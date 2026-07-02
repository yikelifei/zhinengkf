"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(desktopRoot, ".runtime");
const mockModeLockFile = path.join(runtimeDir, "mock-mode.lock");
const realModeLockFile = path.join(runtimeDir, "real-mode.lock");
const designPlatformConfigFile = path.join(runtimeDir, "design-platform-config.json");
const preferredDesignModeFile = path.join(runtimeDir, "preferred-design-mode.json");
const args = new Set(process.argv.slice(2));
const requestedRealDesignMode = args.has("--real-design");
const requestedMockDesignMode = args.has("--mock-design");
const preferredDesignMode = readPreferredDesignMode();
const realDesignMode =
  requestedRealDesignMode ||
  (!requestedMockDesignMode &&
    (fs.existsSync(realModeLockFile) || runtimeConfigLooksRealDesignMode() || preferredDesignMode === "real"));
const mockDesignMode = !realDesignMode;
const allowMockDesignStart = process.env.ALLOW_MOCK_DESIGN_START === "1" || requestedMockDesignMode;
const modeArg = realDesignMode ? "--real-design" : "--mock-design";
const supervisorMode = realDesignMode ? "real" : "mock";
const supervisorScript = path.join(desktopRoot, "tools", "desktop-service-supervisor.ps1");
const supervisorJs = path.join(desktopRoot, "tools", "desktop-service-supervisor.js");
const launcherLog = path.join(runtimeDir, "logs", realDesignMode ? "launcher-real.log" : "launcher-mock.log");
const stackStarterLog = path.join(runtimeDir, "logs", "ports-stack-starter.log");
const conflictMode = realDesignMode ? "mock" : "real";
const managedPorts = [numberEnv("WEB_PORT", 3100), numberEnv("API_PORT", 3200), numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700)];

main().catch((error) => {
  logStep(`failed ${error?.stack || error}`);
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(path.dirname(launcherLog), { recursive: true });
  logStep(`start mode=${realDesignMode ? "real" : "mock"} ppid=${process.ppid}`);
  const activeApiRealMode = mockDesignMode ? await activeApiLooksRealDesignMode() : false;
  const runtimeConfigRealMode = runtimeConfigLooksRealDesignMode();
  const preferredRealMode = preferredDesignMode === "real";

  if (mockDesignMode && (fs.existsSync(realModeLockFile) || runtimeConfigRealMode || preferredRealMode) && !allowMockDesignStart) {
    console.error(
      `[launch] mock design launch is blocked because real design mode is locked, configured, or preferred at ${realModeLockFile}. Set ALLOW_MOCK_DESIGN_START=1 before switching to mock design mode.`,
    );
    process.exit(1);
  }

  if (mockDesignMode && activeApiRealMode && !allowMockDesignStart) {
    console.error(
      "[launch] mock design launch is blocked because the active API is using the real design platform. Run npm.cmd run ports:stop before switching to mock design mode.",
    );
    process.exit(1);
  }

  if (realDesignMode) {
    fs.writeFileSync(realModeLockFile, `${new Date().toISOString()}\n`, "utf8");
    writeRealDesignRuntimeConfig();
  }
  writePreferredDesignMode(realDesignMode ? "real" : "mock");
  disableConflictingLaunchers();
  stopConflictingDesignLaunchers();

  if (shouldRunStopSweep()) {
    logStep("stop sweep begin");
    const stopResult = stopManagedPorts();
    logStep(`stop sweep end status=${stopResult.status ?? "unknown"} signal=${stopResult.signal || ""}`);
    console.log(`[launch] stop status=${stopResult.status ?? "unknown"} signal=${stopResult.signal || ""}`);
    if (stopResult.status !== 0) {
      if (!managedPortsAreFree()) {
        console.log(`[launch] stop failed with status ${stopResult.status || 1}; managed ports are still occupied.`);
        if (realDesignMode) fs.rmSync(realModeLockFile, { force: true });
        process.exit(stopResult.status || 1);
      }
      console.log("[launch] stop reported a stale process race, but managed ports are free; continuing startup.");
    }
  } else {
    console.log("[launch] no existing desktop services detected; skipping stop sweep.");
  }

  if (realDesignMode && fs.existsSync(mockModeLockFile)) {
    throw new Error(
      `Real design launch is blocked because mock mode is locked at ${mockModeLockFile}. Run npm.cmd run ports:stop before switching to real design mode.`,
    );
  }
  if (realDesignMode) {
    fs.writeFileSync(realModeLockFile, `${new Date().toISOString()}\n`, "utf8");
    writeRealDesignRuntimeConfig();
  }
  writePreferredDesignMode(realDesignMode ? "real" : "mock");
  disableConflictingLaunchers();
  stopConflictingDesignLaunchers();

  const env = {
    ...process.env,
  };
  if (mockDesignMode) {
    env.DESIGN_PLATFORM_ADAPTER = "standard_v1";
    env.DESIGN_PLATFORM_BASE_URL = "http://127.0.0.1:3700";
    env.ALLOW_MOCK_DESIGN_START = "1";
  } else {
    env.DESIGN_PLATFORM_ADAPTER = "art_image_local";
    env.DESIGN_PLATFORM_BASE_URL = realDesignBaseUrl();
    env.ALLOW_REAL_DESIGN_START = "1";
  }

  if (process.platform === "win32" && fs.existsSync(supervisorJs)) {
    logStep(`spawn supervisor js ${modeArg}`);
    const child = spawn(process.execPath, ["tools/desktop-service-supervisor.js", modeArg], {
      cwd: desktopRoot,
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    logStep(`spawned supervisor js pid=${child.pid}`);
    console.log(`[launch] node tools/desktop-service-supervisor.js ${modeArg} pid=${child.pid}`);
    process.exit(0);
  }

  if (process.platform === "win32" && fs.existsSync(supervisorScript)) {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", supervisorScript, "-Mode", supervisorMode],
      {
        cwd: desktopRoot,
        env,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    if (result.status !== 0) process.exit(result.status || 1);
    return;
  }

  fs.appendFileSync(launcherLog, `\n[${new Date().toISOString()}] launching ${modeArg} keep-alive stack\n`, "utf8");
  const stdout = fs.openSync(launcherLog, "a");
  const stderr = fs.openSync(launcherLog, "a");
  const child = spawn(process.execPath, ["tools/start-dev-ports.js", modeArg, "--keep-alive"], {
    cwd: desktopRoot,
    env,
    detached: true,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
  child.unref();
  console.log(`[launch] node tools/start-dev-ports.js ${modeArg} --keep-alive pid=${child.pid}`);
  process.exit(0);
}

function logStep(message) {
  try {
    fs.mkdirSync(path.dirname(stackStarterLog), { recursive: true });
    fs.appendFileSync(stackStarterLog, `[${new Date().toISOString()}] pid=${process.pid} ${message}\n`, "utf8");
  } catch {
    // Startup diagnostics must never block launching the desktop services.
  }
}

function stopManagedPorts() {
  return spawnSync(process.execPath, ["tools/stop-dev-ports.js"], {
    cwd: desktopRoot,
    env: {
      ...process.env,
      PORTS_STACK_STARTER_PID: String(process.pid),
      PORTS_STACK_STARTER_PARENT_PID: String(process.ppid),
      PORTS_STACK_STARTER_MODE: realDesignMode ? "real" : "mock",
      PORTS_STOP_SKIP_STACK_STARTERS: "1",
      PRESERVE_REAL_MODE_LOCK: realDesignMode ? "1" : "",
      FORCE_PORTS_SWEEP: "1",
    },
    stdio: "inherit",
    windowsHide: true,
  });
}

function disableConflictingLaunchers() {
  if (process.platform !== "win32") return;
  const conflictLog = path.join(runtimeDir, "logs", `launcher-${conflictMode}.log`);
  for (const name of [`launch-${conflictMode}.cmd`, `supervise-${conflictMode}.cmd`, `stable-supervise-${conflictMode}.cmd`]) {
    const filePath = path.join(runtimeDir, name);
    const lines = [
      "@echo off",
      "setlocal",
      `cd /d ${cmdQuote(desktopRoot)}`,
      `echo [%date% %time%] blocked stale ${conflictMode}-design launcher while ${
        realDesignMode ? "real" : "mock"
      } mode is active >> ${cmdQuote(conflictLog)}`,
      "exit /b 0",
    ];
    fs.writeFileSync(filePath, `${lines.join("\r\n")}\r\n`, "utf8");
  }
}

function stopConflictingDesignLaunchers() {
  if (process.platform !== "win32") return;
  for (const item of findConflictingDesignLaunchers()) {
    const pid = String(item.ProcessId || "");
    if (!/^\d+$/.test(pid)) continue;
    if (pid === String(process.pid) || pid === String(process.ppid)) continue;
    const result = spawnSync("taskkill", ["/PID", pid, "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) {
      console.log(`[launch] stopped stale ${conflictMode} design launcher pid=${pid}`);
    }
  }

  if (!realDesignMode) return;
  for (const pid of getPortOwnerPids(numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700))) {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) console.log(`[launch] stopped stale mock design platform pid=${pid}`);
  }
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function shouldRunStopSweep() {
  const runtimeMode = runtimeConfigDesignMode();
  return runtimeMode === conflictMode || !managedPortsAreFree() || findConflictingDesignLaunchers().length > 0;
}

function findConflictingDesignLaunchers() {
  if (process.platform !== "win32") return [];
  const normalizedRoot = normalizePathText(desktopRoot);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0 || !result.stdout.trim()) return [];

  let processes = [];
  try {
    const parsed = JSON.parse(result.stdout);
    processes = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return [];
  }

  const conflictArg = realDesignMode ? "--mock-design" : "--real-design";
  const conflictLauncherNames = realDesignMode
    ? ["launch-mock.cmd", "supervise-mock.cmd", "stable-supervise-mock.cmd"]
    : ["launch-real.cmd", "supervise-real.cmd", "stable-supervise-real.cmd"];

  return processes.filter((item) => {
    const pid = String(item.ProcessId || "");
    const commandLine = normalizePathText(item.CommandLine || "");
    if (!/^\d+$/.test(pid) || pid === String(process.pid)) return false;
    if (!commandLine.includes(normalizedRoot)) return false;
    if (commandLine.includes("tools/ports-stack-starter.js") && commandLine.includes(conflictArg)) return true;
    if (commandLine.includes("tools/start-dev-ports.js") && commandLine.includes(conflictArg)) return true;
    if (
      commandLine.includes("tools/desktop-service-supervisor.js") &&
      commandLine.includes("--supervisor-child") &&
      commandLine.includes(conflictArg)
    ) {
      return true;
    }
    return conflictLauncherNames.some((name) => commandLine.includes(name));
  });
}

function managedPortsAreFree() {
  return managedPorts.every((port) => getPortOwnerPids(port).length === 0);
}

async function activeApiLooksRealDesignMode() {
  const apiPort = numberEnv("API_PORT", 3200);
  if (!getPortOwnerPids(apiPort).length) return false;
  const health = await getJson(`http://127.0.0.1:${apiPort}/api/integrations/design-platform/health`);
  if (health?.adapter === "art_image_local") return true;
  if (health?.baseUrl && health?.baseUrl !== "http://127.0.0.1:3700") return true;
  return runtimeConfigLooksRealDesignMode();
}

function runtimeConfigLooksRealDesignMode() {
  return runtimeConfigDesignMode() === "real";
}

function runtimeConfigDesignMode() {
  try {
    const config = JSON.parse(fs.readFileSync(designPlatformConfigFile, "utf8"));
    if (config?.designPlatformAdapter === "art_image_local") return "real";
    if (config?.designPlatformAdapter === "standard_v1") return "mock";
    return "";
  } catch {
    return "";
  }
}

function writeRealDesignRuntimeConfig() {
  const existing = readRuntimeDesignPlatformConfig();
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    designPlatformConfigFile,
    `${JSON.stringify(
      {
        ...existing,
        designPlatformAdapter: "art_image_local",
        designPlatformBaseUrl: realDesignBaseUrl(),
        launcherPid: process.pid,
        launcherArgs: process.argv.slice(2),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function readRuntimeDesignPlatformConfig() {
  try {
    return JSON.parse(fs.readFileSync(designPlatformConfigFile, "utf8"));
  } catch {
    return {};
  }
}

function writePreferredDesignMode(mode) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    preferredDesignModeFile,
    `${JSON.stringify(
      {
        mode,
        updatedAt: new Date().toISOString(),
        launcherPid: process.pid,
        launcherArgs: process.argv.slice(2),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function readPreferredDesignMode() {
  try {
    const mode = JSON.parse(fs.readFileSync(preferredDesignModeFile, "utf8"))?.mode;
    return mode === "real" || mode === "mock" ? mode : "";
  } catch {
    return "";
  }
}

function realDesignBaseUrl() {
  const envBaseUrl = process.env.DESIGN_PLATFORM_BASE_URL || "";
  if (envBaseUrl && normalizeBaseUrl(envBaseUrl) !== `http://127.0.0.1:${numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700)}`) {
    return envBaseUrl;
  }
  return "http://127.0.0.1:3000";
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function getJson(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(null));
  });
}

function getPortOwnerPids(port) {
  const result = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return [];
  const suffix = `:${port}`;
  const pids = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    if (String(parts[0]).toUpperCase() !== "TCP") continue;
    const localAddress = parts[1] || "";
    const state = parts[3] || "";
    const pid = parts[4] || "";
    if (!localAddress.endsWith(suffix)) continue;
    if (!/LISTENING/i.test(state)) continue;
    if (/^\d+$/.test(pid) && !pids.includes(pid)) pids.push(pid);
  }
  return pids;
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function normalizePathText(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}
