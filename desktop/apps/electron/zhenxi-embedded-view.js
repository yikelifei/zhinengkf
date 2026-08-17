"use strict";

const crypto = require("node:crypto");
const os = require("node:os");

const ZHENXI_REMOTE_ORIGINS = new Set([
  "https://app.zhenxiai.cloud",
  "https://zhenxiai.cloud",
  "https://www.zhenxiai.cloud",
]);
const ZHENXI_DESKTOP_VIEWPORT_WIDTH = 1440;
const ZHENXI_MINIMUM_ZOOM_FACTOR = 0.5;

function normalizeZhenxiEmbeddedUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.username || parsed.password) return "";

  if (parsed.protocol === "https:" && ZHENXI_REMOTE_ORIGINS.has(parsed.origin)) {
    return parsed.href;
  }
  if (parsed.protocol !== "http:" || !isLoopbackHostname(parsed.hostname)) return "";
  const port = Number(parsed.port || 80);
  if (port !== 3000 && (port < 31870 || port > 31879)) return "";
  return parsed.href;
}

function normalizeZhenxiEmbeddedBounds(value) {
  if (!value || typeof value !== "object") return null;
  const x = boundedInteger(value.x, 0, 16_000);
  const y = boundedInteger(value.y, 0, 16_000);
  const width = boundedInteger(value.width, 1, 16_000);
  const height = boundedInteger(value.height, 1, 16_000);
  if ([x, y, width, height].some((item) => item === null)) return null;
  return { x, y, width, height };
}

function createZhenxiDesktopDeviceInfo(values = {}) {
  const platform = String(values.platform || process.platform);
  const arch = String(values.arch || process.arch);
  const hostname = safeValue(values.hostname, () => os.hostname(), "unknown-host");
  const username = safeValue(values.username, () => os.userInfo().username, "unknown-user");
  const home = safeValue(values.home, () => os.homedir(), "unknown-home");
  const seed = ["art-image-studio-device-v1", platform, arch, hostname, username, home].join("|");
  const digest = crypto.createHash("sha256").update(seed).digest("hex");
  return {
    id: `desktop-${digest.slice(0, 32)}`,
    label: `${hostname} / ${platform}`,
  };
}

function resolveZhenxiDesktopLayout(value) {
  const bounds = normalizeZhenxiEmbeddedBounds(value);
  if (!bounds) return null;
  const zoomFactor = Math.max(
    ZHENXI_MINIMUM_ZOOM_FACTOR,
    Math.min(1, bounds.width / ZHENXI_DESKTOP_VIEWPORT_WIDTH),
  );
  return {
    bounds,
    zoomFactor,
    logicalViewportWidth: Math.round(bounds.width / zoomFactor),
  };
}

function isLoopbackHostname(value) {
  const hostname = String(value || "").trim().toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = Math.round(number);
  if (normalized < minimum || normalized > maximum) return null;
  return normalized;
}

function safeValue(explicit, read, fallback) {
  if (explicit !== undefined && explicit !== null && String(explicit)) return String(explicit);
  try {
    return String(read() || fallback);
  } catch {
    return fallback;
  }
}

module.exports = {
  createZhenxiDesktopDeviceInfo,
  normalizeZhenxiEmbeddedBounds,
  normalizeZhenxiEmbeddedUrl,
  resolveZhenxiDesktopLayout,
};
