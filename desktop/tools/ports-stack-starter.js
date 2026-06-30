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
const args = new Set(process.argv.slice(2));
const realDesignMode = args.has("--real-design");
const mockDesignMode = !realDesignMode;
const allowMockDesignStart = process.env.ALLOW_MOCK_DESIGN_START === "1";
const modeArg = realDesignMode ? "--real-design" : "--mock-design";
const supervisorMode = realDesignMode ? "real" : "mock";
const supervisorScript = path.join(desktopRoot, "tools", "desktop-service-supervisor.ps1");
const supervisorJs = path.join(desktopRoot, "tools", "desktop-service-supervisor.js");
const launcherLog = path.join(runtimeDir, "logs", realDesignMode ? "launcher-real.log" : "launcher-mock.log");
const conflictMode = realDesignMode ? "mock" : "real";
const managedPorts = [numberEnv("WEB_PORT", 3100), numberEnv("API_PORT", 3200), numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700)];

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(path.dirname(launcherLog), { recursive: true });
  const activeApiRealMode = mockDesignMode ? await activeApiLooksRealDesignMode() : false;
  const runtimeConfigRealMode = runtimeConfigLooksRealDesignMode();

  if (mockDesignMode && activeApiRealMode) {
    throw new Error(
      `Mock design launch is blocked because real design mode is active. Run npm.cmd run ports:stop before switching to mock design mode.`,
    );
  }

  if (mockDesignMode && (fs.existsSync(realModeLockFile) || runtimeConfigRealMode) && !activeApiRealMode) {
    fs.rmSync(realModeLockFile, { force: true });
    clearRuntimeDesignModeConfig();
    console.log(`[launch] removed stale real design mode state before mock design launch: ${realModeLockFile}`);
  }

  if (realDesignMode) {
    fs.writeFileSync(realModeLockFile, `${new Date().toISOString()}\n`, "utf8");
  }
  disableConflictingLaunchers();

  const stopResult = stopManagedPorts();
  if (stopResult.status !== 0) {
    if (!managedPortsAreFree()) {
      if (realDesignMode) fs.rmSync(realModeLockFile, { force: true });
      process.exit(stopResult.status || 1);
    }
    console.log("[launch] stop reported a stale process race, but managed ports are free; continuing startup.");
  }

  if (realDesignMode && fs.existsSync(mockModeLockFile)) {
    fs.rmSync(mockModeLockFile, { force: true });
    console.log(`[launch] removed stale mock mode lock before real design launch: ${mockModeLockFile}`);
  }
  if (realDesignMode) {
    fs.writeFileSync(realModeLockFile, `${new Date().toISOString()}\n`, "utf8");
  }
  disableConflictingLaunchers();
  const secondStopResult = stopManagedPorts();
  if (secondStopResult.status !== 0) {
    if (!managedPortsAreFree()) {
      if (realDesignMode) fs.rmSync(realModeLockFile, { force: true });
      process.exit(secondStopResult.status || 1);
    }
    console.log("[launch] second stop reported a stale process race, but managed ports are free; continuing startup.");
  }
  disableConflictingLaunchers();

  const env = {
    ...process.env,
  };
  if (mockDesignMode) {
    env.DESIGN_PLATFORM_ADAPTER = "standard_v1";
    env.DESIGN_PLATFORM_BASE_URL = "http://127.0.0.1:3700";
    env.ALLOW_MOCK_DESIGN_START = "1";
  } else {
    env.ALLOW_REAL_DESIGN_START = "1";
  }

  if (process.platform === "win32" && fs.existsSync(supervisorJs)) {
    const result = spawnSync(process.execPath, ["tools/desktop-service-supervisor.js", modeArg], {
      cwd: desktopRoot,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.status !== 0) process.exit(result.status || 1);
    return;
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
}

function stopManagedPorts() {
  return spawnSync(process.execPath, ["tools/stop-dev-ports.js"], {
    cwd: desktopRoot,
    env: {
      ...process.env,
      PORTS_STACK_STARTER_PID: String(process.pid),
      PORTS_STACK_STARTER_PARENT_PID: String(process.ppid),
      PORTS_STACK_STARTER_MODE: realDesignMode ? "real" : "mock",
      PRESERVE_REAL_MODE_LOCK: realDesignMode ? "1" : "",
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

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
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
  try {
    const config = JSON.parse(fs.readFileSync(designPlatformConfigFile, "utf8"));
    return config?.designPlatformAdapter === "art_image_local";
  } catch {
    return false;
  }
}

function clearRuntimeDesignModeConfig() {
  // Keep designPlatformAccessToken, designPlatformCookie and designPlatformDeviceId across mode switches.
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(designPlatformConfigFile, "utf8"));
  } catch {
    fs.rmSync(designPlatformConfigFile, { force: true });
    return;
  }

  for (const key of [
    "designPlatformAdapter",
    "designPlatformBaseUrl",
    "launcherPid",
    "launcherArgs",
    "updatedAt",
  ]) {
    delete config[key];
  }

  if (Object.keys(config).length) {
    fs.mkdirSync(path.dirname(designPlatformConfigFile), { recursive: true });
    fs.writeFileSync(designPlatformConfigFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } else {
    fs.rmSync(designPlatformConfigFile, { force: true });
  }
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
