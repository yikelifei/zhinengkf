"use strict";

const fs = require("node:fs");
const path = require("node:path");

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
        id: "local-low-value-atomic-commit",
        file: "desktop/apps/api/src/local-store/local-store.service.ts",
        startPattern: /commitInboundLowValueSelection\s*\(payload:\s*\{[\s\S]*?\n\s*\}\)\s*/,
        patterns: [
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
    const paths = new Set([normalizeRelative(contract.file)]);
    for (const section of contract.sections || []) {
      paths.add(normalizeRelative(section.file));
      const sectionSource = readText(root, section.file);
      const block = sectionSource === null ? null : extractBalancedBlock(sectionSource, section.startPattern);
      if (block === null) {
        missing.push(`${section.id}:section-missing`);
        continue;
      }
      for (const [index, pattern] of section.patterns.entries()) {
        if (!pattern.test(block)) missing.push(`${section.id}:required-pattern-${index + 1}`);
      }
      for (const [index, pattern] of (section.forbidden || []).entries()) {
        if (pattern.test(block)) forbidden.push(`${section.id}:forbidden-pattern-${index + 1}`);
      }
      for (const [index, occurrence] of (section.occurrences || []).entries()) {
        const flags = occurrence.pattern.flags.includes("g") ? occurrence.pattern.flags : `${occurrence.pattern.flags}g`;
        const matches = block.match(new RegExp(occurrence.pattern.source, flags)) || [];
        if (matches.length < occurrence.minimum) {
          missing.push(`${section.id}:occurrence-${index + 1}-${matches.length}-of-${occurrence.minimum}`);
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

function extractBalancedBlock(text, startPattern) {
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
      if (depth === 0) return text.slice(match.index, index + 1);
    }
  }
  return null;
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
  const sources = Object.fromEntries(
    Object.entries(paths).map(([key, file]) => [key, readText(root, file) || ""]),
  );
  const missing = [];
  const forbidden = [];
  const issues = [];
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
    ["orders-class", "orders"],
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
    ["orders-from-quote", "orders", /@Post\(["']from-quote\/:quoteId["']\)/, "manage_design_executions"],
    ["orders-update", "orders", /@Post\(["']:id\/update["']\)/, "manage_design_executions"],
    ["orders-revise", "orders", /@Post\(["']:id\/revise-selection["']\)/, "manage_design_executions"],
    ["quotes-update", "quotes", /@Post\(["']:id\/update["']\)/, "manage_design_executions"],
    ["quotes-revise", "quotes", /@Post\(["']:id\/revise-selection["']\)/, "manage_design_executions"],
  ]) {
    check(label, sources[sourceKey], routePattern, [
      new RegExp(`@RequireOperatorCapability\\(["']${capability}["']\\)`),
    ]);
  }
  for (const [label, sourceKey, routePattern] of [
    ["orders-revise-trusted", "orders", /@Post\(["']:id\/revise-selection["']\)/],
    ["quotes-update-trusted", "quotes", /@Post\(["']:id\/update["']\)/],
    ["quotes-revise-trusted", "quotes", /@Post\(["']:id\/revise-selection["']\)/],
  ]) {
    check(label, sources[sourceKey], routePattern, [
      /@TrustedOperator\(\) principal/,
      /owner:\s*_untrustedOwner/,
      /owner:\s*principal\.id/,
    ]);
  }
  const ordersUpdateSection = extractRouteSection(sources.orders, /@Post\(["']:id\/update["']\)/);
  const explicitOrdersUpdateAllowlist = [
    /return this\.orders\.update\(id,\s*\{/,
    /status:\s*payload\?\.status/,
    /customerNotes:\s*payload\?\.customerNotes/,
    /expectedWechatAccountId:\s*payload\?\.expectedWechatAccountId/,
    /expectedConversationId:\s*payload\?\.expectedConversationId/,
    /expectedCustomerId:\s*payload\?\.expectedCustomerId/,
  ];
  const stripsUntrustedOwner = /owner:\s*_untrustedOwner/.test(ordersUpdateSection || "");
  check(
    "orders-update-trusted",
    sources.orders,
    /@Post\(["']:id\/update["']\)/,
    [
      /@TrustedOperator\(\) principal/,
      /owner:\s*principal\.id/,
      ...(stripsUntrustedOwner ? [/owner:\s*_untrustedOwner/] : explicitOrdersUpdateAllowlist),
    ],
    stripsUntrustedOwner ? [] : [/\.\.\.(?:payload|trustedPayload)/, /owner:\s*payload(?:\?|\.)/],
  );
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

  const uiChecks = patternFailures(ui, [
    /export const DESIGN_EXECUTION_RESOLUTIONS\s*=\s*\{[\s\S]*unknown:\s*["']confirmed_not_generated_refunded["'][\s\S]*refund:\s*["']confirmed_refunded["'][\s\S]*\}\s*as const/,
    /resolutionAction\(execution\.availableResolution\)/,
    /resolution\s*===\s*DESIGN_EXECUTION_RESOLUTIONS\.unknown/,
    /resolution\s*===\s*DESIGN_EXECUTION_RESOLUTIONS\.refund/,
    /return null/,
    /if \(!pending[^\n{]*submittingId[^\n{]*!canManageExecutions\) return/,
    /submitLock\.current/,
    /role=["']alertdialog["']/,
    /await onRefresh\(\)/,
  ], [
    /\breviewer\s*:/,
    /\bsetInterval\s*\(/,
  ]);
  const uiOk = uiChecks.missing.length === 0 && uiChecks.forbidden.length === 0;

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
  const unknownClient = extractBalancedBlock(webApi, /export async function resolveUnknownDesignExecution\s*\([^)]*\)\s*[^\{]*/);
  const refundClient = extractBalancedBlock(webApi, /export async function resolveDesignExecutionRefund\s*\([^)]*\)\s*[^\{]*/);
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
  const unknownClientChecks = patternFailures(unknownClient, [
    /\/executions\/\$\{encodeURIComponent\(executionId\)\}\/resolve-unknown/,
    /resolution:\s*["']confirmed_not_generated_refunded["']/,
  ], [/\breviewer\s*:/]);
  const refundClientChecks = patternFailures(refundClient, [
    /\/executions\/\$\{encodeURIComponent\(executionId\)\}\/resolve-refund/,
    /resolution:\s*["']confirmed_refunded["']/,
  ], [/\breviewer\s*:/]);
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
    ...unknownPublicChecks.missing.map((item) => `unknown-public-mapper-${item}`),
    ...refundPublicChecks.missing.map((item) => `refund-public-mapper-${item}`),
    ...unknownServiceResponseChecks.missing.map((item) => `unknown-service-response-${item}`),
    ...refundServiceResponseChecks.missing.map((item) => `refund-service-response-${item}`),
  ];
  const boundaryForbidden = [
    ...unknownClientChecks.forbidden.map((item) => `unknown-client-${item}`),
    ...refundClientChecks.forbidden.map((item) => `refund-client-${item}`),
  ];
  const boundariesOk = boundaryMissing.length === 0
    && boundaryForbidden.length === 0;

  return [
    result(
      "contract.design_execution_reconciliation_ui",
      "设计执行人工核销 UI 失败关闭契约",
      uiOk ? STATUS.PASS : STATUS.FAIL,
      uiOk ? "UI 只使用服务端白名单动作和固定 resolution，且不提交 reviewer。" : "UI 文件缺失，或核销动作、固定 resolution、失败关闭/无 reviewer 契约发生漂移。",
      { paths: [uiPath, webApiPath], ...uiChecks },
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
  parseArgs,
  toMarkdown,
  writeReport,
};
