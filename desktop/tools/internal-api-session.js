"use strict";

const { randomBytes } = require("node:crypto");

const INTERNAL_API_TOKEN_ENV = "INTERNAL_API_TOKEN";
const INTERNAL_API_TOKEN_HEADER = "x-internal-api-token";
const INTERNAL_API_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const INTERNAL_API_SERVICE_NAMES = new Set(["api", "web"]);

function isValidInternalApiToken(value) {
  return INTERNAL_API_TOKEN_PATTERN.test(String(value || "").trim());
}

function ensureInternalApiToken(value = process.env[INTERNAL_API_TOKEN_ENV]) {
  const existing = String(value || "").trim();
  if (isValidInternalApiToken(existing)) return existing;
  return randomBytes(32).toString("hex");
}

function withoutInternalApiToken(env = {}) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.toUpperCase() === INTERNAL_API_TOKEN_ENV) delete next[key];
  }
  return next;
}

function internalApiServiceEnv(env, serviceName, token) {
  const next = withoutInternalApiToken(env);
  if (INTERNAL_API_SERVICE_NAMES.has(String(serviceName || "").toLowerCase())) {
    next[INTERNAL_API_TOKEN_ENV] = token;
  }
  return next;
}

module.exports = {
  INTERNAL_API_TOKEN_ENV,
  INTERNAL_API_TOKEN_HEADER,
  ensureInternalApiToken,
  internalApiServiceEnv,
  isValidInternalApiToken,
  withoutInternalApiToken,
};
