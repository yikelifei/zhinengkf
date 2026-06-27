"use strict";

function planInboundAutomation(input = {}) {
  const route = input.route || {};
  const assetIds = normalizeList(input.assetIds);
  const bundle = input.bundleRecommendation || null;

  if (input.conversationManualLocked || route.conversationManualLocked) {
    return {
      type: "manual_locked",
      reason: "conversation_manual_locked",
      shouldQueueReply: false,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: true,
    };
  }

  if (route.action === "manual_review") {
    return {
      type: "manual_review",
      reason: route.isHighValue ? "high_value_customer" : "risk_or_unclear_route",
      shouldQueueReply: false,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: true,
    };
  }

  if (route.action === "collect_info") {
    const needsSceneClarification = (route.missingFields || []).includes("scene_clarification");
    return {
      type: "queue_reply",
      reason: needsSceneClarification ? "scene_clarification_required" : "missing_required_info",
      shouldQueueReply: true,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: false,
      missingFields: route.missingFields || [],
    };
  }

  if (route.agentKey === "gift_design" && route.action === "auto_agent") {
    if (!assetIds.length) {
      return {
        type: "queue_reply",
        reason: "missing_real_customer_assets",
        shouldQueueReply: true,
        shouldCreateDesignJob: false,
        shouldNotifyHuman: false,
        missingFields: ["customer_assets"],
      };
    }

    if (!bundle?.items?.length) {
      return {
        type: "manual_review",
        reason: "bundle_recommendation_empty",
        shouldQueueReply: false,
        shouldCreateDesignJob: false,
        shouldNotifyHuman: true,
      };
    }

    return {
      type: "create_design_job",
      reason: "complete_gift_design_request",
      shouldQueueReply: true,
      shouldCreateDesignJob: true,
      shouldNotifyHuman: false,
    };
  }

  if (route.action === "auto_agent") {
    return {
      type: "queue_reply",
      reason: "agent_reply",
      shouldQueueReply: true,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: false,
    };
  }

  return {
    type: "manual_review",
    reason: "fallback_unknown_route",
    shouldQueueReply: false,
    shouldCreateDesignJob: false,
    shouldNotifyHuman: true,
  };
}

function buildInboundReplyText(route = {}, plan = {}) {
  const base = String(route.suggestedReply || "").trim();
  if (plan.reason === "missing_real_customer_assets") {
    const suffix = "另外效果图必须使用真实素材，麻烦您把 Logo、参考图或产品图发我一下，我收到后再开始整理效果图，避免图片和实际商品不一致。";
    return base ? `${base}\n${suffix}` : suffix;
  }
  return base || "收到，我先帮您整理关键信息，再给您明确的下一步。";
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => (typeof item === "string" ? item : item?.id || item?.assetId)).filter(Boolean).map(String))];
}

module.exports = {
  buildInboundReplyText,
  planInboundAutomation,
};
