CREATE TYPE "DesignPlatformExecutionStatus" AS ENUM ('prepared', 'dispatching', 'generating', 'completed', 'explicit_failed', 'outcome_unknown', 'cancel_requested', 'cancelled');
CREATE TYPE "DesignPlatformAcceptanceStatus" AS ENUM ('pending', 'accepting', 'accepted', 'rejected', 'manual_review');
CREATE TYPE "DesignPlatformRefundStatus" AS ENUM ('pending', 'refunded', 'not_required', 'credit_bypass', 'failed', 'unknown');

CREATE TABLE "DesignPlatformExecution" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "externalJobId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "adapter" TEXT NOT NULL DEFAULT 'art_image_local',
    "designJobId" TEXT NOT NULL,
    "designRevisionId" TEXT,
    "attemptNo" INTEGER NOT NULL,
    "processRunId" TEXT NOT NULL,
    "status" "DesignPlatformExecutionStatus" NOT NULL DEFAULT 'prepared',
    "acceptanceStatus" "DesignPlatformAcceptanceStatus" NOT NULL DEFAULT 'pending',
    "refundStatus" "DesignPlatformRefundStatus" NOT NULL DEFAULT 'pending',
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "images" JSONB,
    "refundSummary" JSONB,
    "errorCode" TEXT,
    "errorCategory" TEXT,
    "errorMessage" TEXT,
    "responseHttpStatus" INTEGER,
    "dispatchedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DesignPlatformExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DesignPlatformExecution_operationKey_key" ON "DesignPlatformExecution"("operationKey");
CREATE UNIQUE INDEX "DesignPlatformExecution_externalJobId_key" ON "DesignPlatformExecution"("externalJobId");
CREATE UNIQUE INDEX "DesignPlatformExecution_requestId_key" ON "DesignPlatformExecution"("requestId");
CREATE UNIQUE INDEX "DesignPlatformExecution_designJobId_designRevisionId_attemptNo_key" ON "DesignPlatformExecution"("designJobId", "designRevisionId", "attemptNo");
CREATE INDEX "DesignPlatformExecution_status_processRunId_updatedAt_idx" ON "DesignPlatformExecution"("status", "processRunId", "updatedAt");
CREATE INDEX "DesignPlatformExecution_scopeKey_attemptNo_idx" ON "DesignPlatformExecution"("scopeKey", "attemptNo");
CREATE INDEX "DesignPlatformExecution_designJobId_createdAt_idx" ON "DesignPlatformExecution"("designJobId", "createdAt");
CREATE INDEX "DesignPlatformExecution_acceptanceStatus_completedAt_idx" ON "DesignPlatformExecution"("acceptanceStatus", "completedAt");

ALTER TABLE "DesignPlatformExecution" ADD CONSTRAINT "DesignPlatformExecution_designJobId_fkey" FOREIGN KEY ("designJobId") REFERENCES "DesignJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DesignPlatformExecution" ADD CONSTRAINT "DesignPlatformExecution_designRevisionId_fkey" FOREIGN KEY ("designRevisionId") REFERENCES "DesignRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
