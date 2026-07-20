"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const {
  DesignPlatformController,
  boundOrExplicitDesignPlatformDeviceId,
  callbackAuthorizationMatches,
  sanitizePublicDesignPlatformHealth,
} = require("../apps/api/src/integrations/design-platform/design-platform.controller");
const {
  appConfig,
  constantTimeSecretEqual,
  hasIndependentDesignPlatformCallbackApiKey,
} = require("../apps/api/src/shared/app-config");

test("callback is disabled for art and standard mode fails closed without an independent key", async () => {
  const previous = { ...appConfig };
  let handlerCalls = 0;
  const controller = new DesignPlatformController(
    { handleDesignPlatformCallback: async () => { handlerCalls += 1; return { ok: true }; } },
    {},
  );
  const payload = { externalJobId: "external-1", status: "completed", images: [] };
  try {
    appConfig.designPlatformAdapter = "art_image_local";
    appConfig.callbackApiKey = "callback-key";
    await assert.rejects(() => controller.callback("Bearer callback-key", payload), statusIs(404));
    assert.equal(handlerCalls, 0);

    appConfig.designPlatformAdapter = "standard_v1";
    for (const [callbackKey, overlapping] of [
      ["", {}],
      ["internal-secret", { internalApiToken: "internal-secret" }],
      ["api-secret", { designPlatformApiKey: "api-secret" }],
      ["access-secret", { designPlatformAccessToken: "access-secret" }],
      ["cookie-secret", { designPlatformCookie: "session=cookie-secret" }],
    ]) {
      Object.assign(appConfig, {
        internalApiToken: "",
        designPlatformApiKey: "",
        designPlatformAccessToken: "",
        designPlatformCookie: "",
        callbackApiKey: callbackKey,
        ...overlapping,
      });
      assert.equal(hasIndependentDesignPlatformCallbackApiKey(), false);
      await assert.rejects(() => controller.callback(`Bearer ${callbackKey}`, payload), statusIs(503));
      assert.equal(handlerCalls, 0);
    }

    Object.assign(appConfig, {
      internalApiToken: "internal-secret",
      designPlatformApiKey: "api-secret",
      designPlatformAccessToken: "access-secret",
      designPlatformCookie: "session=cookie-secret",
      callbackApiKey: "independent-callback-secret",
    });
    assert.equal(hasIndependentDesignPlatformCallbackApiKey(), true);
    await assert.rejects(() => controller.callback("Bearer wrong", payload), statusIs(401));
    assert.equal(handlerCalls, 0);
    assert.deepEqual(await controller.callback("Bearer independent-callback-secret", payload), { ok: true });
    assert.equal(handlerCalls, 1);
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("callback and credential-domain comparisons require exact values", () => {
  assert.equal(callbackAuthorizationMatches("Bearer callback", "callback"), true);
  assert.equal(callbackAuthorizationMatches("Bearer callback-x", "callback"), false);
  assert.equal(callbackAuthorizationMatches(undefined, "callback"), false);
  assert.equal(constantTimeSecretEqual("same-secret", "same-secret"), true);
  assert.equal(constantTimeSecretEqual("same-secret", "different"), false);
});

test("public health response reduces hostile upstream data to one boolean", async () => {
  const hostile = {
    ok: true,
    token: "secret-token",
    cookie: "secret-cookie",
    authorization: "secret-auth",
    password: "secret-password",
    config: { apiKey: "secret-api-key" },
  };
  assert.deepEqual(sanitizePublicDesignPlatformHealth(hostile), { upstreamOk: true });
  const controller = new DesignPlatformController({}, { publicHealth: async () => hostile });
  const response = await controller.health();
  const serialized = JSON.stringify(response);
  assert.equal(response.upstreamOk, true);
  for (const secret of ["secret-token", "secret-cookie", "secret-auth", "secret-password", "secret-api-key"]) {
    assert.equal(serialized.includes(secret), false);
  }
  const failed = new DesignPlatformController({}, {
    publicHealth: async () => { throw new Error("secret-token cookie=secret-cookie"); },
  });
  const failure = await failed.health();
  assert.equal(failure.errorMessage, "design platform health check failed");
  assert.equal(JSON.stringify(failure).includes("secret-token"), false);
  assert.equal(JSON.stringify(failure).includes("secret-cookie"), false);
});

test("standard readiness blocks a missing callback key while art local does not require one", async () => {
  const previous = { ...appConfig };
  const controller = new DesignPlatformController(
    {},
    {
      health: async () => ({ ok: true }),
      getArtImageLocalAuthSession: async () => ({ authenticated: true }),
      getArtImageLocalActivationStatus: async () => ({ required: true, active: true }),
    },
  );
  try {
    Object.assign(appConfig, {
      designPlatformAdapter: "standard_v1",
      callbackApiKey: "",
      internalApiToken: "",
      designPlatformApiKey: "",
      designPlatformAccessToken: "",
      designPlatformCookie: "",
    });
    const standard = await controller.readiness();
    const callbackCheck = standard.checks.find((check) => check.key === "design_platform_callback_auth");
    assert.equal(standard.ok, false);
    assert.equal(standard.canSubmitFormalGeneration, false);
    assert.equal(callbackCheck.ok, false);
    assert.equal(callbackCheck.severity, "error");

    appConfig.designPlatformAdapter = "art_image_local";
    const art = await controller.readiness();
    assert.equal(art.checks.some((check) => check.key === "design_platform_callback_auth"), false);
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("a stale device binding is rejected before login or redeem performs a request", async () => {
  const previous = { ...appConfig };
  let loginCalls = 0;
  let redeemCalls = 0;
  const controller = new DesignPlatformController(
    {},
    {
      loginArtImageLocal: async () => { loginCalls += 1; return {}; },
      redeemArtImageLocalActivation: async () => { redeemCalls += 1; return {}; },
    },
  );
  try {
    Object.assign(appConfig, {
      designPlatformAdapter: "art_image_local",
      designPlatformBaseUrl: "http://127.0.0.1:3001",
      designPlatformDeviceId: "old-device",
      designPlatformDeviceIdOrigin: "http://127.0.0.1:3000",
    });
    assert.throws(() => boundOrExplicitDesignPlatformDeviceId(undefined), statusIs(400));
    await assert.rejects(() => controller.login({ email: "a@example.com", password: "secret" }), statusIs(400));
    await assert.rejects(() => controller.redeemActivation({ code: "CODE-1" }), statusIs(400));
    assert.equal(loginCalls, 0);
    assert.equal(redeemCalls, 0);
    assert.equal(boundOrExplicitDesignPlatformDeviceId("new-device"), "new-device");
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("invalid remote config is rejected before readiness performs a request", async () => {
  const previous = { ...appConfig };
  const previousAllowed = process.env.DESIGN_PLATFORM_ALLOWED_ORIGINS;
  let healthCalls = 0;
  const controller = new DesignPlatformController(
    {},
    { health: async () => { healthCalls += 1; return { ok: true }; } },
  );
  try {
    delete process.env.DESIGN_PLATFORM_ALLOWED_ORIGINS;
    await assert.rejects(
      () => controller.updateConfig({ adapter: "standard_v1", baseUrl: "https://untrusted.example" }),
      statusIs(400),
    );
    assert.equal(healthCalls, 0);
  } finally {
    Object.assign(appConfig, previous);
    if (previousAllowed === undefined) delete process.env.DESIGN_PLATFORM_ALLOWED_ORIGINS;
    else process.env.DESIGN_PLATFORM_ALLOWED_ORIGINS = previousAllowed;
  }
});

function statusIs(status) {
  return (error) => error?.getStatus?.() === status;
}
