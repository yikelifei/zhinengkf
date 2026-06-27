"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(desktopRoot, ".runtime");
const defaultInboxDir = path.join(runtimeDir, "wechat-window-snapshots");
const defaultStatusFile = path.join(runtimeDir, "wechat-window-observer-status.json");
const defaultApiBase = `http://127.0.0.1:${process.env.API_PORT || "3200"}/api`;
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
      writeObserverStatus(config.statusFile, buildObserverStatus(result, config, startedAt));
      printRunSummary(result, config);
    } catch (error) {
      writeObserverStatus(config.statusFile, buildObserverStatus(null, config, startedAt, error));
      throw error;
    }
    if (!config.watch) break;
    await delay(config.intervalMs);
  } while (true);
}

async function runOnce(config = readConfig(), capture = captureForegroundWindow) {
  fs.mkdirSync(config.inboxDir, { recursive: true });
  const windowInfo = await Promise.resolve(capture(config));
  const snapshot = buildSnapshotFromWindow(windowInfo, config);
  const snapshotFile = config.dryRun ? "" : writeSnapshotFile(config.inboxDir, snapshot);
  const scanResult = config.scan && !config.dryRun
    ? await postJson(`${config.apiBase}/wechat/window-snapshots/inbox/scan`, {})
    : null;

  return {
    snapshot,
    snapshotFile,
    scanResult,
    dryRun: config.dryRun,
    windowSummary: summarizeWindow(windowInfo),
  };
}

function buildSnapshotFromWindow(windowInfo = {}, config = {}, capturedAt = new Date().toISOString()) {
  const title = cleanText(windowInfo.title || windowInfo.windowTitle || "");
  const processName = cleanText(windowInfo.processName || "");
  const account = matchAccount(windowInfo, config);
  const conversation = matchConversation(windowInfo, account, config);
  const wechatLike = isWechatLikeWindow(windowInfo, config);
  const online = Boolean(wechatLike && title);
  const chatTitle = cleanText(conversation?.chatTitle || conversation?.title || title);

  return {
    source: "windows_foreground_observer",
    isOnline: online,
    wechatAccountId: cleanText(account?.wechatAccountId || account?.accountId || ""),
    accountDisplayName: cleanText(account?.accountDisplayName || account?.displayName || ""),
    windowHandle: cleanText(windowInfo.windowHandle || windowInfo.hwnd || ""),
    processId: positiveNumber(windowInfo.processId),
    chatTitle,
    activeChatTitle: chatTitle,
    externalChatId: cleanText(conversation?.externalChatId || conversation?.chatId || ""),
    recentCustomerId: cleanText(conversation?.recentCustomerId || conversation?.customerId || ""),
    recentMessageText: cleanText(conversation?.recentMessageText || ""),
    confidence: snapshotConfidence({ online, account, conversation }),
    capturedAt,
    raw: {
      title,
      processName,
      processId: positiveNumber(windowInfo.processId),
      executablePath: cleanText(windowInfo.executablePath || ""),
      matchedAccountRule: cleanText(account?.name || account?.wechatAccountId || ""),
      matchedConversationRule: cleanText(conversation?.name || conversation?.conversationId || conversation?.customerId || ""),
    },
  };
}

function matchAccount(windowInfo = {}, config = {}) {
  const accounts = Array.isArray(config.accounts) ? config.accounts : [];
  return accounts.find((rule) => ruleMatchesWindow(rule, windowInfo)) || null;
}

function matchConversation(windowInfo = {}, account = null, config = {}) {
  const conversations = Array.isArray(config.conversations) ? config.conversations : [];
  return (
    conversations.find((rule) => {
      const expectedAccountId = cleanText(rule.wechatAccountId || rule.accountId || "");
      const accountId = cleanText(account?.wechatAccountId || account?.accountId || "");
      if (expectedAccountId && accountId && expectedAccountId !== accountId) return false;
      return ruleMatchesWindow(rule, windowInfo);
    }) || null
  );
}

function ruleMatchesWindow(rule = {}, windowInfo = {}) {
  const title = cleanText(windowInfo.title || windowInfo.windowTitle || "").toLowerCase();
  const processName = cleanText(windowInfo.processName || "").toLowerCase();
  const processId = positiveNumber(windowInfo.processId);

  let hasCondition = false;
  let matched = true;

  const processIds = normalizeArray(rule.processIds || rule.processId).map(Number).filter((item) => Number.isFinite(item));
  if (processIds.length) {
    hasCondition = true;
    matched = matched && processIds.includes(processId);
  }

  const processNames = normalizeArray(rule.processNames || rule.processName).map((item) => item.toLowerCase());
  if (processNames.length) {
    hasCondition = true;
    matched = matched && processNames.includes(processName);
  }

  const titleEquals = normalizeArray(rule.titleEquals || rule.title).map((item) => item.toLowerCase());
  if (titleEquals.length) {
    hasCondition = true;
    matched = matched && titleEquals.includes(title);
  }

  const titleIncludes = normalizeArray(rule.titleIncludes).map((item) => item.toLowerCase());
  if (titleIncludes.length) {
    hasCondition = true;
    matched = matched && titleIncludes.every((token) => title.includes(token));
  }

  const titleAnyIncludes = normalizeArray(rule.titleAnyIncludes).map((item) => item.toLowerCase());
  if (titleAnyIncludes.length) {
    hasCondition = true;
    matched = matched && titleAnyIncludes.some((token) => title.includes(token));
  }

  return hasCondition && matched;
}

function isWechatLikeWindow(windowInfo = {}, config = {}) {
  const processName = cleanText(windowInfo.processName || "").toLowerCase();
  const title = cleanText(windowInfo.title || windowInfo.windowTitle || "").toLowerCase();
  const names = normalizeArray(config.wechatProcessNames || ["WeChat", "Weixin", "WeChatAppEx"]).map((item) => item.toLowerCase());
  const titleTokens = normalizeArray(config.wechatTitleTokens || ["wechat", "weixin", "微信"]).map((item) => item.toLowerCase());

  return names.includes(processName) || titleTokens.some((token) => title.includes(token));
}

function captureForegroundWindow() {
  if (process.platform !== "win32") {
    return {
      title: "",
      processName: "",
      processId: null,
      executablePath: "",
      errorMessage: "windows foreground observer only runs on Windows",
    };
  }

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ForegroundWindowProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$handle = [ForegroundWindowProbe]::GetForegroundWindow()
$builder = New-Object System.Text.StringBuilder 2048
[void][ForegroundWindowProbe]::GetWindowText($handle, $builder, $builder.Capacity)
$pid = 0
[void][ForegroundWindowProbe]::GetWindowThreadProcessId($handle, [ref]$pid)
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
[pscustomobject]@{
  windowHandle = $handle.ToInt64().ToString()
  title = $builder.ToString()
  processId = $pid
  processName = if ($proc) { $proc.ProcessName } else { "" }
  executablePath = if ($proc) { $proc.Path } else { "" }
} | ConvertTo-Json -Compress
`;

  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "foreground window capture failed").trim());
  }
  try {
    return JSON.parse(String(result.stdout || "").trim());
  } catch (error) {
    throw new Error(`foreground window capture returned invalid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

function writeSnapshotFile(inboxDir, snapshot) {
  fs.mkdirSync(inboxDir, { recursive: true });
  const filePath = path.join(inboxDir, `${Date.now()}-${safeFileSegment(snapshot.wechatAccountId || "unbound")}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return filePath;
}

function buildObserverStatus(result, config, startedAt, error) {
  const completedAt = new Date().toISOString();
  const snapshot = result?.snapshot || {};
  return {
    ok: !error && Boolean(snapshot.source),
    status: error ? "failed" : "completed",
    pid: process.pid,
    apiBase: config.apiBase,
    inboxDir: config.inboxDir,
    statusFile: config.statusFile,
    scan: Boolean(config.scan),
    dryRun: Boolean(config.dryRun),
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt || completedAt)),
    result: result
      ? {
          wroteSnapshot: Boolean(result.snapshotFile),
          snapshotFile: result.snapshotFile || "",
          isOnline: Boolean(snapshot.isOnline),
          wechatAccountId: snapshot.wechatAccountId || "",
          confidence: snapshot.confidence || 0,
          processName: result.windowSummary?.processName || "",
          processId: result.windowSummary?.processId || null,
          scanProcessed: Array.isArray(result.scanResult?.processed) ? result.scanResult.processed.length : null,
          scanFailed: Array.isArray(result.scanResult?.failed) ? result.scanResult.failed.length : null,
        }
      : null,
    errorMessage: error instanceof Error ? error.message : error ? String(error) : "",
  };
}

function writeObserverStatus(statusFile, status) {
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(statusFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  return statusFile;
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
  const configFile = path.resolve(
    valueArg("--config") || process.env.WECHAT_WINDOW_OBSERVER_CONFIG_FILE || path.join(runtimeDir, "wechat-window-observer-config.json"),
  );
  const fileConfig = readJsonIfExists(configFile);
  return {
    ...fileConfig,
    configFile,
    apiBase: cleanText(valueArg("--api-base") || process.env.WECHAT_WINDOW_OBSERVER_API_BASE || fileConfig.apiBase || defaultApiBase).replace(/\/$/, ""),
    inboxDir: path.resolve(valueArg("--inbox-dir") || process.env.WECHAT_WINDOW_SNAPSHOT_INBOX_DIR || fileConfig.inboxDir || defaultInboxDir),
    statusFile: path.resolve(
      valueArg("--status-file") || process.env.WECHAT_WINDOW_OBSERVER_STATUS_FILE || fileConfig.statusFile || defaultStatusFile,
    ),
    intervalMs: numberValue(valueArg("--interval-ms") || process.env.WECHAT_WINDOW_OBSERVER_INTERVAL_MS || fileConfig.intervalMs, 3000, 500, 60000),
    scan: hasArg("--scan") || String(process.env.WECHAT_WINDOW_OBSERVER_SCAN || fileConfig.scan || "").toLowerCase() === "true",
    dryRun: hasArg("--dry-run"),
    watch: hasArg("--watch"),
  };
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

function numberValue(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function snapshotConfidence({ online, account, conversation }) {
  let value = online ? 0.55 : 0.15;
  if (account) value += 0.2;
  if (conversation) value += 0.2;
  return Math.max(0, Math.min(0.99, Number(value.toFixed(2))));
}

function summarizeWindow(windowInfo = {}) {
  return {
    processName: cleanText(windowInfo.processName || ""),
    processId: positiveNumber(windowInfo.processId),
    hasTitle: Boolean(cleanText(windowInfo.title || windowInfo.windowTitle || "")),
  };
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  const text = cleanText(value);
  return text ? [text] : [];
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function safeFileSegment(value) {
  return cleanText(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

function hasArg(name) {
  return args.includes(name);
}

function valueArg(name) {
  const equals = args.find((item) => item.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] || "";
  return "";
}

function printRunSummary(result, config) {
  const snapshot = result.snapshot || {};
  const scanText = result.scanResult
    ? ` scanProcessed=${result.scanResult.processed?.length || 0} scanFailed=${result.scanResult.failed?.length || 0}`
    : "";
  console.log(
    `[window-observer] online=${Boolean(snapshot.isOnline)} account=${snapshot.wechatAccountId || "unbound"} confidence=${snapshot.confidence || 0} dryRun=${Boolean(config.dryRun)}${scanText}`,
  );
  if (result.snapshotFile) console.log(`[window-observer] wrote ${result.snapshotFile}`);
}

function printHelp() {
  console.log(`Usage: node tools/wechat-window-observer.js [--once|--watch] [--scan] [--dry-run]

Safe scope:
  Observes the current foreground window title/process and writes a snapshot JSON file.
  It does not click, type, send, login, multi-open, or bypass platform rules.

Environment:
  WECHAT_WINDOW_OBSERVER_CONFIG_FILE=.runtime/wechat-window-observer-config.json
  WECHAT_WINDOW_SNAPSHOT_INBOX_DIR=.runtime/wechat-window-snapshots
  WECHAT_WINDOW_OBSERVER_STATUS_FILE=.runtime/wechat-window-observer-status.json
  WECHAT_WINDOW_OBSERVER_SCAN=true

Config example:
{
  "accounts": [
    { "wechatAccountId": "wechat_demo_1", "accountDisplayName": "Service 1", "processNames": ["WeChat"], "titleIncludes": ["Wang"] }
  ],
  "conversations": [
    { "wechatAccountId": "wechat_demo_1", "conversationId": "conversation_demo_1", "customerId": "customer_demo_1", "titleIncludes": ["Wang"], "chatTitle": "Wang gift box" }
  ]
}`);
}

module.exports = {
  buildObserverStatus,
  buildSnapshotFromWindow,
  isWechatLikeWindow,
  matchAccount,
  matchConversation,
  numberValue,
  ruleMatchesWindow,
  runOnce,
  safeFileSegment,
  writeObserverStatus,
};
