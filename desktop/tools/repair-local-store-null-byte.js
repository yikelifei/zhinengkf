"use strict";

const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const fileArg = args.find((arg) => arg !== "--apply");

if (!fileArg) {
  console.error("usage: node tools/repair-local-store-null-byte.js <local-store.json> [--apply]");
  process.exit(2);
}

const filePath = path.resolve(fileArg);
const raw = fs.readFileSync(filePath);
const nullByteOffsets = [];
for (let index = 0; index < raw.length; index += 1) {
  if (raw[index] === 0) nullByteOffsets.push(index);
}

if (!nullByteOffsets.length) {
  JSON.parse(raw.toString("utf8"));
  console.log(JSON.stringify({ ok: true, changed: false, filePath, nullByteCount: 0 }));
  process.exit(0);
}

let rawParseError = "";
try {
  JSON.parse(raw.toString("utf8"));
} catch (error) {
  rawParseError = error instanceof Error ? error.message : String(error);
}
if (!rawParseError) {
  throw new Error("refusing repair because the original file is already valid JSON");
}

const repaired = Buffer.from(raw.toString("utf8").replace(/\u0000/g, ""), "utf8");
const parsed = JSON.parse(repaired.toString("utf8"));
const report = {
  ok: true,
  changed: apply,
  filePath,
  originalBytes: raw.length,
  repairedBytes: repaired.length,
  nullByteCount: nullByteOffsets.length,
  nullByteOffsets,
  rawParseError,
  recordCounts: {
    conversations: Array.isArray(parsed.conversations) ? parsed.conversations.length : null,
    sendTasks: Array.isArray(parsed.sendTasks) ? parsed.sendTasks.length : null,
    skus: Array.isArray(parsed.skus) ? parsed.skus.length : null,
    knowledgeEntries: Array.isArray(parsed.knowledgeEntries) ? parsed.knowledgeEntries.length : null,
  },
};

if (!apply) {
  console.log(JSON.stringify(report));
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${filePath}.before-null-byte-repair-${stamp}.bak`;
fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
fs.writeFileSync(filePath, repaired, { flag: "w" });
JSON.parse(fs.readFileSync(filePath, "utf8"));
console.log(JSON.stringify({ ...report, backupPath }));
