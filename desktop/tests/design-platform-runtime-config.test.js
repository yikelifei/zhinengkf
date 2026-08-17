"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-design-config-"));
const runtimeConfigPath = path.join(tempDir, "design-platform-config.json");
const envPath = path.join(tempDir, ".env");
fs.writeFileSync(envPath, "");

for (const name of [
  "DESIGN_PLATFORM_ADAPTER",
  "DESIGN_PLATFORM_BASE_URL",
  "DESIGN_PLATFORM_ALLOWED_ORIGINS",
  "DESIGN_PLATFORM_API_KEY",
  "DESIGN_PLATFORM_ACCESS_TOKEN",
  "DESIGN_PLATFORM_COOKIE",
  "DESIGN_PLATFORM_DEVICE_ID",
  "DESIGN_PLATFORM_RUNTIME_CONFIG",
  "CUSTOMER_SERVICE_PUBLIC_BASE_URL",
  "DESIGN_PLATFORM_CALLBACK_URL",
  "DESIGN_PLATFORM_CALLBACK_API_KEY",
  "INTERNAL_API_TOKEN",
  "ZHENXI_AI_APP_URL",
  "ZHENXI_AI_SITE_URL",
  "ZHENXI_AI_WWW_URL",
  "ZHENXI_AI_LOCAL_BASE_URL",
  "ZHENXI_AI_LOCAL_DEV_URL",
  "ZHENXI_AI_LOCAL_PREVIEW_URL",
  "DESKTOP_ENV_FILE",
]) {
  delete process.env[name];
}
process.env.DESIGN_PLATFORM_RUNTIME_CONFIG = runtimeConfigPath;
process.env.DESKTOP_ENV_FILE = envPath;

require("ts-node/register");

const {
  appConfig,
  getDesignPlatformRuntimeConfigSummary,
  updateDesignPlatformRuntimeConfig,
} = require("../apps/api/src/shared/app-config.ts");

test("defaults design platform runtime config to local mock platform", () => {
  const summary = getDesignPlatformRuntimeConfigSummary();

  assert.equal(summary.adapter, "standard_v1");
  assert.equal(summary.baseUrl, "http://127.0.0.1:3700");
  assert.equal(summary.hasAccessToken, false);
  assert.equal(summary.hasApiKey, false);
  assert.equal(summary.hasCookie, false);
  assert.equal(summary.hasDeviceId, false);
  assert.equal(summary.hasCallbackApiKey, false);
  assert.equal(summary.customerServicePublicBaseUrl, "http://127.0.0.1:3200");
  assert.equal(summary.callbackUrl, "http://127.0.0.1:3200/api/integrations/design-platform/callback");
  assert.deepEqual(summary.zhenxiAi, {
    primaryAppUrl: "https://app.zhenxiai.cloud",
    websiteUrl: "https://zhenxiai.cloud",
    wwwWebsiteUrl: "https://www.zhenxiai.cloud",
    localDevUrl: "http://127.0.0.1:3000",
    localPreviewUrl: "http://127.0.0.1:3001",
    localCandidateBaseUrls: [
      "http://127.0.0.1:31870",
      "http://127.0.0.1:31871",
      "http://127.0.0.1:31872",
      "http://127.0.0.1:31873",
      "http://127.0.0.1:31874",
      "http://127.0.0.1:31875",
      "http://127.0.0.1:31876",
      "http://127.0.0.1:31877",
      "http://127.0.0.1:31878",
      "http://127.0.0.1:31879",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
    ],
    authRedirectUrls: [
      "https://zhenxiai.cloud/auth/callback",
      "https://zhenxiai.cloud/auth/reset-password",
      "https://www.zhenxiai.cloud/auth/callback",
      "https://www.zhenxiai.cloud/auth/reset-password",
      "https://app.zhenxiai.cloud/auth/callback",
      "https://app.zhenxiai.cloud/auth/reset-password",
    ],
  });
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
  assert.equal(saved.designPlatformAccessTokenOrigin, "http://127.0.0.1:3001");
  assert.equal(saved.designPlatformCookieOrigin, "http://127.0.0.1:3001");
  assert.equal(saved.designPlatformDeviceIdOrigin, "http://127.0.0.1:3001");

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

test("accepts Zhenxi external adapter only on explicit loopback origins", () => {
  const designPlatformApiFixture = ["same", "as", "art", "external", "key"].join("-");
  const summary = updateDesignPlatformRuntimeConfig({
    adapter: "zhenxi_external",
    baseUrl: "http://127.0.0.1:31870",
    apiKey: designPlatformApiFixture,
  });
  const saved = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"));

  assert.equal(saved.designPlatformAdapter, "zhenxi_external");
  assert.equal(saved.designPlatformBaseUrl, "http://127.0.0.1:31870");
  assert.equal(saved.designPlatformApiKey, designPlatformApiFixture);
  assert.equal(saved.designPlatformApiKeyOrigin, "http://127.0.0.1:31870");
  assert.equal(appConfig.designPlatformAdapter, "zhenxi_external");
  assert.equal(appConfig.designPlatformBaseUrl, "http://127.0.0.1:31870");
  assert.equal(appConfig.designPlatformApiKey, designPlatformApiFixture);
  assert.equal(appConfig.designPlatformApiKeyOrigin, "http://127.0.0.1:31870");
  assert.equal(summary.adapter, "zhenxi_external");
  assert.equal(summary.hasApiKey, true);
  assert.equal(summary.credentialsBoundToBase, true);

  const before = fs.readFileSync(runtimeConfigPath, "utf8");
  assert.throws(
    () => updateDesignPlatformRuntimeConfig({ adapter: "zhenxi_external", baseUrl: "https://app.zhenxiai.cloud" }),
    /explicit loopback/,
  );
  assert.equal(fs.readFileSync(runtimeConfigPath, "utf8"), before);
});

test("rejects a remote runtime origin outside the explicit allowlist without writing config", () => {
  const before = fs.readFileSync(runtimeConfigPath, "utf8");
  const previousBaseUrl = appConfig.designPlatformBaseUrl;
  assert.throws(
    () => updateDesignPlatformRuntimeConfig({ adapter: "standard_v1", baseUrl: "https://untrusted.example" }),
    /not allowlisted/,
  );
  assert.equal(fs.readFileSync(runtimeConfigPath, "utf8"), before);
  assert.equal(appConfig.designPlatformBaseUrl, previousBaseUrl);
});

test("rejects malformed or authority-bearing base URLs without changing persisted config", () => {
  process.env.DESIGN_PLATFORM_ALLOWED_ORIGINS = "https://design.example";
  for (const baseUrl of [
    "ftp://design.example",
    "https://user:password@design.example",
    "https://design.example/v1",
    "https://design.example?tenant=1",
    "https://design.example#fragment",
    "http://design.example",
  ]) {
    const before = fs.readFileSync(runtimeConfigPath, "utf8");
    assert.throws(() => updateDesignPlatformRuntimeConfig({ adapter: "standard_v1", baseUrl }), undefined, baseUrl);
    assert.equal(fs.readFileSync(runtimeConfigPath, "utf8"), before, baseUrl);
  }
});

test("origin change clears bearer and cookie while retaining the old-bound device until explicitly rebound", () => {
  process.env.DESIGN_PLATFORM_ALLOWED_ORIGINS = "https://design.example";
  const changed = updateDesignPlatformRuntimeConfig({
    adapter: "standard_v1",
    baseUrl: "https://design.example",
  });
  const saved = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"));

  assert.equal(saved.designPlatformAccessToken, undefined);
  assert.equal(saved.designPlatformApiKey, undefined);
  assert.equal(saved.designPlatformCookie, undefined);
  assert.equal(saved.designPlatformDeviceId, "device-999999");
  assert.equal(saved.designPlatformApiKeyOrigin, undefined);
  assert.equal(saved.designPlatformDeviceIdOrigin, "http://127.0.0.1:3001");
  assert.equal(appConfig.designPlatformApiKey, "");
  assert.equal(appConfig.designPlatformAccessToken, "");
  assert.equal(appConfig.designPlatformCookie, "");
  assert.equal(appConfig.designPlatformDeviceId, "device-999999");
  assert.equal(changed.credentialsBoundToBase, false);

  const rebound = updateDesignPlatformRuntimeConfig({
    accessToken: "new-token",
    cookie: "new-session=1",
    deviceId: "new-device",
  });
  const reboundSaved = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"));
  assert.equal(reboundSaved.designPlatformAccessTokenOrigin, "https://design.example");
  assert.equal(reboundSaved.designPlatformCookieOrigin, "https://design.example");
  assert.equal(reboundSaved.designPlatformDeviceIdOrigin, "https://design.example");
  assert.equal(rebound.credentialsBoundToBase, true);
});

test("clears optional design platform credentials with empty strings", () => {
  const summary = updateDesignPlatformRuntimeConfig({
    apiKey: "",
    accessToken: "",
    cookie: "",
    deviceId: "",
  });

  const saved = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"));
  assert.equal(saved.designPlatformApiKey, undefined);
  assert.equal(saved.designPlatformAccessToken, undefined);
  assert.equal(saved.designPlatformCookie, undefined);
  assert.equal(saved.designPlatformDeviceId, undefined);
  assert.equal(saved.designPlatformApiKeyOrigin, undefined);
  assert.equal(saved.designPlatformAccessTokenOrigin, undefined);
  assert.equal(saved.designPlatformCookieOrigin, undefined);
  assert.equal(saved.designPlatformDeviceIdOrigin, undefined);

  assert.equal(appConfig.designPlatformApiKey, "");
  assert.equal(appConfig.designPlatformAccessToken, "");
  assert.equal(appConfig.designPlatformCookie, "");
  assert.equal(appConfig.designPlatformDeviceId, "");
  assert.equal(summary.hasApiKey, false);
  assert.equal(summary.hasAccessToken, false);
  assert.equal(summary.hasCookie, false);
  assert.equal(summary.hasDeviceId, false);
});
