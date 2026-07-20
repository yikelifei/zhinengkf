ALTER TABLE "DesignJob"
  ADD COLUMN "submitOperationKey" TEXT,
  ADD COLUMN "submitRequestFingerprint" TEXT,
  ADD COLUMN "submitOperationIdentity" JSONB,
  ADD COLUMN "submitDispatchStatus" TEXT,
  ADD COLUMN "submitDispatchError" TEXT,
  ADD COLUMN "callbackOperationKey" TEXT,
  ADD COLUMN "callbackRequestFingerprint" TEXT,
  ADD COLUMN "callbackStatus" TEXT,
  ADD COLUMN "callbackClaimedAt" TIMESTAMP(3),
  ADD COLUMN "callbackSettledAt" TIMESTAMP(3);

ALTER TABLE "DesignRevision"
  ADD COLUMN "operationKey" TEXT,
  ADD COLUMN "requestFingerprint" TEXT,
  ADD COLUMN "operationIdentity" JSONB,
  ADD COLUMN "externalRequestId" TEXT,
  ADD COLUMN "dispatchStatus" TEXT,
  ADD COLUMN "dispatchError" TEXT,
  ADD COLUMN "waitMessageSentAt" TIMESTAMP(3);

-- Preserve every historical revision while repairing duplicate numbers before
-- installing the concurrency guard.
WITH "rankedRevisions" AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "designJobId"
    ORDER BY "revisionNumber" ASC, "createdAt" ASC, "id" ASC
  ) AS "nextRevisionNumber"
  FROM "DesignRevision"
)
UPDATE "DesignRevision" AS "revision"
SET "revisionNumber" = "rankedRevisions"."nextRevisionNumber"
FROM "rankedRevisions"
WHERE "revision"."id" = "rankedRevisions"."id"
  AND "revision"."revisionNumber" <> "rankedRevisions"."nextRevisionNumber";

UPDATE "DesignJob" AS "job"
SET "revisionCount" = "revisionCounts"."revisionCount"
FROM (
  SELECT "designJobId", MAX("revisionNumber") AS "revisionCount"
  FROM "DesignRevision"
  GROUP BY "designJobId"
) AS "revisionCounts"
WHERE "job"."id" = "revisionCounts"."designJobId"
  AND "job"."revisionCount" < "revisionCounts"."revisionCount";

CREATE UNIQUE INDEX "DesignJob_submitOperationKey_key" ON "DesignJob"("submitOperationKey");
CREATE UNIQUE INDEX "DesignJob_callbackOperationKey_key" ON "DesignJob"("callbackOperationKey");
CREATE UNIQUE INDEX "DesignRevision_operationKey_key" ON "DesignRevision"("operationKey");
CREATE UNIQUE INDEX "DesignRevision_externalRequestId_key" ON "DesignRevision"("externalRequestId");
CREATE UNIQUE INDEX "DesignRevision_designJobId_revisionNumber_key" ON "DesignRevision"("designJobId", "revisionNumber");
