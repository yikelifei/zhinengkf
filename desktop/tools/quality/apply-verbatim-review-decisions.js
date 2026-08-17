"use strict";

const fs = require("node:fs");

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] || "http://127.0.0.1:3100").replace(/\/$/, "");
const importId = String(args["import-id"] || "").trim();
const samplesPath = String(args.samples || "").trim();
const decisionsPath = String(args.decisions || "").trim();

if (!importId || !samplesPath || !decisionsPath) {
  throw new Error("--import-id, --samples and --decisions are required");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});

async function main() {
  const source = JSON.parse(fs.readFileSync(samplesPath, "utf8"));
  const decisions = JSON.parse(fs.readFileSync(decisionsPath, "utf8"));
  const artifacts = Array.isArray(source.samples) ? source.samples : [];
  const statusByArtifactId = buildDecisionMap(decisions, artifacts);
  const apiSamples = await getSamples();
  const apiByContent = new Map(apiSamples.map((sample) => [contentKey(sample.customerText, sample.idealReply), sample]));
  const matched = artifacts.map((artifact) => {
    const sample = apiByContent.get(contentKey(artifact.customerText, artifact.humanReply));
    if (!sample) throw new Error(`API sample not found for ${artifact.id}`);
    return { artifact, sample, status: statusByArtifactId.get(artifact.id) };
  });

  for (const item of matched) {
    if (item.status === "review") continue;
    const response = await fetch(`${baseUrl}/api/training/samples/${encodeURIComponent(item.sample.id)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationKey: `xiaoshi-verbatim-${item.status}-20260814-${item.artifact.id.slice(-3)}`,
        status: item.status,
        note: item.status === "ready"
          ? "已核对为小石脱敏原话；上下文完整，不含需要实时查询的商业事实，可用于真人语气学习。"
          : rejectionReason(item.artifact.id, decisions),
      }),
    });
    if (!response.ok) throw new Error(`review failed ${item.artifact.id}: ${response.status} ${await response.text()}`);
  }

  const verified = await getSamples();
  const counts = countBy(verified, (sample) => sample.status);
  process.stdout.write(`${JSON.stringify({ importId, matched: matched.length, counts }, null, 2)}\n`);
}

async function getSamples() {
  const response = await fetch(`${baseUrl}/api/training/samples?importId=${encodeURIComponent(importId)}&limit=100`);
  if (!response.ok) throw new Error(`list samples failed: ${response.status} ${await response.text()}`);
  const body = await response.json();
  return Array.isArray(body) ? body : body.items || body.rows || body.data || [];
}

function buildDecisionMap(decisions, artifacts) {
  const map = new Map();
  for (const status of ["ready", "review", "rejected"]) {
    for (const id of decisions[status] || []) {
      if (map.has(id)) throw new Error(`duplicate review decision: ${id}`);
      map.set(id, status);
    }
  }
  const missing = artifacts.map((item) => item.id).filter((id) => !map.has(id));
  if (missing.length) throw new Error(`missing review decisions: ${missing.join(", ")}`);
  if (map.size !== artifacts.length) throw new Error(`decision count mismatch: ${map.size} != ${artifacts.length}`);
  return map;
}

function rejectionReason(id, decisions) {
  const category = Object.entries(decisions.rejectionReasons || {})
    .find(([, ids]) => Array.isArray(ids) && ids.includes(id))?.[0] || "not_reusable";
  return `小石原话保留作审计，但不用于回复学习；原因：${category}。`;
}

function contentKey(customerText, replyText) {
  return `${String(customerText || "").replace(/\r\n?/g, "\n").trim()}\u0000${String(replyText || "").replace(/\r\n?/g, "\n").trim()}`;
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item) || "undefined";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
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
