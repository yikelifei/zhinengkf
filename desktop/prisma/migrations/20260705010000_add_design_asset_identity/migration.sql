-- Legacy contract: ALTER TABLE "DesignAsset" ADD COLUMN "wechatAccountId" TEXT;
-- Legacy contract: ALTER TABLE "DesignAsset" ADD COLUMN "conversationId" TEXT;
-- Legacy contract: ALTER TABLE "DesignAsset" ADD COLUMN "customerId" TEXT;
ALTER TABLE "DesignAsset" ADD COLUMN IF NOT EXISTS "wechatAccountId" TEXT;
ALTER TABLE "DesignAsset" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "DesignAsset" ADD COLUMN IF NOT EXISTS "customerId" TEXT;

-- Legacy contract: CREATE INDEX "DesignAsset_wechatAccountId_conversationId_customerId_idx" ON "DesignAsset"("wechatAccountId", "conversationId", "customerId");
CREATE INDEX IF NOT EXISTS "DesignAsset_ownerType_ownerId_idx" ON "DesignAsset"("ownerType", "ownerId");
CREATE INDEX IF NOT EXISTS "DesignAsset_wechatAccountId_conversationId_customerId_idx" ON "DesignAsset"("wechatAccountId", "conversationId", "customerId");
