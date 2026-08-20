"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateAgentRoute,
  findPendingFieldQuestionContext,
  findPendingSceneClarificationContext,
} = require("../packages/rules");

test("routes basic customer service questions to direct low-risk answers", () => {
  const cases = [
    ["你是谁？", "identity", /我是小石/],
    ["你可以做什么？", "capabilities", /商品和礼盒推荐/],
    ["你背后是什么模型？", "model", /AI 模型/],
    ["这个客服怎么用？", "usage", /直接描述需求/],
    ["你好", "greeting", /在的，您说/],
    ["[微笑]", "greeting", /在的，您说/],
    ["你只会说这一句吗？", "repetition_feedback", /太像模板/],
    ["不要每次都回一样的话好吗", "repetition_feedback", /太像模板/],
    ["客服回复太机械了，没有人味", "repetition_feedback", /按前面的内容往下聊/],
    ["现在的对话消息很假", "repetition_feedback", /太像模板/],
  ];

  for (const [text, intent, answerPattern] of cases) {
    const result = evaluateAgentRoute({ text });
    assert.equal(result.agentKey, "general", text);
    assert.equal(result.scene, "通用问答", text);
    assert.equal(result.basicIntent, intent, text);
    assert.equal(result.action, "auto_agent", text);
    assert.equal(result.routingPolicy.lane, "low_value_agent", text);
    assert.equal(result.routingPolicy.canQueueAutoReply, true, text);
    assert.equal(result.manualRequired, false, text);
    assert.match(result.suggestedReply, answerPattern, text);
  }
});

test("routes natural product-style browsing questions into Xiaoshi pre-sales", () => {
  for (const text of ["都有哪些款式啊", "有哪几款？", "发几个款我看看"]) {
    const result = evaluateAgentRoute({ text });
    assert.equal(result.agentKey, "pre_sales", text);
    assert.equal(result.scene, "售前转化", text);
    assert.notEqual(result.action, "manual_review", text);
    assert.ok(result.matchedKeywords.length > 0, text);
  }
});

test("keeps sensitive wording on manual review even when it contains a basic question", () => {
  const result = evaluateAgentRoute({ text: "你是谁？我要投诉并要求赔偿" });

  assert.equal(result.basicIntent, "identity");
  assert.equal(result.action, "manual_review");
  assert.equal(result.routingPolicy.lane, "risk_human");
  assert.equal(result.routingPolicy.canQueueAutoReply, false);
});

test("routes complete low-value gift design request to gift design agent", () => {
  const result = evaluateAgentRoute({
    text: "端午员工福利礼盒，每盒180元，做50份，想看真实摆拍效果图，logo已发",
  });

  assert.equal(result.agentKey, "gift_design");
  assert.equal(result.scene, "礼盒设计");
  assert.equal(result.action, "auto_agent");
  assert.equal(result.isHighValue, false);
  assert.equal(result.routingPolicy.lane, "low_value_agent");
  assert.equal(result.routingPolicy.handler, "agent");
  assert.equal(result.routingPolicy.valueTier, "standard");
  assert.equal(result.routingPolicy.canQueueAutoReply, true);
  assert.equal(result.routingPolicy.manualRequired, false);
  assert.equal(result.routingPolicy.safeguards.includes("wechat_send_guard_required"), true);
  assert.ok(result.sceneScore > 0);
  assert.ok(result.matchedKeywords.includes("礼盒"));
  assert.ok(result.sceneScores[0].agentKey === "gift_design");
});

test("asks for missing info before gift design automation", () => {
  const result = evaluateAgentRoute({
    text: "我想做礼盒效果图",
  });

  assert.equal(result.agentKey, "gift_design");
  assert.equal(result.action, "collect_info");
  assert.equal(result.routingPolicy.lane, "info_collection");
  assert.equal(result.routingPolicy.canAskClarification, true);
  assert.equal(result.routingPolicy.canQueueAutoReply, true);
  assert.equal(result.missingFields.includes("budget"), true);
  assert.equal(result.missingFields.includes("quantity"), true);
});

test("routes card redesign with box size to gift design agent", () => {
  const result = evaluateAgentRoute({
    text: "再设计一下这个卡片，盒子是 15*15*6的",
  });

  assert.equal(result.agentKey, "gift_design");
  assert.equal(result.scene, "礼盒设计");
  assert.equal(result.sceneDecision.status, "clear");
  assert.equal(result.action, "auto_agent");
  assert.equal(result.routingPolicy.canQueueAutoReply, true);
  assert.equal(result.missingFields.includes("scene_clarification"), false);
  assert.ok(result.matchedKeywords.includes("卡片"));
  assert.ok(result.matchedKeywords.includes("盒子是"));
  assert.ok(result.matchedKeywords.includes("再设计"));
  assert.match(result.suggestedReply, /卡片可以重新调整/);
  assert.match(result.suggestedReply, /盒子尺寸/);
  assert.match(result.suggestedReply, /不乱改/);
});

test("routes greeting-card requirement update directly without asking gift box fields", () => {
  const result = evaluateAgentRoute({
    text: "尺寸是盒子的尺寸，图片里面是方形的贺卡，也就是1：1的尺寸，主题颜色是紫色",
  });

  assert.equal(result.agentKey, "gift_design");
  assert.equal(result.action, "auto_agent");
  assert.deepEqual(result.missingFields, []);
  assert.match(result.suggestedReply, /盒子尺寸只作为包装适配参考/);
  assert.match(result.suggestedReply, /贺卡按 1:1 正方形处理/);
  assert.match(result.suggestedReply, /主题色用紫色/);
  assert.doesNotMatch(result.suggestedReply, /预算|数量|用途/);
});

test("routes high-value request to manual review", () => {
  const result = evaluateAgentRoute({
    text: "企业伴手礼总预算20000元，做100份，想看礼盒设计和效果图",
  });

  assert.equal(result.agentKey, "gift_design");
  assert.equal(result.action, "manual_review");
  assert.equal(result.isHighValue, true);
  assert.equal(result.routingPolicy.lane, "high_value_human");
  assert.equal(result.routingPolicy.handler, "human");
  assert.equal(result.routingPolicy.valueTier, "high");
  assert.equal(result.routingPolicy.canQueueAutoReply, false);
  assert.equal(result.routingPolicy.manualRequired, true);
  assert.equal(result.routingPolicy.safeguards.includes("human_approval_required"), true);
  assert.equal(result.routingPolicy.safeguards.includes("price_image_and_order_manual_review"), true);
});

test("keeps weak high-value pre-sales inquiry on deterministic acknowledgement path", () => {
  const result = evaluateAgentRoute({
    text: "我想做20份500元的商务礼盒，有什么建议？",
  });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.sceneDecision.status, "weak");
  assert.equal(result.isHighValue, true);
  assert.equal(result.action, "manual_review");
  assert.equal(result.routingPolicy.lane, "high_value_human");
  assert.equal(result.routingPolicy.manualRequired, true);
});

test("treats a named companion-gift product complaint as clear pre-sales", () => {
  const result = evaluateAgentRoute({
    text: "扩香石这三个不是很好看呢",
  });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.sceneDecision.status, "clear");
  assert.equal(result.action, "auto_agent");
  assert.deepEqual(result.missingFields, []);
});

test("routes Xiaoshi batch-two price and style phrases to pre-sales", () => {
  for (const text of ["再便宜点", "这款怎么卖的", "好贵，我再看看吧", "这个笔记本太可爱了", "不定了，班费有点拮据"]) {
    const result = evaluateAgentRoute({ text });
    assert.equal(result.agentKey, "pre_sales", text);
    assert.equal(result.sceneDecision.status, "clear", text);
  }
});

test("routes order and payment request to order payment agent", () => {
  const result = evaluateAgentRoute({
    text: "我已经付定金了，订单能不能改地址并开发票",
  });

  assert.equal(result.agentKey, "order_payment");
  assert.equal(result.scene, "下单支付");
  assert.equal(result.action, "auto_agent");
  assert.equal(result.matchedKeywords.includes("订单"), true);
  assert.equal(result.matchedKeywords.includes("定金"), true);
});

test("marks mixed order and after-sales request as ambiguous manual review", () => {
  const result = evaluateAgentRoute({
    text: "订单破损要退款，还能改地址开发票吗",
  });

  assert.equal(result.sceneDecision.status, "ambiguous");
  assert.equal(result.action, "manual_review");
  assert.equal(result.missingFields.includes("scene_clarification"), true);
  assert.deepEqual(
    new Set([result.sceneDecision.topScene.agentKey, result.sceneDecision.secondaryScene.agentKey]),
    new Set(["order_payment", "after_sales"]),
  );
  assert.equal(result.sceneClarification.type, "choose_scene");
  assert.match(result.sceneClarification.question, /下单支付/);
  assert.match(result.sceneClarification.question, /售后/);
});

test("asks for clarification when only weak scene signal is detected", () => {
  const result = evaluateAgentRoute({
    text: "推荐一下",
  });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.sceneDecision.status, "weak");
  assert.equal(result.action, "collect_info");
  assert.equal(result.routingPolicy.lane, "scene_clarification");
  assert.equal(result.routingPolicy.canAskClarification, true);
  assert.equal(result.routingPolicy.canQueueAutoReply, true);
  assert.equal(result.routingPolicy.safeguards.includes("ask_before_answering_uncertain_scene"), true);
  assert.equal(result.missingFields.includes("scene_clarification"), true);
  assert.equal(result.sceneClarification.type, "confirm_scene");
  assert.match(result.sceneClarification.question, /售前咨询/);
});

test("low-risk unmatched messages clarify twice before manual review", () => {
  const first = evaluateAgentRoute({ text: "天梯奖" });
  assert.equal(first.agentKey, "general");
  assert.equal(first.sceneDecision.status, "unmatched");
  assert.equal(first.action, "collect_info");
  assert.equal(first.routingPolicy.lane, "scene_clarification");
  assert.equal(first.routingPolicy.canAskClarification, true);
  assert.equal(first.routingPolicy.canQueueAutoReply, true);
  assert.equal(first.sceneClarification.attempt, 1);
  assert.match(first.sceneClarification.question, /商品咨询/);

  const second = evaluateAgentRoute({ text: "就是这个", clarificationContext: first });
  assert.equal(second.action, "collect_info");
  assert.equal(second.sceneClarification.attempt, 2);
  assert.equal(second.sceneClarification.type, "describe_scene_retry");
  assert.notEqual(second.sceneClarification.question, first.sceneClarification.question);
  assert.match(second.sceneClarification.question, /一句话描述/);

  const third = evaluateAgentRoute({ text: "还是这个", clarificationContext: second });
  assert.equal(third.clarificationExhausted, true);
  assert.equal(third.sceneClarification, null);
  assert.equal(third.action, "manual_review");
  assert.equal(third.routingPolicy.manualRequired, true);
});

test("uses route correction memory for repeated scene routing", () => {
  const result = evaluateAgentRoute(
    {
      text: "杯子破了怎么处理",
    },
    {
      sceneMemory: [
        {
          id: "sample_after_sales_memory",
          sourceType: "route_correction",
          status: "ready",
          score: 95,
          agentKey: "after_sales",
          scene: "售后安抚",
          customerText: "杯子破了怎么处理",
          sourceRouteId: "route_old",
        },
      ],
    },
  );

  assert.equal(result.agentKey, "after_sales");
  assert.equal(result.scene, "售后安抚");
  assert.equal(result.sceneDecision.status, "clear");
  assert.equal(result.sceneDecision.reason, "route_correction_memory_boost");
  assert.equal(result.sceneMemory.applied, true);
  assert.equal(result.sceneMemory.sampleId, "sample_after_sales_memory");
  assert.equal(result.matchedKeywords.includes("route_correction_memory"), true);
  assert.equal(result.sceneAudit.evidence.some((item) => item.includes("route correction memory")), true);
});

test("uses high quality chat import memory only when the match is strong", () => {
  const result = evaluateAgentRoute(
    {
      text: "陶瓷杯裂了怎么办",
    },
    {
      sceneMemory: [
        {
          id: "sample_chat_import_memory",
          sourceType: "chat_import",
          status: "ready",
          score: 92,
          agentKey: "after_sales",
          scene: "售后安抚",
          customerText: "陶瓷杯裂了怎么办",
          importId: "import_1",
          quality: { level: "pass", trainable: true },
        },
      ],
    },
  );

  assert.equal(result.agentKey, "after_sales");
  assert.equal(result.sceneMemory.applied, true);
  assert.equal(result.sceneMemory.sourceType, "chat_import");
  assert.equal(result.sceneMemory.importId, "import_1");
  assert.equal(result.matchedKeywords.includes("chat_import_memory"), true);
});

test("does not use chat import memory before it is confirmed trainable", () => {
  const result = evaluateAgentRoute(
    {
      text: "cup broken refund help",
    },
    {
      sceneMemory: [
        {
          id: "sample_chat_import_review",
          sourceType: "chat_import",
          status: "review",
          score: 95,
          agentKey: "after_sales",
          scene: "售后安抚",
          customerText: "cup broken refund help",
          quality: { level: "review", trainable: false, flags: ["manual_review_required"] },
        },
      ],
    },
  );

  assert.equal(result.agentKey, "general");
  assert.equal(result.sceneMemory, null);
  assert.equal(result.matchedKeywords.includes("chat_import_memory"), false);
});

test("does not use chat import scene memory when imported scene judgement is uncertain", () => {
  const result = evaluateAgentRoute(
    {
      text: "cup broken refund help",
    },
    {
      sceneMemory: [
        {
          id: "sample_chat_import_weak_scene",
          sourceType: "chat_import",
          status: "ready",
          score: 96,
          agentKey: "after_sales",
          scene: "鍞悗瀹夋姎",
          sceneScore: 8,
          sceneCheck: { status: "weak", reason: "only_weak_scene_signal", needsReview: true },
          customerText: "cup broken refund help",
          quality: { level: "safe", trainable: true, usage: { routeMemory: true } },
        },
      ],
    },
  );

  assert.equal(result.agentKey, "general");
  assert.equal(result.sceneMemory, null);
  assert.equal(result.matchedKeywords.includes("chat_import_memory"), false);
});

test("uses chat import scene memory after human confirms the imported scene", () => {
  const result = evaluateAgentRoute(
    {
      text: "cup broken refund help",
    },
    {
      sceneMemory: [
        {
          id: "sample_chat_import_confirmed_scene",
          sourceType: "chat_import",
          status: "ready",
          score: 96,
          agentKey: "after_sales",
          scene: "鍞悗瀹夋姎",
          sceneScore: 8,
          sceneCheck: { status: "clear", reason: "human_confirmed_scene", needsReview: false },
          customerText: "cup broken refund help",
          quality: { level: "safe", trainable: true, usage: { routeMemory: true } },
        },
      ],
    },
  );

  assert.equal(result.agentKey, "after_sales");
  assert.equal(result.sceneMemory.applied, true);
  assert.equal(result.sceneMemory.reason, "chat_import_memory");
  assert.equal(result.matchedKeywords.includes("chat_import_memory"), true);
});

test("resolves customer clarification reply to after-sales scene", () => {
  const previous = evaluateAgentRoute({
    text: "订单破损要退款，还能改地址开发票吗",
  });
  const result = evaluateAgentRoute({
    text: "先处理退款",
    clarificationContext: previous,
  });

  assert.equal(result.agentKey, "after_sales");
  assert.equal(result.scene, "售后安抚");
  assert.equal(result.sceneDecision.status, "clear");
  assert.equal(result.sceneDecision.reason, "customer_scene_clarified");
  assert.equal(result.clarificationResolution.agentKey, "after_sales");
  assert.equal(result.missingFields.includes("scene_clarification"), false);
});

test("resolves weak-scene follow-up clarification to order payment", () => {
  const previous = evaluateAgentRoute({
    text: "推荐一下",
  });
  const result = evaluateAgentRoute({
    text: "我是问发票",
    clarificationContext: previous,
  });

  assert.equal(result.agentKey, "order_payment");
  assert.equal(result.sceneDecision.reason, "customer_scene_clarified");
  assert.equal(result.action, "auto_agent");
  assert.equal(result.missingFields.includes("scene_clarification"), false);
});

test("resolves ordinal scene option selection", () => {
  const previous = evaluateAgentRoute({
    text: "订单破损要退款，还能改地址开发票吗",
  });
  const result = evaluateAgentRoute({
    text: "第二个",
    clarificationContext: previous,
  });

  assert.equal(result.agentKey, previous.sceneClarification.options[1].agentKey);
  assert.equal(result.sceneDecision.reason, "customer_scene_clarified");
});

test("resolves a named pre-sales clarification option", () => {
  const previous = {
    sceneDecision: { status: "ambiguous" },
    sceneClarification: {
      required: true,
      type: "choose_scene",
      options: [
        { agentKey: "pre_sales", scene: "售前转化", label: "售前咨询/商品推荐" },
        { agentKey: "gift_design", scene: "礼盒设计", label: "礼盒设计/效果图" },
      ],
    },
  };
  const result = evaluateAgentRoute({
    text: "售前咨询。",
    clarificationContext: previous,
  });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.sceneDecision.status, "clear");
  assert.equal(result.sceneDecision.reason, "customer_scene_clarified");
});

test("routes damaged gift boxes to after-sales instead of gift design", () => {
  const result = evaluateAgentRoute({
    text: "收到的礼盒破损了，怎么处理？",
  });

  assert.equal(result.agentKey, "after_sales");
  assert.equal(result.sceneDecision.status, "clear");
  assert.equal(result.action, "auto_agent");
  assert.equal(result.sceneClarification, null);
});

test("allows a high-value pre-sales catalog reply while keeping the final quote manual", () => {
  const result = evaluateAgentRoute({
    text: "我想买100份员工礼盒，每份预算150元，有什么推荐？",
  });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.isHighValue, true);
  assert.equal(result.action, "auto_agent");
  assert.equal(result.routingPolicy.lane, "high_value_guided_reply");
  assert.equal(result.routingPolicy.safeguards.includes("catalog_facts_only"), true);
  assert.equal(result.routingPolicy.safeguards.includes("final_quote_manual_review"), true);
});

test("does not mistake an order quantity for a unit price", () => {
  const result = evaluateAgentRoute({
    text: "这个礼盒多少钱，100套能优惠吗？",
  });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.budget.quantity, 100);
  assert.equal(result.budget.perUnitAmount, null);
  assert.equal(result.budget.totalAmount, null);
  assert.equal(result.isHighValue, false);
});

test("inherits recent gift budget while treating a delivery date as a date", () => {
  const result = evaluateAgentRoute(
    { text: "主要送客户，8月30日前，需要 Logo 和贺卡" },
    {
      budgetContext: {
        mode: "per_box",
        quantity: 20,
        perUnitAmount: 500,
        totalAmount: 10000,
        confidence: "high",
        sourceAgentKey: "gift_design",
      },
    },
  );

  assert.equal(result.agentKey, "gift_design");
  assert.equal(result.budget.quantity, 20);
  assert.equal(result.budget.perUnitAmount, 500);
  assert.equal(result.budget.totalAmount, 10000);
  assert.deepEqual(result.missingFields, ["customer_assets"]);
  assert.equal(result.isHighValue, true);
});

test("keeps an explicit product combination and stock request in pre-sales", () => {
  const result = evaluateAgentRoute({
    text: "我想买100份员工福利礼盒，每份预算150元，请直接推荐商品组合和库存情况。",
  });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.sceneDecision.status, "clear");
  assert.equal(result.action, "auto_agent");
  assert.equal(result.routingPolicy.lane, "high_value_guided_reply");
});

test("uses only latest unresolved scene clarification as context", () => {
  const pending = {
    id: "route_pending",
    conversationId: "conv_1",
    createdAt: "2026-06-26T10:00:00.000Z",
    sceneClarification: { required: true, type: "choose_scene" },
  };
  const resolved = {
    id: "route_resolved",
    conversationId: "conv_1",
    createdAt: "2026-06-26T10:01:00.000Z",
    sceneClarification: null,
    clarificationResolution: { agentKey: "after_sales" },
  };
  const clearRoute = {
    id: "route_clear",
    conversationId: "conv_1",
    createdAt: "2026-06-26T10:02:00.000Z",
    sceneDecision: { status: "clear" },
    sceneClarification: null,
  };

  assert.equal(findPendingSceneClarificationContext([pending], "conv_1"), pending);
  assert.equal(findPendingSceneClarificationContext([pending, resolved], "conv_1"), null);
  assert.equal(findPendingSceneClarificationContext([pending, clearRoute], "conv_1"), null);
});

test("treats a terse quantity as the answer to Xiaoshi's previous quantity question", () => {
  const previous = {
    id: "route_quantity_question",
    conversationId: "conv_followup",
    createdAt: "2026-08-15T09:00:00.000Z",
    agentKey: "pre_sales",
    scene: "售前咨询",
    action: "auto_agent",
    riskFlags: [],
    suggestedReply: "款式挺多的，我先按数量给您筛，您大概需要多少份呀？",
  };
  const followupContext = findPendingFieldQuestionContext([previous], "conv_followup");
  const result = evaluateAgentRoute({ text: "10份呀", followupContext });

  assert.equal(followupContext.requestedField, "quantity");
  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.sceneDecision.reason, "customer_field_answered");
  assert.equal(result.followupResolution.requestedField, "quantity");
  assert.equal(result.budget.quantity, 10);
  assert.equal(result.action, "auto_agent");
  assert.equal(result.sceneClarification, null);
});

test("does not let a pending sales question override a clear after-sales request", () => {
  const result = evaluateAgentRoute({
    text: "我要退款，订单里的礼盒破损了",
    followupContext: {
      requestedField: "quantity",
      agentKey: "pre_sales",
      scene: "售前咨询",
      question: "您要多少份呀",
    },
  });

  assert.equal(result.agentKey, "after_sales");
  assert.equal(result.followupResolution, null);
});

test("keeps a quantity correction in the sales conversation even when Xiaoshi had asked for budget", () => {
  const result = evaluateAgentRoute({
    text: "12份呀",
    followupContext: {
      requestedField: "budget",
      agentKey: "pre_sales",
      scene: "售前转化",
      question: "10份收到，咱单份预算大概多少呢？",
    },
    budgetContext: {
      sourceAgentKey: "pre_sales",
      quantity: 10,
    },
  });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.sceneDecision.reason, "customer_field_answered");
  assert.equal(result.followupResolution.expectedField, "budget");
  assert.equal(result.followupResolution.requestedField, "quantity");
  assert.equal(result.budget.quantity, 12);
});

test("recognizes Xiaoshi's natural alternative wording as a pending budget question", () => {
  const previous = {
    id: "route_natural_budget_question",
    conversationId: "conv_natural_budget",
    createdAt: new Date().toISOString(),
    agentKey: "pre_sales",
    scene: "售前咨询",
    action: "auto_agent",
    riskFlags: [],
    suggestedReply: "12份记下了，咱单份大概想控制在多少钱呢？",
  };

  const context = findPendingFieldQuestionContext([previous], "conv_natural_budget");
  assert.equal(context.requestedField, "budget");
});

test("inherits quantity when the customer answers Xiaoshi's natural budget question", () => {
  const result = evaluateAgentRoute({
    text: "单份20元左右",
    followupContext: {
      requestedField: "budget",
      agentKey: "pre_sales",
      scene: "售前咨询",
      question: "12份记下了，咱单份大概想控制在多少钱呢？",
    },
    budgetContext: { sourceAgentKey: "pre_sales", quantity: 12 },
  });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.sceneDecision.reason, "customer_field_answered");
  assert.equal(result.budget.quantity, 12);
  assert.equal(result.budget.perUnitAmount, 20);
  assert.equal(result.salesContext.currentField, "budget");
});

test("keeps usage and style answers in the same sales context", () => {
  const usage = evaluateAgentRoute(
    { text: "教师节送老师" },
    { budgetContext: { sourceAgentKey: "pre_sales", quantity: 12, perUnitAmount: 20 } },
  );
  assert.equal(usage.agentKey, "pre_sales");
  assert.equal(usage.salesContext.usageScene, "教师节送老师");
  assert.equal(usage.salesContext.currentField, "usage_scene");

  const style = evaluateAgentRoute({
    text: "实用一点",
    followupContext: {
      requestedField: "style_preference",
      agentKey: "pre_sales",
      scene: "售前咨询",
      question: "咱偏实用还是氛围感一点？",
    },
  }, {
    budgetContext: { sourceAgentKey: "pre_sales", quantity: 12, perUnitAmount: 20 },
    salesContext: usage.salesContext,
  });
  assert.equal(style.agentKey, "pre_sales");
  assert.equal(style.sceneDecision.reason, "customer_field_answered");
  assert.equal(style.salesContext.usageScene, "教师节送老师");
  assert.equal(style.salesContext.stylePreference, "实用");
  assert.equal(style.salesContext.currentField, "style_preference");
});

test("starts a fresh requirement when the customer changes the usage scene", () => {
  const result = evaluateAgentRoute({
    text: "另外中秋送客户呢",
  }, {
    budgetContext: { sourceAgentKey: "pre_sales", quantity: 12, perUnitAmount: 20 },
    salesContext: { usageScene: "教师节送老师", stylePreference: "实用" },
  });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.salesContext.usageScene, "中秋送客户");
  assert.equal(result.salesContext.stylePreference, null);
  assert.equal(result.salesContext.contextReset, "usage_scene_changed");
  assert.equal(Number(result.budget.quantity || 0), 0);
  assert.equal(Number(result.budget.perUnitAmount || 0), 0);
});

test("keeps explicitly supplied quantity and budget when changing usage scene", () => {
  const result = evaluateAgentRoute({
    text: "另外中秋送客户，还是30份，单份25元",
  }, {
    budgetContext: { sourceAgentKey: "pre_sales", quantity: 12, perUnitAmount: 20 },
    salesContext: { usageScene: "教师节送老师", stylePreference: "实用" },
  });

  assert.equal(result.salesContext.usageScene, "中秋送客户");
  assert.equal(result.salesContext.stylePreference, null);
  assert.equal(result.salesContext.contextReset, "usage_scene_changed");
  assert.equal(result.budget.quantity, 30);
  assert.equal(result.budget.perUnitAmount, 25);
});

test("translates a rejected cute style into a positive simple preference", () => {
  const result = evaluateAgentRoute({ text: "不要这款笔记本，太可爱了" });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.salesContext.stylePreference, "简约");
  assert.ok(result.salesContext.currentFields.includes("style_preference"));
});

test("keeps terse alternative-product requests in the active sales conversation", () => {
  const result = evaluateAgentRoute({ text: "还有别的吗" }, {
    budgetContext: { sourceAgentKey: "pre_sales", quantity: 12, perUnitAmount: 20 },
    salesContext: { usageScene: "教师节送老师", stylePreference: "简约" },
  });

  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.sceneDecision.reason, "top_scene_confident");
  assert.ok(result.matchedKeywords.includes("conversation:sales_followup"));
  assert.equal(result.salesContext.usageScene, "教师节送老师");
  assert.equal(result.salesContext.stylePreference, "简约");
  assert.deepEqual(result.salesContext.currentFields, []);
});

test("routes logistics exception with tracking info to logistics agent", () => {
  const result = evaluateAgentRoute({
    text: "我的订单快递一直不动，单号SF123，帮我看一下",
  });

  assert.equal(result.agentKey, "logistics_exception");
  assert.equal(result.action, "auto_agent");
  assert.equal(result.missingFields.includes("order_or_tracking"), false);
});

test("does not create a standalone size recommendation lane", () => {
  const result = evaluateAgentRoute({
    text: "我身高165cm，体重50kg，这件衣服尺码怎么选",
  });

  assert.equal(result.agentKey, "general");
  assert.equal(result.action, "collect_info");
  assert.equal(result.sceneDecision.status, "unmatched");
});

test("routes sensitive after-sales complaint to manual review", () => {
  const result = evaluateAgentRoute({
    text: "我要投诉，东西破损还不给赔偿",
  });

  assert.equal(result.agentKey, "after_sales");
  assert.equal(result.action, "manual_review");
  assert.equal(result.riskFlags.length > 0, true);
});

test("explains clear scene audit for gift design routing", () => {
  const result = evaluateAgentRoute({
    text: "端午员工福利礼盒，每盒180元，做50份，想看真实摆拍效果图，logo已发",
  });

  assert.equal(result.agentKey, "gift_design");
  assert.equal(result.action, "auto_agent");
  assert.equal(result.sceneAudit.level, "pass");
  assert.equal(result.sceneAudit.label, "场景清晰");
  assert.match(result.sceneAudit.summary, /礼盒设计/);
  assert.match(result.sceneAudit.nextStep, /智能体/);
  assert.equal(result.sceneAudit.warnings.length, 0);
});

test("explains ambiguous scene audit before routing to manual review", () => {
  const result = evaluateAgentRoute({
    text: "订单破损要退款，还能改地址开发票吗",
  });

  assert.equal(result.sceneDecision.status, "ambiguous");
  assert.equal(result.action, "manual_review");
  assert.equal(result.sceneAudit.level, "manual");
  assert.match(result.sceneAudit.summary, /同时像/);
  assert.match(result.sceneAudit.nextStep, /场景确认/);
  assert.equal(result.sceneAudit.warnings.some((warning) => warning.includes("避免把 A 场景当成 B 场景")), true);
});
