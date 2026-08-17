"use strict";

const XIAOSHI_PROFILE_VERSION = "xiaoshi_v4";
const XIAOSHI_APPROVED_SAMPLE_BASELINE = 32;

const XIAOSHI_SKILLS = [
  {
    id: "skill_builtin_xiaoshi_single_question",
    name: "小石式单点追问",
    description: "结合最近对话判断客户是在询问、补充、纠正、拒绝还是催促；先回答当前问题，再只推进最必要的一步，同一字段最多问一次。",
    agentKeys: ["pre_sales", "gift_design", "logistics_exception"],
    activation: "always",
  },
  {
    id: "skill_builtin_xiaoshi_price_objection",
    name: "小石式价格异议承接",
    description: "客户询价或觉得贵时，先问数量或预算，再说明礼品可以调整；不急着解释、不承诺最低价。",
    agentKeys: ["pre_sales"],
    triggers: ["多少钱", "怎么卖", "价格", "报价", "优惠", "便宜", "好贵", "太贵", "预算"],
  },
  {
    id: "skill_builtin_xiaoshi_bundle_change",
    name: "小石式搭配变更确认",
    description: "客户要删除或更换礼盒内容时，先确认保留项、数量或预期价格，再重新核价。",
    agentKeys: ["pre_sales", "gift_design"],
    triggers: ["更换", "换掉", "取消", "删掉", "去掉", "保留", "不要", "可以换", "调整"],
  },
  {
    id: "skill_builtin_xiaoshi_preference_translation",
    name: "小石式偏好翻译",
    description: "把“太可爱、不喜欢、不好看”等否定表达转成简单、商务、大气等正向偏好，再继续选品。",
    agentKeys: ["pre_sales", "gift_design"],
    triggers: ["太可爱", "不喜欢", "不好看", "简单", "商务", "大气", "风格", "颜色"],
  },
  {
    id: "skill_builtin_xiaoshi_soft_close",
    name: "小石式柔和收口",
    description: "客户明确不做、再看看或预算暂时不合适时，简短收口并保留以后再联系的空间，不继续施压。",
    agentKeys: ["pre_sales"],
    triggers: ["不定了", "不做了", "算了", "再看看", "以后再说", "班费", "拮据"],
  },
];

const XIAOSHI_STYLE_RULES = [
  "先理解这句话承接上一轮的哪一点，再决定回答、建议、确认或追问",
  "先准确回答客户当前问题，再推进一小步",
  "客户已经给出的信息不重复问",
  "同一需求里同一缺失字段最多问一次，客户暂时不答就先给方案",
  "一轮优先一个短问题，必要时才分成两句",
  "询价和议价优先确认数量、预算、时间或地区中的关键缺口",
  "否定偏好要翻译成正向风格，不与客户争辩",
  "不使用最低价、绝对品质、库存、交期、到账或赔付等未核实承诺",
];

function xiaoshiSkillsForRoute(route = {}) {
  const agentKey = String(route.agentKey || "");
  const text = String(route.text || "");
  return XIAOSHI_SKILLS
    .filter((skill) => skill.agentKeys.includes(agentKey))
    .filter((skill) => skill.activation === "always" || skill.triggers.some((trigger) => text.includes(trigger)))
    .map((skill) => ({
      ...skill,
      agentKey,
      enabled: true,
      version: 4,
      confidence: 96,
      sampleCount: XIAOSHI_APPROVED_SAMPLE_BASELINE,
      sourceType: "built_in_xiaoshi",
      scope: { level: "global", label: "小石内置 Skill", bindingStatus: "passed" },
    }));
}

function mergeXiaoshiSkills(skills = [], route = {}) {
  const existing = Array.isArray(skills) ? skills : [];
  const builtIn = xiaoshiSkillsForRoute(route);
  const builtInByName = new Map(builtIn.map((skill) => [normalizeSkillKey(skill.name), skill]));
  const upgradedExisting = existing.map((skill) => {
    const current = builtInByName.get(normalizeSkillKey(skill?.name));
    if (!current) return skill;
    return {
      ...skill,
      ...current,
      id: skill.id || current.id,
      enabled: true,
      confidence: Math.max(Number(skill.confidence || 0), Number(current.confidence || 0)),
      sampleCount: Math.max(Number(skill.sampleCount || 0), Number(current.sampleCount || 0)),
      version: Math.max(Number(skill.version || 1), Number(current.version || 1)),
      scope: skill.scope || current.scope,
    };
  });
  const existingNames = new Set(upgradedExisting.map((skill) => normalizeSkillKey(skill?.name)).filter(Boolean));
  return [
    ...upgradedExisting,
    ...builtIn.filter((skill) => !existingNames.has(normalizeSkillKey(skill.name))),
  ];
}

function buildXiaoshiStyleProfile(route = {}, knowledgeMatches = []) {
  const approvedMatch = (Array.isArray(knowledgeMatches) ? knowledgeMatches : []).find((match) => (
    match?.humanVerbatim === true
    && match?.allowVerbatim !== false
    && Number(match?.score || 0) >= 55
  ));
  return {
    id: XIAOSHI_PROFILE_VERSION,
    name: "小石真人客服",
    channel: "伴手礼行业客服",
    evidence: `${XIAOSHI_APPROVED_SAMPLE_BASELINE} 组已审核脱敏真人回复`,
    coveredAgentKeys: ["pre_sales", "gift_design", "logistics_exception"],
    activeForAgent: ["pre_sales", "gift_design", "logistics_exception"].includes(String(route.agentKey || "")),
    rules: XIAOSHI_STYLE_RULES.slice(),
    preserveHumanVerbatim: Boolean(approvedMatch),
    approvedKnowledgeId: approvedMatch?.id || null,
  };
}

function buildXiaoshiPreSalesReply(route = {}) {
  const text = String(route.text || "");
  const budget = route.budget || {};
  const quantity = Number(budget.quantity || 0);
  const perUnitAmount = Number(budget.perUnitAmount || 0);
  const totalAmount = Number(budget.totalAmount || 0);
  const hasQuantity = quantity > 0;
  const hasBudget = perUnitAmount > 0 || totalAmount > 0;
  const usageScene = String(route.salesContext?.usageScene || "").trim();
  const hasUsageScene = Boolean(usageScene);
  const stylePreference = String(route.salesContext?.stylePreference || "").trim();
  const quantityText = hasQuantity ? `${formatSalesNumber(quantity)}份` : "";
  const budgetText = perUnitAmount > 0
    ? `单份${formatSalesNumber(perUnitAmount)}元左右`
    : totalAmount > 0
      ? `总预算${formatSalesNumber(totalAmount)}元左右`
      : "";

  if (/不定了|不做了|算了|以后再说/.test(text)) return "好呢\n以后有需要再来找我哈";
  if (/好贵|太贵|超预算|预算.{0,4}(低|少)|再看看/.test(text)) {
    return hasBudget
      ? "预算我记得，我按这个范围调整下搭配。咱更想要实用一点还是有氛围感的？"
      : "咱这边预算多少，礼品可以调整";
  }
  if (/太可爱|不喜欢|不好看/.test(text)) return "那咱们看简单一点的哈";
  if (/还有别的|还有其他|其他款|换一个|换一款|换款|再看看其他|再看别的/.test(text)) {
    return stylePreference
      ? `可以，我按${stylePreference}这个方向再给您换几款哈`
      : "可以，我再给您换几款看看哈";
  }
  if (/更换|换掉|取消|删掉|去掉|保留|不要|可以换|调整/.test(text)) {
    return hasQuantity ? "可以换，咱先确认下哪些要保留哈" : "可以换，您要多少呀";
  }
  if (/有哪些款式|有哪几款|有哪些款|都有什么款|什么款式|看看款式|发几个款/.test(text)) {
    if (!hasQuantity) return hasUsageScene ? `${usageScene}收到，咱大概需要多少份呀？` : "款式挺多的，我先按数量给您筛，您大概需要多少份呀？";
    if (!hasBudget) return hasUsageScene ? `${usageScene}、${quantityText}收到，咱单份预算大概多少呢？` : `${quantityText}收到，咱单份预算大概多少呢？`;
    if (!hasUsageScene) return `${quantityText}、${budgetText}收到，我按这个范围给您挑。主要是什么场景用呀？`;
    return stylePreference
      ? `${usageScene}，${quantityText}、${budgetText}收到，我先按${stylePreference}一点给您挑几款哈`
      : `${usageScene}，${quantityText}、${budgetText}收到。咱偏实用还是氛围感一点？`;
  }
  if (/多少钱|怎么卖|价格|报价|优惠|便宜|单价/.test(text)) {
    if (!hasQuantity) return hasUsageScene ? `${usageScene}收到，咱大概需要多少份呀？` : "您要多少份呀";
    if (!hasBudget) return hasUsageScene ? `${usageScene}、${quantityText}收到，咱单份预算大概多少呢？` : `好呢，${quantityText}我记下了，咱单份预算大概多少呢？`;
    if (!hasUsageScene) return `${quantityText}、${budgetText}收到，我按这个范围给您找。主要是什么场景用呀？`;
    return stylePreference
      ? `${usageScene}，${quantityText}、${budgetText}收到，我先按${stylePreference}一点给您挑几款哈`
      : `${usageScene}，${quantityText}、${budgetText}收到。咱偏实用还是氛围感一点？`;
  }
  if (!hasQuantity) {
    return hasUsageScene
      ? `${usageScene}${stylePreference ? `、偏${stylePreference}` : ""}收到，咱大概需要多少份呀？`
      : "您要多少份呀";
  }
  if (!hasBudget) {
    return hasUsageScene
      ? `${usageScene}${stylePreference ? `、偏${stylePreference}` : ""}、${quantityText}收到，咱单份预算大概多少呢？`
      : `好呢，${quantityText}我记下了，咱单份预算大概多少呢？`;
  }
  if (!hasUsageScene) return `${quantityText}、${budgetText}收到。咱这个主要是什么场景用呀？`;
  return stylePreference
    ? `${usageScene}，${quantityText}、${budgetText}收到，我先按${stylePreference}一点给您挑几款哈`
    : `${usageScene}，${quantityText}、${budgetText}收到。咱偏实用还是氛围感一点？`;
}

function formatSalesNumber(value) {
  return Number.isInteger(Number(value)) ? String(Number(value)) : String(Math.round(Number(value) * 100) / 100);
}

function xiaoshiPromptGuidance(profile = {}) {
  if (!/^xiaoshi_v\d+$/.test(String(profile?.id || ""))) return [];
  return [
    "本轮使用“小石真人客服”风格：像熟练的伴手礼销售在微信里接话，口语、简短、有判断，不写客服公文。",
    "先结合最近对话判断客户是在询问、补充、纠正、拒绝还是催促；答案要针对当下语境即时组织，不复读固定话术。",
    "先回答客户当前问题，再决定是否需要追问；客户问得短就短答，优先只问一个最关键缺口。",
    "同一需求里同一个缺失字段最多问一次；客户没有回答时先给可执行方案，不要换句话重复追问。",
    "可以自然使用“咱这边、呀、哈、好呢、哦哦”，但不要每句都带称呼，也不要固定叫“亲”。",
    "价格异议先问数量或预算并允许调整组合；风格异议要翻译成正向偏好；客户明确放弃时简短收口。",
    "如果基准回复来自已审核小石原话，应原样保留，不扩写、不润色、不补客套话。",
  ];
}

function normalizeSkillKey(value) {
  return String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
}

module.exports = {
  XIAOSHI_APPROVED_SAMPLE_BASELINE,
  XIAOSHI_PROFILE_VERSION,
  XIAOSHI_SKILLS,
  XIAOSHI_STYLE_RULES,
  buildXiaoshiPreSalesReply,
  buildXiaoshiStyleProfile,
  mergeXiaoshiSkills,
  xiaoshiPromptGuidance,
  xiaoshiSkillsForRoute,
};
