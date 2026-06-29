"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = new Set(process.argv.slice(2));
const realDesignMode = args.has("--real-design");
const modeArgs = realDesignMode
  ? ["tools/start-dev-ports.js", "--real-design", "--keep-alive"]
  : ["tools/start-dev-ports.js", "--mock-design", "--keep-alive"];
const runtimeDir = path.join(process.cwd(), ".runtime");
const logsDir = path.join(runtimeDir, "logs");
const mockModeLockFile = path.join(runtimeDir, "mock-mode.lock");
const launcherLog = path.join(logsDir, realDesignMode ? "launcher-real.log" : "launcher-mock.log");
const launcherCmd = path.join(runtimeDir, realDesignMode ? "launch-real.cmd" : "launch-mock.cmd");
const conflictingLauncherCmd = path.join(runtimeDir, realDesignMode ? "launch-mock.cmd" : "launch-real.cmd");

main();

function main() {
  fs.mkdirSync(logsDir, { recursive: true });
  assertModeSwitchAllowed();
  stopConflictingDesktopServices();
  updateMockModeLock();
  disableConflictingLauncher();
  removeIfPossible(launcherLog);

  if (process.platform !== "win32") {
    const result = spawnSync(process.execPath, modeArgs, {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    if (result.error) throw result.error;
    return;
  }

  fs.writeFileSync(launcherCmd, buildLauncherCmd(), "utf8");
  const commandLine = `cmd.exe /d /k ${cmdQuote(launcherCmd)}`;
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
    throw new Error(String(result.stderr || result.stdout || "failed to launch desktop services").trim());
  }
  const pid = String(result.stdout || "").trim().split(/\s+/).pop();
  console.log(`[launch] keeper node ${modeArgs.join(" ")} pid=${pid}`);
}

function updateMockModeLock() {
  if (realDesignMode) {
    return;
  }
  fs.writeFileSync(mockModeLockFile, `${new Date().toISOString()}\n`, "utf8");
}

function assertModeSwitchAllowed() {
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

  console.log(
    `[launch] found stale ${conflictMode} design launcher; stopping managed desktop services before starting ${
      realDesignMode ? "real" : "mock"
    } mode.`,
  );
  const result = spawnSync(process.execPath, ["tools/stop-dev-ports.js"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error("failed to stop stale conflicting desktop services before launch");
  }
}

function findConflictingDesignLaunchers(mode) {
  if (process.platform !== "win32") return [];

  const launcherFile = mode === "real" ? "launch-real.cmd" : "launch-mock.cmd";
  const modeArg = mode === "real" ? "--real-design" : "--mock-design";
  const batFile = mode === "real" ? "run_desktop_real_design.bat" : "run_desktop.bat";
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$root = ${psQuote(normalizePathText(process.cwd()))}`,
    "$selfPid = $PID",
    "$items = Get-CimInstance Win32_Process | Where-Object {",
    "  $_.ProcessId -ne $selfPid -and $_.CommandLine -and",
    "  ($_.CommandLine -replace '\\\\','/').ToLowerInvariant().Contains($root) -and",
    `  ((($_.CommandLine -like '*start-dev-ports.js*') -and ($_.CommandLine -like '*${modeArg}*')) -or`,
    `    ($_.CommandLine -like '*${launcherFile}*') -or`,
    `    ($_.CommandLine -like '*${batFile}*'))`,
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
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((item) => ({
        pid: Number(item.ProcessId),
        commandLine: String(item.CommandLine || ""),
      }))
      .filter((item) => Number.isFinite(item.pid) && item.commandLine);
  } catch {
    return [];
  }
}

function disableConflictingLauncher() {
  if (realDesignMode || process.platform !== "win32") return;
  const lines = [
    "@echo off",
    "setlocal",
    `cd /d ${cmdQuote(process.cwd())}`,
    `echo [%date% %time%] blocked stale real-design launcher while mock mode is active >> ${cmdQuote(path.join(logsDir, "launcher-real.log"))}`,
    "exit /b 0",
  ];
  fs.writeFileSync(conflictingLauncherCmd, `${lines.join("\r\n")}\r\n`, "utf8");
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
    `${cmdQuote(process.execPath)} ${modeArgs.map(cmdQuote).join(" ")} >> ${cmdQuote(launcherLog)} 2>>&1`,
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
  if (realDesignMode) {
    keys.push("DESIGN_PLATFORM_ADAPTER", "DESIGN_PLATFORM_BASE_URL");
  }
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
