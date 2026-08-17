"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { parseChatTranscript } = require("../packages/rules");

const samplesPath = artifact("xiaoshi-verbatim-training-samples-2026-08-14.json");
const transcriptPath = artifact("xiaoshi-verbatim-training-transcript-2026-08-14.txt");
const analysisPath = artifact("xiaoshi-chat-analysis-2026-08-14.json");
const logicPath = artifact("xiaoshi-human-reply-logic-2026-08-14.md");
const decisionsPath = artifact("xiaoshi-verbatim-review-decisions-2026-08-14.json");
const batch2AnalysisPath = artifact("xiaoshi-chat-analysis-batch2-2026-08-14.json");
const batch2SamplesPath = artifact("xiaoshi-curated-training-samples-batch2-2026-08-14.json");
const batch2TranscriptPath = artifact("xiaoshi-curated-training-transcript-batch2-2026-08-14.txt");
const batch2ManifestPath = artifact("xiaoshi-batch2-curation-manifest-2026-08-14.json");

test("keeps Xiaoshi training samples as sanitized verbatim multi-message replies", () => {
  const source = JSON.parse(fs.readFileSync(samplesPath, "utf8"));

  assert.equal(source.meta.sampleCount, 74);
  assert.equal(source.samples.length, source.meta.sampleCount);
  assert.ok(source.samples.every((sample) => sample.status === "review"));
  assert.ok(source.samples.every((sample) => sample.authenticity === "sanitized_verbatim"));
  assert.ok(source.samples.every((sample) => sample.humanReply === sample.humanReplyMessages.join("\n")));
  assert.ok(source.samples.every((sample) => !Object.hasOwn(sample, "idealReply")));
  assert.ok(source.samples.some((sample) => (
    sample.customerText.includes("公司20周年庆典")
    && sample.humanReply === "咱们是什么类型的公司，预算多少呢"
  )));
  assert.ok(source.samples.some((sample) => sample.humanReplyMessages.length >= 4));
});

test("parses consecutive customer and service bubbles as complete turns", () => {
  const parsed = parseChatTranscript(fs.readFileSync(transcriptPath, "utf8"));

  assert.equal(parsed.pairCount, 74);
  assert.equal(parsed.pairs[0].question, "好的 我看看");
  assert.deepEqual(parsed.pairs[0].answerMessages, [
    "咱这边是什么活动用的",
    "然后大概的预算是多少呢？这样的话，我可以推荐得更准确一些",
  ]);
  assert.equal(parsed.pairs[0].answer, parsed.pairs[0].answerMessages.join("\n"));
});

test("records the inspected chat scope and keeps risky raw-chat pairs out of verbatim training", () => {
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  assert.equal(analysis.meta.sessionCount, 23);
  assert.equal(analysis.totals.sourceMessageCount, 3853);
  assert.equal(analysis.totals.parsedMessageCount, 3804);
  assert.equal(analysis.totals.turnPairCount, 946);
  assert.equal(analysis.totals.trainingCandidateCount, 74);
  assert.equal(analysis.totals.excludedSystemMessageCount, 49);
  assert.equal(analysis.totals.attachmentCount, 729);
  assert.ok(analysis.privacyScan.addressLike > 0);
  assert.ok(analysis.riskCounts.one_off_commercial_fact > 0);
  assert.ok(analysis.riskCounts.address_or_contact_details > 0);
  assert.ok(analysis.riskCounts.commercial_reasoning_requires_review > 0);
  assert.ok(analysis.trainingCandidates.every((sample) => sample.flags.length === 0));
});

test("partitions every verbatim sample into ready, review or rejected without overlap", () => {
  const source = JSON.parse(fs.readFileSync(samplesPath, "utf8"));
  const decisions = JSON.parse(fs.readFileSync(decisionsPath, "utf8"));
  const all = [...decisions.ready, ...decisions.review, ...decisions.rejected];

  assert.equal(decisions.ready.length, 21);
  assert.equal(decisions.review.length, 21);
  assert.equal(decisions.rejected.length, 32);
  assert.equal(new Set(all).size, source.samples.length);
  assert.deepEqual(new Set(all), new Set(source.samples.map((sample) => sample.id)));
  const readySamples = source.samples.filter((sample) => decisions.ready.includes(sample.id));
  assert.ok(readySamples.every((sample) => !/\[附件\]|\[引用/.test(sample.humanReply)));
  assert.ok(readySamples.every((sample) => !/(?:¥|￥)\s*\d|\d+(?:\.\d+)?\s*(?:元|块钱|含税运)/.test(sample.humanReply)));
});

test("generated Xiaoshi artifacts exclude raw WeChat XML and direct identifiers", () => {
  const combined = [samplesPath, transcriptPath, analysisPath, logicPath, decisionsPath]
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n");

  assert.doesNotMatch(combined, /<\?xml|cdnthumburl|<voipmsg/i);
  assert.doesNotMatch(combined, /(?<!\d)1[3-9]\d{9}(?!\d)/);
  assert.doesNotMatch(combined, /\bwxid[_-][a-z0-9_-]+/i);
  assert.doesNotMatch(combined, /(?:北京市|上海市|天津市|重庆市|[\u4e00-\u9fa5]{2,}省).{2,80}(?:号|大厦|广场|小区|楼|单元)/);
});

test("curates Xiaoshi batch two without rewriting human replies", () => {
  const analysis = JSON.parse(fs.readFileSync(batch2AnalysisPath, "utf8"));
  const source = JSON.parse(fs.readFileSync(batch2SamplesPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(batch2ManifestPath, "utf8"));
  const parsed = parseChatTranscript(fs.readFileSync(batch2TranscriptPath, "utf8"));

  assert.equal(analysis.meta.sessionCount, 8);
  assert.equal(analysis.totals.parsedMessageCount, 1057);
  assert.equal(analysis.totals.turnPairCount, 261);
  assert.equal(analysis.totals.attachmentCount, 203);
  assert.equal(source.meta.selectedSampleCount, 30);
  assert.equal(source.meta.excludedPairCount, 231);
  assert.equal(source.meta.exactDuplicateCount, 0);
  assert.deepEqual(source.counts, { ready: 11, review: 19 });
  assert.equal(manifest.decisions.length, 30);
  assert.equal(parsed.pairCount, 30);
  assert.ok(source.samples.every((sample) => sample.authenticity === "sanitized_verbatim"));
  assert.ok(source.samples.every((sample) => sample.humanReply === sample.humanReplyMessages.join("\n")));
  assert.ok(source.samples.filter((sample) => sample.status === "ready").every((sample) => sample.agentKey === "pre_sales"));
  assert.ok(source.samples.filter((sample) => sample.status === "ready").every((sample) => !/\[附件\]|\[引用/.test(sample.humanReply)));
});

test("batch two artifacts exclude direct identifiers and raw WeChat payloads", () => {
  const combined = [batch2AnalysisPath, batch2SamplesPath, batch2TranscriptPath, batch2ManifestPath]
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n");

  assert.doesNotMatch(combined, /<\?xml|cdnthumburl|<voipmsg/i);
  assert.doesNotMatch(combined, /(?<!\d)1[3-9]\d{9}(?!\d)/);
  assert.doesNotMatch(combined, /\bwxid[_-][a-z0-9_-]+/i);
});

function artifact(name) {
  return path.join(__dirname, "..", "docs", "knowledge-base", name);
}
