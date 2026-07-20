"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  validateApiReadinessResponse,
  validateExactHttp200,
  validateWebApiReadinessResponse,
  validateWebOverviewResponse,
  desktopReadinessChallengeHeaders,
  desktopSessionCookieHeader,
} = require("../apps/electron/packaged-runtime");
const { selectEvidenceProcessEnvironment } = require("./windows-evidence-chain");

const root = path.resolve(__dirname, "..");
const outputDir = path.resolve(process.env.PACKAGED_SMOKE_OUTPUT_DIR || path.join(root, "release", "windows"));
const unpackedDir = path.join(outputDir, "win-unpacked");
const resourcesDir = path.join(unpackedDir, "resources");
const executable = path.join(unpackedDir, "Smart Kefu.exe");
const apiEntry = path.join(resourcesDir, "services", "api", "main.js");
const webEntry = path.join(resourcesDir, "services", "web", "apps", "web", "server.js");
const readOnlyRoot = path.join(resourcesDir, "services", "runtime-root");
const smokeRoot = path.resolve(process.env.PACKAGED_SMOKE_RUNTIME_DIR || path.join(outputDir, ".packaged-full-stack-smoke"));
const reportFile = path.resolve(process.env.PACKAGED_SMOKE_REPORT_FILE || path.join(outputDir, "verification", "packaged-api-smoke.json"));
const apiPort = Number(process.env.PACKAGED_API_SMOKE_PORT || 32191);
const webPort = Number(process.env.PACKAGED_WEB_SMOKE_PORT || 32190);
const apiHealthUrl = `http://127.0.0.1:${apiPort}/api/health`;
const overviewUrl = `http://127.0.0.1:${webPort}/overview`;
const proxyHealthUrl = `http://127.0.0.1:${webPort}/api/health`;

if (require.main === module) {
  main().catch((error) => {
    writeReport({ status: "FAIL", apiHealthUrl, overviewUrl, proxyHealthUrl, error: String(error?.message || error) });
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

async function main() {
  const requiredFiles = [
    executable,
    apiEntry,
    webEntry,
    path.join(readOnlyRoot, "packages", "rules", "index.js"),
    path.join(readOnlyRoot, "config", "settings.yaml"),
    path.join(readOnlyRoot, "node_modules", ".prisma", "client", "default.js"),
    path.join(readOnlyRoot, "node_modules", "sharp", "lib", "index.js"),
    path.join(readOnlyRoot, "node_modules", "@img", "sharp-win32-x64", "lib", "sharp-win32-x64.node"),
    path.join(resourcesDir, "services", "api", "shared", "image-fingerprint.js"),
  ];
  for (const required of requiredFiles) {
    if (!fs.existsSync(required)) throw new Error(`packaged full-stack smoke input missing: ${required}`);
  }

  fs.rmSync(smokeRoot, { recursive: true, force: true });
  fs.mkdirSync(smokeRoot, { recursive: true });
  const token = crypto.randomBytes(32).toString("hex");
  const desktopWebSessionProof = crypto.randomBytes(32).toString("hex");
  const commonEnv = selectEvidenceProcessEnvironment({
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
  }, smokeRoot);

  const processes = [];
  try {
    const sharpFingerprint = await verifyPackagedSharp({
      ...commonEnv,
      PACKAGED_FINGERPRINT_MODULE: path.join(resourcesDir, "services", "api", "shared", "image-fingerprint.js"),
    });
    const api = spawnService("api", apiEntry, readOnlyRoot, commonEnv);
    processes.push(api);
    const apiHealth = await waitForUrl(
      api,
      apiHealthUrl,
      45_000,
      (response) => validateApiReadinessResponse(response, token, desktopWebSessionProof),
      { headers: desktopReadinessChallengeHeaders(desktopWebSessionProof) },
    );
    if (apiHealth.statusCode !== 200) {
      throw new Error(`packaged API health returned ${apiHealth.statusCode}, expected 200`);
    }

    const web = spawnService("web", webEntry, path.dirname(webEntry), {
      ...commonEnv,
      PORT: String(webPort),
      DESKTOP_WEB_SESSION_PROOF: desktopWebSessionProof,
    });
    processes.push(web);
    const overview = await waitForUrl(web, overviewUrl, 45_000, validateWebOverviewResponse);
    if (overview.statusCode !== 200) {
      throw new Error(`packaged overview returned ${overview.statusCode}, expected 200`);
    }
    const proxyHealth = await requestUrl(proxyHealthUrl);
    const proxyHealthBody = parseJsonBuffer(proxyHealth.body);
    if (proxyHealth.statusCode !== 403 || proxyHealthBody?.code !== "desktop_session_proof_missing") {
      throw new Error(`packaged Web API proxy did not fail closed without Electron proof (${proxyHealth.statusCode})`);
    }
    const authenticatedProxyHealth = await requestUrl(proxyHealthUrl, {
      headers: { Cookie: desktopSessionCookieHeader(desktopWebSessionProof) },
    });
    if (authenticatedProxyHealth.statusCode !== 200 || !validateWebApiReadinessResponse(
      authenticatedProxyHealth,
      token,
      desktopWebSessionProof,
    )) {
      throw new Error(`packaged Web API proxy did not reach the API with valid Electron proof (${authenticatedProxyHealth.statusCode})`);
    }

    const assetPath = firstStaticAssetPath(overview.body);
    if (!assetPath) throw new Error("packaged overview did not reference a Next static asset");
    const staticAssetUrl = new URL(assetPath, overviewUrl).toString();
    const staticAsset = await requestUrl(staticAssetUrl);
    if (staticAsset.statusCode !== 200 || !staticAsset.body.length) {
      throw new Error(`packaged static asset returned ${staticAsset.statusCode} (${staticAsset.body.length} bytes)`);
    }

    writeReport({
      status: "PASS",
      apiHealth: { statusCode: apiHealth.statusCode, mode: "launch_bound_api_hmac" },
      overview: { statusCode: overview.statusCode },
      proxyHealth: { statusCode: proxyHealth.statusCode, mode: "external_no_cookie_fail_closed" },
      authenticatedProxyHealth: { statusCode: authenticatedProxyHealth.statusCode, mode: "launch_bound_web_api_hmac" },
      staticAsset: { statusCode: staticAsset.statusCode, bytes: staticAsset.body.length },
      ports: { api: apiPort, web: webPort },
      cwd: "resources/services/runtime-root",
      writableRoot: "temporary user-data-equivalent directory",
      sharedToken: "generated 64-hex token (not persisted)",
      sharpFingerprint,
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

function parseJsonBuffer(value) {
  try {
    return JSON.parse(Buffer.from(value || "").toString("utf8"));
  } catch {
    return null;
  }
}

async function verifyPackagedSharp(env) {
  const script = path.join(smokeRoot, "verify-sharp.js");
  fs.writeFileSync(script, [
    '"use strict";',
    'const sharp = require("sharp");',
    'const { fingerprintImageBytes } = require(process.env.PACKAGED_FINGERPRINT_MODULE);',
    'const pixels = Buffer.from([0,16,32,48,64,80,96,112,128].flatMap((row) => Array(8).fill(row)));',
    'sharp(pixels, { raw: { width: 9, height: 8, channels: 1 } }).png().toBuffer()',
    '  .then((png) => fingerprintImageBytes(png))',
    '  .then((result) => process.stdout.write(result.fingerprint))',
    '  .catch((error) => { console.error(error.message); process.exitCode = 1; });',
  ].join("\n"), "utf8");
  const result = await spawnCapture(executable, [script], { ...env, ELECTRON_RUN_AS_NODE: "1" }, smokeRoot);
  const fingerprint = String(result.stdout || "").trim();
  if (result.code !== 0 || fingerprint !== "dhash64:v1:0000000000000000") {
    throw new Error(`packaged Sharp fixture fingerprint failed: code=${result.code} output=${redact(fingerprint)} error=${redact(result.stderr)}`);
  }
  return fingerprint;
}

function spawnCapture(command, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
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

function waitForUrl(child, url, timeoutMs, validateResponse = validateExactHttp200, requestOptions = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (child.exitCode !== null) return reject(new Error(`${child.serviceName} exited with ${child.exitCode}`));
      try {
        const response = await requestUrl(url, requestOptions);
        if (response.statusCode === 200 && validateResponse(response)) return resolve(response);
      } catch {}
      if (Date.now() >= deadline) return reject(new Error(`timed out waiting for ${url}`));
      setTimeout(attempt, Math.min(250, Math.max(1, deadline - Date.now())));
    };
    attempt();
  });
}

function requestUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 1500, ...options }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
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

module.exports = {
  main,
  requestUrl,
  waitForUrl,
};
