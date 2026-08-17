"use strict";

const DEFAULT_MAX_RESULTS = 3;
const DEFAULT_MIN_SCORE = 32;

function retrieveKnowledgeRag(query, entries = [], options = {}) {
  const normalizedQuery = normalizeText(query);
  const contextQuery = String(options.contextQuery || "").trim();
  const normalizedContextQuery = normalizeText(contextQuery);
  const sourceEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const eligibleEntries = sourceEntries.filter((entry) => !entry.status || entry.status === "ready");
  const documents = eligibleEntries.map(buildDocument);
  const queryTokens = tokenize(query);
  const contextTokens = tokenize(contextQuery);
  const documentFrequency = buildDocumentFrequency(documents);
  const querySignals = detectKnowledgeSignals(query);
  const contextSignals = detectKnowledgeSignals(contextQuery);
  const knownFacts = new Set([
    ...detectKnownCustomerFacts(query),
    ...normalizeKnownFacts(options.knownFacts),
  ]);
  const minScore = Number.isFinite(Number(options.minScore)) ? Number(options.minScore) : DEFAULT_MIN_SCORE;
  const max = Math.max(1, Number(options.max || DEFAULT_MAX_RESULTS));

  const rankedCandidates = documents
    .map((document) => scoreDocument({
      query,
      normalizedQuery,
      queryTokens,
      querySignals,
      contextQuery,
      normalizedContextQuery,
      contextTokens,
      contextSignals,
      knownFacts,
      document,
      documents,
      documentFrequency,
    }))
    .filter((result) => result.score >= minScore)
    .sort((left, right) => (
      right.score - left.score
      || right.qualityScore - left.qualityScore
      || Number(right.humanVerbatim) - Number(left.humanVerbatim)
    ));
  const excludedByContextConflict = rankedCandidates.filter((result) => result.contextConflicts.length);
  const ranked = rankedCandidates.filter((result) => !result.contextConflicts.length);

  const matches = diversifyMatches(ranked, max);
  const top = matches[0] || null;
  return {
    matches,
    trace: {
      strategy: "hybrid_bm25_chargram_state_rerank_v3_context",
      query: String(query || ""),
      contextQuery,
      querySignals,
      contextSignals,
      knownFacts: [...knownFacts],
      candidateCount: sourceEntries.length,
      eligibleCount: eligibleEntries.length,
      excludedByReviewStatus: sourceEntries.length - eligibleEntries.length,
      excludedByContextConflict: excludedByContextConflict.length,
      contextConflictFields: [...new Set(excludedByContextConflict.flatMap((item) => item.contextConflicts))],
      retrievedCount: matches.length,
      minScore,
      topScore: top?.score || 0,
      confidence: top?.ragConfidence || "none",
      decision: top?.allowVerbatim
        ? "use_reviewed_verbatim"
        : top && top.score >= 45
          ? "grounded_synthesis"
          : "fallback",
      topKnowledgeId: top?.id || null,
    },
  };
}

function buildDocument(entry) {
  const customerText = extractCustomerText(entry.content);
  const replyText = extractServiceText(entry.content);
  const tags = Array.isArray(entry.tags) ? entry.tags.map(String) : [];
  const title = String(entry.title || "");
  const weightedText = [title, tags.join(" "), customerText, customerText, customerText].join("\n");
  return {
    entry,
    customerText,
    replyText,
    title,
    tags,
    normalizedCustomer: normalizeText(customerText),
    normalizedEvidence: normalizeText(`${title}\n${customerText}\n${tags.join(" ")}`),
    tokens: tokenize(weightedText),
    signals: detectKnowledgeSignals(`${title}\n${customerText}\n${tags.join(" ")}`),
  };
}

function scoreDocument(context) {
  const {
    normalizedQuery,
    queryTokens,
    querySignals,
    normalizedContextQuery,
    contextTokens,
    contextSignals,
    knownFacts,
    document,
    documents,
    documentFrequency,
  } = context;
  const bm25 = bm25Score(queryTokens, document.tokens, documents, documentFrequency);
  const contextBm25 = bm25Score(contextTokens, document.tokens, documents, documentFrequency);
  const charSimilarity = Math.max(
    ngramCosine(normalizedQuery, document.normalizedCustomer),
    ngramCosine(normalizedQuery, document.normalizedEvidence),
  );
  const contextCharSimilarity = Math.max(
    ngramCosine(normalizedContextQuery, document.normalizedCustomer),
    ngramCosine(normalizedContextQuery, document.normalizedEvidence),
  );
  const exactCustomer = Boolean(normalizedQuery && normalizedQuery === document.normalizedCustomer);
  const containment = Boolean(
    normalizedQuery
    && (document.normalizedEvidence.includes(normalizedQuery) || normalizedQuery.includes(document.normalizedCustomer))
  );
  const signalMatches = querySignals.filter((signal) => document.signals.includes(signal));
  const contextSignalMatches = contextSignals.filter((signal) => document.signals.includes(signal));
  const signalRatio = querySignals.length ? signalMatches.length / querySignals.length : 0;
  const contextSignalRatio = contextSignals.length ? contextSignalMatches.length / contextSignals.length : 0;
  const qualityScore = clamp(Number(document.entry.qualityScore || 0), 0, 100);
  const humanVerbatim = isReviewedHumanVerbatim(document.entry);
  const replySafe = Boolean(document.replyText) && !/\[附件\]|\[引用|<msg|wxid_|1\d{10}/i.test(document.replyText);
  const contextConflicts = detectReplyRequestedFacts(document.replyText)
    .filter((fact) => knownFacts.has(fact));
  const currentGrounding = exactCustomer || containment || charSimilarity >= 0.14 || bm25 >= 0.35 || signalMatches.length > 0;
  const contextGrounding = Boolean(normalizedContextQuery)
    && (contextCharSimilarity >= 0.14 || contextBm25 >= 0.35 || contextSignalMatches.length > 0);
  const hasGrounding = currentGrounding || contextGrounding;

  let score = 0;
  if (hasGrounding) {
    score += exactCustomer ? 36 : containment ? 22 : 0;
    score += Math.min(bm25, 10) / 10 * 36;
    score += charSimilarity * 34;
    score += signalRatio * 24;
    if (contextGrounding) {
      score += Math.min(20,
        Math.min(contextBm25, 10) / 10 * 8
        + contextCharSimilarity * 8
        + contextSignalRatio * 8);
    }
    score += qualityScore / 100 * 8;
    if (humanVerbatim) score += 4;
  }
  score = Math.round(score);
  const ragConfidence = score >= 78 ? "high" : score >= 55 ? "medium" : score >= 35 ? "low" : "none";
  const allowVerbatim = currentGrounding && humanVerbatim && replySafe && contextConflicts.length === 0 && score >= 55;
  const reasons = [];
  if (exactCustomer) reasons.push("客户问法完全一致");
  else if (containment) reasons.push("客户问法为已审核样本的近似子句");
  if (bm25 >= 0.35) reasons.push("BM25 关键词相关");
  if (charSimilarity >= 0.25) reasons.push("中文短句相似");
  if (signalMatches.length) reasons.push(`业务信号一致：${signalMatches.join("、")}`);
  if (contextGrounding) reasons.push("已确认会话上下文相关");
  if (humanVerbatim) reasons.push("来源为已审核小石脱敏原话");
  if (contextConflicts.length) reasons.push(`已知信息冲突：重复追问${contextConflicts.map(factLabel).join("、")}`);

  return {
    id: document.entry.id,
    title: document.title,
    sourceType: document.entry.sourceType || "",
    humanVerbatim,
    qualityScore,
    score,
    ragConfidence,
    allowVerbatim,
    contextConflicts,
    excerpt: formatReplyExcerpt(document.replyText || document.entry.content),
    customerExample: truncate(document.customerText, 180),
    tags: document.tags.slice(0, 8),
    retrievalReasons: reasons,
    matchedSignals: [...new Set([...signalMatches, ...contextSignalMatches])],
    scoreComponents: {
      bm25: round(bm25, 3),
      charSimilarity: round(charSimilarity, 3),
      signalRatio: round(signalRatio, 3),
      exactCustomer,
      containment,
      quality: qualityScore,
      contextBm25: round(contextBm25, 3),
      contextCharSimilarity: round(contextCharSimilarity, 3),
      contextSignalRatio: round(contextSignalRatio, 3),
      currentGrounding,
    },
  };
}

function detectKnownCustomerFacts(value) {
  const text = String(value || "").toLowerCase();
  const facts = [];
  if (/\d+(?:\.\d+)?\s*(?:份|套|个|盒|件)/u.test(text)) facts.push("quantity");
  if (
    /(?:预算|每份|每套|每盒|每个|单价|价位)[^\d]{0,8}\d+(?:\.\d+)?\s*(?:元|块)?/u.test(text)
    || /\d+(?:\.\d+)?\s*(?:元|块)(?:\s*(?:一份|每份|预算|左右|以内|以下))?/u.test(text)
  ) facts.push("budget");
  if (/客户|员工|活动|开业|婚礼|伴手礼|教师节|中秋|年会|周年|会议|酒店|民宿|瑜伽|普拉提|美容|服装店|医师节|拜访|福利|庆典/.test(text)) {
    facts.push("usage_scene");
  }
  if (/实用|氛围感|简约|高级|可爱|质感|商务|大气/.test(text)) facts.push("style_preference");
  return facts;
}

function detectReplyRequestedFacts(value) {
  const text = String(value || "").toLowerCase();
  const facts = [];
  if (
    /(?:要|需要|大概|预计|准备)(?:做|订|采购|拿)?\s*多少\s*(?:份|套|个|盒|件)?/u.test(text)
    || /多少\s*(?:份|套|个|盒|件)/u.test(text)
    || /数量.{0,5}(?:多少|几)/u.test(text)
  ) facts.push("quantity");
  if (
    /(?:预算|价位|预期价格|价格区间).{0,8}(?:多少|什么|几|区间)/u.test(text)
    || /(?:多少|什么|哪个).{0,5}(?:预算|价位)/u.test(text)
  ) facts.push("budget");
  if (/什么场景|什么用途|主要.{0,6}(?:送|用)|送客户还是员工|送给谁|什么活动/.test(text)) facts.push("usage_scene");
  if (/什么风格|喜欢.{0,6}(?:什么|哪种)|偏.{0,8}(?:实用|氛围|简约|高级|可爱|质感|商务|大气)|实用.{0,10}氛围感/.test(text)) {
    facts.push("style_preference");
  }
  return facts;
}

function normalizeKnownFacts(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => ["quantity", "budget", "usage_scene", "style_preference"].includes(item));
}

function factLabel(value) {
  return value === "quantity"
    ? "数量"
    : value === "budget"
      ? "预算"
      : value === "usage_scene"
        ? "用途"
        : value === "style_preference"
          ? "风格偏好"
          : value;
}

function bm25Score(queryTokens, documentTokens, documents, documentFrequency) {
  if (!queryTokens.length || !documentTokens.length || !documents.length) return 0;
  const frequencies = tokenFrequencies(documentTokens);
  const averageLength = documents.reduce((sum, document) => sum + document.tokens.length, 0) / documents.length || 1;
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  for (const token of [...new Set(queryTokens)]) {
    const frequency = frequencies.get(token) || 0;
    if (!frequency) continue;
    const df = documentFrequency.get(token) || 0;
    const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
    const denominator = frequency + k1 * (1 - b + b * documentTokens.length / averageLength);
    score += idf * (frequency * (k1 + 1)) / denominator;
  }
  return score;
}

function tokenize(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const tokens = [];
  const latin = String(value || "").toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) || [];
  tokens.push(...latin);
  for (let index = 0; index < normalized.length - 1; index += 1) tokens.push(normalized.slice(index, index + 2));
  for (const signal of detectKnowledgeSignals(value)) tokens.push(signal);
  return tokens;
}

function detectKnowledgeSignals(value) {
  const text = String(value || "").toLowerCase();
  const rules = [
    ["intent:price_inquiry", /多少钱|怎么卖|价格|单价|报价|核价/],
    ["intent:price_objection", /好贵|太贵|便宜|优惠|让点|超预算|预算.{0,4}(低|少)|再看看/],
    ["need:quantity", /多少份|数量|\d+\s*(份|套|个|盒)/],
    ["need:budget", /预算|每份|每盒|总价|\d+\s*(元|块)/],
    ["intent:bundle_change", /更换|换掉|取消|删掉|去掉|保留|不要|可以换|调整/],
    ["intent:style_preference", /太可爱|不喜欢|不好看|简单款|商务|大气|风格|颜色|实用|氛围感|简约|高级|质感/],
    ["intent:decline", /不定了|不做了|算了|以后再说|班费|拮据/],
    ["scene:design", /效果图|设计|logo|腰封|卡片|文案|素材/],
    ["scene:logistics", /物流|快递|发货|签收|催件/],
    ["scene:after_sales", /退款|退货|换货|补发|破损|少件|漏发|投诉/],
    ["scene:payment", /付款|支付|定金|尾款|发票|对公/],
    ["topic:百日宴", /百日宴|百天|满月/],
    ["topic:开业", /开业|开店/],
    ["topic:婚礼", /婚礼|伴娘|伴郎|喜糖/],
    ["topic:教师节", /教师节|老师/],
    ["topic:中秋", /中秋|月饼/],
    ["topic:漫威", /漫威/],
    ["topic:伴手礼", /伴手礼|回礼|礼盒|礼品/],
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}

function ngramCosine(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftVector = ngramFrequency(left);
  const rightVector = ngramFrequency(right);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const count of leftVector.values()) leftNorm += count * count;
  for (const count of rightVector.values()) rightNorm += count * count;
  for (const [gram, count] of leftVector) dot += count * (rightVector.get(gram) || 0);
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function ngramFrequency(value) {
  const vector = new Map();
  const sizes = value.length <= 4 ? [1, 2] : [2, 3];
  for (const size of sizes) {
    if (value.length < size) continue;
    for (let index = 0; index <= value.length - size; index += 1) {
      const gram = value.slice(index, index + size);
      vector.set(gram, (vector.get(gram) || 0) + 1);
    }
  }
  return vector;
}

function buildDocumentFrequency(documents) {
  const frequencies = new Map();
  for (const document of documents) {
    for (const token of new Set(document.tokens)) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }
  return frequencies;
}

function tokenFrequencies(tokens) {
  const frequencies = new Map();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  return frequencies;
}

function diversifyMatches(matches, max) {
  const selected = [];
  const replies = new Set();
  for (const match of matches) {
    const replyKey = normalizeText(match.excerpt);
    if (replyKey && replies.has(replyKey) && selected.length) continue;
    selected.push(match);
    if (replyKey) replies.add(replyKey);
    if (selected.length >= max) break;
  }
  return selected;
}

function extractCustomerText(content) {
  return String(content || "").match(/客户[:：]\s*([\s\S]*?)(?:\n客服[:：]|$)/)?.[1]?.trim() || "";
}

function extractServiceText(content) {
  return String(content || "").match(/客服[:：]\s*([\s\S]+)$/)?.[1]?.trim() || "";
}

function formatReplyExcerpt(value) {
  return truncate(String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(" ｜ "), 240);
}

function isReviewedHumanVerbatim(entry) {
  return entry?.sourceType === "chat_import" && /脱敏原话|sanitized verbatim/i.test(String(entry?.reviewNote || ""));
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

module.exports = {
  DEFAULT_RAG_MIN_SCORE: DEFAULT_MIN_SCORE,
  detectKnowledgeSignals,
  retrieveKnowledgeRag,
  tokenizeKnowledgeText: tokenize,
};
