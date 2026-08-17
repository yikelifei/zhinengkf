"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MANAGED_ENV_NAMES = Object.freeze([
  "DESKTOP_ENV_FILE",
  "DESIGN_PLATFORM_RUNTIME_CONFIG",
  "DESIGN_PLATFORM_ADAPTER",
  "DESIGN_PLATFORM_BASE_URL",
  "DESIGN_PLATFORM_ALLOWED_ORIGINS",
  "DESIGN_PLATFORM_API_KEY",
  "DESIGN_PLATFORM_ACCESS_TOKEN",
  "DESIGN_PLATFORM_COOKIE",
  "DESIGN_PLATFORM_DEVICE_ID",
]);

function installIsolatedAppConfigEnv(prefix = "smart-kefu-app-config-") {
  const previous = new Map(MANAGED_ENV_NAMES.map((name) => [name, process.env[name]]));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const envPath = path.join(root, ".env");
  const runtimeConfigPath = path.join(root, "design-platform-config.json");
  fs.writeFileSync(envPath, "");
  for (const name of MANAGED_ENV_NAMES) delete process.env[name];
  process.env.DESKTOP_ENV_FILE = envPath;
  process.env.DESIGN_PLATFORM_RUNTIME_CONFIG = runtimeConfigPath;
  process.env.DESIGN_PLATFORM_ADAPTER = "standard_v1";
  process.env.DESIGN_PLATFORM_BASE_URL = "http://127.0.0.1:3700";
  return {
    envPath,
    runtimeConfigPath,
    cleanup() {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

module.exports = { installIsolatedAppConfigEnv };
