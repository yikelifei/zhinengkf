-- Preserve business fields already present in the durable local store before
-- switching the stable runtime to PostgreSQL.
ALTER TABLE "KnowledgeEntry" ADD COLUMN "metadata" JSONB;
ALTER TABLE "RouteEvaluation" ADD COLUMN "operationKey" TEXT;

CREATE UNIQUE INDEX "RouteEvaluation_operationKey_key" ON "RouteEvaluation"("operationKey");
