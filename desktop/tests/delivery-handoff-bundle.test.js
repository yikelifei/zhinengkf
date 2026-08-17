"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SCHEMA_VERSION,
  STATUS,
  collectDeliveryHandoffBundle,
  extractExternalBlockers,
  parseArgs,
  renderMarkdown,
  summarizeReleaseCandidateScope,
  writeReports,
} = require("../tools/delivery-handoff-bundle");

const REVISION = "a".repeat(40);

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-delivery-handoff-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function externalResult(id, title, summary) {
  return {
    id,
    title,
    status: STATUS.BLOCKED,
    summary,
    evidence: { external: true, token: "super-secret-value-that-must-not-enter-report" },
  };
}

function projectAuditReport() {
  return {
    schemaVersion: "smart_kefu_project_completion_audit_v3",
    generatedAt: "2026-07-26T03:22:21.229Z",
    mode: "offline-readonly-inventory",
    status: STATUS.BLOCKED,
    counts: { PASS: 186, BLOCKED: 4, FAIL: 0 },
    safety: {
      networkCalls: false,
      commandsExecuted: false,
      externalWrites: false,
      secretFilesRead: false,
      realMessageSendAttempted: false,
      databaseConnectionAttempted: false,
      reportContainsSecrets: false,
    },
    results: [
      { id: "release.gate", title: "Production release gate", status: STATUS.PASS, summary: "implemented", evidence: { path: "desktop/tools/production-release-gate.js" } },
      externalResult("external.windows_signing", "Windows signing", "Needs signed installer and target-machine evidence."),
      externalResult("external.staging", "Staging", "Needs public HTTPS, Prisma, Redis and read-only staging evidence."),
      externalResult("external.channels", "Channels", "Needs Enterprise WeChat callback and design-platform readiness evidence."),
      externalResult("external.database_recovery", "Database recovery", "Needs isolated database recovery rehearsal evidence."),
      { id: "legacy.personal_wechat_disabled", title: "Legacy personal WeChat disabled", status: STATUS.PASS, summary: "Enterprise WeChat only.", evidence: { productMode: "enterprise_wechat_only" } },
    ],
  };
}

function acceptanceReport() {
  return {
    schemaVersion: 1,
    matrixVersion: "2026-07-25-enterprise-wechat-only",
    runId: "e2e-fixture",
    requestedMode: "local-safe",
    executedModes: ["mock", "local-safe"],
    startedAt: "2026-07-26T03:24:01.697Z",
    finishedAt: "2026-07-26T03:24:30.800Z",
    environment: {
      desktopRoot: "fixture",
      token: "super-secret-value-that-must-not-enter-report",
    },
    safety: {
      policy: {
        paymentMutation: "external_forbidden_internal_ledger_allowed",
        allowedInternalPaymentMutations: [
          "/api/quotes/:id/verify-payment-proof",
        ],
      },
      actual: {
        realSendEnabled: false,
        paymentMutationEnabled: false,
        externalMutationCount: 0,
        safetyViolations: [],
      },
    },
    summary: { passed: 10, failed: 0, blocked: 0, skipped: 2, total: 12 },
    results: [],
  };
}

function stagingReport() {
  return {
    schemaVersion: "smart_kefu_staging_readiness_v2",
    repositoryRevision: REVISION,
    runId: "staging-fixture",
    generatedAt: "2026-07-26T03:00:00.000Z",
    status: STATUS.BLOCKED,
    mode: "offline-inventory",
    summary: { pass: 3, blocked: 12, fail: 0, total: 15 },
    safety: {
      executeExplicitlyEnabled: false,
      allowedNetworkMethods: [],
      realMessageSendAttempted: false,
      databaseWriteAttempted: false,
      secretsIncluded: false,
    },
    results: [],
  };
}

function failedStagingConfigurationReport() {
  return {
    ...stagingReport(),
    status: STATUS.FAIL,
    summary: { pass: 7, blocked: 5, fail: 1, total: 13 },
    results: [
      {
        id: "config.database",
        status: STATUS.FAIL,
        summary: "DATABASE_URL uses obvious default administrator credentials",
      },
    ],
  };
}

function freezePlanReport() {
  return {
    schemaVersion: "smart_kefu_release_candidate_freeze_plan_v1",
    generatedAt: "2026-07-26T04:01:00.000Z",
    status: STATUS.BLOCKED,
    summary: {
      branchCount: 6,
      statusEntryCount: 3,
      modifiedCount: 2,
      untrackedCount: 1,
    },
    branchPlans: [
      { id: "foundation_governance", branchName: "codex/rc-foundation-governance" },
      { id: "legacy_personal_wechat_compat", branchName: "codex/compat-personal-wechat-quarantine" },
    ],
  };
}

function incompleteReleaseGateReport() {
  return {
    schemaVersion: 2,
    generatedAt: "2026-07-26T04:03:00.000Z",
    completed: false,
    currentStage: "running tests.node.09",
    status: STATUS.FAIL,
    results: [
      { id: "tests.node.08", title: "Node tests shard 8/15", status: STATUS.FAIL, summary: "stale partial failure" },
      { id: "gate.incomplete", title: "Production release gate incomplete", status: STATUS.BLOCKED, summary: "later stages did not run" },
    ],
  };
}

function completedFailedReleaseGateReport() {
  return {
    schemaVersion: 2,
    generatedAt: "2026-07-26T04:03:00.000Z",
    completed: true,
    currentStage: "done",
    status: STATUS.FAIL,
    results: [
      { id: "tests.node.08", title: "Node tests shard 8/15", status: STATUS.FAIL, summary: "current failure" },
    ],
  };
}

function installFixture(runtimeRoot) {
  writeJson(path.join(runtimeRoot, "project-completion-audit", "latest.json"), projectAuditReport());
  writeJson(path.join(runtimeRoot, "staging-readiness-evidence", "latest.json"), stagingReport());
  writeJson(path.join(runtimeRoot, "release-candidate-freeze-plan", "latest.json"), freezePlanReport());
  writeJson(path.join(runtimeRoot, "acceptance", "e2e-fixture", "product-acceptance-report.json"), acceptanceReport());
}

test("handoff bundle treats passing local acceptance plus external blockers as blocked, not ready", (t) => {
  const root = temporaryDirectory(t);
  const runtimeRoot = path.join(root, ".runtime");
  installFixture(runtimeRoot);

  const report = collectDeliveryHandoffBundle({
    runtimeRoot,
    reportRoot: path.join(runtimeRoot, "delivery-handoff"),
    generatedAt: "2026-07-26T04:00:00.000Z",
    runId: "handoff-fixture",
    repositoryState: {
      revision: REVISION,
      clean: false,
      statusEntries: [
        { status: "M", path: "desktop/apps/api/src/wechat-work/wechat-work.service.ts" },
        { status: "??", path: "desktop/apps/api/src/personal-wechat-rpa/legacy-warning.ts" },
        { status: "M", path: "desktop/tests/demo-data-production-boundary.test.js" },
      ],
    },
  });

  assert.equal(report.schemaVersion, SCHEMA_VERSION);
  assert.equal(report.status, STATUS.BLOCKED);
  assert.equal(report.readiness, "internal-verified-external-blocked");
  assert.equal(report.localDeliveryVerdict.state, "local_verified_external_blocked");
  assert.equal(report.localDeliveryVerdict.localEvidenceReady, true);
  assert.equal(report.localDeliveryVerdict.localCodeDefectCount, 0);
  assert.equal(report.localDeliveryVerdict.externalBlockerCount, 4);
  assert.equal(report.localDeliveryVerdict.productionReleaseAllowed, false);
  assert.equal(report.repository.clean, false);
  assert.equal(report.repository.statusEntryCount, 3);
  assert.equal(report.releaseCandidateScope.requiresCleanReleaseWorkspace, true);
  assert.equal(report.releaseCandidateScope.statusEntryCount, 3);
  assert.equal(report.releaseCandidateScope.untrackedCount, 1);
  assert.equal(report.releaseCandidateScope.groups.some((group) => group.id === "enterprise_wechat"), true);
  assert.equal(report.releaseCandidateScope.groups.some((group) => group.id === "delivery_evidence"), true);
  const legacyGroup = report.releaseCandidateScope.groups.find((group) => group.id === "legacy_personal_wechat");
  assert.equal(legacyGroup.risk, "high");
  assert.equal(legacyGroup.untracked, 1);
  assert.equal(report.releaseCandidateScope.riskNotes.some((note) => note.includes("compatibility-only")), true);
  assert.equal(report.releaseCandidateScope.riskNotes.some((note) => note.includes("Untracked files")), true);
  assert.equal(report.productScope.productionChannel, "enterprise_wechat");
  assert.equal(report.productScope.legacyPersonalWechatProductionCore, false);
  assert.equal(report.safety.networkAttempted, false);
  assert.equal(report.safety.realMessageSendAttempted, false);
  assert.equal(report.safety.databaseCommandAttempted, false);
  assert.equal(report.safety.externalPaymentMutationAttempted, false);
  assert.equal(report.safety.internalPaymentLedgerAllowed, true);
  assert.equal(report.safety.paymentBoundary, "external-forbidden-internal-ledger-allowed");
  assert.equal(report.reports.find((item) => item.id === "product.acceptance").status, STATUS.PASS);
  assert.equal(report.reports.find((item) => item.id === "product.acceptance").safety.internalPaymentLedgerAllowed, true);
  assert.equal(report.reports.find((item) => item.id === "release.freeze_plan").status, STATUS.BLOCKED);
  assert.deepEqual(report.externalBlockers.map((item) => item.id), [
    "external.windows_signing",
    "external.staging",
    "external.channels",
    "external.database_recovery",
  ]);
  assert.equal(report.externalBlockers.every((item) => item.actionItems.length > 0 && item.requiredEvidence.length > 0), true);
  assert.equal(JSON.stringify(report).includes("super-secret-value-that-must-not-enter-report"), false);
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Local Delivery Verdict/);
  assert.match(markdown, /Production release allowed: false/);
  assert.match(markdown, /Release Candidate Scope/);
  assert.match(markdown, /Legacy personal WeChat compatibility/);
  assert.match(markdown, /Clean release workspace required: true/);
});

test("incomplete production release gate remains blocked instead of failing handoff", (t) => {
  const root = temporaryDirectory(t);
  const runtimeRoot = path.join(root, ".runtime");
  installFixture(runtimeRoot);
  writeJson(path.join(runtimeRoot, "production-release-gate", "latest.json"), incompleteReleaseGateReport());

  const report = collectDeliveryHandoffBundle({
    runtimeRoot,
    reportRoot: path.join(runtimeRoot, "delivery-handoff"),
    generatedAt: "2026-07-26T04:00:00.000Z",
    runId: "incomplete-gate-fixture",
    repositoryState: { revision: REVISION, clean: false, statusEntries: [] },
  });

  const releaseGate = report.reports.find((item) => item.id === "release.gate");
  assert.equal(releaseGate.status, STATUS.BLOCKED);
  assert.match(releaseGate.summary, /incomplete release gate/);
  assert.equal(report.status, STATUS.BLOCKED);
  assert.equal(report.readiness, "internal-verified-external-blocked");
  assert.equal(report.localDeliveryVerdict.localCodeDefectCount, 0);
});

test("completed failed production release gate still fails handoff", (t) => {
  const root = temporaryDirectory(t);
  const runtimeRoot = path.join(root, ".runtime");
  installFixture(runtimeRoot);
  writeJson(path.join(runtimeRoot, "production-release-gate", "latest.json"), completedFailedReleaseGateReport());

  const report = collectDeliveryHandoffBundle({
    runtimeRoot,
    reportRoot: path.join(runtimeRoot, "delivery-handoff"),
    generatedAt: "2026-07-26T04:00:00.000Z",
    runId: "failed-gate-fixture",
    repositoryState: { revision: REVISION, clean: false, statusEntries: [] },
  });

  assert.equal(report.reports.find((item) => item.id === "release.gate").status, STATUS.FAIL);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.readiness, "internal-failed");
  assert.equal(report.localDeliveryVerdict.localCodeDefectCount, 1);
});

test("unsafe optional staging configuration blocks production without becoming a local code defect", (t) => {
  const root = temporaryDirectory(t);
  const runtimeRoot = path.join(root, ".runtime");
  installFixture(runtimeRoot);
  writeJson(path.join(runtimeRoot, "staging-readiness-evidence", "latest.json"), failedStagingConfigurationReport());

  const report = collectDeliveryHandoffBundle({
    runtimeRoot,
    reportRoot: path.join(runtimeRoot, "delivery-handoff"),
    generatedAt: "2026-07-26T04:00:00.000Z",
    runId: "failed-staging-config-fixture",
    repositoryState: { revision: REVISION, clean: false, statusEntries: [] },
  });

  const staging = report.reports.find((item) => item.id === "staging.readiness");
  assert.equal(staging.status, STATUS.FAIL);
  assert.equal(staging.failureDomain, "external");
  assert.equal(report.status, STATUS.BLOCKED);
  assert.equal(report.readiness, "internal-verified-external-blocked");
  assert.equal(report.localDeliveryVerdict.state, "local_verified_external_blocked");
  assert.equal(report.localDeliveryVerdict.localCodeDefectCount, 0);
  assert.equal(report.summary.fail, 0);
});

test("missing project audit fails the bundle because local completion cannot be certified", (t) => {
  const root = temporaryDirectory(t);
  const runtimeRoot = path.join(root, ".runtime");
  writeJson(path.join(runtimeRoot, "acceptance", "e2e-fixture", "product-acceptance-report.json"), acceptanceReport());

  const report = collectDeliveryHandoffBundle({
    runtimeRoot,
    generatedAt: "2026-07-26T04:00:00.000Z",
    runId: "missing-audit-fixture",
    repositoryState: { revision: REVISION, clean: true },
  });

  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.readiness, "internal-failed");
  assert.equal(report.reports.find((item) => item.id === "project.completion.audit").status, STATUS.FAIL);
});

test("reports are written under delivery-handoff and markdown names the external evidence", (t) => {
  const root = temporaryDirectory(t);
  const runtimeRoot = path.join(root, ".runtime");
  installFixture(runtimeRoot);
  const report = collectDeliveryHandoffBundle({
    runtimeRoot,
    reportRoot: path.join(runtimeRoot, "delivery-handoff"),
    runId: "write-fixture",
    generatedAt: "2026-07-26T04:00:00.000Z",
    repositoryState: { revision: REVISION, clean: true },
  });
  const artifacts = writeReports(report, path.join(runtimeRoot, "delivery-handoff"));
  assert.equal(fs.existsSync(artifacts.latestJson), true);
  assert.equal(fs.existsSync(artifacts.latestMarkdown), true);
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Enterprise WeChat only/);
  assert.match(markdown, /external\.channels/);
  assert.match(markdown, /no external payment mutation/);
  assert.match(markdown, /internal payment-proof ledger/);
  assert.match(markdown, /Release candidate freeze plan/);
  assert.match(markdown, /Release Candidate Scope/);
  assert.match(markdown, /Clean release workspace required: false/);
  assert.match(markdown, /Status entries: 0/);
  assert.doesNotMatch(markdown, /no payment mutation and no real message send/);
  assert.match(markdown, /npm run delivery:acceptance/);
  assert.match(markdown, /npm run delivery:freeze-plan/);
});

test("release candidate scope summarizes dirty paths by product risk", () => {
  const cleanScope = summarizeReleaseCandidateScope({ clean: true, statusEntries: [] });
  assert.equal(cleanScope.requiresCleanReleaseWorkspace, false);
  assert.equal(cleanScope.statusEntriesAvailable, true);
  assert.equal(cleanScope.statusEntryCount, 0);
  assert.deepEqual(cleanScope.groups, []);

  const unknownScope = summarizeReleaseCandidateScope({ clean: false });
  assert.equal(unknownScope.requiresCleanReleaseWorkspace, true);
  assert.equal(unknownScope.statusEntriesAvailable, false);
  assert.equal(unknownScope.riskNotes.some((note) => note.includes("clean, frozen worktree")), true);

  const dirtyScope = summarizeReleaseCandidateScope({
    clean: false,
    statusEntries: [
      { status: "M", path: "desktop/apps/api/src/wechat-work/wechat-work.service.ts" },
      { status: "M", path: "desktop/apps/web/src/features/integrations/integration-pages.module.css" },
      { status: "??", path: "desktop/apps/api/src/personal-wechat-rpa/legacy-warning.ts" },
      { status: "M", path: "desktop/apps/api/src/orders/orders.service.ts" },
      { status: "M", path: "desktop/apps/web/src/features/training/TrainingWorkbench.tsx" },
      { status: "M", path: "desktop/tools/delivery-handoff-bundle.js" },
    ],
  });
  assert.deepEqual(dirtyScope.groups.map((group) => group.id), [
    "commerce",
    "enterprise_wechat",
    "legacy_personal_wechat",
    "delivery_evidence",
    "training_agent_ai",
  ]);
  assert.equal(dirtyScope.modifiedCount, 5);
  assert.equal(dirtyScope.untrackedCount, 1);
  assert.equal(dirtyScope.groups.find((group) => group.id === "legacy_personal_wechat").untracked, 1);
  assert.deepEqual(
    dirtyScope.groups.find((group) => group.id === "enterprise_wechat").allPaths,
    [
      "desktop/apps/api/src/wechat-work/wechat-work.service.ts",
      "desktop/apps/web/src/features/integrations/integration-pages.module.css",
    ],
  );
  assert.equal(dirtyScope.groups.every((group) => group.allPaths.length === group.count), true);
  assert.equal(dirtyScope.riskNotes.some((note) => note.includes("production channel")), true);
});

test("external blocker extraction falls back to the fixed release blockers", () => {
  const blockers = extractExternalBlockers({ results: [] });
  assert.deepEqual(blockers.map((item) => item.id), [
    "external.windows_signing",
    "external.staging",
    "external.channels",
    "external.database_recovery",
  ]);
});

test("CLI is intentionally read-only and package script is explicit", () => {
  assert.deepEqual(parseArgs([]), { help: false });
  assert.deepEqual(parseArgs(["--help"]), { help: true });
  assert.throws(() => parseArgs(["--execute"]), /unknown argument/);

  const source = fs.readFileSync(path.resolve(__dirname, "..", "tools", "delivery-handoff-bundle.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
  assert.equal(packageJson.scripts["delivery:handoff"], "node tools/delivery-handoff-bundle.js");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /method:\s*["']POST["']/);
  assert.doesNotMatch(source, /send_msg|send-text|verify-payment-proof|migrate\W+deploy|pg_restore/);
  assert.match(source, /realMessageSendAttempted:\s*false/);
  assert.match(source, /networkAttempted:\s*false/);
  assert.match(source, /externalPaymentMutationAttempted:\s*false/);
});
