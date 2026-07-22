"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const {
  allowedLocalWebOrigins,
  createLocalOriginRequestHook,
  evaluateLocalRequestOrigin,
} = require("../apps/api/src/shared/local-origin-policy");
const {
  ensureInternalApiToken,
  internalApiServiceEnv,
  isValidInternalApiToken,
  withoutInternalApiToken,
} = require("../tools/internal-api-session");
const {
  DESKTOP_SESSION_COOKIE,
  buildDesktopApiUpstreamHeaders,
  canonicalDesktopProxyPath,
  evaluateDesktopSessionProof,
  isForbiddenWebProxyIngress,
  requiresDesktopSessionProof,
} = require("../apps/web/src/lib/desktop-session-proof");
const { PackagedServiceManager, buildApiServiceEnvironment } = require("../apps/electron/packaged-runtime");
const {
  READINESS_CHALLENGE_HEADER,
  createApiReadinessProof,
  createWebReadinessProof,
  verifyApiReadinessProof,
  verifyWebReadinessProof,
} = require("../packages/runtime/packaged-readiness-proof");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Origin policy accepts only the configured local Web origins and no-Origin workers", () => {
  assert.deepEqual([...allowedLocalWebOrigins(3100)].sort(), ["http://127.0.0.1:3100", "http://localhost:3100"]);
  for (const origin of ["http://127.0.0.1:3100", "http://localhost:3100"]) {
    assert.deepEqual(evaluateLocalRequestOrigin(origin, 3100), {
      allowed: true,
      reason: "allowed_local_web_origin",
    });
  }
  assert.deepEqual(evaluateLocalRequestOrigin(undefined, 3100), { allowed: true, reason: "no_origin" });
  for (const origin of [
    "http://evil.example",
    "https://127.0.0.1:3100",
    "http://127.0.0.1:3101",
    "http://localhost:3100/",
    "null",
    "not a url",
    "",
  ]) {
    assert.equal(evaluateLocalRequestOrigin(origin, 3100).allowed, false, origin);
  }
  assert.equal(evaluateLocalRequestOrigin(["http://127.0.0.1:3100"], 3100).allowed, false);
});

test("malicious browser Origin receives a structured JSON 403", async () => {
  const reply = {
    statusCode: 200,
    payload: null,
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
      return this;
    },
  };
  await createLocalOriginRequestHook(3100)({ headers: { origin: "https://evil.example" } }, reply);
  assert.equal(reply.statusCode, 403);
  assert.deepEqual(reply.payload, {
    statusCode: 403,
    error: "Forbidden",
    code: "request_origin_not_allowed",
    message: "Browser requests to the desktop API are limited to the configured local Web origin.",
  });

  const noOriginReply = { ...reply, statusCode: 200, payload: null };
  await createLocalOriginRequestHook(3100)({ headers: {} }, noOriginReply);
  assert.equal(noOriginReply.statusCode, 200);
  assert.equal(noOriginReply.payload, null);
});

test("launcher helper creates a high-entropy internal API token and only Web/API children receive it", () => {
  const first = ensureInternalApiToken("");
  const second = ensureInternalApiToken("invalid");
  assert.equal(isValidInternalApiToken(first), true);
  assert.equal(isValidInternalApiToken(second), true);
  assert.equal(first.length, 64);
  assert.notEqual(first, second);
  assert.equal(ensureInternalApiToken(first), first);

  const base = { PATH: "safe", INTERNAL_API_TOKEN: "must-be-removed", internal_api_token: "also-remove" };
  assert.equal(internalApiServiceEnv(base, "web", first).INTERNAL_API_TOKEN, first);
  assert.equal(internalApiServiceEnv(base, "api", first).INTERNAL_API_TOKEN, first);
  assert.equal(Object.keys(internalApiServiceEnv(base, "design-platform-mock", first)).some(isTokenKey), false);
  assert.equal(Object.keys(internalApiServiceEnv(base, "wechat-bridge-worker", first)).some(isTokenKey), false);
  assert.equal(Object.keys(withoutInternalApiToken(base)).some(isTokenKey), false);
});

test("Next catch-all proxy injects proof server-side, strips spoofed proof, and exposes no public token", () => {
  const route = read("apps/web/src/app/api/[...path]/route.ts");
  const nextConfig = read("apps/web/next.config.js");
  const apiClient = read("apps/web/src/lib/api.ts");
  assert.match(route, /import "server-only"/);
  assert.match(route, /process\.env\.INTERNAL_API_TOKEN/);
  assert.match(route, /buildDesktopApiUpstreamHeaders\(request\.headers, token, INTERNAL_API_TOKEN_HEADER\)/);
  const proofHelper = read("apps/web/src/lib/desktop-session-proof.ts");
  assert.match(proofHelper, /headers\.delete\("cookie"\)/);
  assert.match(proofHelper, /headers\.delete\(internalApiTokenHeader\);\s*headers\.delete\(READINESS_CHALLENGE_HEADER\);\s*headers\.set\(internalApiTokenHeader, internalApiToken\);/);
  assert.match(route, /http:\/\/127\.0\.0\.1:\$\{apiPort\}/);
  assert.match(route, /export const POST = proxyDesktopApi/);
  assert.doesNotMatch(route, /NEXT_PUBLIC|console\.(?:log|error)|token\s*:/);
  assert.doesNotMatch(nextConfig, /rewrites|destination:\s*`http:\/\/127\.0\.0\.1/);
  assert.match(apiClient, /const API_BASE = "\/api";/);
  assert.doesNotMatch(apiClient, /NEXT_PUBLIC_API_BASE/);

  const clientFiles = listFiles(path.join(root, "apps", "web", "src"), [".ts", ".tsx"])
    .filter((filePath) => !filePath.endsWith(path.join("api", "[...path]", "route.ts")))
    .filter((filePath) => !filePath.endsWith(path.join("lib", "desktop-session-proof.ts")));
  for (const filePath of clientFiles) {
    assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /INTERNAL_API_TOKEN|x-internal-api-token/i, filePath);
    assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /desktop-session-proof/, filePath);
  }
});

test("desktop proxy requires a verified Electron proof for every method and strips ambient authority upstream", () => {
  const proof = "c".repeat(64);
  for (const method of ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(requiresDesktopSessionProof(method), true, method);
  }
  assert.equal(evaluateDesktopSessionProof(null, proof).allowed, false);
  assert.equal(evaluateDesktopSessionProof(`${DESKTOP_SESSION_COOKIE}=${"d".repeat(64)}`, proof).allowed, false);
  assert.deepEqual(evaluateDesktopSessionProof(`${DESKTOP_SESSION_COOKIE}=${proof}`, proof), {
    allowed: true,
    reason: "verified_electron_session",
  });
  assert.equal(
    evaluateDesktopSessionProof(`${DESKTOP_SESSION_COOKIE}=${proof}; ${DESKTOP_SESSION_COOKIE}=${proof}`, proof).allowed,
    false,
  );

  const upstream = buildDesktopApiUpstreamHeaders(
    new Headers({
      cookie: `${DESKTOP_SESSION_COOKIE}=${proof}; ordinary=also-removed`,
      "x-internal-api-token": "attacker",
      "x-request-id": "request-1",
    }),
    "a".repeat(64),
  );
  assert.equal(upstream.get("cookie"), null);
  assert.equal(upstream.get("x-internal-api-token"), "a".repeat(64));
  assert.equal(upstream.get(READINESS_CHALLENGE_HEADER), null);
  assert.equal(upstream.get("x-request-id"), "request-1");
});

test("packaged readiness HMAC binds API and Web responses to one launch without exposing the token", () => {
  const token = "a".repeat(64);
  const challenge = "b".repeat(64);
  const otherToken = "c".repeat(64);
  const apiProof = createApiReadinessProof(token, challenge);
  const webProof = createWebReadinessProof(token, challenge, apiProof);

  assert.match(apiProof, /^[a-f0-9]{64}$/);
  assert.match(webProof, /^[a-f0-9]{64}$/);
  assert.equal(verifyApiReadinessProof(token, challenge, apiProof), true);
  assert.equal(verifyApiReadinessProof(otherToken, challenge, apiProof), false);
  assert.equal(verifyApiReadinessProof(token, "d".repeat(64), apiProof), false);
  assert.equal(verifyWebReadinessProof(token, challenge, apiProof, webProof), true);
  assert.equal(verifyWebReadinessProof(token, challenge, apiProof, challenge), false);

  const route = read("apps/web/src/app/api/[...path]/route.ts");
  const health = read("apps/api/src/health.controller.ts");
  assert.match(route, /verifyApiReadinessProof\(internalSecret, desktopSessionProof, apiProof\)/);
  assert.match(route, /createWebReadinessProof\(internalSecret, desktopSessionProof, apiProof\)/);
  assert.match(health, /createApiReadinessProof\(appConfig\.internalApiToken, readinessChallenge\)/);
  assert.doesNotMatch(route, /\[INTERNAL_API_TOKEN_HEADER\]\s*:/);
});

test("callback proxy ingress and path-normalization variants are rejected before upstream construction", () => {
  for (const segments of [
    ["integrations", "design-platform", "callback"],
    ["INTEGRATIONS", "DESIGN-PLATFORM", "CALLBACK"],
  ]) {
    const result = canonicalDesktopProxyPath(segments);
    assert.equal(result.allowed, true);
    assert.equal(isForbiddenWebProxyIngress(result.path), true);
  }
  for (const segments of [
    ["integrations", "design-platform", "callback", ""],
    ["integrations", "design-platform", "x", "..", "callback"],
    ["integrations", "design-platform", "x", "%2e%2e", "callback"],
    ["integrations", "design-platform%2fcallback"],
    ["integrations", "design-platform%252fcallback"],
  ]) {
    assert.equal(canonicalDesktopProxyPath(segments).allowed, false, segments.join("/"));
  }
  assert.equal(isForbiddenWebProxyIngress("/integrations/design-platform/callback/"), true);
});

test("packaged runtime keeps desktop proof independent and out of the API environment", () => {
  const token = "a".repeat(64);
  const env = buildApiServiceEnvironment({
    resourcesPath: "C:\\Program Files\\Smart Kefu\\resources",
    appPath: "C:\\Program Files\\Smart Kefu\\resources\\app.asar",
    userDataPath: "C:\\Users\\operator\\AppData\\Roaming\\Smart Kefu",
    baseEnv: { PATH: "safe", DESKTOP_WEB_SESSION_PROOF: "parent-secret", desktop_web_session_proof: "lower-secret" },
    token,
  });
  assert.equal(Object.keys(env).some((key) => key.toUpperCase() === "DESKTOP_WEB_SESSION_PROOF"), false);
  const manager = new PackagedServiceManager({
    resourcesPath: "resources",
    appPath: "app.asar",
    userDataPath: "user-data",
    executablePath: "electron.exe",
  });
  assert.match(manager.webSessionProof, /^[a-f0-9]{64}$/);
  assert.notEqual(manager.webSessionProof, manager.token);
  const main = read("apps/electron/main.js");
  assert.match(main, /partition: DESKTOP_SESSION_PARTITION/);
  assert.match(main, /path: "\/api"/);
  assert.match(main, /httpOnly: true/);
  assert.match(main, /sameSite: "strict"/);
  assert.match(main, /await installDesktopSessionCookie\(webSessionProof\);\s*createMainWindow\(\);/);
});

test("stable and port-stack launchers scope tokens and filter wrapper files", () => {
  const stable = read("tools/stable-runtime-launcher.js");
  const stableElectron = read("tools/launch-stable-electron.js");
  const starter = read("tools/ports-stack-starter.js");
  const supervisor = read("tools/desktop-service-supervisor.js");
  const dev = read("tools/start-dev-ports.js");
  assert.match(stable, /const internalApiToken = ensureInternalApiToken\(\)/);
  assert.match(stable, /renderWindowsWrapperEnvironment\(spec\.name, serviceEnv/);
  assert.match(stable, /env: serviceEnv\(spec\.port \|\| ports\.api, spec\.name, spec\.env\)/);
  assert.match(stable, /createDesktopWebSession\(runtimeDir/);
  assert.match(stable, /desktopWebSessionServiceEnv\(internalEnv, serviceName, desktopWebSession\.proof\)/);
  assert.match(stableElectron, /readDesktopWebSessionProof\(sessionFile\)/);
  assert.match(stableElectron, /env\[DESKTOP_WEB_SESSION_PROOF_ENV\] = proof/);
  assert.match(starter, /INTERNAL_API_TOKEN: internalApiToken/);
  assert.match(supervisor, /process\.env\.INTERNAL_API_TOKEN = ensureInternalApiToken\(\)/);
  assert.match(dev, /internalApiServiceEnv\([\s\S]*?service\?\.name, internalApiToken\)/);
  assert.match(dev, /selectServiceEnvironment\(/);
  assert.match(dev, /withoutInternalApiToken\(\{[\s\S]*?FORCE_WEB_CLEAN_BUILD/);

  const wrapperSection = dev.slice(dev.indexOf("function buildWindowsServiceWrapper"), dev.indexOf("function serviceCwd"));
  assert.doesNotMatch(wrapperSection, /INTERNAL_API_TOKEN/);
  const stableWrapperSection = stable.slice(
    stable.indexOf("function buildWindowsPortServiceWrapper"),
    stable.indexOf("function cmdQuote"),
  );
  assert.doesNotMatch(stableWrapperSection, /INTERNAL_API_TOKEN/);
});

test("API bootstrap keeps dedicated callbacks public while generic inbound requires a trusted operator", () => {
  const main = read("apps/api/src/main.ts");
  const personal = read("apps/api/src/personal-wechat-rpa/personal-wechat-rpa.controller.ts");
  const wechat = read("apps/api/src/wechat/wechat.controller.ts");
  assert.match(main, /registerLocalOriginPolicy\(app, appConfig\.webPort\)/);
  assert.doesNotMatch(main, /enableCors\(\{\s*origin:\s*true/);

  const personalInbound = methodSection(personal, '@Post("inbound")', "processInbound");
  assert.doesNotMatch(personalInbound, /RequireOperatorCapability|UseGuards\(OperatorAccessGuard\)/);
  const bridgeAck = methodSection(wechat, '@Post("send-tasks/:id/bridge-ack")', "acknowledgeBridgeSend");
  assert.doesNotMatch(bridgeAck, /RequireOperatorCapability|UseGuards\(OperatorAccessGuard\)/);
  assert.doesNotMatch(bridgeAck, /WechatBridgeAccessGuard|WechatWindowObserverAccessGuard/);
  for (const [decorator, method, guard] of [
    ['@Get("bridge/outbox")', "listBridgeOutbox", "WechatBridgeAccessGuard"],
    ['@Get("bridge/dispatch")', "listBridgeDispatch", "WechatBridgeAccessGuard"],
    ['@Get("bridge/status")', "getBridgeStatus", "WechatBridgeAccessGuard"],
    ['@Post("bridge/inbox/scan")', "scanBridgeInbox", "WechatBridgeAccessGuard"],
    ['@Get("window-snapshots")', "listWindowSnapshots", "WechatWindowObserverAccessGuard"],
    ['@Get("window-observer/status")', "getWindowObserverStatus", "WechatWindowObserverAccessGuard"],
    ['@Post("window-snapshots/inbox/scan")', "scanWindowSnapshotInbox", "WechatWindowObserverAccessGuard"],
  ]) {
    const section = methodSection(wechat, decorator, method);
    assert.match(section, /@RequireOperatorCapability\("view_console"\)/, method);
    assert.match(section, new RegExp(`@UseGuards\\(${guard}\\)`), method);
  }
  const inbound = methodSection(wechat, '@Post("inbound/messages")', "processInboundMessage");
  assert.match(inbound, /@RequireOperatorCapability\("approve_send"\)/);
  assert.match(inbound, /@UseGuards\(OperatorAccessGuard\)/);
  assert.match(inbound, /@TrustedOperator\(\) _principal: TrustedOperatorPrincipal/);
});

function methodSection(source, decorator, methodName) {
  const start = source.indexOf(decorator);
  const method = source.indexOf(methodName, start);
  const nextDecorator = source.indexOf("\n  @", method);
  assert.ok(start >= 0 && method >= start, `${decorator} / ${methodName}`);
  return source.slice(start, nextDecorator >= 0 ? nextDecorator : source.length);
}

function isTokenKey(key) {
  return String(key).toUpperCase() === "INTERNAL_API_TOKEN";
}

function listFiles(directory, extensions) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath, extensions));
    else if (extensions.includes(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}
