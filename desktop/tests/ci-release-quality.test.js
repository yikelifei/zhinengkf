"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_RELEASE_PASS_IDS,
  validateReleaseReport,
  validateStagingReport,
} = require("../tools/ci-release-quality");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const workflowFile = path.join(repositoryRoot, ".github", "workflows", "windows-quality.yml");

function passingReleaseReport() {
  return {
    status: "BLOCKED",
    results: [
      ...REQUIRED_RELEASE_PASS_IDS.map((id) => ({ id, status: "PASS" })),
      { id: "external.secrets", status: "BLOCKED" },
    ],
  };
}

function blockedStagingReport() {
  return {
    status: "BLOCKED",
    mode: "offline-inventory",
    safety: {
      executeExplicitlyEnabled: false,
      externalMutationCount: 0,
      databaseWriteAttempted: false,
      realMessageSendAttempted: false,
      designJobSubmitted: false,
      paymentMutationAttempted: false,
      secretsIncluded: false,
    },
    results: [{ id: "config.database", status: "BLOCKED" }],
  };
}

test("CI accepts external BLOCKED while requiring every local release check to pass", () => {
  assert.deepEqual(validateReleaseReport(passingReleaseReport()), []);
  const report = passingReleaseReport();
  report.results.find((item) => item.id === "build.web").status = "BLOCKED";
  assert.match(validateReleaseReport(report).join("\n"), /build\.web is BLOCKED/);

  const missing = passingReleaseReport();
  missing.results = missing.results.filter((item) => item.id !== "prisma.validate");
  assert.match(validateReleaseReport(missing).join("\n"), /prisma\.validate is missing/);
});

test("CI fails closed on FAIL results and unsafe staging execution", () => {
  const release = passingReleaseReport();
  release.results.push({ id: "security.fixture", status: "FAIL" });
  assert.match(validateReleaseReport(release).join("\n"), /security\.fixture is FAIL/);

  const staging = blockedStagingReport();
  staging.safety.executeExplicitlyEnabled = true;
  staging.safety.realMessageSendAttempted = true;
  staging.results.push({ id: "config.fixture", status: "FAIL" });
  const errors = validateStagingReport(staging).join("\n");
  assert.match(errors, /network execution must stay disabled/);
  assert.match(errors, /real message send/);
  assert.match(errors, /config\.fixture is FAIL/);
});

test("Windows workflow is least privilege, deterministic and always uploads sanitized reports", () => {
  const workflow = fs.readFileSync(workflowFile, "utf8");
  assert.match(workflow, /^permissions:\s*\r?\n\s+contents: read$/m);
  assert.doesNotMatch(workflow, /:\s*write\b/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /secrets\s*\./i);
  assert.doesNotMatch(workflow, /--execute|migrate\s+deploy|ports:(?:start|launch)|wechat:[^\r\n]*(?:send|dispatch)|npm\s+publish/i);
  assert.match(workflow, /runs-on: windows-2022/);
  assert.match(workflow, /timeout-minutes: 45/);
  assert.match(workflow, /node-version: "20\.19\.4"/);
  assert.match(workflow, /python-version: "3\.12\.10"/);
  assert.match(workflow, /cache: npm/);
  assert.match(workflow, /cache: pip/);
  assert.match(workflow, /npm\.cmd ci/);
  assert.match(workflow, /requirements-dev\.txt/);
  assert.match(workflow, /npm\.cmd run ci:release-quality/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /desktop\/\.runtime\/production-release-gate\/latest\.json/);
  assert.match(workflow, /desktop\/\.runtime\/staging-readiness-evidence\/latest\.json/);
  assert.match(workflow, /persist-credentials: false/);
});
