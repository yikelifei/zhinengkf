"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classifyTrainingSampleUsage,
  classifyTrainingSampleAttention,
  classifySkillSuggestionQuality,
  compileAgentSkillSuggestions,
  evaluateTrainingSampleQuality,
  isSceneClarificationReply,
  isSkillSuggestionSafeToApply,
  isTrainingSampleNeedingAttention,
  isTrainingSampleReady,
  normalizeTrainingSampleStatus,
  summarizeTrainingSamples,
  trainingSampleReviewNote,
} = require("../packages/rules");

test("compiles high-score training samples into skill suggestions", () => {
  const suggestions = compileAgentSkillSuggestions([
    {
      id: "sample_1",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "每盒 200 元，想看带 logo 的礼盒效果图",
      idealReply: "可以的，我先按您的预算和用途搭配礼盒，再整理几版真实摆拍效果图给您挑。",
      score: 86,
      skillHints: ["预算澄清", "设计需求确认"],
    },
    {
      id: "sample_2",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "总预算 1 万，100 份，能先看图吗",
      idealReply: "可以，我先帮您折算到每份预算，再把适合的搭配和效果图方向一起确认。",
      score: 82,
      skillHints: ["预算澄清"],
    },
  ]);

  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0].name, "预算澄清");
  assert.equal(suggestions[0].suggestionKey, "agent_gift_design::预算澄清");
  assert.equal(suggestions[0].sampleCount, 2);
  assert.equal(suggestions[0].action, "create");
  assert.equal(suggestions[0].confidence > 70, true);
});

test("matches mojibake skill hints to existing readable skill names", () => {
  const suggestions = compileAgentSkillSuggestions(
    [
      {
        id: "sample_1",
        agentId: "agent_gift_design",
        agentKey: "gift_design",
        scene: "gift",
        customerText: "budget and render",
        idealReply: "reply",
        score: 90,
        skillHints: ["棰勭畻婢勬竻"],
      },
    ],
    {
      existingSkills: [
        {
          id: "skill_1",
          agentId: "agent_gift_design",
          name: "预算澄清",
        },
      ],
    },
  );

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].name, "预算澄清");
  assert.equal(suggestions[0].existingSkillId, "skill_1");
  assert.equal(suggestions[0].action, "update");
});

test("classifies skill suggestion quality before applying skills", () => {
  const suggestions = compileAgentSkillSuggestions([
    {
      id: "sample_1",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "每盒 200 元，想看礼盒效果图",
      idealReply: "可以，我先按预算确认搭配，再给您整理几版真实摆拍效果图。",
      score: 96,
      status: "ready",
      skillHints: ["预算澄清"],
    },
    {
      id: "sample_2",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "总预算 1 万，100 份，先看图",
      idealReply: "可以，我先折算每份预算，再把搭配和效果图方向一起确认。",
      score: 94,
      status: "ready",
      skillHints: ["预算澄清"],
    },
    {
      id: "sample_3",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "logo 已发，想看效果图",
      idealReply: "可以，我会把 logo 和产品图一起纳入效果图需求。",
      score: 92,
      status: "ready",
      skillHints: ["设计需求确认"],
    },
  ]);

  const safe = suggestions.find((suggestion) => suggestion.name === "预算澄清");
  const needsReview = suggestions.find((suggestion) => suggestion.name === "设计需求确认");

  assert.equal(safe.quality.level, "safe");
  assert.equal(isSkillSuggestionSafeToApply(safe), true);
  assert.equal(needsReview.quality.needsReview, true);
  assert.match(classifySkillSuggestionQuality(needsReview).reason, /低于 2 条/);
});

test("compiles scene clarification replies only as anti-wrong-reply skill", () => {
  const genericReply = "我先确认一下，您是想让我先处理「售前咨询/商品推荐」这个方向吗？如果是订单、售后、物流或设计图，也可以直接告诉我重点。";
  const suggestions = compileAgentSkillSuggestions([
    {
      id: "sample_route_1",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "推荐一下",
      idealReply: genericReply,
      score: 95,
      status: "ready",
      sourceType: "route_correction",
      skillHints: ["设计需求确认", "物流安抚", "高情商话术"],
    },
    {
      id: "sample_route_2",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "你帮我看看",
      idealReply: genericReply,
      score: 92,
      status: "ready",
      sourceType: "route_correction",
      skillHints: ["售后方案", "高情商话术"],
    },
  ]);

  assert.equal(isSceneClarificationReply(genericReply), true);
  assert.deepEqual(suggestions.map((suggestion) => suggestion.name), ["防乱回复"]);
  assert.equal(suggestions[0].sampleCount, 2);
});

test("detects choose-scene clarification replies", () => {
  assert.equal(
    isSceneClarificationReply("这条消息同时像「下单支付/发票地址」和「售后退款/破损补发」。为避免回错，我先确认一下：您现在最想先处理哪一件？"),
    true,
  );
});

test("labels training sample quality for review and anti-wrong-reply samples", () => {
  const antiWrongReply = evaluateTrainingSampleQuality({
    status: "ready",
    score: 95,
    idealReply: "我先确认一下，您是想让我先处理「售前咨询/商品推荐」这个方向吗？如果是订单、售后、物流或设计图，也可以直接告诉我重点。",
    skillHints: ["物流安抚", "高情商话术"],
  });
  const normal = evaluateTrainingSampleQuality({
    status: "ready",
    score: 88,
    idealReply: "可以的，我先按您的预算和用途搭配礼盒，再整理几版真实产品摆拍效果图给您挑。",
    skillHints: ["预算澄清"],
  });
  const lowScore = evaluateTrainingSampleQuality({
    status: "ready",
    score: 62,
    idealReply: "可以的",
    skillHints: ["预算澄清"],
  });

  assert.equal(antiWrongReply.label, "防乱回复样本");
  assert.equal(antiWrongReply.trainable, true);
  assert.deepEqual(antiWrongReply.flags, ["scene_clarification_reply", "anti_wrong_reply_only"]);
  assert.match(antiWrongReply.recommendedAction, /防乱回复/);
  assert.equal(normal.level, "safe");
  assert.match(normal.recommendedAction, /Skill/);
  assert.equal(lowScore.level, "risk");
  assert.equal(lowScore.trainable, false);
  assert.match(lowScore.recommendedAction, /重写/);
});

test("classifies training sample usage for scene routing and reply skills", () => {
  const routeAndReply = evaluateTrainingSampleQuality({
    status: "ready",
    sourceType: "chat_import",
    agentKey: "after_sales",
    scene: "售后安抚",
    customerText: "杯子破了怎么处理",
    idealReply: "我先帮您核对破损情况，再给您补发或退款方案。",
    score: 92,
    skillHints: ["售后方案"],
  });
  const replyOnly = classifyTrainingSampleUsage({
    status: "ready",
    sourceType: "chat_import",
    agentKey: "after_sales",
    scene: "售后安抚",
    customerText: "杯子坏了",
    idealReply: "我先帮您处理。",
    score: 78,
    skillHints: ["售后方案"],
  });
  const uncertainScene = evaluateTrainingSampleQuality({
    status: "ready",
    sourceType: "chat_import",
    agentKey: "after_sales",
    scene: "after_sales",
    sceneScore: 8,
    sceneCheck: { status: "weak", reason: "only_weak_scene_signal", needsReview: true },
    customerText: "cup issue",
    idealReply: "I can help confirm the issue first and then give the next step.",
    score: 95,
    skillHints: ["after sales"],
  });
  const blocked = classifyTrainingSampleUsage({
    status: "review",
    sourceType: "chat_import",
    agentKey: "after_sales",
    scene: "售后安抚",
    customerText: "杯子坏了",
    idealReply: "我先帮您处理。",
    score: 96,
    skillHints: ["售后方案"],
  });

  assert.equal(routeAndReply.usage.scope, "route_and_reply");
  assert.equal(routeAndReply.usage.routeMemory, true);
  assert.equal(routeAndReply.usage.replySkill, true);
  assert.equal(replyOnly.scope, "reply_only");
  assert.equal(replyOnly.routeMemory, false);
  assert.equal(replyOnly.replySkill, true);
  assert.equal(uncertainScene.usage.scope, "reply_only");
  assert.equal(uncertainScene.usage.routeMemory, false);
  assert.equal(uncertainScene.usage.replySkill, true);
  assert.equal(uncertainScene.usage.flags.includes("scene_weak"), true);
  assert.equal(uncertainScene.attention.needsAttention, true);
  assert.equal(uncertainScene.attention.primaryReason.code, "scene_weak");
  assert.equal(blocked.scope, "review");
  assert.equal(blocked.routeMemory, false);
});

test("ignores low quality samples", () => {
  const suggestions = compileAgentSkillSuggestions([
    {
      id: "sample_low",
      agentId: "agent_after_sales",
      agentKey: "after_sales",
      scene: "售后",
      customerText: "坏了",
      idealReply: "不知道",
      score: 30,
      skillHints: ["售后方案"],
    },
  ]);

  assert.equal(suggestions.length, 0);
});

test("uses only ready samples for skill suggestions", () => {
  const suggestions = compileAgentSkillSuggestions([
    {
      id: "sample_ready",
      agentId: "agent_after_sales",
      agentKey: "after_sales",
      scene: "售后",
      customerText: "坏了怎么处理",
      idealReply: "我先帮您核对破损情况，再给您补发或退款方案。",
      score: 90,
      status: "ready",
      skillHints: ["售后方案"],
    },
    {
      id: "sample_review",
      agentId: "agent_after_sales",
      agentKey: "after_sales",
      scene: "售后",
      customerText: "差评了",
      idealReply: "高分但还没复核",
      score: 96,
      status: "review",
      skillHints: ["售后方案"],
    },
    {
      id: "sample_rejected",
      agentId: "agent_after_sales",
      agentKey: "after_sales",
      scene: "售后",
      customerText: "乱回复",
      idealReply: "高分但已禁用",
      score: 99,
      status: "rejected",
      skillHints: ["售后方案"],
    },
  ]);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].sampleCount, 1);
  assert.deepEqual(suggestions[0].sampleIds, ["sample_ready"]);
});

test("keeps legacy samples without status eligible for skill suggestions", () => {
  const suggestions = compileAgentSkillSuggestions([
    {
      id: "sample_legacy",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "每盒200看图",
      idealReply: "可以，我先帮您确认预算和效果图方向。",
      score: 90,
      skillHints: ["预算澄清"],
    },
  ]);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].sampleCount, 1);
});

test("summarizes rejected samples separately", () => {
  const overview = summarizeTrainingSamples([
    {
      id: "sample_rejected",
      agentId: "agent_after_sales",
      agentKey: "after_sales",
      scene: "售后",
      customerText: "不要进入训练",
      idealReply: "禁用",
      score: 92,
      status: "rejected",
      skillHints: ["售后方案"],
    },
  ]);

  assert.equal(overview.totalSamples, 1);
  assert.equal(overview.readySamples, 0);
  assert.equal(overview.rejectedSamples, 1);
  assert.equal(overview.byAgent[0].rejectedCount, 1);
});

test("summarizes training sample quality buckets", () => {
  const overview = summarizeTrainingSamples([
    {
      id: "sample_safe",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "每盒200看效果图",
      idealReply: "可以，我先按预算给您搭配礼盒，再整理几版真实摆拍效果图。",
      score: 88,
      status: "ready",
      skillHints: ["预算澄清"],
    },
    {
      id: "sample_guard",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "推荐一下",
      idealReply: "我先确认一下，您是想让我先处理「售前咨询/商品推荐」这个方向吗？如果是订单、售后、物流或设计图，也可以直接告诉我重点。",
      score: 95,
      status: "ready",
      skillHints: ["防乱回复"],
    },
    {
      id: "sample_low",
      agentId: "agent_after_sales",
      agentKey: "after_sales",
      scene: "售后",
      customerText: "坏了",
      idealReply: "不知道",
      score: 40,
      status: "ready",
      skillHints: ["售后方案"],
    },
    {
      id: "sample_rejected",
      agentId: "agent_after_sales",
      agentKey: "after_sales",
      scene: "售后",
      customerText: "别训练",
      idealReply: "已禁用",
      score: 90,
      status: "rejected",
      skillHints: ["售后方案"],
    },
  ]);

  assert.equal(overview.qualitySummary.safeSamples, 1);
  assert.equal(overview.qualitySummary.reviewQualitySamples, 1);
  assert.equal(overview.qualitySummary.riskSamples, 1);
  assert.equal(overview.qualitySummary.blockedSamples, 1);
  assert.equal(overview.qualitySummary.trainableSamples, 2);
  assert.equal(overview.qualitySummary.antiWrongReplySamples, 1);
  assert.equal(overview.qualitySummary.routeMemorySamples, 0);
  assert.equal(overview.qualitySummary.replySkillSamples, 1);
  assert.equal(overview.qualitySummary.routeAndReplySamples, 0);
  assert.equal(overview.qualitySummary.needsAttentionSamples, 1);
  assert.deepEqual(overview.qualitySummary.attentionReasonCounts, [{ code: "low_score", label: "低分", count: 1 }]);
  assert.equal(overview.qualitySummary.lowScoreSamples, 1);
  assert.equal(overview.recommendations.some((text) => text.includes("防乱回复")), true);
});

test("identifies training samples that need operator attention", () => {
  assert.equal(
    isTrainingSampleNeedingAttention({
      status: "ready",
      quality: {
        level: "risk",
        trainable: false,
        flags: ["low_score"],
        usage: { scope: "reply_only", replySkill: true },
      },
    }),
    true,
  );
  assert.equal(
    isTrainingSampleNeedingAttention({
      status: "ready",
      quality: {
        level: "review",
        trainable: true,
        flags: ["anti_wrong_reply_only"],
        usage: { scope: "anti_wrong_reply", antiWrongReply: true },
      },
    }),
    false,
  );
  assert.equal(
    isTrainingSampleNeedingAttention({
      status: "rejected",
      quality: {
        level: "blocked",
        trainable: false,
        flags: ["rejected"],
        usage: { scope: "none" },
      },
    }),
    false,
  );
  const attention = classifyTrainingSampleAttention({
    status: "ready",
    quality: {
      level: "risk",
      trainable: false,
      flags: ["missing_answer", "missing_customer_text"],
      usage: { scope: "none", flags: ["missing_answer", "missing_customer_text"] },
    },
  });
  assert.equal(attention.needsAttention, true);
  assert.deepEqual(
    attention.reasons.map((reason) => reason.code),
    ["missing_answer", "missing_customer_text", "usage_none"],
  );
});

test("normalizes training sample review status for local store", () => {
  assert.equal(normalizeTrainingSampleStatus("ready"), "ready");
  assert.equal(normalizeTrainingSampleStatus("rejected"), "rejected");
  assert.throws(() => normalizeTrainingSampleStatus("unknown"), /unsupported training sample status/);
  assert.equal(isTrainingSampleReady({ status: "ready" }), true);
  assert.equal(isTrainingSampleReady({ status: "review" }), false);
  assert.match(trainingSampleReviewNote("rejected"), /禁用/);
});

test("summarizes route correction samples for skill training", () => {
  const samples = [
    {
      id: "sample_correction",
      agentId: "agent_after_sales",
      agentKey: "after_sales",
      scene: "售后退款",
      customerText: "这个能退吗",
      idealReply: "我先帮您确认订单状态，再给您退款处理方案。",
      score: 95,
      status: "ready",
      sourceType: "route_correction",
      skillHints: ["售后方案"],
      createdAt: "2026-06-26T08:00:00.000Z",
    },
    {
      id: "sample_import",
      importId: "import_1",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "每盒200看效果图",
      idealReply: "可以，我先按预算给您搭配礼盒，再出效果图。",
      score: 88,
      status: "ready",
      skillHints: ["预算澄清", "设计需求确认"],
      createdAt: "2026-06-26T07:00:00.000Z",
    },
    {
      id: "sample_review",
      agentId: "agent_gift_design",
      agentKey: "gift_design",
      scene: "礼盒设计",
      customerText: "随便做",
      idealReply: "不知道",
      score: 50,
      status: "review",
      skillHints: [],
      createdAt: "2026-06-26T06:00:00.000Z",
    },
  ];
  const suggestions = compileAgentSkillSuggestions(samples);
  const overview = summarizeTrainingSamples(
    samples,
    [
      { id: "agent_after_sales", key: "after_sales", name: "售后退款与退换货 Agent", scene: "售后退款" },
      { id: "agent_gift_design", key: "gift_design", name: "礼盒设计 Agent", scene: "礼盒设计" },
    ],
    suggestions,
  );

  assert.equal(overview.totalSamples, 3);
  assert.equal(overview.correctionSamples, 1);
  assert.equal(overview.chatImportSamples, 1);
  assert.equal(overview.reviewSamples, 1);
  assert.equal(overview.topCorrectionScenes[0].scene, "售后退款");
  assert.equal(overview.byAgent.find((agent) => agent.agentKey === "after_sales").correctionCount, 1);
  assert.equal(overview.recommendations.some((text) => text.includes("场景纠错样本")), true);
});
