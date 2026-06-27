"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(desktopRoot, ".runtime");
const logsDir = path.join(runtimeDir, "logs");
const configFile = path.join(runtimeDir, "design-platform-config.json");
const webPort = numberEnv("WEB_PORT", 3100);
const apiPort = numberEnv("API_PORT", 3200);
const mockPort = numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700);
const timeoutMs = numberEnv("SMOKE_TIMEOUT_MS", 30000);

const services = [
  {
    name: "web",
    label: "Customer workbench",
    url: `http://127.0.0.1:${webPort}/`,
    command: process.execPath,
    args: ["node_modules/next/dist/bin/next", "dev", "apps/web", "-p", String(webPort)],
  },
  {
    name: "design-platform-mock",
    label: "Mock design platform",
    url: `http://127.0.0.1:${mockPort}/v1/health`,
    command: process.execPath,
    args: ["tools/mock-design-platform.js"],
  },
  {
    name: "api",
    label: "NestJS API",
    url: `http://127.0.0.1:${apiPort}/api/health`,
    command: process.execPath,
    args: ["dist/apps/api/main.js"],
  },
];

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(logsDir, { recursive: true });
  writeRuntimeConfig();

  const children = [];
  try {
    for (const service of services) {
      children.push(startService(service));
    }

    let failed = false;
    for (const service of services) {
      const ok = await waitForHealth(service.url, timeoutMs);
      if (ok) {
        console.log(`[ok] ${service.label}: ${service.url}`);
      } else {
        failed = true;
        console.log(`[fail] ${service.label}: ${service.url}`);
        printTail(path.join(logsDir, `smoke-${service.name}.err.log`));
        printTail(path.join(logsDir, `smoke-${service.name}.out.log`));
      }
    }

    if (failed) {
      process.exitCode = 1;
      return;
    }
    console.log("[result] Smoke startup passed.");
  } finally {
    for (const child of children.reverse()) {
      stopProcessTree(child.pid);
    }
  }
}

function startService(service) {
  const stdoutPath = path.join(logsDir, `smoke-${service.name}.out.log`);
  const stderrPath = path.join(logsDir, `smoke-${service.name}.err.log`);
  fs.rmSync(stdoutPath, { force: true });
  fs.rmSync(stderrPath, { force: true });
  const stdout = fs.openSync(stdoutPath, "a");
  const stderr = fs.openSync(stderrPath, "a");
  const child = spawn(service.command, service.args, {
    cwd: desktopRoot,
    env: defaultEnv(),
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  child.unref();
  console.log(`[start] ${service.label} pid=${child.pid}`);
  return child;
}

async function waitForHealth(url, timeout) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await isHealthy(url)) return true;
    await sleep(500);
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

function stopProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 5000 });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already exited.
  }
}

function defaultEnv() {
  return {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    USE_LOCAL_STORE: process.env.USE_LOCAL_STORE || "true",
    WEB_PORT: String(webPort),
    API_PORT: String(apiPort),
    MOCK_DESIGN_PLATFORM_PORT: String(mockPort),
    START_MOCK_DESIGN_PLATFORM: "true",
    DESIGN_PLATFORM_ADAPTER: "standard_v1",
    DESIGN_PLATFORM_BASE_URL: `http://127.0.0.1:${mockPort}`,
    DESIGN_PLATFORM_RUNTIME_CONFIG: configFile,
  };
}

function writeRuntimeConfig() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    configFile,
    `${JSON.stringify(
      {
        designPlatformAdapter: "standard_v1",
        designPlatformBaseUrl: `http://127.0.0.1:${mockPort}`,
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

function printTail(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-12);
  if (!lines.length) return;
  console.log(`       log: ${file}`);
  for (const line of lines) console.log(`       ${line}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
