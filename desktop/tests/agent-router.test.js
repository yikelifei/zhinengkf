"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateAgentRoute, findPendingSceneClarificationContext } = require("../packages/rules");

test("routes complete low-value gift design request to gift design agent", () => {
  const result = evaluateAgentRoute({
    text: "端午员工福利礼盒，每盒180元，做50份，想看真实摆拍效果图，logo已发",
  });

  assert.equal(result.agentKey, "gift_design");
  assert.equal(result.scene, "礼盒设计");
  assert.equal(result.action, "auto_agent");
  assert.equal(result.isHighValue, false);
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
  assert.equal(result.missingFields.includes("budget"), true);
  assert.equal(result.missingFields.includes("quantity"), true);
});

test("routes high-value request to manual review", () => {
  const result = evaluateAgentRoute({
    text: "企业伴手礼总预算20000元，做100份，想看礼盒设计和效果图",
  });

  assert.equal(result.agentKey, "gift_design");
  assert.equal(result.action, "manual_review");
  assert.equal(result.isHighValue, true);
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
  assert.equal(result.sceneDecision.secondaryScene.agentKey, "after_sales");
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
  assert.equal(result.missingFields.includes("scene_clarification"), true);
  assert.equal(result.sceneClarification.type, "confirm_scene");
  assert.match(result.sceneClarification.question, /售前咨询/);
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
  assert.equal(result.sceneDecision.reason, "route_correction_memory");
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

  assert.equal(result.agentKey, "after_sales");
  assert.equal(result.sceneDecision.reason, "customer_scene_clarified");
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

test("routes logistics exception with tracking info to logistics agent", () => {
  const result = evaluateAgentRoute({
    text: "我的订单快递一直不动，单号SF123，帮我看一下",
  });

  assert.equal(result.agentKey, "logistics_exception");
  assert.equal(result.action, "auto_agent");
  assert.equal(result.missingFields.includes("order_or_tracking"), false);
});

test("routes size request to size recommendation agent", () => {
  const result = evaluateAgentRoute({
    text: "我身高165cm，体重50kg，这件衣服尺码怎么选",
  });

  assert.equal(result.agentKey, "size_recommendation");
  assert.equal(result.action, "auto_agent");
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
