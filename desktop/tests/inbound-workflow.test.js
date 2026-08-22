"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildInboundReplyText, planInboundAutomation, planZhenxiCustomerRequest } = require("../packages/rules");

test("routes a production-ready poster request to exactly four Zhenxi image candidates", () => {
  const zhenxiRequest = planZhenxiCustomerRequest({
    text: "帮我做一套七夕活动海报设计，画面只包含文案“七夕有礼”，不放Logo，尺寸1080x1440",
  });
  assert.equal(zhenxiRequest.kind, "image");
  assert.equal(zhenxiRequest.designRequests[0].copyModule, "poster_copy");
  assert.equal(zhenxiRequest.designRequests[0].outputCount, 4);
  assert.equal(zhenxiRequest.designRequests[0].size, "1080x1440");
  assert.equal(zhenxiRequest.designRequests[0].ratio, "3:4");
  assert.equal(zhenxiRequest.designRequests[0].visualContentMode, "graphic_only");
  assert.equal(zhenxiRequest.designRequests[0].exactCopyOnly, true);
  assert.equal(zhenxiRequest.designRequests[0].copyText, "七夕有礼");

  const plan = planInboundAutomation({
    route: { action: "collect_info", agentKey: "gift_design", riskFlags: [] },
    zhenxiRequest,
  });
  assert.equal(plan.reason, "customer_creative_ready");
  assert.equal(plan.shouldCreateDesignJob, true);
  assert.match(buildInboundReplyText({}, plan), /4 条文案方案/);
  assert.match(buildInboundReplyText({}, plan), /4 张设计图/);
});

test("requires real references when a Zhenxi request must preserve supplied identity", () => {
  const zhenxiRequest = planZhenxiCustomerRequest({ text: "用我们产品图和Logo做4张小红书封面图", assetIds: [] });
  assert.equal(zhenxiRequest.kind, "image");
  assert.equal(zhenxiRequest.referenceRequired, true);
  assert.equal(zhenxiRequest.missingReference, true);
  const plan = planInboundAutomation({ route: { action: "collect_info", agentKey: "gift_design" }, zhenxiRequest });
  assert.equal(plan.reason, "zhenxi_reference_required");
  assert.equal(plan.shouldCreateDesignJob, false);
  assert.match(buildInboundReplyText({}, plan), /真实的产品、Logo/);
});

test("routes the exact text-only recommendation request without creating a design job", () => {
  const zhenxiRequest = planZhenxiCustomerRequest({
    text: "酒店开业伴手礼要100份，单份预算20元左右，有哪些可以做？只回复文字建议，不要出图。",
  });
  const plan = planInboundAutomation({
    route: {
      action: "auto_agent",
      agentKey: "gift_design",
      suggestedReply: "20元左右可以先看实用小件，我按100份帮您核现货和包装。",
    },
    assetIds: ["asset-real-product"],
    bundleRecommendation: { items: [{ skuCode: "GIFT-20", imageUrl: "https://assets.example.test/gift.png" }] },
    zhenxiRequest,
  });

  assert.equal(zhenxiRequest.kind, "cancel");
  assert.equal(zhenxiRequest.reason, "explicit_image_generation_declined");
  assert.equal(plan.shouldCreateDesignJob, false);
  assert.equal(plan.shouldQueueReply, true);
  assert.equal(plan.reason, "explicit_image_generation_declined");
});

test("routes every Zhenxi copy module to a durable copy job", () => {
  const cases = [
    ["写一份活动海报文案", "poster_copy"],
    ["帮我写一篇小红书种草文案", "xiaohongshu"],
    ["写商品详情页卖点文案", "detail_page"],
    ["写一份30秒短视频口播脚本", "video_script"],
  ];
  for (const [text, module] of cases) {
    const zhenxiRequest = planZhenxiCustomerRequest({ text });
    assert.equal(zhenxiRequest.kind, "copy");
    assert.equal(zhenxiRequest.module, module);
    const plan = planInboundAutomation({ route: { action: "collect_info", agentKey: "gift_design" }, zhenxiRequest });
    assert.equal(plan.type, "create_zhenxi_copy_job");
    assert.equal(plan.shouldCreateZhenxiCopyJob, true);
  }
});

test("a Zhenxi status query can reply on a manual route without creating a new design job", () => {
  const zhenxiRequest = planZhenxiCustomerRequest({
    text: "生成好了吗",
    previousPlan: {
      kind: "clarify",
      module: "customer_creative",
      planId: "customer-creative:status-routing-1",
      requestedDeliverables: ["greeting_card"],
      missingFields: ["copy_text"],
    },
  });
  const plan = planInboundAutomation({
    route: {
      action: "manual_review",
      agentKey: "general",
      routingPolicy: { lane: "manual_review", manualRequired: true, canQueueAutoReply: false },
    },
    zhenxiRequest,
  });

  assert.equal(zhenxiRequest.kind, "status");
  assert.equal(plan.type, "queue_reply");
  assert.equal(plan.reason, "zhenxi_status_not_started");
  assert.equal(plan.shouldQueueReply, true);
  assert.equal(plan.shouldCreateDesignJob, false);
  assert.equal(plan.shouldCreateZhenxiCopyJob, false);
  assert.match(buildInboundReplyText({}, plan), /还没有开始生成/);
});

test("business risk disabled routes high value manual route to smart reply", () => {
  const plan = planInboundAutomation({
    route: {
      action: "manual_review",
      isHighValue: true,
      agentKey: "gift_design",
      suggestedReply: "这个金额需要人工核对后再报价。",
      routingPolicy: {
        lane: "high_value_human",
        valueTier: "high",
        handler: "human",
        manualRequired: true,
        canQueueAutoReply: false,
        safeguards: ["human_approval_required"],
      },
    },
  });

  assert.equal(plan.type, "queue_reply");
  assert.equal(plan.reason, "business_risk_disabled_auto_reply");
  assert.equal(plan.shouldNotifyHuman, false);
  assert.equal(plan.shouldQueueReply, true);
  assert.equal(plan.shouldLockConversation, false);
  assert.equal(plan.businessRiskControlsDisabled, true);
  assert.equal(plan.acknowledgementOnly, undefined);
  assert.equal(plan.routingPolicy.lane, "business_risk_disabled_agent");
  assert.equal(plan.routingPolicy.canQueueAutoReply, true);
  assert.equal(plan.routingPolicy.manualRequired, false);
  assert.equal(plan.routingPolicy.safeguards.includes("human_approval_required"), false);
  const reply = buildInboundReplyText({ suggestedReply: "这个金额需要人工核对后再报价。" }, plan);
  assert.doesNotMatch(reply, /人工|转人工/);
});

test("manual lock no longer stops smart customer-service automation", () => {
  const plan = planInboundAutomation({
    conversationManualLocked: true,
    route: { action: "auto_agent", agentKey: "gift_design", missingFields: [] },
    assetIds: ["asset_logo"],
    bundleRecommendation: { items: [{ skuCode: "BOX-A" }, { skuCode: "TEA-A" }] },
  });

  assert.equal(plan.type, "create_design_job");
  assert.equal(plan.reason, "complete_gift_design_request");
  assert.equal(plan.shouldNotifyHuman, false);
  assert.equal(plan.shouldQueueReply, true);
  assert.equal(plan.shouldCreateDesignJob, true);
});

test("queues a safe clarification for low-risk manual review during employee testing", () => {
  const plan = planInboundAutomation({
    internalTestAutoReply: true,
    route: {
      action: "manual_review",
      agentKey: "general",
      isHighValue: false,
      riskFlags: [],
      routingPolicy: {
        lane: "manual_review",
        manualRequired: true,
        canQueueAutoReply: false,
      },
    },
  });

  assert.equal(plan.type, "queue_reply");
  assert.equal(plan.reason, "business_risk_disabled_auto_reply");
  assert.equal(plan.shouldQueueReply, true);
  assert.equal(plan.internalTestOverride, undefined);
  assert.equal(plan.shouldNotifyHuman, false);
  assert.equal(plan.businessRiskControlsDisabled, true);
  assert.match(buildInboundReplyText({}, plan), /继续处理|补问/);
});

test("business risk disabled keeps employee testing on smart replies for risky routes", () => {
  const highValuePlan = planInboundAutomation({
    internalTestAutoReply: true,
    route: { action: "manual_review", isHighValue: true, riskFlags: [] },
  });
  assert.equal(highValuePlan.reason, "business_risk_disabled_auto_reply");
  assert.equal(highValuePlan.internalTestOverride, undefined);
  assert.equal(highValuePlan.acknowledgementOnly, undefined);
  assert.equal(highValuePlan.shouldNotifyHuman, false);
  assert.equal(highValuePlan.businessRiskControlsDisabled, true);

  for (const route of [
    { action: "manual_review", isHighValue: false, riskFlags: ["payment_claim"] },
    {
      action: "manual_review",
      isHighValue: false,
      riskFlags: [],
      routingPolicy: { lane: "risk_human", manualRequired: true },
    },
  ]) {
    const plan = planInboundAutomation({ internalTestAutoReply: true, route });
    assert.equal(plan.type, "queue_reply");
    assert.equal(plan.shouldQueueReply, true);
    assert.equal(plan.shouldNotifyHuman, false);
    assert.equal(plan.shouldLockConversation, false);
    assert.equal(plan.reason, "business_risk_disabled_auto_reply");
    assert.equal(plan.businessRiskControlsDisabled, true);
  }
});

test("business risk disabled lets customer creative tools bypass risk review", () => {
  const creativeRequest = planZhenxiCustomerRequest({
    text: "做一张贺卡，文案写“感谢一路相伴”，不放logo，尺寸90x54mm",
    requestContextId: "creative-routing-safety-1",
  });
  const safePlan = planInboundAutomation({
    route: {
      action: "manual_review",
      riskFlags: ["unverified_catalog_data"],
      routingPolicy: { lane: "manual_review", manualRequired: true, canQueueAutoReply: false },
    },
    zhenxiRequest: creativeRequest,
  });
  assert.equal(safePlan.reason, "customer_creative_ready");
  assert.equal(safePlan.shouldCreateDesignJob, true);

  const riskyPlan = planInboundAutomation({
    route: {
      action: "manual_review",
      riskFlags: ["payment_claim"],
      routingPolicy: { lane: "risk_human", manualRequired: true, canQueueAutoReply: false },
    },
    zhenxiRequest: creativeRequest,
  });
  assert.equal(riskyPlan.type, "create_design_job");
  assert.equal(riskyPlan.shouldQueueReply, true);
  assert.equal(riskyPlan.shouldNotifyHuman, false);
  assert.equal(riskyPlan.shouldCreateDesignJob, true);
});

test("does not create gift design job without real asset ids", () => {
  const plan = planInboundAutomation({
    route: { action: "auto_agent", agentKey: "gift_design", missingFields: [] },
    assetIds: [],
    bundleRecommendation: { items: [{ skuCode: "BOX-A" }] },
  });

  assert.equal(plan.type, "queue_reply");
  assert.equal(plan.reason, "missing_real_customer_assets");
  assert.equal(plan.shouldCreateDesignJob, false);
});

test("separates scene clarification from normal missing info", () => {
  const plan = planInboundAutomation({
    route: {
      action: "collect_info",
      agentKey: "pre_sales",
      missingFields: ["scene_clarification"],
      routingPolicy: {
        lane: "scene_clarification",
        handler: "agent",
        canAskClarification: true,
        canQueueAutoReply: false,
        safeguards: ["ask_before_answering_uncertain_scene"],
      },
    },
  });

  assert.equal(plan.type, "queue_reply");
  assert.equal(plan.reason, "scene_clarification_required");
  assert.equal(plan.shouldQueueReply, true);
  assert.equal(plan.routingPolicy.lane, "scene_clarification");
  assert.equal(plan.routingPolicy.canAskClarification, true);
});

test("creates gift design job only when bundle and real assets exist", () => {
  const plan = planInboundAutomation({
    route: {
      action: "auto_agent",
      agentKey: "gift_design",
      missingFields: [],
      routingPolicy: {
        lane: "low_value_agent",
        valueTier: "standard",
        handler: "agent",
        manualRequired: false,
        canQueueAutoReply: true,
        safeguards: ["wechat_send_guard_required"],
      },
    },
    assetIds: ["asset_logo"],
    bundleRecommendation: { items: [{ skuCode: "BOX-A" }, { skuCode: "TEA-A" }] },
  });

  assert.equal(plan.type, "create_design_job");
  assert.equal(plan.shouldCreateDesignJob, true);
  assert.equal(plan.shouldQueueReply, true);
  assert.equal(plan.routingPolicy.lane, "low_value_agent");
  assert.equal(plan.routingPolicy.canQueueAutoReply, true);
});

test("business risk disabled still creates gift design job when recommended bundle is not automation ready", () => {
  const plan = planInboundAutomation({
    route: { action: "auto_agent", agentKey: "gift_design", missingFields: [] },
    assetIds: ["asset_logo"],
    bundleRecommendation: {
      items: [{ skuCode: "BOX-A" }, { skuCode: "TEA-A" }],
      automation: { ready: false, blockers: ["low_margin", "size_unknown"] },
    },
  });

  assert.equal(plan.type, "create_design_job");
  assert.equal(plan.reason, "complete_gift_design_request_business_risk_disabled");
  assert.equal(plan.shouldNotifyHuman, false);
  assert.equal(plan.shouldCreateDesignJob, true);
  assert.equal(plan.businessRiskControlsDisabled, true);
  assert.deepEqual(plan.blockers, ["low_margin", "size_unknown"]);
});

test("appends real asset request to reply when assets are missing", () => {
  const text = buildInboundReplyText(
    { suggestedReply: "可以的，我先帮您整理方案。" },
    { reason: "missing_real_customer_assets" },
  );

  assert.match(text, /真实素材/);
  assert.match(text, /Logo/);
});
