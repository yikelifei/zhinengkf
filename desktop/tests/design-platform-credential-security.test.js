"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const { appConfig } = require("../apps/api/src/shared/app-config");
const {
  DesignPlatformClient,
  designPlatformCredentialsForTarget,
} = require("../apps/api/src/integrations/design-platform/design-platform.client");

test("Axios interceptor sends each credential only to its bound origin", async () => {
  const previous = snapshotConfig();
  const seen = [];
  try {
    Object.assign(appConfig, {
      designPlatformAdapter: "standard_v1",
      designPlatformBaseUrl: "https://design.example",
      designPlatformAccessToken: "access-secret",
      designPlatformAccessTokenOrigin: "https://design.example",
      designPlatformApiKey: "api-secret",
      designPlatformApiKeyOrigin: "https://design.example",
      designPlatformCookie: "session=cookie-secret",
      designPlatformCookieOrigin: "https://design.example",
      designPlatformDeviceId: "device-secret",
      designPlatformDeviceIdOrigin: "https://design.example",
    });
    const client = new DesignPlatformClient();
    client.http.defaults.adapter = captureAdapter(seen, { ok: true });

    await client.health();
    await client.http.get("https://untrusted.example/probe", {
      headers: {
        Authorization: "Bearer spoofed",
        Cookie: "spoofed=1",
        "x-art-device-id": "explicit-device",
      },
    });

    assert.equal(header(seen[0], "authorization"), "Bearer access-secret");
    assert.equal(header(seen[0], "cookie"), "session=cookie-secret");
    assert.equal(header(seen[0], "x-art-device-id"), "device-secret");
    assert.equal(header(seen[1], "authorization"), undefined);
    assert.equal(header(seen[1], "cookie"), undefined);
    assert.equal(header(seen[1], "x-art-device-id"), undefined);

    appConfig.designPlatformAccessToken = "";
    const apiKeyOnly = designPlatformCredentialsForTarget("https://design.example", "/v1/health");
    assert.equal(apiKeyOnly.authorization, "Bearer api-secret");
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("first login preserves its explicit same-origin device id while a cross-origin absolute request loses it", async () => {
  const previous = snapshotConfig();
  const seen = [];
  try {
    Object.assign(appConfig, {
      designPlatformAdapter: "art_image_local",
      designPlatformBaseUrl: "http://127.0.0.1:3000",
      designPlatformAccessToken: "",
      designPlatformAccessTokenOrigin: "",
      designPlatformApiKey: "",
      designPlatformApiKeyOrigin: "",
      designPlatformCookie: "",
      designPlatformCookieOrigin: "",
      designPlatformDeviceId: "",
      designPlatformDeviceIdOrigin: "",
    });
    const client = new DesignPlatformClient();
    client.http.defaults.adapter = captureAdapter(seen, {
      ok: true,
      data: { accessToken: "login-token", user: { id: "user-1" } },
    });

    await client.loginArtImageLocal({ email: "test@example.com", password: "secret", deviceId: "first-device" });
    await client.http.get("https://untrusted.example/probe", { headers: { "x-art-device-id": "first-device" } });

    assert.equal(header(seen[0], "x-art-device-id"), "first-device");
    assert.equal(header(seen[1], "x-art-device-id"), undefined);
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("restart never binds an environment API key to a runtime-only base URL", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "design-platform-restart-security-"));
  const configPath = path.join(tempDir, "design-platform-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({ designPlatformAdapter: "standard_v1", designPlatformBaseUrl: "https://design.example" }),
  );
  const script = [
    "const { appConfig, getDesignPlatformRuntimeConfigSummary } = require('./apps/api/src/shared/app-config.ts');",
    "process.stdout.write(JSON.stringify({ apiKeyOrigin: appConfig.designPlatformApiKeyOrigin, summary: getDesignPlatformRuntimeConfigSummary() }));",
  ].join("");
  const env = { ...process.env };
  delete env.DESIGN_PLATFORM_BASE_URL;
  delete env.DESIGN_PLATFORM_ACCESS_TOKEN;
  delete env.DESIGN_PLATFORM_COOKIE;
  delete env.DESIGN_PLATFORM_DEVICE_ID;
  env.DESIGN_PLATFORM_API_KEY = "static-api-key";
  env.DESIGN_PLATFORM_ALLOWED_ORIGINS = "https://design.example";
  env.DESIGN_PLATFORM_RUNTIME_CONFIG = configPath;
  const child = spawnSync(process.execPath, ["-r", "ts-node/register", "-e", script], {
    cwd: path.resolve(__dirname, ".."),
    env,
    encoding: "utf8",
  });
  try {
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.apiKeyOrigin, "");
    assert.equal(result.summary.hasApiKey, true);
    assert.equal(result.summary.credentialsBoundToBase, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function captureAdapter(seen, data) {
  return async (config) => {
    seen.push(config);
    return { data, status: 200, statusText: "OK", headers: {}, config, request: {} };
  };
}

function header(config, name) {
  const value = typeof config.headers?.get === "function" ? config.headers.get(name) : config.headers?.[name];
  return value === null ? undefined : value;
}

function snapshotConfig() {
  return { ...appConfig };
}
