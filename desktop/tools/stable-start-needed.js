"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const requiredPorts = [3100, 3200, 3700];
const root = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR ? path.resolve(process.env.DESKTOP_RUNTIME_DIR) : path.join(root, ".runtime-stable");
const heartbeatFile = path.join(runtimeDir, "keep-alive.json");
const lockFile = path.join(runtimeDir, "stable-runtime-launcher.pid");
const result = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
if (result.status !== 0 || !result.stdout) process.exit(1);
const listening = new Set();
for (const line of result.stdout.split(/\r?\n/)) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) continue;
  if (!/LISTENING/i.test(parts[3])) continue;
  for (const port of requiredPorts) {
    if (parts[1].endsWith(`:${port}`)) listening.add(port);
  }
}
if (!requiredPorts.every((port) => listening.has(port))) process.exit(1);

const apiHealth = requestJson("http://127.0.0.1:3200/api/health");
if (!canonicalPath(apiHealth?.localStore?.path).startsWith(canonicalPath(runtimeDir))) process.exit(1);

const designHealth = requestJson("http://127.0.0.1:3700/v1/health");
if (designHealth?.ok !== true || designHealth?.service !== "mock-design-platform") process.exit(1);

const heartbeat = readJsonFile(heartbeatFile);
const heartbeatPid = Number(heartbeat?.pid);
const heartbeatUpdatedAt = Date.parse(String(heartbeat?.updatedAt || ""));
if (!Number.isFinite(heartbeatPid) || heartbeatPid <= 0) process.exit(1);
if (!Number.isFinite(heartbeatUpdatedAt) || Date.now() - heartbeatUpdatedAt > 30000) process.exit(1);
const lockPid = Number(readTextFile(lockFile));
if (lockPid !== heartbeatPid || !isPidAlive(heartbeatPid)) process.exit(1);
const launcherCommandLine = normalize(commandLineForPid(heartbeatPid));
if (launcherCommandLine && !launcherCommandLine.includes("stable-runtime-launcher.js")) process.exit(1);

process.exit(0);

function requestJson(url) {
  try {
    const response = spawnSync("curl.exe", ["-s", "--max-time", "2", url], { encoding: "utf8", windowsHide: true });
    if (response.status !== 0 || !response.stdout) return null;
    return JSON.parse(response.stdout);
  } catch {
    return null;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
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

function commandLineForPid(pid) {
  if (process.platform !== "win32") return "";
  const response = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Get-CimInstance Win32_Process -Filter \"ProcessId = ${Number(pid)}\" | Select-Object -ExpandProperty CommandLine`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 2000 },
  );
  return response.status === 0 ? String(response.stdout || "") : "";
}

function normalize(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function canonicalPath(value) {
  try {
    return normalize(fs.realpathSync.native(String(value || "")));
  } catch {
    return normalize(value);
  }
}
