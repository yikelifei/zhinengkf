ALTER TABLE "DesignAsset" ADD COLUMN "wechatAccountId" TEXT;
ALTER TABLE "DesignAsset" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "DesignAsset" ADD COLUMN "customerId" TEXT;

CREATE INDEX "DesignAsset_ownerType_ownerId_idx" ON "DesignAsset"("ownerType", "ownerId");
CREATE INDEX "DesignAsset_wechatAccountId_conversationId_customerId_idx" ON "DesignAsset"("wechatAccountId", "conversationId", "customerId");
