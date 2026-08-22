import fs from "node:fs";
import path from "node:path";
import { Injectable } from "@nestjs/common";

type DeliveryStatus = "ready" | "blocked" | "failed" | "unknown";

type ReportStatus = "PASS" | "BLOCKED" | "FAIL" | string;

type ProjectAuditResult = {
  id?: string;
  title?: string;
  status?: ReportStatus;
  summary?: string;
  evidence?: {
    path?: string;
    paths?: string[];
    external?: boolean;
    productMode?: string;
  };
};

type ProductAcceptanceResult = {
  id?: string;
  titleZh?: string;
  status?: string;
  errorMessage?: string;
  blockers?: string[];
  evidence?: Record<string, unknown>;
};

type DeliveryReadinessBlocker = {
  id: string;
  title: string;
  status: "blocked" | "failed";
  summary: string;
  source: string;
  external: boolean;
  command?: string;
  ownerHint: string;
  phase: "during_icp" | "after_icp" | "release_gate";
  actionItems: string[];
};

type DeliveryEvidenceReport = {
  id: string;
  label: string;
  available: boolean;
  reportPath: string;
  generatedAt: string;
  status: string;
  mode: string;
  summary: string;
  counts: { pass: number; blocked: number; fail: number; skipped?: number; total?: number };
  command: string;
  external: boolean;
};

type LocalDeliveryVerdict = {
  state: "local_verified" | "local_verified_external_blocked" | "local_evidence_incomplete" | "local_failed";
  label: string;
  summary: string;
  localEvidenceReady: boolean;
  productionReleaseAllowed: boolean;
  localCodeDefectCount: number;
  localEvidenceBlockerCount: number;
  externalBlockerCount: number;
  localEvidenceBlockerIds: string[];
  externalBlockerIds: string[];
  canContinueDuringIcp: boolean;
};

type ReleaseCandidateScopeGroup = {
  id: string;
  label: string;
  risk: "high" | "medium" | "low" | string;
  count: number;
  untracked: number;
  modified: number;
  paths: string[];
};

type ReleaseCandidateScope = {
  available: boolean;
  reportPath: string;
  generatedAt: string;
  status: string;
  requiresCleanReleaseWorkspace: boolean;
  statusEntriesAvailable: boolean;
  statusEntryCount: number;
  untrackedCount: number;
  modifiedCount: number;
  groups: ReleaseCandidateScopeGroup[];
  riskNotes: string[];
};

const LOCAL_SAFE_ACCEPTANCE_COMMAND = "npm.cmd run acceptance:e2e -- --mode local-safe";
const PROJECT_COMPLETION_AUDIT_COMMAND = "npm.cmd run project:completion:audit";
const DELIVERY_HANDOFF_COMMAND = "npm.cmd run delivery:handoff";
const DELIVERY_FREEZE_PLAN_COMMAND = "npm.cmd run delivery:freeze-plan";
const DELIVERY_STAGING_READINESS_COMMAND = "npm.cmd run delivery:staging-readiness";
const DATABASE_RECOVERY_PLAN_COMMAND = "npm.cmd run database:recovery:plan";
const RELEASE_GATE_COMMAND = "npm.cmd run release:gate";
const WINDOWS_PACKAGE_PREFLIGHT_COMMAND = "npm.cmd run delivery:windows-package-preflight";
const DEFAULT_EVIDENCE_MAX_AGE_HOURS = 24;

const EVIDENCE_REPORTS = [
  {
    id: "release_gate",
    label: "生产发布门禁",
    relativePath: "production-release-gate/latest.json",
    command: RELEASE_GATE_COMMAND,
    external: false,
  },
  {
    id: "staging_readiness",
    label: "预发布只读证据",
    relativePath: "staging-readiness-evidence/latest.json",
    command: DELIVERY_STAGING_READINESS_COMMAND,
    external: true,
  },
  {
    id: "database_recovery",
    label: "数据库恢复演练计划",
    relativePath: "database-recovery-rehearsal/latest.json",
    command: DATABASE_RECOVERY_PLAN_COMMAND,
    external: true,
  },
  {
    id: "windows_package",
    label: "Windows 打包预检",
    relativePath: "windows-package-verification/latest.json",
    command: WINDOWS_PACKAGE_PREFLIGHT_COMMAND,
    external: true,
  },
  {
    id: "release_freeze_plan",
    label: "发布候选冻结计划",
    relativePath: "release-candidate-freeze-plan/latest.json",
    command: DELIVERY_FREEZE_PLAN_COMMAND,
    external: false,
  },
  {
    id: "delivery_handoff",
    label: "交付 handoff 包",
    relativePath: "delivery-handoff/latest.json",
    command: DELIVERY_HANDOFF_COMMAND,
    external: false,
  },
] as const;

function blockerGuidance(id: string, source: string, external: boolean) {
  const catalog: Record<string, Pick<DeliveryReadinessBlocker, "ownerHint" | "phase" | "actionItems">> = {
    "external.windows_signing": {
      ownerHint: "发布负责人 / 证书管理员",
      phase: "release_gate",
      actionItems: [
        "准备企业代码签名证书并确认签名机或 CI 机可用。",
        "用正式 Windows 安装包跑安装、卸载和 SmartScreen 证据采集。",
        "把签名证书、安装包哈希和验证报告纳入发布门禁。",
      ],
    },
    "external.staging": {
      ownerHint: "运维负责人 / 后端负责人",
      phase: "after_icp",
      actionItems: [
        "准备独立预发布域名、HTTPS、PostgreSQL、Redis 和只读验证账号。",
        "在隔离环境执行 Prisma 迁移和只读 readiness 证据采集。",
        "预发布报告通过后再进入真实渠道联调。",
      ],
    },
    "external.channels": {
      ownerHint: "企业微信管理员 / 开发负责人",
      phase: "after_icp",
      actionItems: [
        "备案域名通过后配置企业微信客服 HTTPS 回调、Token 和 EncodingAESKey。",
        "填入 CorpID、Secret、OpenKfId，并验证 external_userid 到本地客户会话映射。",
        "先跑只读 preflight，再做受控真实收发验收，禁止离线报告代替真实联调。",
      ],
    },
    "external.database_recovery": {
      ownerHint: "数据库负责人 / 运维负责人",
      phase: "during_icp",
      actionItems: [
        "提供独立 rehearsal 或 sandbox 数据库，不使用生产库。",
        "执行备份、恢复、迁移回滚演练并保存命令输出和报告。",
        "确认恢复演练负责人、库名和时间戳后再关闭此门禁。",
      ],
    },
    "acceptance.local_safe_required": {
      ownerHint: "开发负责人",
      phase: "during_icp",
      actionItems: [
        `运行 ${LOCAL_SAFE_ACCEPTANCE_COMMAND}。`,
        "确认验收报告 failed=0、blocked=0，并保留最新 JSON/Markdown 路径。",
      ],
    },
  };

  if (catalog[id]) return catalog[id];
  if (external) {
    return {
      ownerHint: "项目负责人",
      phase: "after_icp" as const,
      actionItems: [
        "补齐真实账号、域名、证书、回调或环境证据。",
        "生成新的完成度审计和产品验收报告。",
      ],
    };
  }
  return {
    ownerHint: source === "product_acceptance" ? "开发负责人" : "项目负责人",
    phase: "during_icp" as const,
    actionItems: [
      "先修复本地失败项。",
      "重新运行项目完成度审计和 local-safe 产品验收。",
    ],
  };
}

@Injectable()
export class DeliveryReadinessService {
  getReadiness(runtimeDir?: string, platform = process.platform, now = new Date()) {
    // Stable desktop state lives in .runtime-stable, while the repository's
    // delivery/audit commands intentionally write immutable evidence under
    // .runtime.  An explicit directory (used by isolated tests and release
    // readers) remains authoritative; the live service resolves the evidence
    // directory separately so generated reports do not appear to be missing.
    const evidenceRuntimeDir = runtimeDir
      ? path.resolve(runtimeDir)
      : resolveEvidenceRuntimeDir(resolveRuntimeDir());
    const projectAudit = loadProjectAudit(evidenceRuntimeDir);
    const acceptance = loadLatestAcceptance(evidenceRuntimeDir);
    const rawEvidenceReports = loadEvidenceReports(evidenceRuntimeDir);
    const releaseCandidateScope = loadReleaseCandidateScope(evidenceRuntimeDir);
    const freshness = buildEvidenceFreshness(projectAudit, acceptance, rawEvidenceReports, now);
    const staleEvidenceBlockers = evidenceFreshnessBlockers(freshness, rawEvidenceReports);
    const releaseCandidateBlockers = releaseCandidateScopeBlockers(releaseCandidateScope);
    const evidenceBlockers = evidenceReportBlockers(rawEvidenceReports);
    const rawBlockers = [
      ...projectAudit.blockers.filter((item) => !item.external),
      ...acceptance.blockers,
      ...releaseCandidateBlockers,
      ...evidenceBlockers,
      ...staleEvidenceBlockers.filter((item) => !item.external),
      ...projectAudit.blockers.filter((item) => item.external),
      ...staleEvidenceBlockers.filter((item) => item.external),
    ];
    const status = deliveryStatus(projectAudit, acceptance, rawEvidenceReports, rawBlockers);
    const rawRecommendedCommands = recommendedCommandsFor(projectAudit, acceptance, rawEvidenceReports, rawBlockers);
    const localDelivery = buildLocalDeliveryVerdict(projectAudit, acceptance, rawEvidenceReports, rawBlockers);
    const evidenceReports = rawEvidenceReports.map((report) => ({
      ...report,
      command: commandForPlatform(report.command, platform),
    }));
    const blockers = rawBlockers.map((blocker) => ({
      ...blocker,
      command: blocker.command ? commandForPlatform(blocker.command, platform) : undefined,
      actionItems: blocker.actionItems.map((item) => commandForPlatform(item, platform)),
    }));
    const recommendedCommands = rawRecommendedCommands.map((item) => ({
      ...item,
      command: commandForPlatform(item.command, platform),
    }));

    return {
      schema: "smart_kefu_delivery_readiness_v1",
      generatedAt: now.toISOString(),
      mode: "offline_report_inventory",
      networkCalls: false,
      commandsExecuted: false,
      commandEnvironment: {
        platform,
        shell: platform === "win32" ? "windows" : "posix",
        workspace: "development_or_release",
        productionServerExecutionSupported: false,
      },
      status,
      productMode: projectAudit.productMode || "enterprise_wechat_only",
      projectAudit,
      acceptance,
      evidenceReports,
      releaseCandidateScope,
      localDelivery,
      freshness,
      blockers,
      recommendedCommands,
      nextAction: nextAction(status, blockers, recommendedCommands, evidenceReports),
    };
  }
}

function buildEvidenceFreshness(
  projectAudit: ReturnType<typeof loadProjectAudit>,
  acceptance: ReturnType<typeof loadLatestAcceptance>,
  evidenceReports: DeliveryEvidenceReport[],
  now: Date,
) {
  const configuredHours = Number(process.env.DELIVERY_EVIDENCE_MAX_AGE_HOURS || DEFAULT_EVIDENCE_MAX_AGE_HOURS);
  const maxAgeHours = Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : DEFAULT_EVIDENCE_MAX_AGE_HOURS;
  const sources = [
    { id: "project_audit", label: "项目完成度审计", available: projectAudit.available, generatedAt: projectAudit.generatedAt, external: false, command: PROJECT_COMPLETION_AUDIT_COMMAND },
    { id: "product_acceptance", label: "local-safe 产品验收", available: acceptance.available, generatedAt: acceptance.finishedAt || acceptance.startedAt, external: false, command: LOCAL_SAFE_ACCEPTANCE_COMMAND },
    ...evidenceReports.map((report) => ({
      id: report.id,
      label: report.label,
      available: report.available,
      generatedAt: report.generatedAt,
      external: report.external,
      command: report.command,
    })),
  ].map((source) => ({
    ...source,
    stale: source.available && !timestampIsFresh(source.generatedAt, now, maxAgeHours),
  }));
  return {
    checkedAt: now.toISOString(),
    maxAgeHours,
    staleSourceIds: sources.filter((source) => source.stale).map((source) => source.id),
    sources,
  };
}

function timestampIsFresh(value: string, now: Date, maxAgeHours: number) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return false;
  const ageMs = now.getTime() - timestamp;
  return ageMs >= -5 * 60_000 && ageMs <= maxAgeHours * 60 * 60_000;
}

function evidenceFreshnessBlockers(
  freshness: ReturnType<typeof buildEvidenceFreshness>,
  evidenceReports: DeliveryEvidenceReport[],
): DeliveryReadinessBlocker[] {
  return freshness.sources
    .filter((source) => source.stale)
    .map((source) => {
      const evidenceReport = evidenceReports.find((report) => report.id === source.id);
      return {
        id: `evidence_stale.${source.id}`,
        title: `${source.label}已过期`,
        status: "blocked" as const,
        summary: `最新证据时间为 ${source.generatedAt || "未记录"}，超过 ${freshness.maxAgeHours} 小时有效期；旧 PASS 不能继续证明当前版本可交付。`,
        source: "delivery_evidence_freshness",
        external: source.external,
        command: source.command,
        ownerHint: source.external ? "运维负责人 / 外部验收负责人" : "开发负责人 / 发布负责人",
        phase: "release_gate" as const,
        actionItems: [
          `在开发或发布工作区重新运行 ${source.command}。`,
          "刷新交付就绪页，并核对新报告时间、状态和当前发布候选范围。",
          ...(evidenceReport?.external ? ["外部环境证据仍需由对应负责人完成，不能用本地报告替代。"] : []),
        ],
      };
    });
}

function commandForPlatform(value: string, platform: NodeJS.Platform | string) {
  return platform === "win32" ? value : value.replace(/\bnpm\.cmd\b/g, "npm");
}

function resolveRuntimeDir() {
  return path.resolve(process.env.DESKTOP_RUNTIME_DIR || path.resolve(process.cwd(), ".runtime"));
}

function resolveEvidenceRuntimeDir(fallbackRuntimeDir: string) {
  const configured = String(process.env.DELIVERY_EVIDENCE_RUNTIME_DIR || "").trim();
  if (configured) return path.resolve(configured);
  const repositoryEvidenceDir = path.resolve(process.cwd(), ".runtime");
  return fs.existsSync(repositoryEvidenceDir) ? repositoryEvidenceDir : fallbackRuntimeDir;
}

function loadProjectAudit(runtimeDir: string) {
  const reportPath = path.join(runtimeDir, "project-completion-audit", "latest.json");
  const raw = readJson(reportPath);
  const results = Array.isArray(raw?.results) ? raw.results as ProjectAuditResult[] : [];
  const blockers: DeliveryReadinessBlocker[] = results
    .filter((item) => item.status === "BLOCKED" || item.status === "FAIL")
    .map((item) => ({
      id: String(item.id || "project_audit_blocker"),
      title: String(item.title || item.id || "项目审计阻塞项"),
      status: item.status === "FAIL" ? "failed" : "blocked",
      summary: String(item.summary || ""),
      source: "project_completion_audit",
      external: item.evidence?.external === true,
      ...blockerGuidance(
        String(item.id || "project_audit_blocker"),
        "project_completion_audit",
        item.evidence?.external === true,
      ),
    }));
  const productMode = results.find((item) => item.evidence?.productMode)?.evidence?.productMode;

  return {
    available: Boolean(raw),
    reportPath: raw ? repositoryRelative(reportPath) : "",
    generatedAt: String(raw?.generatedAt || ""),
    status: String(raw?.status || "unknown"),
    counts: {
      pass: numberValue(raw?.counts?.PASS),
      blocked: numberValue(raw?.counts?.BLOCKED),
      fail: numberValue(raw?.counts?.FAIL),
    },
    completionVerdict: raw?.completionVerdict && typeof raw.completionVerdict === "object" ? raw.completionVerdict : null,
    safety: raw?.safety || null,
    productMode: typeof productMode === "string" ? productMode : "",
    blockers,
  };
}

function loadLatestAcceptance(runtimeDir: string) {
  const reportPath = latestAcceptanceReportPath(path.join(runtimeDir, "acceptance"));
  const raw = reportPath ? readJson(reportPath) : null;
  const results = Array.isArray(raw?.results) ? raw.results as ProductAcceptanceResult[] : [];
  const blockers: DeliveryReadinessBlocker[] = results
    .filter((item) => item.status === "failed" || item.status === "blocked")
    .map((item) => ({
      id: String(item.id || "acceptance_blocker"),
      title: String(item.titleZh || item.id || "产品验收阻塞项"),
      status: item.status === "failed" ? "failed" : "blocked",
      summary: String(item.errorMessage || ""),
      source: "product_acceptance",
      external: false,
      ...blockerGuidance(String(item.id || "acceptance_blocker"), "product_acceptance", false),
    }));
  const executedModes = Array.isArray(raw?.executedModes) ? raw.executedModes.map(String) : [];
  if (raw && !executedModes.includes("local-safe")) {
    blockers.push({
      id: "acceptance.local_safe_required",
      title: "local-safe 产品验收未执行",
      status: "blocked",
      summary: `最新验收只覆盖 ${executedModes.length ? executedModes.join(", ") : "未知模式"}，必须先运行 ${LOCAL_SAFE_ACCEPTANCE_COMMAND}。`,
      source: "product_acceptance",
      external: false,
      command: LOCAL_SAFE_ACCEPTANCE_COMMAND,
      ...blockerGuidance("acceptance.local_safe_required", "product_acceptance", false),
    });
  }

  return {
    available: Boolean(raw),
    reportPath: raw && reportPath ? repositoryRelative(reportPath) : "",
    runId: String(raw?.runId || ""),
    startedAt: String(raw?.startedAt || ""),
    finishedAt: String(raw?.finishedAt || ""),
    requestedMode: String(raw?.requestedMode || ""),
    executedModes,
    summary: {
      passed: numberValue(raw?.summary?.passed),
      failed: numberValue(raw?.summary?.failed),
      blocked: numberValue(raw?.summary?.blocked),
      skipped: numberValue(raw?.summary?.skipped),
      total: numberValue(raw?.summary?.total),
    },
    safety: raw?.safety || null,
    artifacts: raw?.artifacts || null,
    blockers,
  };
}

function loadEvidenceReports(runtimeDir: string): DeliveryEvidenceReport[] {
  return EVIDENCE_REPORTS.map((definition) => {
    const reportPath = path.join(runtimeDir, ...definition.relativePath.split("/"));
    const raw = readJson(reportPath);
    const counts = reportCounts(raw);
    const status = String(raw?.status || (raw ? "unknown" : "missing"));
    return {
      id: definition.id,
      label: definition.label,
      available: Boolean(raw),
      reportPath: raw ? repositoryRelative(reportPath) : "",
      generatedAt: String(raw?.generatedAt || raw?.finishedAt || ""),
      status,
      mode: String(raw?.mode || raw?.readiness || ""),
      summary: reportSummary(raw, counts),
      counts,
      command: definition.command,
      external: definition.external,
    };
  });
}

function loadReleaseCandidateScope(runtimeDir: string): ReleaseCandidateScope {
  const reportPath = path.join(runtimeDir, "delivery-handoff", "latest.json");
  const raw = readJson(reportPath);
  const scope = raw?.releaseCandidateScope;
  const available = Boolean(raw && scope && typeof scope === "object");
  return {
    available,
    reportPath: raw ? repositoryRelative(reportPath) : "",
    generatedAt: String(raw?.generatedAt || ""),
    status: String(raw?.status || (raw ? "unknown" : "missing")),
    requiresCleanReleaseWorkspace: scope?.requiresCleanReleaseWorkspace === true,
    statusEntriesAvailable: scope?.statusEntriesAvailable === true,
    statusEntryCount: numberValue(scope?.statusEntryCount),
    untrackedCount: numberValue(scope?.untrackedCount),
    modifiedCount: numberValue(scope?.modifiedCount),
    groups: normalizeReleaseCandidateScopeGroups(scope?.groups),
    riskNotes: Array.isArray(scope?.riskNotes) ? scope.riskNotes.map(String).filter(Boolean) : [],
  };
}

function normalizeReleaseCandidateScopeGroups(value: unknown): ReleaseCandidateScopeGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item: any) => ({
      id: String(item.id || "other"),
      label: String(item.label || item.id || "Other repository changes"),
      risk: String(item.risk || "low"),
      count: numberValue(item.count),
      untracked: numberValue(item.untracked),
      modified: numberValue(item.modified),
      paths: Array.isArray(item.paths) ? item.paths.map(String).filter(Boolean).slice(0, 12) : [],
    }));
}

function buildLocalDeliveryVerdict(
  projectAudit: ReturnType<typeof loadProjectAudit>,
  acceptance: ReturnType<typeof loadLatestAcceptance>,
  evidenceReports: DeliveryEvidenceReport[],
  blockers: DeliveryReadinessBlocker[],
): LocalDeliveryVerdict {
  const externalBlockers = blockers.filter((item) => item.external);
  const localBlockers = blockers.filter((item) => !item.external);
  const failedEvidenceReports = evidenceReports.filter((item) => item.status === "FAIL" && !item.external);
  const localCodeDefectCount = projectAudit.counts.fail
    + acceptance.summary.failed
    + failedEvidenceReports.reduce((total, item) => total + item.counts.fail, 0)
    + localBlockers.filter((item) => item.status === "failed").length;
  const localEvidenceBlockers = localBlockers.filter((item) => item.status === "blocked");
  const acceptanceLocalSafe = acceptance.available && acceptance.executedModes.includes("local-safe");
  const projectLocalExternalOnly = projectAudit.available
    && projectAudit.counts.fail === 0
    && projectAudit.blockers.every((item) => item.external);
  let state: LocalDeliveryVerdict["state"] = "local_evidence_incomplete";
  if (localCodeDefectCount > 0) state = "local_failed";
  else if (projectLocalExternalOnly && acceptanceLocalSafe && localEvidenceBlockers.length === 0 && externalBlockers.length > 0) {
    state = "local_verified_external_blocked";
  } else if (projectLocalExternalOnly && acceptanceLocalSafe && localEvidenceBlockers.length === 0) {
    state = "local_verified";
  }
  return {
    state,
    label: localDeliveryLabel(state),
    summary: localDeliverySummary(state, localCodeDefectCount, localEvidenceBlockers.length, externalBlockers.length),
    localEvidenceReady: state === "local_verified" || state === "local_verified_external_blocked",
    productionReleaseAllowed: state === "local_verified" && externalBlockers.length === 0,
    localCodeDefectCount,
    localEvidenceBlockerCount: localEvidenceBlockers.length,
    externalBlockerCount: externalBlockers.length,
    localEvidenceBlockerIds: localEvidenceBlockers.map((item) => item.id),
    externalBlockerIds: externalBlockers.map((item) => item.id),
    canContinueDuringIcp: state !== "local_failed",
  };
}

function localDeliveryLabel(state: LocalDeliveryVerdict["state"]) {
  return {
    local_verified: "本地证据闭环",
    local_verified_external_blocked: "本地已验证，等待外部证据",
    local_evidence_incomplete: "本地证据未闭环",
    local_failed: "本地存在失败项",
  }[state];
}

function localDeliverySummary(
  state: LocalDeliveryVerdict["state"],
  localCodeDefectCount: number,
  localEvidenceBlockerCount: number,
  externalBlockerCount: number,
) {
  if (state === "local_failed") return `仓库内仍有 ${localCodeDefectCount} 个失败项，不能把它解释成外部阻断。`;
  if (state === "local_evidence_incomplete") return `本地交付证据还有 ${localEvidenceBlockerCount} 个阻塞项，需要先补报告、验收或冻结范围。`;
  if (state === "local_verified_external_blocked") return `本地代码与 local-safe 验收未发现失败；剩余 ${externalBlockerCount} 个外部阻断需要真实证据关闭，不是代码残缺。`;
  return "本地交付证据已闭环，且当前报告没有外部阻断。";
}

function releaseCandidateScopeBlockers(scope: ReleaseCandidateScope): DeliveryReadinessBlocker[] {
  if (scope.reportPath && !scope.available) {
    return [{
      id: "release_candidate.scope_missing",
      title: "发布候选范围缺失",
      status: "blocked",
      summary: "交付 handoff 存在，但没有发布候选改动范围，不能判断上线改动是否已冻结。",
      source: "delivery_handoff",
      external: false,
      command: DELIVERY_HANDOFF_COMMAND,
      ownerHint: "开发负责人 / 发布负责人",
      phase: "release_gate",
      actionItems: [
        `运行 ${DELIVERY_HANDOFF_COMMAND} 刷新 handoff。`,
        "确认报告包含改动分组、未跟踪文件数量和风险提示。",
      ],
    }];
  }
  if (!scope.available || !scope.requiresCleanReleaseWorkspace) return [];
  return [{
    id: "release_candidate.clean_workspace_required",
    title: "发布候选工作区尚未冻结",
    status: "blocked",
    summary: `当前候选范围仍有 ${scope.statusEntryCount} 个改动，其中 ${scope.untrackedCount} 个未跟踪文件。`,
    source: "delivery_handoff",
    external: false,
    command: DELIVERY_HANDOFF_COMMAND,
    ownerHint: "开发负责人 / 发布负责人",
    phase: "release_gate",
    actionItems: [
      "逐项决定发布候选分组中的文件是纳入、拆分还是排除。",
      "未跟踪文件必须显式纳入或移出发布候选范围。",
      "冻结干净发布分支或工作区后，重新运行 release gate 和 handoff。",
    ],
  }];
}

function evidenceReportBlockers(reports: DeliveryEvidenceReport[]): DeliveryReadinessBlocker[] {
  return reports
    .filter((report) => !report.available || report.status === "FAIL")
    .map((report) => ({
      id: `evidence.${report.id}`,
      title: `${report.label}${report.available ? "失败" : "未生成"}`,
      status: report.status === "FAIL" && !report.external ? "failed" : "blocked",
      summary: report.available
        ? report.external
          ? `${report.label} 最新报告为 FAIL；这是预发布、签名或恢复环境阻塞，不计为本地代码缺陷。`
          : `${report.label} 最新报告为 FAIL，必须先修复本地证据。`
        : `${report.label} 报告缺失，交付页面不能确认该证据。`,
      source: "delivery_evidence",
      external: report.external,
      command: report.command,
      ownerHint: "开发负责人",
      phase: "during_icp",
      actionItems: [
        `运行 ${report.command}。`,
        "刷新交付 handoff，并确认报告 fail=0。",
      ],
    }));
}

function latestAcceptanceReportPath(acceptanceDir: string) {
  try {
    const candidates = fs.readdirSync(acceptanceDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(acceptanceDir, entry.name, "product-acceptance-report.json"))
      .filter((filePath) => isRegularFile(filePath))
      .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    return candidates[0]?.filePath || "";
  } catch {
    return "";
  }
}

function readJson(filePath: string) {
  try {
    if (!isRegularFile(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isRegularFile(filePath: string) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function deliveryStatus(
  projectAudit: ReturnType<typeof loadProjectAudit>,
  acceptance: ReturnType<typeof loadLatestAcceptance>,
  evidenceReports: DeliveryEvidenceReport[],
  blockers: Array<{ status: string }>,
): DeliveryStatus {
  if (!projectAudit.available && !acceptance.available) return "unknown";
  if (
    projectAudit.counts.fail > 0
    || acceptance.summary.failed > 0
    || evidenceReports.some((item) => item.status === "FAIL" && !item.external)
    || blockers.some((item) => item.status === "failed")
  ) return "failed";
  if (
    projectAudit.counts.blocked > 0
    || acceptance.summary.blocked > 0
    || evidenceReports.some((item) => !item.available || item.status === "BLOCKED" || (item.status === "FAIL" && item.external))
    || blockers.some((item) => item.status === "blocked")
  ) return "blocked";
  if (projectAudit.available && acceptance.available) return "ready";
  return "unknown";
}

function recommendedCommandsFor(
  projectAudit: ReturnType<typeof loadProjectAudit>,
  acceptance: ReturnType<typeof loadLatestAcceptance>,
  evidenceReports: DeliveryEvidenceReport[],
  blockers: Array<{ command?: string }>,
) {
  const commands = [];
  if (!acceptance.available || blockers.some((item) => item.command === LOCAL_SAFE_ACCEPTANCE_COMMAND)) {
    commands.push({
      label: "生成 local-safe 产品验收",
      command: LOCAL_SAFE_ACCEPTANCE_COMMAND,
      reason: "证明本机安全队列、企业微信回调、CRM、自动化和关键 UI 布局都跑通。",
    });
  }
  if (!projectAudit.available) {
    commands.push({
      label: "生成项目完成度审计",
      command: PROJECT_COMPLETION_AUDIT_COMMAND,
      reason: "区分仓库内部失败和备案、签名、真实渠道等外部阻塞。",
    });
  }
  if (projectAudit.counts.fail > 0) {
    commands.push({
      label: "修复后重跑项目完成度审计",
      command: PROJECT_COMPLETION_AUDIT_COMMAND,
      reason: "确认仓库内 FAIL 已清零。",
    });
  }
  for (const report of evidenceReports) {
    if (!report.available || report.status === "FAIL") {
      commands.push({
        label: `${report.label}${report.available ? "失败后重跑" : "生成报告"}`,
        command: report.command,
        reason: report.available ? "清零本地证据 FAIL 后刷新交付状态。" : "补齐交付页面需要的只读本地证据。",
      });
    }
  }
  return commands;
}

function nextAction(
  status: DeliveryStatus,
  blockers: Array<{ external?: boolean; title: string; command?: string }>,
  recommendedCommands: Array<{ command: string }>,
  evidenceReports: DeliveryEvidenceReport[] = [],
) {
  if (status === "ready") return "交付证据已闭环，可以进入正式发布门禁。";
  if (status === "failed") return "先处理失败项并重新生成验收与完成度报告。";
  const internal = blockers.find((item) => !item.external);
  if (internal) return internal.command ? `先处理：${internal.title}；运行：${internal.command}` : `先处理：${internal.title}`;
  const external = blockers.find((item) => item.external);
  if (external) return `等待或准备外部条件：${external.title}`;
  const blockedReport = evidenceReports.find((item) => item.status === "BLOCKED");
  if (blockedReport) return `等待或准备外部条件：${blockedReport.label}`;
  if (recommendedCommands[0]) return `先运行：${recommendedCommands[0].command}`;
  return "先运行产品验收和项目完成度审计，生成可追踪报告。";
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function reportCounts(raw: any) {
  if (!raw) return { pass: 0, blocked: 0, fail: 0, total: 0 };
  if (raw.counts) {
    const pass = numberValue(raw.counts.PASS ?? raw.counts.pass);
    const blocked = numberValue(raw.counts.BLOCKED ?? raw.counts.blocked);
    const fail = numberValue(raw.counts.FAIL ?? raw.counts.fail);
    return { pass, blocked, fail, total: pass + blocked + fail };
  }
  if (raw.summary) {
    const pass = numberValue(raw.summary.pass ?? raw.summary.passed);
    const blocked = numberValue(raw.summary.blocked);
    const fail = numberValue(raw.summary.fail ?? raw.summary.failed);
    return {
      pass,
      blocked,
      fail,
      skipped: numberValue(raw.summary.skipped),
      total: numberValue(raw.summary.total) || pass + blocked + fail,
    };
  }
  const results = Array.isArray(raw.results) ? raw.results : [];
  if (results.length) {
    const pass = results.filter((item: any) => item?.status === "PASS").length;
    const blocked = results.filter((item: any) => item?.status === "BLOCKED").length;
    const fail = results.filter((item: any) => item?.status === "FAIL").length;
    return { pass, blocked, fail, total: results.length };
  }
  return { pass: 0, blocked: 0, fail: 0, total: 0 };
}

function reportSummary(raw: any, counts: { pass: number; blocked: number; fail: number; skipped?: number; total?: number }) {
  if (!raw) return "未生成";
  if (raw.readiness) return `${raw.readiness}; pass=${counts.pass} blocked=${counts.blocked} fail=${counts.fail}`;
  return `status=${String(raw.status || "unknown")}; pass=${counts.pass} blocked=${counts.blocked} fail=${counts.fail}`;
}

function repositoryRelative(filePath: string) {
  const relative = path.relative(path.resolve(process.cwd(), ".."), filePath);
  return relative && !relative.startsWith("..") ? relative.split(path.sep).join("/") : filePath;
}
