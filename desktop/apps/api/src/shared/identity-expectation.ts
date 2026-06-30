import { BadRequestException } from "@nestjs/common";

export type ExpectedIdentityPayload = {
  expectedWechatAccountId?: string;
  expectedConversationId?: string;
  expectedCustomerId?: string;
};

export function assertExpectedIdentity(record: any, expected: ExpectedIdentityPayload = {}, label = "record") {
  const checks = [
    ["expectedWechatAccountId", "wechatAccountId", resolveWechatAccountId(record)],
    ["expectedConversationId", "conversationId", resolveConversationId(record)],
    ["expectedCustomerId", "customerId", resolveCustomerId(record)],
  ] as const;

  for (const [payloadKey, identityKey, actual] of checks) {
    const expectedValue = expected[payloadKey];
    if (!expectedValue) continue;
    if (String(expectedValue) !== String(actual || "")) {
      throw new BadRequestException(
        `${label} identity mismatch: ${identityKey} expected ${expectedValue}, got ${actual || "-"}`,
      );
    }
  }
}

function resolveWechatAccountId(record: any) {
  return record?.wechatAccountId || record?.target?.wechatAccountId || record?.designJob?.wechatAccountId || record?.quoteDraft?.designJob?.wechatAccountId;
}

function resolveConversationId(record: any) {
  return record?.conversationId || record?.target?.conversationId || record?.designJob?.conversationId || record?.quoteDraft?.designJob?.conversationId;
}

function resolveCustomerId(record: any) {
  return (
    record?.customerId ||
    record?.target?.customerId ||
    record?.conversation?.customerId ||
    record?.designJob?.customerId ||
    record?.designJob?.conversation?.customerId ||
    record?.quoteDraft?.customerId ||
    record?.quoteDraft?.designJob?.customerId
  );
}
