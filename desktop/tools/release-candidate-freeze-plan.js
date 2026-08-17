"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "smart_kefu_release_candidate_freeze_plan_v1";
const STATUS = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", FAIL: "FAIL" });
const EXIT_CODE = Object.freeze({ PASS: 0, BLOCKED: 2, FAIL: 1 });

const desktopRoot = path.resolve(__dirname, "..");
const defaultRuntimeRoot = path.join(desktopRoot, ".runtime");
const defaultHandoffPath = path.join(defaultRuntimeRoot, "delivery-handoff", "latest.json");
const defaultReportRoot = path.join(defaultRuntimeRoot, "release-candidate-freeze-plan");

const FOUNDATION_DIRECT_PATH_PATTERNS = Object.freeze([
  /^scripts\/run_tests\.py$/,
  /^desktop\/config\/product-acceptance-matrix\.json$/,
  /^desktop\/docs\/(?:product_acceptance|project_completion_audit|release_candidate_scope_execution|release_freeze_control_\d+)\.md$/,
  /^desktop\/apps\/api\/src\/delivery\/delivery-readiness\.(?:controller|service)\.ts$/,
  /^desktop\/apps\/api\/src\/shared\/demo-data-boundary\.ts$/,
  /^desktop\/apps\/web\/src\/app\/settings\/delivery-readiness\/page\.tsx$/,
  /^desktop\/apps\/web\/src\/features\/system\/(?:delivery-readiness-page|delivery-readiness-summary-card)\.tsx$/,
  /^desktop\/apps\/web\/src\/features\/system\/index\.ts$/,
  /^desktop\/tests\/(?:ci-release-quality|delivery-full-automation|delivery-handoff-bundle|delivery-readiness|demo-data-production-boundary|external-evidence-bundle|manual-release-relock|product-acceptance-matrix|production-release-gate|project-completion-audit|release-candidate-freeze-plan|repository-provenance|staging-readiness-evidence)\.test\.js$/,
  /^desktop\/tools\/(?:ci-release-quality|delivery-full-automation|delivery-handoff-bundle|external-evidence-bundle|product-acceptance-layout(?:-edge)?-probe|production-release-gate|project-completion-audit|release-candidate-freeze-plan|repository-provenance|run-product-acceptance|staging-readiness-evidence)\.js$/,
  /^desktop\/tools\/quality\/run_product_acceptance\.bat$/,
]);

const FOUNDATION_DIRECT_PATHS = new Set([
  ".gitignore",
  "desktop/apps/api/src/notifications/notifications.service.ts",
  "desktop/tests/isolated-app-config-env.js",
]);

const FOUNDATION_DEFERRED_PATHS = new Set([
  "desktop/README.md",
  "desktop/package-lock.json",
  "desktop/apps/api/src/local-store/local-store.service.ts",
  "desktop/apps/web/src/features/overview/overview-page.tsx",
  "desktop/tests/local-store-demo-sku-readiness.test.js",
]);

const FOUNDATION_MIXED_PATHS = new Set([
  "desktop/.env.example",
  "desktop/package.json",
  "desktop/apps/api/src/app.module.ts",
  "desktop/apps/api/src/assets/assets.service.ts",
  "desktop/apps/api/src/catalog/catalog.service.ts",
  "desktop/apps/api/src/design-jobs/design-jobs.service.ts",
  "desktop/apps/api/src/shared/app-config.ts",
  "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
  "desktop/apps/web/src/app/overview-route-feature.tsx",
  "desktop/apps/web/src/app/route-manifest.ts",
  "desktop/apps/web/src/components/workbench-shell/navigation.ts",
  "desktop/apps/web/src/features/governance-pages.module.css",
  "desktop/apps/web/src/lib/api.ts",
]);

const FOUNDATION_MIXED_GUIDANCE = Object.freeze({
  "desktop/.env.example": {
    include: "只纳入 ALLOW_DEMO_DATA_MUTATIONS 示例。",
    defer: "臻玺 AI 地址/API Key、本地浏览器 API 和企业微信服务商授权配置全部延期。",
  },
  "desktop/package.json": {
    include: "只纳入 acceptance:e2e:local-safe 与 delivery:* 治理脚本。",
    defer: "臻玺 AI 连接、快捷方式修复、依赖升级和 overrides 全部延期。",
  },
  "desktop/apps/api/src/app.module.ts": {
    include: "只纳入 DeliveryReadinessController 和 DeliveryReadinessService 的导入与注册。",
    defer: "Agent Skill、企业微信授权/服务商和个人微信控制器模式变更全部延期。",
  },
  "desktop/apps/api/src/assets/assets.service.ts": {
    include: "只纳入 demo-data-boundary 导入和 createDemoCustomerLogo 前置保护。",
    defer: "资源 role 投影变更延期到核心产品范围。",
  },
  "desktop/apps/api/src/catalog/catalog.service.ts": {
    include: "只纳入 demo-data-boundary 导入和 createDemoSkuImages 前置保护。",
    defer: "商品图片归档、演示目录和 SKU 资产同步变更全部延期。",
  },
  "desktop/apps/api/src/design-jobs/design-jobs.service.ts": {
    include: "只纳入 demo-data-boundary 导入，以及 timeout/failure demo 的两个前置保护。",
    defer: "臻玺 AI 适配、日志、图片持久化和设计执行变更全部延期。",
  },
  "desktop/apps/api/src/shared/app-config.ts": {
    include: "只纳入 allowDemoDataMutations 配置项。",
    defer: "臻玺 AI 适配、凭据、链接、桌面自动化默认值和企业微信服务商配置全部延期。",
  },
  "desktop/apps/api/src/wechat/wechat-dispatch.service.ts": {
    include: "只纳入 demo-data-boundary 导入，以及窗口快照和演示发送任务的前置保护。",
    defer: "付款核验、发送恢复、企业微信和其他会话业务变更全部延期。",
  },
  "desktop/apps/web/src/app/overview-route-feature.tsx": {
    include: "只纳入 delivery 到 /settings/delivery-readiness 的导航目标。",
    defer: "企业微信 launch 导航延期到企业微信范围。",
  },
  "desktop/apps/web/src/app/route-manifest.ts": {
    include: "只纳入 delivery 视图、settingsDeliveryReadiness 路由及其默认映射。",
    defer: "AI 模型、训练、个人微信和其他路由变更全部延期。",
  },
  "desktop/apps/web/src/components/workbench-shell/navigation.ts": {
    include: "只纳入系统管理指向 settingsDeliveryReadiness 的导航变更。",
    defer: "企业微信、个人微信和 Skill 训练导航变更全部延期。",
  },
  "desktop/apps/web/src/features/governance-pages.module.css": {
    include: "只纳入 delivery-readiness 使用的 compactList 和链接按钮样式。",
    defer: "审核 handoffPanel 样式延期到核心产品范围。",
  },
  "desktop/apps/web/src/lib/api.ts": {
    include: "只纳入 DeliveryReadiness 类型和 getDeliveryReadiness 只读 API。",
    defer: "知识导入、Agent、AI、企业微信、设计、订单和其他 API 变更全部延期。",
  },
});

const BRANCH_BLUEPRINTS = Object.freeze([
  {
    id: "foundation_governance",
    branchName: "codex/rc-foundation-governance",
    title: "基础治理、demo 边界与交付证据",
    priority: 1,
    decision: "include-subset-only-release-governance",
    groupIds: ["other", "delivery_evidence"],
    scopeGuidance: [
      "只纳入 release/audit/handoff/demo 写入边界、安全扫描、配置说明相关文件。",
      "delivery_evidence 不能整组直接 staging；业务 UI、渠道、数据库相关测试必须回到各自产品分支。",
    ],
    verificationCommands: [
      "node --test --test-concurrency=1 tests\\delivery-full-automation.test.js tests\\delivery-handoff-bundle.test.js tests\\delivery-readiness.test.js tests\\demo-data-production-boundary.test.js tests\\external-evidence-bundle.test.js tests\\manual-release-relock.test.js tests\\product-acceptance-matrix.test.js tests\\production-release-gate.test.js tests\\project-completion-audit.test.js tests\\release-candidate-freeze-plan.test.js tests\\repository-provenance.test.js tests\\staging-readiness-evidence.test.js",
      "npm.cmd run build:api",
      "npm.cmd run build:web",
    ],
    blockers: [
      "不能夹带业务页面、渠道实现、数据库迁移或桌面打包运行时改动。",
      "冻结后 release gate 仍必须显示本地 FAIL=0。",
    ],
  },
  {
    id: "core_product_flow",
    branchName: "codex/rc-core-product-flow",
    title: "核心产品闭环：会话、训练、设计、报价、订单、发送队列",
    priority: 2,
    decision: "include-as-single-product-journey",
    groupIds: ["web_workbench", "training_agent_ai", "automation", "design_platform", "commerce", "send_and_messaging"],
    scopeGuidance: [
      "这是可以合成一个产品分支的闭环：客户会话进入工作台，训练/AI 辅助处理，设计生成报价，订单与付款凭证进入人工确认，最后进入安全发送队列。",
      "send_and_messaging 在此分支只纳入安全队列、人工确认、阻断和回执诊断的产品闭环部分；企业微信专属适配放到企微分支复核。",
    ],
    verificationCommands: [
      "node --test tests\\ui-design-commerce-features.test.js tests\\commerce-page-responsibilities.test.js tests\\wechat-direct-send-safety.test.js tests\\automation-service-status.test.js tests\\training-overview-ui.test.js",
      "npm.cmd run delivery:acceptance",
    ],
    blockers: [
      "不能包含真实外部支付 mutation；付款只能作为内部人工凭证账本记录。",
      "设计平台不能提交真实正式任务；自动化不能绕过发送安全队列。",
    ],
  },
  {
    id: "database_migrations",
    branchName: "codex/rc-database-migrations",
    title: "数据库 schema、迁移与恢复演练",
    priority: 3,
    decision: "split-for-database-review",
    groupIds: ["database"],
    scopeGuidance: [
      "数据库 schema、migration 和 recovery plan 必须单独审查，不和 UI 或业务代码混在一个冻结分支里。",
      "上线前需要隔离预发布库的 migrate deploy 和恢复演练证据。",
    ],
    verificationCommands: [
      "npm.cmd run prisma:validate",
      "npm.cmd run prisma:generate",
      "node --test tests\\database-recovery-rehearsal.test.js",
    ],
    blockers: [
      "没有隔离预发布数据库和恢复演练报告前，不能上线生产数据切换。",
      "migration 必须保持可重复、非空、可审计。",
    ],
  },
  {
    id: "enterprise_wechat_channel",
    branchName: "codex/rc-enterprise-wechat-channel",
    title: "企业微信生产通道",
    priority: 4,
    decision: "split-and-external-gated",
    groupIds: ["enterprise_wechat", "send_and_messaging"],
    scopeGuidance: [
      "企业微信是唯一生产客服通道，但备案、HTTPS、真实回调没完成前只能冻结代码，不能声明上线。",
      "send_and_messaging 在此分支只纳入企微适配、入站、回调、发送回执相关子集；通用发送队列产品面由核心产品分支承担。",
    ],
    verificationCommands: [
      "node --test tests\\wechat-work-production-readiness.test.js tests\\wechat-work-readiness-ui.test.js tests\\wechat-inbound-auth.test.js tests\\enterprise-wechat-only-api-surface.test.js",
      "npm.cmd run build:api",
    ],
    blockers: [
      "ICP 域名、HTTPS callback、真实企微密钥、sync_msg 到 send_msg 证据缺失前不能上线。",
      "不得回退到个人微信作为生产客服通道。",
    ],
  },
  {
    id: "legacy_personal_wechat_compat",
    branchName: "codex/compat-personal-wechat-quarantine",
    title: "个人微信遗留兼容隔离",
    priority: 5,
    decision: "compatibility-only-not-production-channel",
    groupIds: ["legacy_personal_wechat"],
    scopeGuidance: [
      "只能保留历史兼容、人工确认或迁移辅助，不进入生产客服核心。",
      "默认产品模式必须隐藏个人微信 API 控制器和前端操作入口。",
    ],
    verificationCommands: [
      "node --test tests\\personal-wechat-rpa-api.test.js tests\\personal-wechat-rpa-send-switch.test.js tests\\personal-wechat-runtime-config.test.js tests\\personal-wechat-voice-assist-page.test.js",
      "node --test tests\\enterprise-wechat-only-api-surface.test.js tests\\workbench-route-contract.test.js tests\\ui-integrations-delivery-features.test.js",
    ],
    blockers: [
      "个人微信只能保留为显式 legacy 兼容或离线证据工具，不能进入生产客服通道。",
      "默认产品模式必须继续隐藏个人微信 API 控制器和前端操作入口。",
    ],
  },
  {
    id: "desktop_package_runtime",
    branchName: "codex/rc-desktop-package-runtime",
    title: "桌面运行时、会话刷新与 Windows 打包",
    priority: 6,
    decision: "split-for-release-carrier-review",
    groupIds: ["desktop_runtime", "delivery_evidence"],
    scopeGuidance: [
      "桌面启动、会话刷新、打包预检和 Windows 证据属于发布载体，不应混入业务功能分支。",
      "delivery_evidence 在此分支只纳入 Windows/package/runtime 相关子集。",
    ],
    verificationCommands: [
      "node --test tests\\electron-desktop-session-refresh.test.js tests\\windows-package-preflight.test.js tests\\startup-defaults.test.js",
      "npm.cmd run build:web",
      "npm.cmd run build:api",
    ],
    blockers: [
      "正式代码签名证书、目标 Windows 安装/卸载、SmartScreen 证据缺失前不能发正式安装包。",
      "桌面运行时不能绕过可信本机会话和内部 API 守卫。",
    ],
  },
]);

function parseArgs(argv = []) {
  const options = { help: false, handoffPath: defaultHandoffPath, reportRoot: defaultReportRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--handoff") options.handoffPath = path.resolve(readRequiredValue(argv, ++index, argument));
    else if (argument === "--output-root") options.reportRoot = path.resolve(readRequiredValue(argv, ++index, argument));
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function readRequiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function loadHandoff(filePath = defaultHandoffPath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!raw || typeof raw !== "object") throw new Error("delivery handoff report is not an object");
  if (!raw.releaseCandidateScope || typeof raw.releaseCandidateScope !== "object") {
    throw new Error("delivery handoff report does not include releaseCandidateScope");
  }
  return raw;
}

function buildFreezePlan(handoff, options = {}) {
  const sourcePath = options.handoffPath ? relativeToDesktop(options.handoffPath) : "";
  const groups = Array.isArray(handoff.releaseCandidateScope?.groups) ? handoff.releaseCandidateScope.groups : [];
  const normalizedGroups = groups.map(normalizeGroup);
  const groupById = new Map(normalizedGroups.map((group) => [group.id, group]));
  const branchPlans = BRANCH_BLUEPRINTS.map((blueprint) => buildBranchPlan(blueprint, groupById, normalizedGroups))
    .filter((branch) => branch.groups.length > 0);
  const assignedGroupIds = new Set(branchPlans.flatMap((branch) => branch.groupIds));
  const unassignedGroups = groups
    .map(normalizeGroup)
    .filter((group) => !assignedGroupIds.has(group.id));
  if (unassignedGroups.length) {
    branchPlans.push(buildBranchPlan({
      id: "unassigned_changes",
      branchName: "codex/rc-unassigned-review",
      title: "未分类发布候选改动",
      priority: 99,
      decision: "manual-review-required",
      groupIds: unassignedGroups.map((group) => group.id),
      verificationCommands: ["npm.cmd run delivery:acceptance", "npm.cmd run release:gate"],
      blockers: ["这些改动未进入固定分支蓝图，冻结前必须人工归类。"],
    }, new Map(unassignedGroups.map((group) => [group.id, group]))));
  }

  const summary = summarizeBranches(branchPlans, handoff.releaseCandidateScope);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: summary.statusEntryCount > 0 || summary.untrackedCount > 0 ? STATUS.BLOCKED : STATUS.PASS,
    sourceHandoff: {
      path: sourcePath,
      generatedAt: String(handoff.generatedAt || ""),
      status: String(handoff.status || ""),
      readiness: String(handoff.readiness || ""),
    },
    localDeliveryVerdict: normalizeLocalDeliveryVerdict(handoff, summary),
    summary,
    branchPlans,
    globalExitCriteria: [
      "本地交付判定必须是 local_verified 或 local_verified_external_blocked；后者只允许在外部证据未到时保持 BLOCKED，不能当成代码残缺。",
      "每个分支只纳入对应 group 的文件，未跟踪文件必须显式纳入或移出工作区。",
      "每个分支通过自己的最小验证命令后，再合并到发布候选分支。",
      "最终发布候选分支运行 npm.cmd run delivery:acceptance、npm.cmd run release:gate、npm.cmd run delivery:handoff。",
      "最终 release gate 只能剩余外部密钥、预发布数据库、Redis 队列、真实渠道、Windows 签名等外部 BLOCKED；不得有 FAIL。",
      "个人微信相关改动只能作为 legacy compatibility，不能成为生产客服通道。",
    ],
  };
}

function normalizeGroup(group) {
  const paths = Array.isArray(group?.paths) ? group.paths.map(String).filter(Boolean) : [];
  const allPaths = Array.isArray(group?.allPaths) ? group.allPaths.map(String).filter(Boolean) : paths;
  return {
    id: String(group?.id || "other"),
    label: String(group?.label || group?.id || "Other repository changes"),
    risk: String(group?.risk || "low"),
    count: numberValue(group?.count),
    untracked: numberValue(group?.untracked),
    modified: numberValue(group?.modified),
    paths,
    allPaths,
  };
}

function normalizeLocalDeliveryVerdict(handoff, summary) {
  const source = handoff.localDeliveryVerdict && typeof handoff.localDeliveryVerdict === "object"
    ? handoff.localDeliveryVerdict
    : {};
  const externalBlockerCount = numberValue(source.externalBlockerCount ?? handoff.summary?.externalBlockers);
  const inferredState = handoff.readiness === "internal-verified-external-blocked"
    ? "local_verified_external_blocked"
    : summary.statusEntryCount > 0
      ? "release_scope_unfrozen"
      : "unknown";
  const state = String(source.state || inferredState);
  return {
    state,
    localEvidenceReady: source.localEvidenceReady === true || state === "local_verified" || state === "local_verified_external_blocked",
    releaseScopeFrozen: summary.statusEntryCount === 0 && summary.untrackedCount === 0,
    productionReleaseAllowed: source.productionReleaseAllowed === true && summary.statusEntryCount === 0 && externalBlockerCount === 0,
    localCodeDefectCount: numberValue(source.localCodeDefectCount),
    externalBlockerCount,
    summary: String(source.summary || (
      state === "local_verified_external_blocked"
        ? "Local delivery evidence is usable; production release is still blocked by external proof."
        : "Release candidate scope must be frozen and local evidence must be refreshed before production release."
    )),
  };
}

function buildBranchPlan(blueprint, groupById, allGroups = []) {
  const groups = blueprint.groupIds.map((id) => groupById.get(id)).filter(Boolean);
  const statusEntryCount = groups.reduce((total, group) => total + group.count, 0);
  const untrackedCount = groups.reduce((total, group) => total + group.untracked, 0);
  const modifiedCount = groups.reduce((total, group) => total + group.modified, 0);
  const risk = groups.some((group) => group.risk === "high") ? "high" : groups.some((group) => group.risk === "medium") ? "medium" : "low";
  const executionScope = blueprint.id === "foundation_governance"
    ? buildFoundationExecutionScope(allGroups.length ? allGroups : groups)
    : null;
  return {
    id: blueprint.id,
    branchName: blueprint.branchName,
    title: blueprint.title,
    priority: blueprint.priority,
    decision: blueprint.decision,
    risk,
    groupIds: groups.map((group) => group.id),
    statusEntryCount,
    untrackedCount,
    modifiedCount,
    groups,
    paths: uniqueSortedPaths(groups.flatMap((group) => group.allPaths)),
    verificationCommands: blueprint.verificationCommands,
    blockers: blueprint.blockers,
    scopeGuidance: blueprint.scopeGuidance || [],
    ...(executionScope ? { executionScope } : {}),
    readyToFreeze: statusEntryCount > 0 && untrackedCount === 0 && (!executionScope || executionScope.readyToIsolate),
  };
}

function buildFoundationExecutionScope(groups) {
  const allPaths = uniqueSortedPaths(groups.flatMap((group) => group.allPaths));
  const directPaths = [];
  const mixedPaths = [];
  const deferredPaths = [];
  for (const filePath of allPaths) {
    const normalizedPath = String(filePath).replace(/\\/g, "/");
    const lowerPath = normalizedPath.toLowerCase();
    if (FOUNDATION_DEFERRED_PATHS.has(normalizedPath)) deferredPaths.push(normalizedPath);
    else if (FOUNDATION_DIRECT_PATHS.has(normalizedPath)) directPaths.push(normalizedPath);
    else if (FOUNDATION_MIXED_PATHS.has(normalizedPath)) mixedPaths.push(normalizedPath);
    else if (FOUNDATION_DIRECT_PATH_PATTERNS.some((pattern) => pattern.test(lowerPath))) directPaths.push(normalizedPath);
    else deferredPaths.push(normalizedPath);
  }
  const mixedFiles = mixedPaths.map((filePath) => ({
    path: filePath,
    isolationMode: "edited-hunk-required",
    include: FOUNDATION_MIXED_GUIDANCE[filePath]?.include || "只纳入基础治理相关变更块。",
    defer: FOUNDATION_MIXED_GUIDANCE[filePath]?.defer || "其他产品范围变更全部延期。",
  }));
  return {
    selectionBasis: "entire-status-inventory",
    decision: mixedPaths.length > 0 ? "split-shared-files-before-isolation" : "direct-paths-ready-for-isolation",
    readyToIsolate: directPaths.length > 0 && mixedPaths.length === 0,
    directCount: directPaths.length,
    mixedCount: mixedPaths.length,
    deferredCount: deferredPaths.length,
    directPaths,
    mixedPaths,
    mixedFiles,
    deferredPaths,
    rule: "Only directPaths belong wholly to foundation governance. mixedPaths require hunk-level review; every other current change is deferred from this batch.",
  };
}

function uniqueSortedPaths(paths) {
  return [...new Set(paths.map(String).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function summarizeBranches(branchPlans, scope = {}) {
  const statusEntryCount = numberValue(scope.statusEntryCount);
  const modifiedCount = numberValue(scope.modifiedCount);
  const untrackedCount = numberValue(scope.untrackedCount);
  return {
    branchCount: branchPlans.length,
    statusEntryCount,
    modifiedCount,
    untrackedCount,
    highRiskBranches: branchPlans.filter((branch) => branch.risk === "high").length,
    compatibilityOnlyBranches: branchPlans.filter((branch) => branch.decision.includes("compatibility-only")).length,
    requiresCleanReleaseWorkspace: scope.requiresCleanReleaseWorkspace !== false,
    statusEntriesAvailable: scope.statusEntriesAvailable === true,
  };
}

function renderMarkdown(plan) {
  const lines = [
    "# Local Delivery Verdict",
    "",
    `- state: \`${plan.localDeliveryVerdict.state}\``,
    `- summary: ${plan.localDeliveryVerdict.summary}`,
    `- local evidence ready: ${plan.localDeliveryVerdict.localEvidenceReady}`,
    `- release scope frozen: ${plan.localDeliveryVerdict.releaseScopeFrozen}`,
    `- local code defects: ${plan.localDeliveryVerdict.localCodeDefectCount}`,
    `- external blockers: ${plan.localDeliveryVerdict.externalBlockerCount}`,
    `- production release allowed: ${plan.localDeliveryVerdict.productionReleaseAllowed}`,
    "",
    "# 发布候选冻结计划",
    "",
    `- 状态：**${plan.status}**`,
    `- 生成时间：${plan.generatedAt}`,
    `- handoff：\`${plan.sourceHandoff.path || "unknown"}\``,
    `- 候选改动：${plan.summary.statusEntryCount}；已修改：${plan.summary.modifiedCount}；未跟踪：${plan.summary.untrackedCount}`,
    `- 分支数：${plan.summary.branchCount}；高风险分支：${plan.summary.highRiskBranches}`,
    "",
    "## 分支计划",
    "",
  ];
  for (const branch of plan.branchPlans) {
    lines.push(`### ${branch.priority}. ${branch.title}`, "");
    lines.push(`- branch: \`${branch.branchName}\``);
    lines.push(`- decision: \`${branch.decision}\``);
    lines.push(`- risk: \`${branch.risk}\``);
    lines.push(`- groups: ${branch.groupIds.map((id) => `\`${id}\``).join(", ")}`);
    lines.push(`- changes: ${branch.statusEntryCount}; modified=${branch.modifiedCount}; untracked=${branch.untrackedCount}`);
    lines.push("- scope guidance:");
    for (const guidance of branch.scopeGuidance) lines.push(`  - ${guidance}`);
    lines.push("- verification:");
    for (const command of branch.verificationCommands) lines.push(`  - \`${command}\``);
    lines.push("- blockers:");
    for (const blocker of branch.blockers) lines.push(`  - ${blocker}`);
    if (branch.executionScope) {
      lines.push("- executable scope:");
      lines.push(`  - decision: \`${branch.executionScope.decision}\``);
      lines.push(`  - ready to isolate: ${branch.executionScope.readyToIsolate}`);
      lines.push(`  - direct=${branch.executionScope.directCount}; mixed=${branch.executionScope.mixedCount}; deferred=${branch.executionScope.deferredCount}`);
      lines.push("  - 本批直接纳入:");
      for (const filePath of branch.executionScope.directPaths) lines.push(`    - \`${filePath}\``);
      lines.push("  - 必须按变更块拆分:");
      for (const file of branch.executionScope.mixedFiles) {
        lines.push(`    - \`${file.path}\``);
        lines.push(`      - 纳入: ${file.include}`);
        lines.push(`      - 延期: ${file.defer}`);
      }
      lines.push(`  - 本批延期: ${branch.executionScope.deferredCount} 个文件；除上述 direct/mixed 外的当前改动全部延期。`);
    }
    lines.push("- path samples:");
    for (const group of branch.groups) {
      lines.push(`  - ${group.label}:`);
      for (const filePath of group.paths.slice(0, 8)) lines.push(`    - \`${filePath}\``);
    }
    lines.push("");
  }
  lines.push("## 全局退出条件", "");
  for (const criterion of plan.globalExitCriteria) lines.push(`- ${criterion}`);
  return `${lines.join("\n")}\n`;
}

function writeReports(plan, reportRoot = defaultReportRoot) {
  fs.mkdirSync(reportRoot, { recursive: true });
  const runId = `freeze-plan-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
  const jsonPath = path.join(reportRoot, `${runId}.json`);
  const markdownPath = path.join(reportRoot, `${runId}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(plan), "utf8");
  fs.copyFileSync(jsonPath, path.join(reportRoot, "latest.json"));
  fs.copyFileSync(markdownPath, path.join(reportRoot, "latest.md"));
  return { runId, jsonPath, markdownPath, latestJson: path.join(reportRoot, "latest.json"), latestMarkdown: path.join(reportRoot, "latest.md") };
}

function relativeToDesktop(filePath) {
  const relative = path.relative(desktopRoot, path.resolve(filePath));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative.replace(/\\/g, "/") : String(filePath).replace(/\\/g, "/");
}

function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function printHelp() {
  process.stdout.write([
    "Usage: node tools/release-candidate-freeze-plan.js [--handoff <path>] [--output-root <dir>]",
    "",
    "Generates a read-only release candidate freeze plan from delivery-handoff/latest.json.",
    "",
  ].join("\n"));
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  const handoff = loadHandoff(options.handoffPath);
  const plan = buildFreezePlan(handoff, { handoffPath: options.handoffPath });
  const artifacts = writeReports(plan, options.reportRoot);
  process.stdout.write(`[release-candidate-freeze-plan] status=${plan.status} branches=${plan.summary.branchCount} changes=${plan.summary.statusEntryCount} untracked=${plan.summary.untrackedCount}\n`);
  process.stdout.write(`[release-candidate-freeze-plan] report=${artifacts.latestMarkdown}\n`);
  process.exitCode = EXIT_CODE[plan.status];
}

if (require.main === module) main();

module.exports = {
  BRANCH_BLUEPRINTS,
  SCHEMA_VERSION,
  STATUS,
  buildFreezePlan,
  parseArgs,
  renderMarkdown,
  writeReports,
};
