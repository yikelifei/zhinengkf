ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "WechatWindowSnapshot" ADD COLUMN IF NOT EXISTS "activeConversationId" TEXT;

CREATE INDEX IF NOT EXISTS "WechatAccount_isActive_displayName_idx" ON "WechatAccount"("isActive", "displayName");
CREATE INDEX IF NOT EXISTS "Customer_wechatId_idx" ON "Customer"("wechatId");
CREATE INDEX IF NOT EXISTS "Conversation_channel_lastMessageAt_idx" ON "Conversation"("channel", "lastMessageAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_wechatAccountId_externalChatId_key" ON "Conversation"("wechatAccountId", "externalChatId");
CREATE INDEX IF NOT EXISTS "Message_externalId_idx" ON "Message"("externalId");
CREATE UNIQUE INDEX IF NOT EXISTS "Message_conversationId_externalId_key" ON "Message"("conversationId", "externalId");
CREATE INDEX IF NOT EXISTS "WechatSendTask_conversationId_status_idx" ON "WechatSendTask"("conversationId", "status");
CREATE INDEX IF NOT EXISTS "WechatSendTask_status_queuedAt_idx" ON "WechatSendTask"("status", "queuedAt");
CREATE INDEX IF NOT EXISTS "WechatSendAttempt_windowSnapshotId_idx" ON "WechatSendAttempt"("windowSnapshotId");
CREATE INDEX IF NOT EXISTS "WechatWindowSnapshot_activeConversationId_capturedAt_idx" ON "WechatWindowSnapshot"("activeConversationId", "capturedAt");
CREATE INDEX IF NOT EXISTS "WechatWindowSnapshot_recentCustomerId_capturedAt_idx" ON "WechatWindowSnapshot"("recentCustomerId", "capturedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'WechatSendAttempt_windowSnapshotId_fkey'
      AND conrelid = '"WechatSendAttempt"'::regclass
  ) THEN
    ALTER TABLE "WechatSendAttempt"
      ADD CONSTRAINT "WechatSendAttempt_windowSnapshotId_fkey"
      FOREIGN KEY ("windowSnapshotId") REFERENCES "WechatWindowSnapshot"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'WechatWindowSnapshot_activeConversationId_fkey'
      AND conrelid = '"WechatWindowSnapshot"'::regclass
  ) THEN
    ALTER TABLE "WechatWindowSnapshot"
      ADD CONSTRAINT "WechatWindowSnapshot_activeConversationId_fkey"
      FOREIGN KEY ("activeConversationId") REFERENCES "Conversation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
