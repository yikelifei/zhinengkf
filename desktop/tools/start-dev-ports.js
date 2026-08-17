"use strict";

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const {
  ensureInternalApiToken,
  internalApiServiceEnv,
  withoutInternalApiToken,
} = require("./internal-api-session");
const {
  ensureWechatWindowObserverProofSession,
  wechatWindowObserverServiceEnv,
} = require("./wechat-window-observer-session");
const {
  ensureWechatBridgeServiceSession,
  wechatBridgeServiceEnv,
} = require("./wechat-bridge-service-session");
const {
  createDesktopWebSession,
  desktopWebSessionServiceEnv,
  resolveDesktopWebSessionFile,
} = require("./desktop-web-session");
const { renderWindowsWrapperEnvironment, selectServiceEnvironment } = require("../packages/runtime/service-environment");
const { atomicWritePrivateJson, readPrivateJsonFile } = require("./private-runtime-file");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
  ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
  : path.join(desktopRoot, ".runtime");
const stableRuntimeDir = path.join(desktopRoot, ".runtime-stable");
const logsDir = path.join(runtimeDir, "logs");
const pidFile = path.join(runtimeDir, "dev-ports.json");
const stableStartingLockFile = path.join(stableRuntimeDir, "stable-starting.lock");
const stableKeepAliveHeartbeatFile = path.join(stableRuntimeDir, "keep-alive.json");
const stableRuntimeLauncherPidFile = path.join(stableRuntimeDir, "stable-runtime-launcher.pid");
const designPlatformConfigFile = path.join(runtimeDir, "design-platform-config.json");
const preferredDesignModeFile = path.join(runtimeDir, "preferred-design-mode.json");
const keepAliveHeartbeatFile = path.join(runtimeDir, "keep-alive.json");
const supervisorStopRequestFile = path.join(runtimeDir, "desktop-supervisor-stop-request");
const stableRuntimeStopRequestFile = path.join(runtimeDir, "stable-runtime-stop-request");
const mockModeLockFile = path.join(runtimeDir, "mock-mode.lock");
const realModeLockFile = path.join(runtimeDir, "real-mode.lock");
const mockRepairLockFile = path.join(runtimeDir, "mock-repair.lock");
const apiBuildEntryPath = path.join(desktopRoot, "dist", "apps", "api", "main.js");
const webStandaloneServer = path.join("apps", "web", ".next", "standalone", "apps", "web", "server.js");
const webStandaloneServerPath = path.join(desktopRoot, webStandaloneServer);
const webRuntimeServerPath = path.join(runtimeDir, "web-standalone-server.js");
const webBuildIdPath = path.join(desktopRoot, "apps", "web", ".next", "BUILD_ID");
const webRequiredServerFilesPath = path.join(desktopRoot, "apps", "web", ".next", "required-server-files.json");
const webStandaloneBuildIdPath = path.join(
  desktopRoot,
  "apps",
  "web",
  ".next",
  "standalone",
  "apps",
  "web",
  ".next",
  "BUILD_ID",
);
const internalApiToken = ensureInternalApiToken();
const desktopWebSession = {
  sessionFile: resolveDesktopWebSessionFile(runtimeDir),
  proof: "",
};
const observerProofSession = ensureWechatWindowObserverProofSession(runtimeDir);
const bridgeServiceSession = ensureWechatBridgeServiceSession(runtimeDir);
const args = new Set(process.argv.slice(2));
const includeApi = !args.has("--no-api");
const statusOnly = args.has("--status");
const preflightOnly = args.has("--preflight");
const keepAliveLauncher = args.has("--keep-alive");
const startServicesThroughWrappers = process.env.START_SERVICES_THROUGH_WRAPPERS === "1";
const requireFreePorts = args.has("--require-free-ports");
const allowMockDesignStart = process.env.FORCE_MOCK_DESIGN_START === "1";
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
const preferredDesignMode = readPreferredDesignMode();
const shouldReuseRealDesignMode =
  !requestedMockDesignMode &&
  !requestedRealDesignMode &&
  (existingDesignPlatformAdapter === "art_image_local" || preferredDesignMode === "real" || fs.existsSync(realModeLockFile));
const designPlatformAdapter =
  (requestedRealDesignMode || shouldReuseRealDesignMode) && !forceMockDesignMode ? "art_image_local" : "standard_v1";
const realDesignMode = designPlatformAdapter === "art_image_local";
const includeMockDesignPlatform =
  designPlatformAdapter === "standard_v1" &&
  (forceMockDesignMode || process.env.START_MOCK_DESIGN_PLATFORM === undefined
    ? true
    : process.env.START_MOCK_DESIGN_PLATFORM !== "false");
const integrationHealthUrl = `http://127.0.0.1:${apiPort}/api/integrations/design-platform/health`;
const defaultZhenxiAiDesktopBaseUrl = "http://127.0.0.1:3000";
const deprecatedZhenxiAiDesktopBaseUrl = "http://127.0.0.1:31870";

const services = [
  {
    name: "web",
    label: "Customer workbench",
    port: webPort,
    url: `http://127.0.0.1:${webPort}/`,
    command: process.execPath,
    commandArgs: [webRuntimeServerPath],
    cwd: desktopRoot,
    enabled: true,
  },
  {
    name: "design-platform-mock",
    label: "Mock design platform",
    port: mockPort,
    url: `http://127.0.0.1:${mockPort}/v1/health`,
    command: process.execPath,
    commandArgs: [path.join(desktopRoot, "tools", "mock-design-platform.js")],
    cwd: desktopRoot,
    enabled: includeMockDesignPlatform,
  },
  {
    name: "api",
    label: "NestJS API",
    port: apiPort,
    url: `http://127.0.0.1:${apiPort}/api/health`,
    command: process.execPath,
    commandArgs: [path.join(desktopRoot, "dist", "apps", "api", "main.js")],
    cwd: desktopRoot,
    enabled: includeApi,
  },
];
const managedChildren = [];
const keepAliveTimers = [];
const keepAliveHeartbeatTimers = [];
const keepAliveAnchors = [];
const keepAliveServers = [];
const serviceRestartGraceUntil = new Map();
let webDevServerFallback = false;

main().catch((error) => {
  logFatal("main", error, { exit: false });
  process.exitCode = 1;
});

process.on("uncaughtException", (error) => {
  if (isBrokenPipeError(error)) return;
  logFatal("uncaughtException", error);
});

process.on("unhandledRejection", (error) => {
  logFatal("unhandledRejection", error);
});

process.stdout?.on?.("error", (error) => {
  if (!isBrokenPipeError(error)) logFatal("stdout", error, { exit: false });
});

process.stderr?.on?.("error", (error) => {
  if (!isBrokenPipeError(error)) logFatal("stderr", error, { exit: false });
});

process.on("beforeExit", (code) => {
  logLifecycle("beforeExit", code);
});

process.on("exit", (code) => {
  logLifecycle("exit", code);
});

async function main() {
  fs.mkdirSync(logsDir, { recursive: true });

  if (!statusOnly && (await stableDesktopGuardActive())) {
    console.log("[ports] stable desktop runtime is active; legacy start-dev-ports skipped.");
    return;
  }

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

  if (!statusOnly && !preflightOnly) {
    writeRuntimeDesignPlatformConfig();
    writePreferredDesignMode();
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
  ensureDesktopWebSessionForLaunch();
  if (keepAliveLauncher) {
    startKeepAliveHeartbeat();
    startKeepAliveAnchor();
  }

  const records = readPidFile();
  let startedAnyService = false;
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
      if (keepAliveLauncher) {
        console.log(`[recover] ${service.label} port ${service.port} is unhealthy. Stopping PID ${portOwners.join(", ")} before restart.`);
        for (const pid of portOwners) stopPid(pid);
        await sleep(1000);
      } else {
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
    }

    ensureServiceArtifactReady(service);
    const child = startService(service);
    startedAnyService = true;
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

  let allReady = false;
  try {
    allReady = await waitAndPrint(services.filter((item) => item.enabled), records);
  } catch (error) {
    if (!keepAliveLauncher) throw error;
    logFatal("initialReadyCheck", error, { exit: false });
  }
  console.log("[info] Local JSON data mode is enabled by default. Set USE_LOCAL_STORE=false for database mode later.");

  if (keepAliveLauncher) {
    if (!allReady) {
      console.log("[keep-alive] Some services were not ready yet. Keeping launcher alive so managed services can recover.");
    }
    if (!startedAnyService && allReady && findSameModeKeepAliveLaunchers().length) {
      console.log("[keep-alive] Services are already owned by another launcher; exiting duplicate keep-alive.");
      return;
    }
    startModeLockHeartbeat();
    console.log("[keep-alive] Port services are running. Use npm.cmd run ports:stop to stop them.");
    await waitUntilStopped();
    return;
  }

  if (!allReady) {
    process.exitCode = 1;
    return;
  }
}

function startKeepAliveMonitor() {
  if (keepAliveTimers.length) return;
  const timer = setInterval(() => {
    try {
      if (keepAliveStopRequested()) {
        stopManagedChildrenForShutdown();
        process.exit(0);
      }
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
        ensureServiceArtifactReady(service, launcherLogPath);
        appendLauncherLine(launcherLogPath, `monitor restarting ${service.name}`);
        const child = startService(service);
        refreshServiceRecord(service, child?.pid);
      }
    } catch (error) {
      logFatal("keepAliveMonitor", error, { exit: false });
    }
  }, 2000);
  timer.ref();
  keepAliveTimers.push(timer);
}

function ensureDesktopWebSessionForLaunch() {
  Object.assign(
    desktopWebSession,
    createDesktopWebSession(runtimeDir, { sessionFile: desktopWebSession.sessionFile }),
  );
}

function ensureServiceArtifactReady(service, launcherLogPath = "") {
  if (service.name === "web" && webDevServerFallback) return;
  if (service.name === "web" && (!fs.existsSync(webRuntimeServerPath) || !webProductionBuildReadyForStartup())) {
    if (process.env.SKIP_EXISTING_WEB_BUILD === "1") {
      if (webProductionBuildReadyForStartup()) {
        appendLauncherLine(
          launcherLogPath || path.join(logsDir, "web.launcher.log"),
          "web runtime wrapper missing; reusing existing web production build",
        );
        writeRuntimeWebStandaloneServer();
        return;
      }
      if (useWebDevServerFallback(new Error("web production build is unavailable"), "web rebuild skipped for stable startup")) return;
    }
    appendLauncherLine(launcherLogPath || path.join(logsDir, "web.launcher.log"), "web standalone build incomplete; rebuilding web before start");
    try {
      runPackageScript("build:web");
      writeRuntimeWebStandaloneServer();
    } catch (error) {
      if (useWebDevServerFallback(error, "web standalone rebuild failed")) return;
      throw error;
    }
    return;
  }
  if (service.name === "web") {
    writeRuntimeWebStandaloneServer();
  }
  if (service.name === "api" && !fs.existsSync(apiBuildEntryPath)) {
    appendLauncherLine(launcherLogPath || path.join(logsDir, "api.launcher.log"), "api build entry missing; rebuilding api before start");
    runPackageScript("build:api");
  }
}

function webProductionBuildReadyForStartup() {
  return fs.existsSync(webBuildIdPath) && fs.existsSync(webRequiredServerFilesPath);
}

function writeRuntimeWebStandaloneServer() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    webRuntimeServerPath,
    `"use strict";\n` +
      `const path = require("node:path");\n` +
      `const { createRequire } = require("node:module");\n` +
      `const root = ${JSON.stringify(desktopRoot)};\n` +
      `const rootRequire = createRequire(path.join(root, "package.json"));\n` +
      `const webRoot = path.join(root, "apps", "web");\n` +
      `const requiredServerFiles = rootRequire(path.join(webRoot, ".next", "required-server-files.json"));\n` +
      `const currentPort = parseInt(process.env.PORT, 10) || 3100;\n` +
      `const hostname = process.env.HOSTNAME || "127.0.0.1";\n` +
      `let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);\n` +
      `const keepAlive = setInterval(() => undefined, 60000);\n` +
      `keepAlive.ref();\n` +
      `process.env.NODE_ENV = "production";\n` +
      `process.chdir(webRoot);\n` +
      `const nextConfig = { ...requiredServerFiles.config, distDir: ".next" };\n` +
      `process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);\n` +
      `rootRequire("next");\n` +
      `const { startServer } = rootRequire("next/dist/server/lib/start-server");\n` +
      `if (Number.isNaN(keepAliveTimeout) || !Number.isFinite(keepAliveTimeout) || keepAliveTimeout < 0) keepAliveTimeout = undefined;\n` +
      `startServer({ dir: webRoot, isDev: false, config: nextConfig, hostname, port: currentPort, allowRetry: false, keepAliveTimeout })\n` +
      `  .catch((error) => { console.error(error); clearInterval(keepAlive); process.exit(1); });\n`,
    "utf8",
  );
}

function appendLauncherLine(filePath, message) {
  appendSafeLogLine(filePath, `[${new Date().toISOString()}] ${message}`, { silent: true });
}

function appendSafeLogLine(filePath, message, options = {}) {
  const line = message.endsWith("\n") ? message : `${message}\n`;
  const fallbackPath = `${filePath}.retry.${process.pid}.${Date.now()}.log`;
  for (const candidate of [filePath, fallbackPath]) {
    try {
      fs.mkdirSync(path.dirname(candidate), { recursive: true });
      fs.appendFileSync(candidate, line, "utf8");
      return true;
    } catch (error) {
      if ((error?.code !== "EBUSY" && error?.code !== "EPERM") || candidate === fallbackPath) {
        if (!options.silent) {
          console.warn(`[warn] log write failed for ${filePath}: ${error?.message || error}`);
        }
        return false;
      }
    }
  }
  return false;
}

function startModeLockHeartbeat() {
  if (!realDesignMode) return;
  writeRealModeLockIfNeeded();
  setInterval(writeRealModeLockIfNeeded, 5000);
}

function startManagedChild(service, stdoutPath, stderrPath, launcherLogPath, wrapperPath, launchCommandOverride) {
  const launchCommand = launchCommandOverride || { command: service.command, commandArgs: service.commandArgs, usesOwnRedirection: false };
  const stdout = launchCommand.usesOwnRedirection ? null : openServiceLogForAppend(stdoutPath, launcherLogPath, service.name, "out");
  const stderr = launchCommand.usesOwnRedirection ? null : openServiceLogForAppend(stderrPath, launcherLogPath, service.name, "err");
  const stdio = launchCommand.usesOwnRedirection ? ["ignore", "ignore", "ignore"] : ["ignore", stdout, stderr];
  const child = spawn(launchCommand.command, launchCommand.commandArgs, {
    cwd: serviceCwd(service),
    env: serviceEnv(service),
    detached: process.platform === "win32",
    stdio,
    windowsHide: true,
  });
  if (process.platform === "win32") child.unref();
  appendLauncherLine(
    launcherLogPath,
    `launched managed child ${child.pid || "unknown"} via ${launchCommand.usesOwnRedirection ? "wrapper command" : "direct service command"}; wrapper kept at ${wrapperPath}`,
  );
  managedChildren.push(child);
  serviceRestartGraceUntil.set(service.name, Date.now() + serviceReadyTimeoutMs(service));
  scheduleServiceRecordRefresh(service, child.pid);
  child.once("exit", (code, signal) => {
    appendLauncherLine(launcherLogPath, `${service.name} managed process exited code=${code ?? ""} signal=${signal ?? ""}`);
    const index = managedChildren.indexOf(child);
    if (index >= 0) managedChildren.splice(index, 1);
    if (stdout !== null) closeLogFd(stdout);
    if (stderr !== null) closeLogFd(stderr);
    if (keepAliveLauncher && service.name === "web" && code !== 0 && !webDevServerFallback) {
      configureWebDevServerFallback(`web standalone exited with code ${code ?? "unknown"}`);
      serviceRestartGraceUntil.set(service.name, 0);
      setImmediate(() => {
        if (getPortOwnerPids(service.port).length) return;
        const restartedChild = startService(service);
        refreshServiceRecord(service, restartedChild?.pid);
      });
    } else if (keepAliveLauncher && service.name === "web" && code !== 0) {
      serviceRestartGraceUntil.set(service.name, 0);
    }
  });
  return child;
}

function openServiceLogForAppend(filePath, launcherLogPath, serviceName, streamName) {
  try {
    return fs.openSync(filePath, "a");
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EBUSY") throw error;
    const fallbackPath = path.join(
      logsDir,
      `${serviceName}.${streamName}.${process.pid}.${Date.now()}.log`,
    );
    try {
      const fd = fs.openSync(fallbackPath, "a");
        appendLauncherLine(launcherLogPath, `${serviceName} ${streamName} log was locked; using ${fallbackPath}`);
        return fd;
      } catch (fallbackError) {
        appendLauncherLine(
          launcherLogPath,
          `${serviceName} ${streamName} log open failed; using ignored stdio: ${fallbackError?.message || fallbackError}`,
        );
        return "ignore";
      }
  }
}

function closeLogFd(value) {
  if (typeof value !== "number") return;
  try {
    fs.closeSync(value);
  } catch {
    // Closing a log descriptor must not stop the supervisor.
  }
}

function scheduleServiceRecordRefresh(service, childPid) {
  for (const delayMs of [1000, 5000, 12000]) {
    setTimeout(() => refreshServiceRecord(service, childPid), delayMs);
  }
}

function refreshServiceRecord(service, childPid) {
  const records = readPidFile();
  const portOwners = getPortOwnerPids(service.port);
  const childProcessPid = processIsRunning(childPid) ? numberOrUndefined(childPid) : undefined;
  const recordedPid = processIsRunning(records[service.name]?.pid) ? numberOrUndefined(records[service.name]?.pid) : undefined;
  const preferredPid = numberOrUndefined(portOwners[0]) || childProcessPid || recordedPid;
  const graceActive = (serviceRestartGraceUntil.get(service.name) || 0) > Date.now();
  records[service.name] = {
    ...records[service.name],
    name: service.name,
    label: service.label,
    port: service.port,
    url: service.url,
    pid: preferredPid,
    portOwnerPids: portOwners,
    status: portOwners.length ? "running" : preferredPid || graceActive ? "starting" : "down",
    updatedAt: new Date().toISOString(),
  };
  writePidFile(records);
}

async function buildApiIfNeeded() {
  const apiService = services.find((service) => service.name === "api");
  if (!apiService?.enabled) return;
  if (process.env.SKIP_EXISTING_API_BUILD === "1" && fs.existsSync(apiBuildEntryPath)) {
    console.log("[ok] API build entry exists, skip API rebuild.");
    return;
  }
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
  if (webDevServerFallback) return;
  if (await isServiceReadyForCurrentConfig(webService)) {
    console.log("[ok] Web workbench is already online, skip web rebuild.");
    return;
  }
  const portOwners = getPortOwnerPids(webService.port);
  if (portOwners.length) {
    console.log(`[blocked] Web port ${webService.port} is used by PID ${portOwners.join(", ")}. Skip web rebuild.`);
    return;
  }
  if (process.env.SKIP_EXISTING_WEB_BUILD === "1") {
    if (webProductionBuildReadyForStartup()) {
      writeRuntimeWebStandaloneServer();
      console.log("[ok] Web production build exists, skip web rebuild.");
      return;
    }
    if (useWebDevServerFallback(new Error("web production build is unavailable"), "web rebuild skipped for stable startup")) return;
  }
  if (!webBuildIsStale()) return;

  const hadExistingWebStandalone = fs.existsSync(webRuntimeServerPath);
  console.log("[build] Building web standalone assets before startup...");
  waitForExistingWebBuild("before web build");
  try {
    runPackageScript("build:web");
  } catch (error) {
    if (useExistingWebStandaloneAfterBuildFailure(error, hadExistingWebStandalone)) return;
    console.log(`[warn] Web build failed once: ${error instanceof Error ? error.message : String(error)}`);
    console.log("[build] Waiting for any existing web build to finish, then retrying web build...");
    waitForExistingWebBuild("before web build retry", { minWaitMs: 2000 });
    try {
      runPackageScript("build:web");
    } catch (retryError) {
      if (useExistingWebStandaloneAfterBuildFailure(retryError, hadExistingWebStandalone)) return;
      if (useWebDevServerFallback(retryError, "web build retry failed")) return;
      throw retryError;
    }
  }
  writeRuntimeWebStandaloneServer();
}

function useWebDevServerFallback(error, reason) {
  if (!keepAliveLauncher) return false;
  configureWebDevServerFallback(`${reason}: ${error instanceof Error ? error.message : String(error)}`);
  return true;
}

function configureWebDevServerFallback(reason) {
  const webService = services.find((service) => service.name === "web");
  if (!webService || webDevServerFallback) return;
  webDevServerFallback = true;
  webService.command = process.execPath;
  webService.commandArgs = [
    "node_modules/next/dist/bin/next",
    "dev",
    "apps/web",
    "-H",
    "127.0.0.1",
    "-p",
    String(webPort),
    "--webpack",
  ];
  webService.cwd = desktopRoot;
  console.log(`[warn] ${reason}. Using Next dev server for local startup.`);
}

function useExistingWebStandaloneAfterBuildFailure(error, hadExistingWebStandalone) {
  if (!hadExistingWebStandalone) return false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (fs.existsSync(webRuntimeServerPath)) {
      console.log(
        `[warn] Web rebuild failed (${error instanceof Error ? error.message : String(error)}), but ${path.relative(desktopRoot, webRuntimeServerPath)} exists. Starting with the existing standalone build.`,
      );
      return true;
    }
    sleepMs(200);
  }
  console.log(
    `[warn] Web rebuild failed (${error instanceof Error ? error.message : String(error)}), and the previous ${path.relative(desktopRoot, webRuntimeServerPath)} is not available anymore.`,
  );
  return false;
}

function waitForExistingWebBuild(reason, options = {}) {
  const deadline = Date.now() + (options.timeoutMs || 120000);
  if (options.minWaitMs) sleepMs(options.minWaitMs);
  let lastPids = [];
  while (Date.now() < deadline) {
    const pids = findProjectWebBuildPids();
    if (!pids.length) {
      if (lastPids.length) console.log(`[build] Existing web build finished (${reason}).`);
      return;
    }
    if (pids.join(",") !== lastPids.join(",")) {
      console.log(`[build] Waiting for existing web build PID ${pids.join(", ")} (${reason})...`);
      lastPids = pids;
    }
    sleepMs(2000);
  }
  const pids = findProjectWebBuildPids();
  if (pids.length) throw new Error(`Timed out waiting for existing web build PID ${pids.join(", ")} (${reason})`);
}

function webBuildIsStale() {
  if (!fs.existsSync(webRuntimeServerPath) || !fs.existsSync(webBuildIdPath)) return true;
  if (process.env.FORCE_WEB_REBUILD === "1") return true;
  if (process.env.SKIP_WEB_REBUILD !== "0") return false;
  const builtAt = fs.statSync(webRuntimeServerPath).mtimeMs;
  return [
    path.join(desktopRoot, "apps", "web", "src"),
    path.join(desktopRoot, "apps", "web", "public"),
    path.join(desktopRoot, "apps", "web", "next.config.js"),
    path.join(desktopRoot, "package.json"),
  ].some((item) => pathHasFileNewerThan(item, builtAt));
}

function findProjectWebBuildPids() {
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
      if (!commandLine.includes(normalizedRoot)) return false;
      if (commandLine.includes("tools/build-web.js")) return true;
      if (
        commandLine.includes("node_modules/next/dist/bin/next") &&
        commandLine.includes("build") &&
        commandLine.includes("apps/web")
      ) {
        return true;
      }
      if (commandLine.includes("node_modules/next/dist/compiled/jest-worker/processchild.js")) return true;
      return commandLine.includes("typescript/bin/tsc") && commandLine.includes("apps/web/tsconfig.json");
    })
    .map((item) => String(item.ProcessId || ""))
    .filter((pid) => /^\d+$/.test(pid));
}

function stopExistingWebBuildProcesses(reason) {
  const pids = findProjectWebBuildPids();
  if (!pids.length) return;
  console.log(`[build] Stopping existing web build PID ${pids.join(", ")} (${reason})...`);
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
    env: packageScriptEnv(),
    stdio: "inherit",
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${scriptName} failed${result.error ? `: ${result.error.message}` : ""}`);
  }
}

function packageScriptEnv() {
  const env = withoutInternalApiToken({
    ...process.env,
    FORCE_WEB_CLEAN_BUILD: "0",
  });
  return process.platform === "win32" ? windowsSafeEnv(env) : env;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isBrokenPipeError(error) {
  return error && (error.code === "EPIPE" || String(error.message || "").includes("EPIPE"));
}

function waitUntilStopped() {
  startKeepAliveMonitor();
  startKeepAliveHeartbeat();
  startKeepAliveAnchor();
  startKeepAliveServerAnchor();
  return new Promise(() => {
    const timer = setInterval(() => {
      if (!keepAliveStopRequested()) return;
      stopManagedChildrenForShutdown();
      process.exit(0);
    }, 1000);
    timer.ref();
    keepAliveTimers.push(timer);
  });
}

function keepAliveStopRequested() {
  return fs.existsSync(supervisorStopRequestFile) || fs.existsSync(stableRuntimeStopRequestFile);
}

function stopManagedChildrenForShutdown() {
  const pids = new Set();
  for (const child of managedChildren) {
    if (child?.pid) pids.add(String(child.pid));
  }
  const records = readPidFile();
  for (const record of Object.values(records)) {
    if (record?.pid) pids.add(String(record.pid));
    for (const pid of record?.portOwnerPids || []) pids.add(String(pid));
  }
  for (const pid of pids) stopPid(pid);
}

function startKeepAliveHeartbeat() {
  if (keepAliveHeartbeatTimers.length) return;
  writeKeepAliveHeartbeat();
  const timer = setInterval(writeKeepAliveHeartbeat, 5000);
  timer.ref();
  keepAliveHeartbeatTimers.push(timer);
}

function writeKeepAliveHeartbeat() {
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      keepAliveHeartbeatFile,
      `${JSON.stringify(
        {
          pid: process.pid,
          mode: realDesignMode ? "real" : "mock",
          args: process.argv.slice(2),
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch (error) {
    logFatal("writeKeepAliveHeartbeat", error, { exit: false });
  }
}

function startKeepAliveAnchor() {
  if (keepAliveAnchors.length) return;
  const anchor = setInterval(() => undefined, 60_000);
  anchor.ref();
  keepAliveAnchors.push(anchor);
}

function startKeepAliveServerAnchor() {
  if (keepAliveServers.length) return;
  const server = net.createServer((socket) => socket.end());
  server.listen(0, "127.0.0.1", () => {
    server.ref();
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : "unknown";
    logLifecycle(`keepAliveServerAnchor port=${port}`, 0);
  });
  server.on("error", (error) => logFatal("keepAliveServerAnchor", error, { exit: false }));
  keepAliveServers.push(server);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      try {
        server.close();
      } finally {
        process.exit(0);
      }
    });
  }
}

function logFatal(scope, error, options = {}) {
  const message = error?.stack || error?.message || String(error);
  const line = `[${new Date().toISOString()}] ${scope}: ${message}\n`;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    appendSafeLogLine(path.join(logsDir, "start-dev-ports.fatal.log"), line, { silent: true });
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
    appendSafeLogLine(
      path.join(logsDir, "start-dev-ports.lifecycle.log"),
      `[${new Date().toISOString()}] pid=${process.pid} args=${JSON.stringify(process.argv.slice(2))} ${scope} code=${code}`,
      { silent: true },
    );
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
    cwd: serviceCwd(service),
    env: serviceEnv(service),
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

  appendLauncherLine(launcherLogPath, `launching ${service.name}`);
  if (keepAliveLauncher && !startServicesThroughWrappers) {
    appendLauncherLine(
      launcherLogPath,
      `wrapper prepared at ${wrapperPath}; launching direct service process for keep-alive supervision`,
    );
  }
  if (keepAliveLauncher && startServicesThroughWrappers) {
    appendLauncherLine(
      launcherLogPath,
      `wrapper prepared at ${wrapperPath}; launching detached Windows service wrapper for keep-alive supervision`,
    );
  }
  const launchCommand = keepAliveLauncher && !startServicesThroughWrappers
    ? { command: service.command, commandArgs: service.commandArgs, usesOwnRedirection: false }
    : windowsServiceLaunchCommand(service, wrapperPath);
  return startManagedChild(service, stdoutPath, stderrPath, launcherLogPath, wrapperPath, launchCommand);
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
    `cd /d ${cmdQuote(serviceCwd(service))}`,
    ...renderWindowsWrapperEnvironment(service.name, serviceEnv(service)),
    `echo [%date% %time%] launching ${service.name} >> ${cmdQuote(launcherLogPath)}`,
    runLine,
  ];
  return `${lines.join("\r\n")}\r\n`;
}

function serviceCwd(service) {
  return service.cwd || desktopRoot;
}

function commandRecordLine(command, args = []) {
  return [cmdQuote(command), ...args.map(cmdQuote)].join(" ");
}

function windowsServiceLaunchCommand(service, wrapperPath) {
  if (process.platform === "win32" && wrapperPath) {
    appendLauncherLine(
      path.join(logsDir, `${service.name}.launcher.log`),
      `wrapper prepared at ${wrapperPath}; launching detached Windows service wrapper through PowerShell Start-Process for stable supervision`,
    );
  }
  return {
    command: "powershell.exe",
    commandArgs: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Start-Process -FilePath ${psQuote(wrapperPath)} -WorkingDirectory ${psQuote(desktopRoot)} -WindowStyle Minimized`,
    ],
    usesOwnRedirection: true,
  };
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
      pid: ok || portOwners.length ? numberOrUndefined(portOwners[0]) || records[service.name]?.pid : undefined,
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
  const apiHealthUrl = `http://127.0.0.1:${apiPort}/api/health`;
  const apiReachable = await isHealthyWithRetry(apiHealthUrl, 2, 250);
  const apiHealth = apiReachable ? await getJsonWithRetry(apiHealthUrl, 2, 250) : null;
  const integrationHealth = apiReachable ? await getJsonWithRetry(integrationHealthUrl, 10, 500) : null;
  const effectiveServices =
    designPlatformAdapter === "art_image_local"
      ? services.filter((service) => service.enabled && service.name !== "design-platform-mock")
      : services.filter((service) => service.enabled);

  for (const service of services.filter((item) => !effectiveServices.some((active) => active.name === item.name))) {
    delete records[service.name];
  }

  for (const service of effectiveServices) {
    const reachable = await isHealthyWithRetry(service.url, 10, 500);
    const configMismatch =
      service.name === "api" && reachable && integrationHealth && !integrationMatchesCurrentConfig(integrationHealth);
    const runtimeMismatch = service.name === "api" && reachable && !apiHealthUsesRuntimeDir(apiHealth);
    const portOwners = getPortOwnerPids(service.port);
    const ownerMismatch = workspacePortOwnerMismatchReason(service.name, portOwners);
    const webRuntimeMismatch = service.name === "web" ? webPortRuntimeMismatchReason(portOwners) : "";
    const ok = reachable && !configMismatch && !runtimeMismatch && !ownerMismatch && !webRuntimeMismatch;
    const portText = portOwners.length ? ` port=${service.port} pid=${portOwners.join(",")}` : "";
    const statusLabel = ok
      ? "[ready]"
      : configMismatch
        ? "[wrong-mode]"
        : runtimeMismatch || webRuntimeMismatch
          ? "[wrong-runtime]"
          : ownerMismatch
            ? "[blocked]"
            : "[down] ";
    console.log(`${statusLabel} ${service.label} ${service.url}${portText}`);
    if (runtimeMismatch) console.log(`          API local store is outside current runtime: ${apiHealth?.localStore?.path || "unknown"}`);
    if (webRuntimeMismatch) console.log(`          ${webRuntimeMismatch}`);
    if (ownerMismatch) console.log(`          ${ownerMismatch}`);
    records[service.name] = {
      ...records[service.name],
      name: service.name,
      label: service.label,
      port: service.port,
      url: service.url,
      pid: ok || portOwners.length ? numberOrUndefined(portOwners[0]) || records[service.name]?.pid : undefined,
      portOwnerPids: portOwners,
      status: ok ? "running" : configMismatch ? "wrong_mode" : runtimeMismatch || webRuntimeMismatch ? "wrong_runtime" : "down",
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
  const portOwners = getPortOwnerPids(service.port);
  if (workspacePortOwnerMismatchReason(service.name, portOwners)) return false;
  if (service.name === "web" && webPortRuntimeMismatchReason(portOwners)) return false;
  if (!(await isHealthy(service.url))) return false;
  if (service.name === "web") return isDesktopWebSessionReady();
  if (service.name !== "api") return true;

  const apiHealth = await getJson(`http://127.0.0.1:${apiPort}/api/health`);
  if (!apiHealthUsesRuntimeDir(apiHealth)) return false;
  const integrationHealth = await getJson(integrationHealthUrl);
  return integrationMatchesCurrentConfig(integrationHealth);
}

async function isDesktopWebSessionReady() {
  const proof = String(desktopWebSession.proof || "").trim();
  if (!proof) return false;
  const health = await getJson(`http://127.0.0.1:${webPort}/api/health`, {
    headers: { Cookie: `smart_kefu_desktop_session=${proof}` },
  });
  return Boolean(health?.ok);
}

async function isApiIntegrationReadyForCurrentConfig() {
  if (!(await isHealthy(`http://127.0.0.1:${apiPort}/api/health`))) return false;

  const apiHealth = await getJson(`http://127.0.0.1:${apiPort}/api/health`);
  if (!apiHealthUsesRuntimeDir(apiHealth)) return false;
  const integrationHealth = await getJson(integrationHealthUrl);
  return integrationMatchesCurrentConfig(integrationHealth);
}

function apiHealthUsesRuntimeDir(apiHealth) {
  const storePath = apiHealth?.localStore?.path;
  if (!storePath) return true;
  return normalizePathText(storePath).startsWith(normalizePathText(runtimeDir));
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

async function isHealthyWithRetry(url, attempts, delayMs) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await isHealthy(url)) return true;
    if (attempt < attempts) await sleep(delayMs);
  }
  return false;
}

function getJson(url, options = {}) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 1500, ...options }, (response) => {
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

async function getJsonWithRetry(url, attempts, delayMs) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const value = await getJson(url);
    if (value) return value;
    if (attempt < attempts) await sleep(delayMs);
  }
  return null;
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
  if (command === "node" && process.execPath && fs.existsSync(process.execPath)) return true;
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

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function processIsRunning(pid) {
  const numericPid = numberOrUndefined(pid);
  if (!numericPid) return false;
  if (process.platform !== "win32") {
    try {
      process.kill(numericPid, 0);
      return true;
    } catch {
      return false;
    }
  }
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `if (Get-Process -Id ${numericPid} -ErrorAction SilentlyContinue) { '1' }`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return result.status === 0 && String(result.stdout || "").trim() === "1";
}

function readPidFile() {
  try {
    return JSON.parse(fs.readFileSync(pidFile, "utf8"));
  } catch {
    return {};
  }
}

function writePidFile(records) {
  try {
    fs.writeFileSync(pidFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  } catch (error) {
    if (statusOnly && (error?.code === "EPERM" || error?.code === "EACCES")) {
      console.warn(`[warn] status could not update pid file ${pidFile}: ${error.message}`);
      return;
    }
    throw error;
  }
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
    `    (($_.CommandLine -like '*desktop-service-supervisor.js*') -and ($_.CommandLine -like '*${modeArg}*')) -or`,
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

function findSameModeKeepAliveLaunchers() {
  if (process.platform !== "win32") return [];

  const modeArg = realDesignMode ? "--real-design" : "--mock-design";
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$root = ${psQuote(normalizePathText(desktopRoot))}`,
    `$selfPid = ${process.pid}`,
    `$parentPid = ${process.ppid || 0}`,
    "$items = Get-CimInstance Win32_Process | Where-Object {",
    "  $_.ProcessId -ne $selfPid -and $_.ProcessId -ne $parentPid -and $_.CommandLine -and",
    "  ($_.CommandLine -notlike '*Get-CimInstance Win32_Process*') -and",
    "  ($cmd = ($_.CommandLine -replace '\\\\','/').ToLowerInvariant()) -and",
    "  $cmd.Contains($root) -and",
    `  (`,
    `    ($cmd.Contains('tools/start-dev-ports.js') -and $cmd.Contains('${modeArg}') -and $cmd.Contains('--keep-alive')) -or`,
    `    ($cmd.Contains('tools/desktop-service-supervisor.js') -and $cmd.Contains('${modeArg}') -and $cmd.Contains('--supervisor-child'))`,
    "  )",
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

function serviceEnv(service) {
  const internalEnv = internalApiServiceEnv({
    ...process.env,
    ...serviceDefaultEnv(service),
  }, service?.name, internalApiToken);
  const desktopSessionEnv = desktopWebSession.proof
    ? desktopWebSessionServiceEnv(internalEnv, service?.name, desktopWebSession.proof)
    : internalEnv;
  const observerEnv = wechatWindowObserverServiceEnv(desktopSessionEnv, service?.name, observerProofSession.tokenFile);
  return selectServiceEnvironment(
    service?.name,
    wechatBridgeServiceEnv(observerEnv, service?.name, bridgeServiceSession.tokenFile),
  );
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

function serviceDefaultEnv(service) {
  return {
    NEXT_TELEMETRY_DISABLED: "1",
    FORCE_WEB_CLEAN_BUILD: "0",
    ALLOW_LOCAL_BROWSER_WEB_API: process.env.ALLOW_LOCAL_BROWSER_WEB_API === "0" ? "0" : "1",
    SMART_KEFU_RUNTIME_TARGET: process.env.SMART_KEFU_RUNTIME_TARGET || "desktop",
    USE_LOCAL_STORE: process.env.USE_LOCAL_STORE || "true",
    DESKTOP_RUNTIME_DIR: runtimeDir,
    LOCAL_STORE_FILE: path.join(runtimeDir, "local-store.json"),
    LOCAL_STORAGE_ROOT: path.join(runtimeDir, "storage"),
    LOW_VALUE_AUTOMATION_ENABLED: process.env.LOW_VALUE_AUTOMATION_ENABLED || "true",
    LOW_VALUE_AUTOMATION_RUN_ON_START: process.env.LOW_VALUE_AUTOMATION_RUN_ON_START || "true",
    LOW_VALUE_AUTOMATION_MODE: process.env.LOW_VALUE_AUTOMATION_MODE || "interval",
    PORT: String(service?.port || webPort),
    WEB_PORT: String(webPort),
    API_PORT: String(apiPort),
    MOCK_DESIGN_PLATFORM_PORT: String(mockPort),
    DESIGN_PLATFORM_RUNTIME_CONFIG: designPlatformConfigFile,
    WECHAT_BRIDGE_OUTBOX_DIR: path.join(runtimeDir, "wechat-outbox"),
    WECHAT_BRIDGE_INBOX_DIR: path.join(runtimeDir, "wechat-inbox"),
    WECHAT_BRIDGE_DISPATCH_DIR: path.join(runtimeDir, "wechat-dispatch"),
    WECHAT_BRIDGE_LOCK_DIR: path.join(runtimeDir, "wechat-bridge-locks"),
    WECHAT_BRIDGE_WORKER_STATUS_FILE: path.join(runtimeDir, "wechat-bridge-worker-status.json"),
    WECHAT_WINDOW_SNAPSHOT_INBOX_DIR: path.join(runtimeDir, "wechat-window-snapshots"),
    WECHAT_WINDOW_OBSERVER_STATUS_FILE: path.join(runtimeDir, "wechat-window-observer-status.json"),
    ...designPlatformDefaults(),
  };
}

function designPlatformDefaults() {
  const envBaseUrl = process.env.DESIGN_PLATFORM_BASE_URL || process.env.ZHENXI_AI_LOCAL_BASE_URL || "";
  const shouldUseEnvBaseUrl =
    realDesignMode && Boolean(envBaseUrl) && normalizeBaseUrl(envBaseUrl) !== `http://127.0.0.1:${mockPort}`;
  const existingBaseIsDeprecated = normalizeBaseUrl(existingDesignPlatformBaseUrl) === deprecatedZhenxiAiDesktopBaseUrl;
  const shouldReuseExistingBaseUrl =
    realDesignMode &&
    existingDesignPlatformAdapter === designPlatformAdapter &&
    Boolean(existingDesignPlatformBaseUrl) &&
    !existingBaseIsDeprecated;
  return {
    DESIGN_PLATFORM_ADAPTER: designPlatformAdapter,
    DESIGN_PLATFORM_BASE_URL:
      (shouldUseEnvBaseUrl ? envBaseUrl : "") ||
      (shouldReuseExistingBaseUrl ? existingDesignPlatformBaseUrl : "") ||
      (designPlatformAdapter === "art_image_local" ? defaultZhenxiAiDesktopBaseUrl : `http://127.0.0.1:${mockPort}`),
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
  atomicWritePrivateJson(designPlatformConfigFile, {
    ...existing,
    designPlatformAdapter: defaults.DESIGN_PLATFORM_ADAPTER,
    designPlatformBaseUrl: defaults.DESIGN_PLATFORM_BASE_URL,
    launcherPid: process.pid,
    launcherArgs: process.argv.slice(2),
    updatedAt: new Date().toISOString(),
  });
}

function assertRealDesignStartAllowed() {
  if (!requestedRealDesignMode) return;
  if (process.env.ALLOW_REAL_DESIGN_LAUNCH !== "1" || process.env.CONFIRM_REAL_DESIGN_SWITCH !== "1") {
    throw new Error(
      "Real design startup is disabled by default. Use run_desktop_real_design.bat, or run npm.cmd run ports:launch:real:confirmed when intentionally switching to the real design platform.",
    );
  }
  if (process.env.ALLOW_REAL_DESIGN_START !== "1") {
    throw new Error(
      "Real design startup must go through npm.cmd run ports:launch:real so stale raw keep-alive launchers cannot steal the default mock startup.",
    );
  }
  if (mockRepairLockIsFresh()) {
    throw new Error("Real design startup is blocked because default mock startup repair is in progress.");
  }
  if (mockRuntimeStateIsActive()) {
    throw new Error("Real design startup is blocked because mock design mode is active. Run npm.cmd run ports:stop before switching to real design mode.");
  }
  if (!fs.existsSync(mockModeLockFile)) return;
  if (
    !findConflictingDesignLaunchers("mock").length &&
    !getPortOwnerPids(mockPort).length &&
    !getPortOwnerPids(apiPort).length
  ) {
    fs.rmSync(mockModeLockFile, { force: true });
    console.log(`[launch] removed stale mock mode lock before real design startup: ${mockModeLockFile}`);
    return;
  }
  throw new Error(
    `Real design startup is blocked because mock mode is locked at ${mockModeLockFile}. Run npm.cmd run ports:stop before switching to real design mode.`,
  );
}

function mockRuntimeStateIsActive() {
  return fs.existsSync(mockModeLockFile) || existingDesignPlatformAdapter === "standard_v1" || preferredDesignMode === "mock";
}

function assertMockDesignStartAllowed() {
  if (!includeMockDesignPlatform) return;
  const runtimeConfigLooksReal = existingDesignPlatformAdapter === "art_image_local";
  const preferredRealMode = preferredDesignMode === "real";
  const realModeLocked = fs.existsSync(realModeLockFile);
  const realLaunchers = findConflictingDesignLaunchers("real");
  if (
    !realModeLocked &&
    !realLaunchers.length &&
    ((!runtimeConfigLooksReal && !preferredRealMode) || allowMockDesignStart)
  ) {
    return;
  }
  throw new Error(
    `Mock design startup is blocked because real mode is active, preferred, or locked at ${realModeLockFile}. Set FORCE_MOCK_DESIGN_START=1 before switching to mock design mode.`,
  );
}

function writeMockModeLockIfNeeded() {
  if (!includeMockDesignPlatform) return;
  writeRuntimeFileWithRetry(mockModeLockFile, `${new Date().toISOString()}\n`);
}

function writeRealModeLockIfNeeded() {
  if (!realDesignMode) return;
  writeRuntimeFileWithRetry(realModeLockFile, `${new Date().toISOString()}\n`);
}

function writePreferredDesignMode() {
  writeRuntimeFileWithRetry(
    preferredDesignModeFile,
    `${JSON.stringify(
      {
        mode: realDesignMode ? "real" : "mock",
        updatedAt: new Date().toISOString(),
        launcherPid: process.pid,
        launcherArgs: process.argv.slice(2),
      },
      null,
      2,
    )}\n`,
  );
}

function writeRuntimeFileWithRetry(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.writeFileSync(filePath, content, "utf8");
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code)) throw error;
      sleepSync(40 * (attempt + 1));
    }
  }
  throw lastError;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readRuntimeDesignPlatformConfig() {
  return readPrivateJsonFile(designPlatformConfigFile, {});
}

function readPreferredDesignMode() {
  try {
    const mode = JSON.parse(fs.readFileSync(preferredDesignModeFile, "utf8"))?.mode;
    return mode === "real" || mode === "mock" ? mode : "";
  } catch {
    return "";
  }
}

async function stableDesktopGuardActive() {
  if (process.env.ALLOW_LEGACY_START_WITH_STABLE === "1") return false;
  if (normalizePathText(runtimeDir) === normalizePathText(stableRuntimeDir)) return false;
  const processActive = stableStartingLockActive() || heartbeatFresh(stableKeepAliveHeartbeatFile, 3_600_000);
  if (!processActive) return false;
  console.log("[ports] stable desktop runtime guard is active; legacy start-dev-ports skipped.");
  return true;
}

function stableStartingLockActive() {
  if (fileFresh(stableStartingLockFile, 10 * 60_000)) return true;
  if (!fileFresh(stableStartingLockFile, 3_600_000)) return false;
  return stableRuntimeLauncherProcessActive(readNumericFile(stableRuntimeLauncherPidFile)) || findStableRuntimeLauncherProcesses().length > 0;
}

async function stableRuntimeServicesHealthy() {
  const webHealthy = await isHealthy(`http://127.0.0.1:${webPort}/`);
  if (!webHealthy) return false;
  const apiHealth = await getJson(`http://127.0.0.1:${apiPort}/api/health`);
  if (!apiHealth?.ok) return false;
  if (!includeMockDesignPlatform) return true;
  return isHealthy(`http://127.0.0.1:${mockPort}/v1/health`);
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
    return (
      Number.isFinite(pid) &&
      pid !== process.pid &&
      commandLine.includes(normalizedRoot) &&
      commandLine.includes("tools/stable-runtime-launcher.js")
    );
  });
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

function stopPid(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0 || numericPid === process.pid) return false;
  try {
    process.kill(numericPid, "SIGTERM");
  } catch {}
  if (process.platform !== "win32") return true;
  const script = `Stop-Process -Id ${numericPid} -Force -ErrorAction SilentlyContinue`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
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
