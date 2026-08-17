"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { DeliveryReadinessService } = require("../apps/api/src/delivery/delivery-readiness.service");

const repoRoot = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const freshTimestamp = () => new Date().toISOString();

function writeJson(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
}

function releaseCandidateScope(overrides = {}) {
  return {
    requiresCleanReleaseWorkspace: false,
    statusEntriesAvailable: true,
    statusEntryCount: 0,
    untrackedCount: 0,
    modifiedCount: 0,
    groups: [],
    riskNotes: [],
    ...overrides,
  };
}

function writeDeliveryEvidenceReports(runtime, scope = releaseCandidateScope()) {
  writeJson(runtime, "production-release-gate/latest.json", {
    generatedAt: freshTimestamp(),
    status: "BLOCKED",
    mode: "default",
    results: [
      { id: "tests.node", status: "PASS" },
      { id: "external.channels", status: "BLOCKED" },
    ],
  });
  writeJson(runtime, "staging-readiness-evidence/latest.json", {
    generatedAt: freshTimestamp(),
    status: "BLOCKED",
    mode: "offline-inventory",
    summary: { pass: 2, blocked: 11, fail: 0, total: 13 },
  });
  writeJson(runtime, "database-recovery-rehearsal/latest.json", {
    generatedAt: freshTimestamp(),
    status: "BLOCKED",
    mode: "plan",
    summary: { pass: 4, blocked: 3, fail: 0 },
  });
  writeJson(runtime, "windows-package-verification/latest.json", {
    generatedAt: freshTimestamp(),
    status: "BLOCKED",
    mode: "offline-preflight",
    summary: { pass: 4, blocked: 5, fail: 0, total: 9 },
  });
  writeJson(runtime, "release-candidate-freeze-plan/latest.json", {
    generatedAt: freshTimestamp(),
    status: "BLOCKED",
    summary: { branchCount: 6, statusEntryCount: 20, modifiedCount: 14, untrackedCount: 6 },
  });
  writeJson(runtime, "delivery-handoff/latest.json", {
    generatedAt: freshTimestamp(),
    status: "BLOCKED",
    readiness: "internal-verified-external-blocked",
    summary: { pass: 1, blocked: 9, fail: 0, externalBlockers: 4 },
    releaseCandidateScope: scope,
  });
}

test("delivery readiness summarizes latest audit and acceptance reports without running commands", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-readiness-"));
  writeDeliveryEvidenceReports(runtime, releaseCandidateScope({
    requiresCleanReleaseWorkspace: true,
    statusEntryCount: 3,
    untrackedCount: 1,
    modifiedCount: 2,
    groups: [
      {
        id: "enterprise_wechat",
        label: "Enterprise WeChat production channel",
        risk: "high",
        count: 1,
        untracked: 0,
        modified: 1,
        paths: ["desktop/apps/api/src/wechat-work/wechat-work.service.ts"],
      },
      {
        id: "delivery_evidence",
        label: "Delivery, tests and release evidence",
        risk: "medium",
        count: 2,
        untracked: 1,
        modified: 1,
        paths: ["desktop/tools/delivery-handoff-bundle.js", "desktop/tests/delivery-readiness.test.js"],
      },
    ],
    riskNotes: [
      "Release packaging must be done from a clean, frozen worktree.",
      "Untracked files must be explicitly included or excluded before a release branch is frozen.",
    ],
  }));
  writeJson(runtime, "project-completion-audit/latest.json", {
    generatedAt: freshTimestamp(),
    status: "BLOCKED",
    counts: { PASS: 186, BLOCKED: 4, FAIL: 0 },
    safety: { networkCalls: false, commandsExecuted: false },
    results: [
      {
        id: "external.channels",
        title: "真实渠道联调",
        status: "BLOCKED",
        summary: "需要企业微信真实回调验收。",
        evidence: { external: true },
      },
      {
        id: "legacy.personal_wechat_disabled",
        title: "个人微信遗留通道默认禁用",
        status: "PASS",
        evidence: { productMode: "enterprise_wechat_only" },
      },
    ],
  });
  writeJson(runtime, "acceptance/e2e-old/product-acceptance-report.json", {
    runId: "e2e-old",
    summary: { passed: 1, failed: 1, blocked: 0, skipped: 0, total: 2 },
    results: [{ id: "OLD", status: "failed", errorMessage: "old failure" }],
  });
  const latest = writeJson(runtime, "acceptance/e2e-latest/product-acceptance-report.json", {
    runId: "e2e-latest",
    finishedAt: freshTimestamp(),
    requestedMode: "local-safe",
    executedModes: ["mock", "local-safe"],
    summary: { passed: 6, failed: 0, blocked: 0, skipped: 6, total: 12 },
    safety: { actual: { realSendEnabled: false } },
    artifacts: { markdownReport: "latest.md" },
    results: [],
  });
  const future = Date.now() + 1000;
  fs.utimesSync(latest, future / 1000, future / 1000);

  const report = new DeliveryReadinessService().getReadiness(runtime);

  assert.equal(report.status, "blocked");
  assert.equal(report.networkCalls, false);
  assert.equal(report.commandsExecuted, false);
  assert.equal(report.productMode, "enterprise_wechat_only");
  assert.equal(report.projectAudit.counts.fail, 0);
  assert.equal(report.acceptance.runId, "e2e-latest");
  assert.equal(report.acceptance.summary.passed, 6);
  assert.equal(report.evidenceReports.length, 6);
  assert.equal(report.evidenceReports.find((item) => item.id === "windows_package").counts.fail, 0);
  assert.equal(report.evidenceReports.find((item) => item.id === "release_freeze_plan").status, "BLOCKED");
  assert.equal(report.evidenceReports.find((item) => item.id === "delivery_handoff").mode, "internal-verified-external-blocked");
  assert.equal(report.releaseCandidateScope.available, true);
  assert.equal(report.releaseCandidateScope.requiresCleanReleaseWorkspace, true);
  assert.equal(report.releaseCandidateScope.statusEntryCount, 3);
  assert.equal(report.releaseCandidateScope.untrackedCount, 1);
  assert.equal(report.releaseCandidateScope.groups[0].id, "enterprise_wechat");
  assert.equal(report.localDelivery.state, "local_evidence_incomplete");
  assert.equal(report.localDelivery.localCodeDefectCount, 0);
  assert.equal(report.localDelivery.localEvidenceBlockerCount, 1);
  assert.equal(report.localDelivery.externalBlockerCount, 1);
  assert.equal(report.localDelivery.productionReleaseAllowed, false);
  assert.equal(report.localDelivery.localEvidenceBlockerIds.includes("release_candidate.clean_workspace_required"), true);
  assert.equal(report.blockers.length, 2);
  assert.equal(report.blockers[0].id, "release_candidate.clean_workspace_required");
  assert.equal(report.blockers.some((item) => item.id === "release_candidate.clean_workspace_required"), true);
  const channelBlocker = report.blockers.find((item) => item.id === "external.channels");
  assert.equal(channelBlocker.external, true);
  assert.equal(channelBlocker.phase, "after_icp");
  assert.match(channelBlocker.ownerHint, /企业微信|开发/);
  assert.ok(channelBlocker.actionItems.length >= 3);
  assert.equal(report.recommendedCommands.length, 0);
  assert.match(report.nextAction, /发布候选工作区/);
});

test("delivery readiness blocks mock-only acceptance from being treated as deliverable", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-readiness-mock-only-"));
  writeDeliveryEvidenceReports(runtime);
  writeJson(runtime, "project-completion-audit/latest.json", {
    generatedAt: freshTimestamp(),
    status: "PASS",
    counts: { PASS: 10, BLOCKED: 0, FAIL: 0 },
    results: [],
  });
  writeJson(runtime, "acceptance/e2e-mock/product-acceptance-report.json", {
    runId: "e2e-mock",
    finishedAt: freshTimestamp(),
    requestedMode: "mock",
    executedModes: ["mock"],
    summary: { passed: 6, failed: 0, blocked: 0, skipped: 0, total: 6 },
    results: [],
  });

  const report = new DeliveryReadinessService().getReadiness(runtime);

  assert.equal(report.status, "blocked");
  assert.equal(report.localDelivery.state, "local_evidence_incomplete");
  assert.equal(report.localDelivery.localEvidenceBlockerIds.includes("acceptance.local_safe_required"), true);
  assert.equal(report.blockers.some((item) => item.id === "acceptance.local_safe_required"), true);
  assert.equal(report.blockers.find((item) => item.id === "acceptance.local_safe_required").phase, "during_icp");
  assert.match(report.blockers.find((item) => item.id === "acceptance.local_safe_required").actionItems.join("\n"), /local-safe/);
  assert.equal(report.recommendedCommands[0].command, "npm.cmd run acceptance:e2e -- --mode local-safe");
  assert.match(report.nextAction, /local-safe 产品验收未执行/);
});

test("delivery readiness fails closed when acceptance has a failed scenario", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-readiness-fail-"));
  writeDeliveryEvidenceReports(runtime);
  writeJson(runtime, "project-completion-audit/latest.json", {
    generatedAt: freshTimestamp(),
    status: "PASS",
    counts: { PASS: 1, BLOCKED: 0, FAIL: 0 },
    results: [],
  });
  writeJson(runtime, "acceptance/e2e-failed/product-acceptance-report.json", {
    runId: "e2e-failed",
    finishedAt: freshTimestamp(),
    summary: { passed: 5, failed: 1, blocked: 0, skipped: 0, total: 6 },
    results: [{ id: "MCK-FAIL", titleZh: "失败验收", status: "failed", errorMessage: "layout failed" }],
  });

  const report = new DeliveryReadinessService().getReadiness(runtime);

  assert.equal(report.status, "failed");
  assert.equal(report.localDelivery.state, "local_failed");
  assert.equal(report.localDelivery.localCodeDefectCount > 0, true);
  assert.equal(report.blockers[0].source, "product_acceptance");
  assert.ok(report.blockers[0].actionItems.length >= 2);
  assert.match(report.nextAction, /失败项/);
});

test("unsafe staging evidence remains an external blocker instead of a local code defect", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-readiness-staging-fail-"));
  writeDeliveryEvidenceReports(runtime, releaseCandidateScope({ requiresCleanReleaseWorkspace: false }));
  writeJson(runtime, "project-completion-audit/latest.json", {
    generatedAt: freshTimestamp(),
    status: "BLOCKED",
    counts: { PASS: 10, BLOCKED: 1, FAIL: 0 },
    results: [{ id: "external.staging", status: "BLOCKED", evidence: { external: true } }],
  });
  writeJson(runtime, "acceptance/e2e-local/product-acceptance-report.json", {
    runId: "e2e-local",
    finishedAt: freshTimestamp(),
    requestedMode: "local-safe",
    executedModes: ["mock", "local-safe"],
    summary: { passed: 14, failed: 0, blocked: 0, skipped: 2, total: 16 },
    results: [],
  });
  writeJson(runtime, "staging-readiness-evidence/latest.json", {
    generatedAt: freshTimestamp(),
    status: "FAIL",
    summary: { pass: 7, blocked: 5, fail: 1, total: 13 },
    results: [{ id: "config.database", status: "FAIL" }],
  });

  const report = new DeliveryReadinessService().getReadiness(runtime);
  const staging = report.evidenceReports.find((item) => item.id === "staging_readiness");
  const stagingBlocker = report.blockers.find((item) => item.id === "evidence.staging_readiness");

  assert.equal(staging.external, true);
  assert.equal(staging.status, "FAIL");
  assert.equal(stagingBlocker.external, true);
  assert.equal(stagingBlocker.status, "blocked");
  assert.equal(report.status, "blocked");
  assert.equal(report.localDelivery.localCodeDefectCount, 0);
});

test("delivery readiness UI renders blocker owners, phases, and action items", () => {
  const source = read("apps/web/src/features/system/delivery-readiness-page.tsx");
  const css = read("apps/web/src/features/governance-pages.module.css");

  assert.match(source, /evidenceReports/);
  assert.match(source, /EvidenceReportRecord/);
  assert.match(source, /windows_package/);
  assert.match(source, /release_freeze_plan/);
  assert.match(source, /delivery_handoff/);
  assert.match(source, /blocker\.ownerHint/);
  assert.match(source, /phaseLabel\(blocker\.phase\)/);
  assert.match(source, /blocker\.actionItems/);
  assert.match(source, /ReleaseCandidateScopePanel/);
  assert.match(source, /LocalDeliveryVerdictPanel/);
  assert.match(source, /localDelivery/);
  assert.match(source, /productionReleaseAllowed/);
  assert.match(source, /localCodeDefectCount/);
  assert.match(source, /releaseCandidateScope/);
  assert.match(source, /scope\.groups/);
  assert.match(source, /scope\.riskNotes/);
  assert.match(source, /riskLabel\(group\.risk\)/);
  assert.match(source, /compactList/);
  assert.match(css, /\.compactList/);
  assert.doesNotMatch(source, /runProductAcceptance|projectCompletionAudit|exec|spawn|writeFile/i);
});

test("old PASS evidence is blocked until the report is regenerated", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-readiness-stale-"));
  writeDeliveryEvidenceReports(runtime);
  writeJson(runtime, "project-completion-audit/latest.json", {
    generatedAt: "2026-07-01T00:00:00.000Z",
    status: "PASS",
    counts: { PASS: 10, BLOCKED: 0, FAIL: 0 },
    results: [],
  });
  writeJson(runtime, "acceptance/e2e-local/product-acceptance-report.json", {
    runId: "e2e-local",
    finishedAt: freshTimestamp(),
    requestedMode: "local-safe",
    executedModes: ["local-safe"],
    summary: { passed: 10, failed: 0, blocked: 0, skipped: 0, total: 10 },
    results: [],
  });

  const report = new DeliveryReadinessService().getReadiness(runtime);

  assert.equal(report.status, "blocked");
  assert.equal(report.freshness.staleSourceIds.includes("project_audit"), true);
  assert.equal(report.blockers.some((item) => item.id === "evidence_stale.project_audit"), true);
  assert.equal(report.localDelivery.productionReleaseAllowed, false);
  assert.match(report.nextAction, /project:completion:audit/);
});

test("delivery readiness is unknown when no reports exist", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-readiness-empty-"));
  const report = new DeliveryReadinessService().getReadiness(runtime);

  assert.equal(report.status, "unknown");
  assert.equal(report.projectAudit.available, false);
  assert.equal(report.acceptance.available, false);
  assert.ok(report.recommendedCommands.map((item) => item.command).includes("npm.cmd run acceptance:e2e -- --mode local-safe"));
  assert.ok(report.recommendedCommands.map((item) => item.command).includes("npm.cmd run project:completion:audit"));
  assert.ok(report.recommendedCommands.map((item) => item.command).includes("npm.cmd run delivery:freeze-plan"));
  assert.ok(report.recommendedCommands.map((item) => item.command).includes("npm.cmd run delivery:handoff"));
});

test("delivery readiness exposes build-workspace commands in the server platform syntax", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-readiness-linux-"));
  const report = new DeliveryReadinessService().getReadiness(runtime, "linux");

  assert.deepEqual(report.commandEnvironment, {
    platform: "linux",
    shell: "posix",
    workspace: "development_or_release",
    productionServerExecutionSupported: false,
  });
  assert.ok(report.recommendedCommands.length > 0);
  assert.equal(report.recommendedCommands.every((item) => item.command.startsWith("npm run ")), true);
  assert.equal(report.evidenceReports.every((item) => item.command.startsWith("npm run ")), true);
  assert.equal(report.blockers.every((item) => !item.command || !item.command.includes("npm.cmd")), true);
});
