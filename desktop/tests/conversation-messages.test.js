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
  const reply = await service.enqueueManualReply({ ...primaryIdentity, text: "收到，我先核对附件。", operator: "客服甲" });
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
  await service.enqueueManualReply({ ...primaryIdentity, text: "人工回复不增加未读" });
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
  const first = localStore.createMessage({ ...primaryIdentity, text: "一次", externalId: "same-event" });
  const replay = localStore.createMessage({ ...primaryIdentity, text: "重复", externalId: "same-event" });
  const timeline = localStore.listConversationTimeline(primaryIdentity);
  assert.equal(replay.id, first.id);
  assert.equal(timeline.filter((item) => item.externalId === "same-event").length, 1);
});

test("manual reply uses safe queue while automation stays blocked by manual takeover", async () => {
  const { localStore, service, tempDir } = setup();
  localStore.updateConversation(primaryIdentity.conversationId, { manualLocked: true });
  await assert.rejects(() => service.enqueueTextMessage({ ...primaryIdentity, text: "自动消息" }), /会话已人工接管/);
  await assert.rejects(() => service.enqueueManualReply({ ...primaryIdentity, customerId: "customer_demo_2", text: "错客户" }), /customer binding invalid/);
  await assert.rejects(() => service.enqueueManualReply({ ...primaryIdentity, text: "   " }), /text is required/);
  await assert.rejects(() => service.enqueueManualReply({ ...primaryIdentity, text: "超".repeat(2001) }), /exceeds 2000 characters/);
  const boundary = await service.enqueueManualReply({ ...primaryIdentity, text: "界".repeat(2000), operator: "客服甲" });
  assert.equal(boundary.task.payload.text.length, 2000);
  const result = await service.enqueueManualReply({ ...primaryIdentity, text: "人工接管后的可信回复", operator: "客服甲" });
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
  await assert.rejects(() => service.processInboundMessage({ ...primaryIdentity, customerId: "customer_demo_2", text: "串线请求" }), /inbound customer binding invalid/);
});
