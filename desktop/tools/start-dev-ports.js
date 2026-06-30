"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(desktopRoot, ".runtime");
const logsDir = path.join(runtimeDir, "logs");
const pidFile = path.join(runtimeDir, "dev-ports.json");
const designPlatformConfigFile = path.join(runtimeDir, "design-platform-config.json");
const mockModeLockFile = path.join(runtimeDir, "mock-mode.lock");
const realModeLockFile = path.join(runtimeDir, "real-mode.lock");
const apiBuildEntryPath = path.join(desktopRoot, "dist", "apps", "api", "main.js");
const webStandaloneServer = path.join("apps", "web", ".next", "standalone", "apps", "web", "server.js");
const webStandaloneServerPath = path.join(desktopRoot, webStandaloneServer);
const args = new Set(process.argv.slice(2));
const includeApi = !args.has("--no-api");
const statusOnly = args.has("--status");
const preflightOnly = args.has("--preflight");
const keepAliveLauncher = args.has("--keep-alive");
const requireFreePorts = args.has("--require-free-ports");
const allowMockDesignStart = process.env.ALLOW_MOCK_DESIGN_START === "1";
const requestedMockDesignMode = args.has("--mock-design");
const forceMockDesignMode = requestedMockDesignMode;
const requestedRealDesignMode = args.has("--real-design");
const webPort = numberEnv("WEB_PORT", 3100);
const mockPort = numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700);
const apiPort = numberEnv("API_PORT", 3200);
const existingDesignPlatformConfig = readRuntimeDesignPlatformConfig();
const existingDesignPlatformAdapter =
  typeof existingDesignPlatformConfig.designPlatformAdapter === "string" ? existingDesignPlatformConfig.designPlatformAdapter : "";
const existingDesignPlatformBaseUrl =
  typeof existingDesignPlatformConfig.designPlatformBaseUrl === "string" ? existingDesignPlatformConfig.designPlatformBaseUrl : "";
const shouldReuseRealDesignMode =
  !requestedMockDesignMode && !requestedRealDesignMode && existingDesignPlatformAdapter === "art_image_local";
const designPlatformAdapter =
  (requestedRealDesignMode || shouldReuseRealDesignMode) && !forceMockDesignMode ? "art_image_local" : "standard_v1";
const realDesignMode = designPlatformAdapter === "art_image_local";
const includeMockDesignPlatform =
  designPlatformAdapter === "standard_v1" &&
  (forceMockDesignMode || process.env.START_MOCK_DESIGN_PLATFORM === undefined
    ? true
    : process.env.START_MOCK_DESIGN_PLATFORM !== "false");
const integrationHealthUrl = `http://127.0.0.1:${apiPort}/api/integrations/design-platform/health`;

const services = [
  {
    name: "web",
    label: "Customer workbench",
    port: webPort,
    url: `http://127.0.0.1:${webPort}/`,
    command: process.execPath,
    commandArgs: [webStandaloneServerPath],
    enabled: true,
  },
  {
    name: "design-platform-mock",
    label: "Mock design platform",
    port: mockPort,
    url: `http://127.0.0.1:${mockPort}/v1/health`,
    command: process.execPath,
    commandArgs: ["tools/mock-design-platform.js"],
    enabled: includeMockDesignPlatform,
  },
  {
    name: "api",
    label: "NestJS API",
    port: apiPort,
    url: `http://127.0.0.1:${apiPort}/api/health`,
    command: process.execPath,
    commandArgs: ["dist/apps/api/main.js"],
    enabled: includeApi,
  },
];
const managedChildren = [];
const keepAliveTimers = [];
const keepAliveAnchors = [];
const serviceRestartGraceUntil = new Map();

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

process.on("uncaughtException", (error) => {
  logFatal("uncaughtException", error);
});

process.on("unhandledRejection", (error) => {
  logFatal("unhandledRejection", error);
});

process.on("beforeExit", (code) => {
  logLifecycle("beforeExit", code);
});

process.on("exit", (code) => {
  logLifecycle("exit", code);
});

async function main() {
  fs.mkdirSync(logsDir, { recursive: true });

  if (!statusOnly && !preflightOnly) {
    assertMockDesignStartAllowed();
    assertRealDesignStartAllowed();
    writeMockModeLockIfNeeded();
    writeRealModeLockIfNeeded();
  }

  if (!statusOnly) {
    assertNoConflictingDesignLauncher();
  }

  if (!statusOnly && !preflightOnly && includeApi) {
    await assertNoActiveApiModeConflict();
  }

  if (keepAliveLauncher) startKeepAliveMonitor();

  if (!statusOnly && !preflightOnly) {
    writeRuntimeDesignPlatformConfig();
  }

  if (preflightOnly) {
    await printPreflight();
    return;
  }

  if (statusOnly) {
    await printStatus();
    return;
  }

  assertRequiredCommands();

  const records = readPidFile();
  await buildWebIfNeeded();
  await buildApiIfNeeded();
  for (const disabledService of services.filter((item) => !item.enabled)) {
    delete records[disabledService.name];
  }
  for (const service of services.filter((item) => item.enabled)) {
    if (await isServiceReadyForCurrentConfig(service)) {
      const portOwners = getPortOwnerPids(service.port);
      console.log(`[ok] ${service.label} is already online: ${service.url}`);
      records[service.name] = {
        ...records[service.name],
        name: service.name,
        label: service.label,
        port: service.port,
        url: service.url,
        pid: numberOrUndefined(portOwners[0]) || records[service.name]?.pid,
        portOwnerPids: portOwners,
        status: "already_running",
        updatedAt: new Date().toISOString(),
      };
      writePidFile(records);
      continue;
    }

    const portOwners = getPortOwnerPids(service.port);
    if (portOwners.length) {
      console.log(`[wait] ${service.label} port ${service.port} is used by PID ${portOwners.join(", ")}. Checking health...`);
      if (service.name === "api" && (await isHealthy(service.url))) {
        const integrationHealth = await getJson(integrationHealthUrl);
        if (integrationHealth && !integrationMatchesCurrentConfig(integrationHealth)) {
          records[service.name] = {
            ...records[service.name],
            name: service.name,
            label: service.label,
            port: service.port,
            url: service.url,
            status: "wrong_mode",
            portOwnerPids: portOwners,
            updatedAt: new Date().toISOString(),
          };
          writePidFile(records);
          console.log(`[wrong-mode] ${service.label} port ${service.port} is used by PID ${portOwners.join(", ")} with the wrong design mode.`);
          console.log(
            `             current adapter=${integrationHealth.adapter || "unknown"} base=${integrationHealth.baseUrl || "unknown"}`,
          );
          console.log(`             expected adapter=${designPlatformAdapter} base=${designPlatformDefaults().DESIGN_PLATFORM_BASE_URL}`);
          console.log("             Run npm.cmd run ports:stop, then start with the matching mode.");
          continue;
        }
      }
      if (await waitForStableServiceReady(service, serviceReadyTimeoutMs(service))) {
        const healthyPortOwners = getPortOwnerPids(service.port);
        records[service.name] = {
          ...records[service.name],
          name: service.name,
          label: service.label,
          port: service.port,
          url: service.url,
          pid: numberOrUndefined(healthyPortOwners[0]) || records[service.name]?.pid,
          portOwnerPids: healthyPortOwners,
          status: "already_running",
          updatedAt: new Date().toISOString(),
        };
        writePidFile(records);
        console.log(`[ok] ${service.label} is already online: ${service.url}`);
        continue;
      }
      records[service.name] = {
        ...records[service.name],
        name: service.name,
        label: service.label,
        port: service.port,
        url: service.url,
        status: "port_blocked",
        portOwnerPids: portOwners,
        updatedAt: new Date().toISOString(),
      };
      writePidFile(records);
      console.log(`[blocked] ${service.label} port ${service.port} is used by PID ${portOwners.join(", ")}.`);
      console.log("          Run stop_desktop.bat, or close the listed PID in Task Manager.");
      continue;
    }

    const child = startService(service);
    records[service.name] = {
      name: service.name,
      label: service.label,
      port: service.port,
      url: service.url,
      pid: child.pid,
      command: commandRecordLine(service.command, service.commandArgs),
      startedAt: new Date().toISOString(),
      status: "starting",
    };
    writePidFile(records);
    console.log(`[start] ${service.label} pid=${child.pid} port=${service.port}`);
  }

  const allReady = await waitAndPrint(services.filter((item) => item.enabled), records);
  console.log("[info] Local JSON data mode is enabled by default. Set USE_LOCAL_STORE=false for database mode later.");

  if (!allReady) {
    if (keepAliveLauncher) {
      console.log("[keep-alive] Some services were not ready yet. Keeping launcher alive so managed services can recover.");
    } else {
      process.exitCode = 1;
      return;
    }
  }

  if (keepAliveLauncher) {
    startModeLockHeartbeat();
    console.log("[keep-alive] Port services are running. Use npm.cmd run ports:stop to stop them.");
    await waitUntilStopped();
  }
}

function startKeepAliveMonitor() {
  if (keepAliveTimers.length) return;
  const timer = setInterval(() => {
    try {
      for (const service of services.filter((item) => item.enabled)) {
        if (getPortOwnerPids(service.port).length) {
          refreshServiceRecord(service);
          continue;
        }
        if ((serviceRestartGraceUntil.get(service.name) || 0) > Date.now()) {
          refreshServiceRecord(service);
          continue;
        }
        const launcherLogPath = path.join(logsDir, `${service.name}.launcher.log`);
        fs.appendFileSync(launcherLogPath, `[${new Date().toISOString()}] monitor restarting ${service.name}\n`, "utf8");
        startService(service);
      }
    } catch (error) {
      logFatal("keepAliveMonitor", error, { exit: false });
    }
  }, 2000);
  timer.ref();
  keepAliveTimers.push(timer);
}

function startModeLockHeartbeat() {
  if (!realDesignMode) return;
  writeRealModeLockIfNeeded();
  setInterval(writeRealModeLockIfNeeded, 5000);
}

function startManagedChild(service, stdoutPath, stderrPath, launcherLogPath, wrapperPath) {
  const stdout = fs.openSync(stdoutPath, "a");
  const stderr = fs.openSync(stderrPath, "a");
  const launchCommand = { command: service.command, commandArgs: service.commandArgs };
  const child = spawn(launchCommand.command, launchCommand.commandArgs, {
    cwd: desktopRoot,
    env: serviceEnv(),
    detached: false,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  fs.appendFileSync(
    launcherLogPath,
    `[${new Date().toISOString()}] launched managed child ${child.pid || "unknown"} via direct service command; wrapper kept at ${wrapperPath}\n`,
    "utf8",
  );
  managedChildren.push(child);
  serviceRestartGraceUntil.set(service.name, Date.now() + serviceReadyTimeoutMs(service));
  scheduleServiceRecordRefresh(service, child.pid);
  child.once("exit", (code, signal) => {
    fs.appendFileSync(
      launcherLogPath,
      `[${new Date().toISOString()}] ${service.name} managed process exited code=${code ?? ""} signal=${signal ?? ""}\n`,
      "utf8",
    );
    const index = managedChildren.indexOf(child);
    if (index >= 0) managedChildren.splice(index, 1);
  });
  return child;
}

function scheduleServiceRecordRefresh(service, childPid) {
  for (const delayMs of [1000, 5000, 12000]) {
    setTimeout(() => refreshServiceRecord(service, childPid), delayMs);
  }
}

function refreshServiceRecord(service, childPid) {
  const records = readPidFile();
  const portOwners = getPortOwnerPids(service.port);
  const preferredPid = numberOrUndefined(portOwners[0]) || numberOrUndefined(childPid) || records[service.name]?.pid;
  records[service.name] = {
    ...records[service.name],
    name: service.name,
    label: service.label,
    port: service.port,
    url: service.url,
    pid: preferredPid,
    portOwnerPids: portOwners,
    status: portOwners.length ? "running" : records[service.name]?.status || "starting",
    updatedAt: new Date().toISOString(),
  };
  writePidFile(records);
}

async function buildApiIfNeeded() {
  const apiService = services.find((service) => service.name === "api");
  if (!apiService?.enabled) return;
  if (await isServiceReadyForCurrentConfig(apiService)) {
    console.log("[ok] API is already online, skip API rebuild.");
    return;
  }
  const portOwners = getPortOwnerPids(apiService.port);
  if (portOwners.length) {
    console.log(`[blocked] API port ${apiService.port} is used by PID ${portOwners.join(", ")}. Skip API rebuild.`);
    return;
  }
  if (!apiBuildIsStale()) return;

  console.log("[build] Building API before startup...");
  try {
    runPackageScript("build:api");
  } catch (error) {
    console.log(`[warn] API build failed once: ${error instanceof Error ? error.message : String(error)}`);
    console.log("[build] Waiting 2 seconds, then retrying API build...");
    sleepMs(2000);
    runPackageScript("build:api");
  }
}

function apiBuildIsStale() {
  if (!fs.existsSync(apiBuildEntryPath)) return true;
  const builtAt = fs.statSync(apiBuildEntryPath).mtimeMs;
  return [
    path.join(desktopRoot, "apps", "api", "src"),
    path.join(desktopRoot, "apps", "api", "nest-cli.json"),
    path.join(desktopRoot, "apps", "api", "tsconfig.json"),
    path.join(desktopRoot, "apps", "api", "tsconfig.build.json"),
  ].some((item) => pathHasFileNewerThan(item, builtAt));
}

async function buildWebIfNeeded() {
  const webService = services.find((service) => service.name === "web");
  if (!webService?.enabled) return;
  if (await isServiceReadyForCurrentConfig(webService)) {
    console.log("[ok] Web workbench is already online, skip web rebuild.");
    return;
  }
  const portOwners = getPortOwnerPids(webService.port);
  if (portOwners.length) {
    console.log(`[blocked] Web port ${webService.port} is used by PID ${portOwners.join(", ")}. Skip web rebuild.`);
    return;
  }
  if (!webBuildIsStale()) return;

  console.log("[build] Building web standalone assets before startup...");
  try {
    runPackageScript("build:web");
  } catch (error) {
    console.log(`[warn] Web build failed once: ${error instanceof Error ? error.message : String(error)}`);
    console.log("[build] Waiting 2 seconds, then retrying web build...");
    sleepMs(2000);
    try {
      runPackageScript("build:web");
    } catch (retryError) {
      if (fs.existsSync(webStandaloneServerPath)) {
        console.log(
          `[warn] Web rebuild failed, but ${webStandaloneServer} exists. Starting with the existing standalone build.`,
        );
        return;
      }
      throw retryError;
    }
  }
}

function webBuildIsStale() {
  if (!fs.existsSync(webStandaloneServerPath)) return true;
  const builtAt = fs.statSync(webStandaloneServerPath).mtimeMs;
  return [
    path.join(desktopRoot, "apps", "web", "src"),
    path.join(desktopRoot, "apps", "web", "public"),
    path.join(desktopRoot, "apps", "web", "next.config.js"),
    path.join(desktopRoot, "package.json"),
  ].some((item) => pathHasFileNewerThan(item, builtAt));
}

function pathHasFileNewerThan(itemPath, builtAt) {
  if (!fs.existsSync(itemPath)) return false;
  const stat = fs.statSync(itemPath);
  if (stat.isFile()) return stat.mtimeMs > builtAt;
  if (!stat.isDirectory()) return false;

  for (const entry of fs.readdirSync(itemPath, { withFileTypes: true })) {
    if (entry.name === ".next" || entry.name === "node_modules") continue;
    const childPath = path.join(itemPath, entry.name);
    if (pathHasFileNewerThan(childPath, builtAt)) return true;
  }
  return false;
}

function runPackageScript(scriptName) {
  const command = npmCommand();
  const args = ["run", scriptName];
  const npmCliPath = process.platform === "win32" ? resolvedNpmCliPath() : "";
  const packageCommand =
    npmCliPath
      ? { command: process.execPath, args: [npmCliPath, ...args] }
      : { command, args };
  const result = spawnSync(packageCommand.command, packageCommand.args, {
    cwd: desktopRoot,
    env: process.platform === "win32" ? windowsSafeEnv(process.env) : process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${scriptName} failed${result.error ? `: ${result.error.message}` : ""}`);
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitUntilStopped() {
  startKeepAliveMonitor();
  startKeepAliveAnchor();
  return new Promise(() => undefined);
}

function startKeepAliveAnchor() {
  if (keepAliveAnchors.length) return;
  const anchor = setInterval(() => undefined, 60_000);
  anchor.ref();
  keepAliveAnchors.push(anchor);
}

function logFatal(scope, error, options = {}) {
  const message = error?.stack || error?.message || String(error);
  const line = `[${new Date().toISOString()}] ${scope}: ${message}\n`;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, "start-dev-ports.fatal.log"), line, "utf8");
  } catch {
    // Fatal logging must not throw recursively.
  }
  console.error(line.trim());
  if (options.exit === false) return;
  process.exitCode = 1;
}

function logLifecycle(scope, code) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, "start-dev-ports.lifecycle.log"), `[${new Date().toISOString()}] ${scope} code=${code}\n`, "utf8");
  } catch {
    // Lifecycle logging must not block process shutdown.
  }
}

function startService(service) {
  if (process.platform === "win32") {
    return startWindowsService(service);
  }

  const stdout = fs.openSync(path.join(logsDir, `${service.name}.out.log`), "a");
  const stderr = fs.openSync(path.join(logsDir, `${service.name}.err.log`), "a");
  const child = spawn(service.command, service.commandArgs, {
    cwd: desktopRoot,
    env: serviceEnv(),
    detached: true,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
  child.unref();
  return child;
}

function startWindowsService(service) {
  const stdoutPath = path.join(logsDir, `${service.name}.out.log`);
  const stderrPath = path.join(logsDir, `${service.name}.err.log`);
  const launcherLogPath = path.join(logsDir, `${service.name}.launcher.log`);
  const wrapperPath = path.join(runtimeDir, `run-${service.name}.cmd`);
  removeLogFileIfUnlocked(stdoutPath);
  removeLogFileIfUnlocked(stderrPath);
  removeLogFileIfUnlocked(launcherLogPath);

  fs.writeFileSync(wrapperPath, buildWindowsServiceWrapper(service, stdoutPath, stderrPath, launcherLogPath), "utf8");
  if (!fs.existsSync(wrapperPath)) {
    throw new Error(`failed to create service wrapper for ${service.name}`);
  }

  fs.appendFileSync(launcherLogPath, `[${new Date().toISOString()}] launching ${service.name}\n`, "utf8");
  if (keepAliveLauncher) {
    return startManagedChild(service, stdoutPath, stderrPath, launcherLogPath, wrapperPath);
  }

  const envAssignments = Object.entries(serviceDefaultEnv())
    .map(([key, value]) => `$env:${psEnvName(key)} = ${psQuote(value)}`)
    .join("; ");
  const launchCommand = windowsServiceLaunchCommand(service, wrapperPath);
  const redirectArgs = launchCommand.usesOwnRedirection
    ? ""
    : `-RedirectStandardOutput ${psQuote(stdoutPath)} -RedirectStandardError ${psQuote(stderrPath)} `;
  const script =
    `${envAssignments}; ` +
    `$process = Start-Process -FilePath ${psQuote(launchCommand.command)} ` +
    `-ArgumentList ${psArray(launchCommand.commandArgs)} ` +
    `-WorkingDirectory ${psQuote(desktopRoot)} -WindowStyle Hidden ${redirectArgs}-PassThru; ` +
    "$process.Id";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: desktopRoot,
    env: windowsSafeEnv(process.env),
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`failed to start ${service.name}: ${String(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  const startedPid = Number(String(result.stdout || "").trim().split(/\s+/).pop());
  return { pid: numberOrUndefined(getPortOwnerPids(service.port)[0]) || (Number.isFinite(startedPid) ? startedPid : undefined) };
}

function removeLogFileIfUnlocked(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EBUSY") {
      console.log(`[warn] Log file is locked, keeping existing file: ${filePath}`);
      return;
    }
    throw error;
  }
}

function buildWindowsServiceWrapper(service, stdoutPath, stderrPath, launcherLogPath) {
  const command = [cmdQuote(service.command), ...service.commandArgs.map(cmdQuote)].join(" ");
  const runLine = `${command} >> ${cmdQuote(stdoutPath)} 2>> ${cmdQuote(stderrPath)}`;
  const lines = [
    "@echo off",
    "setlocal",
    `cd /d ${cmdQuote(desktopRoot)}`,
    ...Object.entries(serviceDefaultEnv()).map(([key, value]) => cmdSetEnv(key, value)),
    `echo [%date% %time%] launching ${service.name} >> ${cmdQuote(launcherLogPath)}`,
    runLine,
  ];
  return `${lines.join("\r\n")}\r\n`;
}

function commandRecordLine(command, args = []) {
  return [cmdQuote(command), ...args.map(cmdQuote)].join(" ");
}

function windowsServiceLaunchCommand(service, wrapperPath) {
  if (process.platform === "win32" && wrapperPath) {
    return { command: "cmd.exe", commandArgs: ["/d", "/c", wrapperPath], usesOwnRedirection: true };
  }
  return { command: service.command, commandArgs: service.commandArgs, usesOwnRedirection: false };
}

function cmdSetEnv(key, value) {
  return `set "${String(key).replace(/"/g, "")}=${String(value ?? "").replace(/\r?\n/g, " ").replace(/"/g, '""')}"`;
}

async function waitAndPrint(enabledServices, records) {
  let allReady = true;
  for (const service of enabledServices) {
    const existingRecord = records[service.name];
    if (existingRecord?.status === "port_blocked") {
      console.log(`[blocked] ${service.label}: port ${service.port} is used by PID ${(existingRecord.portOwnerPids || []).join(", ")}.`);
      allReady = false;
      continue;
    }

    const ok = await waitForStableServiceReady(service, serviceReadyTimeoutMs(service));
    const portOwners = getPortOwnerPids(service.port);
    records[service.name] = {
      ...records[service.name],
      status: ok ? "running" : "failed_or_slow",
      portOwnerPids: portOwners,
      pid: numberOrUndefined(portOwners[0]) || records[service.name]?.pid,
      updatedAt: new Date().toISOString(),
    };
    writePidFile(records);
    if (ok) {
      console.log(`[ready] ${service.label}: ${service.url}`);
    } else {
      allReady = false;
      console.log(`[warn] ${service.label} was not ready within ${Math.round(serviceReadyTimeoutMs(service) / 1000)} seconds.`);
      console.log(`       Check log: ${path.join(logsDir, `${service.name}.err.log`)}`);
    }
  }
  return allReady;
}

function serviceReadyTimeoutMs(service) {
  if (service.name === "api") return 90000;
  if (service.name === "web") return 60000;
  return 30000;
}

async function printStatus() {
  const records = readPidFile();
  const integrationHealth = await getJson(integrationHealthUrl);
  const effectiveServices =
    designPlatformAdapter === "art_image_local"
      ? services.filter((service) => service.enabled && service.name !== "design-platform-mock")
      : services.filter((service) => service.enabled);

  for (const service of services.filter((item) => !effectiveServices.some((active) => active.name === item.name))) {
    delete records[service.name];
  }

  for (const service of effectiveServices) {
    const reachable = await isHealthy(service.url);
    const configMismatch =
      service.name === "api" && reachable && integrationHealth && !integrationMatchesCurrentConfig(integrationHealth);
    const ok = reachable && !configMismatch;
    const portOwners = getPortOwnerPids(service.port);
    const portText = portOwners.length ? ` port=${service.port} pid=${portOwners.join(",")}` : "";
    const statusLabel = ok ? "[ready]" : configMismatch ? "[wrong-mode]" : "[down] ";
    console.log(`${statusLabel} ${service.label} ${service.url}${portText}`);
    records[service.name] = {
      ...records[service.name],
      name: service.name,
      label: service.label,
      port: service.port,
      url: service.url,
      pid: numberOrUndefined(portOwners[0]) || records[service.name]?.pid,
      portOwnerPids: portOwners,
      status: ok ? "running" : configMismatch ? "wrong_mode" : "down",
      updatedAt: new Date().toISOString(),
    };
  }
  if (integrationHealth) {
    const latencyText = Number.isFinite(Number(integrationHealth.latencyMs)) ? ` latency=${integrationHealth.latencyMs}ms` : "";
    console.log(
      `${integrationHealth.ok ? "[ready]" : "[down] "} Design integration adapter=${integrationHealth.adapter || "unknown"} base=${integrationHealth.baseUrl || "unknown"}${latencyText}`,
    );
    if (!integrationMatchesCurrentConfig(integrationHealth)) {
      console.log(
        `[warn] Design integration config mismatch. expected adapter=${designPlatformAdapter} base=${designPlatformDefaults().DESIGN_PLATFORM_BASE_URL}`,
      );
      console.log("       Run npm.cmd run ports:stop, then start with the matching mode.");
    }
  }
  writePidFile(records);
  console.log(`pid file: ${pidFile}`);
  console.log(`logs: ${logsDir}`);
}

async function printPreflight() {
  assertRequiredCommands();
  console.log(`[ok] Node.js: ${process.version}`);
  console.log(`[ok] npm command: ${npmCommand()}`);
  console.log(`[ok] desktop root: ${desktopRoot}`);
  console.log(`[ok] logs: ${logsDir}`);
  console.log(`[ok] design platform adapter: ${designPlatformDefaults().DESIGN_PLATFORM_ADAPTER}`);
  console.log(`[ok] design platform base url: ${designPlatformDefaults().DESIGN_PLATFORM_BASE_URL}`);
  if (!includeMockDesignPlatform) {
    const externalHealthUrl = designPlatformHealthUrl();
    if (await isHealthy(externalHealthUrl)) {
      console.log(`[ok] external design platform online: ${externalHealthUrl}`);
    } else {
      console.log(`[warn] external design platform is not responding: ${externalHealthUrl}`);
      console.log("       Desktop services can still start, but real design jobs will fail until it is online.");
    }
  }

  let blocked = false;
  for (const service of services.filter((item) => item.enabled)) {
    const portOwners = getPortOwnerPids(service.port);
    if (requireFreePorts && portOwners.length) {
      blocked = true;
      console.log(`[blocked] ${service.label} port ${service.port} is already used by PID ${portOwners.join(", ")}.`);
      console.log("          Foreground startup needs this port to be free. Run stop_desktop.bat and approve the Administrator prompt.");
      continue;
    }
    if (await isServiceReadyForCurrentConfig(service)) {
      console.log(`[ok] ${service.label} already online: ${service.url}`);
      continue;
    }
    if (portOwners.length) {
      blocked = true;
      if (service.name === "api") {
        const integrationHealth = await getJson(integrationHealthUrl);
        if (integrationHealth && !integrationMatchesCurrentConfig(integrationHealth)) {
          console.log(`[blocked] ${service.label} port ${service.port} is used by PID ${portOwners.join(", ")} with the wrong design mode.`);
          console.log(
            `          current adapter=${integrationHealth.adapter || "unknown"} base=${integrationHealth.baseUrl || "unknown"}`,
          );
          console.log(`          expected adapter=${designPlatformAdapter} base=${designPlatformDefaults().DESIGN_PLATFORM_BASE_URL}`);
          console.log("          Run stop_desktop.bat, approve the Administrator prompt, then run run_desktop.bat again.");
          continue;
        }
      }
      console.log(`[blocked] ${service.label} port ${service.port} is used by PID ${portOwners.join(", ")}.`);
    } else {
      console.log(`[free] ${service.label} port ${service.port} is available.`);
    }
  }

  if (blocked) {
    throw new Error("One or more ports are blocked. Run stop_desktop.bat, approve the Administrator prompt, then start again.");
  }
}

async function isServiceReadyForCurrentConfig(service) {
  if (!(await isHealthy(service.url))) return false;
  if (service.name !== "api") return true;

  const integrationHealth = await getJson(integrationHealthUrl);
  return integrationMatchesCurrentConfig(integrationHealth);
}

async function isApiIntegrationReadyForCurrentConfig() {
  if (!(await isHealthy(`http://127.0.0.1:${apiPort}/api/health`))) return false;

  const integrationHealth = await getJson(integrationHealthUrl);
  return integrationMatchesCurrentConfig(integrationHealth);
}

function integrationMatchesCurrentConfig(integrationHealth) {
  if (!integrationHealth) return false;
  return (
    String(integrationHealth.adapter || "") === designPlatformAdapter &&
    normalizeBaseUrl(integrationHealth.baseUrl) === normalizeBaseUrl(designPlatformDefaults().DESIGN_PLATFORM_BASE_URL)
  );
}

async function waitForHealth(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isHealthy(url)) return true;
    await sleep(1000);
  }
  return false;
}

async function waitForStableHealth(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isHealthy(url)) {
      await sleep(1000);
      if (await isHealthy(url)) return true;
    }
    await sleep(1000);
  }
  return false;
}

async function waitForStableServiceReady(service, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServiceReadyForCurrentConfig(service)) {
      await sleep(1000);
      if (await isServiceReadyForCurrentConfig(service)) return true;
    }
    await sleep(1000);
  }
  return false;
}

function isHealthy(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 1500 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

function getJson(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 1500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
    request.on("error", () => resolve(null));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function npmCommand() {
  return resolvedNpmCommand() || npmCommandName();
}

function npmCommandName() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function resolvedNpmCommand() {
  const fromPath = resolveCommandPath(npmCommandName());
  if (fromPath) return fromPath;
  if (process.platform === "win32") {
    const besideNode = path.join(path.dirname(process.execPath), "npm.cmd");
    if (fs.existsSync(besideNode)) return besideNode;
  }
  return "";
}

function resolvedNpmCliPath() {
  const candidates = [
    resolvedNpmCommand() ? path.join(path.dirname(resolvedNpmCommand()), "node_modules", "npm", "bin", "npm-cli.js") : "",
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((item) => item && fs.existsSync(item)) || "";
}

function assertRequiredCommands() {
  const missing = [];
  if (!commandExists("node")) missing.push("node");
  if (!resolvedNpmCommand()) missing.push(npmCommandName());
  if (missing.length) {
    throw new Error(`Missing startup dependency: ${missing.join(", ")}. Install Node.js 20 or newer first.`);
  }
}

function commandExists(command) {
  return Boolean(resolveCommandPath(command));
}

function resolveCommandPath(command) {
  if (path.isAbsolute(command) && fs.existsSync(command)) return command;
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [command], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return "";
  return String(result.stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || "";
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

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readPidFile() {
  try {
    return JSON.parse(fs.readFileSync(pidFile, "utf8"));
  } catch {
    return {};
  }
}

function writePidFile(records) {
  fs.writeFileSync(pidFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function assertNoConflictingDesignLauncher() {
  const conflictMode = realDesignMode ? "mock" : "real";
  const conflicts = findConflictingDesignLaunchers(conflictMode);
  if (!conflicts.length) return;

  console.log(`[blocked] A ${conflictMode} design launcher is still running for this project.`);
  for (const conflict of conflicts.slice(0, 5)) {
    console.log(`          PID ${conflict.pid}: ${truncateText(conflict.commandLine, 140)}`);
  }
  console.log("          Run npm.cmd run ports:stop, then start with only one design mode.");
  throw new Error(`Conflicting ${conflictMode} design launcher is still running.`);
}

async function assertNoActiveApiModeConflict() {
  const portOwners = getPortOwnerPids(apiPort);
  if (!portOwners.length) return;
  if (!(await isHealthy(`http://127.0.0.1:${apiPort}/api/health`))) return;

  const integrationHealth = await getJson(integrationHealthUrl);
  if (!integrationHealth || integrationMatchesCurrentConfig(integrationHealth)) return;

  console.log(`[blocked] NestJS API port ${apiPort} is already running with a different design mode.`);
  console.log(
    `          current adapter=${integrationHealth.adapter || "unknown"} base=${integrationHealth.baseUrl || "unknown"}`,
  );
  console.log(`          expected adapter=${designPlatformAdapter} base=${designPlatformDefaults().DESIGN_PLATFORM_BASE_URL}`);
  console.log("          Runtime design platform config was not changed.");
  console.log("          Run npm.cmd run ports:stop, then start with the matching mode.");
  throw new Error("Active API design mode does not match requested startup mode.");
}

function findConflictingDesignLaunchers(mode) {
  if (process.platform !== "win32") return [];

  const launcherFile = mode === "real" ? "launch-real.cmd" : "launch-mock.cmd";
  const supervisorFile = mode === "real" ? "supervise-real.cmd" : "supervise-mock.cmd";
  const stableSupervisorFile = mode === "real" ? "stable-supervise-real.cmd" : "stable-supervise-mock.cmd";
  const modeArg = mode === "real" ? "--real-design" : "--mock-design";
  const batFile = mode === "real" ? "run_desktop_real_design.bat" : "run_desktop.bat";
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$root = ${psQuote(normalizePathText(desktopRoot))}`,
    "$selfPid = $PID",
    "$items = Get-CimInstance Win32_Process | Where-Object {",
    "  $_.ProcessId -ne $selfPid -and $_.CommandLine -and",
    "  ($_.CommandLine -notlike '*Get-CimInstance Win32_Process*') -and",
    "  ($_.CommandLine -replace '\\\\','/').ToLowerInvariant().Contains($root) -and",
    `  ((($_.CommandLine -like '*start-dev-ports.js*') -and ($_.CommandLine -like '*${modeArg}*')) -or`,
    `    ($_.CommandLine -like '*${launcherFile}*') -or`,
    `    ($_.CommandLine -like '*${supervisorFile}*') -or`,
    `    ($_.CommandLine -like '*${stableSupervisorFile}*') -or`,
    `    ($_.CommandLine -like '*${batFile}*'))`,
    "} | Select-Object -First 8 ProcessId,CommandLine",
    "if ($items) { $items | ConvertTo-Json -Compress }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: desktopRoot,
    env: windowsSafeEnv(process.env),
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return [];

  try {
    const parsed = JSON.parse(result.stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((item) => ({
        pid: Number(item.ProcessId),
        commandLine: String(item.CommandLine || ""),
      }))
      .filter((item) => Number.isFinite(item.pid) && item.commandLine);
  } catch {
    return [];
  }
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function serviceEnv() {
  return {
    ...process.env,
    ...serviceDefaultEnv(),
  };
}

function windowsSafeEnv(env) {
  if (process.platform !== "win32") return env;
  const safe = {};
  const seen = new Set();
  for (const [key, value] of Object.entries(env)) {
    const normalized = key.toUpperCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    safe[key] = value;
  }
  return safe;
}

function serviceDefaultEnv() {
  return {
    NEXT_TELEMETRY_DISABLED: "1",
    USE_LOCAL_STORE: process.env.USE_LOCAL_STORE || "true",
    PORT: String(webPort),
    WEB_PORT: String(webPort),
    API_PORT: String(apiPort),
    MOCK_DESIGN_PLATFORM_PORT: String(mockPort),
    DESIGN_PLATFORM_RUNTIME_CONFIG: designPlatformConfigFile,
    ...designPlatformDefaults(),
  };
}

function designPlatformDefaults() {
  const shouldReuseExistingBaseUrl =
    realDesignMode && existingDesignPlatformAdapter === designPlatformAdapter && Boolean(existingDesignPlatformBaseUrl);
  const envBaseUrl = process.env.DESIGN_PLATFORM_BASE_URL || "";
  const shouldUseEnvBaseUrl =
    realDesignMode && Boolean(envBaseUrl) && normalizeBaseUrl(envBaseUrl) !== `http://127.0.0.1:${mockPort}`;
  return {
    DESIGN_PLATFORM_ADAPTER: designPlatformAdapter,
    DESIGN_PLATFORM_BASE_URL:
      (shouldUseEnvBaseUrl ? envBaseUrl : "") ||
      (shouldReuseExistingBaseUrl ? existingDesignPlatformBaseUrl : "") ||
      (designPlatformAdapter === "art_image_local" ? "http://127.0.0.1:3000" : `http://127.0.0.1:${mockPort}`),
  };
}

function designPlatformHealthUrl() {
  const defaults = designPlatformDefaults();
  const baseUrl = defaults.DESIGN_PLATFORM_BASE_URL.replace(/\/+$/, "");
  if (defaults.DESIGN_PLATFORM_ADAPTER === "art_image_local") return `${baseUrl}/api/health`;
  return `${baseUrl}/v1/health`;
}

function writeRuntimeDesignPlatformConfig() {
  const defaults = designPlatformDefaults();
  const existing = readRuntimeDesignPlatformConfig();
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    designPlatformConfigFile,
    `${JSON.stringify(
      {
        ...existing,
        designPlatformAdapter: defaults.DESIGN_PLATFORM_ADAPTER,
        designPlatformBaseUrl: defaults.DESIGN_PLATFORM_BASE_URL,
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

function assertRealDesignStartAllowed() {
  if (!requestedRealDesignMode) return;
  if (!fs.existsSync(mockModeLockFile)) return;
  throw new Error(
    `Real design startup is blocked because mock mode is locked at ${mockModeLockFile}. Run npm.cmd run ports:stop before switching to real design mode.`,
  );
}

function assertMockDesignStartAllowed() {
  if (!includeMockDesignPlatform) return;
  const runtimeConfigLooksReal = existingDesignPlatformAdapter === "art_image_local";
  if (!fs.existsSync(realModeLockFile) && !findConflictingDesignLaunchers("real").length && (!runtimeConfigLooksReal || allowMockDesignStart)) {
    return;
  }
  throw new Error(
    `Mock design startup is blocked because real mode is active or locked at ${realModeLockFile}. Run npm.cmd run ports:stop before switching to mock design mode.`,
  );
}

function writeMockModeLockIfNeeded() {
  if (!includeMockDesignPlatform) return;
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(mockModeLockFile, `${new Date().toISOString()}\n`, "utf8");
}

function writeRealModeLockIfNeeded() {
  if (!realDesignMode) return;
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(realModeLockFile, `${new Date().toISOString()}\n`, "utf8");
}

function readRuntimeDesignPlatformConfig() {
  try {
    return JSON.parse(fs.readFileSync(designPlatformConfigFile, "utf8"));
  } catch {
    return {};
  }
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function psArray(values) {
  return `@(${values.map((value) => psQuote(value)).join(",")})`;
}

function psEnvName(value) {
  return String(value).replace(/[^\w]/g, "");
}

function psCommandArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function normalizePathText(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}
