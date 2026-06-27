"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildInboundReplyText, planInboundAutomation } = require("../packages/rules");

test("plans manual review for high value route", () => {
  const plan = planInboundAutomation({
    route: { action: "manual_review", isHighValue: true, agentKey: "gift_design" },
  });

  assert.equal(plan.type, "manual_review");
  assert.equal(plan.shouldNotifyHuman, true);
  assert.equal(plan.shouldQueueReply, false);
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
    route: { action: "collect_info", agentKey: "pre_sales", missingFields: ["scene_clarification"] },
  });

  assert.equal(plan.type, "queue_reply");
  assert.equal(plan.reason, "scene_clarification_required");
  assert.equal(plan.shouldQueueReply, true);
});

test("creates gift design job only when bundle and real assets exist", () => {
  const plan = planInboundAutomation({
    route: { action: "auto_agent", agentKey: "gift_design", missingFields: [] },
    assetIds: ["asset_logo"],
    bundleRecommendation: { items: [{ skuCode: "BOX-A" }, { skuCode: "TEA-A" }] },
  });

  assert.equal(plan.type, "create_design_job");
  assert.equal(plan.shouldCreateDesignJob, true);
  assert.equal(plan.shouldQueueReply, true);
});

test("appends real asset request to reply when assets are missing", () => {
  const text = buildInboundReplyText(
    { suggestedReply: "可以的，我先帮您整理方案。" },
    { reason: "missing_real_customer_assets" },
  );

  assert.match(text, /真实素材/);
  assert.match(text, /Logo/);
});
