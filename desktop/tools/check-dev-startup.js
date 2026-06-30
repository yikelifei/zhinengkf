"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(desktopRoot, ".runtime");
const logsDir = path.join(runtimeDir, "logs");
const pidFile = path.join(runtimeDir, "dev-ports.json");
const args = new Set(process.argv.slice(2));
const forceMockDesignMode = args.has("--mock-design");
const requestedRealDesignMode = args.has("--real-design");
const realDesignMode = requestedRealDesignMode && !forceMockDesignMode;
const mockDesignMode = !realDesignMode;

const webPort = numberEnv("WEB_PORT", 3100);
const apiPort = numberEnv("API_PORT", 3200);
const mockPort = numberEnv("MOCK_DESIGN_PLATFORM_PORT", 3700);

const baseServices = [
  {
    name: "web",
    label: "Customer workbench",
    port: webPort,
    url: `http://127.0.0.1:${webPort}/`,
    requiredStatus: "2xx/3xx",
  },
  {
    name: "api",
    label: "NestJS API",
    port: apiPort,
    url: `http://127.0.0.1:${apiPort}/api/health`,
    requiredStatus: "2xx",
  },
];

const mockDesignService = {
  name: "design-platform-mock",
  label: "Mock design platform",
  port: mockPort,
  url: `http://127.0.0.1:${mockPort}/v1/health`,
  requiredStatus: "2xx",
};

const integrationHealthUrl = `http://127.0.0.1:${apiPort}/api/integrations/design-platform/health`;

const fallbackServices = [
  ...baseServices,
  {
    ...mockDesignService,
  },
];

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  let hasError = false;
  const integrationHealth = await getIntegrationHealth();
  const services = realDesignMode ? baseServices : fallbackServices;

  printHeader("Environment");
  hasError = !printCommand("node", ["--version"]) || hasError;
  hasError = !printCommand(npmCommand(), ["--version"]) || hasError;
  printPath("desktop root", desktopRoot);
  printPath("pid file", pidFile);
  printPath("logs", logsDir);
  printPath("api build", path.join(desktopRoot, "dist", "apps", "api", "main.js"));

  printHeader("Launcher Records");
  printLauncherRecords();

  printHeader("Ports");
  for (const service of services) {
    printPortOwners(service);
  }
  printIntegrationPortOwners(integrationHealth);

  printHeader("HTTP Health");
  for (const service of services) {
    const result = await requestUrlWithRetry(service.url, 20, 1000);
    if (isExpectedStatus(result.statusCode, service.requiredStatus)) {
      console.log(`[ok] ${service.label}: HTTP ${result.statusCode} ${service.url}`);
      printHealthBody(service, result.body);
      continue;
    }

    hasError = true;
    const status = result.statusCode ? `HTTP ${result.statusCode}` : result.error || "not reachable";
    console.log(`[fail] ${service.label}: ${status} ${service.url}`);
    printLogTail(service.name);
  }
  if (integrationHealth) {
    const ok = integrationHealth.ok === true;
    if (!ok) hasError = true;
    const latencyText = Number.isFinite(Number(integrationHealth.latencyMs)) ? ` latency=${integrationHealth.latencyMs}ms` : "";
    console.log(
      `${ok ? "[ok]" : "[fail]"} Design integration: adapter=${integrationHealth.adapter || "unknown"} base=${
        integrationHealth.baseUrl || "unknown"
      }${latencyText}`,
    );
    const expectedAdapter = realDesignMode ? "art_image_local" : "standard_v1";
    const expectedBaseUrl = expectedDesignPlatformBaseUrl();
    let hasDesignConfigMismatch = false;
    if (integrationHealth.adapter && integrationHealth.adapter !== expectedAdapter) {
      hasError = true;
      hasDesignConfigMismatch = true;
      console.log(`[fail] Design integration adapter mismatch: expected=${expectedAdapter} actual=${integrationHealth.adapter}`);
    }
    if (
      integrationHealth.baseUrl &&
      normalizeBaseUrl(integrationHealth.baseUrl) !== normalizeBaseUrl(expectedBaseUrl)
    ) {
      hasError = true;
      hasDesignConfigMismatch = true;
      console.log(`[fail] Design integration base URL mismatch: expected=${expectedBaseUrl} actual=${integrationHealth.baseUrl}`);
    }
    if (hasDesignConfigMismatch) {
      printDesignModeFix(realDesignMode);
    }
  } else {
    console.log(`[warn] Design integration health is not available yet: ${integrationHealthUrl}`);
  }

  if (hasError) {
    console.log("");
    console.log("[result] Startup check failed. Run stop_desktop.bat, approve the Administrator prompt, then run_desktop.bat.");
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("[result] Startup check passed. The desktop app is reachable.");
}

function printHeader(title) {
  console.log("");
  console.log(`== ${title} ==`);
}

function printCommand(command, args) {
  const result = runCommand(command, args);
  if (result.status !== 0) {
    console.log(`[fail] ${command} ${args.join(" ")}: ${String(result.stderr || result.stdout || "not found").trim()}`);
    return false;
  }
  console.log(`[ok] ${command}: ${String(result.stdout || "").trim()}`);
  return true;
}

function runCommand(command, args) {
  if (process.platform === "win32" && /\.cmd$/i.test(command)) {
    const cmdLine = [command, ...args].join(" ");
    return spawnSync("cmd.exe", ["/d", "/c", cmdLine], { encoding: "utf8" });
  }
  return spawnSync(command, args, { encoding: "utf8" });
}

function printPath(label, value) {
  const exists = fs.existsSync(value);
  console.log(`${exists ? "[ok]" : "[warn]"} ${label}: ${value}`);
}

function printLauncherRecords() {
  const records = readJson(pidFile);
  const entries = Object.values(records).filter(Boolean);
  if (!entries.length) {
    console.log("[warn] no launcher records found");
    return;
  }
  for (const record of entries) {
    console.log(
      `[record] ${record.label || record.name} pid=${record.pid || "-"} port=${record.port || "-"} status=${
        record.status || "-"
      }`,
    );
  }
}

function printPortOwners(service) {
  const owners = getPortOwners(service.port);
  if (!owners.length) {
    console.log(`[down] ${service.label} port=${service.port} has no listener`);
    return;
  }
  for (const owner of owners) {
    console.log(`[port] ${service.label} port=${service.port} pid=${owner.pid} name=${owner.name || "unknown"}`);
    if (owner.commandLine) console.log(`       ${trimMiddle(owner.commandLine, 180)}`);
  }
}

function printIntegrationPortOwners(integrationHealth) {
  const port = parseUrlPort(integrationHealth?.baseUrl);
  if (!port || port === mockPort) return;
  const owners = getPortOwners(port);
  if (!owners.length) {
    console.log(`[warn] Design integration port=${port} has no listener`);
    return;
  }
  for (const owner of owners) {
    console.log(`[port] Design integration port=${port} pid=${owner.pid} name=${owner.name || "unknown"}`);
    if (owner.commandLine) console.log(`       ${trimMiddle(owner.commandLine, 180)}`);
  }
}

function printHealthBody(service, body) {
  if (!body) return;
  const parsed = tryParseJson(body);
  if (!parsed) {
    const text = compactText(body);
    if (text) console.log(`       body: ${trimMiddle(text, 180)}`);
    return;
  }
  if (service.name === "api") {
    const mode = parsed.dataMode || "-";
    const counts = parsed.localStore?.counts ? JSON.stringify(parsed.localStore.counts) : "{}";
    console.log(`       dataMode=${mode} counts=${trimMiddle(counts, 180)}`);
    return;
  }
  console.log(`       body: ${trimMiddle(JSON.stringify(parsed), 180)}`);
}

function printLogTail(serviceName) {
  const candidates = [
    path.join(logsDir, `${serviceName}.err.log`),
    path.join(logsDir, `${serviceName}.out.log`),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-10);
    if (!lines.length) continue;
    console.log(`       recent log: ${file}`);
    for (const line of lines) {
      console.log(`       ${trimMiddle(line, 180)}`);
    }
    return;
  }
  console.log(`       no logs found under ${logsDir}`);
}

function requestUrl(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 3000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("timeout", () => {
      request.destroy();
      resolve({ error: "timeout" });
    });
    request.on("error", (error) => resolve({ error: error.message }));
  });
}

async function getIntegrationHealth() {
  const result = await requestUrlWithRetry(integrationHealthUrl, 5, 700);
  if (!isExpectedStatus(result.statusCode, "2xx") || !result.body) return null;
  return tryParseJson(result.body);
}

async function requestUrlWithRetry(url, attempts, delayMs) {
  let lastResult = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await requestUrl(url);
    lastResult = result;
    if (result.statusCode || attempt === attempts) return result;
    await sleep(delayMs);
  }
  return lastResult || { error: "not reachable" };
}

function isExpectedStatus(statusCode, rule) {
  if (!statusCode) return false;
  if (rule === "2xx") return statusCode >= 200 && statusCode < 300;
  if (rule === "2xx/3xx") return statusCode >= 200 && statusCode < 400;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPortOwners(port) {
  const result = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return [];
  const suffix = `:${port}`;
  const owners = [];
  const seen = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    if (String(parts[0]).toUpperCase() !== "TCP") continue;
    const localAddress = parts[1] || "";
    const state = parts[3] || "";
    const pid = parts[4] || "";
    if (!localAddress.endsWith(suffix)) continue;
    if (!/LISTENING/i.test(state)) continue;
    if (!/^\d+$/.test(pid) || seen.has(pid)) continue;
    seen.add(pid);
    owners.push({
      pid,
      name: getProcessName(pid),
      commandLine: getCommandLine(pid),
    });
  }
  return owners;
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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function trimMiddle(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  const keep = Math.max(20, Math.floor((maxLength - 5) / 2));
  return `${text.slice(0, keep)} ... ${text.slice(-keep)}`;
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function parseUrlPort(value) {
  try {
    const url = new URL(String(value || ""));
    return Number(url.port || (url.protocol === "https:" ? 443 : 80));
  } catch {
    return 0;
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function expectedDesignPlatformBaseUrl() {
  if (realDesignMode && process.env.DESIGN_PLATFORM_BASE_URL && normalizeBaseUrl(process.env.DESIGN_PLATFORM_BASE_URL) !== `http://127.0.0.1:${mockPort}`) {
    return process.env.DESIGN_PLATFORM_BASE_URL;
  }
  return realDesignMode ? "http://127.0.0.1:3000" : `http://127.0.0.1:${mockPort}`;
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function printDesignModeFix(isRealDesignMode) {
  if (isRealDesignMode) {
    console.log("[fix] Real design mode expects the API to use art_image_local and http://127.0.0.1:3000.");
    console.log("[fix] Run stop_desktop.bat first, then run_desktop.bat after the real design platform is online.");
    return;
  }
  console.log("[fix] Default stable mode expects the local mock design platform on http://127.0.0.1:3700.");
  console.log("[fix] Run repair_desktop.bat, approve the Administrator prompt, then run check_desktop.bat again.");
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
