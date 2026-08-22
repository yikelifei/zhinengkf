"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const test = require("node:test");
const {
  browserEmbedCsp,
  createZhenxiBrowserEmbedProxy,
  embeddedActivationStatus,
  normalizeDeviceId,
  normalizeTrustedUpstreamOrigin,
} = require("../tools/zhenxi-browser-embed-proxy");

test("browser embed proxy accepts only controlled loopback Zhenxi ports", () => {
  assert.equal(normalizeTrustedUpstreamOrigin("http://127.0.0.1:3000/path"), "http://127.0.0.1:3000");
  assert.equal(normalizeTrustedUpstreamOrigin("http://localhost:31870/"), "http://localhost:31870");
  assert.equal(normalizeTrustedUpstreamOrigin("http://127.0.0.1:31879/"), "http://127.0.0.1:31879");
  assert.equal(normalizeTrustedUpstreamOrigin("http://127.0.0.1:3100/"), "");
  assert.equal(normalizeTrustedUpstreamOrigin("https://app.zhenxiai.cloud/"), "");
  assert.equal(normalizeTrustedUpstreamOrigin("http://192.168.1.8:3000/"), "");
  assert.equal(normalizeTrustedUpstreamOrigin("http://user:secret@127.0.0.1:3000/"), "");
});

test("browser embed bootstrap restores the mirrored session marker and bound device identity", async (t) => {
  const proxy = createZhenxiBrowserEmbedProxy({
    port: 0,
    upstreamOrigins: [],
    deviceIdProvider: () => "smart-kefu-test-device",
    sharedSessionProvider: () => ({ authenticated: true, accessToken: "test.token.signature", deviceId: "" }),
  });
  await listen(proxy);
  t.after(() => close(proxy));
  const proxyPort = proxy.address().port;

  const response = await fetch(`http://127.0.0.1:${proxyPort}/__smart_kefu_embed_bootstrap`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-frame-options"), null);
  assert.match(body, /localStorage\.setItem\("art_device_id",deviceId\)/);
  assert.match(body, /localStorage\.setItem\("art_token","cookie-session"\)/);
  assert.match(body, /localStorage\.removeItem\("art_supabase_access_token"\)/);
  assert.match(body, /smart-kefu-test-device/);
  assert.match(body, /location\.replace\("\/"\)/);
  assert.equal(normalizeDeviceId("bad device id<script>"), "");
});

test("browser embed reports activation as not required without changing external Zhenxi", async (t) => {
  let activationStatusRequests = 0;
  const upstream = http.createServer((request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: { service: "zhenxi-ai" } }));
      return;
    }
    if (request.url === "/api/activation/status") activationStatusRequests += 1;
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false }));
  });
  await listen(upstream);
  t.after(() => close(upstream));
  const upstreamPort = upstream.address().port;

  const proxy = createZhenxiBrowserEmbedProxy({
    port: 0,
    upstreamOrigins: [`http://127.0.0.1:${upstreamPort}`],
    allowedPorts: new Set([upstreamPort]),
    sharedSessionProvider: () => ({ authenticated: true, accessToken: "test.token.signature", deviceId: "external-device" }),
  });
  await listen(proxy);
  t.after(() => close(proxy));
  const proxyPort = proxy.address().port;

  const response = await fetch(`http://127.0.0.1:${proxyPort}/api/activation/status`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.data, embeddedActivationStatus("external-device"));
  assert.equal(payload.data.required, false);
  assert.equal(payload.data.active, true);
  assert.equal(payload.data.reason, "not_required");
  assert.equal(activationStatusRequests, 0);
});

test("browser embed adds the not-required activation state to a valid mirrored auth session", async (t) => {
  const upstream = http.createServer((request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: { service: "zhenxi-ai" } }));
      return;
    }
    if (request.url === "/api/auth/session") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, data: { user: { id: "user-1" }, activation: null } }));
      return;
    }
    response.writeHead(404).end();
  });
  await listen(upstream);
  t.after(() => close(upstream));
  const upstreamPort = upstream.address().port;

  const proxy = createZhenxiBrowserEmbedProxy({
    port: 0,
    upstreamOrigins: [`http://127.0.0.1:${upstreamPort}`],
    allowedPorts: new Set([upstreamPort]),
    sharedSessionProvider: () => ({ authenticated: true, accessToken: "test.token.signature", deviceId: "external-device" }),
  });
  await listen(proxy);
  t.after(() => close(proxy));
  const proxyPort = proxy.address().port;

  const response = await fetch(`http://127.0.0.1:${proxyPort}/api/auth/session`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.user.id, "user-1");
  assert.deepEqual(payload.data.activation, embeddedActivationStatus("external-device"));
});

test("browser embed CSP preserves security directives and allows only Smart Kefu frame origins", () => {
  const result = browserEmbedCsp("base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
  assert.match(result, /base-uri 'self'/);
  assert.match(result, /object-src 'none'/);
  assert.doesNotMatch(result, /frame-ancestors 'none'/);
  assert.match(result, /frame-ancestors http:\/\/127\.0\.0\.1:3100 http:\/\/localhost:3100/);
});

test("browser embed proxy strips frame denial and forwards the real Zhenxi page", async (t) => {
  let receivedAuthorization = "";
  const upstream = http.createServer((request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: { status: "ok", service: "zhenxi-ai" } }));
      return;
    }
    receivedAuthorization = String(request.headers.authorization || "");
    response.writeHead(200, {
      "content-security-policy": "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "DENY",
    });
    response.end("<!doctype html><title>Zhenxi test</title><main>real workspace</main>");
  });
  await listen(upstream);
  t.after(() => close(upstream));
  const upstreamPort = upstream.address().port;

  const proxy = createZhenxiBrowserEmbedProxy({
    port: 0,
    upstreamOrigins: [`http://127.0.0.1:${upstreamPort}`],
    allowedPorts: new Set([upstreamPort]),
    sharedSessionProvider: () => ({ authenticated: true, accessToken: "external.token.signature", deviceId: "desktop-test" }),
  });
  await listen(proxy);
  t.after(() => close(proxy));
  const proxyPort = proxy.address().port;

  const health = await fetch(`http://127.0.0.1:${proxyPort}/__smart_kefu_embed_health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).upstreamOk, true);

  const page = await fetch(`http://127.0.0.1:${proxyPort}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-frame-options"), null);
  assert.match(page.headers.get("content-security-policy") || "", /frame-ancestors http:\/\/127\.0\.0\.1:3100/);
  assert.match(await page.text(), /real workspace/);
  assert.equal(receivedAuthorization, "Bearer external.token.signature");
});

test("browser embed proxy forwards the Zhenxi Next.js development websocket", async (t) => {
  let receivedOrigin = "";
  const upstream = http.createServer();
  upstream.on("upgrade", (request, socket) => {
    receivedOrigin = String(request.headers.origin || "");
    socket.end([
      "HTTP/1.1 101 Switching Protocols",
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Accept: test",
      "",
      "",
    ].join("\r\n"));
  });
  await listen(upstream);
  t.after(() => close(upstream));
  const upstreamPort = upstream.address().port;

  const proxy = createZhenxiBrowserEmbedProxy({
    port: 0,
    upstreamOrigins: [`http://127.0.0.1:${upstreamPort}`],
    allowedPorts: new Set([upstreamPort]),
    sharedSessionProvider: () => ({ authenticated: true, accessToken: "test.token.signature", deviceId: "desktop-test" }),
  });
  await listen(proxy);
  t.after(() => close(proxy));
  const proxyPort = proxy.address().port;

  const response = await rawUpgrade(proxyPort);
  assert.match(response, /^HTTP\/1\.1 101 Switching Protocols/);
  assert.equal(receivedOrigin, `http://127.0.0.1:${upstreamPort}`);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function rawUpgrade(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let response = "";
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write([
        "GET /_next/webpack-hmr HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        `Origin: http://127.0.0.1:${port}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGVzdC13ZWJzb2NrZXQ=",
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(response);
      }
    });
  });
}
