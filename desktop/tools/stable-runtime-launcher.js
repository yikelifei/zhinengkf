"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const {
  ensureInternalApiToken,
  internalApiServiceEnv,
} = require("./internal-api-session");
const {
  createWechatWindowObserverProofSession,
  wechatWindowObserverServiceEnv,
} = require("./wechat-window-observer-session");
const {
  createWechatBridgeServiceSession,
  wechatBridgeServiceEnv,
} = require("./wechat-bridge-service-session");
const {
  createDesktopWebSession,
  desktopWebSessionServiceEnv,
  resolveDesktopWebSessionFile,
} = require("./desktop-web-session");
const { commandLineReferencesNestedLegacyRuntime } = require("./stable-runtime-process-classifier");
const { renderWindowsWrapperEnvironment, selectServiceEnvironment } = require("../packages/runtime/service-environment");
const { atomicWritePrivateJson } = require("./private-runtime-file");

const root = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR ? path.resolve(process.env.DESKTOP_RUNTIME_DIR) : path.join(root, ".runtime-stable");
const logsDir = path.join(runtimeDir, "logs");
const heartbeatFile = path.join(runtimeDir, "keep-alive.json");
const lockFile = path.join(runtimeDir, "stable-runtime-launcher.pid");
const stopRequestFile = path.join(runtimeDir, "stable-runtime-stop-request");
const localStoreFile = path.join(runtimeDir, "local-store.json");
const storageRoot = path.join(runtimeDir, "storage");
const designConfigFile = path.join(runtimeDir, "design-platform-config.json");
const webRuntimeServerPath = path.join(runtimeDir, "web-standalone-server.js");
const webStandaloneServerPath = path.join(root, "apps", "web", ".next", "standalone", "apps", "web", "server.js");
const webNextDir = path.join(root, "apps", "web", ".next");
const nextCliPath = path.join(root, "node_modules", "next", "dist", "bin", "next");
const internalApiToken = ensureInternalApiToken();
const desktopWebSession = {
  sessionFile: resolveDesktopWebSessionFile(runtimeDir),
};
const observerProofSession = {
  tokenFile: path.resolve(process.env.WECHAT_WINDOW_OBSERVER_PROOF_FILE || path.join(runtimeDir, "wechat-window-observer-proof.key")),
};
const bridgeServiceSession = {
  tokenFile: path.resolve(process.env.WECHAT_BRIDGE_SERVICE_TOKEN_FILE || path.join(runtimeDir, "wechat-bridge-service.key")),
};

const ports = {
  web: Number(process.env.WEB_PORT || 3100),
  api: Number(process.env.API_PORT || 3200),
  mock: Number(process.env.MOCK_DESIGN_PLATFORM_PORT || 3700),
};
const windowsProcessQueryTimeoutMs = positiveNumber(process.env.WINDOWS_PROCESS_QUERY_TIMEOUT_MS, 1000);

const specs = [
  webServiceSpec(),
  { name: "design-platform-mock", command: process.execPath, args: [path.join(root, "tools", "mock-design-platform.js")], port: ports.mock, expected: normalize(path.join(root, "tools", "mock-design-platform.js")) },
  { name: "api", command: process.execPath, args: [path.join(root, "dist", "apps", "api", "main.js")], port: ports.api, expected: normalize(path.join(root, "dist", "apps", "api", "main.js")) },
  processServiceSpec("wechat-window-observer", [path.join(root, "tools", "wechat-window-observer.js"), "--watch", "--scan"], {
    WECHAT_WINDOW_OBSERVER_API_BASE: `http://127.0.0.1:${ports.api}/api`,
    WECHAT_WINDOW_OBSERVER_SCAN: "true",
  }),
  processServiceSpec("wechat-bridge-worker", [path.join(root, "tools", "wechat-bridge-worker.js"), "--watch"], {
    BRIDGE_API_BASE: `http://127.0.0.1:${ports.api}/api`,
    BRIDGE_MODE: process.env.STABLE_WECHAT_BRIDGE_MODE || "dispatch",
    BRIDGE_ACK_TRANSPORT: process.env.BRIDGE_ACK_TRANSPORT || "file_scan",
  }),
  processServiceSpec("personal-wechat-bridge", [path.join(root, "tools", "personal-wechat-bridge.js"), "--watch"], {
    PERSONAL_WECHAT_API_BASE: `http://127.0.0.1:${ports.api}/api`,
    WECHAT_BRIDGE_DISPATCH_DIR: path.join(runtimeDir, "wechat-dispatch"),
    WECHAT_BRIDGE_INBOX_DIR: path.join(runtimeDir, "wechat-inbox"),
    WECHAT_BRIDGE_LOCK_DIR: path.join(runtimeDir, "wechat-bridge-locks"),
    PERSONAL_WECHAT_BLOCKED_DIR: path.join(runtimeDir, "personal-wechat-blocked"),
    PERSONAL_WECHAT_BRIDGE_STATUS_FILE: path.join(runtimeDir, "personal-wechat-bridge-status.json"),
    PERSONAL_WECHAT_ACCOUNTS_CONFIG_FILE: path.join(runtimeDir, "personal-wechat-accounts.json"),
    PERSONAL_WECHAT_DRIVER: process.env.PERSONAL_WECHAT_DRIVER || "wechatauto_rpa",
    PERSONAL_WECHAT_RPA_CONFIG_FILE: path.join(runtimeDir, "personal-wechat-rpa.json"),
    PERSONAL_WECHAT_SEND: process.env.STABLE_PERSONAL_WECHAT_SEND || process.env.PERSONAL_WECHAT_SEND || "0",
  }),
];

const children = new Map();
const runtimeKeepAlive = setInterval(() => undefined, 60000);
runtimeKeepAlive.ref();
fs.mkdirSync(logsDir, { recursive: true });
installProcessHandlers();
if (fs.existsSync(stopRequestFile)) {
  append("stable-runtime", `stop request exists; exiting pid=${process.pid}`);
  process.exit(0);
}
acquireSingleInstanceLock();
Object.assign(desktopWebSession, createDesktopWebSession(runtimeDir, { sessionFile: desktopWebSession.sessionFile }));
Object.assign(observerProofSession, createWechatWindowObserverProofSession(runtimeDir, { tokenFile: observerProofSession.tokenFile }));
Object.assign(bridgeServiceSession, createWechatBridgeServiceSession(runtimeDir, { tokenFile: bridgeServiceSession.tokenFile }));
if (specs[0].args[0] === webRuntimeServerPath) {
  writeWebRuntimeServer();
} else {
  append("web", "web standalone build incomplete; using Next dev server fallback");
}
writeDesignConfig();
writeHeartbeat();
setInterval(writeHeartbeat, 5000);

killStaleRuntimeProcesses();
for (const spec of specs) ensureService(spec);
setInterval(() => {
  if (fs.existsSync(stopRequestFile)) {
    append("stable-runtime", `stop request received; stopping pid=${process.pid}`);
    for (const child of children.values()) {
      try { child.kill(); } catch {}
    }
    process.exit(0);
  }
  killStaleRuntimeProcesses();
  for (const spec of specs) ensureService(spec);
}, 5000);

console.log(`[stable-runtime] running runtime=${runtimeDir}`);
append("stable-runtime", `running pid=${process.pid} runtime=${runtimeDir}`);

function installProcessHandlers() {
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
    process.once(signal, () => {
      append("stable-runtime", `received ${signal}; stopping children`);
      for (const child of children.values()) {
        try { child.kill(); } catch {}
      }
      process.exit(0);
    });
  }

  process.on("uncaughtException", (error) => append("stable-runtime", `uncaughtException ${error.stack || error.message || error}`));
  process.on("unhandledRejection", (error) => append("stable-runtime", `unhandledRejection ${error?.stack || error?.message || error}`));
  process.on("beforeExit", (code) => append("stable-runtime", `beforeExit code=${code}`));
  process.on("exit", (code) => append("stable-runtime", `exit code=${code}`));
}

function ensureService(spec) {
  if (spec.type === "process") {
    ensureProcessService(spec);
    return;
  }
  const owners = getPortOwnerPids(spec.port);
  const existing = children.get(spec.name);
  if (existing && isPidAlive(existing.pid) && process.platform === "win32" && spec.port) return;
  if (existing && owners.includes(existing.pid)) return;
  const wrongOwners = owners.filter((pid) => {
    if (existing && pid === existing.pid) return false;
    if (portHealthMatches(spec)) {
      append(spec.name, `port ${spec.port} owner ${pid} accepted by health check`);
      return false;
    }
    const match = ownerMatches(pid, spec.expected);
    if (match === true) return false;
    if (match === "unknown" && portHealthMatches(spec)) {
      append(spec.name, `port ${spec.port} owner ${pid} command unavailable; accepted by health check`);
      return false;
    }
    return true;
  });
  if (wrongOwners.length) {
    append(spec.name, `port ${spec.port} owned by wrong pid(s) ${wrongOwners.join(",")}; killing`);
    for (const pid of wrongOwners) killPid(pid);
    return;
  }
  if (!existing && owners.length && portHealthMatches(spec)) {
    append(spec.name, `port ${spec.port} already owned by matching healthy pid(s) ${owners.join(",")}; adopting externally managed service`);
    return;
  }
  const unmanagedOwners = owners.filter((pid) => {
    if (portHealthMatches(spec)) return false;
    if (!existing) return true;
    if (pid === existing.pid) return false;
    return !(ownerMatches(pid, spec.expected) === true && isDescendantPid(pid, existing.pid));
  });
  if (unmanagedOwners.length) {
    append(spec.name, `port ${spec.port} owned by unmanaged matching pid(s) ${unmanagedOwners.join(",")}; killing for runtime isolation`);
    for (const pid of unmanagedOwners) killPid(pid);
    return;
  }
  if (existing && isPidAlive(existing.pid)) return;
  startService(spec);
}

function ensureProcessService(spec) {
  const existing = children.get(spec.name);
  if (existing && isPidAlive(existing.pid)) return;
  startService(spec);
}

function startService(spec) {
  if (process.platform === "win32" && spec.port) {
    startWindowsWrappedPortService(spec);
    return;
  }
  const out = openServiceLogForAppend(spec.name, "out");
  const err = openServiceLogForAppend(spec.name, "err");
  try {
    append(spec.name, `starting ${spec.command} ${spec.args.join(" ")}`);
    const child = spawn(spec.command, spec.args, {
      cwd: root,
      env: serviceEnv(spec.port || ports.api, spec.name, spec.env),
      detached: process.platform === "win32",
      stdio: ["ignore", out, err],
      windowsHide: true,
    });
    children.set(spec.name, child);
    append(spec.name, `pid=${child.pid}`);
    if (process.platform === "win32") child.unref();
    child.once("exit", (code, signal) => {
      const current = children.get(spec.name);
      if (current === child) children.delete(spec.name);
      append(spec.name, `exited code=${code ?? ""} signal=${signal ?? ""}`);
    });
  } catch (error) {
    append(spec.name, `start failed: ${error?.stack || error?.message || error}`);
    closeFd(out);
    closeFd(err);
  }
}

function startWindowsWrappedPortService(spec) {
  const wrapperPath = path.join(runtimeDir, `run-${spec.name}.cmd`);
  fs.writeFileSync(wrapperPath, buildWindowsPortServiceWrapper(spec), "utf8");
  try {
    append(spec.name, `starting wrapper ${wrapperPath}`);
    const child = spawn("cmd.exe", ["/d", "/c", wrapperPath], {
      cwd: root,
      env: serviceEnv(spec.port || ports.api, spec.name, spec.env),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    children.set(spec.name, child);
    append(spec.name, `wrapper pid=${child.pid}`);
    child.unref();
    child.once("exit", (code, signal) => {
      const current = children.get(spec.name);
      if (current === child) children.delete(spec.name);
      append(spec.name, `wrapper exited code=${code ?? ""} signal=${signal ?? ""}`);
    });
  } catch (error) {
    append(spec.name, `wrapper start failed: ${error?.stack || error?.message || error}`);
  }
}

function buildWindowsPortServiceWrapper(spec) {
  return [
    "@echo off",
    "setlocal",
    `cd /d ${cmdQuote(root)}`,
    ...renderWindowsWrapperEnvironment(spec.name, serviceEnv(spec.port, spec.name, spec.env)),
    ":restart",
    `if exist ${cmdQuote(stopRequestFile)} exit /b 0`,
    `${cmdQuote(process.execPath)} ${cmdQuote(path.join(root, "tools", "check-loopback-port.js"))} ${spec.port}`,
    "if not errorlevel 1 (",
    "  timeout /t 2 /nobreak >nul",
    "  goto restart",
    ")",
    `echo [%date% %time%] launching ${spec.name} >> ${cmdQuote(path.join(logsDir, `${spec.name}.launcher.log`))}`,
    `${cmdQuote(spec.command)} ${spec.args.map(cmdQuote).join(" ")} >> ${cmdQuote(path.join(logsDir, `${spec.name}.out.log`))} 2>> ${cmdQuote(path.join(logsDir, `${spec.name}.err.log`))}`,
    "set SERVICE_EXIT_CODE=%ERRORLEVEL%",
    `echo [%date% %time%] ${spec.name} exited with %SERVICE_EXIT_CODE% >> ${cmdQuote(path.join(logsDir, `${spec.name}.launcher.log`))}`,
    `if exist ${cmdQuote(stopRequestFile)} exit /b %SERVICE_EXIT_CODE%`,
    "timeout /t 2 /nobreak >nul",
    "goto restart",
    "",
  ].join("\r\n");
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function processServiceSpec(name, args, env = {}) {
  return { name, type: "process", command: process.execPath, args, expected: normalize(args[0]), env };
}

function openServiceLogForAppend(name, streamName) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    return fs.openSync(path.join(logsDir, `${name}.${streamName}.log`), "a");
  } catch (error) {
    append("stable-runtime", `${name} ${streamName} log unavailable: ${error?.message || error}`);
    return "ignore";
  }
}

function webServiceSpec() {
  if (!webStandaloneBuildReady()) {
    return {
      name: "web",
      command: process.execPath,
      args: [nextCliPath, "dev", "apps/web", "-H", "127.0.0.1", "-p", String(ports.web), "--webpack"],
      port: ports.web,
      expected: [normalize(nextCliPath), "next/dist/server/lib/start-server.js"],
    };
  }
  return { name: "web", command: process.execPath, args: [webRuntimeServerPath], port: ports.web, expected: normalize(webRuntimeServerPath) };
}

function webStandaloneBuildReady() {
  return [
    webStandaloneServerPath,
    path.join(webNextDir, "BUILD_ID"),
    path.join(webNextDir, "required-server-files.json"),
    path.join(webNextDir, "routes-manifest.json"),
  ].every((filePath) => fs.existsSync(filePath));
}

function serviceEnv(port, serviceName, overrides = {}) {
  const internalEnv = internalApiServiceEnv({
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    FORCE_WEB_CLEAN_BUILD: "0",
    USE_LOCAL_STORE: "true",
    DESKTOP_RUNTIME_DIR: runtimeDir,
    LOCAL_STORE_FILE: localStoreFile,
    LOCAL_STORAGE_ROOT: storageRoot,
    LOW_VALUE_AUTOMATION_ENABLED: "true",
    LOW_VALUE_AUTOMATION_RUN_ON_START: "true",
    PORT: String(port),
    WEB_PORT: String(ports.web),
    API_PORT: String(ports.api),
    MOCK_DESIGN_PLATFORM_PORT: String(ports.mock),
    DESIGN_PLATFORM_RUNTIME_CONFIG: designConfigFile,
    DESIGN_PLATFORM_ADAPTER: "standard_v1",
    DESIGN_PLATFORM_BASE_URL: `http://127.0.0.1:${ports.mock}`,
    WECHAT_BRIDGE_OUTBOX_DIR: path.join(runtimeDir, "wechat-outbox"),
    WECHAT_BRIDGE_INBOX_DIR: path.join(runtimeDir, "wechat-inbox"),
    WECHAT_BRIDGE_DISPATCH_DIR: path.join(runtimeDir, "wechat-dispatch"),
    WECHAT_BRIDGE_LOCK_DIR: path.join(runtimeDir, "wechat-bridge-locks"),
    WECHAT_BRIDGE_WORKER_STATUS_FILE: path.join(runtimeDir, "wechat-bridge-worker-status.json"),
    WECHAT_WINDOW_SNAPSHOT_INBOX_DIR: path.join(runtimeDir, "wechat-window-snapshots"),
    WECHAT_WINDOW_OBSERVER_STATUS_FILE: path.join(runtimeDir, "wechat-window-observer-status.json"),
  }, serviceName, internalApiToken);
  const desktopSessionEnv = desktopWebSessionServiceEnv(internalEnv, serviceName, desktopWebSession.proof);
  const observerEnv = wechatWindowObserverServiceEnv(desktopSessionEnv, serviceName, observerProofSession.tokenFile);
  return selectServiceEnvironment(
    serviceName,
    wechatBridgeServiceEnv(observerEnv, serviceName, bridgeServiceSession.tokenFile),
    overrides,
  );
}

function acquireSingleInstanceLock() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  try {
    const existingPid = Number(fs.readFileSync(lockFile, "utf8").trim());
    if (Number.isFinite(existingPid) && existingPid > 0) {
      if (!isPidAlive(existingPid)) {
        fs.rmSync(lockFile, { force: true });
        append("stable-runtime", `removed stale launcher pid file pid=${existingPid}`);
      } else if (isCurrentStableRuntimeLauncher(existingPid)) {
        console.log(`[stable-runtime] existing launcher pid=${existingPid}; exiting`);
        process.exit(0);
      } else {
        fs.rmSync(lockFile, { force: true });
        append("stable-runtime", `removed stale launcher pid file with stale heartbeat pid=${existingPid}`);
      }
    }
  } catch {}
  fs.writeFileSync(lockFile, `${process.pid}\n`, "utf8");
  process.on("exit", () => {
    try {
      if (fs.readFileSync(lockFile, "utf8").trim() === String(process.pid)) fs.rmSync(lockFile, { force: true });
    } catch {}
  });
}

function isCurrentStableRuntimeLauncher(pid) {
  if (!isStableRuntimeLauncherPid(pid)) return false;
  const heartbeat = readJsonFile(heartbeatFile);
  const heartbeatPid = Number(heartbeat?.pid);
  const heartbeatUpdatedAt = Date.parse(String(heartbeat?.updatedAt || ""));
  return heartbeatPid === Number(pid) && Number.isFinite(heartbeatUpdatedAt) && Date.now() - heartbeatUpdatedAt < 30000;
}


function isStableRuntimeLauncherPid(pid) {
  const commandLine = normalize(commandLineForPid(pid));
  return Boolean(commandLine && commandLine.includes("stable-runtime-launcher.js"));
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function getPortOwnerPids(port) {
  const result = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return [];
  const pids = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    if (!parts[1].endsWith(`:${port}`)) continue;
    if (!/LISTENING/i.test(parts[3])) continue;
    const pid = Number(parts[4]);
    if (Number.isFinite(pid) && !pids.includes(pid)) pids.push(pid);
  }
  return pids;
}

function ownerMatches(pid, expected) {
  const commandLine = normalize(commandLineForPid(pid));
  if (!commandLine) return "unknown";
  const expectedMarkers = Array.isArray(expected) ? expected : [expected];
  return expectedMarkers.some((marker) => commandLine.includes(marker));
}

function portHealthMatches(spec) {
  if (spec.name === "api") {
    const json = requestJson(`http://127.0.0.1:${spec.port}/api/health`);
    return normalize(json?.localStore?.path) === normalize(localStoreFile);
  }
  if (spec.name === "design-platform-mock") {
    const json = requestJson(`http://127.0.0.1:${spec.port}/v1/health`);
    return json?.ok === true && json?.service === "mock-design-platform";
  }
  if (spec.name === "web") {
    const json = requestJson(`http://127.0.0.1:${spec.port}/api/health`, [
      `Cookie: smart_kefu_desktop_session=${desktopWebSession.proof}`,
    ]);
    return normalize(json?.localStore?.path) === normalize(localStoreFile);
  }
  return false;
}

function requestJson(url, headers = []) {
  try {
    const headerArgs = headers.flatMap((header) => ["-H", header]);
    const result = spawnSync("curl.exe", ["-s", "--max-time", "2", ...headerArgs, url], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0 || !result.stdout) return null;
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function requestOk(url) {
  const result = spawnSync("curl.exe", ["-s", "-o", "NUL", "-w", "%{http_code}", "--max-time", "2", url], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 && Number(result.stdout) >= 200 && Number(result.stdout) < 500;
}

function commandLineForPid(pid) {
  const script = `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" | Select-Object -ExpandProperty CommandLine`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: windowsProcessQueryTimeoutMs,
  });
  return result.stdout || "";
}

function isDescendantPid(pid, ancestorPid) {
  const ancestor = Number(ancestorPid);
  let current = Number(pid);
  const seen = new Set();
  for (let depth = 0; depth < 12; depth += 1) {
    const parent = parentPidForPid(current);
    if (!parent || seen.has(parent)) return false;
    if (parent === ancestor) return true;
    seen.add(parent);
    current = parent;
  }
  return false;
}

function parentPidForPid(pid) {
  const script = `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" | Select-Object -ExpandProperty ParentProcessId`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: windowsProcessQueryTimeoutMs,
  });
  const parentPid = Number(String(result.stdout || "").trim());
  return Number.isFinite(parentPid) && parentPid > 0 ? parentPid : null;
}

function killPid(pid) {
  try { process.kill(Number(pid), "SIGTERM"); } catch {}
  const script = `Stop-Process -Id ${Number(pid)} -Force -ErrorAction SilentlyContinue`;
  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
    timeout: windowsProcessQueryTimeoutMs,
  });
}

function closeFd(value) {
  if (typeof value !== "number") return;
  try { fs.closeSync(value); } catch {}
}

function killStaleRuntimeProcesses() {
  const pids = findLegacyRuntimeProcesses();
  if (!pids.length) return;
  append("stable-runtime", `killing legacy runtime process pid(s) ${pids.join(",")}`);
  for (const pid of pids) killPid(pid);
}

function findLegacyRuntimeProcesses() {
  if (process.platform !== "win32") return [];
  const script = [
    "$items = Get-CimInstance Win32_Process",
    "$items | Where-Object { $_.Name -in @('node.exe','cmd.exe','powershell.exe') -and $_.CommandLine } | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: windowsProcessQueryTimeoutMs,
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  let items = [];
  try {
    const parsed = JSON.parse(result.stdout);
    items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return [];
  }
  const normalizedRoot = normalize(root);
  const stableMarker = normalize(`${path.sep}.runtime-stable${path.sep}`);
  const legacyRuntimeMarker = normalize(`${path.sep}.runtime${path.sep}`);
  const byParent = new Map();
  const seeds = [];
  for (const item of items) {
    const pid = Number(item.ProcessId);
    const parentPid = Number(item.ParentProcessId);
    const commandLine = normalize(item.CommandLine || "");
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue;
    if (Number.isFinite(parentPid) && parentPid > 0) {
      if (!byParent.has(parentPid)) byParent.set(parentPid, []);
      byParent.get(parentPid).push(pid);
    }
    if (!commandLine.includes(normalizedRoot)) continue;
    if (commandLine.includes(stableMarker)) continue;
    if (
      commandLineReferencesNestedLegacyRuntime(commandLine, normalizedRoot, legacyRuntimeMarker) ||
      commandLine.includes("tools/start-dev-ports.js") ||
      commandLine.includes("tools\\start-dev-ports.js") ||
      commandLine.includes("ports:keepalive:mock") ||
      commandLine.includes("ports:keepalive:real") ||
      commandLine.includes("desktop-service-supervisor.js")
    ) {
      seeds.push(pid);
    }
  }
  const resultPids = new Set();
  const visit = (pid) => {
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid || resultPids.has(pid)) return;
    resultPids.add(pid);
    for (const childPid of byParent.get(pid) || []) visit(childPid);
  };
  for (const pid of seeds) visit(pid);
  return [...resultPids];
}

function isPidAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function writeHeartbeat() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(heartbeatFile, `${JSON.stringify({ pid: process.pid, mode: "mock", args: ["stable-runtime-launcher"], updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

function writeDesignConfig() {
  atomicWritePrivateJson(designConfigFile, {
    designPlatformAdapter: "standard_v1",
    designPlatformBaseUrl: `http://127.0.0.1:${ports.mock}`,
    updatedAt: new Date().toISOString(),
  });
}

function writeWebRuntimeServer() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const requiredServerFilesPath = path.join(root, "apps", "web", ".next", "required-server-files.json");
  fs.writeFileSync(
    webRuntimeServerPath,
    `"use strict";\n` +
      `const path = require("node:path");\n` +
      `const root = ${JSON.stringify(root)};\n` +
      `const requiredServerFiles = require(${JSON.stringify(requiredServerFilesPath)});\n` +
      `const dir = path.join(root, "apps", "web");\n` +
      `const currentPort = parseInt(process.env.PORT, 10) || 3100;\n` +
      `const hostname = process.env.HOSTNAME || "127.0.0.1";\n` +
      `let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);\n` +
      `const keepAlive = setInterval(() => undefined, 60000);\n` +
      `keepAlive.ref();\n` +
      `process.env.NODE_ENV = "production";\n` +
      `process.chdir(dir);\n` +
      `const nextConfig = { ...requiredServerFiles.config, distDir: ".next" };\n` +
      `process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);\n` +
      `require("next");\n` +
      `const { startServer } = require("next/dist/server/lib/start-server");\n` +
      `if (Number.isNaN(keepAliveTimeout) || !Number.isFinite(keepAliveTimeout) || keepAliveTimeout < 0) keepAliveTimeout = undefined;\n` +
      `startServer({ dir, isDev: false, config: nextConfig, hostname, port: currentPort, allowRetry: false, keepAliveTimeout })\n` +
      `  .catch((error) => { console.error(error); clearInterval(keepAlive); process.exit(1); });\n`,
    "utf8",
  );
}

function append(name, message) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, `${name}.launcher.log`), `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {}
}

function normalize(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
