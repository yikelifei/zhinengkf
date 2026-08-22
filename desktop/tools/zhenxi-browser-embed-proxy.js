"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const {
  applyZhenxiSharedSessionRequestHeaders,
  isZhenxiSessionMutationUrl,
  publicZhenxiSharedSessionStatus,
  readZhenxiSharedSession,
} = require("../apps/electron/zhenxi-shared-session");

const DEFAULT_PORT = 3710;
const HEALTH_PATH = "/__smart_kefu_embed_health";
const BOOTSTRAP_PATH = "/__smart_kefu_embed_bootstrap";
const DEFAULT_FRAME_ORIGINS = ["http://127.0.0.1:3100", "http://localhost:3100"];
const DEFAULT_UPSTREAM_PORTS = new Set([3000, ...Array.from({ length: 10 }, (_, index) => 31870 + index)]);

function normalizeTrustedUpstreamOrigin(value, allowedPorts = DEFAULT_UPSTREAM_PORTS) {
  try {
    const target = new URL(String(value || "").trim());
    const hostname = target.hostname.toLowerCase();
    const port = Number(target.port || 80);
    if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname)) return "";
    if (target.username || target.password || !allowedPorts.has(port)) return "";
    return target.origin;
  } catch {
    return "";
  }
}

function browserEmbedCsp(value, frameOrigins = DEFAULT_FRAME_ORIGINS) {
  const directives = String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item && !item.toLowerCase().startsWith("frame-ancestors"));
  directives.push(`frame-ancestors ${frameOrigins.join(" ")}`);
  return `${directives.join("; ")};`;
}

function proxyResponseHeaders(headers, upstreamOrigin, proxyOrigin, frameOrigins = DEFAULT_FRAME_ORIGINS) {
  const next = { ...headers };
  delete next["x-frame-options"];
  delete next["cross-origin-opener-policy"];
  next["content-security-policy"] = browserEmbedCsp(next["content-security-policy"], frameOrigins);
  const location = Array.isArray(next.location) ? next.location[0] : next.location;
  if (location) {
    try {
      const resolved = new URL(location, upstreamOrigin);
      if (resolved.origin === upstreamOrigin) next.location = `${proxyOrigin}${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch {}
  }
  return next;
}

function createZhenxiBrowserEmbedProxy(options = {}) {
  const allowedPorts = options.allowedPorts || DEFAULT_UPSTREAM_PORTS;
  const candidates = (options.upstreamOrigins || configuredUpstreamOrigins())
    .map((value) => normalizeTrustedUpstreamOrigin(value, allowedPorts))
    .filter((value, index, all) => value && all.indexOf(value) === index);
  const frameOrigins = options.frameOrigins || DEFAULT_FRAME_ORIGINS;
  const proxyPort = options.port !== undefined
    ? Number(options.port)
    : Number(process.env.ZHENXI_BROWSER_EMBED_PORT || DEFAULT_PORT);
  const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
  const resolveDeviceId = options.deviceIdProvider || configuredDeviceId;
  const resolveSharedSession = options.sharedSessionProvider || (() => readZhenxiSharedSession());
  let activeUpstream = candidates[0] || "";

  const server = http.createServer(async (request, response) => {
    const currentProxyOrigin = listeningProxyOrigin(server, proxyOrigin);
    const requestUrl = new URL(request.url || "/", currentProxyOrigin);
    if (requestUrl.pathname === HEALTH_PATH) {
      const upstream = await findHealthyUpstream(candidates, activeUpstream);
      if (upstream) activeUpstream = upstream;
      const sharedSession = resolveSharedSession();
      writeJson(response, upstream ? 200 : 503, {
        ok: Boolean(upstream),
        service: "zhenxi-browser-embed-proxy",
        upstream: upstream || null,
        upstreamOk: Boolean(upstream),
        sharedSession: publicZhenxiSharedSessionStatus(sharedSession),
      }, frameOrigins);
      return;
    }

    if (requestUrl.pathname === BOOTSTRAP_PATH) {
      const sharedSession = resolveSharedSession();
      if (!sharedSession?.authenticated) {
        writeJson(response, 401, { ok: false, error: "ZHENXI_EXTERNAL_SESSION_REQUIRED" }, frameOrigins);
        return;
      }
      const deviceId = normalizeDeviceId(sharedSession.deviceId)
        || normalizeDeviceId(resolveDeviceId())
        || normalizeDeviceId(requestUrl.searchParams.get("deviceId"));
      writeBootstrap(response, deviceId, frameOrigins);
      return;
    }

    if (!activeUpstream) activeUpstream = await findHealthyUpstream(candidates, "");
    if (!activeUpstream) {
      writeJson(response, 503, { ok: false, error: "ZHENXI_EMBED_UPSTREAM_UNAVAILABLE" }, frameOrigins);
      return;
    }

    const sharedSession = resolveSharedSession();
    if (!sharedSession?.authenticated) {
      writeJson(response, 401, { ok: false, error: "ZHENXI_EXTERNAL_SESSION_REQUIRED" }, frameOrigins);
      return;
    }
    if (isZhenxiSessionMutationUrl(new URL(request.url || "/", activeUpstream))) {
      writeJson(response, 409, { ok: false, error: "ZHENXI_EXTERNAL_SESSION_IS_AUTHORITATIVE" }, frameOrigins);
      return;
    }

    const mirroredActivation = embeddedActivationStatus(
      normalizeDeviceId(sharedSession.deviceId)
        || normalizeDeviceId(resolveDeviceId())
        || normalizeDeviceId(request.headers["x-art-device-id"]),
    );
    if (requestUrl.pathname === "/api/activation/status") {
      writeJson(response, 200, { ok: true, data: mirroredActivation }, frameOrigins);
      return;
    }

    forwardRequest(
      request,
      response,
      activeUpstream,
      currentProxyOrigin,
      frameOrigins,
      sharedSession,
      () => { activeUpstream = ""; },
      requestUrl.pathname === "/api/auth/session"
        ? (payload) => activationMirroredSessionPayload(payload, mirroredActivation)
        : null,
    );
  });

  server.on("upgrade", async (request, socket, head) => {
    if (!activeUpstream) activeUpstream = await findHealthyUpstream(candidates, "");
    if (!activeUpstream) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    const sharedSession = resolveSharedSession();
    if (!sharedSession?.authenticated) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    forwardUpgrade(request, socket, head, activeUpstream, listeningProxyOrigin(server, proxyOrigin), frameOrigins, sharedSession, () => {
      activeUpstream = "";
    });
  });

  return server;
}

function listeningProxyOrigin(server, fallback) {
  const address = server.address();
  return address && typeof address === "object" ? `http://127.0.0.1:${address.port}` : fallback;
}

function normalizeDeviceId(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(normalized)) return "";
  return normalized;
}

function embeddedActivationStatus(deviceId) {
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  return {
    required: false,
    active: true,
    reason: "not_required",
    deviceIdSuffix: normalizedDeviceId
      ? crypto.createHash("sha256").update(normalizedDeviceId.toLowerCase()).digest("hex").slice(0, 10)
      : "",
    activation: null,
  };
}

function activationMirroredSessionPayload(payload, activation) {
  if (!payload || typeof payload !== "object" || payload.ok !== true) return payload;
  if (!payload.data || typeof payload.data !== "object" || !payload.data.user) return payload;
  return {
    ...payload,
    data: {
      ...payload.data,
      activation,
    },
  };
}

function configuredDeviceId() {
  try {
    const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
      ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
      : path.resolve(__dirname, "..", ".runtime-stable");
    const configPath = process.env.DESIGN_PLATFORM_RUNTIME_CONFIG
      ? path.resolve(process.env.DESIGN_PLATFORM_RUNTIME_CONFIG)
      : path.join(runtimeDir, "design-platform-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return normalizeDeviceId(config?.designPlatformDeviceId);
  } catch {
    return "";
  }
}

function configuredUpstreamOrigins() {
  const configured = String(process.env.ZHENXI_BROWSER_UPSTREAMS || process.env.DESIGN_PLATFORM_BASE_URL || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [
    ...Array.from({ length: 10 }, (_, index) => `http://127.0.0.1:${31870 + index}`),
    ...configured,
    "http://127.0.0.1:3000",
  ];
}

function forwardRequest(request, response, upstreamOrigin, proxyOrigin, frameOrigins, sharedSession, onFailure, transformJson = null) {
  const target = new URL(request.url || "/", `${upstreamOrigin}/`);
  const headers = upstreamRequestHeaders(request.headers, target, upstreamOrigin, proxyOrigin, frameOrigins, sharedSession);

  const upstreamRequest = http.request(target, { method: request.method, headers }, (upstreamResponse) => {
    const nextHeaders = proxyResponseHeaders(upstreamResponse.headers, upstreamOrigin, proxyOrigin, frameOrigins);
    if (transformJson) {
      const chunks = [];
      let size = 0;
      upstreamResponse.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 2 * 1024 * 1024) chunks.push(chunk);
      });
      upstreamResponse.on("end", () => {
        if (size > 2 * 1024 * 1024) {
          writeJson(response, 502, { ok: false, error: "ZHENXI_EMBED_RESPONSE_TOO_LARGE" }, frameOrigins);
          return;
        }
        let body = Buffer.concat(chunks);
        try {
          const payload = JSON.parse(body.toString("utf8"));
          body = Buffer.from(JSON.stringify(transformJson(payload)));
        } catch {}
        delete nextHeaders["content-length"];
        delete nextHeaders["content-encoding"];
        delete nextHeaders["transfer-encoding"];
        nextHeaders["content-length"] = body.length;
        response.writeHead(upstreamResponse.statusCode || 502, nextHeaders);
        response.end(body);
      });
      return;
    }
    response.writeHead(upstreamResponse.statusCode || 502, nextHeaders);
    upstreamResponse.pipe(response);
  });
  upstreamRequest.setTimeout(30_000, () => upstreamRequest.destroy(new Error("ZHENXI_EMBED_UPSTREAM_TIMEOUT")));
  upstreamRequest.once("error", (error) => {
    onFailure();
    if (!response.headersSent) writeJson(response, 502, { ok: false, error: error.message || "ZHENXI_EMBED_PROXY_FAILED" }, frameOrigins);
    else response.destroy(error);
  });
  request.pipe(upstreamRequest);
}

function forwardUpgrade(request, socket, head, upstreamOrigin, proxyOrigin, frameOrigins, sharedSession, onFailure) {
  const target = new URL(request.url || "/", `${upstreamOrigin}/`);
  const headers = upstreamRequestHeaders(request.headers, target, upstreamOrigin, proxyOrigin, frameOrigins, sharedSession);
  const upstreamRequest = http.request(target, { method: request.method || "GET", headers });
  upstreamRequest.once("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    const rawHeaders = [];
    for (let index = 0; index < upstreamResponse.rawHeaders.length; index += 2) {
      rawHeaders.push(`${upstreamResponse.rawHeaders[index]}: ${upstreamResponse.rawHeaders[index + 1]}`);
    }
    socket.write(`HTTP/1.1 ${upstreamResponse.statusCode || 101} ${upstreamResponse.statusMessage || "Switching Protocols"}\r\n${rawHeaders.join("\r\n")}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });
  upstreamRequest.once("response", (upstreamResponse) => {
    socket.end(`HTTP/1.1 ${upstreamResponse.statusCode || 502} ${upstreamResponse.statusMessage || "Bad Gateway"}\r\nConnection: close\r\n\r\n`);
  });
  upstreamRequest.once("error", () => {
    onFailure();
    socket.destroy();
  });
  upstreamRequest.end();
}

function upstreamRequestHeaders(requestHeaders, target, upstreamOrigin, proxyOrigin, frameOrigins, sharedSession) {
  const headers = applyZhenxiSharedSessionRequestHeaders({ ...requestHeaders, host: target.host }, sharedSession);
  delete headers["proxy-connection"];
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-proto"];
  delete headers["accept-encoding"];
  if (headers.origin === proxyOrigin || frameOrigins.includes(headers.origin)) headers.origin = upstreamOrigin;
  if (typeof headers.referer === "string" && headers.referer.startsWith(proxyOrigin)) {
    headers.referer = `${upstreamOrigin}${headers.referer.slice(proxyOrigin.length)}`;
  }
  return headers;
}

function findHealthyUpstream(candidates, preferred) {
  const ordered = [preferred, ...candidates].filter((value, index, all) => value && all.indexOf(value) === index);
  return ordered.reduce(async (resultPromise, candidate) => {
    const result = await resultPromise;
    if (result) return result;
    return await upstreamHealthy(candidate) ? candidate : "";
  }, Promise.resolve(""));
}

function upstreamHealthy(origin) {
  return new Promise((resolve) => {
    const request = http.get(new URL("/api/health", origin), { timeout: 2500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body = `${body}${chunk}`.slice(0, 4096); });
      response.on("end", () => {
        try {
          const json = JSON.parse(body);
          const service = json?.service || json?.data?.service;
          resolve(response.statusCode === 200 && json?.ok === true && service === "zhenxi-ai");
        } catch {
          resolve(false);
        }
      });
    });
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(false));
  });
}

function writeJson(response, statusCode, payload, frameOrigins) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-security-policy": browserEmbedCsp("default-src 'none'", frameOrigins),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function writeBootstrap(response, deviceId, frameOrigins) {
  const serializedDeviceId = JSON.stringify(normalizeDeviceId(deviceId)).replace(/</g, "\\u003c");
  const body = `<!doctype html><meta charset="utf-8"><title>Loading Zhenxi AI</title><script>`
    + `const deviceId=${serializedDeviceId};if(deviceId)localStorage.setItem("art_device_id",deviceId);`
    + `localStorage.setItem("art_token","cookie-session");localStorage.removeItem("art_supabase_access_token");location.replace("/");`
    + `</script>`;
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-security-policy": browserEmbedCsp("default-src 'none'; script-src 'unsafe-inline'", frameOrigins),
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

if (require.main === module) {
  const port = Number(process.env.ZHENXI_BROWSER_EMBED_PORT || process.env.PORT || DEFAULT_PORT);
  const server = createZhenxiBrowserEmbedProxy({ port });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[zhenxi-browser-embed] listening http://127.0.0.1:${port}`);
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
}

module.exports = {
  BOOTSTRAP_PATH,
  HEALTH_PATH,
  browserEmbedCsp,
  createZhenxiBrowserEmbedProxy,
  embeddedActivationStatus,
  normalizeDeviceId,
  normalizeTrustedUpstreamOrigin,
  proxyResponseHeaders,
};
