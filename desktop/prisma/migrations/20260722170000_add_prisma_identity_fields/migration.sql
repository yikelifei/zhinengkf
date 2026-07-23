ALTER TABLE "DesignAsset" ADD COLUMN "role" TEXT;
ALTER TABLE "WechatSendTask" ADD COLUMN "customerId" TEXT;

CREATE INDEX "WechatSendTask_customerId_idx" ON "WechatSendTask"("customerId");
