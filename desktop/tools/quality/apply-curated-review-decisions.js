"use strict";

const fs = require("node:fs");

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] || "http://127.0.0.1:3100").replace(/\/$/, "");
const importId = String(args["import-id"] || "").trim();
const samplesPath = String(args.samples || "").trim();
const operationPrefix = String(args["operation-prefix"] || "curated-review").trim();

if (!importId || !samplesPath) throw new Error("--import-id and --samples are required");

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});

async function main() {
  const source = JSON.parse(fs.readFileSync(samplesPath, "utf8"));
  const artifacts = Array.isArray(source.samples) ? source.samples : [];
  const apiSamples = await getSamples();
  const apiByContent = new Map(apiSamples.map((sample) => [contentKey(sample.customerText, sample.idealReply), sample]));
  const matched = artifacts.map((artifact) => {
    const sample = apiByContent.get(contentKey(artifact.customerText, artifact.humanReply));
    if (!sample) throw new Error(`API sample not found for ${artifact.id}`);
    return { artifact, sample };
  });

  for (const { artifact, sample } of matched) {
    const status = artifact.status === "ready" ? "ready" : "review";
    const response = await fetch(`${baseUrl}/api/training/samples/${encodeURIComponent(sample.id)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationKey: `${operationPrefix}-${artifact.id}`,
        status,
        agentKey: artifact.agentKey,
        scene: artifact.scene,
        customerText: artifact.customerText,
        idealReply: artifact.humanReply,
        score: artifact.score,
        note: status === "ready"
          ? `已核对为小石第二批脱敏原话；${artifact.reviewNote}`
          : `保留为小石第二批脱敏原话待复核；${artifact.reviewNote}`,
      }),
    });
    if (!response.ok) throw new Error(`review failed ${artifact.id}: ${response.status} ${await response.text()}`);
  }

  const verified = await getSamples();
  const counts = countBy(verified, (sample) => sample.status);
  const agents = countBy(verified, (sample) => sample.agentKey);
  process.stdout.write(`${JSON.stringify({ importId, matched: matched.length, counts, agents }, null, 2)}\n`);
}

async function getSamples() {
  const response = await fetch(`${baseUrl}/api/training/samples?importId=${encodeURIComponent(importId)}&limit=100`);
  if (!response.ok) throw new Error(`list samples failed: ${response.status} ${await response.text()}`);
  const body = await response.json();
  return Array.isArray(body) ? body : body.items || body.rows || body.data || [];
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
