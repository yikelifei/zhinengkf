"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const API_URL = "http://127.0.0.1:3200/api/health";
const WEB_URL = "http://127.0.0.1:3100/overview";

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

function buildServiceEnvironment({ resourcesPath, appPath, userDataPath, baseEnv = process.env, token }) {
  const paths = resolvePackagedPaths({ resourcesPath, appPath, userDataPath });
  const nodePath = [paths.serviceNodeModulesPath, paths.nodeModulesPath, paths.unpackedNodeModulesPath, baseEnv.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  return {
    ...baseEnv,
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
  };
}

function waitForHttp(url, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (child.exitCode !== null || child.killed) {
        reject(new Error(`${child.serviceName || "service"} exited before ${url} became ready`));
        return;
      }
      const request = http.get(url, { timeout: 1500 }, (response) => {
        response.resume();
        if ((response.statusCode || 500) < 500) {
          resolve();
          return;
        }
        retry();
      });
      request.on("timeout", () => request.destroy());
      request.on("error", retry);
    };
    const retry = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

class PackagedServiceManager {
  constructor(options) {
    this.options = options;
    this.children = [];
    this.paths = resolvePackagedPaths(options);
    this.token = crypto.randomBytes(32).toString("hex");
  }

  async start() {
    for (const required of [this.paths.apiEntry, this.paths.webEntry]) {
      if (!fs.existsSync(required)) throw new Error(`Packaged service entry is missing: ${required}`);
    }
    for (const directory of [this.paths.runtimeDir, this.paths.storageDir, this.paths.configDir, this.paths.logDir]) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const commonEnv = buildServiceEnvironment({
      appPath: this.options.appPath,
      resourcesPath: this.options.resourcesPath,
      userDataPath: this.options.userDataPath,
      baseEnv: process.env,
      token: this.token,
    });
    try {
      const api = this.spawnService("api", this.paths.apiEntry, commonEnv, this.paths.readOnlyRoot);
      await waitForHttp(API_URL, api);
      const web = this.spawnService("web", this.paths.webEntry, { ...commonEnv, PORT: "3100" }, this.paths.runtimeDir);
      await waitForHttp(WEB_URL, web);
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
  WEB_URL,
  PackagedServiceManager,
  buildServiceEnvironment,
  resolvePackagedPaths,
  waitForHttp,
};
