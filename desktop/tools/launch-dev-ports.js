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
const launcherLog = path.join(logsDir, args.has("--real-design") ? "launcher-real.log" : "launcher-mock.log");
const launcherCmd = path.join(runtimeDir, args.has("--real-design") ? "launch-real.cmd" : "launch-mock.cmd");
const conflictingLauncherCmd = path.join(runtimeDir, args.has("--real-design") ? "launch-mock.cmd" : "launch-real.cmd");

main();

function main() {
  fs.mkdirSync(logsDir, { recursive: true });
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

  removeIfPossible(launcherLog);
  fs.writeFileSync(launcherCmd, buildLauncherCmd(), "utf8");
  const commandLine = `cmd.exe /d /c ${cmdQuote(launcherCmd)}`;
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
  console.log(`[launch] node ${modeArgs.join(" ")} pid=${pid}`);
}

function updateMockModeLock() {
  if (realDesignMode) {
    removeIfPossible(mockModeLockFile);
    return;
  }
  fs.writeFileSync(mockModeLockFile, `${new Date().toISOString()}\n`, "utf8");
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
    `${cmdQuote("powershell.exe")} -NoProfile -ExecutionPolicy Bypass -Command ${cmdQuote(buildKeeperPowerShellCommand())}`,
  ];
  return `${lines.join("\r\n")}\r\n`;
}

function buildKeeperPowerShellCommand() {
  return [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location ${psQuote(process.cwd())}`,
    `& ${psQuote(process.execPath)} ${modeArgs.map(psQuote).join(" ")} *> ${psQuote(launcherLog)}`,
    "while ($true) { Start-Sleep -Seconds 3600 }",
  ].join("; ");
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
