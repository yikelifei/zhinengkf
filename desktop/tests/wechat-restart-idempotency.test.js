"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");

let operationCalls = 0;
let operationResult = verifiedOperationResult();
const personalBridge = require("../tools/personal-wechat-bridge");
const bridgeWorker = require("../tools/wechat-bridge-worker");

require("reflect-metadata");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { OrdersService } = require("../apps/api/src/orders/orders.service");
const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const { createWechatWindowObserverAttestation } = require("../packages/rules/wechatWindowEvidence");

const observerProofToken = "9".repeat(64);

test("duplicate inbound msgid is idempotent and conflicting content fails closed", async () => {
  const { localStore, service } = setupService();
  const payload = {
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    externalId: "msgid-retry-1",
    text: "你好，请问起订量是多少？",
  };
  await service.processInboundMessage(payload);
  const first = readStore(localStore);
  const replay = await service.processInboundMessage(payload);
  const second = readStore(localStore);

  assert.equal(replay.duplicate, true);
  assert.equal(second.messages.length, first.messages.length);
  assert.equal(second.routeEvaluations.length, first.routeEvaluations.length);
  assert.equal(second.sendTasks.length, first.sendTasks.length);
  await assert.rejects(
    () => service.processInboundMessage({ ...payload, text: "同一 msgid 被替换成另一段内容" }),
    /duplicate inbound externalId conflict/,
  );
});

test("the same provider msgid remains isolated across concurrent accounts", async () => {
  const { localStore, service } = setupService();
  await Promise.all([
    service.processInboundMessage({
      wechatAccountId: "wechat_demo_1", conversationId: "conversation_demo_1", customerId: "customer_demo_1",
      externalId: "shared-provider-id", text: "账号一消息",
    }),
    service.processInboundMessage({
      wechatAccountId: "wechat_demo_2", conversationId: "conversation_demo_2", customerId: "customer_demo_2",
      externalId: "shared-provider-id", text: "账号二消息",
    }),
  ]);
  const saved = readStore(localStore).messages.filter((message) => message.externalId === "shared-provider-id");
  assert.equal(saved.length, 2);
  assert.deepEqual(new Set(saved.map((message) => message.wechatAccountId)), new Set(["wechat_demo_1", "wechat_demo_2"]));
});

test("restart never executes one dispatch twice and sent ack carries customer identity", async () => {
  operationCalls = 0;
  operationResult = verifiedOperationResult();
  const fixture = createPersonalFixture();
  const first = await personalBridge.runOnce(fixture.config);
  const second = await personalBridge.runOnce(fixture.config);
  const ack = JSON.parse(fs.readFileSync(listFiles(fixture.inboxDir, ".ack.json")[0], "utf8"));

  assert.equal(first.processed.length, 1);
  assert.equal(second.scanned, 0);
  assert.equal(operationCalls, 1);
  assert.equal(ack.customerId, "customer_1");
  assert.equal(listFiles(path.join(fixture.dispatchDir, "processed"), ".dispatch.json").length, 1);
});

test("restart recognizes legacy timestamp-prefixed terminal dispatch files", () => {
  const fixture = createWorkerFixture([
    identity("task_legacy", "attempt_legacy", "account_legacy", "conversation_legacy", "customer_legacy"),
  ]);
  const entry = fixture.response.pending[0];
  const outbox = bridgeWorker.loadAndValidateOutboxPayload({ ...entry, outboxDir: fixture.outboxDir });
  const fileName = "account_legacy-task_legacy-attempt_legacy.dispatch.json";
  const terminalDir = path.join(fixture.dispatchDir, "processed");
  fs.mkdirSync(terminalDir, { recursive: true });
  const legacyPath = path.join(terminalDir, `1700000000000-${fileName}`);
  fs.writeFileSync(legacyPath, "{}\n", "utf8");

  const result = bridgeWorker.writeDispatchFile(fixture.dispatchDir, entry, outbox, {
    inboxDir: fixture.inboxDir,
    apiBase: "http://127.0.0.1:3200/api",
  });
  assert.equal(result, legacyPath);
  assert.equal(listFiles(fixture.dispatchDir, ".dispatch.json").length, 0);
});

test("ack scan failure keeps durable ack and terminal dispatch without resending", async () => {
  operationCalls = 0;
  operationResult = verifiedOperationResult();
  const fixture = createPersonalFixture({ scanAckExecutor: undefined, apiBase: "http://127.0.0.1:1/api" });
  const first = await personalBridge.runOnce(fixture.config);
  const second = await personalBridge.runOnce(fixture.config);

  assert.equal(first.processed.length, 1);
  assert.equal(first.processed[0].scanResult.ok, false);
  assert.equal(listFiles(fixture.inboxDir, ".ack.json").length, 1);
  assert.equal(listFiles(path.join(fixture.dispatchDir, "processed"), ".dispatch.json").length, 1);
  assert.equal(second.scanned, 0);
  assert.equal(operationCalls, 1);
});

test("interrupted UI send becomes delivery-unknown and emits no failed ack", async () => {
  operationCalls = 0;
  operationResult = { ok: false, code: "injected_interruption", errorMessage: "injected interruption after UI activation" };
  const fixture = createPersonalFixture();
  const result = await personalBridge.runOnce(fixture.config);

  assert.equal(result.processed[0].status, "delivery_unknown");
  assert.equal(listFiles(fixture.inboxDir, ".ack.json").length, 0);
  assert.equal(listFiles(path.join(fixture.dispatchDir, "uncertain"), ".dispatch.json").length, 1);
});

test("incomplete RPA verification proof is quarantined without a failed ack", async () => {
  operationCalls = 0;
  operationResult = { ok: true, actionCount: 1, accountVerified: true, chatVerified: true };
  const fixture = createPersonalFixture();
  const result = await personalBridge.runOnce(fixture.config);

  assert.equal(operationCalls, 1);
  assert.equal(result.processed[0].status, "delivery_unknown");
  assert.match(result.processed[0].reason, /incomplete verification proof/i);
  assert.equal(listFiles(fixture.inboxDir, ".ack.json").length, 0);
  assert.equal(listFiles(path.join(fixture.dispatchDir, "uncertain"), ".dispatch.json").length, 1);
});

test("dispatch removed from API pending is quarantined before touching the UI", async () => {
  operationCalls = 0;
  operationResult = verifiedOperationResult();
  const fixture = createPersonalFixture({
    verifyPendingDispatch: () => ({ ok: false, reason: "delivery_unknown_retry_blocked" }),
  });
  const result = await personalBridge.runOnce(fixture.config);

  assert.equal(operationCalls, 0);
  assert.equal(result.processed[0].status, "delivery_unknown");
  assert.equal(listFiles(fixture.inboxDir, ".ack.json").length, 0);
  assert.equal(listFiles(path.join(fixture.dispatchDir, "uncertain"), ".dispatch.json").length, 1);
});

test("personal bridge rechecks exact pending identity through the existing outbox API", async () => {
  operationCalls = 0;
  operationResult = verifiedOperationResult();
  let requestUrl = "";
  const server = http.createServer((request, response) => {
    requestUrl = String(request.url || "");
    sendJson(response, {
      pending: [{
        taskId: "task_1", attemptId: "attempt_1", wechatAccountId: "account_1",
        conversationId: "conversation_1", customerId: "customer_1", fileName: "source-outbox.json",
      }],
    });
  });
  const apiBase = await listen(server);
  const fixture = createPersonalFixture({ apiBase, verifyPendingDispatch: undefined });
  try {
    const result = await personalBridge.runOnce(fixture.config);
    const requested = new URL(requestUrl, apiBase);
    assert.equal(result.processed[0].status, "sent_ack_written");
    assert.equal(operationCalls, 1);
    assert.equal(requested.pathname, "/api/wechat/bridge/outbox");
    assert.equal(requested.searchParams.get("wechatAccountId"), "account_1");
    assert.equal(requested.searchParams.get("conversationId"), "conversation_1");
    assert.equal(requested.searchParams.get("customerId"), "customer_1");
  } finally {
    await close(server);
  }
});

test("half-written worker status preserves the last complete generation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-status-half-"));
  const file = path.join(dir, "worker-status.json");
  const previous = { ok: true, generation: 1 };
  fs.writeFileSync(file, JSON.stringify(previous), "utf8");
  injectHalfWrite(file, () => {
    assert.throws(() => bridgeWorker.writeWorkerStatus(file, { ok: false, generation: 2 }), /injected half write/);
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), previous);
});

test("half-written local store preserves the previous valid database", () => {
  const { localStore } = setupService();
  localStore.listConversations();
  const before = fs.readFileSync(localStore.filePath, "utf8");
  injectHalfWrite(localStore.filePath, () => {
    assert.throws(
      () => localStore.createMessage({ conversationId: "conversation_demo_1", text: "half write" }),
      /injected half write/,
    );
  });
  assert.equal(fs.readFileSync(localStore.filePath, "utf8"), before);
});

test("live account lock cannot be stolen merely because stale interval elapsed", async () => {
  const fixture = createWorkerFixture([
    identity("task_lock", "attempt_lock", "account_lock", "conversation_lock", "customer_lock"),
  ]);
  let postCount = 0;
  let firstPostResolve;
  const firstPost = new Promise((resolve) => { firstPostResolve = resolve; });
  const pendingResponses = [];
  const server = http.createServer((request, response) => {
    if (request.method === "GET") return sendJson(response, fixture.response);
    postCount += 1;
    pendingResponses.push(response);
    firstPostResolve();
  });
  const apiBase = await listen(server);
  const config = workerConfig(fixture, apiBase, { lockStaleMs: 40 });

  try {
    const firstRun = bridgeWorker.runOnce(config);
    await firstPost;
    await delay(80);
    const secondRun = bridgeWorker.runOnce(config);
    await delay(80);
    pendingResponses.forEach((response) => sendJson(response, { ok: true }));
    const [, second] = await Promise.all([firstRun, secondRun]);
    assert.equal(postCount, 1);
    assert.equal(second.processed.length, 0);
    assert.equal(second.skipped[0].reason, "account_lock_busy");
  } finally {
    pendingResponses.forEach((response) => sendJson(response, { ok: true }));
    await close(server);
  }
});

test("corrupted stale account lock fails closed instead of being stolen", async () => {
  const fixture = createWorkerFixture([
    identity("task_corrupt_lock", "attempt_corrupt_lock", "account_corrupt", "conversation_corrupt", "customer_corrupt"),
  ]);
  fs.mkdirSync(fixture.lockDir, { recursive: true });
  const lockPath = path.join(fixture.lockDir, "account_corrupt.lock");
  fs.writeFileSync(lockPath, "{\"partial\":", "utf8");
  const old = new Date(Date.now() - 5000);
  fs.utimesSync(lockPath, old, old);
  let postCount = 0;
  const server = http.createServer((request, response) => {
    if (request.method === "GET") return sendJson(response, fixture.response);
    postCount += 1;
    sendJson(response, { ok: true });
  });
  const apiBase = await listen(server);
  try {
    const result = await bridgeWorker.runOnce(workerConfig(fixture, apiBase, { lockStaleMs: 40 }));
    assert.equal(postCount, 0);
    assert.equal(result.skipped[0].reason, "account_lock_busy");
    assert.equal(fs.existsSync(lockPath), true);
  } finally {
    await close(server);
  }
});

test("queue-head contention stays per account while different accounts progress", async () => {
  const fixture = createWorkerFixture([
    identity("task_a1", "attempt_a1", "account_a", "conversation_a1", "customer_a1"),
    identity("task_a2", "attempt_a2", "account_a", "conversation_a2", "customer_a2"),
    identity("task_b1", "attempt_b1", "account_b", "conversation_b1", "customer_b1"),
  ]);
  const posts = [];
  const server = http.createServer((request, response) => {
    if (request.method === "GET") return sendJson(response, fixture.response);
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      posts.push(JSON.parse(body));
      sendJson(response, { ok: true });
    });
  });
  const apiBase = await listen(server);
  try {
    const result = await bridgeWorker.runOnce(workerConfig(fixture, apiBase));
    assert.deepEqual(result.processed.map((item) => item.taskId), ["task_a1", "task_b1"]);
    assert.equal(result.skipped[0].taskId, "task_a2");
    assert.deepEqual(new Set(posts.map((item) => item.wechatAccountId)), new Set(["account_a", "account_b"]));
  } finally {
    await close(server);
  }
});

test("lost ack timeout becomes protected delivery-unknown instead of requeueable failure", async () => {
  const { localStore, service } = setupService();
  const execution = createPendingBridgeSend(localStore, service, "ack may have been lost");
  createDispatchForPending(service);
  localStore.updateSendAttempt(execution.attempt.id, {
    startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });
  const scan = await service.scanSendOperations();
  const task = localStore.getSendTask(execution.task.id);
  const attempt = localStore.getLatestSendAttempt(execution.task.id, { adapter: "windows_bridge" });

  assert.equal(scan.bridgeTimedOut, 1);
  assert.equal(task.status, "sending");
  assert.equal(task.guardSnapshot.deliveryState, "unknown");
  assert.equal(task.guardSnapshot.deliveryUnknownReason, "bridge_ack_timeout");
  assert.equal(attempt.status, "started");
  assert.equal(service.listBridgeOutbox().pending.length, 0);
  assert.equal(service.listBridgeOutbox().ignored[0].ignoreReason, "delivery_unknown_retry_blocked");
  assert.equal(listFiles(process.env.WECHAT_BRIDGE_DISPATCH_DIR, ".dispatch.json").length, 0);
  assert.equal(listFiles(path.join(process.env.WECHAT_BRIDGE_DISPATCH_DIR, "uncertain"), ".dispatch.json").length, 1);
  await assert.rejects(() => service.requeueSendTask(task.id), /不能直接重新排队|waiting for Windows bridge ack/i);
});

test("duplicate trusted ack is accepted idempotently after first response is lost", () => {
  const { localStore, service } = setupService();
  const execution = createPendingBridgeSend(localStore, service, "idempotent ack");
  const { pending, outbox } = createDispatchForPending(service);
  const ack = bridgeWorker.buildAckPayload(pending, "simulate_sent", outbox.payload);
  const first = service.acknowledgeBridgeSend(execution.task.id, ack);
  const replay = service.acknowledgeBridgeSend(execution.task.id, ack);

  assert.equal(first.task.status, "sent");
  assert.equal(replay.task.status, "sent");
  assert.equal(replay.idempotent, true);
  assert.equal(localStore.listSendAttempts({ sendTaskId: execution.task.id }).length, 1);
});

test("ack commit interruption persists sent task before attempt and archive cleanup", () => {
  const { localStore, service } = setupService();
  const execution = createPendingBridgeSend(localStore, service, "crash during ack commit");
  const { pending, outbox } = createDispatchForPending(service);
  const ack = bridgeWorker.buildAckPayload(pending, "simulate_sent", outbox.payload);
  const original = localStore.updateSendAttempt.bind(localStore);
  localStore.updateSendAttempt = (attemptId, patch) => {
    if (attemptId === execution.attempt.id && patch.status === "sent") throw new Error("injected crash");
    return original(attemptId, patch);
  };

  assert.throws(() => service.acknowledgeBridgeSend(execution.task.id, ack), /injected crash/);
  assert.equal(localStore.getSendTask(execution.task.id).status, "sent");
  assert.equal(fs.existsSync(outbox.filePath), true);
  assert.equal(localStore.getLatestSendAttempt(execution.task.id, { adapter: "windows_bridge" }).status, "started");
  localStore.updateSendAttempt = original;
  const recovered = service.acknowledgeBridgeSend(execution.task.id, ack);
  assert.equal(recovered.idempotent, true);
  assert.equal(recovered.attempt.status, "sent");
  assert.equal(fs.existsSync(outbox.filePath), false);
});

function setupService() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "restart-idempotency-service-"));
  process.env.WECHAT_BRIDGE_OUTBOX_DIR = path.join(tempDir, "outbox");
  process.env.WECHAT_BRIDGE_INBOX_DIR = path.join(tempDir, "inbox");
  process.env.WECHAT_BRIDGE_DISPATCH_DIR = path.join(tempDir, "dispatch");
  process.env.WECHAT_BRIDGE_LOCK_DIR = path.join(tempDir, "locks");
  appConfig.useLocalStore = true;
  appConfig.wechatBridgeOutboxDir = process.env.WECHAT_BRIDGE_OUTBOX_DIR;
  appConfig.wechatBridgeInboxDir = process.env.WECHAT_BRIDGE_INBOX_DIR;
  appConfig.wechatBridgeDispatchDir = process.env.WECHAT_BRIDGE_DISPATCH_DIR;
  appConfig.wechatBridgeLockDir = process.env.WECHAT_BRIDGE_LOCK_DIR;
  appConfig.wechatBridgeWorkerStatusFile = path.join(tempDir, "worker-status.json");
  appConfig.wechatWindowObserverProofFile = path.join(tempDir, "wechat-window-observer-proof.key");
  fs.writeFileSync(appConfig.wechatWindowObserverProofFile, `${observerProofToken}\n`, "utf8");
  appConfig.sendBridgeAckTimeoutMinutes = 5;
  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  const notifications = new NotificationsService({}, localStore);
  const orders = new OrdersService({}, localStore, notifications);
  const service = new WechatDispatchService({}, localStore, new WechatSendAdapterService(), notifications, orders);
  return { localStore, service };
}

function createPendingBridgeSend(localStore, service, text) {
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text },
    guardSnapshot: { requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"] },
  });
  createTrustedTestWindowSnapshot(localStore, {
    source: "windows_foreground_observer",
    isOnline: true,
    wechatAccountId: "wechat_demo_1",
    accountDisplayName: "客服微信1号",
    chatTitle: "王总-端午礼盒",
    activeChatTitle: "王总-端午礼盒",
    recentCustomerId: "customer_demo_1",
    recentMessageText: text,
    confidence: 1,
    capturedAt: new Date().toISOString(),
    diagnostic: {
      observerEvidence: {
        verified: true,
        version: "wechat_window_observer_v1",
        nonceHash: "d".repeat(64),
      },
    },
  });
  return service.executeSend(task.id, { adapter: "windows_bridge" });
}

function createTrustedTestWindowSnapshot(localStore, payload) {
  const snapshot = { ...payload, capturedAt: payload.capturedAt || new Date().toISOString() };
  const evidence = payload.diagnostic?.observerEvidence || {};
  const observerEvidence = createWechatWindowObserverAttestation(
    snapshot,
    {
      version: evidence.version || "wechat_window_observer_v1",
      issuedAt: snapshot.capturedAt,
      nonceHash: evidence.nonceHash || "d".repeat(64),
    },
    observerProofToken,
  );
  return localStore.createWechatWindowSnapshot({
    ...snapshot,
    diagnostic: { ...(payload.diagnostic || {}), observerEvidence },
  });
}

function createDispatchForPending(service) {
  const pending = service.listBridgeOutbox().pending[0];
  const outbox = bridgeWorker.loadAndValidateOutboxPayload({
    ...pending,
    outboxDir: process.env.WECHAT_BRIDGE_OUTBOX_DIR,
  });
  bridgeWorker.writeDispatchFile(process.env.WECHAT_BRIDGE_DISPATCH_DIR, pending, outbox, {
    inboxDir: process.env.WECHAT_BRIDGE_INBOX_DIR,
    apiBase: "http://127.0.0.1:3200/api",
  });
  return { pending, outbox };
}

function createPersonalFixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-bridge-restart-"));
  const dispatchDir = path.join(root, "dispatch");
  const inboxDir = path.join(root, "inbox");
  const blockedDir = path.join(root, "blocked");
  const localStorageRoot = path.join(root, "storage");
  const outboxDir = path.join(root, "outbox");
  fs.mkdirSync(dispatchDir, { recursive: true });
  fs.mkdirSync(outboxDir, { recursive: true });
  const sourceOutboxFileName = "source-outbox.json";
  const sourceOutboxFilePath = path.join(outboxDir, sourceOutboxFileName);
  const target = {
    wechatAccountId: "account_1", conversationId: "conversation_1", customerId: "customer_1",
    conversationTitle: "Chat 1", recentMessageText: "latest customer message", windowSnapshotId: "window_1",
  };
  const sendPlan = {
    kind: "text", target, actionCount: 1, actions: [{ type: "text", text: "fault injection" }],
    constraints: { singleAccountLock: true, requireActiveWindowMatch: true, requireRecentCustomerMatch: true, doNotMarkSentWithoutAck: true },
  };
  const outbox = {
    version: "wechat_bridge_outbox_v1", ackToken: "a".repeat(64), taskId: "task_1",
    wechatAccountId: "account_1", conversationId: "conversation_1", customerId: "customer_1", target, sendPlan,
    guardSnapshot: { status: "passed", ok: true }, context: { guardStatus: "passed", windowSnapshotId: "window_1" },
  };
  fs.writeFileSync(sourceOutboxFilePath, `${JSON.stringify(outbox, null, 2)}\n`, "utf8");
  const dispatch = {
    version: "wechat_bridge_dispatch_v1", taskId: "task_1", attemptId: "attempt_1",
    wechatAccountId: "account_1", conversationId: "conversation_1", sourceOutboxFileName, sourceOutboxFilePath,
    target,
    preflight: {
      expectedWechatAccountId: "account_1", expectedConversationId: "conversation_1", expectedCustomerId: "customer_1",
      expectedConversationTitle: "Chat 1", expectedRecentMessageText: "latest customer message",
      rejectIfAnyCheckFails: true, rejectIfWindowChanged: true, rejectIfExpired: true, rejectIfOutboxMissing: true,
    },
    sendPlan,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  fs.writeFileSync(path.join(dispatchDir, "account_1-task_1-attempt_1.dispatch.json"), `${JSON.stringify(dispatch, null, 2)}\n`, "utf8");
  return {
    dispatchDir,
    inboxDir,
    config: {
      apiBase: "http://127.0.0.1:3200/api", dispatchDir, inboxDir, blockedDir, localStorageRoot,
      lockDir: path.join(root, "locks"), statusFile: path.join(root, "status.json"),
      limit: 5, intervalMs: 10, sendTimeoutMs: 1000, lockStaleMs: 1000,
      sendEnabled: true, scanAckInbox: true, watch: false, driver: "windows_uia",
      pasteDelayMs: 1, confirmDelayMs: 1,
      accountsConfig: {
        version: "personal_wechat_accounts_v1",
        accounts: [{
          wechatAccountId: "account_1", sessionId: "session_1", processId: 1001, processName: "WeChat.exe",
          windowHandle: "0x1001", windowsSessionId: 1, accountText: "Account 1",
          ui: {
            accountAutomationId: "account", chatTitleAutomationId: "chat", messageListAutomationId: "messages",
            inputAutomationId: "input", recentMessageMatch: "exact", sentTextMatch: "exact",
          },
          conversations: [{ conversationId: "conversation_1", customerId: "customer_1", chatTitle: "Chat 1" }],
        }],
      },
      operationExecutor: () => {
        operationCalls += 1;
        return { ...operationResult };
      },
      scanAckExecutor: () => ({ processed: [{ taskId: "task_1", attemptId: "attempt_1" }], failed: [] }),
      verifyPendingDispatch: () => ({ ok: true, source: "fault_injection" }),
      ...overrides,
    },
  };
}

function verifiedOperationResult() {
  return {
    ok: true,
    operationVerified: true,
    accountVerified: true,
    chatVerified: true,
    recentMessageVerified: true,
    actionCount: 1,
  };
}

function identity(taskId, attemptId, wechatAccountId, conversationId, customerId) {
  return { taskId, attemptId, wechatAccountId, conversationId, customerId };
}

function createWorkerFixture(identities) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worker-lock-injection-"));
  const outboxDir = path.join(root, "outbox");
  fs.mkdirSync(outboxDir, { recursive: true });
  const pending = identities.map((item, index) => {
    const fileName = `${index}-${item.taskId}.json`;
    const target = { ...item, taskId: undefined, attemptId: undefined, windowSnapshotId: `window_${index}` };
    const payload = {
      version: "wechat_bridge_outbox_v1", ackToken: String(index + 1).repeat(64).slice(0, 64),
      ...item, target,
      sendPlan: {
        kind: "text", target, actionCount: 1, actions: [{ type: "text", text: item.taskId }],
        constraints: { singleAccountLock: true, requireActiveWindowMatch: true, requireRecentCustomerMatch: true, doNotMarkSentWithoutAck: true },
      },
      guardSnapshot: { status: "passed", ok: true }, context: { guardStatus: "passed", windowSnapshotId: target.windowSnapshotId },
    };
    fs.writeFileSync(path.join(outboxDir, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return {
      ...item, fileName, payloadKind: "text",
      preview: { protocolVersion: "wechat_bridge_outbox_v1", outboxFileName: fileName, ...item },
    };
  });
  return {
    root, outboxDir, inboxDir: path.join(root, "inbox"), dispatchDir: path.join(root, "dispatch"),
    lockDir: path.join(root, "locks"), statusFile: path.join(root, "status.json"), response: { outboxDir, pending },
  };
}

function workerConfig(fixture, apiBase, overrides = {}) {
  return {
    apiBase, outboxDir: fixture.outboxDir, inboxDir: fixture.inboxDir, dispatchDir: fixture.dispatchDir,
    lockDir: fixture.lockDir, statusFile: fixture.statusFile, mode: "simulate_sent", ackTransport: "api",
    limit: 20, intervalMs: 10, lockStaleMs: 1000, dispatchTtlMs: 1000, watch: false, ...overrides,
  };
}

function injectHalfWrite(targetFile, callback) {
  const target = path.resolve(targetFile);
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = (filePath, data, ...rest) => {
    const resolved = path.resolve(String(filePath));
    if (resolved === target || (path.dirname(resolved) === path.dirname(target) && path.basename(resolved).includes(path.basename(target)))) {
      realWrite(filePath, "{\"partial\":", ...rest);
      throw new Error("injected half write");
    }
    return realWrite(filePath, data, ...rest);
  };
  try {
    callback();
  } finally {
    fs.writeFileSync = realWrite;
  }
}

function readStore(localStore) {
  return JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
}

function listFiles(directory, suffix) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => path.join(directory, entry.name));
}

function sendJson(response, payload) {
  if (response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}/api`));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
