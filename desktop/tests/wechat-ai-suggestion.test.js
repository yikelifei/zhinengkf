"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { OrdersService } = require("../apps/api/src/orders/orders.service");
const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");

function setup(aiProviders) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-ai-suggestion-"));
  const store = new LocalStoreService();
  store.filePath = path.join(root, "local-store.json");
  const notifications = new NotificationsService({}, store);
  const orders = new OrdersService({}, store, notifications);
  const service = new WechatDispatchService({}, store, new WechatSendAdapterService(), notifications, orders, aiProviders);
  return { store, service };
}

test("safe inbound reply uses AI after rules and scoped knowledge", async () => {
  const calls = [];
  const ai = { generateInboundSuggestion: async (input) => { calls.push(input); return { text: "收到，我帮您核对订单 123 的物流进度。", provider: "backup", model: "demo", attempts: 2 }; } };
  const { service } = setup(ai);
  const result = await service.processInboundMessage({ externalId: "ai-suggestion-safe-inbound", wechatAccountId: "wechat_demo_1", conversationId: "conversation_demo_1", customerId: "customer_demo_1", text: "物流快递单号 123 已停滞三天，请帮我查物流进度" });
  assert.equal(calls.length, 1);
  assert.equal("conversationId" in calls[0], false);
  assert.equal(result.route.suggestedReply, "收到，我帮您核对订单 123 的物流进度。");
  assert.equal(result.route.replyDraft.aiAssistance.authority, "rules_and_scoped_knowledge");
  assert.equal(result.sendTask.payload.text, result.route.suggestedReply);
});

test("high-risk inbound is forced to human without calling AI", async () => {
  let calls = 0;
  const ai = { generateInboundSuggestion: async () => { calls += 1; throw new Error("must not run"); } };
  const { service } = setup(ai);
  const result = await service.processInboundMessage({ externalId: "ai-suggestion-high-risk-inbound", wechatAccountId: "wechat_demo_1", conversationId: "conversation_demo_1", customerId: "customer_demo_1", text: "我要投诉并报警维权" });
  assert.equal(calls, 0);
  assert.equal(result.plan.shouldNotifyHuman, true);
  assert.equal(result.sendTask, null);
  assert.equal(result.manualLock.conversation.manualLocked, true);
});

test("provider failure falls back to the existing rule reply without interrupting inbound", async () => {
  const ai = { generateInboundSuggestion: async () => { throw new Error("provider unavailable"); } };
  const { service } = setup(ai);
  const result = await service.processInboundMessage({ externalId: "ai-suggestion-provider-fallback", wechatAccountId: "wechat_demo_1", conversationId: "conversation_demo_1", customerId: "customer_demo_1", text: "物流快递单号 456 已停滞两天，请帮我查物流进度" });
  assert.equal(result.route.replyDraft.aiAssistance.used, false);
  assert.equal(result.route.replyDraft.aiAssistance.authority, "rule_fallback");
  assert.equal(result.route.suggestedReply, result.route.replyDraft.ruleSuggestedReply);
  assert.equal(result.sendTask.payload.text, result.route.suggestedReply);
});
