"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const webPort = numberEnv("WEB_PORT", 3100);
const root = process.cwd();
const nextDir = path.join(root, "apps", "web", ".next");
const nextLockFile = path.join(root, "apps", "web", ".next", "lock");

main();

function main() {
  const owners = getPortOwnerPids(webPort);
  if (owners.length) {
    console.log(`[blocked] Web port ${webPort} is currently used by PID ${owners.join(", ")}.`);
    console.log("          Stop the desktop services before building web assets:");
    console.log("          npm.cmd run ports:stop");
    process.exitCode = 1;
    return;
  }

  const activeBuildPids = findProjectNextBuildPids();
  if (activeBuildPids.length) {
    console.log(`[blocked] Next build is already running for this project: PID ${activeBuildPids.join(", ")}.`);
    console.log("          Wait for it to finish, or run npm.cmd run ports:stop to clear stale build workers.");
    process.exitCode = 1;
    return;
  }
  removeStaleNextBuildLock();
  resetNextBuildState();
  runNextBuild();
  run(process.execPath, ["tools/sync-web-standalone-assets.js"]);
}

function runNextBuild() {
  const args = ["node_modules/next/dist/bin/next", "build", "apps/web"];
  const result = runWithCapturedOutput("node", args);
  if (result.status === 0) return;
  if (!isRetryableNextBuildRace(result)) process.exit(result.status || 1);
  console.log("[warn] Next build failed while copying generated .next files; retrying once with a clean build state.");
  removeStaleNextBuildLock();
  resetNextBuildState();
  const retry = runWithCapturedOutput("node", args);
  if (retry.status !== 0) process.exit(retry.status || 1);
}

function removeStaleNextBuildLock() {
  if (!fs.existsSync(nextLockFile)) return;
  if (findProjectNextBuildPids().length) return;
  fs.rmSync(nextLockFile, { force: true });
  console.log(`[warn] Removed stale Next build lock: ${path.relative(root, nextLockFile)}`);
}

function resetNextBuildState() {
  if (!fs.existsSync(nextDir)) return;
  if (findProjectNextBuildPids().length) return;
  fs.rmSync(nextDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 250 });
  console.log(`[build] Removed previous Next build directory: ${path.relative(root, nextDir)}`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function runWithCapturedOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
    shell: false,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function isRetryableNextBuildRace(result) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return /Build error occurred/.test(output) && /ENOENT/.test(output) && /[\\\/]\.next[\\\/]/.test(output);
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

function findProjectNextBuildPids() {
  if (process.platform !== "win32") return [];
  const normalizedRoot = normalizePathText(root);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  return (Array.isArray(rows) ? rows : [rows])
    .filter((item) => {
      const commandLine = normalizePathText(item?.CommandLine || "");
      return commandLine.includes(normalizedRoot) && commandLine.includes("node_modules/next/dist/bin/next") && commandLine.includes("build");
    })
    .map((item) => String(item.ProcessId || ""))
    .filter((pid) => /^\d+$/.test(pid));
}

function normalizePathText(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
