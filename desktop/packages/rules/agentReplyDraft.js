"use strict";

const DEFAULT_MAX_SKILLS = 5;
const DEFAULT_MAX_KNOWLEDGE = 3;

function buildAgentReplyDraft(route = {}, context = {}) {
  const skills = selectSkills(context.skills || [], route, context.maxSkills || DEFAULT_MAX_SKILLS);
  const knowledgeMatches = matchKnowledge(route.text || "", context.knowledgeEntries || [], {
    agentId: context.agentId,
    max: context.maxKnowledge || DEFAULT_MAX_KNOWLEDGE,
  });
  const suggestedReply = composeReply(route, skills, knowledgeMatches);
  return {
    suggestedReply,
    appliedSkills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description || "",
      confidence: Number(skill.confidence || 0),
      sampleCount: Number(skill.sampleCount || 0),
      version: Number(skill.version || 1),
    })),
    knowledgeMatches,
    replyDraft: {
      source: skills.length || knowledgeMatches.length ? "skill_enhanced" : "rule_based",
      style: "warm_precise_service",
      nextAction: inferNextAction(route),
      safetyChecks: buildSafetyChecks(route),
    },
  };
}

function selectSkills(skills, route, max) {
  const wanted = wantedSkillNames(route);
  return [...skills]
    .filter((skill) => skill && skill.enabled !== false)
    .map((skill) => ({
      ...skill,
      relevance: scoreSkill(skill, route, wanted),
    }))
    .filter((skill) => skill.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, max);
}

function wantedSkillNames(route) {
  const names = new Set(["高情商话术"]);
  if (route.agentKey === "gift_design") {
    names.add("预算澄清");
    names.add("设计需求确认");
    if (route.isHighValue) names.add("高价值转人工");
  }
  if (route.agentKey === "logistics_exception") names.add("物流安抚");
  if (route.agentKey === "after_sales") names.add("售后方案");
  if (route.agentKey === "size_recommendation") names.add("参数追问");
  if (route.action === "collect_info") names.add("需求澄清");
  if ((route.missingFields || []).includes("scene_clarification")) names.add("场景澄清");
  if (route.action === "manual_review") names.add("防乱回复");
  return [...names];
}

function scoreSkill(skill, route, wanted) {
  const name = normalizeSkillName(skill.name);
  const description = String(skill.description || "");
  let score = 0;
  if (wanted.some((item) => normalizeSkillName(item) === name)) score += 60;
  if (route.agentKey === "gift_design" && /预算|设计|效果图|Logo|logo|礼盒/.test(`${name}${description}`)) score += 24;
  if (route.agentKey === "logistics_exception" && /物流|发货|快递|签收/.test(`${name}${description}`)) score += 24;
  if (route.agentKey === "after_sales" && /售后|退款|退货|换货|补发/.test(`${name}${description}`)) score += 24;
  if (/高情商|自然|负责|承接/.test(`${name}${description}`)) score += 12;
  score += Math.min(Number(skill.confidence || 0), 100) / 10;
  score += Math.min(Number(skill.sampleCount || 0), 10);
  return Math.round(score);
}

function matchKnowledge(text, entries, options = {}) {
  const content = String(text || "");
  return [...entries]
    .filter((entry) => entry && (!options.agentId || entry.agentId === options.agentId))
    .map((entry) => {
      const score = scoreKnowledge(content, entry);
      return {
        id: entry.id,
        title: entry.title || "",
        qualityScore: Number(entry.qualityScore || 0),
        score,
        excerpt: extractReplyExcerpt(entry.content || ""),
        tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 6) : [],
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.qualityScore - a.qualityScore)
    .slice(0, options.max || DEFAULT_MAX_KNOWLEDGE);
}

function scoreKnowledge(text, entry) {
  const content = `${entry.title || ""}\n${entry.content || ""}\n${Array.isArray(entry.tags) ? entry.tags.join(" ") : ""}`;
  let score = 0;
  for (const keyword of extractKeywords(text)) {
    if (content.includes(keyword)) score += keyword.length >= 3 ? 12 : 6;
  }
  score += Math.min(Number(entry.qualityScore || 0), 100) / 5;
  return Math.round(score);
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
    "尺码",
  ];
  for (const keyword of dictionary) {
    if (value.includes(keyword)) keywords.push(keyword);
  }
  return [...new Set(keywords)];
}

function composeReply(route, skills, knowledgeMatches) {
  const budget = route.budget || {};
  const skillNames = new Set(skills.map((skill) => normalizeSkillName(skill.name)));
  const exemplar = knowledgeMatches[0]?.excerpt || "";

  if (route.action === "manual_review") {
    if (route.isHighValue) {
      return "可以的，这个需求金额比较重要，我先帮您把预算、数量、用途和素材整理清楚，再交给专人审核方案和报价，避免后面反复改。";
    }
    if ((route.riskFlags || []).length) {
      return "收到，我先认真记录您反馈的情况。这个问题需要核实后再给明确处理方案，我马上转人工跟进，避免回复不准确。";
    }
    return "收到，这个问题我先不直接下结论，会帮您转给人工确认后再回复，保证处理更稳妥。";
  }

  if (route.action === "collect_info") {
    if (route.sceneClarification?.question) {
      return route.sceneClarification.question;
    }
    const labels = (route.missingFields || []).map(fieldLabel).join("、") || "关键信息";
    return `可以的，我先帮您往下推进。为了方案更准确，还需要您补充一下：${labels}。补齐后我就能继续给您整理方案。`;
  }

  if (route.agentKey === "gift_design") {
    const budgetText = budget.perUnitAmount
      ? `按每份 ${budget.perUnitAmount} 元`
      : budget.totalAmount
        ? `按总预算 ${budget.totalAmount} 元`
        : "按您的预算";
    const quantityText = budget.quantity ? `、${budget.quantity} 份` : "";
    const suffix = skillNames.has("设计需求确认")
      ? "同时我会核对 Logo、参考图、用途和礼盒搭配，确保效果图不乱换商品。"
      : "我先把关键信息确认清楚。";
    return `${budgetText}${quantityText}可以做。我先帮您搭一套礼盒组合，再整理几版真实产品摆拍效果图给您挑。${suffix}`;
  }

  if (route.agentKey === "logistics_exception") {
    return exemplar || "收到，我先帮您核对物流进度。如果确实停滞，我会同步安排催件或补发方案，再把处理结果告诉您。";
  }

  if (route.agentKey === "after_sales") {
    return "收到，我先帮您核对订单和问题凭证。确认具体情况后，会给您一个明确的处理方案；涉及退款、补发或争议的部分会先转人工确认。";
  }

  if (route.agentKey === "size_recommendation") {
    return "可以，我先根据您的身高、体重、版型偏好和商品尺码规则来判断。信息不全的话我会先补问关键参数，再给建议。";
  }

  return "收到，我先按您这个情况整理关键信息，再给您一个明确的下一步处理方式。";
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
  const match = value.match(/客服[:：]\s*(.+)$/m);
  return truncate((match ? match[1] : value).replace(/\s+/g, " "), 120);
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
  matchKnowledge,
  selectSkills,
};
