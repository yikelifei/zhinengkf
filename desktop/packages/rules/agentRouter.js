"use strict";

const { classifyScene } = require("./chatTraining");
const { isHighValueBudget, parseBudget } = require("./budget");

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
  const classifiedScene = applySceneMemory(classifyScene(text), text, options.sceneMemory || options.routeCorrectionSamples || []);
  const clarificationResolution = resolveSceneClarification(
    text,
    input.clarificationContext || options.clarificationContext,
    classifiedScene,
  );
  const scene = clarificationResolution?.resolvedScene || classifiedScene;
  const sceneDecision = clarificationResolution
    ? buildResolvedSceneDecision(clarificationResolution)
    : buildSceneDecision(scene);
  const sceneClarification = clarificationResolution ? null : buildSceneClarification(sceneDecision);
  const budget = input.budget || (shouldParseBudgetForRoute(text, scene.agentKey) ? parseBudget(text) : null);
  const highValue = isHighValueBudget(budget, Number(options.highValueAmountCny || 10000));
  const riskFlags = detectRiskFlags(text);
  const missing = detectMissingFields(text, scene.agentKey, budget);
  if (sceneDecision.status === "ambiguous" || sceneDecision.status === "weak") {
    missing.unshift("scene_clarification");
  }

  const action = decideAction({ highValue, riskFlags, missing, agentKey: scene.agentKey, sceneDecision });
  const sceneAudit = buildSceneAudit({
    scene,
    sceneDecision,
    sceneClarification,
    clarificationResolution,
    sceneMemory: scene.sceneMemory || null,
    budget,
    highValue,
    riskFlags,
    missing,
    action,
  });
  return {
    text,
    channel: input.channel || "wechat",
    scene: scene.scene,
    agentKey: scene.agentKey,
    sceneScore: scene.score || 0,
    sceneScores: scene.scores || [],
    matchedKeywords: scene.matchedKeywords || [],
    sceneDecision,
    sceneClarification,
    clarificationResolution,
    sceneMemory: scene.sceneMemory || null,
    sceneAudit,
    budget,
    isHighValue: highValue,
    riskFlags,
    missingFields: missing,
    action,
    manualRequired: action === "manual_review",
    confidence: calculateConfidence(scene, budget, missing, riskFlags),
    suggestedReply: buildSuggestedReply({ scene, budget, missing, action, highValue, riskFlags }),
  };
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
  const sampleScore = Number(sample.score || 0);
  if (sourceType === "route_correction" && sampleScore && sampleScore < 70) return null;
  if (sourceType === "chat_import" && sampleScore < 85) return null;
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
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/[锛屻€傦紒锛熴€?.!?;锛?锛?'鈥溾€濃€樷€橾]/g, "");
}

const SCENE_META = {
  gift_design: { scene: "礼盒设计", label: "礼盒设计/效果图" },
  order_payment: { scene: "下单支付", label: "下单支付/发票地址" },
  logistics_exception: { scene: "物流异常", label: "物流发货/签收异常" },
  after_sales: { scene: "售后安抚", label: "售后退款/破损补发" },
  size_recommendation: { scene: "尺码推荐", label: "尺码推荐" },
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
  gift_design: weightedAliases(["设计图", "效果图", "出图", "看图", "图片", "摆拍", "礼盒", "搭配", "包装", "logo"]),
  order_payment: weightedAliases(["订单", "付款", "支付", "发票", "开票", "地址", "改地址", "收货地址", "下单", "定金", "尾款"]),
  logistics_exception: weightedAliases(["物流", "快递", "发货", "到货", "签收", "派送", "催件", "单号", "没收到"]),
  after_sales: weightedAliases(["售后", "退款", "退货", "换货", "破损", "坏了", "补发", "质量", "少件", "漏发", "赔偿"]),
  size_recommendation: weightedAliases(["尺码", "码数", "身高", "体重", "穿多大", "合身", "偏大", "偏小"]),
  pre_sales: weightedAliases(["推荐", "商品", "价格", "优惠", "怎么买", "活动", "有货", "多少钱", "介绍", "对比"]),
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

function buildSceneClarification(sceneDecision) {
  if (!sceneDecision || sceneDecision.status === "clear") return null;
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

  if (sceneDecision.status === "ambiguous" && options.length >= 2) {
    return {
      required: true,
      type: "choose_scene",
      question: `这条消息同时像「${options[0].label}」和「${options[1].label}」。为避免回错，我先确认一下：您现在最想先处理哪一件？`,
      options,
    };
  }

  if (sceneDecision.status === "weak" && options.length) {
    return {
      required: true,
      type: "confirm_scene",
      question: `我先确认一下，您是想让我先处理「${options[0].label}」这个方向吗？如果是订单、售后、物流或设计图，也可以直接告诉我重点。`,
      options,
    };
  }

  return {
    required: true,
    type: "describe_scene",
    question: "我先确认一下，您现在主要想处理哪类问题：商品咨询、设计效果图、订单付款、物流还是售后？",
    options,
  };
}

function sceneOptionLabel(agentKey, scene) {
  const labels = {
    gift_design: "礼盒设计/效果图",
    order_payment: "下单支付/发票地址",
    logistics_exception: "物流发货/签收异常",
    after_sales: "售后退款/破损补发",
    size_recommendation: "尺码推荐",
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
  return [...new Set(flags)];
}

function detectMissingFields(text, agentKey, budget) {
  const missing = [];
  if (agentKey === "gift_design") {
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
  if (agentKey === "size_recommendation") {
    if (!/身高|\d{2,3}\s*cm|厘米/.test(text)) missing.push("height");
    if (!/体重|\d{2,3}\s*(斤|kg|公斤)/i.test(text)) missing.push("weight");
  }
  if (agentKey === "after_sales" && !/订单|图片|视频|破损|凭证|单号|照片/.test(text)) {
    missing.push("order_or_evidence");
  }
  if (agentKey === "order_payment" && !/订单|单号|付款|支付|下单|定金|尾款|地址|发票/.test(text)) {
    missing.push("order_or_payment_info");
  }
  return missing;
}

function decideAction({ highValue, riskFlags, missing, agentKey, sceneDecision }) {
  if (highValue) return "manual_review";
  if (riskFlags.length) return "manual_review";
  if (sceneDecision?.status === "ambiguous") {
    const keys = [sceneDecision.topScene?.agentKey, sceneDecision.secondaryScene?.agentKey].filter(Boolean);
    if (keys.includes("after_sales") || keys.includes("order_payment")) return "manual_review";
    return "collect_info";
  }
  if (agentKey === "general") return "manual_review";
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

function buildSuggestedReply({ scene, budget, missing, action, highValue, riskFlags }) {
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
    const budgetText = budget?.perUnitAmount ? `按每份 ${budget.perUnitAmount} 元` : "按您的预算";
    return `${budgetText}可以做。我先帮您搭一套礼盒组合，再整理几版真实产品摆拍效果图给您挑。同时我会核对 Logo、参考图、用途和礼盒搭配，确保效果图不乱换商品。`;
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

  if (scene.agentKey === "size_recommendation") {
    return "可以，我先根据您的身高、体重、版型偏好和商品尺码规则来判断。信息不全的话我会先补问关键参数，再给建议。";
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
  if (highValue) warnings.push("达到高价值客户线，不能自动推进。");
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
    height: "身高",
    weight: "体重",
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
  resolveSceneClarification,
  buildSceneAudit,
  shouldParseBudgetForRoute,
  detectMissingFields,
  detectRiskFlags,
};
