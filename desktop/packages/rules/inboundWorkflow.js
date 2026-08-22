"use strict";

const { buildAgentTaskPlan } = require("./agentTaskRuntime");

function planInboundAutomationInternal(input = {}) {
  const route = input.route || {};
  const assetIds = normalizeList(input.assetIds);
  const bundle = input.bundleRecommendation || null;
  const zhenxiRequest = input.zhenxiRequest || null;
  const routingPolicy = normalizeRoutingPolicy(route.routingPolicy);
  const businessRiskDisabled = businessRiskControlsDisabled();

  if (canQueueLowRiskGenericFollowup(input, route, routingPolicy)) {
    return withRoutingPolicy({
      type: "queue_reply",
      reason: "low_risk_generic_followup",
      shouldQueueReply: true,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: false,
      shouldLockConversation: false,
      deterministicReply: true,
    }, lowRiskFollowupRoutingPolicy(routingPolicy));
  }

  if (
    !businessRiskDisabled &&
    isGenericProgressFollowup(input.customerText || route.text || "")
    && (hasActiveBusinessRiskState(input.activeBusinessState) || hasRiskyRecentContext(input))
  ) {
    return withRoutingPolicy({
      type: "queue_reply",
      reason: "generic_followup_requires_business_review",
      shouldQueueReply: true,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: true,
      shouldLockConversation: false,
      acknowledgementOnly: true,
    }, routingPolicy);
  }

  if (zhenxiRequest?.kind === "status") {
    return withZhenxiRoutingPolicy({
      type: "queue_reply",
      reason: zhenxiRequest.reason || "zhenxi_status_query",
      shouldQueueReply: true,
      shouldCreateDesignJob: false,
      shouldCreateZhenxiCopyJob: false,
      shouldNotifyHuman: zhenxiRequest.needsHumanReview === true,
      shouldLockConversation: false,
      deterministicReply: true,
      zhenxiRequest,
    }, routingPolicy);
  }

  if ((routingPolicy?.manualRequired || route.action === "manual_review") && !canSafelyRouteZhenxiRequest(route, routingPolicy, zhenxiRequest)) {
    if (businessRiskDisabled) {
      return withRoutingPolicy({
        type: "queue_reply",
        reason: "business_risk_disabled_auto_reply",
        shouldQueueReply: true,
        shouldCreateDesignJob: false,
        shouldNotifyHuman: false,
        shouldLockConversation: false,
        businessRiskControlsDisabled: true,
      }, businessRiskDisabledRoutingPolicy(routingPolicy));
    }
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
      type: "queue_reply",
      reason: reviewReason,
      shouldQueueReply: true,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: true,
      shouldLockConversation: false,
      acknowledgementOnly: true,
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
        type: "queue_reply",
        reason: businessRiskDisabled ? "bundle_recommendation_empty_auto_reply" : "bundle_recommendation_empty",
        shouldQueueReply: true,
        shouldCreateDesignJob: false,
        shouldNotifyHuman: false,
        shouldLockConversation: false,
      }, businessRiskDisabled ? businessRiskDisabledRoutingPolicy(routingPolicy) : routingPolicy);
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
      if (businessRiskDisabled) {
        return withRoutingPolicy({
          type: "create_design_job",
          reason: "complete_gift_design_request_business_risk_disabled",
          shouldQueueReply: true,
          shouldCreateDesignJob: true,
          shouldNotifyHuman: false,
          shouldLockConversation: false,
          blockers: Array.isArray(bundle.automation.blockers) ? bundle.automation.blockers : [],
          businessRiskControlsDisabled: true,
        }, businessRiskDisabledRoutingPolicy(routingPolicy));
      }
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
      shouldQueueReply: businessRiskDisabled ? true : routingPolicy?.canQueueAutoReply !== false,
      shouldCreateDesignJob: false,
      shouldNotifyHuman: false,
    }, businessRiskDisabled ? businessRiskDisabledRoutingPolicy(routingPolicy) : routingPolicy);
  }

  return withRoutingPolicy({
    type: "queue_reply",
    reason: "fallback_unknown_route",
    shouldQueueReply: true,
    shouldCreateDesignJob: false,
    shouldNotifyHuman: !businessRiskDisabled,
    shouldLockConversation: false,
    acknowledgementOnly: !businessRiskDisabled,
    ...(businessRiskDisabled ? { businessRiskControlsDisabled: true } : {}),
  }, businessRiskDisabled ? businessRiskDisabledRoutingPolicy(routingPolicy) : routingPolicy);
}

function planInboundAutomation(input = {}) {
  const plan = planInboundAutomationInternal(input);
  // Keep the existing automation contract intact while exposing a structured
  // task envelope for the future AgentTask persistence layer.
  return {
    ...plan,
    agentTask: buildAgentTaskPlan({
      input,
      route: input.route || {},
      plan,
    }),
  };
}

function canSafelyRouteZhenxiRequest(route, routingPolicy, request) {
  if (!request || !["clarify", "copy", "image", "multi", "bundle"].includes(String(request.kind || ""))) return false;
  if (businessRiskControlsDisabled()) return true;
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
  if (plan.reason === "low_risk_generic_followup") {
    return "收到，我这边继续按当前信息处理；如果需要您补充材料，会直接在这里说明。";
  }
  if (plan.reason === "business_risk_disabled_auto_reply") {
    return removeManualHandoffLanguage(base) || "收到，我按您发来的信息继续处理，有需要补充的我会直接在这里问您。";
  }
  if (plan.reason === "bundle_recommendation_empty_auto_reply") {
    return removeManualHandoffLanguage(base) || "收到，我先按您的需求继续整理方案，缺少商品搭配信息时我会直接在这里补问。";
  }
  if (plan.acknowledgementOnly) {
    return base || "收到，我先按您发来的信息继续整理；涉及价格、交期、付款或定制细节，我会以系统资料核对后再给您明确结论。";
  }
  if (plan.reason === "missing_real_customer_assets") {
    const suffix = "另外效果图必须使用真实素材，麻烦您把 Logo、参考图或产品图发我一下，我收到后再开始整理效果图，避免图片和实际商品不一致。";
    return base ? `${base}\n${suffix}` : suffix;
  }
  return base || "收到，我先帮您整理关键信息，再给您明确的下一步。";
}

function canQueueInternalTestReply(input, route, routingPolicy) {
  if (businessRiskControlsDisabled()) return true;
  if (input.internalTestAutoReply !== true) return false;
  if (route.action !== "manual_review") return false;
  if (route.isHighValue === true || (route.riskFlags || []).length) return false;
  if (["high_value_human", "risk_human"].includes(String(routingPolicy?.lane || ""))) return false;
  return true;
}

function canQueueLowRiskGenericFollowup(input, route, routingPolicy) {
  if (route.agentKey !== "general") return false;
  if (!businessRiskControlsDisabled()) {
    if (route.isHighValue === true || normalizeList(route.riskFlags).length) return false;
    if (["high_value_human", "risk_human"].includes(String(routingPolicy?.lane || ""))) return false;
  }
  if (!explicitPolicyAllowsLowRiskGenericFollowup(route, routingPolicy)) return false;
  if (!businessRiskControlsDisabled()) {
    if (hasActiveBusinessRiskState(input.activeBusinessState)) return false;
    if (hasRiskyRecentContext(input)) return false;
  }
  return isGenericProgressFollowup(input.customerText || route.text || "");
}

function isGenericProgressFollowup(value) {
  const text = normalizeShortCustomerText(value);
  if (!text) return false;
  if (/(投诉|报警|律师|赔偿|退款|发票|合同|价格|报价|定金|尾款|付款|转账|发货|物流|快递|地址|隐私|删除|拉黑)/.test(text)) return false;
  return /^(可以了吗|可以了么|可以了没|好了没|好了么|好了吗|能发了吗|可以发了吗|可以继续吗|现在可以吗|处理好了吗|有结果了吗|怎么样了|弄好了吗)$/.test(text);
}

function explicitPolicyAllowsLowRiskGenericFollowup(route, routingPolicy) {
  if (businessRiskControlsDisabled()) return true;
  if (!routingPolicy) return true;
  const manuallyBlocked = routingPolicy.manualRequired === true
    || routingPolicy.canQueueAutoReply === false
    || routingPolicy.autoSendAllowed === false;
  if (!manuallyBlocked) return true;
  if (
    route.agentKey === "general" &&
    route.scene === "未分类" &&
    route.sceneDecision?.reason === "no_scene_keyword_hit"
  ) return true;
  const text = [
    route.scene,
    route.action,
    route.agentKey,
    routingPolicy.lane,
    routingPolicy.reason,
    routingPolicy.nextStep,
    ...(routingPolicy.safeguards || []),
  ].map((value) => String(value || "")).join(" ");
  if (/(价格|报价|付款|支付|转账|订单|发货|物流|快递|售后|退款|投诉|赔偿|合同|发票|隐私|删除|拉黑|高价值|风险)/.test(text)) {
    return false;
  }
  return /(manual_review|general|未分类|人工确认|低风险|普通|追问|generic|unclear|handoff_to_human)/i.test(text);
}

function hasActiveBusinessRiskState(value) {
  if (!value || typeof value !== "object") return false;
  return Boolean(
    value.hasActiveQuote ||
    value.hasActiveOrder ||
    value.hasPaymentPending ||
    value.hasAfterSales ||
    value.hasComplaint ||
    Number(value.activeRiskCount || 0) > 0
  );
}

function hasRiskyRecentContext(input) {
  const routes = Array.isArray(input.recentRoutes) ? input.recentRoutes.slice(0, 5) : [];
  return routes.some((route) => {
    if (!route || typeof route !== "object") return false;
    if (route.isHighValue === true || normalizeList(route.riskFlags).length) return true;
    const agentKey = String(route.agentKey || route.routingPolicy?.agentKey || "");
    if (["logistics_exception", "order", "after_sales", "payment", "finance"].includes(agentKey)) return true;
    const text = [
      route.scene,
      route.text,
      route.suggestedReply,
      route.routingPolicy?.lane,
      route.routingPolicy?.reason,
      route.routingPolicy?.nextStep,
      route.replyDraft?.nextAction,
      route.replyDraft?.ruleSuggestedReply,
    ].map((value) => String(value || "")).join(" ");
    return /(付款|支付|转账|打款|定金|订金|尾款|收款|回款|发票|合同|价格|报价|订单|生产|发货|物流|快递|售后|退款|投诉|赔偿|报警|律师)/.test(text);
  });
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => (typeof item === "string" ? item : item?.id || item?.assetId)).filter(Boolean).map(String))];
}

function normalizeShortCustomerText(value) {
  return String(value || "")
    .trim()
    .replace(/[？?！!。，,.\s]/g, "");
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

function businessRiskControlsDisabled() {
  return true;
}

function businessRiskDisabledRoutingPolicy(routingPolicy) {
  return {
    ...(routingPolicy || {}),
    lane: "business_risk_disabled_agent",
    handler: "agent",
    manualRequired: false,
    canAskClarification: true,
    canQueueAutoReply: true,
    autoSendAllowed: true,
    reason: "业务风控已临时关闭，智能客服直接处理。",
    nextStep: "queue_agent_reply_without_business_risk_review",
    safeguards: normalizeList([
      ...((routingPolicy?.safeguards || []).filter((flag) => ![
        "human_approval_required",
        "final_quote_manual_review",
        "price_image_and_order_manual_review",
        "ask_before_answering_uncertain_scene",
      ].includes(flag))),
      "wechat_send_guard_required",
    ]),
  };
}

function removeManualHandoffLanguage(value) {
  return String(value || "")
    .replace(/(?:需要|请|建议)?人工(?:客服)?(?:核对|确认|处理|介入|接管|审核|判断|复核)?/g, "我这边继续处理")
    .replace(/转人工/g, "继续处理")
    .replace(/\s+/g, " ")
    .trim();
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

function lowRiskFollowupRoutingPolicy(routingPolicy) {
  return {
    ...(routingPolicy || {}),
    lane: "low_risk_followup",
    handler: "agent",
    manualRequired: false,
    canAskClarification: false,
    canQueueAutoReply: true,
    autoSendAllowed: true,
    reason: "低风险客户追问使用确定性确认回复，避免无意义人工拦截。",
    nextStep: "queue_deterministic_followup_reply",
    safeguards: normalizeList([
      ...(routingPolicy?.safeguards || []).filter((flag) => ![
        "human_approval_required",
        "ask_before_answering_uncertain_scene",
      ].includes(flag)),
      "wechat_send_guard_required",
      "no_quote_or_delivery_commitment",
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
