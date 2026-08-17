"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const {
  createNotificationConfirmationGuard,
  notificationReadState,
  notificationScopeKey,
  runLatestNotificationOperation,
} = require("../apps/web/src/features/notifications/notification-operation-guard");
const { reconcileMarkedNotification } = require("../apps/web/src/features/notifications/use-notifications-controller");
const {
  agentDirectoryReadState,
  agentDirectoryScopeKey,
} = require("../apps/web/src/features/agents/agent-directory-read-state");
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

test("notification read state keeps same-scope cache and blocks cross-scope leakage", () => {
  assert.equal(notificationReadState({ busy: false, currentScopeKey: "scope-a", loadedScopeKey: "", staleScopeKey: "" }), "unknown");
  assert.equal(notificationReadState({ busy: true, currentScopeKey: "scope-a", loadedScopeKey: "", staleScopeKey: "" }), "loading");
  assert.equal(notificationReadState({ busy: false, currentScopeKey: "scope-a", loadedScopeKey: "scope-a", staleScopeKey: "" }), "ready");
  assert.equal(notificationReadState({ busy: false, currentScopeKey: "scope-a", loadedScopeKey: "scope-a", staleScopeKey: "scope-a" }), "stale");
  assert.equal(notificationReadState({ busy: false, currentScopeKey: "scope-b", loadedScopeKey: "scope-a", staleScopeKey: "scope-a" }), "unknown");
  assert.equal(notificationReadState({ busy: true, currentScopeKey: "scope-b", loadedScopeKey: "scope-a", staleScopeKey: "scope-a" }), "loading");
});

test("agent directory keeps same-scope trusted results but never leaks them across identity scope", () => {
  const firstScope = agentDirectoryScopeKey({ wechatAccountId: "account-a", customerId: "customer-a" });
  const secondScope = agentDirectoryScopeKey({ wechatAccountId: "account-b", customerId: "customer-b" });
  assert.notEqual(firstScope, secondScope);
  assert.equal(agentDirectoryReadState({ busy: false, currentScopeKey: firstScope, loadedScopeKey: "", staleScopeKey: "" }), "unknown");
  assert.equal(agentDirectoryReadState({ busy: true, currentScopeKey: firstScope, loadedScopeKey: "", staleScopeKey: "" }), "loading");
  assert.equal(agentDirectoryReadState({ busy: false, currentScopeKey: firstScope, loadedScopeKey: firstScope, staleScopeKey: "" }), "ready");
  assert.equal(agentDirectoryReadState({ busy: false, currentScopeKey: firstScope, loadedScopeKey: firstScope, staleScopeKey: firstScope }), "stale");
  assert.equal(agentDirectoryReadState({ busy: false, currentScopeKey: secondScope, loadedScopeKey: firstScope, staleScopeKey: firstScope }), "unknown");
  assert.equal(agentDirectoryReadState({ busy: true, currentScopeKey: secondScope, loadedScopeKey: firstScope, staleScopeKey: firstScope }), "loading");
});

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

test("notification scope changes invalidate bulk confirmation across an A-B-A transition", () => {
  const allScope = notificationScopeKey(false, { wechatAccountId: "account-a", customerId: "customer-a" });
  const unreadScope = notificationScopeKey(true, { wechatAccountId: "account-a", customerId: "customer-a" });
  const otherIdentityScope = notificationScopeKey(false, { wechatAccountId: "account-b", customerId: "customer-b" });
  assert.notEqual(allScope, unreadScope);
  assert.notEqual(allScope, otherIdentityScope);

  const guard = createNotificationConfirmationGuard(allScope);
  const original = guard.begin(allScope);
  assert.equal(guard.isCurrent(original, allScope), true);
  guard.setScope(unreadScope);
  assert.equal(guard.isCurrent(original, unreadScope), false);
  guard.setScope(allScope);
  assert.equal(guard.isCurrent(original, allScope), false, "A-B-A must not revive the original confirmation");
  assert.equal(guard.consume(original, allScope), false);

  const fresh = guard.begin(allScope);
  assert.equal(guard.consume(fresh, allScope), true);
  assert.equal(guard.consume(fresh, allScope), false, "confirmation token must be one-shot");

  const unread = [{ id: "notification-1", readAt: null }, { id: "notification-2", readAt: null }];
  const updated = { id: "notification-1", readAt: "2026-07-21T00:00:00.000Z" };
  assert.deepEqual(reconcileMarkedNotification(unread, updated, true), [unread[1]]);
  assert.deepEqual(reconcileMarkedNotification(unread, updated, false), [updated, unread[1]]);

  const controller = read("apps/web/src/features/notifications/use-notifications-controller.ts");
  assert.match(controller, /loadedScopeKey === scopeKey/);
  assert.match(controller, /scopeLoaded \? notifications : \[\]/);
  assert.match(controller, /notificationReadState\(\{ busy, currentScopeKey: scopeKey, loadedScopeKey, staleScopeKey \}\)/);
  assert.match(controller, /expectedScopeKey !== scopeKey/);
  assert.match(controller, /reconcileMarkedNotification\(current, updated, unreadOnly\)/);
  const page = read("apps/web/src/features/notifications/notifications-page.tsx");
  assert.match(page, /confirmationGuard\.setScope\(controller\.scopeKey\)/);
  assert.match(page, /confirmationGuard\.consume\(confirmationToken, controller\.scopeKey\)/);
  assert.match(page, /controller\.markAllRead\(confirmationToken\.scopeKey\)/);
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
    if (relativePath.includes("catalog/use-catalog-records")) {
      assert.match(source, /setLoaded\(hasTrustedRecords\)/);
      assert.match(source, /setLoaded\(hasTrustedAudit\)/);
      assert.match(source, /setStale\(hasTrustedRecords\)/);
      assert.match(source, /setStale\(hasTrustedAudit\)/);
    } else {
      assert.match(source, /setLoaded\(false\)/);
    }
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
    ["apps/web/src/features/catalog/catalog-product-editor-page.tsx", /读取成功；请返回商品列表/, /已阻止(?:新增或)?编辑保存/],
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
