"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const {
  notificationScopeKey,
  runLatestNotificationOperation,
} = require("../apps/web/src/features/notifications/notification-operation-guard");
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("stale notification mutation cannot overwrite a newer filter result or clear its busy state", async () => {
  let sequence = 0;
  const oldMutation = deferred();
  const newMutation = deferred();
  const state = { records: [], notice: "", error: "", busy: false };

  const run = (operation, label) => runLatestNotificationOperation({
    begin: () => ++sequence,
    isCurrent: (requestSequence) => requestSequence === sequence,
    operation: () => operation.promise,
    onStart: () => { state.busy = true; state.error = ""; state.notice = ""; },
    onSuccess: (records) => { state.records = records; state.notice = label; },
    onError: (error) => { state.records = []; state.error = error.message; },
    onFinally: () => { state.busy = false; },
  });

  const stale = run(oldMutation, "old filter");
  const current = run(newMutation, "new filter");
  oldMutation.resolve([{ id: "old" }]);
  await stale;
  assert.deepEqual(state, { records: [], notice: "", error: "", busy: true });

  newMutation.resolve([{ id: "new" }]);
  assert.equal(await current, true);
  assert.deepEqual(state, { records: [{ id: "new" }], notice: "new filter", error: "", busy: false });
});

test("stale notification rejection cannot erase a newer successful response", async () => {
  let sequence = 0;
  const staleMutation = deferred();
  const state = { records: [], loaded: false, error: "" };
  const stale = runLatestNotificationOperation({
    begin: () => ++sequence,
    isCurrent: (requestSequence) => requestSequence === sequence,
    operation: () => staleMutation.promise,
    onStart: () => {},
    onSuccess: (records) => { state.records = records; state.loaded = true; },
    onError: (error) => { state.records = []; state.loaded = false; state.error = error.message; },
    onFinally: () => {},
  });

  sequence += 1;
  state.records = [{ id: "new" }];
  state.loaded = true;
  staleMutation.reject(new Error("old filter failed"));
  assert.equal(await stale, false);
  assert.deepEqual(state, { records: [{ id: "new" }], loaded: true, error: "" });
});

test("notification scope changes hide old rows and invalidate an open bulk confirmation", () => {
  const allScope = notificationScopeKey(false, { wechatAccountId: "account-a", customerId: "customer-a" });
  const unreadScope = notificationScopeKey(true, { wechatAccountId: "account-a", customerId: "customer-a" });
  const otherIdentityScope = notificationScopeKey(false, { wechatAccountId: "account-b", customerId: "customer-b" });
  assert.notEqual(allScope, unreadScope);
  assert.notEqual(allScope, otherIdentityScope);

  const controller = read("apps/web/src/features/notifications/use-notifications-controller.ts");
  assert.match(controller, /loadedScopeKey === scopeKey/);
  assert.match(controller, /scopeLoaded \? notifications : \[\]/);
  assert.match(controller, /expectedScopeKey !== scopeKey/);
  const page = read("apps/web/src/features/notifications/notifications-page.tsx");
  assert.match(page, /confirmationScopeKey === controller\.scopeKey/);
  assert.match(page, /controller\.markAllRead\(confirmationScopeKey\)/);
  assert.match(page, /controller\.loaded && controller\.notifications\.length/);
});

test("design catalog and sales shared reads fence stale responses and unmount cleanup", () => {
  const hooks = [
    "apps/web/src/features/design/use-design-job.ts",
    "apps/web/src/features/catalog/use-catalog-records.ts",
    "apps/web/src/features/sales/use-sales-records.ts",
  ];

  for (const relativePath of hooks) {
    const source = read(relativePath);
    assert.match(source, /requestSequence = useRef\(0\)/);
    assert.match(source, /const sequence = \+\+requestSequence\.current/);
    assert.match(source, /sequence !== requestSequence\.current/);
    assert.match(source, /return \(\) => \{ requestSequence\.current \+= 1; \}/);
    assert.match(source, /setLoaded\(true\)/);
    assert.match(source, /setLoaded\(false\)/);
  }
});

test("failed shared reads render unknown truth instead of empty or missing claims", () => {
  const consumers = [
    ["apps/web/src/features/design/design-jobs-page.tsx", /读取成功，当前没有设计任务/, /设计任务状态未确认/],
    ["apps/web/src/features/design/design-job-detail-page.tsx", /读取成功；请返回任务列表/, /不能据此认定任务不存在/],
    ["apps/web/src/features/design/design-job-submit-page.tsx", /读取成功；请返回任务列表/, /已阻止预检与提交/],
    ["apps/web/src/features/design/design-job-status-page.tsx", /读取成功；请返回任务列表/, /已阻止远端状态同步/],
    ["apps/web/src/features/catalog/catalog-products-page.tsx", /读取成功，当前没有商品/, /商品列表状态未确认/],
    ["apps/web/src/features/catalog/catalog-product-detail-page.tsx", /读取成功；请返回商品列表/, /不能据此认定商品不存在/],
    ["apps/web/src/features/catalog/catalog-product-editor-page.tsx", /读取成功；请返回商品列表/, /已阻止编辑保存/],
    ["apps/web/src/features/catalog/catalog-repair-page.tsx", /读取成功，当前没有修复任务/, /修复队列状态未确认/],
    ["apps/web/src/features/catalog/catalog-repair-detail-page.tsx", /读取成功；它可能已完成/, /已阻止修复提交/],
    ["apps/web/src/features/catalog/catalog-audit-page.tsx", /读取成功，但没有审计结果/, /商品审计状态未确认/],
  ];

  for (const [relativePath, fulfilledEmpty, unknown] of consumers) {
    const source = read(relativePath);
    assert.match(source, /\bloaded\b/, `${relativePath} must consume fulfilled-read truth`);
    assert.match(source, fulfilledEmpty);
    assert.match(source, unknown);
  }

  const notifications = read("apps/web/src/features/notifications/notifications-page.tsx");
  assert.match(notifications, /checked=\{controller\.unreadOnly\} disabled=\{controller\.busy\}/);
  const controller = read("apps/web/src/features/notifications/use-notifications-controller.ts");
  assert.match(controller, /runLatestNotificationOperation\(\{/);
  assert.match(controller, /begin: \(\) => \+\+refreshSequence\.current/);
});
