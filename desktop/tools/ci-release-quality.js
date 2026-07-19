"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const reportFiles = Object.freeze({
  release: path.join(desktopRoot, ".runtime", "production-release-gate", "latest.json"),
  staging: path.join(desktopRoot, ".runtime", "staging-readiness-evidence", "latest.json"),
});

const REQUIRED_RELEASE_PASS_IDS = Object.freeze([
  "runtime.node",
  "runtime.npm",
  "runtime.python",
  "dependencies.lock",
  "prisma.inventory",
  "desktop.contract",
  "security.secrets",
  "ports.preflight",
  "prisma.validate",
  "prisma.generate",
  "prisma.migration-sql",
  "security.tests",
  "tests.python",
  "tests.node",
  "build.api",
  "build.web",
  "desktop.syntax",
]);

function runTool(scriptName) {
  const script = path.join(desktopRoot, "tools", scriptName);
  process.stdout.write(`\n[ci-release] running ${scriptName}\n`);
  const executed = spawnSync(process.execPath, [script], {
    cwd: desktopRoot,
    env: {
      ...process.env,
      CI: "true",
      NEXT_TELEMETRY_DISABLED: "1",
      SMART_KEFU_PAUSE: "0",
      SMART_KEFU_QUIET_EXIT: "1",
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 250,
    windowsHide: true,
    shell: false,
  });
  if (executed.stdout) process.stdout.write(executed.stdout);
  if (executed.stderr) process.stderr.write(executed.stderr);
  return {
    exitCode: Number.isInteger(executed.status) ? executed.status : null,
    error: executed.error ? executed.error.message : "",
  };
}

function readReport(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} report is missing or invalid: ${error.message}`);
  }
}

function validateReleaseReport(report) {
  const errors = [];
  if (!Array.isArray(report?.results)) return ["release report has no results array"];
  const resultsById = new Map(report.results.map((item) => [item.id, item]));

  for (const item of report.results) {
    if (item.status === "FAIL") errors.push(`release check ${item.id || "unknown"} is FAIL`);
  }
  for (const id of REQUIRED_RELEASE_PASS_IDS) {
    const item = resultsById.get(id);
    if (!item) errors.push(`required release check ${id} is missing`);
    else if (item.status !== "PASS") errors.push(`required release check ${id} is ${item.status}`);
  }
  return errors;
}

function validateStagingReport(report) {
  const errors = [];
  if (!Array.isArray(report?.results)) return ["staging report has no results array"];
  if (report.mode !== "offline-inventory") errors.push(`staging mode must be offline-inventory, got ${report.mode}`);
  const safety = report.safety || {};
  if (safety.executeExplicitlyEnabled !== false) errors.push("staging network execution must stay disabled in CI");
  if (Number(safety.externalMutationCount) !== 0) errors.push("staging report records an external mutation");
  if (safety.databaseWriteAttempted !== false) errors.push("staging report records a database write");
  if (safety.realMessageSendAttempted !== false) errors.push("staging report records a real message send");
  if (safety.designJobSubmitted !== false) errors.push("staging report records a design job submission");
  if (safety.paymentMutationAttempted !== false) errors.push("staging report records a payment mutation");
  if (safety.secretsIncluded !== false) errors.push("staging report may include secrets");
  for (const item of report.results) {
    if (item.status === "FAIL") errors.push(`staging check ${item.id || "unknown"} is FAIL`);
  }
  return errors;
}

function main() {
  for (const reportFile of Object.values(reportFiles)) {
    fs.rmSync(reportFile, { force: true });
    fs.rmSync(reportFile.replace(/\.json$/, ".md"), { force: true });
  }

  const releaseRun = runTool("production-release-gate.js");
  const stagingRun = runTool("staging-readiness-evidence.js");
  const errors = [];

  for (const [label, run] of [["release", releaseRun], ["staging", stagingRun]]) {
    if (run.error) errors.push(`${label} tool failed to start: ${run.error}`);
    if (![0, 1, 2].includes(run.exitCode)) errors.push(`${label} tool returned unexpected exit code ${run.exitCode}`);
  }

  try {
    errors.push(...validateReleaseReport(readReport(reportFiles.release, "release")));
  } catch (error) {
    errors.push(error.message);
  }
  try {
    errors.push(...validateStagingReport(readReport(reportFiles.staging, "staging")));
  } catch (error) {
    errors.push(error.message);
  }

  if (errors.length) {
    process.stderr.write("\n[ci-release] FAIL\n");
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write("\n[ci-release] PASS: all repository-local checks passed; external staging evidence remains BLOCKED.\n");
}

if (require.main === module) main();

module.exports = {
  REQUIRED_RELEASE_PASS_IDS,
  validateReleaseReport,
  validateStagingReport,
};
