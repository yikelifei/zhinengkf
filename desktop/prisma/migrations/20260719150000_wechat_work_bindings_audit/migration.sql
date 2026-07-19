-- Persist Enterprise WeChat identity mappings and redacted operational audit records.
CREATE TABLE "WechatWorkBinding" (
    "id" TEXT NOT NULL,
    "openKfid" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "wechatAccountId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WechatWorkBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WechatWorkAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "msgid" TEXT,
    "callbackId" TEXT,
    "event" TEXT,
    "openKfid" TEXT,
    "externalUserId" TEXT,
    "wechatAccountId" TEXT,
    "customerId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "sendTaskId" TEXT,
    "sendAttemptId" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WechatWorkAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WechatWorkBinding_openKfid_externalUserId_key"
ON "WechatWorkBinding"("openKfid", "externalUserId");
CREATE UNIQUE INDEX "WechatWorkBinding_conversationId_key"
ON "WechatWorkBinding"("conversationId");
CREATE INDEX "WechatWorkBinding_wechatAccountId_customerId_idx"
ON "WechatWorkBinding"("wechatAccountId", "customerId");
CREATE INDEX "WechatWorkAuditLog_msgid_idx" ON "WechatWorkAuditLog"("msgid");
CREATE INDEX "WechatWorkAuditLog_action_createdAt_idx" ON "WechatWorkAuditLog"("action", "createdAt");
CREATE INDEX "WechatWorkAuditLog_sendTaskId_createdAt_idx" ON "WechatWorkAuditLog"("sendTaskId", "createdAt");
CREATE INDEX "WechatWorkAuditLog_openKfid_externalUserId_createdAt_idx"
ON "WechatWorkAuditLog"("openKfid", "externalUserId", "createdAt");

ALTER TABLE "WechatWorkBinding"
ADD CONSTRAINT "WechatWorkBinding_wechatAccountId_fkey"
FOREIGN KEY ("wechatAccountId") REFERENCES "WechatAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WechatWorkBinding"
ADD CONSTRAINT "WechatWorkBinding_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WechatWorkBinding"
ADD CONSTRAINT "WechatWorkBinding_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
