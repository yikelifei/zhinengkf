"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const webPort = numberEnv("WEB_PORT", 3100);
const root = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
  ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
  : path.join(root, ".runtime");
const buildLockFile = path.join(runtimeDir, "web-build.lock");
const keepAliveHeartbeatFile = path.join(runtimeDir, "keep-alive.json");
const stableKeepAliveHeartbeatFile = path.join(root, ".runtime-stable", "keep-alive.json");
const stableStartingLockFile = path.join(root, ".runtime-stable", "stable-starting.lock");
const nextDir = path.join(root, "apps", "web", ".next");
const nextLockFile = path.join(root, "apps", "web", ".next", "lock");

main();

function main() {
  buildDiagnostic("start");
  const releaseBuildLock = acquireBuildLock();
  process.on("exit", releaseBuildLock);
  if (stableStartingLockIsFresh() && process.env.ALLOW_WEB_BUILD_WITH_FRESH_HEARTBEAT !== "1") {
    console.log("[blocked] Stable desktop startup is in progress; refusing to rebuild web assets.");
    console.log("          Wait for startup to finish, or run npm.cmd run ports:stop first.");
    process.exitCode = 1;
    return;
  }
  const owners = getPortOwnerPids(webPort);
  if (owners.length) {
    console.log(`[blocked] Web port ${webPort} is currently used by PID ${owners.join(", ")}.`);
    console.log("          Stop the desktop services before building web assets:");
    console.log("          npm.cmd run ports:stop");
    process.exitCode = 1;
    return;
  }
  if (stableRuntimeHeartbeatIsFresh() && process.env.ALLOW_WEB_BUILD_WITH_FRESH_HEARTBEAT !== "1") {
    console.log("[blocked] Stable desktop heartbeat is fresh; refusing to rebuild web assets while the runtime may be restarting.");
    console.log("          Run npm.cmd run ports:stop first, or use start-stable-desktop.cmd which stops the stack before rebuilding.");
    process.exitCode = 1;
    return;
  }

  let activeBuildPids = findProjectNextBuildPids();
  if (activeBuildPids.length) {
    waitForProjectNextBuildPidsToExit(30);
    activeBuildPids = findProjectNextBuildPids();
  }
  if (activeBuildPids.length) {
    console.log(`[blocked] Next build is already running for this project: PID ${activeBuildPids.join(", ")}.`);
    console.log("          Wait for it to finish, or run npm.cmd run ports:stop to clear stale build workers.");
    process.exitCode = 1;
    return;
  }
  removeStaleNextBuildLock();
  buildDiagnostic("after stale next lock cleanup");
  if (process.env.FORCE_WEB_CLEAN_BUILD === "1") {
    resetNextBuildState();
  }
  if (standaloneServerExists() && productionBuildReady() && !webBuildIsStale()) {
    run(process.execPath, ["tools/sync-web-standalone-assets.js"]);
    buildDiagnostic("after existing standalone sync");
    return;
  }
  if (!standaloneServerExists() && productionBuildReady()) {
    writeStableStandaloneServer();
    run(process.execPath, ["tools/sync-web-standalone-assets.js"]);
    buildDiagnostic("after stable standalone sync");
    return;
  }
  if (fs.existsSync(nextDir) && !productionBuildReady()) {
    resetNextBuildState({ force: true });
  }
  runNextBuild();
  buildDiagnostic("after next build");
  run(process.execPath, ["tools/sync-web-standalone-assets.js"]);
  buildDiagnostic("after standalone sync");
}

function acquireBuildLock() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  for (;;) {
    try {
      const fd = fs.openSync(buildLockFile, "wx");
      fs.writeFileSync(
        fd,
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
        "utf8",
      );
      fs.closeSync(fd);
      return () => removeBuildLockForCurrentProcess();
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const ownerPid = readBuildLockPid();
      if (ownerPid && isProjectWebBuildProcessAlive(ownerPid)) {
        console.log(`[blocked] Web build is already running under PID ${ownerPid}.`);
        console.log("          Wait for it to finish, or run npm.cmd run ports:stop to clear stale startup workers.");
        process.exit(1);
      }
      const activeBuildPids = findProjectNextBuildPids();
      if (activeBuildPids.length) {
        console.log(`[blocked] Web build is already running for this project: PID ${activeBuildPids.join(", ")}.`);
        console.log("          Wait for it to finish, or run npm.cmd run ports:stop to clear stale startup workers.");
        process.exit(1);
      }
      fs.rmSync(buildLockFile, { force: true });
      console.log(`[warn] Removed stale web build lock: ${path.relative(root, buildLockFile)}`);
    }
  }
}

function readBuildLockPid() {
  try {
    const parsed = JSON.parse(fs.readFileSync(buildLockFile, "utf8"));
    const pid = Number(parsed?.pid);
    return Number.isFinite(pid) ? pid : 0;
  } catch {
    return 0;
  }
}

function removeBuildLockForCurrentProcess() {
  if (readBuildLockPid() !== process.pid) return;
  fs.rmSync(buildLockFile, { force: true });
}

function buildDiagnostic(label) {
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.appendFileSync(
      path.join(runtimeDir, "build-web-diagnostic.log"),
      `[${new Date().toISOString()}] pid=${process.pid} ${label}\n`,
      "utf8",
    );
  } catch {
    // Diagnostics must not block building web assets.
  }
  if (process.env.WEB_BUILD_DIAGNOSTICS !== "1") return;
  const pids = findProjectNextBuildPids();
  const lockState = fs.existsSync(nextLockFile) ? "next-lock" : "no-next-lock";
  const standaloneState = standaloneServerExists() ? "standalone-ready" : "standalone-missing";
  console.log(`[build:diagnostic] ${label}: ${lockState}, ${standaloneState}, nextPids=${pids.join(",") || "-"}`);
}

function runNextBuild() {
  const args = ["node_modules/next/dist/bin/next", "build", "apps/web", "--webpack"];
  buildDiagnostic("before next build");
  const result = runWithCapturedOutput(process.execPath, args);
  waitForProjectNextBuildPidsToExit(90);
  waitForBuildOutputReady(60);
  buildDiagnostic("after next build command");
  if (result.status === 0 && !hasNextBuildErrorOutput(result) && standaloneServerExists()) return;
  if (productionBuildReady() && !hasNextBuildErrorOutput(result)) {
    writeStableStandaloneServer();
    return;
  }
  if (result.status !== 0 && !isRetryableNextBuildRace(result) && !hasNextBuildErrorOutput(result)) process.exit(result.status || 1);
  console.log("[warn] Next build failed or exited before standalone output was complete; retrying once with a clean build state.");
  terminateProjectNextBuildPids();
  waitForProjectNextBuildPidsToExit();
  removeStaleNextBuildLock();
  resetNextBuildState({ force: true });
  buildDiagnostic("before next build retry");
  const retry = runWithCapturedOutput(process.execPath, args);
  waitForProjectNextBuildPidsToExit(90);
  waitForBuildOutputReady(60);
  buildDiagnostic("after next build retry command");
  if (retry.status === 0 && !hasNextBuildErrorOutput(retry) && standaloneServerExists()) return;
  if (productionBuildReady() && !hasNextBuildErrorOutput(retry)) {
    writeStableStandaloneServer();
    return;
  }
  process.exit(retry.status || 1);
}

function standaloneServerExists() {
  return fs.existsSync(path.join(nextDir, "standalone", "apps", "web", "server.js"));
}

function productionBuildReady() {
  const buildId = readBuildId();
  if (!buildId) return false;
  return [
    "BUILD_ID",
    "build-manifest.json",
    "prerender-manifest.json",
    "required-server-files.json",
    "routes-manifest.json",
    path.join("server", "app-paths-manifest.json"),
    path.join("server", "pages-manifest.json"),
    path.join("static", buildId, "_buildManifest.js"),
    path.join("static", buildId, "_ssgManifest.js"),
  ].every((item) => fs.existsSync(path.join(nextDir, item)));
}

function readBuildId() {
  try {
    return fs.readFileSync(path.join(nextDir, "BUILD_ID"), "utf8").trim();
  } catch {
    return "";
  }
}

function webBuildIsStale() {
  const buildIdPath = path.join(nextDir, "BUILD_ID");
  if (!fs.existsSync(buildIdPath)) return true;
  const builtAt = fs.statSync(buildIdPath).mtimeMs;
  return [
    "package.json",
    "package-lock.json",
    path.join("apps", "web", "next.config.js"),
    path.join("apps", "web", "src"),
    path.join("apps", "web", "public"),
  ].some((item) => pathHasFileNewerThan(path.join(root, item), builtAt));
}

function pathHasFileNewerThan(target, timestamp) {
  if (!fs.existsSync(target)) return false;
  const stats = fs.statSync(target);
  if (stats.isFile()) return stats.mtimeMs > timestamp;
  if (!stats.isDirectory()) return false;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (pathHasFileNewerThan(entryPath, timestamp)) return true;
    } else if (entry.isFile() && fs.statSync(entryPath).mtimeMs > timestamp) {
      return true;
    }
  }
  return false;
}

function removeStaleNextBuildLock() {
  if (!fs.existsSync(nextLockFile)) return;
  if (findProjectNextBuildPids().length) return;
  fs.rmSync(nextLockFile, { force: true });
  console.log(`[warn] Removed stale Next build lock: ${path.relative(root, nextLockFile)}`);
}

function resetNextBuildState(options = {}) {
  if (!fs.existsSync(nextDir)) return;
  if (!options.force && findProjectNextBuildPids().length) return;
  buildDiagnostic(`removing ${path.relative(root, nextDir)}`);
  removeDirectoryWithRetry(nextDir);
  console.log(`[build] Removed previous Next build directory: ${path.relative(root, nextDir)}`);
}

function writeStableStandaloneServer() {
  const standaloneWebRoot = path.join(nextDir, "standalone", "apps", "web");
  const serverPath = path.join(standaloneWebRoot, "server.js");
  fs.mkdirSync(standaloneWebRoot, { recursive: true });
  fs.writeFileSync(
    serverPath,
    `"use strict";\n` +
      `const path = require("node:path");\n` +
      `const root = path.resolve(__dirname, "..", "..", "..", "..", "..", "..");\n` +
      `const requiredServerFiles = require(path.join(root, "apps", "web", ".next", "required-server-files.json"));\n` +
      `const dir = __dirname;\n` +
      `const currentPort = parseInt(process.env.PORT, 10) || 3100;\n` +
      `const hostname = process.env.HOSTNAME || "127.0.0.1";\n` +
      `let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);\n` +
      `const keepAlive = setInterval(() => undefined, 60000);\n` +
      `keepAlive.ref();\n` +
      `process.env.NODE_ENV = "production";\n` +
      `process.chdir(__dirname);\n` +
      `const nextConfig = { ...requiredServerFiles.config, distDir: "./.next" };\n` +
      `process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);\n` +
      `require("next");\n` +
      `const { startServer } = require("next/dist/server/lib/start-server");\n` +
      `if (Number.isNaN(keepAliveTimeout) || !Number.isFinite(keepAliveTimeout) || keepAliveTimeout < 0) keepAliveTimeout = undefined;\n` +
      `startServer({ dir, isDev: false, config: nextConfig, hostname, port: currentPort, allowRetry: false, keepAliveTimeout })\n` +
      `  .catch((error) => { console.error(error); clearInterval(keepAlive); process.exit(1); });\n`,
    "utf8",
  );
  console.log(`[warn] Native Next standalone output was not emitted; wrote stable startServer wrapper: ${path.relative(root, serverPath)}`);
}

function removeDirectoryWithRetry(target) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(target, { force: true, recursive: true, maxRetries: 5, retryDelay: 250 });
      if (!fs.existsSync(target)) return;
    } catch (error) {
      lastError = error;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 + attempt * 250);
  }
  if (fs.existsSync(target)) throw lastError || new Error(`Failed to remove ${target}`);
}

function waitForProjectNextBuildPidsToExit(timeoutSeconds = 60) {
  const attempts = Math.max(1, Math.round(Number(timeoutSeconds || 60) * 2));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!findProjectNextBuildPids().length) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  const pids = findProjectNextBuildPids();
  if (pids.length) {
    console.log(`[warn] Next build workers are still exiting after ${timeoutSeconds} seconds: PID ${pids.join(", ")}.`);
  }
}

function waitForBuildOutputReady(timeoutSeconds = 60) {
  const attempts = Math.max(1, Math.round(Number(timeoutSeconds || 60) * 2));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (standaloneServerExists()) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
}

function terminateProjectNextBuildPids() {
  const pids = findProjectNextBuildPids();
  if (!pids.length) return;
  console.log(`[warn] Stopping leftover Next build workers before retry: PID ${pids.join(", ")}.`);
  if (process.platform !== "win32") {
    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        // The process may have exited between scan and termination.
      }
    }
    return;
  }
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Stop-Process -Id ${pids.map((pid) => Number(pid)).join(",")} -Force -ErrorAction SilentlyContinue`,
    ],
    { encoding: "utf8" },
  );
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
  if (result.error) console.error(`[build] ${command} failed to start: ${result.error.message}`);
  if (result.signal) console.error(`[build] ${command} exited by signal: ${result.signal}`);
  return result;
}

function runWithInheritedOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  return { status: result.status, stdout: "", stderr: "" };
}

function isRetryableNextBuildRace(result) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status === 0) return !standaloneServerExists();
  if (/Another next build process is already running/.test(output)) return true;
  if ((fs.existsSync(nextLockFile) && !findProjectNextBuildPids().length) || !standaloneServerExists()) return true;
  return (
    /(ENOENT|MODULE_NOT_FOUND|Cannot find module)/.test(output) &&
    /\.next/.test(output) &&
    /(manifest|_ssgManifest|\.nft\.json|diagnostics[\\\/]build-diagnostics\.json|lock)/.test(output)
  );
}

function hasNextBuildErrorOutput(result) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return /Build error occurred|Error:\s+(ENOENT|MODULE_NOT_FOUND)|Cannot find module/.test(output);
}

function readFreshestHeartbeat(files) {
  const heartbeats = [];
  for (const file of files) {
    try {
      heartbeats.push(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {}
  }
  return heartbeats
    .filter((heartbeat) => heartbeat && heartbeat.updatedAt)
    .sort((left, right) => Date.parse(String(right.updatedAt)) - Date.parse(String(left.updatedAt)))[0] || null;
}
function stableStartingLockIsFresh() {
  try {
    const stat = fs.statSync(stableStartingLockFile);
    return Date.now() - stat.mtimeMs <= 3600000;
  } catch {
    return false;
  }
}
function stableRuntimeHeartbeatIsFresh() {
  try {
    const heartbeat = readFreshestHeartbeat([keepAliveHeartbeatFile, stableKeepAliveHeartbeatFile]);
    const updatedAt = Date.parse(String(heartbeat?.updatedAt || ""));
    if (!Number.isFinite(updatedAt)) return false;
    if (Date.now() - updatedAt > 3600000) return false;
    return true;
  } catch {
    return false;
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
      const pid = Number(item?.ProcessId);
      if (!Number.isFinite(pid) || pid === process.pid) return false;
      const commandLine = normalizePathText(item?.CommandLine || "");
      return isProjectNextBuildProcess(commandLine, normalizedRoot);
    })
    .map((item) => String(item.ProcessId || ""))
    .filter((pid) => /^\d+$/.test(pid) && Number(pid) !== process.pid);
}

function isProjectNextBuildProcess(commandLine, normalizedRoot) {
  if (!commandLine.includes(normalizedRoot)) return false;
  if (isNextBuildCommand(commandLine)) return true;
  if (commandLine.includes("node_modules/next/dist/compiled/jest-worker/processchild.js")) return true;
  if (commandLine.includes("typescript/bin/tsc") && commandLine.includes("apps/web/tsconfig.json")) return true;
  return isNextBuildCommand(commandLine);
}

function isProjectWebBuildProcessAlive(pid) {
  if (!Number.isFinite(Number(pid))) return false;
  if (process.platform !== "win32") {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  const normalizedRoot = normalizePathText(root);
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !String(result.stdout || "").trim()) return false;
  try {
    const item = JSON.parse(result.stdout);
    const commandLine = normalizePathText(item?.CommandLine || "");
    if (!commandLine.includes(normalizedRoot)) return false;
    if (commandLine.includes("tools/build-web.js")) return true;
    return isProjectNextBuildProcess(commandLine, normalizedRoot);
  } catch {
    return false;
  }
}

function isNextBuildCommand(commandLine) {
  return (
    commandLine.includes("node_modules/next/dist/bin/next") &&
    commandLine.includes("build") &&
    commandLine.includes("apps/web")
  );
}

function normalizePathText(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
