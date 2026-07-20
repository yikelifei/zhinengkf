"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { OrdersService } = require("../apps/api/src/orders/orders.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
const { createWechatWindowObserverAttestation } = require("../packages/rules/wechatWindowEvidence");

const observerProofToken = "7".repeat(64);

test("LocalStore claim is durable before adapter execution and arbitrary adapter failure stays unknown across restart", async (t) => {
  const fixture = setupFixture(t);
  const task = createReadyTask(fixture.localStore, "adapter throws after durable claim");
  let durableClaimObserved = false;
  fixture.sendAdapter.execute = (_task, context) => {
    const stored = readStore(fixture.localStore);
    const persistedTask = stored.sendTasks.find((item) => item.id === task.id);
    const persistedAttempt = stored.sendAttempts.find((item) => item.sendTaskId === task.id);
    assert.equal(persistedTask.status, "sending");
    assert.equal(persistedAttempt.status, "started");
    assert.equal(context.attemptId, persistedAttempt.id);
    durableClaimObserved = true;
    throw new Error("injected adapter exception with uncertain side effects");
  };

  const result = fixture.service.executeSend(task.id, { adapter: "windows_bridge" });
  assert.equal(durableClaimObserved, true);
  assert.equal(result.task.status, "sending");
  assert.equal(result.task.guardSnapshot.deliveryState, "unknown");
  assert.equal(result.task.guardSnapshot.automaticRetryBlocked, true);
  assert.equal(result.task.guardSnapshot.manualReviewRequired, true);
  assert.equal(result.attempt.status, "started");
  assert.equal(result.attempt.metadata.deliveryState, "unknown");
  assert.equal(result.attempt.metadata.automaticRetryBlocked, true);
  assert.equal(result.attempt.metadata.failureStage, "adapter_execution");

  const restarted = buildService(fixture.localStore.filePath, new WechatSendAdapterService());
  const scan = await restarted.service.scanSendOperations();
  assert.equal(scan.bridgeOutboxBroken, 1);
  const afterRestart = restarted.localStore.getSendTask(task.id);
  const attemptsAfterRestart = restarted.localStore.listSendAttempts({ sendTaskId: task.id });
  assert.equal(afterRestart.status, "sending");
  assert.equal(afterRestart.guardSnapshot.deliveryState, "unknown");
  assert.equal(afterRestart.guardSnapshot.automaticRetryBlocked, true);
  assert.equal(attemptsAfterRestart.length, 1);
  assert.equal(attemptsAfterRestart[0].status, "started");
  assert.equal(attemptsAfterRestart[0].metadata.deliveryState, "unknown");

  const resolved = await restarted.service.resolveUnknownSendDelivery(task.id, {
    operationKey: "resolve-local-adapter-unknown-1",
    resolution: "confirmed_not_sent",
    reason: "operator verified that no WeChat message was emitted",
    ...expectedIdentity(),
  }, "test-operator");
  assert.equal(resolved.status, "failed");
  assert.equal(resolved.guardSnapshot.deliveryState, "confirmed_not_sent");
  const requeued = await restarted.service.requeueSendTask(task.id, {
    reason: "explicit retry after confirmed_not_sent",
    ...expectedIdentity(),
  });
  assert.equal(requeued.status, "queued");
  assert.equal(requeued.guardSnapshot.deliveryState, "not_started");
  assert.equal(restarted.localStore.listSendAttempts({ sendTaskId: task.id }).length, 1);
});

test("real outbox parent-file write failure settles task and attempt as failed and permits explicit requeue", async (t) => {
  const fixture = setupFixture(t);
  const task = createReadyTask(fixture.localStore, "outbox parent is a regular file");
  const parentFile = path.join(fixture.root, "outbox-parent-file");
  fs.writeFileSync(parentFile, "not a directory\n", "utf8");
  appConfig.wechatBridgeOutboxDir = path.join(parentFile, "outbox");

  const result = fixture.service.executeSend(task.id, { adapter: "windows_bridge" });
  assert.equal(result.task.status, "failed");
  assert.equal(result.task.guardSnapshot.deliveryState, "failed");
  assert.equal(result.task.guardSnapshot.automaticRetryBlocked, false);
  assert.equal(result.attempt.status, "failed");
  assert.equal(result.attempt.metadata.deliveryState, "failed");
  assert.equal(result.attempt.metadata.retrySafe, true);
  assert.equal(result.attempt.metadata.failureStage, "outbox_mkdir");
  assert.equal(result.attempt.completedAt !== null, true);

  const stored = readStore(fixture.localStore);
  assert.equal(stored.sendTasks.find((item) => item.id === task.id).status, "failed");
  assert.equal(stored.sendAttempts.find((item) => item.sendTaskId === task.id).status, "failed");
  assert.equal(fs.existsSync(appConfig.wechatBridgeOutboxDir), false);

  const requeued = await fixture.service.requeueSendTask(task.id, {
    reason: "explicit retry after durable outbox write was proven not published",
    ...expectedIdentity(),
  });
  assert.equal(requeued.status, "queued");
  assert.equal(requeued.guardSnapshot.automaticRetryBlocked, false);
});

function setupFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-local-send-claim-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  appConfig.useLocalStore = true;
  appConfig.wechatBridgeOutboxDir = path.join(root, "outbox");
  appConfig.wechatBridgeInboxDir = path.join(root, "inbox");
  appConfig.wechatBridgeDispatchDir = path.join(root, "dispatch");
  appConfig.wechatBridgeLockDir = path.join(root, "locks");
  appConfig.wechatBridgeWorkerStatusFile = path.join(root, "worker-status.json");
  appConfig.wechatWindowObserverProofFile = path.join(root, "observer-proof.key");
  appConfig.sendBridgeAckTimeoutMinutes = 5;
  fs.writeFileSync(appConfig.wechatWindowObserverProofFile, `${observerProofToken}\n`, "utf8");

  const storePath = path.join(root, "local-store.json");
  const sendAdapter = new WechatSendAdapterService();
  return { root, sendAdapter, ...buildService(storePath, sendAdapter) };
}

function buildService(storePath, sendAdapter) {
  const localStore = new LocalStoreService();
  localStore.filePath = storePath;
  const notifications = new NotificationsService({}, localStore);
  const orders = new OrdersService({}, localStore, notifications);
  const service = new WechatDispatchService({}, localStore, sendAdapter, notifications, orders);
  return { localStore, service };
}

function createReadyTask(localStore, text) {
  const task = localStore.createSendTask({
    operationKey: `local-claim-${Buffer.from(text, "utf8").toString("hex").slice(0, 48)}`,
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    payload: { kind: "text", text },
    guardSnapshot: { requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"] },
  });
  const capturedAt = new Date().toISOString();
  const snapshot = {
    source: "windows_foreground_observer",
    isOnline: true,
    wechatAccountId: "wechat_demo_1",
    accountDisplayName: "客服微信1号",
    chatTitle: "王总-端午礼盒",
    activeChatTitle: "王总-端午礼盒",
    recentCustomerId: "customer_demo_1",
    recentMessageText: text,
    confidence: 1,
    capturedAt,
  };
  const observerEvidence = createWechatWindowObserverAttestation(
    snapshot,
    { version: "wechat_window_observer_v1", issuedAt: capturedAt, nonceHash: "e".repeat(64) },
    observerProofToken,
  );
  localStore.createWechatWindowSnapshot({
    ...snapshot,
    diagnostic: { observerEvidence },
  });
  return task;
}

function expectedIdentity() {
  return {
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
  };
}

function readStore(localStore) {
  return JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
}
