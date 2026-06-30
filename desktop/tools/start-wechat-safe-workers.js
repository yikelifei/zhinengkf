"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(desktopRoot, ".runtime");
const logsDir = path.join(runtimeDir, "logs");
const pidFile = path.join(runtimeDir, "wechat-safe-workers.json");
const designPlatformConfigFile = path.join(runtimeDir, "design-platform-config.json");
const apiPort = numberEnv("API_PORT", 3200);
const apiBase = String(process.env.BRIDGE_API_BASE || process.env.WECHAT_WINDOW_OBSERVER_API_BASE || `http://127.0.0.1:${apiPort}/api`).replace(/\/$/, "");
const args = new Set(process.argv.slice(2));

const services = [
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
      BRIDGE_MODE: process.env.BRIDGE_MODE || "noop",
      BRIDGE_ACK_TRANSPORT: process.env.BRIDGE_ACK_TRANSPORT || "file_scan",
    },
  },
];

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
      console.log(`[ok] ${service.label} already running pid=${existingPid}`);
      continue;
    }

    const pid = startWorker(service);
    records[service.name] = {
      name: service.name,
      label: service.label,
      pid,
      command: [process.execPath, ...service.commandArgs].join(" "),
      status: "starting",
      startedAt: new Date().toISOString(),
    };
    writeRecords(records);
    console.log(`[start] ${service.label} pid=${pid}`);
  }

  console.log("[info] Bridge worker defaults to BRIDGE_MODE=noop, so it observes outbox tasks but does not mark WeChat messages sent.");
}

async function assertApiReadyForSafeWorkers() {
  const health = await getJson(`${apiBase}/health`, 2500);
  if (!health.ok) {
    throw new Error(`API is not reachable at ${apiBase}/health. Start the desktop stack first with: npm.cmd run ports:start:mock`);
  }

  const bridgeStatus = await getJson(`${apiBase}/wechat/bridge/status`, 2500);
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

  const integration = await getJson(`${apiBase}/integrations/design-platform/health`, 2500);
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

  const commandLine = `cmd.exe /d /c ${cmdQuote(wrapperPath)}`;
  const script =
    `$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(commandLine)}; CurrentDirectory = ${psQuote(desktopRoot)} }; ` +
    "if ($result.ReturnValue -ne 0) { throw \"Win32_Process.Create failed: $($result.ReturnValue)\" }; " +
    "$result.ProcessId";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: desktopRoot,
    env: windowsSafeEnv(process.env),
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status === 0) {
    const startedPid = Number(String(result.stdout || "").trim().split(/\s+/).pop());
    if (!Number.isFinite(startedPid)) throw new Error(`failed to read ${service.name} pid`);
    return startedPid;
  }

  const fallbackPid = startWindowsWorkerWithSpawn(service, wrapperPath, result);
  if (Number.isFinite(fallbackPid)) return fallbackPid;
  throw new Error(`failed to start ${service.name}: ${String(result.stderr || result.stdout || "unknown error").trim()}`);
}

function startWindowsWorkerWithSpawn(service, wrapperPath, failedResult) {
  const stdoutPath = path.join(logsDir, `${service.name}.out.log`);
  const stderrPath = path.join(logsDir, `${service.name}.err.log`);
  const stdout = fs.openSync(stdoutPath, "a");
  const stderr = fs.openSync(stderrPath, "a");
  fs.appendFileSync(
    path.join(logsDir, `${service.name}.launcher.log`),
    `[${new Date().toISOString()}] Win32_Process.Create failed; falling back to direct detached worker spawn. wrapper=${wrapperPath} error=${String(failedResult.stderr || failedResult.stdout || "").trim()}\n`,
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
  const startedPid = Number(child.pid);
  if (!Number.isFinite(startedPid)) throw new Error(`failed to read ${service.name} pid`);
  return startedPid;
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
    PATH: process.env.PATH || "",
    SystemRoot: process.env.SystemRoot || "C:\\WINDOWS",
    ComSpec: process.env.ComSpec || "C:\\WINDOWS\\System32\\cmd.exe",
    TEMP: process.env.TEMP || process.env.TMP || runtimeDir,
    TMP: process.env.TMP || process.env.TEMP || runtimeDir,
    ...service.env,
  });
}

function stopWorkers() {
  const records = readRecords();
  for (const service of services) {
    const record = records[service.name];
    const pid = Number(record?.pid);
    if (!isProcessRunning(pid)) {
      delete records[service.name];
      console.log(`[skip] ${service.label} is not running`);
      continue;
    }
    stopPid(pid);
    delete records[service.name];
    console.log(`[stop] ${service.label} pid=${pid}`);
  }
  writeRecords(records);
}

function printStatus() {
  const records = readRecords();
  for (const service of services) {
    const pid = Number(records[service.name]?.pid);
    const status = readJson(service.statusFile);
    const running = isProcessRunning(pid);
    const lastStatus = status.status || "no_status";
    console.log(`[${running ? "running" : "down"}] ${service.label} pid=${pid || "-"} lastStatus=${lastStatus}`);
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

function readRecords() {
  return readJson(pidFile);
}

function writeRecords(records) {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
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
