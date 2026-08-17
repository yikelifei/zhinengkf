"use strict";

function planInboundAutomation(input = {}) {
  const route = input.route || {};
  const assetIds = normalizeList(input.assetIds);
  const bundle = input.bundleRecommendation || null;
  const zhenxiRequest = input.zhenxiRequest || null;
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

  if ((routingPolicy?.manualRequired || route.action === "manual_review") && !canSafelyRouteZhenxiRequest(route, routingPolicy, zhenxiRequest)) {
    if (canQueueInternalTestReply(input, route, routingPolicy)) {
      return withRoutingPolicy({
        type: "queue_reply",
        reason: "internal_test_safe_reply",
        shouldQueueReply: true,
        shouldCreateDesignJob: false,
        shouldNotifyHuman: false,
        internalTestOverride: true,
      }, routingPolicy);
    }
    const reviewReason = manualReviewReason(route, routingPolicy);
    if (reviewReason === "high_value_customer" && normalizeList(route.riskFlags).length === 0) {
      return withRoutingPolicy({
        type: "queue_reply",
        reason: "high_value_safe_acknowledgement",
        shouldQueueReply: true,
        shouldCreateDesignJob: false,
        shouldNotifyHuman: true,
        shouldLockConversation: false,
        acknowledgementOnly: true,
      }, highValueAcknowledgementRoutingPolicy(routingPolicy));
    }
    return withRoutingPolicy({
      type: "manual_review",
      reason: reviewReason,
      shouldQueueReply: false,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: true,
    }, routingPolicy);
  }

  if (zhenxiRequest?.kind === "clarify") {
    return withZhenxiRoutingPolicy({
      type: "queue_reply",
      reason: zhenxiRequest.reason || "zhenxi_output_type_unclear",
      shouldQueueReply: true,
      shouldCreateDesignJob: false,
      shouldCreateZhenxiCopyJob: false,
      shouldNotifyHuman: false,
      zhenxiRequest,
    }, routingPolicy);
  }

  if (zhenxiRequest?.kind === "copy") {
    return withZhenxiRoutingPolicy({
      type: "create_zhenxi_copy_job",
      reason: "explicit_zhenxi_copy_request",
      shouldQueueReply: true,
      shouldCreateDesignJob: true,
      shouldCreateZhenxiCopyJob: true,
      shouldNotifyHuman: false,
      zhenxiRequest,
    }, routingPolicy);
  }

  if (["image", "multi", "bundle"].includes(zhenxiRequest?.kind)) {
    if (zhenxiRequest.missingReference) {
      return withZhenxiRoutingPolicy({
        type: "queue_reply",
        reason: "zhenxi_reference_required",
        shouldQueueReply: true,
        shouldCreateDesignJob: false,
        shouldCreateZhenxiCopyJob: false,
        shouldNotifyHuman: false,
        missingFields: ["customer_assets"],
        zhenxiRequest,
      }, routingPolicy);
    }
    return withZhenxiRoutingPolicy({
      type: "create_design_job",
      reason: zhenxiRequest.reason || (zhenxiRequest.kind === "bundle" ? "customer_tool_plan_ready" : "explicit_zhenxi_image_request"),
      shouldQueueReply: true,
      shouldCreateDesignJob: true,
      shouldCreateZhenxiCopyJob: false,
      shouldNotifyHuman: false,
      zhenxiRequest,
    }, routingPolicy);
  }

  if (zhenxiRequest?.kind === "cancel" && zhenxiRequest?.reason === "explicit_image_generation_declined") {
    return withRoutingPolicy({
      type: "queue_reply",
      reason: "explicit_image_generation_declined",
      shouldQueueReply: routingPolicy?.canQueueAutoReply !== false,
      shouldCreateDesignJob: false,
      shouldCreateZhenxiCopyJob: false,
      shouldNotifyHuman: false,
      zhenxiRequest,
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
    if (!bundle?.items?.length) {
      return withRoutingPolicy({
        type: "manual_review",
        reason: "bundle_recommendation_empty",
        shouldQueueReply: false,
        shouldCreateDesignJob: false,
        shouldNotifyHuman: true,
      }, routingPolicy);
    }

    // 搭品效果图以商品库中每个 SKU 的真实图为权威素材。只有客户明确要求
    // 放 Logo、原图或人物时才需要额外客户素材，不能把“未发 Logo”误当成
    // 所有礼盒搭配任务的阻塞项。
    if (!assetIds.length && !bundleHasUsableRealImages(bundle)) {
      return withRoutingPolicy({
        type: "queue_reply",
        reason: "missing_real_customer_assets",
        shouldQueueReply: true,
        shouldCreateDesignJob: false,
        shouldNotifyHuman: false,
        missingFields: ["customer_assets"],
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

function canSafelyRouteZhenxiRequest(route, routingPolicy, request) {
  if (!request || !["clarify", "copy", "image", "multi", "bundle"].includes(String(request.kind || ""))) return false;
  if (route?.isHighValue === true) return false;
  const needsCatalog = request?.toolIntents?.catalog === true || request?.kind === "bundle";
  const blockingRiskFlags = normalizeList(route?.riskFlags).filter((flag) => flag !== "unverified_catalog_data" || needsCatalog);
  if (blockingRiskFlags.length > 0) return false;
  if (["high_value_human", "risk_human"].includes(String(routingPolicy?.lane || ""))) return false;
  return true;
}

function bundleHasUsableRealImages(bundle) {
  const items = Array.isArray(bundle?.items) ? bundle.items : [];
  if (!items.length) return false;
  return items.every((item) => {
    const candidates = [
      item?.imageUrl,
      item?.image,
      item?.localImagePath,
      item?.localPath,
      ...(Array.isArray(item?.imageUrls) ? item.imageUrls : []),
      ...(Array.isArray(item?.imageRefs) ? item.imageRefs : []),
      ...(Array.isArray(item?.images) ? item.images : []),
    ];
    return candidates.some((value) => typeof value === "string" && value.trim().length > 0);
  });
}

function buildInboundReplyText(route = {}, plan = {}) {
  if (plan.zhenxiRequest?.replyText) return String(plan.zhenxiRequest.replyText).trim();
  if (plan.reason === "high_value_safe_acknowledgement") {
    const hasMissingFieldAudit = Array.isArray(route?.missingFields);
    const missingFields = new Set(hasMissingFieldAudit ? route.missingFields : []);
    const coreDetailsComplete = !["budget", "quantity", "usage_scene"].some((field) => missingFields.has(field));
    if (hasMissingFieldAudit && coreDetailsComplete && missingFields.has("customer_assets")) {
      return "那就按稳重、有质感的商务款往下做，包装别太花。把 Logo 文件和贺卡文字发我，我接着配方案。";
    }
    if (hasMissingFieldAudit && coreDetailsComplete && missingFields.size === 0) {
      return "信息够了，我先按稳重、有质感的商务款整理方案，价格和交期核对好再给您。";
    }
    const quantity = positiveNumber(route?.budget?.quantity);
    const perUnitAmount = positiveNumber(route?.budget?.perUnitAmount);
    const quantityText = quantity ? `${quantity} 份` : "这批";
    const budgetText = perUnitAmount ? `、每份 ${formatMoney(perUnitAmount)} 元` : "";
    return `${quantityText}${budgetText}，这个预算做商务礼盒比较从容。建议把礼品、包装和定制费用一起考虑，别把预算全压在单品上，成品会更体面。主要是送客户还是员工？我先按赠送对象给您定方向。`;
  }
  const base = String(route.suggestedReply || "").trim();
  if (plan.reason === "internal_test_safe_reply") {
    return String(route.sceneClarification?.question || "").trim()
      || "收到，我已经看到您的消息。为了准确回复，请补充您想咨询的具体问题和关键信息，我会继续为您处理。";
  }
  if (plan.reason === "missing_real_customer_assets") {
    const suffix = "另外效果图必须使用真实素材，麻烦您把 Logo、参考图或产品图发我一下，我收到后再开始整理效果图，避免图片和实际商品不一致。";
    return base ? `${base}\n${suffix}` : suffix;
  }
  return base || "收到，我先帮您整理关键信息，再给您明确的下一步。";
}

function canQueueInternalTestReply(input, route, routingPolicy) {
  if (input.internalTestAutoReply !== true) return false;
  if (route.action !== "manual_review") return false;
  if (route.isHighValue === true || (route.riskFlags || []).length) return false;
  if (["high_value_human", "risk_human"].includes(String(routingPolicy?.lane || ""))) return false;
  return true;
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

function withZhenxiRoutingPolicy(plan, routingPolicy) {
  if (!routingPolicy) return plan;
  return withRoutingPolicy(plan, {
    ...routingPolicy,
    lane: "zhenxi_generation",
    handler: "agent",
    manualRequired: false,
    canAskClarification: true,
    canQueueAutoReply: true,
    autoSendAllowed: true,
    reason: plan.reason,
    nextStep: plan.shouldCreateDesignJob ? "create_zhenxi_generation_job" : "collect_zhenxi_generation_info",
  });
}

function manualReviewReason(route, routingPolicy) {
  if (routingPolicy?.lane === "high_value_human" || route.isHighValue) return "high_value_customer";
  if (routingPolicy?.lane === "risk_human") return "risk_or_sensitive_route";
  if (routingPolicy?.lane === "manual_review") return "routing_policy_manual_review";
  return "risk_or_unclear_route";
}

function highValueAcknowledgementRoutingPolicy(routingPolicy) {
  return {
    ...(routingPolicy || {}),
    lane: "high_value_guided_reply",
    handler: "agent",
    manualRequired: false,
    canAskClarification: true,
    canQueueAutoReply: true,
    autoSendAllowed: true,
    reason: "高价值需求先发送安全确认并通知人工；正式方案、价格和履约承诺仍需核对。",
    nextStep: "queue_safe_acknowledgement_and_notify_operator",
    safeguards: normalizeList([
      ...(routingPolicy?.safeguards || []),
      "wechat_send_guard_required",
      "acknowledgement_only",
      "final_quote_manual_review",
    ]),
  };
}

function positiveNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function formatMoney(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

module.exports = {
  buildInboundReplyText,
  planInboundAutomation,
};
