"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { classifyScene, evaluateSceneClassification } = require("../../packages/rules");

const args = parseArgs(process.argv.slice(2));
const inputRoot = path.resolve(String(args.input || ""));
const outputPath = args.output ? path.resolve(String(args.output)) : "";

if (!inputRoot || !fs.existsSync(inputRoot) || !fs.statSync(inputRoot).isDirectory()) {
  throw new Error(`input directory not found: ${inputRoot || "<empty>"}`);
}

const metadataFiles = listFiles(inputRoot, ".json")
  .sort((left, right) => left.localeCompare(right, "zh-CN"))
  .map((filePath) => readJson(filePath))
  .filter((item) => item && item.dialogue_file && Number.isFinite(Number(item.dialogue_message_count)));
const sessionAliases = new Map(
  metadataFiles.map((meta, index) => [
    String(meta.session_id || `session_${index + 1}`),
    `xiaoshi_session_${String(index + 1).padStart(3, "0")}`,
  ]),
);

const sessions = [];
const allPairs = [];
const allServiceMessages = [];
const allCustomerMessages = [];
const privacyScan = { phone: 0, email: 0, idCard: 0, bankCard: 0, url: 0, wechatId: 0, addressLike: 0 };

for (const meta of metadataFiles) {
  const sessionAlias = sessionAliases.get(String(meta.session_id || "")) || "xiaoshi_session_unknown";
  const dialoguePath = resolveDialoguePath(inputRoot, meta);
  if (!dialoguePath || !fs.existsSync(dialoguePath)) continue;
  const raw = fs.readFileSync(dialoguePath, "utf8");
  incrementPrivacyScan(privacyScan, raw);
  const messages = parseMessages(raw);
  const turns = collapseTurns(messages);
  const pairs = pairTurns(turns).map((pair, index) => analyzePair(pair, meta, index, sessionAlias));
  allPairs.push(...pairs);
  allServiceMessages.push(...messages.filter((item) => item.role === "service").map((item) => item.text));
  allCustomerMessages.push(...messages.filter((item) => item.role === "customer").map((item) => item.text));
  sessions.push({
    sessionId: sessionAlias,
    messageCount: messages.length,
    turnCount: turns.length,
    pairCount: pairs.length,
    attachmentCount: Number(meta.attachment_count || 0),
    sourceMessageCount: Number(meta.source_message_count || 0),
    excludedSystemMessageCount: Number(meta.excluded_system_message_count || 0),
    contentAnonymized: Boolean(meta.content_anonymized),
    mixedWithOtherCustomers: Boolean(meta.mixed_with_other_customers),
  });
}

const sceneCounts = countBy(allPairs, (item) => `${item.agentKey}:${item.scene}`);
const riskCounts = countMany(allPairs.flatMap((item) => item.flags));
const safePairs = allPairs.filter((item) => item.trainingCandidate);
const trainingCandidates = safePairs
  .sort((left, right) => right.candidateScore - left.candidateScore || left.id.localeCompare(right.id))
  .map((item) => ({
    id: item.id,
    sessionId: item.sessionId,
    customerMessages: item.customerMessages,
    humanReplyMessages: item.serviceMessages,
    customerText: item.customerText,
    humanReply: item.serviceText,
    agentKey: item.agentKey,
    scene: item.scene,
    sceneCheck: item.sceneCheck,
    candidateScore: item.candidateScore,
    flags: item.flags,
    sourceLineStart: item.sourceLineStart,
    sourceLineEnd: item.sourceLineEnd,
    authenticity: "sanitized_verbatim",
    status: "review",
  }));
const logicExamples = buildLogicExamples(allPairs);
const riskExamples = {};
for (const risk of Object.keys(riskCounts)) {
  riskExamples[risk] = allPairs
    .filter((item) => item.flags.includes(risk))
    .slice(0, 5)
    .map(({ sessionId, customerText, serviceText, flags }) => ({ sessionId, customerText, serviceText, flags }));
}
const representativePairs = {};
for (const sceneKey of Object.keys(sceneCounts)) {
  representativePairs[sceneKey] = safePairs
    .filter((item) => `${item.agentKey}:${item.scene}` === sceneKey)
    .sort((a, b) => b.candidateScore - a.candidateScore || b.serviceText.length - a.serviceText.length)
    .slice(0, 8)
    .map(({ sessionId, customerText, serviceText, candidateScore, flags, sceneCheck }) => ({
      sessionId,
      customerText,
      serviceText,
      candidateScore,
      flags,
      sceneCheck,
    }));
}

const serviceLengths = allServiceMessages.map((text) => visibleText(text).length);
const result = {
  meta: {
    title: "微信客服对话结构化分析（匿名化训练准备）",
    createdAt: new Date().toISOString(),
    inputRoot,
    sessionCount: sessions.length,
    sourceMetadataCount: metadataFiles.length,
    contentAnonymizedCount: sessions.filter((item) => item.contentAnonymized).length,
    mixedSessionCount: sessions.filter((item) => item.mixedWithOtherCustomers).length,
  },
  totals: {
    sourceMessageCount: sum(sessions, "sourceMessageCount"),
    parsedMessageCount: allServiceMessages.length + allCustomerMessages.length,
    customerMessageCount: allCustomerMessages.length,
    serviceMessageCount: allServiceMessages.length,
    turnPairCount: allPairs.length,
    trainingCandidateCount: safePairs.length,
    excludedSystemMessageCount: sum(sessions, "excludedSystemMessageCount"),
    attachmentCount: sum(sessions, "attachmentCount"),
  },
  style: {
    serviceReplyLengthAverage: round(average(serviceLengths), 1),
    serviceReplyLengthMedian: median(serviceLengths),
    serviceQuestionRate: round(rate(allServiceMessages, (text) => /[?？]|吗|嘛|呢|是否|方便/.test(text)), 4),
    shortAcknowledgementRate: round(rate(allServiceMessages, isShortAcknowledgement), 4),
    attachmentOnlyRate: round(rate(allServiceMessages, isAttachmentOnly), 4),
    warmthMarkerCounts: markerCounts(allServiceMessages, ["咱们", "这边", "可以的", "好滴", "好的", "嗯呢", "稍等", "哈哈", "亲", "漂亮"]),
    commonServiceMessages: commonMessages(allServiceMessages, 30),
  },
  sceneCounts,
  riskCounts,
  riskExamples,
  logicExamples,
  privacyScan,
  sessions,
  representativePairs,
  reviewPairs: allPairs.map((item) => ({
    id: item.id,
    sessionId: item.sessionId,
    customerMessages: item.customerMessages,
    humanReplyMessages: item.serviceMessages,
    customerText: item.customerText,
    humanReply: item.serviceText,
    agentKey: item.agentKey,
    scene: item.scene,
    sceneCheck: item.sceneCheck,
    candidateScore: item.candidateScore,
    flags: item.flags,
    sourceLineStart: item.sourceLineStart,
    sourceLineEnd: item.sourceLineEnd,
  })),
  trainingCandidates,
  guardrails: [
    "分析结果中的手机号、证件号、银行卡号、邮箱、网址和微信号已替换为占位符。",
    "附件文件名和本地路径不进入训练示例。",
    "短确认、只发图片、一次性价格和高亲密称呼不自动作为可训练答案。",
    "代表性回答仍需人工复核后才能标记 ready。",
  ],
};

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

process.stdout.write(`${JSON.stringify({
  outputPath,
  meta: result.meta,
  totals: result.totals,
  style: result.style,
  sceneCounts: result.sceneCounts,
  riskCounts: result.riskCounts,
  privacyScan: result.privacyScan,
}, null, 2)}\n`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    parsed[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return parsed;
}

function listFiles(root, extension) {
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(target, extension));
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === extension) results.push(target);
  }
  return results;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function resolveDialoguePath(root, meta) {
  const candidates = [
    path.resolve(root, String(meta.dialogue_file || "")),
    path.resolve(root, String(meta.folder || ""), path.basename(String(meta.dialogue_file || ""))),
  ];
  return candidates.find((candidate) => candidate.startsWith(root) && fs.existsSync(candidate)) || "";
}

function parseMessages(raw) {
  const messages = [];
  for (const [index, line] of String(raw || "").split(/\r?\n/).entries()) {
    const match = line.trim().match(/^(客户|客服)[:：]\s*(.*)$/);
    if (!match) continue;
    const text = String(match[2] || "").trim();
    if (!text) continue;
    messages.push({ role: match[1] === "客户" ? "customer" : "service", text, lineNumber: index + 1 });
  }
  return messages;
}

function collapseTurns(messages) {
  const turns = [];
  for (const message of messages) {
    const previous = turns[turns.length - 1];
    if (previous && previous.role === message.role) {
      previous.parts.push(message.text);
      previous.lineEnd = message.lineNumber;
    } else {
      turns.push({ role: message.role, parts: [message.text], lineStart: message.lineNumber, lineEnd: message.lineNumber });
    }
  }
  return turns.map((turn) => ({ ...turn, text: turn.parts.join("；") }));
}

function pairTurns(turns) {
  const pairs = [];
  for (let index = 0; index < turns.length - 1; index += 1) {
    const current = turns[index];
    const next = turns[index + 1];
    if (current.role === "customer" && next.role === "service") {
      pairs.push({ customer: current, service: next });
    }
  }
  return pairs;
}

function analyzePair(pair, meta, index, sessionAlias) {
  const rawCustomer = visibleText(pair.customer.text);
  const rawService = visibleText(pair.service.text);
  const combined = `${rawCustomer}\n${rawService}`;
  const scene = classifyScene(combined);
  const sceneCheck = evaluateSceneClassification(scene);
  const flags = [];
  if (isShortAcknowledgement(rawService)) flags.push("short_acknowledgement");
  if (isAttachmentOnly(pair.service.text)) flags.push("attachment_only");
  if (containsOneOffCommercialFact(rawService)) flags.push("one_off_commercial_fact");
  if (/全网最低|绝对最低|保证到|肯定到|一定能到|百分百|最便宜/.test(rawService)) flags.push("absolute_or_unverified_promise");
  if (/全网.{0,12}(一家|独家|只有我们)|行业第一|销量第一/.test(rawService)) flags.push("absolute_or_unverified_promise");
  if (/个人微信|个人账户|个人银行卡|转我微信|打我卡/.test(rawService)) flags.push("personal_payment_risk");
  if (/付款码|收款码|微信付款|转账|打款/.test(rawService)) flags.push("payment_channel_requires_review");
  if (/手机号|电话号码|联系电话|收货地址/.test(rawService)) flags.push("contact_collection_requires_review");
  if (/退货|退款|不退|运费自理|押金|样品费/.test(rawService)) flags.push("policy_requires_review");
  if (/一般不寄样品|样品.{0,8}(不给|不能|不做|不印)|定制品.{0,8}不退/.test(rawService)) flags.push("policy_requires_review");
  if (/\d+\s*(?:-|到|至)\s*\d+\s*天|\d+\s*天(?:发|到|出货)|明天(?:发|到)|后天(?:发|到)/.test(rawService)) flags.push("one_off_lead_time");
  if (/漂亮|美女|宝贝|亲爱的|专业模特/.test(rawService)) flags.push("over_familiar_tone");
  if (/偷图|盗图|照着.{0,8}一模一样/.test(rawService)) flags.push("external_image_or_copy_risk");
  if (/淘宝|拼多多|1688|拍下后改价/.test(rawService)) flags.push("external_platform_instruction");
  if (/我们是工厂|几万份.{0,8}接过|全网|独家/.test(rawService)) flags.push("unverified_business_claim");
  if (/亏本|成本|纳税/.test(rawService)) flags.push("commercial_reasoning_requires_review");
  if (containsAddressLike(`${rawCustomer}\n${rawService}`)) flags.push("address_or_contact_details");
  if (sceneCheck.needsReview) flags.push(`scene_${sceneCheck.status}`);
  if (rawCustomer.length < 2 || rawService.length < 5) flags.push("low_information_pair");
  const candidateScore = scoreCandidate(rawCustomer, rawService, flags, sceneCheck);
  const blockedFlags = new Set([
    "short_acknowledgement",
    "attachment_only",
    "one_off_commercial_fact",
    "absolute_or_unverified_promise",
    "personal_payment_risk",
    "payment_channel_requires_review",
    "contact_collection_requires_review",
    "policy_requires_review",
    "one_off_lead_time",
    "over_familiar_tone",
    "external_image_or_copy_risk",
    "external_platform_instruction",
    "unverified_business_claim",
    "commercial_reasoning_requires_review",
    "address_or_contact_details",
    "scene_weak",
    "scene_ambiguous",
    "scene_unmatched",
    "low_information_pair",
  ]);
  return {
    id: `${sessionAlias}:${index + 1}`,
    sessionId: sessionAlias,
    customerMessages: pair.customer.parts.map((item) => sanitizeForTraining(visibleText(item))).filter(Boolean),
    serviceMessages: pair.service.parts.map((item) => sanitizeForTraining(visibleText(item))).filter(Boolean),
    customerText: sanitizeForTraining(rawCustomer),
    serviceText: sanitizeForTraining(rawService),
    agentKey: scene.agentKey,
    scene: scene.scene,
    sceneCheck: sceneCheck.status,
    candidateScore,
    trainingCandidate: candidateScore >= 72 && !flags.some((flag) => blockedFlags.has(flag)),
    flags,
    sourceLineStart: pair.customer.lineStart,
    sourceLineEnd: pair.service.lineEnd,
  };
}

function visibleText(text) {
  return String(text || "")
    .replace(/<voipmsg[\s\S]*?<\/voipmsg>/gi, "[通话记录]")
    .replace(/<msg[\s\S]*?<\/msg>/gi, "[引用附件]")
    .replace(/\[引用消息\][\s\S]*?<msg[\s\S]*$/gi, "[引用附件]")
    .replace(/\[引用消息\][\s\S]*?<\?xml[\s\S]*$/gi, "[引用附件]")
    .replace(/<\?xml[\s\S]*$/gi, "[引用附件]")
    .replace(/\[(?:图片|表情|视频|文件|语音)内容：[^\]]*\]/g, "[附件]")
    .replace(/\[(?:图片|表情|视频|文件|语音)：[^\]]*\]/g, "[附件]")
    .replace(/附件[\\/][^；\s\]]+/g, "[附件]")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeForTraining(text) {
  return String(text || "")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[手机号]")
    .replace(/\b\d{15,18}[0-9Xx]\b/g, "[证件号]")
    .replace(/\b\d{16,19}\b/g, "[银行卡号]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[邮箱]")
    .replace(/https?:\/\/\S+/gi, "[链接]")
    .replace(/(?:微信号|wxid)[:：]?\s*[A-Za-z][-_A-Za-z0-9]{5,19}/gi, "微信号：[已脱敏]")
    .replace(/(?:北京市|上海市|天津市|重庆市|[\u4e00-\u9fa5]{2,}(?:省|自治区))[\u4e00-\u9fa5A-Za-z0-9\s-]{3,100}/g, "[地址]")
    .replace(/\[地址\]\[手机号\][\u4e00-\u9fa5]{2,4}/g, "[地址][手机号][收件人]")
    .replace(/(?:[\u4e00-\u9fa5A-Za-z0-9-]{2,}(?:省|自治区))?[\u4e00-\u9fa5]{2,}(?:市|州)[\u4e00-\u9fa5A-Za-z0-9\s-]{2,80}?(?:号|大厦|广场|小区|楼|单元)/g, "[地址]")
    .replace(/(?:¥|￥)\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|块钱|块|\/套|一套|每套|套哈|含税运)/g, "[金额]")
    .replace(/\d+(?:\.\d+)?\s*[×x*]\s*\d+(?:\.\d+)?\s*=\s*\d+(?:\.\d+)?/gi, "[金额计算]")
    .replace(/\[附件\](?:\s*[；,，]?\s*\[附件\])+/g, "[附件]")
    .slice(0, 600);
}

function isShortAcknowledgement(text) {
  const value = visibleText(text).replace(/[啊呀哈哦嗯呢滴的~！!。,.，]/g, "");
  return /^(好|好的|可以|收到|行|稍等|没问题|对|是)$/.test(value) || value.length <= 2;
}

function isAttachmentOnly(text) {
  const value = visibleText(text).replace(/\[附件\]|[；,，。.!！\s]/g, "");
  return value.length === 0;
}

function containsOneOffCommercialFact(text) {
  return /(?:¥|￥)\s*\d|\d+(?:\.\d+)?\s*(?:元|块钱|块|折|\/套|一套|每套|套哈|含税运)|\d+(?:\.\d+)?\s*[×x*]\s*\d+(?:\.\d+)?\s*=|现货\s*\d|库存\s*\d|运费\s*\d|定金\s*\d|原价\s*\d|最低价\s*\d|这款\s*\d{1,5}(?!\s*(?:个|件|份|套))|\d+\s*起订|批量定制\s*\d/.test(text);
}

function containsAddressLike(text) {
  return /(?:北京市|上海市|天津市|重庆市|[\u4e00-\u9fa5]{2,}(?:省|自治区))[\u4e00-\u9fa5A-Za-z0-9\s-]{3,100}/.test(text)
    || /[\u4e00-\u9fa5]{2,}(?:市|区|县)[\u4e00-\u9fa5A-Za-z0-9\s-]{4,80}(?:路|街|号|大厦|广场|小区|楼|单元|中心)/.test(text);
}

function scoreCandidate(customer, service, flags, sceneCheck) {
  let score = 50;
  if (customer.length >= 6) score += 8;
  if (service.length >= 10) score += 12;
  if (service.length >= 24) score += 6;
  if (/[?？]|吗|嘛|呢|是否|方便/.test(service)) score += 6;
  if (/预算|数量|用途|日期|时间|地址|风格|logo|确认|核对|安排|推荐|方案|稍等/i.test(service)) score += 10;
  if (sceneCheck.status === "clear") score += 8;
  score -= flags.length * 7;
  return Math.max(0, Math.min(100, score));
}

function incrementPrivacyScan(scan, raw) {
  scan.phone += matches(raw, /(?<!\d)1[3-9]\d{9}(?!\d)/g);
  scan.email += matches(raw, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  scan.idCard += matches(raw, /\b\d{15,18}[0-9Xx]\b/g);
  scan.bankCard += matches(raw, /\b\d{16,19}\b/g);
  scan.url += matches(raw, /https?:\/\/\S+/gi);
  scan.wechatId += matches(raw, /(?:微信号|wxid)[:：]?\s*[A-Za-z][-_A-Za-z0-9]{5,19}/gi);
  scan.addressLike += matches(raw, /(?:[\u4e00-\u9fa5A-Za-z0-9-]{2,}(?:省|自治区))?[\u4e00-\u9fa5]{2,}(?:市|州)[\u4e00-\u9fa5A-Za-z0-9\s-]{2,80}?(?:号|大厦|广场|小区|楼|单元)/g);
}

function matches(text, pattern) {
  return String(text || "").match(pattern)?.length || 0;
}

function countBy(items, selector) {
  return Object.fromEntries([...countMap(items.map(selector)).entries()].sort((a, b) => b[1] - a[1]));
}

function buildLogicExamples(pairs) {
  const patterns = {
    need_discovery: /预算|数量|多少份|什么时候用|什么活动|用途|送谁|什么风格/,
    recommendation: /推荐|搭配|可以换|可以调换|截图|挑一下|看一下/,
    design_confirmation: /logo|效果图|腰封|卡片|印制|内衬|尺寸/i,
    sample_policy: /样品|寄样|看样|试样|大货/,
    price_objection: /贵|便宜|预算有限|含税|运费|定制|成本|最低价/,
    delivery_timing: /发货|到货|快递|几天|时间用|来得及|保证时间/,
    order_confirmation: /下单|付款|地址|确认明细|定金|订单/,
    follow_up: /确定了|考虑|等我消息|再看看|决定|老板|领导/,
    after_sales: /退货|退款|质量问题|破损|少件|补发|换货/,
  };
  return Object.fromEntries(Object.entries(patterns).map(([key, pattern]) => [
    key,
    pairs
      .filter((item) => pattern.test(`${item.customerText}\n${item.serviceText}`))
      .sort((a, b) => b.candidateScore - a.candidateScore)
      .slice(0, 12)
      .map(({ sessionId, customerText, serviceText, candidateScore, flags, agentKey, scene }) => ({
        sessionId,
        customerText,
        serviceText,
        candidateScore,
        flags,
        agentKey,
        scene,
      })),
  ]));
}

function countMany(items) {
  return Object.fromEntries([...countMap(items).entries()].sort((a, b) => b[1] - a[1]));
}

function countMap(items) {
  const map = new Map();
  for (const item of items) map.set(item, (map.get(item) || 0) + 1);
  return map;
}

function commonMessages(messages, limit) {
  return [...countMap(messages.map((text) => visibleText(text)).filter(Boolean)).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => ({ text: sanitizeForTraining(text), count }));
}

function markerCounts(messages, markers) {
  return Object.fromEntries(markers.map((marker) => [marker, messages.filter((text) => text.includes(marker)).length]));
}

function rate(items, predicate) {
  if (!items.length) return 0;
  return items.filter(predicate).length / items.length;
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : round((sorted[middle - 1] + sorted[middle]) / 2, 1);
}

function round(value, digits = 0) {
  const multiplier = 10 ** digits;
  return Math.round(Number(value) * multiplier) / multiplier;
}
