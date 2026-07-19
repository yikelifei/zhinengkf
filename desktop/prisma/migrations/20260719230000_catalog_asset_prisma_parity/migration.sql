-- Catalog mutations and their audit record must commit atomically.
CREATE TABLE "SkuChangeLog" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changedFields" JSONB NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkuChangeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SkuChangeLog_skuCode_createdAt_idx" ON "SkuChangeLog"("skuCode", "createdAt");
CREATE INDEX "SkuChangeLog_createdAt_idx" ON "SkuChangeLog"("createdAt");
ALTER TABLE "SkuChangeLog" ADD CONSTRAINT "SkuChangeLog_skuId_fkey"
FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the new key nullable so ambiguous legacy rows fail closed instead of
-- being assigned an arbitrary identity during deployment.
ALTER TABLE "DesignAsset" ADD COLUMN "normalizedLocalPath" TEXT;

WITH candidates AS (
  SELECT
    "id",
    NULLIF(
      lower(regexp_replace(replace(btrim("localPath"), E'\\', '/'), '/+', '/', 'g')),
      ''
    ) AS normalized_path
  FROM "DesignAsset"
), classified AS (
  SELECT
    "id",
    normalized_path,
    count(*) OVER (PARTITION BY normalized_path) AS normalized_count
  FROM candidates
)
UPDATE "DesignAsset" AS asset
SET "normalizedLocalPath" = CASE
  WHEN classified.normalized_path IS NULL OR classified.normalized_count > 1 THEN NULL
  ELSE classified.normalized_path
END
FROM classified
WHERE asset."id" = classified."id";

-- PostgreSQL UNIQUE permits multiple NULL values. This ordinary index matches
-- Prisma's String? @unique contract while keeping ambiguous legacy rows unreadable.
CREATE UNIQUE INDEX "DesignAsset_normalizedLocalPath_key"
ON "DesignAsset"("normalizedLocalPath");
