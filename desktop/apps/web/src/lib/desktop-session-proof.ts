import { timingSafeEqual } from "node:crypto";

const packagedReadinessProof = require("../../../../packages/runtime/packaged-readiness-proof");

export const DESKTOP_SESSION_COOKIE = "smart_kefu_desktop_session";
export const DESKTOP_SESSION_PROOF_PATTERN = /^[a-f0-9]{64}$/i;
export const API_READINESS_PROOF_FIELD: string = packagedReadinessProof.API_READINESS_PROOF_FIELD;
export const READINESS_CHALLENGE_HEADER: string = packagedReadinessProof.READINESS_CHALLENGE_HEADER;
export const WEB_READINESS_PROOF_FIELD: string = packagedReadinessProof.WEB_READINESS_PROOF_FIELD;
export const createWebReadinessProof: (token: unknown, challenge: unknown, apiProof: unknown) => string =
  packagedReadinessProof.createWebReadinessProof;
export const verifyApiReadinessProof: (token: unknown, challenge: unknown, proof: unknown) => boolean =
  packagedReadinessProof.verifyApiReadinessProof;

const REQUEST_HEADERS_TO_REMOVE = [
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

export function evaluateDesktopSessionProof(cookieHeader: string | null, expectedProof: unknown) {
  const expected = String(expectedProof || "").trim();
  if (!DESKTOP_SESSION_PROOF_PATTERN.test(expected)) {
    return { allowed: false, reason: "desktop_session_unavailable" } as const;
  }
  const provided = desktopSessionCookieValues(cookieHeader);
  if (provided.length !== 1 || !DESKTOP_SESSION_PROOF_PATTERN.test(provided[0])) {
    return { allowed: false, reason: "desktop_session_proof_missing" } as const;
  }
  const actualBuffer = Buffer.from(provided[0], "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
    ? ({ allowed: true, reason: "verified_electron_session" } as const)
    : ({ allowed: false, reason: "desktop_session_proof_invalid" } as const);
}

export function isForbiddenWebProxyIngress(path: string) {
  const normalized = String(path || "").replace(/^\/+|\/+$/g, "").toLowerCase();
  return normalized === "integrations/design-platform/callback";
}

export function requiresDesktopSessionProof(method: string) {
  void method;
  return true;
}

export function evaluateLocalBrowserApiAccess(
  requestUrl: string,
  requestHeaders: Headers,
  options: { allowLocalBrowserWebApi?: unknown; nodeEnv?: unknown },
) {
  if (!localBrowserApiAccessEnabled(options)) {
    return { allowed: false, reason: "local_browser_api_disabled" } as const;
  }
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { allowed: false, reason: "local_browser_api_invalid_url" } as const;
  }
  if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) {
    return { allowed: false, reason: "local_browser_api_url_not_allowed" } as const;
  }
  const host = requestHeaders.get("host");
  if (host && !isLoopbackHostHeader(host)) {
    return { allowed: false, reason: "local_browser_api_host_not_allowed" } as const;
  }
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  if (forwardedHost && !isLoopbackHostHeader(forwardedHost)) {
    return { allowed: false, reason: "local_browser_api_forwarded_host_not_allowed" } as const;
  }
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  if (forwardedFor && !forwardedFor.split(",").every((value) => isLoopbackHostname(value.trim()))) {
    return { allowed: false, reason: "local_browser_api_forwarded_for_not_allowed" } as const;
  }
  const origin = requestHeaders.get("origin");
  if (origin && !isAllowedLocalBrowserOrigin(origin, url.port)) {
    return { allowed: false, reason: "local_browser_api_origin_not_allowed" } as const;
  }
  return { allowed: true, reason: "local_browser_api_allowed" } as const;
}

export function canonicalDesktopProxyPath(segments: unknown) {
  if (!Array.isArray(segments)) return { allowed: true, path: "" } as const;
  const canonical: string[] = [];
  for (const value of segments) {
    const segment = String(value || "");
    let decoded = segment;
    try {
      for (let depth = 0; depth < 3 && /%[0-9a-f]{2}/i.test(decoded); depth += 1) {
        decoded = decodeURIComponent(decoded);
      }
    } catch {
      return { allowed: false, path: "", reason: "invalid_path_encoding" } as const;
    }
    if (!decoded || decoded === "." || decoded === ".." || /[\\/\0]/.test(decoded)) {
      return { allowed: false, path: "", reason: "unsafe_proxy_path" } as const;
    }
    canonical.push(decoded);
  }
  return { allowed: true, path: canonical.join("/") } as const;
}

export function buildDesktopApiUpstreamHeaders(
  requestHeaders: Headers,
  internalApiToken: string,
  internalApiTokenHeader = "x-internal-api-token",
) {
  const headers = new Headers(requestHeaders);
  for (const header of REQUEST_HEADERS_TO_REMOVE) headers.delete(header);
  // The API has no browser cookie authentication. Never forward the Electron-only proof or any ambient cookie.
  headers.delete("cookie");
  headers.delete(internalApiTokenHeader);
  headers.delete(READINESS_CHALLENGE_HEADER);
  headers.set(internalApiTokenHeader, internalApiToken);
  return headers;
}

function desktopSessionCookieValues(cookieHeader: string | null) {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 0 || part.slice(0, separator).trim() !== DESKTOP_SESSION_COOKIE) return [];
      return [part.slice(separator + 1).trim()];
    });
}

function localBrowserApiAccessEnabled(options: { allowLocalBrowserWebApi?: unknown; nodeEnv?: unknown }) {
  const explicit = String(options.allowLocalBrowserWebApi || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(explicit)) return true;
  if (["0", "false", "no", "off"].includes(explicit)) return false;
  return String(options.nodeEnv || "").trim().toLowerCase() === "development";
}

function isAllowedLocalBrowserOrigin(origin: string, requestPort: string) {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) return false;
  return !requestPort || !url.port || url.port === requestPort;
}

function isLoopbackHostHeader(value: string) {
  return isLoopbackHostname(hostHeaderHostname(value));
}

function hostHeaderHostname(value: string) {
  const host = String(value || "").trim();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 0 ? host.slice(1, end) : host;
  }
  return host.split(":")[0] || host;
}

function isLoopbackHostname(value: string) {
  const hostname = String(value || "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
