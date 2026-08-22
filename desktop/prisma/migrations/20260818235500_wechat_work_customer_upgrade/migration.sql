CREATE TABLE "WechatWorkCustomerUpgrade" (
  "id" TEXT NOT NULL,
  "corpId" TEXT NOT NULL,
  "openKfid" TEXT NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "wechatAccountId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "memberUserId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "configId" TEXT,
  "qrCodeUrl" TEXT,
  "localPath" TEXT,
  "status" TEXT NOT NULL,
  "claimToken" TEXT,
  "claimExpiresAt" TIMESTAMP(3),
  "textStatus" TEXT NOT NULL DEFAULT 'pending',
  "imageStatus" TEXT NOT NULL DEFAULT 'pending',
  "textMsgId" TEXT,
  "imageMsgId" TEXT,
  "sendTaskId" TEXT,
  "sendAttemptId" TEXT,
  "apiAcceptedAt" TIMESTAMP(3),
  "asyncFailedAt" TIMESTAMP(3),
  "sourceUnionId" TEXT,
  "addedExternalUserId" TEXT,
  "halfAddedAt" TIMESTAMP(3),
  "identityVerifiedAt" TIMESTAMP(3),
  "addedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WechatWorkCustomerUpgrade_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WechatWorkCustomerUpgrade_state_key" ON "WechatWorkCustomerUpgrade"("state");
CREATE UNIQUE INDEX "WechatWorkCustomerUpgrade_identity_key" ON "WechatWorkCustomerUpgrade"("corpId", "openKfid", "externalUserId", "memberUserId");
CREATE INDEX "WechatWorkCustomerUpgrade_sendTaskId_idx" ON "WechatWorkCustomerUpgrade"("sendTaskId");
CREATE INDEX "WechatWorkCustomerUpgrade_textMsgId_idx" ON "WechatWorkCustomerUpgrade"("textMsgId");
CREATE INDEX "WechatWorkCustomerUpgrade_imageMsgId_idx" ON "WechatWorkCustomerUpgrade"("imageMsgId");
CREATE INDEX "WechatWorkCustomerUpgrade_status_updatedAt_idx" ON "WechatWorkCustomerUpgrade"("status", "updatedAt");
