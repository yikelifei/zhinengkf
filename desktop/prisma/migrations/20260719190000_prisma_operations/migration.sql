-- Production persistence for agent/routing/training and conversation operations.
-- Additive and backwards compatible: existing rows remain global/unscoped and keep
-- the same default queue behavior.

ALTER TABLE "Conversation"
  ADD COLUMN "assignee" TEXT,
  ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN "slaDueAt" TIMESTAMP(3),
  ADD COLUMN "firstResponseDueAt" TIMESTAMP(3);

ALTER TABLE "AgentSkill"
  ADD COLUMN "wechatAccountId" TEXT,
  ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "identityBinding" JSONB;

ALTER TABLE "ChatImport"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "wechatAccountId" TEXT,
  ADD COLUMN "identityBinding" JSONB,
  ADD COLUMN "sceneSummary" JSONB;

ALTER TABLE "TrainingSample"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "wechatAccountId" TEXT,
  ADD COLUMN "identityBinding" JSONB,
  ADD COLUMN "sceneScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sceneScores" JSONB,
  ADD COLUMN "matchedKeywords" JSONB,
  ADD COLUMN "sceneCheck" JSONB,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceRouteId" TEXT,
  ADD COLUMN "reviewer" TEXT,
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewHistory" JSONB;

ALTER TABLE "KnowledgeEntry"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "wechatAccountId" TEXT,
  ADD COLUMN "identityBinding" JSONB;

ALTER TABLE "RouteEvaluation"
  ADD COLUMN "wechatAccountId" TEXT,
  ADD COLUMN "identityBinding" JSONB,
  ADD COLUMN "sceneScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sceneScores" JSONB,
  ADD COLUMN "matchedKeywords" JSONB,
  ADD COLUMN "sceneDecision" JSONB,
  ADD COLUMN "sceneClarification" JSONB,
  ADD COLUMN "clarificationResolution" JSONB,
  ADD COLUMN "sceneMemory" JSONB,
  ADD COLUMN "sceneAudit" JSONB,
  ADD COLUMN "routingPolicy" JSONB,
  ADD COLUMN "correction" JSONB;

CREATE INDEX "Conversation_wechatAccountId_status_priority_lastMessageAt_idx"
  ON "Conversation"("wechatAccountId", "status", "priority", "lastMessageAt");
CREATE INDEX "Conversation_assignee_status_lastMessageAt_idx"
  ON "Conversation"("assignee", "status", "lastMessageAt");
CREATE INDEX "Conversation_slaDueAt_idx" ON "Conversation"("slaDueAt");
CREATE INDEX "Conversation_firstResponseDueAt_idx" ON "Conversation"("firstResponseDueAt");
CREATE INDEX "AgentSkill_agentId_wechatAccountId_conversationId_customerId_idx"
  ON "AgentSkill"("agentId", "wechatAccountId", "conversationId", "customerId");
CREATE INDEX "ChatImport_wechatAccountId_conversationId_customerId_createdAt_idx"
  ON "ChatImport"("wechatAccountId", "conversationId", "customerId", "createdAt");
CREATE INDEX "TrainingSample_wechatAccountId_conversationId_customerId_createdAt_idx"
  ON "TrainingSample"("wechatAccountId", "conversationId", "customerId", "createdAt");
CREATE INDEX "TrainingSample_sourceType_sourceRouteId_idx"
  ON "TrainingSample"("sourceType", "sourceRouteId");
CREATE INDEX "KnowledgeEntry_agentId_wechatAccountId_conversationId_customerId_qualityScore_idx"
  ON "KnowledgeEntry"("agentId", "wechatAccountId", "conversationId", "customerId", "qualityScore");
CREATE INDEX "RouteEvaluation_wechatAccountId_conversationId_customerId_createdAt_idx"
  ON "RouteEvaluation"("wechatAccountId", "conversationId", "customerId", "createdAt");
