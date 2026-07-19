"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STATUS = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", FAIL: "FAIL" });
const STATUS_RANK = Object.freeze({ PASS: 0, BLOCKED: 1, FAIL: 2 });
const EXIT_CODE = Object.freeze({ PASS: 0, BLOCKED: 2, FAIL: 1 });
const SCHEMA_VERSION = "smart_kefu_project_completion_audit_v1";

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
]);

const CONTRACTS = Object.freeze([
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
      /"prisma:agents:init"\s*:\s*"node tools\/initialize-prisma-agents\.js"/,
    ],
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
    patterns: [/permissions:\s*[\r\n]+\s*contents:\s*read/i, /persist-credentials:\s*false/i, /upload-artifact@v4/i],
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
    id: "contract.wechat_prisma",
    title: "微信与企业微信 Prisma 持久化",
    file: "desktop/apps/api/src/wechat/wechat-persistence.ts",
    patterns: [/if \(this\.isLocal\)/, /wechatWorkBinding/, /wechatWorkAuditLog/, /wechatSendTask/],
  },
  {
    id: "contract.documentation",
    title: "完成度审计文档入口",
    file: "desktop/README.md",
    patterns: [/project:completion:audit/, /稳定 SHA-256/],
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
    id: "contract.agents_prisma_route",
    title: "Agent 中心 Prisma 路由",
    file: "desktop/apps/api/src/agents/agents.service.ts",
    patterns: [/PrismaOperationsService/, /appConfig\.useLocalStore/, /this\.requirePrisma\(\)\.listAgents/, /this\.requirePrisma\(\)\.listAgentSkills/],
  },
  {
    id: "contract.routing_prisma_route",
    title: "路由与纠正 Prisma 路由",
    file: "desktop/apps/api/src/routing/routing.service.ts",
    patterns: [/PrismaOperationsService/, /if \(!appConfig\.useLocalStore\)/, /evaluatePrisma/, /correctRouteEvaluation/],
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
      /this\.persistence\.upsertBinding/,
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
  "desktop/apps/electron",
  "core",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py"]);
const PLACEHOLDER_PATTERN = /(?:prisma mode is not implemented yet|not implemented|尚未实现|TODO\b|FIXME\b)/gi;
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
        missingContracts: contract.patterns.length,
      });
    }
    const missing = contract.patterns
      .map((pattern, index) => (pattern.test(text) ? null : `required-pattern-${index + 1}`))
      .filter(Boolean);
    const forbidden = (contract.forbidden || [])
      .map((pattern, index) => (pattern.test(text) ? `forbidden-pattern-${index + 1}` : null))
      .filter(Boolean);
    const ok = missing.length === 0 && forbidden.length === 0;
    return result(
      contract.id,
      contract.title,
      ok ? STATUS.PASS : STATUS.FAIL,
      ok ? "代码/配置契约与完成度声明一致。" : "代码/配置契约不完整或存在禁止项。",
      { path: normalizeRelative(contract.file), missing, forbidden },
    );
  });
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
      { path: normalizeRelative(item.file), classification: item.classification, active, localPathPresent, productionRoutePresent, reason: item.reason },
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
  const fingerprintSource = readText(root, "desktop/apps/api/src/design-jobs/design-jobs.service.ts") || "";
  const exactHash = /createHash\(["']sha256["']\)/.test(fingerprintSource);
  const perceptualHash = /(?:perceptualHash|pHash|dHash|aHash)/.test(fingerprintSource);
  return [
    result(
      "capability.image_fingerprint",
      "图片指纹能力口径",
      exactHash && perceptualHash ? STATUS.PASS : exactHash ? STATUS.FAIL : STATUS.FAIL,
      exactHash && !perceptualHash
        ? "当前仅有稳定 SHA-256 身份哈希，不是感知哈希，截图相似匹配尚未完成。"
        : exactHash
          ? "稳定哈希与感知哈希实现均可定位。"
          : "未定位到稳定图片身份哈希实现。",
      {
        path: "desktop/apps/api/src/design-jobs/design-jobs.service.ts",
        stableSha256IdentityHash: exactHash,
        perceptualImageHash: perceptualHash,
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
