"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const args = new Set(process.argv.slice(2));
const realDesignMode = args.has("--real-design");
const supervisorChild = args.has("--supervisor-child");
const modeArgs = realDesignMode
  ? ["tools/start-dev-ports.js", "--real-design", "--keep-alive"]
  : ["tools/start-dev-ports.js", "--mock-design", "--keep-alive"];
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
  ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
  : path.join(process.cwd(), ".runtime");
const stableRuntimeDir = path.join(process.cwd(), ".runtime-stable");
const logsDir = path.join(runtimeDir, "logs");
const mockModeLockFile = path.join(runtimeDir, "mock-mode.lock");
const realModeLockFile = path.join(runtimeDir, "real-mode.lock");
const designPlatformConfigFile = path.join(runtimeDir, "design-platform-config.json");
const preferredDesignModeFile = path.join(runtimeDir, "preferred-design-mode.json");
const mockRepairLockFile = path.join(runtimeDir, "mock-repair.lock");
const keepAliveHeartbeatFile = path.join(runtimeDir, "keep-alive.json");
const stableStartingLockFile = path.join(stableRuntimeDir, "stable-starting.lock");
const stableKeepAliveHeartbeatFile = path.join(stableRuntimeDir, "keep-alive.json");
const stableRuntimeLauncherPidFile = path.join(stableRuntimeDir, "stable-runtime-launcher.pid");
const launcherLog = path.join(logsDir, realDesignMode ? "launcher-real.log" : "launcher-mock.log");
const launcherCmd = path.join(runtimeDir, realDesignMode ? "supervise-real.cmd" : "supervise-mock.cmd");
const legacyLauncherCmd = path.join(runtimeDir, realDesignMode ? "launch-real.cmd" : "launch-mock.cmd");
const stableLauncherCmd = path.join(runtimeDir, realDesignMode ? "stable-supervise-real.cmd" : "stable-supervise-mock.cmd");
const supervisorChildCmd = path.join(runtimeDir, realDesignMode ? "supervisor-child-real.cmd" : "supervisor-child-mock.cmd");
const conflictingLauncherCmd = path.join(runtimeDir, realDesignMode ? "supervise-mock.cmd" : "supervise-real.cmd");
const legacyConflictingLauncherCmd = path.join(runtimeDir, realDesignMode ? "launch-mock.cmd" : "launch-real.cmd");
const stableConflictingLauncherCmd = path.join(
  runtimeDir,
  realDesignMode ? "stable-supervise-mock.cmd" : "stable-supervise-real.cmd",
);

main().catch((error) => {
  appendLog(launcherLog, `[supervisor] failed ${error?.stack || error}`);
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(logsDir, { recursive: true });
  if (await stableDesktopGuardActive()) {
    appendLog(launcherLog, "[supervisor] blocked because stable desktop startup/runtime is active");
    console.log("[supervisor] stable desktop runtime is active; legacy supervisor skipped.");
    return;
  }
  setModeEnv();
  if (supervisorChild) {
    await runSupervisorLoop();
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

  const supervisorCommandLine = buildSupervisorCommandLine();
  const supervisorCreateResult = createWindowsProcess(supervisorCommandLine);
  if (supervisorCreateResult.status === 0) {
    const pid = processIdFromResult(supervisorCreateResult);
    if (waitForDurableSupervisorPid(pid)) {
      console.log(`[supervisor] node ${modeArgs.join(" ")} pid=${pid}`);
      return;
    }
    appendLog(
      launcherLog,
      `[supervisor] Win32_Process node supervisor pid=${pid || "unknown"} exited before durable startup; trying fallback`,
    );
  }

  appendLog(
    launcherLog,
    `[supervisor] Win32_Process node supervisor skipped: ${String(
      supervisorCreateResult.stderr || supervisorCreateResult.stdout || supervisorCreateResult.error || "failed",
    ).trim()}`,
  );

  const launcherResult = startLauncherProcess(launcherCmd);
  if (launcherResult.status === 0) {
    const launcherPid = processIdFromResult(launcherResult);
    if (waitForDurableSupervisorPid(launcherPid)) {
      console.log(`[supervisor] ${path.basename(launcherCmd)} pid=${launcherPid}`);
      return;
    }
    appendLog(
      launcherLog,
      `[supervisor] Start-Process launcher pid=${launcherPid || "unknown"} exited before durable startup; trying fallback`,
    );
  }

  appendLog(
    launcherLog,
    `[supervisor] Start-Process launcher skipped: ${String(launcherResult.stderr || launcherResult.stdout || "failed").trim()}`,
  );

  const scheduledSupervisorResult = startSupervisorChildScheduled();
  if (scheduledSupervisorResult.status === 0) {
    console.log(`[supervisor] node ${modeArgs.join(" ")} pid=scheduled`);
    return;
  }

  appendLog(
    launcherLog,
    `[supervisor] scheduled supervisor skipped: ${String(
      scheduledSupervisorResult.stderr || scheduledSupervisorResult.stdout || scheduledSupervisorResult.error || "failed",
    ).trim()}`,
  );

  const supervisorChildResult = startSupervisorChild();
  if (supervisorChildResult.status === 0) {
    const childPid = processIdFromResult(supervisorChildResult);
    if (waitForDurableSupervisorPid(childPid)) {
      console.log(`[supervisor] node ${modeArgs.join(" ")} pid=${childPid}`);
      return;
    }
    appendLog(
      launcherLog,
      `[supervisor] Start-Process supervisor child pid=${childPid || "unknown"} exited before durable startup; trying fallback`,
    );
  }

  appendLog(
    launcherLog,
    `[supervisor] Start-Process supervisor child skipped: ${String(
      supervisorChildResult.stderr || supervisorChildResult.stdout || supervisorChildResult.error || "failed",
    ).trim()}`,
  );

  if (!nonDurableSupervisorFallbackAllowed()) {
    throw new Error(
      "Durable Windows supervisor launch failed. Run run_desktop_real_design.bat for foreground mode, or set ALLOW_NON_DURABLE_SUPERVISOR_FALLBACK=1 only for local debugging.",
    );
  }

  const detachedSupervisorChild = spawnSupervisorChildDetached();
  if (detachedSupervisorChild.pid) {
    console.log(`[supervisor] node ${modeArgs.join(" ")} pid=${detachedSupervisorChild.pid}`);
    return;
  }

  appendLog(launcherLog, `[supervisor] detached node supervisor skipped: ${detachedSupervisorChild.error || "failed"}`);

  const launcherCommandLine = `cmd.exe /d /c ${cmdQuote(launcherCmd)}`;
  const launcherCreateResult = createWindowsProcess(launcherCommandLine);
  if (launcherCreateResult.status === 0) {
    const launcherPid = String(launcherCreateResult.stdout || "").trim().split(/\s+/).pop();
    console.log(`[supervisor] ${path.basename(launcherCmd)} pid=${launcherPid}`);
    return;
  }

  appendLog(
    launcherLog,
    `[supervisor] Win32_Process launcher skipped: ${String(
      launcherCreateResult.stderr || launcherCreateResult.stdout || launcherCreateResult.error || "failed",
    ).trim()}`,
  );

  throw new Error("failed to launch desktop services");
}

function startLauncherProcess(filePath) {
  const isCmd = /\.cmd$/i.test(filePath);
  const file = isCmd ? "cmd.exe" : filePath;
  const argumentList = isCmd ? ["/d", "/c", filePath] : [];
  const argumentListScript = argumentList.length ? ` -ArgumentList ${psArray(argumentList)}` : "";
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$process = Start-Process -FilePath ${psQuote(file)}${argumentListScript} -WorkingDirectory ${psQuote(process.cwd())} -WindowStyle Hidden -PassThru; $process.Id`,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

function spawnSupervisorChildDetached() {
  let stdout;
  let stderr;
  try {
    stdout = fs.openSync(launcherLog, "a");
    stderr = fs.openSync(launcherLog, "a");
    const child = spawn(
      process.execPath,
      ["tools/desktop-service-supervisor.js", realDesignMode ? "--real-design" : "--mock-design", "--supervisor-child"],
      {
        cwd: process.cwd(),
        env: process.env,
        detached: true,
        stdio: ["ignore", stdout, stderr],
        windowsHide: true,
      },
    );
    child.unref();
    fs.closeSync(stdout);
    fs.closeSync(stderr);
    return { pid: child.pid };
  } catch (error) {
    if (stdout) fs.closeSync(stdout);
    if (stderr) fs.closeSync(stderr);
    return { pid: 0, error: error?.message || String(error) };
  }
}

function createWindowsProcess(commandLine) {
  const script =
    `$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(
      commandLine,
    )}; CurrentDirectory = ${psQuote(process.cwd())} }; ` +
    "if ($result.ReturnValue -ne 0) { throw \"Win32_Process.Create failed: $($result.ReturnValue)\" }; " +
    "$result.ProcessId";
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
  });
}

function startSupervisorChildScheduled() {
  writeSupervisorChildCmd();
  const taskName = `zhinengkefu_desktop_supervisor_${realDesignMode ? "real" : "mock"}`;
  const startTime = scheduledTaskStartTime();
  const taskArgument = `/d /c \\"${supervisorChildCmd}\\"`;
  const createScript = [
    `$taskName = ${psQuote(taskName)}`,
    `$action = New-ScheduledTaskAction -Execute ${psQuote("cmd.exe")} -Argument ${psQuote(taskArgument)}`,
    `$trigger = New-ScheduledTaskTrigger -Once -At ${psQuote(startTime)}`,
    "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Force | Out-Null",
  ].join("; ");
  const createResult = spawnPowerShell(createScript);
  if (createResult.status !== 0) {
    createResult.stderr = `create failed taskArgument=${taskArgument}\n${createResult.stderr || createResult.stdout || ""}`;
    return createResult;
  }

  const runResult = spawnPowerShell(`Start-ScheduledTask -TaskName ${psQuote(taskName)}`);
  if (runResult.status === 0) sleep(2000);
  if (runResult.status !== 0) {
    runResult.stderr = `run failed taskArgument=${taskArgument}\n${runResult.stderr || runResult.stdout || ""}`;
    return runResult;
  }
  const deleteResult = spawnPowerShell(`Unregister-ScheduledTask -TaskName ${psQuote(taskName)} -Confirm:$false`);
  if (deleteResult.status !== 0) {
    appendLog(launcherLog, `[supervisor] scheduled task cleanup skipped: ${String(deleteResult.stderr || deleteResult.stdout).trim()}`);
  }
  return runResult;
}

function spawnPowerShell(script) {
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
  });
}

function processIdFromResult(result) {
  return String(result.stdout || "").trim().split(/\s+/).pop() || "";
}

function waitForDurableSupervisorPid(pid) {
  if (!pid) return false;
  const deadline = Date.now() + numberEnv("SUPERVISOR_DURABILITY_CHECK_MS", 10000);
  while (Date.now() < deadline) {
    if (keepAliveHeartbeatIsFresh()) return true;
    if (!processIsRunning(pid)) return false;
    sleep(500);
  }
  return keepAliveHeartbeatIsFresh();
}

function processIsRunning(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function keepAliveHeartbeatIsFresh() {
  try {
    const heartbeat = JSON.parse(fs.readFileSync(keepAliveHeartbeatFile, "utf8"));
    const expectedMode = realDesignMode ? "real" : "mock";
    const updatedAt = Date.parse(String(heartbeat.updatedAt || ""));
    return heartbeat.mode === expectedMode && Number.isFinite(updatedAt) && Date.now() - updatedAt <= 30_000;
  } catch {
    return false;
  }
}

function nonDurableSupervisorFallbackAllowed() {
  return process.env.ALLOW_NON_DURABLE_SUPERVISOR_FALLBACK === "1";
}

function scheduledTaskStartTime() {
  const date = new Date(Date.now() + 60_000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function startSupervisorChild() {
  const childArgs = [
    "tools/desktop-service-supervisor.js",
    realDesignMode ? "--real-design" : "--mock-design",
    "--supervisor-child",
  ];
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$process = Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList ${psArray(
        childArgs,
      )} -WorkingDirectory ${psQuote(process.cwd())} -WindowStyle Hidden -PassThru; $process.Id`,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

function buildSupervisorCommandLine() {
  writeSupervisorChildCmd();
  return `cmd.exe /d /c ${cmdQuote(supervisorChildCmd)}`;
}

function writeSupervisorChildCmd() {
  const envLines = [
    ...launcherModeEnv(),
    ...launcherEnvKeys()
      .filter((key) => process.env[key] !== undefined)
      .map((key) => `set ${cmdSetArg(key, process.env[key])}`),
  ];
  const lines = [
    "@echo off",
    "setlocal",
    `cd /d ${cmdQuote(process.cwd())}`,
    ...envLines,
    `${cmdQuote(process.execPath)} ${cmdQuote("tools/desktop-service-supervisor.js")} ${cmdQuote(
      realDesignMode ? "--real-design" : "--mock-design",
    )} ${cmdQuote("--supervisor-child")} >> ${cmdQuote(launcherLog)} 2>>&1`,
  ];
  fs.writeFileSync(supervisorChildCmd, `${lines.join("\r\n")}\r\n`, "utf8");
}

async function runSupervisorLoop() {
  assertModeSwitchAllowed();
  updateMockModeLock();
  updateRealModeLock();
  disableConflictingLauncher();
  writeActiveLaunchers();
  appendLog(launcherLog, `[supervisor] persistent ${realDesignMode ? "real" : "mock"} supervisor started pid=${process.pid}`);
  for (;;) {
    if (await stableDesktopGuardActive()) {
      appendLog(launcherLog, "[supervisor] stable desktop runtime became active; stopping legacy supervisor loop");
      return;
    }
    assertModeSwitchAllowed();
    const stdout = openLauncherLogForAppend("stdout");
    const stderr = openLauncherLogForAppend("stderr");
    const result = spawnSync(process.execPath, modeArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", stdout, stderr],
      windowsHide: true,
    });
    closeLogFd(stdout);
    closeLogFd(stderr);
    if (result.status === 0) {
      appendLog(launcherLog, `[${new Date().toISOString()}] start-dev-ports exited with 0, continuing supervision`);
      sleep(2000);
      continue;
    }
    appendLog(launcherLog, `[${new Date().toISOString()}] start-dev-ports exited with ${result.status ?? "unknown"}, restarting`);
    sleep(2000);
  }
}

function setModeEnv() {
  if (realDesignMode) {
    if (process.env.ALLOW_REAL_DESIGN_START !== "1" || process.env.CONFIRM_REAL_DESIGN_SWITCH !== "1") {
      throw new Error(
        "Real design supervisor must be launched through npm.cmd run ports:launch:real so stale real supervisors cannot steal the default mock startup.",
      );
    }
    if (mockRepairLockIsFresh()) {
      throw new Error("Real design supervisor is blocked because default mock startup repair is in progress.");
    }
    if (mockRuntimeStateIsActive()) {
      throw new Error("Real design supervisor is blocked because mock design mode is active.");
    }
    process.env.ALLOW_REAL_DESIGN_START = "1";
    process.env.ALLOW_REAL_DESIGN_LAUNCH = "1";
    process.env.CONFIRM_REAL_DESIGN_SWITCH = "1";
    return;
  }
  process.env.DESIGN_PLATFORM_ADAPTER = "standard_v1";
  process.env.DESIGN_PLATFORM_BASE_URL = "http://127.0.0.1:3700";
}

function assertModeSwitchAllowed() {
  if (
    !realDesignMode &&
    (fs.existsSync(realModeLockFile) ||
      findConflictingDesignLaunchers("real").length ||
      ((runtimeConfigLooksRealDesignMode() || preferredDesignModeIsReal()) && process.env.FORCE_MOCK_DESIGN_START !== "1"))
  ) {
    throw new Error(
      `Mock design launch is blocked because real mode is active, preferred, or locked at ${realModeLockFile}. Set FORCE_MOCK_DESIGN_START=1 before switching to mock design mode.`,
    );
  }
  if (!realDesignMode) return;
  if (mockRuntimeStateIsActive()) {
    throw new Error("Real design launch is blocked because mock design mode is active. Run npm.cmd run ports:stop before switching to real design mode.");
  }
  if (!fs.existsSync(mockModeLockFile)) return;
  if (mockModeLockIsStaleForRealStart()) {
    fs.rmSync(mockModeLockFile, { force: true });
    appendLog(launcherLog, `[supervisor] removed stale mock mode lock before real design startup: ${mockModeLockFile}`);
    return;
  }
  throw new Error(
    `Real design launch is blocked because mock mode is locked at ${mockModeLockFile}. Run npm.cmd run ports:stop before switching to real design mode.`,
  );
}

function mockRuntimeStateIsActive() {
  return fs.existsSync(mockModeLockFile) || runtimeConfigLooksMockDesignMode() || preferredDesignModeIsMock();
}

function runtimeConfigLooksMockDesignMode() {
  try {
    const config = JSON.parse(fs.readFileSync(designPlatformConfigFile, "utf8"));
    return config?.designPlatformAdapter === "standard_v1";
  } catch {
    return false;
  }
}

function preferredDesignModeIsMock() {
  try {
    return JSON.parse(fs.readFileSync(preferredDesignModeFile, "utf8"))?.mode === "mock";
  } catch {
    return false;
  }
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
      PRESERVE_MOCK_REPAIR_LOCK: mockRepairLockIsFresh() ? "1" : "",
      FORCE_PORTS_SWEEP: "1",
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
    `    (($_.CommandLine -like '*desktop-service-supervisor.js*') -and ($_.CommandLine -like '*${modeArg}*')) -or`,
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

function mockModeLockIsStaleForRealStart() {
  if (!realDesignMode) return false;
  return (
    !findConflictingDesignLaunchers("mock").length &&
    !getPortOwnerPids(numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700)).length &&
    !getPortOwnerPids(numberEnv("API_PORT", 3200)).length
  );
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

function runtimeConfigLooksRealDesignMode() {
  try {
    const config = JSON.parse(fs.readFileSync(designPlatformConfigFile, "utf8"));
    return config?.designPlatformAdapter === "art_image_local";
  } catch {
    return false;
  }
}

function preferredDesignModeIsReal() {
  try {
    return JSON.parse(fs.readFileSync(preferredDesignModeFile, "utf8"))?.mode === "real";
  } catch {
    return false;
  }
}

function mockRepairLockIsFresh() {
  try {
    const updatedAt = Date.parse(fs.readFileSync(mockRepairLockFile, "utf8").trim());
    return Number.isFinite(updatedAt) && Date.now() - updatedAt <= 10 * 60_000;
  } catch {
    return false;
  }
}

function updateMockModeLock() {
  if (realDesignMode) return;
  fs.writeFileSync(mockModeLockFile, `${new Date().toISOString()}\n`, "utf8");
  writePreferredDesignMode("mock");
}

function updateRealModeLock() {
  if (!realDesignMode) return;
  fs.writeFileSync(realModeLockFile, `${new Date().toISOString()}\n`, "utf8");
  writePreferredDesignMode("real");
}

function writePreferredDesignMode(mode) {
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
    `if %ERRORLEVEL% EQU 0 echo [%date% %time%] start-dev-ports exited with 0, continuing supervision >> ${cmdQuote(launcherLog)}`,
    `echo [%date% %time%] start-dev-ports exited with %ERRORLEVEL%, restarting >> ${cmdQuote(launcherLog)}`,
    "timeout /t 2 /nobreak >nul",
    "goto restart",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

function launcherEnvKeys() {
  const keys = [
    "FORCE_MOCK_DESIGN_START",
    "NEXT_TELEMETRY_DISABLED",
    "USE_LOCAL_STORE",
    "WEB_PORT",
    "API_PORT",
    "MOCK_DESIGN_PLATFORM_PORT",
    "START_MOCK_DESIGN_PLATFORM",
    "DESIGN_PLATFORM_RUNTIME_CONFIG",
    "DESKTOP_RUNTIME_DIR",
    "SKIP_EXISTING_API_BUILD",
    "SKIP_EXISTING_WEB_BUILD",
  ];
  if (realDesignMode) keys.push("DESIGN_PLATFORM_ADAPTER", "DESIGN_PLATFORM_BASE_URL");
  return keys;
}

function launcherModeEnv() {
  if (realDesignMode) {
    return [
      `set ${cmdSetArg("ALLOW_REAL_DESIGN_START", "1")}`,
      `set ${cmdSetArg("ALLOW_REAL_DESIGN_LAUNCH", "1")}`,
      `set ${cmdSetArg("CONFIRM_REAL_DESIGN_SWITCH", "1")}`,
    ];
  }
  return [
    `set ${cmdSetArg("DESIGN_PLATFORM_ADAPTER", "standard_v1")}`,
    `set ${cmdSetArg("DESIGN_PLATFORM_BASE_URL", "http://127.0.0.1:3700")}`,
  ];
}

async function stableDesktopGuardActive() {
  if (process.env.ALLOW_LEGACY_START_WITH_STABLE === "1") return false;
  if (normalizePathText(runtimeDir) === normalizePathText(stableRuntimeDir)) return false;
  const processActive = stableStartingLockActive() || heartbeatFresh(stableKeepAliveHeartbeatFile, 3_600_000);
  if (!processActive) return false;
  if (await stableRuntimeServicesHealthy()) return true;
  appendLog(launcherLog, "[supervisor] ignored stale stable desktop runtime guard because the stable launcher is not serving required ports");
  console.log("[supervisor] ignored stale stable desktop runtime guard because required ports are not healthy.");
  return false;
}

function stableStartingLockActive() {
  if (fileFresh(stableStartingLockFile, 10 * 60_000)) return true;
  if (!fileFresh(stableStartingLockFile, 3_600_000)) return false;
  return stableRuntimeLauncherProcessActive(readNumericFile(stableRuntimeLauncherPidFile)) || findStableRuntimeLauncherProcesses().length > 0;
}

async function stableRuntimeServicesHealthy() {
  const webPort = numberEnv("WEB_PORT", 3100);
  const apiPort = numberEnv("API_PORT", 3200);
  const mockPort = numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700);
  if (!(await httpOk(`http://127.0.0.1:${webPort}/`))) return false;
  const apiHealth = await getJson(`http://127.0.0.1:${apiPort}/api/health`);
  if (!apiHealth?.ok) return false;
  const integrationHealth = await getJson(`http://127.0.0.1:${apiPort}/api/integrations/design-platform/health`);
  if (realDesignMode) return integrationHealth?.adapter === "art_image_local";
  return (
    (await httpOk(`http://127.0.0.1:${mockPort}/v1/health`)) &&
    integrationHealth?.adapter === "standard_v1"
  );
}

function httpOk(url) {
  return requestText(url).then((response) => response.statusCode >= 200 && response.statusCode < 400).catch(() => false);
}

async function getJson(url) {
  try {
    const response = await requestText(url);
    if (response.statusCode < 200 || response.statusCode >= 400) return null;
    return JSON.parse(response.body || "{}");
  } catch {
    return null;
  }
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { timeout: 2500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve({ statusCode: response.statusCode || 0, body }));
    });
    request.once("timeout", () => {
      request.destroy(new Error(`timeout ${url}`));
    });
    request.once("error", reject);
    request.end();
  });
}

function fileFresh(filePath, maxAgeMs) {
  try {
    return Date.now() - fs.statSync(filePath).mtimeMs <= maxAgeMs;
  } catch {
    return false;
  }
}

function heartbeatFresh(filePath, maxAgeMs) {
  try {
    const heartbeat = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const updatedAt = Date.parse(String(heartbeat?.updatedAt || ""));
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > maxAgeMs) return false;
    return stableRuntimeLauncherProcessActive(Number(heartbeat?.pid)) || findStableRuntimeLauncherProcesses().length > 0;
  } catch {
    return false;
  }
}

function readNumericFile(filePath) {
  try {
    const value = Number(String(fs.readFileSync(filePath, "utf8")).trim());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function stableRuntimeLauncherProcessActive(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0 || numericPid === process.pid) return false;
  if (process.platform !== "win32") return processIsRunning(numericPid);
  const commandLine = normalizePathText(getProcessCommandLinesByPid([String(numericPid)]).get(String(numericPid)) || "");
  return commandLine.includes(normalizePathText(process.cwd())) && commandLine.includes("tools/stable-runtime-launcher.js");
}

function findStableRuntimeLauncherProcesses() {
  if (process.platform !== "win32") return [];
  const normalizedRoot = normalizePathText(process.cwd());
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  return (Array.isArray(rows) ? rows : [rows]).filter((item) => {
    const pid = Number(item?.ProcessId);
    const commandLine = normalizePathText(item?.CommandLine || "");
    return Number.isFinite(pid) && pid !== process.pid && commandLine.includes(normalizedRoot) && commandLine.includes("tools/stable-runtime-launcher.js");
  });
}

function getProcessCommandLinesByPid(pids) {
  const ids = pids.map((pid) => Number(pid)).filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);
  if (!ids.length || process.platform !== "win32") return new Map();
  const filter = ids.map((pid) => `ProcessId = ${pid}`).join(" OR ");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Get-CimInstance Win32_Process -Filter ${psQuote(filter)} | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0 || !String(result.stdout || "").trim()) return new Map();
  try {
    const parsed = JSON.parse(result.stdout);
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return new Map(rows.map((item) => [String(item.ProcessId || ""), String(item.CommandLine || "")]));
  } catch {
    return new Map();
  }
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function psArray(values) {
  return `@(${values.map(psQuote).join(", ")})`;
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

function openLauncherLogForAppend(streamName) {
  try {
    return fs.openSync(launcherLog, "a");
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EBUSY") throw error;
    const fallbackPath = path.join(
      logsDir,
      `${path.basename(launcherLog, ".log")}.supervisor-${process.pid}-${streamName}.log`,
    );
    appendLog(fallbackPath, `[supervisor] launcher log was locked; using fallback log for ${streamName}: ${launcherLog}`);
    try {
      return fs.openSync(fallbackPath, "a");
    } catch {
      return "ignore";
    }
  }
}

function closeLogFd(value) {
  if (typeof value !== "number") return;
  try {
    fs.closeSync(value);
  } catch {
    // Closing a diagnostic log must not stop supervision.
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
