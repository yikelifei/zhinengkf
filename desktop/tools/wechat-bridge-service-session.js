"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");

const WECHAT_BRIDGE_SERVICE_TOKEN_FILE_ENV = "WECHAT_BRIDGE_SERVICE_TOKEN_FILE";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const TRUSTED_SERVICE_NAMES = new Set(["api", "wechat-bridge-worker", "personal-wechat-bridge"]);

function createWechatBridgeServiceSession(runtimeDir, options = {}) {
  const tokenFile = path.resolve(
    options.tokenFile ||
      process.env[WECHAT_BRIDGE_SERVICE_TOKEN_FILE_ENV] ||
      path.join(runtimeDir, "wechat-bridge-service.key"),
  );
  const token = validToken(options.token) ? String(options.token).trim() : randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  const temporary = `${tokenFile}.${process.pid}.${randomUUID()}.tmp`;
  const backup = `${tokenFile}.${process.pid}.${randomUUID()}.replace-backup`;
  fs.writeFileSync(temporary, `${token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  let movedExisting = false;
  try {
    if (fs.existsSync(tokenFile)) {
      assertReplaceableTokenFile(tokenFile);
      fs.renameSync(tokenFile, backup);
      movedExisting = true;
    }
    fs.renameSync(temporary, tokenFile);
    if (movedExisting) fs.rmSync(backup, { force: true });
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    if (movedExisting && fs.existsSync(backup) && !fs.existsSync(tokenFile)) fs.renameSync(backup, tokenFile);
    throw error;
  }
  return { token, tokenFile };
}

function ensureWechatBridgeServiceSession(runtimeDir, options = {}) {
  const tokenFile = path.resolve(
    options.tokenFile ||
      process.env[WECHAT_BRIDGE_SERVICE_TOKEN_FILE_ENV] ||
      path.join(runtimeDir, "wechat-bridge-service.key"),
  );
  try {
    return { token: readWechatBridgeServiceToken(tokenFile), tokenFile };
  } catch {
    return createWechatBridgeServiceSession(runtimeDir, { ...options, tokenFile });
  }
}

function readWechatBridgeServiceToken(tokenFile) {
  const configured = String(tokenFile || process.env[WECHAT_BRIDGE_SERVICE_TOKEN_FILE_ENV] || "").trim();
  if (!configured) throw new Error("WeChat bridge service token file is not configured");
  const resolved = path.resolve(configured);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("WeChat bridge service token must be a regular file");
  const token = String(fs.readFileSync(resolved, "utf8") || "").trim();
  if (!validToken(token)) throw new Error("WeChat bridge service token file is invalid");
  return token;
}

function wechatBridgeServiceEnv(env, serviceName, tokenFile) {
  const next = withoutWechatBridgeServiceToken(env);
  if (TRUSTED_SERVICE_NAMES.has(String(serviceName || "").toLowerCase())) {
    next[WECHAT_BRIDGE_SERVICE_TOKEN_FILE_ENV] = path.resolve(tokenFile);
  }
  return next;
}

function withoutWechatBridgeServiceToken(env = {}) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.toUpperCase() === WECHAT_BRIDGE_SERVICE_TOKEN_FILE_ENV) delete next[key];
  }
  return next;
}

function assertReplaceableTokenFile(tokenFile) {
  const stat = fs.lstatSync(tokenFile);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("WeChat bridge service token target must be a regular file");
  readWechatBridgeServiceToken(tokenFile);
}

function validToken(value) {
  return TOKEN_PATTERN.test(String(value || "").trim());
}

module.exports = {
  WECHAT_BRIDGE_SERVICE_TOKEN_FILE_ENV,
  createWechatBridgeServiceSession,
  ensureWechatBridgeServiceSession,
  readWechatBridgeServiceToken,
  validToken,
  wechatBridgeServiceEnv,
  withoutWechatBridgeServiceToken,
};
