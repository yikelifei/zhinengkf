"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");

const WECHAT_WINDOW_OBSERVER_PROOF_FILE_ENV = "WECHAT_WINDOW_OBSERVER_PROOF_FILE";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const TRUSTED_SERVICE_NAMES = new Set(["api", "wechat-window-observer"]);

function createWechatWindowObserverProofSession(runtimeDir, options = {}) {
  const tokenFile = path.resolve(options.tokenFile || process.env[WECHAT_WINDOW_OBSERVER_PROOF_FILE_ENV] || path.join(runtimeDir, "wechat-window-observer-proof.key"));
  const token = validToken(options.token) ? String(options.token).trim() : randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  const temporary = `${tokenFile}.${process.pid}.${randomUUID()}.tmp`;
  const backup = `${tokenFile}.${process.pid}.${randomUUID()}.replace-backup`;
  fs.writeFileSync(temporary, `${token}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  let movedExisting = false;
  try {
    if (fs.existsSync(tokenFile)) {
      assertReplaceableProofFile(tokenFile);
      fs.renameSync(tokenFile, backup);
      movedExisting = true;
    }
    fs.renameSync(temporary, tokenFile);
    if (movedExisting) fs.rmSync(backup, { force: true });
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (movedExisting && !fs.existsSync(tokenFile) && fs.existsSync(backup)) {
      fs.renameSync(backup, tokenFile);
    }
    throw error;
  } finally {
    fs.rmSync(temporary, { force: true });
    if (fs.existsSync(tokenFile)) fs.rmSync(backup, { force: true });
  }
  try {
    fs.chmodSync(tokenFile, 0o600);
  } catch {
    // Windows ACLs are inherited from the private runtime directory.
  }
  return { token, tokenFile };
}

function assertReplaceableProofFile(tokenFile) {
  const stat = fs.lstatSync(tokenFile);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("observer proof target must be a regular file");
  }
  readWechatWindowObserverProofToken(tokenFile);
}

function ensureWechatWindowObserverProofSession(runtimeDir, options = {}) {
  const tokenFile = path.resolve(options.tokenFile || process.env[WECHAT_WINDOW_OBSERVER_PROOF_FILE_ENV] || path.join(runtimeDir, "wechat-window-observer-proof.key"));
  try {
    return { token: readWechatWindowObserverProofToken(tokenFile), tokenFile };
  } catch {
    return createWechatWindowObserverProofSession(runtimeDir, { ...options, tokenFile });
  }
}

function readWechatWindowObserverProofToken(tokenFile) {
  const configured = String(tokenFile || process.env[WECHAT_WINDOW_OBSERVER_PROOF_FILE_ENV] || "").trim();
  if (!configured) throw new Error("observer proof file is not configured");
  const resolved = path.resolve(configured);
  const token = String(fs.readFileSync(resolved, "utf8") || "").trim();
  if (!validToken(token)) throw new Error("observer proof file is invalid");
  return token;
}

function wechatWindowObserverServiceEnv(env, serviceName, tokenFile) {
  const next = withoutWechatWindowObserverProof(env);
  if (TRUSTED_SERVICE_NAMES.has(String(serviceName || "").toLowerCase())) {
    next[WECHAT_WINDOW_OBSERVER_PROOF_FILE_ENV] = path.resolve(tokenFile);
  }
  return next;
}

function withoutWechatWindowObserverProof(env = {}) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.toUpperCase() === WECHAT_WINDOW_OBSERVER_PROOF_FILE_ENV) delete next[key];
  }
  return next;
}

function validToken(value) {
  return TOKEN_PATTERN.test(String(value || "").trim());
}

module.exports = {
  WECHAT_WINDOW_OBSERVER_PROOF_FILE_ENV,
  createWechatWindowObserverProofSession,
  ensureWechatWindowObserverProofSession,
  readWechatWindowObserverProofToken,
  validToken,
  wechatWindowObserverServiceEnv,
  withoutWechatWindowObserverProof,
};
