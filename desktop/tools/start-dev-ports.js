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
const args = new Set(process.argv.slice(2));
const includeApi = !args.has("--no-api");
const statusOnly = args.has("--status");
const preflightOnly = args.has("--preflight");
const requireFreePorts = args.has("--require-free-ports");
const forceMockDesignMode = args.has("--mock-design");
const webPort = numberEnv("WEB_PORT", 3100);
const mockPort = numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700);
const apiPort = numberEnv("API_PORT", 3200);
const existingDesignPlatformConfig = readRuntimeDesignPlatformConfig();
const existingDesignPlatformAdapter =
  typeof existingDesignPlatformConfig.designPlatformAdapter === "string" ? existingDesignPlatformConfig.designPlatformAdapter : "";
const existingDesignPlatformBaseUrl =
  typeof existingDesignPlatformConfig.designPlatformBaseUrl === "string" ? existingDesignPlatformConfig.designPlatformBaseUrl : "";
const designPlatformAdapter = forceMockDesignMode ? "standard_v1" : "art_image_local";
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
    commandArgs: ["node_modules/next/dist/bin/next", "dev", "apps/web", "-p", String(webPort)],
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

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(logsDir, { recursive: true });

  if (!statusOnly) {
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
  await buildApiIfNeeded();
  for (const disabledService of services.filter((item) => !item.enabled)) {
    delete records[disabledService.name];
  }
  for (const service of services.filter((item) => item.enabled)) {
    if (await isServiceReadyForCurrentConfig(service)) {
      const portOwners = getPortOwnerPids(service.port);
      const existingPid = records[service.name]?.pid;
      console.log(`[ok] ${service.label} is already online: ${service.url}`);
      records[service.name] = {
        ...records[service.name],
        name: service.name,
        label: service.label,
        port: service.port,
        url: service.url,
        pid: existingPid || numberOrUndefined(portOwners[0]),
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
      if (await waitForStableHealth(service.url, 30000)) {
        const healthyPortOwners = getPortOwnerPids(service.port);
        records[service.name] = {
          ...records[service.name],
          name: service.name,
          label: service.label,
          port: service.port,
          url: service.url,
          pid: records[service.name]?.pid || numberOrUndefined(healthyPortOwners[0]),
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
      command: [service.command, ...service.commandArgs].join(" "),
      startedAt: new Date().toISOString(),
      status: "starting",
    };
    writePidFile(records);
    console.log(`[start] ${service.label} pid=${child.pid} port=${service.port}`);
  }

  const allReady = await waitAndPrint(services.filter((item) => item.enabled), records);
  console.log("[info] Local JSON data mode is enabled by default. Set USE_LOCAL_STORE=false for database mode later.");

  if (!allReady) {
    process.exitCode = 1;
  }
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
  console.log("[build] Building API before startup...");
  runPackageScript("build:api");
}

function runPackageScript(scriptName) {
  const command = npmCommand();
  const args = ["run", scriptName];
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/c", [command, ...args].join(" ")], { cwd: desktopRoot, env: process.env, stdio: "inherit" })
      : spawnSync(command, args, { cwd: desktopRoot, env: process.env, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${scriptName} failed`);
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
  const wrapperPath = path.join(runtimeDir, `run-${service.name}.cmd`);
  fs.rmSync(stdoutPath, { force: true });
  fs.rmSync(stderrPath, { force: true });

  fs.writeFileSync(wrapperPath, buildWindowsServiceWrapper(service, stdoutPath, stderrPath), "utf8");

  const script =
    '$process = Start-Process -FilePath "$env:ComSpec" ' +
    `-ArgumentList @('/d','/c',${psQuote(`"${wrapperPath}"`)}) ` +
    `-WorkingDirectory ${psQuote(desktopRoot)} ` +
    "-WindowStyle Hidden -PassThru; " +
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
  return { pid: Number.isFinite(startedPid) ? startedPid : numberOrUndefined(getPortOwnerPids(service.port)[0]) };
}

function buildWindowsServiceWrapper(service, stdoutPath, stderrPath) {
  const command = [cmdQuote(service.command), ...service.commandArgs.map(cmdQuote)].join(" ");
  const lines = [
    "@echo off",
    `cd /d ${cmdQuote(desktopRoot)}`,
    ...Object.entries(serviceDefaultEnv()).map(([key, value]) => cmdSetEnv(key, value)),
    `echo [%date% %time%] starting ${service.name} >> ${cmdQuote(stdoutPath)}`,
    `${command} >> ${cmdQuote(stdoutPath)} 2>> ${cmdQuote(stderrPath)}`,
  ];
  return `${lines.join("\r\n")}\r\n`;
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

    const ok = await waitForStableHealth(service.url, 30000);
    const portOwners = getPortOwnerPids(service.port);
    records[service.name] = {
      ...records[service.name],
      status: ok ? "running" : "failed_or_slow",
      portOwnerPids: portOwners,
      updatedAt: new Date().toISOString(),
    };
    writePidFile(records);
    if (ok) {
      console.log(`[ready] ${service.label}: ${service.url}`);
    } else {
      allReady = false;
      console.log(`[warn] ${service.label} was not ready within 30 seconds.`);
      console.log(`       Check log: ${path.join(logsDir, `${service.name}.err.log`)}`);
    }
  }
  return allReady;
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
    const ok = await isHealthy(service.url);
    const portOwners = getPortOwnerPids(service.port);
    const portText = portOwners.length ? ` port=${service.port} pid=${portOwners.join(",")}` : "";
    console.log(`${ok ? "[ready]" : "[down] "} ${service.label} ${service.url}${portText}`);
    records[service.name] = {
      ...records[service.name],
      name: service.name,
      label: service.label,
      port: service.port,
      url: service.url,
      pid: records[service.name]?.pid || numberOrUndefined(portOwners[0]),
      portOwnerPids: portOwners,
      status: ok ? "running" : "down",
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
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function assertRequiredCommands() {
  const missing = ["node", npmCommand()].filter((command) => !commandExists(command));
  if (missing.length) {
    throw new Error(`Missing startup dependency: ${missing.join(", ")}. Install Node.js 20 or newer first.`);
  }
}

function commandExists(command) {
  return Boolean(resolveCommandPath(command));
}

function resolveCommandPath(command) {
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
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    designPlatformConfigFile,
    `${JSON.stringify(
      {
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

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}
