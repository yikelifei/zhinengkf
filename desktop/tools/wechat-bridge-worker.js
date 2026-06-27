"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(desktopRoot, ".runtime");
const defaultApiBase = `http://127.0.0.1:${process.env.API_PORT || "3200"}/api`;
const defaultInboxDir = path.join(runtimeDir, "wechat-inbox");
const defaultLockDir = path.join(runtimeDir, "wechat-bridge-locks");
const defaultStatusFile = path.join(runtimeDir, "wechat-bridge-worker-status.json");
const BRIDGE_OUTBOX_VERSION = "wechat_bridge_outbox_v1";
const BRIDGE_ACK_VERSION = "wechat_bridge_ack_v1";

const args = process.argv.slice(2);

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

async function main() {
  if (hasArg("--help")) {
    printHelp();
    return;
  }

  const config = readConfig();
  do {
    const startedAt = new Date().toISOString();
    try {
      const result = await runOnce(config);
      writeWorkerStatus(config.statusFile, buildWorkerStatus(result, config, startedAt));
      printRunSummary(result, config);
    } catch (error) {
      writeWorkerStatus(config.statusFile, buildWorkerStatus(null, config, startedAt, error));
      throw error;
    }
    if (!config.watch) break;
    await delay(config.intervalMs);
  } while (true);
}

async function runOnce(config = readConfig()) {
  fs.mkdirSync(config.inboxDir, { recursive: true });
  fs.mkdirSync(config.lockDir, { recursive: true });

  const outbox = await fetchJson(`${config.apiBase}/wechat/bridge/outbox`);
  const pending = Array.isArray(outbox.pending) ? outbox.pending.slice(0, config.limit) : [];
  const handledAccounts = new Set();
  const processed = [];
  const skipped = [];
  const failed = [];

  for (const entry of pending) {
    const accountId = String(entry.wechatAccountId || "unknown");
    if (handledAccounts.has(accountId)) {
      skipped.push({ taskId: entry.taskId, wechatAccountId: accountId, reason: "same_account_already_handled" });
      continue;
    }
    handledAccounts.add(accountId);

    const lock = acquireAccountLock(accountId, config);
    if (!lock) {
      skipped.push({ taskId: entry.taskId, wechatAccountId: accountId, reason: "account_lock_busy" });
      continue;
    }

    try {
      processed.push(await processPendingEntry({ ...entry, outboxDir: outbox.outboxDir || "" }, config));
    } catch (error) {
      failed.push({
        taskId: entry.taskId,
        wechatAccountId: accountId,
        errorMessage: error instanceof Error ? error.message : "unknown bridge worker error",
      });
    } finally {
      lock.release();
    }
  }

  return {
    scanned: pending.length,
    processed,
    skipped,
    failed,
    outboxDir: outbox.outboxDir || "",
    mode: config.mode,
    ackTransport: config.ackTransport,
  };
}

async function processPendingEntry(entry, config) {
  if (config.mode === "noop") {
    const validation = validateOutboxEntry(entry);
    if (!validation.ok) {
      throw new Error(`invalid bridge outbox entry: ${validation.reason}`);
    }
    loadAndValidateOutboxPayload(entry);
    return {
      taskId: entry.taskId,
      wechatAccountId: entry.wechatAccountId,
      status: "noop",
      reason: "BRIDGE_MODE=noop，只观察 outbox，不回写发送结果",
    };
  }

  const validation = validateOutboxEntry(entry);
  if (!validation.ok) {
    throw new Error(`invalid bridge outbox entry: ${validation.reason}`);
  }
  const outbox = loadAndValidateOutboxPayload(entry);

  const ackPayload = buildAckPayload(entry, config.mode, outbox.payload);
  if (config.ackTransport === "api") {
    const result = await postJson(`${config.apiBase}/wechat/send-tasks/${encodeURIComponent(entry.taskId)}/bridge-ack`, ackPayload);
    return {
      taskId: entry.taskId,
      wechatAccountId: entry.wechatAccountId,
      status: ackPayload.status,
      transport: "api",
      result,
    };
  }

  const ackFile = writeAckFile(config.inboxDir, ackPayload);
  const result = config.ackTransport === "file_scan"
    ? await postJson(`${config.apiBase}/wechat/bridge/inbox/scan`, {})
    : null;
  if (config.ackTransport === "file_scan") {
    assertScanAcceptedAck(result, ackPayload);
  }
  return {
    taskId: entry.taskId,
    wechatAccountId: entry.wechatAccountId,
    status: ackPayload.status,
    transport: config.ackTransport,
    ackFile,
    result,
  };
}

function assertScanAcceptedAck(scanResult, ackPayload) {
  const processed = Array.isArray(scanResult?.processed) ? scanResult.processed : [];
  const failed = Array.isArray(scanResult?.failed) ? scanResult.failed : [];
  const matchesAck = (item) =>
    item?.taskId === ackPayload.taskId ||
    item?.result?.task?.id === ackPayload.taskId ||
    item?.attemptId === ackPayload.attemptId ||
    item?.result?.attempt?.id === ackPayload.attemptId;
  const failedItem = failed.find(matchesAck);
  if (failedItem) {
    const message = failedItem.errorMessage || failedItem.result?.errorMessage || "bridge inbox scan rejected ack";
    throw new Error(`bridge inbox scan failed for ${ackPayload.taskId}: ${message}`);
  }
  if (!processed.some(matchesAck)) {
    throw new Error(`bridge inbox scan did not process ack for ${ackPayload.taskId}`);
  }
  return scanResult;
}

function buildAckPayload(entry, mode, outboxPayload = {}) {
  const status = mode === "simulate_failed" ? "failed" : "sent";
  return {
    version: BRIDGE_ACK_VERSION,
    ackToken: typeof outboxPayload.ackToken === "string" ? outboxPayload.ackToken : undefined,
    taskId: String(entry.taskId || ""),
    attemptId: entry.attemptId || undefined,
    wechatAccountId: String(entry.wechatAccountId || ""),
    conversationId: String(entry.conversationId || ""),
    outboxFileName: String(entry.fileName || ""),
    status,
    errorMessage: status === "failed" ? "桥接 worker 模拟失败，需人工检查发送环境" : "",
    metadata: {
      source: "wechat-bridge-worker",
      mode,
      outboxFile: entry.fileName || "",
      payloadKind: entry.payloadKind || "",
      accountDisplayName: entry.accountDisplayName || "",
      conversationTitle: entry.conversationTitle || "",
    },
    sentAt: status === "sent" ? new Date().toISOString() : undefined,
  };
}

function validateOutboxEntry(entry = {}) {
  const preview = entry.preview || {};
  const checks = [
    {
      key: "protocolVersion",
      passed: preview.protocolVersion === BRIDGE_OUTBOX_VERSION,
    },
    { key: "taskId", passed: Boolean(entry.taskId) },
    { key: "attemptId", passed: Boolean(entry.attemptId) },
    { key: "wechatAccountId", passed: Boolean(entry.wechatAccountId) },
    { key: "conversationId", passed: Boolean(entry.conversationId) },
    { key: "fileName", passed: Boolean(entry.fileName) },
    {
      key: "previewIdentityMatches",
      passed:
        (!preview.wechatAccountId || preview.wechatAccountId === entry.wechatAccountId) &&
        (!preview.conversationId || preview.conversationId === entry.conversationId) &&
        (!preview.outboxFileName || preview.outboxFileName === entry.fileName) &&
        (!preview.attemptId || preview.attemptId === entry.attemptId),
    },
  ];
  const failedKeys = checks.filter((item) => !item.passed).map((item) => item.key);
  return {
    ok: failedKeys.length === 0,
    failedKeys,
    reason: failedKeys.length ? failedKeys.join(",") : "bridge outbox entry is valid",
  };
}

function loadAndValidateOutboxPayload(entry = {}) {
  const filePath = resolveOutboxFilePath(entry);
  const payload = readJsonFile(filePath);
  const validation = validateOutboxPayload(entry, payload);
  if (!validation.ok) {
    throw new Error(`invalid bridge outbox payload: ${validation.reason}`);
  }
  return { filePath, payload, validation };
}

function resolveOutboxFilePath(entry = {}) {
  const fileName = String(entry.fileName || "").trim();
  const filePath = String(entry.filePath || "").trim();
  if (!fileName) throw new Error("bridge outbox fileName is required");
  if (!filePath) throw new Error("bridge outbox filePath is required");
  if (path.basename(filePath) !== fileName) {
    throw new Error("bridge outbox filePath basename must match fileName");
  }

  const outboxDir = String(entry.outboxDir || "").trim() || path.dirname(filePath);
  const outboxRoot = path.resolve(outboxDir);
  const resolved = path.resolve(filePath);
  const relative = path.relative(outboxRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative !== fileName) {
    throw new Error("bridge outbox file must be a direct child of outbox directory");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error("bridge outbox file does not exist");
  }
  return resolved;
}

function readJsonFile(filePath) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("json root must be an object");
    }
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid json";
    throw new Error(`bridge outbox file is not valid json: ${message}`);
  }
}

function validateOutboxPayload(entry = {}, payload = {}) {
  const sendPlan = payload && typeof payload.sendPlan === "object" && payload.sendPlan ? payload.sendPlan : {};
  const target = payload && typeof payload.target === "object" && payload.target ? payload.target : {};
  const sendPlanTarget = sendPlan && typeof sendPlan.target === "object" && sendPlan.target ? sendPlan.target : {};
  const constraints = sendPlan && typeof sendPlan.constraints === "object" && sendPlan.constraints ? sendPlan.constraints : {};
  const actions = Array.isArray(sendPlan.actions) ? sendPlan.actions : null;
  const actionCount = Number(sendPlan.actionCount);
  const guardSnapshot = payload && typeof payload.guardSnapshot === "object" && payload.guardSnapshot ? payload.guardSnapshot : {};
  const context = payload && typeof payload.context === "object" && payload.context ? payload.context : {};

  const entryTaskId = String(entry.taskId || "");
  const entryWechatAccountId = String(entry.wechatAccountId || "");
  const entryConversationId = String(entry.conversationId || "");
  const hasPassedGuard = guardSnapshot.status === "passed" || guardSnapshot.ok === true || context.guardStatus === "passed";

  const checks = [
    {
      key: "protocolVersion",
      passed: payload.version === BRIDGE_OUTBOX_VERSION,
    },
    {
      key: "ackToken",
      passed: typeof payload.ackToken === "string" && /^[a-f0-9]{64}$/i.test(payload.ackToken),
    },
    {
      key: "taskId",
      passed: Boolean(entryTaskId) && String(payload.taskId || "") === entryTaskId,
    },
    {
      key: "wechatAccountId",
      passed: Boolean(entryWechatAccountId) && String(payload.wechatAccountId || "") === entryWechatAccountId,
    },
    {
      key: "conversationId",
      passed: Boolean(entryConversationId) && String(payload.conversationId || "") === entryConversationId,
    },
    {
      key: "targetIdentity",
      passed:
        String(target.wechatAccountId || "") === entryWechatAccountId &&
        String(target.conversationId || "") === entryConversationId,
    },
    {
      key: "sendPlanTargetIdentity",
      passed:
        String(sendPlanTarget.wechatAccountId || "") === entryWechatAccountId &&
        String(sendPlanTarget.conversationId || "") === entryConversationId,
    },
    {
      key: "sendPlanActions",
      passed: Array.isArray(actions) && actions.length > 0,
    },
    {
      key: "sendPlanActionCount",
      passed: Array.isArray(actions) && Number.isFinite(actionCount) && actionCount === actions.length,
    },
    {
      key: "sendPlanConstraints",
      passed:
        constraints.singleAccountLock === true &&
        constraints.requireActiveWindowMatch === true &&
        constraints.requireRecentCustomerMatch === true &&
        constraints.doNotMarkSentWithoutAck === true,
    },
    {
      key: "guardSnapshot",
      passed: hasPassedGuard,
    },
  ];

  const failedKeys = checks.filter((item) => !item.passed).map((item) => item.key);
  return {
    ok: failedKeys.length === 0,
    failedKeys,
    reason: failedKeys.length ? failedKeys.join(",") : "bridge outbox payload is valid",
  };
}

function writeAckFile(inboxDir, ackPayload) {
  fs.mkdirSync(inboxDir, { recursive: true });
  const fileName = `${Date.now()}-${safeFileSegment(ackPayload.taskId)}-${ackPayload.status}.json`;
  const filePath = path.join(inboxDir, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(ackPayload, null, 2)}\n`, "utf8");
  return filePath;
}

function buildWorkerStatus(result, config, startedAt, error) {
  const completedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt || completedAt));
  const processed = Array.isArray(result?.processed) ? result.processed : [];
  const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
  const failed = Array.isArray(result?.failed) ? result.failed : [];

  return {
    ok: !error && failed.length === 0,
    status: error ? "failed" : "completed",
    pid: process.pid,
    mode: config.mode,
    ackTransport: config.ackTransport,
    apiBase: config.apiBase,
    inboxDir: config.inboxDir,
    lockDir: config.lockDir,
    statusFile: config.statusFile,
    startedAt,
    completedAt,
    durationMs,
    result: {
      scanned: Number(result?.scanned || 0),
      processedCount: processed.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      outboxDir: result?.outboxDir || "",
      processed: processed.map(summarizeWorkerItem),
      skipped: skipped.map(summarizeWorkerItem),
      failed: failed.map(summarizeWorkerItem),
    },
    errorMessage: error instanceof Error ? error.message : error ? String(error) : "",
  };
}

function summarizeWorkerItem(item) {
  return {
    taskId: item?.taskId || "",
    wechatAccountId: item?.wechatAccountId || "",
    status: item?.status || "",
    reason: item?.reason || "",
    transport: item?.transport || "",
    errorMessage: item?.errorMessage || "",
  };
}

function writeWorkerStatus(statusFile, status) {
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(statusFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  return statusFile;
}

function acquireAccountLock(accountId, config) {
  fs.mkdirSync(config.lockDir, { recursive: true });
  const lockPath = path.join(config.lockDir, `${safeFileSegment(accountId)}.lock`);
  removeStaleLock(lockPath, config.lockStaleMs);
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(
      fd,
      `${JSON.stringify({ accountId, pid: process.pid, createdAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
    fs.closeSync(fd);
    return {
      lockPath,
      release() {
        fs.rmSync(lockPath, { force: true });
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
  if (Date.now() - stat.mtimeMs > staleMs) {
    fs.rmSync(lockPath, { force: true });
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `GET ${url} failed with ${response.status}`);
  }
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `POST ${url} failed with ${response.status}`);
  }
  return response.json();
}

function readConfig() {
  return {
    apiBase: String(valueArg("--api-base") || process.env.BRIDGE_API_BASE || defaultApiBase).replace(/\/$/, ""),
    inboxDir: path.resolve(valueArg("--inbox-dir") || process.env.WECHAT_BRIDGE_INBOX_DIR || defaultInboxDir),
    lockDir: path.resolve(valueArg("--lock-dir") || process.env.WECHAT_BRIDGE_LOCK_DIR || defaultLockDir),
    statusFile: path.resolve(valueArg("--status-file") || process.env.WECHAT_BRIDGE_WORKER_STATUS_FILE || defaultStatusFile),
    mode: normalizeMode(valueArg("--mode") || process.env.BRIDGE_MODE || "noop"),
    ackTransport: normalizeAckTransport(valueArg("--ack") || process.env.BRIDGE_ACK_TRANSPORT || "file_scan"),
    limit: numberValue(valueArg("--limit") || process.env.BRIDGE_LIMIT, 5, 1, 50),
    intervalMs: numberValue(valueArg("--interval-ms") || process.env.BRIDGE_POLL_INTERVAL_MS, 3000, 500, 60000),
    lockStaleMs: numberValue(valueArg("--lock-stale-ms") || process.env.BRIDGE_LOCK_STALE_MS, 5 * 60 * 1000, 1000, 60 * 60 * 1000),
    watch: hasArg("--watch"),
  };
}

function normalizeMode(value) {
  const mode = String(value || "").trim();
  if (["noop", "simulate_sent", "simulate_failed"].includes(mode)) return mode;
  return "noop";
}

function normalizeAckTransport(value) {
  const transport = String(value || "").trim();
  if (["file", "file_scan", "api"].includes(transport)) return transport;
  return "file_scan";
}

function numberValue(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function safeFileSegment(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

function hasArg(name) {
  return args.includes(name);
}

function valueArg(name) {
  const equals = args.find((item) => item.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return "";
}

function printRunSummary(result, config) {
  console.log(
    `[bridge] mode=${config.mode} transport=${config.ackTransport} scanned=${result.scanned} processed=${result.processed.length} skipped=${result.skipped.length} failed=${result.failed.length}`,
  );
  for (const item of result.processed) {
    console.log(`[bridge] task=${item.taskId} account=${item.wechatAccountId || ""} status=${item.status} transport=${item.transport || "none"}`);
  }
  for (const item of result.skipped) {
    console.log(`[skip] task=${item.taskId || ""} account=${item.wechatAccountId || ""} reason=${item.reason}`);
  }
  for (const item of result.failed) {
    console.log(`[fail] task=${item.taskId || ""} account=${item.wechatAccountId || ""} ${item.errorMessage}`);
  }
}

function printHelp() {
  console.log(`Usage: node tools/wechat-bridge-worker.js [--once|--watch] [--mode noop|simulate_sent|simulate_failed]

Environment:
  BRIDGE_API_BASE=http://127.0.0.1:3200/api
  BRIDGE_MODE=noop|simulate_sent|simulate_failed
  BRIDGE_ACK_TRANSPORT=file_scan|file|api
  WECHAT_BRIDGE_INBOX_DIR=.runtime/wechat-inbox
  WECHAT_BRIDGE_LOCK_DIR=.runtime/wechat-bridge-locks
  WECHAT_BRIDGE_WORKER_STATUS_FILE=.runtime/wechat-bridge-worker-status.json

Default mode is noop: it only reads pending bridge outbox tasks and does not mark anything sent.`);
}

module.exports = {
  buildAckPayload,
  buildWorkerStatus,
  assertScanAcceptedAck,
  loadAndValidateOutboxPayload,
  validateOutboxEntry,
  validateOutboxPayload,
  normalizeAckTransport,
  normalizeMode,
  numberValue,
  safeFileSegment,
  runOnce,
  writeWorkerStatus,
};
