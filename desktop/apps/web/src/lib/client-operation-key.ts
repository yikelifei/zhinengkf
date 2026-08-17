export type ClientOperationScope =
  | "design-job"
  | "design-submit"
  | "design-revision"
  | "quote-create"
  | "training-import"
  | "knowledge-import-preview"
  | "knowledge-import"
  | "manual-reply"
  | "design-send"
  | "quote-send"
  | "payment-proof"
  | "order-send"
  | "order-fulfillment"
  | "order-after-sales-create"
  | "order-after-sales-resolve"
  | "review-action"
  | "agent-skill"
  | "routing-inbound"
  | "send-demo"
  | "customer-upgrade"
  | "conversation-outcome"
  | "send-resolution";

export type PendingClientOperation = {
  scope: ClientOperationScope;
  key: string;
  payloadSignature: string;
};

export function createClientOperationKey(scope: ClientOperationScope) {
  return `${scope}:${globalThis.crypto.randomUUID()}`;
}

export function reserveClientOperation(
  scope: ClientOperationScope,
  payload: unknown,
  pending: PendingClientOperation | null,
): PendingClientOperation {
  const payloadSignature = stableClientPayload(payload);
  if (pending?.scope === scope && pending.payloadSignature === payloadSignature) return pending;
  return { scope, payloadSignature, key: createClientOperationKey(scope) };
}

export function completeClientOperation(
  pending: PendingClientOperation | null,
  completedKey: string,
) {
  return pending?.key === completedKey ? null : pending;
}

function stableClientPayload(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableClientPayload(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableClientPayload(record[key])}`)
    .join(",")}}`;
}
