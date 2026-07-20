"use strict";

const { createHash, createHmac, randomBytes, timingSafeEqual } = require("node:crypto");

const WECHAT_WINDOW_OBSERVER_SOURCE = "windows_foreground_observer";
const WECHAT_WINDOW_OBSERVER_EVIDENCE_VERSION = "wechat_window_observer_v1";
const WECHAT_WINDOW_OBSERVER_ATTESTATION_VERSION = "wechat_window_observer_attestation_v1";
const NONCE_PATTERN = /^[a-f0-9]{32,128}$/i;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i;

function createWechatWindowObserverEvidence(snapshot, token, options = {}) {
  assertObserverToken(token);
  const issuedAt = requiredIsoDate(options.issuedAt || snapshot?.capturedAt || new Date().toISOString(), "issuedAt");
  const nonce = String(options.nonce || randomBytes(24).toString("hex")).trim();
  if (!NONCE_PATTERN.test(nonce)) throw new Error("observer evidence nonce is invalid");
  const normalizedSnapshot = canonicalObserverSnapshot({ ...snapshot, capturedAt: snapshot?.capturedAt || issuedAt });
  const signed = {
    version: WECHAT_WINDOW_OBSERVER_EVIDENCE_VERSION,
    nonce,
    issuedAt,
    snapshot: normalizedSnapshot,
  };
  return {
    ...signed,
    signature: createHmac("sha256", token).update(JSON.stringify(signed)).digest("hex"),
  };
}

function verifyWechatWindowObserverEvidence(envelope, token, options = {}) {
  try {
    assertObserverToken(token);
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return failure("invalid_envelope");
    if (envelope.version !== WECHAT_WINDOW_OBSERVER_EVIDENCE_VERSION) return failure("unsupported_version");
    const nonce = String(envelope.nonce || "").trim();
    const signature = String(envelope.signature || "").trim();
    if (!NONCE_PATTERN.test(nonce)) return failure("invalid_nonce");
    if (!SIGNATURE_PATTERN.test(signature)) return failure("invalid_signature");
    const issuedAt = requiredIsoDate(envelope.issuedAt, "issuedAt");
    const snapshot = canonicalObserverSnapshot(envelope.snapshot);
    const signed = { version: WECHAT_WINDOW_OBSERVER_EVIDENCE_VERSION, nonce, issuedAt, snapshot };
    const expected = createHmac("sha256", token).update(JSON.stringify(signed)).digest();
    const supplied = Buffer.from(signature, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return failure("signature_mismatch");

    const nowMs = dateMs(options.now || new Date());
    const issuedAtMs = dateMs(issuedAt);
    const capturedAtMs = dateMs(snapshot.capturedAt);
    const maxAgeMs = positiveNumber(options.maxAgeSeconds, 30) * 1000;
    const maxFutureSkewMs = positiveNumber(options.maxFutureSkewSeconds, 5) * 1000;
    if (!Number.isFinite(nowMs)) return failure("invalid_server_time");
    if (issuedAtMs > nowMs + maxFutureSkewMs || capturedAtMs > nowMs + maxFutureSkewMs) return failure("future_timestamp");
    if (nowMs - issuedAtMs > maxAgeMs || nowMs - capturedAtMs > maxAgeMs) return failure("expired_evidence");
    if (Math.abs(issuedAtMs - capturedAtMs) > maxFutureSkewMs) return failure("timestamp_mismatch");

    return {
      ok: true,
      snapshot,
      evidence: {
        version: WECHAT_WINDOW_OBSERVER_EVIDENCE_VERSION,
        issuedAt,
        nonceHash: createHash("sha256").update(nonce).digest("hex"),
      },
    };
  } catch {
    return failure("invalid_evidence");
  }
}

function createWechatWindowObserverAttestation(snapshot, evidence, token) {
  assertObserverToken(token);
  const payload = canonicalObserverAttestation(snapshot, evidence);
  return {
    ...payload.evidence,
    verified: true,
    attestationVersion: WECHAT_WINDOW_OBSERVER_ATTESTATION_VERSION,
    attestation: createHmac("sha256", token).update(JSON.stringify(payload)).digest("hex"),
  };
}

function isTrustedWechatWindowObserverSnapshot(snapshot, token) {
  const evidence = snapshot?.diagnostic?.observerEvidence;
  if (
    snapshot?.source !== WECHAT_WINDOW_OBSERVER_SOURCE ||
    evidence?.verified !== true ||
    evidence?.version !== WECHAT_WINDOW_OBSERVER_EVIDENCE_VERSION ||
    evidence?.attestationVersion !== WECHAT_WINDOW_OBSERVER_ATTESTATION_VERSION ||
    !SIGNATURE_PATTERN.test(String(evidence?.nonceHash || "")) ||
    !SIGNATURE_PATTERN.test(String(evidence?.attestation || ""))
  ) {
    return false;
  }
  try {
    assertObserverToken(token);
    const payload = canonicalObserverAttestation(snapshot, evidence);
    const expected = createHmac("sha256", token).update(JSON.stringify(payload)).digest();
    const supplied = Buffer.from(String(evidence.attestation), "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}

function canonicalObserverAttestation(snapshot, evidence = {}) {
  const version = String(evidence.version || "").trim();
  const issuedAt = requiredIsoDate(evidence.issuedAt, "observer evidence issuedAt");
  const nonceHash = String(evidence.nonceHash || "").trim();
  if (version !== WECHAT_WINDOW_OBSERVER_EVIDENCE_VERSION) throw new Error("observer evidence version is invalid");
  if (!SIGNATURE_PATTERN.test(nonceHash)) throw new Error("observer evidence nonce hash is invalid");
  return {
    attestationVersion: WECHAT_WINDOW_OBSERVER_ATTESTATION_VERSION,
    evidence: { version, issuedAt, nonceHash },
    snapshot: canonicalObserverSnapshot(snapshot),
  };
}

function canonicalObserverSnapshot(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("observer snapshot must be an object");
  const capturedAt = requiredIsoDate(input.capturedAt, "capturedAt");
  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("observer confidence is invalid");
  const processId = Number(input.processId);
  return {
    source: WECHAT_WINDOW_OBSERVER_SOURCE,
    isOnline: input.isOnline === true,
    wechatAccountId: cleanText(input.wechatAccountId),
    accountDisplayName: cleanText(input.accountDisplayName),
    windowHandle: cleanText(input.windowHandle),
    processId: Number.isInteger(processId) && processId > 0 ? processId : null,
    chatTitle: cleanText(input.chatTitle || input.activeChatTitle),
    activeChatTitle: cleanText(input.activeChatTitle || input.chatTitle),
    externalChatId: cleanText(input.externalChatId),
    recentCustomerId: cleanText(input.recentCustomerId),
    recentMessageText: cleanText(input.recentMessageText),
    confidence,
    capturedAt,
    raw: input.raw && typeof input.raw === "object" && !Array.isArray(input.raw) ? canonicalJsonObject(input.raw) : null,
  };
}

function canonicalJsonObject(value) {
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const canonical = canonicalJsonValue(value[key]);
    if (canonical !== undefined) result[key] = canonical;
  }
  return result;
}

function canonicalJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => canonicalJsonValue(item) ?? null);
  if (value && typeof value === "object") return canonicalJsonObject(value);
  return undefined;
}

function assertObserverToken(token) {
  if (!/^[a-f0-9]{64}$/i.test(String(token || "").trim())) throw new Error("observer proof token is unavailable");
}

function requiredIsoDate(value, label) {
  const text = String(value || "").trim();
  const time = new Date(text);
  if (!text || Number.isNaN(time.getTime())) throw new Error(`${label} is invalid`);
  return time.toISOString();
}

function dateMs(value) {
  return value instanceof Date ? value.getTime() : new Date(String(value || "")).getTime();
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function failure(reason) {
  return { ok: false, reason };
}

module.exports = {
  WECHAT_WINDOW_OBSERVER_ATTESTATION_VERSION,
  WECHAT_WINDOW_OBSERVER_EVIDENCE_VERSION,
  WECHAT_WINDOW_OBSERVER_SOURCE,
  canonicalObserverSnapshot,
  createWechatWindowObserverAttestation,
  createWechatWindowObserverEvidence,
  isTrustedWechatWindowObserverSnapshot,
  verifyWechatWindowObserverEvidence,
};
