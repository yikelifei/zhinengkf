"use strict";

const crypto = require("node:crypto");

const HEX_64_PATTERN = /^[a-f0-9]{64}$/i;
const READINESS_CHALLENGE_HEADER = "x-smart-kefu-readiness-challenge";
const API_READINESS_PROOF_FIELD = "apiReadinessProof";
const WEB_READINESS_PROOF_FIELD = "webReadinessProof";

function createApiReadinessProof(internalApiToken, challenge) {
  return createProof("smart-kefu-api-readiness-v1", internalApiToken, [challenge]);
}

function createWebReadinessProof(internalApiToken, challenge, apiProof) {
  if (!normalizedHex(apiProof)) return "";
  return createProof("smart-kefu-web-readiness-v1", internalApiToken, [challenge, apiProof]);
}

function verifyApiReadinessProof(internalApiToken, challenge, providedProof) {
  return proofMatches(createApiReadinessProof(internalApiToken, challenge), providedProof);
}

function verifyWebReadinessProof(internalApiToken, challenge, apiProof, providedProof) {
  return proofMatches(createWebReadinessProof(internalApiToken, challenge, apiProof), providedProof);
}

function createProof(domain, internalApiToken, values) {
  const token = normalizedHex(internalApiToken);
  const normalizedValues = values.map(normalizedHex);
  if (!token || normalizedValues.some((value) => !value)) return "";
  const hmac = crypto.createHmac("sha256", Buffer.from(token, "hex"));
  hmac.update(domain, "utf8");
  for (const value of normalizedValues) {
    hmac.update("\0", "utf8");
    hmac.update(value, "utf8");
  }
  return hmac.digest("hex");
}

function normalizedHex(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return HEX_64_PATTERN.test(normalized) ? normalized : "";
}

function proofMatches(expected, provided) {
  const actual = normalizedHex(provided);
  if (!expected || !actual) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

module.exports = {
  API_READINESS_PROOF_FIELD,
  HEX_64_PATTERN,
  READINESS_CHALLENGE_HEADER,
  WEB_READINESS_PROOF_FIELD,
  createApiReadinessProof,
  createWebReadinessProof,
  verifyApiReadinessProof,
  verifyWebReadinessProof,
};
