"use strict";

const path = require("node:path");
const { randomBytes } = require("node:crypto");
const {
  atomicWritePrivateJson,
  readPrivateJsonFile,
} = require("./private-runtime-file");

const DESKTOP_WEB_SESSION_PROOF_ENV = "DESKTOP_WEB_SESSION_PROOF";
const DESKTOP_WEB_SESSION_FILE_ENV = "DESKTOP_WEB_SESSION_FILE";
const DESKTOP_WEB_SESSION_PROOF_PATTERN = /^[a-f0-9]{64}$/i;

function resolveDesktopWebSessionFile(runtimeDir, sessionFile) {
  return path.resolve(
    sessionFile ||
      process.env[DESKTOP_WEB_SESSION_FILE_ENV] ||
      path.join(runtimeDir, "desktop-web-session.json"),
  );
}

function createDesktopWebSession(runtimeDir, options = {}) {
  const sessionFile = resolveDesktopWebSessionFile(runtimeDir, options.sessionFile);
  const proof = isValidDesktopWebSessionProof(options.proof)
    ? String(options.proof).trim()
    : randomBytes(32).toString("hex");
  atomicWritePrivateJson(sessionFile, {
    proof,
    createdAt: new Date().toISOString(),
    launcherPid: process.pid,
  });
  return { proof, sessionFile };
}

function readDesktopWebSessionProof(sessionFile) {
  const payload = readPrivateJsonFile(path.resolve(sessionFile));
  const proof = String(payload?.proof || "").trim();
  if (!isValidDesktopWebSessionProof(proof)) {
    throw new Error("Desktop Web session proof file is invalid");
  }
  return proof;
}

function desktopWebSessionServiceEnv(env, serviceName, proof) {
  const next = withoutDesktopWebSessionProof(env);
  if (String(serviceName || "").toLowerCase() === "web") {
    if (!isValidDesktopWebSessionProof(proof)) {
      throw new Error("Desktop Web session proof is invalid");
    }
    next[DESKTOP_WEB_SESSION_PROOF_ENV] = String(proof).trim();
  }
  return next;
}

function withoutDesktopWebSessionProof(env = {}) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.toUpperCase() === DESKTOP_WEB_SESSION_PROOF_ENV) delete next[key];
  }
  return next;
}

function isValidDesktopWebSessionProof(value) {
  return DESKTOP_WEB_SESSION_PROOF_PATTERN.test(String(value || "").trim());
}

module.exports = {
  DESKTOP_WEB_SESSION_FILE_ENV,
  DESKTOP_WEB_SESSION_PROOF_ENV,
  createDesktopWebSession,
  desktopWebSessionServiceEnv,
  isValidDesktopWebSessionProof,
  readDesktopWebSessionProof,
  resolveDesktopWebSessionFile,
  withoutDesktopWebSessionProof,
};
