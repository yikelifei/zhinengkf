"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR ? path.resolve(process.env.DESKTOP_RUNTIME_DIR) : path.join(desktopRoot, ".runtime");
const logsDir = path.join(runtimeDir, "logs");
const pidFile = path.join(runtimeDir, "wechat-safe-workers.json");
const designPlatformConfigFile = path.join(runtimeDir, "design-platform-config.json");
const personalWechatBridgeStatusFile = path.join(runtimeDir, "personal-wechat-bridge-status.json");
const apiPort = numberEnv("API_PORT", 3200);
const apiBase = String(process.env.BRIDGE_API_BASE || process.env.WECHAT_WINDOW_OBSERVER_API_BASE || `http://127.0.0.1:${apiPort}/api`).replace(/\/$/, "");
const args = new Set(process.argv.slice(2));
const requestedBridgeMode = resolveBridgeMode();

const services = buildServices();

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(logsDir, { recursive: true });

  if (args.has("--status")) {
    printStatus();
    return;
  }
  if (args.has("--stop")) {
    stopWorkers();
    return;
  }

  if (!args.has("--no-api-check")) {
    await assertApiReadyForSafeWorkers();
  }

  const records = readRecords();
  for (const service of services) {
    const existingPid = Number(records[service.name]?.pid);
    if (isProcessRunning(existingPid)) {
      assertExistingWorkerMode(service);
      console.log(`[ok] ${service.label} already running pid=${existingPid}`);
      continue;
    }

    const pid = startWorker(service);
    records[service.name] = {
      name: service.name,
      label: service.label,
      pid,
      command: [process.execPath, ...service.commandArgs].join(" "),
      mode: service.env.BRIDGE_MODE || "",
      status: "starting",
      startedAt: new Date().toISOString(),
    };
    writeWorkerStartingStatus(service, pid);
    writeRecords(records);
    console.log(`[start] ${service.label} pid=${pid}`);
  }

  console.log(`[info] Bridge worker mode is BRIDGE_MODE=${requestedBridgeMode}; it will not mark WeChat messages sent without a real ack.`);
}

function resolveBridgeMode() {
  if (args.has("--dispatch")) return "dispatch";
  if (args.has("--noop")) return "noop";
  const modeArg = valueArg("--mode");
  if (modeArg === "dispatch" || modeArg === "noop") return modeArg;
  const envMode = String(process.env.BRIDGE_MODE || "").trim();
  if (envMode === "dispatch" || envMode === "noop") return envMode;
  return "noop";
}

function buildServices() {
  const list = [
    {
      name: "wechat-window-observer",
      label: "WeChat window observer",
      commandArgs: ["tools/wechat-window-observer.js", "--watch", "--scan"],
      statusFile: path.join(runtimeDir, "wechat-window-observer-status.json"),
      env: {
        WECHAT_WINDOW_OBSERVER_API_BASE: apiBase,
        WECHAT_WINDOW_OBSERVER_SCAN: "true",
      },
    },
    {
      name: "wechat-bridge-worker",
      label: "WeChat bridge worker",
      commandArgs: ["tools/wechat-bridge-worker.js", "--watch"],
      statusFile: path.join(runtimeDir, "wechat-bridge-worker-status.json"),
      env: {
        BRIDGE_API_BASE: apiBase,
        BRIDGE_MODE: requestedBridgeMode,
        BRIDGE_ACK_TRANSPORT: process.env.BRIDGE_ACK_TRANSPORT || "file_scan",
      },
    },
  ];

  if (
    args.has("--personal") ||
    process.env.PERSONAL_WECHAT_BRIDGE === "1" ||
    ((args.has("--status") || args.has("--stop")) && fs.existsSync(personalWechatBridgeStatusFile))
  ) {
    list.push({
      name: "personal-wechat-bridge",
      label: "Personal WeChat bridge",
      commandArgs: ["tools/personal-wechat-bridge.js", "--watch"],
      statusFile: personalWechatBridgeStatusFile,
      env: {
        PERSONAL_WECHAT_API_BASE: apiBase,
        WECHAT_BRIDGE_DISPATCH_DIR: process.env.WECHAT_BRIDGE_DISPATCH_DIR || path.join(runtimeDir, "wechat-dispatch"),
        WECHAT_BRIDGE_INBOX_DIR: process.env.WECHAT_BRIDGE_INBOX_DIR || path.join(runtimeDir, "wechat-inbox"),
        PERSONAL_WECHAT_SEND: process.env.PERSONAL_WECHAT_SEND || "0",
        PERSONAL_WECHAT_AUTO_ENTER: process.env.PERSONAL_WECHAT_AUTO_ENTER || "0",
        PERSONAL_WECHAT_ALLOW_UNVERIFIED_WINDOW: process.env.PERSONAL_WECHAT_ALLOW_UNVERIFIED_WINDOW || "0",
      },
    });
  }

  return list;
}

function assertExistingWorkerMode(service) {
  if (service.name !== "wechat-bridge-worker") return;
  const status = readJson(service.statusFile);
  const runningMode = String(status.mode || "").trim();
  if (!runningMode || runningMode === requestedBridgeMode) return;
  throw new Error(
    `WeChat bridge worker is already running with BRIDGE_MODE=${runningMode}; run npm.cmd run wechat:safe:stop before starting BRIDGE_MODE=${requestedBridgeMode}.`,
  );
}

async function assertApiReadyForSafeWorkers() {
  const health = await waitForStableJson(`${apiBase}/health`, 2500, "API health");
  if (!health.ok) {
    throw new Error(`API is not reachable at ${apiBase}/health. Start the desktop stack first with: npm.cmd run ports:start:mock`);
  }

  const bridgeStatus = await waitForStableJson(`${apiBase}/wechat/bridge/status`, 2500, "WeChat bridge status");
  if (!bridgeStatus.ok) {
    throw new Error(`WeChat bridge status is not reachable at ${apiBase}/wechat/bridge/status.`);
  }
  const bridgeAdapterName = String(bridgeStatus.data?.adapter?.name || "");
  if (bridgeAdapterName && bridgeAdapterName !== "windows_bridge") {
    throw new Error(`WeChat safe workers require windows_bridge adapter, current adapter is ${bridgeAdapterName}.`);
  }

  const runtimeConfig = readJson(designPlatformConfigFile);
  const expectedAdapter = String(runtimeConfig.designPlatformAdapter || "");
  const expectedBaseUrl = normalizeBaseUrl(runtimeConfig.designPlatformBaseUrl || "");
  if (!expectedAdapter && !expectedBaseUrl) return;

  const integration = await waitForStableJson(`${apiBase}/integrations/design-platform/health`, 2500, "design platform integration");
  if (!integration.ok) return;
  const actualAdapter = String(integration.data?.adapter || "");
  const actualBaseUrl = normalizeBaseUrl(integration.data?.baseUrl || "");
  if (expectedAdapter && actualAdapter && expectedAdapter !== actualAdapter) {
    throw new Error(`Design platform config mismatch: runtime adapter=${expectedAdapter}, API adapter=${actualAdapter}. Run npm.cmd run ports:stop, then npm.cmd run ports:start:mock.`);
  }
  if (expectedBaseUrl && actualBaseUrl && expectedBaseUrl !== actualBaseUrl) {
    throw new Error(`Design platform config mismatch: runtime base=${expectedBaseUrl}, API base=${actualBaseUrl}. Run npm.cmd run ports:stop, then npm.cmd run ports:start:mock.`);
  }
}

async function waitForStableJson(url, timeoutMs, label) {
  const deadline = Date.now() + numberEnv("WECHAT_SAFE_API_READY_TIMEOUT_MS", 30000);
  let last = { ok: false, errorMessage: "not checked" };
  let consecutiveOk = 0;
  while (Date.now() < deadline) {
    last = await getJson(url, timeoutMs);
    if (last.ok) {
      consecutiveOk += 1;
      if (consecutiveOk >= 2) return last;
      await sleep(500);
      continue;
    }
    consecutiveOk = 0;
    await sleep(1000);
  }
  return {
    ...last,
    ok: false,
    errorMessage: `${label} was not stable before timeout${last.errorMessage ? `: ${last.errorMessage}` : ""}`,
  };
}

function startWorker(service) {
  if (process.platform === "win32") {
    return startWindowsWorker(service);
  }

  const stdoutPath = path.join(logsDir, `${service.name}.out.log`);
  const stderrPath = path.join(logsDir, `${service.name}.err.log`);
  const stdout = fs.openSync(stdoutPath, "a");
  const stderr = fs.openSync(stderrPath, "a");
  const child = spawn(process.execPath, service.commandArgs, {
    cwd: desktopRoot,
    env: {
      ...process.env,
      ...service.env,
    },
    detached: true,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
  child.unref();
  if (!child.pid) throw new Error(`failed to start ${service.name}`);
  return child.pid;
}

function startWindowsWorker(service) {
  const stdoutPath = path.join(logsDir, `${service.name}.out.log`);
  const stderrPath = path.join(logsDir, `${service.name}.err.log`);
  const launcherLogPath = path.join(logsDir, `${service.name}.launcher.log`);
  const wrapperPath = path.join(runtimeDir, `run-${service.name}.cmd`);
  fs.writeFileSync(wrapperPath, buildWindowsWorkerWrapper(service, stdoutPath, stderrPath, launcherLogPath), "utf8");
  const stdout = fs.openSync(stdoutPath, "a");
  const stderr = fs.openSync(stderrPath, "a");
  fs.appendFileSync(
    launcherLogPath,
    `[${new Date().toISOString()}] launching ${service.name} via direct detached node process; wrapper kept at ${wrapperPath}\n`,
    "utf8",
  );
  const child = spawn(process.execPath, service.commandArgs, {
    cwd: desktopRoot,
    env: windowsWorkerEnv(service),
    detached: true,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
  child.unref();
  closeFd(stdout);
  closeFd(stderr);
  const startedPid = Number(child.pid);
  if (!Number.isFinite(startedPid)) throw new Error(`failed to read ${service.name} pid`);
  return startedPid;
}

function closeFd(value) {
  if (typeof value !== "number") return;
  try {
    fs.closeSync(value);
  } catch {
    // Log descriptors are best-effort after the child has inherited them.
  }
}

function buildWindowsWorkerWrapper(service, stdoutPath, stderrPath, launcherLogPath) {
  const command = [cmdQuote(process.execPath), ...service.commandArgs.map(cmdQuote)].join(" ");
  const runLine = `${command} >> ${cmdQuote(stdoutPath)} 2>> ${cmdQuote(stderrPath)}`;
  const lines = [
    "@echo off",
    "setlocal",
    `cd /d ${cmdQuote(desktopRoot)}`,
    ...Object.entries(windowsWorkerEnv(service)).map(([key, value]) => cmdSetEnv(key, value)),
    `echo [%date% %time%] launching ${service.name} >> ${cmdQuote(launcherLogPath)}`,
    runLine,
  ];
  return `${lines.join("\r\n")}\r\n`;
}

function windowsWorkerEnv(service) {
  return windowsSafeEnv({
    ...process.env,
    PATH: process.env.PATH || process.env.Path || "",
    SystemRoot: process.env.SystemRoot || process.env.WINDIR || "C:\\WINDOWS",
    windir: process.env.windir || process.env.SystemRoot || process.env.WINDIR || "C:\\WINDOWS",
    ComSpec: process.env.ComSpec || "C:\\WINDOWS\\System32\\cmd.exe",
    TEMP: process.env.TEMP || process.env.TMP || runtimeDir,
    TMP: process.env.TMP || process.env.TEMP || runtimeDir,
    ...service.env,
  });
}

function stopWorkers() {
  const records = readRecords();
  const failures = [];
  for (const service of services) {
    const record = records[service.name];
    const pid = Number(record?.pid);
    if (!isProcessRunning(pid)) {
      delete records[service.name];
      writeWorkerStoppedStatus(service, pid || Number(readJson(service.statusFile).pid) || null);
      console.log(`[skip] ${service.label} is not running`);
      continue;
    }
    try {
      stopPid(pid);
      delete records[service.name];
      writeWorkerStoppedStatus(service, pid);
      console.log(`[stop] ${service.label} pid=${pid}`);
    } catch (error) {
      failures.push(`${service.label} pid=${pid}: ${error.message}`);
      console.log(`[warn] ${service.label} pid=${pid} stop failed: ${singleLine(error.message)}`);
    }
  }
  writeRecords(records);
  if (failures.length) {
    throw new Error(`Some WeChat safe workers could not be stopped: ${failures.map(singleLine).join("; ")}`);
  }
}

function writeWorkerStoppedStatus(service, pid) {
  if (!service.statusFile) return;
  try {
    const previous = readJson(service.statusFile);
    const now = new Date().toISOString();
    const status = {
      ok: false,
      status: "stopped",
      pid: pid || previous.pid || null,
      mode: previous.mode || service.env.BRIDGE_MODE || "",
      stoppedAt: now,
      updatedAt: now,
      message: `${service.label} was stopped by wechat:safe:stop.`,
    };
    fs.mkdirSync(path.dirname(service.statusFile), { recursive: true });
    fs.writeFileSync(service.statusFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  } catch (error) {
    console.log(`[warn] could not mark ${service.label} stopped: ${singleLine(error?.message || String(error))}`);
  }
}

function printStatus() {
  const records = readRecords();
  for (const service of services) {
    const pid = Number(records[service.name]?.pid);
    const status = readJson(service.statusFile);
    const running = isProcessRunning(pid);
    const lastStatus = status.status || "no_status";
    const statusPid = Number(status.pid);
    const ok = Object.hasOwn(status, "ok") ? ` ok=${status.ok === true}` : "";
    const mode = status.mode || records[service.name]?.mode ? ` mode=${status.mode || records[service.name]?.mode}` : "";
    const failedCount = Number(status.result?.failedCount);
    const failed = Number.isFinite(failedCount) && failedCount > 0 ? ` failed=${failedCount}` : "";
    const stale = running && Number.isFinite(statusPid) && statusPid > 0 && statusPid !== pid
      ? ` staleStatusPid=${statusPid}`
      : "";
    const message = singleLine(status.errorMessage || status.message || "");
    const detail = message ? ` message=${message.slice(0, 160)}` : "";
    console.log(`[${running ? "running" : "down"}] ${service.label} pid=${pid || "-"} lastStatus=${lastStatus}${ok}${mode}${failed}${stale}${detail}`);
  }
}

function stopPid(pid) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(String(result.stderr || result.stdout || `failed to stop pid ${pid}`).trim());
    }
    return;
  }
  process.kill(pid, "SIGTERM");
}

function isProcessRunning(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id`], {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0 && String(result.stdout || "").trim() === String(pid);
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        let data = null;
        try {
          data = body ? JSON.parse(body) : null;
        } catch {
          data = null;
        }
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, statusCode: response.statusCode, data });
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });
    request.on("error", (error) => {
      resolve({ ok: false, errorMessage: error.message });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRecords() {
  return readJson(pidFile);
}

function writeRecords(records) {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function writeWorkerStartingStatus(service, pid) {
  if (!service.statusFile) return;
  const status = {
    ok: false,
    status: "starting",
    pid,
    startedAt: new Date().toISOString(),
    message: `${service.label} started and is waiting for the first successful cycle.`,
  };
  fs.mkdirSync(path.dirname(service.statusFile), { recursive: true });
  fs.writeFileSync(service.statusFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

function singleLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function valueArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return String(process.argv[index + 1] || "").trim();
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function windowsSafeEnv(env) {
  if (process.platform !== "win32") return env;
  const safe = {};
  const seen = new Set();
  for (const [key, value] of Object.entries(env)) {
    const normalized = key.toUpperCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    safe[key] = value;
  }
  return safe;
}

function cmdSetEnv(key, value) {
  return `set "${String(key).replace(/"/g, "")}=${String(value ?? "").replace(/\r?\n/g, " ").replace(/"/g, '""')}"`;
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
