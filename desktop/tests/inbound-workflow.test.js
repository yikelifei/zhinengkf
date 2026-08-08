"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildInboundReplyText, planInboundAutomation } = require("../packages/rules");

test("plans manual review for high value route", () => {
  const plan = planInboundAutomation({
    route: {
      action: "manual_review",
      isHighValue: true,
      agentKey: "gift_design",
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

  assert.equal(plan.type, "manual_review");
  assert.equal(plan.reason, "high_value_customer");
  assert.equal(plan.shouldNotifyHuman, true);
  assert.equal(plan.shouldQueueReply, false);
  assert.equal(plan.routingPolicy.lane, "high_value_human");
  assert.equal(plan.routingPolicy.canQueueAutoReply, false);
});

test("keeps manually locked conversation out of automation", () => {
  const plan = planInboundAutomation({
    conversationManualLocked: true,
    route: { action: "auto_agent", agentKey: "gift_design", missingFields: [] },
    assetIds: ["asset_logo"],
    bundleRecommendation: { items: [{ skuCode: "BOX-A" }, { skuCode: "TEA-A" }] },
  });

  assert.equal(plan.type, "manual_locked");
  assert.equal(plan.reason, "conversation_manual_locked");
  assert.equal(plan.shouldNotifyHuman, true);
  assert.equal(plan.shouldQueueReply, false);
  assert.equal(plan.shouldCreateDesignJob, false);
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
  assert.equal(plan.reason, "internal_test_safe_reply");
  assert.equal(plan.shouldQueueReply, true);
  assert.equal(plan.internalTestOverride, true);
  assert.equal(plan.shouldNotifyHuman, false);
  assert.match(buildInboundReplyText({}, plan), /补充/);
});

test("employee testing never overrides high-value or risky manual review", () => {
  for (const route of [
    { action: "manual_review", isHighValue: true, riskFlags: [] },
    { action: "manual_review", isHighValue: false, riskFlags: ["payment_claim"] },
    {
      action: "manual_review",
      isHighValue: false,
      riskFlags: [],
      routingPolicy: { lane: "risk_human", manualRequired: true },
    },
  ]) {
    const plan = planInboundAutomation({ internalTestAutoReply: true, route });
    assert.equal(plan.type, "manual_review");
    assert.equal(plan.shouldQueueReply, false);
  }
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

test("sends gift design request to manual review when recommended bundle is not automation ready", () => {
  const plan = planInboundAutomation({
    route: { action: "auto_agent", agentKey: "gift_design", missingFields: [] },
    assetIds: ["asset_logo"],
    bundleRecommendation: {
      items: [{ skuCode: "BOX-A" }, { skuCode: "TEA-A" }],
      automation: { ready: false, blockers: ["low_margin", "size_unknown"] },
    },
  });

  assert.equal(plan.type, "manual_review");
  assert.equal(plan.reason, "bundle_automation_not_ready");
  assert.equal(plan.shouldNotifyHuman, true);
  assert.equal(plan.shouldCreateDesignJob, false);
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
