"use strict";

const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const analysisPath = requiredPath(args.analysis, "--analysis");
const manifestPath = requiredPath(args.manifest, "--manifest");
const outputPath = requiredPath(args.output, "--output", false);
const transcriptPath = requiredPath(args.transcript, "--transcript", false);
const previousPath = args.previous ? path.resolve(String(args.previous)) : "";
const prefix = String(args.prefix || "xiaoshi_curated").trim().replace(/[^a-zA-Z0-9_-]/g, "_");

const analysis = readJson(analysisPath);
const manifest = readJson(manifestPath);
const pairs = new Map((analysis.reviewPairs || []).map((item) => [item.id, item]));
const previousSamples = previousPath && fs.existsSync(previousPath)
  ? (readJson(previousPath).samples || [])
  : [];
const previousFingerprints = new Map(previousSamples.map((sample) => [fingerprint(sample.customerMessages, sample.humanReplyMessages), sample.id]));
const missing = [];
const duplicates = [];
const samples = [];

for (const decision of manifest.decisions || []) {
  const pair = pairs.get(decision.sourcePairId);
  if (!pair) {
    missing.push(decision.sourcePairId);
    continue;
  }
  const duplicateOf = previousFingerprints.get(fingerprint(pair.customerMessages, pair.humanReplyMessages));
  if (duplicateOf) {
    duplicates.push({ sourcePairId: pair.id, duplicateOf });
    continue;
  }
  const agentKey = String(decision.agentKey || pair.agentKey);
  samples.push({
    id: `${prefix}_${String(samples.length + 1).padStart(3, "0")}`,
    sourceRef: {
      batch: manifest.batch,
      session: pair.sessionId,
      pairId: pair.id,
      lineStart: pair.sourceLineStart,
      lineEnd: pair.sourceLineEnd,
    },
    customerMessages: pair.customerMessages,
    humanReplyMessages: pair.humanReplyMessages,
    customerText: pair.customerMessages.join("\n"),
    humanReply: pair.humanReplyMessages.join("\n"),
    scene: decision.scene || sceneForAgent(agentKey, pair.scene),
    agentKey,
    score: pair.candidateScore,
    authenticity: "sanitized_verbatim",
    editing: "Privacy sanitization only; the human reply was not rewritten.",
    status: decision.status,
    reviewNote: decision.note,
  });
}

if (missing.length) throw new Error(`curation source pairs missing: ${missing.join(", ")}`);

const counts = countBy(samples, (sample) => sample.status);
const agentCounts = countBy(samples, (sample) => sample.agentKey);
const result = {
  meta: {
    title: "小石客服第二批脱敏原话人工精选样本",
    createdAt: new Date().toISOString(),
    sourceBatch: manifest.batch,
    sourceSessionCount: analysis.meta?.sessionCount || 0,
    sourceTurnPairCount: analysis.totals?.turnPairCount || 0,
    selectedSampleCount: samples.length,
    excludedPairCount: Math.max(0, Number(analysis.totals?.turnPairCount || 0) - samples.length - duplicates.length),
    exactDuplicateCount: duplicates.length,
    reviewMode: "required",
    statement: "客服回复来自原聊天相邻消息，仅做隐私脱敏；没有改写为标准答案。",
  },
  counts,
  agentCounts,
  duplicates,
  samples,
};

const transcript = samples.flatMap((sample) => [
  `[${sample.id} | ${sample.status} | ${sample.sourceRef.session}:${sample.sourceRef.lineStart}-${sample.sourceRef.lineEnd}]`,
  ...sample.customerMessages.map((message) => `客户：${message}`),
  ...sample.humanReplyMessages.map((message) => `客服：${message}`),
  `审核：${sample.reviewNote}`,
  "",
]).join("\n");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
fs.writeFileSync(transcriptPath, `${transcript.trim()}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  outputPath,
  transcriptPath,
  sourceTurnPairCount: result.meta.sourceTurnPairCount,
  selectedSampleCount: samples.length,
  excludedPairCount: result.meta.excludedPairCount,
  exactDuplicateCount: duplicates.length,
  counts,
  agentCounts,
}, null, 2)}\n`);

function requiredPath(value, label, mustExist = true) {
  const resolved = path.resolve(String(value || ""));
  if (!value || (mustExist && !fs.existsSync(resolved))) throw new Error(`${label} is required${mustExist ? " and must exist" : ""}`);
  return resolved;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

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

function fingerprint(customerMessages, humanReplyMessages) {
  return `${normalize(customerMessages)}\n---\n${normalize(humanReplyMessages)}`;
}

function normalize(messages) {
  return (Array.isArray(messages) ? messages : [messages])
    .map((value) => String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ""))
    .filter(Boolean)
    .join("|");
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function sceneForAgent(agentKey, fallback) {
  return ({
    pre_sales: "售前转化",
    gift_design: "礼盒设计",
    order_payment: "下单支付",
    logistics_exception: "物流异常",
    after_sales: "售后安抚",
  })[agentKey] || fallback;
}
