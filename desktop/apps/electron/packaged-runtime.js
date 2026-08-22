"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { selectServiceEnvironment } = require("../../packages/runtime/service-environment");
const {
  API_READINESS_PROOF_FIELD,
  READINESS_CHALLENGE_HEADER,
  WEB_READINESS_PROOF_FIELD,
  verifyApiReadinessProof,
  verifyWebReadinessProof,
} = require("../../packages/runtime/packaged-readiness-proof");

const DEFAULT_API_PORT = 3200;
const DEFAULT_WEB_PORT = 3100;
const API_URL = `http://127.0.0.1:${DEFAULT_API_PORT}/api/health`;
const WEB_URL = `http://127.0.0.1:${DEFAULT_WEB_PORT}/overview`;
const PROXY_HEALTH_URL = `http://127.0.0.1:${DEFAULT_WEB_PORT}/api/health`;
const DESKTOP_SESSION_COOKIE = "smart_kefu_desktop_session";
const DESKTOP_SESSION_PROOF_PATTERN = /^[a-f0-9]{64}$/i;
const CLOUD_CLIENT_ENV_KEYS = new Set(["SMART_KEFU_CLOUD_API_BASE_URL", "SMART_KEFU_CLOUD_API_TOKEN"]);

function resolvePackagedPaths({ resourcesPath, appPath, userDataPath }) {
  return {
    apiEntry: path.join(resourcesPath, "services", "api", "main.js"),
    webEntry: path.join(resourcesPath, "services", "web", "apps", "web", "server.js"),
    runtimeDir: path.join(userDataPath, "runtime"),
    storageDir: path.join(userDataPath, "storage"),
    configDir: path.join(userDataPath, "config"),
    logDir: path.join(userDataPath, "logs"),
    cloudClientEnvPath: path.join(resourcesPath, "cloud", "cloud-client.env"),
    userCloudClientEnvPath: path.join(userDataPath, "config", "cloud-client.env"),
    companyProfilePath: path.join(resourcesPath, "company", "company-profile.json"),
    readOnlyRoot: path.join(resourcesPath, "services", "runtime-root"),
    serviceNodeModulesPath: path.join(resourcesPath, "services", "runtime-root", "node_modules"),
    zhenxiMcpServerPath: path.join(
      resourcesPath,
      "services",
      "runtime-root",
      "packages",
      "mcp",
      "zhenxi-ai-server.mjs",
    ),
    nodeModulesPath: path.join(appPath, "node_modules"),
    unpackedNodeModulesPath: path.join(`${appPath}.unpacked`, "node_modules"),
  };
}

function buildApiServiceEnvironment({
  resourcesPath,
  appPath,
  userDataPath,
  baseEnv = process.env,
  token,
  apiPort = DEFAULT_API_PORT,
  webPort = DEFAULT_WEB_PORT,
}) {
  const paths = resolvePackagedPaths({ resourcesPath, appPath, userDataPath });
  const nodePath = [paths.serviceNodeModulesPath, paths.nodeModulesPath, paths.unpackedNodeModulesPath, baseEnv.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  return selectServiceEnvironment("api", baseEnv, {
    NODE_ENV: "production",
    SMART_KEFU_RUNTIME_TARGET: "desktop",
    ELECTRON_RUN_AS_NODE: "1",
    HOSTNAME: "127.0.0.1",
    API_PORT: String(normalizePort(apiPort, DEFAULT_API_PORT)),
    WEB_PORT: String(normalizePort(webPort, DEFAULT_WEB_PORT)),
    INTERNAL_API_TOKEN: token,
    DESKTOP_RUNTIME_DIR: paths.runtimeDir,
    LOCAL_STORAGE_ROOT: paths.storageDir,
    DESKTOP_ENV_FILE: path.join(paths.configDir, "runtime.env"),
    SMART_KEFU_COMPANY_PROFILE_FILE: paths.companyProfilePath,
    ZHENXI_MCP_SERVER_PATH: paths.zhenxiMcpServerPath,
    NODE_PATH: nodePath,
  });
}

function buildWebServiceEnvironment({
  resourcesPath,
  appPath,
  userDataPath,
  baseEnv = process.env,
  token,
  webSessionProof,
  apiPort = DEFAULT_API_PORT,
  webPort = DEFAULT_WEB_PORT,
}) {
  const paths = resolvePackagedPaths({ resourcesPath, appPath, userDataPath });
  const nodePath = [paths.serviceNodeModulesPath, paths.nodeModulesPath, paths.unpackedNodeModulesPath, baseEnv.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  const cloudClientEnv = readPackagedCloudClientEnv(paths);
  return selectServiceEnvironment("web", { ...baseEnv, ...cloudClientEnv }, {
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: "1",
    HOSTNAME: "127.0.0.1",
    PORT: String(normalizePort(webPort, DEFAULT_WEB_PORT)),
    API_PORT: String(normalizePort(apiPort, DEFAULT_API_PORT)),
    WEB_PORT: String(normalizePort(webPort, DEFAULT_WEB_PORT)),
    ALLOW_LOCAL_BROWSER_WEB_API: "0",
    INTERNAL_API_TOKEN: token,
    DESKTOP_WEB_SESSION_PROOF: webSessionProof,
    DESKTOP_RUNTIME_DIR: paths.runtimeDir,
    LOCAL_STORAGE_ROOT: paths.storageDir,
    NODE_PATH: nodePath,
  });
}

const buildServiceEnvironment = buildApiServiceEnvironment;

function normalizePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

const FIRST_ENTERPRISE_SETUP_KEYS = [
  "WECHAT_WORK_CORP_ID",
  "WECHAT_WORK_SECRET",
  "WECHAT_WORK_TOKEN",
  "WECHAT_WORK_ENCODING_AES_KEY",
  "WECHAT_WORK_OPEN_KFID",
];

function desktopEnvRequiresEnterpriseSetup({ envFile, env = process.env } = {}) {
  const stored = readDesktopEnvValues(envFile);
  const value = (key) => String(env?.[key] || stored[key] || "").trim();
  if (FIRST_ENTERPRISE_SETUP_KEYS.some((key) => !value(key))) return true;
  if (value("WECHAT_WORK_ENCODING_AES_KEY").length !== 43) return true;
  return value("WECHAT_SEND_ADAPTER") !== "wechat_work_kf";
}

function readDesktopEnvValues(envFile) {
  const target = String(envFile || "").trim();
  if (!target) return {};
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) return {};
    return Object.fromEntries(fs.readFileSync(target, "utf8").split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match) return [];
      const raw = match[2];
      const unquoted = raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
        ? raw.slice(1, -1)
        : raw;
      return [[match[1], unquoted]];
    }));
  } catch {
    return {};
  }
}

function readPackagedCloudClientEnv(pathsOrFile) {
  const candidateFiles = typeof pathsOrFile === "string"
    ? [pathsOrFile]
    : [pathsOrFile?.cloudClientEnvPath, pathsOrFile?.userCloudClientEnvPath];
  const selected = {};
  for (const filePath of candidateFiles) {
    const values = readDesktopEnvValues(filePath);
    for (const [key, value] of Object.entries(values)) {
      const normalized = String(key).toUpperCase();
      if (!CLOUD_CLIENT_ENV_KEYS.has(normalized)) continue;
      selected[normalized] = value;
    }
  }
  return selected;
}

function createPackagedServiceEndpoints({ apiPort, webPort }) {
  const normalizedApiPort = normalizePort(apiPort, DEFAULT_API_PORT);
  const normalizedWebPort = normalizePort(webPort, DEFAULT_WEB_PORT);
  if (normalizedApiPort === normalizedWebPort) throw new Error("Packaged API and Web ports must be different");
  return {
    apiPort: normalizedApiPort,
    webPort: normalizedWebPort,
    apiHealthUrl: `http://127.0.0.1:${normalizedApiPort}/api/health`,
    webOverviewUrl: `http://127.0.0.1:${normalizedWebPort}/overview`,
    proxyHealthUrl: `http://127.0.0.1:${normalizedWebPort}/api/health`,
  };
}

function reserveLoopbackPort(requestedPort = 0) {
  const port = Number(requestedPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return Promise.reject(new Error(`Invalid packaged service port: ${requestedPort}`));
  }
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    let released = false;
    const fail = (error) => reject(error);
    server.once("error", fail);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.off("error", fail);
      const address = server.address();
      const reservedPort = typeof address === "object" && address ? address.port : 0;
      if (!reservedPort) {
        server.close();
        reject(new Error("Failed to reserve a loopback port for packaged services"));
        return;
      }
      resolve({
        port: reservedPort,
        release: () => new Promise((releaseResolve, releaseReject) => {
          if (released || !server.listening) {
            released = true;
            releaseResolve();
            return;
          }
          released = true;
          server.close((error) => error ? releaseReject(error) : releaseResolve());
        }),
      });
    });
  });
}

async function reservePackagedServicePorts(options = {}) {
  const api = await reserveLoopbackPort(options.apiPort || 0);
  try {
    const web = await reserveLoopbackPort(options.webPort || 0);
    return { api, web };
  } catch (error) {
    await api.release().catch(() => {});
    throw error;
  }
}

function waitForHttp(url, child, timeoutMs = 45_000, validateResponse = validateExactHttp200, requestOptions = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (child.exitCode !== null || child.killed) {
        reject(new Error(`${child.serviceName || "service"} exited before ${url} became ready`));
        return;
      }
      try {
        const response = await requestHttp(url, requestOptions);
        if (response.statusCode === 200 && validateResponse(response)) {
          if (child.exitCode !== null || child.killed) {
            reject(new Error(`${child.serviceName || "service"} exited while ${url} reported ready`));
            return;
          }
          resolve(response);
          return;
        }
      } catch {}
      retry();
    };
    const retry = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(attempt, Math.min(250, Math.max(1, deadline - Date.now())));
    };
    attempt();
  });
}

function requestHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 1500, ...options }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          request.destroy(new Error(`Readiness response exceeded 1 MiB: ${url}`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.on("timeout", () => request.destroy(new Error(`Timed out requesting ${url}`)));
    request.on("error", reject);
  });
}

function desktopSessionCookieHeader(proof) {
  const value = String(proof || "").trim();
  if (!DESKTOP_SESSION_PROOF_PATTERN.test(value)) throw new Error("Packaged desktop session proof is invalid");
  return `${DESKTOP_SESSION_COOKIE}=${value}`;
}

function desktopReadinessChallengeHeaders(proof) {
  const value = String(proof || "").trim();
  if (!DESKTOP_SESSION_PROOF_PATTERN.test(value)) throw new Error("Packaged desktop readiness challenge is invalid");
  return { [READINESS_CHALLENGE_HEADER]: value };
}

function validateExactHttp200(response) {
  return response?.statusCode === 200;
}

function validateApiHealthResponse(response) {
  if (!validateExactHttp200(response)) return false;
  const contentType = String(response.headers?.["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) return false;
  const payload = parseApiHealthPayload(response);
  return payload?.ok === true && payload?.service === "smart-kefu-desktop-api";
}

function validateApiReadinessResponse(response, token, challenge) {
  if (!validateApiHealthResponse(response)) return false;
  const payload = parseApiHealthPayload(response);
  return verifyApiReadinessProof(token, challenge, payload?.[API_READINESS_PROOF_FIELD]);
}

function validateWebApiReadinessResponse(response, token, challenge) {
  if (!validateApiReadinessResponse(response, token, challenge)) return false;
  const payload = parseApiHealthPayload(response);
  return verifyWebReadinessProof(
    token,
    challenge,
    payload?.[API_READINESS_PROOF_FIELD],
    payload?.[WEB_READINESS_PROOF_FIELD],
  );
}

function parseApiHealthPayload(response) {
  try {
    return JSON.parse(Buffer.from(response?.body || "").toString("utf8"));
  } catch {
    return null;
  }
}

function validateWebOverviewResponse(response) {
  if (!validateExactHttp200(response)) return false;
  const contentType = String(response.headers?.["content-type"] || "").toLowerCase();
  const html = Buffer.from(response.body || "").toString("utf8");
  return contentType.includes("text/html") &&
    /<html\b[^>]*\blang=["']zh-CN["']/i.test(html) &&
    /\bid=["']overview-center["']/i.test(html) &&
    /\/_next\/static\//i.test(html);
}

class PackagedServiceManager {
  constructor(options) {
    this.options = options;
    this.children = [];
    this.paths = resolvePackagedPaths(options);
    this.token = crypto.randomBytes(32).toString("hex");
    this.webSessionProof = crypto.randomBytes(32).toString("hex");
    this.endpoints = null;
    this.startedAt = null;
  }

  async start() {
    for (const required of [
      this.paths.apiEntry,
      this.paths.webEntry,
      this.paths.zhenxiMcpServerPath,
      this.paths.companyProfilePath,
    ]) {
      if (!fs.existsSync(required)) throw new Error(`Packaged service entry is missing: ${required}`);
    }
    for (const directory of [this.paths.runtimeDir, this.paths.storageDir, this.paths.configDir, this.paths.logDir]) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const reservations = await reservePackagedServicePorts({
      apiPort: this.options.apiPort,
      webPort: this.options.webPort,
    });
    this.endpoints = createPackagedServiceEndpoints({
      apiPort: reservations.api.port,
      webPort: reservations.web.port,
    });
    this.startedAt = new Date().toISOString();
    this.writeRuntimeStatus("starting");

    const apiEnv = buildApiServiceEnvironment({
      appPath: this.options.appPath,
      resourcesPath: this.options.resourcesPath,
      userDataPath: this.options.userDataPath,
      baseEnv: process.env,
      token: this.token,
      apiPort: this.endpoints.apiPort,
      webPort: this.endpoints.webPort,
    });
    try {
      await reservations.api.release();
      const api = this.spawnService("api", this.paths.apiEntry, apiEnv, this.paths.readOnlyRoot);
      await waitForHttp(
        this.endpoints.apiHealthUrl,
        api,
        45_000,
        (response) => validateApiReadinessResponse(response, this.token, this.webSessionProof),
        { headers: desktopReadinessChallengeHeaders(this.webSessionProof) },
      );
      await reservations.web.release();
      const web = this.spawnService(
        "web",
        this.paths.webEntry,
        buildWebServiceEnvironment({
          appPath: this.options.appPath,
          resourcesPath: this.options.resourcesPath,
          userDataPath: this.options.userDataPath,
          baseEnv: process.env,
          token: this.token,
          webSessionProof: this.webSessionProof,
          apiPort: this.endpoints.apiPort,
          webPort: this.endpoints.webPort,
        }),
        this.paths.runtimeDir,
      );
      await waitForHttp(this.endpoints.webOverviewUrl, web, 45_000, validateWebOverviewResponse);
      await waitForHttp(this.endpoints.proxyHealthUrl, web, 45_000, (response) => (
        validateWebApiReadinessResponse(response, this.token, this.webSessionProof)
      ), {
        headers: { Cookie: desktopSessionCookieHeader(this.webSessionProof) },
      });
      this.writeRuntimeStatus("ready");
      return { ...this.endpoints };
    } catch (error) {
      await Promise.allSettled([reservations.api.release(), reservations.web.release()]);
      this.stop();
      this.writeRuntimeStatus("failed", { error: String(error?.message || error || "unknown error") });
      throw error;
    }
  }

  spawnService(name, entry, env, cwd) {
    const logPath = path.join(this.paths.logDir, `packaged-${name}.log`);
    fs.appendFileSync(
      logPath,
      `[desktop-runtime] ${new Date().toISOString()} starting ${name} apiPort=${env.API_PORT || ""} webPort=${env.WEB_PORT || env.PORT || ""}\n`,
      "utf8",
    );
    const logFd = fs.openSync(logPath, "a");
    let child;
    try {
      child = spawn(this.options.executablePath, [entry], {
        cwd,
        env,
        windowsHide: true,
        stdio: ["ignore", logFd, logFd],
      });
    } finally {
      fs.closeSync(logFd);
    }
    child.serviceName = name;
    child.on("error", (error) => console.error(`[desktop] ${name} service failed to start`, error));
    child.on("exit", (code, signal) => console.error(`[desktop] ${name} service exited code=${code} signal=${signal}`));
    this.children.push(child);
    return child;
  }

  stop() {
    for (const child of this.children.splice(0).reverse()) {
      if (child.exitCode !== null || child.killed) continue;
      try {
        child.kill();
      } catch (error) {
        console.error(`[desktop] failed to stop ${child.serviceName || "service"}`, error);
      }
    }
    if (this.endpoints) this.writeRuntimeStatus("stopped", { stoppedAt: new Date().toISOString() });
  }

  writeRuntimeStatus(status, extra = {}) {
    try {
      const target = path.join(this.paths.runtimeDir, "packaged-runtime-status.json");
      const temporary = `${target}.${process.pid}.tmp`;
      const payload = {
        schemaVersion: "smart_kefu_packaged_runtime_status_v1",
        status,
        desktopPid: process.pid,
        startedAt: this.startedAt,
        ...(this.endpoints || {}),
        servicePids: Object.fromEntries(this.children.map((child) => [child.serviceName, child.pid || null])),
        updatedAt: new Date().toISOString(),
        ...extra,
      };
      fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      fs.renameSync(temporary, target);
    } catch (error) {
      console.error("[desktop] failed to write packaged runtime status", error);
    }
  }
}

module.exports = {
  API_URL,
  DEFAULT_API_PORT,
  DEFAULT_WEB_PORT,
  PROXY_HEALTH_URL,
  WEB_URL,
  PackagedServiceManager,
  buildApiServiceEnvironment,
  buildServiceEnvironment,
  buildWebServiceEnvironment,
  createPackagedServiceEndpoints,
  desktopReadinessChallengeHeaders,
  desktopEnvRequiresEnterpriseSetup,
  desktopSessionCookieHeader,
  requestHttp,
  reserveLoopbackPort,
  reservePackagedServicePorts,
  readPackagedCloudClientEnv,
  resolvePackagedPaths,
  validateApiHealthResponse,
  validateApiReadinessResponse,
  validateExactHttp200,
  validateWebApiReadinessResponse,
  validateWebOverviewResponse,
  waitForHttp,
};
