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
  const summary = {
    safeSamples: 0,
    reviewQualitySamples: 0,
    riskSamples: 0,
    blockedSamples: 0,
    trainableSamples: 0,
    antiWrongReplySamples: 0,
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
    if (quality.flags.includes("low_score")) summary.lowScoreSamples += 1;
    if (quality.flags.includes("missing_answer")) summary.missingAnswerSamples += 1;
    if (quality.flags.includes("missing_skill_hints")) summary.missingSkillHintSamples += 1;
  }

  return summary;
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
  classifySkillSuggestionQuality,
  evaluateTrainingSampleQuality,
  isSceneClarificationReply,
  isSkillSuggestionSafeToApply,
  isTrainingSampleReady,
  normalizeTrainingSampleStatus,
  trainingSampleReviewNote,
};
