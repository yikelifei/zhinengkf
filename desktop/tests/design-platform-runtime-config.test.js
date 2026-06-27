"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-design-config-"));
const runtimeConfigPath = path.join(tempDir, "design-platform-config.json");

for (const name of [
  "DESIGN_PLATFORM_ADAPTER",
  "DESIGN_PLATFORM_BASE_URL",
  "DESIGN_PLATFORM_ACCESS_TOKEN",
  "DESIGN_PLATFORM_COOKIE",
  "DESIGN_PLATFORM_DEVICE_ID",
  "DESIGN_PLATFORM_RUNTIME_CONFIG",
]) {
  delete process.env[name];
}
process.env.DESIGN_PLATFORM_RUNTIME_CONFIG = runtimeConfigPath;

require("ts-node/register");

const {
  appConfig,
  getDesignPlatformRuntimeConfigSummary,
  updateDesignPlatformRuntimeConfig,
} = require("../apps/api/src/shared/app-config.ts");

test("defaults design platform runtime config to local art image platform", () => {
  const summary = getDesignPlatformRuntimeConfigSummary();

  assert.equal(summary.adapter, "art_image_local");
  assert.equal(summary.baseUrl, "http://127.0.0.1:3000");
  assert.equal(summary.hasAccessToken, false);
  assert.equal(summary.hasCookie, false);
  assert.equal(summary.hasDeviceId, false);
  assert.equal(summary.runtimeConfigPath, runtimeConfigPath);
});

test("updates design platform runtime config and refreshes app config", () => {
  const summary = updateDesignPlatformRuntimeConfig({
    adapter: "art_image_local",
    baseUrl: "http://127.0.0.1:3001",
    accessToken: "token-123",
    cookie: "session=abc",
    deviceId: "device-999999",
  });

  const saved = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"));
  assert.equal(saved.designPlatformAdapter, "art_image_local");
  assert.equal(saved.designPlatformBaseUrl, "http://127.0.0.1:3001");
  assert.equal(saved.designPlatformAccessToken, "token-123");
  assert.equal(saved.designPlatformCookie, "session=abc");
  assert.equal(saved.designPlatformDeviceId, "device-999999");

  assert.equal(appConfig.designPlatformAdapter, "art_image_local");
  assert.equal(appConfig.designPlatformBaseUrl, "http://127.0.0.1:3001");
  assert.equal(appConfig.designPlatformAccessToken, "token-123");
  assert.equal(appConfig.designPlatformCookie, "session=abc");
  assert.equal(appConfig.designPlatformDeviceId, "device-999999");
  assert.equal(summary.hasAccessToken, true);
  assert.equal(summary.hasCookie, true);
  assert.equal(summary.hasDeviceId, true);
  assert.equal(summary.deviceIdSuffix, "999999");
});

test("clears optional design platform credentials with empty strings", () => {
  const summary = updateDesignPlatformRuntimeConfig({
    accessToken: "",
    cookie: "",
    deviceId: "",
  });

  const saved = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"));
  assert.equal(saved.designPlatformAccessToken, undefined);
  assert.equal(saved.designPlatformCookie, undefined);
  assert.equal(saved.designPlatformDeviceId, undefined);

  assert.equal(appConfig.designPlatformAccessToken, "");
  assert.equal(appConfig.designPlatformCookie, "");
  assert.equal(appConfig.designPlatformDeviceId, "");
  assert.equal(summary.hasAccessToken, false);
  assert.equal(summary.hasCookie, false);
  assert.equal(summary.hasDeviceId, false);
});
