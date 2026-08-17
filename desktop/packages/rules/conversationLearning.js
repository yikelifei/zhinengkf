"use strict";

const MUTABLE_FACT_CATEGORIES = Object.freeze([
  "price",
  "stock",
  "freight",
  "delivery_promise",
  "temporary_discount",
]);

const FIELD_LABELS = Object.freeze({
  budget: "预算",
  quantity: "采购数量",
  usage_scene: "使用场景",
  style_preference: "风格偏好",
  customer_assets: "Logo或设计素材",
  deadline: "交付时间",
  order_or_tracking: "订单号或快递单号",
  order_or_evidence: "订单信息或问题凭证",
  order_or_payment_info: "订单号或付款信息",
});

const REASON_DEFINITIONS = Object.freeze([
  {
    code: "explicit_cancel",
    label: "客户明确取消",
    patterns: [/不(?:做|要|定|买)了/, /取消(?:吧|订单)?/, /先不考虑了/, /暂时不需要了/, /已经(?:找|定)别家了/],
    confidence: 0.98,
  },
  {
    code: "price_budget_gap",
    label: "价格超出预算",
    patterns: [/太贵了?/, /价格高了?/, /超(?:出)?预算/, /预算(?:没这么多|不够|太低)/, /便宜(?:一|点|些)/, /这个价(?:不行|接受不了)/],
    confidence: 0.92,
  },
  {
    code: "platform_price_comparison",
    label: "平台比价",
    patterns: [/1688/, /阿里巴巴/, /淘宝.*(?:便宜|价格)/, /别家.*(?:便宜|低)/, /对比.*价格/, /网上.*(?:便宜|价格)/],
    confidence: 0.9,
  },
  {
    code: "quantity_or_moq_mismatch",
    label: "数量或起订量不匹配",
    patterns: [/数量太少/, /起订量/, /最低.*(?:个|份|套|盒)/, /只要[一二三四五六七八九十\d]+(?:个|份|套|盒)/, /三五(?:个|份|套|盒)/, /小单/],
    confidence: 0.88,
  },
  {
    code: "product_style_mismatch",
    label: "产品或风格不匹配",
    patterns: [/不好看/, /不喜欢/, /没(?:有)?合适的/, /不太合适/, /款式不合适/, /质感不(?:行|好)/, /不喜欢.*(?:款|颜色|风格)/],
    confidence: 0.9,
  },
  {
    code: "sample_quality_or_followup",
    label: "样品体验或样品跟进受阻",
    patterns: [/样品.*(?:不满意|不好|一般|质感)/, /实物.*(?:不满意|不好|一般|质感)/, /样品.*(?:没收到|还没到)/],
    confidence: 0.9,
  },
  {
    code: "delivery_timeline_mismatch",
    label: "交期不匹配",
    patterns: [/来不及/, /时间太赶/, /交期太长/, /赶不上/, /等不了/, /必须.*(?:前|号).*到/],
    confidence: 0.9,
  },
  {
    code: "decision_delayed",
    label: "决策尚未完成",
    patterns: [/问下领导/, /领导.*(?:确认|决定|回复)/, /考虑一下/, /商量一下/, /出差/, /过两天/, /晚点回复/, /再看看/],
    confidence: 0.72,
  },
]);

const REASON_ACTIONS = Object.freeze({
  explicit_cancel: ["记录客户明确取消的原话和时间，不再高频追问。", "若客户说明了替代供应商或具体缺口，将该信息标为待复核经验。"],
  price_budget_gap: ["先确认单份预算、数量和必须保留的配置，再给同预算的减配方案。", "报价时解释材质、包装和定制项的差异，不只报一个总价。"],
  platform_price_comparison: ["把1688裸品价与含包装、设计、定制、品控和交付的方案价分开说明。", "如果客户只需要标准现货，直接给固定链接，减少无效搭配时间。"],
  quantity_or_moq_mismatch: ["先确认数量，再判断走固定链接、标准款还是定制方案。", "小单不要承诺单独搭配；给出可直接下单的现成款。"],
  product_style_mismatch: ["追问不喜欢的是颜色、材质、包装还是产品本身，一次只缩小一个变量。", "下一轮只发2至3个差异明显的候选，不重复堆图。"],
  sample_quality_or_followup: ["样品签收前后各跟进一次，并询问具体不满意点。", "把质感反馈关联到具体SKU或包装，不把模糊评价直接写入永久知识。"],
  delivery_timeline_mismatch: ["先确认必须到货日期和城市，再核对真实生产与物流时效。", "时效未经供应链确认前，不做确定性承诺。"],
  decision_delayed: ["约定明确的下次联系时间，并留下便于内部转发的一页方案。", "不要把客户的暂缓表述直接判定为丢单。"],
  customer_silent_after_followup: ["先检查最后一条是否真正回答了客户问题，再做一次带新信息的短跟进。", "沉默只能标记为停滞，不能在没有证据时判定客户流失。"],
  qualification_incomplete: ["补齐数量、单份预算、用途和到货时间，再进入推荐或报价。", "每次只问最影响下一步的1至2个问题，避免连续审问。"],
  unknown_insufficient_evidence: ["请客服人工选择结果和原因，或补充客户原话。", "证据不足时保留为待判断，不把模型猜测写入训练知识。"],
  converted: ["复盘促成成交的关键问题、方案和跟进节点。", "可复用表达仍需脱敏和人工复核后再进入知识库。"],
});

function buildConversationLearningInsight(input = {}) {
  const text = normalizeText(input.text);
  const route = input.route && typeof input.route === "object" ? input.route : {};
  const facts = extractOpportunityFacts(text, route);
  const objections = matchReasonDefinitions(text).map((item) => ({
    code: item.code,
    label: item.label,
    evidence: excerpt(text),
    confidence: item.confidence,
  }));
  const positiveSignals = extractPositiveSignals(text);
  const unansweredQuestions = uniqueStrings(route.missingFields)
    .map((field) => ({ field, label: FIELD_LABELS[field] || field }));
  const stage = inferConversationStage(text, route, objections);
  const nextBestAction = chooseNextBestAction({ stage, objections, unansweredQuestions, positiveSignals });

  return {
    schema: "conversation_learning_v1",
    observedAt: input.observedAt || new Date().toISOString(),
    sourceMessageId: input.messageId || null,
    customerIntent: inferCustomerIntent(text, route),
    stage,
    knownFacts: facts,
    objections,
    positiveSignals,
    unansweredQuestions,
    agentAction: String(route.action || "").trim() || null,
    nextBestAction,
    learningPolicy: {
      autoPromote: false,
      status: "review_required",
      reason: "单轮客户表达只能形成会话经验；经人工复核后才能进入知识库或Skill。",
      blockedMutableFactCategories: [...MUTABLE_FACT_CATEGORIES],
    },
  };
}

function analyzeConversationConversion(input = {}) {
  const messages = normalizeMessages(input.messages);
  const inbound = messages.filter((item) => item.direction === "inbound" && item.text);
  const quotes = Array.isArray(input.quotes) ? input.quotes : [];
  const orders = Array.isArray(input.orders) ? input.orders : [];
  const routes = Array.isArray(input.routes) ? input.routes : [];
  const confirmation = normalizeOutcomeConfirmation(input.confirmedOutcome || latestConfirmedOutcome(routes));
  const matchedReasons = collectConversationReasons(inbound);
  const explicitCancel = matchedReasons.find((item) => item.code === "explicit_cancel") || null;
  const activeOrder = orders.find((item) => !["cancelled", "rejected", "closed_lost"].includes(String(item?.status || "").toLowerCase()));
  const acceptedQuote = quotes.find((item) => (
    String(item?.status || "").toLowerCase() === "accepted" ||
    ["deposit_paid", "paid"].includes(String(item?.paymentStatus || "").toLowerCase())
  ));
  const rejectedQuote = quotes.find((item) => ["rejected", "cancelled"].includes(String(item?.status || "").toLowerCase()));
  const storedStatus = String(input.conversation?.status || "").toLowerCase();

  let outcome = "ongoing";
  let outcomeSource = "automatic";
  let outcomeConfidence = 0.55;
  if (confirmation) {
    outcome = confirmation.outcome;
    outcomeSource = "operator_confirmed";
    outcomeConfidence = 1;
  } else if (activeOrder || acceptedQuote) {
    outcome = "won";
    outcomeConfidence = activeOrder ? 1 : 0.96;
  } else if (rejectedQuote || explicitCancel || ["lost", "closed_lost"].includes(storedStatus)) {
    outcome = "lost";
    outcomeConfidence = explicitCancel || rejectedQuote ? 0.96 : 0.85;
  }

  const silence = analyzeSilence(messages, input.now);
  let primaryReason = null;
  if (confirmation?.reasonCode) {
    primaryReason = buildConfirmedReason(confirmation, inbound);
  } else if (outcome === "won") {
    primaryReason = { code: "converted", label: "已形成成交记录", confidence: outcomeConfidence, evidence: commerceEvidence(activeOrder, acceptedQuote) };
  } else {
    primaryReason = matchedReasons.find((item) => item.code !== "decision_delayed")
      || matchedReasons[0]
      || (silence.stalled ? {
        code: "customer_silent_after_followup",
        label: "客户在跟进后暂未回复",
        confidence: 0.58,
        evidence: silence.evidence,
        inference: true,
      } : null)
      || (quotes.length === 0 ? {
        code: "qualification_incomplete",
        label: "需求信息尚未补齐或尚未进入报价",
        confidence: 0.52,
        evidence: qualificationEvidence(routes),
        inference: true,
      } : null)
      || {
        code: "unknown_insufficient_evidence",
        label: "现有聊天证据不足",
        confidence: 0.25,
        evidence: [],
        inference: true,
      };
  }

  const secondaryReasons = matchedReasons.filter((item) => item.code !== primaryReason.code).slice(0, 3);
  const state = outcome === "won" ? "converted" : outcome === "lost" ? "not_converted" : silence.stalled ? "stalled" : "in_progress";
  return {
    schema: "conversion_feedback_v1",
    generatedAt: input.now || new Date().toISOString(),
    conversationId: input.conversation?.id || input.conversationId || null,
    outcome,
    state,
    outcomeSource,
    outcomeConfidence,
    whyNotConverted: outcome === "won"
      ? "已有订单、已接受报价或人工确认的成交证据。"
      : `${primaryReason.label}${primaryReason.inference ? "（基于现有记录推断，待人工确认）" : ""}。`,
    primaryReason,
    secondaryReasons,
    recommendedActions: REASON_ACTIONS[primaryReason.code] || REASON_ACTIONS.unknown_insufficient_evidence,
    evidencePolicy: {
      grounded: true,
      silenceIsNotLoss: true,
      humanConfirmationRequiredForLearning: true,
      autoPromoteToKnowledge: false,
    },
    metrics: {
      messageCount: messages.length,
      inboundCount: inbound.length,
      quoteCount: quotes.length,
      orderCount: orders.length,
      lastActivityAt: messages.length ? messages[messages.length - 1].createdAt || null : null,
      stalledHours: silence.stalledHours,
    },
    confirmedOutcome: confirmation,
  };
}

function extractOpportunityFacts(text, route) {
  const facts = [];
  const budget = route.budget && typeof route.budget === "object" ? route.budget : {};
  addNumericFact(facts, "quantity", "采购数量", budget.quantity, "route_budget", text);
  addNumericFact(facts, "per_unit_budget", "单份预算", budget.perUnitAmount, "route_budget", text, "元");
  addNumericFact(facts, "total_budget", "总预算", budget.totalAmount, "route_budget", text, "元");
  if (!facts.some((item) => item.field === "quantity")) {
    const match = text.match(/(\d{1,7})\s*(个|份|套|盒|位|人份)/);
    if (match) facts.push(fact("quantity", "采购数量", Number(match[1]), match[0], "message"));
  }
  if (!facts.some((item) => item.field.includes("budget"))) {
    const match = text.match(/(?:预算|价位|单价|每份|每个|控制在)?\s*(\d+(?:\.\d+)?)\s*(?:元|块)(?:\s*(?:左右|以内|以下))?/);
    if (match) facts.push(fact("stated_budget", "客户表述的预算或价位", Number(match[1]), match[0], "message", "元"));
  }
  const occasion = findFirst(text, ["教师节", "中秋", "医师节", "开业", "年会", "周年庆", "商务拜访", "员工福利", "客户答谢", "婚礼"]);
  if (occasion) facts.push(fact("occasion", "使用场景", occasion, occasion, "message"));
  const industry = findFirst(text, ["瑜伽", "普拉提", "美容院", "美业", "服装店", "酒店", "民宿", "学校", "医院", "企业", "饺子店"]);
  if (industry) facts.push(fact("industry", "客户行业", industry, industry, "message"));
  const deadline = text.match(/(?:要|希望|必须|最晚)?\s*(\d{1,2}月\d{1,2}日|\d{1,2}号|下周[一二三四五六日天]|这周[一二三四五六日天]|月底|本月底)(?:前|之前)?(?:到|收到|交付)?/);
  if (deadline) facts.push(fact("deadline", "期望到货时间", deadline[1], deadline[0], "message", "", true));
  return dedupeFacts(facts);
}

function inferConversationStage(text, route, objections) {
  const agentKey = String(route.agentKey || "");
  if (agentKey === "after_sales" || /售后|退款|破损|补发/.test(text)) return "after_sales";
  if (/下单|付款|合同|开票|定金/.test(text)) return "decision";
  if (/样品|寄样/.test(text)) return "sample";
  if (/报价|多少钱|价格|单价|总价/.test(text)) return "quotation";
  if (objections.length) return "objection_handling";
  if (/推荐|搭配|方案|款式|礼盒/.test(text)) return "recommendation";
  if (uniqueStrings(route.missingFields).length) return "qualification";
  return "discovery";
}

function inferCustomerIntent(text, route) {
  if (/下单|付款|合同|开票/.test(text)) return "推进下单";
  if (/报价|多少钱|价格|预算|单价/.test(text)) return "询价或预算匹配";
  if (/推荐|搭配|方案|款式|礼盒/.test(text)) return "选品或方案推荐";
  if (/样品|寄样/.test(text)) return "样品确认";
  if (/物流|快递|发货|到货/.test(text)) return "交付进度";
  if (route.scene) return `场景：${route.scene}`;
  return "需求待进一步确认";
}

function chooseNextBestAction({ objections, unansweredQuestions, positiveSignals }) {
  if (objections.length) return (REASON_ACTIONS[objections[0].code] || REASON_ACTIONS.unknown_insufficient_evidence)[0];
  if (unansweredQuestions.length) return `优先确认${unansweredQuestions.slice(0, 2).map((item) => item.label).join("和")}，一次不要追问过多。`;
  if (positiveSignals.length) return "直接回应客户当前问题，并给出一个清晰的下一步选择。";
  return "先准确回答本轮问题，再追问一个最影响推荐或报价的信息。";
}

function collectConversationReasons(inbound) {
  const rows = [];
  for (const message of inbound) {
    for (const definition of REASON_DEFINITIONS) {
      if (!definition.patterns.some((pattern) => pattern.test(message.text))) continue;
      const existing = rows.find((item) => item.code === definition.code);
      const evidence = messageEvidence(message);
      if (existing) existing.evidence.push(evidence);
      else rows.push({ code: definition.code, label: definition.label, confidence: definition.confidence, evidence: [evidence], inference: false });
    }
  }
  return rows.sort((left, right) => right.confidence - left.confidence);
}

function matchReasonDefinitions(text) {
  return REASON_DEFINITIONS.filter((definition) => definition.patterns.some((pattern) => pattern.test(text)));
}

function extractPositiveSignals(text) {
  const signals = [];
  const definitions = [
    ["request_quote", "主动询价", /报价|多少钱|单价|总价/],
    ["request_sample", "希望看样或寄样", /样品|寄样|看实物/],
    ["request_design", "希望设计或定制", /定制|设计|效果图|Logo/],
    ["purchase_intent", "出现下单意向", /怎么下单|可以下单|付款|合同|开票/],
    ["quantity_provided", "已提供数量", /\d{1,7}\s*(?:个|份|套|盒|位|人份)/],
  ];
  for (const [code, label, pattern] of definitions) {
    if (pattern.test(text)) signals.push({ code, label, evidence: excerpt(text) });
  }
  return signals;
}

function analyzeSilence(messages, nowValue) {
  if (!messages.length) return { stalled: false, stalledHours: 0, evidence: [] };
  const last = messages[messages.length - 1];
  const lastAt = Date.parse(String(last.createdAt || ""));
  const now = Date.parse(String(nowValue || "")) || Date.now();
  const hours = Number.isFinite(lastAt) ? Math.max(0, Math.round(((now - lastAt) / 36e5) * 10) / 10) : 0;
  const stalled = last.direction === "outbound" && hours >= 24;
  return {
    stalled,
    stalledHours: stalled ? hours : 0,
    evidence: stalled ? [messageEvidence(last)] : [],
  };
}

function latestConfirmedOutcome(routes) {
  const sorted = [...routes].sort((left, right) => String(right?.updatedAt || right?.createdAt || "").localeCompare(String(left?.updatedAt || left?.createdAt || "")));
  return sorted.map((item) => item?.conversionAssessment?.confirmedOutcome).find(Boolean) || null;
}

function normalizeOutcomeConfirmation(value) {
  if (!value || typeof value !== "object") return null;
  const outcome = String(value.outcome || "").toLowerCase();
  if (!["won", "lost", "ongoing"].includes(outcome)) return null;
  return {
    outcome,
    reasonCode: String(value.reasonCode || "").trim() || null,
    note: String(value.note || "").trim() || null,
    reviewer: String(value.reviewer || "").trim() || null,
    confirmedAt: value.confirmedAt || null,
  };
}

function buildConfirmedReason(confirmation, inbound) {
  const definition = REASON_DEFINITIONS.find((item) => item.code === confirmation.reasonCode);
  const label = definition?.label || (confirmation.reasonCode === "converted" ? "人工确认已成交" : "人工确认的成交结果");
  return {
    code: confirmation.reasonCode || (confirmation.outcome === "won" ? "converted" : "unknown_insufficient_evidence"),
    label,
    confidence: 1,
    evidence: confirmation.note ? [{ source: "operator_confirmation", excerpt: excerpt(confirmation.note) }] : inbound.slice(-1).map(messageEvidence),
    inference: false,
  };
}

function commerceEvidence(order, quote) {
  if (order) return [{ source: "order", id: order.id || null, status: order.status || null, excerpt: `订单状态：${order.status || "已创建"}` }];
  if (quote) return [{ source: "quote", id: quote.id || null, status: quote.status || null, excerpt: `报价状态：${quote.status || "accepted"}` }];
  return [];
}

function qualificationEvidence(routes) {
  const latest = [...routes].sort((left, right) => String(right?.createdAt || "").localeCompare(String(left?.createdAt || "")))[0];
  const missing = uniqueStrings(latest?.missingFields).map((field) => FIELD_LABELS[field] || field);
  return missing.length ? [{ source: "route", id: latest?.id || null, excerpt: `待补充：${missing.join("、")}` }] : [];
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((item, index) => ({
      id: item?.id || `message_${index}`,
      direction: String(item?.direction || "").toLowerCase(),
      text: normalizeText(item?.text),
      createdAt: item?.createdAt || item?.sentAt || null,
    }))
    .filter((item) => ["inbound", "outbound"].includes(item.direction))
    .sort((left, right) => {
      const time = String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
      return time || String(left.id).localeCompare(String(right.id));
    });
}

function messageEvidence(message) {
  return {
    source: "message",
    messageId: message.id || null,
    direction: message.direction || null,
    createdAt: message.createdAt || null,
    excerpt: excerpt(message.text),
  };
}

function addNumericFact(target, field, label, value, source, text, unit = "") {
  const number = Number(value || 0);
  if (number > 0) target.push(fact(field, label, number, excerpt(text), source, unit));
}

function fact(field, label, value, evidence, source, unit = "", mutable = false) {
  return { field, label, value, unit: unit || null, evidence: excerpt(evidence), source, mutable };
}

function dedupeFacts(facts) {
  const seen = new Set();
  return facts.filter((item) => {
    const key = `${item.field}:${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function findFirst(text, values) {
  return values.find((value) => text.includes(value)) || "";
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function excerpt(value, max = 80) {
  const text = normalizeText(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

module.exports = {
  MUTABLE_FACT_CATEGORIES,
  REASON_DEFINITIONS,
  analyzeConversationConversion,
  buildConversationLearningInsight,
};
