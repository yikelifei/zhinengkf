"use strict";

const { retrieveKnowledgeRag } = require("./knowledgeRag");
const {
  buildXiaoshiPreSalesReply,
  buildXiaoshiStyleProfile,
  mergeXiaoshiSkills,
} = require("./xiaoshiCustomerService");

const DEFAULT_MAX_SKILLS = 5;
const DEFAULT_MAX_KNOWLEDGE = 3;
const ANSWER_FIRST_INTENTS = new Set([
  "style_options",
  "inventory",
  "lead_time",
  "logo_customization",
  "sample",
  "packaging_adjustment",
  "greeting_card_requirements",
  "greeting_card_revision",
  "price_explanation",
]);

function buildAgentReplyDraft(route = {}, context = {}) {
  const identity = {
    wechatAccountId: firstText(context.wechatAccountId, route.wechatAccountId),
    conversationId: firstText(context.conversationId, route.conversationId),
    customerId: firstText(context.customerId, route.customerId),
  };
  const skills = selectSkills(mergeXiaoshiSkills(context.skills || [], route), route, context.maxSkills || DEFAULT_MAX_SKILLS, identity);
  const knowledgeRag = retrieveScopedKnowledge(route.text || "", context.knowledgeEntries || [], {
    agentId: context.agentId,
    max: context.maxKnowledge || DEFAULT_MAX_KNOWLEDGE,
    knownFacts: knownFactsForRoute(route),
    contextQuery: knowledgeContextForRoute(route),
    ...identity,
  });
  const knowledgeMatches = knowledgeRag.matches;
  const styleProfile = buildXiaoshiStyleProfile(route, knowledgeMatches);
  const mayUseCatalogFacts = route.action !== "manual_review";
  const catalogMatches = mayUseCatalogFacts
    ? matchCatalog(route.text || "", context.catalogSkus || [], {
        max: context.maxCatalog || 3,
      })
    : [];
  const catalogRecommendation = mayUseCatalogFacts
    ? summarizeBundleRecommendation(context.bundleRecommendation)
    : null;
  const hasApprovedHumanReply = knowledgeMatches.some((item) => (
    item.humanVerbatim === true
    && item.allowVerbatim !== false
    && Number(item.score || 0) >= 60
    && !/\[附件\]|\[引用/.test(formatHumanVerbatimReply(item.excerpt || ""))
  ));
  const directCandidate = !catalogMatches.length && !catalogRecommendation
    ? buildDirectCustomerAnswer(route)
    : null;
  const completeGiftDesignRequest = route.agentKey === "gift_design"
    && route.action === "auto_agent"
    && !(route.missingFields || []).length;
  const completeGiftDesignDirectAllowed = completeGiftDesignRequest
    && ["packaging_adjustment", "greeting_card_requirements", "greeting_card_revision"].includes(directCandidate?.intent)
    && /卡片|贺卡|祝福卡|感谢卡|心意卡|盒子|1\s*[:：]\s*1|正方形|方形|紫色|花/.test(String(route.text || ""));
  const directAnswer = directCandidate
    && (!completeGiftDesignRequest || completeGiftDesignDirectAllowed)
    && (!hasApprovedHumanReply || ANSWER_FIRST_INTENTS.has(directCandidate.intent))
    ? directCandidate
    : null;
  const composedReply = composeReply(route, skills, knowledgeMatches, catalogMatches, catalogRecommendation, directAnswer);
  const repetitionGuard = avoidRepeatedReply(route, composedReply, context.previousReplies);
  const suggestedReply = repetitionGuard.reply;
  return {
    suggestedReply,
    appliedSkills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description || "",
      confidence: Number(skill.confidence || 0),
      sampleCount: Number(skill.sampleCount || 0),
      version: Number(skill.version || 1),
      scope: skillScopeSummary(skill),
    })),
    knowledgeMatches,
    rag: knowledgeRag.trace,
    catalogMatches,
    replyDraft: {
      source: catalogMatches.length || catalogRecommendation
        ? "catalog_enhanced"
        : skills.length || knowledgeMatches.length
          ? "skill_enhanced"
          : "rule_based",
      style: styleProfile.activeForAgent ? "xiaoshi_concise_sales" : "warm_precise_service",
      styleProfile,
      salesContext: route.salesContext || null,
      rag: knowledgeRag.trace,
      preserveHumanVerbatim: styleProfile.preserveHumanVerbatim && !directAnswer && !repetitionGuard.applied,
      directAnswer: directAnswer
        ? { applied: true, intent: directAnswer.intent }
        : { applied: false, intent: null },
      repetitionGuard: {
        applied: repetitionGuard.applied,
        previousReply: repetitionGuard.previousReply,
        reason: repetitionGuard.reason || null,
        repeatedField: repetitionGuard.repeatedField || null,
      },
      nextAction: inferNextAction(route),
      safetyChecks: buildSafetyChecks(route),
      catalog: {
        matches: catalogMatches,
        recommendation: catalogRecommendation,
        finalQuoteRequiresManualReview: true,
      },
    },
  };
}

function skillScopeSummary(skill = {}) {
  const wechatAccountId = firstText(skill.wechatAccountId, skill.identityBinding?.wechatAccountId, skill.scope?.wechatAccountId);
  const conversationId = firstText(skill.conversationId, skill.identityBinding?.conversationId, skill.scope?.conversationId);
  const customerId = firstText(skill.customerId, skill.identityBinding?.customerId, skill.scope?.customerId);
  if (conversationId) {
    return {
      level: "conversation",
      label: "当前会话私有",
      wechatAccountId,
      conversationId,
      customerId,
      bindingStatus: firstText(skill.identityBinding?.status) || "passed",
    };
  }
  if (customerId) {
    return {
      level: "customer",
      label: "客户私有",
      wechatAccountId,
      customerId,
      bindingStatus: firstText(skill.identityBinding?.status) || "passed",
    };
  }
  if (wechatAccountId) {
    return {
      level: "wechat_account",
      label: "微信账号内共享",
      wechatAccountId,
      bindingStatus: firstText(skill.identityBinding?.status) || "passed",
    };
  }
  return {
    level: "global",
    label: "全局 Skill",
    bindingStatus: firstText(skill.identityBinding?.status) || "",
  };
}

function selectSkills(skills, route, max, identity = {}) {
  const wanted = wantedSkillNames(route);
  return [...skills]
    .filter((skill) => skill && skill.enabled !== false)
    .filter((skill) => skillIdentityMatches(skill, identity))
    .map((skill) => ({
      ...skill,
      relevance: scoreSkill(skill, route, wanted),
    }))
    .filter((skill) => skill.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, max);
}

function skillIdentityMatches(skill = {}, identity = {}) {
  const scopeLevel = firstText(skill.scope?.level);
  if (scopeLevel === "mixed") return false;
  if (scopeLevel === "conversation" && !firstText(skill.conversationId, skill.identityBinding?.conversationId, skill.scope?.conversationId)) return false;
  if (scopeLevel === "customer" && !firstText(skill.customerId, skill.identityBinding?.customerId, skill.scope?.customerId)) return false;
  if (scopeLevel === "wechat_account" && !firstText(skill.wechatAccountId, skill.identityBinding?.wechatAccountId, skill.scope?.wechatAccountId)) return false;
  const checks = ["wechatAccountId", "conversationId", "customerId"];
  for (const key of checks) {
    const actual = identityFieldValue(skill, key);
    if (actual.conflict) return false;
    if (!actual.value) continue;
    const expected = firstText(identity?.[key]);
    if (!expected || expected !== actual.value) return false;
  }
  return true;
}

function identityFieldValue(record = {}, key) {
  const values = [
    record?.[key],
    record?.identityBinding?.[key],
    record?.scope?.[key],
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const unique = [...new Set(values)];
  return {
    value: unique[0] || "",
    conflict: unique.length > 1,
  };
}

function wantedSkillNames(route) {
  const names = new Set(["高情商话术"]);
  const text = String(route.text || "");
  if (route.agentKey === "pre_sales") {
    names.add("小石式单点追问");
  }
  if (route.agentKey === "pre_sales" && /多少钱|怎么卖|价格|报价|优惠|便宜|好贵|太贵|预算/.test(text)) {
    names.add("小石式价格异议承接");
  }
  if (["pre_sales", "gift_design"].includes(route.agentKey) && /更换|换掉|取消|删掉|去掉|保留|不要|可以换|调整/.test(text)) {
    names.add("小石式搭配变更确认");
  }
  if (["pre_sales", "gift_design"].includes(route.agentKey) && /太可爱|不喜欢|不好看|简单|商务|大气|风格|颜色/.test(text)) {
    names.add("小石式偏好翻译");
  }
  if (route.agentKey === "pre_sales" && /不定了|不做了|算了|再看看|以后再说|班费|拮据/.test(text)) {
    names.add("小石式柔和收口");
  }
  if (route.agentKey === "gift_design") {
    names.add("预算澄清");
    names.add("设计需求确认");
    if (route.isHighValue) names.add("高价值转人工");
  }
  if (route.agentKey === "logistics_exception") names.add("物流安抚");
  if (route.agentKey === "after_sales") names.add("售后方案");
  if (route.action === "collect_info") names.add("需求澄清");
  if ((route.missingFields || []).includes("scene_clarification")) names.add("场景澄清");
  if (route.action === "manual_review") names.add("防乱回复");
  return [...names];
}

function scoreSkill(skill, route, wanted) {
  const name = normalizeSkillName(skill.name);
  const description = String(skill.description || "");
  const explicitlyWanted = wanted.some((item) => normalizeSkillName(item) === name);
  if (name.startsWith("小石式") && skill.sourceType !== "built_in_xiaoshi" && !explicitlyWanted) return 0;
  let score = 0;
  if (explicitlyWanted) score += 60;
  if (route.agentKey === "gift_design" && /预算|设计|效果图|Logo|logo|礼盒/.test(`${name}${description}`)) score += 24;
  if (route.agentKey === "logistics_exception" && /物流|发货|快递|签收/.test(`${name}${description}`)) score += 24;
  if (route.agentKey === "after_sales" && /售后|退款|退货|换货|补发/.test(`${name}${description}`)) score += 24;
  if (/高情商|自然|负责|承接/.test(`${name}${description}`)) score += 12;
  if (skill.sourceType === "built_in_xiaoshi") score += 50;
  score += Math.min(Number(skill.confidence || 0), 100) / 10;
  score += Math.min(Number(skill.sampleCount || 0), 10);
  return Math.round(score);
}

function matchKnowledge(text, entries, options = {}) {
  return retrieveScopedKnowledge(text, entries, options).matches;
}

function retrieveScopedKnowledge(text, entries, options = {}) {
  const scopedEntries = [...entries]
    .filter((entry) => entry && (!options.agentId || entry.agentId === options.agentId))
    .filter((entry) => knowledgeIdentityMatches(entry, options));
  return retrieveKnowledgeRag(text, scopedEntries, {
    max: options.max || DEFAULT_MAX_KNOWLEDGE,
    minScore: options.minScore,
    knownFacts: options.knownFacts,
    contextQuery: options.contextQuery,
  });
}

function knownFactsForRoute(route = {}) {
  const budget = route?.budget || {};
  const facts = [];
  if (positiveNumberOrNull(budget.quantity)) facts.push("quantity");
  if (positiveNumberOrNull(budget.perUnitAmount) || positiveNumberOrNull(budget.totalAmount)) facts.push("budget");
  if (String(route?.salesContext?.usageScene || "").trim()) facts.push("usage_scene");
  if (String(route?.salesContext?.stylePreference || "").trim()) facts.push("style_preference");
  return facts;
}

function knowledgeContextForRoute(route = {}) {
  return [
    route?.salesContext?.usageScene,
    route?.salesContext?.stylePreference,
  ].map((item) => String(item || "").trim()).filter(Boolean).join(" ");
}

function matchCatalog(text, skus, options = {}) {
  const query = normalizeCatalogText(text);
  if (!query) return [];
  return [...(Array.isArray(skus) ? skus : [])]
    .filter((sku) => sku && sku.isActive !== false && Number(sku.salePrice || 0) > 0)
    .map((sku) => ({ sku, score: scoreCatalogSku(query, sku) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || Number(left.sku.salePrice || 0) - Number(right.sku.salePrice || 0))
    .slice(0, Math.max(1, Number(options.max || 3)))
    .map(({ sku, score }) => publicCatalogSku(sku, score));
}

function enforceCatalogDataReplyPolicy(route = {}, replyDraft = {}, dataReadiness = {}, options = {}) {
  if (replyDraft?.source !== "catalog_enhanced") return route;
  const referencedSkuCodes = [
    ...(Array.isArray(replyDraft?.catalog?.matches) ? replyDraft.catalog.matches : []),
    ...(Array.isArray(replyDraft?.catalog?.recommendation?.items) ? replyDraft.catalog.recommendation.items : []),
  ].map((item) => String(item?.skuCode || "").trim()).filter(Boolean);
  const eligibleSkuCodes = new Set(
    (Array.isArray(dataReadiness?.customerReplyEligibleSkuCodes) ? dataReadiness.customerReplyEligibleSkuCodes : [])
      .map((code) => String(code || "").trim())
      .filter(Boolean),
  );
  const referencedFactsReady = referencedSkuCodes.length > 0 && referencedSkuCodes.every((code) => eligibleSkuCodes.has(code));
  if (dataReadiness?.customerReplyReady === true || referencedFactsReady || options.internalTestAllowed === true) return route;
  const currentPolicy = route?.routingPolicy && typeof route.routingPolicy === "object" ? route.routingPolicy : {};
  return {
    ...route,
    action: "manual_review",
    riskFlags: [...new Set([...(Array.isArray(route?.riskFlags) ? route.riskFlags : []), "unverified_catalog_data"])],
    routingPolicy: {
      ...currentPolicy,
      lane: "manual_review",
      handler: "human",
      manualRequired: true,
      canQueueAutoReply: false,
      autoSendAllowed: false,
      reason: "商品事实来自尚未完成真实数据验收的目录，非白名单会话必须人工确认。",
      nextStep: "先在商品审计页完成真实 SKU 来源和图片验收，再允许自动发送商品价格、库存或组合。",
      safeguards: [...new Set([...(Array.isArray(currentPolicy.safeguards) ? currentPolicy.safeguards : []), "verified_catalog_data_required"])],
    },
  };
}

function scoreCatalogSku(query, sku = {}) {
  const skuCode = normalizeCatalogText(sku.skuCode);
  const name = normalizeCatalogText(sku.name);
  const category = normalizeCatalogText(sku.category);
  const material = normalizeCatalogText(sku.material);
  const sceneTags = (Array.isArray(sku.sceneTags) ? sku.sceneTags : []).map(normalizeCatalogText).filter(Boolean);
  let score = 0;
  if (skuCode && query.includes(skuCode)) score += 120;
  if (name && query.includes(name)) score += 100;
  if (category && query.includes(category) && category !== "礼盒") score += 24;
  if (material && query.includes(material)) score += 18;
  for (const tag of sceneTags) {
    if (tag && query.includes(tag)) score += 22;
  }
  return score;
}

function publicCatalogSku(sku = {}, score = 0) {
  return {
    skuCode: String(sku.skuCode || ""),
    name: String(sku.name || ""),
    type: String(sku.type || ""),
    category: String(sku.category || ""),
    salePrice: Number(sku.salePrice || 0),
    stock: Math.max(0, Number(sku.stock || 0)),
    leadTimeDays: positiveNumberOrNull(sku.leadTimeDays),
    material: String(sku.material || ""),
    sceneTags: Array.isArray(sku.sceneTags) ? sku.sceneTags.slice(0, 6).map(String) : [],
    score,
  };
}

function summarizeBundleRecommendation(bundle) {
  if (!bundle || !Array.isArray(bundle.items) || !bundle.items.length) return null;
  return {
    status: String(bundle.status || ""),
    items: bundle.items.slice(0, 6).map((sku) => publicCatalogSku(sku)),
    totalSalePrice: Number(bundle.totals?.salePrice || 0),
    requestedQuantity: positiveNumberOrNull(bundle.fulfillment?.requestedQuantity),
    capacity: positiveNumberOrNull(bundle.fulfillment?.capacity),
    enough: bundle.fulfillment?.enough === true,
    warnings: Array.isArray(bundle.warnings) ? bundle.warnings.slice(0, 4).map(String) : [],
  };
}

function knowledgeIdentityMatches(entry, options = {}) {
  const checks = ["wechatAccountId", "conversationId", "customerId"];
  for (const key of checks) {
    const expected = firstText(options[key]);
    const actual = identityFieldValue(entry, key);
    if (actual.conflict) return false;
    if (!actual.value) continue;
    if (!expected || expected !== actual.value) return false;
  }
  return true;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function scoreKnowledge(text, entry) {
  const content = `${entry.title || ""}\n${entry.content || ""}\n${Array.isArray(entry.tags) ? entry.tags.join(" ") : ""}`;
  const customerExample = String(entry.content || "").match(/客户[:：]\s*([\s\S]*?)(?:\n客服[:：]|$)/)?.[1] || "";
  const evidenceText = `${entry.title || ""}\n${customerExample}\n${Array.isArray(entry.tags) ? entry.tags.join(" ") : ""}`;
  const normalizedQuery = normalizeKnowledgeMatchText(text);
  const normalizedEvidence = normalizeKnowledgeMatchText(evidenceText);
  const normalizedCustomerExample = normalizeKnowledgeMatchText(customerExample);
  if (!normalizedQuery || !normalizedEvidence) return 0;
  let relevance = 0;
  if (normalizedEvidence.includes(normalizedQuery)) relevance += 90;
  for (const keyword of extractKeywords(text)) {
    if (content.includes(keyword)) relevance += keyword.length >= 3 ? 12 : 6;
  }
  const similarity = Math.max(
    characterBigramSimilarity(normalizedQuery, normalizedEvidence),
    characterBigramSimilarity(normalizedQuery, normalizedCustomerExample),
  );
  if (similarity >= 0.18) relevance += Math.round(similarity * 70);
  if (relevance <= 0) return 0;
  relevance += Math.min(Number(entry.qualityScore || 0), 100) / 5;
  return Math.round(relevance);
}

function extractKeywords(text) {
  const value = String(text || "");
  const keywords = [];
  const dictionary = [
    "预算",
    "价格",
    "每盒",
    "每份",
    "总预算",
    "数量",
    "礼盒",
    "效果图",
    "设计",
    "Logo",
    "logo",
    "素材",
    "摆拍",
    "物流",
    "快递",
    "发货",
    "签收",
    "退款",
    "退货",
    "换货",
    "补发",
    "投诉",
    "伴手礼",
    "开业",
    "商务",
    "活动",
    "用途",
    "周年庆",
    "婚礼",
    "中秋",
    "样品",
    "方案",
    "大气",
    "推荐",
    "包包",
    "定制",
    "腰封",
    "卡片",
    "风格",
    "好看",
    "不喜欢",
    "好贵",
    "便宜",
    "怎么卖",
    "多少钱",
    "太可爱",
    "简单款",
    "百日宴",
  ];
  for (const keyword of dictionary) {
    if (value.includes(keyword)) keywords.push(keyword);
  }
  return [...new Set(keywords)];
}

function composeReply(route, skills, knowledgeMatches, catalogMatches, catalogRecommendation, directAnswer = null) {
  const budget = route.budget || {};
  const skillNames = new Set(skills.map((skill) => normalizeSkillName(skill.name)));
  const exemplar = knowledgeMatches[0]?.excerpt || "";
  const humanExemplar = knowledgeMatches.find((item) => (
    item.humanVerbatim === true
    && item.allowVerbatim !== false
    && Number(item.score || 0) >= 60
    && !/\[附件\]|\[引用/.test(formatHumanVerbatimReply(item.excerpt || ""))
  ))?.excerpt || "";
  const catalogReply = composeCatalogReply(route, catalogMatches, catalogRecommendation);

  if (route.action === "manual_review") {
    if (route.isHighValue) {
      if (catalogReply) {
        return `${catalogReply} 当前只能先提供商品库参考，最终优惠、含税、运费、Logo 工艺和正式报价由人工审核确认。`;
      }
      return "可以的，这个需求金额比较重要，我先帮您把预算、数量、用途和素材整理清楚，再交给专人审核方案和报价，避免后面反复改。";
    }
    if ((route.riskFlags || []).length) {
      return "收到，我先认真记录您反馈的情况。这个问题需要核实后再给明确处理方案，我马上转人工跟进，避免回复不准确。";
    }
    return "收到，这个问题我先不直接下结论，会帮您转给人工确认后再回复，保证处理更稳妥。";
  }

  // Low-risk factual questions still deserve an answer when the scene score is
  // weak or the workflow also needs more information.
  if (directAnswer?.text) return directAnswer.text;

  if (route.action === "collect_info") {
    if (route.sceneClarification?.question) {
      return route.sceneClarification.question;
    }
    return buildMissingFieldQuestion((route.missingFields || [])[0]);
  }

  if (route.action === "auto_agent" && route.basicAnswer) {
    return String(route.basicAnswer).trim();
  }

  if (route.agentKey === "pre_sales") {
    if (!catalogReply) {
      if (directAnswer?.text) return directAnswer.text;
      return humanExemplar ? formatHumanVerbatimReply(humanExemplar) : buildXiaoshiPreSalesReply(route);
    }
    const needsQuoteReview = route.isHighValue || /优惠|报价|含税|运费|logo/i.test(route.text || "");
    return needsQuoteReview
      ? `${catalogReply} 最终优惠、含税、运费、Logo 工艺和正式报价由人工确认。`
      : catalogReply;
  }

  if (route.agentKey === "gift_design") {
    if (!catalogReply && directAnswer?.text) return directAnswer.text;
    if (!catalogReply && humanExemplar) return formatHumanVerbatimReply(humanExemplar);
    if (catalogReply) return `${catalogReply} 如需效果图，请再发 Logo、参考图或指定产品图，我会按这套真实商品继续出图。`;
    const budgetText = budget.perUnitAmount
      ? `按每份 ${budget.perUnitAmount} 元`
      : budget.totalAmount
        ? `按总预算 ${budget.totalAmount} 元`
        : "按您的预算";
    const quantityText = budget.quantity ? `、${budget.quantity} 份` : "";
    const suffix = skillNames.has("设计需求确认")
      ? "同时我会核对 Logo、参考图、用途和礼盒搭配，确保效果图不乱换商品。"
      : "我先把关键信息确认清楚。";
    return `${budgetText}${quantityText}可以做。我先帮您搭一套礼盒组合，再整理 4 张真实产品摆拍效果图给您挑。${suffix}`;
  }

  if (route.agentKey === "logistics_exception") {
    return exemplar || "收到，我先帮您核对物流进度。如果确实停滞，我会同步安排催件或补发方案，再把处理结果告诉您。";
  }

  if (route.agentKey === "after_sales") {
    if (/破损|少件|漏发|错发|坏了/.test(route.text || "")) {
      return "很抱歉给您添麻烦。请发订单号、外包装和问题商品照片；核对后会优先安排补发处理。若涉及退款、质量争议或责任认定，会由人工复核后给您明确结果。";
    }
    return exemplar || "收到，我先帮您核对订单和问题凭证。确认具体情况后，会给您一个明确的处理方案；涉及退款、补发或争议的部分会先转人工确认。";
  }

  return "收到，我先按您这个情况整理关键信息，再给您一个明确的下一步处理方式。";
}

function avoidRepeatedReply(route, reply, previousReplies = []) {
  const current = String(reply || "").trim();
  const recent = Array.isArray(previousReplies)
    ? previousReplies.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const latest = recent[0] || "";
  const repeatedField = detectRequestedReplyField(current);
  const askedBefore = route.salesContext?.contextReset !== "usage_scene_changed"
    && repeatedField
    && recent.some((item) => detectRequestedReplyField(item) === repeatedField);
  if (
    current
    && route.agentKey === "pre_sales"
    && askedBefore
    && !currentTurnSuppliedField(route, repeatedField)
  ) {
    return {
      reply: buildDeferredFieldReply(route, repeatedField),
      applied: true,
      previousReply: latest || null,
      reason: "repeated_question_suppressed",
      repeatedField,
    };
  }
  if (!current || !latest || normalizeReplyForComparison(current) !== normalizeReplyForComparison(latest)) {
    return { reply: current, applied: false, previousReply: latest || null, reason: null, repeatedField: null };
  }
  if (route.agentKey !== "pre_sales") {
    return { reply: current, applied: false, previousReply: latest, reason: null, repeatedField: null };
  }

  const text = String(route.text || "");
  const quantity = Number(route.budget?.quantity || 0);
  const hasBudget = Number(route.budget?.perUnitAmount || route.budget?.totalAmount || 0) > 0;
  const usageScene = String(route.salesContext?.usageScene || "").trim();
  const stylePreference = String(route.salesContext?.stylePreference || "").trim();
  let alternative = "";
  if (/暂时没配出完整礼盒|不拿零散配件凑/.test(current)) {
    alternative = `好呢，${usageScene || "这个用途"}${stylePreference ? `、偏${stylePreference}` : ""}我都记着，完整搭配还在补，不会拿零散配件给您凑哈。`;
  } else if (/好贵|太贵|超预算|预算.{0,4}(低|少)|再看看/.test(text)) {
    alternative = hasBudget
      ? "可以再调整，我按之前的预算重新搭。咱更偏实用款还是氛围感强一点的？"
      : "礼品可以重新搭，咱单份预算大概多少呢？";
  } else if (!quantity) {
    alternative = /有哪些款式|有哪几款|有哪些款|都有什么款|什么款式|看看款式|发几个款/.test(text)
      ? "您是想先看现成款式对吧？咱大概需要多少份，我按数量给您筛呀？"
      : "我好按数量给您筛，咱大概需要多少份呀？";
  } else if (!hasBudget) {
    alternative = `${formatReplyNumber(quantity)}份记下了，咱单份大概想控制在多少钱呢？`;
  } else if (!usageScene) {
    alternative = "数量和预算我都记下了，这次主要是送客户、员工，还是活动用呀？";
  } else if (!stylePreference) {
    alternative = `${usageScene}记下了。咱想要实用耐用一点，还是礼赠氛围更强一点？`;
  } else {
    alternative = `好呢，我按${stylePreference}这个方向继续给您挑几款哈`;
  }
  return {
    reply: alternative && normalizeReplyForComparison(alternative) !== normalizeReplyForComparison(current)
      ? alternative
      : current,
    applied: Boolean(alternative && normalizeReplyForComparison(alternative) !== normalizeReplyForComparison(current)),
    previousReply: latest,
    reason: alternative ? "exact_reply_rewritten" : null,
    repeatedField: null,
  };
}

function buildDirectCustomerAnswer(route = {}) {
  if (!["auto_agent", "collect_info"].includes(String(route.action || "")) || (route.riskFlags || []).length) return null;
  const agentKey = String(route.agentKey || "");
  if (!["pre_sales", "gift_design", "logistics_exception"].includes(agentKey)) return null;
  const text = String(route.text || "").trim();
  const stylePreference = String(route.salesContext?.stylePreference || "").trim();

  if (agentKey !== "logistics_exception" && /有哪些款式|有哪几款|有哪些款|都有什么款|什么款式|看看款式|发几个款/.test(text)) {
    return {
      intent: "style_options",
      text: stylePreference
        ? `有简约实用、商务礼赠和节日氛围这几类，我先按${stylePreference}这个方向给您筛几款哈。`
        : "有简约实用、商务礼赠和节日氛围这几类，我先按数量帮您筛。您大概需要多少份呀？",
    };
  }
  if (agentKey !== "logistics_exception" && /有现货|库存|缺货|还有货|现货多不多/.test(text)) {
    return {
      intent: "inventory",
      text: "现货要按具体款式和数量实时核，我先不乱报。您把看中的款发我，我马上帮您查。",
    };
  }
  if (/多久.{0,6}(?:发|到)|什么时候.{0,6}(?:发|到)|交期|几天.{0,6}(?:发|到)|能不能.{0,10}(?:前|号).{0,4}到/.test(text)) {
    return {
      intent: "lead_time",
      text: "发货时间要看款式、数量和是否定制。您把看中的款和要货日期发我，我按这个给您核准。",
    };
  }
  if (agentKey !== "logistics_exception" && /logo|印字|刻字|加字|定制.{0,6}(?:字|标|logo)/i.test(text)) {
    return {
      intent: "logo_customization",
      text: "多数款可以加 Logo，具体要看产品材质和工艺。您把看中的款和 Logo 文件发我，我帮您确认。",
    };
  }
  if (agentKey !== "logistics_exception" && /样品|寄样|看样/.test(text)) {
    return {
      intent: "sample",
      text: "可以先确认样品，不过样品更适合数量较多、意向明确的订单。您把看中的款发我，我先核样品和费用。",
    };
  }
  if (
    agentKey !== "logistics_exception"
    && /卡片|贺卡|祝福卡|感谢卡|心意卡/.test(text)
    && /(?:不要(?:这个)?花|不要花|去掉花|无花)/i.test(text)
  ) {
    return {
      intent: "greeting_card_revision",
      text: "收到，这版不要花。我会去掉花朵元素，保留当前贺卡方向，重新按客户要求出无花版本给您确认。",
    };
  }
  if (
    agentKey !== "logistics_exception"
    && /卡片|贺卡|祝福卡|感谢卡|心意卡/.test(text)
    && /(?:盒子(?:的)?尺寸|尺寸是(?:盒子|包装|礼盒)|1\s*[:：]\s*1|正方形|方形|主题(?:色|颜色)|紫色)/i.test(text)
  ) {
    const parts = [];
    if (/(?:盒子(?:的)?尺寸|尺寸是(?:盒子|包装|礼盒))/i.test(text)) parts.push("盒子尺寸只作为包装适配参考");
    if (/(?:1\s*[:：]\s*1|正方形|方形)/i.test(text)) parts.push("贺卡按 1:1 正方形处理");
    if (/(?:主题(?:色|颜色)|紫色)/i.test(text)) parts.push("主题色用紫色");
    return {
      intent: "greeting_card_requirements",
      text: `明白，${parts.length ? parts.join("；") : "我会按您补充的要求调整贺卡"}。我会直接按这个要求生成贺卡版本给您确认。`,
    };
  }
  if (
    agentKey !== "logistics_exception"
    && /卡片|贺卡|祝福卡|感谢卡|心意卡/.test(text)
    && /再设计|重新设计|重做|调整|改|适配|盒子|尺寸/.test(text)
  ) {
    return {
      intent: "packaging_adjustment",
      text: "收到，卡片可以重新调整。我会按您给的盒子尺寸做适配；如果需要保留原图细节，我会以原图和原文为准，不乱改。",
    };
  }
  if (agentKey !== "logistics_exception" && /包装|礼盒|盒子|卡片|贺卡/.test(text) && /换|调整|改|合适|尺寸|装得下|再设计|重新设计|重做|适配/.test(text)) {
    return {
      intent: "packaging_adjustment",
      text: "包装可以调整，但要按产品尺寸试装，避免盒子不合适。您把想保留的产品和包装要求发我，我按尺寸核。",
    };
  }
  if (agentKey !== "logistics_exception" && /多少钱|怎么卖|价格|单价|报价/.test(text)) {
    return {
      intent: "price_explanation",
      text: "具体价格要按款式、数量和定制内容核，数量不同单价也会变。我先不报虚价，您大概需要多少份呀？",
    };
  }
  if (agentKey !== "logistics_exception" && /好贵|太贵|超预算|便宜一点|便宜点|优惠|再少点/.test(text)) {
    return {
      intent: "price_adjustment",
      text: "可以往更精简的搭配调，我会保留完整礼盒，不拿零散配件凑。您有大概预算时发我，我按这个范围改哈。",
    };
  }
  return null;
}

function detectRequestedReplyField(reply) {
  const text = String(reply || "").trim();
  if (!text) return null;
  if (/多少份|要多少(?:份|个|套|盒|件)|数量.{0,8}(?:发我|告诉我|确定)/.test(text)) return "quantity";
  if (/预算.{0,10}(?:多少|呢|发我|告诉我|确定)|单份.{0,14}(?:预算|价位|多少钱|控制在)|大概多少钱/.test(text)) return "budget";
  if (/什么场景|什么用途|主要.{0,6}(?:送|用)|送客户还是员工|送给谁|什么活动/.test(text)) return "usage_scene";
  if (
    /实用.{0,8}(?:还是|或).{0,8}氛围感|氛围感.{0,8}(?:还是|或).{0,8}实用/.test(text)
    || /(?:咱|您).{0,8}(?:偏|想要|喜欢).{0,8}(?:实用|氛围|简约|高级|可爱|质感)/.test(text)
    || /更喜欢.{0,8}(?:哪|什么)/.test(text)
  ) return "style_preference";
  return null;
}

function currentTurnSuppliedField(route, field) {
  return (route.salesContext?.currentFields || []).includes(field);
}

function buildDeferredFieldReply(route, field) {
  const usageScene = String(route.salesContext?.usageScene || "").trim();
  const stylePreference = String(route.salesContext?.stylePreference || "").trim();
  const knownDirection = [usageScene, stylePreference ? `偏${stylePreference}` : ""].filter(Boolean).join("、");
  const text = String(route.text || "");
  if (field === "quantity") {
    if (/多少钱|怎么卖|价格|单价|报价/.test(text)) {
      return "具体价格要按款式、数量和定制内容核，我先不报虚价。数量确定后我给您报准价哈。";
    }
    return `${knownDirection ? `${knownDirection}我记下了，` : ""}我先给您看几款合适的，数量确定后再发我就行哈。`;
  }
  if (field === "budget") {
    return `${knownDirection ? `${knownDirection}我记下了，` : ""}我先按这个方向整理可选款，预算确定后再发我就行哈。`;
  }
  if (field === "usage_scene") {
    return "数量和预算我都记着，我先按通用礼赠方向整理；具体用途确定后再补充就行哈。";
  }
  if (field === "style_preference") {
    return `${usageScene ? `${usageScene}我记下了，` : ""}我先给您看几种不同方向，偏好确定后再缩小范围就行哈。`;
  }
  return "前面的信息我都记着，我先回答您当前这个问题，不让您重复提供。";
}

function normalizeReplyForComparison(value) {
  return String(value || "").replace(/[\s，。！？、,.!?]/g, "").toLowerCase();
}

function formatReplyNumber(value) {
  return Number.isInteger(Number(value)) ? String(Number(value)) : String(Math.round(Number(value) * 100) / 100);
}

function composeCatalogReply(route, catalogMatches = [], recommendation = null) {
  const quantity = positiveNumberOrNull(route.budget?.quantity);
  if (recommendation?.items?.length) {
    const visibleItems = recommendation.items.slice(0, 4);
    const items = visibleItems
      .map((item) => `${item.name || item.skuCode}${item.salePrice ? ` ${formatMoney(item.salePrice)}元` : ""}`)
      .join("＋");
    const remaining = recommendation.items.length - visibleItems.length;
    const itemCount = remaining > 0 ? `等 ${recommendation.items.length} 件` : "";
    const price = recommendation.totalSalePrice ? `，单份完整组合商品库合计 ${formatMoney(recommendation.totalSalePrice)} 元` : "";
    const humanPrice = recommendation.totalSalePrice ? `，单份 ${formatMoney(recommendation.totalSalePrice)} 元` : "";
    const stock = quantity
      ? recommendation.enough
        ? `，${quantity} 份库存够的`
        : recommendation.capacity
          ? `，当前库存最多能做 ${recommendation.capacity} 份`
          : "，库存需要人工核对"
      : "";
    const usageScene = String(route.salesContext?.usageScene || "").trim();
    const stylePreference = String(route.salesContext?.stylePreference || "").trim();
    if (route.agentKey === "pre_sales" && usageScene) {
      const preference = stylePreference ? `、偏${stylePreference}` : "";
      if (recommendation.status !== "ready" || recommendation.warnings.length) {
        return `好呢，${usageScene}${preference}我记下了。这档预算暂时没配出完整礼盒，我先不拿零散配件凑，给您补一套完整搭配再发哈。`;
      }
      return `好呢，按${usageScene}${preference}，我先给您搭：${items}${itemCount}${humanPrice}${stock}。您看这套可以吗？`;
    }
    return `按您提供的预算，当前商品库可先参考：${items}${itemCount}${price}${stock}。`;
  }
  const matched = catalogMatches[0];
  if (!matched) return "";
  const stock = quantity
    ? matched.stock >= quantity
      ? `，当前库存可支持 ${quantity} 件`
      : `，当前库存 ${matched.stock} 件，距离 ${quantity} 件还差 ${quantity - matched.stock} 件`
    : `，当前登记库存 ${matched.stock} 件`;
  const leadTime = matched.leadTimeDays ? `，常规备货约 ${matched.leadTimeDays} 天` : "";
  return `当前商品库中，${matched.name}（${matched.skuCode}）登记单价 ${formatMoney(matched.salePrice)} 元${stock}${leadTime}。`;
}

function buildPreSalesReply(route) {
  const quantity = positiveNumberOrNull(route.budget?.quantity);
  const quantityText = quantity ? `我已记录 ${quantity} 件` : "请告诉我需要的数量";
  if (/多少钱|价格|优惠|报价|单价/.test(route.text || "")) {
    return `可以核价。请把商品名称、SKU 或图片发我，${quantityText}；还需确认收货城市、是否含税/运费以及 Logo 工艺。系统会先按商品库核对，最终阶梯优惠由人工确认。`;
  }
  return "可以推荐。请告诉我用途、单份预算、数量、交期，以及是否需要 Logo；我会先从商品库给出可执行搭配，并明确库存与待人工确认项。";
}

function normalizeCatalogText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "").trim();
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatMoney(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function buildSafetyChecks(route) {
  return [
    {
      key: "no_cross_conversation",
      passed: true,
      label: "只基于当前客户消息生成草稿，不直接发送到其他会话。",
    },
    {
      key: "manual_review_guard",
      passed: route.action !== "manual_review" || route.manualRequired === true,
      label: "高价值或风险问题保留人工审核。",
    },
    {
      key: "missing_info_guard",
      passed: route.action !== "auto_agent" || !(route.missingFields || []).length,
      label: "信息缺失时先追问，不直接调用设计或报价。",
    },
    {
      key: "scene_clarity_guard",
      passed: !["weak", "ambiguous", "unmatched"].includes(route.sceneDecision?.status || "") || route.action !== "auto_agent",
      label: "场景不清晰时先确认处理重点。",
    },
  ];
}

function inferNextAction(route) {
  if (route.action === "manual_review") return "handoff_to_human";
  if ((route.missingFields || []).includes("scene_clarification")) return "clarify_scene";
  if (route.action === "collect_info") return "ask_missing_fields";
  if (route.agentKey === "gift_design") return "prepare_bundle_and_design_job";
  return "agent_reply_draft";
}

function extractReplyExcerpt(content) {
  const value = String(content || "");
  const match = value.match(/客服[:：]\s*([\s\S]+)$/);
  const parts = String(match ? match[1] : value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  return truncate(parts.join(" ｜ "), 240);
}

function isHumanVerbatimKnowledge(entry = {}) {
  return entry.sourceType === "chat_import" && /脱敏原话|sanitized verbatim/i.test(String(entry.reviewNote || ""));
}

function formatHumanVerbatimReply(value) {
  return String(value || "")
    .split(/\s*｜\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeKnowledgeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function characterBigramSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftGrams = characterNgrams(left, 2);
  const rightGrams = characterNgrams(right, 2);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let overlap = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) overlap += 1;
  return (2 * overlap) / (leftGrams.size + rightGrams.size);
}

function characterNgrams(value, size) {
  const grams = new Set();
  if (value.length < size) {
    grams.add(value);
    return grams;
  }
  for (let index = 0; index <= value.length - size; index += 1) grams.add(value.slice(index, index + size));
  return grams;
}

function fieldLabel(field) {
  const labels = {
    budget: "预算",
    quantity: "数量",
    customer_assets: "Logo 或参考图",
    usage_scene: "用途场景",
    order_or_tracking: "订单号或快递单号",
    height: "身高",
    weight: "体重",
    order_or_evidence: "订单信息或问题凭证",
    order_or_payment_info: "订单或付款信息",
    scene_clarification: "要优先处理的问题",
  };
  return labels[field] || field;
}

function buildMissingFieldQuestion(field) {
  const replies = {
    budget: "先定一下单份预算，大概希望控制在多少？",
    quantity: "这次大概需要多少份？",
    customer_assets: "把 Logo 文件或参考图发我，我接着往下做。",
    usage_scene: "这批主要送客户、员工，还是活动使用？",
    order_or_tracking: "把订单号或快递单号发我，我来接着查。",
    height: "身高大概多少？",
    weight: "体重大概多少？",
    order_or_evidence: "把订单信息和问题照片发我，我先核对具体情况。",
    order_or_payment_info: "把订单号或付款信息发我，我先核对。",
  };
  return replies[field] || `还差一项${fieldLabel(field || "关键信息")}，您补充一下就行。`;
}

function normalizeSkillName(name) {
  const text = String(name || "").trim();
  const aliases = {
    "棰勭畻婢勬竻": "预算澄清",
    "闇€姹傛緞娓?": "需求澄清",
    "璁捐闇€姹傜‘璁?": "设计需求确认",
    "鐗╂祦瀹夋姎": "物流安抚",
    "鍞悗鏂规": "售后方案",
    "楂樻儏鍟嗚瘽鏈?": "高情商话术",
  };
  return aliases[text] || text;
}

function truncate(text, maxLength) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

module.exports = {
  buildAgentReplyDraft,
  enforceCatalogDataReplyPolicy,
  matchCatalog,
  knowledgeIdentityMatches,
  matchKnowledge,
  selectSkills,
  avoidRepeatedReply,
};
