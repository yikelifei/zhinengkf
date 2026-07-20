export type ClientOperationScope = "design-job" | "training-import";

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
