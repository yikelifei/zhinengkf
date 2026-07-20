"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
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

const API_URL = "http://127.0.0.1:3200/api/health";
const WEB_URL = "http://127.0.0.1:3100/overview";
const PROXY_HEALTH_URL = "http://127.0.0.1:3100/api/health";
const DESKTOP_SESSION_COOKIE = "smart_kefu_desktop_session";
const DESKTOP_SESSION_PROOF_PATTERN = /^[a-f0-9]{64}$/i;

function resolvePackagedPaths({ resourcesPath, appPath, userDataPath }) {
  return {
    apiEntry: path.join(resourcesPath, "services", "api", "main.js"),
    webEntry: path.join(resourcesPath, "services", "web", "apps", "web", "server.js"),
    runtimeDir: path.join(userDataPath, "runtime"),
    storageDir: path.join(userDataPath, "storage"),
    configDir: path.join(userDataPath, "config"),
    logDir: path.join(userDataPath, "logs"),
    readOnlyRoot: path.join(resourcesPath, "services", "runtime-root"),
    serviceNodeModulesPath: path.join(resourcesPath, "services", "runtime-root", "node_modules"),
    nodeModulesPath: path.join(appPath, "node_modules"),
    unpackedNodeModulesPath: path.join(`${appPath}.unpacked`, "node_modules"),
  };
}

function buildApiServiceEnvironment({ resourcesPath, appPath, userDataPath, baseEnv = process.env, token }) {
  const paths = resolvePackagedPaths({ resourcesPath, appPath, userDataPath });
  const nodePath = [paths.serviceNodeModulesPath, paths.nodeModulesPath, paths.unpackedNodeModulesPath, baseEnv.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  return selectServiceEnvironment("api", baseEnv, {
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: "1",
    HOSTNAME: "127.0.0.1",
    API_PORT: "3200",
    WEB_PORT: "3100",
    INTERNAL_API_TOKEN: token,
    DESKTOP_RUNTIME_DIR: paths.runtimeDir,
    LOCAL_STORAGE_ROOT: paths.storageDir,
    DESKTOP_ENV_FILE: path.join(paths.configDir, "runtime.env"),
    NODE_PATH: nodePath,
  });
}

function buildWebServiceEnvironment({ resourcesPath, appPath, userDataPath, baseEnv = process.env, token, webSessionProof }) {
  const paths = resolvePackagedPaths({ resourcesPath, appPath, userDataPath });
  const nodePath = [paths.serviceNodeModulesPath, paths.nodeModulesPath, paths.unpackedNodeModulesPath, baseEnv.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  return selectServiceEnvironment("web", baseEnv, {
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: "1",
    HOSTNAME: "127.0.0.1",
    PORT: "3100",
    API_PORT: "3200",
    WEB_PORT: "3100",
    INTERNAL_API_TOKEN: token,
    DESKTOP_WEB_SESSION_PROOF: webSessionProof,
    DESKTOP_RUNTIME_DIR: paths.runtimeDir,
    LOCAL_STORAGE_ROOT: paths.storageDir,
    NODE_PATH: nodePath,
  });
}

const buildServiceEnvironment = buildApiServiceEnvironment;

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
  }

  async start() {
    for (const required of [this.paths.apiEntry, this.paths.webEntry]) {
      if (!fs.existsSync(required)) throw new Error(`Packaged service entry is missing: ${required}`);
    }
    for (const directory of [this.paths.runtimeDir, this.paths.storageDir, this.paths.configDir, this.paths.logDir]) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const apiEnv = buildApiServiceEnvironment({
      appPath: this.options.appPath,
      resourcesPath: this.options.resourcesPath,
      userDataPath: this.options.userDataPath,
      baseEnv: process.env,
      token: this.token,
    });
    try {
      const api = this.spawnService("api", this.paths.apiEntry, apiEnv, this.paths.readOnlyRoot);
      await waitForHttp(
        API_URL,
        api,
        45_000,
        (response) => validateApiReadinessResponse(response, this.token, this.webSessionProof),
        { headers: desktopReadinessChallengeHeaders(this.webSessionProof) },
      );
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
        }),
        this.paths.runtimeDir,
      );
      await waitForHttp(WEB_URL, web, 45_000, validateWebOverviewResponse);
      await waitForHttp(PROXY_HEALTH_URL, web, 45_000, (response) => (
        validateWebApiReadinessResponse(response, this.token, this.webSessionProof)
      ), {
        headers: { Cookie: desktopSessionCookieHeader(this.webSessionProof) },
      });
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  spawnService(name, entry, env, cwd) {
    const logPath = path.join(this.paths.logDir, `packaged-${name}.log`);
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
  }
}

module.exports = {
  API_URL,
  PROXY_HEALTH_URL,
  WEB_URL,
  PackagedServiceManager,
  buildApiServiceEnvironment,
  buildServiceEnvironment,
  buildWebServiceEnvironment,
  desktopReadinessChallengeHeaders,
  desktopSessionCookieHeader,
  requestHttp,
  resolvePackagedPaths,
  validateApiHealthResponse,
  validateApiReadinessResponse,
  validateExactHttp200,
  validateWebApiReadinessResponse,
  validateWebOverviewResponse,
  waitForHttp,
};
