"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

function setup() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-messages-"));
  appConfig.useLocalStore = true;
  appConfig.wechatBridgeOutboxDir = path.join(tempDir, "outbox");
  appConfig.wechatBridgeInboxDir = path.join(tempDir, "inbox");
  appConfig.wechatBridgeDispatchDir = path.join(tempDir, "dispatch");
  appConfig.wechatBridgeLockDir = path.join(tempDir, "locks");
  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  const service = new WechatDispatchService({}, localStore, new WechatSendAdapterService(), { create: async () => ({}) }, {});
  return { tempDir, localStore, service };
}

const primaryIdentity = {
  wechatAccountId: "wechat_demo_1",
  conversationId: "conversation_demo_1",
  customerId: "customer_demo_1",
};

test("conversation timeline requires and enforces account customer conversation identity", async () => {
  const { service } = setup();
  await assert.rejects(() => service.listConversationTimeline({ conversationId: primaryIdentity.conversationId }), /complete conversation identity/);
  await assert.rejects(() => service.listConversationTimeline({ ...primaryIdentity, wechatAccountId: "wechat_demo_2" }), /conversation not found|wechat account binding invalid/);
  await assert.rejects(() => service.listConversationTimeline({ ...primaryIdentity, customerId: "customer_demo_2" }), /customer binding invalid/);
  const timeline = await service.listConversationTimeline(primaryIdentity);
  assert.equal(timeline.every((item) => item.conversationId === primaryIdentity.conversationId), true);
  assert.equal(timeline.some((item) => item.text.includes("企业伴手礼")), false);
});

test("timeline merges inbound attachments and queued outbound tasks without claiming sent", async () => {
  const { localStore, service } = setup();
  localStore.createMessage({
    ...primaryIdentity,
    text: "请看附件",
    externalId: "external-attachment-1",
    attachments: [
      { name: "参考图.png", mimeType: "image/png", status: "loaded" },
      { name: "需求单.pdf", mimeType: "application/pdf", status: "available" },
      { source: "wechat_work", externalUserId: "wm_customer", raw: { msgtype: "text" } },
    ],
  });
  const reply = await service.enqueueManualReply({
    ...primaryIdentity,
    text: "收到，我先核对附件。",
    operator: "客服甲",
    operationKey: "conversation-attachment-reply-1",
  });
  const timeline = await service.listConversationTimeline(primaryIdentity);
  const inbound = timeline.find((item) => item.externalId === "external-attachment-1");
  const outbound = timeline.find((item) => item.sendTaskId === reply.task.id);
  assert.deepEqual(inbound.attachments.map((item) => item.kind), ["image", "file"]);
  assert.equal(outbound.direction, "outbound");
  assert.equal(outbound.status, "queued");
  assert.equal(outbound.text, "收到，我先核对附件。");
  assert.equal(timeline.every((item, index) => index === 0 || timeline[index - 1].createdAt <= item.createdAt), true);
});

test("read state is isolated, inbound-only, and idempotent", async () => {
  const { localStore, service } = setup();
  localStore.createMessage({ ...primaryIdentity, text: "新的未读消息", externalId: "unread-1" });
  await service.enqueueManualReply({
    ...primaryIdentity,
    text: "人工回复不增加未读",
    operationKey: "conversation-read-state-reply-1",
  });
  const before = localStore.listConversations().find((item) => item.id === primaryIdentity.conversationId);
  assert.equal(before.unreadCount >= 2, true);
  const first = await service.markConversationMessagesRead(primaryIdentity);
  const second = await service.markConversationMessagesRead(primaryIdentity);
  const after = localStore.listConversations().find((item) => item.id === primaryIdentity.conversationId);
  const other = localStore.listConversations().find((item) => item.id === "conversation_demo_2");
  assert.equal(first.updatedCount >= 2, true);
  assert.equal(second.updatedCount, 0);
  assert.equal(after.unreadCount, 0);
  assert.equal(other.unreadCount, 1);
});

test("external inbound replay is idempotent within the conversation", () => {
  const { localStore } = setup();
  const payload = { ...primaryIdentity, text: "一次", externalId: "same-event" };
  const first = localStore.createMessage(payload);
  const replay = localStore.createMessage(payload);
  const timeline = localStore.listConversationTimeline(primaryIdentity);
  assert.equal(replay.id, first.id);
  assert.equal(timeline.filter((item) => item.externalId === "same-event").length, 1);
  assert.throws(
    () => localStore.createMessage({ ...payload, text: "同一外部事件被替换为不同内容" }),
    /inbound message create operationKey was already used with different identity or payload/,
  );
});

test("out-of-order LocalStore inbound messages never move conversation lastMessageAt backwards", () => {
  const { localStore } = setup();
  localStore.createMessage({
    ...primaryIdentity,
    text: "较新消息",
    externalId: "conversation-newer-event",
    createdAt: "2030-07-20T12:00:00.000Z",
  });
  localStore.createMessage({
    ...primaryIdentity,
    text: "延迟到达的旧消息",
    externalId: "conversation-stale-event",
    createdAt: "2030-07-20T10:00:00.000Z",
  });
  const conversation = localStore.listConversations().find((item) => item.id === primaryIdentity.conversationId);
  assert.equal(conversation.lastMessageAt, "2030-07-20T12:00:00.000Z");
});

test("LocalStore compares valid ISO offsets by epoch and persists canonical UTC activity", () => {
  const { localStore } = setup();
  localStore.createMessage({
    ...primaryIdentity,
    text: "基准时间",
    externalId: "offset-base",
    createdAt: "2030-07-20T10:00:00.000Z",
  });
  localStore.createMessage({
    ...primaryIdentity,
    text: "字典序更小但实际更晚",
    externalId: "offset-newer",
    createdAt: "2030-07-20T09:30:00-01:00",
  });
  localStore.createMessage({
    ...primaryIdentity,
    text: "字典序更大但实际更早",
    externalId: "offset-stale",
    createdAt: "2030-07-20T20:00:00+10:00",
  });
  const conversation = localStore.listConversations().find((item) => item.id === primaryIdentity.conversationId);
  assert.equal(conversation.lastMessageAt, "2030-07-20T10:30:00.000Z");
});

test("inbound replay resumes after route commit failure without duplicate route or message", async () => {
  const { localStore, service } = setup();
  const originalCreateRoute = localStore.createRouteEvaluation.bind(localStore);
  let injectFailure = true;
  localStore.createRouteEvaluation = (...args) => {
    const route = originalCreateRoute(...args);
    if (injectFailure) {
      injectFailure = false;
      throw new Error("injected failure after durable route create");
    }
    return route;
  };
  const payload = {
    ...primaryIdentity,
    text: "你好，请介绍一下礼盒",
    externalId: "recover-after-route-commit",
    createdAt: "2030-07-20T11:00:00.000Z",
  };
  await assert.rejects(service.processInboundMessage(payload), /injected failure/);
  const afterFailure = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  assert.equal(afterFailure.messages.filter((item) => item.externalId === payload.externalId).length, 1);
  assert.equal(afterFailure.routeEvaluations.length, 1);
  assert.equal(afterFailure.inboundMessageOperations[0].status, "retryable");
  assert.equal(afterFailure.inboundMessageOperations[0].stage, "message_persisted");

  const recovered = await service.processInboundMessage(payload);
  const afterRecovery = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  assert.equal(recovered.message.externalId, payload.externalId);
  assert.equal(afterRecovery.messages.filter((item) => item.externalId === payload.externalId).length, 1);
  assert.equal(afterRecovery.routeEvaluations.length, 1);
  assert.equal(afterRecovery.inboundMessageOperations[0].status, "completed");
  assert.equal(afterRecovery.inboundMessageOperations[0].stage, "completed");

  const completedReplay = await service.processInboundMessage(payload);
  assert.equal(completedReplay.duplicate, true);
  assert.equal(completedReplay.processing, false);
  assert.equal(completedReplay.message.id, recovered.message.id);
  assert.equal(completedReplay.route.id, recovered.route.id);
  assert.equal(completedReplay.outcome, recovered.plan.type);
  assert.equal(JSON.parse(fs.readFileSync(localStore.filePath, "utf8")).routeEvaluations.length, 1);
});

test("effects-committed replay completes without repeating downstream effects", async () => {
  const { localStore, service } = setup();
  let notificationCalls = 0;
  service.notifications.create = async (...args) => ({ id: `notice-${++notificationCalls}`, target: args[3] });
  const originalComplete = service.persistence.completeInboundOperation.bind(service.persistence);
  let injectFailure = true;
  service.persistence.completeInboundOperation = async (...args) => {
    if (injectFailure) {
      injectFailure = false;
      throw new Error("injected failure after durable effects stage");
    }
    return originalComplete(...args);
  };
  const payload = {
    ...primaryIdentity,
    text: "预算两万元，需要人工确认礼盒方案",
    externalId: "recover-after-effects-commit",
    createdAt: "2030-07-20T12:00:00.000Z",
  };
  await assert.rejects(service.processInboundMessage(payload), /injected failure/);
  const failed = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  const operation = failed.inboundMessageOperations.find((item) => item.externalId === payload.externalId);
  const routesAfterFailure = failed.routeEvaluations.length;
  assert.equal(operation.status, "retryable");
  assert.equal(operation.stage, "effects_committed");
  assert.equal(routesAfterFailure > 0, true);

  const recovered = await service.processInboundMessage(payload);
  const completed = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"))
    .inboundMessageOperations.find((item) => item.externalId === payload.externalId);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.processing, false);
  assert.equal(recovered.message.externalId, payload.externalId);
  assert.equal(recovered.route.id, operation.result.routeEvaluationId);
  assert.equal(recovered.outcome, recovered.plan.type);
  assert.equal(notificationCalls, 0);
  assert.equal(JSON.parse(fs.readFileSync(localStore.filePath, "utf8")).routeEvaluations.length, routesAfterFailure);
  assert.equal(completed.status, "completed");
  assert.equal(completed.stage, "completed");
});

test("inbound operation snapshot strips host secrets and local paths from attachments", async () => {
  const { localStore, service } = setup();
  await service.processInboundMessage({
    ...primaryIdentity,
    text: "带附件引用的消息",
    externalId: "safe-operation-attachment",
    attachments: [{
      role: "image",
      mimeType: "image/png",
      imageId: "safe-remote-image-id",
      referencedImageId: "C:\\secret\\reference.png",
      remoteImageId: "file:///private/remote.png",
      token: "operation-secret-token",
      endpoint: "http://127.0.0.1:3999",
      localPath: "C:\\secret\\attachment.png",
    }],
    createdAt: "2030-07-20T13:00:00.000Z",
  });
  const operation = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"))
    .inboundMessageOperations.find((item) => item.externalId === "safe-operation-attachment");
  const snapshot = JSON.stringify(operation.normalizedPayload);
  assert.match(snapshot, /image\/png/);
  assert.match(snapshot, /safe-remote-image-id/);
  assert.doesNotMatch(snapshot, /operation-secret-token|127\.0\.0\.1|secret\\\\(?:attachment|reference)|file:\/\/\/private/i);
  assert.doesNotMatch(snapshot, /"(?:token|endpoint|localPath)"/i);
});

test("inbound assetIds reject non-strings, credentials, endpoints, absolute paths and control characters", async () => {
  const unsafeValues = [
    [{ token: "nested-secret", endpoint: "https://private.example", localPath: "C:\\private\\asset.png" }],
    ["token=secret-value"],
    ["https://private.example/asset"],
    ["file:///private/asset.png"],
    ["C:\\private\\asset.png"],
    ["\\\\server\\share\\asset.png"],
    ["asset-id\u0000hidden"],
  ];
  for (const [index, assetIds] of unsafeValues.entries()) {
    const { service } = setup();
    await assert.rejects(
      () => service.processInboundMessage({
        ...primaryIdentity,
        text: "unsafe asset id",
        externalId: `unsafe-operation-asset-${index}`,
        assetIds,
      }),
      /assetIds must/,
    );
  }
});

test("inbound lease reclaim fences the stale owner before effects and supplied operationId validation is write-free", async () => {
  const { localStore, service } = setup();
  const original = localStore.claimInboundMessageOperation({
    id: "inbound-lease-fence-operation",
    source: "wechat",
    wechatAccountId: primaryIdentity.wechatAccountId,
    externalId: "inbound-lease-fence-event",
    requestFingerprint: "inbound-lease-fence-fingerprint",
    normalizedPayload: { text: "lease fence" },
    claimToken: "lease-owner-a",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  }).operation;
  const beforeInvalidReplay = localStore.getInboundMessageOperation(
    primaryIdentity.wechatAccountId,
    "inbound-lease-fence-event",
  );
  await assert.rejects(
    () => service.persistence.claimInboundOperation({
      operationId: "wrong-operation-id",
      source: "wechat",
      wechatAccountId: primaryIdentity.wechatAccountId,
      externalId: "inbound-lease-fence-event",
      requestFingerprint: "inbound-lease-fence-fingerprint",
      normalizedPayload: { text: "lease fence" },
      claimToken: "lease-owner-a",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    /operation identity or payload changed/,
  );
  const afterInvalidReplay = localStore.getInboundMessageOperation(
    primaryIdentity.wechatAccountId,
    "inbound-lease-fence-event",
  );
  assert.equal(afterInvalidReplay.claimToken, beforeInvalidReplay.claimToken);
  assert.equal(afterInvalidReplay.attemptCount, beforeInvalidReplay.attemptCount);

  const expiredDocument = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  expiredDocument.inboundMessageOperations.find((item) => item.id === original.id).leaseExpiresAt =
    new Date(Date.now() - 1_000).toISOString();
  fs.writeFileSync(localStore.filePath, JSON.stringify(expiredDocument, null, 2));
  const reclaimed = localStore.claimInboundMessageOperation({
    source: "wechat",
    wechatAccountId: primaryIdentity.wechatAccountId,
    externalId: "inbound-lease-fence-event",
    requestFingerprint: "inbound-lease-fence-fingerprint",
    claimToken: "lease-owner-b",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(reclaimed.claimed, true);
  assert.equal(reclaimed.operation.claimToken, "lease-owner-b");
  assert.equal(reclaimed.operation.attemptCount, original.attemptCount + 1);

  let staleEffectCalls = 0;
  await assert.rejects(
    () => service.withInboundEffectLease(original.id, "lease-owner-a", () => {
      staleEffectCalls += 1;
    }),
    /lease is no longer owned by this claim/,
  );
  assert.equal(staleEffectCalls, 0);
  assert.throws(
    () => localStore.updateInboundMessageOperation(original.id, "lease-owner-a", { stage: "routed" }),
    /claim changed before stage commit/,
  );
  const advanced = localStore.updateInboundMessageOperation(original.id, "lease-owner-b", { stage: "routed" });
  assert.equal(advanced.stage, "routed");
});

test("completed inbound replay fails closed when a promised durable reference is missing", async () => {
  const { localStore, service } = setup();
  const payload = {
    ...primaryIdentity,
    text: "durable hydration reference",
    externalId: "completed-replay-missing-route",
  };
  await service.processInboundMessage(payload);
  const document = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  const operation = document.inboundMessageOperations.find((item) => item.externalId === payload.externalId);
  operation.result.routeEvaluationId = "missing-route-evaluation";
  fs.writeFileSync(localStore.filePath, JSON.stringify(document, null, 2));
  await assert.rejects(
    () => service.processInboundMessage(payload),
    /missing its durable route evaluation/,
  );
});

test("manual reply uses safe queue while automation stays blocked by manual takeover", async () => {
  const { localStore, service, tempDir } = setup();
  localStore.updateConversation(primaryIdentity.conversationId, { manualLocked: true });
  await assert.rejects(() => service.enqueueTextMessage({ ...primaryIdentity, text: "自动消息" }), /会话已人工接管/);
  await assert.rejects(
    () => service.enqueueManualReply({
      ...primaryIdentity,
      customerId: "customer_demo_2",
      text: "错客户",
      operationKey: "conversation-wrong-customer-1",
    }),
    /customer binding invalid/,
  );
  await assert.rejects(
    () => service.enqueueManualReply({ ...primaryIdentity, text: "   ", operationKey: "conversation-empty-reply-1" }),
    /text is required/,
  );
  await assert.rejects(
    () => service.enqueueManualReply({
      ...primaryIdentity,
      text: "超".repeat(2001),
      operationKey: "conversation-oversized-reply-1",
    }),
    /exceeds 2000 characters/,
  );
  const boundary = await service.enqueueManualReply({
    ...primaryIdentity,
    text: "界".repeat(2000),
    operator: "客服甲",
    operationKey: "conversation-boundary-reply-1",
  });
  assert.equal(boundary.task.payload.text.length, 2000);
  const result = await service.enqueueManualReply({
    ...primaryIdentity,
    text: "人工接管后的可信回复",
    operator: "客服甲",
    operationKey: "conversation-manual-takeover-reply-1",
  });
  assert.equal(result.task.status, "queued");
  assert.equal(result.task.payload.source, "manual_reply");
  assert.equal(result.task.guardSnapshot.manualReply, true);
  assert.equal(localStore.listSendAttempts({ sendTaskId: result.task.id }).length, 0);
  assert.equal(fs.existsSync(path.join(tempDir, "outbox")), false);
  const guarded = service.validateSendTask(result.task.id, {
    expectedWechatAccountId: primaryIdentity.wechatAccountId,
    expectedConversationId: primaryIdentity.conversationId,
    expectedCustomerId: primaryIdentity.customerId,
    activeWindow: { wechatAccountId: "wechat_demo_2", chatTitle: "王总-端午礼盒", recentCustomerId: primaryIdentity.customerId },
  });
  assert.equal(guarded.guardSnapshot.status, "blocked");
  assert.equal(guarded.guardSnapshot.failedKeys.includes("windowSnapshotMissing"), true);
  assert.equal(guarded.guardSnapshot.activeWindow, null);
});

test("inbound service rejects a customer id from another conversation", async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.processInboundMessage({
      ...primaryIdentity,
      customerId: "customer_demo_2",
      externalId: "conversation-cross-customer-1",
      text: "串线请求",
    }),
    /inbound customer binding invalid/,
  );
});
