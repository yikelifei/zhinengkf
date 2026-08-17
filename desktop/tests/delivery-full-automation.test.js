"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  EXIT_CODE,
  SCHEMA_VERSION,
  STATUS,
  buildDeliveryAutomationPlan,
  buildLocalVerdict,
  latestAcceptanceReportPath,
  parseArgs,
  renderMarkdown,
  summarizeStepResult,
  writeReports,
} = require("../tools/delivery-full-automation");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-delivery-full-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function handoffReport(overrides = {}) {
  return {
    localDeliveryVerdict: {
      state: "local_verified_external_blocked",
      localEvidenceReady: true,
      productionReleaseAllowed: false,
      localCodeDefectCount: 0,
      externalBlockerCount: 4,
      externalBlockerIds: [
        "external.windows_signing",
        "external.staging",
        "external.channels",
        "external.database_recovery",
      ],
      ...overrides,
    },
  };
}

test("CLI defaults stay local-safe and require explicit external options", () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.executeStagingReadiness, false);
  assert.equal(defaults.executeDatabaseRecovery, false);
  assert.equal(defaults.validateExternalEvidence, false);
  assert.equal(defaults.restartMock, true);
  assert.equal(defaults.skipReleaseGate, false);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["--no-restart-mock", "--skip-release-gate"]).restartMock, false);
  assert.equal(parseArgs(["--no-restart-mock", "--skip-release-gate"]).skipReleaseGate, true);
  assert.throws(() => parseArgs(["--execute-database-recovery"]), /requires --database-confirm/);
  assert.throws(() => parseArgs(["--evidence-root", "bundle"]), /external evidence validation requires/);
  assert.throws(() => parseArgs(["--send-real-message"]), /unknown argument/);
});

test("delivery plan wires the complete safe chain by default", () => {
  const plan = buildDeliveryAutomationPlan(parseArgs([]));
  assert.deepEqual(plan.map((step) => step.id), [
    "ports.stop_before_acceptance",
    "acceptance.local_safe",
    "audit.project_completion",
    "database.recovery_plan",
    "staging.readiness",
    "windows.package_preflight",
    "ports.stop_before_gate",
    "release.gate",
    "handoff.initial",
    "freeze.plan",
    "handoff.final",
    "mock.restart",
    "mock.final_status",
  ]);
  assert.equal(plan.find((step) => step.id === "ports.stop_before_acceptance").verifyManagedPortsStopped, true);
  assert.equal(plan.find((step) => step.id === "database.recovery_plan").safetyClass, "offline-plan");
  assert.equal(plan.find((step) => step.id === "staging.readiness").args.includes("--execute"), false);
  assert.equal(plan.find((step) => step.id === "release.gate").expectedBlocked, true);
  assert.equal(plan.find((step) => step.id === "ports.stop_before_gate").verifyManagedPortsStopped, true);
  assert.equal(plan.every((step) => !step.command.includes("git")), true);
});

test("guarded options add execute/evidence steps without enabling message or payment mutations", () => {
  const options = parseArgs([
    "--execute-staging-readiness",
    "--execute-database-recovery",
    "--database-confirm",
    "RESTORE ISOLATED REHEARSAL DATABASE: sandbox",
    "--evidence-root",
    "E:/evidence",
    "--staging-report",
    "staging.json",
    "--recovery-report",
    "recovery.json",
    "--windows-report",
    "windows.json",
  ]);
  const plan = buildDeliveryAutomationPlan(options);
  const database = plan.find((step) => step.id === "database.recovery_execute");
  const staging = plan.find((step) => step.id === "staging.readiness");
  const evidence = plan.find((step) => step.id === "external.evidence_bundle");
  assert.equal(database.safetyClass, "guarded-database-recovery");
  assert.deepEqual(database.args.slice(-2), ["--confirm", "RESTORE ISOLATED REHEARSAL DATABASE: sandbox"]);
  assert.equal(staging.safetyClass, "read-only-external");
  assert.equal(staging.args.includes("--execute"), true);
  assert.equal(evidence.safetyClass, "local-validation");
  assert.equal(plan.some((step) => /send|payment/i.test(step.command)), false);
});

test("local verdict counts local defects and keeps external blocker IDs", () => {
  const verdict = buildLocalVerdict({
    handoff: handoffReport({ externalBlockerCount: 2, externalBlockerIds: ["external.staging", "external.channels"] }),
    projectAudit: { completionVerdict: { localCodeDefectCount: 0 } },
    releaseGate: { results: [{ id: "tests.node", status: STATUS.FAIL }] },
    acceptance: {
      summary: { failed: 1 },
      safety: { actual: { safetyViolations: [{ id: "mutation" }] } },
    },
    freezePlan: { localDeliveryVerdict: { releaseScopeFrozen: false } },
  });

  assert.equal(verdict.localCodeDefectCount, 3);
  assert.equal(verdict.externalBlockerCount, 2);
  assert.deepEqual(verdict.externalBlockerIds, ["external.staging", "external.channels"]);
  assert.equal(verdict.releaseScopeFrozen, false);
  assert.equal(verdict.productionReleaseAllowed, false);
});

test("step summary does not let stale PASS reports hide command failures", (t) => {
  const root = temporaryDirectory(t);
  const reportPath = path.join(root, "latest.json");
  writeJson(reportPath, { status: STATUS.PASS, summary: { pass: 1, blocked: 0, fail: 0 } });
  const step = { id: "fixture", title: "Fixture", command: "node", args: ["fixture.js"], reportPath, expectedBlocked: false, safetyClass: "local" };

  assert.equal(summarizeStepResult(step, { status: 1, signal: null, error: null }, 10).status, STATUS.FAIL);
  assert.equal(summarizeStepResult(step, { status: EXIT_CODE.BLOCKED, signal: null, error: null }, 10).status, STATUS.BLOCKED);
  assert.equal(summarizeStepResult(step, { status: 0, signal: null, error: null }, 10).status, STATUS.PASS);
});

test("latest acceptance report resolves the newest nested report", (t) => {
  const root = temporaryDirectory(t);
  const oldReport = path.join(root, "old", "product-acceptance-report.json");
  const newReport = path.join(root, "new", "nested", "product-acceptance-report.json");
  writeJson(oldReport, { status: STATUS.PASS });
  writeJson(newReport, { status: STATUS.PASS });
  const now = new Date("2026-07-30T00:00:00.000Z");
  fs.utimesSync(oldReport, now, now);
  fs.utimesSync(newReport, new Date(now.getTime() + 1000), new Date(now.getTime() + 1000));

  assert.equal(latestAcceptanceReportPath(root), newReport);
});

test("reports render external commands and keep safety boundary visible", (t) => {
  const root = temporaryDirectory(t);
  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: "2026-07-30T00:00:00.000Z",
    runId: "delivery-full-fixture",
    status: STATUS.BLOCKED,
    localVerdict: {
      state: "local_verified_external_blocked",
      localCodeDefectCount: 0,
      externalBlockerCount: 4,
      releaseScopeFrozen: false,
      productionReleaseAllowed: false,
    },
    steps: [{ status: STATUS.PASS, title: "Run local-safe product acceptance", summary: "pass=14 blocked=0 fail=0" }],
    reports: [{ id: "releaseGate", status: STATUS.BLOCKED, summary: "external blockers remain" }],
    nextExternalCommands: [{ id: "staging.read_only_execute", command: "npm.cmd run delivery:full -- --execute-staging-readiness" }],
  };
  const artifacts = writeReports(report, root);
  const markdown = renderMarkdown(report);

  assert.equal(fs.existsSync(artifacts.latestJson), true);
  assert.equal(fs.existsSync(artifacts.latestMarkdown), true);
  assert.match(markdown, /default run does not send real messages/);
  assert.match(markdown, /External Commands/);
  assert.match(markdown, /delivery:full -- --execute-staging-readiness/);
});

test("package script exposes the full automation entry", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
  const source = fs.readFileSync(path.resolve(__dirname, "..", "tools", "delivery-full-automation.js"), "utf8");
  assert.equal(packageJson.scripts["delivery:full"], "node tools/delivery-full-automation.js");
  assert.doesNotMatch(source, /git add|git commit|git push|migrate deploy|send-text|verify-payment-proof/);
  assert.match(source, /realMessageSendAttempted:\s*false/);
  assert.match(source, /paymentMutationAttempted:\s*false/);
  assert.match(source, /designJobSubmitted:\s*false/);
});
