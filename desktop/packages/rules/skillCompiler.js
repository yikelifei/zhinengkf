"use strict";

const DEFAULT_MIN_SCORE = 70;
const DEFAULT_SAFE_MIN_SAMPLE_COUNT = 2;
const DEFAULT_SAFE_MIN_CONFIDENCE = 80;

const HINT_ALIASES = new Map([
  ["棰勭畻婢勬竻", "预算澄清"],
  ["需求澄清", "需求澄清"],
  ["闇€姹傛緞娓?", "需求澄清"],
  ["璁捐闇€姹傜‘璁?", "设计需求确认"],
  ["设计需求确认", "设计需求确认"],
  ["鐗╂祦瀹夋姎", "物流安抚"],
  ["物流安抚", "物流安抚"],
  ["鍞悗鏂规", "售后方案"],
  ["售后方案", "售后方案"],
  ["楂樻儏鍟嗚瘽鏈?", "高情商话术"],
  ["高情商话术", "高情商话术"],
  ["转化推进", "转化推进"],
  ["防乱回复", "防乱回复"],
]);

function compileAgentSkillSuggestions(samples = [], options = {}) {
  const minScore = Number(options.minScore || DEFAULT_MIN_SCORE);
  const agentId = options.agentId ? String(options.agentId) : "";
  const existingSkills = Array.isArray(options.existingSkills) ? options.existingSkills : [];
  const buckets = new Map();

  for (const sample of Array.isArray(samples) ? samples : []) {
    if (agentId && sample.agentId !== agentId) continue;
    if (!isSkillTrainingEligible(sample)) continue;
    const score = Number(sample.score || 0);
    if (score < minScore) continue;
    const names = extractSkillNames(sample);
    for (const name of names) {
      const key = `${sample.agentId || sample.agentKey || "general"}::${canonicalSkillName(name)}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          suggestionKey: key,
          agentId: sample.agentId || null,
          agentKey: sample.agentKey || "general",
          name,
          scenes: new Set(),
          sampleIds: [],
          scores: [],
          questions: [],
          answers: [],
        });
      }
      const bucket = buckets.get(key);
      bucket.scenes.add(sample.scene || "未分类");
      bucket.sampleIds.push(sample.id);
      bucket.scores.push(score);
      if (sample.customerText) bucket.questions.push(String(sample.customerText));
      if (sample.idealReply) bucket.answers.push(String(sample.idealReply));
    }
  }

  return [...buckets.values()]
    .map((bucket) => {
      const averageScore = average(bucket.scores);
      const existing = findExistingSkill(existingSkills, bucket.agentId, bucket.name);
      const evidence = pickEvidence(bucket.questions, bucket.answers);
      const description = buildSkillDescription(bucket, averageScore, evidence);
      const sampleCount = bucket.sampleIds.length;
      const confidence = calculateConfidence(sampleCount, averageScore);
      return {
        suggestionKey: bucket.suggestionKey,
        agentId: bucket.agentId,
        agentKey: bucket.agentKey,
        name: bucket.name,
        description,
        sampleCount,
        averageScore,
        confidence,
        sampleIds: bucket.sampleIds,
        scenes: [...bucket.scenes],
        evidence,
        existingSkillId: existing?.id || null,
        action: existing ? "update" : "create",
        quality: classifySkillSuggestionQuality({ sampleCount, confidence }),
      };
    })
    .sort((a, b) => b.confidence - a.confidence || b.sampleCount - a.sampleCount || a.name.localeCompare(b.name, "zh-Hans-CN"));
}

function classifySkillSuggestionQuality(suggestion = {}, options = {}) {
  const minSampleCount = Number(options.minSampleCount || DEFAULT_SAFE_MIN_SAMPLE_COUNT);
  const minConfidence = Number(options.minConfidence || DEFAULT_SAFE_MIN_CONFIDENCE);
  const sampleCount = Number(suggestion.sampleCount || 0);
  const confidence = Number(suggestion.confidence || 0);
  if (sampleCount >= minSampleCount && confidence >= minConfidence) {
    return {
      level: "safe",
      label: "高可信默认选中",
      reason: "样本数量和置信度均达到自动应用线。",
      needsReview: false,
      minSampleCount,
      minConfidence,
    };
  }
  if (sampleCount < minSampleCount) {
    return {
      level: confidence >= 70 ? "review" : "risk",
      label: "样本少需复核",
      reason: `只有 ${sampleCount} 条样本，低于 ${minSampleCount} 条自动应用线。`,
      needsReview: true,
      minSampleCount,
      minConfidence,
    };
  }
  return {
    level: confidence >= 70 ? "review" : "risk",
    label: "低置信需复核",
    reason: `置信度 ${confidence}，低于 ${minConfidence} 自动应用线。`,
    needsReview: true,
    minSampleCount,
    minConfidence,
  };
}

function isSkillSuggestionSafeToApply(suggestion = {}, options = {}) {
  return !classifySkillSuggestionQuality(suggestion, options).needsReview;
}

function evaluateTrainingSampleQuality(sample = {}, options = {}) {
  const quality = {
    ...evaluateTrainingSampleQualityCore(sample, options),
    usage: classifyTrainingSampleUsage(sample, options),
  };
  return {
    ...quality,
    attention: classifyTrainingSampleAttention(sample, quality),
  };
}

function evaluateTrainingSampleQualityCore(sample = {}, options = {}) {
  const minScore = Number(options.minScore || DEFAULT_MIN_SCORE);
  const status = String(sample.status || "ready");
  const score = Number(sample.score || 0);
  const skillHints = normalizeHints(sample.skillHints);
  const answer = String(sample.idealReply || "");

  if (status === "rejected") {
    return {
      level: "blocked",
      label: "已禁用",
      reason: "人工已禁用，不参与 Skill 和知识匹配。",
      recommendedAction: "保持禁用；如果是误禁用，先退回复核并补齐标准回复后再确认训练。",
      trainable: false,
      flags: ["rejected"],
    };
  }
  if (status === "review") {
    return {
      level: "review",
      label: "待人工复核",
      reason: "样本已退回复核，复核前不参与 Skill 和知识匹配。",
      recommendedAction: "人工检查场景、客户问题、标准回复和 Skill 提示，确认没有跑偏后再放回训练。",
      trainable: false,
      flags: ["manual_review_required"],
    };
  }
  if (isSceneClarificationReply(answer)) {
    return {
      level: "review",
      label: "防乱回复样本",
      reason: "这是场景确认话术，只训练防乱回复，不参与业务 Skill 和普通知识匹配。",
      recommendedAction: "保留为防乱回复样本，不要改成售前、售后、物流等业务 Skill。",
      trainable: true,
      flags: ["scene_clarification_reply", "anti_wrong_reply_only"],
    };
  }
  if (score < minScore) {
    return {
      level: "risk",
      label: "低分需复核",
      reason: `评分 ${score}，低于 ${minScore} 分训练线。`,
      recommendedAction: "先重写成高情商客服标准回复，并把评分提高到训练线以上，再确认训练。",
      trainable: false,
      flags: ["low_score"],
    };
  }
  if (!answer.trim()) {
    return {
      level: "risk",
      label: "缺少回复",
      reason: "缺少客服标准回复，不能提炼可执行 Skill。",
      recommendedAction: "补上客服应该怎么回，不能只留下客户问题；补完后再确认训练。",
      trainable: false,
      flags: ["missing_answer"],
    };
  }
  if (!skillHints.length) {
    return {
      level: "review",
      label: "缺 Skill 提示",
      reason: "样本可训练，但缺少 Skill 提示，建议人工补充后再应用。",
      recommendedAction: "补 1 到 3 个明确 Skill 提示，例如预算澄清、售后安抚、物流追踪。",
      trainable: true,
      flags: ["missing_skill_hints"],
    };
  }
  return {
    level: "safe",
    label: "可训练",
    reason: "样本状态、评分和 Skill 提示满足训练要求。",
    recommendedAction: "可以进入 Skill 生成；应用前仍检查样本是否符合当前业务口径。",
    trainable: true,
    flags: [],
  };
}

function isSceneClarificationReply(value) {
  const text = String(value || "")
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?;；:："'“”‘’]/g, "");
  if (!text) return false;
  if (/这条消息同时像.+为避免回错.+最想先处理哪一件/.test(text)) return true;
  if (/我先确认一下.+是想让我先处理.+这个方向吗/.test(text)) return true;
  if (/我先确认一下.+现在主要想处理哪类问题/.test(text)) return true;
  return /如果是订单.*售后.*物流.*设计图/.test(text);
}

function classifyTrainingSampleUsage(sample = {}, options = {}) {
  const minScore = Number(options.minScore || DEFAULT_MIN_SCORE);
  const sourceType = normalizeSampleSource(sample);
  const status = String(sample.status || "ready");
  const score = Number(sample.score || 0);
  const hasCustomerText = Boolean(String(sample.customerText || sample.question || "").trim());
  const hasAnswer = Boolean(String(sample.idealReply || sample.answer || "").trim());
  const hasAgent = Boolean(sample.agentKey || sample.agentId);
  const hasScene = Boolean(sample.scene);
  const sceneConfidence = classifyTrainingSampleSceneConfidence(sample);
  const antiWrongReply = isSceneClarificationReply(sample.idealReply || sample.answer);
  const flags = [];

  if (status === "rejected") {
    return trainingSampleUsageResult("none", "不参与训练", "样本已禁用，不参与场景判断、客服话术或知识匹配。", flags);
  }
  if (status === "review") {
    return trainingSampleUsageResult("review", "待复核", "样本还在人工复核中，确认前不进入自动训练。", ["manual_review_required"]);
  }
  if (antiWrongReply) {
    return trainingSampleUsageResult("anti_wrong_reply", "仅防乱回复", "这是场景澄清话术，只训练防乱回复，不能拿来判断具体业务场景。", [
      "anti_wrong_reply_only",
    ]);
  }

  const routeMemory =
    hasCustomerText &&
    hasAgent &&
    hasScene &&
    sceneConfidence.routeMemoryAllowed &&
    ((sourceType === "route_correction" && score >= minScore) || (sourceType === "chat_import" && score >= 85));
  const replySkill = hasAnswer && score >= minScore;

  if (!hasCustomerText) flags.push("missing_customer_text");
  if (!hasAnswer) flags.push("missing_answer");
  if (!hasAgent) flags.push("missing_agent");
  if (!hasScene) flags.push("missing_scene");
  if (!sceneConfidence.routeMemoryAllowed) flags.push(sceneConfidence.flag);
  if (score < minScore) flags.push("low_score");
  if (sourceType === "chat_import" && score < 85) flags.push("chat_import_scene_score_low");

  if (routeMemory && replySkill) {
    return trainingSampleUsageResult("route_and_reply", "场景判断+客服话术", "这个样本既能帮助识别场景，也能提炼客服回复方式。", flags);
  }
  if (routeMemory) {
    return trainingSampleUsageResult("route_memory", "仅场景判断", "这个样本适合帮助智能体判断客户属于哪个场景。", flags);
  }
  if (replySkill) {
    return trainingSampleUsageResult("reply_only", "仅客服话术", "这个样本适合训练回复风格和处理方式，但不够稳，不用于自动判断场景。", flags);
  }
  return trainingSampleUsageResult("none", "不可训练", "样本缺少关键内容或评分过低，先修正后再训练。", flags);
}

function trainingSampleUsageResult(scope, label, reason, flags = []) {
  return {
    scope,
    label,
    reason,
    routeMemory: scope === "route_and_reply" || scope === "route_memory",
    replySkill: scope === "route_and_reply" || scope === "reply_only",
    antiWrongReply: scope === "anti_wrong_reply",
    trainable: ["route_and_reply", "route_memory", "reply_only", "anti_wrong_reply"].includes(scope),
    flags: [...new Set(flags.filter(Boolean))],
  };
}

function classifyTrainingSampleSceneConfidence(sample = {}) {
  const sourceType = normalizeSampleSource(sample);
  if (sourceType !== "chat_import") return { routeMemoryAllowed: true, flag: "" };

  const sceneCheck = sample.sceneCheck || sample.sceneDecision || null;
  if (sceneCheck?.status) {
    if (sceneCheck.status === "clear") return { routeMemoryAllowed: true, flag: "" };
    return { routeMemoryAllowed: false, flag: `scene_${sceneCheck.status}` };
  }

  if (sample.sceneScore === undefined || sample.sceneScore === null) {
    return { routeMemoryAllowed: true, flag: "" };
  }

  const sceneScore = Number(sample.sceneScore || 0);
  if (!Number.isFinite(sceneScore) || sceneScore <= 0) return { routeMemoryAllowed: false, flag: "scene_unmatched" };
  if (sceneScore < 14) return { routeMemoryAllowed: false, flag: "scene_weak" };
  return { routeMemoryAllowed: true, flag: "" };
}

function summarizeTrainingSamples(samples = [], agents = [], suggestions = []) {
  const rows = Array.isArray(samples) ? samples : [];
  const agentRows = Array.isArray(agents) ? agents : [];
  const suggestionRows = Array.isArray(suggestions) ? suggestions : [];
  const agentMap = new Map();
  const buckets = new Map();

  for (const agent of agentRows) {
    const key = agent.id || agent.key || "general";
    agentMap.set(key, agent);
    buckets.set(key, createAgentBucket(agent));
  }

  for (const sample of rows) {
    const key = sample.agentId || sample.agentKey || "general";
    if (!buckets.has(key)) {
      const agent = agentMap.get(key) || {
        id: sample.agentId || null,
        key: sample.agentKey || "general",
        name: sample.agentKey || "通用 Agent",
        scene: sample.scene || "未分类",
      };
      buckets.set(key, createAgentBucket(agent));
    }
    const bucket = buckets.get(key);
    const score = Number(sample.score || 0);
    const sourceType = normalizeSampleSource(sample);
    bucket.sampleCount += 1;
    bucket.scoreTotal += score;
    bucket.averageScore = Math.round(bucket.scoreTotal / bucket.sampleCount);
    bucket.readyCount += isSkillTrainingEligible(sample) ? 1 : 0;
    bucket.reviewCount += sample.status === "review" ? 1 : 0;
    bucket.rejectedCount += sample.status === "rejected" ? 1 : 0;
    bucket.correctionCount += sourceType === "route_correction" ? 1 : 0;
    bucket.chatImportCount += sourceType === "chat_import" ? 1 : 0;
    bucket.lastSampleAt = maxIso(bucket.lastSampleAt, sample.createdAt);
    for (const hint of normalizeHints(sample.skillHints)) {
      bucket.skillHintCounts.set(hint, (bucket.skillHintCounts.get(hint) || 0) + 1);
    }
  }

  for (const suggestion of suggestionRows) {
    const key = suggestion.agentId || suggestion.agentKey || "general";
    if (!buckets.has(key)) {
      buckets.set(key, createAgentBucket({ id: suggestion.agentId || null, key: suggestion.agentKey || "general" }));
    }
    buckets.get(key).suggestionCount += 1;
  }

  const byAgent = [...buckets.values()]
    .map((bucket) => ({
      agentId: bucket.agentId,
      agentKey: bucket.agentKey,
      name: bucket.name,
      scene: bucket.scene,
      sampleCount: bucket.sampleCount,
      readyCount: bucket.readyCount,
      reviewCount: bucket.reviewCount,
      rejectedCount: bucket.rejectedCount,
      correctionCount: bucket.correctionCount,
      chatImportCount: bucket.chatImportCount,
      averageScore: bucket.averageScore,
      suggestionCount: bucket.suggestionCount,
      lastSampleAt: bucket.lastSampleAt,
      topSkillHints: topEntries(bucket.skillHintCounts, 4).map(([name, count]) => ({ name, count })),
    }))
    .sort((a, b) => b.sampleCount - a.sampleCount || b.correctionCount - a.correctionCount || String(a.name).localeCompare(String(b.name), "zh-Hans-CN"));

  const readySamples = rows.filter((sample) => isSkillTrainingEligible(sample)).length;
  const reviewSamples = rows.filter((sample) => sample.status === "review").length;
  const rejectedSamples = rows.filter((sample) => sample.status === "rejected").length;
  const correctionSamples = rows.filter((sample) => normalizeSampleSource(sample) === "route_correction").length;
  const chatImportSamples = rows.filter((sample) => normalizeSampleSource(sample) === "chat_import").length;
  const averageScore = average(rows.map((sample) => Number(sample.score || 0)));
  const topCorrectionScenes = summarizeCorrectionScenes(rows);
  const qualitySummary = summarizeTrainingSampleQuality(rows);
  const recommendations = buildTrainingRecommendations({
    totalSamples: rows.length,
    readySamples,
    reviewSamples,
    rejectedSamples,
    correctionSamples,
    suggestionCount: suggestionRows.length,
    byAgent,
    qualitySummary,
  });

  return {
    totalSamples: rows.length,
    readySamples,
    reviewSamples,
    rejectedSamples,
    correctionSamples,
    chatImportSamples,
    averageScore,
    suggestionCount: suggestionRows.length,
    agentsWithSamples: byAgent.filter((item) => item.sampleCount > 0).length,
    qualitySummary,
    topCorrectionScenes,
    byAgent,
    recommendations,
  };
}

function summarizeTrainingSampleQuality(samples = []) {
  const attentionReasonCounts = new Map();
  const summary = {
    safeSamples: 0,
    reviewQualitySamples: 0,
    riskSamples: 0,
    blockedSamples: 0,
    trainableSamples: 0,
    antiWrongReplySamples: 0,
    routeMemorySamples: 0,
    replySkillSamples: 0,
    routeAndReplySamples: 0,
    needsAttentionSamples: 0,
    attentionReasonCounts: [],
    lowScoreSamples: 0,
    missingAnswerSamples: 0,
    missingSkillHintSamples: 0,
  };

  for (const sample of Array.isArray(samples) ? samples : []) {
    const quality = evaluateTrainingSampleQuality(sample);
    if (quality.level === "safe") summary.safeSamples += 1;
    if (quality.level === "review") summary.reviewQualitySamples += 1;
    if (quality.level === "risk") summary.riskSamples += 1;
    if (quality.level === "blocked") summary.blockedSamples += 1;
    if (quality.trainable) summary.trainableSamples += 1;
    if (quality.flags.includes("anti_wrong_reply_only")) summary.antiWrongReplySamples += 1;
    if (quality.usage?.routeMemory) summary.routeMemorySamples += 1;
    if (quality.usage?.replySkill) summary.replySkillSamples += 1;
    if (quality.usage?.routeMemory && quality.usage?.replySkill) summary.routeAndReplySamples += 1;
    if (quality.attention?.needsAttention) {
      summary.needsAttentionSamples += 1;
      const primaryReasons = quality.attention.primaryReason ? [quality.attention.primaryReason] : [];
      for (const reason of primaryReasons) {
        const current = attentionReasonCounts.get(reason.code) || { code: reason.code, label: reason.label, count: 0 };
        current.count += 1;
        attentionReasonCounts.set(reason.code, current);
      }
    }
    if (quality.flags.includes("low_score")) summary.lowScoreSamples += 1;
    if (quality.flags.includes("missing_answer")) summary.missingAnswerSamples += 1;
    if (quality.flags.includes("missing_skill_hints")) summary.missingSkillHintSamples += 1;
  }

  summary.attentionReasonCounts = [...attentionReasonCounts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-Hans-CN"))
    .slice(0, 8);
  return summary;
}

function isTrainingSampleNeedingAttention(sample = {}, evaluatedQuality) {
  return classifyTrainingSampleAttention(sample, evaluatedQuality).needsAttention;
}

function classifyTrainingSampleAttention(sample = {}, evaluatedQuality) {
  const quality = resolveTrainingSampleQuality(sample, evaluatedQuality);
  const status = String(sample.status || "ready");
  const usage = quality.usage || {};
  const flags = [
    ...(Array.isArray(quality.flags) ? quality.flags : []),
    ...(Array.isArray(usage.flags) ? usage.flags : []),
  ];
  const isAntiWrongReply = usage.antiWrongReply === true || flags.includes("anti_wrong_reply_only");
  const reasons = [];

  if (status !== "rejected" && quality.level !== "blocked" && !(isAntiWrongReply && status !== "review")) {
    if (status === "review" || flags.includes("manual_review_required")) {
      pushAttentionReason(reasons, "manual_review_required", "人工复核", "样本还在待复核状态，确认前不能进入自动训练。", "人工检查场景、客户问题、标准回复和 Skill 提示。");
    }
    if (flags.includes("low_score")) {
      pushAttentionReason(reasons, "low_score", "低分", "样本评分低或被判定为风险样本。", "先重写成高情商客服标准回复，再提高评分后确认训练。");
    }
    if (flags.includes("missing_answer")) {
      pushAttentionReason(reasons, "missing_answer", "缺回复", "样本缺少客服标准回复。", "补上客服应该怎么回，不能只留下客户问题。");
    }
    if (flags.includes("missing_customer_text")) {
      pushAttentionReason(reasons, "missing_customer_text", "缺客户问题", "样本缺少客户原话。", "补上客户真实问题，避免训练成无上下文话术。");
    }
    if (flags.includes("missing_skill_hints")) {
      pushAttentionReason(reasons, "missing_skill_hints", "缺 Skill", "样本缺少 Skill 提示。", "补 1 到 3 个明确 Skill，例如预算澄清、售后安抚、物流追踪。");
    }
    const sceneFlag = flags.find((flag) => /^scene_(weak|ambiguous|unmatched)$/.test(flag));
    if (sceneFlag) {
      pushAttentionReason(reasons, sceneFlag, "scene_uncertain", "chat import scene judgement is not confident enough for route memory", "confirm the scene and agent before using this sample for scene routing");
    }
    if (quality.level === "risk" && !reasons.length) {
      pushAttentionReason(reasons, "quality_risk", "质量风险", "样本被判定为风险样本。", quality.recommendedAction || "先修正样本内容后再确认训练。");
    }
    if (quality.level === "review" && !reasons.length) {
      pushAttentionReason(reasons, "quality_review", "质量复核", "样本质量需要人工再看一遍。", quality.recommendedAction || "确认没有跑偏后再放回训练。");
    }
    if (quality.trainable === false && !reasons.length) {
      pushAttentionReason(reasons, "not_trainable", "不可训练", "样本当前不能进入自动训练。", quality.recommendedAction || "先修正样本内容后再确认训练。");
    }
    if (usage.scope === "review") {
      pushAttentionReason(reasons, "usage_review", "用途待复核", "训练用途仍处于待复核。", "确认它是用于场景判断、客服话术，还是只用于防乱回复。");
    }
    if (usage.scope === "none") {
      pushAttentionReason(reasons, "usage_none", "不可用样本", "样本缺少关键内容或评分过低。", "先补齐内容或禁用这条样本。");
    }
    if (usage.scope === undefined) {
      pushAttentionReason(reasons, "usage_unknown", "用途未判定", "系统还没有给这条样本标记训练用途。", "重新保存或复核样本，让系统补齐用途判断。");
    }
  }

  return {
    needsAttention: reasons.length > 0,
    label: reasons.length ? "需人工处理" : "无需优先处理",
    primaryReason: reasons[0] || null,
    reasons,
    recommendedAction: reasons[0]?.action || quality.recommendedAction || "",
  };
}

function resolveTrainingSampleQuality(sample = {}, evaluatedQuality) {
  if (evaluatedQuality) return evaluatedQuality;
  if (sample.quality) return sample.quality;
  return {
    ...evaluateTrainingSampleQualityCore(sample),
    usage: classifyTrainingSampleUsage(sample),
  };
}

function pushAttentionReason(reasons, code, label, detail, action) {
  if (reasons.some((reason) => reason.code === code)) return;
  reasons.push({ code, label, detail, action });
}

function createAgentBucket(agent = {}) {
  return {
    agentId: agent.id || null,
    agentKey: agent.key || "general",
    name: agent.name || agent.key || "通用 Agent",
    scene: agent.scene || "未分类",
    sampleCount: 0,
    readyCount: 0,
    reviewCount: 0,
    rejectedCount: 0,
    correctionCount: 0,
    chatImportCount: 0,
    scoreTotal: 0,
    averageScore: 0,
    suggestionCount: 0,
    lastSampleAt: "",
    skillHintCounts: new Map(),
  };
}

function normalizeSampleSource(sample = {}) {
  if (sample.sourceType) return sample.sourceType;
  if (sample.sourceRouteId) return "route_correction";
  if (sample.importId) return "chat_import";
  return "manual";
}

function isSkillTrainingEligible(sample = {}) {
  return !sample.status || sample.status === "ready";
}

function normalizeTrainingSampleStatus(status) {
  const value = String(status || "").trim();
  if (["ready", "review", "rejected"].includes(value)) return value;
  throw new Error(`unsupported training sample status: ${status}`);
}

function trainingSampleReviewNote(status) {
  if (status === "ready") return "人工确认样本可进入 Skill 训练。";
  if (status === "rejected") return "人工禁用样本，不参与 Skill 和知识匹配。";
  return "人工标记样本待复核，暂不参与 Skill 和知识匹配。";
}

function isTrainingSampleReady(sample = {}) {
  return isSkillTrainingEligible(sample);
}

function summarizeCorrectionScenes(samples) {
  const buckets = new Map();
  for (const sample of samples) {
    if (normalizeSampleSource(sample) !== "route_correction") continue;
    const scene = sample.scene || "未分类";
    const agentKey = sample.agentKey || "general";
    const key = `${agentKey}::${scene}`;
    if (!buckets.has(key)) {
      buckets.set(key, { scene, agentKey, count: 0, latestAt: "" });
    }
    const bucket = buckets.get(key);
    bucket.count += 1;
    bucket.latestAt = maxIso(bucket.latestAt, sample.createdAt);
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count || String(b.latestAt).localeCompare(String(a.latestAt)))
    .slice(0, 6);
}

function buildTrainingRecommendations(summary) {
  const messages = [];
  if (summary.correctionSamples > 0 && summary.suggestionCount > 0) {
    messages.push(`已有 ${summary.correctionSamples} 条场景纠错样本，可生成或更新 ${summary.suggestionCount} 个 Skill。`);
  }
  if (summary.qualitySummary?.antiWrongReplySamples > 0) {
    messages.push(`${summary.qualitySummary.antiWrongReplySamples} 条场景确认样本只用于防乱回复，不进入业务 Skill 或普通知识匹配。`);
  }
  if (summary.qualitySummary?.riskSamples > 0) {
    messages.push(`${summary.qualitySummary.riskSamples} 条样本存在低分或缺回复风险，需要先修正再训练。`);
  }
  if (summary.reviewSamples > 0) {
    messages.push(`${summary.reviewSamples} 条样本需要人工复核，复核后再进入自动 Skill 编译。`);
  }
  const uncoveredAgents = summary.byAgent.filter((agent) => agent.sampleCount === 0).slice(0, 3);
  if (uncoveredAgents.length) {
    messages.push(`这些智能体还缺训练样本：${uncoveredAgents.map((agent) => agent.name).join("、")}。`);
  }
  if (!messages.length && summary.totalSamples > 0) {
    messages.push("样本质量正常，可以继续导入聊天记录或纠正错误场景来扩充 Skill。");
  }
  if (!messages.length) {
    messages.push("还没有训练样本，先导入聊天记录或在路由结果里人工纠正场景。");
  }
  return messages;
}

function topEntries(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN")).slice(0, limit);
}

function maxIso(a, b) {
  if (!a) return b || "";
  if (!b) return a || "";
  return String(a).localeCompare(String(b)) >= 0 ? a : b;
}

function extractSkillNames(sample) {
  if (isSceneClarificationReply(sample.idealReply)) return ["防乱回复"];
  const hints = normalizeHints(sample.skillHints);
  if (hints.length) return hints;
  return inferSkillNames(`${sample.customerText || ""}\n${sample.idealReply || ""}`);
}

function normalizeHints(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,\u3001;；|]/)
        .map((item) => item.trim());
  return [...new Set(raw.map(normalizeHint).filter(Boolean))];
}

function normalizeHint(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (HINT_ALIASES.has(text)) return HINT_ALIASES.get(text);
  if (/预算|价格|每盒|每份|总预算|棰勭畻|浠锋牸/.test(text)) return "预算澄清";
  if (/设计|效果图|logo|Logo|摆拍|璁捐|鏁堟灉/.test(text)) return "设计需求确认";
  if (/物流|发货|快递|签收|鐗╂祦|鍙戣揣/.test(text)) return "物流安抚";
  if (/退款|退货|换货|补发|售后|閫€|琛ュ彂/.test(text)) return "售后方案";
  if (/亲|您|麻烦|建议|确认|高情商|浜瞸|楹荤儲/.test(text)) return "高情商话术";
  return text.slice(0, 24);
}

function inferSkillNames(text) {
  const names = [];
  const content = String(text || "");
  if (/预算|价格|每盒|每份|总预算|棰勭畻|浠锋牸/.test(content)) names.push("预算澄清");
  if (/设计|效果图|logo|Logo|摆拍|璁捐|鏁堟灉/.test(content)) names.push("设计需求确认");
  if (/物流|发货|快递|签收|鐗╂祦|鍙戣揣/.test(content)) names.push("物流安抚");
  if (/退款|退货|换货|补发|售后|閫€|琛ュ彂/.test(content)) names.push("售后方案");
  if (/亲|您|麻烦|建议|确认|高情商|浜瞸|楹荤儲/.test(content)) names.push("高情商话术");
  return names.length ? [...new Set(names)] : ["高情商承接"];
}

function findExistingSkill(existingSkills, agentId, name) {
  const key = canonicalSkillName(name);
  return existingSkills.find((skill) => {
    if (agentId && skill.agentId !== agentId) return false;
    return canonicalSkillName(skill.name) === key;
  });
}

function canonicalSkillName(name) {
  return normalizeHint(name).replace(/\s+/g, "").toLowerCase();
}

function buildSkillDescription(bucket, averageScore, evidence) {
  const scenes = [...bucket.scenes].slice(0, 3).join("、");
  const answer = evidence.answer ? `参考回复方式：${evidence.answer}` : "参考回复方式：先承接客户情绪，再给出明确下一步。";
  return `从 ${bucket.sampleIds.length} 条高分聊天样本提炼，适用于${scenes || "当前场景"}，平均评分 ${averageScore}。${answer}`;
}

function pickEvidence(questions, answers) {
  const question = longestUsefulText(questions);
  const answer = longestUsefulText(answers);
  return {
    question: truncate(question, 80),
    answer: truncate(answer, 120),
  };
}

function longestUsefulText(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => scoreEvidence(b) - scoreEvidence(a))[0] || "";
}

function scoreEvidence(text) {
  const value = String(text || "");
  let score = Math.min(value.length, 160);
  if (/亲|您|麻烦|建议|确认|可以|这边/.test(value)) score += 30;
  if (/不知道|自己看|不清楚|随便/.test(value)) score -= 80;
  return score;
}

function calculateConfidence(sampleCount, averageScore) {
  const countScore = Math.min(Number(sampleCount || 0) * 12, 36);
  return Math.max(0, Math.min(100, Math.round(Number(averageScore || 0) * 0.64 + countScore)));
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length);
}

function truncate(text, maxLength) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

module.exports = {
  compileAgentSkillSuggestions,
  summarizeTrainingSamples,
  canonicalSkillName,
  classifyTrainingSampleAttention,
  classifyTrainingSampleUsage,
  classifySkillSuggestionQuality,
  evaluateTrainingSampleQuality,
  isSceneClarificationReply,
  isSkillSuggestionSafeToApply,
  isTrainingSampleNeedingAttention,
  isTrainingSampleReady,
  normalizeTrainingSampleStatus,
  trainingSampleReviewNote,
};
