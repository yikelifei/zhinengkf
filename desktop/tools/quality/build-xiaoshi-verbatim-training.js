"use strict";

const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const analysisPath = path.resolve(String(args.analysis || ""));
const jsonOutput = path.resolve(String(args.json || ""));
const transcriptOutput = path.resolve(String(args.transcript || ""));
const samplePrefix = String(args.prefix || "xiaoshi_verbatim")
  .trim()
  .replace(/[^a-zA-Z0-9_-]/g, "_") || "xiaoshi_verbatim";
const sourceBatch = String(args.batch || "").trim();

if (!fs.existsSync(analysisPath)) throw new Error(`analysis file not found: ${analysisPath}`);
if (!jsonOutput || !transcriptOutput) throw new Error("--json and --transcript are required");

const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
const candidates = Array.isArray(analysis.trainingCandidates) ? analysis.trainingCandidates : [];
const samples = candidates.map((item, index) => ({
  id: `${samplePrefix}_${String(index + 1).padStart(3, "0")}`,
  sourceRef: {
    session: item.sessionId,
    lineStart: item.sourceLineStart,
    lineEnd: item.sourceLineEnd,
  },
  customerMessages: item.customerMessages,
  humanReplyMessages: item.humanReplyMessages,
  customerText: item.customerMessages.join("\n"),
  humanReply: item.humanReplyMessages.join("\n"),
  scene: item.scene,
  agentKey: item.agentKey,
  score: item.candidateScore,
  authenticity: "sanitized_verbatim",
  editing: "Only privacy and one-off fact filtering; no ideal-reply rewrite.",
  status: "review",
}));

const result = {
  meta: {
    title: "小石客服脱敏原话训练集",
    createdAt: new Date().toISOString(),
    sampleCount: samples.length,
    sourceSessionCount: analysis.meta?.sessionCount || 0,
    sourceTurnPairCount: analysis.totals?.turnPairCount || 0,
    sourceType: "sanitized_verbatim_wechat_dialogue",
    ...(sourceBatch ? { sourceBatch } : {}),
    reviewMode: "required",
    statement: "客服回复来自原聊天相邻消息，不改写为标准答案。",
  },
  styleEvidence: analysis.style,
  samples,
};

const transcript = samples.flatMap((sample) => [
  `[样本 ${sample.id}；来源 ${sample.sourceRef.session}:${sample.sourceRef.lineStart}-${sample.sourceRef.lineEnd}]`,
  ...sample.customerMessages.map((message) => `客户：${message}`),
  ...sample.humanReplyMessages.map((message) => `客服：${message}`),
  "",
]).join("\n");

fs.mkdirSync(path.dirname(jsonOutput), { recursive: true });
fs.mkdirSync(path.dirname(transcriptOutput), { recursive: true });
fs.writeFileSync(jsonOutput, `${JSON.stringify(result, null, 2)}\n`, "utf8");
fs.writeFileSync(transcriptOutput, `${transcript.trim()}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  jsonOutput,
  transcriptOutput,
  sampleCount: samples.length,
  customerMessageCount: samples.reduce((total, sample) => total + sample.customerMessages.length, 0),
  humanReplyMessageCount: samples.reduce((total, sample) => total + sample.humanReplyMessages.length, 0),
  agentCounts: countBy(samples, (sample) => sample.agentKey),
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

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}
