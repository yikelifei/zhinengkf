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
const { appConfig } = require("../apps/api/src/shared/app-config");

function setup(aiProviders, sendAdapter = new WechatSendAdapterService()) {
  appConfig.useLocalStore = true;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-ai-suggestion-"));
  const store = new LocalStoreService();
  store.filePath = path.join(root, "local-store.json");
  const notifications = new NotificationsService({}, store);
  const orders = new OrdersService({}, store, notifications);
  const service = new WechatDispatchService({}, store, sendAdapter, notifications, orders, aiProviders);
  return { store, service };
}

test("isolated inbound reply queue sends only low-risk inbound text automation", async (t) => {
  const previousCorpId = appConfig.wechatWorkCorpId;
  const previousSecret = appConfig.wechatWorkSecret;
  appConfig.wechatWorkCorpId = "corp-isolated-reply";
  appConfig.wechatWorkSecret = "secret-isolated-reply";
  t.after(() => {
    appConfig.wechatWorkCorpId = previousCorpId;
    appConfig.wechatWorkSecret = previousSecret;
  });
  const adapter = {
    describe: () => ({
      name: "dry_run",
      realSend: false,
      capabilities: { requiresWindowGuard: false },
    }),
    execute: () => ({ status: "dry_run", metadata: { isolatedInboundReply: true } }),
  };
  const ai = {
    generateInboundSuggestion: async () => ({
      text: "在的，您说。",
      provider: "demo",
      model: "demo",
      attempts: 1,
    }),
  };
  const { store, service } = setup(ai, adapter);
  const binding = store.upsertWechatWorkBinding({
    openKfid: "wk-isolated-reply",
    externalUserId: "wm-isolated-reply",
  });
  const inbound = await service.processInboundMessage({
    externalId: "isolated-inbound-reply-queue",
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    text: "你好",
  });
  const unrelated = store.createSendTask({
    operationKey: "order-followup:isolated-inbound-reply-queue",
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    payload: { kind: "text", text: "订单进度通知" },
    guardSnapshot: {
      automation: { source: "order_followup", valueLevel: "low", planType: "queue_reply" },
    },
  });

  const result = await service.processSafeSendQueue({
    automationOnly: true,
    inboundReplyOnly: true,
    adapter: "dry_run",
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.processed.length, 1);
  assert.equal(result.processed[0].task.id, inbound.sendTask.id);
  assert.equal(store.getSendTask(inbound.sendTask.id).status, "dry_run");
  assert.equal(store.getSendTask(unrelated.id).status, "queued");
});

test("one account can serve multiple customers in one fair bounded queue cycle", async () => {
  const adapter = {
    describe: () => ({
      name: "dry_run",
      realSend: false,
      capabilities: { requiresWindowGuard: false },
    }),
    execute: () => ({ status: "dry_run", metadata: { multiCustomerCycle: true } }),
  };
  const { store, service } = setup(undefined, adapter);
  const firstAccountBindings = ["wm-multi-a", "wm-multi-b", "wm-multi-c"].map((externalUserId) =>
    store.upsertWechatWorkBinding({ openKfid: "wk-multi-account", externalUserId }),
  );
  const otherAccountBinding = store.upsertWechatWorkBinding({
    openKfid: "wk-other-account",
    externalUserId: "wm-other-a",
  });
  assert.equal(new Set(firstAccountBindings.map((item) => item.wechatAccountId)).size, 1);
  assert.equal(new Set(firstAccountBindings.map((item) => item.conversationId)).size, 3);

  const bindings = [...firstAccountBindings, otherAccountBinding];
  const tasks = bindings.map((binding, index) => store.createSendTask({
    operationKey: `multi-customer-cycle:${index}`,
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    status: "queued",
    payload: {
      kind: "text",
      text: `multi customer reply ${index}`,
      automationPlan: "queue_reply",
    },
    guardSnapshot: {
      automation: {
        source: "inbound_message",
        valueLevel: "low",
        planType: "queue_reply",
      },
    },
  }));

  const result = await service.processSafeSendQueue({
    automationOnly: true,
    inboundReplyOnly: true,
    adapter: "dry_run",
    limit: 4,
    perAccountLimit: 2,
  });

  assert.equal(result.processed.length, 3);
  assert.deepEqual(
    result.processed.map((item) => item.task.id),
    [tasks[0].id, tasks[3].id, tasks[1].id],
  );
  assert.equal(result.processed.filter((item) => item.task.wechatAccountId === firstAccountBindings[0].wechatAccountId).length, 2);
  assert.equal(store.getSendTask(tasks[2].id).status, "queued");
  assert.equal(result.skipped.some((item) => item.sendTaskId === tasks[2].id && item.reason === "account_cycle_limit_reached"), true);
});

test("safe inbound reply uses AI after rules and scoped knowledge", async () => {
  const calls = [];
  const ai = { generateInboundSuggestion: async (input) => { calls.push(input); return { text: "收到，我帮您核对订单 123 的物流进度。", provider: "backup", model: "demo", attempts: 2 }; } };
  const { store, service } = setup(ai);
  store.createMessage({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    externalId: "ai-suggestion-history-inbound",
    text: "前面说的是订单 123，请按这个订单继续处理。",
  });
  const result = await service.processInboundMessage({ externalId: "ai-suggestion-safe-inbound", wechatAccountId: "wechat_demo_1", conversationId: "conversation_demo_1", customerId: "customer_demo_1", text: "物流快递单号 123 已停滞三天，请帮我查物流进度" });
  assert.equal(calls.length, 1);
  assert.equal("conversationId" in calls[0], false);
  assert.equal(calls[0].conversationHistory.some((item) => item.content.includes("订单 123")), true);
  assert.equal(result.route.suggestedReply, "收到，我帮您核对订单 123 的物流进度。");
  assert.equal(result.route.replyDraft.aiAssistance.authority, "rules_and_scoped_knowledge");
  assert.equal(result.route.replyDraft.aiAssistance.historyTurns, calls[0].conversationHistory.length);
  assert.equal(result.route.replyDraft.aiAssistance.historyTurns >= 1, true);
  assert.equal(result.sendTask.payload.text, result.route.suggestedReply);
});

test("reviewed Xiaoshi verbatim RAG match skips model rewriting", async () => {
  let calls = 0;
  const ai = { generateInboundSuggestion: async () => { calls += 1; throw new Error("must not rewrite reviewed verbatim"); } };
  const { store, service } = setup(ai);
  const imported = store.createChatImport(
    {
      name: "Xiaoshi reviewed verbatim",
      text: "客户：好贵[捂脸]\n行，我再看看吧\n客服：咱这边预算多少，礼品可以调整",
      reviewMode: "required",
    },
    {
      messageCount: 3,
      pairCount: 1,
      warnings: [],
      pairs: [{
        question: "好贵[捂脸]\n行，我再看看吧",
        answer: "咱这边预算多少，礼品可以调整",
        scene: "售前转化",
        agentKey: "pre_sales",
        sceneScore: 30,
        matchedKeywords: ["好贵"],
        sceneScores: [],
        sceneCheck: { status: "clear", reason: "top_scene_confident", needsReview: false },
        score: 94,
        skillHints: ["小石式价格异议承接"],
      }],
    },
  );
  store.reviewTrainingSample(imported.samples[0].id, {
    status: "ready",
    reviewer: "test-reviewer",
    note: "已核对为小石脱敏原话；可用于真人语气学习。",
  });
  const result = await service.processInboundMessage({
    externalId: "xiaoshi-verbatim-no-rewrite",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "好贵，我再看看吧",
  });

  assert.equal(calls, 0);
  assert.equal(result.route.suggestedReply, "咱这边预算多少，礼品可以调整");
  assert.equal(result.route.replyDraft.aiAssistance.authority, "reviewed_human_verbatim");
  assert.equal(result.route.replyDraft.aiAssistance.reason, "approved_xiaoshi_verbatim");
  assert.equal(result.route.replyDraft.preserveHumanVerbatim, true);
});

test("reviewed Xiaoshi verbatim question keeps human authority ahead of deterministic clarification", async () => {
  let calls = 0;
  const ai = { generateInboundSuggestion: async () => { calls += 1; throw new Error("must not rewrite reviewed question"); } };
  const { store, service } = setup(ai);
  const imported = store.createChatImport(
    {
      name: "Xiaoshi reviewed budget question",
      text: "客户：中秋送客户呢\n客服：这个伴手礼的预算呢",
      reviewMode: "required",
    },
    {
      messageCount: 2,
      pairCount: 1,
      warnings: [],
      pairs: [{
        question: "中秋送客户呢",
        answer: "这个伴手礼的预算呢",
        scene: "售前转化",
        agentKey: "pre_sales",
        sceneScore: 30,
        matchedKeywords: ["中秋", "送客户"],
        sceneScores: [],
        sceneCheck: { status: "clear", reason: "top_scene_confident", needsReview: false },
        score: 96,
        skillHints: ["小石式单点追问"],
      }],
    },
  );
  store.reviewTrainingSample(imported.samples[0].id, {
    status: "ready",
    reviewer: "test-reviewer",
    note: "已核对为小石脱敏原话；可用于真人语气学习。",
  });

  const result = await service.processInboundMessage({
    externalId: "xiaoshi-reviewed-question-authority",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "中秋送客户呢",
  });

  assert.equal(calls, 0);
  assert.equal(result.route.suggestedReply, "这个伴手礼的预算呢");
  assert.equal(result.route.replyDraft.rag.decision, "use_reviewed_verbatim");
  assert.equal(result.route.replyDraft.aiAssistance.authority, "reviewed_human_verbatim");
  assert.equal(result.route.replyDraft.aiAssistance.reason, "approved_xiaoshi_verbatim");
});

test("basic customer service reply bypasses AI and uses the deterministic Xiaoshi answer", async () => {
  const calls = [];
  const ai = { generateInboundSuggestion: async (input) => { calls.push(input); return { text: "您好，我是臻希智能客服，可以协助您处理礼赠业务咨询。", provider: "demo", model: "demo", attempts: 1 }; } };
  const { service } = setup(ai);
  const result = await service.processInboundMessage({
    externalId: "basic-customer-service-inbound",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "\u4f60\u662f\u8c01\uff1f",
  });
  assert.equal(calls.length, 0);
  assert.equal(result.route.scene, "\u901a\u7528\u95ee\u7b54");
  assert.ok(result.route.matchedKeywords.includes("basic_customer_service:identity"));
  assert.equal(result.route.replyDraft.aiAssistance.used, false);
  assert.equal(result.route.replyDraft.aiAssistance.authority, "deterministic_basic_answer");
  assert.match(result.route.suggestedReply, /\u5c0f\u77f3/);
  assert.equal(result.sendTask.payload.text, result.route.suggestedReply);
});

test("Xiaoshi answers the browsing question before one clarification and suppresses repeated quantity prompts", async () => {
  let calls = 0;
  const ai = { generateInboundSuggestion: async () => { calls += 1; throw new Error("must not run"); } };
  const { service } = setup(ai);
  const result = await service.processInboundMessage({
    externalId: "xiaoshi-deterministic-browsing-question",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "都有哪些款式啊",
  });

  assert.equal(calls, 1);
  assert.equal(result.route.agentKey, "pre_sales");
  assert.deepEqual(result.route.appliedSkills.map((skill) => skill.name), ["小石式单点追问"]);
  assert.equal(result.route.replyDraft.aiAssistance.authority, "deterministic_direct_customer_answer");
  assert.equal(result.route.suggestedReply, "有简约实用、商务礼赠和节日氛围这几类，我先按数量帮您筛。您大概需要多少份呀？");
  assert.equal(result.sendTask.payload.text, result.route.suggestedReply);

  const repeated = await service.processInboundMessage({
    externalId: "xiaoshi-repeated-browsing-question",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "还有哪些款式呀",
  });
  assert.equal(calls, 2);
  assert.equal(repeated.route.replyDraft.aiAssistance.authority, "deterministic_repetition_guard");
  assert.equal(repeated.route.replyDraft.repetitionGuard.reason, "repeated_question_suppressed");
  assert.doesNotMatch(repeated.route.suggestedReply, /多少份|要多少/);
  assert.match(repeated.route.suggestedReply, /先给您看几款合适的/);

  const quantity = await service.processInboundMessage({
    externalId: "xiaoshi-quantity-after-suppressed-repeat",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "10份呀",
  });
  assert.equal(quantity.route.sceneDecision.reason, "customer_field_answered");
  assert.equal(quantity.route.budget.quantity, 10);
  assert.match(quantity.route.suggestedReply, /单份预算/);
  assert.equal(calls, 3);
});

test("Xiaoshi fast conversation path thinks with context instead of replaying fixed copy", async () => {
  const requests = [];
  const ai = {
    generateInboundSuggestion: async (input) => {
      requests.push(input);
      const repeated = input.dialoguePlan?.prohibitedQuestions?.some((item) => item.includes("数量"));
      return {
        text: repeated
          ? "可以，我沿着前面的方向再换几款，先从简约实用和商务礼赠里给您挑。"
          : "款式主要有简约实用、商务礼赠和节日氛围这几个方向。这批大概需要多少份，我好按量帮您挑？",
        provider: "fast-test",
        model: "conversation-test",
        attempts: 1,
        requestedTier: "economy",
        resolvedTier: "economy",
      };
    },
  };
  const { service } = setup(ai);
  const first = await service.processInboundMessage({
    externalId: "xiaoshi-contextual-first",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "都有哪些款式啊",
  });
  const second = await service.processInboundMessage({
    externalId: "xiaoshi-contextual-second",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "还有哪些款式呀",
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].routingHint, "economy");
  assert.equal(requests[0].latencyBudgetMs, 4500);
  assert.equal(requests[0].allowRepair, false);
  assert.match(requests[0].dialoguePlan.objective, /先正面回答客户当前问题/);
  assert.equal(first.route.replyDraft.aiAssistance.authority, "contextual_ai_conversation");
  assert.equal(first.route.replyDraft.aiAssistance.used, true);
  assert.notEqual(first.route.suggestedReply, first.route.replyDraft.ruleSuggestedReply);
  assert.equal(requests[1].conversationHistory.some((item) => item.content.includes("都有哪些款式")), true);
  assert.equal(requests[1].dialoguePlan.prohibitedQuestions.some((item) => item.includes("数量")), true);
  assert.equal(second.route.replyDraft.aiAssistance.authority, "contextual_ai_conversation");
  assert.doesNotMatch(second.route.suggestedReply, /多少份|要多少/);
  assert.notEqual(second.route.suggestedReply, first.route.suggestedReply);
});

test("Xiaoshi stops waiting for a stalled conversation model and keeps a safe quick answer", async () => {
  const ai = {
    generateInboundSuggestion: async () => new Promise(() => {}),
  };
  const { service } = setup(ai);
  const startedAt = Date.now();
  const result = await service.processInboundMessage({
    externalId: "xiaoshi-stalled-conversation-model",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "有现货吗",
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.route.replyDraft.aiAssistance.used, false);
  assert.equal(result.route.replyDraft.aiAssistance.authority, "deterministic_direct_customer_answer");
  assert.equal(result.route.replyDraft.aiAssistance.reason, "conversational_model_timeout");
  assert.equal(result.route.replyDraft.aiAssistance.latencyBudgetMs, 4500);
  assert.equal(result.route.replyDraft.aiAssistance.elapsedMs >= 4500, true);
  assert.equal(elapsedMs < 5200, true);
  assert.match(result.route.suggestedReply, /库存|现货/);
  assert.equal(result.sendTask.payload.text, result.route.suggestedReply);
});

test("Xiaoshi rejects a vague wait message when no follow-up action exists", async () => {
  const ai = {
    generateInboundSuggestion: async () => ({
      text: "好的，我再为您推荐其他款式，请稍等。",
      provider: "fast-test",
      model: "conversation-test",
      attempts: 1,
      requestedTier: "economy",
      resolvedTier: "economy",
    }),
  };
  const { service } = setup(ai);
  const result = await service.processInboundMessage({
    externalId: "xiaoshi-wait-message",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "有现货吗",
  });

  assert.equal(result.route.replyDraft.aiAssistance.used, false);
  assert.equal(result.route.replyDraft.aiAssistance.reason, "unsupported_deferred_followup");
  assert.equal(result.route.replyDraft.aiAssistance.authority, "deterministic_direct_customer_answer");
  assert.doesNotMatch(result.route.suggestedReply, /稍等|稍后/);
});

test("a terse quantity continues the previous Xiaoshi sales question instead of falling back to the generic menu", async () => {
  let calls = 0;
  const ai = { generateInboundSuggestion: async () => { calls += 1; throw new Error("must not run"); } };
  const { store, service } = setup(ai);
  const imported = store.importKnowledgeEntries([{
    title: "售前价格询问与数量追问",
    content: "客户问多少钱、怎么卖、能否优惠或再便宜一点，但没有给采购数量时，先只问数量。推荐短答：您要多少份呀。不要先报历史价格，也不要承诺最低价。",
    agentKey: "pre_sales",
    tags: ["pre_sales", "数量", "询价"],
    qualityScore: 85,
  }], { source: "followup_speed_test" });
  store.reviewKnowledgeEntry(imported.results[0].id, {
    status: "ready",
    reviewer: "test_operator",
    note: "verified test sample",
  });
  await service.processInboundMessage({
    externalId: "xiaoshi-followup-style-question",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "都有哪些款式啊",
  });
  const result = await service.processInboundMessage({
    externalId: "xiaoshi-followup-quantity-answer",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "10份呀",
  });

  assert.equal(calls >= 2, true);
  assert.equal(result.route.agentKey, "pre_sales");
  assert.equal(result.route.sceneDecision.reason, "customer_field_answered");
  assert.equal(result.route.budget.quantity, 10);
  assert.equal(result.route.knowledgeMatches.length > 0, true);
  assert.equal(result.route.suggestedReply, "好呢，10份我记下了，咱单份预算大概多少呢？");
  assert.equal(result.route.replyDraft.aiAssistance.authority, "deterministic_xiaoshi_clarification");
  assert.equal(result.sendTask.payload.text, result.route.suggestedReply);

  const budgetResult = await service.processInboundMessage({
    externalId: "xiaoshi-followup-budget-answer",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "单份20元左右",
  });
  assert.equal(calls >= 2, true);
  assert.equal(budgetResult.route.agentKey, "pre_sales");
  assert.equal(budgetResult.route.sceneDecision.reason, "customer_field_answered");
  assert.equal(budgetResult.route.budget.quantity, 10);
  assert.equal(budgetResult.route.budget.perUnitAmount, 20);
  assert.equal(budgetResult.route.suggestedReply, "10份、单份20元左右收到。咱这个主要是什么场景用呀？");
  assert.equal(budgetResult.route.replyDraft.aiAssistance.authority, "deterministic_xiaoshi_clarification");
  assert.equal(budgetResult.sendTask.payload.text, budgetResult.route.suggestedReply);

  const usageResult = await service.processInboundMessage({
    externalId: "xiaoshi-followup-usage-answer",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "教师节送老师",
  });
  assert.equal(calls >= 2, true);
  assert.equal((usageResult.route.salesContext || usageResult.route.replyDraft.salesContext).usageScene, "教师节送老师");
  assert.equal(usageResult.route.suggestedReply, "教师节送老师，10份、单份20元左右收到。咱偏实用还是氛围感一点？");
  assert.equal(usageResult.route.replyDraft.aiAssistance.authority, "deterministic_xiaoshi_clarification");

  const styleResult = await service.processInboundMessage({
    externalId: "xiaoshi-followup-style-answer",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "实用一点",
  });
  assert.equal(calls >= 2, true);
  const styleSalesContext = styleResult.route.salesContext || styleResult.route.replyDraft.salesContext;
  assert.equal(styleSalesContext.usageScene, "教师节送老师");
  assert.equal(styleSalesContext.stylePreference, "实用");
  assert.equal(Boolean(styleResult.route.replyDraft.catalog.recommendation), true);
  assert.match(styleResult.route.suggestedReply, /教师节送老师/);
  assert.match(styleResult.route.suggestedReply, /偏实用/);
  assert.match(styleResult.route.suggestedReply, /不拿零散配件凑/);
  assert.doesNotMatch(styleResult.route.suggestedReply, /定制贺卡A|祝福卡C/);
  if (styleResult.sendTask) assert.equal(styleResult.sendTask.payload.text, styleResult.route.suggestedReply);

  const newSceneResult = await service.processInboundMessage({
    externalId: "xiaoshi-followup-new-usage-scene",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "另外中秋送客户呢",
  });
  const newSceneContext = newSceneResult.route.salesContext || newSceneResult.route.replyDraft.salesContext;
  assert.equal(calls >= 2, true);
  assert.equal(newSceneResult.route.agentKey, "pre_sales");
  assert.equal(newSceneContext.usageScene, "中秋送客户");
  assert.equal(newSceneContext.stylePreference, null);
  assert.equal(newSceneContext.contextReset, "usage_scene_changed");
  assert.equal(Number(newSceneResult.route.budget.quantity || 0), 0);
  assert.equal(Number(newSceneResult.route.budget.perUnitAmount || 0), 0);
  assert.equal(newSceneResult.route.suggestedReply, "中秋送客户收到，咱大概需要多少份呀？");

  const newSceneStyleResult = await service.processInboundMessage({
    externalId: "xiaoshi-followup-new-scene-style",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "简单一点",
  });
  const newSceneStyleContext = newSceneStyleResult.route.salesContext || newSceneStyleResult.route.replyDraft.salesContext;
  assert.equal(calls >= 2, true);
  assert.equal(newSceneStyleResult.route.agentKey, "pre_sales");
  assert.equal(newSceneStyleContext.usageScene, "中秋送客户");
  assert.equal(newSceneStyleContext.stylePreference, "简约");
  assert.equal(Number(newSceneStyleResult.route.budget.quantity || 0), 0);
  assert.equal(Number(newSceneStyleResult.route.budget.perUnitAmount || 0), 0);
  assert.equal(newSceneStyleResult.route.replyDraft.repetitionGuard.applied, true);
  assert.equal(newSceneStyleResult.route.replyDraft.repetitionGuard.repeatedField, "quantity");
  assert.equal(newSceneStyleResult.route.suggestedReply, "中秋送客户、偏简约我记下了，我先给您看几款合适的，数量确定后再发我就行哈。");
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

test("high-value gift inquiry receives a safe acknowledgement without locking the conversation", async () => {
  let calls = 0;
  const ai = { generateInboundSuggestion: async () => { calls += 1; throw new Error("must not run"); } };
  const { store, service } = setup(ai);
  const result = await service.processInboundMessage({
    externalId: "high-value-safe-acknowledgement",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "我想做20份500元的商务礼盒，有什么建议？",
  });
  assert.equal(calls, 0);
  assert.equal(result.plan.reason, "high_value_safe_acknowledgement");
  assert.equal(result.plan.acknowledgementOnly, true);
  assert.equal(result.sendTask.status, "queued");
  assert.match(result.sendTask.payload.text, /20/);
  assert.match(result.sendTask.payload.text, /500/);
  assert.match(result.sendTask.payload.text, /别把预算全压在单品上/);
  assert.match(result.sendTask.payload.text, /送客户还是员工/);
  assert.doesNotMatch(result.sendTask.payload.text, /我已经记下|再确认三个信息|正式报价/);
  assert.doesNotMatch(result.sendTask.payload.text, /商品库|红金礼盒/);
  assert.equal(result.manualLock, undefined);
  assert.equal(store.listConversations().find((item) => item.id === "conversation_demo_1").manualLocked, false);
  assert.ok(result.notification);
});

test("high-value follow-up inherits prior budget and asks only for the next missing asset", async () => {
  let calls = 0;
  const ai = { generateInboundSuggestion: async () => { calls += 1; throw new Error("must not run"); } };
  const { service } = setup(ai);
  await service.processInboundMessage({
    externalId: "high-value-context-initial",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "我想做20份500元的商务礼盒，有什么建议？",
  });
  const result = await service.processInboundMessage({
    externalId: "high-value-context-follow-up",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "主要送客户，8月30日前，需要 Logo 和贺卡",
  });

  assert.equal(calls, 0);
  assert.equal(result.route.budget.quantity, 20);
  assert.equal(result.route.budget.perUnitAmount, 500);
  assert.equal(result.route.budget.totalAmount, 10000);
  assert.deepEqual(result.route.missingFields, ["customer_assets"]);
  assert.match(result.sendTask.payload.text, /Logo 文件和贺卡文字/);
  assert.doesNotMatch(result.sendTask.payload.text, /预算|数量|我已经记下|再确认三个信息/);
});

test("provider failure keeps the rule draft for review but blocks unpolished auto-send", async () => {
  const ai = { generateInboundSuggestion: async () => { throw new Error("provider unavailable"); } };
  const { service } = setup(ai);
  const result = await service.processInboundMessage({ externalId: "ai-suggestion-provider-fallback", wechatAccountId: "wechat_demo_1", conversationId: "conversation_demo_1", customerId: "customer_demo_1", text: "物流快递单号 456 已停滞两天，请帮我查物流进度" });
  assert.equal(result.route.replyDraft.aiAssistance.used, false);
  assert.equal(result.route.replyDraft.aiAssistance.authority, "rule_fallback");
  assert.equal(result.route.suggestedReply, result.route.replyDraft.ruleSuggestedReply);
  assert.equal(result.plan.shouldQueueReply, false);
  assert.equal(result.plan.shouldNotifyHuman, true);
  assert.equal(result.plan.aiPolishRequired, true);
  assert.match(result.plan.reason, /^ai_polish_required:/);
  assert.equal(result.sendTask, null);
  assert.ok(result.notification);
});

test("manual-takeover conversation can request a fresh AI suggestion without sending it", async () => {
  const calls = [];
  const ai = {
    generateInboundSuggestion: async (input) => {
      calls.push(input);
      return {
        text: "抱歉，前面的回复太重复了；这件事我会交给人工同事核实，确认后给您明确答复。",
        provider: "demo-provider",
        model: "demo-model",
        attempts: 1,
      };
    },
  };
  const { store, service } = setup(ai);
  store.createMessage({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    externalId: "manual-suggestion-history",
    text: "不要每次都回复一样的套话",
  });
  const inbound = await service.processInboundMessage({
    externalId: "manual-suggestion-inbound",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "我要投诉并报警维权",
  });
  assert.equal(calls.length, 0, "high-risk inbound must not call AI automatically");
  assert.equal(inbound.manualLock.conversation.manualLocked, true);

  const suggestion = await service.generateConversationReplySuggestion({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  });

  assert.equal(calls.length, 1, "provider switching belongs inside the AI router; the business layer must not replay the full chain");
  assert.equal(calls[0].requireNaturalRewrite, true);
  assert.equal(calls[0].latencyBudgetMs, 8000);
  assert.ok(calls[0].requiredTerms.includes("人工"));
  assert.ok(calls[0].requiredTerms.includes("抱歉"));
  assert.match(calls[0].nextAction, /反感重复模板/);
  assert.equal(suggestion.suggestedReply, "抱歉，前面的回复太重复了；这件事我会交给人工同事核实，确认后给您明确答复。");
  assert.equal(store.listSendTasks({ conversationId: "conversation_demo_1" }).length, 0);
});

test("catalog facts use AI while preserving verified names and numbers", async () => {
  let calls = 0;
  const ai = { generateInboundSuggestion: async (input) => { calls += 1; return { text: `模型润色：${input.ruleSuggestion}`, provider: "demo", model: "demo", attempts: 1 }; } };
  const { store, service } = setup(ai);
  store.upsertSku({
    skuCode: "BOX-FACT-1",
    name: "事实礼盒",
    type: "gift_box",
    category: "礼盒",
    salePrice: 88,
    costPrice: 50,
    stock: 80,
    leadTimeDays: 5,
    mainImagePath: "C:\\assets\\box-fact-1.png",
    isActive: true,
  });

  const result = await service.processInboundMessage({
    externalId: "catalog-facts-skip-ai",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "事实礼盒多少钱，100套能优惠吗？",
  });

  assert.equal(calls, 1);
  assert.equal(result.route.replyDraft.source, "ai_assisted");
  assert.equal(result.route.replyDraft.aiAssistance.used, true);
  assert.match(result.route.suggestedReply, /事实礼盒/);
  assert.match(result.route.suggestedReply, /88/);
  assert.match(result.route.suggestedReply, /还差 20/);
  assert.equal(result.sendTask.payload.text, result.route.suggestedReply);
});

test("catalog AI output that drops verified facts falls back to the rule reply", async () => {
  let calls = 0;
  const ai = { generateInboundSuggestion: async () => { calls += 1; return { text: "请补充需求", provider: "demo", model: "demo", attempts: 1 }; } };
  const { store, service } = setup(ai);
  store.upsertSku({
    skuCode: "BOX-FACT-GUARD",
    name: "守护礼盒",
    type: "gift_box",
    category: "礼盒",
    salePrice: 66,
    costPrice: 40,
    stock: 50,
    leadTimeDays: 5,
    mainImagePath: "C:\\assets\\box-fact-guard.png",
    isActive: true,
  });

  const result = await service.processInboundMessage({
    externalId: "catalog-facts-ai-guard",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "守护礼盒多少钱？",
  });

  assert.equal(calls, 1);
  assert.equal(result.route.replyDraft.aiAssistance.used, false);
  assert.match(result.route.replyDraft.aiAssistance.reason, /ai_output_dropped_catalog_/);
  assert.equal(result.route.suggestedReply, result.route.replyDraft.ruleSuggestedReply);
  assert.match(result.route.suggestedReply, /守护礼盒/);
  assert.match(result.route.suggestedReply, /66/);
  assert.equal(result.plan.shouldQueueReply, false);
  assert.equal(result.plan.aiPolishRequired, true);
  assert.equal(result.sendTask, null);
});

test("automatic transactional text is rewritten by AI and keeps verified facts", async () => {
  const calls = [];
  const ai = {
    generateInboundSuggestion: async (input) => {
      calls.push(input);
      return {
        text: "订单 20260812 已发货，顺丰单号 SF123456，路上有新进展我也会继续帮您盯着。",
        provider: "demo-provider",
        model: "demo-model",
        attempts: 1,
      };
    },
  };
  const { service } = setup(ai);
  const task = await service.enqueueTextMessage({
    operationKey: "ai-transactional-text-20260812",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "订单 20260812 已发货，顺丰单号 SF123456。",
    reason: "order-followup",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].requireNaturalRewrite, true);
  assert.ok(calls[0].requiredTerms.includes("20260812"));
  assert.ok(calls[0].requiredTerms.includes("SF123456"));
  assert.ok(calls[0].requiredTerms.includes("已发货"));
  assert.ok(calls[0].requiredTerms.includes("顺丰"));
  assert.match(task.payload.text, /继续帮您盯着/);
  assert.equal(task.payload.aiRewrite.required, true);
  assert.equal(task.payload.aiRewrite.provider, "demo-provider");
});

test("automatic transactional replay reuses the first AI copy without a second model call", async () => {
  let calls = 0;
  const ai = {
    generateInboundSuggestion: async () => {
      calls += 1;
      return { text: "这笔 88 元的款已经收到了，我这边接着为您安排。", provider: "demo", model: "demo", attempts: 1 };
    },
  };
  const { service } = setup(ai);
  const payload = {
    operationKey: "ai-transactional-replay",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "已收款 88 元，继续安排。",
    reason: "payment-confirmation",
  };
  const first = await service.enqueueTextMessage(payload);
  const replay = await service.enqueueTextMessage(payload);

  assert.equal(calls, 1);
  assert.equal(replay.id, first.id);
  assert.equal(replay.payload.text, first.payload.text);
});

test("automatic transactional text fails closed when AI polishing is unavailable", async () => {
  const ai = { generateInboundSuggestion: async () => { throw new Error("provider unavailable"); } };
  const { service } = setup(ai);
  await assert.rejects(
    () => service.enqueueTextMessage({
      operationKey: "ai-transactional-fail-closed",
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
      text: "订单已进入生产。",
      reason: "order-followup",
    }),
    /AI 润色失败，自动回复已停止入队/,
  );
  assert.equal(service.localStore?.listSendTasks?.().some((item) => item.operationKey === "ai-transactional-fail-closed") || false, false);
});

test("manual operator reply is not rewritten by AI", async () => {
  let calls = 0;
  const ai = { generateInboundSuggestion: async () => { calls += 1; throw new Error("must not run"); } };
  const { service } = setup(ai);
  const task = await service.enqueueTextMessage({
    operationKey: "manual-text-skips-ai",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text: "这是人工客服已经确认好的回复。",
    reason: "manual-agent-reply",
    manualReply: true,
    queuedBy: "operator-test",
  });

  assert.equal(calls, 0);
  assert.equal(task.payload.text, "这是人工客服已经确认好的回复。");
  assert.equal(task.payload.aiRewrite, undefined);
});
