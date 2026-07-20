"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  STATUS,
  EXIT_CODE,
  REQUIRED_ARTIFACTS,
  absoluteFrom,
  aggregateStatus,
  buildAudit,
  toMarkdown,
  writeReport,
} = require("../tools/project-completion-audit");

function write(root, relative, content = "fixture evidence\n", append = false) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (append) fs.appendFileSync(target, content, "utf8");
  else fs.writeFileSync(target, content, "utf8");
  return target;
}

function createPassingFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "completion-audit-fixture-"));
  for (const artifact of REQUIRED_ARTIFACTS) write(root, artifact.file);
  write(root, ".gitignore", "desktop/.runtime/\n");
  write(root, "desktop/package.json", JSON.stringify({ dependencies: { sharp: "0.34.5" }, scripts: {
    "release:gate": "x", "staging:readiness": "x", "database:recovery:plan": "x",
    "database:recovery:execute": "x", "package:win:test": "x", "package:win:signed": "x",
    "ci:release-quality": "x", "project:completion:audit": "x",
    "prisma:agents:init": "node tools/initialize-prisma-agents.js",
  }}));
  write(root, "desktop/electron-builder.yml", "asar: true\nextraResources:\n  - from: x\nwin:\n  target: nsis\n");
  write(root, ".github/workflows/windows-quality.yml", "permissions:\n  contents: read\nsteps:\n  persist-credentials: false\n  uses: actions/upload-artifact@v4\n");
  write(root, "desktop/packages/rules/skuImport.js", `
const SKU_IMPORT_LIMITS = {
  maxZipEntries: 256, maxZipEntryUncompressedBytes: 1, maxZipTotalUncompressedBytes: 1,
  maxSharedStrings: 1, maxWorksheetRows: 1, maxWorksheetCells: 1,
  maxXmlTagBytes: 1, maxTextRunsPerCell: 1, maxCellTextBytes: 1, maxFinalTextBytes: 1,
};
const XML_SCANNER_CONTRACT = Object.freeze({
  strategy: "forward-only-index-scanner",
  materializesMatchArrays: false,
  rejectsElementNPlusOneBeforeBodyScan: true,
});
function isCanonicalBase64() {}
function scanXmlElements(xml, tagName, options) { let count = 0; const start = findNextXmlStartTag(xml, tagName, 0, xml.length); count += 1; if (count > options.limit) throw new Error(); const openEnd = findXmlTagEnd(xml, start, xml.length); "SKU_IMPORT_XML_MALFORMED"; "SKU_IMPORT_XML_TAG_LIMIT"; "SKU_IMPORT_TEXT_RUN_LIMIT"; "SKU_IMPORT_CELL_TEXT_LIMIT"; }
function findNextXmlStartTag(xml, tagName, start, end) { const needle = tagName; let cursor = start; const found = xml.indexOf(needle, cursor); cursor = found + needle.length; }
function findXmlTagEnd() {}
function parseSkuImportFile() { "SKU_IMPORT_ZIP_BOUNDS"; "SKU_IMPORT_ZIP64_UNSUPPORTED"; "SKU_IMPORT_ZIP_MULTIDISK"; "SKU_IMPORT_ZIP_ENCRYPTED"; "SKU_IMPORT_ZIP_DESCRIPTOR"; "SKU_IMPORT_ZIP_LOCAL_OVERLAP"; "SKU_IMPORT_ZIP_CRC"; maxOutputLength: SKU_IMPORT_LIMITS.maxZipEntryUncompressedBytes; }
function buildSkuImportTemplateXlsx() {}
module.exports={ parseSkuImportFile, buildSkuImportTemplateXlsx, };
`);
  write(root, "desktop/packages/rules/index.js", "module.exports={...require('./skuImport')};\n");
  write(root, "desktop/apps/api/src/wechat/wechat-persistence.ts", 'if (this.isLocal) {}\nwechatWorkBinding; wechatWorkAuditLog; wechatSendTask;\n{ action: "inbound_processed", status: "processed" };\n{ action: "inbound_failed", status: "permanent_manual_review" };\nwechatWorkSyncCursor.updateMany();\ncompleteAttemptAndTask(); linkedTransition; tx.wechatSendTask.updateMany(); tx.wechatSendAttempt.update(); if (linked.count !== 1) throw new Error(); updateSendTaskWithLinkedTransition();\nupsertCanonicalWechatWorkBinding(); deterministicOperationId("wwacct", key); deterministicOperationId("wwcust", key); singleWechatWorkHistoryId(); for (let attempt = 0; attempt < 4; attempt += 1) {} wechat work canonical binding conflict;\n');
  write(root, "desktop/apps/api/src/wechat-work/wechat-work.service.ts", "activeCursorSyncs; getWechatWorkSyncCursor(); expectedCursor: cursor; permanent_manual_review; cursorScopeMismatch;\n");
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", 'handlePrismaInboundImageSelection(); wechatAccountId: identity.wechatAccountId; conversationId: identity.conversationId; customerId: identity.customerId; latestCandidateRound(); shouldLetQuoteAcceptanceHandleSelectionText(); high_value_customer_selected_image; designSelectionRevisionSignature();\nawait this.executeQueuedSend(freshTask.id); pendingAttempt.adapter !== "windows_bridge"; await this.resolveBridgeAckAttempt(task, payload); validatePrismaLinkedSendState(); deliveryState: "unknown"; acceptedMessageIds: apiMsgIds; bridgeAckTokenHash: hashBridgeAckToken(payload); Files remain in place until the task + attempt transition is durably committed;\n');
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", 'validateSendTask(id: string, expected: ExpectedIdentityPayload = {}) { return this.validateSendTaskWithCurrentWindow(id, expected); }\nconst activeWindow = await this.persistence.getLatestWindowSnapshot(task.wechatAccountId);\nobserverProofToken: currentWechatWindowObserverProofToken();\ncreateWechatWindowObserverAttestation();\n', true);
  write(root, "desktop/apps/api/src/wechat/wechat.controller.ts", `
@Get("accounts")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
listAccounts() {}
@Get("conversations")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
listConversations() {}
@Get("conversations/:id/messages")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
listConversationTimeline() {}
@Post("conversations/:id/read")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
markConversationMessagesRead() {}
@Get("send-tasks")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
listSendTasks() {}
@Get("send-attempts")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
listSendAttempts() {}
@Get("send-adapter")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
getSendAdapter() {}
@Get("channels/status")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
getChannelStatus() {}
@Get("bridge/outbox")
@RequireOperatorCapability("view_console")
@UseGuards(WechatBridgeAccessGuard)
listBridgeOutbox() {}
@Get("bridge/dispatch")
@RequireOperatorCapability("view_console")
@UseGuards(WechatBridgeAccessGuard)
listBridgeDispatch() {}
@Get("bridge/status")
@RequireOperatorCapability("view_console")
@UseGuards(WechatBridgeAccessGuard)
getBridgeStatus() {}
@Post("bridge/inbox/scan")
@RequireOperatorCapability("view_console")
@UseGuards(WechatBridgeAccessGuard)
scanBridgeInbox() {}
@Get("window-snapshots")
@RequireOperatorCapability("view_console")
@UseGuards(WechatWindowObserverAccessGuard)
listWindowSnapshots() {}
@Get("window-observer/status")
@RequireOperatorCapability("view_console")
@UseGuards(WechatWindowObserverAccessGuard)
getWindowObserverStatus() {}
@Post("window-snapshots/inbox/scan")
@RequireOperatorCapability("view_console")
@UseGuards(WechatWindowObserverAccessGuard)
scanWindowSnapshotInbox() {}
@Post("inbound/messages")
@RequireOperatorCapability("approve_send")
@UseGuards(OperatorAccessGuard)
processInboundMessage(@Body() payload, @TrustedOperator() _principal) {}
@Post("send-tasks/:id/bridge-ack")
acknowledgeBridgeSend() {}
validateSendTask(
  @Param("id") id: string,
  @Body() payload: ExpectedIdentityPayload,
) {}
`);
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", 'queueOrderConfirmationWithProvenance(orderDraftId, manualOrderQueueRequest(payload), null);\nqueueLowValueOrderConfirmation();\nqueueOrderFollowupWithProvenance(orderDraftId, manualOrderQueueRequest(payload), null);\nqueueLowValueOrderFollowup();\nbuildLowValueOrderAutomation();\norderDraftId: String(order.id);\nquoteDraftId: String(order.quoteDraftId || "");\nqueuedBy: "low_value_automation";\nfunction manualOrderQueueRequest() {}\n', true);
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", 'buildOrderSendContext();\norderContext: params.orderContext;\nthis.orderSendContext(task);\n', true);
  write(root, "desktop/apps/api/src/wechat/wechat.controller.ts", 'queueOrderConfirmation(id, { expectedWechatAccountId: payload?.expectedWechatAccountId, expectedConversationId: payload?.expectedConversationId, expectedCustomerId: payload?.expectedCustomerId, owner: principal.id });\nqueueOrderFollowup(id, { expectedWechatAccountId: payload?.expectedWechatAccountId, expectedConversationId: payload?.expectedConversationId, expectedCustomerId: payload?.expectedCustomerId, type: payload?.type, owner: principal.id });\nsetConversationManualLock(id, { expectedWechatAccountId: payload?.expectedWechatAccountId, expectedConversationId: payload?.expectedConversationId, expectedCustomerId: payload?.expectedCustomerId, locked: payload?.locked, reviewer: principal.id, reason: payload?.reason, note: payload?.note });\n', true);
  write(root, "desktop/packages/rules/wechatWindowEvidence.js", 'WECHAT_WINDOW_OBSERVER_ATTESTATION_VERSION; createWechatWindowObserverAttestation(); createHmac("sha256", token); timingSafeEqual(supplied, expected); canonicalObserverAttestation(); canonicalJsonObject();\n');
  write(root, "desktop/apps/api/src/orders/orders.service.ts", 'updatePrismaOrderAndQuoteWithSendInvalidation();\nreturn prisma.$transaction(async (tx: any) => {\ntx.quoteDraft.update();\nstatus: { in: ["queued", "blocked", "failed"] };\ntx.wechatSendTask.updateMany();\ninvalidationStateChanged || cancelledSendTasks.length > 0;\ndecision: "invalidate_pending_order_send_tasks";\nreviewer: "system_order_invalidation";\n});\nasync update(id, patch) { assertGenericOrderUpdatePatch(patch || {}); }\nasync recordVerifiedPayment() { return ["deposit_paid", "paid"]; }\nfunction guard(patch) { if (Object.prototype.hasOwnProperty.call(patch, "paymentStatus")) throw new Error("订单付款状态只能通过报价付款凭证核验入口更新"); }\n');
  write(root, "desktop/README.md", "npm run project:completion:audit\ndhash64:v1\nlegacyIdentityHash\n稳定 SHA-256 身份哈希\n");
  write(root, "docs/PRODUCTION_RELEASE_CHECKLIST.md", "npm run project:completion:audit\nnpm run package:win:signed\nnpm run database:recovery:execute\n真实签名证据保持 BLOCKED\n");
  write(root, "desktop/apps/api/src/automation/automation-queue.runtime.ts", 'import { Queue, Worker } from "bullmq";\nnew Queue("x", { connection: {} }); new Worker("x", async()=>{}, { connection: {} });\n');
  write(root, "desktop/apps/api/src/automation/automation-scheduler.service.ts", 'lowValueAutomationMode === "durable"; bullmq_redis; readiness();\n');
  write(root, "desktop/apps/api/src/prisma/prisma-operations.service.ts", 'listAgents(); listAgentSkills(); createRouteEvaluation(); correctRouteEvaluation(); reviewTrainingSample(); applyAgentSkillSuggestions(); listConversations(); listConversationAudit(); updateConversationOperations(); routingCorrectionRequestKey(); before.correction?.requestKey === requestKey; trainingSample.findFirst(); knowledgeEntry.findFirst(); correctionRequestKey: requestKey; TransactionIsolationLevel.Serializable; NotFoundException; BadRequestException; deterministicOperationId("import", operationKey); deterministicOperationId("sample", operationKey, pairIndex); deterministicOperationId("knowledge", operationKey, pairIndex); isUniqueConstraintError(error); replayChatImport();\nasync createChatImport(payload: any, parsed: any) { const existing = await tx.chatImport.findUnique({ where: { id: importId } }); if (existing) { assertStoredOperationIdentityReplay(); return this.replayChatImport(existing, operation); } const identity = await this.resolveIdentity(tx, payload, "chat import"); }\n');
  write(root, "desktop/apps/api/src/shared/operation-idempotency.ts", "const OPERATION_KEY_MIN_LENGTH = 16; const OPERATION_KEY_MAX_LENGTH = 128; createOperationFingerprint(); deterministicOperationId(); assertStoredOperationIdentityReplay(); OPERATION_KEY_REUSED;\n");
  write(root, "desktop/tools/initialize-prisma-agents.js", 'const execute=process.argv.includes("--execute");\nconst requiredConfirmation="INITIALIZE_PRISMA_AGENTS";\nif (!execute) { console.log({status:"PLAN", writesExecuted:false}); process.exit(0); }\nif (confirmation !== requiredConfirmation) throw new Error("refusing");\ninitializePrismaAgentData().catch(() => { process.stderr.write("failed; inspect protected deployment logs"); });\n');
  write(root, "desktop/apps/api/src/agents/agents.service.ts", "PrismaOperationsService; appConfig.useLocalStore; this.requirePrisma().listAgents(); this.requirePrisma().listAgentSkills();\n");
  write(root, "desktop/apps/api/src/routing/routing.service.ts", "PrismaOperationsService; if (!appConfig.useLocalStore) this.evaluatePrisma(); correctRouteEvaluation(); notifyCorrectionBestEffort(); notification delivery is non-authoritative; NotFoundException;\n");
  write(root, "desktop/apps/api/src/quotes/quotes.service.ts", 'async update(id, patch) { assertGenericQuoteUpdatePatch(patch || {}); }\nfunction guard(patch) { if (Object.prototype.hasOwnProperty.call(patch, "paymentStatus")) throw new Error("报价付款状态只能通过付款凭证核验入口更新"); }\nupdateQuoteDraft(id, { ...payload, ...quotePatch }, true); orders.recordVerifiedPayment();\n');
  write(root, "desktop/apps/api/src/quotes/quotes.service.ts", 'queueSendWithProvenance(id, manualQuoteQueueRequest(options), false);\nqueueSendWithProvenance(id, manualQuoteQueueRequest(options), true);\nsource: "low_value_quote_send"; quoteDraftId: quote.id; queuedBy: "low_value_automation"; automation: trustedAutomation;\nfunction manualQuoteQueueRequest() {}\n', true);
  write(root, "desktop/apps/api/src/local-store/local-store.service.ts", 'routingCorrectionRequestKey(); before.correction?.requestKey === requestKey; correctionRequestKey: requestKey; throw new NotFoundException(`route evaluation not found: ${id}`); throw new BadRequestException(`agent not found: ${key}`);\ncreateChatImport(payload: any, parsed: any) { const existing = data.chatImports.find((item) => item.id === importId); if (existing) { assertStoredOperationIdentityReplay(); return { ...existing, samples: existingSamples }; } const identity = this.validateOptionalConversationBinding(data, payload, "chat import"); }\n');
  write(root, "desktop/apps/web/src/features/sales/sales-order-edit-page.tsx", '付款状态（只读）; 负责人（可信会话记录）; 需从报价页核验付款凭证;\n');
  write(root, "desktop/apps/api/src/training/training.service.ts", "PrismaOperationsService; listSamplesPrisma(); getOverviewPrisma(); reviewSamplePrisma(); listSkillSuggestionsPrisma(); applySkillSuggestionsPrisma();\n");
  write(root, "desktop/apps/api/src/conversation-ops/conversation-operations.service.ts", "PrismaOperationsService; if (!appConfig.useLocalStore) return this.listQueuePrisma(); if (!appConfig.useLocalStore) return this.listAuditPrisma(); if (!appConfig.useLocalStore) return this.updateConversationPrisma(); this.requirePrisma().updateConversationOperations();\n");
  write(root, "desktop/apps/api/src/conversation-ops/conversation-operations.controller.ts", `
@Controller("conversation-ops")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class ConversationOperationsController {
  @Get("queue")
  listQueue() {}

  @Patch("conversations/:id")
  @RequireOperatorCapability("manage_assignments")
  updateConversation() {}
}
`);
  write(root, "desktop/apps/api/src/automation/automation.service.ts", "listAutomationRuns(); saveAutomationRun();\n");
  write(root, "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.service.ts", "REGISTRY_VERSION; readRegistryState(); writeRegistryDocument(); PersonalWechatRpaPersistence; this.persistence.listBindings(); this.persistence.listAudit(); this.persistence.upsertBinding(); this.persistence.recordAudit(); assertProductionIdentity();\n");
  write(root, "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.persistence.ts", "prisma.$transaction(); hydrateBinding(); sanitizeError();\n");
  write(root, "desktop/prisma/schema.prisma", "enum ConversationChannel { personal_wechat work_wechat }\nmodel PersonalWechatRpaBinding {}\nmodel PersonalWechatRpaAuditLog {}\nmodel WechatWorkSyncCursor {}\nmodel SkuChangeLog { changedFields Json before Json? }\nmodel DesignAsset { normalizedLocalPath String? @unique }\npersonalWechatOwnerWxId String? @unique\npersonalWechatRpaBindingKey String? @unique\n");
  write(root, "desktop/apps/api/src/catalog/catalog.service.ts", 'this.prisma.$transaction(); tx.skuChangeLog.create(); changedFields; reason: context.reason; reason: "no_change"; skuChangeLog.findMany();\n');
  write(root, "desktop/apps/api/src/assets/assets.service.ts", 'normalizedLocalPath; await fs.realpath(input); local asset path must be absolute; this.prisma.conversation.findFirst(); normalizedLocalPath: normalized; ambiguous persisted identities; no unambiguous persisted identity;\n');
  write(root, "desktop/apps/api/src/storage/storage.service.ts", 'MAX_IMAGE_FINGERPRINT_BYTES; assertAssetSize(decodeBase64(params.base64)); Buffer.byteLength(params.text, "utf8"); normalizeAssetUrl(params.url); timeout: appConfig.designPlatformTimeoutMs; maxContentLength: MAX_IMAGE_FINGERPRINT_BYTES; maxBodyLength: MAX_IMAGE_FINGERPRINT_BYTES; isCanonicalBase64Text; asset URL must use http(s); inspectSafeAssetContent(); downloadBoundedBytes(); assertCanonicalStoragePath();\n');
  write(root, "desktop/apps/api/src/storage/safe-download.ts", 'resolvePublicDownloadTarget(); if (url.username || url.password) throw new Error(); lookup(hostname, { all: true, verbatim: true }); resolved.some((item) => !isPublicAddress(item.address)); createPinnedLookup(); maxRedirects: 0; proxy: false; 169.254.0.0; 2001:db8::;\n');
  write(root, "desktop/apps/api/src/storage/asset-content-security.ts", 'sharp(buffer); %PDF-; ACTIVE_PDF_PATTERN; new TextDecoder("utf-8", { fatal: true }); ACTIVE_TEXT_PATTERN; asset fileName extension does not match file content; asset mimeType does not match file content; kind: "pdf", mimeType: "application/pdf", extension: ".pdf", inlineSafe: false;\n');
  write(root, "desktop/apps/api/src/storage/local-file-response.ts", 'X-Content-Type-Options; nosniff; Content-Security-Policy; sandbox; Content-Disposition; "attachment";\n');
  write(root, "desktop/docs/DESIGN_PLATFORM_CONTRACT.md", "DNS rebinding; Content-Disposition; realpath; 不再作为“部署侧未决”项冒充已完成;\n");
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.service.ts", 'buildLegacyImageIdentityHash(); legacyIdentityHash; normalizeOperationKey(payload?.operationKey); findUnique({ where: { requestId } }); isUniqueConstraintError(error); activeCreateEffectPromises; requirements.createEffects; effectKey: `${effectRoot}:handoff-review`; completedAt: new Date().toISOString(); deterministicOperationId("review", effectKey);\nasync create(payload: CreateDesignJobPayload) { const existing = findUnique({ where: { requestId } }); if (existing) return this.completeDesignJobCreateEffects(existing, operation, readiness); const identity = await this.validateCreateIdentity(payload); }\n');
  write(root, "desktop/apps/api/src/shared/image-fingerprint.ts", 'import sharp from "sharp";\nconst IMAGE_FINGERPRINT_ALGORITHM = "dhash64:v1";\nsharp().rotate().flatten({}).greyscale().resize(9, 8);\n');
  write(root, "desktop/apps/api/src/wechat-work/wechat-work-api.client.ts", 'fetch(`/cgi-bin/media/get?media_id=${encodeURIComponent(mediaId)}`); errcode === 40007; errcode === 41006; errcode === 45009; retry_exhausted;\n');
  write(root, "desktop/apps/api/src/wechat-work/wechat-work-inbound-media.ts", 'MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES; LOCAL_STORAGE_ROOT; fs.link(temporaryPath, finalPath); inspectExistingImage();\n');
  write(root, "desktop/packages/rules/selectionMatcher.js", 'hammingDistance(); nearest.distance > 1; gap < 2; "候选图存在缺失或旧版指纹";\n');
  write(root, "desktop/tests/wechat-prisma-send-parity.test.js", "Prisma send safety parity tests\n");
  write(root, "desktop/prisma/migrations/20260719233000_design_platform_execution_durability/migration.sql", "CREATE TABLE \"DesignPlatformExecution\" ();\n");
  write(root, "desktop/tests/design-platform-execution-durability.test.js", "durable design execution behavior tests\n");
  write(root, "desktop/apps/api/src/design-jobs/design-platform-execution.service.ts", `
class DesignPlatformExecutionService {
  async begin() {}
  async claimDispatch() {}
  async markGenerating() {}
  async listPublicForDesignJob(designJobId: string) { return rows.map(toPublicExecutionView); }
  async resolveUnknown() { return row; }
  async resolveUnknownPublic(executionId, resolution, reviewer) {
    return toPublicExecutionView(await this.resolveUnknown(executionId, resolution, reviewer));
  }
  async resolveUnsafeRefund() {
    const resumableCompleted = isResumableCompletedExecution(execution);
    if (!isUnsafeRefundResolutionEligible(execution)) throw new Error("unsafe refund only");
    return {
      ...(resumableCompleted ? { acceptanceStatus: "pending" } : {}),
      resolvedAt: resumableCompleted ? null : new Date(),
    };
  }
  async resolveUnsafeRefundPublic(executionId, resolution, reviewer) {
    return toPublicExecutionView(await this.resolveUnsafeRefund(executionId, resolution, reviewer));
  }
  recoverStaleExecutions() {}
  commitAcceptedResult() { designImageCandidate.upsert(); throw new Error("design platform acceptance CAS failed"); }
  marker() { return { status: "outcome_unknown" }; }
}
function toPublicExecutionView(execution) {
  const availableResolution = execution.status === "outcome_unknown"
    ? "confirmed_not_generated_refunded"
    : isUnsafeRefundResolutionEligible(execution)
      ? "confirmed_refunded"
      : null;
  return {
    id: execution.id, attemptNo: execution.attemptNo, status: execution.status,
    acceptanceStatus: execution.acceptanceStatus, refundStatus: execution.refundStatus,
    imageCount: execution.imageCount, errorCategory: execution.errorCategory,
    responseHttpStatus: execution.responseHttpStatus, createdAt: execution.createdAt,
    updatedAt: execution.updatedAt, completedAt: execution.completedAt,
    resolvedAt: execution.resolvedAt, availableResolution,
  };
}
function isUnsafeRefundResolutionEligible(execution) {
  return Boolean(
    execution
    && (execution.status === "explicit_failed" || isResumableCompletedExecution(execution))
    && ["failed", "unknown"].includes(execution.refundStatus),
  );
}
function isResumableCompletedExecution(execution) {
  return execution?.status === "completed" && execution?.acceptanceStatus === "manual_review";
}
"explicit confirmed_not_generated_refunded resolution and reviewer are required";
"design platform execution outcome requires explicit manual resolution before retry";
`);
  write(root, "desktop/apps/api/src/integrations/design-platform/design-platform.client.ts", 'requestId: externalJobId; MALFORMED_SUCCESS_RESPONSE; ECONNABORTED; ECONNRESET; Number(error.response?.status || 0) >= 500; art_image_local results must be read from durable execution; maxRedirects: 0; config.maxRedirects = 0; assertTrustedDesignPlatformTarget(config.baseURL, config.url); config.adapter = this.guardedAdapter; config.transformRequest = copyTransform(trustedTransformRequest); delete config.transport; config.proxy = false; AxiosHeaders.from(config.headers); headers.delete("Authorization"); createForTesting(transport: AxiosAdapter); response.status >= 300 && response.status < 400; DESIGN_PLATFORM_REDIRECT_BLOCKED;\n');
  write(root, "desktop/apps/web/src/lib/desktop-session-proof.ts", 'DESKTOP_SESSION_COOKIE; timingSafeEqual(); requiresDesktopSessionProof(); return true; headers.delete("cookie"); headers.set(internalApiTokenHeader, internalApiToken);\n');
  write(root, "desktop/apps/api/src/shared/app-config.ts", 'DESIGN_PLATFORM_ALLOWED_ORIGINS; designPlatformAccessTokenOrigin; designPlatformCookieOrigin; designPlatformApiKeyOrigin; designPlatformDeviceIdOrigin; hasIndependentDesignPlatformCallbackApiKey(); timingSafeEqual();\n');
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.service.ts", `
buildLegacyImageIdentityHash(); legacyIdentityHash; design_platform_callback_auth;
hasIndependentDesignPlatformCallbackApiKey(); severity: "error"; assertDesignPlatformPreflight();
normalizeOperationKey(payload?.operationKey); findUnique({ where: { requestId } }); isUniqueConstraintError(error); activeCreateEffectPromises; requirements.createEffects; effectKey: \`\${effectRoot}:handoff-review\`; completedAt: new Date().toISOString(); deterministicOperationId("review", effectKey);
async create(payload: CreateDesignJobPayload) { const existing = findUnique({ where: { requestId } }); if (existing) return this.completeDesignJobCreateEffects(existing, operation, readiness); const identity = await this.validateCreateIdentity(payload); }
class DesignJobsService {
  async listExecutions(id, expected) {
    if (!expected.expectedWechatAccountId || !expected.expectedConversationId || !expected.expectedCustomerId) throw new Error("complete identity required");
    const job = await this.getById(id);
    assertExpectedIdentity(job, expected);
    return this.designPlatformExecutions.listPublicForDesignJob(id);
  }
  async resolveUnknownExecution() {
    return this.designPlatformExecutions.resolveUnknownPublic(execution.id, payload.resolution, reviewer);
  }
  async resolveExecutionRefund() {
    return this.designPlatformExecutions.resolveUnsafeRefundPublic(execution.id, payload.resolution, reviewer);
  }
}
`);
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.controller.ts", `
@Controller("design-jobs")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class DesignJobsController {
  localImageFile(reply, file) { applySafeLocalFileHeaders(reply, file); }
  @Get(":id/executions")
  listExecutions(
    @Param("id") id,
    @Query("expectedWechatAccountId") expectedWechatAccountId,
    @Query("expectedConversationId") expectedConversationId,
    @Query("expectedCustomerId") expectedCustomerId,
  ) { return this.designJobs.listExecutions(id, { expectedWechatAccountId, expectedConversationId, expectedCustomerId }); }

  @Post(":id/executions/:executionId/resolve-unknown")
  @RequireOperatorCapability("manage_design_executions")
  resolveUnknownExecution(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trustedBody } = body;
    return this.designJobs.resolveUnknownExecution(id, executionId, trustedBody, principal.id);
  }

  @Post(":id/executions/:executionId/resolve-refund")
  @RequireOperatorCapability("manage_design_executions")
  resolveExecutionRefund(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trustedBody } = body;
    return this.designJobs.resolveExecutionRefund(id, executionId, trustedBody, principal.id);
  }

  @Post(":id/quick-confirm-send")
  @RequireOperatorCapability("approve_send")
  quickConfirmSend() {}
}
`);
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.types.ts", `
export type ResolveUnknownDesignExecutionPayload = {
  resolution: "confirmed_not_generated_refunded";
};
export type ResolveDesignExecutionRefundPayload = {
  resolution: "confirmed_refunded";
};
export type DesignExecutionAvailableResolution =
  | "confirmed_not_generated_refunded"
  | "confirmed_refunded"
  | null;
export type DesignPlatformExecutionView = {
  id: string;
  attemptNo: number;
  status: string;
  acceptanceStatus: string;
  refundStatus: string;
  imageCount: number;
  errorCategory: string | null;
  responseHttpStatus: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  resolvedAt: string | null;
  availableResolution: DesignExecutionAvailableResolution;
};
`);
  write(root, "desktop/apps/web/src/components/design-execution-reconciliation-panel.tsx", `
export const DESIGN_EXECUTION_RESOLUTIONS = {
  unknown: "confirmed_not_generated_refunded",
  refund: "confirmed_refunded",
} as const;
async function confirmResolution() {
  if (!pending || submitLock.current || submittingId || !canManageExecutions) return;
  submitLock.current = true;
  if (pending.resolution === DESIGN_EXECUTION_RESOLUTIONS.unknown) await onResolveUnknown();
  else if (pending.resolution === DESIGN_EXECUTION_RESOLUTIONS.refund) await onResolveRefund();
  await onRefresh();
  return <div role="alertdialog" />;
}
function resolutionAction(resolution) {
  if (resolution === DESIGN_EXECUTION_RESOLUTIONS.unknown) return { resolution };
  if (resolution === DESIGN_EXECUTION_RESOLUTIONS.refund) return { resolution };
  return null;
}
resolutionAction(execution.availableResolution);
`);
  write(root, "desktop/apps/web/src/lib/api.ts", `
function postJsonWithNetworkRetry(path, body) { const serializedBody = JSON.stringify(body); }
function createClientOperationKey() {}
const requestPayload: { operationKey: string } = {};
export async function createDemoDesignJob(identity, assetIds, operationKey: string) {}
function designExecutionExpectedIdentityQuery(expected) {
  const params = new URLSearchParams();
  params.set("expectedWechatAccountId", expected.expectedWechatAccountId);
  params.set("expectedConversationId", expected.expectedConversationId);
  params.set("expectedCustomerId", expected.expectedCustomerId);
  return params;
}
export async function getDesignJobExecutions(id, expected) {
  return fetch(\`/design-jobs/\${encodeURIComponent(id)}/executions?\${designExecutionExpectedIdentityQuery(expected)}\`);
}
export async function resolveUnknownDesignExecution(designJobId, executionId, expected) {
  return post(\`/design-jobs/\${encodeURIComponent(designJobId)}/executions/\${encodeURIComponent(executionId)}/resolve-unknown\`,
    { ...expected, resolution: "confirmed_not_generated_refunded" });
}
export async function resolveDesignExecutionRefund(designJobId, executionId, expected) {
  return post(\`/design-jobs/\${encodeURIComponent(designJobId)}/executions/\${encodeURIComponent(executionId)}/resolve-refund\`,
    { ...expected, resolution: "confirmed_refunded" });
}
`);
  write(root, "desktop/apps/web/src/lib/client-operation-key.ts", `
function reserveClientOperation(scope, payload, pending) {
  const payloadSignature = stableClientPayload(payload);
  if (pending?.scope === scope && pending.payloadSignature === payloadSignature) return pending;
}
function completeClientOperation(pending, completedKey) { return pending?.key === completedKey ? null : pending; }
function stableClientPayload(value) { return Object.keys(value).sort(); }
`);
  write(root, "desktop/apps/web/src/features/training/training-import-page.tsx", `
const pendingImportOperation = useRef<PendingClientOperation | null>(null);
const operation = reserveClientOperation("training-import", requestPayload, pendingImportOperation.current);
await importChatTranscript({ operationKey: operation.key });
pendingImportOperation.current = completeClientOperation(pendingImportOperation.current, operation.key);
`);
  write(root, "desktop/apps/api/src/wechat-work/wechat-work.controller.ts", `
@Controller("wechat-work")
export class WechatWorkController {
  @Get("status") status() {}
  @Get("preflight") preflight() {}
  @Get("callback") verifyCallback() {}
  @Post("callback") handleCallback() {}
  @Post("kf/sync")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  sync() {}
  @Post("kf/send-text")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  sendText() {}
  @Post("kf/send-images")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  sendImages() {}
  @Post("kf/send-tasks/:id/dispatch")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  dispatch() {}
  @Get("kf/audit")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  audit() {}
}
`);
  write(root, "desktop/apps/api/src/reviews/reviews.controller.ts", `
@Controller("reviews")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class ReviewsController {
  @Get() list() {}
  @Post("design-jobs/:id")
  @RequireOperatorCapability("approve_send")
  reviewDesign(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
  @Post("quotes/:id")
  @RequireOperatorCapability("approve_send")
  reviewQuote(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
  @Post("orders/:id")
  @RequireOperatorCapability("approve_send")
  reviewOrder(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
}
`);
  write(root, "desktop/apps/api/src/quotes/quotes.controller.ts", `
@Controller("quotes")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class QuotesController {
  @Post(":id/update")
  @RequireOperatorCapability("manage_design_executions")
  update(@Body() body, @TrustedOperator() principal) {
    const { owner: _untrustedOwner, ...trusted } = body;
    return service({ ...trusted, owner: principal.id });
  }
  @Post(":id/revise-selection")
  @RequireOperatorCapability("manage_design_executions")
  revise(@Body() body, @TrustedOperator() principal) {
    const { owner: _untrustedOwner, ...trusted } = body;
    return service({ ...trusted, owner: principal.id });
  }
  @Post(":id/queue-send")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  queueSend(id, @Body() payload, @TrustedOperator() principal) {
    return this.quotes.queueSend(id, {
      expectedWechatAccountId: payload?.expectedWechatAccountId,
      expectedConversationId: payload?.expectedConversationId,
      expectedCustomerId: payload?.expectedCustomerId,
      note: payload?.note,
      owner: principal.id,
      releaseManualLock: true,
      releaseReason: "manual_quote_send",
    });
  }
  @Post(":id/verify-payment-proof")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  verify(@Body() body, @TrustedOperator() principal) {
    const { owner: _untrustedOwner, ...trusted } = body;
    return service({ ...trusted, owner: principal.id });
  }
}
`);
  write(root, "desktop/apps/api/src/assets/assets.controller.ts", `
@Controller("assets")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AssetsController {
  localFile(reply, file) { applySafeLocalFileHeaders(reply, file); }
  @Post("upload")
  @RequireOperatorCapability("manage_design_executions")
  upload() {}
  @Post("demo-customer-logo")
  @RequireOperatorCapability("manage_design_executions")
  demo() {}
}
`);
  write(root, "desktop/apps/api/src/agents/agents.controller.ts", `
@Controller("agents")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AgentsController { @Get() list() {} }
`);
  write(root, "desktop/apps/api/src/ai/ai-provider.controller.ts", `
@Controller("ai/providers")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AiProviderController { @Get("status") status() {} }
`);
  write(root, "desktop/apps/api/src/catalog/catalog.controller.ts", `
@Controller("catalog")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class CatalogController {
  @Post("skus/demo-images") @RequireOperatorCapability("manage_design_executions") demo() {}
  @Post("skus") @RequireOperatorCapability("manage_design_executions") upsert() {}
  @Post("skus/batch-update") @RequireOperatorCapability("manage_design_executions") batch() {}
  @Post("skus/:skuCode/deactivate") @RequireOperatorCapability("manage_design_executions") deactivate() {}
  @Post("skus/:skuCode/restore") @RequireOperatorCapability("manage_design_executions") restore() {}
  @Post("skus/bulk") @RequireOperatorCapability("manage_design_executions") bulk() {}
  @Post("skus/import-text") @RequireOperatorCapability("manage_design_executions") importText() {}
  @Post("skus/import-file") @RequireOperatorCapability("manage_design_executions") importFile() {}
}
`);
  write(root, "desktop/apps/api/src/notifications/notifications.controller.ts", `
@Controller("notifications")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class NotificationsController {
  @Post("demo")
  @RequireOperatorCapability("manage_training")
  demo() {}
}
`);
  write(root, "desktop/apps/api/src/orders/orders.controller.ts", `
@Controller("orders")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class OrdersController {
  @Post("from-quote/:quoteId") @RequireOperatorCapability("manage_design_executions") create() {}
  @Post(":id/update")
  @RequireOperatorCapability("manage_design_executions")
  update(@Body() body, @TrustedOperator() principal) {
    const { owner: _untrustedOwner, ...trusted } = body;
    return service({ ...trusted, owner: principal.id });
  }
  @Post(":id/revise-selection")
  @RequireOperatorCapability("manage_design_executions")
  revise(@Body() body, @TrustedOperator() principal) {
    const { owner: _untrustedOwner, ...trusted } = body;
    return service({ ...trusted, owner: principal.id });
  }
}
`);
  write(root, "desktop/apps/api/src/routing/routing.controller.ts", `
@Controller("routing")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class RoutingController {
  @Post("evaluate")
  @RequireOperatorCapability("manage_training")
  evaluate() {}
  @Post("evaluations/:id/correct")
  @RequireOperatorCapability("manage_training")
  correct(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
}
`);
  write(root, "desktop/apps/api/src/automation/automation.controller.ts", `
@Controller("automation")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AutomationController {
  @Get("status") status() {}
  @Post("run-once")
  @RequireOperatorCapability("approve_send")
  runOnce() {}
  @Post("start")
  @RequireOperatorCapability("approve_send")
  start() {}
  @Post("stop")
  @RequireOperatorCapability("approve_send")
  stop() {}
}
`);
  write(root, "desktop/apps/api/src/training/training.controller.ts", `
@Controller("training")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class TrainingController {
  @Get("samples") list() {}
  @Post("chat-imports")
  @RequireOperatorCapability("manage_training")
  importChat() {}
  @Post("samples/:id/review")
  @RequireOperatorCapability("manage_training")
  review(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
  @Post("samples/batch-review")
  @RequireOperatorCapability("manage_training")
  batch(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
  @Post("skill-suggestions/apply")
  @RequireOperatorCapability("manage_training")
  apply() {}
}
`);
  write(root, "desktop/prisma/schema.prisma", "enum ConversationChannel { personal_wechat work_wechat }\nmodel PersonalWechatRpaBinding {}\nmodel PersonalWechatRpaAuditLog {}\nmodel WechatWorkSyncCursor {}\nmodel SkuChangeLog { changedFields Json before Json? }\nmodel DesignAsset { normalizedLocalPath String? @unique }\nmodel DesignPlatformExecution { operationKey String @unique requestId String @unique scopeKey String processRunId String acceptanceStatus DesignPlatformAcceptanceStatus refundStatus DesignPlatformRefundStatus }\nenum DesignPlatformExecutionStatus { outcome_unknown explicit_failed cancel_requested }\npersonalWechatOwnerWxId String? @unique\npersonalWechatRpaBindingKey String? @unique\n");
  write(root, "core/channel_registry.py", 'SUPPORTED_CHANNELS = {"x": ChannelSpec(status="planned")}\nif channel_id != "wechat":\n print("adapter is planned but not implemented; skipped.")\nreturn DisabledChannelAdapter(spec, reason="adapter not implemented")\n');
  write(root, "docs/PROJECT_LANDING_ROADMAP.md", "抖音、小红书、拼多多、淘宝、快手目前是规划渠道，不能假装已接通。\n");
  return root;
}

test("completion audit fixture reaches local PASS without network, commands or secret reads", () => {
  const root = createPassingFixture();
  write(root, ".env", "INTERNAL_API_TOKEN=never-include-this-secret\n");
  const report = buildAudit(root, { includeExternal: false });
  assert.equal(report.schemaVersion, "smart_kefu_project_completion_audit_v3");
  assert.equal(report.status, STATUS.PASS, JSON.stringify(report.results.filter((item) => item.status === STATUS.FAIL)));
  assert.deepEqual(report.safety, {
    networkCalls: false,
    commandsExecuted: false,
    externalWrites: false,
    secretFilesRead: false,
    realMessageSendAttempted: false,
    databaseConnectionAttempted: false,
    reportContainsSecrets: false,
  });
  assert.ok(report.results.every((item) => item.status === STATUS.PASS));
  assert.equal(JSON.stringify(report).includes("never-include-this-secret"), false);
  assert.equal(JSON.stringify(report).includes(path.resolve(root)), false);
  const source = fs.readFileSync(path.resolve(__dirname, "../tools/project-completion-audit.js"), "utf8");
  assert.doesNotMatch(source, /node:child_process|\bspawnSync\b|\bexecFileSync\b|\bfetch\s*\(|require\(["']node:https?["']\)|process\.env/);
});

test("idempotency audit rejects mutable-identity-first replay and browser operation-key drift", () => {
  const mutations = [
    {
      id: "contract.design_job_create_idempotency",
      file: "desktop/apps/api/src/design-jobs/design-jobs.service.ts",
      from: "const existing = findUnique({ where: { requestId } }); if (existing) return this.completeDesignJobCreateEffects(existing, operation, readiness); const identity = await this.validateCreateIdentity(payload);",
      to: "const identity = await this.validateCreateIdentity(payload); const existing = findUnique({ where: { requestId } }); if (existing) return existing;",
    },
    {
      id: "contract.local_chat_import_existing_first",
      file: "desktop/apps/api/src/local-store/local-store.service.ts",
      from: "const existing = data.chatImports.find((item) => item.id === importId); if (existing) { assertStoredOperationIdentityReplay(); return { ...existing, samples: existingSamples }; } const identity = this.validateOptionalConversationBinding(data, payload, \"chat import\");",
      to: "const identity = this.validateOptionalConversationBinding(data, payload, \"chat import\"); const existing = data.chatImports.find((item) => item.id === importId); if (existing) return existing;",
    },
    {
      id: "contract.training_import_idempotency",
      file: "desktop/apps/api/src/prisma/prisma-operations.service.ts",
      from: "const existing = await tx.chatImport.findUnique({ where: { id: importId } }); if (existing) { assertStoredOperationIdentityReplay(); return this.replayChatImport(existing, operation); } const identity = await this.resolveIdentity(tx, payload, \"chat import\");",
      to: "const identity = await this.resolveIdentity(tx, payload, \"chat import\"); const existing = await tx.chatImport.findUnique({ where: { id: importId } }); if (existing) return existing;",
    },
    {
      id: "contract.web_create_operation_retry",
      file: "desktop/apps/web/src/lib/api.ts",
      from: "operationKey: string",
      to: 'operationKey = createClientOperationKey("design-job")',
    },
    {
      id: "contract.training_import_operation_lifecycle",
      file: "desktop/apps/web/src/features/training/training-import-page.tsx",
      from: "await importChatTranscript({ operationKey: operation.key });\npendingImportOperation.current = completeClientOperation(pendingImportOperation.current, operation.key);",
      to: "pendingImportOperation.current = completeClientOperation(pendingImportOperation.current, operation.key);\nawait importChatTranscript({ operationKey: operation.key });",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.match(source, new RegExp(mutation.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === mutation.id).status, STATUS.FAIL, mutation.id);
  }
});

test("asset ingestion audit contract fails when bounded input markers drift", () => {
  const baselineRoot = createPassingFixture();
  const baseline = buildAudit(baselineRoot, { includeExternal: false });
  assert.equal(baseline.results.find((item) => item.id === "contract.asset_ingestion_limits").status, STATUS.PASS);

  const mutations = [
    { name: "shared byte limit", from: "MAX_IMAGE_FINGERPRINT_BYTES", to: "LEGACY_IMAGE_LIMIT", all: true },
    {
      name: "base64 decoded byte assertion",
      from: "assertAssetSize(decodeBase64(params.base64))",
      to: "decodeBase64(params.base64)",
    },
    { name: "UTF-8 text byte count", from: 'Buffer.byteLength(params.text, "utf8")', to: "params.text.length" },
    { name: "URL protocol normalization", from: "normalizeAssetUrl(params.url)", to: "params.url" },
    {
      name: "download timeout",
      from: "timeout: appConfig.designPlatformTimeoutMs",
      to: "timeout: 0",
    },
    {
      name: "download content length",
      from: "maxContentLength: MAX_IMAGE_FINGERPRINT_BYTES",
      to: "maxContentLength: Infinity",
    },
    {
      name: "download body length",
      from: "maxBodyLength: MAX_IMAGE_FINGERPRINT_BYTES",
      to: "maxBodyLength: Infinity",
    },
    { name: "canonical base64 validation", from: "isCanonicalBase64Text", to: "isBase64Text" },
    { name: "HTTP(S) URL restriction", from: "asset URL must use http(s)", to: "asset URL is invalid" },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, "desktop", "apps", "api", "src", "storage", "storage.service.ts");
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.name);
    const mutated = mutation.all ? source.split(mutation.from).join(mutation.to) : source.replace(mutation.from, mutation.to);
    fs.writeFileSync(target, mutated, "utf8");

    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === "contract.asset_ingestion_limits");
    assert.equal(contract.status, STATUS.FAIL, mutation.name);
    assert.ok(contract.evidence.missing.length > 0, mutation.name);
  }
});

test("asset SSRF, content truth and both local-file response contracts fail closed on drift", () => {
  const baselineRoot = createPassingFixture();
  const expectedContracts = [
    "contract.asset_public_network",
    "contract.asset_content_truth",
    "contract.asset_local_file_headers",
    "contract.assets_controller_safe_file_response",
    "contract.design_controller_safe_file_response",
    "contract.asset_security_documentation",
  ];
  const baseline = buildAudit(baselineRoot, { includeExternal: false });
  for (const id of expectedContracts) {
    assert.equal(baseline.results.find((item) => item.id === id).status, STATUS.PASS, id);
  }

  const mutations = [
    {
      id: "contract.asset_public_network",
      file: "desktop/apps/api/src/storage/safe-download.ts",
      from: "proxy: false",
      to: "proxy: true",
    },
    {
      id: "contract.asset_content_truth",
      file: "desktop/apps/api/src/storage/asset-content-security.ts",
      from: 'kind: "pdf", mimeType: "application/pdf", extension: ".pdf", inlineSafe: false',
      to: 'kind: "pdf", mimeType: "application/pdf", extension: ".pdf", inlineSafe: true',
    },
    {
      id: "contract.asset_local_file_headers",
      file: "desktop/apps/api/src/storage/local-file-response.ts",
      from: "nosniff",
      to: "sniff",
    },
    {
      id: "contract.assets_controller_safe_file_response",
      file: "desktop/apps/api/src/assets/assets.controller.ts",
      from: "applySafeLocalFileHeaders(reply, file)",
      to: 'reply.header("Content-Type", file.mimeType)',
    },
    {
      id: "contract.design_controller_safe_file_response",
      file: "desktop/apps/api/src/design-jobs/design-jobs.controller.ts",
      from: "applySafeLocalFileHeaders(reply, file)",
      to: 'reply.header("Content-Type", file.mimeType)',
    },
    {
      id: "contract.asset_security_documentation",
      file: "desktop/docs/DESIGN_PLATFORM_CONTRACT.md",
      from: "不再作为“部署侧未决”项冒充已完成",
      to: "私网地址、DNS 重绑定仍需要部署负责人",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.id);
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === mutation.id);
    assert.equal(contract.status, STATUS.FAIL, mutation.id);
    assert.ok(contract.evidence.missing.length > 0, mutation.id);
  }
});

test("completion audit fails when high-risk route guards, trusted actors or public callback boundaries drift", () => {
  const baselineRoot = createPassingFixture();
  const baseline = buildAudit(baselineRoot, { includeExternal: false });
  assert.equal(baseline.results.find((item) => item.id === "contract.high_risk_operator_routes").status, STATUS.PASS);

  const mutations = [
    {
      file: "desktop/apps/api/src/wechat-work/wechat-work.controller.ts",
      from: '@RequireOperatorCapability("manage_channels")',
      to: '@RequireOperatorCapability("view_console")',
    },
    {
      file: "desktop/apps/api/src/reviews/reviews.controller.ts",
      from: "reviewer: principal.id",
      to: 'reviewer: "browser_operator"',
    },
    {
      file: "desktop/apps/api/src/wechat-work/wechat-work.controller.ts",
      from: '@Post("callback")',
      to: '@Post("callback")\n  @RequireOperatorCapability("approve_send")\n  @UseGuards(OperatorAccessGuard)',
    },
    {
      file: "desktop/apps/api/src/assets/assets.controller.ts",
      from: '@RequireOperatorCapability("manage_design_executions")',
      to: '@RequireOperatorCapability("view_console")',
    },
    {
      file: "desktop/apps/api/src/routing/routing.controller.ts",
      from: "reviewer: principal.id",
      to: 'reviewer: "browser_operator"',
    },
    {
      file: "desktop/apps/api/src/routing/routing.controller.ts",
      from: '@Post("evaluate")\n  @RequireOperatorCapability("manage_training")',
      to: '@Post("evaluate")\n  @RequireOperatorCapability("view_console")',
    },
    {
      file: "desktop/apps/api/src/quotes/quotes.controller.ts",
      from: "owner: principal.id",
      to: 'owner: "browser_operator"',
    },
  ];
  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from));
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === "contract.high_risk_operator_routes");
    assert.equal(contract.status, STATUS.FAIL, mutation.file);
    assert.ok(contract.evidence.missing.length + contract.evidence.forbidden.length > 0);
  }
});

test("completion audit detects payment and routing correction boundary drift", () => {
  const mutations = [
    {
      id: "contract.payment_update_boundaries",
      file: "desktop/apps/api/src/quotes/quotes.service.ts",
      from: "报价付款状态只能通过付款凭证核验入口更新",
      to: "付款状态可直接更新",
    },
    {
      id: "contract.order_payment_update_boundaries",
      file: "desktop/apps/api/src/orders/orders.service.ts",
      from: "async recordVerifiedPayment",
      to: "async updatePayment",
    },
    {
      id: "contract.routing_correction_idempotency",
      file: "desktop/apps/api/src/prisma/prisma-operations.service.ts",
      from: "before.correction?.requestKey === requestKey",
      to: "false",
    },
    {
      id: "contract.routing_correction_local_parity",
      file: "desktop/apps/api/src/local-store/local-store.service.ts",
      from: "throw new BadRequestException",
      to: "throw new Error",
    },
    {
      id: "contract.payment_update_web_surface",
      file: "desktop/apps/web/src/features/sales/sales-order-edit-page.tsx",
      from: "付款状态（只读）",
      to: "付款状态",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.id);
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === mutation.id).status, STATUS.FAIL, mutation.id);
  }
});

test("external signing, staging, channel, recovery and hardware evidence aggregate to BLOCKED", () => {
  const report = buildAudit(createPassingFixture());
  assert.equal(report.status, STATUS.BLOCKED);
  assert.equal(report.counts.FAIL, 0);
  assert.equal(report.counts.BLOCKED, 5);
  assert.equal(EXIT_CODE[STATUS.BLOCKED], 2);
});

test("missing repository artifact and production placeholder aggregate to FAIL with relative location", () => {
  const root = createPassingFixture();
  fs.rmSync(path.join(root, "desktop", "tools", "build-windows-package.js"));
  write(root, "desktop/apps/api/src/example.service.ts", 'throw new Error("prisma mode is not implemented yet");\n');
  const report = buildAudit(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(EXIT_CODE[STATUS.FAIL], 1);
  const placeholders = report.results.find((item) => item.id === "source.production_placeholders");
  assert.deepEqual(placeholders.evidence.findings, [{
    component: "desktop/apps/api/src/example.service.ts",
    line: 1,
    marker: "prisma mode is not implemented yet",
  }]);
});

test("missing desktop session security artifact prevents a completion PASS", () => {
  const root = createPassingFixture();
  fs.rmSync(path.join(root, "desktop", "tests", "internal-api-security.test.js"));
  const report = buildAudit(root, { includeExternal: false });
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "security.desktop_session_proof").status, STATUS.FAIL);
});

test("missing wechat window observer evidence security artifact prevents a completion PASS", () => {
  const root = createPassingFixture();
  fs.rmSync(path.join(root, "desktop", "tests", "wechat-window-evidence-security.test.js"));
  const report = buildAudit(root, { includeExternal: false });
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "security.wechat_window_observer_evidence").status, STATUS.FAIL);
});

test("completion audit rejects browser window self-report and observer attestation drift", () => {
  const mutations = [
    {
      id: "contract.wechat_window_validation_source",
      file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
      from: "return this.validateSendTaskWithCurrentWindow(id, expected)",
      to: "return this.validateSendTask(id, expected.activeWindow)",
    },
    {
      id: "contract.wechat_window_validation_controller",
      file: "desktop/apps/api/src/wechat/wechat.controller.ts",
      from: "@Body() payload: ExpectedIdentityPayload",
      to: "@Body() payload: ExpectedIdentityPayload & { activeWindow?: object }",
    },
    {
      id: "contract.wechat_window_persisted_attestation",
      file: "desktop/packages/rules/wechatWindowEvidence.js",
      from: "timingSafeEqual(supplied, expected)",
      to: "supplied.length === expected.length",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.id);
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === mutation.id).status, STATUS.FAIL, mutation.id);
  }
});

test("completion audit rejects forged HTTP and spread automation provenance", () => {
  const contractIds = [
    "contract.manual_order_queue_controller_allowlist",
    "contract.manual_quote_queue_controller_allowlist",
    "contract.trusted_order_automation_provenance",
    "contract.trusted_quote_automation_provenance",
  ];
  const baseline = buildAudit(createPassingFixture(), { includeExternal: false });
  for (const id of contractIds) {
    assert.equal(baseline.results.find((item) => item.id === id).status, STATUS.PASS, id);
  }

  const mutations = [
    {
      id: "contract.manual_order_queue_controller_allowlist",
      file: "desktop/apps/api/src/wechat/wechat.controller.ts",
      content: "\nqueueOrderConfirmation(id, { ...(payload || {}), automation: payload.automation });\n",
    },
    {
      id: "contract.manual_order_queue_controller_allowlist",
      file: "desktop/apps/api/src/wechat/wechat.controller.ts",
      content: "\nsetConversationManualLock(id, { ...(payload || {}), effectKey: payload.effectKey });\n",
    },
    {
      id: "contract.manual_quote_queue_controller_allowlist",
      file: "desktop/apps/api/src/quotes/quotes.controller.ts",
      content: "\nqueueSend(id, { ...trustedPayload, automation: payload.automation });\n",
    },
    {
      id: "contract.trusted_order_automation_provenance",
      file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
      content: "\nconst forgedAutomation = { ...(payload.automation || {}) };\n",
    },
    {
      id: "contract.trusted_quote_automation_provenance",
      file: "desktop/apps/api/src/quotes/quotes.service.ts",
      content: "\nautomation: options.automation;\n",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    write(root, mutation.file, mutation.content, true);
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === mutation.id);
    assert.equal(contract.status, STATUS.FAIL, mutation.id);
    assert.ok(contract.evidence.forbidden.length > 0, mutation.id);
  }
});

test("design reconciliation UI is a required artifact with a fail-closed action contract", () => {
  const root = createPassingFixture();
  const componentPath = path.join(root, "desktop", "apps", "web", "src", "components", "design-execution-reconciliation-panel.tsx");
  fs.rmSync(componentPath);
  let report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "ui.design_execution_reconciliation").status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "contract.design_execution_reconciliation_ui").status, STATUS.FAIL);

  const restored = createPassingFixture();
  const restoredComponentPath = path.join(restored, "desktop", "apps", "web", "src", "components", "design-execution-reconciliation-panel.tsx");
  const component = fs.readFileSync(restoredComponentPath, "utf8").replace("return null;", 'return { resolution: "unexpected_server_value" };');
  fs.writeFileSync(restoredComponentPath, component, "utf8");
  report = buildAudit(restored, { includeExternal: false });
  const uiContract = report.results.find((item) => item.id === "contract.design_execution_reconciliation_ui");
  assert.equal(uiContract.status, STATUS.FAIL);
  assert.ok(uiContract.evidence.missing.length > 0);
});

test("design reconciliation UI cannot put reviewer in a browser-owned request body", () => {
  const root = createPassingFixture();
  const componentPath = path.join(root, "desktop", "apps", "web", "src", "components", "design-execution-reconciliation-panel.tsx");
  fs.appendFileSync(componentPath, '\nconst unsafeBody = { reviewer: "browser_operator" };\n', "utf8");
  const report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.design_execution_reconciliation_ui");
  assert.equal(contract.status, STATUS.FAIL);
  assert.deepEqual(contract.evidence.forbidden, ["forbidden-pattern-1"]);
});

test("design execution public view rejects unexpected DTO fields and unsafe projection fields", () => {
  const root = createPassingFixture();
  const typesPath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-jobs.types.ts");
  const executionPath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-platform-execution.service.ts");
  fs.writeFileSync(
    typesPath,
    fs.readFileSync(typesPath, "utf8").replace("  attemptNo: number;", "  attemptNo: number;\n  requestId: string;"),
    "utf8",
  );
  fs.writeFileSync(
    executionPath,
    fs.readFileSync(executionPath, "utf8").replace("    id: execution.id,", "    id: execution.id, operationKey: execution.operationKey,"),
    "utf8",
  );
  const report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.design_execution_public_view");
  assert.equal(contract.status, STATUS.FAIL);
  assert.deepEqual(contract.evidence.unexpectedFields, ["requestId"]);
  assert.ok(contract.evidence.forbidden.length > 0);
});

test("refund reconciliation eligibility stays exact for resumable partial success and unsafe refund states", () => {
  const baselineRoot = createPassingFixture();
  const baseline = buildAudit(baselineRoot, { includeExternal: false });
  assert.equal(baseline.results.find((item) => item.id === "contract.design_execution_public_view").status, STATUS.PASS);

  const mutations = [
    {
      name: "completed manual_review with failed refund remains eligible",
      from: '["failed", "unknown"].includes(execution.refundStatus)',
      to: '["unknown"].includes(execution.refundStatus)',
    },
    {
      name: "completed manual_review with unknown refund remains eligible",
      from: '["failed", "unknown"].includes(execution.refundStatus)',
      to: '["failed"].includes(execution.refundStatus)',
    },
    {
      name: "completed accepted remains ineligible",
      from: 'execution?.acceptanceStatus === "manual_review"',
      to: 'execution?.acceptanceStatus === "accepted"',
    },
    {
      name: "safe refunded state remains ineligible",
      from: '["failed", "unknown"].includes(execution.refundStatus)',
      to: '["failed", "unknown", "refunded"].includes(execution.refundStatus)',
    },
    {
      name: "refund write path reuses the same eligibility helper",
      from: "if (!isUnsafeRefundResolutionEligible(execution))",
      to: "if (!execution)",
    },
    {
      name: "resumable partial success returns to pending local acceptance",
      from: 'resumableCompleted ? { acceptanceStatus: "pending" } : {}',
      to: 'resumableCompleted ? { acceptanceStatus: "accepted" } : {}',
    },
    {
      name: "resumable partial success clears resolvedAt for local acceptance",
      from: "resolvedAt: resumableCompleted ? null : new Date()",
      to: "resolvedAt: new Date()",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const executionPath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-platform-execution.service.ts");
    const source = fs.readFileSync(executionPath, "utf8");
    assert.match(source, new RegExp(mutation.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), mutation.name);
    fs.writeFileSync(executionPath, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === "contract.design_execution_public_view");
    assert.equal(contract.status, STATUS.FAIL, mutation.name);
    assert.ok(contract.evidence.missingContracts.length > 0, mutation.name);
  }
});

test("design execution GET client must use exact expected identity query keys", () => {
  const root = createPassingFixture();
  const apiPath = path.join(root, "desktop", "apps", "web", "src", "lib", "api.ts");
  const unsafe = fs.readFileSync(apiPath, "utf8")
    .replaceAll("expectedWechatAccountId", "wechatAccountId")
    .replaceAll("expectedConversationId", "conversationId")
    .replaceAll("expectedCustomerId", "customerId");
  fs.writeFileSync(apiPath, unsafe, "utf8");
  const report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.design_execution_list_identity");
  assert.equal(contract.status, STATUS.FAIL);
  assert.ok(contract.evidence.missing.every((item) => item.startsWith("client-")));
  assert.equal(report.results.find((item) => item.id === "contract.design_execution_public_view").status, STATUS.PASS);

  const callerRoot = createPassingFixture();
  const callerApiPath = path.join(callerRoot, "desktop", "apps", "web", "src", "lib", "api.ts");
  fs.writeFileSync(
    callerApiPath,
    fs.readFileSync(callerApiPath, "utf8").replace(
      "designExecutionExpectedIdentityQuery(expected)",
      "expectedIdentityQuery(expected)",
    ),
    "utf8",
  );
  const callerReport = buildAudit(callerRoot, { includeExternal: false });
  const callerContract = callerReport.results.find((item) => item.id === "contract.design_execution_list_identity");
  assert.equal(callerContract.status, STATUS.FAIL);
  assert.ok(callerContract.evidence.missing.some((item) => item.startsWith("client-")));
});

test("design execution list service requires all three expected identity values before optional matching", () => {
  const root = createPassingFixture();
  const servicePath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-jobs.service.ts");
  const source = fs.readFileSync(servicePath, "utf8").replace(
    '    if (!expected.expectedWechatAccountId || !expected.expectedConversationId || !expected.expectedCustomerId) throw new Error("complete identity required");\n',
    "",
  );
  fs.writeFileSync(servicePath, source, "utf8");
  const report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.design_execution_list_identity");
  assert.equal(contract.status, STATUS.FAIL);
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("service-")));
});

test("design execution resolution writes must return the public mapper", () => {
  const root = createPassingFixture();
  const servicePath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-jobs.service.ts");
  const unsafe = fs.readFileSync(servicePath, "utf8")
    .replace("this.designPlatformExecutions.resolveUnknownPublic", "this.designPlatformExecutions.resolveUnknown")
    .replace("this.designPlatformExecutions.resolveUnsafeRefundPublic", "this.designPlatformExecutions.resolveUnsafeRefund");
  fs.writeFileSync(servicePath, unsafe, "utf8");
  const report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.design_execution_resolution_boundaries");
  assert.equal(contract.status, STATUS.FAIL);
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("unknown-service-response-")));
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("refund-service-response-")));
  assert.equal(report.results.find((item) => item.id === "contract.design_execution_public_view").status, STATUS.PASS);
});

test("design execution resolution routes keep manage/approve boundaries and strict payload literals", () => {
  const root = createPassingFixture();
  const controllerPath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-jobs.controller.ts");
  const typesPath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-jobs.types.ts");
  const controller = fs.readFileSync(controllerPath, "utf8")
    .replaceAll('@RequireOperatorCapability("manage_design_executions")', '@RequireOperatorCapability("view_console")')
    .replace('@RequireOperatorCapability("approve_send")', '@RequireOperatorCapability("manage_design_executions")');
  fs.writeFileSync(controllerPath, controller, "utf8");
  fs.writeFileSync(
    typesPath,
    fs.readFileSync(typesPath, "utf8").replace('resolution: "confirmed_refunded";', 'resolution: "refund_confirmed";'),
    "utf8",
  );
  const report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.design_execution_resolution_boundaries");
  assert.equal(contract.status, STATUS.FAIL);
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("unknown-route-")));
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("refund-route-")));
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("approve-route-")));
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("types-")));
});

test("design execution secret boundary is scoped to the execution model", () => {
  const root = createPassingFixture();
  const schemaPath = path.join(root, "desktop", "prisma", "schema.prisma");
  fs.appendFileSync(schemaPath, "\nmodel LegacyDesignRequest { customerText String? }\n", "utf8");

  let report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.design_platform_execution_models").status, STATUS.PASS);

  const schema = fs.readFileSync(schemaPath, "utf8").replace(
    "scopeKey String processRunId String",
    "scopeKey String customerText String processRunId String",
  );
  fs.writeFileSync(schemaPath, schema, "utf8");
  report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.design_platform_execution_models").status, STATUS.FAIL);
});

test("planned channel placeholders are allowed only with planned status, fail-closed adapter and roadmap reason", () => {
  const root = createPassingFixture();
  let report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "planned_scope.optional_channels").status, STATUS.PASS);
  assert.equal(report.results.find((item) => item.id === "source.production_placeholders").status, STATUS.PASS);

  write(root, "docs/PROJECT_LANDING_ROADMAP.md", "规划渠道已经接通。\n");
  report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "planned_scope.optional_channels").status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "source.production_placeholders").status, STATUS.FAIL);
});

test("Prisma Agent initializer must keep zero-write plan, explicit confirmation and redacted catch", () => {
  const root = createPassingFixture();
  let report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.prisma_agent_initializer_safety").status, STATUS.PASS);

  write(root, "desktop/tools/initialize-prisma-agents.js", 'const execute=process.argv.includes("--execute");\ninitializePrismaAgentData().catch((error) => process.stderr.write(error.message));\n');
  report = buildAudit(root, { includeExternal: false });
  const initializer = report.results.find((item) => item.id === "contract.prisma_agent_initializer_safety");
  assert.equal(initializer.status, STATUS.FAIL);
  assert.ok(initializer.evidence.missing.length > 0);
  assert.ok(initializer.evidence.forbidden.length > 0);
});

test("Prisma order invalidation requires one transaction, guarded task statuses and a fixed audit actor", () => {
  const root = createPassingFixture();
  let report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.prisma_order_send_invalidation").status, STATUS.PASS);

  write(root, "desktop/apps/api/src/orders/orders.service.ts", 'updatePrismaOrderAndQuoteWithSendInvalidation();\ntx.wechatSendTask.updateMany();\nreviewer: data.owner;\n');
  report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.prisma_order_send_invalidation");
  assert.equal(contract.status, STATUS.FAIL);
  assert.ok(contract.evidence.missing.length >= 5);
});

test("report output is confined to the ignored runtime path and remains sanitized Chinese Markdown plus JSON", () => {
  const root = createPassingFixture();
  const report = buildAudit(root);
  const files = writeReport(root, report);
  const expected = path.join(root, "desktop", ".runtime", "project-completion-audit");
  assert.equal(path.dirname(files.jsonPath), expected);
  assert.equal(path.dirname(files.markdownPath), expected);
  assert.match(fs.readFileSync(files.markdownPath, "utf8"), /项目完成度真值审计/);
  assert.equal(fs.readFileSync(files.jsonPath, "utf8").includes(root), false);
  assert.equal(report.scope.reportPath, "desktop/.runtime/project-completion-audit/latest.{json,md}");
});

test("root path escape is rejected and status aggregation keeps FAIL above BLOCKED", () => {
  const root = createPassingFixture();
  assert.throws(() => absoluteFrom(root, "../outside"), /path escapes audit root/);
  assert.equal(aggregateStatus([{ status: STATUS.PASS }, { status: STATUS.BLOCKED }]), STATUS.BLOCKED);
  assert.equal(aggregateStatus([{ status: STATUS.BLOCKED }, { status: STATUS.FAIL }]), STATUS.FAIL);
  assert.match(toMarkdown(buildAudit(root)), /无网络、无命令执行、无数据库连接、无真实发送/);
});

test("documentation keeps Excel, Prisma, packaging, CI, recovery and image hash claims evidence-bound", () => {
  const repositoryRoot = path.resolve(__dirname, "..", "..");
  const read = (relative) => fs.readFileSync(path.join(repositoryRoot, ...relative.split("/")), "utf8");
  const readme = read("desktop/README.md");
  const status = read("desktop/docs/IMPLEMENTATION_STATUS.md");
  const auditGuide = read("desktop/docs/PROJECT_COMPLETION_AUDIT.md");
  const designGuide = read("desktop/docs/design-platform-art-image-local.md");
  const designContract = read("desktop/docs/DESIGN_PLATFORM_CONTRACT.md");
  assert.match(readme, /\.xlsx.*\.csv.*\.tsv.*\.txt/s);
  assert.match(status, /WechatPersistence.*USE_LOCAL_STORE=false.*Prisma/s);
  assert.match(status, /electron-builder\/NSIS/);
  assert.match(status, /GitHub Actions/);
  assert.match(status, /恢复演练工具/);
  assert.match(status, /dhash64:v1/);
  assert.match(status, /legacyIdentityHash/);
  assert.match(status, /不承诺任意裁剪/);
  assert.match(status, /PersonalWechatRpaPersistence.*USE_LOCAL_STORE=false.*Prisma/s);
  assert.doesNotMatch(status, /个人微信 RPA 账号绑定与业务审计固定走 LocalStore/);
  assert.match(auditGuide, /dhash64:v1.*legacyIdentityHash.*不承诺任意裁剪/s);
  assert.match(designGuide, /DesignExecutionReconciliationPanel.*availableResolution.*不接受 reviewer/s);
  assert.match(designGuide, /completed \+ acceptanceStatus=manual_review.*acceptanceStatus=pending.*不会再次调用生成接口/s);
  assert.match(designGuide, /completed \+ accepted.*refunded\/not_required\/credit_bypass.*不会开放该核销动作/s);
  assert.doesNotMatch(designGuide, /客服 UI 入口仍列入下一轮/);
  assert.match(designContract, /DNS rebinding.*Content-Disposition.*realpath.*不再作为“部署侧未决”项冒充已完成/s);
  assert.doesNotMatch(designContract, /私网地址、DNS 重绑定.*仍需要部署负责人/);
  assert.doesNotMatch(readme, /Excel 文件解析导入。\s*$/m);
});

test("completion audit requires zero redirects and bounded SKU workbook parsing", () => {
  const baselineRoot = createPassingFixture();
  let report = buildAudit(baselineRoot, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.design_platform_zero_redirect").status, STATUS.PASS);
  assert.equal(report.results.find((item) => item.id === "contract.excel_import_limits").status, STATUS.PASS);

  const redirectRoot = createPassingFixture();
  const clientPath = path.join(redirectRoot, "desktop", "apps", "api", "src", "integrations", "design-platform", "design-platform.client.ts");
  fs.writeFileSync(
    clientPath,
    fs.readFileSync(clientPath, "utf8").replace("config.maxRedirects = 0", "config.maxRedirects = config.maxRedirects"),
    "utf8",
  );
  report = buildAudit(redirectRoot, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.design_platform_zero_redirect").status, STATUS.FAIL);

  const importRoot = createPassingFixture();
  const importPath = path.join(importRoot, "desktop", "packages", "rules", "skuImport.js");
  fs.writeFileSync(
    importPath,
    fs.readFileSync(importPath, "utf8").replace(
      "maxOutputLength: SKU_IMPORT_LIMITS.maxZipEntryUncompressedBytes",
      "maxOutputLength: Infinity",
    ),
    "utf8",
  );
  report = buildAudit(importRoot, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.excel_import_limits").status, STATUS.FAIL);
});

test("completion audit rejects regex XML materialization and weakened N+1 early stop", () => {
  for (const mutation of [
    {
      name: "shared string match materialization",
      mutate: (source) => `${source}\nconst items = xml.match(/<si>/g);\n`,
      evidence: "forbidden",
    },
    {
      name: "row match materialization",
      mutate: (source) => `${source}\nconst rowMatches = xml.match(/<row>/g);\n`,
      evidence: "forbidden",
    },
    {
      name: "removed N+1 check",
      mutate: (source) => source.replace("if (count > options.limit)", "if (false)"),
      evidence: "missing",
    },
    {
      name: "moved N+1 check after tag body scan",
      mutate: (source) => source.replace(
        "if (count > options.limit) throw new Error(); const openEnd = findXmlTagEnd(xml, start, xml.length);",
        "const openEnd = findXmlTagEnd(xml, start, xml.length); if (count > options.limit) throw new Error();",
      ),
      evidence: "missing",
    },
  ]) {
    const root = createPassingFixture();
    const sourcePath = path.join(root, "desktop", "packages", "rules", "skuImport.js");
    fs.writeFileSync(sourcePath, mutation.mutate(fs.readFileSync(sourcePath, "utf8")), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === "contract.excel_import_limits");
    assert.equal(contract.status, STATUS.FAIL, mutation.name);
    assert.ok(contract.evidence[mutation.evidence].length > 0, mutation.name);
  }
});
