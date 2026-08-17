ALTER TABLE "OrderDraft"
ADD COLUMN "productionStatus" TEXT NOT NULL DEFAULT 'not_started',
ADD COLUMN "productionDueAt" TEXT,
ADD COLUMN "carrier" TEXT,
ADD COLUMN "trackingNo" TEXT,
ADD COLUMN "shippedAt" TEXT,
ADD COLUMN "deliveredAt" TEXT;

CREATE INDEX "OrderDraft_productionStatus_updatedAt_idx"
ON "OrderDraft"("productionStatus", "updatedAt");
