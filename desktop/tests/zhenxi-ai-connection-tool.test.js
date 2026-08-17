"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const probe = require("../tools/check-zhenxi-ai-connection.js");

test("Zhenxi AI connection probe uses the customer-service adapter without generation", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["zhenxi:connection"], "node tools/check-zhenxi-ai-connection.js");

  const source = read("tools/check-zhenxi-ai-connection.js");
  assert.match(source, /DesignPlatformClient/);
  assert.match(source, /DESIGN_PLATFORM_ADAPTER = "art_image_local"/);
  assert.match(source, /http:\/\/127\.0\.0\.1:3000/);
  assert.match(source, /http:\/\/127\.0\.0\.1:3001/);
  assert.match(source, /buildLoopbackPortCandidates\(31870, 10\)/);
  assert.match(source, /candidateResults/);
  assert.match(source, /probeCandidateHealth/);
  assert.match(source, /publicHealth\(\)/);
  assert.match(source, /getArtImageLocalAuthSession\(\)/);
  assert.match(source, /getArtImageLocalActivationStatus\(\)/);
  assert.doesNotMatch(source, /\.post\(["']api\/local-generate/);
  assert.match(source, /requires explicit approval/);
});

test("Zhenxi AI connection probe includes dev, preview, packaged desktop and custom candidates", () => {
  const previous = process.env.ZHENXI_AI_LOCAL_CANDIDATES;
  process.env.ZHENXI_AI_LOCAL_CANDIDATES = "http://127.0.0.1:39000, http://localhost:39001";
  try {
    const args = probe.parseArgs(["--base-url", "http://127.0.0.1:3000"]);
    assert.deepEqual(args.candidateBaseUrls.slice(0, 6), [
      "http://127.0.0.1:3000",
      "http://127.0.0.1:39000",
      "http://localhost:39001",
      "http://127.0.0.1:31870",
      "http://127.0.0.1:31871",
      "http://127.0.0.1:31872",
    ]);
    assert.ok(args.candidateBaseUrls.includes("http://127.0.0.1:31870"));
    assert.ok(args.candidateBaseUrls.includes("http://127.0.0.1:31879"));
    assert.ok(args.candidateBaseUrls.includes("http://localhost:3000"));
    assert.ok(args.candidateBaseUrls.includes("http://127.0.0.1:3001"));
    assert.ok(args.candidateBaseUrls.includes("http://localhost:3001"));
  } finally {
    if (previous === undefined) delete process.env.ZHENXI_AI_LOCAL_CANDIDATES;
    else process.env.ZHENXI_AI_LOCAL_CANDIDATES = previous;
  }
});

test("Zhenxi AI connection probe separates missing device, activation, auth, and generation states", () => {
  const checks = probe.buildChecks({
    fatalError: "",
    health: { service: "zhenxi-ai", status: "ok" },
    auth: { required: true, authenticated: false, reason: "UNAUTHORIZED" },
    activation: { required: true, active: false, reason: "missing_device", deviceIdSuffix: "" },
    configSummary: { hasDeviceId: false, deviceIdSuffix: "" },
    args: {},
  });

  assert.equal(probe.statusFromChecks(checks), "CONNECTED_BLOCKED");
  assert.equal(checks.find((check) => check.id === "zhenxi.health").status, "PASS");
  assert.equal(checks.find((check) => check.id === "zhenxi.device_id").status, "BLOCKED");
  assert.match(checks.find((check) => check.id === "zhenxi.device_id").detail, /missing device id/);
  assert.equal(checks.find((check) => check.id === "zhenxi.activation").status, "BLOCKED");
  assert.match(checks.find((check) => check.id === "zhenxi.activation").detail, /\/design\/activation/);
  assert.equal(checks.find((check) => check.id === "zhenxi.auth").status, "BLOCKED");
  assert.match(checks.find((check) => check.id === "zhenxi.auth").detail, /\/design\/account/);
  assert.equal(checks.find((check) => check.id === "zhenxi.generation").status, "NOT_RUN");
  assert.equal(probe.readyForFormalGeneration(checks), false);

  const routes = probe.buildNextSteps(checks).map((step) => step.route);
  assert.deepEqual([...new Set(routes)], ["/design/activation", "/design/account"]);
});

test("Zhenxi AI connection probe marks unactivated devices without treating auth as ready", () => {
  const checks = probe.buildChecks({
    fatalError: "",
    health: { service: "zhenxi-ai", status: "ok" },
    auth: { required: true, authenticated: false, reason: "UNAUTHORIZED" },
    activation: { required: true, active: false, reason: "not_activated", deviceIdSuffix: "abc123" },
    configSummary: { hasDeviceId: true, deviceIdSuffix: "abc123" },
    args: { deviceIdSource: "cli" },
  });

  assert.equal(checks.find((check) => check.id === "zhenxi.device_id").status, "PASS");
  assert.equal(checks.find((check) => check.id === "zhenxi.activation").status, "BLOCKED");
  assert.match(checks.find((check) => check.id === "zhenxi.activation").detail, /admin activation code/);
  assert.equal(checks.find((check) => check.id === "zhenxi.auth").status, "BLOCKED");
  assert.equal(probe.statusFromChecks(checks), "CONNECTED_BLOCKED");
});

test("Zhenxi AI connection probe reports ready preflight while keeping formal generation manual", () => {
  const checks = probe.buildChecks({
    fatalError: "",
    health: { service: "zhenxi-ai", status: "ok" },
    auth: { required: true, authenticated: true, refreshed: false },
    activation: { required: true, active: true, reason: "active", deviceIdSuffix: "ready1" },
    configSummary: { hasDeviceId: true, deviceIdSuffix: "ready1" },
    args: {},
  });

  assert.equal(probe.statusFromChecks(checks), "READY");
  assert.equal(probe.readyForFormalGeneration(checks), true);
  assert.equal(checks.find((check) => check.id === "zhenxi.generation").status, "NOT_RUN");
  assert.match(checks.find((check) => check.id === "zhenxi.generation").detail, /does not call \/api\/local-generate/);
  assert.deepEqual(probe.buildNextSteps(checks).map((step) => step.route), ["/design/settings"]);
});

test("Zhenxi AI internal workspace reuses the bound local process without a second login or device", () => {
  const health = {
    service: "zhenxi-ai",
    status: "ok",
    runtime: { channel: "internal", localWorkspace: true },
    localDemo: { localGenerateEnabled: true },
    ai: { imageConfigured: true },
  };
  const checks = probe.buildChecks({
    fatalError: "",
    health,
    auth: { required: true, authenticated: false, reason: "UNAUTHORIZED" },
    activation: { required: true, active: false, reason: "not_activated" },
    configSummary: { hasDeviceId: false },
    args: {},
  });

  assert.equal(probe.internalNoLoginGenerationReady(health), true);
  assert.equal(probe.statusFromChecks(checks), "READY");
  assert.equal(probe.readyForFormalGeneration(checks), true);
  assert.match(checks.find((check) => check.id === "zhenxi.device_id").detail, /no second device binding/);
  assert.match(checks.find((check) => check.id === "zhenxi.auth").detail, /without storing account credentials/);
});

test("Zhenxi AI connection probe supports read-only device id input without leaking secrets", () => {
  const args = probe.parseArgs(["--base-url", "http://127.0.0.1:3000", "--device-id", "device-secret-123"]);
  assert.equal(args.deviceId, "device-secret-123");
  assert.equal(args.deviceIdSource, "cli");

  const sanitized = probe.sanitizePublicText(
    "authorization=Bearer abc.def cookie=sessionid=secret password=hunter2 refresh_token=refresh-secret",
  );
  assert.doesNotMatch(sanitized, /abc\.def|sessionid=secret|hunter2|refresh-secret/);
  assert.match(sanitized, /Bearer \[redacted\]|password=\[redacted\]/);

  const markdown = probe.renderMarkdown({
    status: "CONNECTED_BLOCKED",
    readyForFormalGeneration: false,
    generatedAt: "2026-07-28T00:00:00.000Z",
    baseUrl: "http://127.0.0.1:3000",
    strict: false,
    latencyMs: 1,
    candidateResults: [],
    checks: [
      { id: "zhenxi.generation", label: "Formal generation", status: "NOT_RUN", detail: "not run" },
    ],
    nextSteps: [{ route: "/design/activation", action: "Redeem code for this device" }],
    deviceIdInput: { provided: true, source: "cli", suffix: "abc123" },
    preflight: {
      healthOk: true,
      hasDeviceId: true,
      deviceActivated: false,
      authenticated: false,
      formalGenerationRun: false,
    },
  });
  assert.match(markdown, /\/design\/activation/);
  assert.doesNotMatch(markdown, /device-secret-123|password|cookie|authorization/i);
});
