"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR ? path.resolve(process.env.DESKTOP_RUNTIME_DIR) : path.join(root, ".runtime-stable");
const logsDir = path.join(runtimeDir, "logs");
const heartbeatFile = path.join(runtimeDir, "keep-alive.json");
const lockFile = path.join(runtimeDir, "stable-runtime-launcher.pid");
const localStoreFile = path.join(runtimeDir, "local-store.json");
const storageRoot = path.join(runtimeDir, "storage");
const designConfigFile = path.join(runtimeDir, "design-platform-config.json");
const webRuntimeServerPath = path.join(runtimeDir, "web-standalone-server.js");

const ports = {
  web: Number(process.env.WEB_PORT || 3100),
  api: Number(process.env.API_PORT || 3200),
  mock: Number(process.env.MOCK_DESIGN_PLATFORM_PORT || 3700),
};

const specs = [
  { name: "web", command: process.execPath, args: [webRuntimeServerPath], port: ports.web, expected: normalize(webRuntimeServerPath) },
  { name: "design-platform-mock", command: process.execPath, args: [path.join(root, "tools", "mock-design-platform.js")], port: ports.mock, expected: normalize(path.join(root, "tools", "mock-design-platform.js")) },
  { name: "api", command: process.execPath, args: [path.join(root, "dist", "apps", "api", "main.js")], port: ports.api, expected: normalize(path.join(root, "dist", "apps", "api", "main.js")) },
];

const children = new Map();
fs.mkdirSync(logsDir, { recursive: true });
acquireSingleInstanceLock();
writeWebRuntimeServer();
writeDesignConfig();
writeHeartbeat();
setInterval(writeHeartbeat, 5000);

for (const spec of specs) ensureService(spec);
setInterval(() => {
  for (const spec of specs) ensureService(spec);
}, 5000);

console.log(`[stable-runtime] running runtime=${runtimeDir}`);
append("stable-runtime", `running pid=${process.pid} runtime=${runtimeDir}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
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
process.on("exit", (code) => append("stable-runtime", `exit code=${code}`));

function ensureService(spec) {
  const owners = getPortOwnerPids(spec.port);
  const wrongOwners = owners.filter((pid) => !ownerMatches(pid, spec.expected));
  if (wrongOwners.length) {
    append(spec.name, `port ${spec.port} owned by wrong pid(s) ${wrongOwners.join(",")}; killing`);
    for (const pid of wrongOwners) killPid(pid);
    return;
  }
  if (owners.length) return;
  const existing = children.get(spec.name);
  if (existing && isPidAlive(existing.pid)) return;
  startService(spec);
}

function startService(spec) {
  const out = fs.openSync(path.join(logsDir, `${spec.name}.out.log`), "a");
  const err = fs.openSync(path.join(logsDir, `${spec.name}.err.log`), "a");
  append(spec.name, `starting ${spec.command} ${spec.args.join(" ")}`);
  const child = spawn(spec.command, spec.args, {
    cwd: root,
    env: serviceEnv(spec.port),
    detached: false,
    stdio: ["ignore", out, err],
    windowsHide: true,
  });
  children.set(spec.name, child);
  append(spec.name, `pid=${child.pid}`);
  child.once("exit", (code, signal) => {
    const current = children.get(spec.name);
    if (current === child) children.delete(spec.name);
    append(spec.name, `exited code=${code ?? ""} signal=${signal ?? ""}`);
  });
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
    if (Number.isFinite(existingPid) && existingPid > 0 && isPidAlive(existingPid)) {
      console.log(`[stable-runtime] existing launcher pid=${existingPid}; exiting`);
      process.exit(0);
    }
  } catch {}
  fs.writeFileSync(lockFile, `${process.pid}\n`, "utf8");
  process.on("exit", () => {
    try {
      if (fs.readFileSync(lockFile, "utf8").trim() === String(process.pid)) fs.rmSync(lockFile, { force: true });
    } catch {}
  });
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
  return commandLine.includes(expected);
}

function commandLineForPid(pid) {
  const script = `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" | Select-Object -ExpandProperty CommandLine`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true });
  return result.stdout || "";
}

function killPid(pid) {
  try { process.kill(Number(pid), "SIGTERM"); } catch {}
  const script = `Stop-Process -Id ${Number(pid)} -Force -ErrorAction SilentlyContinue`;
  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
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
  fs.writeFileSync(webRuntimeServerPath, `"use strict";\nconst path = require("node:path");\nconst { createRequire } = require("node:module");\nconst root = ${JSON.stringify(root)};\nconst rootRequire = createRequire(path.join(root, "package.json"));\nconst serverPath = path.join(root, "apps", "web", ".next", "standalone", "apps", "web", "server.js");\nprocess.chdir(path.join(root, "apps", "web"));\nrootRequire(serverPath);\n`, "utf8");
}

function append(name, message) {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(path.join(logsDir, `${name}.launcher.log`), `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

function normalize(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}
