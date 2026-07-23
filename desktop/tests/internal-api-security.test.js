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

test("launcher helper creates high-entropy session proof and only Web/API children receive it", () => {
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
  assert.match(route, /headers\.delete\(INTERNAL_API_TOKEN_HEADER\);\s*headers\.set\(INTERNAL_API_TOKEN_HEADER, token\);/);
  assert.match(route, /http:\/\/127\.0\.0\.1:\$\{apiPort\}/);
  assert.match(route, /export const POST = proxyDesktopApi/);
  assert.doesNotMatch(route, /NEXT_PUBLIC|console\.(?:log|error)|token\s*:/);
  assert.doesNotMatch(nextConfig, /rewrites|destination:\s*`http:\/\/127\.0\.0\.1/);
  assert.match(apiClient, /const API_BASE = "\/api";/);
  assert.doesNotMatch(apiClient, /NEXT_PUBLIC_API_BASE/);

  const clientFiles = listFiles(path.join(root, "apps", "web", "src"), [".ts", ".tsx"])
    .filter((filePath) => !filePath.endsWith(path.join("api", "[...path]", "route.ts")));
  for (const filePath of clientFiles) {
    assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /INTERNAL_API_TOKEN|x-internal-api-token/i, filePath);
  }
});

test("stable and port-stack launchers share proof without writing it into wrapper files", () => {
  const stable = read("tools/stable-runtime-launcher.js");
  const starter = read("tools/ports-stack-starter.js");
  const supervisor = read("tools/desktop-service-supervisor.js");
  const dev = read("tools/start-dev-ports.js");
  assert.match(stable, /const internalApiToken = ensureInternalApiToken\(\)/);
  assert.match(stable, /withoutInternalApiToken\(\{ \.\.\.serviceEnv/);
  assert.match(stable, /env: \{ \.\.\.serviceEnv\(spec\.port \|\| ports\.api, spec\.name\)/);
  assert.match(starter, /INTERNAL_API_TOKEN: internalApiToken/);
  assert.match(supervisor, /process\.env\.INTERNAL_API_TOKEN = ensureInternalApiToken\(\)/);
  assert.match(dev, /internalApiServiceEnv\([\s\S]*?service\?\.name, internalApiToken\)/);
  assert.match(dev, /withoutInternalApiToken\(\{[\s\S]*?FORCE_WEB_CLEAN_BUILD/);

  const wrapperSection = dev.slice(dev.indexOf("function buildWindowsServiceWrapper"), dev.indexOf("function serviceCwd"));
  assert.doesNotMatch(wrapperSection, /INTERNAL_API_TOKEN/);
  const stableWrapperSection = stable.slice(
    stable.indexOf("function buildWindowsPortServiceWrapper"),
    stable.indexOf("function cmdQuote"),
  );
  assert.doesNotMatch(stableWrapperSection, /INTERNAL_API_TOKEN/);
});

test("API bootstrap installs exact Origin enforcement while callback and worker routes remain unguarded", () => {
  const main = read("apps/api/src/main.ts");
  const personal = read("apps/api/src/personal-wechat-rpa/personal-wechat-rpa.controller.ts");
  const wechat = read("apps/api/src/wechat/wechat.controller.ts");
  assert.match(main, /registerLocalOriginPolicy\(app, appConfig\.webPort\)/);
  assert.doesNotMatch(main, /enableCors\(\{\s*origin:\s*true/);

  const personalInbound = methodSection(personal, '@Post("inbound")', "processInbound");
  assert.doesNotMatch(personalInbound, /RequireOperatorCapability|UseGuards\(OperatorAccessGuard\)/);
  const bridgeAck = methodSection(wechat, '@Post("send-tasks/:id/bridge-ack")', "acknowledgeBridgeSend");
  assert.doesNotMatch(bridgeAck, /RequireOperatorCapability|UseGuards\(OperatorAccessGuard\)/);
  const inbound = methodSection(wechat, '@Post("inbound/messages")', "processInboundMessage");
  assert.doesNotMatch(inbound, /RequireOperatorCapability|UseGuards\(OperatorAccessGuard\)/);
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
