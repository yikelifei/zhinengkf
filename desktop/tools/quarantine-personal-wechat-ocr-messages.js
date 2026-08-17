const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const readArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
};
const messageIds = args.filter((value, index) => args[index - 1] === "--message-id");
const conversationId = readArg("--conversation-id");
const storeFile = path.resolve(readArg("--store-file"));
const quarantineReason = readArg("--reason") || "ocr_embedded_media_text";

if (!conversationId || messageIds.length === 0 || !readArg("--store-file")) {
  throw new Error(
    "usage: node tools/quarantine-personal-wechat-ocr-messages.js --store-file <path> --conversation-id <id> --message-id <id> [--message-id <id>]",
  );
}

const store = JSON.parse(fs.readFileSync(storeFile, "utf8"));
const targetIds = new Set(messageIds);
const changed = [];
for (const message of store.messages ?? []) {
  if (!targetIds.has(message.id) || message.conversationId !== conversationId) continue;
  if (message.direction !== "inbound") {
    throw new Error(`refusing to quarantine non-inbound message: ${message.id}`);
  }
  message.metadata = {
    ...(message.metadata ?? {}),
    inboundCaptureSource: "legacy_unverified",
    quarantineReason,
  };
  changed.push(message.id);
}
if (changed.length !== targetIds.size) {
  throw new Error(`expected ${targetIds.size} exact messages, changed ${changed.length}`);
}

const backupFile = `${storeFile}.before-ocr-quarantine-${Date.now()}.bak`;
fs.copyFileSync(storeFile, backupFile);
const temporaryFile = `${storeFile}.ocr-quarantine.tmp`;
fs.writeFileSync(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
fs.renameSync(temporaryFile, storeFile);
console.log(JSON.stringify({ ok: true, changed, backupFile }));
