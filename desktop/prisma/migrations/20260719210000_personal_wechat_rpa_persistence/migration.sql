-- Persist personal WeChat business identity bindings and redacted audit evidence.
-- Host endpoints, credentials, Windows sessions and local paths deliberately remain outside PostgreSQL.
ALTER TYPE "ConversationChannel" ADD VALUE IF NOT EXISTS 'personal_wechat';

ALTER TABLE "WechatAccount"
ADD COLUMN "personalWechatOwnerWxId" TEXT,
ADD COLUMN "personalWechatAccountNickname" TEXT;

ALTER TABLE "Customer"
ADD COLUMN "personalWechatRpaBindingKey" TEXT;

CREATE UNIQUE INDEX "WechatAccount_personalWechatOwnerWxId_key"
ON "WechatAccount"("personalWechatOwnerWxId");

CREATE UNIQUE INDEX "Customer_personalWechatRpaBindingKey_key"
ON "Customer"("personalWechatRpaBindingKey");

CREATE TABLE "PersonalWechatRpaBinding" (
    "id" TEXT NOT NULL,
    "bindingKey" TEXT NOT NULL,
    "ownerWxId" TEXT NOT NULL,
    "accountNickname" TEXT NOT NULL,
    "chatTitle" TEXT NOT NULL,
    "conversationType" TEXT NOT NULL,
    "senderName" TEXT,
    "wechatAccountId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalWechatRpaBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonalWechatRpaAuditLog" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "accountNickname" TEXT,
    "ownerWxId" TEXT,
    "chatTitle" TEXT,
    "externalId" TEXT,
    "wechatAccountId" TEXT,
    "customerId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "sendTaskId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalWechatRpaAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonalWechatRpaBinding_bindingKey_key"
ON "PersonalWechatRpaBinding"("bindingKey");
CREATE UNIQUE INDEX "PersonalWechatRpaBinding_conversationId_key"
ON "PersonalWechatRpaBinding"("conversationId");
CREATE INDEX "PersonalWechatRpaBinding_wechatAccountId_lastInboundAt_idx"
ON "PersonalWechatRpaBinding"("wechatAccountId", "lastInboundAt");
CREATE INDEX "PersonalWechatRpaBinding_ownerWxId_idx"
ON "PersonalWechatRpaBinding"("ownerWxId");
CREATE INDEX "PersonalWechatRpaAuditLog_wechatAccountId_createdAt_idx"
ON "PersonalWechatRpaAuditLog"("wechatAccountId", "createdAt");
CREATE INDEX "PersonalWechatRpaAuditLog_conversationId_externalId_created_idx"
ON "PersonalWechatRpaAuditLog"("conversationId", "externalId", "createdAt");
CREATE INDEX "PersonalWechatRpaAuditLog_direction_status_createdAt_idx"
ON "PersonalWechatRpaAuditLog"("direction", "status", "createdAt");

ALTER TABLE "PersonalWechatRpaBinding"
ADD CONSTRAINT "PersonalWechatRpaBinding_wechatAccountId_fkey"
FOREIGN KEY ("wechatAccountId") REFERENCES "WechatAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonalWechatRpaBinding"
ADD CONSTRAINT "PersonalWechatRpaBinding_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonalWechatRpaBinding"
ADD CONSTRAINT "PersonalWechatRpaBinding_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
