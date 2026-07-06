"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

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

const ports = {
  web: Number(process.env.WEB_PORT || 3100),
  api: Number(process.env.API_PORT || 3200),
  mock: Number(process.env.MOCK_DESIGN_PLATFORM_PORT || 3700),
};

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
    BRIDGE_MODE: process.env.STABLE_WECHAT_BRIDGE_MODE || "noop",
    BRIDGE_ACK_TRANSPORT: process.env.BRIDGE_ACK_TRANSPORT || "file_scan",
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
  const out = openServiceLogForAppend(spec.name, "out");
  const err = openServiceLogForAppend(spec.name, "err");
  try {
    append(spec.name, `starting ${spec.command} ${spec.args.join(" ")}`);
    const child = spawn(spec.command, spec.args, {
      cwd: root,
      env: { ...serviceEnv(spec.port || ports.api), ...(spec.env || {}) },
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

function serviceEnv(port) {
  return {
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
  };
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
    return requestOk(`http://127.0.0.1:${spec.port}/`);
  }
  return false;
}

function requestJson(url) {
  try {
    const result = spawnSync("curl.exe", ["-s", "--max-time", "2", url], { encoding: "utf8", windowsHide: true });
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
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true });
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
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true });
  const parentPid = Number(String(result.stdout || "").trim());
  return Number.isFinite(parentPid) && parentPid > 0 ? parentPid : null;
}

function killPid(pid) {
  try { process.kill(Number(pid), "SIGTERM"); } catch {}
  const script = `Stop-Process -Id ${Number(pid)} -Force -ErrorAction SilentlyContinue`;
  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
}

function closeFd(value) {
  if (typeof value !== "number") return;
  try { fs.closeSync(value); } catch {}
}

function killStaleRuntimeProcesses() {
  // Disabled in stable mode: stale process cleanup is handled by stop-stable-desktop.cmd.
  // Keeping this as a no-op prevents the supervisor from killing its own service children.
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
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(designConfigFile, `${JSON.stringify({ designPlatformAdapter: "standard_v1", designPlatformBaseUrl: `http://127.0.0.1:${ports.mock}`, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
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
