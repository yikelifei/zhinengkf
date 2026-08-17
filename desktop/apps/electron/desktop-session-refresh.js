"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DESKTOP_SESSION_PROOF_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_SESSION_FILE_BYTES = 4096;

function createDesktopSessionRefreshWatcher({
  sessionFile,
  initialProof,
  onProofChange,
  intervalMs = 1000,
}) {
  const resolvedSessionFile = path.resolve(String(sessionFile || ""));
  if (!resolvedSessionFile || typeof onProofChange !== "function") return null;

  let currentProof = validProof(initialProof) ? String(initialProof).trim() : "";
  let stopped = false;
  let pending = Promise.resolve();

  const refresh = () => {
    pending = pending.then(async () => {
      if (stopped) return false;
      const nextProof = readDesktopSessionProof(resolvedSessionFile);
      if (!nextProof || nextProof === currentProof) return false;
      const accepted = await onProofChange(nextProof);
      if (accepted === false) return false;
      currentProof = nextProof;
      return true;
    }).catch(() => false);
    return pending;
  };

  fs.watchFile(resolvedSessionFile, {
    interval: Math.max(250, Number(intervalMs) || 1000),
    persistent: false,
  }, refresh);

  return {
    refresh,
    stop() {
      if (stopped) return;
      stopped = true;
      fs.unwatchFile(resolvedSessionFile, refresh);
    },
    currentProof() {
      return currentProof;
    },
  };
}

function readDesktopSessionProof(sessionFile) {
  try {
    const stat = fs.lstatSync(sessionFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_SESSION_FILE_BYTES) {
      return null;
    }
    const payload = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    return validProof(payload?.proof) ? String(payload.proof).trim() : null;
  } catch {
    return null;
  }
}

function validProof(value) {
  return DESKTOP_SESSION_PROOF_PATTERN.test(String(value || "").trim());
}

module.exports = {
  createDesktopSessionRefreshWatcher,
  readDesktopSessionProof,
};
