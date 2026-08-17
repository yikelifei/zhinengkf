ALTER TABLE "KnowledgeEntry" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'review';
ALTER TABLE "KnowledgeEntry" ADD COLUMN "reviewer" TEXT;
ALTER TABLE "KnowledgeEntry" ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "KnowledgeEntry" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "KnowledgeEntry" ADD COLUMN "reviewHistory" JSONB;

UPDATE "KnowledgeEntry"
SET "status" = 'ready'
WHERE "sourceType" IN ('starter_knowledge', 'chat_import', 'route_correction');

CREATE INDEX "KnowledgeEntry_agentId_status_idx" ON "KnowledgeEntry"("agentId", "status");
