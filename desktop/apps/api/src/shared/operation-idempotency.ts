import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";

const OPERATION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*[A-Za-z0-9]$/;
const INBOUND_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const INBOUND_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MIME_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;
const EMBEDDED_ENDPOINT_OR_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\[^\\\s]|(?:^|[^:])\/\/|\b(?:file|https?|wss?|tcp):\/\/)/i;
const EMBEDDED_CREDENTIAL_PATTERN = /(?:^|[^A-Za-z0-9_])(?:access[_-]?token|token|password|passwd|secret)\s*[:=]/i;

export const OPERATION_KEY_MIN_LENGTH = 16;
export const OPERATION_KEY_MAX_LENGTH = 128;

export type RequestOperationMetadata = {
  key: string;
  fingerprint: string;
};

export class InboundLeaseLostError extends ConflictException {
  constructor(message = "inbound operation lease is no longer owned by this claim") {
    super({ code: "INBOUND_LEASE_LOST", message });
    this.name = "InboundLeaseLostError";
  }
}

const INBOUND_OPERATION_STAGE_ORDER = [
  "reserved",
  "binding_ready",
  "message_persisted",
  "routed",
  "effects_committed",
  "completed",
] as const;

export function normalizeOperationKey(value: unknown, label = "operationKey") {
  if (typeof value !== "string") {
    throw new BadRequestException(`${label} is required`);
  }
  if (value !== value.trim()) {
    throw new BadRequestException(`${label} must not contain leading or trailing whitespace`);
  }
  if (value.length < OPERATION_KEY_MIN_LENGTH || value.length > OPERATION_KEY_MAX_LENGTH) {
    throw new BadRequestException(
      `${label} length must be between ${OPERATION_KEY_MIN_LENGTH} and ${OPERATION_KEY_MAX_LENGTH} characters`,
    );
  }
  if (!OPERATION_KEY_PATTERN.test(value)) {
    throw new BadRequestException(`${label} may only contain letters, numbers, dot, underscore, colon and hyphen`);
  }
  return value;
}

export function createOperationFingerprint(scope: string, identity: unknown, payload: unknown) {
  return createHash("sha256")
    .update(stableSerialize({ scope, identity, payload }))
    .digest("hex");
}

export function createChatImportOperationFingerprint(payload: Record<string, unknown>, identity: Record<string, unknown>) {
  return createOperationFingerprint(
    "chat-import-create",
    {
      customerId: identity.customerId || null,
      conversationId: identity.conversationId || null,
      wechatAccountId: identity.wechatAccountId || null,
    },
    {
      name: normalizedOptionalString(payload.name),
      source: normalizedOptionalString(payload.source) || "manual_text",
      channel: normalizedOptionalString(payload.channel) || "wechat",
      agentId: normalizedOptionalString(payload.agentId),
      text: String(payload.text || "").replace(/\r\n?/g, "\n").trim(),
    },
  );
}

export function createSendTaskOperationFingerprint(
  payload: Record<string, unknown>,
  identity: Record<string, unknown>,
) {
  const guard = payload.guardSnapshot && typeof payload.guardSnapshot === "object"
    ? payload.guardSnapshot as Record<string, unknown>
    : {};
  return createOperationFingerprint(
    "wechat-send-task-create",
    {
      customerId: normalizedOptionalString(identity.customerId),
      conversationId: normalizedOptionalString(identity.conversationId),
      wechatAccountId: normalizedOptionalString(identity.wechatAccountId),
    },
    {
      designJobId: normalizedOptionalString(payload.designJobId),
      quoteDraftId: normalizedOptionalString(payload.quoteDraftId),
      payload: payload.payload || {},
      guard: {
        source: guard.source,
        reason: guard.reason,
        orderContext: guard.orderContext,
        automation: guard.automation,
        manualReply: guard.manualReply,
        queuedBy: guard.queuedBy,
        policy: guard.policy,
        requiredChecks: guard.requiredChecks,
      },
    },
  );
}

export function createInboundMessageOperationFingerprint(
  payload: Record<string, unknown>,
  identity: Record<string, unknown>,
) {
  const metadata = payload.metadata && typeof payload.metadata === "object"
    ? payload.metadata as Record<string, unknown>
    : {};
  return createOperationFingerprint(
    "wechat-inbound-message-create",
    {
      customerId: normalizedOptionalString(identity.customerId),
      conversationId: normalizedOptionalString(identity.conversationId),
      wechatAccountId: normalizedOptionalString(identity.wechatAccountId),
    },
    {
      direction: normalizedOptionalString(payload.direction) || "inbound",
      text: String(payload.text || "").replace(/\r\n?/g, "\n"),
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      assetIds: Array.isArray(payload.assetIds)
        ? payload.assetIds
        : Array.isArray(metadata.assetIds)
          ? metadata.assetIds
          : [],
    },
  );
}

export function sanitizeInboundOperationAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];
  const allowedKeys = [
    "assetId",
    "imageId",
    "referencedImageId",
    "referenceImageId",
    "quotedImageId",
    "quoteImageId",
    "attachmentImageId",
    "remoteImageId",
    "screenshotFingerprint",
    "imageFingerprint",
    "attachmentFingerprint",
    "fingerprint",
    "role",
    "type",
    "kind",
    "mimeType",
  ];
  return value.slice(0, 50).flatMap((item) => {
    if (typeof item === "string") {
      const assetId = sanitizeInboundBusinessIdentifier(item, 256);
      return assetId ? [{ assetId }] : [];
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const source = item as Record<string, unknown>;
    const sanitized = Object.fromEntries(allowedKeys.flatMap((key) => {
      if (typeof source[key] !== "string" || !String(source[key]).trim()) return [];
      const safeValue = key === "mimeType"
        ? sanitizeInboundMimeType(source[key])
        : key === "role" || key === "type" || key === "kind"
          ? sanitizeInboundLabel(source[key], 64)
          : sanitizeInboundBusinessIdentifier(source[key], 512);
      return safeValue ? [[key, safeValue] as [string, string]] : [];
    }));
    return Object.keys(sanitized).length ? [sanitized] : [];
  });
}

export function sanitizeInboundOperationAssetIds(value: unknown, options: { rejectInvalid?: boolean } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    if (options.rejectInvalid) throw new BadRequestException("assetIds must be an array of safe business identifiers");
    return [];
  }
  const sanitized: string[] = [];
  for (const item of value.slice(0, 100)) {
    if (typeof item !== "string") {
      if (options.rejectInvalid) throw new BadRequestException("assetIds must contain only strings");
      continue;
    }
    const assetId = sanitizeInboundBusinessIdentifier(item, 256);
    if (!assetId) {
      if (options.rejectInvalid) {
        throw new BadRequestException("assetIds must not contain credentials, endpoints, file URIs, absolute paths or control characters");
      }
      continue;
    }
    sanitized.push(assetId);
  }
  return [...new Set(sanitized)];
}

function sanitizeInboundBusinessIdentifier(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) return "";
  if (/[\u0000-\u001f\u007f]/.test(text)) return "";
  if (EMBEDDED_ENDPOINT_OR_PATH_PATTERN.test(text) || EMBEDDED_CREDENTIAL_PATTERN.test(text)) return "";
  if (!INBOUND_IDENTIFIER_PATTERN.test(text)) return "";
  return text;
}

function sanitizeInboundLabel(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) return "";
  if (EMBEDDED_ENDPOINT_OR_PATH_PATTERN.test(text) || EMBEDDED_CREDENTIAL_PATTERN.test(text)) return "";
  return INBOUND_LABEL_PATTERN.test(text) ? text : "";
}

function sanitizeInboundMimeType(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 127) return "";
  if (EMBEDDED_ENDPOINT_OR_PATH_PATTERN.test(text) || EMBEDDED_CREDENTIAL_PATTERN.test(text)) return "";
  return MIME_TYPE_PATTERN.test(text) ? text.toLowerCase() : "";
}

export function inboundOperationStageAtLeast(current: unknown, expected: unknown) {
  return inboundOperationStageRank(current) >= inboundOperationStageRank(expected);
}

export function monotonicInboundOperationStage(current: unknown, incoming: unknown) {
  const currentStage = normalizeInboundOperationStage(current);
  const incomingStage = normalizeInboundOperationStage(incoming);
  return inboundOperationStageRank(currentStage) >= inboundOperationStageRank(incomingStage)
    ? currentStage
    : incomingStage;
}

function inboundOperationStageRank(value: unknown) {
  const normalized = normalizeInboundOperationStage(value);
  return INBOUND_OPERATION_STAGE_ORDER.indexOf(normalized as (typeof INBOUND_OPERATION_STAGE_ORDER)[number]);
}

function normalizeInboundOperationStage(value: unknown) {
  const normalized = String(value || "reserved").trim();
  if ((INBOUND_OPERATION_STAGE_ORDER as readonly string[]).includes(normalized)) return normalized;
  throw new BadRequestException(`unsupported inbound operation stage: ${normalized}`);
}

export function deterministicOperationId(prefix: string, operationKey: string, suffix?: string | number) {
  const digest = createHash("sha256")
    .update(suffix === undefined ? operationKey : `${operationKey}:${suffix}`)
    .digest("hex")
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

export function stableOperationKey(prefix: string, source: string) {
  const digest = createHash("sha256").update(source).digest("hex");
  return normalizeOperationKey(`${prefix}:${digest}`);
}

export function requestOperationMetadata(key: string, fingerprint: string): RequestOperationMetadata {
  return { key, fingerprint };
}

export function readRequestOperationMetadata(value: unknown): RequestOperationMetadata | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const metadata = candidate.requestOperation;
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  if (typeof record.key !== "string" || typeof record.fingerprint !== "string") return null;
  return { key: record.key, fingerprint: record.fingerprint };
}

export function assertExactOperationReplay(
  stored: RequestOperationMetadata | null,
  expected: RequestOperationMetadata,
  label: string,
) {
  if (stored?.key === expected.key && stored.fingerprint === expected.fingerprint) return;
  throw new ConflictException({
    code: "OPERATION_KEY_REUSED",
    message: `${label} operationKey was already used with different identity or payload`,
  });
}

export function assertStoredOperationIdentityReplay(
  storedIdentity: Record<string, unknown>,
  requestedIdentity: Record<string, unknown>,
  label: string,
) {
  const stored = normalizedIdentity(storedIdentity);
  const requested = normalizedIdentity(requestedIdentity);
  const conversationMismatch = stored.conversationId
    ? requested.conversationId !== stored.conversationId
    : Boolean(requested.conversationId);
  const explicitCustomerMismatch = Boolean(requested.customerId) && requested.customerId !== stored.customerId;
  const explicitAccountMismatch = Boolean(requested.wechatAccountId) && requested.wechatAccountId !== stored.wechatAccountId;
  if (!conversationMismatch && !explicitCustomerMismatch && !explicitAccountMismatch) return stored;
  throw new ConflictException({
    code: "OPERATION_KEY_REUSED",
    message: `${label} operationKey was already used with different identity or payload`,
  });
}

export function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

function normalizedOptionalString(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function normalizedIdentity(value: Record<string, unknown>) {
  return {
    customerId: normalizedOptionalString(value.customerId),
    conversationId: normalizedOptionalString(value.conversationId),
    wechatAccountId: normalizedOptionalString(value.wechatAccountId),
  };
}
