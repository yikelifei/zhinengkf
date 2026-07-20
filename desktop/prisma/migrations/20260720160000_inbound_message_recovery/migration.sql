-- Durable account-scoped inbound reservation and resumable processing stages.
-- normalizedPayload contains only normalized business event data; host credentials,
-- endpoints, Windows session data and local paths are deliberately excluded.
CREATE TABLE "InboundMessageOperation" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "wechatAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "normalizedPayload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "stage" TEXT NOT NULL DEFAULT 'reserved',
    "bindingKey" TEXT,
    "customerId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "routeEvaluationId" TEXT,
    "sendTaskId" TEXT,
    "result" JSONB,
    "claimToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundMessageOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundMessageOperation_wechatAccountId_externalId_key"
ON "InboundMessageOperation"("wechatAccountId", "externalId");
CREATE INDEX "InboundMessageOperation_status_leaseExpiresAt_idx"
ON "InboundMessageOperation"("status", "leaseExpiresAt");
CREATE INDEX "InboundMessageOperation_stage_updatedAt_idx"
ON "InboundMessageOperation"("stage", "updatedAt");
