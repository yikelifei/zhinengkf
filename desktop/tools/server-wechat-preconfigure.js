"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const envPath = process.argv[2] || "/opt/smart-kefu/shared/runtime.env";
const publicBase = process.argv[3] || "https://kefu.zhenxiliye.cn";

if (envPath !== "/opt/smart-kefu/shared/runtime.env") throw new Error("unexpected runtime environment path");
if (publicBase !== "https://kefu.zhenxiliye.cn") throw new Error("unexpected customer-service public base URL");

const stat = fs.statSync(envPath);
const source = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
const lines = source.split(/\r?\n/);
const current = Object.create(null);
for (const line of lines) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) continue;
  let value = match[2].trim();
  if (value.length >= 2 && value[0] === value[value.length - 1] && ["'", '"'].includes(value[0])) value = value.slice(1, -1);
  current[match[1]] = value;
}

const existingToken = String(current.WECHAT_WORK_TOKEN || "");
const existingAesKey = String(current.WECHAT_WORK_ENCODING_AES_KEY || "");
const tokenValid = /^[A-Za-z0-9_-]{16,64}$/.test(existingToken);
const aesKeyValid = validAesKey(existingAesKey);
const token = tokenValid ? existingToken : crypto.randomBytes(16).toString("hex");
const aesKey = aesKeyValid ? existingAesKey : crypto.randomBytes(32).toString("base64").replace(/=+$/, "");

if (!validAesKey(aesKey)) throw new Error("generated EncodingAESKey is invalid");

const replacedNames = new Set([
  "CUSTOMER_SERVICE_PUBLIC_BASE_URL",
  "WECHAT_WORK_TOKEN",
  "WECHAT_WORK_ENCODING_AES_KEY",
  "WECHAT_SEND_ADAPTER",
]);
const retained = lines.filter((line) => {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return !match || !replacedNames.has(match[1]);
});
while (retained.length && !retained[retained.length - 1]) retained.pop();

const next = [
  ...retained,
  "",
  "# WeCom callback preconfiguration; real sending remains disabled",
  `CUSTOMER_SERVICE_PUBLIC_BASE_URL=${publicBase}`,
  `WECHAT_WORK_TOKEN=${token}`,
  `WECHAT_WORK_ENCODING_AES_KEY=${aesKey}`,
  "WECHAT_SEND_ADAPTER=dry_run",
  "",
].join("\n");

if (next === source) {
  printResult(false, "");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${envPath}.pre-wechat-${stamp}`;
const temporaryPath = `${envPath}.tmp-${process.pid}`;
fs.copyFileSync(envPath, backupPath, fs.constants.COPYFILE_EXCL);
fs.chmodSync(backupPath, stat.mode & 0o777);
fs.chownSync(backupPath, stat.uid, stat.gid);
fs.writeFileSync(temporaryPath, next, { encoding: "utf8", mode: stat.mode & 0o777, flag: "wx" });
fs.chownSync(temporaryPath, stat.uid, stat.gid);
fs.renameSync(temporaryPath, envPath);
printResult(true, backupPath);

function validAesKey(value) {
  if (!/^[A-Za-z0-9+/]{43}$/.test(String(value || ""))) return false;
  try {
    return Buffer.from(`${value}=`, "base64").length === 32;
  } catch {
    return false;
  }
}

function printResult(changed, backupPath) {
  console.log(JSON.stringify({
    changed,
    backupPath: backupPath || null,
    publicBaseConfigured: true,
    callbackTokenConfigured: true,
    encodingAesKeyConfigured: true,
    sendAdapter: "dry_run",
    realSendEnabled: false,
    secretValuesPrinted: false,
  }));
}
