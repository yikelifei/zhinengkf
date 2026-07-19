-- Enterprise WeChat inbound durability is scoped to the official customer-service channel.
-- Personal WeChat remains a separate local RPA integration and is intentionally not added here.
ALTER TYPE "ConversationChannel" ADD VALUE IF NOT EXISTS 'work_wechat';

CREATE TABLE "WechatWorkSyncCursor" (
    "id" TEXT NOT NULL,
    "openKfid" TEXT NOT NULL,
    "nextCursor" TEXT NOT NULL DEFAULT '',
    "terminalMessageCount" INTEGER NOT NULL DEFAULT 0,
    "batchFingerprint" TEXT,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WechatWorkSyncCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WechatWorkSyncCursor_openKfid_key" ON "WechatWorkSyncCursor"("openKfid");
CREATE INDEX "WechatWorkSyncCursor_committedAt_idx" ON "WechatWorkSyncCursor"("committedAt");
