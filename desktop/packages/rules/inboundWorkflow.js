"use strict";

function planInboundAutomation(input = {}) {
  const route = input.route || {};
  const assetIds = normalizeList(input.assetIds);
  const bundle = input.bundleRecommendation || null;
  const routingPolicy = normalizeRoutingPolicy(route.routingPolicy);

  if (input.conversationManualLocked || route.conversationManualLocked) {
    return withRoutingPolicy({
      type: "manual_locked",
      reason: "conversation_manual_locked",
      shouldQueueReply: false,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: true,
    }, routingPolicy);
  }

  if (routingPolicy?.manualRequired || route.action === "manual_review") {
    return withRoutingPolicy({
      type: "manual_review",
      reason: manualReviewReason(route, routingPolicy),
      shouldQueueReply: false,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: true,
    }, routingPolicy);
  }

  if (route.action === "collect_info") {
    const needsSceneClarification =
      routingPolicy?.lane === "scene_clarification" || (route.missingFields || []).includes("scene_clarification");
    return withRoutingPolicy({
      type: "queue_reply",
      reason: needsSceneClarification ? "scene_clarification_required" : "missing_required_info",
      shouldQueueReply: true,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: false,
      missingFields: route.missingFields || [],
    }, routingPolicy);
  }

  if (route.agentKey === "gift_design" && route.action === "auto_agent") {
    if (!assetIds.length) {
      return withRoutingPolicy({
        type: "queue_reply",
        reason: "missing_real_customer_assets",
        shouldQueueReply: true,
        shouldCreateDesignJob: false,
        shouldNotifyHuman: false,
        missingFields: ["customer_assets"],
      }, routingPolicy);
    }

    if (!bundle?.items?.length) {
      return withRoutingPolicy({
        type: "manual_review",
        reason: "bundle_recommendation_empty",
        shouldQueueReply: false,
        shouldCreateDesignJob: false,
        shouldNotifyHuman: true,
      }, routingPolicy);
    }

    if (bundle.automation && bundle.automation.ready === false) {
      return withRoutingPolicy({
        type: "manual_review",
        reason: "bundle_automation_not_ready",
        shouldQueueReply: false,
        shouldCreateDesignJob: false,
        shouldNotifyHuman: true,
        blockers: Array.isArray(bundle.automation.blockers) ? bundle.automation.blockers : [],
      }, routingPolicy);
    }

    return withRoutingPolicy({
      type: "create_design_job",
      reason: "complete_gift_design_request",
      shouldQueueReply: true,
      shouldCreateDesignJob: true,
      shouldNotifyHuman: false,
    }, routingPolicy);
  }

  if (route.action === "auto_agent") {
    return withRoutingPolicy({
      type: "queue_reply",
      reason: "agent_reply",
      shouldQueueReply: routingPolicy?.canQueueAutoReply !== false,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: false,
    }, routingPolicy);
  }

  return withRoutingPolicy({
    type: "manual_review",
    reason: "fallback_unknown_route",
    shouldQueueReply: false,
    shouldCreateDesignJob: false,
    shouldNotifyHuman: true,
  }, routingPolicy);
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

function normalizeRoutingPolicy(policy) {
  if (!policy || typeof policy !== "object") return null;
  return {
    lane: String(policy.lane || ""),
    valueTier: String(policy.valueTier || ""),
    handler: String(policy.handler || ""),
    agentKey: String(policy.agentKey || ""),
    scene: String(policy.scene || ""),
    manualRequired: Boolean(policy.manualRequired),
    canAskClarification: Boolean(policy.canAskClarification),
    canQueueAutoReply: policy.canQueueAutoReply !== false,
    autoSendAllowed: policy.autoSendAllowed !== false,
    reason: String(policy.reason || ""),
    nextStep: String(policy.nextStep || ""),
    safeguards: normalizeList(policy.safeguards),
  };
}

function withRoutingPolicy(plan, routingPolicy) {
  if (!routingPolicy) return plan;
  return {
    ...plan,
    routingPolicy,
  };
}

function manualReviewReason(route, routingPolicy) {
  if (routingPolicy?.lane === "high_value_human" || route.isHighValue) return "high_value_customer";
  if (routingPolicy?.lane === "risk_human") return "risk_or_sensitive_route";
  if (routingPolicy?.lane === "manual_review") return "routing_policy_manual_review";
  return "risk_or_unclear_route";
}

module.exports = {
  buildInboundReplyText,
  planInboundAutomation,
};
