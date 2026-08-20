"use strict";

const { classifyScene } = require("./chatTraining");
const { isHighValueBudget, mergeBudgetContext, parseBudget } = require("./budget");
const { buildBasicCustomerServiceScene, classifyBasicCustomerServiceQuestion } = require("./basicCustomerService");

const SENSITIVE_PATTERNS = [
  /投诉/,
  /差评/,
  /平台介入/,
  /维权/,
  /赔偿/,
  /法律/,
  /报警/,
  /假货/,
  /辱骂/,
  /曝光/,
  /12315/,
];

function evaluateAgentRoute(input = {}, options = {}) {
  const text = String(input.text || "");
  const clarificationContext = input.clarificationContext || options.clarificationContext;
  const priorSalesContext = input.salesContext || options.salesContext || {};
  const basicQuestion = classifyBasicCustomerServiceQuestion(text);
  const classifiedScene = basicQuestion
    ? buildBasicCustomerServiceScene(basicQuestion)
    : applySalesConversationContinuity(
        applySceneMemory(classifyScene(text), text, options.sceneMemory || options.routeCorrectionSamples || []),
        text,
        priorSalesContext,
      );
  const clarificationResolution = basicQuestion
    ? null
    : resolveSceneClarification(
        text,
        clarificationContext,
        classifiedScene,
      );
  const followupResolution = basicQuestion || clarificationResolution
    ? null
    : resolvePendingFieldAnswer(
        text,
        input.followupContext || options.followupContext,
        classifiedScene,
      );
  const scene = clarificationResolution?.resolvedScene || followupResolution?.resolvedScene || classifiedScene;
  const sceneDecision = clarificationResolution
    ? buildResolvedSceneDecision(clarificationResolution)
    : followupResolution
      ? buildResolvedFollowupDecision(followupResolution)
      : buildSceneDecision(scene);
  const priorClarificationAttempt = clarificationContext?.sceneClarification?.required
    ? Math.max(1, Number(clarificationContext.sceneClarification.attempt || 1))
    : 0;
  const clarificationExhausted = Boolean(
    !clarificationResolution
    && !followupResolution
    && clarificationContext?.sceneClarification?.required
    && priorClarificationAttempt >= 2,
  );
  const sceneClarification = clarificationResolution || followupResolution || clarificationExhausted
    ? null
    : buildSceneClarification(sceneDecision, { attempt: priorClarificationAttempt + 1 });
  const parsedBudget = shouldParseBudgetForRoute(text, scene.agentKey) ? parseBudget(text) : null;
  const currentUsageScene = extractSalesUsageScene(text);
  const currentStylePreference = extractSalesStylePreference(text);
  const priorUsageScene = normalizeUsageContext(input.usageContext || options.usageContext || priorSalesContext);
  const usageChanged = Boolean(currentUsageScene && priorUsageScene && currentUsageScene !== priorUsageScene);
  const budgetContext = usageChanged
    ? null
    : compatibleBudgetContext(input.budgetContext || options.budgetContext, scene.agentKey);
  const budget = input.budget || mergeBudgetContext(parsedBudget, budgetContext);
  const usageScene = currentUsageScene || priorUsageScene;
  const stylePreference = currentStylePreference
    || (usageChanged ? null : normalizeStylePreference(input.styleContext || options.styleContext || priorSalesContext));
  const salesContext = {
    usageScene: usageScene || null,
    stylePreference: stylePreference || null,
    contextReset: usageChanged ? "usage_scene_changed" : null,
    currentFields: [...new Set([
      followupResolution?.requestedField,
      Number(parsedBudget?.quantity || 0) > 0 ? "quantity" : null,
      Number(parsedBudget?.perUnitAmount || parsedBudget?.totalAmount || 0) > 0 ? "budget" : null,
      currentUsageScene ? "usage_scene" : null,
      currentStylePreference ? "style_preference" : null,
    ].filter(Boolean))],
    currentField: followupResolution?.requestedField
      || (currentUsageScene ? "usage_scene" : null)
      || (currentStylePreference ? "style_preference" : null),
  };
  const highValue = isHighValueBudget(budget, Number(options.highValueAmountCny || 10000));
  const riskFlags = detectRiskFlags(text);
  const missing = basicQuestion ? [] : detectMissingFields(text, scene.agentKey, budget);
  if (!basicQuestion && ["ambiguous", "weak", "unmatched"].includes(sceneDecision.status)) {
    missing.unshift("scene_clarification");
  }

  const action = decideAction({
    highValue,
    riskFlags,
    missing,
    agentKey: scene.agentKey,
    sceneDecision,
    basicQuestion,
    clarificationExhausted,
  });
  const sceneAudit = buildSceneAudit({
    scene,
    sceneDecision,
    sceneClarification,
    clarificationResolution,
    clarificationExhausted,
    followupResolution,
    sceneMemory: scene.sceneMemory || null,
    budget,
    salesContext,
    highValue,
    riskFlags,
    missing,
    action,
  });
  const routingPolicy = buildRoutingPolicy({
    scene,
    sceneDecision,
    sceneClarification,
    budget,
    highValue,
    riskFlags,
    missing,
    action,
    sceneAudit,
  });
  return {
    text,
    channel: input.channel || "wechat",
    scene: scene.scene,
    agentKey: scene.agentKey,
    sceneScore: scene.score || 0,
    sceneScores: scene.scores || [],
    matchedKeywords: scene.matchedKeywords || [],
    basicIntent: basicQuestion?.intent || null,
    basicAnswer: basicQuestion?.answer || null,
    sceneDecision,
    sceneClarification,
    clarificationResolution,
    clarificationExhausted,
    followupResolution,
    sceneMemory: scene.sceneMemory || null,
    sceneAudit,
    budget,
    salesContext,
    isHighValue: highValue,
    riskFlags,
    missingFields: missing,
    action,
    routingPolicy,
    manualRequired: action === "manual_review",
    confidence: calculateConfidence(scene, budget, missing, riskFlags),
    suggestedReply: basicQuestion?.answer || buildSuggestedReply({ scene, budget, missing, action, highValue, riskFlags, text }),
  };
}

function applySalesConversationContinuity(scene, text, priorSalesContext) {
  const decision = buildSceneDecision(scene || {});
  if (decision.status === "clear") return scene;
  const explicitUsageScene = extractSalesUsageScene(text);
  if (explicitUsageScene) {
    const marker = "conversation:explicit_usage_scene";
    return {
      scene: "售前转化",
      agentKey: "pre_sales",
      hits: 1,
      score: 24,
      matchedKeywords: [marker],
      scores: [{ scene: "售前转化", agentKey: "pre_sales", score: 24, matchedKeywords: [marker] }],
      conversationContext: { source: "explicit_usage_scene", usageScene: explicitUsageScene },
    };
  }
  const usageScene = normalizeUsageContext(priorSalesContext);
  const stylePreference = normalizeStylePreference(priorSalesContext);
  if (!usageScene && !stylePreference) return scene;
  if (!/还有别的|还有其他|其他款|换一个|换一款|换款|再看看其他|再看别的|这个不喜欢|不太喜欢|简单一点|简约一点|实用一点|氛围感一点|商务一点|大气一点|高级一点|这个呢|哪个好/.test(String(text || ""))) {
    return scene;
  }
  const marker = "conversation:sales_followup";
  return {
    scene: "售前转化",
    agentKey: "pre_sales",
    hits: 1,
    score: 24,
    matchedKeywords: [marker],
    scores: [{ scene: "售前转化", agentKey: "pre_sales", score: 24, matchedKeywords: [marker] }],
    conversationContext: {
      source: "sales_context",
      usageScene: usageScene || null,
      stylePreference: stylePreference || null,
    },
  };
}

function compatibleBudgetContext(context, agentKey) {
  if (!context || typeof context !== "object") return null;
  const sourceAgentKey = String(context.sourceAgentKey || "").trim();
  if (!sourceAgentKey || sourceAgentKey === agentKey) return context;
  const giftAgents = new Set(["gift_design", "pre_sales"]);
  return giftAgents.has(sourceAgentKey) && giftAgents.has(agentKey) ? context : null;
}

function applySceneMemory(classifiedScene, text, sceneMemory = []) {
  const matches = findSceneMemoryMatches(text, sceneMemory);
  const best = matches[0] || null;
  if (!best) return { ...classifiedScene, sceneMemory: null };

  const currentScore = Number(classifiedScene.score || 0);
  const sameAgent = classifiedScene.agentKey === best.agentKey;
  const marker = sceneMemoryMarker(best.sourceType);
  const shouldApply = shouldApplySceneMemory({ best, currentScore, sameAgent });

  const memoryCandidate = {
    scene: best.scene,
    agentKey: best.agentKey,
    score: Math.max(18, Math.round(best.score * (best.sourceType === "chat_import" ? 0.45 : 0.55))),
    matchedKeywords: [marker],
  };

  const baseMemory = {
    matched: true,
    applied: shouldApply,
    score: best.score,
    sampleId: best.sampleId,
    sourceType: best.sourceType,
    sourceRouteId: best.sourceRouteId || null,
    importId: best.importId || null,
    agentKey: best.agentKey,
    scene: best.scene,
    reason: shouldApply ? (sameAgent ? `${best.sourceType}_memory_boost` : marker) : "current_scene_has_stronger_keywords",
  };

  if (!shouldApply) {
    return {
      ...classifiedScene,
      sceneMemory: {
        ...baseMemory,
        originalAgentKey: classifiedScene.agentKey,
        originalScene: classifiedScene.scene,
      },
    };
  }

  if (sameAgent) {
    const boost = Math.max(6, Math.round(best.score / 8));
    const boostedScore = Math.max(currentScore + boost, memoryCandidate.score);
    const topScore = {
      scene: classifiedScene.scene,
      agentKey: classifiedScene.agentKey,
      score: boostedScore,
      matchedKeywords: [...new Set([...(classifiedScene.matchedKeywords || []), marker])],
    };
    const scores = [topScore, ...(classifiedScene.scores || []).filter((item) => item.agentKey !== classifiedScene.agentKey)].slice(0, 5);
    return {
      ...classifiedScene,
      score: boostedScore,
      matchedKeywords: topScore.matchedKeywords,
      scores,
      sceneMemory: baseMemory,
    };
  }

  const scores = [
    memoryCandidate,
    ...(classifiedScene.scores || []).filter((item) => item.agentKey !== memoryCandidate.agentKey),
  ].slice(0, 5);
  return {
    ...classifiedScene,
    scene: best.scene,
    agentKey: best.agentKey,
    hits: Math.max(1, classifiedScene.hits || 0),
    score: Math.max(memoryCandidate.score, currentScore),
    matchedKeywords: [marker],
    scores,
    sceneMemory: {
      ...baseMemory,
      originalAgentKey: classifiedScene.agentKey,
      originalScene: classifiedScene.scene,
      originalScore: currentScore,
    },
  };
}

function findSceneMemoryMatches(text, sceneMemory = []) {
  const content = normalizeSceneMemoryText(text);
  if (!content) return [];
  return (Array.isArray(sceneMemory) ? sceneMemory : [])
    .map((sample) => scoreSceneMemorySample(content, sample))
    .filter((match) => match && match.score >= 50)
    .sort((a, b) => b.score - a.score || Number(b.sampleScore || 0) - Number(a.sampleScore || 0))
    .slice(0, 5);
}

function scoreSceneMemorySample(content, sample = {}) {
  const sourceType = sceneMemorySourceType(sample);
  if (!sourceType) return null;
  if (String(sample.status || "ready") !== "ready") return null;
  if (!sample.agentKey) return null;
  if (sample.quality?.usage?.routeMemory === false) return null;
  const sampleScore = Number(sample.score || 0);
  if (sourceType === "route_correction" && sampleScore && sampleScore < 70) return null;
  if (sourceType === "chat_import" && sampleScore < 85) return null;
  if (sourceType === "chat_import" && !isChatImportSceneMemoryConfirmed(sample)) return null;
  if (sourceType === "chat_import" && sample.quality?.trainable === false) return null;
  if (sourceType === "chat_import" && ["review", "risk", "blocked"].includes(String(sample.quality?.level || ""))) return null;
  const sampleText = normalizeSceneMemoryText(sample.customerText || sample.question || sample.text);
  if (!sampleText || sampleText.length < 4) return null;

  let score = 0;
  if (content === sampleText) {
    score = 100;
  } else if (content.includes(sampleText) || sampleText.includes(content)) {
    const ratio = Math.min(content.length, sampleText.length) / Math.max(content.length, sampleText.length);
    score = Math.round(78 + ratio * 18);
  } else {
    score = Math.round(sceneMemoryDiceScore(content, sampleText) * 100);
  }
  if (score < 50) return null;
  return {
    score,
    sampleScore,
    sampleId: sample.id || null,
    sourceRouteId: sample.sourceRouteId || null,
    importId: sample.importId || null,
    sourceType,
    agentKey: sample.agentKey,
    scene: sample.scene || SCENE_META[sample.agentKey]?.scene || sample.agentKey,
  };
}

function isChatImportSceneMemoryConfirmed(sample = {}) {
  const sceneCheck = sample.sceneCheck || sample.sceneDecision || null;
  if (sceneCheck?.status) return sceneCheck.status === "clear";
  if (sample.sceneScore === undefined || sample.sceneScore === null) return true;
  const sceneScore = Number(sample.sceneScore || 0);
  return Number.isFinite(sceneScore) && sceneScore >= 14;
}

function sceneMemorySourceType(sample = {}) {
  const sourceType = String(sample.sourceType || "").trim();
  if (sourceType === "route_correction") return "route_correction";
  if (sourceType === "chat_import") return "chat_import";
  if (sample.sourceRouteId) return "route_correction";
  if (sample.importId) return "chat_import";
  return "";
}

function sceneMemoryMarker(sourceType) {
  return sourceType === "chat_import" ? "chat_import_memory" : "route_correction_memory";
}

function shouldApplySceneMemory({ best, currentScore, sameAgent }) {
  if (best.sourceType === "chat_import") {
    return best.score >= 98 || currentScore < 8 || (currentScore < 16 && best.score >= 88) || (sameAgent && best.score >= 70);
  }
  return best.score >= 92 || currentScore < 14 || (currentScore < 24 && best.score >= 74) || sameAgent;
}

function sceneMemoryDiceScore(left, right) {
  const leftGrams = textNgrams(left);
  const rightGrams = textNgrams(right);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let overlap = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (leftGrams.size + rightGrams.size);
}

function textNgrams(text, size = 2) {
  const value = String(text || "");
  const grams = new Set();
  if (value.length <= size) {
    if (value) grams.add(value);
    return grams;
  }
  for (let index = 0; index <= value.length - size; index += 1) {
    grams.add(value.slice(index, index + size));
  }
  return grams;
}

function normalizeSceneMemoryText(value) {
  const compact = String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");
  const normalized = compact
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/[锛屻€傦紒锛熴€?.!?;锛?锛?'鈥溾€濃€樷€橾]/g, "");
  return normalized.length >= 4 ? normalized : compact;
}

const SCENE_META = {
  gift_design: { scene: "礼盒设计", label: "礼盒设计/效果图" },
  order_payment: { scene: "下单支付", label: "下单支付/发票地址" },
  logistics_exception: { scene: "物流异常", label: "物流发货/签收异常" },
  after_sales: { scene: "售后安抚", label: "售后退款/破损补发" },
  pre_sales: { scene: "售前转化", label: "售前咨询/商品推荐" },
  general: { scene: "未分类", label: "人工确认" },
};

function weightedAliases(values = [], weight = 10) {
  return values.map((value) => ({
    value,
    weight: String(value || "").length >= 4 ? weight + 2 : weight,
  }));
}

function normalizeClarificationText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?;；:："'“”‘’]/g, "");
}

const SCENE_RESOLUTION_ALIASES = {
  gift_design: weightedAliases([
    "设计图",
    "效果图",
    "出图",
    "看图",
    "图片",
    "摆拍",
    "礼盒",
    "搭配",
    "包装",
    "logo",
    "卡片",
    "贺卡",
    "盒子尺寸",
    "盒子是",
    "再设计",
    "重新设计",
    "重设计",
  ]),
  order_payment: weightedAliases(["订单", "付款", "支付", "发票", "开票", "地址", "改地址", "收货地址", "下单", "定金", "尾款"]),
  logistics_exception: weightedAliases(["物流", "快递", "发货", "到货", "签收", "派送", "催件", "单号", "没收到"]),
  after_sales: weightedAliases(["售后", "退款", "退货", "换货", "破损", "坏了", "补发", "质量", "少件", "漏发", "赔偿"]),
  pre_sales: weightedAliases(["售前咨询", "商品咨询", "售前", "推荐", "商品", "价格", "优惠", "怎么买", "活动", "有货", "多少钱", "介绍", "对比"]),
};

function resolveSceneClarification(text, context, classifiedScene = null) {
  if (context?.clarificationResolution || context?.sceneDecision?.status === "clear") return null;
  if (!context?.sceneClarification && !context?.options?.length) return null;
  const content = normalizeClarificationText(text);
  if (!content) return null;
  const options = buildClarificationOptions(context);
  const optionPick = pickClarificationOptionByOrdinal(content, options);
  if (optionPick) return buildClarificationResolution(optionPick, text, ["option_pick"], classifiedScene);

  if (options.length === 1 && isAffirmativeClarification(content)) {
    return buildClarificationResolution(options[0], text, ["affirmative"], classifiedScene);
  }

  const candidates = buildResolutionCandidates(context, options);
  const ranked = candidates
    .map((candidate) => scoreClarificationCandidate(content, candidate))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.matchedKeywords.length - a.matchedKeywords.length);
  const top = ranked[0];
  const second = ranked[1];
  if (!top || top.score < 8) return null;
  if (second && top.score - second.score <= 2) return null;
  return buildClarificationResolution(top, text, top.matchedKeywords, classifiedScene);
}

function buildClarificationOptions(context) {
  const source = context.sceneClarification || context;
  const options = Array.isArray(source.options) ? source.options : [];
  return options
    .filter((option) => option?.agentKey)
    .map((option, index) => ({
      ...option,
      index,
      label: option.label || sceneOptionLabel(option.agentKey, option.scene),
      scene: option.scene || SCENE_META[option.agentKey]?.scene || option.agentKey,
    }));
}

function buildResolutionCandidates(context, options) {
  const source = context.sceneClarification || context;
  const allowAll = !options.length || source.type === "confirm_scene" || source.type === "describe_scene";
  const candidates = allowAll
    ? Object.keys(SCENE_META).filter((agentKey) => agentKey !== "general").map((agentKey) => ({
        agentKey,
        scene: SCENE_META[agentKey].scene,
        label: SCENE_META[agentKey].label,
      }))
    : options;
  return candidates.filter((candidate, index, list) => list.findIndex((item) => item.agentKey === candidate.agentKey) === index);
}

function pickClarificationOptionByOrdinal(content, options) {
  if (!options.length) return null;
  const first = options[0];
  const second = options[1];
  if (first && /^(1|一|第一个|第1个|前一个|前面|a|A)$/i.test(content)) return first;
  if (second && /^(2|二|第二个|第2个|后一个|后面|b|B)$/i.test(content)) return second;
  return null;
}

function isAffirmativeClarification(content) {
  return /^(是|对|对的|是的|没错|就是这个|就这个|这个|可以|嗯|好)$/i.test(content);
}

function scoreClarificationCandidate(content, candidate) {
  const aliases = SCENE_RESOLUTION_ALIASES[candidate.agentKey] || [];
  const matchedKeywords = [];
  let score = 0;
  for (const alias of aliases) {
    const value = normalizeClarificationText(alias.value);
    if (!value || !content.includes(value)) continue;
    matchedKeywords.push(alias.value);
    score += alias.weight;
  }
  const label = normalizeClarificationText(candidate.label || candidate.scene);
  if (label && content.includes(label)) {
    matchedKeywords.push(candidate.label || candidate.scene);
    score += 16;
  }
  return { ...candidate, score, matchedKeywords: [...new Set(matchedKeywords)] };
}

function buildClarificationResolution(candidate, text, matchedKeywords, classifiedScene) {
  const agentKey = candidate.agentKey;
  const sceneName = candidate.scene || SCENE_META[agentKey]?.scene || agentKey;
  const score = Math.max(Number(candidate.score || 0), 30);
  const topScene = {
    scene: sceneName,
    agentKey,
    score,
    matchedKeywords: matchedKeywords || [],
  };
  const remainingScores = (classifiedScene?.scores || []).filter((item) => item.agentKey !== agentKey);
  return {
    type: "customer_scene_clarification",
    text,
    agentKey,
    scene: sceneName,
    label: candidate.label || sceneOptionLabel(agentKey, sceneName),
    matchedKeywords: matchedKeywords || [],
    confidence: "high",
    resolvedScene: {
      scene: sceneName,
      agentKey,
      hits: Math.max(1, (matchedKeywords || []).length),
      score,
      matchedKeywords: matchedKeywords || [],
      scores: [topScene, ...remainingScores].slice(0, 5),
    },
  };
}

function buildResolvedSceneDecision(resolution) {
  const resolvedScene = resolution.resolvedScene;
  const topScene = {
    scene: resolvedScene.scene,
    agentKey: resolution.agentKey,
    score: resolvedScene.score,
    matchedKeywords: resolution.matchedKeywords || [],
  };
  return {
    status: "clear",
    reason: "customer_scene_clarified",
    topScene,
    secondaryScene: null,
    scoreGap: topScene.score,
  };
}

function findPendingSceneClarificationContext(routeEvaluations = [], conversationId) {
  if (!conversationId || !Array.isArray(routeEvaluations)) return null;
  const latest = routeEvaluations
    .filter((route) => route?.conversationId === conversationId)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  if (!latest?.sceneClarification?.required) return null;
  if (latest.clarificationResolution) return null;
  return latest;
}

function findPendingFieldQuestionContext(routeEvaluations = [], conversationId) {
  if (!conversationId || !Array.isArray(routeEvaluations)) return null;
  const recent = routeEvaluations
    .filter((route) => route?.conversationId === conversationId)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 12);
  if (!recent.length || recent[0].action === "manual_review" || (recent[0].riskFlags || []).length) return null;
  for (let index = 0; index < recent.length; index += 1) {
    const route = recent[index];
    if (route.action === "manual_review" || (route.riskFlags || []).length) break;
    const question = String(route.suggestedReply || route.replyDraft?.ruleSuggestedReply || "").trim();
    const requestedField = detectRequestedField(question);
    if (!requestedField) continue;
    const newerRoutes = recent.slice(0, index);
    const superseded = newerRoutes.some((item) => {
      const salesContext = item?.salesContext || item?.replyDraft?.salesContext || {};
      return salesContext.contextReset === "usage_scene_changed"
        || (salesContext.currentFields || []).includes(requestedField);
    });
    if (superseded) continue;
    return {
      routeId: route.id || null,
      conversationId,
      requestedField,
      question,
      agentKey: String(route.agentKey || "pre_sales"),
      scene: String(route.scene || "售前咨询"),
      createdAt: route.createdAt || null,
    };
  }
  return null;
}

function detectRequestedField(question) {
  const text = String(question || "").trim();
  if (!text) return null;
  if (/多少份|要多少(?:份|个|套|盒|件)|数量(?:是多少|多少|大概)/.test(text)) return "quantity";
  if (/预算(?:是多少|多少|大概|呢)|预期价格|单份.{0,14}(?:预算|价位|多少钱|控制在|想控制)|价位|大概多少钱/.test(text)) return "budget";
  if (/什么场景|什么用途|主要.{0,6}(?:送|用)|送客户还是员工|送给谁|什么活动/.test(text)) return "usage_scene";
  if (/实用.{0,10}氛围感|氛围感.{0,10}实用|偏.{0,6}(?:实用|氛围|简约|高级|可爱|质感)/.test(text)) return "style_preference";
  return null;
}

function resolvePendingFieldAnswer(text, context, classifiedScene) {
  if (!context?.requestedField) return null;
  const currentDecision = buildSceneDecision(classifiedScene || {});
  const isSalesConversationContinuation = (classifiedScene?.matchedKeywords || []).includes("conversation:sales_followup");
  if (currentDecision.status === "clear" && !isSalesConversationContinuation) return null;

  let answeredField = context.requestedField;
  let value = extractPendingFieldValue(text, answeredField);
  if (!value && ["pre_sales", "gift_design"].includes(String(context.agentKey || ""))) {
    for (const candidate of ["quantity", "budget", "usage_scene", "style_preference"]) {
      if (candidate === answeredField) continue;
      const candidateValue = extractPendingFieldValue(text, candidate);
      if (!candidateValue) continue;
      answeredField = candidate;
      value = candidateValue;
      break;
    }
  }
  if (!value) return null;
  const agentKey = ["pre_sales", "gift_design"].includes(String(context.agentKey || ""))
    ? String(context.agentKey)
    : "pre_sales";
  const scene = String(context.scene || (agentKey === "gift_design" ? "礼盒设计" : "售前咨询"));
  const marker = `followup:${answeredField}`;
  return {
    type: "customer_field_answer",
    requestedField: answeredField,
    expectedField: context.requestedField,
    value,
    sourceRouteId: context.routeId || null,
    sourceQuestion: context.question || "",
    agentKey,
    scene,
    matchedKeywords: [marker],
    confidence: "high",
    resolvedScene: {
      scene,
      agentKey,
      hits: 1,
      score: 24,
      matchedKeywords: [marker],
      scores: [{ scene, agentKey, score: 24, matchedKeywords: [marker] }],
    },
  };
}

function extractPendingFieldValue(text, requestedField) {
  const value = String(text || "").trim();
  if (!value) return null;
  if (requestedField === "quantity") {
    const quantity = Number(parseBudget(value)?.quantity || 0);
    return quantity > 0 ? { quantity } : null;
  }
  if (requestedField === "budget") {
    const parsed = parseBudget(value);
    const amount = Number(parsed?.perUnitAmount || parsed?.totalAmount || 0);
    return amount > 0 ? parsed : null;
  }
  if (requestedField === "usage_scene") {
    const usageScene = extractSalesUsageScene(value);
    return usageScene ? { usageScene } : null;
  }
  if (requestedField === "style_preference") {
    const stylePreference = extractSalesStylePreference(value);
    return stylePreference ? { stylePreference } : null;
  }
  return null;
}

function extractSalesUsageScene(value) {
  const text = String(value || "").replace(/[，。！？、,.!?]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const namedPatterns = [
    [/教师节.{0,8}(?:送)?老师|送老师.{0,8}教师节/, "教师节送老师"],
    [/中秋.{0,8}(?:送)?客户|送客户.{0,8}中秋/, "中秋送客户"],
    [/中秋.{0,8}(?:送)?员工|送员工.{0,8}中秋/, "中秋送员工"],
    [/员工.{0,6}(?:福利|礼品)|福利.{0,6}员工/, "员工福利"],
    [/公司.{0,8}(?:周年|年会)|周年庆|年会/, "公司活动"],
    [/婚礼|结婚|婚庆/, "婚礼伴手礼"],
    [/开业|开店|开张/, "开业伴手礼"],
    [/酒店|民宿/, "酒店民宿用礼"],
    [/瑜伽|普拉提/, "瑜伽普拉提活动"],
    [/美容院|美业|服装店/, "门店活动"],
    [/医师节/, "医师节用礼"],
    [/教师节/, "教师节用礼"],
    [/中秋/, "中秋用礼"],
    [/送客户|客户礼|客户拜访/, "送客户"],
    [/送员工|员工礼/, "送员工"],
  ];
  const matched = namedPatterns.find(([pattern]) => pattern.test(text));
  if (matched) return matched[1];
  if (/活动|庆典|会议|伴手礼|福利|拜访|送礼|送人/.test(text)) return text.slice(0, 24);
  return null;
}

function normalizeUsageContext(value) {
  if (!value) return null;
  if (typeof value === "string") return String(value).trim() || null;
  return String(value.usageScene || "").trim() || null;
}

function extractSalesStylePreference(value) {
  const text = String(value || "").replace(/[，。！？、,.!?]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/太可爱|不要.{0,6}可爱|不(?:太)?喜欢.{0,8}可爱|可爱.{0,6}(?:不喜欢|不要)/.test(text)) return "简约";
  if (/简单|简洁/.test(text)) return "简约";
  const preferences = ["实用", "氛围感", "简约", "商务", "大气", "高级", "质感", "可爱"];
  return preferences.find((item) => text.includes(item)) || null;
}

function normalizeStylePreference(value) {
  if (!value) return null;
  if (typeof value === "string") return extractSalesStylePreference(value);
  return extractSalesStylePreference(value.stylePreference);
}

function buildResolvedFollowupDecision(resolution) {
  const resolvedScene = resolution.resolvedScene;
  const topScene = {
    scene: resolvedScene.scene,
    agentKey: resolution.agentKey,
    score: resolvedScene.score,
    matchedKeywords: resolution.matchedKeywords || [],
  };
  return {
    status: "clear",
    reason: "customer_field_answered",
    topScene,
    secondaryScene: null,
    scoreGap: topScene.score,
  };
}

function buildSceneClarification(sceneDecision, config = {}) {
  if (!sceneDecision || sceneDecision.status === "clear") return null;
  const attempt = Math.max(1, Number(config.attempt || 1));
  const options = [sceneDecision.topScene, sceneDecision.secondaryScene]
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((other) => other.agentKey === item.agentKey) === index)
    .map((item) => ({
      agentKey: item.agentKey,
      scene: item.scene,
      score: item.score,
      matchedKeywords: item.matchedKeywords || [],
      label: sceneOptionLabel(item.agentKey, item.scene),
    }));

  if (attempt > 1) {
    return {
      required: true,
      type: "describe_scene_retry",
      question: "没关系，您直接用一句话描述现在遇到的具体情况；有订单号、图片或参考图也可以一起发来。",
      options,
      attempt,
    };
  }

  if (sceneDecision.status === "ambiguous" && options.length >= 2) {
    return {
      required: true,
      type: "choose_scene",
      question: `这条消息同时像「${options[0].label}」和「${options[1].label}」。为避免回错，我先确认一下：您现在最想先处理哪一件？`,
      options,
      attempt,
    };
  }

  if (sceneDecision.status === "weak" && options.length) {
    return {
      required: true,
      type: "confirm_scene",
      question: `我先确认一下，您是想让我先处理「${options[0].label}」这个方向吗？如果是订单、售后、物流或设计图，也可以直接告诉我重点。`,
      options,
      attempt,
    };
  }

  return {
    required: true,
    type: "describe_scene",
    question: "我先确认一下，您现在主要想处理哪类问题：商品咨询、设计效果图、订单付款、物流还是售后？",
    options,
    attempt,
  };
}

function sceneOptionLabel(agentKey, scene) {
  const labels = {
    gift_design: "礼盒设计/效果图",
    order_payment: "下单支付/发票地址",
    logistics_exception: "物流发货/签收异常",
    after_sales: "售后退款/破损补发",
    pre_sales: "售前咨询/商品推荐",
    general: "人工确认",
  };
  return labels[agentKey] || scene || agentKey;
}

function buildSceneDecision(scene) {
  if (scene.sceneMemory?.applied) {
    const topScene = {
      scene: scene.scene,
      agentKey: scene.agentKey,
      score: scene.score || 0,
      matchedKeywords: scene.matchedKeywords || [],
    };
    const secondaryScene = (scene.scores || []).find((item) => item.agentKey !== scene.agentKey) || null;
    return {
      status: "clear",
      reason: scene.sceneMemory.reason || "route_correction_memory",
      topScene,
      secondaryScene,
      scoreGap: Number(topScene.score || 0) - Number(secondaryScene?.score || 0),
    };
  }

  const positiveScores = (scene.scores || []).filter((item) => Number(item.score || 0) > 0);
  const top = positiveScores[0] || null;
  const second = positiveScores[1] || null;
  const topScore = Number(top?.score || scene.score || 0);
  const secondScore = Number(second?.score || 0);
  const gap = topScore - secondScore;

  if (!top || topScore <= 0) {
    return {
      status: "unmatched",
      reason: "no_scene_keyword_hit",
      topScene: null,
      secondaryScene: null,
      scoreGap: 0,
    };
  }

  if (topScore < 14) {
    return {
      status: "weak",
      reason: "only_weak_scene_signal",
      topScene: top,
      secondaryScene: second,
      scoreGap: gap,
    };
  }

  if (second && secondScore >= 14 && (gap <= 8 || secondScore / topScore >= 0.72)) {
    return {
      status: "ambiguous",
      reason: "multiple_scene_signals_close",
      topScene: top,
      secondaryScene: second,
      scoreGap: gap,
    };
  }

  return {
    status: "clear",
    reason: "top_scene_confident",
    topScene: top,
    secondaryScene: second,
    scoreGap: gap,
  };
}

function shouldParseBudgetForRoute(text, agentKey) {
  if (agentKey === "gift_design" || agentKey === "pre_sales" || agentKey === "order_payment") return true;
  return /预算|总预算|每盒|每份|单价|金额|价格|报价|元|块|万|定金|尾款|付款|支付/.test(text);
}

function detectRiskFlags(text) {
  const flags = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) flags.push(pattern.source);
  }
  if (/退款|退货|换货/.test(text) && /拒绝|不处理|不给|没人管/.test(text)) flags.push("售后争议");
  if (/(微信付|微信付款|微信收款|微信款|个人微信|个人银行卡)/.test(text) && /(对公|公户|公司.{0,8}打款|退款|退回|退微信|原路退)/.test(text)) {
    flags.push("双重支付或退款流程");
  }
  if (/(繁体字|错别字|错字|乱码)/.test(text) && /(印刷|直接印|生产|定稿)/.test(text)) {
    flags.push("错误设计稿生产风险");
  }
  if (/(随便|临时).{0,8}(logo|品牌名)|帮我.{0,8}(想|编|做).{0,6}(logo|品牌名)/i.test(text)) {
    flags.push("虚构品牌素材风险");
  }
  if (/(淘宝|外部|网上).{0,12}(照着|一模一样|完全一样)|一模一样/.test(text)) {
    flags.push("外部图片或仿制风险");
  }
  if (/月饼.{0,18}(红酒|茶叶|刀叉|混装)|(红酒|茶叶|刀叉).{0,18}月饼/.test(text)) {
    flags.push("月饼混装合规风险");
  }
  return [...new Set(flags)];
}

function detectMissingFields(text, agentKey, budget) {
  const missing = [];
  if (agentKey === "pre_sales") {
    const bulkOrderCue = /大批量|大量|批量|大货|上千|几千|上万|几万/.test(text);
    if (bulkOrderCue && !budget?.quantity) missing.push("quantity");
    if ((bulkOrderCue || Number(budget?.quantity || 0) >= 1000)
      && !budget?.perUnitAmount
      && !budget?.totalAmount) {
      missing.push("budget");
    }
  }
  if (agentKey === "gift_design") {
    if (isStandaloneCreativeMaterialRequest(text)) {
      if (!isCreativeMaterialRequirementUpdate(text) && /logo|素材|参考图|图片|原图|品牌/i.test(text) && !/\[图片\]|已发|上传|附件/.test(text)) {
        missing.push("customer_assets");
      }
      return missing;
    }
    if (!budget?.perUnitAmount && !budget?.totalAmount) missing.push("budget");
    if (!budget?.quantity) missing.push("quantity");
    if (/logo|素材|参考图|图片|品牌/i.test(text) && !/\[图片\]|已发|上传|附件/.test(text)) {
      missing.push("customer_assets");
    }
    if (!/用途|送礼|员工|客户|活动|节日|福利|拜访|伴手礼/.test(text)) missing.push("usage_scene");
  }
  if (agentKey === "logistics_exception" && !/订单|单号|快递号|手机号|尾号/.test(text)) {
    missing.push("order_or_tracking");
  }
  if (agentKey === "after_sales" && !/订单|图片|视频|破损|凭证|单号|照片/.test(text)) {
    missing.push("order_or_evidence");
  }
  if (agentKey === "order_payment" && !/订单|单号|付款|支付|下单|定金|尾款|地址|发票/.test(text)) {
    missing.push("order_or_payment_info");
  }
  return missing;
}

function isStandaloneCreativeMaterialRequest(text) {
  const value = String(text || "");
  if (!/(?:贺卡|祝福卡|感谢卡|心意卡|卡片|吊牌|挂牌|挂签|腰封|围条|海报)/i.test(value)) return false;
  if (/(?:礼盒效果图|搭品|搭配效果图|组合礼盒|套装效果|商品|产品|伴手礼).{0,12}(?:效果图|设计|入镜|展示)|(?:效果图|设计).{0,12}(?:礼盒|搭品|搭配|商品|产品|伴手礼)/i.test(value)) {
    return false;
  }
  if (isCreativeMaterialRequirementUpdate(value)) return true;
  return /(?:做|设计|生成|出|制作|要|需要|想要|想做|来|改|调整|再设计|重新设计|重做)/i.test(value);
}

function isCreativeMaterialRequirementUpdate(text) {
  const value = String(text || "");
  const material = /(?:贺卡|祝福卡|感谢卡|心意卡|卡片)/i.test(value);
  if (!material) return false;
  return /(?:盒子(?:的)?尺寸|尺寸是(?:盒子|包装|礼盒)|1\s*[:：]\s*1|正方形|方形|主题(?:色|颜色)|紫色|不要(?:这个)?花|不要花|去掉花|无花)/i.test(value);
}

function buildCreativeMaterialResolutionReply(text) {
  const value = String(text || "");
  if (!isCreativeMaterialRequirementUpdate(value)) return "";
  if (/(?:不要(?:这个)?花|不要花|去掉花|无花)/i.test(value)) {
    return "收到，这版不要花。我会去掉花朵元素，保留当前贺卡方向，重新按客户要求出无花版本给您确认。";
  }
  const parts = [];
  if (/(?:盒子(?:的)?尺寸|尺寸是(?:盒子|包装|礼盒))/i.test(value)) parts.push("盒子尺寸只作为包装适配参考");
  if (/(?:1\s*[:：]\s*1|正方形|方形)/i.test(value)) parts.push("贺卡按 1:1 正方形处理");
  if (/(?:主题(?:色|颜色)|紫色)/i.test(value)) parts.push("主题色用紫色");
  const summary = parts.length ? parts.join("；") : "我会按您补充的要求调整贺卡";
  return `明白，${summary}。我会直接按这个要求生成贺卡版本给您确认。`;
}

function decideAction({ highValue, riskFlags, missing, agentKey, sceneDecision, basicQuestion, clarificationExhausted }) {
  if (riskFlags.length) return "manual_review";
  if (basicQuestion) return "auto_agent";
  // A high total value must still block design, quoting, payment and order actions.
  // A pre-sales answer may safely describe catalog facts and request quote details,
  // while the final discount/price commitment remains explicitly manual.
  if (highValue && agentKey !== "pre_sales") return "manual_review";
  // A high-value pre-sales request may use the guided catalog lane only when
  // the scene is already clear and no clarification is pending. Otherwise the
  // deterministic acknowledgement path must run before any model assistance.
  if (highValue && (sceneDecision?.status !== "clear" || missing.length)) return "manual_review";
  if (clarificationExhausted) return "manual_review";
  if (sceneDecision?.status === "ambiguous") {
    const keys = [sceneDecision.topScene?.agentKey, sceneDecision.secondaryScene?.agentKey].filter(Boolean);
    if (keys.includes("after_sales") || keys.includes("order_payment")) return "manual_review";
    return "collect_info";
  }
  if (agentKey === "general") return "collect_info";
  if (missing.length) return "collect_info";
  return "auto_agent";
}

function calculateConfidence(scene, budget, missing, riskFlags) {
  let score = 35;
  score += Math.min(Number(scene.score || scene.hits * 12 || 0), 40);
  if (budget?.confidence === "high") score += 15;
  if (budget?.confidence === "medium") score += 8;
  score -= missing.length * 8;
  score -= riskFlags.length * 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildSuggestedReply({ scene, budget, missing, action, highValue, riskFlags, text }) {
  if (action === "manual_review") {
    if (highValue) return "这个需求金额比较重要，我先帮您把预算、数量、用途和素材整理清楚，再交给专人确认方案和报价，避免后面反复改。";
    if (riskFlags.length) return "您这个情况我先认真记录下来，避免处理不准确。我这边马上转人工帮您跟进，后续给您明确处理方案。";
    return "这个问题需要人工确认后再回复，我先帮您转给专人处理。";
  }

  if (action === "collect_info") {
    const labels = missing.map(fieldLabel).join("、");
    return `可以的，我先帮您往下推进。为了处理更准确，还需要您补充一下：${labels}。`;
  }

  if (scene.agentKey === "gift_design") {
    if (isStandaloneCreativeMaterialRequest(text)) {
      const materialReply = buildCreativeMaterialResolutionReply(text);
      if (materialReply) return materialReply;
      if (/卡片|贺卡|祝福卡|感谢卡|心意卡/.test(String(text || ""))) {
        return /盒子|尺寸/.test(String(text || ""))
          ? "收到，卡片可以重新调整。我会按您给的盒子尺寸做适配；如果需要保留原图细节，我会以原图和原文为准，不乱改。"
          : "收到，卡片设计可以做。我会按您给的方向出 4 版图给您挑；如果有固定文案或原图细节，我会以原文和原图为准。";
      }
      return "收到，这个物料设计可以做。我会按您给的方向出 4 版图给您挑；如果有固定文案或参考图，我会以原文和素材为准。";
    }
    const budgetText = budget?.perUnitAmount ? `按每份 ${budget.perUnitAmount} 元` : "按您的预算";
    return `${budgetText}可以做。我先帮您搭一套礼盒组合，再整理 4 张真实产品摆拍效果图给您挑。同时我会核对 Logo、参考图、用途和礼盒搭配，确保效果图不乱换商品。`;
  }

  if (scene.agentKey === "order_payment") {
    return "收到，我先帮您核对订单和付款相关信息。确认清楚后，会把下一步付款、改地址、发票或订单处理方式说明白。";
  }

  if (scene.agentKey === "logistics_exception") {
    return "收到，我先帮您核对物流进度。如果确实停滞，我会同步安排催件或补发方案，再把处理结果告诉您。";
  }

  if (scene.agentKey === "after_sales") {
    return "收到，我先帮您核对订单和问题凭证。确认具体情况后，会给您明确的处理方案；涉及退款、补发或争议的部分会先转人工确认。";
  }

  return "收到，我先按您这个情况整理关键信息，再给您一个明确的下一步处理方式。";
}

function buildSceneAudit({
  scene,
  sceneDecision,
  sceneClarification,
  clarificationResolution,
  sceneMemory,
  budget,
  highValue,
  riskFlags,
  missing,
  action,
}) {
  const topScene = sceneDecision?.topScene || null;
  const secondaryScene = sceneDecision?.secondaryScene || null;
  const matchedKeywords = [...new Set([...(scene.matchedKeywords || []), ...(topScene?.matchedKeywords || [])])];
  const evidence = [];
  if (topScene) {
    evidence.push(`第一候选：${topScene.scene}，分数 ${topScene.score}`);
  }
  if (secondaryScene) {
    evidence.push(`第二候选：${secondaryScene.scene}，分数 ${secondaryScene.score}`);
  }
  if (matchedKeywords.length) {
    evidence.push(`命中关键词：${matchedKeywords.slice(0, 8).join("、")}`);
  }
  if (sceneMemory?.matched) {
    evidence.push(`route correction memory: ${sceneMemory.applied ? "applied" : "reference_only"} ${sceneMemory.score || 0}`);
  }
  if (budget?.perUnitAmount || budget?.totalAmount) {
    const budgetParts = [];
    if (budget.perUnitAmount) budgetParts.push(`单份 ${budget.perUnitAmount} 元`);
    if (budget.totalAmount) budgetParts.push(`总额 ${budget.totalAmount} 元`);
    if (budget.quantity) budgetParts.push(`数量 ${budget.quantity}`);
    evidence.push(`预算信息：${budgetParts.join("，")}`);
  }

  const missingFields = [...new Set(missing || [])];
  const warnings = [];
  if (highValue) warnings.push(
    action === "auto_agent"
      ? "达到高价值客户线，只允许自动回复商品库事实；最终优惠、报价和业务动作仍需人工审核。"
      : "达到高价值客户线，不能自动推进。",
  );
  if (riskFlags.length) warnings.push(`敏感风险：${riskFlags.join("、")}`);
  if (missingFields.length) warnings.push(`缺少信息：${missingFields.map(fieldLabel).join("、")}`);
  if (sceneClarification?.question) warnings.push("需要先问清场景，避免把 A 场景当成 B 场景回复。");

  if (sceneMemory?.matched && !sceneMemory.applied) {
    warnings.push("route correction memory was used as reference only; current stronger scene was kept.");
  }

  const label = sceneAuditLabel(sceneDecision, action);
  const summary = sceneAuditSummary({
    scene,
    sceneDecision,
    clarificationResolution,
    matchedKeywords,
    action,
  });
  const nextStep = sceneAuditNextStep({
    scene,
    sceneClarification,
    missingFields,
    highValue,
    riskFlags,
    action,
  });

  return {
    level: sceneAuditLevel(sceneDecision, action, warnings),
    label,
    summary,
    nextStep,
    evidence,
    warnings,
  };
}

function buildRoutingPolicy({
  scene,
  sceneDecision,
  sceneClarification,
  budget,
  highValue,
  riskFlags,
  missing,
  action,
  sceneAudit,
}) {
  const missingFields = [...new Set(missing || [])];
  const lane = routingPolicyLane({ highValue, riskFlags, missingFields, action, sceneDecision });
  const manualRequired = action === "manual_review";
  const canQueueAutoReply = ["auto_agent", "collect_info"].includes(action) && !manualRequired;
  const canAskClarification = action === "collect_info" && missingFields.length > 0 && !manualRequired;
  const valueTier = highValue ? "high" : "standard";
  return {
    lane,
    valueTier,
    handler: manualRequired ? "human" : "agent",
    agentKey: scene.agentKey,
    scene: scene.scene,
    manualRequired,
    canDraftReply: true,
    canAskClarification,
    canQueueAutoReply,
    autoSendAllowed: canQueueAutoReply,
    reason: routingPolicyReason({ lane, scene, budget, riskFlags, missingFields }),
    nextStep: sceneAudit?.nextStep || "",
    safeguards: routingPolicySafeguards({ lane, manualRequired, canQueueAutoReply, sceneClarification }),
  };
}

function routingPolicyLane({ highValue, riskFlags, missingFields, action, sceneDecision }) {
  if (highValue && action === "auto_agent") return "high_value_guided_reply";
  if (highValue) return "high_value_human";
  if (riskFlags.length) return "risk_human";
  if (action === "manual_review") return "manual_review";
  if (missingFields.includes("scene_clarification") || sceneDecision?.status === "ambiguous" || sceneDecision?.status === "weak") {
    return "scene_clarification";
  }
  if (action === "collect_info") return "info_collection";
  if (action === "auto_agent") return "low_value_agent";
  return "manual_review";
}

function routingPolicyReason({ lane, scene, budget, riskFlags, missingFields }) {
  if (lane === "high_value_human") return `达到高价值线，${scene.scene} 由人工审核后推进。`;
  if (lane === "high_value_guided_reply") return "达到高价值线，但仅自动回复商品库事实和需求确认；最终优惠与报价仍由人工审核。";
  if (lane === "risk_human") return `命中敏感风险：${riskFlags.join("、")}，需要人工处理。`;
  if (lane === "scene_clarification") return "场景判断还不够稳，先确认客户真正要处理的问题，避免回错会话或回错场景。";
  if (lane === "info_collection") return `已识别为 ${scene.scene}，但还缺少 ${missingFields.map(fieldLabel).join("、")}。`;
  if (lane === "low_value_agent") {
    const parts = [];
    if (budget?.perUnitAmount) parts.push(`单份 ${budget.perUnitAmount} 元`);
    if (budget?.totalAmount) parts.push(`总额 ${budget.totalAmount} 元`);
    const budgetText = parts.length ? `，${parts.join("，")}` : "";
    return `常规自动处理线内且场景清晰${budgetText}，可交给 ${sceneOptionLabel(scene.agentKey, scene.scene)} 智能体处理。`;
  }
  return "需要人工确认后再继续。";
}

function routingPolicySafeguards({ lane, manualRequired, canQueueAutoReply, sceneClarification }) {
  const safeguards = ["identity_binding_required", "no_cross_conversation_reply", "use_agent_skills_and_knowledge"];
  if (manualRequired) safeguards.push("human_approval_required");
  if (canQueueAutoReply) safeguards.push("wechat_send_guard_required");
  if (lane === "scene_clarification" || sceneClarification?.required) safeguards.push("ask_before_answering_uncertain_scene");
  if (lane === "high_value_human") safeguards.push("price_image_and_order_manual_review");
  if (lane === "high_value_guided_reply") safeguards.push("catalog_facts_only", "final_quote_manual_review");
  return safeguards;
}

function sceneAuditLevel(sceneDecision, action, warnings) {
  if (action === "manual_review") return "manual";
  if (sceneDecision?.status === "ambiguous" || sceneDecision?.status === "weak") return "review";
  if (warnings.length) return "review";
  return "pass";
}

function sceneAuditLabel(sceneDecision, action) {
  if (action === "manual_review") return "人工优先";
  if (sceneDecision?.status === "ambiguous") return "多场景接近";
  if (sceneDecision?.status === "weak") return "场景待确认";
  if (sceneDecision?.status === "unmatched") return "未识别场景";
  return "场景清晰";
}

function sceneAuditSummary({ scene, sceneDecision, clarificationResolution, matchedKeywords, action }) {
  if (clarificationResolution) {
    return `客户已澄清为「${clarificationResolution.label || clarificationResolution.scene || scene.scene}」，本轮按该场景继续处理。`;
  }
  if (sceneDecision?.status === "ambiguous") {
    const top = sceneDecision.topScene?.scene || "第一候选";
    const second = sceneDecision.secondaryScene?.scene || "第二候选";
    return `这句话同时像「${top}」和「${second}」，分差 ${sceneDecision.scoreGap}，系统不会直接乱回。`;
  }
  if (sceneDecision?.status === "weak") {
    return `只命中较弱场景信号，暂判为「${scene.scene}」，需要先向客户确认重点。`;
  }
  if (sceneDecision?.status === "unmatched") {
    return "没有命中明确场景关键词，需要人工或追问客户当前要处理的重点。";
  }
  const keywords = matchedKeywords.length ? `，主要依据：${matchedKeywords.slice(0, 5).join("、")}` : "";
  const actionText = action === "auto_agent" ? "可以交给对应智能体处理" : "需要先补齐信息";
  return `已判断为「${scene.scene}」${keywords}，${actionText}。`;
}

function sceneAuditNextStep({ scene, sceneClarification, missingFields, highValue, riskFlags, action }) {
  if (highValue && action === "auto_agent") return "先回复商品库事实并收集报价条件，最终优惠与正式报价转人工审核。";
  if (highValue) return "转人工审核预算、客户价值、图片和报价，再决定是否发送。";
  if (riskFlags.length) return "转人工处理投诉、售后争议或敏感风险，避免自动话术激化问题。";
  if (sceneClarification?.question) return `先发送场景确认问题：${sceneClarification.question}`;
  if (action === "collect_info" && missingFields.length) {
    return `先补齐 ${missingFields.map(fieldLabel).join("、")}，补齐后再让 ${sceneOptionLabel(scene.agentKey, scene.scene)} 智能体继续。`;
  }
  if (action === "auto_agent") return `进入 ${sceneOptionLabel(scene.agentKey, scene.scene)} 智能体，使用匹配到的 Skill 和知识回复。`;
  return "保持人工确认，处理完后可把正确场景沉淀为训练样本。";
}

function fieldLabel(field) {
  const labels = {
    budget: "预算",
    quantity: "数量",
    customer_assets: "Logo 或参考图",
    usage_scene: "用途场景",
    order_or_tracking: "订单号或快递单号",
    order_or_evidence: "订单信息或问题凭证",
    order_or_payment_info: "订单或付款信息",
    scene_clarification: "要处理的重点",
  };
  return labels[field] || field;
}

module.exports = {
  evaluateAgentRoute,
  buildSceneDecision,
  buildSceneClarification,
  findPendingSceneClarificationContext,
  findPendingFieldQuestionContext,
  resolveSceneClarification,
  resolvePendingFieldAnswer,
  extractSalesUsageScene,
  extractSalesStylePreference,
  buildSceneAudit,
  buildRoutingPolicy,
  shouldParseBudgetForRoute,
  detectMissingFields,
  detectRiskFlags,
};
