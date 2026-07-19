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

function write(root, relative, content = "fixture evidence\n") {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
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
  write(root, "desktop/packages/rules/skuImport.js", "function parseSkuImportFile() {}\nfunction buildSkuImportTemplateXlsx() {}\nmodule.exports={ parseSkuImportFile, buildSkuImportTemplateXlsx, };\n");
  write(root, "desktop/packages/rules/index.js", "module.exports={...require('./skuImport')};\n");
  write(root, "desktop/apps/api/src/wechat/wechat-persistence.ts", 'if (this.isLocal) {}\nwechatWorkBinding; wechatWorkAuditLog; wechatSendTask;\n{ action: "inbound_processed", status: "processed" };\n{ action: "inbound_failed", status: "permanent_manual_review" };\nwechatWorkSyncCursor.updateMany();\ncompleteAttemptAndTask(); linkedTransition; tx.wechatSendTask.updateMany(); tx.wechatSendAttempt.update(); if (linked.count !== 1) throw new Error(); updateSendTaskWithLinkedTransition();\n');
  write(root, "desktop/apps/api/src/wechat-work/wechat-work.service.ts", "activeCursorSyncs; getWechatWorkSyncCursor(); expectedCursor: cursor; permanent_manual_review; cursorScopeMismatch;\n");
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", 'handlePrismaInboundImageSelection(); wechatAccountId: identity.wechatAccountId; conversationId: identity.conversationId; customerId: identity.customerId; latestCandidateRound(); shouldLetQuoteAcceptanceHandleSelectionText(); high_value_customer_selected_image; designSelectionRevisionSignature();\nawait this.executeQueuedSend(freshTask.id); pendingAttempt.adapter !== "windows_bridge"; await this.resolveBridgeAckAttempt(task, payload); validatePrismaLinkedSendState(); deliveryState: "unknown"; acceptedMessageIds: apiMsgIds; bridgeAckTokenHash: hashBridgeAckToken(payload); Files remain in place until the task + attempt transition is durably committed;\n');
  write(root, "desktop/apps/api/src/orders/orders.service.ts", 'updatePrismaOrderAndQuoteWithSendInvalidation();\nreturn prisma.$transaction(async (tx: any) => {\ntx.quoteDraft.update();\nstatus: { in: ["queued", "blocked", "failed"] };\ntx.wechatSendTask.updateMany();\ninvalidationStateChanged || cancelledSendTasks.length > 0;\ndecision: "invalidate_pending_order_send_tasks";\nreviewer: "system_order_invalidation";\n});\n');
  write(root, "desktop/README.md", "npm run project:completion:audit\ndhash64:v1\nlegacyIdentityHash\n稳定 SHA-256 身份哈希\n");
  write(root, "docs/PRODUCTION_RELEASE_CHECKLIST.md", "npm run project:completion:audit\nnpm run package:win:signed\nnpm run database:recovery:execute\n真实签名证据保持 BLOCKED\n");
  write(root, "desktop/apps/api/src/automation/automation-queue.runtime.ts", 'import { Queue, Worker } from "bullmq";\nnew Queue("x", { connection: {} }); new Worker("x", async()=>{}, { connection: {} });\n');
  write(root, "desktop/apps/api/src/automation/automation-scheduler.service.ts", 'lowValueAutomationMode === "durable"; bullmq_redis; readiness();\n');
  write(root, "desktop/apps/api/src/prisma/prisma-operations.service.ts", "listAgents(); listAgentSkills(); createRouteEvaluation(); correctRouteEvaluation(); createChatImport(); reviewTrainingSample(); applyAgentSkillSuggestions(); listConversations(); listConversationAudit(); updateConversationOperations();\n");
  write(root, "desktop/tools/initialize-prisma-agents.js", 'const execute=process.argv.includes("--execute");\nconst requiredConfirmation="INITIALIZE_PRISMA_AGENTS";\nif (!execute) { console.log({status:"PLAN", writesExecuted:false}); process.exit(0); }\nif (confirmation !== requiredConfirmation) throw new Error("refusing");\ninitializePrismaAgentData().catch(() => { process.stderr.write("failed; inspect protected deployment logs"); });\n');
  write(root, "desktop/apps/api/src/agents/agents.service.ts", "PrismaOperationsService; appConfig.useLocalStore; this.requirePrisma().listAgents(); this.requirePrisma().listAgentSkills();\n");
  write(root, "desktop/apps/api/src/routing/routing.service.ts", "PrismaOperationsService; if (!appConfig.useLocalStore) this.evaluatePrisma(); correctRouteEvaluation();\n");
  write(root, "desktop/apps/api/src/training/training.service.ts", "PrismaOperationsService; listSamplesPrisma(); getOverviewPrisma(); reviewSamplePrisma(); listSkillSuggestionsPrisma(); applySkillSuggestionsPrisma();\n");
  write(root, "desktop/apps/api/src/conversation-ops/conversation-operations.service.ts", "PrismaOperationsService; if (!appConfig.useLocalStore) return this.listQueuePrisma(); if (!appConfig.useLocalStore) return this.listAuditPrisma(); if (!appConfig.useLocalStore) return this.updateConversationPrisma(); this.requirePrisma().updateConversationOperations();\n");
  write(root, "desktop/apps/api/src/automation/automation.service.ts", "listAutomationRuns(); saveAutomationRun();\n");
  write(root, "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.service.ts", "REGISTRY_VERSION; readRegistryState(); writeRegistryDocument(); PersonalWechatRpaPersistence; this.persistence.listBindings(); this.persistence.listAudit(); this.persistence.upsertBinding(); this.persistence.recordAudit(); assertProductionIdentity();\n");
  write(root, "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.persistence.ts", "prisma.$transaction(); hydrateBinding(); sanitizeError();\n");
  write(root, "desktop/prisma/schema.prisma", "enum ConversationChannel { personal_wechat work_wechat }\nmodel PersonalWechatRpaBinding {}\nmodel PersonalWechatRpaAuditLog {}\nmodel WechatWorkSyncCursor {}\nmodel SkuChangeLog { changedFields Json before Json? }\nmodel DesignAsset { normalizedLocalPath String? @unique }\npersonalWechatOwnerWxId String? @unique\npersonalWechatRpaBindingKey String? @unique\n");
  write(root, "desktop/apps/api/src/catalog/catalog.service.ts", 'this.prisma.$transaction(); tx.skuChangeLog.create(); changedFields; reason: context.reason; reason: "no_change"; skuChangeLog.findMany();\n');
  write(root, "desktop/apps/api/src/assets/assets.service.ts", 'normalizedLocalPath; await fs.realpath(input); local asset path must be absolute; this.prisma.conversation.findFirst(); normalizedLocalPath: normalized; ambiguous persisted identities; no unambiguous persisted identity;\n');
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.service.ts", 'buildLegacyImageIdentityHash(); legacyIdentityHash;\n');
  write(root, "desktop/apps/api/src/shared/image-fingerprint.ts", 'import sharp from "sharp";\nconst IMAGE_FINGERPRINT_ALGORITHM = "dhash64:v1";\nsharp().rotate().flatten({}).greyscale().resize(9, 8);\n');
  write(root, "desktop/apps/api/src/wechat-work/wechat-work-api.client.ts", 'fetch(`/cgi-bin/media/get?media_id=${encodeURIComponent(mediaId)}`); errcode === 40007; errcode === 41006; errcode === 45009; retry_exhausted;\n');
  write(root, "desktop/apps/api/src/wechat-work/wechat-work-inbound-media.ts", 'MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES; LOCAL_STORAGE_ROOT; fs.link(temporaryPath, finalPath); inspectExistingImage();\n');
  write(root, "desktop/packages/rules/selectionMatcher.js", 'hammingDistance(); nearest.distance > 1; gap < 2; "候选图存在缺失或旧版指纹";\n');
  write(root, "desktop/tests/wechat-prisma-send-parity.test.js", "Prisma send safety parity tests\n");
  write(root, "desktop/prisma/migrations/20260719233000_design_platform_execution_durability/migration.sql", "CREATE TABLE \"DesignPlatformExecution\" ();\n");
  write(root, "desktop/tests/design-platform-execution-durability.test.js", "durable design execution behavior tests\n");
  write(root, "desktop/apps/api/src/design-jobs/design-platform-execution.service.ts", 'async begin() {} async claimDispatch() {} async markGenerating() {} recoverStaleExecutions(); commitAcceptedResult(); designImageCandidate.upsert(); "design platform acceptance CAS failed"; status: "outcome_unknown"; "explicit confirmed_not_generated_refunded resolution and reviewer are required"; "design platform execution outcome requires explicit manual resolution before retry";\n');
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.controller.ts", '@Post(":id/executions/:executionId/resolve-unknown")\nresolveUnknownExecution();\n');
  write(root, "desktop/apps/api/src/integrations/design-platform/design-platform.client.ts", 'requestId: externalJobId; MALFORMED_SUCCESS_RESPONSE; ECONNABORTED; ECONNRESET; Number(error.response?.status || 0) >= 500; art_image_local results must be read from durable execution;\n');
  write(root, "desktop/apps/web/src/lib/desktop-session-proof.ts", 'DESKTOP_SESSION_COOKIE; timingSafeEqual(); requiresDesktopSessionProof(); return true; headers.delete("cookie"); headers.set(internalApiTokenHeader, internalApiToken);\n');
  write(root, "desktop/apps/api/src/shared/app-config.ts", 'DESIGN_PLATFORM_ALLOWED_ORIGINS; designPlatformAccessTokenOrigin; designPlatformCookieOrigin; designPlatformApiKeyOrigin; designPlatformDeviceIdOrigin; hasIndependentDesignPlatformCallbackApiKey(); timingSafeEqual();\n');
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.service.ts", 'buildLegacyImageIdentityHash(); legacyIdentityHash; design_platform_callback_auth; hasIndependentDesignPlatformCallbackApiKey(); severity: "error"; assertDesignPlatformPreflight();\n');
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.controller.ts", '@RequireOperatorCapability("view_console")\n@RequireOperatorCapability("manage_design_executions")\n@RequireOperatorCapability("approve_send")\n@TrustedOperator() principal\n@Post(":id/executions/:executionId/resolve-unknown")\nresolveUnknownExecution();\n');
  write(root, "desktop/prisma/schema.prisma", "enum ConversationChannel { personal_wechat work_wechat }\nmodel PersonalWechatRpaBinding {}\nmodel PersonalWechatRpaAuditLog {}\nmodel WechatWorkSyncCursor {}\nmodel SkuChangeLog { changedFields Json before Json? }\nmodel DesignAsset { normalizedLocalPath String? @unique }\nmodel DesignPlatformExecution { operationKey String @unique requestId String @unique scopeKey String processRunId String acceptanceStatus DesignPlatformAcceptanceStatus refundStatus DesignPlatformRefundStatus }\nenum DesignPlatformExecutionStatus { outcome_unknown explicit_failed cancel_requested }\npersonalWechatOwnerWxId String? @unique\npersonalWechatRpaBindingKey String? @unique\n");
  write(root, "core/channel_registry.py", 'SUPPORTED_CHANNELS = {"x": ChannelSpec(status="planned")}\nif channel_id != "wechat":\n print("adapter is planned but not implemented; skipped.")\nreturn DisabledChannelAdapter(spec, reason="adapter not implemented")\n');
  write(root, "docs/PROJECT_LANDING_ROADMAP.md", "抖音、小红书、拼多多、淘宝、快手目前是规划渠道，不能假装已接通。\n");
  return root;
}

test("completion audit fixture reaches local PASS without network, commands or secret reads", () => {
  const root = createPassingFixture();
  write(root, ".env", "INTERNAL_API_TOKEN=never-include-this-secret\n");
  const report = buildAudit(root, { includeExternal: false });
  assert.equal(report.status, STATUS.PASS);
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
  assert.match(readme, /\.xlsx.*\.csv.*\.tsv.*\.txt/s);
  assert.match(status, /WechatPersistence.*USE_LOCAL_STORE=false.*Prisma/s);
  assert.match(status, /electron-builder\/NSIS/);
  assert.match(status, /GitHub Actions/);
  assert.match(status, /恢复演练工具/);
  assert.match(status, /dhash64:v1/);
  assert.match(status, /legacyIdentityHash/);
  assert.match(status, /不承诺任意裁剪/);
  assert.doesNotMatch(readme, /Excel 文件解析导入。\s*$/m);
});
