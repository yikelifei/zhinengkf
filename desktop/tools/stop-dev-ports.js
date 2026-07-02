"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(desktopRoot, ".runtime");
const pidFile = path.join(runtimeDir, "dev-ports.json");
const mockModeLockFile = path.join(runtimeDir, "mock-mode.lock");
const realModeLockFile = path.join(runtimeDir, "real-mode.lock");
const designPlatformConfigFile = path.join(runtimeDir, "design-platform-config.json");
const preserveRealModeLock = process.env.PRESERVE_REAL_MODE_LOCK === "1";
const forceProcessSweep = process.env.FORCE_PORTS_SWEEP === "1";
const skipStackStarterLaunchers = process.env.PORTS_STOP_SKIP_STACK_STARTERS === "1";
const protectedStarterMode = /^(mock|real)$/.test(process.env.PORTS_STACK_STARTER_MODE || "")
  ? process.env.PORTS_STACK_STARTER_MODE
  : "";
const protectedPids = buildProtectedPids();
const managedPorts = [
  numberEnv("WEB_PORT", 3100),
  numberEnv("API_PORT", 3200),
  numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700),
];

main();

function main() {
  const records = readPidFile();
  const entries = Object.values(records).filter((record) => record && record.pid);
  const recordedPids = new Set();
  const stoppedPids = new Set();
  const attemptedPids = new Set();

  if (!entries.length) {
    console.log("No launcher-recorded processes were found.");
    if (!forceProcessSweep && !hasManagedRuntimeState()) {
      cleanupRuntimeRecords();
      return;
    }
  } else {
    for (const record of entries) {
      if (!shouldStopRecordedProcess(record)) {
        console.log(`[skip] ${record.label || record.name} pid=${record.pid} no longer looks like this desktop service.`);
        continue;
      }
      console.log(`[stop] ${record.label || record.name} pid=${record.pid}`);
      recordedPids.add(String(record.pid));
      attemptedPids.add(String(record.pid));
      if (stopPid(record.pid)) stoppedPids.add(String(record.pid));
    }
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const attemptedBefore = attemptedPids.size;
    const stoppedBefore = stoppedPids.size;
    stopManagedProcessSweep(stoppedPids, attemptedPids, recordedPids);
    if (attemptedPids.size === attemptedBefore && stoppedPids.size === stoppedBefore) break;
    waitForNoManagedPortOwners(attempt === 3 ? 8000 : 2500);
    sleep(500);
  }

  const remaining = listManagedPortOwners();
  if (remaining.length) {
    for (const item of remaining) {
      console.log(`[warn] port=${item.port} is still occupied by PID ${item.pid}`);
    }
    console.log("[warn] Some ports are still in use. Close the listed PID, or run stop_desktop.bat as Administrator.");
    process.exitCode = 1;
    return;
  }

  cleanupRuntimeRecords();
}

function hasManagedRuntimeState() {
  if (fs.existsSync(mockModeLockFile) || fs.existsSync(realModeLockFile)) return true;
  if (listManagedPortOwners().length) return true;
  if (findManagedWrapperPids().length) return true;
  if (findManagedLauncherPids().length) return true;
  if (findManagedKeeperPids().length) return true;
  if (findManagedDirectShellPids().length) return true;
  return false;
}

function cleanupRuntimeRecords() {
  fs.rmSync(pidFile, { force: true });
  fs.rmSync(mockModeLockFile, { force: true });
  if (!preserveRealModeLock) fs.rmSync(realModeLockFile, { force: true });
  clearRuntimeDesignModeConfig();
  console.log("Launcher records were cleaned.");
}

function clearRuntimeDesignModeConfig() {
  // Keep designPlatformAccessToken, designPlatformCookie and designPlatformDeviceId across restarts.
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

function stopManagedProcessSweep(stoppedPids, attemptedPids, recordedPids) {
  stopManagedWrapperProcesses(stoppedPids, attemptedPids);
  stopManagedLauncherProcesses(stoppedPids, attemptedPids);
  stopManagedKeeperProcesses(stoppedPids, attemptedPids);
  stopManagedDirectShellProcesses(stoppedPids, attemptedPids);
  sleep(500);
  stopManagedPortOwners(stoppedPids, attemptedPids, recordedPids);
}

function stopManagedWrapperProcesses(stoppedPids, attemptedPids) {
  for (const pid of findManagedWrapperPids()) {
    if (protectedPids.has(pid)) continue;
    if (attemptedPids.has(pid) || stoppedPids.has(pid)) continue;
    console.log(`[stop:wrapper] pid=${pid}`);
    attemptedPids.add(pid);
    if (stopPid(pid)) stoppedPids.add(pid);
  }
}

function stopManagedLauncherProcesses(stoppedPids, attemptedPids) {
  for (const pid of findManagedLauncherPids()) {
    if (protectedPids.has(pid)) continue;
    if (attemptedPids.has(pid) || stoppedPids.has(pid)) continue;
    console.log(`[stop:launcher] pid=${pid}`);
    attemptedPids.add(pid);
    if (stopPid(pid)) stoppedPids.add(pid);
  }
}

function stopManagedKeeperProcesses(stoppedPids, attemptedPids) {
  for (const pid of findManagedKeeperPids()) {
    if (protectedPids.has(pid)) continue;
    if (attemptedPids.has(pid) || stoppedPids.has(pid)) continue;
    console.log(`[stop:keeper] pid=${pid}`);
    attemptedPids.add(pid);
    if (stopPid(pid)) stoppedPids.add(pid);
  }
}

function stopManagedDirectShellProcesses(stoppedPids, attemptedPids) {
  for (const pid of findManagedDirectShellPids()) {
    if (protectedPids.has(pid)) continue;
    if (attemptedPids.has(pid) || stoppedPids.has(pid)) continue;
    console.log(`[stop:direct] pid=${pid}`);
    attemptedPids.add(pid);
    if (stopPid(pid)) stoppedPids.add(pid);
  }
}

function findManagedWrapperPids() {
  if (process.platform !== "win32") return [];
  const normalizedRuntime = normalizePathText(runtimeDir);
  const normalizedRoot = normalizePathText(desktopRoot);
  const launcherPattern = /(launch|supervise|stable-supervise)-(mock|real)\.cmd/;
  const serviceWrapperPattern = /run-[^" ]+(-worker)?\.cmd/;
  const persistWrapperPattern = /(web|api|mock)-persist\.(out|err)\.log/;
  const directWrapperPattern =
    /node (node_modules\/next\/dist\/bin\/next dev apps\/web -p \d+|dist\/apps\/api\/main\.js|tools\/mock-design-platform\.js).*\.runtime\/logs\/(web|api|mock)-direct\./;
  const projectWebDevWrapperPattern = /next dev apps\/web -p \d+/;
  const projectWebBuildWrapperPattern = /node_modules\/next\/dist\/bin\/next build apps\/web/;
  const standaloneWebWrapperPattern =
    /apps\/web\/\.next\/standalone\/apps\/web.*node\s+server\.js|node(?:\.exe)?"?\s+.*apps\/web\/\.next\/standalone\/apps\/web\/server\.js/;
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"name = 'cmd.exe' OR name = 'node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout) return [];
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  const processes = Array.isArray(rows) ? rows : [rows];
  return processes
    .filter((item) => {
      const pid = String(item?.ProcessId || "");
      if (protectedPids.has(pid)) return false;
      const commandLine = normalizePathText(item?.CommandLine || "");
      const parentCommandLine = /"?node(?:\.exe)?"?\s+server\.js\b/.test(commandLine)
        ? normalizePathText(getParentCommandLine(pid))
        : "";
      const runtimeWrapper =
        commandLine.includes(normalizedRuntime) &&
        (serviceWrapperPattern.test(commandLine) || launcherPattern.test(commandLine));
      const projectWebDevWrapper = commandLine.includes(normalizedRoot) && projectWebDevWrapperPattern.test(commandLine);
      const projectWebBuildWrapper = commandLine.includes(normalizedRoot) && projectWebBuildWrapperPattern.test(commandLine);
      const projectStandaloneWebServer =
        /"?node(?:\.exe)?"?\s+server\.js\b/.test(commandLine) && parentCommandLine.includes(normalizedRoot);
      return (
        runtimeWrapper ||
        persistWrapperPattern.test(commandLine) ||
        directWrapperPattern.test(commandLine) ||
        projectWebDevWrapper ||
        projectWebBuildWrapper ||
        projectStandaloneWebServer ||
        standaloneWebWrapperPattern.test(commandLine)
      );
    })
    .map((item) => String(item.ProcessId || ""))
    .filter((pid) => /^\d+$/.test(pid));
}

function findManagedDirectShellPids() {
  if (process.platform !== "win32") return [];
  const normalizedRoot = normalizePathText(desktopRoot);
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$root = ${psQuote(normalizedRoot)}`,
    "$selfPid = $PID",
    "$items = Get-CimInstance Win32_Process -Filter \"name = 'powershell.exe'\" | Where-Object {",
    "  $_.ProcessId -ne $selfPid -and $_.CommandLine -and",
    "  ($cmd = ($_.CommandLine -replace '\\\\','/').ToLowerInvariant()) -and",
    "  (",
    "    ($cmd.Contains($root) -and",
    "      (",
    "        ($cmd.Contains('node_modules/next/dist/bin/next dev apps/web -p') -and $cmd.Contains('-noexit')) -or",
    "        ($cmd.Contains('start-process') -and",
    "          ($cmd.Contains('.runtime/logs/web-direct.') -or",
    "           $cmd.Contains('.runtime/logs/api-direct.') -or",
    "           $cmd.Contains('.runtime/logs/mock-direct.')))",
    "      )",
    "    ) -or",
    "    ($cmd.Contains($root) -and",
    "      $cmd.Contains('tools/start-dev-ports.js') -and",
    "      ($cmd.Contains('--mock-design') -or $cmd.Contains('--real-design') -or $cmd.Contains('--keep-alive')))",
    "  )",
    "} | Select-Object ProcessId,CommandLine",
    "if ($items) { $items | ConvertTo-Json -Compress }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  const processes = Array.isArray(rows) ? rows : [rows];
  return processes
    .map((item) => String(item.ProcessId || ""))
    .filter((pid) => /^\d+$/.test(pid));
}

function findManagedLauncherPids() {
  if (process.platform !== "win32") return [];
  const normalizedRoot = normalizePathText(desktopRoot);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout) return [];
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  const processes = Array.isArray(rows) ? rows : [rows];
  return processes
    .filter((item) => {
      const commandLine = normalizePathText(item?.CommandLine || "");
      if (commandLine.includes("tools/stop-dev-ports.js")) return false;
      const stackStarterMode = commandLine.includes("tools/ports-stack-starter.js") && commandLine.includes("--mock-design")
        ? "mock"
        : commandLine.includes("tools/ports-stack-starter.js") && commandLine.includes("--real-design")
          ? "real"
          : "";
      if (skipStackStarterLaunchers && stackStarterMode) return false;
      if (stackStarterMode) return !protectedStarterMode || stackStarterMode !== protectedStarterMode;
      if (
        commandLine.includes("tools/start-dev-ports.js") &&
        (commandLine.includes("--mock-design") || commandLine.includes("--real-design") || commandLine.includes("--keep-alive"))
      ) {
        return true;
      }
      if (
        commandLine.includes("tools/desktop-service-supervisor.js") &&
        commandLine.includes("--supervisor-child") &&
        (commandLine.includes("--mock-design") || commandLine.includes("--real-design"))
      ) {
        return true;
      }
      if (!commandLine.includes(normalizedRoot)) return false;
      const npmPortsMatch = commandLine.match(/npm(?:\.cmd|\/bin\/npm-cli\.js)"? run ports:(start|launch|keepalive|once)(:mock|:real)?/);
      if (npmPortsMatch) {
        if (skipStackStarterLaunchers && npmPortsMatch[1] === "launch") return false;
        const npmMode = npmPortsMatch[2] === ":real" ? "real" : npmPortsMatch[2] === ":mock" ? "mock" : "";
        return !protectedStarterMode || !npmMode || npmMode !== protectedStarterMode;
      }
      return /npm\.cmd"? run build:(api|web)/.test(commandLine) || /node_modules\/next\/dist\/bin\/next build apps\/web/.test(commandLine);
    })
    .map((item) => String(item.ProcessId || ""))
    .filter((pid) => /^\d+$/.test(pid));
}

function findManagedKeeperPids() {
  if (process.platform !== "win32") return [];
  const normalizedRoot = normalizePathText(desktopRoot);
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$root = ${psQuote(normalizedRoot)}`,
    "$selfPid = $PID",
    "$items = Get-CimInstance Win32_Process -Filter \"name = 'powershell.exe'\" | Where-Object {",
    "  $_.ProcessId -ne $selfPid -and $_.CommandLine -and",
    "  ($cmd = ($_.CommandLine -replace '\\\\','/').ToLowerInvariant()) -and",
    "  $cmd.Contains($root) -and",
    "  $cmd.Contains('tools/start-dev-ports.js') -and",
    "  ($cmd.Contains('--mock-design') -or $cmd.Contains('--real-design') -or $cmd.Contains('--keep-alive')) -and",
    "  ($cmd.Contains('start-sleep -seconds 3600') -or $cmd.Contains('launcher-mock.log') -or $cmd.Contains('launcher-real.log'))",
    "} | Select-Object ProcessId,CommandLine",
    "if ($items) { $items | ConvertTo-Json -Compress }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  const processes = Array.isArray(rows) ? rows : [rows];
  return processes
    .map((item) => String(item.ProcessId || ""))
    .filter((pid) => /^\d+$/.test(pid));
}

function stopManagedPortOwners(stoppedPids, attemptedPids, recordedPids) {
  for (const port of managedPorts) {
    const pids = getPortOwnerPids(port).filter((pid) => !stoppedPids.has(pid));
    for (const pid of pids) {
      if (protectedPids.has(pid)) continue;
      if (attemptedPids.has(pid)) continue;
      if (!recordedPids.has(pid) && !isManagedProcess(pid)) {
        console.log(`[warn] port=${port} pid=${pid} does not look like this desktop app. It was not stopped automatically.`);
        continue;
      }
      console.log(`[stop:port] port=${port} pid=${pid}`);
      attemptedPids.add(pid);
      if (stopPid(pid)) stoppedPids.add(pid);
    }
  }
}

function stopPid(pid) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
    if (result.status !== 0) {
      const message = String(result.stderr || result.stdout || "unknown error").trim();
      if (stopPidWithPowerShell(pid)) return true;
      console.log(`[warn] failed to stop pid=${pid}: ${message}`);
      return false;
    }
    return true;
  }
  try {
    process.kill(Number(pid), "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function buildProtectedPids() {
  const seeds = [process.pid, process.ppid, process.env.PORTS_STACK_STARTER_PID, process.env.PORTS_STACK_STARTER_PARENT_PID]
    .map((value) => String(value || ""))
    .filter((value) => /^\d+$/.test(value));
  const pids = new Set(seeds);
  const parentByPid = getParentPidMap();
  for (const seed of seeds) {
    for (const ancestor of collectAncestorPids(seed, parentByPid)) {
      pids.add(ancestor);
    }
  }
  return pids;
}

function collectAncestorPids(pid, parentByPid = null) {
  const ancestors = [];
  let current = String(pid || "");
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = parentByPid ? parentByPid.get(current) : getParentPid(current);
    if (!parent || ancestors.includes(parent)) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

function getParentPidMap() {
  if (process.platform !== "win32") return new Map();
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !String(result.stdout || "").trim()) return new Map();
  try {
    const rows = JSON.parse(result.stdout);
    return (Array.isArray(rows) ? rows : [rows]).reduce((map, item) => {
      const pid = String(item?.ProcessId || "");
      const parent = String(item?.ParentProcessId || "");
      if (/^\d+$/.test(pid) && /^\d+$/.test(parent) && pid !== parent) map.set(pid, parent);
      return map;
    }, new Map());
  } catch {
    return new Map();
  }
}

function getParentPid(pid) {
  if (process.platform !== "win32") return "";
  const safePid = Number(pid);
  if (!Number.isFinite(safePid)) return "";
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter ${psQuote(`ProcessId = ${safePid}`)}`,
    "if ($p) { $p.ParentProcessId }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
  });
  const parent = String(result.stdout || "").trim();
  return result.status === 0 && /^\d+$/.test(parent) && parent !== String(safePid) ? parent : "";
}

function stopPidWithPowerShell(pid) {
  const safePid = Number(pid);
  if (!Number.isFinite(safePid)) return false;
  const script = [
    `$targetId = ${safePid}`,
    "$all = Get-CimInstance Win32_Process",
    "$childrenByParent = @{}",
    "foreach ($p in $all) {",
    "  $parentKey = [string]$p.ParentProcessId",
    "  if (-not $childrenByParent.ContainsKey($parentKey)) { $childrenByParent[$parentKey] = @() }",
    "  $childrenByParent[$parentKey] += $p",
    "}",
    "$ordered = New-Object System.Collections.Generic.List[int]",
    "function Add-Descendants([int]$parentId) {",
    "  $key = [string]$parentId",
    "  if (-not $childrenByParent.ContainsKey($key)) { return }",
    "  foreach ($child in $childrenByParent[$key]) {",
    "    Add-Descendants ([int]$child.ProcessId)",
    "    $ordered.Add([int]$child.ProcessId)",
    "  }",
    "}",
    "Add-Descendants $targetId",
    "$ordered.Add($targetId)",
    "$stopped = $false",
    "foreach ($id in $ordered) {",
    "  try {",
    "    Stop-Process -Id $id -Force -ErrorAction Stop",
    "    $stopped = $true",
    "  } catch {",
    "    if (Get-Process -Id $id -ErrorAction SilentlyContinue) { throw }",
    "  }",
    "}",
    "if (-not $stopped -and (Get-Process -Id $targetId -ErrorAction SilentlyContinue)) { throw 'process still running' }",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    { encoding: "utf8" },
  );
  return result.status === 0;
}

function shouldStopRecordedProcess(record) {
  const pid = String(record.pid || "");
  if (!/^\d+$/.test(pid)) return false;
  if (isManagedCommandLine(pid)) return true;
  const port = Number(record.port);
  if (!Number.isFinite(port)) return false;
  return getPortOwnerPids(port).includes(pid);
}

function isManagedProcess(pid) {
  return isManagedCommandLine(pid);
}

function isManagedCommandLine(pid) {
  const commandLine = getCommandLine(pid).toLowerCase();
  if (!commandLine) return false;
  const normalizedCommand = normalizePathText(commandLine);
  const normalizedRoot = normalizePathText(desktopRoot);
  if (normalizedCommand.includes(normalizedRoot)) return true;
  const normalizedParentCommand = normalizePathText(getParentCommandLine(pid));
  if (
    /"?node(?:\.exe)?"?\s+server\.js\b/.test(normalizedCommand) &&
    (normalizedParentCommand.includes("apps/web/.next/standalone/apps/web") || normalizedParentCommand.includes(normalizedRoot))
  ) {
    return true;
  }
  return [
    "tools/mock-design-platform.js",
    "dist/apps/api/main.js",
    "apps/web/.next/standalone/apps/web/server.js",
    "next/dist/server/lib/start-server.js",
    "node_modules/next/dist/bin/next",
  ].some((marker) => normalizedCommand.includes(marker));
}

function normalizePathText(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function getCommandLine(pid) {
  if (process.platform !== "win32") return "";
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter ${psQuote(`ProcessId = ${Number(pid)}`)}`,
    "if ($p) { $p.CommandLine }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function getParentCommandLine(pid) {
  if (process.platform !== "win32") return "";
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter ${psQuote(`ProcessId = ${Number(pid)}`)}`,
    "if ($p) {",
    "  $parent = Get-CimInstance Win32_Process -Filter \"ProcessId = $($p.ParentProcessId)\"",
    "  if ($parent) { $parent.CommandLine }",
    "}",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function getProcessName(pid) {
  if (process.platform !== "win32") return "";
  const script = [
    `$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue`,
    "if ($p) { $p.ProcessName }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function waitForNoManagedPortOwners(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!listManagedPortOwners().length) return true;
    sleep(500);
  }
  return false;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function listManagedPortOwners() {
  return managedPorts.flatMap((port) => getPortOwnerPids(port).map((pid) => ({ port, pid })));
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

function readPidFile() {
  try {
    return JSON.parse(fs.readFileSync(pidFile, "utf8"));
  } catch {
    return {};
  }
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
