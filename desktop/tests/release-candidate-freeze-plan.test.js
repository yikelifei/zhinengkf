"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SCHEMA_VERSION,
  STATUS,
  buildFreezePlan,
  parseArgs,
  renderMarkdown,
  writeReports,
} = require("../tools/release-candidate-freeze-plan");

function handoffFixture() {
  return {
    generatedAt: "2026-07-26T10:59:49.875Z",
    status: "BLOCKED",
    readiness: "internal-verified-external-blocked",
    summary: { externalBlockers: 4 },
    releaseCandidateScope: {
      requiresCleanReleaseWorkspace: true,
      statusEntriesAvailable: true,
      statusEntryCount: 20,
      modifiedCount: 14,
      untrackedCount: 6,
      groups: [
        group("commerce", "Commerce quotes, payment proof and orders", "high", 4, 1),
        group("database", "Database schema and recovery", "high", 2, 1),
        group("design_platform", "Design jobs and asset workflow", "high", 4, 2),
        group("enterprise_wechat", "Enterprise WeChat production channel", "high", 3, 1),
        group("send_and_messaging", "Send queue and messaging safety", "high", 2, 0),
        group("legacy_personal_wechat", "Legacy personal WeChat compatibility", "high", 2, 1),
        group("delivery_evidence", "Delivery, tests and release evidence", "medium", 3, 0, [
          "desktop/tools/production-release-gate.js",
          "desktop/package.json",
          "desktop/tests/unrelated-ui.test.js",
        ]),
        group("desktop_runtime", "Desktop runtime and packaging", "medium", 1, 0),
        group("web_workbench", "Web workbench UI", "medium", 1, 0),
        group("training_agent_ai", "Training, Agent and AI configuration", "medium", 1, 0),
        group("automation", "Automation and durable scheduling", "medium", 1, 0),
      ],
    },
  };
}

function group(id, label, risk, count, untracked, paths = [`desktop/${id}/first.ts`, `desktop/${id}/second.test.js`]) {
  return {
    id,
    label,
    risk,
    count,
    untracked,
    modified: count - untracked,
    paths,
    allPaths: paths,
  };
}

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-freeze-plan-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("freeze plan maps handoff groups into release candidate branches", () => {
  const plan = buildFreezePlan(handoffFixture(), { handoffPath: "E:/repo/desktop/.runtime/delivery-handoff/latest.json" });

  assert.equal(plan.schemaVersion, SCHEMA_VERSION);
  assert.equal(plan.status, STATUS.BLOCKED);
  assert.equal(plan.localDeliveryVerdict.state, "local_verified_external_blocked");
  assert.equal(plan.localDeliveryVerdict.localEvidenceReady, true);
  assert.equal(plan.localDeliveryVerdict.releaseScopeFrozen, false);
  assert.equal(plan.localDeliveryVerdict.externalBlockerCount, 4);
  assert.equal(plan.localDeliveryVerdict.productionReleaseAllowed, false);
  assert.equal(plan.summary.statusEntryCount, 20);
  assert.equal(plan.summary.untrackedCount, 6);
  assert.equal(plan.summary.branchCount, 6);
  assert.deepEqual(plan.branchPlans.map((branch) => branch.id), [
    "foundation_governance",
    "core_product_flow",
    "database_migrations",
    "enterprise_wechat_channel",
    "legacy_personal_wechat_compat",
    "desktop_package_runtime",
  ]);

  const foundation = plan.branchPlans.find((branch) => branch.id === "foundation_governance");
  assert.deepEqual(foundation.groupIds, ["delivery_evidence"]);
  assert.match(foundation.scopeGuidance.join("\n"), /不能整组直接 staging/);
  assert.match(foundation.verificationCommands.join("\n"), /release-candidate-freeze-plan/);
  assert.equal(foundation.executionScope.decision, "split-shared-files-before-isolation");
  assert.equal(foundation.executionScope.readyToIsolate, false);
  assert.deepEqual(foundation.executionScope.directPaths, ["desktop/tools/production-release-gate.js"]);
  assert.deepEqual(foundation.executionScope.mixedPaths, ["desktop/package.json"]);
  assert.equal(foundation.executionScope.mixedFiles[0].isolationMode, "edited-hunk-required");
  assert.match(foundation.executionScope.mixedFiles[0].include, /delivery/);
  assert.match(foundation.executionScope.mixedFiles[0].defer, /依赖升级/);
  assert.ok(foundation.executionScope.deferredPaths.includes("desktop/tests/unrelated-ui.test.js"));

  const core = plan.branchPlans.find((branch) => branch.id === "core_product_flow");
  assert.deepEqual(core.groupIds, ["web_workbench", "training_agent_ai", "automation", "design_platform", "commerce", "send_and_messaging"]);
  assert.match(core.scopeGuidance.join("\n"), /合成一个产品分支的闭环/);
  assert.match(core.blockers.join("\n"), /不能包含真实外部支付 mutation/);

  const database = plan.branchPlans.find((branch) => branch.id === "database_migrations");
  assert.deepEqual(database.groupIds, ["database"]);
  assert.match(database.decision, /database-review/);
  assert.match(database.verificationCommands.join("\n"), /prisma:generate/);
  assert.deepEqual(database.paths, ["desktop/database/first.ts", "desktop/database/second.test.js"]);

  const enterprise = plan.branchPlans.find((branch) => branch.id === "enterprise_wechat_channel");
  assert.deepEqual(enterprise.groupIds, ["enterprise_wechat", "send_and_messaging"]);
  assert.deepEqual(enterprise.paths, [
    "desktop/enterprise_wechat/first.ts",
    "desktop/enterprise_wechat/second.test.js",
    "desktop/send_and_messaging/first.ts",
    "desktop/send_and_messaging/second.test.js",
  ]);
  assert.match(enterprise.verificationCommands.join("\n"), /wechat-work-production-readiness/);
  assert.match(enterprise.blockers.join("\n"), /ICP 域名/);

  const legacy = plan.branchPlans.find((branch) => branch.id === "legacy_personal_wechat_compat");
  assert.equal(legacy.decision, "compatibility-only-not-production-channel");
  assert.match(legacy.blockers.join("\n"), /不能进入生产客服通道/);

  const desktop = plan.branchPlans.find((branch) => branch.id === "desktop_package_runtime");
  assert.deepEqual(desktop.groupIds, ["desktop_runtime", "delivery_evidence"]);
  assert.match(desktop.blockers.join("\n"), /代码签名证书/);
});

test("freeze plan renders markdown and writes latest artifacts", (t) => {
  const root = temporaryDirectory(t);
  const plan = buildFreezePlan(handoffFixture(), { handoffPath: path.join(root, "latest.json") });
  const artifacts = writeReports(plan, root);

  assert.equal(fs.existsSync(artifacts.latestJson), true);
  assert.equal(fs.existsSync(artifacts.latestMarkdown), true);
  const markdown = renderMarkdown(plan);
  assert.match(markdown, /Local Delivery Verdict/);
  assert.match(markdown, /production release allowed: false/);
  assert.match(markdown, /发布候选冻结计划/);
  assert.match(markdown, /codex\/rc-enterprise-wechat-channel/);
  assert.match(markdown, /codex\/rc-database-migrations/);
  assert.match(markdown, /codex\/rc-desktop-package-runtime/);
  assert.match(markdown, /compatibility-only-not-production-channel/);
  assert.match(markdown, /本批直接纳入/);
  assert.match(markdown, /必须按变更块拆分/);
  assert.match(markdown, /npm\.cmd run release:gate/);
  assert.doesNotMatch(markdown, /git add \./);
});

test("freeze plan CLI and package script stay explicit and read-only", () => {
  assert.deepEqual(parseArgs([]).help, false);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs(["--unknown"]), /unknown argument/);

  const source = fs.readFileSync(path.resolve(__dirname, "..", "tools", "release-candidate-freeze-plan.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
  assert.equal(packageJson.scripts["delivery:freeze-plan"], "node tools/release-candidate-freeze-plan.js");
  assert.doesNotMatch(source, /\bspawnSync\b|\bexecFile\b|\bfetch\s*\(|method:\s*["']POST["']|git add|git commit/);
});
