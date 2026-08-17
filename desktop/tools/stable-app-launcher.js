"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const args = new Set(process.argv.slice(2));
const repairMode = args.has("--repair");
const root = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
  ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
  : path.join(root, ".runtime-stable");
const logFile = path.join(runtimeDir, "stable-app-launch.log");
const lockFile = path.join(runtimeDir, "stable-app-launch.pid");
let lockOwned = false;

main().catch((error) => {
  append(`fatal ${error?.stack || error?.message || error}`);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  if (!acquireLaunchLock()) return;
  append(`launch requested mode=${repairMode ? "repair" : "open"} pid=${process.pid}`);

  const prepare = runCmd(path.join(root, "prepare-stable-dependencies.cmd"), [], "prepare dependencies");
  if (prepare.status !== 0) throw new Error(`dependency preparation failed exit=${prepare.status}`);

  if (repairMode) {
    const stop = runCmd(path.join(root, "stop-stable-desktop.cmd"), [], "stop managed runtime");
    if (stop.status !== 0) append(`stop completed with exit=${stop.status}; readiness checks will decide recovery`);
  }

  let doctor = repairMode ? { status: 1 } : runDoctor(5000, "initial readiness");
  if (doctor.status !== 0) {
    const start = runCmd(path.join(root, "start-stable-desktop.cmd"), [], "start hidden runtime");
    if (start.status !== 0) append(`hidden runtime starter exit=${start.status}; waiting for final readiness evidence`);
    doctor = runDoctor(120000, "final readiness");
  }
  if (doctor.status !== 0) {
    throw new Error(`desktop services are not ready; inspect ${logFile}`);
  }

  const electron = run(process.execPath, [path.join(root, "tools", "launch-stable-electron.js")], "launch Electron");
  if (electron.status !== 0) throw new Error(`Electron launcher failed exit=${electron.status}`);
  append("launch completed");
}

function runDoctor(waitMs, label) {
  return run(
    process.execPath,
    [
      path.join(root, "tools", "stable-desktop-doctor.js"),
      "--wait",
      `--wait-ms=${waitMs}`,
      "--interval-ms=1000",
    ],
    label,
  );
}

function runCmd(scriptPath, scriptArgs, label) {
  return run(process.env.ComSpec || "cmd.exe", ["/d", "/c", scriptPath, ...scriptArgs], label);
}

function run(command, commandArgs, label) {
  append(`${label} started`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: {
      ...process.env,
      DESKTOP_ROOT: root,
      DESKTOP_RUNTIME_DIR: runtimeDir,
    },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.stdout) appendOutput(label, "stdout", result.stdout);
  if (result.stderr) appendOutput(label, "stderr", result.stderr);
  if (result.error) append(`${label} error=${result.error.message || result.error}`);
  append(`${label} exit=${result.status ?? "unknown"}`);
  return result;
}

function appendOutput(label, stream, value) {
  const text = String(value).trim();
  if (!text) return;
  append(`${label} ${stream}:\n${text}`);
}

function acquireLaunchLock() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = fs.openSync(lockFile, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n`, "utf8");
      } finally {
        fs.closeSync(fd);
      }
      lockOwned = true;
      process.on("exit", releaseLaunchLock);
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existingPid = readLockPid();
      const ageMs = fileAgeMs(lockFile);
      if ((existingPid > 0 && isPidAlive(existingPid) && ageMs < 300000) || (!existingPid && ageMs < 5000)) {
        append(`duplicate launch skipped existingPid=${existingPid || "initializing"} ageMs=${Math.round(ageMs)}`);
        return false;
      }
      fs.rmSync(lockFile, { force: true });
      append(`removed stale launch lock pid=${existingPid || "unknown"} ageMs=${Math.round(ageMs)}`);
    }
  }
  throw new Error(`could not acquire desktop launch lock: ${lockFile}`);
}

function releaseLaunchLock() {
  if (!lockOwned) return;
  try {
    if (fs.readFileSync(lockFile, "utf8").trim() === String(process.pid)) fs.rmSync(lockFile, { force: true });
  } catch {}
  lockOwned = false;
}

function readLockPid() {
  try {
    const pid = Number(fs.readFileSync(lockFile, "utf8").trim());
    return Number.isFinite(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

function fileAgeMs(filePath) {
  try {
    return Math.max(0, Date.now() - fs.statSync(filePath).mtimeMs);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isPidAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function append(message) {
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {}
}
