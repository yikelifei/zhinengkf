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
  isTrustedInternalZhenxiWorkspaceHealth,
  probeDesignPlatformCandidates,
  sanitizePublicDesignPlatformHealth,
} = require("../apps/api/src/integrations/design-platform/design-platform.controller");
const {
  appConfig,
  constantTimeSecretEqual,
  hasIndependentDesignPlatformCallbackApiKey,
} = require("../apps/api/src/shared/app-config");
const {
  supportsZhenxiCustomerCopyGeneration,
  supportsZhenxiCustomerImageGeneration,
} = require("../apps/api/src/integrations/design-platform/design-platform-readiness");

test("customer generation readiness recognizes the local Zhenxi image adapter", () => {
  assert.equal(supportsZhenxiCustomerImageGeneration("art_image_local", true), true);
  assert.equal(supportsZhenxiCustomerImageGeneration("zhenxi_external", true), true);
  assert.equal(supportsZhenxiCustomerImageGeneration("zhenxi_external", false), false);
  assert.equal(supportsZhenxiCustomerImageGeneration("standard_v1", true), false);
  assert.equal(supportsZhenxiCustomerCopyGeneration("art_image_local", true), false);
  assert.equal(supportsZhenxiCustomerCopyGeneration("zhenxi_external", true), true);
});

test("callback is disabled for Zhenxi adapters and standard mode fails closed without an independent key", async () => {
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

    appConfig.designPlatformAdapter = "zhenxi_external";
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

test("standard readiness blocks a missing callback key while Zhenxi adapters do not require one", async () => {
  const previous = { ...appConfig };
  const controller = new DesignPlatformController(
    {},
    {
      health: async () => appConfig.designPlatformAdapter === "zhenxi_external"
        ? { reachable: true, transport: "mcp_stdio", target: "installed_release" }
        : { ok: true },
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

    Object.assign(appConfig, {
      designPlatformAdapter: "zhenxi_external",
      designPlatformApiKey: "external-secret",
      designPlatformApiKeyOrigin: "http://127.0.0.1:31870",
      designPlatformBaseUrl: "http://127.0.0.1:31870",
    });
    const external = await controller.readiness();
    assert.equal(external.ok, true);
    assert.equal(external.canSubmitFormalGeneration, true);
    assert.equal(external.checks.some((check) => check.key === "design_platform_callback_auth"), false);
    assert.equal(external.checks.find((check) => check.key === "zhenxi_mcp_release").ok, true);

    appConfig.designPlatformApiKey = "";
    const externalWithoutKey = await controller.readiness();
    assert.equal(externalWithoutKey.ok, true);
    assert.equal(externalWithoutKey.checks.find((check) => check.key === "zhenxi_mcp_release").ok, true);

    Object.assign(appConfig, {
      designPlatformAccessToken: "same-as-art-external-key",
      designPlatformAccessTokenOrigin: "http://127.0.0.1:31870",
    });
    const externalWithCompatibleToken = await controller.readiness();
    assert.equal(externalWithCompatibleToken.ok, true);
    assert.equal(
      externalWithCompatibleToken.checks.find((check) => check.key === "zhenxi_mcp_release").ok,
      true,
    );
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("art local readiness returns actionable activation and account next steps", async () => {
  const previous = { ...appConfig };
  const controller = new DesignPlatformController(
    {},
    {
      health: async () => ({ ok: true, service: "zhenxi-ai", status: "ok" }),
      getArtImageLocalAuthSession: async () => ({ authenticated: false, reason: "UNAUTHORIZED" }),
      getArtImageLocalActivationStatus: async () => ({ required: true, active: false, reason: "missing_device" }),
    },
  );
  try {
    Object.assign(appConfig, {
      designPlatformAdapter: "art_image_local",
      designPlatformBaseUrl: "http://127.0.0.1:3000",
    });
    const readiness = await controller.readiness();
    const auth = readiness.checks.find((check) => check.key === "art_image_auth_session");
    const activation = readiness.checks.find((check) => check.key === "art_image_activation");

    assert.equal(readiness.ok, false);
    assert.equal(readiness.canSubmitFormalGeneration, false);
    assert.match(auth.action, /\/design\/activation/);
    assert.match(auth.action, /\/design\/account/);
    assert.match(activation.action, /\/design\/activation/);
    assert.ok(readiness.nextSteps.some((step) => step.includes("/design/account")));
    assert.ok(readiness.nextSteps.some((step) => step.includes("/design/activation")));
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("art local internal workspace readiness does not create a second device or login binding", async () => {
  const previous = { ...appConfig };
  let credentialProbeCalls = 0;
  const health = {
    ok: true,
    service: "zhenxi-ai",
    status: "ok",
    runtime: { channel: "internal", localWorkspace: true },
    localDemo: { localGenerateEnabled: true },
    ai: { imageConfigured: true },
  };
  const controller = new DesignPlatformController(
    {},
    {
      health: async () => health,
      getArtImageLocalAuthSession: async () => { credentialProbeCalls += 1; return { authenticated: false }; },
      getArtImageLocalActivationStatus: async () => { credentialProbeCalls += 1; return { active: false }; },
    },
  );
  try {
    Object.assign(appConfig, {
      designPlatformAdapter: "art_image_local",
      designPlatformBaseUrl: "http://127.0.0.1:3000",
    });
    const readiness = await controller.readiness();
    assert.equal(isTrustedInternalZhenxiWorkspaceHealth(health), true);
    assert.equal(readiness.ok, true);
    assert.equal(readiness.canSubmitFormalGeneration, true);
    assert.equal(readiness.checks.find((check) => check.key === "art_image_auth_session").ok, true);
    assert.equal(readiness.checks.find((check) => check.key === "art_image_activation").ok, true);
    assert.equal(credentialProbeCalls, 0);
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

test("candidate probe only checks trusted loopback health endpoints and does not mutate config", async () => {
  const previous = { ...appConfig };
  const requests = [];
  try {
    Object.assign(appConfig, {
      designPlatformAdapter: "art_image_local",
      designPlatformBaseUrl: "http://127.0.0.1:31871",
    });

    const report = await probeDesignPlatformCandidates({
      selectedBaseUrl: appConfig.designPlatformBaseUrl,
      candidateBaseUrls: [
        "http://127.0.0.1:31870",
        "http://127.0.0.1:31871",
        "http://127.0.0.1:31871/",
        "http://127.0.0.1:31872/path",
        "http://localhost:3000",
        "https://example.com",
      ],
      timeoutMs: 500,
      requestHealth: async (url, timeoutMs) => {
        requests.push({ url, timeoutMs });
        if (url === "http://127.0.0.1:31871/api/health") {
          return { statusCode: 200, data: { ok: true, data: { service: "zhenxi-ai", status: "ok", version: "0.1.26" } } };
        }
        return { statusCode: 200, data: { ok: true, service: "other", status: "ok" } };
      },
    });

    assert.equal(appConfig.designPlatformBaseUrl, "http://127.0.0.1:31871");
    assert.equal(report.ok, true);
    assert.equal(report.selectedBaseUrl, "http://127.0.0.1:31871");
    assert.equal(report.recommendedBaseUrl, "http://127.0.0.1:31871");
    assert.deepEqual(report.candidates.map((candidate) => candidate.baseUrl), [
      "http://127.0.0.1:31870",
      "http://127.0.0.1:31871",
    ]);
    assert.deepEqual(requests.map((request) => request.url), [
      "http://127.0.0.1:31870/api/health",
      "http://127.0.0.1:31871/api/health",
    ]);
    assert.ok(requests.every((request) => request.timeoutMs === 500));
    assert.equal(report.candidates.find((candidate) => candidate.baseUrl.endsWith(":31871")).version, "0.1.26");
    assert.equal(JSON.stringify(report).includes("Authorization"), false);
    assert.equal(JSON.stringify(requests).includes("local-generate"), false);
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("candidate endpoint is operator guarded and separate from public health", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../apps/api/src/integrations/design-platform/design-platform.controller.ts"),
    "utf8",
  );

  assert.match(source, /@Get\("candidates"\)/);
  assert.match(source, /@RequireOperatorCapability\("view_console"\)\s*\r?\n\s*@UseGuards\(OperatorAccessGuard\)\s*\r?\n\s*async candidates\(\)/);
  assert.doesNotMatch(source, /@Query\("baseUrl"\)/);
  assert.match(source, /\/api\/health/);
  assert.doesNotMatch(source, /\/api\/local-generate/);
});

function statusIs(status) {
  return (error) => error?.getStatus?.() === status;
}
