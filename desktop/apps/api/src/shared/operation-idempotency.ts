import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";

const OPERATION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*[A-Za-z0-9]$/;

export const OPERATION_KEY_MIN_LENGTH = 16;
export const OPERATION_KEY_MAX_LENGTH = 128;

export type RequestOperationMetadata = {
  key: string;
  fingerprint: string;
};

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
