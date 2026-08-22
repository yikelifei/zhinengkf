import "server-only";

import {
  API_READINESS_PROOF_FIELD,
  READINESS_CHALLENGE_HEADER,
  WEB_READINESS_PROOF_FIELD,
  buildDesktopApiUpstreamHeaders,
  canonicalDesktopProxyPath,
  createWebReadinessProof,
  evaluateDesktopSessionProof,
  evaluateLocalBrowserApiAccess,
  isForbiddenWebProxyIngress,
  requiresDesktopSessionProof,
  verifyApiReadinessProof,
} from "../../../lib/desktop-session-proof";

const { MAX_DESKTOP_API_JSON_BODY_BYTES } = require("../../../../../../packages/runtime/desktop-request-limits") as {
  MAX_DESKTOP_API_JSON_BODY_BYTES: number;
};

const INTERNAL_API_TOKEN_HEADER = "x-internal-api-token";
const INTERNAL_API_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const CLOUD_API_BASE_URL_ENV = "SMART_KEFU_CLOUD_API_BASE_URL";
const CLOUD_API_TOKEN_ENV = "SMART_KEFU_CLOUD_API_TOKEN";
const RESPONSE_HEADERS_TO_REMOVE = [
  "connection",
  "content-length",
  "content-encoding",
  "keep-alive",
  "transfer-encoding",
  "set-cookie",
  INTERNAL_API_TOKEN_HEADER,
];

type ApiProxyContext = {
  params: Promise<{ path?: string[] }>;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function proxyDesktopApi(request: Request, context: ApiProxyContext) {
  const params = await context.params;
  const canonicalPath = canonicalDesktopProxyPath(params.path);
  if (!canonicalPath.allowed) {
    return jsonError(400, canonicalPath.reason, "The desktop API proxy path is invalid.");
  }
  if (isForbiddenWebProxyIngress(canonicalPath.path)) {
    return jsonError(404, "callback_proxy_disabled", "Design platform callbacks must use the dedicated API ingress.");
  }
  if (requiresDesktopSessionProof(request.method)) {
    const desktopSession = evaluateDesktopSessionProof(
      request.headers.get("cookie"),
      process.env.DESKTOP_WEB_SESSION_PROOF,
    );
    const localBrowser = evaluateLocalBrowserApiAccess(request.url, request.headers, {
      allowLocalBrowserWebApi: process.env.ALLOW_LOCAL_BROWSER_WEB_API,
      nodeEnv: process.env.NODE_ENV,
    });
    if (!desktopSession.allowed && !localBrowser.allowed) {
      return jsonError(403, desktopSession.reason, "A verified Electron desktop session is required.");
    }
  }
  const requestUrl = new URL(request.url);
  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const isReadinessHealth = method === "GET" && canonicalPath.path === "health";
  const upstreamTarget = resolveApiUpstreamTarget(canonicalPath.path, requestUrl.search, isReadinessHealth, method);
  if (!upstreamTarget.allowed) {
    return jsonError(upstreamTarget.status, upstreamTarget.code, upstreamTarget.message);
  }
  const headers = buildDesktopApiUpstreamHeaders(request.headers, upstreamTarget.token, INTERNAL_API_TOKEN_HEADER);
  if (hasBody && advertisedBodyExceedsLimit(request.headers.get("content-length"))) {
    return jsonError(413, "desktop_api_body_too_large", "The desktop API request body is too large.");
  }
  const desktopSessionProof = String(process.env.DESKTOP_WEB_SESSION_PROOF || "").trim();
  if (isReadinessHealth) headers.set(READINESS_CHALLENGE_HEADER, desktopSessionProof);

  try {
    const body = hasBody ? await request.arrayBuffer() : undefined;
    if (body && body.byteLength > MAX_DESKTOP_API_JSON_BODY_BYTES) {
      return jsonError(413, "desktop_api_body_too_large", "The desktop API request body is too large.");
    }
    // Reading the incoming body can close the client request and abort its signal even
    // though the body was received successfully. Reusing that signal cancels every
    // loopback POST before it reaches the API. Forward the buffered body independently.
    const upstreamBody = body && body.byteLength ? Buffer.from(body) : undefined;
    const upstream = await fetch(upstreamTarget.url, {
      method,
      headers,
      body: upstreamBody,
      cache: "no-store",
      redirect: "manual",
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const header of RESPONSE_HEADERS_TO_REMOVE) responseHeaders.delete(header);
    if (isReadinessHealth) {
      const responseBody = Buffer.from(await upstream.arrayBuffer());
      const boundBody = bindPackagedReadinessBody(responseBody, upstreamTarget.token, desktopSessionProof, upstream.ok);
      if (boundBody !== responseBody) responseHeaders.set("content-type", "application/json; charset=utf-8");
      return new Response(boundBody.toString("utf8"), {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }
    return new Response(method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return jsonError(
      502,
      upstreamTarget.mode === "cloud" ? "cloud_api_unavailable" : "desktop_api_unavailable",
      upstreamTarget.mode === "cloud" ? "The cloud desktop API is unavailable." : "The local desktop API is unavailable.",
    );
  }
}

type ApiUpstreamTarget = {
  allowed: true;
  mode: "local" | "cloud";
  token: string;
  url: URL;
} | {
  allowed: false;
  status: number;
  code: string;
  message: string;
};

function resolveApiUpstreamTarget(pathname: string, search: string, forceLocal: boolean, method: string): ApiUpstreamTarget {
  const cloud = forceLocal ? null : resolveCloudApiConfig();
  if (cloud?.error) {
    return {
      allowed: false,
      status: 503,
      code: cloud.error,
      message: cloud.message,
    };
  }
  const encodedPath = pathname.split("/").filter(Boolean).map((segment) => encodeURIComponent(segment)).join("/");
  if (cloud?.baseUrl && isCloudManagedAiProviderPath(method, pathname)) {
    const upstreamUrl = buildCloudApiUrl(cloud.baseUrl, encodedPath, search);
    return { allowed: true, mode: "cloud", token: cloud.token, url: upstreamUrl };
  }
  if (cloud?.baseUrl && isAiProviderPath(pathname)) {
    return {
      allowed: false,
      status: 403,
      code: "cloud_api_route_not_allowed",
      message: "This model-management API route is not available from the packaged cloud client.",
    };
  }
  const token = String(process.env.INTERNAL_API_TOKEN || "").trim();
  if (!INTERNAL_API_TOKEN_PATTERN.test(token)) {
    return {
      allowed: false,
      status: 503,
      code: "trusted_local_session_unavailable",
      message: "The trusted local desktop session is unavailable.",
    };
  }
  const apiPort = validPort(process.env.API_PORT, 3200);
  const upstreamUrl = new URL(`/api/${encodedPath}`, `http://127.0.0.1:${apiPort}`);
  upstreamUrl.search = search;
  return { allowed: true, mode: "local", token, url: upstreamUrl };
}

function isAiProviderPath(pathname: string) {
  return pathname.toLowerCase().startsWith("ai/providers/");
}

function isCloudManagedAiProviderPath(method: string, pathname: string) {
  const normalizedPath = pathname.toLowerCase();
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "GET" && normalizedPath === "ai/providers/status") return true;
  if (normalizedMethod === "POST" && normalizedPath === "ai/providers/status/probe") return true;
  if (normalizedMethod !== "POST") return false;
  return /^ai\/providers\/[^/]+\/(?:test|balance|models\/sync)$/.test(normalizedPath);
}

function resolveCloudApiConfig(): { baseUrl: URL; token: string; error?: never; message?: never } | {
  baseUrl?: never;
  token?: never;
  error: string;
  message: string;
} | null {
  const rawBaseUrl = String(process.env[CLOUD_API_BASE_URL_ENV] || "").trim();
  if (!rawBaseUrl) return null;
  const token = String(process.env[CLOUD_API_TOKEN_ENV] || "").trim();
  if (!INTERNAL_API_TOKEN_PATTERN.test(token)) {
    return {
      error: "cloud_api_session_unavailable",
      message: "The cloud desktop API session is unavailable.",
    };
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    return { error: "cloud_api_base_url_invalid", message: "The cloud desktop API base URL is invalid." };
  }
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    return { error: "cloud_api_base_url_invalid", message: "The cloud desktop API base URL is invalid." };
  }
  return { baseUrl, token };
}

function buildCloudApiUrl(baseUrl: URL, encodedPath: string, search: string) {
  const upstreamUrl = new URL(baseUrl.href);
  const basePath = upstreamUrl.pathname.replace(/\/+$/, "");
  const apiRoot = basePath === "/api" || basePath.endsWith("/api") ? basePath : `${basePath}/api`;
  upstreamUrl.pathname = `${apiRoot || "/api"}/${encodedPath}`.replace(/\/{2,}/g, "/");
  upstreamUrl.search = search;
  return upstreamUrl;
}

function advertisedBodyExceedsLimit(value: string | null) {
  if (!value) return false;
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes >= 0 && bytes > MAX_DESKTOP_API_JSON_BODY_BYTES;
}

function bindPackagedReadinessBody(body: Buffer, internalSecret: string, desktopSessionProof: string, upstreamOk: boolean) {
  if (!upstreamOk) return body;
  try {
    const payload = JSON.parse(body.toString("utf8"));
    const apiProof = payload?.[API_READINESS_PROOF_FIELD];
    if (!verifyApiReadinessProof(internalSecret, desktopSessionProof, apiProof)) return body;
    const webProof = createWebReadinessProof(internalSecret, desktopSessionProof, apiProof);
    if (!webProof) return body;
    return Buffer.from(JSON.stringify({ ...payload, [WEB_READINESS_PROOF_FIELD]: webProof }), "utf8");
  } catch {
    return body;
  }
}

function validPort(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
}

function jsonError(status: number, code: string, message: string) {
  const error =
    status === 503
      ? "Service Unavailable"
      : status === 413
        ? "Payload Too Large"
        : status === 403
          ? "Forbidden"
          : status === 404
            ? "Not Found"
            : status === 400
              ? "Bad Request"
              : "Bad Gateway";
  return Response.json({ statusCode: status, error, code, message }, { status });
}

export const GET = proxyDesktopApi;
export const HEAD = proxyDesktopApi;
export const OPTIONS = proxyDesktopApi;
export const POST = proxyDesktopApi;
export const PUT = proxyDesktopApi;
export const PATCH = proxyDesktopApi;
export const DELETE = proxyDesktopApi;
