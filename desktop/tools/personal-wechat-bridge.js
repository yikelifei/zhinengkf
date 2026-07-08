"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR ? path.resolve(process.env.DESKTOP_RUNTIME_DIR) : path.join(desktopRoot, ".runtime");
const defaultDispatchDir = path.join(runtimeDir, "wechat-dispatch");
const defaultInboxDir = path.join(runtimeDir, "wechat-inbox");
const defaultStatusFile = path.join(runtimeDir, "personal-wechat-bridge-status.json");
const defaultApiBase = `http://127.0.0.1:${process.env.API_PORT || "3200"}/api`;
const BRIDGE_DISPATCH_VERSION = "wechat_bridge_dispatch_v1";
const BRIDGE_ACK_VERSION = "wechat_bridge_ack_v1";

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

async function main() {
  if (hasArg("--help") || hasArg("-h")) {
    printHelp();
    return;
  }
  const config = readConfig();
  if (hasArg("--status")) {
    printStatus(config);
    return;
  }

  while (true) {
    const startedAt = new Date().toISOString();
    try {
      const result = await runOnce(config);
      writeStatus(config.statusFile, buildStatus(result, config, startedAt));
      printSummary(result);
    } catch (error) {
      writeStatus(config.statusFile, buildStatus(null, config, startedAt, error));
      console.error(error?.stack || error);
      if (!config.watch) throw error;
    }
    if (!config.watch) break;
    await sleep(config.intervalMs);
  }
}

async function runOnce(config = readConfig()) {
  fs.mkdirSync(config.dispatchDir, { recursive: true });
  fs.mkdirSync(config.inboxDir, { recursive: true });
  const files = listDispatchFiles(config.dispatchDir).slice(0, config.limit);
  const processed = [];
  const skipped = [];
  const failed = [];

  for (const filePath of files) {
    try {
      const result = await processDispatchFile(filePath, config);
      if (result.status === "skipped") skipped.push(result);
      else processed.push(result);
    } catch (error) {
      failed.push({
        fileName: path.basename(filePath),
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    scanned: files.length,
    processed,
    skipped,
    failed,
    dispatchDir: config.dispatchDir,
    inboxDir: config.inboxDir,
  };
}

async function processDispatchFile(filePath, config) {
  const dispatch = readJsonFile(filePath);
  const validation = validateDispatchPayload(dispatch, filePath);
  if (!validation.ok) {
    return await writeFailureAckAndScan(filePath, dispatch, config, `invalid dispatch: ${validation.reason}`);
  }

  if (!config.sendEnabled) {
    return {
      fileName: path.basename(filePath),
      taskId: dispatch.taskId || "",
      status: "skipped",
      reason: "PERSONAL_WECHAT_SEND is not 1; dispatch observed only",
    };
  }

  if (dispatchExpired(dispatch)) {
    return await writeFailureAckAndScan(filePath, dispatch, config, `dispatch expired at ${dispatch.expiresAt}`);
  }

  const sourceOutbox = loadSourceOutbox(dispatch);
  const outboxValidation = validateSourceOutbox(dispatch, sourceOutbox);
  if (!outboxValidation.ok) {
    return await writeFailureAckAndScan(filePath, dispatch, config, `invalid source outbox: ${outboxValidation.reason}`);
  }

  const text = buildTextPayload(dispatch.sendPlan?.actions || []);
  if (!text) {
    return await writeFailureAckAndScan(filePath, dispatch, config, "personal WeChat bridge currently supports text actions only");
  }

  if (!config.allowUnverifiedWindow) {
    return await writeFailureAckAndScan(
      filePath,
      dispatch,
      config,
      "current PC WeChat UI cannot expose active chat title; set PERSONAL_WECHAT_ALLOW_UNVERIFIED_WINDOW=1 only after manually opening the target chat",
    );
  }

  const sendResult = executePersonalWechatPaste(text, {
    autoEnter: config.autoEnter,
    timeoutMs: config.sendTimeoutMs,
  });
  if (!sendResult.ok) {
    return await writeFailureAckAndScan(filePath, dispatch, config, sendResult.errorMessage || "personal WeChat paste failed");
  }

  if (!config.autoEnter) {
    return {
      fileName: path.basename(filePath),
      taskId: dispatch.taskId || "",
      status: "drafted",
      reason: "message pasted into personal WeChat input; PERSONAL_WECHAT_AUTO_ENTER is not 1 so no sent ack was written",
    };
  }

  const ackPayload = buildAckPayload(dispatch, sourceOutbox.payload, "sent", {
    source: "personal_wechat_bridge",
    automation: "clipboard_sendkeys",
    activeChatVerified: false,
    windowVerification: "unavailable_in_current_pc_wechat_ui",
  });
  const ackFile = writeAckFile(config.inboxDir, ackPayload);
  const scanResult = await scanAckInbox(config);
  return {
    fileName: path.basename(filePath),
    taskId: dispatch.taskId || "",
    status: "sent_ack_written",
    ackFile,
    scanResult,
  };
}

async function writeFailureAckAndScan(filePath, dispatch, config, errorMessage) {
  const sourceOutbox = tryLoadSourceOutbox(dispatch);
  const ackPayload = buildAckPayload(dispatch || {}, sourceOutbox?.payload || {}, "failed", {
    source: "personal_wechat_bridge",
    errorMessage,
  });
  ackPayload.errorMessage = errorMessage;
  const ackFile = writeAckFile(config.inboxDir, ackPayload);
  let scanResult = null;
  try {
    scanResult = await scanAckInbox(config);
  } catch (error) {
    scanResult = { ok: false, errorMessage: error instanceof Error ? error.message : String(error) };
  }
  return {
    fileName: path.basename(filePath),
    taskId: dispatch?.taskId || "",
    status: "failed_ack_written",
    errorMessage,
    ackFile,
    scanResult,
  };
}

function validateDispatchPayload(dispatch, filePath) {
  if (!dispatch || typeof dispatch !== "object" || Array.isArray(dispatch)) return { ok: false, reason: "payload must be an object" };
  if (dispatch.version !== BRIDGE_DISPATCH_VERSION) return { ok: false, reason: "unsupported dispatch version" };
  if (!String(dispatch.taskId || "").trim()) return { ok: false, reason: "taskId is required" };
  if (!String(dispatch.wechatAccountId || "").trim()) return { ok: false, reason: "wechatAccountId is required" };
  if (!String(dispatch.conversationId || "").trim()) return { ok: false, reason: "conversationId is required" };
  if (!String(dispatch.sourceOutboxFileName || "").trim()) return { ok: false, reason: "sourceOutboxFileName is required" };
  if (!String(dispatch.sourceOutboxFilePath || "").trim()) return { ok: false, reason: "sourceOutboxFilePath is required" };
  if (path.basename(String(dispatch.sourceOutboxFilePath)) !== String(dispatch.sourceOutboxFileName)) {
    return { ok: false, reason: "source outbox basename mismatch" };
  }
  if (!Array.isArray(dispatch.sendPlan?.actions) || dispatch.sendPlan.actions.length < 1) {
    return { ok: false, reason: "sendPlan.actions must not be empty" };
  }
  const resolved = path.resolve(filePath);
  if (path.basename(resolved) !== path.basename(filePath)) return { ok: false, reason: "dispatch file must be a direct file" };
  return { ok: true };
}

function validateSourceOutbox(dispatch, sourceOutbox) {
  const payload = sourceOutbox?.payload || {};
  if (payload.version !== "wechat_bridge_outbox_v1") return { ok: false, reason: "unsupported outbox version" };
  if (!/^[a-f0-9]{64}$/i.test(String(payload.ackToken || ""))) return { ok: false, reason: "ackToken is missing or invalid" };
  if (String(payload.taskId || "") !== String(dispatch.taskId || "")) return { ok: false, reason: "taskId mismatch" };
  if (String(payload.wechatAccountId || "") !== String(dispatch.wechatAccountId || "")) return { ok: false, reason: "wechatAccountId mismatch" };
  if (String(payload.conversationId || "") !== String(dispatch.conversationId || "")) return { ok: false, reason: "conversationId mismatch" };
  return { ok: true };
}

function loadSourceOutbox(dispatch) {
  const sourcePath = resolveSourceOutboxPath(dispatch);
  return { filePath: sourcePath, payload: readJsonFile(sourcePath) };
}

function tryLoadSourceOutbox(dispatch) {
  try {
    if (!dispatch) return null;
    return loadSourceOutbox(dispatch);
  } catch {
    return null;
  }
}

function resolveSourceOutboxPath(dispatch) {
  const fileName = String(dispatch.sourceOutboxFileName || "").trim();
  const filePath = path.resolve(String(dispatch.sourceOutboxFilePath || "").trim());
  if (!fileName || path.basename(filePath) !== fileName) throw new Error("source outbox basename mismatch");
  if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) throw new Error("source outbox file is missing");
  const root = path.dirname(filePath);
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(filePath);
  const relative = path.relative(realRoot, realFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative !== fileName) {
    throw new Error("source outbox file must be a direct child of its directory");
  }
  return filePath;
}

function dispatchExpired(dispatch) {
  const expiresAt = Date.parse(String(dispatch.expiresAt || ""));
  return Number.isFinite(expiresAt) && Date.now() > expiresAt;
}

function buildTextPayload(actions) {
  const parts = [];
  for (const action of actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) return "";
    const type = String(action.type || "").trim();
    if (type !== "text") return "";
    const text = String(action.text || "").trim();
    if (text) parts.push(text);
  }
  return parts.join("\r\n").trim();
}

function executePersonalWechatPaste(text, options = {}) {
  if (process.platform !== "win32") {
    return { ok: false, errorMessage: "personal WeChat bridge currently supports Windows only" };
  }
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$procs = @(Get-Process Weixin,WeChat -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })",
    "if ($procs.Count -lt 1) { throw 'WeChat/Weixin main window was not found' }",
    "$shell = New-Object -ComObject WScript.Shell",
    "$activated = $false",
    "foreach ($p in $procs) { if ($shell.AppActivate($p.Id)) { $activated = $true; break } }",
    "if (-not $activated) { throw 'could not activate WeChat/Weixin window' }",
    "Start-Sleep -Milliseconds 250",
    "Set-Clipboard -Value $env:PERSONAL_WECHAT_BRIDGE_TEXT",
    "[System.Windows.Forms.SendKeys]::SendWait('^v')",
    "Start-Sleep -Milliseconds 100",
    "if ($env:PERSONAL_WECHAT_BRIDGE_AUTO_ENTER -eq '1') { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript],
    {
      encoding: "utf8",
      timeout: Number(options.timeoutMs || 10000),
      windowsHide: false,
      env: {
        ...process.env,
        PERSONAL_WECHAT_BRIDGE_TEXT: text,
        PERSONAL_WECHAT_BRIDGE_AUTO_ENTER: options.autoEnter ? "1" : "0",
      },
    },
  );
  if (result.status === 0) return { ok: true };
  return {
    ok: false,
    errorMessage: singleLine(result.stderr || result.stdout || result.error?.message || `powershell exited with ${result.status}`),
  };
}

function buildAckPayload(dispatch, outboxPayload, status, metadata = {}) {
  return {
    version: BRIDGE_ACK_VERSION,
    ackToken: typeof outboxPayload?.ackToken === "string" ? outboxPayload.ackToken : undefined,
    taskId: String(dispatch.taskId || ""),
    attemptId: dispatch.attemptId || undefined,
    wechatAccountId: String(dispatch.wechatAccountId || ""),
    conversationId: String(dispatch.conversationId || ""),
    outboxFileName: String(dispatch.sourceOutboxFileName || ""),
    status: status === "sent" ? "sent" : "failed",
    sentAt: status === "sent" ? new Date().toISOString() : undefined,
    metadata,
  };
}

function writeAckFile(inboxDir, ackPayload) {
  fs.mkdirSync(inboxDir, { recursive: true });
  const fileName = `${Date.now()}-${safeFileSegment(ackPayload.wechatAccountId)}-${safeFileSegment(ackPayload.taskId)}-${safeFileSegment(ackPayload.attemptId || "attempt")}-${ackPayload.status}.ack.json`;
  const filePath = path.join(inboxDir, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(ackPayload, null, 2)}\n`, "utf8");
  return filePath;
}

function scanAckInbox(config) {
  if (!config.scanAckInbox) return Promise.resolve(null);
  return postJson(`${config.apiBase}/wechat/bridge/inbox/scan`, {});
}

function listDispatchFiles(dispatchDir) {
  return fs
    .readdirSync(dispatchDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".dispatch.json"))
    .map((entry) => path.join(dispatchDir, entry.name))
    .sort();
}

function readConfig() {
  return {
    apiBase: String(valueArg("--api-base") || process.env.PERSONAL_WECHAT_API_BASE || process.env.BRIDGE_API_BASE || defaultApiBase).replace(/\/$/, ""),
    dispatchDir: path.resolve(valueArg("--dispatch-dir") || process.env.WECHAT_BRIDGE_DISPATCH_DIR || defaultDispatchDir),
    inboxDir: path.resolve(valueArg("--inbox-dir") || process.env.WECHAT_BRIDGE_INBOX_DIR || defaultInboxDir),
    statusFile: path.resolve(valueArg("--status-file") || process.env.PERSONAL_WECHAT_BRIDGE_STATUS_FILE || defaultStatusFile),
    limit: numberValue(valueArg("--limit") || process.env.PERSONAL_WECHAT_BRIDGE_LIMIT, 3, 1, 20),
    intervalMs: numberValue(valueArg("--interval-ms") || process.env.PERSONAL_WECHAT_BRIDGE_INTERVAL_MS, 3000, 500, 60000),
    sendTimeoutMs: numberValue(valueArg("--send-timeout-ms") || process.env.PERSONAL_WECHAT_SEND_TIMEOUT_MS, 10000, 1000, 60000),
    sendEnabled: envFlag("PERSONAL_WECHAT_SEND"),
    autoEnter: envFlag("PERSONAL_WECHAT_AUTO_ENTER"),
    allowUnverifiedWindow: envFlag("PERSONAL_WECHAT_ALLOW_UNVERIFIED_WINDOW"),
    scanAckInbox: !envFlag("PERSONAL_WECHAT_DISABLE_ACK_SCAN"),
    watch: hasArg("--watch"),
  };
}

function buildStatus(result, config, startedAt, error) {
  const completedAt = new Date().toISOString();
  return {
    ok: !error && (!result || result.failed.length === 0),
    status: error ? "failed" : "completed",
    pid: process.pid,
    startedAt,
    completedAt,
    sendEnabled: config.sendEnabled,
    autoEnter: config.autoEnter,
    allowUnverifiedWindow: config.allowUnverifiedWindow,
    dispatchDir: config.dispatchDir,
    inboxDir: config.inboxDir,
    result: result
      ? {
          scanned: result.scanned,
          processedCount: result.processed.length,
          skippedCount: result.skipped.length,
          failedCount: result.failed.length,
        }
      : null,
    errorMessage: error ? singleLine(error.message || String(error)) : "",
  };
}

function printStatus(config) {
  const status = readJsonIfExists(config.statusFile) || {};
  console.log(JSON.stringify({ statusFile: config.statusFile, status }, null, 2));
}

function printSummary(result) {
  console.log(
    `[personal-wechat] scanned=${result.scanned} processed=${result.processed.length} skipped=${result.skipped.length} failed=${result.failed.length}`,
  );
  for (const item of result.processed) console.log(`[processed] task=${item.taskId || ""} status=${item.status}`);
  for (const item of result.skipped) console.log(`[skipped] task=${item.taskId || ""} reason=${singleLine(item.reason || "")}`);
  for (const item of result.failed) console.log(`[failed] file=${item.fileName || ""} error=${singleLine(item.errorMessage || "")}`);
}

function writeStatus(filePath, status) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const request = http.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(data || `POST ${url} failed with ${response.statusCode}`));
            return;
          }
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch {
            resolve(data);
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function readJsonIfExists(filePath) {
  try {
    return readJsonFile(filePath);
  } catch {
    return null;
  }
}

function safeFileSegment(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "item";
}

function valueArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return String(process.argv[index + 1] || "").trim();
}

function hasArg(name) {
  return process.argv.includes(name);
}

function envFlag(name) {
  return String(process.env[name] || "").trim() === "1";
}

function numberValue(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function singleLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage: node tools/personal-wechat-bridge.js [--once|--watch|--status]

Environment:
  PERSONAL_WECHAT_SEND=1                    enable touching the personal WeChat window
  PERSONAL_WECHAT_ALLOW_UNVERIFIED_WINDOW=1 allow send/paste when current chat title cannot be verified
  PERSONAL_WECHAT_AUTO_ENTER=1              press Enter after paste and then write sent ack

Default mode only observes dispatch files and never sends or acknowledges.`);
}

module.exports = {
  BRIDGE_ACK_VERSION,
  BRIDGE_DISPATCH_VERSION,
  buildAckPayload,
  buildTextPayload,
  validateDispatchPayload,
  validateSourceOutbox,
  runOnce,
};
