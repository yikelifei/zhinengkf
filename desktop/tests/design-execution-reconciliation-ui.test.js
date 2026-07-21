"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

require("reflect-metadata");
require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
});

const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
const { DesignPlatformExecutionService } = require("../apps/api/src/design-jobs/design-platform-execution.service");
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const {
  DESIGN_EXECUTION_RESOLUTIONS,
  DesignExecutionReconciliationPanel,
  getDesignExecutionResolutionBlockedReason,
} = require("../apps/web/src/components/design-execution-reconciliation-panel");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function localFixture(t) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-reconciliation-"));
  const previousFile = process.env.LOCAL_STORE_FILE;
  const previousMode = appConfig.useLocalStore;
  process.env.LOCAL_STORE_FILE = path.join(temporaryRoot, "local-store.json");
  appConfig.useLocalStore = true;
  const localStore = new LocalStoreService();
  const job = localStore.createDesignJob({
    requestId: `reconciliation-${Date.now()}`,
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 200, quantity: 20 },
    bundle: {},
    outputCount: 1,
    status: "draft",
  });
  t.after(() => {
    appConfig.useLocalStore = previousMode;
    if (previousFile === undefined) delete process.env.LOCAL_STORE_FILE;
    else process.env.LOCAL_STORE_FILE = previousFile;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });
  return { localStore, job, storePath: process.env.LOCAL_STORE_FILE };
}

test("execution read model is an exact allowlist and server computes only two narrow resolutions", async (t) => {
  const { localStore, job, storePath } = localFixture(t);
  const service = new DesignPlatformExecutionService({}, localStore);
  for (let attemptNo = 1; attemptNo <= 9; attemptNo += 1) {
    const begun = await service.begin({ designJobId: job.id, attemptNo });
    const interim = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const created = interim.designPlatformExecutions.find((row) => row.id === begun.execution.id);
    Object.assign(created, { status: "explicit_failed", refundStatus: "refunded", acceptanceStatus: "manual_review" });
    fs.writeFileSync(storePath, `${JSON.stringify(interim, null, 2)}\n`, "utf8");
  }
  const data = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const rows = data.designPlatformExecutions.filter((row) => row.designJobId === job.id);
  Object.assign(rows[0], { status: "outcome_unknown", resolvedAt: null });
  Object.assign(rows[1], { status: "outcome_unknown", resolvedAt: new Date().toISOString() });
  Object.assign(rows[2], { status: "explicit_failed", refundStatus: "failed" });
  Object.assign(rows[3], { status: "explicit_failed", refundStatus: "refunded" });
  Object.assign(rows[4], { status: "completed", acceptanceStatus: "manual_review", refundStatus: "unknown" });
  Object.assign(rows[5], { status: "completed", acceptanceStatus: "accepted", refundStatus: "unknown" });
  Object.assign(rows[6], { status: "completed", acceptanceStatus: "manual_review", refundStatus: "failed" });
  Object.assign(rows[7], { status: "completed", acceptanceStatus: "pending", refundStatus: "failed" });
  Object.assign(rows[8], { status: "completed", acceptanceStatus: "manual_review", refundStatus: "refunded" });
  for (const row of rows) {
    Object.assign(row, {
      operationKey: "secret-operation-key",
      requestId: "secret-request-id",
      externalJobId: "secret-external-id",
      images: [{ downloadUrl: "https://secret.invalid/image?token=secret" }],
      refundSummary: { reviewer: "private-reviewer", token: "secret" },
      errorMessage: "https://secret.invalid Authorization=secret",
    });
  }
  Object.assign(rows[5], {
    errorCategory: "token=secret-category",
    createdAt: "https://secret.invalid/date",
    responseHttpStatus: 999,
  });
  fs.writeFileSync(storePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  const views = await service.listPublicForDesignJob(job.id);
  const byAttempt = new Map(views.map((view) => [view.attemptNo, view]));
  assert.equal(byAttempt.get(1).availableResolution, DESIGN_EXECUTION_RESOLUTIONS.unknown);
  assert.equal(byAttempt.get(2).availableResolution, null);
  assert.equal(byAttempt.get(3).availableResolution, DESIGN_EXECUTION_RESOLUTIONS.refund);
  assert.equal(byAttempt.get(4).availableResolution, null);
  assert.equal(byAttempt.get(5).availableResolution, DESIGN_EXECUTION_RESOLUTIONS.refund);
  assert.equal(byAttempt.get(6).availableResolution, null);
  assert.equal(byAttempt.get(7).availableResolution, DESIGN_EXECUTION_RESOLUTIONS.refund);
  assert.equal(byAttempt.get(8).availableResolution, null);
  assert.equal(byAttempt.get(9).availableResolution, null);
  assert.equal(byAttempt.get(6).errorCategory, "other_error");
  assert.equal(byAttempt.get(6).createdAt, null);
  assert.equal(byAttempt.get(6).responseHttpStatus, null);

  const allowed = [
    "acceptanceStatus", "attemptNo", "availableResolution", "completedAt", "createdAt",
    "errorCategory", "id", "imageCount", "refundStatus", "resolvedAt",
    "responseHttpStatus", "status", "updatedAt",
  ];
  for (const view of views) assert.deepEqual(Object.keys(view).sort(), allowed);
  const serialized = JSON.stringify(views);
  for (const forbidden of [
    "operationKey", "requestId", "externalJobId", "images", "refundSummary", "errorMessage",
    "secret-operation-key", "private-reviewer", "secret.invalid",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden));
});

test("job execution GET requires complete expected identity and rejects a mismatch", async (t) => {
  const { localStore, job } = localFixture(t);
  const context = {
    localStore,
    platformExecutions: { listPublicForDesignJob: async () => [{ id: "safe-view" }] },
  };
  await assert.rejects(
    DesignJobsService.prototype.listExecutions.call(context, job.id, {}),
    /complete expected design job identity is required/,
  );
  await assert.rejects(
    DesignJobsService.prototype.listExecutions.call(context, job.id, {
      expectedWechatAccountId: "wrong-account",
      expectedConversationId: job.conversationId,
      expectedCustomerId: job.customerId,
    }),
    /identity mismatch/,
  );
  const result = await DesignJobsService.prototype.listExecutions.call(context, job.id, {
    expectedWechatAccountId: job.wechatAccountId,
    expectedConversationId: job.conversationId,
    expectedCustomerId: job.customerId,
  });
  assert.deepEqual(result, [{ id: "safe-view" }]);
});

test("controller, API client and write responses preserve the authorization and privacy boundary", () => {
  const controller = read("apps/api/src/design-jobs/design-jobs.controller.ts");
  const jobsService = read("apps/api/src/design-jobs/design-jobs.service.ts");
  const executionService = read("apps/api/src/design-jobs/design-platform-execution.service.ts");
  const localStoreService = read("apps/api/src/local-store/local-store.service.ts");
  const client = read("apps/web/src/lib/api.ts");

  assert.match(controller, /@RequireOperatorCapability\("view_console"\)[\s\S]*@Get\(":id\/executions"\)[\s\S]*listExecutions/);
  for (const key of ["expectedWechatAccountId", "expectedConversationId", "expectedCustomerId"]) {
    assert.match(controller, new RegExp(`@Query\\("${key}"\\)`));
    assert.match(client, new RegExp(`params\\.set\\("${key}"`));
  }
  assert.match(jobsService, /resolveUnknownPublic\(/);
  assert.match(jobsService, /resolveUnsafeRefundPublic\(/);
  assert.match(executionService, /resolveUnknownPublic[\s\S]*toPublicExecutionView/);
  assert.match(executionService, /resolveUnsafeRefundPublic[\s\S]*toPublicExecutionView/);
  assert.match(executionService, /if \(!isUnsafeRefundResolutionEligible\(execution\)\)/);
  assert.match(executionService, /isUnsafeRefundResolutionEligible\(execution\)[\s\S]*\? "confirmed_refunded"/);
  assert.match(executionService, /only an eligible unsafe refund can be resolved/);
  assert.match(localStoreService, /only an eligible unsafe refund can be resolved/);
  assert.doesNotMatch(`${executionService}\n${localStoreService}`, /only an unsafe explicit failure refund/);

  const clientSection = client.slice(client.indexOf("export async function getDesignJobExecutions"), client.indexOf("export async function retryDesignJob"));
  assert.match(clientSection, /confirmed_not_generated_refunded/);
  assert.match(clientSection, /confirmed_refunded/);
  assert.doesNotMatch(clientSection, /response\.text\(\)/);
  assert.doesNotMatch(clientSection, /reviewer\s*:/);
});

test("panel fails closed on status alone and exposes a guarded second confirmation flow", () => {
  const baseExecution = {
    id: "execution-12345678",
    attemptNo: 1,
    status: "outcome_unknown",
    acceptanceStatus: "manual_review",
    refundStatus: "unknown",
    imageCount: 0,
    errorCategory: "timeout_unknown",
    responseHttpStatus: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    completedAt: null,
    resolvedAt: null,
    availableResolution: null,
  };
  const props = {
    executions: [baseExecution],
    loading: false,
    canManageExecutions: true,
    onRefresh: async () => {},
    onResolveUnknown: async () => {},
    onResolveRefund: async () => {},
  };
  const closed = renderToStaticMarkup(React.createElement(DesignExecutionReconciliationPanel, props));
  assert.match(closed, /服务端未开放核销动作/);
  assert.doesNotMatch(closed, /确认未生成且已退款/);

  const actionable = renderToStaticMarkup(React.createElement(DesignExecutionReconciliationPanel, {
    ...props,
    executions: [{ ...baseExecution, availableResolution: DESIGN_EXECUTION_RESOLUTIONS.unknown }],
  }));
  assert.match(actionable, /确认未生成且已退款/);
  assert.doesNotMatch(actionable, /secret|secret\.invalid/i);

  const resumableRefund = renderToStaticMarkup(React.createElement(DesignExecutionReconciliationPanel, {
    ...props,
    executions: [{
      ...baseExecution,
      status: "completed",
      acceptanceStatus: "manual_review",
      refundStatus: "failed",
      availableResolution: DESIGN_EXECUTION_RESOLUTIONS.refund,
    }],
  }));
  assert.match(resumableRefund, /确认退款已到账/);

  const source = read("apps/web/src/components/design-execution-reconciliation-panel.tsx");
  assert.match(source, /if \(!pending \|\| submitLock\.current \|\| submittingId \|\| pendingBlockedReason\) return/);
  assert.match(source, /function getDesignExecutionResolutionBlockedReason/);
  assert.match(source, /if \(loading\)[\s\S]*if \(!accessLoaded\)[\s\S]*if \(!canManageExecutions\)/);
  assert.match(source, /currentExecution\.availableResolution !== pending\.resolution/);
  assert.match(source, /disabled=\{Boolean\(submittingId\) \|\| Boolean\(pendingBlockedReason\)\}/);
  assert.match(source, /submitLock\.current = true/);
  assert.match(source, /submitLock\.current = false/);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, /确认已核对并提交/);
  assert.match(source, /await onRefresh\(\)/);
  assert.match(source, /onRefresh\(\)\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(source, /useEffect|setInterval|setTimeout|\bfetch\s*\(/);

  const pending = { executionId: baseExecution.id, resolution: DESIGN_EXECUTION_RESOLUTIONS.unknown };
  const currentIntent = [{ ...baseExecution, availableResolution: DESIGN_EXECUTION_RESOLUTIONS.unknown }];
  assert.equal(getDesignExecutionResolutionBlockedReason({
    pending,
    executions: currentIntent,
    loading: false,
    accessLoaded: true,
    canManageExecutions: true,
  }), "");
  assert.notEqual(getDesignExecutionResolutionBlockedReason({
    pending,
    executions: [{ ...baseExecution, availableResolution: DESIGN_EXECUTION_RESOLUTIONS.refund }],
    loading: false,
    accessLoaded: true,
    canManageExecutions: true,
  }), "");
});

test("reconciliation layout remains usable at 390px and uses workbench tokens", () => {
  const css = read("apps/web/src/components/design-execution-reconciliation-panel.module.css");
  for (const token of ["--wk-color-border", "--wk-color-text", "--wk-color-text-secondary", "--wk-color-surface", "--wk-color-brand"]) {
    assert.match(css, new RegExp(token));
  }
  assert.match(css, /@media \(max-width: 410px\)/);
  assert.match(css, /grid-template-columns: 1fr/);
  assert.match(css, /width: 100%/);
});
