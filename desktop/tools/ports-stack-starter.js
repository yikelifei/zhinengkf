"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
  ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
  : path.join(desktopRoot, ".runtime");
const mockModeLockFile = path.join(runtimeDir, "mock-mode.lock");
const realModeLockFile = path.join(runtimeDir, "real-mode.lock");
const mockRepairLockFile = path.join(runtimeDir, "mock-repair.lock");
const designPlatformConfigFile = path.join(runtimeDir, "design-platform-config.json");
const preferredDesignModeFile = path.join(runtimeDir, "preferred-design-mode.json");
const stableRuntimeDir = path.join(desktopRoot, ".runtime-stable");
const stableStartingLockFile = path.join(stableRuntimeDir, "stable-starting.lock");
const stableKeepAliveHeartbeatFile = path.join(stableRuntimeDir, "keep-alive.json");
const stableRuntimeLauncherPidFile = path.join(stableRuntimeDir, "stable-runtime-launcher.pid");
const args = new Set(process.argv.slice(2));
const requestedRealDesignMode = args.has("--real-design");
const requestedMockDesignMode = args.has("--mock-design");
const preferredDesignMode = readPreferredDesignMode();
const realDesignMode =
  requestedRealDesignMode ||
  (!requestedMockDesignMode &&
    !mockRepairLockIsFresh() &&
    (fs.existsSync(realModeLockFile) || runtimeConfigLooksRealDesignMode() || preferredDesignMode === "real"));
const mockDesignMode = !realDesignMode;
const allowMockDesignStart = process.env.FORCE_MOCK_DESIGN_START === "1";
const modeArg = realDesignMode ? "--real-design" : "--mock-design";
const supervisorMode = realDesignMode ? "real" : "mock";
const supervisorScript = path.join(desktopRoot, "tools", "desktop-service-supervisor.ps1");
const supervisorJs = path.join(desktopRoot, "tools", "desktop-service-supervisor.js");
const launcherLog = path.join(runtimeDir, "logs", realDesignMode ? "launcher-real.log" : "launcher-mock.log");
const stackStarterLog = path.join(runtimeDir, "logs", "ports-stack-starter.log");
const conflictMode = realDesignMode ? "mock" : "real";
const managedPorts = [numberEnv("WEB_PORT", 3100), numberEnv("API_PORT", 3200), numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700)];
const stackStarterLockFile = path.join(runtimeDir, `ports-stack-starter-${supervisorMode}.lock`);
let stackStarterLockHeld = false;

main().catch((error) => {
  logStep(`failed ${error?.stack || error}`);
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(path.dirname(launcherLog), { recursive: true });
  logStep(`start mode=${realDesignMode ? "real" : "mock"} ppid=${process.ppid}`);
  if (await stableDesktopGuardActive()) {
    logStep("blocked because stable desktop startup/runtime is active");
    console.log("[launch] stable desktop runtime is active; legacy port stack start skipped.");
    return;
  }
  const activeApiRealMode = mockDesignMode ? await activeApiLooksRealDesignMode() : false;
  const runtimeConfigRealMode = runtimeConfigLooksRealDesignMode();
  const preferredRealMode = preferredDesignMode === "real";
  const activeRealLaunchers = mockDesignMode ? findConflictingDesignLaunchers("real") : [];
  if (realDesignMode && (process.env.ALLOW_REAL_DESIGN_LAUNCH !== "1" || process.env.CONFIRM_REAL_DESIGN_SWITCH !== "1")) {
    console.error(
      "[launch] real design launch is disabled by default. Use run_desktop_real_design.bat, or run npm.cmd run ports:launch:real:confirmed when intentionally switching to the real design platform.",
    );
    process.exit(1);
  }

  if (realDesignMode && mockRepairLockIsFresh()) {
    console.error("[launch] real design launch is blocked because default mock startup repair is in progress.");
    process.exit(1);
  }

  if (realDesignMode && mockRuntimeStateIsActive()) {
    console.error(
      "[launch] real design launch is blocked because mock design mode is active. Run npm.cmd run ports:stop before switching to real design mode.",
    );
    process.exit(1);
  }

  if (mockDesignMode && activeApiRealMode && !allowMockDesignStart) {
    console.error(
      "[launch] mock design launch is blocked because the active API is using the real design platform. Run npm.cmd run ports:stop before switching to mock design mode.",
    );
    process.exit(1);
  }

  if (mockDesignMode && activeRealLaunchers.length && !allowMockDesignStart) {
    console.error(
      "[launch] mock design launch is blocked because a real design launcher is still running. Run npm.cmd run ports:stop before switching to mock design mode.",
    );
    process.exit(1);
  }

  if (
    mockDesignMode &&
    (fs.existsSync(realModeLockFile) || runtimeConfigRealMode || preferredRealMode) &&
    !allowMockDesignStart
  ) {
    console.error(
      `[launch] mock design launch is blocked because real design mode is locked, configured, or preferred at ${realModeLockFile}. Set FORCE_MOCK_DESIGN_START=1 before switching to mock design mode.`,
    );
    process.exit(1);
  }

  if (await activeStackMatchesRequestedMode()) {
    console.log(`[launch] ${realDesignMode ? "real" : "mock"} design stack is already running; skipping duplicate launch.`);
    return;
  }

  if (!(await acquireStackStarterLockOrWait())) return;
  try {
    if (await activeStackMatchesRequestedMode()) {
      console.log(`[launch] ${realDesignMode ? "real" : "mock"} design stack became ready while waiting for startup lock.`);
      return;
    }

    if (realDesignMode) {
      fs.writeFileSync(realModeLockFile, `${new Date().toISOString()}\n`, "utf8");
      writeRealDesignRuntimeConfig();
    } else {
      fs.rmSync(realModeLockFile, { force: true });
      writeMockDesignRuntimeConfig();
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
          process.exitCode = stopResult.status || 1;
          return;
        }
        console.log("[launch] stop reported a stale process race, but managed ports are free; continuing startup.");
      }
    } else {
      console.log("[launch] no existing desktop services detected; skipping stop sweep.");
    }

    if (realDesignMode && fs.existsSync(mockModeLockFile)) {
      if (mockModeLockIsStaleForRealStart()) {
        fs.rmSync(mockModeLockFile, { force: true });
        console.log(`[launch] removed stale mock mode lock before real design startup: ${mockModeLockFile}`);
      } else {
        throw new Error(
          `Real design launch is blocked because mock mode is locked at ${mockModeLockFile}. Run npm.cmd run ports:stop before switching to real design mode.`,
        );
      }
    }
    if (realDesignMode) {
      fs.writeFileSync(realModeLockFile, `${new Date().toISOString()}\n`, "utf8");
      writeRealDesignRuntimeConfig();
    } else {
      fs.rmSync(realModeLockFile, { force: true });
      writeMockDesignRuntimeConfig();
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
      if (allowMockDesignStart) env.FORCE_MOCK_DESIGN_START = "1";
    } else {
      env.DESIGN_PLATFORM_ADAPTER = "art_image_local";
      env.DESIGN_PLATFORM_BASE_URL = realDesignBaseUrl();
      env.ALLOW_REAL_DESIGN_START = "1";
    }

    if (process.platform === "win32" && fs.existsSync(supervisorJs)) {
      logStep(`run supervisor js ${modeArg}`);
      const result = spawnSync(process.execPath, ["tools/desktop-service-supervisor.js", modeArg], {
        cwd: desktopRoot,
        env,
        stdio: "inherit",
        windowsHide: true,
      });
      logStep(`supervisor js exited status=${result.status ?? "unknown"} signal=${result.signal || ""}`);
      if (result.status !== 0) {
        process.exitCode = result.status || 1;
        return;
      }
      try {
        await waitForStartedStack(numberEnv("PORTS_STACK_SUPERVISOR_READY_TIMEOUT_MS", 15000));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "unknown startup wait error");
        logStep(`supervisor readiness failed; falling back to direct keep-alive: ${message}`);
        console.log(`[launch] supervisor did not produce a ready stack; falling back to direct keep-alive startup.`);
        launchDirectKeepAlive(env);
        await waitForStartedStack();
      }
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
      if (result.status !== 0) {
        process.exitCode = result.status || 1;
        return;
      }
      return;
    }

    launchDirectKeepAlive(env);
  } finally {
    releaseStackStarterLock();
  }
}

function launchDirectKeepAlive(env) {
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
  logStep(`spawn direct keep-alive ${modeArg} pid=${child.pid || "unknown"}`);
  console.log(`[launch] node tools/start-dev-ports.js ${modeArg} --keep-alive pid=${child.pid}`);
}

async function waitForStartedStack(timeoutMs = numberEnv("PORTS_STACK_READY_TIMEOUT_MS", 120000)) {
  const startedAt = Date.now();
  let lastReason = "startup has not been checked yet";
  let lastLoggedAt = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const stack = await activeStackReadiness();
    const heartbeat = keepAliveHeartbeatReadiness();
    if (stack.ok && heartbeat.ok) {
      console.log(`[launch] ${realDesignMode ? "real" : "mock"} design stack is ready and supervised.`);
      return;
    }
    lastReason = [stack.reason, heartbeat.reason].filter(Boolean).join("; ");
    if (Date.now() - lastLoggedAt >= 5000) {
      console.log(`[launch] waiting for ${realDesignMode ? "real" : "mock"} design stack: ${lastReason}`);
      logStep(`waiting readiness ${lastReason}`);
      lastLoggedAt = Date.now();
    }
    await sleep(1000);
  }
  throw new Error(
    `${realDesignMode ? "real" : "mock"} design stack did not become ready within ${Math.round(
      timeoutMs / 1000,
    )} seconds: ${lastReason}`,
  );
}

function keepAliveHeartbeatIsFresh() {
  return keepAliveHeartbeatReadiness().ok;
}

function keepAliveHeartbeatReadiness() {
  const keepAliveHeartbeatFile = path.join(runtimeDir, "keep-alive.json");
  try {
    const heartbeat = JSON.parse(fs.readFileSync(keepAliveHeartbeatFile, "utf8"));
    const expectedMode = realDesignMode ? "real" : "mock";
    const updatedAt = Date.parse(String(heartbeat.updatedAt || ""));
    if (heartbeat.mode !== expectedMode) {
      return { ok: false, reason: `keep-alive heartbeat mode is ${heartbeat.mode || "missing"}, expected ${expectedMode}` };
    }
    if (!Number.isFinite(updatedAt)) {
      return { ok: false, reason: "keep-alive heartbeat timestamp is missing" };
    }
    const ageMs = Date.now() - updatedAt;
    if (ageMs > 30000) {
      return { ok: false, reason: `keep-alive heartbeat is stale (${Math.round(ageMs / 1000)}s old)` };
    }
    return { ok: true, reason: "" };
  } catch (error) {
    return { ok: false, reason: `keep-alive heartbeat is unavailable (${error?.code || error?.message || "read failed"})` };
  }
}

function mockRepairLockIsFresh() {
  try {
    const updatedAt = Date.parse(fs.readFileSync(mockRepairLockFile, "utf8").trim());
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 10 * 60_000) return false;
    if (process.platform !== "win32") return true;
    return findMockRepairProcesses().length > 0;
  } catch {
    return false;
  }
}

function findMockRepairProcesses() {
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

  return processes.filter((item) => {
    const pid = String(item.ProcessId || "");
    const commandLine = normalizePathText(item.CommandLine || "");
    if (!/^\d+$/.test(pid) || pid === String(process.pid)) return false;
    if (!commandLine.includes(normalizedRoot)) return false;
    return commandLine.includes("tools/repair-dev-startup.js") || commandLine.includes("ports:repair");
  });
}

async function acquireStackStarterLockOrWait() {
  for (;;) {
    try {
      fs.mkdirSync(runtimeDir, { recursive: true });
      const fd = fs.openSync(stackStarterLockFile, "wx");
      fs.writeFileSync(
        fd,
        `${JSON.stringify(
          {
            pid: process.pid,
            ppid: process.ppid,
            mode: supervisorMode,
            modeArg,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      fs.closeSync(fd);
      stackStarterLockHeld = true;
      process.once("exit", releaseStackStarterLock);
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = readStackStarterLock();
      if (stackStarterLockOwnerIsActive(owner)) {
        console.log(
          `[launch] ${realDesignMode ? "real" : "mock"} design stack startup is already running under PID ${owner.pid}; waiting for it.`,
        );
        await waitForStartedStack();
        return false;
      }
      fs.rmSync(stackStarterLockFile, { force: true });
    }
  }
}

function readStackStarterLock() {
  try {
    return JSON.parse(fs.readFileSync(stackStarterLockFile, "utf8"));
  } catch {
    return null;
  }
}

function stackStarterLockOwnerIsActive(owner) {
  if (!owner || owner.mode !== supervisorMode) return false;
  const pid = Number(owner.pid);
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false;
  const startedAt = Date.parse(String(owner.startedAt || ""));
  if (Number.isFinite(startedAt) && Date.now() - startedAt > 10 * 60_000) return false;
  if (process.platform === "win32") return windowsProcessLooksLikeStackStarter(pid);
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function windowsProcessLooksLikeStackStarter(pid) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" | Select-Object -ExpandProperty CommandLine`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  const commandLine = normalizePathText(result.stdout || "");
  if (result.status !== 0 || !commandLine) return false;
  return commandLine.includes(normalizePathText(desktopRoot)) && commandLine.includes("tools/ports-stack-starter.js");
}

function releaseStackStarterLock() {
  if (!stackStarterLockHeld) return;
  const owner = readStackStarterLock();
  if (Number(owner?.pid) === process.pid) {
    fs.rmSync(stackStarterLockFile, { force: true });
  }
  stackStarterLockHeld = false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      PRESERVE_MOCK_REPAIR_LOCK: mockRepairLockIsFresh() ? "1" : "",
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

function mockModeLockIsStaleForRealStart() {
  if (!realDesignMode) return false;
  return (
    !findConflictingDesignLaunchers().length &&
    !getPortOwnerPids(numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700)).length &&
    !getPortOwnerPids(numberEnv("API_PORT", 3200)).length
  );
}

async function activeStackMatchesRequestedMode() {
  return (await activeStackReadiness()).ok && keepAliveHeartbeatIsFresh();
}

async function activeStackReadiness() {
  const webPort = numberEnv("WEB_PORT", 3100);
  const apiPort = numberEnv("API_PORT", 3200);
  const mockPort = numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700);
  const webPids = getPortOwnerPids(webPort);
  const apiPids = getPortOwnerPids(apiPort);
  if (!webPids.length) return { ok: false, reason: `web port ${webPort} is not listening` };
  if (!apiPids.length) return { ok: false, reason: `api port ${apiPort} is not listening` };
  const webOwnerMismatch = workspacePortOwnerMismatchReason("web", webPids);
  if (webOwnerMismatch) return { ok: false, reason: webOwnerMismatch };
  const webRuntimeMismatch = webPortRuntimeMismatchReason(webPids);
  if (webRuntimeMismatch) return { ok: false, reason: webRuntimeMismatch };
  const apiOwnerMismatch = workspacePortOwnerMismatchReason("api", apiPids);
  if (apiOwnerMismatch) return { ok: false, reason: apiOwnerMismatch };
  if (mockDesignMode) {
    const mockPids = getPortOwnerPids(mockPort);
    if (!mockPids.length) return { ok: false, reason: `mock design port ${mockPort} is not listening` };
    const mockOwnerMismatch = workspacePortOwnerMismatchReason("mock design", mockPids);
    if (mockOwnerMismatch) return { ok: false, reason: mockOwnerMismatch };
  }
  if (!(await httpOk(`http://127.0.0.1:${webPort}/`))) {
    return { ok: false, reason: `web health check failed on port ${webPort} (pids ${webPids.join(",")})` };
  }
  const apiHealth = await getJson(`http://127.0.0.1:${apiPort}/api/health`);
  if (!apiHealth?.ok) {
    return { ok: false, reason: `api health check failed on port ${apiPort} (pids ${apiPids.join(",")})` };
  }
  if (!apiHealthUsesRuntimeDir(apiHealth)) {
    return { ok: false, reason: `api local store is outside current runtime: ${apiHealth?.localStore?.path || "unknown"}` };
  }
  const integrationHealth = await getJson(`http://127.0.0.1:${apiPort}/api/integrations/design-platform/health`);
  if (realDesignMode) {
    if (!integrationHealth) {
      return { ok: false, reason: `design integration health failed on api port ${apiPort}` };
    }
    const matches =
      integrationHealth.adapter === "art_image_local" &&
      normalizeBaseUrl(integrationHealth.baseUrl) === normalizeBaseUrl(realDesignBaseUrl());
    return matches
      ? { ok: true, reason: "" }
      : {
          ok: false,
          reason: `design integration is ${integrationHealth.adapter || "unknown"} at ${
            integrationHealth.baseUrl || "unknown"
          }, expected art_image_local at ${realDesignBaseUrl()}`,
        };
  }
  if (!integrationHealth?.ok) {
    return { ok: false, reason: `design integration health failed on api port ${apiPort}` };
  }
  const matches =
    integrationHealth.adapter === "standard_v1" &&
    normalizeBaseUrl(integrationHealth.baseUrl) === `http://127.0.0.1:${mockPort}`;
  return matches
    ? { ok: true, reason: "" }
    : {
        ok: false,
        reason: `design integration is ${integrationHealth.adapter || "unknown"} at ${
          integrationHealth.baseUrl || "unknown"
        }, expected standard_v1 at http://127.0.0.1:${mockPort}`,
      };
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

function mockRuntimeStateIsActive() {
  return fs.existsSync(mockModeLockFile) || runtimeConfigDesignMode() === "mock" || preferredDesignMode === "mock";
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

function writeMockDesignRuntimeConfig() {
  const existing = readRuntimeDesignPlatformConfig();
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    designPlatformConfigFile,
    `${JSON.stringify(
      {
        ...existing,
        designPlatformAdapter: "standard_v1",
        designPlatformBaseUrl: "http://127.0.0.1:3700",
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

function httpOk(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 400));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(false));
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

function workspacePortOwnerMismatchReason(label, pids) {
  if (process.platform !== "win32" || !pids.length) return "";
  const commandLines = getProcessCommandLinesByPid(pids);
  const normalizedOwnerRoots = [desktopRoot, runtimeDir].map(normalizePathText).filter(Boolean);
  const mismatched = pids.filter((pid) => {
    const commandLine = normalizePathText(commandLines.get(String(pid)) || "");
    return commandLine && !normalizedOwnerRoots.some((ownerRoot) => commandLine.includes(ownerRoot));
  });
  if (!mismatched.length) return "";
  return `${label} port is owned by non-current workspace PID ${mismatched.join(",")}`;
}

function webPortRuntimeMismatchReason(pids) {
  if (process.platform !== "win32" || !pids.length) return "";
  const commandLines = getProcessCommandLinesByPid(pids);
  const normalizedRuntime = normalizePathText(runtimeDir);
  const mismatched = pids.filter((pid) => {
    const commandLine = normalizePathText(commandLines.get(String(pid)) || "");
    return commandLine.includes("web-standalone-server.js") && !commandLine.includes(normalizedRuntime);
  });
  if (!mismatched.length) return "";
  return `web port is running from a different runtime PID ${mismatched.join(",")}`;
}

function apiHealthUsesRuntimeDir(apiHealth, expectedRuntimeDir = runtimeDir) {
  const storePath = apiHealth?.localStore?.path;
  if (!storePath) return true;
  return normalizePathText(storePath).startsWith(normalizePathText(expectedRuntimeDir));
}

function getProcessCommandLinesByPid(pids) {
  const ids = [...new Set(pids.map((pid) => String(pid)).filter((pid) => /^\d+$/.test(pid)))];
  if (!ids.length) return new Map();
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

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizePathText(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

async function stableDesktopGuardActive() {
  if (process.env.ALLOW_LEGACY_START_WITH_STABLE === "1") return false;
  return stableStartingLockActive() || (await stableRuntimeServicesHealthy());
}

async function stableRuntimeServicesHealthy() {
  const webPort = numberEnv("WEB_PORT", 3100);
  const apiPort = numberEnv("API_PORT", 3200);
  const mockPort = numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700);
  const webPids = getPortOwnerPids(webPort);
  const apiPids = getPortOwnerPids(apiPort);
  if (!webPids.length || !apiPids.length) return false;
  if (workspacePortOwnerMismatchReason("web", webPids) || workspacePortOwnerMismatchReason("api", apiPids)) return false;
  if (!(await httpOk(`http://127.0.0.1:${webPort}/`))) return false;
  const apiHealth = await getJson(`http://127.0.0.1:${apiPort}/api/health`);
  if (!apiHealth?.ok || !apiHealthUsesRuntimeDir(apiHealth, stableRuntimeDir)) return false;
  const integrationHealth = await getJson(`http://127.0.0.1:${apiPort}/api/integrations/design-platform/health`);
  if (realDesignMode) {
    return (
      integrationHealth?.adapter === "art_image_local" &&
      normalizeBaseUrl(integrationHealth.baseUrl) === normalizeBaseUrl(realDesignBaseUrl())
    );
  }
  const mockPids = getPortOwnerPids(mockPort);
  if (!mockPids.length || workspacePortOwnerMismatchReason("mock design", mockPids)) return false;
  return (
    integrationHealth?.ok &&
    integrationHealth.adapter === "standard_v1" &&
    normalizeBaseUrl(integrationHealth.baseUrl) === `http://127.0.0.1:${mockPort}`
  );
}

function stableStartingLockActive() {
  if (!fileFresh(stableStartingLockFile, 3600000)) return false;
  return stableRuntimeLauncherProcessActive(readNumericFile(stableRuntimeLauncherPidFile)) || findStableRuntimeLauncherProcesses().length > 0;
}

function fileFresh(file, maxAgeMs) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs <= maxAgeMs;
  } catch {
    return false;
  }
}

function heartbeatFresh(file, maxAgeMs) {
  try {
    const heartbeat = JSON.parse(fs.readFileSync(file, "utf8"));
    const updatedAt = Date.parse(String(heartbeat?.updatedAt || ""));
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > maxAgeMs) return false;
    return stableRuntimeLauncherProcessActive(Number(heartbeat?.pid)) || findStableRuntimeLauncherProcesses().length > 0;
  } catch {
    return false;
  }
}

function readNumericFile(file) {
  try {
    const value = Number(String(fs.readFileSync(file, "utf8")).trim());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function stableRuntimeLauncherProcessActive(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0 || numericPid === process.pid) return false;
  if (process.platform !== "win32") {
    try {
      process.kill(numericPid, 0);
      return true;
    } catch {
      return false;
    }
  }
  const commandLine = normalizePathText(getProcessCommandLinesByPid([String(numericPid)]).get(String(numericPid)) || "");
  return commandLine.includes(normalizePathText(desktopRoot)) && commandLine.includes("tools/stable-runtime-launcher.js");
}

function findStableRuntimeLauncherProcesses() {
  if (process.platform !== "win32") return [];
  const normalizedRoot = normalizePathText(desktopRoot);
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
