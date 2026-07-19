"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function writeFileAtomic(filePath, contents, encoding = "utf8") {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tempPath = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, contents, encoding);
    const fd = fs.openSync(tempPath, "r");
    try {
      bestEffortFsync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, resolved);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  return resolved;
}

function bestEffortFsync(fd) {
  try {
    fs.fsyncSync(fd);
  } catch (error) {
    if (!["EPERM", "EINVAL", "ENOTSUP"].includes(error?.code)) throw error;
  }
}

function acquireAccountLock(accountId, config) {
  return acquireNamedLock(accountId, config, {
    fileName: `${safeFileSegment(accountId)}.lock`,
    owner: "wechat-bridge-account",
    metadata: { accountId },
  });
}

function acquireNamedLock(identity, config, options = {}) {
  fs.mkdirSync(config.lockDir, { recursive: true });
  const fileName = String(options.fileName || `${safeFileSegment(identity)}.lock`);
  if (path.basename(fileName) !== fileName) throw new Error("lock file name must not contain a path");
  const lockPath = path.join(config.lockDir, fileName);
  removeStaleLock(lockPath, config.lockStaleMs);
  const token = randomUUID();
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(
      fd,
      `${JSON.stringify({
        ...(options.metadata || {}),
        identity: String(identity || ""),
        owner: String(options.owner || "wechat-bridge"),
        pid: process.pid,
        token,
        createdAt: new Date().toISOString(),
      }, null, 2)}\n`,
      "utf8",
    );
    fs.closeSync(fd);
    const heartbeatMs = Math.max(10, Math.min(5000, Math.floor(Number(config.lockStaleMs || 1000) / 3)));
    const heartbeat = setInterval(() => {
      if (!lockOwnedBy(lockPath, token)) return;
      const now = new Date();
      try {
        fs.utimesSync(lockPath, now, now);
      } catch {
        // A missing lock is handled by the ownership check during release.
      }
    }, heartbeatMs);
    heartbeat.unref();
    return {
      lockPath,
      release() {
        clearInterval(heartbeat);
        if (lockOwnedBy(lockPath, token)) fs.rmSync(lockPath, { force: true });
      },
    };
  } catch (error) {
    if (error && error.code === "EEXIST") return null;
    throw error;
  }
}

function removeStaleLock(lockPath, staleMs) {
  if (!fs.existsSync(lockPath)) return;
  const stat = fs.statSync(lockPath);
  if (Date.now() - stat.mtimeMs <= staleMs) return;
  const lock = readJsonIfExists(lockPath);
  if (!lock || !Number.isInteger(lock.pid) || !String(lock.token || "").trim()) return;
  if (processIsAlive(lock.pid)) return;
  fs.rmSync(lockPath, { force: true });
}

function lockOwnedBy(lockPath, token) {
  return readJsonIfExists(lockPath)?.token === token;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function safeFileSegment(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

module.exports = { acquireAccountLock, acquireNamedLock, writeFileAtomic };
