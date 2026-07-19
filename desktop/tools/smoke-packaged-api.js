"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "release", "windows");
const unpackedDir = path.join(outputDir, "win-unpacked");
const resourcesDir = path.join(unpackedDir, "resources");
const executable = path.join(unpackedDir, "Smart Kefu.exe");
const apiEntry = path.join(resourcesDir, "services", "api", "main.js");
const webEntry = path.join(resourcesDir, "services", "web", "apps", "web", "server.js");
const readOnlyRoot = path.join(resourcesDir, "services", "runtime-root");
const smokeRoot = path.join(outputDir, ".packaged-full-stack-smoke");
const reportFile = path.join(outputDir, "verification", "packaged-api-smoke.json");
const apiPort = Number(process.env.PACKAGED_API_SMOKE_PORT || 32191);
const webPort = Number(process.env.PACKAGED_WEB_SMOKE_PORT || 32190);
const apiHealthUrl = `http://127.0.0.1:${apiPort}/api/health`;
const overviewUrl = `http://127.0.0.1:${webPort}/overview`;
const proxyHealthUrl = `http://127.0.0.1:${webPort}/api/health`;

main().catch((error) => {
  writeReport({ status: "FAIL", apiHealthUrl, overviewUrl, proxyHealthUrl, error: String(error?.message || error) });
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  const requiredFiles = [
    executable,
    apiEntry,
    webEntry,
    path.join(readOnlyRoot, "packages", "rules", "index.js"),
    path.join(readOnlyRoot, "config", "settings.yaml"),
    path.join(readOnlyRoot, "node_modules", ".prisma", "client", "default.js"),
  ];
  for (const required of requiredFiles) {
    if (!fs.existsSync(required)) throw new Error(`packaged full-stack smoke input missing: ${required}`);
  }

  fs.rmSync(smokeRoot, { recursive: true, force: true });
  fs.mkdirSync(smokeRoot, { recursive: true });
  const token = crypto.randomBytes(32).toString("hex");
  const commonEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    API_PORT: String(apiPort),
    WEB_PORT: String(webPort),
    INTERNAL_API_TOKEN: token,
    USE_LOCAL_STORE: "true",
    DESKTOP_RUNTIME_DIR: path.join(smokeRoot, "runtime"),
    LOCAL_STORAGE_ROOT: path.join(smokeRoot, "storage"),
    DESKTOP_ENV_FILE: path.join(smokeRoot, "config", "runtime.env"),
    NODE_PATH: [
      path.join(readOnlyRoot, "node_modules"),
      path.join(resourcesDir, "app.asar", "node_modules"),
      path.join(resourcesDir, "app.asar.unpacked", "node_modules"),
    ].join(path.delimiter),
  };

  const processes = [];
  try {
    const api = spawnService("api", apiEntry, readOnlyRoot, commonEnv);
    processes.push(api);
    const apiHealth = await waitForUrl(api, apiHealthUrl, 45_000);

    const web = spawnService("web", webEntry, path.dirname(webEntry), { ...commonEnv, PORT: String(webPort) });
    processes.push(web);
    const overview = await waitForUrl(web, overviewUrl, 45_000);
    const proxyHealth = await requestUrl(proxyHealthUrl);
    if (proxyHealth.statusCode >= 500) throw new Error(`packaged Web API proxy returned ${proxyHealth.statusCode}`);

    const assetPath = firstStaticAssetPath(overview.body);
    if (!assetPath) throw new Error("packaged overview did not reference a Next static asset");
    const staticAssetUrl = new URL(assetPath, overviewUrl).toString();
    const staticAsset = await requestUrl(staticAssetUrl);
    if (staticAsset.statusCode !== 200 || !staticAsset.body.length) {
      throw new Error(`packaged static asset returned ${staticAsset.statusCode} (${staticAsset.body.length} bytes)`);
    }

    writeReport({
      status: "PASS",
      apiHealth: { statusCode: apiHealth.statusCode },
      overview: { statusCode: overview.statusCode },
      proxyHealth: { statusCode: proxyHealth.statusCode },
      staticAsset: { statusCode: staticAsset.statusCode, bytes: staticAsset.body.length },
      ports: { api: apiPort, web: webPort },
      cwd: "resources/services/runtime-root",
      writableRoot: "temporary user-data-equivalent directory",
      sharedToken: "generated 64-hex token (not persisted)",
    });
    console.log(`[PASS] packaged full-stack smoke: API=${apiPort}, Web=${webPort}, overview/proxy/static ready`);
  } catch (error) {
    const evidence = processes.map((item) => `${item.serviceName}: stdout=${redact(item.stdoutText)} stderr=${redact(item.stderrText)}`).join("; ");
    throw new Error(`${error.message}; ${evidence}`);
  } finally {
    await Promise.all(processes.reverse().map(stopChild));
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }
}

function stopChild(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    try {
      child.kill();
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

function spawnService(name, entry, cwd, env) {
  const child = spawn(executable, [entry], {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.serviceName = name;
  child.stdoutText = "";
  child.stderrText = "";
  child.stdout.on("data", (chunk) => { child.stdoutText = `${child.stdoutText}${chunk}`.slice(-12_000); });
  child.stderr.on("data", (chunk) => { child.stderrText = `${child.stderrText}${chunk}`.slice(-12_000); });
  return child;
}

function waitForUrl(child, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (child.exitCode !== null) return reject(new Error(`${child.serviceName} exited with ${child.exitCode}`));
      try {
        const response = await requestUrl(url);
        if (response.statusCode < 500) return resolve(response);
      } catch {}
      if (Date.now() >= deadline) return reject(new Error(`timed out waiting for ${url}`));
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

function requestUrl(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 1500 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ statusCode: response.statusCode || 0, body: Buffer.concat(chunks) }));
    });
    request.on("timeout", () => request.destroy(new Error(`timeout requesting ${url}`)));
    request.on("error", reject);
  });
}

function firstStaticAssetPath(body) {
  const html = Buffer.isBuffer(body) ? body.toString("utf8") : String(body || "");
  const match = html.match(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/i);
  return match?.[1] || "";
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

function redact(value) {
  return String(value || "").replace(/[a-f0-9]{64}/gi, "[redacted-token]").replace(/\s+/g, " ").slice(-4000);
}
