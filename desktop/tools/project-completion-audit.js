"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveWorktreeNodeModules } = require("./resolve-worktree-node-modules");

const STATUS = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", FAIL: "FAIL" });
const STATUS_RANK = Object.freeze({ PASS: 0, BLOCKED: 1, FAIL: 2 });
const EXIT_CODE = Object.freeze({ PASS: 0, BLOCKED: 2, FAIL: 1 });
const SCHEMA_VERSION = "smart_kefu_project_completion_audit_v3";

const REQUIRED_ARTIFACTS = Object.freeze([
  { id: "release.gate", title: "生产发布门禁", file: "desktop/tools/production-release-gate.js" },
  { id: "release.checklist", title: "生产发布清单", file: "docs/PRODUCTION_RELEASE_CHECKLIST.md" },
  { id: "staging.tool", title: "预发布只读证据工具", file: "desktop/tools/staging-readiness-evidence.js" },
  { id: "staging.guide", title: "预发布证据说明", file: "docs/STAGING_READINESS_EVIDENCE.md" },
  { id: "recovery.tool", title: "数据库恢复演练工具", file: "desktop/tools/database-recovery-rehearsal.js" },
  { id: "recovery.guide", title: "数据库恢复演练说明", file: "desktop/docs/DATABASE_RECOVERY_REHEARSAL.md" },
  { id: "windows.builder", title: "Windows 安装包构建工具", file: "desktop/tools/build-windows-package.js" },
  { id: "windows.verifier", title: "Windows 安装包验证工具", file: "desktop/tools/verify-windows-package.js" },
  { id: "windows.config", title: "electron-builder 白名单配置", file: "desktop/electron-builder.yml" },
  { id: "windows.guide", title: "Windows 打包说明", file: "desktop/docs/WINDOWS_PACKAGING.md" },
  { id: "windows.readiness_proof", title: "打包启动 HMAC 证明", file: "desktop/packages/runtime/packaged-readiness-proof.js" },
  { id: "ci.workflow", title: "Windows 质量流水线", file: ".github/workflows/windows-quality.yml" },
  { id: "prisma.schema", title: "Prisma PostgreSQL schema", file: "desktop/prisma/schema.prisma" },
  {
    id: "prisma.wechat_migration",
    title: "微信生产持久化迁移",
    file: "desktop/prisma/migrations/20260713090000_wechat_postgresql_production/migration.sql",
  },
  {
    id: "prisma.wechat_work_migration",
    title: "企业微信绑定审计迁移",
    file: "desktop/prisma/migrations/20260719150000_wechat_work_bindings_audit/migration.sql",
  },
  {
    id: "prisma.operations_migration",
    title: "Agent/路由/训练/会话运营 Prisma 迁移",
    file: "desktop/prisma/migrations/20260719190000_prisma_operations/migration.sql",
  },
  {
    id: "prisma.operations_service",
    title: "运营域 Prisma 服务",
    file: "desktop/apps/api/src/prisma/prisma-operations.service.ts",
  },
  {
    id: "prisma.agent_initializer",
    title: "Prisma Agent 初始化工具",
    file: "desktop/tools/initialize-prisma-agents.js",
  },
  {
    id: "prisma.agent_initializer_data",
    title: "Prisma Agent 初始化事务实现",
    file: "desktop/tools/initialize-prisma-agent-data.ts",
  },
  {
    id: "prisma.operations_tests",
    title: "运营域 Prisma 契约测试",
    file: "desktop/tests/prisma-operations.test.js",
  },
  {
    id: "prisma.personal_wechat_migration",
    title: "个人微信业务绑定与审计迁移",
    file: "desktop/prisma/migrations/20260719210000_personal_wechat_rpa_persistence/migration.sql",
  },
  {
    id: "prisma.personal_wechat_persistence",
    title: "个人微信业务持久化适配器",
    file: "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.persistence.ts",
  },
  {
    id: "prisma.personal_wechat_tests",
    title: "个人微信 Prisma 安全契约测试",
    file: "desktop/tests/personal-wechat-rpa-prisma.test.js",
  },
  {
    id: "prisma.perceptual_hash_migration",
    title: "候选图感知指纹迁移",
    file: "desktop/prisma/migrations/20260719210000_design_image_perceptual_hash/migration.sql",
  },
  {
    id: "prisma.wechat_work_inbound_durability",
    title: "企业微信入站游标与渠道枚举迁移",
    file: "desktop/prisma/migrations/20260719210000_wechat_work_inbound_durability/migration.sql",
  },
  {
    id: "prisma.order_send_invalidation_tests",
    title: "Prisma 订单发送失效事务测试",
    file: "desktop/tests/order-prisma-send-invalidation.test.js",
  },
  {
    id: "prisma.catalog_asset_parity_migration",
    title: "商品审计与素材规范路径迁移",
    file: "desktop/prisma/migrations/20260719230000_catalog_asset_prisma_parity/migration.sql",
  },
  {
    id: "prisma.catalog_change_log_tests",
    title: "商品 Prisma 变更审计测试",
    file: "desktop/tests/catalog-prisma-change-log.test.js",
  },
  {
    id: "prisma.asset_identity_tests",
    title: "素材 Prisma 身份与路径测试",
    file: "desktop/tests/asset-prisma-identity.test.js",
  },
  {
    id: "prisma.wechat_send_parity_tests",
    title: "企业微信与 Windows bridge Prisma 发送安全一致性测试",
    file: "desktop/tests/wechat-prisma-send-parity.test.js",
  },
  {
    id: "safety.local_wechat_send_claim_recovery_tests",
    title: "LocalStore bridge 发送 claim 与故障恢复动态测试",
    file: "desktop/tests/wechat-local-send-claim-recovery.test.js",
  },
  {
    id: "prisma.design_platform_execution_migration",
    title: "设计平台逐尝试持久化迁移",
    file: "desktop/prisma/migrations/20260719233000_design_platform_execution_durability/migration.sql",
  },
  {
    id: "prisma.design_platform_execution_service",
    title: "设计平台 durable execution 服务",
    file: "desktop/apps/api/src/design-jobs/design-platform-execution.service.ts",
  },
  {
    id: "prisma.design_platform_execution_tests",
    title: "设计平台重启与重复扣费安全测试",
    file: "desktop/tests/design-platform-execution-durability.test.js",
  },
  {
    id: "prisma.design_external_operation_migration",
    title: "设计平台外部操作与回调幂等迁移",
    file: "desktop/prisma/migrations/20260720113000_design_external_operation_idempotency/migration.sql",
  },
  {
    id: "prisma.design_external_operation_tests",
    title: "设计平台外部操作与跨实例回调 CAS 测试",
    file: "desktop/tests/design-external-idempotency.test.js",
  },
  {
    id: "request.send_idempotency_tests",
    title: "Request and send operation idempotency tests",
    file: "desktop/tests/request-idempotency.test.js",
  },
  {
    id: "request.direct_send_safety_tests",
    title: "Direct send operation passthrough tests",
    file: "desktop/tests/wechat-direct-send-safety.test.js",
  },
  {
    id: "safety.inbound_recovery_tests",
    title: "Inbound lease, payload and replay recovery tests",
    file: "desktop/tests/conversation-messages.test.js",
  },
  {
    id: "safety.inbound_high_value_recovery_tests",
    title: "Local high-value inbound crash recovery tests",
    file: "desktop/tests/wechat-manual-lock-service.test.js",
  },
  {
    id: "safety.inbound_prisma_recovery_tests",
    title: "Prisma high-value inbound crash recovery tests",
    file: "desktop/tests/wechat-work-prisma-selection.test.js",
  },
  {
    id: "web.api_failure_truth_tests",
    title: "Web API failure truth regression tests",
    file: "desktop/tests/web-api-failure-truth.test.js",
  },
  {
    id: "web.build_freshness_tests",
    title: "Web build freshness state-machine tests",
    file: "desktop/tests/web-build-freshness.test.js",
  },
  {
    id: "security.desktop_session_proof",
    title: "Electron 桌面会话证明与代理安全测试",
    file: "desktop/tests/internal-api-security.test.js",
  },
  {
    id: "security.wechat_inbound_auth",
    title: "通用微信入站可信调用边界测试",
    file: "desktop/tests/wechat-inbound-auth.test.js",
  },
  {
    id: "security.wechat_window_observer_evidence",
    title: "微信窗口 observer 证据签名与发送失败关闭测试",
    file: "desktop/tests/wechat-window-evidence-security.test.js",
  },
  {
    id: "security.design_platform_credentials",
    title: "设计平台逐凭据 origin 与零重定向测试",
    file: "desktop/tests/design-platform-credential-security.test.js",
  },
  {
    id: "security.runtime_secret_isolation_tests",
    title: "运行时服务密钥隔离测试",
    file: "desktop/tests/runtime-secret-isolation.test.js",
  },
  {
    id: "runtime.service_environment",
    title: "运行时服务环境变量白名单",
    file: "desktop/packages/runtime/service-environment.js",
  },
  {
    id: "runtime.private_json",
    title: "私有运行时 JSON 原子文件工具",
    file: "desktop/tools/private-runtime-file.js",
  },
  {
    id: "runtime.observer_child_environment",
    title: "微信窗口 observer 子进程环境隔离",
    file: "desktop/apps/api/src/shared/runtime-child-environment.ts",
  },
  {
    id: "runtime.packaged_environment",
    title: "桌面打包服务环境隔离",
    file: "desktop/apps/electron/packaged-runtime.js",
  },
  {
    id: "security.sku_import_limits",
    title: "SKU 文本与 XLSX 资源边界测试",
    file: "desktop/tests/sku-import-file.test.js",
  },
  {
    id: "security.design_platform_callback",
    title: "设计平台回调与控制器安全测试",
    file: "desktop/tests/design-platform-controller-security.test.js",
  },
  {
    id: "security.asset_download",
    title: "资产公网下载与 DNS 绑定实现",
    file: "desktop/apps/api/src/storage/safe-download.ts",
  },
  {
    id: "security.asset_content",
    title: "资产 magic 与解码内容验证实现",
    file: "desktop/apps/api/src/storage/asset-content-security.ts",
  },
  {
    id: "security.asset_response",
    title: "本地资产安全响应头实现",
    file: "desktop/apps/api/src/storage/local-file-response.ts",
  },
  {
    id: "security.asset_tests",
    title: "资产 SSRF 与内容伪装回归测试",
    file: "desktop/tests/asset-security.test.js",
  },
  {
    id: "security.asset_contract_guide",
    title: "设计平台资产安全契约",
    file: "desktop/docs/DESIGN_PLATFORM_CONTRACT.md",
  },
  {
    id: "ui.design_execution_reconciliation",
    title: "设计执行人工核销工作台",
    file: "desktop/apps/web/src/components/design-execution-reconciliation-panel.tsx",
  },
]);

const CONTRACTS = Object.freeze([
  {
    id: "contract.inbound_effect_recovery",
    title: "Inbound effects are lease fenced, durably recoverable and fully hydrated",
    file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
    patterns: [],
    sections: [
      {
        id: "local-image-selection-dispatch",
        file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
        startPattern: /private async handleInboundImageSelection\s*\([\s\S]*?\n\s*\}\)\s*/,
        patterns: [
          /const recovery = inboundSelectionRecovery\(params\.operationResult\)/,
          /this\.jobMatchesConversationIdentity\(recoveryJob, params\.conversation\)/,
          /recoveredQuote\.designJobId !== recoveryJob\.id/,
          /recoveredQuote\.selectedImageId !== recovery\.selectedImageId/,
          /kind:\s*"high_value_image_selection"[\s\S]*?phase:\s*"selection_committed"/,
          /this\.localStore\.commitInboundHighValueSelection\(\{[\s\S]*?operationId:\s*params\.operationId[\s\S]*?claimToken:\s*params\.claimToken[\s\S]*?leaseExpiresAt:\s*this\.nextInboundLeaseExpiry\(\)[\s\S]*?recoveryEffect/,
          /kind:\s*"low_value_image_selection"[\s\S]*?phase:\s*"selection_committed"/,
          /this\.localStore\.commitInboundLowValueSelection\(\{[\s\S]*?operationId:\s*params\.operationId[\s\S]*?claimToken:\s*params\.claimToken[\s\S]*?leaseExpiresAt:\s*this\.nextInboundLeaseExpiry\(\)[\s\S]*?recoveryEffect/,
        ],
      },
      {
        id: "local-quote-acceptance-dispatch",
        file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
        startPattern: /private async handleInboundQuoteAcceptance\s*\([\s\S]*?\n\s*\}\)\s*/,
        patterns: [
          /const recovery = inboundQuoteAcceptanceRecovery\(params\.operationResult\)/,
          /this\.jobMatchesConversationIdentity\(quote\.designJob, params\.conversation\)/,
          /orderDraft\.quoteDraftId !== quote\.id/,
          /String\(orderDraft\.wechatAccountId \|\| ""\) !== String\(params\.conversation\.wechatAccountId \|\| ""\)/,
          /String\(orderDraft\.conversationId \|\| ""\) !== String\(params\.conversation\.id \|\| ""\)/,
          /String\(orderDraft\.customerId \|\| ""\) !== String\(params\.conversation\.customerId \|\| ""\)/,
        ],
        occurrences: [
          { pattern: /this\.localStore\.commitInboundQuoteAcceptance\(\{/g, minimum: 2 },
          { pattern: /kind:\s*"low_value_quote_acceptance"/g, minimum: 2 },
          { pattern: /phase:\s*"quote_and_order_committed"/g, minimum: 2 },
          { pattern: /claimToken:\s*params\.claimToken/g, minimum: 2 },
          { pattern: /leaseExpiresAt:\s*this\.nextInboundLeaseExpiry\(\)/g, minimum: 2 },
        ],
      },
      {
        id: "selection-recovery-parser",
        file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
        startPattern: /function inboundSelectionRecovery\s*\(value:\s*unknown\)/,
        patterns: [
          /\["high_value_image_selection",\s*"low_value_image_selection"\]\.includes/,
          /effect\.phase !== "selection_committed"/,
          /if \(!designJobId \|\| !selectedImageId\)/,
          /effect\.kind === "low_value_image_selection" && !quoteDraftId/,
        ],
      },
      {
        id: "quote-acceptance-recovery-parser",
        file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
        startPattern: /function inboundQuoteAcceptanceRecovery\s*\(value:\s*unknown\)/,
        patterns: [
          /effect\.kind !== "low_value_quote_acceptance" \|\| effect\.phase !== "quote_and_order_committed"/,
          /if \(!quoteDraftId \|\| !orderDraftId \|\| !acceptancePlan\?\.action \|\| !acceptancePlan\?\.reason\)/,
          /\["accept_quote_and_create_order",\s*"update_existing_order_payment"\]\.includes/,
        ],
      },
      {
        id: "completed-inbound-hydration",
        file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
        startPattern: /private async hydrateCompletedInboundReplay\s*\(operation:\s*any,\s*recovered\s*=\s*false\)/,
        patterns: [
          /const designJobId = String\(durable\.designJobId \|\| ""\)\.trim\(\)/,
          /const manualLockRef = isPlainObject\(durable\.manualLock\) \? durable\.manualLock : null/,
          /const manualConversationId = String\(manualLockRef\?\.conversationId \|\| ""\)\.trim\(\)/,
          /const manualReviewLogId = String\(manualLockRef\?\.reviewLogId \|\| ""\)\.trim\(\)/,
          /designJobId \? this\.persistence\.getDesignJob\(designJobId\) : null/,
          /manualConversationId \? this\.persistence\.getConversation\(manualConversationId\) : null/,
          /manualReviewLogId \? this\.persistence\.getReviewLog\(manualReviewLogId\) : null/,
          /if \(manualLockRef && \(!manualConversationId \|\| !manualReviewLogId\)\)/,
          /selection:\s*hydrateDurableSelection\(durable\.selection, designJob\)/,
        ],
      },
      {
        id: "completed-selection-hydration",
        file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
        startPattern: /function hydrateDurableSelection\s*\(value:\s*unknown,\s*designJob:\s*any\)/,
        patterns: [
          /const candidateId = String\(result\.candidateId \|\| result\.imageId \|\| ""\)\.trim\(\)/,
          /const candidates = Array\.isArray\(designJob\?\.images\) \? designJob\.images : \[\]/,
          /candidates\.find\(\(item:\s*any\) => String\(item\?\.id \|\| ""\) === candidateId \|\| String\(item\?\.imageId \|\| ""\) === candidateId\)/,
          /if \(candidateId && \(!designJob \|\| !candidate\)\)/,
          /throw new BadRequestException\("completed inbound operation is missing its durable selection design job or candidate"\)/,
          /result:\s*\{[\s\S]*?candidate/,
        ],
      },
      {
        id: "local-notification-effect-replay",
        file: "desktop/apps/api/src/local-store/local-store.service.ts",
        startPattern: /createNotification\s*\(level:\s*string,\s*title:\s*string,\s*body\?:\s*string,\s*target\?:\s*any\)/,
        maskCommentsAndStrings: true,
        patterns: [
          /const (?<localEffectKey>[A-Za-z_$][\w$]*) = String\(target\?\.effectKey \|\| ""\)\.trim\(\);\s*const identity = this\.resolveTargetIdentity\(data, target \|\| \{\},\s*["']\s*["']\);\s*const normalizedTarget = \{\s*\.\.\.\(target \|\| \{\}\),\s*\.\.\.identity\.identityFields,\s*identityBinding:\s*identity\.binding,?\s*\};\s*if \(\k<localEffectKey>\) \{\s*const existing = data\.notifications\.find\(\(notification\) => String\(notification\?\.target\?\.effectKey \|\| ""\) === \k<localEffectKey>\);\s*if \(existing\) return assertNotificationEffectReplay\(existing, \{ level, title, body, target: normalizedTarget \}\);\s*\}/,
          /const identity = this\.resolveTargetIdentity\(data, target \|\| \{\},\s*["']\s*["']\)/,
          /const normalizedTarget = \{[\s\S]*?\.\.\.\(target \|\| \{\}\)[\s\S]*?\.\.\.identity\.identityFields[\s\S]*?identityBinding:\s*identity\.binding/,
          /if \(existing\) return assertNotificationEffectReplay\(existing, \{ level, title, body, target: normalizedTarget \}\)/,
          /id:\s*effectKey \? deterministicOperationId\(["']\s*["'], effectKey\) : id\(["']\s*["']\)/,
        ],
        occurrences: [
          { pattern: /if \(effectKey\) \{/g, minimum: 1, maximum: 1 },
          { pattern: /data\.notifications\.find\(/g, minimum: 1, maximum: 1 },
          { pattern: /assertNotificationEffectReplay\(/g, minimum: 1, maximum: 1 },
        ],
        forbiddenRanges: [
          { endPattern: /if \(effectKey\) \{/, patterns: [/\breturn\b/] },
        ],
      },
      {
        id: "notification-effect-dispatch",
        file: "desktop/apps/api/src/notifications/notifications.service.ts",
        startPattern: /create\s*\(level:\s*string,\s*title:\s*string,\s*body\?:\s*string,\s*target\?:\s*Record<string, unknown>\)/,
        maskCommentsAndStrings: true,
        patterns: [
          /if \(appConfig\.useLocalStore\) return this\.localStore\.createNotification\(level, title, body, target\);\s*const (?<prismaEffectKey>[A-Za-z_$][\w$]*) = String\(target\?\.effectKey \|\| ""\)\.trim\(\);\s*if \(\k<prismaEffectKey>\) return this\.createPrismaNotificationOnce\(\k<prismaEffectKey>, level, title, body, target\);\s*return this\.prisma\.notification\.create\(\{/,
          /return this\.prisma\.notification\.create\(\{/,
        ],
        occurrences: [
          { pattern: /this\.createPrismaNotificationOnce\(/g, minimum: 1, maximum: 1 },
          { pattern: /this\.prisma\.notification\.create\(/g, minimum: 1, maximum: 1 },
        ],
        forbiddenRanges: [
          {
            startPattern: /const [A-Za-z_$][\w$]* = String\(target\?\.effectKey \|\| ""\)\.trim\(\);/,
            endPattern: /if \([A-Za-z_$][\w$]*\) return this\.createPrismaNotificationOnce\(/,
            patterns: [/\breturn\b/],
          },
        ],
      },
      {
        id: "prisma-notification-effect-replay",
        file: "desktop/apps/api/src/notifications/notifications.service.ts",
        startPattern: /private async createPrismaNotificationOnce\s*\(/,
        patterns: [
          /const id = deterministicOperationId\("notice", effectKey\)/,
          /if \(existing\) return assertNotificationEffectReplay\(existing, \{ level, title, body, target \}\)/,
          /if \(!isUniqueConstraintError\(error\) \|\| typeof notification\.findUnique !== "function"\) throw error/,
          /const winner = await notification\.findUnique\(\{ where: \{ id \} \}\)/,
          /if \(!winner\) throw error/,
          /return assertNotificationEffectReplay\(winner, \{ level, title, body, target \}\)/,
        ],
        occurrences: [
          { pattern: /assertNotificationEffectReplay\(/g, minimum: 2 },
        ],
      },
      {
        id: "notification-effect-replay-assertion",
        file: "desktop/apps/api/src/shared/notification-idempotency.ts",
        startPattern: /export function assertNotificationEffectReplay\s*\([\s\S]*?\n\)\s*/,
        patterns: [
          /const actualFingerprint = notificationEffectFingerprint\(\{[\s\S]*?level:\s*existing\?\.level[\s\S]*?title:\s*existing\?\.title[\s\S]*?body:\s*existing\?\.body[\s\S]*?target:\s*existing\?\.target/,
          /const expectedFingerprint = notificationEffectFingerprint\(expected\)/,
          /if \(actualFingerprint !== expectedFingerprint\)/,
          /throw new BadRequestException\("notification effectKey replay changed identity or business payload"\)/,
        ],
      },
      {
        id: "notification-effect-fingerprint",
        file: "desktop/apps/api/src/shared/notification-idempotency.ts",
        startPattern: /function notificationEffectFingerprint\s*\(value:\s*\{[\s\S]*?\n\}\)\s*/,
        patterns: [
          /return createOperationFingerprint\("notification-effect", \{\}, \{/,
          /level:\s*String\(value\.level \|\| ""\)/,
          /title:\s*String\(value\.title \|\| ""\)/,
          /body:\s*value\.body === undefined \|\| value\.body === null \? null : String\(value\.body\)/,
          /target:\s*notificationBusinessTarget\(value\.target\)/,
        ],
      },
      {
        id: "notification-effect-business-target",
        file: "desktop/apps/api/src/shared/notification-idempotency.ts",
        startPattern: /function notificationBusinessTarget\s*\(value:\s*unknown\)/,
        patterns: [
          /if \(!value \|\| typeof value !== "object" \|\| Array\.isArray\(value\)\) return \{\}/,
          /const \{ identityBinding: _derivedIdentityBinding, \.\.\.businessTarget \} = value as Record<string, unknown>/,
          /return businessTarget/,
        ],
      },
      {
        id: "local-low-value-atomic-commit",
        file: "desktop/apps/api/src/local-store/local-store.service.ts",
        startPattern: /commitInboundLowValueSelection\s*\(payload:\s*\{[\s\S]*?\n\s*\}\)\s*/,
        patterns: [
          /return this\.withStoreLock\(\(\) => \{/,
          /operation\.status !== "processing"/,
          /operation\.claimToken !== payload\.claimToken/,
          /Date\.parse\(String\(operation\.leaseExpiresAt \|\| ""\)\) <= Date\.now\(\)/,
          /String\(job\.wechatAccountId \|\| ""\) !== String\(operation\.wechatAccountId \|\| ""\)/,
          /String\(job\.conversationId \|\| ""\) !== String\(operation\.conversationId \|\| ""\)/,
          /String\(job\.customerId \|\| ""\) !== String\(operation\.customerId \|\| ""\)/,
          /image\.designJobId === payload\.designJobId/,
          /existingQuote\?\.sendTaskId \|\| existingQuote\?\.status === "sent"/,
          /quote\.identityBinding = this\.validateStoredQuoteDraftIdentity\(data, quote\)/,
          /quote\.identityBinding = this\.validateQuoteDraftIdentity\(/,
          /const recoveryEffect = \{ \.\.\.payload\.recoveryEffect, quoteDraftId: quote\.id \}/,
          /result:\s*\{ \.\.\.\(operation\.result \|\| \{\}\), recoveryEffect \}/,
          /this\.write\(data\)/,
        ],
      },
      {
        id: "local-quote-acceptance-atomic-commit",
        file: "desktop/apps/api/src/local-store/local-store.service.ts",
        startPattern: /commitInboundQuoteAcceptance\s*\(payload:\s*\{[\s\S]*?\n\s*\}\)\s*/,
        patterns: [
          /return this\.withStoreLock\(\(\) => \{/,
          /operation\.status !== "processing"/,
          /operation\.claimToken !== payload\.claimToken/,
          /Date\.parse\(String\(operation\.leaseExpiresAt \|\| ""\)\) <= Date\.now\(\)/,
          /String\(designJob\.wechatAccountId \|\| ""\) !== String\(operation\.wechatAccountId \|\| ""\)/,
          /String\(designJob\.conversationId \|\| ""\) !== String\(operation\.conversationId \|\| ""\)/,
          /String\(currentQuote\.customerId \|\| ""\) !== String\(operation\.customerId \|\| ""\)/,
          /currentOrder\.quoteDraftId !== quote\.id/,
          /quote\.identityBinding = this\.validateStoredQuoteDraftIdentity\(data, quote\)/,
          /order\.identityBinding = this\.validateStoredOrderDraftBinding\(data, order\)/,
          /quoteDraftId:\s*quote\.id/,
          /orderDraftId:\s*order\.id/,
          /result:\s*\{ \.\.\.\(operation\.result \|\| \{\}\), recoveryEffect \}/,
          /this\.write\(data\)/,
        ],
      },
      {
        id: "local-store-lock-domain",
        file: "desktop/apps/api/src/local-store/local-store.service.ts",
        startPattern: /private withStoreLock<T>\s*\(operation:\s*\(\) => T\): T\s*/,
        patterns: [
          /if \(this\.storeLockDepth > 0\) return operation\(\)/,
          /const lock = acquireLocalStoreLock\(this\.filePath\)/,
          /this\.storeLockOwnershipCheck = lock\.assertOwned/,
          /finally\s*\{[\s\S]*?this\.storeLockDepth -= 1[\s\S]*?lock\.release\(\)/,
        ],
      },
      {
        id: "local-store-cross-process-lock",
        file: "desktop/apps/api/src/local-store/local-store.service.ts",
        startPattern: /export function acquireLocalStoreLock\s*\(filePath:\s*string\)\s*/,
        patterns: [
          /const lockPath = `\$\{filePath\}\.lock`/,
          /const ownerToken = randomUUID\(\)/,
          /const pendingPath = `\$\{lockPath\}\.pending-\$\{process\.pid\}-\$\{ownerToken\}`/,
          /fs\.renameSync\(pendingPath, lockPath\)/,
          /return ownedLocalStoreLockHandle\(lockPath, ownerFileName\)/,
          /localStoreLockIsStale\(lockPath\)/,
        ],
      },
      {
        id: "local-store-lock-owner-fence",
        file: "desktop/apps/api/src/local-store/local-store.service.ts",
        startPattern: /function ownedLocalStoreLockHandle\s*\(lockPath:\s*string,\s*ownerFileName:\s*string\)/,
        maskCommentsAndStrings: true,
        patterns: [
          /const ownerPath = path\.join\(lockPath, ownerFileName\)/,
          /assertOwned:\s*\(\) => \{\s*if \(released \|\| !fs\.existsSync\(ownerPath\)\) \{\s*throw new LocalStoreConcurrentWriteError\(["']\s*["']\);\s*\}\s*\}/,
        ],
        occurrences: [
          { pattern: /if \(released \|\| !fs\.existsSync\(ownerPath\)\)/g, minimum: 1, maximum: 1 },
          { pattern: /assertOwned:\s*\(\) => \{/g, minimum: 1, maximum: 1 },
        ],
        forbiddenRanges: [
          {
            startPattern: /assertOwned:\s*\(\) => \{/,
            endPattern: /if \(released \|\| !fs\.existsSync\(ownerPath\)\)/,
            patterns: [/\breturn\b/],
          },
        ],
      },
      {
        id: "local-store-lock-release",
        file: "desktop/apps/api/src/local-store/local-store.service.ts",
        startPattern: /release:\s*\(\) =>\s*/,
        maskCommentsAndStrings: true,
        patterns: [
          /release:\s*\(\) => \{\s*if \(released\) return;\s*released = true;[\s\S]*?fs\.unlinkSync\(ownerPath\)[\s\S]*?fs\.rmdirSync\(lockPath\)/,
        ],
        occurrences: [
          { pattern: /release:\s*\(\) => \{/g, minimum: 1, maximum: 1 },
          { pattern: /released = true/g, minimum: 1, maximum: 1 },
          { pattern: /fs\.unlinkSync\(ownerPath\)/g, minimum: 1, maximum: 1 },
          { pattern: /fs\.rmdirSync\(lockPath\)/g, minimum: 1, maximum: 1 },
        ],
      },
    ],
  },
  {
    id: "contract.inbound_operation_lease_fencing",
    title: "Inbound persistence renews leases and rejects expired stage owners",
    file: "desktop/apps/api/src/wechat/wechat-persistence.ts",
    patterns: [
      /renewInboundOperationLease/,
      /leaseExpiresAt:\s*\{\s*gt:\s*new Date\(\)\s*\}/,
      /assertInboundOperationReplay/,
    ],
  },
  {
    id: "contract.local_inbound_recovery_atomicity",
    title: "Local inbound high-value selection and recovery marker commit atomically",
    file: "desktop/apps/api/src/local-store/local-store.service.ts",
    patterns: [
      /renewInboundMessageOperationLease/,
      /commitInboundHighValueSelection/,
      /recoveryEffect/,
    ],
  },
  {
    id: "contract.inbound_operation_payload_safety",
    title: "Inbound durable payloads whitelist attachments and validate asset identifiers",
    file: "desktop/apps/api/src/shared/operation-idempotency.ts",
    patterns: [
      /sanitizeInboundOperationAttachments/,
      /sanitizeInboundOperationAssetIds/,
      /sanitizeInboundBusinessIdentifier/,
    ],
  },
  {
    id: "contract.package_scripts",
    title: "生产 npm 入口",
    file: "desktop/package.json",
    patterns: [
      /"release:gate"\s*:/,
      /"staging:readiness"\s*:/,
      /"database:recovery:plan"\s*:/,
      /"database:recovery:execute"\s*:/,
      /"package:win:test"\s*:/,
      /"package:win:signed"\s*:/,
      /"ci:release-quality"\s*:/,
      /"project:completion:audit"\s*:/,
      /"test"\s*:\s*"node --test --test-concurrency=1 tests\/\*\.test\.js"/,
      /"prisma:agents:init"\s*:\s*"node tools\/initialize-prisma-agents\.js"/,
    ],
  },
  {
    id: "contract.runtime_service_secret_allowlists",
    title: "业务密钥仅进入 API 服务，Web/observer/worker 使用最小白名单",
    file: "desktop/packages/runtime/service-environment.js",
    patterns: [
      /const API_KEYS\s*=\s*\[[^\]]*"DATABASE_URL"/,
      /const API_KEYS\s*=\s*\[[^\]]*"LOW_VALUE_AUTOMATION_REDIS_URL"/,
      /const API_KEYS\s*=\s*\[[^\]]*"WECHAT_WORK_SECRET"/,
      /const API_KEYS\s*=\s*\[[^\]]*"DESIGN_PLATFORM_ACCESS_TOKEN"/,
      /const API_KEYS\s*=\s*\[[^\]]*"PERSONAL_WECHAT_RPA_TOKEN"/,
      /web:\s*\[\.\.\.RUNTIME_KEYS,\s*"INTERNAL_API_TOKEN",\s*"DESKTOP_WEB_SESSION_PROOF"\]/,
      /"design-platform-mock":\s*\[\.\.\.RUNTIME_KEYS\]/,
      /"wechat-window-observer":\s*OBSERVER_KEYS/,
      /"wechat-bridge-worker":\s*BRIDGE_KEYS/,
      /"personal-wechat-bridge":\s*PERSONAL_BRIDGE_KEYS/,
      /return selectKeys\(\{ \.\.\.baseEnv, \.\.\.overrides \}, keys\)/,
    ],
    forbidden: [
      /web:\s*\[[^\]]*\b(?:DATABASE_URL|LOW_VALUE_AUTOMATION_REDIS_URL|WECHAT_WORK_SECRET|DESIGN_PLATFORM_ACCESS_TOKEN|DESIGN_PLATFORM_COOKIE|PERSONAL_WECHAT_RPA_TOKEN)\b/,
      /const OBSERVER_KEYS\s*=\s*\[[^\]]*\b(?:INTERNAL_API_TOKEN|DATABASE_URL|LOW_VALUE_AUTOMATION_REDIS_URL|WECHAT_WORK_SECRET|DESIGN_PLATFORM_ACCESS_TOKEN|DESIGN_PLATFORM_COOKIE|PERSONAL_WECHAT_RPA_TOKEN)\b/,
      /const BRIDGE_KEYS\s*=\s*\[[^\]]*\b(?:INTERNAL_API_TOKEN|DATABASE_URL|LOW_VALUE_AUTOMATION_REDIS_URL|WECHAT_WORK_SECRET|DESIGN_PLATFORM_ACCESS_TOKEN|DESIGN_PLATFORM_COOKIE|PERSONAL_WECHAT_RPA_TOKEN)\b/,
      /const PERSONAL_BRIDGE_KEYS\s*=\s*\[[^\]]*\b(?:INTERNAL_API_TOKEN|DATABASE_URL|LOW_VALUE_AUTOMATION_REDIS_URL|WECHAT_WORK_SECRET|DESIGN_PLATFORM_ACCESS_TOKEN|DESIGN_PLATFORM_COOKIE|PERSONAL_WECHAT_RPA_TOKEN)\b/,
    ],
  },
  {
    id: "contract.runtime_wrapper_secret_boundary",
    title: "Windows wrapper 只持久化非敏感引用，不落原始凭据",
    file: "desktop/packages/runtime/service-environment.js",
    patterns: [
      /const WRAPPER_KEYS\s*=\s*new Set\(/,
      /function selectWrapperEnvironment\(serviceName, env\)/,
      /WRAPPER_KEYS\.has\(normalized\)/,
      /function renderWindowsWrapperEnvironment\(serviceName, env\)[\s\S]*?selectWrapperEnvironment\(serviceName, env\)/,
    ],
    forbidden: [
      /const WRAPPER_KEYS\s*=\s*new Set\(\[[\s\S]*?\b(?:INTERNAL_API_TOKEN|DATABASE_URL|LOW_VALUE_AUTOMATION_REDIS_URL|WECHAT_WORK_SECRET|WECHAT_WORK_TOKEN|WECHAT_WORK_ENCODING_AES_KEY|DESIGN_PLATFORM_ACCESS_TOKEN|DESIGN_PLATFORM_API_KEY|DESIGN_PLATFORM_CALLBACK_API_KEY|DESIGN_PLATFORM_COOKIE|PERSONAL_WECHAT_RPA_TOKEN)\b[\s\S]*?\]\.map/,
    ],
  },
  {
    id: "contract.runtime_packaged_service_environment",
    title: "打包桌面 API/Web 进程使用隔离后的服务环境",
    file: "desktop/apps/electron/packaged-runtime.js",
    patterns: [
      /return selectServiceEnvironment\("api", baseEnv,/,
      /return selectServiceEnvironment\("web", baseEnv,/,
      /INTERNAL_API_TOKEN:\s*token/,
      /DESKTOP_WEB_SESSION_PROOF:\s*webSessionProof/,
      /this\.spawnService\("api",[\s\S]*?apiEnv/,
      /this\.spawnService\([\s\S]*?"web"[\s\S]*?buildWebServiceEnvironment\(/,
      /validateApiReadinessResponse\(response, this\.token, this\.webSessionProof\)/,
      /desktopReadinessChallengeHeaders\(this\.webSessionProof\)/,
      /waitForHttp\(WEB_URL, web, 45_000, validateWebOverviewResponse\)/,
      /validateWebApiReadinessResponse\(response, this\.token, this\.webSessionProof\)/,
    ],
  },
  {
    id: "contract.packaged_readiness_truth",
    title: "Packaged services require exact HTTP 200 and service-specific readiness truth",
    file: "desktop/apps/electron/packaged-runtime.js",
    patterns: [
      /response\.statusCode === 200 && validateResponse\(response\)/,
      /payload\?\.ok === true && payload\?\.service === "smart-kefu-desktop-api"/,
      /verifyApiReadinessProof\(token, challenge, payload\?\.\[API_READINESS_PROOF_FIELD\]\)/,
      /verifyWebReadinessProof\(/,
      /contentType\.includes\("text\/html"\)/,
      /overview-center/,
      /validateWebOverviewResponse/,
    ],
  },
  {
    id: "contract.packaged_smoke_proof_chain",
    title: "Packaged smoke covers missing-proof denial and launch-bound API/Web HMAC success",
    file: "desktop/tools/smoke-packaged-api.js",
    patterns: [
      /apiHealth\.statusCode !== 200/,
      /overview\.statusCode !== 200/,
      /desktop_session_proof_missing/,
      /desktopSessionCookieHeader\(desktopWebSessionProof\)/,
      /authenticatedProxyHealth\.statusCode !== 200/,
      /validateApiReadinessResponse\(response, token, desktopWebSessionProof\)/,
      /validateWebApiReadinessResponse\(/,
      /launch_bound_web_api_hmac/,
    ],
  },
  {
    id: "contract.packaged_readiness_hmac",
    title: "Packaged readiness proofs are launch-bound HMACs with constant-time verification",
    file: "desktop/packages/runtime/packaged-readiness-proof.js",
    patterns: [
      /crypto\.createHmac\("sha256", Buffer\.from\(token, "hex"\)\)/,
      /smart-kefu-api-readiness-v1/,
      /smart-kefu-web-readiness-v1/,
      /function verifyApiReadinessProof/,
      /function verifyWebReadinessProof/,
      /crypto\.timingSafeEqual/,
    ],
  },
  {
    id: "contract.windows_package_provenance_truth",
    title: "Windows packaging forces a clean Web build before final provenance capture",
    file: "desktop/tools/build-windows-package.js",
    patterns: [
      /runNpm\(\["run", "build:web"\],[\s\S]*?FORCE_WEB_CLEAN_BUILD:\s*"1"/,
      /runNpm\(\["run", "build:web"\],[\s\S]*?assertBuildInputs\(\);[\s\S]*?requireCleanRepository\(\)/,
      /packageRepositoryState\.revision !== initialRepositoryState\.revision/,
      /writePackageProvenance\(packageRepositoryState\)/,
    ],
  },
  {
    id: "contract.external_windows_artifact_truth",
    title: "External evidence verifies a stable private package snapshot instead of report claims",
    file: "desktop/tools/external-evidence-bundle.js",
    patterns: [
      /inspectDistinctArtifacts\(installer, executable, state\)/,
      /installer\.sha256 !== executable\.sha256/,
      /stat\.size !== BigInt\(reported\.bytes\)/,
      /sha256File\(file\)/,
      /createPrivateSnapshot\(outputDir,\s*\{/,
      /await verifyWindowsPackage\(\{/,
      /runtimeSmokeResult:\s*\{ status: STATUS\.PASS, summary: "runtime smoke is deferred/,
      /trustPrerequisitesPass/,
      /hooks\.verifyInstallerBinding\(\{/,
      /hooks\.runPackagedSmoke\(\{ outputDirectory: snapshotOutputDir/,
      /progress\.signatureInspectionAttempted = contentPrerequisitesPass/,
      /progress\.installerBindingAttempted = true/,
      /progress\.runtimeSmokeExecuted = true/,
      /temporaryFilesWritten: livePackageVerification\.temporaryFilesWritten/,
      /snapshotAfter = createTreeManifest\(snapshotOutputDir\)/,
      /sourceAfter = createTreeManifest\(outputDir, snapshot\.treeOptions\)/,
      /manifestsEqual\(snapshot\.snapshotManifest, snapshotAfter\)/,
      /cleanupPrivateTemp\(snapshot\.cleanupHandle\)/,
      /verification\.repositoryRevision === currentRevision/,
      /verification\.version === version/,
      /nativeEvidenceEligible:\s*hooks\.mode === "native"/,
    ],
    forbidden: [/options\.verifySignature/, /options\.runPackagedSmoke/, /options\.verifyInstallerBinding/],
  },
  {
    id: "contract.windows_evidence_chain",
    title: "Windows evidence rejects reparse points and binds native signer, NSIS payload and runtime smoke",
    file: "desktop/tools/windows-evidence-chain.js",
    patterns: [
      /stat\.isSymbolicLink\(\)/,
      /stat\.nlink !== 1n/,
      /createTreeManifest\(sourceDirectory, treeOptions\)/,
      /package tree changed while the private snapshot was created/,
      /package tree exceeds maximum total bytes/,
      /private temp cleanup requires its creation handle/,
      /identityStatus === "CONFIGURED"/,
      /allowedPublisherSubjects/,
      /allowedCertificateThumbprints/,
      /Get-AuthenticodeSignature/,
      /trustedWindowsSystemTool\("WindowsPowerShell", "v1\.0", "powershell\.exe"\)/,
      /windows-release-extractor-policy\.json/,
      /hashFile\(candidate\) !== policy\.sha256/,
      /validateSevenZipListing/,
      /maxCompressionRatio/,
      /inspectArchiveBudget\(sevenZip, installer/,
      /archive identity or SHA-256 changed after technical listing/,
      /createVerifiedArchiveSnapshot/,
      /archiveSnapshot\.path/,
      /verifiedArchive = assertSafePath\(safeSnapshotRoot, budget\.archivePath, "file"\)/,
      /runVerifiedArchiveExtraction/,
      /archive contains a linked or reparse entry/,
      /archive file is an ancestor of another entry/,
      /findNamedFile\(outer, "app-64\.7z", extractionLimits\)/,
      /app-64\.7z/,
      /signed installer payload does not match/,
      /PACKAGED_SMOKE_OUTPUT_DIR/,
      /selectEvidenceProcessEnvironment/,
      /terminateProcessTree/,
      /packaged runtime smoke orchestrator timed out/,
    ],
  },
  {
    id: "contract.windows_streaming_artifact_hash",
    title: "Windows artifact hashes stream bounded chunks without whole-file materialization",
    file: "desktop/tools/verify-windows-package.js",
    patterns: [
      /async function verifyWindowsPackage/,
      /fs\.createReadStream\(file/,
      /await sha256FileStream\(file\)/,
    ],
    forbidden: [/hash\.update\(fs\.readFileSync\(file\)\)/],
  },
  {
    id: "contract.runtime_observer_child_environment",
    title: "一次性 observer 子进程不继承 API 业务密钥",
    file: "desktop/apps/api/src/shared/runtime-child-environment.ts",
    patterns: [
      /const OBSERVER_ENV_KEYS\s*=\s*\[/,
      /WECHAT_WINDOW_OBSERVER_PROOF_FILE/,
      /WECHAT_WINDOW_SNAPSHOT_INBOX_DIR/,
      /allowed\.has\(key\.toUpperCase\(\)\)/,
    ],
    forbidden: [
      /const OBSERVER_ENV_KEYS\s*=\s*\[[^\]]*\b(?:INTERNAL_API_TOKEN|DATABASE_URL|LOW_VALUE_AUTOMATION_REDIS_URL|WECHAT_WORK_SECRET|DESIGN_PLATFORM_ACCESS_TOKEN|DESIGN_PLATFORM_COOKIE|PERSONAL_WECHAT_RPA_TOKEN)\b/,
    ],
  },
  {
    id: "contract.private_runtime_json_safety",
    title: "私有运行时 JSON 原子写入且仅接受普通文件",
    file: "desktop/tools/private-runtime-file.js",
    patterns: [
      /fs\.lstatSync\(filePath\)/,
      /stat\.isSymbolicLink\(\) \|\| !stat\.isFile\(\)/,
      /fs\.openSync\(temporaryPath, "wx", 0o600\)/,
      /fs\.fsyncSync\(fd\)/,
      /assertPrivateRegularFileOrMissing\(filePath\);[\s\S]*?fs\.renameSync\(temporaryPath, filePath\)/,
      /JSON\.parse\(fs\.readFileSync\(filePath, "utf8"\)\)/,
    ],
    forbidden: [/fs\.writeFileSync\(filePath,/],
  },
  {
    id: "contract.windows_package",
    title: "Windows 安装包与签名边界",
    file: "desktop/electron-builder.yml",
    patterns: [/target:\s*nsis/i, /asar:\s*true/i, /extraResources:/i],
  },
  {
    id: "contract.ci_safety",
    title: "CI 最小权限与脱敏报告",
    file: ".github/workflows/windows-quality.yml",
    patterns: [
      /permissions:\s*[\r\n]+\s*contents:\s*read/i,
      /persist-credentials:\s*false/i,
      /upload-artifact@v4/i,
      /unsigned-package:/,
      /npm\.cmd run package:win:test/,
      /windows-unsigned-package-verification/,
      /desktop\/release\/windows\/verification\/packaged-api-smoke\.json/,
    ],
    forbidden: [/pull_request_target\s*:/i],
  },
  {
    id: "contract.excel_import",
    title: "Excel 文件解析导入",
    file: "desktop/packages/rules/skuImport.js",
    patterns: [/function parseSkuImportFile/, /function buildSkuImportTemplateXlsx/, /parseSkuImportFile,/, /buildSkuImportTemplateXlsx,/],
  },
  {
    id: "contract.excel_import_export",
    title: "Excel 解析规则统一导出",
    file: "desktop/packages/rules/index.js",
    patterns: [/\.\.\.require\(["']\.\/skuImport["']\)/],
  },
  {
    id: "contract.excel_import_limits",
    title: "Excel 导入编码、ZIP 与工作表资源边界",
    file: "desktop/packages/rules/skuImport.js",
    patterns: [
      /SKU_IMPORT_LIMITS/,
      /function isCanonicalBase64/,
      /SKU_IMPORT_ZIP_BOUNDS/,
      /SKU_IMPORT_ZIP64_UNSUPPORTED/,
      /SKU_IMPORT_ZIP_MULTIDISK/,
      /SKU_IMPORT_ZIP_ENCRYPTED/,
      /SKU_IMPORT_ZIP_DESCRIPTOR/,
      /SKU_IMPORT_ZIP_LOCAL_OVERLAP/,
      /SKU_IMPORT_ZIP_CRC/,
      /maxZipEntries/,
      /maxZipEntryUncompressedBytes/,
      /maxZipTotalUncompressedBytes/,
      /maxOutputLength: SKU_IMPORT_LIMITS\.maxZipEntryUncompressedBytes/,
      /maxSharedStrings/,
      /maxWorksheetRows/,
      /maxWorksheetCells/,
      /maxXmlTagBytes/,
      /maxTextRunsPerCell/,
      /maxCellTextBytes/,
      /maxFinalTextBytes/,
      /const XML_SCANNER_CONTRACT = Object\.freeze/,
      /strategy: "forward-only-index-scanner"/,
      /materializesMatchArrays: false/,
      /rejectsElementNPlusOneBeforeBodyScan: true/,
      /function scanXmlElements/,
      /if \(count > options\.limit\)/,
      /const start = findNextXmlStartTag[\s\S]*?count \+= 1;[\s\S]*?if \(count > options\.limit\)[\s\S]*?const openEnd = findXmlTagEnd/,
      /function findNextXmlStartTag/,
      /function findNextXmlStartTag[\s\S]*?const found = xml\.indexOf\(needle, cursor\)[\s\S]*?cursor = found \+ needle\.length/,
      /function findXmlTagEnd/,
      /SKU_IMPORT_XML_MALFORMED/,
      /SKU_IMPORT_XML_TAG_LIMIT/,
      /SKU_IMPORT_TEXT_RUN_LIMIT/,
      /SKU_IMPORT_CELL_TEXT_LIMIT/,
    ],
    forbidden: [
      /const items\s*=\s*xml\.match/,
      /const rowMatches\s*=\s*xml\.match/,
      /const cellMatches\s*=\s*rowXml\.match/,
      /(?:cellXml|item)\.matchAll/,
    ],
  },
  {
    id: "contract.asset_ingestion_limits",
    title: "资产摄取格式、字节、真实内容与下载边界",
    file: "desktop/apps/api/src/storage/storage.service.ts",
    patterns: [
      /MAX_IMAGE_FINGERPRINT_BYTES/,
      /assertAssetSize\(decodeBase64\(params\.base64\)\)/,
      /Buffer\.byteLength\(params\.text, "utf8"\)/,
      /normalizeAssetUrl\(params\.url\)/,
      /timeout: appConfig\.designPlatformTimeoutMs/,
      /maxContentLength: MAX_IMAGE_FINGERPRINT_BYTES/,
      /maxBodyLength: MAX_IMAGE_FINGERPRINT_BYTES/,
      /isCanonicalBase64Text/,
      /asset URL must use http\(s\)/,
      /inspectSafeAssetContent/,
      /downloadBoundedBytes/,
      /assertCanonicalStoragePath/,
    ],
  },
  {
    id: "contract.asset_public_network",
    title: "资产公网解析、逐跳重定向与 DNS 绑定",
    file: "desktop/apps/api/src/storage/safe-download.ts",
    patterns: [
      /resolvePublicDownloadTarget/,
      /url\.username \|\| url\.password/,
      /all: true, verbatim: true/,
      /resolved\.some\(\(item\) => !isPublicAddress/,
      /createPinnedLookup/,
      /maxRedirects: 0/,
      /proxy: false/,
      /169\.254\.0\.0/,
      /2001:db8::/,
    ],
  },
  {
    id: "contract.asset_content_truth",
    title: "资产 magic、解码、PDF 与文本安全类型真值",
    file: "desktop/apps/api/src/storage/asset-content-security.ts",
    patterns: [
      /sharp\(buffer/,
      /%PDF-/,
      /ACTIVE_PDF_PATTERN/,
      /new TextDecoder\("utf-8", \{ fatal: true \}\)/,
      /ACTIVE_TEXT_PATTERN/,
      /asset fileName extension does not match file content/,
      /asset mimeType does not match file content/,
      /kind: "pdf", mimeType: "application\/pdf", extension: "\.pdf", inlineSafe: false/,
    ],
  },
  {
    id: "contract.asset_local_file_headers",
    title: "两处本地资产响应的 nosniff、sandbox 与下载策略",
    file: "desktop/apps/api/src/storage/local-file-response.ts",
    patterns: [
      /X-Content-Type-Options/,
      /nosniff/,
      /Content-Security-Policy/,
      /sandbox;/,
      /Content-Disposition/,
      /"attachment"/,
    ],
  },
  {
    id: "contract.assets_controller_safe_file_response",
    title: "素材控制器复用安全本地文件响应",
    file: "desktop/apps/api/src/assets/assets.controller.ts",
    patterns: [/applySafeLocalFileHeaders\(reply, file\)/],
  },
  {
    id: "contract.design_controller_safe_file_response",
    title: "设计图控制器复用安全本地文件响应",
    file: "desktop/apps/api/src/design-jobs/design-jobs.controller.ts",
    patterns: [/applySafeLocalFileHeaders\(reply, file\)/],
  },
  {
    id: "contract.asset_security_documentation",
    title: "资产安全契约不再保留部署侧 SSRF 缺口",
    file: "desktop/docs/DESIGN_PLATFORM_CONTRACT.md",
    patterns: [/DNS rebinding/, /Content-Disposition/, /realpath/, /不再作为“部署侧未决”项冒充已完成/],
    forbidden: [/私网地址、DNS 重绑定.*仍需要部署负责人/],
  },
  {
    id: "contract.wechat_prisma",
    title: "微信与企业微信 Prisma 持久化",
    file: "desktop/apps/api/src/wechat/wechat-persistence.ts",
    patterns: [/if \(this\.isLocal\)/, /wechatWorkBinding/, /wechatWorkAuditLog/, /wechatSendTask/],
  },
  {
    id: "contract.wechat_work_canonical_binding",
    title: "企业微信首次绑定使用确定性身份与竞争赢家回放",
    file: "desktop/apps/api/src/wechat/wechat-persistence.ts",
    patterns: [
      /upsertCanonicalWechatWorkBinding/,
      /deterministicOperationId\("wwacct"/,
      /deterministicOperationId\("wwcust"/,
      /singleWechatWorkHistoryId/,
      /for \(let attempt = 0; attempt < 4; attempt \+= 1\)/,
      /wechat work canonical binding conflict/,
      /tx\.wechatWorkBinding\.updateMany/,
      /lastInboundAt:\s*\{\s*lt:\s*lastInboundAt\s*\}/,
      /normalizeWechatWorkInboundAt/,
    ],
  },
  {
    id: "contract.local_wechat_work_binding_timestamp_monotonic",
    title: "LocalStore 企业微信入站时间戳单调推进",
    file: "desktop/apps/api/src/local-store/local-store.service.ts",
    patterns: [
      /monotonicWechatWorkInboundAt/,
      /normalizeWechatWorkInboundAt/,
      /normalizeInstant|currentValue >= incoming/,
      /Date\.parse\(currentValue\) >= Date\.parse\(incomingValue\)|currentValue >= incoming/,
    ],
  },
  {
    id: "contract.wechat_prisma_send_atomicity",
    title: "Prisma 发送任务、attempt 与订单报价原子迁移",
    file: "desktop/apps/api/src/wechat/wechat-persistence.ts",
    patterns: [
      /completeAttemptAndTask/,
      /linkedTransition/,
      /tx\.wechatSendTask\.updateMany/,
      /tx\.wechatSendAttempt\.update/,
      /linked\.count !== 1/,
      /updateSendTaskWithLinkedTransition/,
    ],
  },
  {
    id: "contract.local_wechat_send_claim_atomicity",
    title: "LocalStore 发送任务与 attempt 单文件原子迁移",
    file: "desktop/apps/api/src/local-store/local-store.service.ts",
    patterns: [
      /claimQueuedSendTaskAndCreateAttempt/,
      /completeSendAttemptAndTask/,
      /data\.sendTasks\[taskIndex\] = nextTask/,
      /data\.sendAttempts\.push\(attempt\)/,
      /expectedAttemptStatus/,
    ],
  },
  {
    id: "contract.local_wechat_adapter_failure_fail_closed",
    title: "Local bridge adapter 故障按可证明边界失败关闭",
    file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
    patterns: [
      /claimQueuedSendTaskAndCreateAttempt/,
      /error instanceof WechatBridgeOutboxError && error\.deliveryState === "failed"/,
      /failureStage = error instanceof WechatBridgeOutboxError/,
      /deliveryUnknownReason = knownNotSent \? null : "adapter_execution_exception"/,
      /automaticRetryBlocked: !knownNotSent/,
      /expectedAttemptStatus: "started"/,
    ],
  },
  {
    id: "contract.local_wechat_outbox_failure_provenance",
    title: "Windows bridge outbox 写入故障来源不可由错误文本伪造",
    file: "desktop/apps/api/src/wechat/wechat-send-adapter.service.ts",
    patterns: [
      /class WechatBridgeOutboxError extends Error/,
      /stage: "outbox_mkdir"/,
      /deliveryState: published \? "unknown" : "failed"/,
      /attemptId: context\.attemptId/,
    ],
  },
  {
    id: "contract.wechat_prisma_send_fail_closed",
    title: "Prisma 企业微信与 bridge 发送闭环",
    file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
    patterns: [
      /await this\.executeQueuedSend\(freshTask\.id/,
      /pendingAttempt\.adapter !== "windows_bridge"/,
      /await this\.resolveBridgeAckAttempt\(task, payload\)/,
      /validatePrismaLinkedSendState/,
      /deliveryState: "unknown"/,
      /acceptedMessageIds: apiMsgIds/,
      /bridgeAckTokenHash: hashBridgeAckToken\(payload\)/,
      /Files remain in place until the task \+ attempt transition is durably committed/,
    ],
  },
  {
    id: "contract.wechat_inflight_send_resolution",
    title: "在途发送取消隔离、迟到结果收敛与人工处置",
    file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
    patterns: [
      /protectLocalInflightSendFromCancellation/,
      /protectPrismaInflightSendFromCancellation/,
      /protectInFlightSendTasksForManualLock/,
      /deliveryUnknownReason:\s*"manual_cancel_requested_inflight"/,
      /manualReviewRequired:\s*true/,
      /automaticRetryBlocked:\s*true/,
      /resolveUnknownSendDelivery/,
      /"confirmed_sent"/,
      /"confirmed_not_sent"/,
      /requireExactSendTaskIdentity/,
      /assertExactOperationReplay/,
      /settleWechatWorkAsyncFailure/,
      /deterministicOperationId\("wechat_work_audit", operationKey, "manual-send-delivery-resolution"\)/,
      /deliveryResolutionPriority:\s*"manual_audited_terminal"/,
      /previousManualDeliveryResolution/,
      /manualDeliveryResolution:\s*null/,
      /protectedUnknownInFlightSendTaskIds/,
      /cancelledInFlightSendTaskIds:\s*\[\]/,
    ],
  },
  {
    id: "contract.wechat_manual_delivery_resolution_guard",
    title: "未知投递人工处置要求发送审批能力与可信操作人",
    file: "desktop/apps/api/src/wechat/wechat.controller.ts",
    patterns: [
      /@Post\("send-tasks\/:id\/resolve-delivery"\)[\s\S]{0,160}@RequireOperatorCapability\("approve_send"\)[\s\S]{0,160}@UseGuards\(OperatorAccessGuard\)[\s\S]{0,500}@TrustedOperator\(\) principal[\s\S]{0,300}resolveUnknownSendDelivery\(id, payload, principal\.id\)/,
    ],
  },
  {
    id: "contract.wechat_work_cursor_terminality",
    title: "企业微信入站终态游标与 CAS",
    file: "desktop/apps/api/src/wechat-work/wechat-work.service.ts",
    patterns: [
      /activeCursorSyncs/,
      /getWechatWorkSyncCursor/,
      /expectedCursor:\s*cursor/,
      /permanent_manual_review/,
      /cursorScopeMismatch/,
    ],
  },
  {
    id: "contract.wechat_work_terminal_idempotency",
    title: "企业微信入站终态幂等白名单",
    file: "desktop/apps/api/src/wechat/wechat-persistence.ts",
    patterns: [
      /action:\s*"inbound_processed",\s*status:\s*"processed"/,
      /action:\s*"inbound_failed",\s*status:\s*"permanent_manual_review"/,
      /wechatWorkSyncCursor\.updateMany/,
    ],
  },
  {
    id: "contract.wechat_work_prisma_selection_parity",
    title: "企业微信 Prisma 选图身份与修订一致性",
    file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
    patterns: [
      /handlePrismaInboundImageSelection/,
      /wechatAccountId:\s*identity\.wechatAccountId/,
      /customerId:\s*identity\.customerId/,
      /latestCandidateRound/,
      /shouldLetQuoteAcceptanceHandleSelectionText/,
      /high_value_customer_selected_image/,
      /designSelectionRevisionSignature/,
    ],
  },
  {
    id: "contract.prisma_order_send_invalidation",
    title: "Prisma 订单与待发送任务原子失效",
    file: "desktop/apps/api/src/orders/orders.service.ts",
    patterns: [
      /updatePrismaOrderAndQuoteWithSendInvalidation/,
      /return prisma\.\$transaction\(async \(tx: any\) =>/,
      /tx\.quoteDraft\.update/,
      /status:\s*\{\s*in:\s*\["queued", "blocked", "failed"\]\s*\}/,
      /tx\.wechatSendTask\.updateMany/,
      /invalidationStateChanged \|\| cancelledSendTasks\.length > 0/,
      /decision:\s*"invalidate_pending_order_send_tasks"/,
      /reviewer:\s*"system_order_invalidation"/,
    ],
  },
  {
    id: "contract.documentation",
    title: "完成度审计文档入口",
    file: "desktop/README.md",
    patterns: [/project:completion:audit/, /dhash64:v1/, /legacyIdentityHash/],
  },
  {
    id: "contract.perceptual_hash",
    title: "真实图片字节 dHash64 v1",
    file: "desktop/apps/api/src/shared/image-fingerprint.ts",
    patterns: [/IMAGE_FINGERPRINT_ALGORITHM\s*=\s*["']dhash64:v1["']/, /from ["']sharp["']/, /\.rotate\(\)/, /\.flatten\(/, /\.greyscale\(\)/, /\.resize\(9, 8/],
  },
  {
    id: "contract.wechat_media_download",
    title: "企业微信入站图片下载与失败分类",
    file: "desktop/apps/api/src/wechat-work/wechat-work-api.client.ts",
    patterns: [/\/cgi-bin\/media\/get/, /encodeURIComponent\(mediaId\)/, /errcode === 40007/, /errcode === 41006/, /errcode === 45009/, /retry_exhausted/],
  },
  {
    id: "contract.wechat_media_storage",
    title: "企业微信入站图片安全落盘",
    file: "desktop/apps/api/src/wechat-work/wechat-work-inbound-media.ts",
    patterns: [/MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES/, /LOCAL_STORAGE_ROOT/, /fs\.link\(temporaryPath, finalPath\)/, /inspectExistingImage/],
  },
  {
    id: "contract.perceptual_matcher",
    title: "图片感知距离失败关闭匹配",
    file: "desktop/packages/rules/selectionMatcher.js",
    patterns: [/hammingDistance/, /nearest\.distance > 1/, /gap < 2/, /候选图存在缺失或旧版指纹/],
  },
  {
    id: "contract.sharp_runtime",
    title: "Sharp 生产依赖与 Windows 运行时",
    file: "desktop/package.json",
    patterns: [/["']sharp["']\s*:\s*["']0\.34\.5["']/],
  },
  {
    id: "contract.report_ignored",
    title: "完成度报告忽略规则",
    file: ".gitignore",
    patterns: [/^desktop\/\.runtime\/$/m],
  },
  {
    id: "contract.release_checklist_truth",
    title: "发布清单完成度与外部证据边界",
    file: "docs/PRODUCTION_RELEASE_CHECKLIST.md",
    patterns: [/project:completion:audit/, /package:win:signed/, /database:recovery:execute/, /真实签名.*BLOCKED/s],
  },
  {
    id: "contract.automation_durable_runtime",
    title: "生产自动化 BullMQ/Redis 持久调度",
    file: "desktop/apps/api/src/automation/automation-queue.runtime.ts",
    patterns: [/from ["']bullmq["']/, /new Queue\(/, /new Worker\(/, /connection:/],
  },
  {
    id: "contract.automation_durable_status",
    title: "生产自动化持久调度状态来源",
    file: "desktop/apps/api/src/automation/automation-scheduler.service.ts",
    patterns: [/lowValueAutomationMode === ["']durable["']/, /bullmq_redis/, /readiness/],
  },
  {
    id: "contract.prisma_operations_service",
    title: "运营域 Prisma 读写实现",
    file: "desktop/apps/api/src/prisma/prisma-operations.service.ts",
    patterns: [
      /listAgents\(/,
      /listAgentSkills\(/,
      /createRouteEvaluation\(/,
      /correctRouteEvaluation\(/,
      /createChatImport\(/,
      /reviewTrainingSample\(/,
      /applyAgentSkillSuggestions\(/,
      /listConversations\(/,
      /listConversationAudit\(/,
      /updateConversationOperations\(/,
    ],
  },
  {
    id: "contract.prisma_agent_initializer_safety",
    title: "Prisma Agent 初始化安全包装",
    file: "desktop/tools/initialize-prisma-agents.js",
    patterns: [
      /process\.argv\.includes\(["']--execute["']\)/,
      /if \(!execute\)/,
      /status:\s*["']PLAN["']/,
      /writesExecuted:\s*false/,
      /process\.exit\(0\)/,
      /requiredConfirmation\s*=\s*["']INITIALIZE_PRISMA_AGENTS["']/,
      /confirmation !== requiredConfirmation/,
      /initializePrismaAgentData/,
      /\.catch\(\(\) =>/,
      /inspect protected deployment logs/,
    ],
    forbidden: [
      /\.catch\(\(error\) =>/,
      /process\.stderr\.write\([^\n]*(?:error\.message|String\(error\))/,
    ],
  },
  {
    id: "contract.request_operation_key",
    title: "Request-level operation key validation and fingerprints",
    file: "desktop/apps/api/src/shared/operation-idempotency.ts",
    patterns: [
      /OPERATION_KEY_MIN_LENGTH\s*=\s*16/,
      /OPERATION_KEY_MAX_LENGTH\s*=\s*128/,
      /createOperationFingerprint/,
      /deterministicOperationId/,
      /assertStoredOperationIdentityReplay/,
      /OPERATION_KEY_REUSED/,
    ],
  },
  {
    id: "contract.design_job_create_idempotency",
    title: "Design job create exact replay and unique request claim",
    file: "desktop/apps/api/src/design-jobs/design-jobs.service.ts",
    patterns: [
      /normalizeOperationKey\(payload\?\.operationKey/,
      /findUnique\(\{ where: \{ requestId \} \}\)/,
      /isUniqueConstraintError\(error\)/,
      /async create\(payload: CreateDesignJobPayload\)[\s\S]*?const existing =[\s\S]*?if \(existing\)[\s\S]*?completeDesignJobCreateEffects\(existing,[\s\S]*?const identity = await this\.validateCreateIdentity\(payload\)/,
      /activeCreateEffectPromises/,
      /requirements\.createEffects/,
      /effectKey:\s*`\$\{effectRoot\}:/,
      /completedAt:\s*new Date\(\)\.toISOString\(\)/,
      /deterministicOperationId\("review", effectKey\)/,
    ],
  },
  {
    id: "contract.design_external_operation_idempotency",
    title: "设计提交、改图和回调持久化幂等",
    file: "desktop/apps/api/src/design-jobs/design-jobs.service.ts",
    patterns: [
      /designSubmitOperation\(/,
      /normalizeOperationKey\(payload\.operationKey, "design revision operationKey"\)/,
      /claimDesignCallback\(/,
      /this\.localStore\.claimDesignJobCallback\(/,
      /prisma\.designJob\.updateMany\(/,
      /callbackStatus:\s*"processing"/,
      /DESIGN_CALLBACK_CLAIM_LEASE_MS/,
      /return "in_progress"/,
      /markDesignCallbackOutcomeUnknown\(/,
      /callbackStatus:\s*"outcome_unknown"/,
      /commitDesignCallbackCompletion\(/,
      /prisma\.\$transaction\(/,
    ],
  },
  {
    id: "contract.local_design_callback_cas",
    title: "LocalStore 设计回调 claim 与原子提交",
    file: "desktop/apps/api/src/local-store/local-store.service.ts",
    patterns: [
      /claimDesignJobCallback\(/,
      /localDesignCallbackClaimIsFresh\(/,
      /"in_progress"\s*:\s*"outcome_unknown"/,
      /settleDesignJobCallbackFailure\(/,
      /beginDesignJobCallbackRetry\(/,
      /markDesignJobCallbackOutcomeUnknown\(/,
      /commitDesignJobCallbackCompletion\(/,
      /callbackStatus:\s*"settled"/,
    ],
  },
  {
    id: "contract.prisma_design_external_operation_schema",
    title: "Prisma 设计外部操作唯一键与回调状态",
    file: "desktop/prisma/schema.prisma",
    patterns: [
      /submitOperationKey\s+String\?\s+@unique/,
      /callbackOperationKey\s+String\?\s+@unique/,
      /callbackRequestFingerprint\s+String\?/,
      /callbackStatus\s+String\?/,
      /callbackClaimedAt\s+DateTime\?/,
      /operationKey\s+String\?\s+@unique/,
      /externalRequestId\s+String\?\s+@unique/,
      /@@unique\(\[designJobId, revisionNumber\]\)/,
    ],
  },
  {
    id: "contract.prisma_design_external_operation_migration",
    title: "设计外部操作迁移唯一约束",
    file: "desktop/prisma/migrations/20260720113000_design_external_operation_idempotency/migration.sql",
    patterns: [
      /ADD COLUMN "callbackStatus" TEXT/,
      /ADD COLUMN "callbackClaimedAt" TIMESTAMP\(3\)/,
      /CREATE UNIQUE INDEX "DesignJob_submitOperationKey_key"/,
      /CREATE UNIQUE INDEX "DesignJob_callbackOperationKey_key"/,
      /CREATE UNIQUE INDEX "DesignRevision_operationKey_key"/,
      /CREATE UNIQUE INDEX "DesignRevision_externalRequestId_key"/,
      /CREATE UNIQUE INDEX "DesignRevision_designJobId_revisionNumber_key"/,
    ],
  },
  {
    id: "contract.local_chat_import_existing_first",
    title: "Local training import replays stored identity before mutable conversation lookup",
    file: "desktop/apps/api/src/local-store/local-store.service.ts",
    patterns: [
      /createChatImport\(payload: any, parsed: any\)[\s\S]*?const existing = data\.chatImports\.find[\s\S]*?if \(existing\)[\s\S]*?assertStoredOperationIdentityReplay[\s\S]*?return \{ \.\.\.existing, samples: existingSamples \};[\s\S]*?const identity = this\.validateOptionalConversationBinding/,
    ],
  },
  {
    id: "contract.training_import_idempotency",
    title: "Training import deterministic import, sample and knowledge identities",
    file: "desktop/apps/api/src/prisma/prisma-operations.service.ts",
    patterns: [
      /deterministicOperationId\("import", operationKey\)/,
      /deterministicOperationId\("sample", operationKey, pairIndex\)/,
      /deterministicOperationId\("knowledge", operationKey, pairIndex\)/,
      /isUniqueConstraintError\(error\)/,
      /replayChatImport/,
      /async createChatImport\(payload: any, parsed: any\)[\s\S]*?chatImport\.findUnique[\s\S]*?assertStoredOperationIdentityReplay[\s\S]*?return this\.replayChatImport\(existing, operation\);[\s\S]*?const identity = await this\.resolveIdentity/,
    ],
  },
  {
    id: "contract.web_api_failure_truth",
    title: "Web design, SKU and asset reads surface API failures instead of sample or empty success",
    file: "desktop/apps/web/src/lib/api.ts",
    patterns: [
      /export async function getDesignJobs[\s\S]{0,900}?if \(!response\.ok\) throw new Error\(`api \$\{response\.status\}`\);[\s\S]{0,120}?return response\.json\(\);/,
      /export async function getSkus[\s\S]{0,900}?if \(!response\.ok\) throw new Error\(`api \$\{response\.status\}`\);[\s\S]{0,120}?return response\.json\(\);/,
      /export async function getAssets[\s\S]{0,1800}?if \(!response\.ok\) throw new Error\(`api \$\{response\.status\}`\);[\s\S]{0,120}?return response\.json\(\);/,
    ],
    forbidden: [
      /return sampleDesignJobs/,
      /return sampleSkus/,
      /const sampleDesignJobs/,
      /const sampleSkus/,
      /export async function getAssets[\s\S]{0,1800}?catch\s*\{[\s\S]{0,120}?return \[\]/,
    ],
  },
  {
    id: "contract.web_build_freshness",
    title: "Every reused Next build is fresh and nonzero builds cannot fall back to old output",
    file: "desktop/tools/build-web.js",
    patterns: [
      /standaloneServerExists\(\) && productionBuildReady\(\) && !webBuildIsStale\(\)/,
      /!standaloneServerExists\(\) && productionBuildReady\(\) && !webBuildIsStale\(\)/,
      /result\.status === 0 && !hasNextBuildErrorOutput\(result\) && !webBuildIsStale\(\) && standaloneServerExists\(\)/,
      /retry\.status === 0 && !hasNextBuildErrorOutput\(retry\) && !webBuildIsStale\(\) && standaloneServerExists\(\)/,
      /retry\.status === 0 && !hasNextBuildErrorOutput\(retry\) && productionBuildReady\(\) && !webBuildIsStale\(\)/,
      /if \(result\.status === 0\) waitForBuildOutputReady\(60\)/,
      /if \(retry\.status === 0\) waitForBuildOutputReady\(60\)/,
      /Completed Next output has no standalone server; forcing a clean rebuild/,
      /refusing to synthesize a source-bound server wrapper/,
    ],
    forbidden: [
      /if \(!standaloneServerExists\(\) && productionBuildReady\(\)\) \{/,
      /if \(productionBuildReady\(\) && !hasNextBuildErrorOutput\((?:result|retry)\)\) \{/,
      /writeStableStandaloneServer/,
    ],
  },
  {
    id: "contract.web_create_operation_retry",
    title: "Web create actions reuse the serialized operation request on network retry",
    file: "desktop/apps/web/src/lib/api.ts",
    patterns: [
      /postJsonWithNetworkRetry/,
      /const serializedBody = JSON\.stringify\(body\)/,
      /createClientOperationKey/,
      /operationKey:\s*string/,
    ],
    forbidden: [/operationKey\s*=\s*createClientOperationKey/],
  },
  {
    id: "contract.web_client_operation_lifecycle",
    title: "Web form actions retain one operation key until exact-payload success",
    file: "desktop/apps/web/src/lib/client-operation-key.ts",
    patterns: [
      /reserveClientOperation/,
      /pending\?\.scope === scope && pending\.payloadSignature === payloadSignature/,
      /completeClientOperation/,
      /pending\?\.key === completedKey \? null : pending/,
      /\.sort\(\)/,
    ],
  },
  {
    id: "contract.training_import_operation_lifecycle",
    title: "Training import preserves failed operation keys and clears only after success",
    file: "desktop/apps/web/src/features/training/training-import-page.tsx",
    patterns: [
      /pendingImportOperation = useRef<PendingClientOperation \| null>\(null\)/,
      /reserveClientOperation\("training-import", requestPayload, pendingImportOperation\.current\)/,
      /operationKey: operation\.key/,
      /await importChatTranscript[\s\S]*?pendingImportOperation\.current = completeClientOperation/,
    ],
  },
  {
    id: "contract.send_demo_controller_operation",
    title: "Demo send controller requires and forwards operationKey",
    file: "desktop/apps/api/src/wechat/wechat.controller.ts",
    patterns: [
      /@Post\("send-tasks\/demo"\)/,
      /createDemoSendTask\([\s\S]*?operationKey:\s*string/,
      /return this\.wechat\.createDemoSendTask\(payload\)/,
    ],
  },
  {
    id: "contract.send_demo_service_operation",
    title: "Demo send service normalizes and persists operationKey",
    file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
    patterns: [
      /createDemoSendTask\([\s\S]*?operationKey:\s*string/,
      /normalizeOperationKey\(payload\?\.operationKey, "operationKey"\)/,
      /createLocalSendTask\(\{[\s\S]*?operationKey/,
      /createPrismaDemoSendTask[\s\S]*?this\.persistence\.createSendTask\(\{[\s\S]*?operationKey:\s*payload\.operationKey/,
      /customerId:\s*conversation\.customerId/,
      /operationKey:\s*stringOrUndefined\(value\.operationKey\)/,
    ],
  },
  {
    id: "contract.send_demo_web_operation",
    title: "Web demo send retries the exact serialized operation request",
    file: "desktop/apps/web/src/lib/api.ts",
    patterns: [
      /createDemoSendTask\([\s\S]*?operationKey:\s*string/,
      /postJsonWithNetworkRetry<SendTask>\("\/wechat\/send-tasks\/demo"/,
      /operationKey,[\s\S]*?conversationId,[\s\S]*?wechatAccountId,[\s\S]*?text/,
    ],
  },
  {
    id: "contract.local_send_operation_replay",
    title: "Local send persistence provides deterministic exact replay",
    file: "desktop/apps/api/src/local-store/local-store.service.ts",
    patterns: [
      /createSendTask\(payload:\s*any\)/,
      /normalizeOperationKey\(payload\.operationKey\)/,
      /deterministicOperationId\("send", operationKey\)/,
      /createSendTaskOperationFingerprint/,
      /assertExactOperationReplay/,
      /assertStoredOperationIdentityReplay/,
    ],
  },
  {
    id: "contract.prisma_send_operation_replay",
    title: "Prisma send persistence provides deterministic P2002 replay",
    file: "desktop/apps/api/src/wechat/wechat-persistence.ts",
    patterns: [
      /async createSendTask\(payload:\s*any\)/,
      /deterministicOperationId\("send", operationKey\)/,
      /createSendTaskOperationFingerprint/,
      /this\.assertSendTaskReplay\(existing, payload, operationKey\)/,
      /isUniqueConstraintError\(error\)/,
      /this\.assertSendTaskReplay\(winner, payload, operationKey\)/,
    ],
  },
  {
    id: "contract.wechat_send_operation_passthrough",
    title: "Manual reply and order sends preserve operationKey",
    file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
    patterns: [
      /enqueueManualReply[\s\S]*?normalizeOperationKey\(payload\.operationKey, "operationKey"\)/,
      /queueOrderConfirmationWithProvenance[\s\S]*?normalizeOperationKey\(payload\.operationKey, "operationKey"\)/,
      /queueOrderFollowupWithProvenance[\s\S]*?normalizeOperationKey\(payload\.operationKey, "operationKey"\)/,
      /function manualOrderQueueRequest[\s\S]*?operationKey:\s*stringOrUndefined\(value\.operationKey\)/,
    ],
  },
  {
    id: "contract.quote_send_operation_passthrough",
    title: "Quote and payment-proof sends preserve operationKey",
    file: "desktop/apps/api/src/quotes/quotes.service.ts",
    patterns: [
      /queueSendWithProvenance[\s\S]*?normalizeOperationKey\(options\.operationKey, "operationKey"\)/,
      /verifyPaymentProofAndQueueConfirmation[\s\S]*?normalizeOperationKey\(payload\.operationKey, "operationKey"\)/,
      /enqueueQuoteMessage\(\{[\s\S]*?operationKey/,
      /queueOrderConfirmation\([\s\S]*?operationKey/,
    ],
  },
  {
    id: "contract.review_send_operation_passthrough",
    title: "Review approvals preserve operationKey into send services",
    file: "desktop/apps/api/src/reviews/reviews.service.ts",
    patterns: [
      /quickConfirmAndQueueSend\(id, \{[\s\S]*?operationKey:\s*payload\.operationKey/,
      /this\.quotes\.queueSend\(id, \{[\s\S]*?operationKey:\s*payload\.operationKey/,
      /this\.wechat\.queueOrderConfirmation\(id, \{[\s\S]*?operationKey:\s*payload\.operationKey/,
      /this\.wechat\.queueOrderFollowup\(id, \{[\s\S]*?operationKey:\s*payload\.operationKey/,
    ],
  },
  ...[
    ["manual_reply", "desktop/apps/web/src/features/conversations/use-conversations-controller.ts", "manual-reply", "queueManualConversationReply"],
    ["quote_send", "desktop/apps/web/src/features/sales/sales-quote-action-page.tsx", "quote-send", "queueQuoteSend"],
    ["order_send", "desktop/apps/web/src/features/sales/sales-order-message-page.tsx", "order-send", "queueOrder"],
    ["review_design", "desktop/apps/web/src/features/reviews/review-design-page.tsx", "review-action", "reviewDesignJob"],
    ["review_quote", "desktop/apps/web/src/features/reviews/review-quotes-page.tsx", "review-action", "reviewQuote"],
    ["review_order", "desktop/apps/web/src/features/reviews/review-orders-page.tsx", "review-action", "reviewOrder"],
  ].map(([suffix, file, scope, action]) => ({
    id: `contract.browser_${suffix}_sticky_operation`,
    title: `Browser ${suffix} retains operationKey until success`,
    file,
    patterns: [
      new RegExp(`reserveClientOperation\\(\\s*["']${scope}["']`),
      /pending\w*Operation(?:Ref)?\.current\s*=\s*operation/,
      new RegExp(`await[\\s\\S]*?${action}[\\s\\S]*?operation\\.key[\\s\\S]*?completeClientOperation`),
    ],
  })),
  {
    id: "contract.agents_prisma_route",
    title: "Agent 中心 Prisma 路由",
    file: "desktop/apps/api/src/agents/agents.service.ts",
    patterns: [/PrismaOperationsService/, /appConfig\.useLocalStore/, /this\.requirePrisma\(\)\.listAgents/, /this\.requirePrisma\(\)\.listAgentSkills/],
  },
  {
    id: "contract.routing_prisma_route",
    title: "路由与纠正 Prisma 路由",
    file: "desktop/apps/api/src/routing/routing.service.ts",
    patterns: [
      /PrismaOperationsService/,
      /if \(!appConfig\.useLocalStore\)/,
      /evaluatePrisma/,
      /correctRouteEvaluation/,
      /notifyCorrectionBestEffort/,
      /notification delivery is non-authoritative/,
      /NotFoundException/,
    ],
  },
  {
    id: "contract.payment_update_boundaries",
    title: "付款状态专用核验与通用更新边界",
    file: "desktop/apps/api/src/quotes/quotes.service.ts",
    patterns: [
      /assertGenericQuoteUpdatePatch\(patch \|\| \{\}\)/,
      /hasOwnProperty\.call\(patch, ["']paymentStatus["']\)/,
      /updateQuoteDraft\(id, \{ \.\.\.payload, \.\.\.quotePatch \}, true\)/,
      /orders\.recordVerifiedPayment/,
      /付款状态只能通过付款凭证核验入口更新/,
    ],
  },
  {
    id: "contract.order_payment_update_boundaries",
    title: "订单付款状态专用核验边界",
    file: "desktop/apps/api/src/orders/orders.service.ts",
    patterns: [
      /assertGenericOrderUpdatePatch\(patch \|\| \{\}\)/,
      /async recordVerifiedPayment\(/,
      /["']deposit_paid["'], ["']paid["']/,
      /hasOwnProperty\.call\(patch, ["']paymentStatus["']\)/,
      /付款状态只能通过报价付款凭证核验入口更新/,
    ],
  },
  {
    id: "contract.routing_correction_idempotency",
    title: "场景纠正幂等与本地/Prisma 错误语义",
    file: "desktop/apps/api/src/prisma/prisma-operations.service.ts",
    patterns: [
      /routingCorrectionRequestKey/,
      /before\.correction\?\.requestKey === requestKey/,
      /trainingSample\.findFirst/,
      /knowledgeEntry\.findFirst/,
      /correctionRequestKey: requestKey/,
      /TransactionIsolationLevel\.Serializable/,
      /NotFoundException/,
      /BadRequestException/,
    ],
  },
  {
    id: "contract.routing_correction_local_parity",
    title: "本地场景纠正幂等与错误语义",
    file: "desktop/apps/api/src/local-store/local-store.service.ts",
    patterns: [
      /routingCorrectionRequestKey/,
      /before\.correction\?\.requestKey === requestKey/,
      /correctionRequestKey: requestKey/,
      /throw new NotFoundException\(`route evaluation not found:/,
      /throw new BadRequestException\(`agent not found:/,
    ],
  },
  {
    id: "contract.payment_update_web_surface",
    title: "付款状态前端只读与专用核验入口",
    file: "desktop/apps/web/src/features/sales/sales-order-edit-page.tsx",
    patterns: [/付款状态（只读）/, /负责人（可信会话记录）/, /需从报价页核验付款凭证/],
    forbidden: [/update\(["']paymentStatus["']/, /update\(["']owner["']/],
  },
  {
    id: "contract.training_prisma_route",
    title: "训练与 Skill Prisma 路由",
    file: "desktop/apps/api/src/training/training.service.ts",
    patterns: [/PrismaOperationsService/, /listSamplesPrisma/, /getOverviewPrisma/, /reviewSamplePrisma/, /listSkillSuggestionsPrisma/, /applySkillSuggestionsPrisma/],
  },
  {
    id: "contract.conversation_operations_prisma_route",
    title: "会话运营查询/审计/更新 Prisma 路由",
    file: "desktop/apps/api/src/conversation-ops/conversation-operations.service.ts",
    patterns: [
      /PrismaOperationsService/,
      /if \(!appConfig\.useLocalStore\) return this\.listQueuePrisma/,
      /if \(!appConfig\.useLocalStore\) return this\.listAuditPrisma/,
      /if \(!appConfig\.useLocalStore\) return this\.updateConversationPrisma/,
      /this\.requirePrisma\(\)\.updateConversationOperations/,
    ],
  },
  {
    id: "contract.personal_wechat_prisma_route",
    title: "个人微信绑定与审计 Prisma 路由",
    file: "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.service.ts",
    patterns: [
      /PersonalWechatRpaPersistence/,
      /this\.persistence\.listBindings/,
      /this\.persistence\.listAudit/,
      /this\.persistence\.(?:upsertBinding|claimInboundAndBind)/,
      /this\.persistence\.recordAudit/,
      /assertProductionIdentity/,
    ],
    forbidden: [
      /this\.localStore\.listPersonalWechatRpaBindings/,
      /this\.localStore\.listPersonalWechatRpaAuditLogs/,
      /this\.localStore\.recordPersonalWechatRpaAudit/,
      /this\.localStore\.upsertPersonalWechatRpaBinding/,
    ],
  },
  {
    id: "contract.personal_wechat_prisma_models",
    title: "个人微信业务模型与主机机密边界",
    file: "desktop/prisma/schema.prisma",
    patterns: [
      /personal_wechat/,
      /model PersonalWechatRpaBinding/,
      /model PersonalWechatRpaAuditLog/,
      /personalWechatOwnerWxId\s+String\?\s+@unique/,
      /personalWechatRpaBindingKey\s+String\?\s+@unique/,
    ],
  },
  {
    id: "contract.personal_wechat_business_secret_boundary",
    title: "个人微信业务持久化不包含主机凭据",
    file: "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.persistence.ts",
    patterns: [
      /prisma\.\$transaction/,
      /hydrateBinding/,
      /sanitizeError/,
    ],
    forbidden: [
      /\b(?:endpoint|token|windowsSessionId|sessionId|processId|windowHandle|configPath|executablePath|localPath)\s*\??\s*:/,
    ],
  },
  {
    id: "contract.catalog_prisma_change_log",
    title: "商品 Prisma 变更与审计原子性",
    file: "desktop/apps/api/src/catalog/catalog.service.ts",
    patterns: [
      /this\.prisma\.\$transaction/,
      /tx\.skuChangeLog\.create/,
      /changedFields/,
      /reason:\s*context\.reason/,
      /reason:\s*"no_change"/,
      /skuChangeLog\.findMany/,
    ],
    forbidden: [/if \(appConfig\.useLocalStore\) return this\.localStore\.listSkuChangeLogs\(filter\);\s*return \[\];/s],
  },
  {
    id: "contract.asset_prisma_identity",
    title: "素材 Prisma 规范路径与会话身份",
    file: "desktop/apps/api/src/assets/assets.service.ts",
    patterns: [
      /normalizedLocalPath/,
      /await fs\.realpath\(input\)/,
      /local asset path must be absolute/,
      /this\.prisma\.conversation\.findFirst/,
      /normalizedLocalPath:\s*normalized/,
      /ambiguous persisted identities/,
      /no unambiguous persisted identity/,
    ],
    forbidden: [/this\.prisma\.designAsset\.findFirst\(\{\s*where:\s*\{\s*localPath/s],
  },
  {
    id: "contract.catalog_asset_prisma_models",
    title: "商品审计与素材路径 Prisma 模型",
    file: "desktop/prisma/schema.prisma",
    patterns: [
      /model SkuChangeLog/,
      /changedFields\s+Json/,
      /before\s+Json\?/,
      /normalizedLocalPath\s+String\?\s+@unique/,
    ],
  },
  {
    id: "contract.design_platform_execution_models",
    title: "设计平台执行状态、稳定请求与敏感字段边界",
    file: "desktop/prisma/schema.prisma",
    patterns: [
      /model DesignPlatformExecution/,
      /operationKey\s+String\s+@unique/,
      /requestId\s+String\s+@unique/,
      /scopeKey\s+String/,
      /processRunId\s+String/,
      /outcome_unknown/,
      /explicit_failed/,
      /cancel_requested/,
      /acceptanceStatus\s+DesignPlatformAcceptanceStatus/,
      /refundStatus\s+DesignPlatformRefundStatus/,
    ],
    forbidden: [
      /model DesignPlatformExecution\s*\{[^}]*\b(?:prompt|customerText|cookie|token|password|authorization)\s+String/i,
    ],
  },
  {
    id: "contract.design_platform_execution_recovery",
    title: "设计平台先持久化、CAS 与未知结果恢复",
    file: "desktop/apps/api/src/design-jobs/design-platform-execution.service.ts",
    patterns: [
      /async begin\(/,
      /async claimDispatch\(/,
      /async markGenerating\(/,
      /recoverStaleExecutions/,
      /commitAcceptedResult/,
      /designImageCandidate\.upsert/,
      /design platform acceptance CAS failed/,
      /status: "outcome_unknown"/,
      /explicit confirmed_not_generated_refunded resolution and reviewer are required/,
      /design platform execution outcome requires explicit manual resolution before retry/,
    ],
  },
  {
    id: "contract.design_platform_unknown_resolution",
    title: "设计平台未知结果人工核销入口",
    file: "desktop/apps/api/src/design-jobs/design-jobs.controller.ts",
    patterns: [
      /@Post\(":id\/executions\/:executionId\/resolve-unknown"\)/,
      /resolveUnknownExecution/,
    ],
  },
  {
    id: "contract.design_platform_uncertain_transport",
    title: "设计平台 timeout、reset、5xx 与畸形 2xx fail-closed",
    file: "desktop/apps/api/src/integrations/design-platform/design-platform.client.ts",
    patterns: [
      /requestId: externalJobId/,
      /MALFORMED_SUCCESS_RESPONSE/,
      /ECONNABORTED/,
      /ECONNRESET/,
      /response\?\.status \|\| 0\) >= 500/,
      /art_image_local results must be read from durable execution/,
    ],
  },
  {
    id: "contract.desktop_session_proof",
    title: "Web API 代理要求独立 Electron 会话证明",
    file: "desktop/apps/web/src/lib/desktop-session-proof.ts",
    patterns: [
      /DESKTOP_SESSION_COOKIE/,
      /timingSafeEqual/,
      /requiresDesktopSessionProof/,
      /return true/,
      /headers\.delete\("cookie"\)/,
      /headers\.set\(internalApiTokenHeader, internalApiToken\)/,
    ],
  },
  {
    id: "contract.wechat_window_validation_source",
    title: "个人微信发送校验仅使用持久化 observer 快照",
    file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
    patterns: [
      /validateSendTask\(id: string, expected: ExpectedIdentityPayload = \{\}\) \{\s*return this\.validateSendTaskWithCurrentWindow\(id, expected\)/,
      /const activeWindow = await this\.persistence\.getLatestWindowSnapshot\(task\.wechatAccountId\)/,
      /observerProofToken: currentWechatWindowObserverProofToken\(\)/,
      /createWechatWindowObserverAttestation/,
    ],
    forbidden: [/params\.activeWindow/, /suppliedWindow/, /buildWindowState/],
  },
  {
    id: "contract.wechat_window_validation_controller",
    title: "个人微信浏览器校验 DTO 不接收窗口自报字段",
    file: "desktop/apps/api/src/wechat/wechat.controller.ts",
    patterns: [
      /validateSendTask\(\s*@Param\("id"\) id: string,\s*@Body\(\) payload: ExpectedIdentityPayload,\s*\)/,
    ],
  },
  {
    id: "contract.wechat_window_persisted_attestation",
    title: "个人微信持久化窗口证据使用密钥 attestation",
    file: "desktop/packages/rules/wechatWindowEvidence.js",
    patterns: [
      /WECHAT_WINDOW_OBSERVER_ATTESTATION_VERSION/,
      /createWechatWindowObserverAttestation/,
      /createHmac\("sha256", token\)/,
      /timingSafeEqual\(supplied, expected\)/,
      /canonicalObserverAttestation/,
      /canonicalJsonObject/,
    ],
  },
  {
    id: "contract.design_platform_credential_origins",
    title: "设计平台显式 allowlist 与逐凭据 origin",
    file: "desktop/apps/api/src/shared/app-config.ts",
    patterns: [
      /DESIGN_PLATFORM_ALLOWED_ORIGINS/,
      /designPlatformAccessTokenOrigin/,
      /designPlatformCookieOrigin/,
      /designPlatformApiKeyOrigin/,
      /designPlatformDeviceIdOrigin/,
      /hasIndependentDesignPlatformCallbackApiKey/,
      /timingSafeEqual/,
    ],
  },
  {
    id: "contract.design_platform_zero_redirect",
    title: "设计平台请求不可覆盖的 URL、transport 与零重定向边界",
    file: "desktop/apps/api/src/integrations/design-platform/design-platform.client.ts",
    patterns: [
      /maxRedirects: 0/,
      /config\.maxRedirects = 0/,
      /assertTrustedDesignPlatformTarget\(config\.baseURL, config\.url\)/,
      /config\.adapter = this\.guardedAdapter/,
      /config\.transformRequest = copyTransform\(trustedTransformRequest\)/,
      /delete config\.transport/,
      /config\.proxy = false/,
      /AxiosHeaders\.from\(config\.headers\)/,
      /headers\.delete\("Authorization"\)/,
      /createForTesting\(transport: AxiosAdapter\)/,
      /response\.status >= 300 && response\.status < 400/,
      /DESIGN_PLATFORM_REDIRECT_BLOCKED/,
    ],
  },
  {
    id: "contract.design_platform_callback_preflight",
    title: "standard_v1 独立回调密钥预检",
    file: "desktop/apps/api/src/design-jobs/design-jobs.service.ts",
    patterns: [
      /design_platform_callback_auth/,
      /hasIndependentDesignPlatformCallbackApiKey/,
      /severity: "error"/,
      /assertDesignPlatformPreflight/,
    ],
  },
  {
    id: "contract.design_job_route_capabilities",
    title: "设计任务读写与发送能力守卫",
    file: "desktop/apps/api/src/design-jobs/design-jobs.controller.ts",
    patterns: [
      /@RequireOperatorCapability\("view_console"\)/,
      /@RequireOperatorCapability\("manage_design_executions"\)/,
      /@RequireOperatorCapability\("approve_send"\)/,
      /@TrustedOperator\(\) principal/,
    ],
  },
  {
    id: "contract.manual_order_queue_controller_allowlist",
    title: "人工订单发送控制器显式字段白名单",
    file: "desktop/apps/api/src/wechat/wechat.controller.ts",
    patterns: [
      /queueOrderConfirmation\(id, \{/,
      /expectedWechatAccountId: payload\?\.expectedWechatAccountId/,
      /owner: principal\.id/,
      /operationKey: payload\?\.operationKey/,
      /queueOrderFollowup\(id, \{/,
      /type: payload\?\.type/,
      /setConversationManualLock\(id, \{/,
      /locked: payload\?\.locked/,
      /reviewer: principal\.id/,
    ],
    forbidden: [
      /queueOrderConfirmation\(id, \{ \.\.\.\(payload \|\| \{\}\)/,
      /queueOrderFollowup\(id, \{ \.\.\.\(payload \|\| \{\}\)/,
      /queueOrder(?:Confirmation|Followup)\(id,\s*\{[\s\S]{0,400}automation:/,
      /setConversationManualLock\(id, \{ \.\.\.\(payload \|\| \{\}\)/,
      /setConversationManualLock\(id,\s*\{[\s\S]{0,400}(?:effectKey|automation):/,
    ],
  },
  {
    id: "contract.manual_quote_queue_controller_allowlist",
    title: "人工报价发送控制器显式字段白名单",
    file: "desktop/apps/api/src/quotes/quotes.controller.ts",
    patterns: [
      /queueSend\(id, \{/,
      /expectedWechatAccountId: payload\?\.expectedWechatAccountId/,
      /expectedConversationId: payload\?\.expectedConversationId/,
      /expectedCustomerId: payload\?\.expectedCustomerId/,
      /note: payload\?\.note/,
      /owner: principal\.id/,
      /releaseReason: "manual_quote_send"/,
      /operationKey: payload\?\.operationKey/,
    ],
    forbidden: [
      /queueSend\(id,\s*\{[\s\S]{0,400}\.\.\.trustedPayload/,
      /queueSend\(id,\s*\{[\s\S]{0,400}automation:/,
    ],
  },
  {
    id: "contract.trusted_order_automation_provenance",
    title: "订单自动化来源仅由内部低价值路径生成",
    file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
    patterns: [
      /queueOrderConfirmationWithProvenance\(orderDraftId, manualOrderQueueRequest\(payload\), null\)/,
      /queueLowValueOrderConfirmation/,
      /queueOrderFollowupWithProvenance\(orderDraftId, manualOrderQueueRequest\(payload\), null\)/,
      /queueLowValueOrderFollowup/,
      /buildLowValueOrderAutomation/,
      /buildOrderSendContext/,
      /orderContext: params\.orderContext/,
      /this\.orderSendContext\(task\)/,
      /orderDraftId: String\(order\.id\)/,
      /quoteDraftId: String\(order\.quoteDraftId \|\| ""\)/,
      /queuedBy: "low_value_automation"/,
      /function manualOrderQueueRequest/,
    ],
    forbidden: [/\.\.\.\(payload\.automation \|\| \{\}\)/],
  },
  {
    id: "contract.trusted_quote_automation_provenance",
    title: "报价自动化来源仅由内部低价值路径生成",
    file: "desktop/apps/api/src/quotes/quotes.service.ts",
    patterns: [
      /queueSendWithProvenance\(id, manualQuoteQueueRequest\(options\), false\)/,
      /queueSendWithProvenance\(id, manualQuoteQueueRequest\(options\), true\)/,
      /source: "low_value_quote_send"/,
      /quoteDraftId: quote\.id/,
      /queuedBy: "low_value_automation"/,
      /automation: trustedAutomation/,
      /function manualQuoteQueueRequest/,
    ],
    forbidden: [/options\.automation/],
  },
]);

const FIXED_LOCAL_INVENTORY = Object.freeze([
  {
    id: "local_store.conversation_operations",
    title: "会话运营字段与审计",
    file: "desktop/apps/api/src/conversation-ops/conversation-operations.service.ts",
    classification: "production_gap",
    reason: "会话分配、优先级、SLA 与运营审计固定调用 LocalStore；Prisma Conversation 尚无完整运营字段。",
    activePatterns: [/LocalStoreService/, /this\.localStore\.updateConversationOperations/],
    resolutionPatterns: [
      /PrismaOperationsService/,
      /if \(!appConfig\.useLocalStore\) return this\.listQueuePrisma/,
      /if \(!appConfig\.useLocalStore\) return this\.listAuditPrisma/,
      /if \(!appConfig\.useLocalStore\) return this\.updateConversationPrisma/,
    ],
  },
  {
    id: "local_store.automation_history",
    title: "本地/兼容自动化运行历史",
    file: "desktop/apps/api/src/automation/automation.service.ts",
    classification: "local_mode_allowlist",
    reason: "interval/本地兼容模式可保留 recentRuns；生产 durable readiness、队列状态与故障证据必须来自 AutomationSchedulerService 的 BullMQ/Redis runtime，另有强制契约检查。",
    activePatterns: [/listAutomationRuns/, /saveAutomationRun/],
  },
  {
    id: "local_store.personal_wechat_business_records",
    title: "个人微信 RPA 绑定与审计业务记录",
    file: "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.service.ts",
    classification: "production_gap",
    reason: "本地演示可继续使用 LocalStore；生产账号绑定与 RPA 审计必须经适配器持久化到 Prisma，这不同于允许保存在本机的 RPA 主机注册表。",
    activePatterns: [/listPersonalWechatRpaBindings/, /listPersonalWechatRpaAuditLogs/],
    resolutionPatterns: [
      /PersonalWechatRpaPersistence/,
      /this\.persistence\.listBindings/,
      /this\.persistence\.listAudit/,
      /this\.persistence\.upsertBinding/,
      /this\.persistence\.recordAudit/,
    ],
  },
  {
    id: "local_store.personal_wechat_host_registry",
    title: "个人微信 RPA 主机注册表",
    file: "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.service.ts",
    classification: "host_local_allowlist",
    reason: "RPA endpoint/token 与 Windows 登录会话和本机进程绑定，注册表按设计保存在受控主机；业务绑定和审计不在此豁免范围。",
    activePatterns: [/REGISTRY_VERSION/, /readRegistryState/, /writeRegistryDocument/],
  },
]);

const SOURCE_ROOTS = Object.freeze([
  "desktop/apps/api/src",
  "desktop/apps/web/src",
  "desktop/apps/electron",
  "desktop/packages",
  "core",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py"]);
const PLACEHOLDER_PATTERN = /(?:prisma mode is not implemented yet|not implemented|尚未实现|TODO\b|FIXME\b)/gi;
const DESIGN_EXECUTION_PUBLIC_VIEW_FIELDS = Object.freeze([
  "id",
  "attemptNo",
  "status",
  "acceptanceStatus",
  "refundStatus",
  "imageCount",
  "errorCategory",
  "responseHttpStatus",
  "createdAt",
  "updatedAt",
  "completedAt",
  "resolvedAt",
  "availableResolution",
]);
const PLANNED_CHANNEL_SCOPE = Object.freeze({
  id: "planned_scope.optional_channels",
  title: "规划渠道 fail-closed 边界",
  file: "core/channel_registry.py",
  reason: "小红书、拼多多、淘宝、抖音、快手在路线图中明确为 planned；未取得官方或合规服务商接口前必须跳过或返回 DisabledChannelAdapter，不能假装接通。",
  markers: [
    "adapter is planned but not implemented; skipped.",
    'reason="adapter not implemented"',
  ],
  guardPatterns: [
    /SUPPORTED_CHANNELS/,
    /status=["']planned["']/,
    /if channel_id != ["']wechat["']:/,
    /DisabledChannelAdapter/,
    /抖音、小红书、拼多多、淘宝、快手目前是规划渠道/,
    /不能假装已接通/,
  ],
});

function result(id, title, status, summary, evidence = {}) {
  if (!(status in STATUS_RANK)) throw new Error(`unsupported completion status: ${status}`);
  return { id, title, status, summary, evidence };
}

function aggregateStatus(results) {
  return results.reduce(
    (current, item) => (STATUS_RANK[item.status] > STATUS_RANK[current] ? item.status : current),
    STATUS.PASS,
  );
}

function normalizeRelative(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function absoluteFrom(root, relative) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalizeRelative(relative));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`path escapes audit root: ${relative}`);
  }
  return resolved;
}

function readText(root, relative) {
  const filePath = absoluteFrom(root, relative);
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? fs.readFileSync(filePath, "utf8")
    : null;
}

function artifactResults(root) {
  return REQUIRED_ARTIFACTS.map((artifact) => {
    const filePath = absoluteFrom(root, artifact.file);
    const present = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    return result(
      artifact.id,
      artifact.title,
      present ? STATUS.PASS : STATUS.FAIL,
      present ? "仓库内存在可审计实现。" : "仓库内缺少必需实现或说明。",
      { path: normalizeRelative(artifact.file), present },
    );
  });
}

function contractResults(root) {
  return CONTRACTS.map((contract) => {
    const text = readText(root, contract.file);
    if (text === null) {
      return result(contract.id, contract.title, STATUS.FAIL, "契约文件缺失。", {
        path: normalizeRelative(contract.file),
        missingContracts: contract.patterns.length + (contract.sections || []).length,
      });
    }
    const missing = contract.patterns
      .map((pattern, index) => (pattern.test(text) ? null : `required-pattern-${index + 1}`))
      .filter(Boolean);
    const forbidden = (contract.forbidden || [])
      .map((pattern, index) => (pattern.test(text) ? `forbidden-pattern-${index + 1}` : null))
      .filter(Boolean);
    if (contract.id === "contract.inbound_effect_recovery") {
      for (const failure of inboundCriticalImportFailures(root)) missing.push(`critical-import:${failure}`);
    }
    const paths = new Set([normalizeRelative(contract.file)]);
    for (const section of contract.sections || []) {
      paths.add(normalizeRelative(section.file));
      const sectionSource = readText(root, section.file);
      if (sectionSource !== null && CRITICAL_AST_SECTION_IDS.has(section.id)) {
        try {
          const criticalInspection = criticalSectionAstInspection(section.id, sectionSource);
          for (const failure of criticalInspection.failures) missing.push(`${section.id}:ast-${failure}`);
          if (criticalInspection.range === null) missing.push(`${section.id}:section-missing`);
        } catch (_error) {
          missing.push(`${section.id}:ast-parse-failed`);
        }
        continue;
      }
      let inspectionSource = sectionSource;
      if (inspectionSource !== null && section.maskCommentsAndStrings) {
        try {
          inspectionSource = maskTypeScriptCommentsAndStrings(inspectionSource);
        } catch (_error) {
          missing.push(`${section.id}:invalid-typescript-lexical-structure`);
          continue;
        }
      }
      const blockRange = inspectionSource === null
        ? null
        : extractLegacyBalancedBlockRange(inspectionSource, section.startPattern);
      if (blockRange === null) {
        missing.push(`${section.id}:section-missing`);
        continue;
      }
      const block = inspectionSource.slice(blockRange.start, blockRange.end);
      const inspectionBlock = block;
      for (const [index, pattern] of section.patterns.entries()) {
        if (!pattern.test(inspectionBlock)) missing.push(`${section.id}:required-pattern-${index + 1}`);
      }
      for (const [index, pattern] of (section.forbidden || []).entries()) {
        if (pattern.test(inspectionBlock)) forbidden.push(`${section.id}:forbidden-pattern-${index + 1}`);
      }
      for (const [index, occurrence] of (section.occurrences || []).entries()) {
        const flags = occurrence.pattern.flags.includes("g") ? occurrence.pattern.flags : `${occurrence.pattern.flags}g`;
        const matches = inspectionBlock.match(new RegExp(occurrence.pattern.source, flags)) || [];
        if (matches.length < occurrence.minimum) {
          missing.push(`${section.id}:occurrence-${index + 1}-${matches.length}-of-${occurrence.minimum}`);
        }
        if (Number.isFinite(occurrence.maximum) && matches.length > occurrence.maximum) {
          forbidden.push(`${section.id}:occurrence-${index + 1}-${matches.length}-max-${occurrence.maximum}`);
        }
      }
      for (const [index, range] of (section.forbiddenRanges || []).entries()) {
        const startMatch = range.startPattern
          ? new RegExp(range.startPattern.source, range.startPattern.flags.replace(/g/g, "")).exec(inspectionBlock)
          : { index: 0, 0: "" };
        if (!startMatch) {
          missing.push(`${section.id}:forbidden-range-${index + 1}-start-missing`);
          continue;
        }
        const rangeStart = startMatch.index + startMatch[0].length;
        const suffix = inspectionBlock.slice(rangeStart);
        const endMatch = new RegExp(range.endPattern.source, range.endPattern.flags.replace(/g/g, "")).exec(suffix);
        if (!endMatch) {
          missing.push(`${section.id}:forbidden-range-${index + 1}-end-missing`);
          continue;
        }
        const rangeText = suffix.slice(0, endMatch.index);
        for (const [patternIndex, pattern] of range.patterns.entries()) {
          if (pattern.test(rangeText)) {
            forbidden.push(`${section.id}:forbidden-range-${index + 1}-pattern-${patternIndex + 1}`);
          }
        }
      }
    }
    const ok = missing.length === 0 && forbidden.length === 0;
    return result(
      contract.id,
      contract.title,
      ok ? STATUS.PASS : STATUS.FAIL,
      ok ? "代码/配置契约与完成度声明一致。" : "代码/配置契约不完整或存在禁止项。",
      { path: normalizeRelative(contract.file), paths: [...paths], missing, forbidden },
    );
  });
}


let typescriptCompiler = null;

function isStrictlyContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function loadTypeScriptCompilerFromDependencyRoot(dependencyRoot, options = {}) {
  if (typeof dependencyRoot !== "string" || !dependencyRoot.trim()) {
    throw new Error("TypeScript compiler dependencies are unavailable");
  }
  const realpathSync = options.realpathSync || fs.realpathSync;
  const requireModule = options.requireModule || require;
  const resolvedDependencyRoot = path.resolve(dependencyRoot);
  if (!fs.existsSync(resolvedDependencyRoot) || !fs.statSync(resolvedDependencyRoot).isDirectory()) {
    throw new Error("TypeScript compiler dependency root is unavailable");
  }
  const packageRoot = path.join(resolvedDependencyRoot, "typescript");
  const packageFile = path.join(packageRoot, "package.json");
  const entryFile = path.join(packageRoot, "lib", "typescript.js");
  for (const file of [packageFile, entryFile]) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error("TypeScript compiler package is incomplete");
    }
  }
  const realDependencyRoot = realpathSync(resolvedDependencyRoot);
  const realPackageRoot = realpathSync(packageRoot);
  const realPackageFile = realpathSync(packageFile);
  const realEntryFile = realpathSync(entryFile);
  if (!isStrictlyContainedPath(realDependencyRoot, realPackageRoot)) {
    throw new Error("TypeScript compiler package escapes its dependency root");
  }
  if (!isStrictlyContainedPath(realPackageRoot, realPackageFile)) {
    throw new Error("TypeScript compiler manifest escapes its package root");
  }
  if (!isStrictlyContainedPath(realPackageRoot, realEntryFile)) {
    throw new Error("TypeScript compiler entry escapes its package root");
  }
  const loaded = requireModule(realEntryFile);
  const requiredFunctions = [
    "createSourceFile",
    "forEachChild",
    "getLeadingCommentRanges",
    "getTrailingCommentRanges",
    "canHaveDecorators",
    "getDecorators",
    "getModifiers",
  ];
  if (requiredFunctions.some((name) => typeof loaded?.[name] !== "function")
    || !loaded?.ScriptTarget || !loaded?.ScriptKind || !loaded?.SyntaxKind) {
    throw new Error("TypeScript compiler API is unavailable");
  }
  return loaded;
}

function loadTypeScriptCompiler() {
  if (typescriptCompiler) return typescriptCompiler;
  const dependencyRoot = resolveWorktreeNodeModules(path.resolve(__dirname, ".."));
  typescriptCompiler = loadTypeScriptCompilerFromDependencyRoot(dependencyRoot);
  return typescriptCompiler;
}

function parseTypeScriptForAudit(text, fileName = "audit-source.ts", requireCleanParse = false) {
  const ts = loadTypeScriptCompiler();
  const sourceFile = ts.createSourceFile(
    fileName,
    String(text || ""),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const lexicalDiagnosticCodes = new Set([1002, 1010, 1160, 1161]);
  const diagnostics = sourceFile.parseDiagnostics || [];
  const lexicalFailure = diagnostics.some((diagnostic) =>
    lexicalDiagnosticCodes.has(diagnostic.code) || (diagnostic.code === 1005 && diagnostic.start >= text.length));
  if (lexicalFailure || (requireCleanParse && diagnostics.length)) {
    throw new SyntaxError(`invalid TypeScript syntax in ${fileName}`);
  }
  return { ts, sourceFile };
}

function maskTypeScriptCommentsAndStrings(text) {
  text = String(text || "");
  const { ts, sourceFile } = parseTypeScriptForAudit(text);
  const masked = text.split("");
  const lineTerminator = (character) => ["\n", "\r", "\u2028", "\u2029"].includes(character);
  const blank = (start, end) => {
    for (let index = Math.max(0, start); index < Math.min(end, masked.length); index += 1) {
      if (!lineTerminator(masked[index])) masked[index] = " ";
    }
  };
  const commentRanges = new Map();
  const collectCommentsAt = (position) => {
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, position) || []),
      ...(ts.getTrailingCommentRanges(text, position) || []),
    ]) {
      commentRanges.set(`${range.pos}:${range.end}`, range);
    }
  };
  const visit = (node) => {
    collectCommentsAt(node.pos);
    collectCommentsAt(node.end);
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  collectCommentsAt(0);
  collectCommentsAt(text.length);
  visit(sourceFile);
  for (const range of commentRanges.values()) blank(range.pos, range.end);

  const maskLiteralNode = (node) => {
    const start = node.getStart(sourceFile);
    const end = node.end;
    if (node.kind === ts.SyntaxKind.StringLiteral || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
      blank(start + 1, end - 1);
      return;
    }
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const literal = text.slice(start, end);
      const closingSlash = literal.lastIndexOf("/");
      if (closingSlash <= 0) throw new SyntaxError("invalid regular expression literal");
      blank(start + 1, start + closingSlash);
      blank(start + closingSlash + 1, end);
      return;
    }
    if (node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle) {
      blank(start + 1, end - 2);
      return;
    }
    if (node.kind === ts.SyntaxKind.TemplateTail) blank(start + 1, end - 1);
  };
  const visitLiterals = (node) => {
    maskLiteralNode(node);
    ts.forEachChild(node, visitLiterals);
  };
  visitLiterals(sourceFile);
  return masked.join("");
}

function maskTypeScriptForDecoratorAudit(text) {
  const masked = maskTypeScriptCommentsAndStrings(text);
  const restored = masked.split("");
  const decoratorLiteral = /@(?:Controller|Get|Post|Put|Patch|Delete|RequireOperatorCapability)\(\s*(["'])([^\r\n]*?)\1\s*\)/g;
  for (const match of masked.matchAll(decoratorLiteral)) {
    const quoteOffset = match[0].indexOf(match[1]);
    const contentStart = match.index + quoteOffset + 1;
    for (let offset = 0; offset < match[2].length; offset += 1) {
      restored[contentStart + offset] = text[contentStart + offset];
    }
  }
  return restored.join("");
}

function astNodes(ts, root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function decoratorsOfNode(ts, node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) || []) : [];
}

function staticPropertyName(ts, node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression &&
    (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))) {
    return node.argumentExpression.text;
  }
  if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ||
    ts.isNoSubstitutionTemplateLiteral(node.name))) return node.name.text;
  if (node.name && ts.isNumericLiteral(node.name)) {
    return String(Number(node.name.text));
  }
  return null;
}

function isWriteTarget(ts, node) {
  let target = node;
  while (target.parent && (
    ((ts.isPropertyAccessExpression(target.parent) || ts.isElementAccessExpression(target.parent)) &&
      target.parent.expression === target) ||
    ((ts.isParenthesizedExpression(target.parent) || ts.isAsExpression(target.parent) ||
      ts.isTypeAssertionExpression(target.parent) || ts.isNonNullExpression(target.parent)) &&
      target.parent.expression === target)
  )) target = target.parent;
  while (target.parent && (
    (ts.isPropertyAssignment(target.parent) && target.parent.initializer === target) ||
    (ts.isShorthandPropertyAssignment(target.parent) && target.parent.name === target) ||
    (ts.isSpreadAssignment(target.parent) && target.parent.expression === target) ||
    (ts.isObjectLiteralExpression(target.parent) && target.parent.properties.includes(target)) ||
    (ts.isArrayLiteralExpression(target.parent) && target.parent.elements.includes(target))
  )) target = target.parent;
  const parent = target.parent;
  if (!parent) return false;
  if (ts.isBinaryExpression(parent) && parent.left === target &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
  if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) return true;
  return ts.isDeleteExpression(parent) && parent.expression === target;
}

function isNonBindingPropertyName(ts, identifier) {
  const parent = identifier.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) && parent.name === identifier) ||
    (ts.isBindingElement(parent) && parent.propertyName === identifier) ||
    (ts.isImportSpecifier(parent) && parent.propertyName === identifier);
}

function criticalImportBindingFailures(text, fileName, specifications) {
  const { ts, sourceFile } = parseTypeScriptForAudit(text, fileName);
  const failures = [];
  for (const specification of specifications) {
    const matchingImports = [];
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== specification.source || !statement.importClause) continue;
      if (statement.importClause.isTypeOnly) continue;
      if (specification.kind === "default" && statement.importClause.name?.text === specification.name) {
        matchingImports.push(statement.importClause.name);
      }
      const bindings = statement.importClause.namedBindings;
      if (specification.kind === "named" && bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly && !element.propertyName && element.name.text === specification.name) {
            matchingImports.push(element.name);
          }
        }
      }
    }
    if (matchingImports.length !== 1) {
      failures.push(`${specification.name}-import`);
      continue;
    }
    const importedIdentifier = matchingImports[0];
    const identifiers = astNodes(ts, sourceFile, (node) => ts.isIdentifier(node) && node.text === specification.name);
    const usageAllowed = (identifier) => {
      if (identifier === importedIdentifier) return true;
      const parent = identifier.parent;
      if (isNonBindingPropertyName(ts, identifier)) return true;
      if (specification.usage === "call") return ts.isCallExpression(parent) && parent.expression === identifier;
      if (specification.usage === "namespace") {
        return (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
          parent.expression === identifier && !isWriteTarget(ts, identifier);
      }
      if (specification.usage === "decorator") {
        return ts.isCallExpression(parent) && parent.expression === identifier && ts.isDecorator(parent.parent);
      }
      if (specification.usage === "guard") {
        return ts.isCallExpression(parent) && parent.arguments.includes(identifier) &&
          ts.isIdentifier(parent.expression) && parent.expression.text === "UseGuards" && ts.isDecorator(parent.parent);
      }
      if (specification.usage === "type") return ts.isTypeReferenceNode(parent) && parent.typeName === identifier;
      return false;
    };
    if (identifiers.some((identifier) => !usageAllowed(identifier))) failures.push(`${specification.name}-usage`);
  }
  return failures;
}

function exactNamedImportFailure(text, fileName, source, expectedNames) {
  const { ts, sourceFile } = parseTypeScriptForAudit(text, fileName, true);
  const imports = sourceFile.statements.filter((statement) => ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === source);
  if (imports.length !== 1 || imports[0].importClause?.name || imports[0].importClause?.isTypeOnly) return true;
  const bindings = imports[0].importClause?.namedBindings;
  return !bindings || !ts.isNamedImports(bindings) || bindings.elements.length !== expectedNames.length ||
    bindings.elements.some((element, index) => element.isTypeOnly || element.propertyName ||
      element.name.text !== expectedNames[index]);
}

function inboundCriticalImportFailures(root) {
  const checks = [
    {
      file: "desktop/apps/api/src/local-store/local-store.service.ts",
      specifications: [
        { name: "fs", source: "node:fs", kind: "default", usage: "namespace" },
        { name: "path", source: "node:path", kind: "default", usage: "namespace" },
        { name: "randomUUID", source: "node:crypto", kind: "named", usage: "call" },
        { name: "deterministicOperationId", source: "../shared/operation-idempotency", kind: "named", usage: "call" },
        { name: "assertNotificationEffectReplay", source: "../shared/notification-idempotency", kind: "named", usage: "call" },
      ],
    },
    {
      file: "desktop/apps/api/src/notifications/notifications.service.ts",
      specifications: [
        { name: "assertNotificationEffectReplay", source: "../shared/notification-idempotency", kind: "named", usage: "call" },
        { name: "deterministicOperationId", source: "../shared/operation-idempotency", kind: "named", usage: "call" },
        { name: "isUniqueConstraintError", source: "../shared/operation-idempotency", kind: "named", usage: "call" },
      ],
    },
    {
      file: "desktop/apps/api/src/shared/notification-idempotency.ts",
      specifications: [
        { name: "createOperationFingerprint", source: "./operation-idempotency", kind: "named", usage: "call" },
      ],
    },
  ];
  const failures = [];
  for (const check of checks) {
    const text = readText(root, check.file);
    if (text === null) {
      failures.push(`${normalizeRelative(check.file)}:missing`);
      continue;
    }
    try {
      failures.push(...criticalImportBindingFailures(text, check.file, check.specifications)
        .map((failure) => `${normalizeRelative(check.file)}:${failure}`));
    } catch (_error) {
      failures.push(`${normalizeRelative(check.file)}:parse-failed`);
    }
  }
  return failures;
}

function compactAstText(sourceFile, node) {
  const ts = loadTypeScriptCompiler();
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    node.getText(sourceFile),
  );
  const tokens = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    tokens.push(scanner.getTokenText());
  }
  return tokens.join("");
}

function unwrapExpression(ts, node) {
  let current = node;
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current))) current = current.expression;
  return current;
}

function lexicalBindingScope(ts, node, includeSelf = true) {
  for (let current = includeSelf ? node : node.parent; current; current = current.parent) {
    if (ts.isSourceFile(current) || ts.isBlock(current) || ts.isModuleBlock(current) ||
      ts.isFunctionLike(current) || ts.isCatchClause(current)) return current;
  }
  return null;
}

function declarationBindingScope(ts, identifier) {
  const declaration = identifier.parent;
  if (ts.isParameter(declaration)) return lexicalBindingScope(ts, declaration.parent, true);
  const variableDeclaration = enclosingVariableDeclaration(ts, identifier);
  const declarationList = variableDeclaration?.parent;
  const loop = declarationList?.parent;
  if (declarationList && ts.isVariableDeclarationList(declarationList) &&
    !(declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) {
    for (let current = declaration; current; current = current.parent) {
      if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return current;
    }
  }
  if (declarationList && ts.isVariableDeclarationList(declarationList) &&
    (declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) && loop &&
    (ts.isForOfStatement(loop) || ts.isForInStatement(loop) || ts.isForStatement(loop))) return loop;
  return lexicalBindingScope(ts, declaration, false);
}

function sourceBindingResolver(ts, sourceFile) {
  const scopeBindings = new Map();
  const declare = (identifier) => {
    const scope = declarationBindingScope(ts, identifier);
    if (!scope) return;
    if (!scopeBindings.has(scope)) scopeBindings.set(scope, new Map());
    const names = scopeBindings.get(scope);
    if (!names.has(identifier.text)) names.set(identifier.text, []);
    names.get(identifier.text).push(identifier);
  };
  for (const identifier of astNodes(ts, sourceFile, (node) => ts.isIdentifier(node) &&
    isBindingDeclarationIdentifier(ts, node))) declare(identifier);
  const resolve = (identifier) => {
    for (let current = identifier.parent; current; current = current.parent) {
      if (!scopeBindings.has(current)) continue;
      const declarations = scopeBindings.get(current).get(identifier.text);
      if (declarations?.length) {
        const functionScopedVariables = declarations.filter((declaration) => {
          const variableDeclaration = enclosingVariableDeclaration(ts, declaration);
          const declarationList = variableDeclaration?.parent;
          return declarationList && ts.isVariableDeclarationList(declarationList) &&
            !(declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const));
        });
        if (functionScopedVariables.length === declarations.length) return declarations[0];
        const preceding = declarations.filter((declaration) =>
          declaration.getStart(sourceFile) <= identifier.getStart(sourceFile));
        return preceding[preceding.length - 1] || declarations[0];
      }
    }
    return null;
  };
  return resolve;
}

function isBindingDeclarationIdentifier(ts, identifier) {
  const parent = identifier.parent;
  return ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) &&
      parent.name === identifier) ||
    ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent)) && parent.name === identifier);
}

function enclosingVariableDeclaration(ts, identifier) {
  for (let current = identifier.parent; current; current = current.parent) {
    if (ts.isVariableDeclaration(current)) return current;
    if (ts.isStatement(current) || ts.isFunctionLike(current) || ts.isSourceFile(current)) break;
  }
  return null;
}

function assignmentPatternEvents(ts, pattern, expression, node, initialProjection = []) {
  const events = [];
  const projectionWithDefault = (projection, defaultExpression) => {
    if (!defaultExpression || !projection.length) return projection;
    return projection.map((step, index) => index === projection.length - 1
      ? { ...step, defaultExpression }
      : step);
  };
  const visit = (targetNode, valueNode, projection = [], defaultExpression = null) => {
    const target = unwrapExpression(ts, targetNode);
    if (!target) return;
    if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (projection.length) {
        visit(target.left, valueNode, projectionWithDefault(projection, target.right), defaultExpression);
      } else {
        visit(target.left, valueNode, projection, target.right);
      }
      return;
    }
    if (ts.isIdentifier(target)) {
      events.push({ identifier: target, node, expression: valueNode || null, projection, defaultExpression });
      return;
    }
    if (ts.isArrayBindingPattern(target) || ts.isArrayLiteralExpression(target)) {
      target.elements.forEach((element, index) => {
        if (ts.isOmittedExpression(element)) return;
        let elementTarget = element;
        if (ts.isBindingElement(element)) {
          elementTarget = element.name;
        } else if (ts.isSpreadElement(element)) {
          elementTarget = element.expression;
        }
        const projectionStep = (ts.isBindingElement(element) && element.dotDotDotToken) ||
          ts.isSpreadElement(element)
          ? { kind: "array-rest", index }
          : {
              kind: "index",
              index,
              defaultExpression: ts.isBindingElement(element) ? element.initializer || null : null,
            };
        visit(
          elementTarget,
          valueNode,
          [...projection, projectionStep],
        );
      });
      return;
    }
    if (ts.isObjectBindingPattern(target)) {
      for (const element of target.elements) {
        if (element.dotDotDotToken) {
          const excluded = target.elements
            .filter((candidate) => candidate !== element && !candidate.dotDotDotToken)
            .map((candidate) => candidate.propertyName || candidate.name);
          visit(element.name, valueNode, [...projection, { kind: "object-rest", excluded }]);
          continue;
        }
        let propertyProjection = null;
        if (element.propertyName && ts.isComputedPropertyName(element.propertyName)) {
          propertyProjection = { kind: "computed-property", expression: element.propertyName.expression };
        } else {
          const propertyName = element.propertyName
            ? staticPropertyName(ts, { name: element.propertyName })
            : ts.isIdentifier(element.name) ? element.name.text : null;
          if (propertyName) propertyProjection = { kind: "property", name: propertyName };
        }
        if (propertyProjection) {
          visit(element.name, valueNode, [
            ...projection,
            { ...propertyProjection, defaultExpression: element.initializer || null },
          ]);
        }
      }
      return;
    }
    if (ts.isObjectLiteralExpression(target)) {
      for (const property of target.properties) {
        if (ts.isPropertyAssignment(property)) {
          if (ts.isComputedPropertyName(property.name)) {
            visit(property.initializer, valueNode, [
              ...projection,
              { kind: "computed-property", expression: property.name.expression },
            ]);
          } else {
            const propertyName = staticPropertyName(ts, property);
            if (propertyName) {
              visit(property.initializer, valueNode, [...projection, { kind: "property", name: propertyName }]);
            }
          }
        } else if (ts.isShorthandPropertyAssignment(property)) {
          visit(property.name, valueNode, [...projection, {
            kind: "property",
            name: property.name.text,
            defaultExpression: property.objectAssignmentInitializer || null,
          }]);
        } else if (ts.isSpreadAssignment(property)) {
          const excluded = target.properties
            .filter((candidate) => candidate !== property && !ts.isSpreadAssignment(candidate))
            .map((candidate) => candidate.name).filter(Boolean);
          visit(property.expression, valueNode, [...projection, { kind: "object-rest", excluded }]);
        }
      }
    }
  };
  visit(pattern, expression, initialProjection);
  return events;
}

function isDestructuringAssignmentDefault(ts, binary) {
  if (!ts.isBinaryExpression(binary) || binary.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  let pattern = null;
  if (ts.isArrayLiteralExpression(binary.parent) && binary.parent.elements.includes(binary)) {
    pattern = binary.parent;
  } else if (ts.isPropertyAssignment(binary.parent) && binary.parent.initializer === binary &&
    ts.isObjectLiteralExpression(binary.parent.parent)) {
    pattern = binary.parent.parent;
  }
  if (!pattern) return false;
  const contains = (ancestor, node) => {
    for (let current = node; current; current = current.parent) {
      if (current === ancestor) return true;
    }
    return false;
  };
  for (let current = pattern; current.parent; current = current.parent) {
    const parent = current.parent;
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      contains(parent.left, pattern)) return true;
    if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) &&
      contains(parent.initializer, pattern)) return true;
    if (ts.isStatement(parent) || ts.isFunctionLike(parent) || ts.isSourceFile(parent)) return false;
  }
  return false;
}

function bindingWriteEvents(ts, sourceFile, declarationIdentifier, indexedWrites) {
  return [...(indexedWrites.get(declarationIdentifier) || [])]
    .sort((left, right) => left.node.getStart(sourceFile) - right.node.getStart(sourceFile));
}

function executionContainer(ts, node) {
  for (let current = node; current; current = current.parent) {
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return current;
  }
  return null;
}

function nodeContains(ancestor, node) {
  for (let current = node; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

function criticalClassSymbolFailures(ts, sourceFile, targetClass, className, propertyNames) {
  const failures = [];
  const criticalNames = new Set(propertyNames);
  const resolveBinding = sourceBindingResolver(ts, sourceFile);
  const sourceNodes = astNodes(ts, sourceFile, () => true);
  const bindingIdentifiers = [...new Set(sourceNodes.filter((node) => ts.isIdentifier(node) &&
    isBindingDeclarationIdentifier(ts, node) && enclosingVariableDeclaration(ts, node))
    .map((identifier) => resolveBinding(identifier)).filter(Boolean))];
  const bindingReferences = new Map(bindingIdentifiers.map((binding) => [binding, []]));
  for (const identifier of sourceNodes.filter(ts.isIdentifier)) {
    if (isBindingDeclarationIdentifier(ts, identifier)) continue;
    const binding = resolveBinding(identifier);
    if (bindingReferences.has(binding)) bindingReferences.get(binding).push(identifier);
  }
  const indexedWrites = new Map();
  const defaultInitializerContexts = new Map();
  const registerDefaultInitializerContexts = (event) => {
    for (const [index, step] of (event.projection || []).entries()) {
      if (!step.defaultExpression || defaultInitializerContexts.has(step.defaultExpression)) continue;
      const projection = event.projection.slice(0, index + 1).map((item, itemIndex) =>
        itemIndex === index ? { ...item, defaultExpression: null } : item);
      defaultInitializerContexts.set(step.defaultExpression, {
        expression: event.expression,
        projection,
        node: event.node,
      });
    }
    if (event.defaultExpression && !defaultInitializerContexts.has(event.defaultExpression)) {
      defaultInitializerContexts.set(event.defaultExpression, {
        expression: event.expression,
        projection: event.projection || [],
        node: event.node,
      });
    }
  };
  const indexWrite = (binding, event) => {
    registerDefaultInitializerContexts(event);
    if (!binding) return;
    if (!indexedWrites.has(binding)) indexedWrites.set(binding, []);
    indexedWrites.get(binding).push(event);
  };
  for (const declaration of sourceNodes.filter(ts.isVariableDeclaration)) {
    if (!declaration.initializer) continue;
    for (const event of assignmentPatternEvents(ts, declaration.name, declaration.initializer, declaration)) {
      indexWrite(resolveBinding(event.identifier), event);
    }
  }
  for (const parameter of sourceNodes.filter(ts.isParameter)) {
    for (const event of assignmentPatternEvents(
      ts,
      parameter.name,
      null,
      parameter,
      [{ kind: "identity", defaultExpression: parameter.initializer }],
    )) {
      indexWrite(resolveBinding(event.identifier), event);
    }
  }
  for (const binary of sourceNodes.filter(ts.isBinaryExpression)) {
    if (binary.operatorToken.kind < ts.SyntaxKind.FirstAssignment ||
      binary.operatorToken.kind > ts.SyntaxKind.LastAssignment) continue;
    if (isDestructuringAssignmentDefault(ts, binary)) continue;
    const left = unwrapExpression(ts, binary.left);
    if (!left) continue;
    if (binary.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      for (const event of assignmentPatternEvents(ts, left, binary.right, binary)) {
        indexWrite(resolveBinding(event.identifier), event);
      }
    } else if (ts.isIdentifier(left)) {
      indexWrite(resolveBinding(left), { node: binary, expression: null });
    }
  }
  for (const unary of sourceNodes.filter((node) =>
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken))) {
    const operand = unwrapExpression(ts, unary.operand);
    if (operand && ts.isIdentifier(operand)) {
      indexWrite(resolveBinding(operand), { node: unary, expression: null });
    }
  }
  for (const statement of sourceNodes.filter(ts.isForOfStatement)) {
    if (ts.isVariableDeclarationList(statement.initializer)) {
      for (const declaration of statement.initializer.declarations) {
        for (const event of assignmentPatternEvents(
          ts,
          declaration.name,
          statement.expression,
          statement,
          [{ kind: "iteration" }],
        )) {
          indexWrite(resolveBinding(event.identifier), event);
        }
      }
    } else {
      for (const event of assignmentPatternEvents(
        ts,
        statement.initializer,
        statement.expression,
        statement,
        [{ kind: "iteration" }],
      )) {
        indexWrite(resolveBinding(event.identifier), event);
      }
    }
  }
  const bindingEvents = new Map();
  const eventsForBinding = (binding) => {
    if (!bindingEvents.has(binding)) {
      bindingEvents.set(binding, bindingWriteEvents(ts, sourceFile, binding, indexedWrites));
    }
    return bindingEvents.get(binding);
  };
  const applicableEvents = (binding, useNode) => {
    const useStart = useNode.getStart(sourceFile);
    const useContainer = executionContainer(ts, useNode);
    const events = eventsForBinding(binding).filter((event) => {
      if (event.node.getStart(sourceFile) >= useStart) return false;
      const eventContainer = executionContainer(ts, event.node);
      return eventContainer === useContainer || eventContainer === sourceFile ||
        Boolean(eventContainer && nodeContains(eventContainer, useNode));
    });
    return events;
  };
  const unknownStaticValue = Object.freeze({ kind: "unknown" });
  const undefinedStaticValue = Object.freeze({ kind: "undefined" });
  const staticValueKey = (value) => {
    if (!value) return "unknown";
    if (["string", "boolean", "number", "operation", "global"].includes(value.kind)) {
      return `${value.kind}:${value.value}`;
    }
    if (value.kind === "tuple") return `tuple:[${value.values.map(staticValueKey).join(",")}]`;
    if (value.kind === "object") {
      return `object:{${[...value.properties.entries()]
        .map(([name, item]) => `${name}:${staticValueKey(item)}`).sort().join(",")}}`;
    }
    if (value.kind === "operation-wrapper") {
      return `${value.kind}:${value.wrapper}:${value.operation}:[${(value.arguments || []).map(staticValueKey).join(",")}]`;
    }
    if (value.kind === "bound-operation") {
      return `${value.kind}:${value.operation}:[${value.arguments.map(staticValueKey).join(",")}]:${value.unknownArguments}`;
    }
    if (value.kind === "union") return `union:${value.values.map(staticValueKey).sort().join("|")}`;
    return value.kind;
  };
  const unionStaticValues = (...inputs) => {
    const values = [];
    const add = (value) => {
      if (!value) return;
      if (value.kind === "union") {
        value.values.forEach(add);
        return;
      }
      if (!values.some((item) => staticValueKey(item) === staticValueKey(value))) values.push(value);
    };
    inputs.forEach(add);
    if (!values.length) return unknownStaticValue;
    return values.length === 1 ? values[0] : { kind: "union", values };
  };
  const staticAlternatives = (value) => value?.kind === "union" ? value.values : [value || unknownStaticValue];
  const containsStaticKind = (value, ...kinds) =>
    staticAlternatives(value).some((item) => kinds.includes(item.kind));
  const staticTruthiness = (value) => {
    const states = staticAlternatives(value).map((item) => {
      if (["unknown", "possible-target-prototype"].includes(item.kind)) return null;
      if (["undefined", "null"].includes(item.kind)) return false;
      if (item.kind === "string") return item.value.length > 0;
      if (item.kind === "boolean") return item.value;
      if (item.kind === "number") return Boolean(item.value);
      return true;
    });
    return states.every((state) => state === true)
      ? true
      : states.every((state) => state === false) ? false : null;
  };
  const staticNullishness = (value) => {
    const states = staticAlternatives(value).map((item) => {
      if (["unknown", "possible-target-prototype"].includes(item.kind)) return null;
      return ["undefined", "null"].includes(item.kind);
    });
    return states.every((state) => state === true)
      ? true
      : states.every((state) => state === false) ? false : null;
  };
  const conditionalWriteForUse = (event, useNode, ignoreLogicalReachability = false) => {
    const container = executionContainer(ts, event.node);
    const nearestBlock = (node) => {
      for (let current = node.parent; current && current !== container; current = current.parent) {
        if (ts.isBlock(current)) return current;
      }
      return null;
    };
    for (let current = event.node.parent; current && current !== container; current = current.parent) {
      if (ts.isIfStatement(current)) {
        const branch = nodeContains(current.thenStatement, event.node)
          ? current.thenStatement
          : current.elseStatement && nodeContains(current.elseStatement, event.node)
            ? current.elseStatement
            : null;
        const conditionState = staticTruthiness(staticValueAt(current.expression, current));
        const selected = conditionState === null
          ? null
          : conditionState ? current.thenStatement : current.elseStatement || null;
        if (selected && branch === selected) continue;
        if (!branch || !nodeContains(branch, useNode)) return true;
      }
      if (ts.isConditionalExpression(current)) {
        const conditionState = staticTruthiness(staticValueAt(current.condition, current));
        const selected = conditionState === null ? null : conditionState ? current.whenTrue : current.whenFalse;
        if (selected && nodeContains(selected, event.node)) continue;
        return true;
      }
      if (ts.isSwitchStatement(current) || ts.isCaseBlock(current)) return true;
      if (ts.isTryStatement(current)) {
        const eventBlock = nearestBlock(event.node);
        const useBlock = nearestBlock(useNode);
        if (eventBlock === useBlock && eventBlock && nodeContains(current.tryBlock, eventBlock) &&
          nodeContains(current.tryBlock, useNode)) continue;
        return true;
      }
      if (ts.isWhileStatement(current) || ts.isDoStatement(current) || ts.isForStatement(current) ||
        ts.isForInStatement(current) || ts.isForOfStatement(current)) {
        if (!nodeContains(current, useNode)) return true;
      }
      if (ts.isBinaryExpression(current) &&
        [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken].includes(current.operatorToken.kind) &&
        nodeContains(current.right, event.node) && !ignoreLogicalReachability) return true;
    }
    return false;
  };
  const eventIsUnconditionalWithin = (event, branch) => {
    if (ts.isIfStatement(branch) || ts.isConditionalExpression(branch) || ts.isSwitchStatement(branch) ||
      ts.isTryStatement(branch) || ts.isWhileStatement(branch) || ts.isDoStatement(branch) ||
      ts.isForStatement(branch) || ts.isForInStatement(branch) || ts.isForOfStatement(branch)) return false;
    for (let current = event.node.parent; current && current !== branch; current = current.parent) {
      if (ts.isFunctionLike(current) || ts.isConditionalExpression(current) || ts.isSwitchStatement(current) ||
        ts.isCaseBlock(current) || ts.isTryStatement(current) || ts.isIfStatement(current) ||
        ts.isWhileStatement(current) || ts.isDoStatement(current) || ts.isForStatement(current) ||
        ts.isForInStatement(current) || ts.isForOfStatement(current)) return false;
      if (ts.isBinaryExpression(current) &&
        [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken].includes(current.operatorToken.kind) &&
        nodeContains(current.right, event.node)) return false;
    }
    return nodeContains(branch, event.node);
  };
  const exhaustiveIfMerge = (event, events, useNode) => {
    let result = null;
    for (let current = event.node.parent; current; current = current.parent) {
      if (current === executionContainer(ts, event.node)) break;
      if (!ts.isIfStatement(current) || !current.elseStatement || nodeContains(current, useNode) ||
        current.getEnd() > useNode.getStart(sourceFile) || conditionalWriteForUse({ node: current }, useNode)) continue;
      const branchTail = (branch) => {
        const branchEvents = events.filter((candidate) => nodeContains(branch, candidate.node));
        const guaranteed = branchEvents.filter((candidate) => eventIsUnconditionalWithin(candidate, branch));
        if (!guaranteed.length) return null;
        const lastGuaranteed = guaranteed[guaranteed.length - 1];
        const cutoff = lastGuaranteed.node.getStart(sourceFile);
        return branchEvents.filter((candidate) => candidate.node.getStart(sourceFile) >= cutoff);
      };
      const whenTrue = branchTail(current.thenStatement);
      const whenFalse = branchTail(current.elseStatement);
      if (whenTrue?.length && whenFalse?.length) {
        result = { statement: current, events: [...whenTrue, ...whenFalse] };
      }
    }
    return result;
  };
  const applyStaticProjection = (initialValue, projection, useNode, seenBindings) => {
    let value = initialValue;
    for (const step of projection || []) {
      if (value.kind === "union") {
        value = unionStaticValues(...value.values.map((item) =>
          applyStaticProjection(item, [step], useNode, seenBindings)));
        continue;
      }
      if (step.kind === "identity") {
        value = applyStaticDefault(value, step.defaultExpression, useNode, seenBindings);
        continue;
      }
      if (step.kind === "index") {
        value = value.kind !== "tuple" || step.index < 0
          ? unknownStaticValue
          : step.index < value.values.length ? value.values[step.index] : undefinedStaticValue;
        value = applyStaticDefault(value, step.defaultExpression, useNode, seenBindings);
        continue;
      }
      if (step.kind === "array-rest") {
        value = value.kind === "tuple"
          ? { kind: "tuple", values: value.values.slice(step.index) }
          : unknownStaticValue;
        value = applyStaticDefault(value, step.defaultExpression, useNode, seenBindings);
        continue;
      }
      if (step.kind === "object-rest") {
        const excluded = [];
        let unknownExclusion = false;
        for (const name of step.excluded || []) {
          if (ts.isComputedPropertyName(name)) {
            const computed = staticValueAt(name.expression, useNode, seenBindings);
            if (["string", "number"].includes(computed.kind)) excluded.push(String(computed.value));
            else unknownExclusion = true;
          } else {
            const propertyName = staticPropertyName(ts, { name });
            if (propertyName === null) unknownExclusion = true;
            else excluded.push(propertyName);
          }
        }
        if (value.kind === "object") {
          const retained = new Map([...value.properties].filter(([name]) => !excluded.includes(name)));
          const projected = { kind: "object", properties: retained };
          if (unknownExclusion) {
            value = unionStaticValues(
              projected,
              ...[...retained.keys()].map((possiblyExcluded) => ({
                kind: "object",
                properties: new Map([...retained].filter(([name]) => name !== possiblyExcluded)),
              })),
            );
          } else {
            value = projected;
          }
        } else {
          value = unknownStaticValue;
        }
        value = applyStaticDefault(value, step.defaultExpression, useNode, seenBindings);
        continue;
      }
      if (step.kind === "iteration") {
        value = value.kind !== "tuple" || !value.values.length
          ? unknownStaticValue
          : unionStaticValues(...value.values);
        value = applyStaticDefault(value, step.defaultExpression, useNode, seenBindings);
        continue;
      }
      let propertyName = null;
      if (step.kind === "property") propertyName = step.name;
      if (step.kind === "computed-property") {
        const computed = staticValueAt(step.expression, useNode, seenBindings);
        if (["string", "number"].includes(computed.kind)) propertyName = String(computed.value);
      }
      if (propertyName === null) {
        value = value.kind === "target-class" ? { kind: "possible-target-prototype" } : unknownStaticValue;
      } else if (value.kind === "target-class" && propertyName === "prototype") {
        value = { kind: "target-prototype" };
      } else if (value.kind === "object" && value.properties.has(propertyName)) {
        value = value.properties.get(propertyName);
      } else if (value.kind === "object") {
        value = undefinedStaticValue;
      } else if (value.kind === "global") {
        const allowed = value.value === "Object"
          ? ["assign", "defineProperty", "defineProperties", "set"]
          : value.value === "Reflect" ? ["apply", "defineProperty", "set"] : [];
        value = allowed.includes(propertyName)
          ? { kind: "operation", value: propertyName }
          : unknownStaticValue;
      } else if (value.kind === "operation" && ["call", "apply", "bind"].includes(propertyName)) {
        value = { kind: "operation-wrapper", wrapper: propertyName, operation: value.value };
      } else if (value.kind === "bound-operation" && ["call", "apply", "bind"].includes(propertyName)) {
        value = { ...value, kind: "operation-wrapper", wrapper: propertyName };
      } else {
        value = unknownStaticValue;
      }
      value = applyStaticDefault(value, step.defaultExpression, useNode, seenBindings);
    }
    return value;
  };
  const applyStaticDefault = (value, defaultExpression, useNode, seenBindings) => {
    if (!defaultExpression) return value;
    const fallback = staticValueAt(defaultExpression, useNode, seenBindings);
    return unionStaticValues(...staticAlternatives(value).map((item) => {
      if (item.kind === "undefined") return fallback;
      if (item.kind === "unknown") return unionStaticValues(item, fallback);
      return item;
    }));
  };
  const eventExecutionReachability = (event, useNode, seenBindings) => {
    let reachability = "always";
    const mergeReachability = (state) => {
      if (state === "never") reachability = "never";
      else if (state === "conditional" && reachability === "always") reachability = "conditional";
    };
    for (const [initializer, context] of defaultInitializerContexts) {
      if (!nodeContains(initializer, event.node)) continue;
      const projected = context.expression
        ? applyStaticProjection(
          staticValueAt(context.expression, context.node, seenBindings),
          context.projection,
          context.node,
          seenBindings,
        )
        : unknownStaticValue;
      const undefinedState = staticAlternatives(projected).map((item) =>
        item.kind === "undefined" ? true : item.kind === "unknown" ? null : false);
      mergeReachability(undefinedState.every((state) => state === true)
        ? "always"
        : undefinedState.every((state) => state === false) ? "never" : "conditional");
    }
    const container = executionContainer(ts, event.node);
    for (let current = event.node.parent; current && current !== container; current = current.parent) {
      if (ts.isIfStatement(current)) {
        const state = staticTruthiness(staticValueAt(current.expression, current, seenBindings));
        const inThen = nodeContains(current.thenStatement, event.node);
        const inElse = current.elseStatement && nodeContains(current.elseStatement, event.node);
        if (state !== null && ((state && inElse) || (!state && inThen))) mergeReachability("never");
        else if (state === null && (inThen || inElse)) mergeReachability("conditional");
      }
      if (ts.isConditionalExpression(current)) {
        const state = staticTruthiness(staticValueAt(current.condition, current, seenBindings));
        const inTrue = nodeContains(current.whenTrue, event.node);
        const inFalse = nodeContains(current.whenFalse, event.node);
        if (state !== null && ((state && inFalse) || (!state && inTrue))) mergeReachability("never");
        else if (state === null && (inTrue || inFalse)) mergeReachability("conditional");
      }
      if (!ts.isBinaryExpression(current) || !nodeContains(current.right, event.node)) continue;
      const operator = current.operatorToken.kind;
      if (![ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken].includes(operator)) continue;
      const left = staticValueAt(current.left, current, seenBindings);
      const state = operator === ts.SyntaxKind.QuestionQuestionToken
        ? staticNullishness(left)
        : staticTruthiness(left);
      const rightRuns = operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken
        ? state
        : state === null ? null : !state;
      mergeReachability(rightRuns === true ? "always" : rightRuns === false ? "never" : "conditional");
    }
    return reachability;
  };
  const staticValueAt = (node, useNode = node, seenBindings = new Set()) => {
    const expression = unwrapExpression(ts, node);
    if (!expression) return unknownStaticValue;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return { kind: "string", value: expression.text };
    }
    if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: "null" };
    if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) {
      return { kind: "boolean", value: expression.kind === ts.SyntaxKind.TrueKeyword };
    }
    if (ts.isNumericLiteral(expression)) return { kind: "number", value: Number(expression.text) };
    if (ts.isTemplateExpression(expression)) {
      let value = expression.head.text;
      for (const span of expression.templateSpans) {
        const substitution = staticValueAt(span.expression, useNode, seenBindings);
        if (substitution.kind !== "string") return unknownStaticValue;
        value += substitution.value + span.literal.text;
      }
      return { kind: "string", value };
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticValueAt(expression.left, useNode, seenBindings);
      const right = staticValueAt(expression.right, useNode, seenBindings);
      return left.kind === "string" && right.kind === "string"
        ? { kind: "string", value: left.value + right.value }
        : unknownStaticValue;
    }
    if (ts.isConditionalExpression(expression)) {
      const condition = staticTruthiness(staticValueAt(expression.condition, useNode, seenBindings));
      if (condition === true) return staticValueAt(expression.whenTrue, useNode, seenBindings);
      if (condition === false) return staticValueAt(expression.whenFalse, useNode, seenBindings);
      const whenTrue = staticValueAt(expression.whenTrue, useNode, seenBindings);
      const whenFalse = staticValueAt(expression.whenFalse, useNode, seenBindings);
      return unionStaticValues(whenTrue, whenFalse);
    }
    if (ts.isBinaryExpression(expression) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind)) {
      const left = staticValueAt(expression.left, useNode, seenBindings);
      const operator = expression.operatorToken.kind;
      const state = operator === ts.SyntaxKind.QuestionQuestionToken
        ? staticNullishness(left)
        : staticTruthiness(left);
      const rightRuns = operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken
        ? state
        : state === null ? null : !state;
      if (rightRuns === false) return left;
      const right = staticValueAt(expression.right, useNode, seenBindings);
      return rightRuns === true ? right : unionStaticValues(left, right);
    }
    if (ts.isArrayLiteralExpression(expression)) {
      if (expression.elements.some(ts.isSpreadElement)) {
        return unknownStaticValue;
      }
      return {
        kind: "tuple",
        values: expression.elements.map((element) => ts.isOmittedExpression(element)
          ? undefinedStaticValue
          : staticValueAt(element, useNode, seenBindings)),
      };
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const properties = new Map();
      for (const property of expression.properties) {
        if (ts.isSpreadAssignment(property)) return unknownStaticValue;
        let propertyName = staticPropertyName(ts, property);
        if (property.name && ts.isComputedPropertyName(property.name)) {
          const computed = staticValueAt(property.name.expression, useNode, seenBindings);
          propertyName = ["string", "number"].includes(computed.kind)
            ? String(computed.value) : null;
        }
        if (!propertyName) return unknownStaticValue;
        if (ts.isPropertyAssignment(property)) {
          properties.set(propertyName, staticValueAt(property.initializer, useNode, seenBindings));
        } else if (ts.isShorthandPropertyAssignment(property)) {
          properties.set(propertyName, staticValueAt(property.name, useNode, seenBindings));
        } else if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) ||
          ts.isSetAccessorDeclaration(property)) {
          properties.set(propertyName, unknownStaticValue);
        } else {
          return unknownStaticValue;
        }
      }
      return { kind: "object", properties };
    }
    if (ts.isCallExpression(expression)) {
      const callees = staticAlternatives(staticValueAt(expression.expression, useNode, seenBindings));
      const argumentsValue = expression.arguments.some(ts.isSpreadElement)
        ? { values: [], unknown: true }
        : {
            values: expression.arguments.map((argument) => staticValueAt(argument, expression, seenBindings)),
            unknown: false,
          };
      const bound = callees.flatMap((callee) => {
        if (callee.kind !== "operation-wrapper" || callee.wrapper !== "bind") return [];
        return [{
          kind: "bound-operation",
          operation: callee.operation,
          arguments: [...(callee.arguments || []), ...argumentsValue.values.slice(1)],
          unknownArguments: Boolean(callee.unknownArguments || argumentsValue.unknown),
        }];
      });
      return bound.length ? unionStaticValues(...bound) : unknownStaticValue;
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const owner = staticValueAt(expression.expression, useNode, seenBindings);
      let propertyName = null;
      if (ts.isPropertyAccessExpression(expression)) propertyName = expression.name.text;
      if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
        const computed = staticValueAt(expression.argumentExpression, useNode, seenBindings);
        if (computed.kind === "string") propertyName = computed.value;
        if (computed.kind === "number" && Number.isInteger(computed.value) && computed.value >= 0) {
          return applyStaticProjection(owner, [{ kind: "index", index: computed.value }], useNode, seenBindings);
        }
      }
      if (propertyName === null) {
        if (containsStaticKind(owner, "global")) return { kind: "operation", value: "unknown-operation" };
        return containsStaticKind(owner, "target-class")
          ? unionStaticValues({ kind: "possible-target-prototype" }, unknownStaticValue)
          : unknownStaticValue;
      }
      return applyStaticProjection(owner, [{ kind: "property", name: propertyName }], useNode, seenBindings);
    }
    if (expression.kind === ts.SyntaxKind.ThisKeyword) {
      let classElement = null;
      for (let current = expression.parent; current && current !== targetClass; current = current.parent) {
        if (ts.isFunctionLike(current) && !ts.isArrowFunction(current) && current.parent !== targetClass) {
          return unknownStaticValue;
        }
        if (current.parent === targetClass) classElement = current;
      }
      if (!classElement) return unknownStaticValue;
      const isStatic = (ts.getModifiers(classElement) || [])
        .some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ||
        (ts.isClassStaticBlockDeclaration && ts.isClassStaticBlockDeclaration(classElement));
      return isStatic ? { kind: "target-class" } : { kind: "target-prototype" };
    }
    if (!ts.isIdentifier(expression)) return unknownStaticValue;
    const binding = resolveBinding(expression);
    if (binding === targetClass.name) return { kind: "target-class" };
    if (!binding) {
      if (expression.text === "undefined") return undefinedStaticValue;
      return ["Object", "Reflect"].includes(expression.text)
        ? { kind: "global", value: expression.text }
        : unknownStaticValue;
    }
    if (seenBindings.has(binding)) return unknownStaticValue;
    const events = applicableEvents(binding, useNode);
    if (!events.length) return unknownStaticValue;
    const nextSeen = new Set(seenBindings);
    nextSeen.add(binding);
    const eventReachability = new Map(events.map((event) => [
      event,
      eventExecutionReachability(event, useNode, nextSeen),
    ]));
    const reachableEvents = events.filter((event) => eventReachability.get(event) !== "never");
    let currentValue = unknownStaticValue;
    let hasValue = false;
    const mergedIfStatements = new Set();
    const valueForEvent = (event) => {
      const projected = applyStaticProjection(
        event.expression ? staticValueAt(event.expression, event.node, nextSeen) : unknownStaticValue,
        event.projection,
        event.node,
        nextSeen,
      );
      return applyStaticDefault(projected, event.defaultExpression, event.node, nextSeen);
    };
    for (const event of reachableEvents) {
      const priorMerge = [...mergedIfStatements].find((statement) => nodeContains(statement, event.node));
      if (priorMerge) continue;
      const merge = exhaustiveIfMerge(event, reachableEvents, useNode);
      if (merge) {
        mergedIfStatements.add(merge.statement);
        currentValue = unionStaticValues(...merge.events.map(valueForEvent));
        hasValue = true;
        continue;
      }
      const eventValue = valueForEvent(event);
      currentValue = (eventReachability.get(event) === "conditional" ||
        conditionalWriteForUse(event, useNode, true)) && hasValue
        ? unionStaticValues(currentValue, eventValue)
        : eventValue;
      hasValue = true;
    }
    return currentValue;
  };
  const unknownStaticString = Object.freeze({ known: false, value: null });
  const staticStringAt = (node, useNode = node, seenBindings = new Set()) => {
    const value = staticValueAt(node, useNode, seenBindings);
    return value.kind === "string" ? { known: true, value: value.value } : unknownStaticString;
  };
  const isTargetPrototypeAt = (node, seenBindings = new Set()) => {
    return containsStaticKind(
      staticValueAt(node, node, seenBindings),
      "target-prototype",
      "possible-target-prototype",
    );
  };
  const isCriticalTarget = (node) => {
    const expression = unwrapExpression(ts, node);
    return Boolean(isTargetPrototypeAt(expression));
  };

  const unsafeDirectWrite = sourceNodes.some((node) => {
    if ((!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) || !isWriteTarget(ts, node)) return false;
    if (!isCriticalTarget(node.expression)) return false;
    if (ts.isPropertyAccessExpression(node)) return criticalNames.has(node.name.text);
    const propertyName = staticStringAt(node.argumentExpression, node);
    return !propertyName.known || criticalNames.has(propertyName.value);
  });
  if (unsafeDirectWrite) failures.push("critical-symbol-write");

  const staticArgumentList = (argumentsList, call) => argumentsList.some(ts.isSpreadElement)
    ? { values: [], unknown: true }
    : { values: argumentsList.map((argument) => staticValueAt(argument, call)), unknown: false };
  const callableOperations = (value) => staticAlternatives(value).flatMap((item) => {
    if (item.kind === "operation") return [{ operation: item.value, arguments: [], unknownArguments: false }];
    if (item.kind === "bound-operation") return [{
      operation: item.operation,
      arguments: item.arguments,
      unknownArguments: item.unknownArguments,
    }];
    return [];
  });
  const expandApplyInvocation = (invocation, seen = new Set(), depth = 0) => {
    if (invocation.operation !== "apply") return [invocation];
    if (invocation.unknownArguments) return [invocation];
    const key = `${invocation.operation}:[${invocation.arguments.map(staticValueKey).join(",")}]`;
    if (depth >= 16 || seen.has(key)) {
      return [{
        operation: "unknown-operation",
        arguments: invocation.arguments,
        unknownArguments: true,
      }];
    }
    const appliedCallable = invocation.arguments[0];
    const appliedArguments = invocation.arguments[2];
    const callables = callableOperations(appliedCallable);
    if (!callables.length || appliedArguments?.kind !== "tuple") {
      return [{
        operation: "unknown-operation",
        arguments: invocation.arguments,
        unknownArguments: true,
      }];
    }
    const nextSeen = new Set(seen);
    nextSeen.add(key);
    return callables.flatMap((callable) => expandApplyInvocation({
      operation: callable.operation,
      arguments: [...callable.arguments, ...appliedArguments.values],
      unknownArguments: Boolean(callable.unknownArguments),
    }, nextSeen, depth + 1));
  };
  const invocationSemantics = (call) => {
    const syntaxArguments = staticArgumentList(call.arguments, call);
    const invocations = [];
    for (const callee of staticAlternatives(staticValueAt(call.expression, call))) {
      if (callee.kind === "bound-operation") {
        invocations.push({
          operation: callee.operation,
          arguments: [...callee.arguments, ...syntaxArguments.values],
          unknownArguments: Boolean(callee.unknownArguments || syntaxArguments.unknown),
        });
        continue;
      }
      if (callee.kind === "operation-wrapper") {
        if (callee.wrapper === "bind") continue;
        const base = callee.arguments || [];
        if (callee.wrapper === "call") {
          invocations.push({
            operation: callee.operation,
            arguments: [...base, ...syntaxArguments.values.slice(1)],
            unknownArguments: Boolean(callee.unknownArguments || syntaxArguments.unknown),
          });
        } else if (callee.wrapper === "apply") {
          const applied = syntaxArguments.values[1];
          invocations.push({
            operation: callee.operation,
            arguments: applied?.kind === "tuple" ? [...base, ...applied.values] : base,
            unknownArguments: Boolean(callee.unknownArguments || syntaxArguments.unknown || applied?.kind !== "tuple"),
          });
        }
        continue;
      }
      if (callee.kind === "operation") {
        invocations.push({
          operation: callee.value,
          arguments: syntaxArguments.values,
          unknownArguments: syntaxArguments.unknown,
        });
      }
    }
    return invocations.flatMap((invocation) => expandApplyInvocation(invocation));
  };
  const isCriticalStaticTarget = (value) => containsStaticKind(
    value,
    "target-prototype",
    "possible-target-prototype",
  );
  const isUnsafeAssignSource = (value) => value?.kind !== "object" ||
    [...value.properties.keys()].some((name) => criticalNames.has(name));
  const calls = sourceNodes.filter(ts.isCallExpression);
  for (const call of calls) {
    for (const invocation of invocationSemantics(call)) {
      if (invocation.unknownArguments) {
        failures.push("critical-symbol-write");
        break;
      }
      const target = invocation.arguments[0];
      if (!target || !isCriticalStaticTarget(target)) continue;
      if (invocation.operation === "unknown-operation") {
        failures.push("critical-symbol-write");
        break;
      }
      if (invocation.operation === "assign") {
        if (invocation.arguments.slice(1).some(isUnsafeAssignSource)) {
          failures.push("critical-symbol-write");
          break;
        }
        continue;
      }
      if (["defineProperty", "set"].includes(invocation.operation)) {
        const propertyName = invocation.arguments[1];
        if (propertyName?.kind !== "string" || criticalNames.has(propertyName.value)) {
          failures.push("critical-symbol-write");
          break;
        }
      }
      if (invocation.operation === "defineProperties") {
        const descriptors = invocation.arguments[1];
        if (descriptors?.kind !== "object" || [...descriptors.properties.keys()]
          .some((name) => criticalNames.has(name))) {
          failures.push("critical-symbol-write");
          break;
        }
      }
    }
    if (failures.includes("critical-symbol-write")) break;
  }

  const shadowed = astNodes(ts, targetClass, (node) => ts.isIdentifier(node) &&
    criticalNames.has(node.text) && isBindingDeclarationIdentifier(ts, node));
  if (shadowed.length) failures.push("critical-symbol-shadow");
  return [...new Set(failures)];
}

function hasModuleBlockAncestor(ts, node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isModuleBlock(current)) return true;
  }
  return false;
}

function ownedLockSymbolFailures(ts, sourceFile, targetFunction) {
  const failures = [];
  const identifiers = astNodes(ts, sourceFile, (node) => ts.isIdentifier(node) &&
    node.text === "ownedLocalStoreLockHandle");
  const declarations = identifiers.filter((identifier) => isBindingDeclarationIdentifier(ts, identifier));
  const targetIdentifier = targetFunction.name;
  if (declarations.some((identifier) => identifier !== targetIdentifier && !hasModuleBlockAncestor(ts, identifier))) {
    failures.push("function-shadow");
  }
  if (identifiers.some((identifier) => identifier !== targetIdentifier && isWriteTarget(ts, identifier))) {
    failures.push("function-write");
  }
  return failures;
}

function isTrimmedEffectKeyInitializer(ts, node) {
  const trimCall = unwrapExpression(ts, node);
  if (!trimCall || !ts.isCallExpression(trimCall) || trimCall.arguments.length ||
    !ts.isPropertyAccessExpression(trimCall.expression) || trimCall.expression.name.text !== "trim") return false;
  const stringCall = unwrapExpression(ts, trimCall.expression.expression);
  if (!stringCall || !ts.isCallExpression(stringCall) || stringCall.arguments.length !== 1 ||
    !ts.isIdentifier(stringCall.expression) || stringCall.expression.text !== "String") return false;
  const fallback = unwrapExpression(ts, stringCall.arguments[0]);
  if (!fallback || !ts.isBinaryExpression(fallback) ||
    fallback.operatorToken.kind !== ts.SyntaxKind.BarBarToken ||
    !ts.isStringLiteral(fallback.right) || fallback.right.text !== "") return false;
  const targetEffectKey = unwrapExpression(ts, fallback.left);
  const target = targetEffectKey && ts.isPropertyAccessExpression(targetEffectKey)
    ? unwrapExpression(ts, targetEffectKey.expression)
    : null;
  return Boolean(targetEffectKey && ts.isPropertyAccessExpression(targetEffectKey) &&
    targetEffectKey.questionDotToken && targetEffectKey.name.text === "effectKey" &&
    target && ts.isIdentifier(target) && target.text === "target");
}

function exactCallExpression(ts, sourceFile, node, callee, argumentsText) {
  const call = unwrapExpression(ts, node);
  return Boolean(call && ts.isCallExpression(call) &&
    compactAstText(sourceFile, call.expression) === callee &&
    call.arguments.length === argumentsText.length &&
    call.arguments.every((argument, index) => compactAstText(sourceFile, argument) === argumentsText[index]));
}

function localNotificationAstFailures(ts, sourceFile, method) {
  const failures = [];
  if ((ts.getModifiers(method) || []).length || method.asteriskToken || method.questionToken ||
    method.exclamationToken || method.typeParameters?.length || decoratorsOfNode(ts, method).length) {
    failures.push("method-modifiers");
  }
  const expectedParameters = ["level:string", "title:string", "body?:string", "target?:any"];
  if (method.parameters.length !== expectedParameters.length || method.parameters.some((parameter, index) =>
    compactAstText(sourceFile, parameter) !== expectedParameters[index])) failures.push("method-parameters");
  const statements = [...method.body.statements];
  if (statements.length !== 9) failures.push("statement-count");
  const gates = statements.filter((statement) =>
    ts.isIfStatement(statement) && compactAstText(sourceFile, statement.expression) === "effectKey");
  if (gates.length !== 1) return ["effect-key-gate-count"];
  const gate = gates[0];
  const gateIndex = statements.indexOf(gate);
  const prelude = statements.slice(0, gateIndex);
  const [dataStatement, effectKeyStatement, identityStatement, normalizedTargetStatement] = prelude;
  const effectKeyDeclaration = ts.isVariableStatement(effectKeyStatement) &&
    effectKeyStatement.declarationList.declarations.length === 1
    ? effectKeyStatement.declarationList.declarations[0]
    : null;
  if (prelude.length !== 4 || compactAstText(sourceFile, dataStatement) !== "constdata=this.read();" ||
    !effectKeyDeclaration || !ts.isIdentifier(effectKeyDeclaration.name) ||
    effectKeyDeclaration.name.text !== "effectKey" || !effectKeyDeclaration.initializer ||
    !(effectKeyStatement.declarationList.flags & ts.NodeFlags.Const) ||
    !isTrimmedEffectKeyInitializer(ts, effectKeyDeclaration.initializer) ||
    compactAstText(sourceFile, identityStatement) !==
      'constidentity=this.resolveTargetIdentity(data,target||{},"notification target");' ||
    compactAstText(sourceFile, normalizedTargetStatement) !==
      "constnormalizedTarget={...(target||{}),...identity.identityFields,identityBinding:identity.binding,};") {
    failures.push("pre-effect-key-gate-shape");
  }
  if (!ts.isBlock(gate.thenStatement) || gate.thenStatement.statements.length !== 2) {
    failures.push("effect-key-gate-body-shape");
  } else {
    const [existingDeclaration, existingGate] = gate.thenStatement.statements;
    const declaration = ts.isVariableStatement(existingDeclaration)
      ? existingDeclaration.declarationList.declarations[0]
      : null;
    if (!declaration || declaration.name.getText(sourceFile) !== "existing" ||
      !declaration.initializer || !ts.isCallExpression(declaration.initializer) ||
      compactAstText(sourceFile, declaration.initializer) !==
        'data.notifications.find((notification)=>String(notification?.target?.effectKey||"")===effectKey)') {
      failures.push("existing-notification-lookup-shape");
    }
    const returned = ts.isIfStatement(existingGate) && ts.isReturnStatement(existingGate.thenStatement)
      ? existingGate.thenStatement
      : null;
    if (!returned?.expression ||
      compactAstText(sourceFile, existingGate.expression) !== "existing" ||
      !exactCallExpression(ts, sourceFile, returned.expression, "assertNotificationEffectReplay",
        ["existing", "{level,title,body,target:normalizedTarget}"])) {
      failures.push("existing-notification-replay-shape");
    }
  }
  const [recordStatement, pushStatement, writeStatement, returnStatement] = statements.slice(gateIndex + 1);
  const recordDeclaration = ts.isVariableStatement(recordStatement) &&
    recordStatement.declarationList.declarations.length === 1
    ? recordStatement.declarationList.declarations[0]
    : null;
  const record = recordDeclaration?.initializer && ts.isObjectLiteralExpression(recordDeclaration.initializer)
    ? recordDeclaration.initializer
    : null;
  if (!recordDeclaration || !ts.isIdentifier(recordDeclaration.name) || recordDeclaration.name.text !== "record" ||
    !record || compactAstText(sourceFile, record) !==
      '{id:effectKey?deterministicOperationId("notice",effectKey):id("notice"),level,title,body,target:normalizedTarget,readAt:null,createdAt:newDate().toISOString(),}') {
    failures.push("notification-record-shape");
  }
  if (!ts.isExpressionStatement(pushStatement) ||
    !exactCallExpression(ts, sourceFile, pushStatement.expression, "data.notifications.push", ["record"])) {
    failures.push("notification-record-push-shape");
  }
  if (!ts.isExpressionStatement(writeStatement) ||
    !exactCallExpression(ts, sourceFile, writeStatement.expression, "this.write", ["data"])) {
    failures.push("notification-write-shape");
  }
  if (!ts.isReturnStatement(returnStatement) || !returnStatement.expression ||
    compactAstText(sourceFile, returnStatement.expression) !== "record") failures.push("notification-return-shape");
  const calls = astNodes(ts, method.body, ts.isCallExpression);
  const countCall = (callee) => calls.filter((call) => compactAstText(sourceFile, call.expression) === callee).length;
  if (countCall("data.notifications.find") !== 1) failures.push("notification-find-call-count");
  if (countCall("assertNotificationEffectReplay") !== 1) failures.push("notification-replay-call-count");
  if (countCall("deterministicOperationId") !== 1 || countCall("id") !== 1 ||
    countCall("data.notifications.push") !== 1 || countCall("this.write") !== 1) {
    failures.push("notification-create-call-count");
  }
  return failures;
}

function prismaNotificationDispatchAstFailures(ts, sourceFile, method) {
  const failures = [];
  if ((ts.getModifiers(method) || []).length || method.asteriskToken || method.questionToken ||
    method.exclamationToken || method.typeParameters?.length || decoratorsOfNode(ts, method).length) {
    failures.push("method-modifiers");
  }
  const expectedParameters = [
    "level:string",
    "title:string",
    "body?:string",
    "target?:Record<string,unknown>",
  ];
  if (method.parameters.length !== expectedParameters.length || method.parameters.some((parameter, index) =>
    compactAstText(sourceFile, parameter) !== expectedParameters[index])) failures.push("method-parameters");
  const statements = [...method.body.statements];
  if (statements.length !== 4) failures.push("statement-count");
  const [localDispatch, effectKeyDeclaration, effectKeyDispatch, prismaFallback] = statements;
  const localReturn = ts.isIfStatement(localDispatch) && ts.isReturnStatement(localDispatch.thenStatement)
    ? localDispatch.thenStatement
    : null;
  if (!localReturn?.expression ||
    compactAstText(sourceFile, localDispatch.expression) !== "appConfig.useLocalStore" ||
    !exactCallExpression(ts, sourceFile, localReturn.expression, "this.localStore.createNotification",
      ["level", "title", "body", "target"])) {
    failures.push("local-dispatch-shape");
  }
  const effectDeclaration = ts.isVariableStatement(effectKeyDeclaration)
    ? effectKeyDeclaration.declarationList.declarations[0]
    : null;
  if (!effectDeclaration || effectKeyDeclaration.declarationList.declarations.length !== 1 ||
    !(effectKeyDeclaration.declarationList.flags & ts.NodeFlags.Const) ||
    !ts.isIdentifier(effectDeclaration.name) || effectDeclaration.name.text !== "effectKey" ||
    !effectDeclaration.initializer || !isTrimmedEffectKeyInitializer(ts, effectDeclaration.initializer)) {
    failures.push("effect-key-declaration-shape");
  }
  const effectReturn = ts.isIfStatement(effectKeyDispatch) && ts.isReturnStatement(effectKeyDispatch.thenStatement)
    ? effectKeyDispatch.thenStatement
    : null;
  if (!effectReturn?.expression ||
    compactAstText(sourceFile, effectKeyDispatch.expression) !== "effectKey" ||
    !exactCallExpression(ts, sourceFile, effectReturn.expression, "this.createPrismaNotificationOnce",
      ["effectKey", "level", "title", "body", "target"])) {
    failures.push("effect-key-dispatch-shape");
  }
  if (!ts.isReturnStatement(prismaFallback) || !prismaFallback.expression ||
    !exactCallExpression(ts, sourceFile, prismaFallback.expression, "this.prisma.notification.create",
      ["{data:{level,title,body,target:(target||{})asany,},}"])) {
    failures.push("prisma-fallback-shape");
  }
  const calls = astNodes(ts, method.body, ts.isCallExpression);
  const countCall = (callee) => calls.filter((call) => compactAstText(sourceFile, call.expression) === callee).length;
  if (countCall("this.createPrismaNotificationOnce") !== 1) failures.push("prisma-helper-call-count");
  if (countCall("this.prisma.notification.create") !== 1) failures.push("prisma-create-call-count");
  return failures;
}

function localStoreLockAstFailures(ts, sourceFile, statement) {
  const failures = [];
  if ((ts.getModifiers(statement) || []).length || statement.asteriskToken || statement.typeParameters?.length ||
    decoratorsOfNode(ts, statement).length) {
    failures.push("function-modifiers");
  }
  const bodyStatements = [...statement.body.statements];
  if (bodyStatements.length !== 3 || !ts.isReturnStatement(bodyStatements[2]) ||
    !bodyStatements[2].expression || !ts.isObjectLiteralExpression(bodyStatements[2].expression)) {
    return ["function-body-shape"];
  }
  if (compactAstText(sourceFile, bodyStatements[0]) !== "letreleased=false;" ||
    compactAstText(sourceFile, bodyStatements[1]) !== "constownerPath=path.join(lockPath,ownerFileName);") {
    failures.push("function-prelude-shape");
  }
  const returnedHandle = bodyStatements[2].expression;
  const properties = [...returnedHandle.properties];
  if (properties.length !== 2 || properties.some((item) => !ts.isPropertyAssignment(item) ||
    !ts.isIdentifier(item.name)) || properties[0].name.text !== "assertOwned" || properties[1].name.text !== "release") {
    return ["handle-property-shape"];
  }
  const property = (name) => properties.filter((item) => item.name.text === name);
  const assertOwnedProperties = property("assertOwned");
  const releaseProperties = property("release");
  if (assertOwnedProperties.length !== 1 || releaseProperties.length !== 1) return ["handle-property-count"];
  const assertOwned = assertOwnedProperties[0].initializer;
  const release = releaseProperties[0].initializer;
  if (!ts.isArrowFunction(assertOwned) || assertOwned.parameters.length || assertOwned.typeParameters?.length ||
    assertOwned.type || (ts.getModifiers(assertOwned) || []).length || !ts.isBlock(assertOwned.body) ||
    assertOwned.body.statements.length !== 1) {
    failures.push("assert-owned-body-shape");
  } else {
    const fence = assertOwned.body.statements[0];
    const throwStatement = ts.isIfStatement(fence) && ts.isBlock(fence.thenStatement) && fence.thenStatement.statements.length === 1
      ? fence.thenStatement.statements[0]
      : null;
    if (!ts.isIfStatement(fence) || compactAstText(sourceFile, fence.expression) !== "released||!fs.existsSync(ownerPath)" ||
      !throwStatement || !ts.isThrowStatement(throwStatement) || !throwStatement.expression ||
      !ts.isNewExpression(throwStatement.expression) ||
      compactAstText(sourceFile, throwStatement.expression.expression) !== "LocalStoreConcurrentWriteError") {
      failures.push("assert-owned-fence-shape");
    }
  }
  if (!ts.isArrowFunction(release) || release.parameters.length || release.typeParameters?.length || release.type ||
    (ts.getModifiers(release) || []).length || !ts.isBlock(release.body) || release.body.statements.length !== 4) {
    failures.push("release-body-shape");
    return failures;
  }
  const [alreadyReleased, markReleased, unlinkTry, rmdirTry] = release.body.statements;
  const initialReturn = ts.isIfStatement(alreadyReleased) && ts.isReturnStatement(alreadyReleased.thenStatement)
    ? alreadyReleased.thenStatement
    : null;
  if (!initialReturn || compactAstText(sourceFile, alreadyReleased.expression) !== "released") {
    failures.push("release-idempotency-shape");
  }
  if (!ts.isExpressionStatement(markReleased) || compactAstText(sourceFile, markReleased.expression) !== "released=true") {
    failures.push("release-mark-shape");
  }
  const cleanupTryMatches = (statement, callName, argumentName, catchCondition) => {
    if (!ts.isTryStatement(statement) || statement.finallyBlock || !statement.catchClause ||
      statement.tryBlock.statements.length !== 1 || statement.catchClause.block.statements.length !== 2 ||
      compactAstText(sourceFile, statement.catchClause.variableDeclaration) !== "error:any") return false;
    const operation = statement.tryBlock.statements[0];
    const call = ts.isExpressionStatement(operation) && ts.isCallExpression(operation.expression)
      ? operation.expression
      : null;
    const [catchGate, catchThrow] = statement.catchClause.block.statements;
    return Boolean(call) && compactAstText(sourceFile, call.expression) === callName && call.arguments.length === 1 &&
      compactAstText(sourceFile, call.arguments[0]) === argumentName && ts.isIfStatement(catchGate) &&
      ts.isReturnStatement(catchGate.thenStatement) && compactAstText(sourceFile, catchGate.expression) === catchCondition &&
      ts.isThrowStatement(catchThrow) && compactAstText(sourceFile, catchThrow.expression) === "error";
  };
  if (!cleanupTryMatches(unlinkTry, "fs.unlinkSync", "ownerPath", 'error?.code==="ENOENT"')) {
    failures.push("release-unlink-try-shape");
  }
  if (!cleanupTryMatches(
    rmdirTry,
    "fs.rmdirSync",
    "lockPath",
    '["ENOENT","ENOTEMPTY","EEXIST"].includes(String(error?.code||""))',
  )) failures.push("release-rmdir-try-shape");
  const calls = astNodes(ts, release.body, ts.isCallExpression);
  const unlinkCalls = calls.filter((call) => compactAstText(sourceFile, call.expression) === "fs.unlinkSync" &&
    call.arguments.length === 1 && compactAstText(sourceFile, call.arguments[0]) === "ownerPath");
  const rmdirCalls = calls.filter((call) => compactAstText(sourceFile, call.expression) === "fs.rmdirSync" &&
    call.arguments.length === 1 && compactAstText(sourceFile, call.arguments[0]) === "lockPath");
  if (unlinkCalls.length !== 1 || rmdirCalls.length !== 1) failures.push("release-call-count");
  else {
    const isDirectReleaseOperation = (call) => {
      const operation = call.parent;
      if (!ts.isExpressionStatement(operation) || operation.expression !== call) return false;
      if (operation.parent === release.body) return true;
      const tryBlock = operation.parent;
      return ts.isBlock(tryBlock) && ts.isTryStatement(tryBlock.parent) &&
        tryBlock.parent.tryBlock === tryBlock && tryBlock.parent.parent === release.body;
    };
    if (!isDirectReleaseOperation(unlinkCalls[0]) || !isDirectReleaseOperation(rmdirCalls[0])) {
      failures.push("release-call-placement");
    }
    if (unlinkCalls[0].getStart(sourceFile) >= rmdirCalls[0].getStart(sourceFile)) failures.push("release-call-order");
  }
  for (const returned of astNodes(ts, release.body, ts.isReturnStatement)) {
    if (returned === initialReturn) continue;
    let ancestor = returned.parent;
    while (ancestor && ancestor !== release.body && !ts.isCatchClause(ancestor)) ancestor = ancestor.parent;
    if (!ancestor || ancestor === release.body) failures.push("release-untrusted-early-return");
  }
  return failures;
}

const CRITICAL_AST_SECTION_IDS = new Set([
  "local-notification-effect-replay",
  "notification-effect-dispatch",
  "local-store-lock-owner-fence",
  "local-store-lock-release",
]);

function criticalSectionAstInspection(sectionId, text) {
  const { ts, sourceFile } = parseTypeScriptForAudit(text, `${sectionId}.audit.ts`, true);
  if (sectionId === "local-notification-effect-replay" || sectionId === "notification-effect-dispatch") {
    const isLocal = sectionId === "local-notification-effect-replay";
    const className = isLocal ? "LocalStoreService" : "NotificationsService";
    const methodName = isLocal ? "createNotification" : "create";
    const classes = astNodes(ts, sourceFile, (node) => ts.isClassDeclaration(node) &&
      ts.isIdentifier(node.name) && node.name.text === className);
    if (classes.length !== 1) return { range: null, failures: ["target-class-count"] };
    const targetClass = classes[0];
    const methods = targetClass.members.filter((node) => ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) && node.name.text === methodName && node.body);
    if (methods.length !== 1) return { range: null, failures: ["method-count"] };
    const failures = isLocal
      ? localNotificationAstFailures(ts, sourceFile, methods[0])
      : prismaNotificationDispatchAstFailures(ts, sourceFile, methods[0]);
    failures.push(...criticalClassSymbolFailures(
      ts,
      sourceFile,
      targetClass,
      className,
      isLocal ? ["createNotification"] : ["create", "createPrismaNotificationOnce"],
    ));
    return { range: { start: methods[0].getStart(sourceFile), end: methods[0].end }, failures };
  }
  const functions = sourceFile.statements.filter((statement) => ts.isFunctionDeclaration(statement) &&
    statement.name?.text === "ownedLocalStoreLockHandle" && statement.body);
  if (functions.length !== 1) return { range: null, failures: ["function-count"] };
  const statement = functions[0];
  const failures = localStoreLockAstFailures(ts, sourceFile, statement);
  failures.push(...ownedLockSymbolFailures(ts, sourceFile, statement));
  if (sectionId === "local-store-lock-release") {
    const releaseProperties = astNodes(ts, statement, (node) => ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) && node.name.text === "release");
    if (releaseProperties.length !== 1) return { range: null, failures: [...failures, "release-property-count"] };
    return {
      range: { start: releaseProperties[0].getStart(sourceFile), end: releaseProperties[0].end },
      failures,
    };
  }
  return { range: { start: statement.getStart(sourceFile), end: statement.end }, failures };
}

function extractLegacyBalancedBlockRange(text, startPattern) {
  const match = startPattern.exec(text);
  if (!match) return null;
  const open = text.indexOf("{", match.index + match[0].length);
  if (open < 0) return null;
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return { start: match.index, end: index + 1 };
    }
  }
  return null;
}

function extractBalancedBlock(text, startPattern) {
  const range = extractLegacyBalancedBlockRange(text, startPattern);
  return range ? text.slice(range.start, range.end) : null;
}

function extractRouteSection(text, routePattern) {
  const match = routePattern.exec(text);
  if (!match) return null;
  const rest = text.slice(match.index + match[0].length);
  const next = /\n\s+@(?:Get|Post|Put|Patch|Delete)\(/.exec(rest);
  return text.slice(match.index, next ? match.index + match[0].length + next.index : text.length);
}

function patternFailures(text, required = [], forbidden = []) {
  if (text === null) return { missing: ["section-missing"], forbidden: [] };
  return {
    missing: required.map((pattern, index) => (pattern.test(text) ? null : `required-pattern-${index + 1}`)).filter(Boolean),
    forbidden: forbidden.map((pattern, index) => (pattern.test(text) ? `forbidden-pattern-${index + 1}` : null)).filter(Boolean),
  };
}

function ordersControllerAstFailures(text) {
  const failures = [];
  const { ts, sourceFile } = parseTypeScriptForAudit(text, "orders.controller.audit.ts", true);
  const decoratorsOf = (node) => decoratorsOfNode(ts, node);
  const decoratorMatches = (decorator, calleeName, expectedArguments) => {
    if (!ts.isCallExpression(decorator.expression) ||
      !ts.isIdentifier(decorator.expression.expression) ||
      decorator.expression.expression.text !== calleeName ||
      decorator.expression.arguments.length !== expectedArguments.length) return false;
    return expectedArguments.every((expected, index) => {
      const argument = decorator.expression.arguments[index];
      return expected.kind === "string"
        ? ts.isStringLiteral(argument) && argument.text === expected.value
        : ts.isIdentifier(argument) && argument.text === expected.value;
    });
  };
  const decoratorsMatch = (node, expected) => {
    const actual = decoratorsOf(node);
    return actual.length === expected.length && expected.every(([callee, args], index) =>
      decoratorMatches(actual[index], callee, args));
  };
  const stringArgument = (value) => ({ kind: "string", value });
  const identifierArgument = (value) => ({ kind: "identifier", value });
  const postDecorator = (decorator) => ts.isCallExpression(decorator.expression) &&
    ts.isIdentifier(decorator.expression.expression) && decorator.expression.expression.text === "Post";
  const importSpecifications = [
    ...["Body", "Controller", "Get", "Param", "Post", "Query", "UseGuards"]
      .map((name) => ({ name, source: "@nestjs/common", kind: "named", usage: "decorator" })),
    { name: "OrdersService", source: "./orders.service", kind: "named", usage: "type" },
    { name: "ExpectedIdentityPayload", source: "../shared/identity-expectation", kind: "named", usage: "type" },
    ...["OperatorAccessGuard", "RequireOperatorCapability", "TrustedOperator"].map((name) => ({
      name,
      source: "../operator-access/operator-access.guard",
      kind: "named",
      usage: name === "OperatorAccessGuard" ? "guard" : "decorator",
    })),
    { name: "TrustedOperatorPrincipal", source: "../operator-access/operator-access.types", kind: "named", usage: "type" },
  ];
  failures.push(...criticalImportBindingFailures(text, "orders.controller.audit.ts", importSpecifications)
    .map((failure) => `binding-${failure}`));
  if (exactNamedImportFailure(
    text,
    "orders.controller.audit.ts",
    "@nestjs/common",
    ["Body", "Controller", "Get", "Param", "Post", "Query", "UseGuards"],
  )) failures.push("common-import-shape");
  if (exactNamedImportFailure(
    text,
    "orders.controller.audit.ts",
    "../operator-access/operator-access.guard",
    ["OperatorAccessGuard", "RequireOperatorCapability", "TrustedOperator"],
  )) failures.push("operator-access-import-shape");
  const commonImports = sourceFile.statements.filter((statement) =>
    ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === "@nestjs/common");
  const postImports = commonImports.flatMap((statement) => {
    const bindings = statement.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings)
      ? bindings.elements.filter((element) => (element.propertyName || element.name).text === "Post")
      : [];
  });
  if (commonImports.length !== 1 || postImports.length !== 1 || postImports[0].propertyName) {
    failures.push("post-import-shape");
  }
  const classDeclarations = sourceFile.statements.filter(ts.isClassDeclaration);
  const classes = classDeclarations.filter((statement) => statement.name?.text === "OrdersController");
  if (classDeclarations.length !== 1 || classes.length !== 1) return [...failures, "orders-controller-count"];
  const ordersController = classes[0];
  if (sourceFile.statements.length !== 6 ||
    sourceFile.statements.slice(0, 5).some((statement) => !ts.isImportDeclaration(statement)) ||
    sourceFile.statements[5] !== ordersController) failures.push("source-statement-set");
  const classModifiers = ts.getModifiers(ordersController) || [];
  if (classModifiers.length !== 1 || classModifiers[0].kind !== ts.SyntaxKind.ExportKeyword ||
    ordersController.typeParameters?.length || ordersController.heritageClauses?.length) {
    failures.push("orders-controller-shape");
  }
  if (!decoratorsMatch(ordersController, [
    ["Controller", [stringArgument("orders")]],
    ["RequireOperatorCapability", [stringArgument("view_console")]],
    ["UseGuards", [identifierArgument("OperatorAccessGuard")]],
  ])) failures.push("orders-controller-decorators");
  const constructors = ordersController.members.filter(ts.isConstructorDeclaration);
  if (constructors.length !== 1 || constructors[0].parameters.length !== 1 ||
    compactAstText(sourceFile, constructors[0].parameters[0]) !== "privatereadonlyorders:OrdersService" ||
    constructors[0].body?.statements.length !== 0 || decoratorsOf(constructors[0]).length) {
    failures.push("orders-constructor-shape");
  }
  const expectedMethods = [
    ["list", [["Get", []]]],
    ["confirmationPreview", [["Get", [stringArgument(":id/confirmation-preview")]]]],
    ["createFromQuote", [
      ["Post", [stringArgument("from-quote/:quoteId")]],
      ["RequireOperatorCapability", [stringArgument("manage_design_executions")]],
    ]],
    ["update", [
      ["Post", [stringArgument(":id/update")]],
      ["RequireOperatorCapability", [stringArgument("manage_design_executions")]],
    ]],
    ["reviseSelection", [
      ["Post", [stringArgument(":id/revise-selection")]],
      ["RequireOperatorCapability", [stringArgument("manage_design_executions")]],
    ]],
  ];
  const methods = ordersController.members.filter(ts.isMethodDeclaration);
  if (methods.length !== expectedMethods.length) failures.push("orders-method-set");
  if (ordersController.members.length !== expectedMethods.length + 1 ||
    !ts.isConstructorDeclaration(ordersController.members[0]) ||
    ordersController.members.slice(1).some((member) => !ts.isMethodDeclaration(member))) {
    failures.push("orders-member-set");
  }
  for (const [index, [expectedName, expectedDecorators]] of expectedMethods.entries()) {
    const method = methods[index];
    if (!method || !ts.isIdentifier(method.name) || method.name.text !== expectedName ||
      !decoratorsMatch(method, expectedDecorators) || method.questionToken || method.exclamationToken ||
      method.asteriskToken || method.typeParameters?.length || (ts.getModifiers(method) || []).length) {
      failures.push(`orders-method-${index + 1}-shape`);
    }
  }
  failures.push(...criticalClassSymbolFailures(
    ts,
    sourceFile,
    ordersController,
    "OrdersController",
    expectedMethods.map(([name]) => name),
  ));
  const routes = [];
  for (const member of ordersController.members) {
    for (const decorator of decoratorsOf(member).filter(postDecorator)) {
      const call = decorator.expression;
      routes.push({ member, call, route: call.arguments.length === 1 && ts.isStringLiteral(call.arguments[0]) ? call.arguments[0].text : null });
    }
  }
  const everyPostDecorator = astNodes(ts, sourceFile, (node) => ts.isDecorator(node) && postDecorator(node));
  const expectedRoutes = ["from-quote/:quoteId", ":id/update", ":id/revise-selection"];
  const expectedRouteMethods = new Map([
    ["from-quote/:quoteId", "createFromQuote"],
    [":id/update", "update"],
    [":id/revise-selection", "reviseSelection"],
  ]);
  if (routes.length !== 3 || everyPostDecorator.length !== 3 ||
    expectedRoutes.some((route) => routes.filter((entry) => entry.route === route).length !== 1) ||
    routes.some((entry) => entry.route === null || !ts.isIdentifier(entry.member.name) ||
      expectedRouteMethods.get(entry.route) !== entry.member.name.text)) {
    failures.push("post-route-set");
  }
  const postIdentifiers = astNodes(ts, sourceFile, (node) => ts.isIdentifier(node) && node.text === "Post");
  const validPostIdentifier = (identifier) =>
    ts.isImportSpecifier(identifier.parent) ||
    (ts.isCallExpression(identifier.parent) && identifier.parent.expression === identifier && ts.isDecorator(identifier.parent.parent));
  if (postIdentifiers.length !== 4 || postIdentifiers.some((identifier) => !validPostIdentifier(identifier))) {
    failures.push("post-identifier-usage");
  }
  const updateRoutes = routes.filter((entry) => entry.route === ":id/update");
  if (updateRoutes.length !== 1 || !ts.isMethodDeclaration(updateRoutes[0].member) || !updateRoutes[0].member.body) {
    return [...failures, "update-method-shape"];
  }
  const updateMethod = updateRoutes[0].member;
  const expectedParameters = [
    ["id", "string", [["Param", [stringArgument("id")]]]],
    ["payload", "{status?:string;customerNotes?:string;owner?:string}&ExpectedIdentityPayload", [["Body", []]]],
    ["principal", "TrustedOperatorPrincipal", [["TrustedOperator", []]]],
  ];
  if (updateMethod.parameters.length !== expectedParameters.length) failures.push("update-parameter-count");
  for (const [index, [name, expectedType, expectedDecorators]] of expectedParameters.entries()) {
    const parameter = updateMethod.parameters[index];
    if (!parameter || !ts.isIdentifier(parameter.name) || parameter.name.text !== name ||
      !parameter.type || compactAstText(sourceFile, parameter.type) !== expectedType ||
      !decoratorsMatch(parameter, expectedDecorators) || parameter.questionToken || parameter.initializer ||
      parameter.dotDotDotToken || (ts.getModifiers(parameter) || []).length) {
      failures.push(`update-parameter-${index + 1}-shape`);
    }
  }
  if (updateMethod.body.statements.length !== 1 || !ts.isReturnStatement(updateMethod.body.statements[0])) {
    return [...failures, "update-body-statement-count"];
  }
  const returned = updateMethod.body.statements[0];
  if (!returned.expression || !ts.isCallExpression(returned.expression) ||
    compactAstText(sourceFile, returned.expression.expression) !== "this.orders.update" ||
    returned.expression.arguments.length !== 2 || compactAstText(sourceFile, returned.expression.arguments[0]) !== "id" ||
    !ts.isObjectLiteralExpression(returned.expression.arguments[1])) {
    return [...failures, "update-return-call-shape"];
  }
  const projection = returned.expression.arguments[1];
  const expectedProjection = [
    ["status", "payload?.status"],
    ["customerNotes", "payload?.customerNotes"],
    ["expectedWechatAccountId", "payload?.expectedWechatAccountId"],
    ["expectedConversationId", "payload?.expectedConversationId"],
    ["expectedCustomerId", "payload?.expectedCustomerId"],
    ["owner", "principal.id"],
  ];
  if (projection.properties.length !== expectedProjection.length) failures.push("update-projection-count");
  for (const [index, [name, value]] of expectedProjection.entries()) {
    const property = projection.properties[index];
    if (!property || !ts.isPropertyAssignment(property) || property.name.getText(sourceFile) !== name ||
      compactAstText(sourceFile, property.initializer) !== value) {
      failures.push(`update-projection-${index + 1}-shape`);
    }
  }
  const reviseRoutes = routes.filter((entry) => entry.route === ":id/revise-selection");
  if (reviseRoutes.length !== 1 || !ts.isMethodDeclaration(reviseRoutes[0].member) ||
    !reviseRoutes[0].member.body) return [...failures, "revise-selection-method-shape"];
  const reviseMethod = reviseRoutes[0].member;
  const expectedReviseParameters = [
    ["id", "string", [["Param", [stringArgument("id")]]]],
    ["payload", "{selectedImageId?:string;owner?:string;note?:string}&ExpectedIdentityPayload", [["Body", []]]],
    ["principal", "TrustedOperatorPrincipal", [["TrustedOperator", []]]],
  ];
  if (reviseMethod.parameters.length !== expectedReviseParameters.length) {
    failures.push("revise-selection-parameter-count");
  }
  for (const [index, [name, expectedType, expectedDecorators]] of expectedReviseParameters.entries()) {
    const parameter = reviseMethod.parameters[index];
    if (!parameter || !ts.isIdentifier(parameter.name) || parameter.name.text !== name ||
      !parameter.type || compactAstText(sourceFile, parameter.type) !== expectedType ||
      !decoratorsMatch(parameter, expectedDecorators) || parameter.questionToken || parameter.initializer ||
      parameter.dotDotDotToken || (ts.getModifiers(parameter) || []).length) {
      failures.push(`revise-selection-parameter-${index + 1}-shape`);
    }
  }
  if (reviseMethod.body.statements.length !== 2 ||
    compactAstText(sourceFile, reviseMethod.body.statements[0]) !==
      "const{owner:_untrustedOwner,actor:_untrustedActor,operator:_untrustedOperator,reviewer:_untrustedReviewer,...trustedPayload}=(payload||{})astypeofpayload&{actor?:unknown;operator?:unknown;reviewer?:unknown};") {
    failures.push("revise-selection-trusted-payload-shape");
  }
  const reviseReturn = reviseMethod.body.statements[1];
  if (!ts.isReturnStatement(reviseReturn) || !reviseReturn.expression ||
    !exactCallExpression(ts, sourceFile, reviseReturn.expression, "this.orders.reviseSelectedImage",
      ["id", "{...trustedPayload,owner:principal.id}"])) {
    failures.push("revise-selection-return-shape");
  }
  return failures;
}

function highRiskOperatorRouteResults(root) {
  const paths = {
    agents: "desktop/apps/api/src/agents/agents.controller.ts",
    aiProviders: "desktop/apps/api/src/ai/ai-provider.controller.ts",
    assets: "desktop/apps/api/src/assets/assets.controller.ts",
    catalog: "desktop/apps/api/src/catalog/catalog.controller.ts",
    conversationOperations: "desktop/apps/api/src/conversation-ops/conversation-operations.controller.ts",
    notifications: "desktop/apps/api/src/notifications/notifications.controller.ts",
    orders: "desktop/apps/api/src/orders/orders.controller.ts",
    wechat: "desktop/apps/api/src/wechat/wechat.controller.ts",
    wechatWork: "desktop/apps/api/src/wechat-work/wechat-work.controller.ts",
    personalWechat: "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.controller.ts",
    reviews: "desktop/apps/api/src/reviews/reviews.controller.ts",
    quotes: "desktop/apps/api/src/quotes/quotes.controller.ts",
    routing: "desktop/apps/api/src/routing/routing.controller.ts",
    automation: "desktop/apps/api/src/automation/automation.controller.ts",
    training: "desktop/apps/api/src/training/training.controller.ts",
  };
  const rawSources = Object.fromEntries(
    Object.entries(paths).map(([key, file]) => [key, readText(root, file) || ""]),
  );
  const sourceMaskFailures = [];
  const sources = Object.fromEntries(
    Object.entries(paths).map(([key, file]) => {
      try {
        return [key, maskTypeScriptForDecoratorAudit(rawSources[key])];
      } catch (_error) {
        sourceMaskFailures.push({ key, file });
        return [key, ""];
      }
    }),
  );
  const missing = sourceMaskFailures.map(({ key }) => `${key}-invalid-typescript-lexical-structure`);
  const forbidden = [];
  const issues = sourceMaskFailures.map(({ key, file }) => ({
    label: `${key}-lexical-structure`,
    path: file,
    missing: ["invalid-typescript-lexical-structure"],
    forbidden: [],
  }));
  try {
    const astFailures = ordersControllerAstFailures(rawSources.orders);
    missing.push(...astFailures.map((failure) => `orders-ast-${failure}`));
    if (astFailures.length) {
      issues.push({ label: "orders-ast", path: paths.orders, missing: astFailures, forbidden: [] });
    }
  } catch (_error) {
    missing.push("orders-ast-parse-failed");
    issues.push({ label: "orders-ast", path: paths.orders, missing: ["parse-failed"], forbidden: [] });
  }
  const sourcePath = (text) => {
    const key = Object.keys(sources).find((candidate) => sources[candidate] === text);
    return key ? paths[key] : null;
  };

  const check = (label, text, routePattern, requiredPatterns, forbiddenPatterns = []) => {
    const section = extractRouteSection(text, routePattern);
    const failures = patternFailures(section, requiredPatterns, forbiddenPatterns);
    missing.push(...failures.missing.map((item) => `${label}-${item}`));
    forbidden.push(...failures.forbidden.map((item) => `${label}-${item}`));
    if (failures.missing.length || failures.forbidden.length) {
      issues.push({ label, path: sourcePath(text), missing: failures.missing, forbidden: failures.forbidden });
    }
    return section;
  };
  const checkClass = (label, text, requiredPatterns) => {
    const classIndex = text.indexOf("export class");
    const header = classIndex >= 0 ? text.slice(0, classIndex) : null;
    const failures = patternFailures(header, requiredPatterns);
    missing.push(...failures.missing.map((item) => `${label}-${item}`));
    if (failures.missing.length) {
      issues.push({ label, path: sourcePath(text), missing: failures.missing, forbidden: [] });
    }
  };

  for (const [label, sourceKey] of [
    ["agents-class", "agents"],
    ["ai-providers-class", "aiProviders"],
    ["assets-class", "assets"],
    ["catalog-class", "catalog"],
    ["notifications-class", "notifications"],
    ["quotes-class", "quotes"],
    ["routing-class", "routing"],
    ["conversation-operations-class", "conversationOperations"],
  ]) {
    checkClass(label, sources[sourceKey], [
      /@RequireOperatorCapability\(["']view_console["']\)/,
      /@UseGuards\(OperatorAccessGuard\)/,
    ]);
  }

  for (const [label, sourceKey, routePattern, capability] of [
    ["assets-upload", "assets", /@Post\(["']upload["']\)/, "manage_design_executions"],
    ["assets-demo-logo", "assets", /@Post\(["']demo-customer-logo["']\)/, "manage_design_executions"],
    ["catalog-demo-images", "catalog", /@Post\(["']skus\/demo-images["']\)/, "manage_design_executions"],
    ["catalog-upsert", "catalog", /@Post\(["']skus["']\)/, "manage_design_executions"],
    ["catalog-batch", "catalog", /@Post\(["']skus\/batch-update["']\)/, "manage_design_executions"],
    ["catalog-deactivate", "catalog", /@Post\(["']skus\/:skuCode\/deactivate["']\)/, "manage_design_executions"],
    ["catalog-restore", "catalog", /@Post\(["']skus\/:skuCode\/restore["']\)/, "manage_design_executions"],
    ["catalog-bulk", "catalog", /@Post\(["']skus\/bulk["']\)/, "manage_design_executions"],
    ["catalog-import-text", "catalog", /@Post\(["']skus\/import-text["']\)/, "manage_design_executions"],
    ["catalog-import-file", "catalog", /@Post\(["']skus\/import-file["']\)/, "manage_design_executions"],
    ["notifications-demo", "notifications", /@Post\(["']demo["']\)/, "manage_training"],
    ["quotes-update", "quotes", /@Post\(["']:id\/update["']\)/, "manage_design_executions"],
    ["quotes-revise", "quotes", /@Post\(["']:id\/revise-selection["']\)/, "manage_design_executions"],
  ]) {
    check(label, sources[sourceKey], routePattern, [
      new RegExp(`@RequireOperatorCapability\\(["']${capability}["']\\)`),
    ]);
  }
  for (const [label, sourceKey, routePattern] of [
    ["quotes-update-trusted", "quotes", /@Post\(["']:id\/update["']\)/],
    ["quotes-revise-trusted", "quotes", /@Post\(["']:id\/revise-selection["']\)/],
  ]) {
    check(label, sources[sourceKey], routePattern, [
      /@TrustedOperator\(\) principal/,
      /owner:\s*_untrustedOwner/,
      /owner:\s*principal\.id/,
    ]);
  }
  check("routing-evaluate", sources.routing, /@Post\(["']evaluate["']\)/, [
    /@RequireOperatorCapability\(["']manage_training["']\)/,
  ]);
  check("routing-correction", sources.routing, /@Post\(["']evaluations\/:id\/correct["']\)/, [
    /@RequireOperatorCapability\(["']manage_training["']\)/,
    /@TrustedOperator\(\) principal/,
    /reviewer:\s*_untrustedReviewer/,
    /reviewer:\s*principal\.id/,
  ]);

  check("wechat-inbound", sources.wechat, /@Post\(["']inbound\/messages["']\)/, [
    /@RequireOperatorCapability\(["']approve_send["']\)/,
    /@UseGuards\(OperatorAccessGuard\)/,
    /@TrustedOperator\(\) _principal/,
  ]);
  for (const [label, routePattern] of [
    ["wechat-accounts-read", /@Get\(["']accounts["']\)/],
    ["wechat-conversations-read", /@Get\(["']conversations["']\)/],
    ["wechat-timeline-read", /@Get\(["']conversations\/:id\/messages["']\)/],
    ["wechat-mark-read", /@Post\(["']conversations\/:id\/read["']\)/],
    ["wechat-send-tasks-read", /@Get\(["']send-tasks["']\)/],
    ["wechat-send-attempts-read", /@Get\(["']send-attempts["']\)/],
    ["wechat-send-adapter-read", /@Get\(["']send-adapter["']\)/],
    ["wechat-channel-status-read", /@Get\(["']channels\/status["']\)/],
  ]) {
    check(label, sources.wechat, routePattern, [
      /@RequireOperatorCapability\(["']view_console["']\)/,
      /@UseGuards\(OperatorAccessGuard\)/,
    ]);
  }
  for (const [label, routePattern] of [
    ["wechat-bridge-outbox", /@Get\(["']bridge\/outbox["']\)/],
    ["wechat-bridge-dispatch", /@Get\(["']bridge\/dispatch["']\)/],
    ["wechat-bridge-status", /@Get\(["']bridge\/status["']\)/],
    ["wechat-bridge-inbox-scan", /@Post\(["']bridge\/inbox\/scan["']\)/],
  ]) {
    check(label, sources.wechat, routePattern, [
      /@RequireOperatorCapability\(["']view_console["']\)/,
      /@UseGuards\(WechatBridgeAccessGuard\)/,
    ]);
  }
  for (const [label, routePattern] of [
    ["wechat-window-snapshots", /@Get\(["']window-snapshots["']\)/],
    ["wechat-window-observer-status", /@Get\(["']window-observer\/status["']\)/],
    ["wechat-window-inbox-scan", /@Post\(["']window-snapshots\/inbox\/scan["']\)/],
  ]) {
    check(label, sources.wechat, routePattern, [
      /@RequireOperatorCapability\(["']view_console["']\)/,
      /@UseGuards\(WechatWindowObserverAccessGuard\)/,
    ]);
  }
  check("wechat-bridge-ack-dedicated", sources.wechat, /@Post\(["']send-tasks\/:id\/bridge-ack["']\)/, [], [
    /@RequireOperatorCapability\(/,
    /@UseGuards\((?:OperatorAccessGuard|WechatBridgeAccessGuard|WechatWindowObserverAccessGuard)\)/,
  ]);

  check("wechat-work-sync", sources.wechatWork, /@Post\(["']kf\/sync["']\)/, [
    /@RequireOperatorCapability\(["']manage_channels["']\)/,
    /@UseGuards\(OperatorAccessGuard\)/,
  ]);
  for (const [label, routePattern] of [
    ["wechat-work-send-text", /@Post\(["']kf\/send-text["']\)/],
    ["wechat-work-send-images", /@Post\(["']kf\/send-images["']\)/],
    ["wechat-work-dispatch", /@Post\(["']kf\/send-tasks\/:id\/dispatch["']\)/],
  ]) {
    check(label, sources.wechatWork, routePattern, [
      /@RequireOperatorCapability\(["']approve_send["']\)/,
      /@UseGuards\(OperatorAccessGuard\)/,
    ]);
  }
  check("wechat-work-audit", sources.wechatWork, /@Get\(["']kf\/audit["']\)/, [
    /@RequireOperatorCapability\(["']view_console["']\)/,
    /@UseGuards\(OperatorAccessGuard\)/,
  ]);
  for (const [label, routePattern] of [
    ["wechat-work-status", /@Get\(["']status["']\)/],
    ["wechat-work-preflight", /@Get\(["']preflight["']\)/],
  ]) {
    check(label, sources.wechatWork, routePattern, [
      /@RequireOperatorCapability\(["']view_console["']\)/,
      /@UseGuards\(OperatorAccessGuard\)/,
    ]);
  }
  for (const [label, routePattern] of [
    ["wechat-work-verify-callback-public", /@Get\(["']callback["']\)/],
    ["wechat-work-callback-public", /@Post\(["']callback["']\)/],
  ]) {
    check(label, sources.wechatWork, routePattern, [], [
      /@RequireOperatorCapability\(/,
      /@UseGuards\(OperatorAccessGuard\)/,
      /@TrustedOperator\(\)/,
    ]);
  }
  check("personal-wechat-instances", sources.personalWechat, /@Get\(["']instances["']\)/, [
    /@RequireOperatorCapability\(["']view_console["']\)/,
    /@UseGuards\(OperatorAccessGuard\)/,
  ]);
  for (const [label, routePattern] of [
    ["personal-wechat-validate", /@Post\(["']instances\/validate["']\)/],
    ["personal-wechat-upsert", /@Post\(["']instances["']\)/],
    ["personal-wechat-disable", /@Post\(["']instances\/:wechatAccountId\/disable["']\)/],
  ]) {
    check(label, sources.personalWechat, routePattern, [
      /@RequireOperatorCapability\(["']manage_channels["']\)/,
      /@UseGuards\(OperatorAccessGuard\)/,
    ]);
  }

  checkClass("reviews-class", sources.reviews, [
    /@RequireOperatorCapability\(["']view_console["']\)/,
    /@UseGuards\(OperatorAccessGuard\)/,
  ]);
  for (const [label, routePattern] of [
    ["reviews-design", /@Post\(["']design-jobs\/:id["']\)/],
    ["reviews-quote", /@Post\(["']quotes\/:id["']\)/],
    ["reviews-order", /@Post\(["']orders\/:id["']\)/],
  ]) {
    check(label, sources.reviews, routePattern, [
      /@RequireOperatorCapability\(["']approve_send["']\)/,
      /@TrustedOperator\(\) principal/,
      /reviewer:\s*_untrustedReviewer/,
      /reviewer:\s*principal\.id/,
    ]);
  }

  check("quotes-queue-send", sources.quotes, /@Post\(["']:id\/queue-send["']\)/, [
    /@RequireOperatorCapability\(["']approve_send["']\)/,
    /@UseGuards\(OperatorAccessGuard\)/,
    /@TrustedOperator\(\) principal/,
    /expectedWechatAccountId:\s*payload\?\.expectedWechatAccountId/,
    /expectedConversationId:\s*payload\?\.expectedConversationId/,
    /expectedCustomerId:\s*payload\?\.expectedCustomerId/,
    /owner:\s*principal\.id/,
  ], [/\.\.\.trustedPayload/, /automation:\s*payload(?:\?)?\.automation/]);

  check("quotes-payment-proof", sources.quotes, /@Post\(["']:id\/verify-payment-proof["']\)/, [
    /@RequireOperatorCapability\(["']approve_send["']\)/,
    /@UseGuards\(OperatorAccessGuard\)/,
    /@TrustedOperator\(\) principal/,
    /owner:\s*_untrustedOwner/,
    /owner:\s*principal\.id/,
  ]);

  checkClass("automation-class", sources.automation, [
    /@RequireOperatorCapability\(["']view_console["']\)/,
    /@UseGuards\(OperatorAccessGuard\)/,
  ]);
  for (const [label, routePattern] of [
    ["automation-run-once", /@Post\(["']run-once["']\)/],
    ["automation-start", /@Post\(["']start["']\)/],
    ["automation-stop", /@Post\(["']stop["']\)/],
  ]) {
    check(label, sources.automation, routePattern, [/@RequireOperatorCapability\(["']approve_send["']\)/]);
  }

  checkClass("training-class", sources.training, [
    /@RequireOperatorCapability\(["']view_console["']\)/,
    /@UseGuards\(OperatorAccessGuard\)/,
  ]);
  check("training-import", sources.training, /@Post\(["']chat-imports["']\)/, [
    /@RequireOperatorCapability\(["']manage_training["']\)/,
  ]);
  for (const [label, routePattern] of [
    ["training-review", /@Post\(["']samples\/:id\/review["']\)/],
    ["training-batch-review", /@Post\(["']samples\/batch-review["']\)/],
  ]) {
    check(label, sources.training, routePattern, [
      /@RequireOperatorCapability\(["']manage_training["']\)/,
      /@TrustedOperator\(\) principal/,
      /reviewer:\s*_untrustedReviewer/,
      /reviewer:\s*principal\.id/,
    ]);
  }
  check("training-apply", sources.training, /@Post\(["']skill-suggestions\/apply["']\)/, [
    /@RequireOperatorCapability\(["']manage_training["']\)/,
  ]);

  const ok = missing.length === 0 && forbidden.length === 0;
  return [result(
    "contract.high_risk_operator_routes",
    "高风险操作路由与可信审计人边界",
    ok ? STATUS.PASS : STATUS.FAIL,
    ok
      ? "操作员写入、通用微信入站、渠道状态、个人微信实例、发送、人工审核、付款确认、自动化和训练写入均要求匹配能力与可信主体；企业微信 callback 保持签名认证公开入口。"
      : "高风险路由守卫、可信审计人覆盖或企业微信公开入口边界发生漂移。",
    { path: issues[0]?.path || paths.wechatWork, paths: Object.values(paths), missing, forbidden, issues },
  )];
}

function designReconciliationResults(root) {
  const uiPath = "desktop/apps/web/src/components/design-execution-reconciliation-panel.tsx";
  const webApiPath = "desktop/apps/web/src/lib/api.ts";
  const controllerPath = "desktop/apps/api/src/design-jobs/design-jobs.controller.ts";
  const designServicePath = "desktop/apps/api/src/design-jobs/design-jobs.service.ts";
  const executionServicePath = "desktop/apps/api/src/design-jobs/design-platform-execution.service.ts";
  const typesPath = "desktop/apps/api/src/design-jobs/design-jobs.types.ts";
  const ui = readText(root, uiPath);
  const webApi = readText(root, webApiPath) || "";
  const controller = readText(root, controllerPath) || "";
  const designService = readText(root, designServicePath) || "";
  const executionService = readText(root, executionServicePath) || "";
  const types = readText(root, typesPath) || "";

  const resolutionConstants = /export const DESIGN_EXECUTION_RESOLUTIONS\s*=\s*\{[\s\S]*?\}\s*as const/.exec(ui || "")?.[0] || null;
  const pendingGuard = extractBalancedBlock(ui, /export function getDesignExecutionResolutionBlockedReason\s*\([^)]*\)\s*/);
  const component = extractBalancedBlock(ui, /export function DesignExecutionReconciliationPanel\s*\([^)]*\)\s*/);
  const confirmResolution = extractBalancedBlock(ui, /async function confirmResolution\s*\([^)]*\)\s*/);
  const resolutionActionBlock = extractBalancedBlock(ui, /function resolutionAction\s*\([^)]*\)\s*/);
  const unknownClient = extractBalancedBlock(webApi, /export async function resolveUnknownDesignExecution\s*\([^)]*\)\s*[^\{]*/);
  const refundClient = extractBalancedBlock(webApi, /export async function resolveDesignExecutionRefund\s*\([^)]*\)\s*[^\{]*/);
  const resolutionRequest = extractBalancedBlock(webApi, /async function postDesignExecutionResolution\s*\([^)]*\)\s*[^\{]*/);

  const resolutionConstantChecks = patternFailures(resolutionConstants, [
    /unknown:\s*["']confirmed_not_generated_refunded["']/,
    /refund:\s*["']confirmed_refunded["']/,
  ]);
  const pendingGuardChecks = patternFailures(pendingGuard, [
    /if \(!pending\) return ["']["']/,
    /if \(loading\) return ["'][^"'\r\n]*[^\s"'][^"'\r\n]*["'];?/,
    /if \(!accessLoaded\) return ["'][^"'\r\n]*[^\s"'][^"'\r\n]*["'];?/,
    /if \(!canManageExecutions\) return ["'][^"'\r\n]*[^\s"'][^"'\r\n]*["'];?/,
    /executions\.find\(\(execution\) => execution\.id === pending\.executionId\)/,
    /if \(!currentExecution\s*\|\|\s*currentExecution\.availableResolution !== pending\.resolution\)\s*\{\s*return ["'][^"'\r\n]*[^\s"'][^"'\r\n]*["'];?\s*\}/,
  ]);
  const componentChecks = patternFailures(component, [
    /getDesignExecutionResolutionBlockedReason\(\{\s*pending,\s*executions,\s*loading,\s*accessLoaded,\s*canManageExecutions,\s*\}\)/,
    /resolutionAction\(execution\.availableResolution\)/,
    /disabled=\{loading\s*\|\|\s*!accessLoaded\s*\|\|\s*!canManageExecutions\s*\|\|\s*Boolean\(submittingId\)\}/,
    /role=["']alertdialog["']/,
    /pendingBlockedReason\s*\?\s*<p[^>]*role=["']alert["']/,
    /disabled=\{Boolean\(submittingId\)\s*\|\|\s*Boolean\(pendingBlockedReason\)\}/,
  ]);
  const confirmChecks = patternFailures(confirmResolution, [
    /if \(!pending\s*\|\|\s*submitLock\.current\s*\|\|\s*submittingId\s*\|\|\s*pendingBlockedReason\) return/,
    /submitLock\.current\s*=\s*true/,
    /resolution\s*===\s*DESIGN_EXECUTION_RESOLUTIONS\.unknown/,
    /resolution\s*===\s*DESIGN_EXECUTION_RESOLUTIONS\.refund/,
    /else\s*\{\s*throw new Error/,
    /await onResolveUnknown\(pending\.executionId\)/,
    /await onResolveRefund\(pending\.executionId\)/,
    /await onRefresh\(\)/,
  ]);
  const resolutionActionChecks = patternFailures(resolutionActionBlock, [
    /resolution\s*===\s*DESIGN_EXECUTION_RESOLUTIONS\.unknown/,
    /resolution\s*===\s*DESIGN_EXECUTION_RESOLUTIONS\.refund/,
    /return null/,
  ]);
  const unknownClientChecks = patternFailures(unknownClient, [
    /\/executions\/\$\{encodeURIComponent\(executionId\)\}\/resolve-unknown/,
    /return postDesignExecutionResolution\([\s\S]*\{\s*\.\.\.expected,\s*resolution:\s*["']confirmed_not_generated_refunded["']\s*\},?\s*\);/,
  ], [
    /\breviewer\b/,
    /\.\.\.(?!expected\b)/,
  ]);
  const refundClientChecks = patternFailures(refundClient, [
    /\/executions\/\$\{encodeURIComponent\(executionId\)\}\/resolve-refund/,
    /return postDesignExecutionResolution\([\s\S]*\{\s*\.\.\.expected,\s*resolution:\s*["']confirmed_refunded["']\s*\},?\s*\);/,
  ], [
    /\breviewer\b/,
    /\.\.\.(?!expected\b)/,
  ]);
  const resolutionRequestChecks = patternFailures(resolutionRequest, [
    /body:\s*JSON\.stringify\(body\)/,
  ], [
    /\breviewer\b/,
    /\.\.\./,
    /\bObject\.(?:assign|defineProperty)\s*\(\s*body\b/,
    /\bbody(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=/,
    /\bbody\s*=(?!=)/,
  ]);
  const uiMissing = [
    ...resolutionConstantChecks.missing.map((item) => `resolution-constants-${item}`),
    ...pendingGuardChecks.missing.map((item) => `pending-guard-${item}`),
    ...componentChecks.missing.map((item) => `component-${item}`),
    ...confirmChecks.missing.map((item) => `confirm-${item}`),
    ...resolutionActionChecks.missing.map((item) => `resolution-action-${item}`),
    ...unknownClientChecks.missing.map((item) => `unknown-client-${item}`),
    ...refundClientChecks.missing.map((item) => `refund-client-${item}`),
    ...resolutionRequestChecks.missing.map((item) => `request-body-${item}`),
  ];
  const uiForbidden = [
    ...unknownClientChecks.forbidden.map((item) => `unknown-client-${item}`),
    ...refundClientChecks.forbidden.map((item) => `refund-client-${item}`),
    ...resolutionRequestChecks.forbidden.map((item) => `request-body-${item}`),
  ];
  const uiOk = uiMissing.length === 0 && uiForbidden.length === 0;

  const viewMatch = /export type DesignPlatformExecutionView\s*=\s*\{([\s\S]*?)\n\};/.exec(types);
  const viewBody = viewMatch?.[1] || null;
  const actualViewFields = viewBody
    ? [...viewBody.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map((match) => match[1])
    : [];
  const missingViewFields = DESIGN_EXECUTION_PUBLIC_VIEW_FIELDS.filter((field) => !actualViewFields.includes(field));
  const unexpectedViewFields = actualViewFields.filter((field) => !DESIGN_EXECUTION_PUBLIC_VIEW_FIELDS.includes(field));
  const publicList = extractBalancedBlock(executionService, /async listPublicForDesignJob\s*\([^)]*\)\s*[^\{]*/);
  const projection = extractBalancedBlock(executionService, /function toPublicExecutionView\s*\([^)]*\)\s*[^\{]*/);
  const refundEligibility = extractBalancedBlock(executionService, /function isUnsafeRefundResolutionEligible\s*\([^)]*\)\s*[^\{]*/);
  const resumableEligibility = extractBalancedBlock(executionService, /function isResumableCompletedExecution\s*\([^)]*\)\s*[^\{]*/);
  const unsafeRefundResolution = extractBalancedBlock(executionService, /async resolveUnsafeRefund\s*\([^)]*\)\s*[^\{]*/);
  const publicListChecks = patternFailures(publicList, [/\.map\(toPublicExecutionView\)/]);
  const projectionChecks = patternFailures(projection, [
    /availableResolution/,
    /confirmed_not_generated_refunded/,
    /confirmed_refunded/,
    /isUnsafeRefundResolutionEligible\(execution\)/,
  ], [
    /\.\.\.\s*execution/,
    /\boperationKey\b/,
    /\brequestId\b/,
    /\bexternalJobId\b/,
    /\bimages\b/,
    /\brefundSummary\b/,
    /\berrorMessage\b/,
  ]);
  const refundEligibilityChecks = patternFailures(refundEligibility, [
    /execution\s*&&\s*\(execution\.status\s*===\s*["']explicit_failed["']\s*\|\|\s*isResumableCompletedExecution\(execution\)\)\s*&&\s*\[["']failed["'],\s*["']unknown["']\]\.includes\(execution\.refundStatus\)/,
  ]);
  const resumableEligibilityChecks = patternFailures(resumableEligibility, [
    /execution\?\.status\s*===\s*["']completed["']\s*&&\s*execution\?\.acceptanceStatus\s*===\s*["']manual_review["']/,
  ]);
  const unsafeRefundResolutionChecks = patternFailures(unsafeRefundResolution, [
    /const resumableCompleted\s*=\s*isResumableCompletedExecution\(execution\)/,
    /if \(!isUnsafeRefundResolutionEligible\(execution\)\)/,
    /resumableCompleted\s*\?\s*\{\s*acceptanceStatus:\s*["']pending["']\s*\}\s*:\s*\{\}/,
    /resolvedAt:\s*resumableCompleted\s*\?\s*null\s*:\s*new Date\(\)/,
  ]);
  const publicViewMissingContracts = [
    ...publicListChecks.missing.map((item) => `list-${item}`),
    ...projectionChecks.missing.map((item) => `projection-${item}`),
    ...refundEligibilityChecks.missing.map((item) => `refund-eligibility-${item}`),
    ...resumableEligibilityChecks.missing.map((item) => `resumable-eligibility-${item}`),
    ...unsafeRefundResolutionChecks.missing.map((item) => `refund-resolution-${item}`),
  ];
  const publicViewOk = Boolean(viewBody)
    && missingViewFields.length === 0
    && unexpectedViewFields.length === 0
    && /type DesignExecutionAvailableResolution\s*=\s*\|?\s*["']confirmed_not_generated_refunded["']\s*\|\s*["']confirmed_refunded["']\s*\|\s*null/.test(types)
    && /availableResolution\??\s*:\s*DesignExecutionAvailableResolution/.test(viewBody)
    && publicViewMissingContracts.length === 0
    && projectionChecks.forbidden.length === 0;

  const getRoute = extractRouteSection(controller, /@Get\(["']:id\/executions["']\)/);
  const listMethod = extractBalancedBlock(designService, /async listExecutions\s*\([^)]*\)\s*[^\{]*/);
  const getIdentityQuery = extractBalancedBlock(webApi, /function designExecutionExpectedIdentityQuery\s*\([^)]*\)\s*[^\{]*/);
  const getClient = extractBalancedBlock(webApi, /export async function getDesignJobExecutions\s*\([^)]*\)\s*[^\{]*/);
  const getRouteChecks = patternFailures(getRoute, [
    /@Query\(["']expectedWechatAccountId["']\)/,
    /@Query\(["']expectedConversationId["']\)/,
    /@Query\(["']expectedCustomerId["']\)/,
  ]);
  const listIdentityChecks = patternFailures(listMethod, [
    /!expected\.expectedWechatAccountId/,
    /!expected\.expectedConversationId/,
    /!expected\.expectedCustomerId/,
    /assertExpectedIdentity/,
    /listPublicForDesignJob/,
  ]);
  const getClientChecks = patternFailures(getClient, [
    /\/design-jobs\/\$\{encodeURIComponent\(id\)\}\/executions/,
    /designExecutionExpectedIdentityQuery\(expected\)/,
  ]);
  const getIdentityQueryChecks = patternFailures(getIdentityQuery, [
    /params\.set\(["']expectedWechatAccountId["'],\s*expected\.expectedWechatAccountId\)/,
    /params\.set\(["']expectedConversationId["'],\s*expected\.expectedConversationId\)/,
    /params\.set\(["']expectedCustomerId["'],\s*expected\.expectedCustomerId\)/,
    /expectedWechatAccountId/,
    /expectedConversationId/,
    /expectedCustomerId/,
  ]);
  const identityMissing = [
    ...getRouteChecks.missing.map((item) => `controller-${item}`),
    ...listIdentityChecks.missing.map((item) => `service-${item}`),
    ...getClientChecks.missing.map((item) => `client-${item}`),
    ...getIdentityQueryChecks.missing.map((item) => `client-query-${item}`),
  ];
  const identityOk = identityMissing.length === 0;

  const unknownRoute = extractRouteSection(controller, /@Post\(["']:id\/executions\/:executionId\/resolve-unknown["']\)/);
  const refundRoute = extractRouteSection(controller, /@Post\(["']:id\/executions\/:executionId\/resolve-refund["']\)/);
  const approveRoute = extractRouteSection(controller, /@Post\(["']:id\/quick-confirm-send["']\)/);
  const unknownPublic = extractBalancedBlock(executionService, /async resolveUnknownPublic\s*\([^)]*\)\s*[^\{]*/);
  const refundPublic = extractBalancedBlock(executionService, /async resolveUnsafeRefundPublic\s*\([^)]*\)\s*[^\{]*/);
  const resolveUnknownService = extractBalancedBlock(designService, /async resolveUnknownExecution\s*\([^)]*\)\s*[^\{]*/);
  const resolveRefundService = extractBalancedBlock(designService, /async resolveExecutionRefund\s*\([^)]*\)\s*[^\{]*/);
  const classBoundaryChecks = patternFailures(controller.slice(0, Math.max(0, controller.indexOf("export class DesignJobsController"))), [
    /@RequireOperatorCapability\(["']view_console["']\)/,
  ]);
  const unknownBoundaryChecks = patternFailures(unknownRoute, [
    /@RequireOperatorCapability\(["']manage_design_executions["']\)/,
    /@TrustedOperator\(\) principal/,
    /reviewer:\s*_untrustedReviewer/,
    /principal\.id/,
  ]);
  const refundBoundaryChecks = patternFailures(refundRoute, [
    /@RequireOperatorCapability\(["']manage_design_executions["']\)/,
    /@TrustedOperator\(\) principal/,
    /reviewer:\s*_untrustedReviewer/,
    /principal\.id/,
  ]);
  const approveBoundaryChecks = patternFailures(approveRoute, [
    /@RequireOperatorCapability\(["']approve_send["']\)/,
  ]);
  const typeBoundaryChecks = patternFailures(types, [
    /ResolveUnknownDesignExecutionPayload\s*=\s*\{\s*resolution:\s*["']confirmed_not_generated_refunded["'];?\s*\}/,
    /ResolveDesignExecutionRefundPayload\s*=\s*\{\s*resolution:\s*["']confirmed_refunded["'];?\s*\}/,
  ]);
  const unknownPublicChecks = patternFailures(unknownPublic, [
    /toPublicExecutionView\(await this\.resolveUnknown/,
  ]);
  const refundPublicChecks = patternFailures(refundPublic, [
    /toPublicExecutionView\(await this\.resolveUnsafeRefund/,
  ]);
  const unknownServiceResponseChecks = patternFailures(resolveUnknownService, [
    /\.resolveUnknownPublic\(/,
  ]);
  const refundServiceResponseChecks = patternFailures(resolveRefundService, [
    /\.resolveUnsafeRefundPublic\(/,
  ]);
  const boundaryMissing = [
    ...classBoundaryChecks.missing.map((item) => `class-${item}`),
    ...unknownBoundaryChecks.missing.map((item) => `unknown-route-${item}`),
    ...refundBoundaryChecks.missing.map((item) => `refund-route-${item}`),
    ...approveBoundaryChecks.missing.map((item) => `approve-route-${item}`),
    ...typeBoundaryChecks.missing.map((item) => `types-${item}`),
    ...unknownClientChecks.missing.map((item) => `unknown-client-${item}`),
    ...refundClientChecks.missing.map((item) => `refund-client-${item}`),
    ...resolutionRequestChecks.missing.map((item) => `request-body-${item}`),
    ...unknownPublicChecks.missing.map((item) => `unknown-public-mapper-${item}`),
    ...refundPublicChecks.missing.map((item) => `refund-public-mapper-${item}`),
    ...unknownServiceResponseChecks.missing.map((item) => `unknown-service-response-${item}`),
    ...refundServiceResponseChecks.missing.map((item) => `refund-service-response-${item}`),
  ];
  const boundaryForbidden = [
    ...unknownClientChecks.forbidden.map((item) => `unknown-client-${item}`),
    ...refundClientChecks.forbidden.map((item) => `refund-client-${item}`),
    ...resolutionRequestChecks.forbidden.map((item) => `request-body-${item}`),
  ];
  const boundariesOk = boundaryMissing.length === 0
    && boundaryForbidden.length === 0;

  return [
    result(
      "contract.design_execution_reconciliation_ui",
      "设计执行人工核销 UI 失败关闭契约",
      uiOk ? STATUS.PASS : STATUS.FAIL,
      uiOk ? "UI 确认绑定当前执行动作，并在读取、权限或 intent 变化时失败关闭；客户端只提交固定 resolution，不提交 reviewer。" : "UI 文件缺失，或当前执行 intent、读取/权限失败关闭、固定 resolution、无 reviewer 契约发生漂移。",
      { paths: [uiPath, webApiPath], missing: uiMissing, forbidden: uiForbidden },
    ),
    result(
      "contract.design_execution_public_view",
      "设计执行人工核销安全读模型",
      publicViewOk ? STATUS.PASS : STATUS.FAIL,
      publicViewOk ? "执行视图采用精确字段白名单，服务端导出可核销动作且不展开原始执行记录。" : "执行视图字段白名单、服务端可操作性或显式 projection 契约不完整。",
      {
        paths: [typesPath, executionServicePath],
        expectedFields: DESIGN_EXECUTION_PUBLIC_VIEW_FIELDS,
        actualFields: actualViewFields,
        missingFields: missingViewFields,
        unexpectedFields: unexpectedViewFields,
        missingContracts: publicViewMissingContracts,
        forbidden: projectionChecks.forbidden,
      },
    ),
    result(
      "contract.design_execution_list_identity",
      "设计执行列表期望身份边界",
      identityOk ? STATUS.PASS : STATUS.FAIL,
      identityOk ? "GET 客户端和服务端都使用账号、会话、客户 expected* 身份，并在读取前校验设计任务身份。" : "GET 客户端 query、控制器或服务层缺少一致的 expected* 身份字段/校验，存在跳过校验风险。",
      { paths: [controllerPath, designServicePath, webApiPath], missing: identityMissing, forbidden: [] },
    ),
    result(
      "contract.design_execution_resolution_boundaries",
      "设计执行核销与发送能力边界",
      boundariesOk ? STATUS.PASS : STATUS.FAIL,
      boundariesOk ? "核销使用 manage_design_executions、可信 reviewer、严格 payload 与脱敏响应；发送仍独立要求 approve_send。" : "核销/发送能力、可信 reviewer、严格 resolution、客户端 body 或脱敏响应发生漂移。",
      {
        paths: [controllerPath, designServicePath, executionServicePath, typesPath, webApiPath],
        missing: boundaryMissing,
        forbidden: boundaryForbidden,
      },
    ),
  ];
}

function localStoreInventoryResults(root) {
  return FIXED_LOCAL_INVENTORY.map((item) => {
    const text = readText(root, item.file);
    if (text === null) {
      return result(item.id, item.title, STATUS.FAIL, "清单中的组件文件缺失，无法确认持久化边界。", {
        path: normalizeRelative(item.file), classification: item.classification, reason: item.reason,
      });
    }
    const localPathPresent = item.activePatterns.every((pattern) => pattern.test(text));
    const productionRoutePresent = Array.isArray(item.resolutionPatterns)
      && item.resolutionPatterns.every((pattern) => pattern.test(text));
    const active = localPathPresent && !productionRoutePresent;
    if (item.classification === "host_local_allowlist") {
      return result(
        item.id,
        item.title,
        active ? STATUS.PASS : STATUS.FAIL,
        active ? "已按理由列入主机本地配置白名单。" : "白名单实现发生漂移，需要重新核对理由与边界。",
        { path: normalizeRelative(item.file), classification: item.classification, active, localPathPresent, productionRoutePresent, reason: item.reason },
      );
    }
    if (item.classification === "local_mode_allowlist") {
      return result(
        item.id,
        item.title,
        STATUS.PASS,
        active ? "本地/兼容历史存在；生产 durable 状态由独立 BullMQ/Redis 契约约束。" : "本地兼容路径已移除，无需继续白名单。",
        { path: normalizeRelative(item.file), classification: item.classification, active, localPathPresent, productionRoutePresent, reason: item.reason },
      );
    }
    return result(
      item.id,
      item.title,
      active ? STATUS.FAIL : STATUS.PASS,
      active ? "生产模式仍固定依赖 LocalStore。" : "未检测到清单记录的固定 LocalStore 路径。",
      {
        path: normalizeRelative(item.file),
        classification: active ? item.classification : "resolved_production_route",
        ...(active ? {} : { priorClassification: item.classification }),
        active,
        localPathPresent,
        productionRoutePresent,
        reason: active
          ? item.reason
          : "生产持久化路由已满足清单中的 resolutionPatterns；该历史缺口已关闭。",
      },
    );
  });
}

function plannedScopeResult(root) {
  const source = readText(root, PLANNED_CHANNEL_SCOPE.file);
  const roadmap = readText(root, "docs/PROJECT_LANDING_ROADMAP.md");
  const combined = `${source || ""}\n${roadmap || ""}`;
  const valid = Boolean(source && roadmap) && PLANNED_CHANNEL_SCOPE.guardPatterns.every((pattern) => pattern.test(combined));
  return result(
    PLANNED_CHANNEL_SCOPE.id,
    PLANNED_CHANNEL_SCOPE.title,
    valid ? STATUS.PASS : STATUS.FAIL,
    valid ? "规划渠道被明确标记并 fail-closed。" : "规划渠道白名单的状态、禁用适配器或路线图理由发生漂移。",
    {
      path: PLANNED_CHANNEL_SCOPE.file,
      classification: "planned_scope_allowlist",
      active: valid,
      reason: PLANNED_CHANNEL_SCOPE.reason,
    },
  );
}

function isAllowedPlannedPlaceholder(root, relativePath, line) {
  if (normalizeRelative(relativePath) !== PLANNED_CHANNEL_SCOPE.file) return false;
  if (plannedScopeResult(root).status !== STATUS.PASS) return false;
  return PLANNED_CHANNEL_SCOPE.markers.some((marker) => line.includes(marker));
}

function listFilesRecursively(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
  const files = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(target);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function placeholderResult(root) {
  const resolvedRoot = path.resolve(root);
  const findings = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    for (const filePath of listFilesRecursively(absoluteFrom(root, sourceRoot))) {
      const relativePath = normalizeRelative(path.relative(resolvedRoot, filePath));
      const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        PLACEHOLDER_PATTERN.lastIndex = 0;
        const matches = [...line.matchAll(PLACEHOLDER_PATTERN)];
        for (const match of matches) {
          if (isAllowedPlannedPlaceholder(root, relativePath, line)) continue;
          findings.push({
            component: relativePath,
            line: index + 1,
            marker: String(match[0]).toLowerCase(),
          });
        }
      });
    }
  }
  return result(
    "source.production_placeholders",
    "生产源码占位实现",
    findings.length ? STATUS.FAIL : STATUS.PASS,
    findings.length ? `发现 ${findings.length} 处明确占位实现。` : "未发现明确的生产源码占位实现。",
    { sourceRoots: SOURCE_ROOTS, findings },
  );
}

function capabilityTruthResults(root) {
  const designSource = readText(root, "desktop/apps/api/src/design-jobs/design-jobs.service.ts") || "";
  const fingerprintSource = readText(root, "desktop/apps/api/src/shared/image-fingerprint.ts") || "";
  const matcherSource = readText(root, "desktop/packages/rules/selectionMatcher.js") || "";
  const exactHash = /buildLegacyImageIdentityHash/.test(designSource) && /legacyIdentityHash/.test(designSource);
  const perceptualHash = /dhash64:v1/.test(fingerprintSource) && /\.resize\(9, 8/.test(fingerprintSource);
  const safeMatcher = /hammingDistance/.test(matcherSource) && /nearest\.distance > 1/.test(matcherSource) && /gap < 2/.test(matcherSource);
  return [
    result(
      "capability.image_fingerprint",
      "图片指纹能力口径",
      exactHash && perceptualHash && safeMatcher ? STATUS.PASS : STATUS.FAIL,
      exactHash && perceptualHash && safeMatcher
        ? "真实图片字节 dHash64 v1、旧身份哈希隔离和汉明距离强阈值均可定位。"
        : "真实图片字节指纹、旧身份哈希隔离或失败关闭匹配契约存在缺口。",
      {
        paths: ["desktop/apps/api/src/shared/image-fingerprint.ts", "desktop/packages/rules/selectionMatcher.js", "desktop/apps/api/src/design-jobs/design-jobs.service.ts"],
        legacySha256IdentityHash: exactHash,
        perceptualImageHash: perceptualHash,
        failClosedMatcher: safeMatcher,
      },
    ),
  ];
}

function externalEvidenceResults() {
  return [
    result("external.windows_signing", "Windows 正式签名与安装验收", STATUS.BLOCKED, "需要企业代码签名证书、目标 Windows 安装/卸载和 SmartScreen 证据。", { external: true }),
    result("external.staging", "真实预发布环境", STATUS.BLOCKED, "需要预发布账号、密钥、HTTPS、数据库迁移和只读就绪报告。", { external: true }),
    result("external.channels", "真实渠道联调", STATUS.BLOCKED, "需要企业微信/设计平台授权账号与真实回调验收；不得由离线审计发消息。", { external: true }),
    result("external.personal_wechat", "个人微信现场硬件与会话", STATUS.BLOCKED, "需要授权 Windows 会话、目标微信版本、登录账号和 UI Automation 现场证据。", { external: true }),
    result("external.database_recovery", "隔离数据库恢复演练", STATUS.BLOCKED, "需要数据库负责人提供独立 rehearsal/sandbox 目标并显式确认执行。", { external: true }),
  ];
}

function buildAudit(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const results = [
    ...artifactResults(resolvedRoot),
    ...contractResults(resolvedRoot),
    ...highRiskOperatorRouteResults(resolvedRoot),
    ...designReconciliationResults(resolvedRoot),
    plannedScopeResult(resolvedRoot),
    placeholderResult(resolvedRoot),
    ...localStoreInventoryResults(resolvedRoot),
    ...capabilityTruthResults(resolvedRoot),
    ...(options.includeExternal === false ? [] : externalEvidenceResults()),
  ];
  const status = aggregateStatus(results);
  const counts = Object.fromEntries(Object.values(STATUS).map((value) => [value, results.filter((item) => item.status === value).length]));
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: "offline-readonly-inventory",
    status,
    counts,
    safety: {
      networkCalls: false,
      commandsExecuted: false,
      externalWrites: false,
      secretFilesRead: false,
      realMessageSendAttempted: false,
      databaseConnectionAttempted: false,
      reportContainsSecrets: false,
    },
    scope: {
      rootIdentity: path.basename(resolvedRoot),
      pathsAreRepositoryRelative: true,
      reportPath: "desktop/.runtime/project-completion-audit/latest.{json,md}",
    },
    results,
  };
}

function escapeMarkdown(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function toMarkdown(report) {
  const lines = [
    "# 项目完成度真值审计",
    "",
    `- 总体状态：**${report.status}**`,
    `- 生成时间：${report.generatedAt}`,
    `- 模式：${report.mode}`,
    `- 汇总：PASS ${report.counts.PASS} / BLOCKED ${report.counts.BLOCKED} / FAIL ${report.counts.FAIL}`,
    "- 安全边界：无网络、无命令执行、无数据库连接、无真实发送，不读取 `.env` 或其他密钥文件。",
    "",
    "| 状态 | 检查项 | 结论 | 证据路径 |",
    "| --- | --- | --- | --- |",
  ];
  for (const item of report.results) {
    lines.push(`| ${item.status} | ${escapeMarkdown(item.title)} | ${escapeMarkdown(item.summary)} | ${escapeMarkdown(item.evidence?.path || "外部证据")} |`);
  }
  const findings = report.results.find((item) => item.id === "source.production_placeholders")?.evidence?.findings || [];
  lines.push("", "## 明确占位实现", "");
  if (!findings.length) lines.push("- 未发现。");
  else for (const finding of findings) lines.push(`- \`${finding.component}:${finding.line}\`：\`${finding.marker}\``);
  lines.push("", "## 固定 LocalStore 清单与本机白名单", "");
  for (const item of report.results.filter((entry) => entry.id.startsWith("local_store."))) {
    lines.push(`- **${item.status} ${item.title}**（${item.evidence.classification}）：${item.evidence.reason}`);
  }
  lines.push("", "## 判定规则", "", "- `FAIL`：仓库内实现、契约或生产持久化缺口，必须修复，不能用外部环境解释。", "- `BLOCKED`：需要真实密钥、账号、预发布、签名证书、数据库授权或 Windows/微信现场证据。", "- `PASS`：当前仓库内可重复、只读核对的代码或文档证据存在且契约一致。", "");
  return `${lines.join("\n")}\n`;
}

function writeReport(root, report) {
  const reportRoot = absoluteFrom(root, "desktop/.runtime/project-completion-audit");
  fs.mkdirSync(reportRoot, { recursive: true });
  const jsonPath = path.join(reportRoot, "latest.json");
  const markdownPath = path.join(reportRoot, "latest.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, toMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

function parseArgs(argv) {
  const parsed = { root: path.resolve(__dirname, "..", "..") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") {
      if (!argv[index + 1]) throw new Error("--root requires a path");
      parsed.root = path.resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`unsupported argument: ${argv[index]}`);
    }
  }
  return parsed;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = buildAudit(options.root);
  const files = writeReport(options.root, report);
  process.stdout.write(`[project-completion-audit] ${report.status} PASS=${report.counts.PASS} BLOCKED=${report.counts.BLOCKED} FAIL=${report.counts.FAIL}\n`);
  process.stdout.write(`[project-completion-audit] JSON ${files.jsonPath}\n`);
  process.stdout.write(`[project-completion-audit] Markdown ${files.markdownPath}\n`);
  process.exitCode = EXIT_CODE[report.status];
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[project-completion-audit] FAIL ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = EXIT_CODE.FAIL;
  }
}

module.exports = {
  STATUS,
  EXIT_CODE,
  REQUIRED_ARTIFACTS,
  CONTRACTS,
  FIXED_LOCAL_INVENTORY,
  aggregateStatus,
  absoluteFrom,
  buildAudit,
  loadTypeScriptCompilerFromDependencyRoot,
  maskTypeScriptCommentsAndStrings,
  parseArgs,
  toMarkdown,
  writeReport,
};
