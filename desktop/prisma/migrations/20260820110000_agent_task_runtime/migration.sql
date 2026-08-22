-- Controlled Agent runtime: durable task, step and approval records.
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "taskType" TEXT NOT NULL,
    "lane" TEXT,
    "routeAction" TEXT,
    "planType" TEXT,
    "reason" TEXT,
    "objective" TEXT,
    "wechatAccountId" TEXT,
    "conversationId" TEXT,
    "customerId" TEXT,
    "routeId" TEXT,
    "inboundMessageId" TEXT,
    "currentStep" TEXT,
    "payload" JSONB,
    "handoff" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTaskStep" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "mode" TEXT,
    "toolName" TEXT,
    "idempotencyKey" TEXT,
    "input" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentTaskStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTaskApproval" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "policy" TEXT NOT NULL,
    "requestedBy" TEXT,
    "reviewer" TEXT,
    "decisionNote" TEXT,
    "metadata" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentTaskApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentTask_operationKey_key" ON "AgentTask"("operationKey");
CREATE UNIQUE INDEX "AgentTaskStep_taskId_stepKey_key" ON "AgentTaskStep"("taskId", "stepKey");
CREATE INDEX "AgentTask_conversationId_status_updatedAt_idx" ON "AgentTask"("conversationId", "status", "updatedAt");
CREATE INDEX "AgentTask_customerId_updatedAt_idx" ON "AgentTask"("customerId", "updatedAt");
CREATE INDEX "AgentTask_wechatAccountId_status_updatedAt_idx" ON "AgentTask"("wechatAccountId", "status", "updatedAt");
CREATE INDEX "AgentTask_status_updatedAt_idx" ON "AgentTask"("status", "updatedAt");
CREATE INDEX "AgentTaskStep_taskId_status_idx" ON "AgentTaskStep"("taskId", "status");
CREATE INDEX "AgentTaskStep_toolName_status_updatedAt_idx" ON "AgentTaskStep"("toolName", "status", "updatedAt");
CREATE INDEX "AgentTaskApproval_taskId_status_idx" ON "AgentTaskApproval"("taskId", "status");
CREATE INDEX "AgentTaskApproval_status_requestedAt_idx" ON "AgentTaskApproval"("status", "requestedAt");

ALTER TABLE "AgentTaskStep" ADD CONSTRAINT "AgentTaskStep_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentTaskApproval" ADD CONSTRAINT "AgentTaskApproval_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgentTaskToolExecution" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepKey" TEXT,
    "operationKey" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolVersion" TEXT NOT NULL DEFAULT '1',
    "effect" TEXT NOT NULL,
    "capability" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "idempotencyKey" TEXT,
    "input" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentTaskToolExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentTaskToolExecution_operationKey_key" ON "AgentTaskToolExecution"("operationKey");
CREATE INDEX "AgentTaskToolExecution_taskId_status_updatedAt_idx" ON "AgentTaskToolExecution"("taskId", "status", "updatedAt");
CREATE INDEX "AgentTaskToolExecution_toolName_status_updatedAt_idx" ON "AgentTaskToolExecution"("toolName", "status", "updatedAt");
CREATE INDEX "AgentTaskToolExecution_idempotencyKey_idx" ON "AgentTaskToolExecution"("idempotencyKey");

ALTER TABLE "AgentTaskToolExecution" ADD CONSTRAINT "AgentTaskToolExecution_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
