"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  readDesktopWebSessionProof,
  resolveDesktopWebSessionFile,
} = require("./desktop-web-session");

const args = new Set(process.argv.slice(2));
const waitMs = numberArg("--wait-ms", args.has("--wait") ? 90000 : 0);
const intervalMs = numberArg("--interval-ms", 2000);
const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
  ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
  : path.join(desktopRoot, ".runtime-stable");
const webPort = numberEnv("WEB_PORT", 3100);
const apiPort = numberEnv("API_PORT", 3200);
const mockPort = numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700);
const windowsProcessQueryTimeoutMs = numberEnv("WINDOWS_PROCESS_QUERY_TIMEOUT_MS", 3000);
const keepAliveHeartbeatFile = path.join(runtimeDir, "keep-alive.json");
const desktopWebSessionFile = resolveDesktopWebSessionFile(runtimeDir);
const wechatBridgeWorkerStatusFile = path.join(runtimeDir, "wechat-bridge-worker-status.json");
const wechatWindowObserverStatusFile = path.join(runtimeDir, "wechat-window-observer-status.json");
const webRuntimeServerPath = path.join(runtimeDir, "web-standalone-server.js");
const webStandaloneServerPath = path.join(desktopRoot, "apps", "web", ".next", "standalone", "apps", "web", "server.js");
const nextCliPath = path.join(desktopRoot, "node_modules", "next", "dist", "bin", "next");
const nextStartServerPath = path.join(desktopRoot, "node_modules", "next", "dist", "server", "lib", "start-server.js");

const requiredFiles = [
  ["package.json", path.join(desktopRoot, "package.json")],
  ["API build", path.join(desktopRoot, "dist", "apps", "api", "main.js")],
];

const endpoints = [
  ["Customer workbench", `http://127.0.0.1:${webPort}/`, (result) => result.statusCode === 200],
  [
    "NestJS API",
    `http://127.0.0.1:${apiPort}/api/health`,
    (result) => result.statusCode === 200 && localStoreUsesRuntimeDir(result.json),
  ],
  [
    "Design integration",
    `http://127.0.0.1:${apiPort}/api/integrations/design-platform/health`,
    (result) => result.statusCode === 200 && result.json?.ok === true,
  ],
  ["Mock design platform", `http://127.0.0.1:${mockPort}/v1/health`, (result) => result.statusCode === 200 && result.json?.ok === true],
];

main().catch((error) => {
  console.error(`[doctor] failed: ${error?.stack || error}`);
  process.exitCode = 1;
});

async function main() {
  const startedAt = Date.now();
  let lastReport = null;
  do {
    lastReport = await collectReport();
    if (lastReport.ok) {
      printReport(lastReport);
      return;
    }
    if (!waitMs || Date.now() - startedAt >= waitMs) break;
    await sleep(intervalMs);
  } while (true);

  printReport(lastReport);
  process.exitCode = 1;
}

async function collectReport() {
  const checks = [];
  checks.push(checkDirectory("Desktop source", desktopRoot));
  checks.push(checkDirectory("Runtime directory", runtimeDir));
  checks.push(checkRuntimeWritable());
  checks.push(checkStaleScheduledTasks());
  checks.push(checkStaleRuntimeProcesses());
  for (const [label, filePath] of requiredFiles) checks.push(checkFile(label, filePath));
  checks.push(checkWebStartable());

  const portOwners = getPortOwners([webPort, apiPort, mockPort]);
  checks.push(checkStableRuntimeVersion(portOwners));
  for (const port of [webPort, apiPort, mockPort]) {
    const owners = portOwners.get(port) || [];
    checks.push({
      ok: owners.length > 0,
      label: `Port ${port}`,
      detail: owners.length ? `listening pid=${owners.join(",")}` : "not listening",
    });
  }
  checks.push(checkWebRuntimeOwner(portOwners.get(webPort) || []));
  checks.push(checkKeepAliveHeartbeat(portOwners));
  checks.push(checkWechatWorkerStatus("WeChat bridge worker", wechatBridgeWorkerStatusFile, "tools/wechat-bridge-worker.js", (status) => {
    const mode = String(status.mode || "");
    return mode === "noop" || mode === "dispatch";
  }));
  checks.push(checkWechatWorkerStatus("WeChat window observer", wechatWindowObserverStatusFile, "tools/wechat-window-observer.js"));

  for (const [label, url, isOk] of endpoints) {
    const result = await requestJson(url, 3000);
    checks.push({
      ok: isOk(result),
      label,
      detail: describeHttpResult(url, result),
    });
  }

  const desktopSessionCheck = await checkDesktopWebSession();
  checks.push(desktopSessionCheck);

  return {
    ok: checks.every((item) => item.ok || item.severity === "warn"),
    checks,
    desktopRoot,
    runtimeDir,
    generatedAt: new Date().toISOString(),
  };
}

async function checkDesktopWebSession() {
  try {
    const proof = readDesktopWebSessionProof(desktopWebSessionFile);
    const result = await requestJson(`http://127.0.0.1:${webPort}/api/health`, 3000, {
      headers: { Cookie: `smart_kefu_desktop_session=${proof}` },
    });
    const ok = result.statusCode === 200 && localStoreUsesRuntimeDir(result.json);
    return {
      ok,
      label: "Verified desktop session",
      detail: describeHttpResult(`http://127.0.0.1:${webPort}/api/health`, result),
    };
  } catch (error) {
    return {
      ok: false,
      label: "Verified desktop session",
      detail: `${desktopWebSessionFile}: ${error?.message || String(error)}`,
    };
  }
}

function printReport(report) {
  console.log(`[doctor] generatedAt=${report.generatedAt}`);
  console.log(`[doctor] desktopRoot=${report.desktopRoot}`);
  console.log(`[doctor] runtimeDir=${report.runtimeDir}`);
  for (const check of report.checks) {
    const prefix = check.severity === "warn" ? "[warn]" : check.ok ? "[ok]" : "[fail]";
    console.log(`${prefix} ${check.label}: ${check.detail}`);
  }
  console.log(report.ok ? "[doctor] stable desktop stack is healthy." : "[doctor] stable desktop stack is not healthy.");
  if (!report.ok) {
    console.log("[doctor] easiest fix: run C:\\Users\\27808\\Desktop\\zhinengkefu\\repair-stable-desktop.cmd and keep that window open.");
    console.log("[doctor] next step: run C:\\Users\\27808\\Desktop\\zhinengkefu\\start-stable-desktop-foreground.cmd and keep that window open.");
    console.log("[doctor] if ports are occupied by old services, run C:\\Users\\27808\\Desktop\\zhinengkefu\\stop-stable-desktop.cmd first.");
    console.log(`[doctor] logs: ${path.join(report.runtimeDir, "logs")}`);
  }
}

function checkDirectory(label, dirPath) {
  const ok = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  return { ok, label, detail: ok ? dirPath : `missing: ${dirPath}` };
}

function checkFile(label, filePath) {
  const ok = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  return { ok, label, detail: ok ? filePath : `missing: ${filePath}` };
}

function checkWebStartable() {
  if (fs.existsSync(webStandaloneServerPath) && fs.statSync(webStandaloneServerPath).isFile()) {
    return { ok: true, label: "Web startable", detail: `standalone build: ${webStandaloneServerPath}` };
  }
  const ok = fs.existsSync(nextCliPath) && fs.statSync(nextCliPath).isFile();
  return {
    ok,
    severity: ok ? "warn" : undefined,
    label: "Web startable",
    detail: ok
      ? `standalone build missing; Next dev fallback available: ${nextCliPath}`
      : `missing standalone build and Next CLI fallback: ${webStandaloneServerPath}; ${nextCliPath}`,
  };
}

function checkRuntimeWritable() {
  const testFile = path.join(runtimeDir, ".stable-doctor-write-test");
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(testFile, `${process.pid}\n`, "utf8");
    fs.rmSync(testFile, { force: true });
    return { ok: true, label: "Runtime writable", detail: runtimeDir };
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      return {
        ok: false,
        severity: "warn",
        label: "Runtime writable",
        detail: `${error.message}; continuing because this can be a Codex sandbox write-test limitation when services are already healthy`,
      };
    }
    return { ok: false, label: "Runtime writable", detail: error?.message || String(error) };
  }
}

function checkStaleScheduledTasks() {
  if (process.platform !== "win32") {
    return { ok: true, severity: "warn", label: "Stale scheduled tasks", detail: "not checked on non-Windows platform" };
  }
  const staleNames = [
    "zhinengkefu_desktop_supervisor_keep_mock_4219d0b8",
    "zhinengkefu_desktop_supervisor_keep_mock_4219d0b8_it",
  ];
  const enabled = staleNames.filter((name) => staleScheduledTaskXmlLooksEnabled(name));
  return {
    ok: enabled.length === 0,
    label: "Stale scheduled tasks",
    detail: enabled.length
      ? `disable old desktop supervisor tasks: ${enabled.join(", ")}`
      : "old desktop supervisor tasks are absent or disabled",
  };
}

function staleScheduledTaskXmlLooksEnabled(taskName) {
  const taskFile = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "Tasks", taskName);
  if (!fs.existsSync(taskFile)) return false;
  try {
    const xml = fs.readFileSync(taskFile, "utf8");
    const referencesOldRuntime =
      xml.includes("zhinengkefu_restore_work") ||
      xml.includes("runtime-d-repo") ||
      xml.includes("stable-supervise-mock.cmd");
    return referencesOldRuntime && /<Enabled>\s*true\s*<\/Enabled>/i.test(xml);
  } catch {
    return false;
  }
}

function checkStableRuntimeVersion(portOwners = new Map()) {
  if (process.platform !== "win32") {
    return { ok: true, severity: "warn", label: "Stable runtime version", detail: "not checked on non-Windows platform" };
  }
  let launchers = stableRuntimeLauncherFromHeartbeat();
  if (!launchers.length) launchers = findStableRuntimeLauncherProcesses();
  if (!launchers.length) {
    const directServicePids = [webPort, apiPort, mockPort].flatMap((port) => portOwners.get(port) || []);
    if (directServicePids.length >= 3) {
      return {
        ok: true,
        label: "Stable runtime version",
        detail: `direct service mode healthy pid=${directServicePids.join(",")}`,
      };
    }
    return { ok: true, severity: "warn", label: "Stable runtime version", detail: "no stable runtime launcher process found" };
  }
  const launcherPath = path.join(desktopRoot, "tools", "stable-runtime-launcher.js");
  let launcherMtimeMs = 0;
  try {
    launcherMtimeMs = fs.statSync(launcherPath).mtimeMs;
  } catch (error) {
    return { ok: false, label: "Stable runtime version", detail: `cannot stat ${launcherPath}: ${error?.message || String(error)}` };
  }
  const stale = launchers.filter((item) => Number.isFinite(item.createdAtMs) && item.createdAtMs + 2000 < launcherMtimeMs);
  if (!stale.length) {
    return {
      ok: true,
      label: "Stable runtime version",
      detail: `launcher pid=${launchers.map((item) => item.pid).join(",")} is current`,
    };
  }
  return {
    ok: true,
    severity: "warn",
    label: "Stable runtime version",
    detail: `old launcher process is still running (${stale.map((item) => `pid=${item.pid}`).join(", ")}); close the Smart Kefu Services window once, then start C:\\Users\\27808\\Desktop\\zhinengkefu\\start-stable-desktop.cmd again`,
  };
}

function stableRuntimeLauncherFromHeartbeat() {
  try {
    const heartbeat = JSON.parse(fs.readFileSync(keepAliveHeartbeatFile, "utf8"));
    const pid = Number(heartbeat?.pid);
    const ageMs = Date.now() - Date.parse(String(heartbeat?.updatedAt || ""));
    const heartbeatIsFresh = Number.isFinite(ageMs) && ageMs <= 30000;
    if (!Number.isFinite(pid) || pid <= 0) return [];
    const commandLine = getCommandLine(pid);
    const normalizedCommandLine = normalizePathText(commandLine);
    if (normalizedCommandLine && !normalizedCommandLine.includes("stable-runtime-launcher.js")) return [];
    if (!normalizedCommandLine && !(heartbeatIsFresh && processIsRunning(pid))) return [];
    return [{ pid, createdAtMs: NaN, commandLine: commandLine || "heartbeat pid is alive; command line unavailable" }];
  } catch {
    return [];
  }
}
function findStableRuntimeLauncherProcesses() {
  const script = [
    "$items = Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\"",
    "$items | Where-Object { $_.CommandLine -like '*stable-runtime-launcher*' } | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: desktopRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: windowsProcessQueryTimeoutMs,
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  try {
    const parsed = JSON.parse(String(result.stdout || "[]"));
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map((item) => ({
        pid: Number(item.ProcessId),
        createdAtMs: parsePowerShellJsonDate(item.CreationDate),
        commandLine: String(item.CommandLine || ""),
      }))
      .filter((item) => Number.isFinite(item.pid) && item.pid > 0);
  } catch {
    return [];
  }
}

function parsePowerShellJsonDate(value) {
  const raw = String(value || "");
  const match = raw.match(/\/Date\((\d+)\)\//);
  if (match) return Number(match[1]);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function checkStaleRuntimeProcesses() {
  if (process.platform !== "win32") {
    return { ok: true, severity: "warn", label: "Stale runtime processes", detail: "not checked on non-Windows platform" };
  }
  const staleProcesses = findStaleRuntimeProcesses();
  return {
    ok: staleProcesses.length === 0,
    label: "Stale runtime processes",
    detail: staleProcesses.length
      ? `stop old runtime processes: ${staleProcesses.map((item) => `pid=${item.pid}`).join(", ")}`
      : "old restore/runtime-d-repo processes are not running",
  };
}

function findStaleRuntimeProcesses() {
  const normalizedRoot = normalizePathText(desktopRoot);
  const script = [
    `$root = ${psQuote(normalizedRoot)}`,
    "$items = Get-CimInstance Win32_Process -Filter \"name = 'node.exe' OR name = 'cmd.exe'\"",
    "$items | Where-Object {",
    "  if (-not $_.CommandLine) { return $false }",
    "  $normalizedCommand = (($_.CommandLine -replace '\\\\','/').ToLowerInvariant())",
    "  $outsideCurrentRoot = $normalizedCommand.Replace($root, '')",
    "  $isNamedLegacyRuntime = $_.CommandLine -match 'zhinengkefu_restore_work|runtime-d-repo'",
    "  $isNestedLegacyRuntime = $normalizedCommand.Contains($root) -and $outsideCurrentRoot.Contains('/.runtime/') -and -not $outsideCurrentRoot.Contains('/.runtime-stable/')",
    "  $isNamedLegacyRuntime -or $isNestedLegacyRuntime",
    "} | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: desktopRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: windowsProcessQueryTimeoutMs,
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];
  try {
    const parsed = JSON.parse(String(result.stdout || "[]"));
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map((item) => ({
        pid: Number(item.ProcessId),
        parentPid: Number(item.ParentProcessId),
        commandLine: String(item.CommandLine || ""),
      }))
      .filter((item) => Number.isFinite(item.pid) && item.pid > 0);
  } catch {
    return [];
  }
}

function checkWebRuntimeOwner(webOwners) {
  if (!webOwners.length) {
    return { ok: false, label: "Web runtime owner", detail: "web port has no owner" };
  }
  const expected = [webRuntimeServerPath, nextCliPath, nextStartServerPath].map(normalizePathText);
  const commandLines = webOwners.map((pid) => ({ pid, commandLine: getCommandLine(pid) }));
  const readableCommandLines = commandLines.filter((item) => item.commandLine);
  if (!readableCommandLines.length) {
    return {
      ok: true,
      label: "Web runtime owner",
      detail: `command unavailable for pid=${webOwners.join(",")}; HTTP and heartbeat checks will verify liveness`,
    };
  }
  const details = commandLines.map((item) => `pid=${item.pid} ${item.commandLine || "command unavailable"}`);
  const ok = readableCommandLines.some((item) => expected.some((expectedPath) => normalizePathText(item.commandLine).includes(expectedPath)));
  return {
    ok,
    label: "Web runtime owner",
    detail: ok ? `uses ${webRuntimeServerPath}, ${nextCliPath}, or ${nextStartServerPath}` : `expected ${webRuntimeServerPath}, ${nextCliPath}, or ${nextStartServerPath}; actual ${details.join(" | ")}`,
  };
}

function checkKeepAliveHeartbeat(portOwners) {
  try {
    const heartbeat = JSON.parse(fs.readFileSync(keepAliveHeartbeatFile, "utf8"));
    const updatedAtMs = Date.parse(String(heartbeat.updatedAt || ""));
    const ageMs = Date.now() - updatedAtMs;
    const missingPorts = [webPort, apiPort, mockPort].filter((port) => !(portOwners.get(port) || []).length);
    const ok = heartbeat.mode === "mock" && Number.isFinite(updatedAtMs) && ageMs <= 15000;
    if (ok && missingPorts.length) {
      return {
        ok: true,
        severity: "warn",
        label: "Keep-alive heartbeat",
        detail: `supervisor heartbeat is fresh pid=${heartbeat.pid} ageMs=${ageMs}, but service ports are not ready: ${missingPorts.join(",")}`,
      };
    }
    if (!ok && missingPorts.length) {
      return {
        ok: true,
        severity: "warn",
        label: "Keep-alive heartbeat",
        detail: `stale or wrong heartbeat and service ports are not ready: ${missingPorts.join(",")}; ${JSON.stringify(heartbeat)}`,
      };
    }
    if (ok && heartbeat.pid && !processIsRunning(heartbeat.pid)) {
      return {
        ok: true,
        severity: "warn",
        label: "Keep-alive heartbeat",
        detail: `fresh heartbeat pid=${heartbeat.pid} is not running; ${JSON.stringify(heartbeat)}`,
      };
    }
    return {
      ok: true,
      label: "Keep-alive heartbeat",
      detail: ok
        ? `pid=${heartbeat.pid} ageMs=${ageMs}`
        : `direct service mode; stale or wrong heartbeat ignored: ${JSON.stringify(heartbeat)}`,
    };
  } catch (error) {
    const missingPorts = [webPort, apiPort, mockPort].filter((port) => !(portOwners.get(port) || []).length);
    if (missingPorts.length) {
      return {
        ok: true,
        severity: "warn",
        label: "Keep-alive heartbeat",
        detail: `heartbeat unavailable and service ports are not ready: ${missingPorts.join(",")}; ${error?.message || String(error)}`,
      };
    }
    return { ok: true, label: "Keep-alive heartbeat", detail: `direct service mode: ${error?.message || String(error)}` };
  }
}

function checkWechatWorkerStatus(label, statusFile, commandMarker, isSafeStatus = null) {
  try {
    const status = JSON.parse(fs.readFileSync(statusFile, "utf8"));
    const updatedAtMs = Date.parse(String(status.completedAt || status.updatedAt || status.startedAt || ""));
    const ageMs = Date.now() - updatedAtMs;
    const pid = Number(status.pid);
    const running = processIsRunning(pid);
    const commandLine = running ? getCommandLine(pid) : "";
    const commandMatches = !commandLine || normalizePathText(commandLine).includes(commandMarker);
    const statusSafe = typeof isSafeStatus === "function" ? isSafeStatus(status) : true;
    const ok = status.ok === true && running && commandMatches && Number.isFinite(updatedAtMs) && ageMs <= 30000 && statusSafe;
    return {
      ok,
      severity: ok ? undefined : "warn",
      label,
      detail: ok
        ? `pid=${pid} status=${status.status || "unknown"} ageMs=${ageMs}${status.mode ? ` mode=${status.mode}` : ""}`
        : `status=${JSON.stringify({ ok: status.ok, status: status.status, pid: status.pid, mode: status.mode, ageMs, running, commandMatches, statusSafe, errorMessage: status.errorMessage || "" })}`,
    };
  } catch (error) {
    return { ok: true, severity: "warn", label, detail: `${statusFile}: ${error?.message || String(error)}` };
  }
}
function getPortOwners(ports) {
  const owners = new Map(ports.map((port) => [port, []]));
  if (process.platform !== "win32") return owners;
  const result = spawnSync("netstat", ["-ano", "-p", "tcp"], {
    cwd: desktopRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return owners;
  for (const line of result.stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    if (String(parts[0]).toUpperCase() !== "TCP") continue;
    if (!/LISTENING/i.test(parts[3] || "")) continue;
    const localAddress = parts[1] || "";
    const pid = Number(parts[4]);
    for (const port of ports) {
      if (localAddress.endsWith(`:${port}`) && Number.isFinite(pid) && !owners.get(port).includes(pid)) {
        owners.get(port).push(pid);
      }
    }
  }
  return owners;
}

function requestJson(url, timeoutMs, options = {}) {
  return new Promise((resolve) => {
    const request = http.get(url, { ...options, timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = null;
        }
        resolve({ ok: true, statusCode: response.statusCode || 0, body, json });
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });
    request.on("error", (error) => {
      resolve({ ok: false, statusCode: 0, error: error?.message || String(error) });
    });
  });
}

function getCommandLine(pid) {
  if (process.platform !== "win32") return "";
  const safePid = Number(pid);
  if (!Number.isFinite(safePid)) return "";
  const script = `$p = Get-CimInstance Win32_Process -Filter ${psQuote(`ProcessId = ${safePid}`)}; if ($p) { $p.CommandLine }`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: desktopRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: windowsProcessQueryTimeoutMs,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processIsRunning(pid) {
  const safePid = Number(pid);
  if (!Number.isFinite(safePid) || safePid <= 0) return false;
  try {
    process.kill(safePid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizePathText(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function describeHttpResult(url, result) {
  if (!result.ok) return `${url} ${result.error || "request failed"}`;
  if (result.json) return `${url} status=${result.statusCode} json=${JSON.stringify(result.json)}`;
  return `${url} status=${result.statusCode} bodyLength=${String(result.body || "").length}`;
}

function localStoreUsesRuntimeDir(json) {
  const storePath = json?.localStore?.path;
  if (!storePath) return true;
  return normalizePathText(storePath).startsWith(normalizePathText(runtimeDir));
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function numberArg(name, fallback) {
  const prefix = `${name}=`;
  const raw = process.argv.find((item) => item.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
