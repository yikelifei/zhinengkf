import "server-only";

import {
  buildDesktopApiUpstreamHeaders,
  canonicalDesktopProxyPath,
  evaluateDesktopSessionProof,
  isForbiddenWebProxyIngress,
  requiresDesktopSessionProof,
} from "../../../lib/desktop-session-proof";

const INTERNAL_API_TOKEN_HEADER = "x-internal-api-token";
const INTERNAL_API_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
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
    if (!desktopSession.allowed) {
      return jsonError(403, desktopSession.reason, "A verified Electron desktop session is required.");
    }
  }
  const token = String(process.env.INTERNAL_API_TOKEN || "").trim();
  if (!INTERNAL_API_TOKEN_PATTERN.test(token)) {
    return jsonError(503, "trusted_local_session_unavailable", "The trusted local desktop session is unavailable.");
  }
  const path = canonicalPath.path.split("/").filter(Boolean).map((segment) => encodeURIComponent(segment)).join("/");
  const requestUrl = new URL(request.url);
  const apiPort = validPort(process.env.API_PORT, 3200);
  const upstreamUrl = new URL(`/api/${path}`, `http://127.0.0.1:${apiPort}`);
  upstreamUrl.search = requestUrl.search;

  const headers = buildDesktopApiUpstreamHeaders(request.headers, token, INTERNAL_API_TOKEN_HEADER);

  try {
    const method = request.method.toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
    const upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body: body && body.byteLength ? body : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const header of RESPONSE_HEADERS_TO_REMOVE) responseHeaders.delete(header);
    return new Response(method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return jsonError(502, "desktop_api_unavailable", "The local desktop API is unavailable.");
  }
}

function validPort(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
}

function jsonError(status: number, code: string, message: string) {
  const error = status === 503 ? "Service Unavailable" : status === 403 ? "Forbidden" : status === 404 ? "Not Found" : status === 400 ? "Bad Request" : "Bad Gateway";
  return Response.json({ statusCode: status, error, code, message }, { status });
}

export const GET = proxyDesktopApi;
export const HEAD = proxyDesktopApi;
export const OPTIONS = proxyDesktopApi;
export const POST = proxyDesktopApi;
export const PUT = proxyDesktopApi;
export const PATCH = proxyDesktopApi;
export const DELETE = proxyDesktopApi;
