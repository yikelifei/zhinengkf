"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ZHENXI_ACCESS_COOKIE = "art_access_token";
const ZHENXI_REFRESH_COOKIE = "art_refresh_token";
const DEFAULT_MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACCESS_TOKEN_LENGTH = 16_384;

function resolveZhenxiSharedSessionFiles(options = {}) {
  const configured = String(options.sessionFile || process.env.ZHENXI_SHARED_SESSION_FILE || "").trim();
  const appData = String(options.appData || process.env.APPDATA || "").trim();
  if (configured) return [path.resolve(configured)];
  const candidates = [
    appData ? path.join(path.resolve(appData), "zhenxi-ai", "workspace-data", "external-active-user.json") : "",
    appData ? path.join(path.resolve(appData), "lingtu-ai", "workspace-data", "external-active-user.json") : "",
  ];
  return candidates.filter((value, index, all) => value && all.indexOf(value) === index);
}

function readZhenxiSharedSession(options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
    ? Math.max(1, Number(options.maxAgeMs))
    : DEFAULT_MAX_SESSION_AGE_MS;

  for (const sessionFile of resolveZhenxiSharedSessionFiles(options)) {
    try {
      const stat = fs.lstatSync(sessionFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 64 * 1024) continue;
      const record = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
      const accessToken = normalizeAccessToken(record?.accessToken);
      const userId = normalizeIdentifier(record?.userId, 200);
      const deviceId = normalizeIdentifier(record?.deviceId, 200);
      const updatedAtMs = Date.parse(String(record?.updatedAt || ""));
      if (!accessToken || !userId || !Number.isFinite(updatedAtMs)) continue;
      if (updatedAtMs > now + 5 * 60 * 1000 || now - updatedAtMs > maxAgeMs) continue;
      return {
        authenticated: true,
        accessToken,
        deviceId,
        updatedAt: new Date(updatedAtMs).toISOString(),
        sessionFile,
      };
    } catch {}
  }

  return {
    authenticated: false,
    accessToken: "",
    deviceId: "",
    updatedAt: "",
    sessionFile: "",
  };
}

function publicZhenxiSharedSessionStatus(sessionRecord, options = {}) {
  const record = sessionRecord && typeof sessionRecord === "object" ? sessionRecord : {};
  return {
    checked: true,
    authenticated: record.authenticated === true && Boolean(record.accessToken),
    source: options.source || "external-zhenxi-desktop",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    deviceIdSuffix: typeof record.deviceId === "string" && record.deviceId
      ? record.deviceId.slice(-10)
      : "",
    errorMessage: record.authenticated === true && record.accessToken
      ? ""
      : "请先在外部臻希 AI 软件完成登录。",
  };
}

function applyZhenxiSharedSessionRequestHeaders(headers, sessionRecord) {
  const next = { ...(headers || {}) };
  removeHeader(next, "authorization");
  const cookieKey = findHeaderKey(next, "cookie");
  if (cookieKey) {
    const stripped = stripZhenxiAuthCookies(next[cookieKey]);
    if (stripped) next[cookieKey] = stripped;
    else delete next[cookieKey];
  }

  const record = sessionRecord && typeof sessionRecord === "object" ? sessionRecord : {};
  const accessToken = normalizeAccessToken(record.accessToken);
  if (record.authenticated === true && accessToken) next.Authorization = `Bearer ${accessToken}`;
  const deviceId = normalizeIdentifier(record.deviceId, 200);
  if (deviceId) next["x-art-device-id"] = deviceId;
  return next;
}

function stripZhenxiAuthCookies(value) {
  const serialized = Array.isArray(value) ? value.join("; ") : String(value || "");
  return serialized
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const name = item.split("=", 1)[0]?.trim().toLowerCase();
      return name !== ZHENXI_ACCESS_COOKIE && name !== ZHENXI_REFRESH_COOKIE;
    })
    .join("; ");
}

function isZhenxiSessionMutationUrl(value) {
  try {
    const pathname = new URL(String(value || "")).pathname.replace(/\/+$/, "");
    return new Set([
      "/api/auth/login",
      "/api/auth/signup",
      "/api/auth/exchange",
      "/api/auth/refresh",
      "/api/auth/logout",
    ]).has(pathname);
  } catch {
    return false;
  }
}

function normalizeAccessToken(value) {
  const token = String(value || "").trim();
  if (!token || token.length > MAX_ACCESS_TOKEN_LENGTH || /\s/.test(token)) return "";
  return /^[A-Za-z0-9._~-]+$/.test(token) ? token : "";
}

function normalizeIdentifier(value, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) return "";
  return normalized;
}

function findHeaderKey(headers, name) {
  const expected = String(name || "").toLowerCase();
  return Object.keys(headers || {}).find((key) => key.toLowerCase() === expected) || "";
}

function removeHeader(headers, name) {
  const key = findHeaderKey(headers, name);
  if (key) delete headers[key];
}

module.exports = {
  ZHENXI_ACCESS_COOKIE,
  ZHENXI_REFRESH_COOKIE,
  applyZhenxiSharedSessionRequestHeaders,
  isZhenxiSessionMutationUrl,
  publicZhenxiSharedSessionStatus,
  readZhenxiSharedSession,
  resolveZhenxiSharedSessionFiles,
  stripZhenxiAuthCookies,
};
