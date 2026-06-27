"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(desktopRoot, ".runtime");
const pidFile = path.join(runtimeDir, "dev-ports.json");
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

  stopManagedPortOwners(stoppedPids, attemptedPids, recordedPids);
  waitForNoManagedPortOwners(8000);

  const remaining = listManagedPortOwners();
  if (remaining.length) {
    for (const item of remaining) {
      console.log(`[warn] port=${item.port} is still occupied by PID ${item.pid}`);
    }
    console.log("[warn] Some ports are still in use. Close the listed PID, or run stop_desktop.bat as Administrator.");
    process.exitCode = 1;
    return;
  }

  fs.rmSync(pidFile, { force: true });
  console.log("Launcher records were cleaned.");
}

function stopManagedPortOwners(stoppedPids, attemptedPids, recordedPids) {
  for (const port of managedPorts) {
    const pids = getPortOwnerPids(port).filter((pid) => !stoppedPids.has(pid));
    for (const pid of pids) {
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
  return commandLine.includes(desktopRoot.toLowerCase());
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
