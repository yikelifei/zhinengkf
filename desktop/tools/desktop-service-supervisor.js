"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = new Set(process.argv.slice(2));
const realDesignMode = args.has("--real-design");
const supervisorChild = args.has("--supervisor-child");
const modeArgs = realDesignMode
  ? ["tools/start-dev-ports.js", "--real-design", "--keep-alive"]
  : ["tools/start-dev-ports.js", "--mock-design", "--keep-alive"];
const runtimeDir = path.join(process.cwd(), ".runtime");
const logsDir = path.join(runtimeDir, "logs");
const mockModeLockFile = path.join(runtimeDir, "mock-mode.lock");
const realModeLockFile = path.join(runtimeDir, "real-mode.lock");
const designPlatformConfigFile = path.join(runtimeDir, "design-platform-config.json");
const launcherLog = path.join(logsDir, realDesignMode ? "launcher-real.log" : "launcher-mock.log");
const launcherCmd = path.join(runtimeDir, realDesignMode ? "supervise-real.cmd" : "supervise-mock.cmd");
const legacyLauncherCmd = path.join(runtimeDir, realDesignMode ? "launch-real.cmd" : "launch-mock.cmd");
const stableLauncherCmd = path.join(runtimeDir, realDesignMode ? "stable-supervise-real.cmd" : "stable-supervise-mock.cmd");
const conflictingLauncherCmd = path.join(runtimeDir, realDesignMode ? "supervise-mock.cmd" : "supervise-real.cmd");
const legacyConflictingLauncherCmd = path.join(runtimeDir, realDesignMode ? "launch-mock.cmd" : "launch-real.cmd");
const stableConflictingLauncherCmd = path.join(
  runtimeDir,
  realDesignMode ? "stable-supervise-mock.cmd" : "stable-supervise-real.cmd",
);

main();

function main() {
  fs.mkdirSync(logsDir, { recursive: true });
  setModeEnv();
  if (supervisorChild) {
    runSupervisorLoop();
    return;
  }

  assertModeSwitchAllowed();
  stopConflictingDesktopServices();
  updateMockModeLock();
  updateRealModeLock();
  disableConflictingLauncher();
  removeIfPossible(launcherLog);
  writeActiveLaunchers();

  if (process.platform !== "win32") {
    const result = spawnSync(process.execPath, modeArgs, { cwd: process.cwd(), env: process.env, detached: true, stdio: "ignore" });
    if (result.error) throw result.error;
    return;
  }

  const launcherResult = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$process = Start-Process -FilePath ${psQuote(launcherCmd)} -WorkingDirectory ${psQuote(process.cwd())} -WindowStyle Hidden -PassThru; $process.Id`,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (launcherResult.status === 0) {
    const launcherPid = String(launcherResult.stdout || "").trim().split(/\s+/).pop();
    console.log(`[supervisor] ${path.basename(launcherCmd)} pid=${launcherPid}`);
    return;
  }

  appendLog(launcherLog, `[supervisor] Start-Process launcher skipped: ${String(launcherResult.stderr || launcherResult.stdout || "failed").trim()}`);
  const commandLine = `${cmdQuote(process.execPath)} ${cmdQuote("tools/desktop-service-supervisor.js")} ${cmdQuote(
    realDesignMode ? "--real-design" : "--mock-design",
  )} ${cmdQuote("--supervisor-child")}`;
  const script =
    `$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(commandLine)}; CurrentDirectory = ${psQuote(process.cwd())} }; ` +
    "if ($result.ReturnValue -ne 0) { throw \"Win32_Process.Create failed: $($result.ReturnValue)\" }; " +
    "$result.ProcessId";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    appendLog(launcherLog, `[supervisor] Win32_Process.Create skipped: ${String(result.stderr || result.stdout || "failed").trim()}`);
    throw new Error("failed to launch desktop services");
  }
  const pid = String(result.stdout || "").trim().split(/\s+/).pop();
  console.log(`[supervisor] node ${modeArgs.join(" ")} pid=${pid}`);
}

function runSupervisorLoop() {
  assertModeSwitchAllowed();
  updateMockModeLock();
  updateRealModeLock();
  disableConflictingLauncher();
  writeActiveLaunchers();
  appendLog(launcherLog, `[supervisor] persistent ${realDesignMode ? "real" : "mock"} supervisor started pid=${process.pid}`);
  for (;;) {
    assertModeSwitchAllowed();
    const stdout = fs.openSync(launcherLog, "a");
    const stderr = fs.openSync(launcherLog, "a");
    const result = spawnSync(process.execPath, modeArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", stdout, stderr],
      windowsHide: true,
    });
    fs.closeSync(stdout);
    fs.closeSync(stderr);
    appendLog(launcherLog, `[${new Date().toISOString()}] start-dev-ports exited with ${result.status ?? "unknown"}, restarting`);
    sleep(2000);
  }
}

function setModeEnv() {
  if (realDesignMode) {
    process.env.ALLOW_REAL_DESIGN_START = "1";
    return;
  }
  process.env.DESIGN_PLATFORM_ADAPTER = "standard_v1";
  process.env.DESIGN_PLATFORM_BASE_URL = "http://127.0.0.1:3700";
}

function assertModeSwitchAllowed() {
  if (!realDesignMode && fs.existsSync(realModeLockFile) && !findConflictingDesignLaunchers("real").length && !runtimeConfigLooksRealDesignMode()) {
    removeIfPossible(realModeLockFile);
    appendLog(launcherLog, `[supervisor] removed stale real mode lock before mock launch: ${realModeLockFile}`);
  }
  if (
    !realDesignMode &&
    (fs.existsSync(realModeLockFile) ||
      findConflictingDesignLaunchers("real").length ||
      (runtimeConfigLooksRealDesignMode() && process.env.ALLOW_MOCK_DESIGN_START !== "1"))
  ) {
    throw new Error(
      `Mock design launch is blocked because real mode is active or locked at ${realModeLockFile}. Run npm.cmd run ports:stop before switching to mock design mode.`,
    );
  }
  if (!realDesignMode) return;
  if (!fs.existsSync(mockModeLockFile)) return;
  throw new Error(
    `Real design launch is blocked because mock mode is locked at ${mockModeLockFile}. Run npm.cmd run ports:stop before switching to real design mode.`,
  );
}

function stopConflictingDesktopServices() {
  if (process.platform !== "win32") return;
  const conflictMode = realDesignMode ? "mock" : "real";
  const conflicts = findConflictingDesignLaunchers(conflictMode);
  if (!conflicts.length) return;
  console.log(`[supervisor] found stale ${conflictMode} design launcher; stopping managed desktop services first.`);
  const result = spawnSync(process.execPath, ["tools/stop-dev-ports.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORTS_STACK_STARTER_PID: String(process.pid),
      PORTS_STACK_STARTER_PARENT_PID: String(process.ppid),
      PORTS_STACK_STARTER_MODE: realDesignMode ? "real" : "mock",
      PRESERVE_REAL_MODE_LOCK: realDesignMode ? "1" : "",
    },
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error("failed to stop stale conflicting desktop services before launch");
}

function findConflictingDesignLaunchers(mode) {
  if (process.platform !== "win32") return [];
  const modeArg = mode === "real" ? "--real-design" : "--mock-design";
  const supervisorFile = mode === "real" ? "supervise-real.cmd" : "supervise-mock.cmd";
  const stableSupervisorFile = mode === "real" ? "stable-supervise-real.cmd" : "stable-supervise-mock.cmd";
  const launcherFile = mode === "real" ? "launch-real.cmd" : "launch-mock.cmd";
  const batFile = mode === "real" ? "run_desktop_real_design.bat" : "run_desktop.bat";
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$root = ${psQuote(normalizePathText(process.cwd()))}`,
    "$selfPid = $PID",
    "$items = Get-CimInstance Win32_Process | Where-Object {",
    "  $_.ProcessId -ne $selfPid -and $_.CommandLine -and",
    "  ($_.CommandLine -replace '\\\\','/').ToLowerInvariant().Contains($root) -and",
    "  (",
    `    (($_.CommandLine -like '*start-dev-ports.js*') -and ($_.CommandLine -like '*${modeArg}*')) -or`,
    `    ($_.CommandLine -like '*${supervisorFile}*') -or`,
    `    ($_.CommandLine -like '*${stableSupervisorFile}*') -or`,
    `    ($_.CommandLine -like '*${launcherFile}*') -or`,
    `    ($_.CommandLine -like '*${batFile}*')`,
    "  )",
    "} | Select-Object -First 8 ProcessId,CommandLine",
    "if ($items) { $items | ConvertTo-Json -Compress }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((item) => item?.ProcessId);
  } catch {
    return [];
  }
}

function runtimeConfigLooksRealDesignMode() {
  try {
    const config = JSON.parse(fs.readFileSync(designPlatformConfigFile, "utf8"));
    return config?.designPlatformAdapter === "art_image_local";
  } catch {
    return false;
  }
}

function updateMockModeLock() {
  if (realDesignMode) return;
  fs.writeFileSync(mockModeLockFile, `${new Date().toISOString()}\n`, "utf8");
}

function updateRealModeLock() {
  if (!realDesignMode) return;
  fs.writeFileSync(realModeLockFile, `${new Date().toISOString()}\n`, "utf8");
}

function disableConflictingLauncher() {
  if (process.platform !== "win32") return;
  const conflictMode = realDesignMode ? "mock" : "real";
  const lines = [
    "@echo off",
    "setlocal",
    `cd /d ${cmdQuote(process.cwd())}`,
    `echo [%date% %time%] blocked stale ${conflictMode}-design launcher while ${
      realDesignMode ? "real" : "mock"
    } mode is active >> ${cmdQuote(path.join(logsDir, realDesignMode ? "launcher-mock.log" : "launcher-real.log"))}`,
    "exit /b 0",
  ];
  const content = `${lines.join("\r\n")}\r\n`;
  for (const filePath of [conflictingLauncherCmd, legacyConflictingLauncherCmd, stableConflictingLauncherCmd]) {
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function writeActiveLaunchers() {
  const content = buildLauncherCmd();
  for (const filePath of [launcherCmd, legacyLauncherCmd, stableLauncherCmd]) {
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function buildLauncherCmd() {
  const lines = [
    "@echo off",
    "setlocal",
    `cd /d ${cmdQuote(process.cwd())}`,
    ...launcherModeEnv(),
    ...launcherEnvKeys()
      .filter((key) => process.env[key] !== undefined)
      .map((key) => `set ${cmdSetArg(key, process.env[key])}`),
    ":restart",
    `${cmdQuote(process.execPath)} ${modeArgs.map(cmdQuote).join(" ")} >> ${cmdQuote(launcherLog)} 2>>&1`,
    `echo [%date% %time%] start-dev-ports exited with %ERRORLEVEL%, restarting >> ${cmdQuote(launcherLog)}`,
    "timeout /t 2 /nobreak >nul",
    "goto restart",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

function launcherEnvKeys() {
  const keys = [
    "NEXT_TELEMETRY_DISABLED",
    "USE_LOCAL_STORE",
    "WEB_PORT",
    "API_PORT",
    "MOCK_DESIGN_PLATFORM_PORT",
    "START_MOCK_DESIGN_PLATFORM",
    "DESIGN_PLATFORM_RUNTIME_CONFIG",
  ];
  if (realDesignMode) keys.push("DESIGN_PLATFORM_ADAPTER", "DESIGN_PLATFORM_BASE_URL");
  return keys;
}

function launcherModeEnv() {
  if (realDesignMode) return [`set ${cmdSetArg("ALLOW_REAL_DESIGN_START", "1")}`];
  return [
    `set ${cmdSetArg("DESIGN_PLATFORM_ADAPTER", "standard_v1")}`,
    `set ${cmdSetArg("DESIGN_PLATFORM_BASE_URL", "http://127.0.0.1:3700")}`,
  ];
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function normalizePathText(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function removeIfPossible(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EBUSY") throw error;
  }
}

function cmdSetArg(key, value) {
  return `"${String(key).replace(/"/g, "")}=${String(value || "").replace(/"/g, '""')}"`;
}

function appendLog(filePath, line) {
  try {
    fs.appendFileSync(filePath, `${line}\n`, "utf8");
  } catch {
    // Logging must not block service startup.
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
