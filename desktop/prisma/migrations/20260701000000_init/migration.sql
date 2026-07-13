-- CreateEnum
CREATE TYPE "SkuType" AS ENUM ('gift_box', 'item', 'accessory');

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('wechat', 'xiaohongshu', 'douyin');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound', 'system');

-- CreateEnum
CREATE TYPE "DesignJobStatus" AS ENUM ('draft', 'submitted', 'generating', 'completed', 'quick_confirm', 'manual_review', 'sent', 'customer_selected', 'quote_created', 'failed', 'timeout', 'cancelled');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('draft', 'auto_sent', 'send_queued', 'manual_review', 'sent', 'accepted', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('unpaid', 'deposit_paid', 'paid', 'refunded');

-- CreateEnum
CREATE TYPE "SendTaskStatus" AS ENUM ('queued', 'sending', 'dry_run', 'sent', 'failed', 'blocked', 'cancelled');

-- CreateEnum
CREATE TYPE "SendAttemptStatus" AS ENUM ('started', 'dry_run', 'sent', 'failed', 'blocked');

-- CreateTable
CREATE TABLE "WechatAccount" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "alias" TEXT,
    "windowHandle" TEXT,
    "processId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WechatAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wechatId" TEXT,
    "phone" TEXT,
    "tags" JSONB,
    "notes" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL DEFAULT 'wechat',
    "externalChatId" TEXT,
    "title" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "wechatAccountId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "manualLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "text" TEXT,
    "attachments" JSONB,
    "metadata" JSONB,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SkuType" NOT NULL,
    "category" TEXT,
    "sceneTags" JSONB,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "salePrice" DECIMAL(12,2) NOT NULL,
    "profitRate" DECIMAL(8,4),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "dimensions" JSONB,
    "weightGram" INTEGER,
    "material" TEXT,
    "supplier" TEXT,
    "leadTimeDays" INTEGER,
    "mainImagePath" TEXT,
    "angleImages" JSONB,
    "matchingRules" JSONB,
    "replacementSkuCodes" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignAsset" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "source" TEXT NOT NULL,
    "wechatAccountId" TEXT,
    "conversationId" TEXT,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignJob" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "externalJobId" TEXT,
    "status" "DesignJobStatus" NOT NULL DEFAULT 'draft',
    "designType" TEXT NOT NULL DEFAULT 'bundle_render',
    "renderStyle" TEXT NOT NULL DEFAULT '真实产品摆拍',
    "outputCount" INTEGER NOT NULL DEFAULT 6,
    "budget" JSONB NOT NULL,
    "bundle" JSONB NOT NULL,
    "requirements" JSONB NOT NULL,
    "customerText" TEXT,
    "scene" TEXT,
    "isHighValue" BOOLEAN NOT NULL DEFAULT false,
    "manualQcRequired" BOOLEAN NOT NULL DEFAULT true,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "revisionPolicy" JSONB,
    "errorMessage" TEXT,
    "waitMessageSentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "wechatAccountId" TEXT,
    "orderId" TEXT,

    CONSTRAINT "DesignJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignImageCandidate" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "designJobId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "downloadUrl" TEXT,
    "localPath" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "fingerprint" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "customerFeedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignImageCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignRevision" (
    "id" TEXT NOT NULL,
    "designJobId" TEXT NOT NULL,
    "selectedImageId" TEXT,
    "revisionNumber" INTEGER NOT NULL,
    "instruction" TEXT NOT NULL,
    "sourceText" TEXT,
    "policyAction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "chargeRequired" BOOLEAN NOT NULL DEFAULT false,
    "manualReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "externalJobId" TEXT,
    "resultImageIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteDraft" (
    "id" TEXT NOT NULL,
    "designJobId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "selectedImageId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "profit" DECIMAL(12,2) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'draft',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'unpaid',
    "sendTaskId" TEXT,
    "customerNotes" TEXT,
    "owner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDraft" (
    "id" TEXT NOT NULL,
    "quoteDraftId" TEXT NOT NULL,
    "designJobId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "wechatAccountId" TEXT NOT NULL,
    "selectedImageId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "totalCost" DECIMAL(12,2) NOT NULL,
    "profit" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'unpaid',
    "bundleSnapshot" JSONB,
    "selectedImageSnapshot" JSONB,
    "customerNotes" TEXT,
    "owner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WechatSendTask" (
    "id" TEXT NOT NULL,
    "status" "SendTaskStatus" NOT NULL DEFAULT 'queued',
    "wechatAccountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "designJobId" TEXT,
    "quoteDraftId" TEXT,
    "payload" JSONB NOT NULL,
    "guardSnapshot" JSONB,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WechatSendTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WechatSendAttempt" (
    "id" TEXT NOT NULL,
    "sendTaskId" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "status" "SendAttemptStatus" NOT NULL DEFAULT 'started',
    "guardStatus" TEXT,
    "windowSnapshotId" TEXT,
    "payloadSummary" JSONB,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WechatSendAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WechatWindowSnapshot" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT true,
    "wechatAccountId" TEXT,
    "activeConversationId" TEXT,
    "accountDisplayName" TEXT,
    "windowHandle" TEXT,
    "processId" INTEGER,
    "chatTitle" TEXT,
    "activeChatTitle" TEXT,
    "externalChatId" TEXT,
    "recentCustomerId" TEXT,
    "recentMessageText" TEXT,
    "confidence" DECIMAL(4,3),
    "diagnostic" JSONB,
    "raw" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WechatWindowSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "target" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reviewer" TEXT NOT NULL,
    "note" TEXT,
    "beforeStatus" TEXT,
    "afterStatus" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerServiceAgent" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "description" TEXT,
    "valueLevel" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerServiceAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSkill" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT,
    "sourceSampleIds" JSONB,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "lastCompiledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatImport" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "agentId" TEXT,
    "rawText" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "pairCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSample" (
    "id" TEXT NOT NULL,
    "importId" TEXT,
    "agentId" TEXT,
    "agentKey" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "customerText" TEXT NOT NULL,
    "idealReply" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'review',
    "skillHints" JSONB,
    "sourceLineStart" INTEGER,
    "sourceLineEnd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEntry" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "trainingSampleId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" JSONB,
    "qualityScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteEvaluation" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "customerId" TEXT,
    "conversationId" TEXT,
    "agentId" TEXT,
    "agentKey" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "isHighValue" BOOLEAN NOT NULL DEFAULT false,
    "budget" JSONB,
    "missingFields" JSONB,
    "riskFlags" JSONB,
    "suggestedReply" TEXT,
    "appliedSkills" JSONB,
    "knowledgeMatches" JSONB,
    "replyDraft" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DesignJobAssets" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "WechatAccount_isActive_displayName_idx" ON "WechatAccount"("isActive", "displayName");

-- CreateIndex
CREATE INDEX "Customer_wechatId_idx" ON "Customer"("wechatId");

-- CreateIndex
CREATE INDEX "Conversation_customerId_idx" ON "Conversation"("customerId");

-- CreateIndex
CREATE INDEX "Conversation_wechatAccountId_idx" ON "Conversation"("wechatAccountId");

-- CreateIndex
CREATE INDEX "Conversation_channel_lastMessageAt_idx" ON "Conversation"("channel", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_wechatAccountId_externalChatId_key" ON "Conversation"("wechatAccountId", "externalChatId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_externalId_idx" ON "Message"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_externalId_key" ON "Message"("conversationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Sku_skuCode_key" ON "Sku"("skuCode");

-- CreateIndex
CREATE INDEX "DesignAsset_ownerType_ownerId_idx" ON "DesignAsset"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "DesignAsset_wechatAccountId_conversationId_customerId_idx" ON "DesignAsset"("wechatAccountId", "conversationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignJob_requestId_key" ON "DesignJob"("requestId");

-- CreateIndex
CREATE INDEX "DesignJob_status_createdAt_idx" ON "DesignJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DesignJob_customerId_idx" ON "DesignJob"("customerId");

-- CreateIndex
CREATE INDEX "DesignJob_conversationId_idx" ON "DesignJob"("conversationId");

-- CreateIndex
CREATE INDEX "DesignImageCandidate_designJobId_position_idx" ON "DesignImageCandidate"("designJobId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "DesignImageCandidate_designJobId_imageId_key" ON "DesignImageCandidate"("designJobId", "imageId");

-- CreateIndex
CREATE INDEX "DesignRevision_designJobId_createdAt_idx" ON "DesignRevision"("designJobId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignRevision_status_createdAt_idx" ON "DesignRevision"("status", "createdAt");

-- CreateIndex
CREATE INDEX "QuoteDraft_status_createdAt_idx" ON "QuoteDraft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "QuoteDraft_sendTaskId_idx" ON "QuoteDraft"("sendTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderDraft_quoteDraftId_key" ON "OrderDraft"("quoteDraftId");

-- CreateIndex
CREATE INDEX "OrderDraft_status_createdAt_idx" ON "OrderDraft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OrderDraft_customerId_createdAt_idx" ON "OrderDraft"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderDraft_designJobId_idx" ON "OrderDraft"("designJobId");

-- CreateIndex
CREATE INDEX "WechatSendTask_wechatAccountId_status_idx" ON "WechatSendTask"("wechatAccountId", "status");

-- CreateIndex
CREATE INDEX "WechatSendTask_conversationId_status_idx" ON "WechatSendTask"("conversationId", "status");

-- CreateIndex
CREATE INDEX "WechatSendTask_status_queuedAt_idx" ON "WechatSendTask"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "WechatSendTask_quoteDraftId_idx" ON "WechatSendTask"("quoteDraftId");

-- CreateIndex
CREATE INDEX "WechatSendAttempt_sendTaskId_startedAt_idx" ON "WechatSendAttempt"("sendTaskId", "startedAt");

-- CreateIndex
CREATE INDEX "WechatSendAttempt_status_startedAt_idx" ON "WechatSendAttempt"("status", "startedAt");

-- CreateIndex
CREATE INDEX "WechatSendAttempt_windowSnapshotId_idx" ON "WechatSendAttempt"("windowSnapshotId");

-- CreateIndex
CREATE INDEX "WechatWindowSnapshot_wechatAccountId_capturedAt_idx" ON "WechatWindowSnapshot"("wechatAccountId", "capturedAt");

-- CreateIndex
CREATE INDEX "WechatWindowSnapshot_activeConversationId_capturedAt_idx" ON "WechatWindowSnapshot"("activeConversationId", "capturedAt");

-- CreateIndex
CREATE INDEX "WechatWindowSnapshot_recentCustomerId_capturedAt_idx" ON "WechatWindowSnapshot"("recentCustomerId", "capturedAt");

-- CreateIndex
CREATE INDEX "WechatWindowSnapshot_isOnline_capturedAt_idx" ON "WechatWindowSnapshot"("isOnline", "capturedAt");

-- CreateIndex
CREATE INDEX "ReviewLog_targetType_targetId_idx" ON "ReviewLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ReviewLog_decision_createdAt_idx" ON "ReviewLog"("decision", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerServiceAgent_key_key" ON "CustomerServiceAgent"("key");

-- CreateIndex
CREATE INDEX "AgentSkill_agentId_idx" ON "AgentSkill"("agentId");

-- CreateIndex
CREATE INDEX "ChatImport_agentId_idx" ON "ChatImport"("agentId");

-- CreateIndex
CREATE INDEX "ChatImport_createdAt_idx" ON "ChatImport"("createdAt");

-- CreateIndex
CREATE INDEX "TrainingSample_agentId_status_idx" ON "TrainingSample"("agentId", "status");

-- CreateIndex
CREATE INDEX "TrainingSample_scene_idx" ON "TrainingSample"("scene");

-- CreateIndex
CREATE INDEX "TrainingSample_createdAt_idx" ON "TrainingSample"("createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_agentId_idx" ON "KnowledgeEntry"("agentId");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_sourceType_sourceId_idx" ON "KnowledgeEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "RouteEvaluation_agentId_createdAt_idx" ON "RouteEvaluation"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "RouteEvaluation_action_createdAt_idx" ON "RouteEvaluation"("action", "createdAt");

-- CreateIndex
CREATE INDEX "RouteEvaluation_scene_idx" ON "RouteEvaluation"("scene");

-- CreateIndex
CREATE UNIQUE INDEX "_DesignJobAssets_AB_unique" ON "_DesignJobAssets"("A", "B");

-- CreateIndex
CREATE INDEX "_DesignJobAssets_B_index" ON "_DesignJobAssets"("B");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_wechatAccountId_fkey" FOREIGN KEY ("wechatAccountId") REFERENCES "WechatAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignJob" ADD CONSTRAINT "DesignJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignJob" ADD CONSTRAINT "DesignJob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignJob" ADD CONSTRAINT "DesignJob_wechatAccountId_fkey" FOREIGN KEY ("wechatAccountId") REFERENCES "WechatAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignImageCandidate" ADD CONSTRAINT "DesignImageCandidate_designJobId_fkey" FOREIGN KEY ("designJobId") REFERENCES "DesignJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignRevision" ADD CONSTRAINT "DesignRevision_designJobId_fkey" FOREIGN KEY ("designJobId") REFERENCES "DesignJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignRevision" ADD CONSTRAINT "DesignRevision_selectedImageId_fkey" FOREIGN KEY ("selectedImageId") REFERENCES "DesignImageCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteDraft" ADD CONSTRAINT "QuoteDraft_designJobId_fkey" FOREIGN KEY ("designJobId") REFERENCES "DesignJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteDraft" ADD CONSTRAINT "QuoteDraft_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteDraft" ADD CONSTRAINT "QuoteDraft_selectedImageId_fkey" FOREIGN KEY ("selectedImageId") REFERENCES "DesignImageCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_quoteDraftId_fkey" FOREIGN KEY ("quoteDraftId") REFERENCES "QuoteDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_designJobId_fkey" FOREIGN KEY ("designJobId") REFERENCES "DesignJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_wechatAccountId_fkey" FOREIGN KEY ("wechatAccountId") REFERENCES "WechatAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_selectedImageId_fkey" FOREIGN KEY ("selectedImageId") REFERENCES "DesignImageCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WechatSendTask" ADD CONSTRAINT "WechatSendTask_wechatAccountId_fkey" FOREIGN KEY ("wechatAccountId") REFERENCES "WechatAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WechatSendTask" ADD CONSTRAINT "WechatSendTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WechatSendTask" ADD CONSTRAINT "WechatSendTask_designJobId_fkey" FOREIGN KEY ("designJobId") REFERENCES "DesignJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WechatSendAttempt" ADD CONSTRAINT "WechatSendAttempt_sendTaskId_fkey" FOREIGN KEY ("sendTaskId") REFERENCES "WechatSendTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WechatSendAttempt" ADD CONSTRAINT "WechatSendAttempt_windowSnapshotId_fkey" FOREIGN KEY ("windowSnapshotId") REFERENCES "WechatWindowSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WechatWindowSnapshot" ADD CONSTRAINT "WechatWindowSnapshot_wechatAccountId_fkey" FOREIGN KEY ("wechatAccountId") REFERENCES "WechatAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WechatWindowSnapshot" ADD CONSTRAINT "WechatWindowSnapshot_activeConversationId_fkey" FOREIGN KEY ("activeConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "CustomerServiceAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatImport" ADD CONSTRAINT "ChatImport_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "CustomerServiceAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSample" ADD CONSTRAINT "TrainingSample_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ChatImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSample" ADD CONSTRAINT "TrainingSample_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "CustomerServiceAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "CustomerServiceAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_trainingSampleId_fkey" FOREIGN KEY ("trainingSampleId") REFERENCES "TrainingSample"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteEvaluation" ADD CONSTRAINT "RouteEvaluation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "CustomerServiceAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DesignJobAssets" ADD CONSTRAINT "_DesignJobAssets_A_fkey" FOREIGN KEY ("A") REFERENCES "DesignAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DesignJobAssets" ADD CONSTRAINT "_DesignJobAssets_B_fkey" FOREIGN KEY ("B") REFERENCES "DesignJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
