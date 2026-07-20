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

test("Axios boundary sends each credential only to its explicitly bound origin", async () => {
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
    const client = DesignPlatformClient.createForTesting(captureAdapter(seen, { ok: true }));

    await client.health();

    assert.equal(header(seen[0], "authorization"), "Bearer access-secret");
    assert.equal(header(seen[0], "cookie"), "session=cookie-secret");
    assert.equal(header(seen[0], "x-art-device-id"), "device-secret");

    appConfig.designPlatformAccessToken = "";
    const apiKeyOnly = designPlatformCredentialsForTarget("https://design.example", "/v1/health");
    assert.equal(apiKeyOnly.authorization, "Bearer api-secret");
    const untrusted = designPlatformCredentialsForTarget("https://design.example", "https://untrusted.example/probe");
    assert.deepEqual(untrusted, { authorization: "", cookie: "", deviceId: "" });
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("first login preserves its explicit same-origin device id and rejects absolute requests", async () => {
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
    const client = DesignPlatformClient.createForTesting(captureAdapter(seen, {
      ok: true,
      data: { accessToken: "login-token", user: { id: "user-1" } },
    }));

    await client.loginArtImageLocal({ email: "test@example.com", password: "secret", deviceId: "first-device" });
    await assert.rejects(
      client.http.get("https://untrusted.example/probe", { headers: { "x-art-device-id": "first-device" } }),
      (error) => error?.code === "DESIGN_PLATFORM_REQUEST_TARGET_BLOCKED",
    );

    assert.equal(header(seen[0], "x-art-device-id"), "first-device");
    assert.equal(seen.length, 1);
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("request security invariants and transport cannot be overridden per request", async () => {
  const previous = snapshotConfig();
  const seen = [];
  try {
    Object.assign(appConfig, {
      designPlatformAdapter: "standard_v1",
      designPlatformBaseUrl: "https://design.example",
      designPlatformTimeoutMs: 12000,
      designPlatformAccessToken: "access-secret",
      designPlatformAccessTokenOrigin: "https://design.example",
      designPlatformApiKey: "",
      designPlatformApiKeyOrigin: "",
      designPlatformCookie: "",
      designPlatformCookieOrigin: "",
      designPlatformDeviceId: "",
      designPlatformDeviceIdOrigin: "",
    });
    let transformRequestRan = false;
    let transformResponseRan = false;
    let attackerAdapterRan = false;
    let attackerTransportRan = false;
    const attackerAdapter = async () => {
      attackerAdapterRan = true;
      throw new Error("attacker adapter must not run");
    };
    const client = DesignPlatformClient.createForTesting(captureAdapter(seen, { ok: true }));

    await client.http.post("v1/design-jobs", { prompt: "sensitive body" }, {
      baseURL: "https://untrusted.example",
      timeout: 1,
      maxRedirects: 12,
      transformRequest: [function (data) {
        transformRequestRan = true;
        this.url = "https://untrusted.example/collect";
        this.maxRedirects = 12;
        return data;
      }],
      transformResponse: [function (data) {
        transformResponseRan = true;
        return data;
      }],
      adapter: attackerAdapter,
      transport: {
        request() {
          attackerTransportRan = true;
          throw new Error("attacker transport must not run");
        },
      },
      socketPath: "\\\\.\\pipe\\attacker",
      proxy: { host: "untrusted.example", port: 8080 },
      httpAgent: { attacker: true },
      httpsAgent: { attacker: true },
      beforeRedirect() {
        throw new Error("attacker redirect hook must not run");
      },
      httpVersion: 2,
      http2Options: { createConnection: () => { throw new Error("attacker HTTP/2 connection must not run"); } },
      validateStatus: () => true,
    });

    assert.equal(seen.length, 1);
    assert.equal(transformRequestRan, false);
    assert.equal(transformResponseRan, false);
    assert.equal(attackerAdapterRan, false);
    assert.equal(attackerTransportRan, false);
    assert.equal(seen[0].url, "v1/design-jobs");
    assert.equal(seen[0].baseURL, "https://design.example/");
    assert.equal(seen[0].timeout, 12000);
    assert.equal(seen[0].maxRedirects, 0);
    assert.equal(seen[0].proxy, false);
    assert.equal(seen[0].transport, undefined);
    assert.equal(seen[0].socketPath, undefined);
    assert.equal(seen[0].httpAgent, undefined);
    assert.equal(seen[0].httpsAgent, undefined);
    assert.equal(seen[0].beforeRedirect, undefined);
    assert.equal(seen[0].httpVersion, undefined);
    assert.equal(seen[0].http2Options, undefined);
    assert.equal(header(seen[0], "authorization"), "Bearer access-secret");
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("request boundary rejects absolute, protocol-relative and base-path escape URLs before transport", async () => {
  const previous = snapshotConfig();
  const seen = [];
  try {
    Object.assign(appConfig, {
      designPlatformAdapter: "standard_v1",
      designPlatformBaseUrl: "https://design.example/trusted/base",
      designPlatformAccessToken: "",
      designPlatformAccessTokenOrigin: "",
      designPlatformApiKey: "",
      designPlatformApiKeyOrigin: "",
      designPlatformCookie: "",
      designPlatformCookieOrigin: "",
      designPlatformDeviceId: "",
      designPlatformDeviceIdOrigin: "",
    });
    const client = DesignPlatformClient.createForTesting(captureAdapter(seen, { ok: true }));
    const blocked = [
      "https://untrusted.example/collect",
      "//untrusted.example/collect",
      "/v1/health",
      "../outside",
      "%2e%2e/outside",
      "v1/%2e%2e/%2e%2e/outside",
      "v1\\..\\outside",
    ];

    for (const url of blocked) {
      await assert.rejects(
        client.http.get(url),
        (error) => error?.code === "DESIGN_PLATFORM_REQUEST_TARGET_BLOCKED",
        url,
      );
    }
    assert.equal(seen.length, 0);
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("AxiosHeaders removes mixed-case credential and routing header spoof attempts", async () => {
  const previous = snapshotConfig();
  const seen = [];
  try {
    Object.assign(appConfig, {
      designPlatformAdapter: "standard_v1",
      designPlatformBaseUrl: "https://design.example",
      designPlatformAccessToken: "",
      designPlatformAccessTokenOrigin: "",
      designPlatformApiKey: "",
      designPlatformApiKeyOrigin: "",
      designPlatformCookie: "",
      designPlatformCookieOrigin: "",
      designPlatformDeviceId: "",
      designPlatformDeviceIdOrigin: "",
    });
    const client = DesignPlatformClient.createForTesting(captureAdapter(seen, { ok: true }));
    await client.http.get("v1/health", {
      headers: {
        aUtHoRiZaTiOn: "Bearer spoofed",
        cOoKiE: "spoofed=1",
        "X-aRt-DeViCe-Id": "spoofed-device",
        "pRoXy-AuThOrIzAtIoN": "Basic spoofed",
        hOsT: "untrusted.example",
      },
    });

    assert.equal(seen.length, 1);
    for (const name of ["authorization", "cookie", "x-art-device-id", "proxy-authorization", "host"]) {
      assert.equal(header(seen[0], name), undefined, name);
    }
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("normal public methods use fixed relative routes beneath the configured base path", async () => {
  const previous = snapshotConfig();
  const seen = [];
  try {
    Object.assign(appConfig, {
      designPlatformAdapter: "standard_v1",
      designPlatformBaseUrl: "https://design.example/trusted/base",
      designPlatformAccessToken: "",
      designPlatformAccessTokenOrigin: "",
      designPlatformApiKey: "",
      designPlatformApiKeyOrigin: "",
      designPlatformCookie: "",
      designPlatformCookieOrigin: "",
      designPlatformDeviceId: "",
      designPlatformDeviceIdOrigin: "",
    });
    const client = DesignPlatformClient.createForTesting(captureAdapter(seen, { ok: true }));

    await client.health();
    await client.createDesignJob({ requestId: "request-1" });
    await client.uploadAsset({ assetId: "asset-1" });
    await client.getDesignJob("job with spaces");
    await client.getDesignJobResults("job with spaces");
    await client.cancelDesignJob("job with spaces");

    assert.deepEqual(
      seen.map((config) => config.url),
      [
        "v1/health",
        "v1/design-jobs",
        "v1/assets/upload",
        "v1/design-jobs/job%20with%20spaces",
        "v1/design-jobs/job%20with%20spaces/results",
        "v1/design-jobs/job%20with%20spaces/cancel",
      ],
    );
    assert.ok(seen.every((config) => config.baseURL === "https://design.example/trusted/base/"));
    assert.ok(seen.every((config) => config.maxRedirects === 0));
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("login, activation and ordinary API POST reject 307/308 without following sensitive bodies", async () => {
  const previous = snapshotConfig();
  const cases = [
    {
      name: "login cross-origin redirect",
      adapter: "art_image_local",
      status: 307,
      location: "https://untrusted.example/collect-login",
      invoke: (client) => client.loginArtImageLocal({ email: "test@example.com", password: "secret", deviceId: "device-1" }),
    },
    {
      name: "activation protocol downgrade redirect",
      adapter: "art_image_local",
      status: 308,
      location: "http://design.example/collect-activation",
      invoke: (client) => client.redeemArtImageLocalActivation({ code: "activation-secret", deviceId: "device-1" }),
    },
    {
      name: "ordinary API private-network redirect",
      adapter: "standard_v1",
      status: 307,
      location: "http://127.0.0.1/internal",
      invoke: (client) => client.createDesignJob({ prompt: "sensitive prompt" }),
    },
  ];

  try {
    for (const item of cases) {
      const seen = [];
      Object.assign(appConfig, {
        designPlatformAdapter: item.adapter,
        designPlatformBaseUrl: "https://design.example",
        designPlatformTimeoutMs: 12000,
        designPlatformAccessToken: "access-secret",
        designPlatformAccessTokenOrigin: "https://design.example",
        designPlatformApiKey: "",
        designPlatformApiKeyOrigin: "",
        designPlatformCookie: "session=cookie-secret",
        designPlatformCookieOrigin: "https://design.example",
        designPlatformDeviceId: "device-secret",
        designPlatformDeviceIdOrigin: "https://design.example",
      });
      const client = DesignPlatformClient.createForTesting(redirectAdapter(seen, item.status, item.location));

      await assert.rejects(
        item.invoke(client),
        (error) => error?.isAxiosError === true && error?.response?.status === item.status,
        item.name,
      );
      assert.equal(seen.length, 1, `${item.name} must make exactly one request`);
      assert.equal(seen[0].maxRedirects, 0, `${item.name} must disable redirects`);
    }
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

function redirectAdapter(seen, status, location) {
  return async (config) => {
    seen.push(config);
    return {
      data: { redirected: true },
      status,
      statusText: "Redirect",
      headers: { location },
      config,
      request: {},
    };
  };
}

function header(config, name) {
  const value = typeof config.headers?.get === "function" ? config.headers.get(name) : config.headers?.[name];
  return value === null ? undefined : value;
}

function snapshotConfig() {
  return { ...appConfig };
}
