"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveRepositoryState } = require("./repository-provenance");

const SCHEMA_VERSION = "smart_kefu_delivery_handoff_bundle_v1";
const STATUS = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", FAIL: "FAIL" });
const STATUS_RANK = Object.freeze({ PASS: 0, BLOCKED: 1, FAIL: 2 });
const EXIT_CODE = Object.freeze({ PASS: 0, BLOCKED: 2, FAIL: 1 });

const desktopRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(desktopRoot, "..");
const defaultRuntimeRoot = path.join(desktopRoot, ".runtime");
const defaultReportRoot = path.join(defaultRuntimeRoot, "delivery-handoff");

const EXTERNAL_ACTIONS = Object.freeze({
  "external.windows_signing": {
    owner: "release operator",
    phase: "after internal release candidate is frozen",
    actions: [
      "Build the Windows package from a clean release workspace.",
      "Sign the installer and unpacked executable with the company code-signing certificate.",
      "Run package verification on a target Windows machine and capture install, uninstall and SmartScreen evidence.",
    ],
    evidence: ["signed package verification report", "target-machine install screenshots or logs"],
  },
  "external.staging": {
    owner: "deployment operator",
    phase: "after ICP/public domain and staging secrets are ready",
    actions: [
      "Configure NODE_ENV, Prisma PostgreSQL, Redis durable automation, internal API token and public HTTPS base URL.",
      "Run staging readiness in read-only execute mode against the staging API.",
      "Confirm API health, migrations, automation readiness and channel audit evidence without sending messages.",
    ],
    evidence: ["staging-readiness report with read-only execute mode"],
  },
  "external.channels": {
    owner: "channel operator",
    phase: "after Enterprise WeChat and design platform credentials are available",
    actions: [
      "Bind Enterprise WeChat customer-service callback to the ICP-approved HTTPS domain.",
      "Verify encrypted callback acceptance, inbound audit, mapped customer identity and controlled send-queue audit.",
      "Verify design-platform readiness with real credentials without submitting a formal design job during read-only checks.",
    ],
    evidence: ["Enterprise WeChat callback audit", "design platform readiness report"],
  },
  "external.database_recovery": {
    owner: "database operator",
    phase: "before production cutover",
    actions: [
      "Provide an isolated rehearsal database target and explicit execution confirmation.",
      "Run the database recovery rehearsal against the isolated target.",
      "Capture backup digest, restore result, migration status and consistency evidence without retaining secrets.",
    ],
    evidence: ["database recovery rehearsal report"],
  },
});

function aggregateStatus(items) {
  return items.reduce((current, item) => (
    STATUS_RANK[item.status] > STATUS_RANK[current] ? item.status : current
  ), STATUS.PASS);
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function pathExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readJsonIfPresent(filePath) {
  if (!pathExists(filePath)) return { present: false, filePath };
  try {
    return { present: true, filePath, report: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch {
    return { present: true, filePath, error: "unreadable_json" };
  }
}

function relativeToDesktop(filePath, root = desktopRoot) {
  if (!filePath) return "";
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? normalizePath(relative)
    : normalizePath(filePath);
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function summarizeReleaseCandidateScope(repoState = {}) {
  const entries = Array.isArray(repoState.statusEntries)
    ? repoState.statusEntries.map(normalizeStatusEntry).filter((entry) => entry.path)
    : [];
  const groups = new Map();
  for (const entry of entries) {
    const group = classifyReleaseCandidatePath(entry.path);
    const existing = groups.get(group.id) || {
      id: group.id,
      label: group.label,
      risk: group.risk,
      count: 0,
      untracked: 0,
      modified: 0,
      paths: [],
      allPaths: [],
    };
    existing.count += 1;
    if (entry.status === "??") existing.untracked += 1;
    else existing.modified += 1;
    existing.allPaths.push(entry.path);
    if (existing.paths.length < 12) existing.paths.push(entry.path);
    groups.set(group.id, existing);
  }
  const grouped = [...groups.values()].sort((left, right) => (
    left.risk === right.risk
      ? left.id.localeCompare(right.id)
      : riskRank(right.risk) - riskRank(left.risk)
  ));
  return {
    requiresCleanReleaseWorkspace: repoState.clean !== true,
    statusEntriesAvailable: Array.isArray(repoState.statusEntries),
    statusEntryCount: entries.length,
    untrackedCount: entries.filter((entry) => entry.status === "??").length,
    modifiedCount: entries.filter((entry) => entry.status !== "??").length,
    groups: grouped,
    riskNotes: buildReleaseCandidateRiskNotes(grouped, repoState.clean === true),
  };
}

function normalizeStatusEntry(entry) {
  const status = String(entry?.status || "").trim() || "unknown";
  const normalizedPath = normalizePath(entry?.path || "").replace(/^\/+/, "");
  return { status, path: normalizedPath };
}

function classifyReleaseCandidatePath(filePath) {
  const value = normalizePath(filePath).toLowerCase();
  if (value.includes("/personal-wechat") || value.includes("personal-wechat-")) {
    return { id: "legacy_personal_wechat", label: "Legacy personal WeChat compatibility", risk: "high" };
  }
  if (value.includes("/wechat-work") || value.includes("wechat-work-")) {
    return { id: "enterprise_wechat", label: "Enterprise WeChat production channel", risk: "high" };
  }
  if (value.includes("/features/integrations/") || value.includes("/app/integrations/wechat-work/")) {
    return { id: "enterprise_wechat", label: "Enterprise WeChat production channel", risk: "high" };
  }
  if (value.includes("/wechat/") || value.includes("send-") || value.includes("/send/")) {
    return { id: "send_and_messaging", label: "Send queue and messaging safety", risk: "high" };
  }
  if (value.includes("/orders") || value.includes("/quotes") || value.includes("/sales/") || value.includes("payment")) {
    return { id: "commerce", label: "Commerce quotes, payment proof and orders", risk: "high" };
  }
  if (value.includes("/design") || value.includes("design-")) {
    return { id: "design_platform", label: "Design jobs and asset workflow", risk: "high" };
  }
  if (value.includes("/training") || value.includes("/agents") || value.includes("/ai/") || value.includes("ai-")) {
    return { id: "training_agent_ai", label: "Training, Agent and AI configuration", risk: "medium" };
  }
  if (value.includes("/automation") || value.includes("automation-")) {
    return { id: "automation", label: "Automation and durable scheduling", risk: "medium" };
  }
  if (value.includes("/prisma/") || value.includes("database") || value.includes("migration")) {
    return { id: "database", label: "Database schema and recovery", risk: "high" };
  }
  if (value.includes("/tools/") || value.includes("/tests/") || value.includes("/docs/") || value.endsWith("package.json")) {
    return { id: "delivery_evidence", label: "Delivery, tests and release evidence", risk: "medium" };
  }
  if (value.includes("/apps/web/") || value.includes("/components/") || value.includes("/features/")) {
    return { id: "web_workbench", label: "Web workbench UI", risk: "medium" };
  }
  if (value.includes("/packages/runtime") || value.includes("/apps/electron")) {
    return { id: "desktop_runtime", label: "Desktop runtime and packaging", risk: "medium" };
  }
  return { id: "other", label: "Other repository changes", risk: "low" };
}

function riskRank(value) {
  return { high: 3, medium: 2, low: 1 }[value] || 0;
}

function buildReleaseCandidateRiskNotes(groups, clean) {
  const notes = [];
  if (!clean) {
    notes.push("Release packaging must be done from a clean, frozen worktree; current repository changes are for handoff scope only.");
  }
  if (groups.some((group) => group.id === "legacy_personal_wechat")) {
    notes.push("Legacy personal WeChat changes must remain compatibility-only and must not become the production channel.");
  }
  if (groups.some((group) => group.risk === "high")) {
    notes.push("High-risk groups need targeted product acceptance or release-gate evidence before they are included in a release candidate.");
  }
  if (groups.some((group) => group.untracked > 0)) {
    notes.push("Untracked files must be explicitly included or excluded before a release branch is frozen.");
  }
  return notes;
}

function latestAcceptanceReport(runtimeRoot) {
  const acceptanceRoot = path.join(runtimeRoot, "acceptance");
  if (!fs.existsSync(acceptanceRoot)) return { present: false, filePath: path.join(acceptanceRoot, "product-acceptance-report.json") };
  const matches = [];
  const stack = [acceptanceRoot];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile() && entry.name === "product-acceptance-report.json") {
        matches.push({ filePath: target, mtimeMs: fs.statSync(target).mtimeMs });
      }
    }
  }
  matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return matches.length ? readJsonIfPresent(matches[0].filePath) : { present: false, filePath: path.join(acceptanceRoot, "product-acceptance-report.json") };
}

function summarizeGenericReport(id, label, loaded, options = {}) {
  if (!loaded.present) {
    return {
      id,
      label,
      status: options.missingStatus || STATUS.BLOCKED,
      summary: "No local report was found.",
      path: relativeToDesktop(loaded.filePath, options.desktopRoot),
      generatedAt: "",
      runId: "",
      counts: {},
      completionVerdict: null,
      required: options.required === true,
      failureDomain: options.failureDomain === "external" ? "external" : "local",
    };
  }
  if (loaded.error || !loaded.report || typeof loaded.report !== "object") {
    return {
      id,
      label,
      status: STATUS.FAIL,
      summary: "The local report exists but cannot be parsed as JSON.",
      path: relativeToDesktop(loaded.filePath, options.desktopRoot),
      generatedAt: "",
      runId: "",
      counts: {},
      completionVerdict: null,
      required: options.required === true,
      failureDomain: options.failureDomain === "external" ? "external" : "local",
    };
  }
  const reportStatus = Object.values(STATUS).includes(loaded.report.status) ? loaded.report.status : STATUS.FAIL;
  return {
    id,
    label,
    status: reportStatus,
    summary: loaded.report.summary
      ? `summary pass=${loaded.report.summary.pass ?? loaded.report.summary.passed ?? "-"} blocked=${loaded.report.summary.blocked ?? "-"} fail=${loaded.report.summary.fail ?? loaded.report.summary.failed ?? "-"}`
      : `status=${reportStatus}`,
    path: relativeToDesktop(loaded.filePath, options.desktopRoot),
    generatedAt: String(loaded.report.generatedAt || loaded.report.finishedAt || ""),
    runId: String(loaded.report.runId || ""),
    counts: summarizeCounts(loaded.report),
    completionVerdict: loaded.report.completionVerdict && typeof loaded.report.completionVerdict === "object"
      ? loaded.report.completionVerdict
      : null,
    required: options.required === true,
    failureDomain: options.failureDomain === "external" ? "external" : "local",
  };
}

function summarizeReleaseGate(loaded, options = {}) {
  const generic = summarizeGenericReport("release.gate", "Production release gate", loaded, {
    ...options,
    missingStatus: STATUS.BLOCKED,
    required: false,
  });
  if (!loaded.present || loaded.error || !loaded.report || typeof loaded.report !== "object") return generic;
  if (loaded.report.completed === false && generic.status === STATUS.FAIL) {
    return {
      ...generic,
      status: STATUS.BLOCKED,
      summary: loaded.report.currentStage
        ? `incomplete release gate stopped at ${loaded.report.currentStage}; rerun before release`
        : "incomplete release gate; rerun before release",
    };
  }
  return generic;
}

function summarizeCounts(report) {
  if (report?.counts && typeof report.counts === "object") {
    return {
      pass: Number(report.counts.PASS ?? report.counts.pass ?? 0),
      blocked: Number(report.counts.BLOCKED ?? report.counts.blocked ?? 0),
      fail: Number(report.counts.FAIL ?? report.counts.fail ?? 0),
    };
  }
  if (report?.summary && typeof report.summary === "object") {
    return {
      pass: Number(report.summary.pass ?? report.summary.passed ?? 0),
      blocked: Number(report.summary.blocked ?? 0),
      fail: Number(report.summary.fail ?? report.summary.failed ?? 0),
      skipped: Number(report.summary.skipped ?? 0),
      total: Number(report.summary.total ?? 0),
    };
  }
  return {};
}

function acceptsInternalPaymentLedger(report) {
  return report?.safety?.policy?.paymentMutation === "external_forbidden_internal_ledger_allowed";
}

function summarizeAcceptance(loaded, options = {}) {
  const generic = summarizeGenericReport("product.acceptance", "Local product acceptance", loaded, {
    ...options,
    missingStatus: STATUS.BLOCKED,
    required: true,
  });
  if (!loaded.report || loaded.error || !loaded.present) return generic;
  const failed = Number(loaded.report.summary?.failed || 0);
  const blocked = Number(loaded.report.summary?.blocked || 0);
  const safetyViolations = Array.isArray(loaded.report.safety?.actual?.safetyViolations)
    ? loaded.report.safety.actual.safetyViolations
    : [];
  const status = failed > 0 || safetyViolations.length > 0
    ? STATUS.FAIL
    : blocked > 0 ? STATUS.BLOCKED : STATUS.PASS;
  return {
    ...generic,
    status,
    summary: `local-safe acceptance passed=${Number(loaded.report.summary?.passed || 0)} failed=${failed} blocked=${blocked} skipped=${Number(loaded.report.summary?.skipped || 0)}`,
    matrixVersion: String(loaded.report.matrixVersion || ""),
    requestedMode: String(loaded.report.requestedMode || ""),
    executedModes: Array.isArray(loaded.report.executedModes) ? loaded.report.executedModes.map(String) : [],
    safety: {
      realSendEnabled: loaded.report.safety?.actual?.realSendEnabled === true,
      paymentMutationEnabled: loaded.report.safety?.actual?.paymentMutationEnabled === true,
      paymentBoundary: String(loaded.report.safety?.policy?.paymentMutation || ""),
      internalPaymentLedgerAllowed: acceptsInternalPaymentLedger(loaded.report),
      externalMutationCount: Number(loaded.report.safety?.actual?.externalMutationCount || 0),
      safetyViolationCount: safetyViolations.length,
    },
  };
}

function extractExternalBlockers(projectAudit) {
  const results = Array.isArray(projectAudit?.results) ? projectAudit.results : [];
  const blockers = results.filter((item) => (
    item?.status === STATUS.BLOCKED
    && (String(item.id || "").startsWith("external.") || item?.evidence?.external === true)
  ));
  const normalized = blockers.length ? blockers : Object.keys(EXTERNAL_ACTIONS).map((id) => ({
    id,
    title: id,
    status: STATUS.BLOCKED,
    summary: "External evidence is still required.",
    evidence: { external: true },
  }));
  return normalized.map((item) => {
    const action = EXTERNAL_ACTIONS[item.id] || {
      owner: "operator",
      phase: "before production release",
      actions: ["Collect the missing external evidence and rerun the relevant release gate."],
      evidence: ["external evidence report"],
    };
    return {
      id: String(item.id || ""),
      title: String(item.title || item.id || ""),
      status: STATUS.BLOCKED,
      summary: String(item.summary || ""),
      owner: action.owner,
      phase: action.phase,
      actionItems: action.actions,
      requiredEvidence: action.evidence,
    };
  });
}

function buildCommandPlan() {
  return [
    {
      stage: "Local contract audit",
      command: "npm run delivery:audit",
      purpose: "Refresh the offline completion audit after code changes.",
    },
    {
      stage: "Mock/local-safe acceptance",
      command: "npm run ports:start:mock",
      purpose: "Start the local Web/API/mock design stack.",
    },
    {
      stage: "Mock/local-safe acceptance",
      command: "npm run ports:status:mock",
      purpose: "Confirm local runtime ports and health before acceptance.",
    },
    {
      stage: "Mock/local-safe acceptance",
      command: "npm run delivery:acceptance",
      purpose: "Run the product acceptance matrix without real sends or external mutations.",
    },
    {
      stage: "Handoff bundle",
      command: "npm run delivery:windows-package-preflight",
      purpose: "Refresh the offline Windows package readiness plan without building or signing.",
    },
    {
      stage: "Release candidate freeze",
      command: "npm run delivery:freeze-plan",
      purpose: "Generate the branch split and verification plan before freezing the release candidate.",
    },
    {
      stage: "Handoff bundle",
      command: "npm run delivery:handoff",
      purpose: "Regenerate this handoff bundle from the latest local evidence.",
    },
    {
      stage: "External readiness after ICP",
      command: "npm run delivery:staging-readiness -- --execute",
      purpose: "Run read-only staging probes after domain, secrets and staging database are ready.",
    },
    {
      stage: "External release gate",
      command: "npm run external:evidence:bundle -- --evidence-root <dir> --staging-report <json> --recovery-report <json> --windows-report <json>",
      purpose: "Validate external reports without generating or mutating them.",
    },
  ];
}

function handoffReadiness(reportSummaries, externalBlockers) {
  const project = reportSummaries.find((item) => item.id === "project.completion.audit");
  const acceptance = reportSummaries.find((item) => item.id === "product.acceptance");
  if (reportSummaries.some((item) => item.status === STATUS.FAIL && item.failureDomain !== "external")) return "internal-failed";
  if (project?.status === STATUS.BLOCKED && acceptance?.status === STATUS.PASS && externalBlockers.length > 0) {
    return "internal-verified-external-blocked";
  }
  if (externalBlockers.length > 0) return "external-blocked";
  if (reportSummaries.some((item) => item.status === STATUS.BLOCKED)) return "local-evidence-incomplete";
  return "handoff-ready";
}

function buildLocalDeliveryVerdict(reportSummaries, externalBlockers) {
  const project = reportSummaries.find((item) => item.id === "project.completion.audit");
  const acceptance = reportSummaries.find((item) => item.id === "product.acceptance");
  const failedReports = reportSummaries.filter((item) => item.status === STATUS.FAIL && item.failureDomain !== "external");
  const localCodeDefectCount = Number(project?.completionVerdict?.localCodeDefectCount || 0)
    + failedReports.length;
  const acceptancePassed = acceptance?.status === STATUS.PASS;
  const projectLocallyClean = project?.status === STATUS.PASS
    || project?.completionVerdict?.state === "local_verified_external_blocked"
    || (project?.status === STATUS.BLOCKED && Number(project?.counts?.fail || 0) === 0 && externalBlockers.length > 0);
  let state = "local_evidence_incomplete";
  if (localCodeDefectCount > 0) state = "local_failed";
  else if (projectLocallyClean && acceptancePassed && externalBlockers.length > 0) state = "local_verified_external_blocked";
  else if (projectLocallyClean && acceptancePassed) state = "local_verified";
  return {
    state,
    localEvidenceReady: state === "local_verified" || state === "local_verified_external_blocked",
    productionReleaseAllowed: state === "local_verified" && externalBlockers.length === 0,
    localCodeDefectCount,
    externalBlockerCount: externalBlockers.length,
    externalBlockerIds: externalBlockers.map((item) => item.id),
    requiredLocalReports: {
      projectCompletionAudit: project?.status || "missing",
      productAcceptance: acceptance?.status || "missing",
    },
    summary: localDeliverySummary(state, localCodeDefectCount, externalBlockers.length),
  };
}

function localDeliverySummary(state, localCodeDefectCount, externalBlockerCount) {
  if (state === "local_failed") return `Local delivery is not certifiable: ${localCodeDefectCount} local failure(s) remain.`;
  if (state === "local_verified_external_blocked") return `Local acceptance and completion evidence are usable; ${externalBlockerCount} production blocker(s) require external proof and must not be closed by this tool.`;
  if (state === "local_verified") return "Local delivery evidence is complete and no external blocker was reported.";
  return "Local delivery evidence is incomplete; refresh completion audit, local-safe acceptance, freeze plan and handoff before release.";
}

function normalizeHandoffEvidenceStatus(item) {
  if (item.status === STATUS.FAIL && item.failureDomain === "external") {
    return { ...item, status: STATUS.BLOCKED };
  }
  return item;
}

function assertNoSensitiveValues(report) {
  const serialized = JSON.stringify(report);
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
    /\b(?:postgres(?:ql)?|redis(?:s)?|https?):\/\/[^\s/@:]+:[^\s/@]+@/i,
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
    /super[-_]?secret/i,
    /must-not-enter-report/i,
  ];
  if (patterns.some((pattern) => pattern.test(serialized))) {
    throw new Error("delivery handoff bundle contains a sensitive value");
  }
}

function collectDeliveryHandoffBundle(options = {}) {
  const runtimeRoot = path.resolve(options.runtimeRoot || defaultRuntimeRoot);
  const reportRoot = path.resolve(options.reportRoot || defaultReportRoot);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const runId = options.runId || `handoff-${generatedAt.replace(/[-:.]/g, "").replace("Z", "Z")}-${process.pid}`;
  const repoState = options.repositoryState || resolveRepositoryState({
    repositoryRoot: options.repositoryRoot || repositoryRoot,
    includeStatusEntries: true,
    ...(options.runGitCommand ? { runCommand: options.runGitCommand } : {}),
  });
  const releaseCandidateScope = summarizeReleaseCandidateScope(repoState);

  const projectAudit = readJsonIfPresent(path.join(runtimeRoot, "project-completion-audit", "latest.json"));
  const acceptance = latestAcceptanceReport(runtimeRoot);
  const releaseGate = readJsonIfPresent(path.join(runtimeRoot, "production-release-gate", "latest.json"));
  const freezePlan = readJsonIfPresent(path.join(runtimeRoot, "release-candidate-freeze-plan", "latest.json"));
  const staging = readJsonIfPresent(path.join(runtimeRoot, "staging-readiness-evidence", "latest.json"));
  const recovery = readJsonIfPresent(path.join(runtimeRoot, "database-recovery-rehearsal", "latest.json"));
  const windows = readJsonIfPresent(path.join(runtimeRoot, "windows-package-verification", "latest.json"));
  const internalPaymentLedgerAllowed = acceptsInternalPaymentLedger(acceptance.report);

  const reportSummaries = [
    summarizeGenericReport("project.completion.audit", "Project completion audit", projectAudit, {
      missingStatus: STATUS.FAIL,
      required: true,
      desktopRoot,
    }),
    summarizeAcceptance(acceptance, { desktopRoot }),
    summarizeReleaseGate(releaseGate, { desktopRoot }),
    summarizeGenericReport("release.freeze_plan", "Release candidate freeze plan", freezePlan, {
      missingStatus: STATUS.BLOCKED,
      required: false,
      desktopRoot,
    }),
    summarizeGenericReport("staging.readiness", "Staging readiness evidence", staging, {
      missingStatus: STATUS.BLOCKED,
      required: false,
      failureDomain: "external",
      desktopRoot,
    }),
    summarizeGenericReport("database.recovery", "Database recovery rehearsal", recovery, {
      missingStatus: STATUS.BLOCKED,
      required: false,
      failureDomain: "external",
      desktopRoot,
    }),
    summarizeGenericReport("windows.package", "Windows package verification", windows, {
      missingStatus: STATUS.BLOCKED,
      required: false,
      failureDomain: "external",
      desktopRoot,
    }),
  ];

  const externalBlockers = extractExternalBlockers(projectAudit.report);
  const handoffEvidence = reportSummaries.map(normalizeHandoffEvidenceStatus);
  const status = aggregateStatus([...handoffEvidence, ...externalBlockers]);
  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    runId,
    status,
    readiness: handoffReadiness(reportSummaries, externalBlockers),
    localDeliveryVerdict: buildLocalDeliveryVerdict(reportSummaries, externalBlockers),
    repository: {
      revision: String(repoState.revision || ""),
      clean: repoState.clean === true,
      statusEntryCount: releaseCandidateScope.statusEntryCount,
    },
    releaseCandidateScope,
    productScope: {
      productionChannel: "enterprise_wechat",
      legacyPersonalWechatProductionCore: false,
      icpPending: true,
    },
    safety: {
      localReportsRead: true,
      gitMetadataCommandExecuted: options.repositoryState ? false : true,
      networkAttempted: false,
      databaseCommandAttempted: false,
      recoveryAttempted: false,
      realMessageSendAttempted: false,
      paymentMutationAttempted: false,
      externalPaymentMutationAttempted: false,
      internalPaymentLedgerAllowed,
      paymentBoundary: internalPaymentLedgerAllowed
        ? "external-forbidden-internal-ledger-allowed"
        : "payment-mutation-forbidden",
      designJobSubmitted: false,
      externalMutationCount: 0,
      secretsIncluded: false,
    },
    summary: {
      pass: handoffEvidence.filter((item) => item.status === STATUS.PASS).length,
      blocked: handoffEvidence.filter((item) => item.status === STATUS.BLOCKED).length + externalBlockers.length,
      fail: handoffEvidence.filter((item) => item.status === STATUS.FAIL).length,
      externalBlockers: externalBlockers.length,
    },
    reports: reportSummaries,
    externalBlockers,
    commandPlan: buildCommandPlan(),
    artifacts: {
      root: relativeToDesktop(reportRoot, desktopRoot),
      latestJson: relativeToDesktop(path.join(reportRoot, "latest.json"), desktopRoot),
      latestMarkdown: relativeToDesktop(path.join(reportRoot, "latest.zh-CN.md"), desktopRoot),
    },
  };
  assertNoSensitiveValues(report);
  return report;
}

function renderMarkdown(report) {
  const safetyLine = report.safety.internalPaymentLedgerAllowed
    ? "no network, no database command, no recovery, no real message send and no external payment mutation; local-safe acceptance may include an internal payment-proof ledger."
    : "no network, no database command, no recovery, no real message send and no payment mutation.";
  const lines = [
    "# Delivery Handoff Bundle",
    "",
    `- Status: **${report.status}**`,
    `- Readiness: **${report.readiness}**`,
    `- Local delivery verdict: **${report.localDeliveryVerdict.state}**`,
    `- Generated at: ${report.generatedAt}`,
    `- Repository: \`${report.repository.revision}\` clean=${report.repository.clean}`,
    `- Product scope: Enterprise WeChat only; legacy personal WeChat is not a production core.`,
    `- Safety: ${safetyLine}`,
    "",
    "## Local Delivery Verdict",
    "",
    `- Summary: ${markdownEscape(report.localDeliveryVerdict.summary)}`,
    `- Local evidence ready: ${report.localDeliveryVerdict.localEvidenceReady}`,
    `- Local code defects: ${report.localDeliveryVerdict.localCodeDefectCount}`,
    `- External blockers: ${report.localDeliveryVerdict.externalBlockerCount}`,
    `- Production release allowed: ${report.localDeliveryVerdict.productionReleaseAllowed}`,
    "",
    "## Evidence",
    "",
    "| Status | Domain | Evidence | Summary | Path |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const item of report.reports) {
    lines.push(`| ${item.status} | ${item.failureDomain || "local"} | ${markdownEscape(item.label)} | ${markdownEscape(item.summary)} | ${markdownEscape(item.path)} |`);
  }
  lines.push("", "## Release Candidate Scope", "");
  lines.push(`- Clean release workspace required: ${report.releaseCandidateScope.requiresCleanReleaseWorkspace}`);
  lines.push(`- Status entries: ${report.releaseCandidateScope.statusEntryCount} (modified=${report.releaseCandidateScope.modifiedCount}, untracked=${report.releaseCandidateScope.untrackedCount})`);
  if (!report.releaseCandidateScope.statusEntriesAvailable) {
    lines.push("- Git status entries were not available for this bundle.");
  }
  for (const group of report.releaseCandidateScope.groups) {
    lines.push(`- ${group.risk.toUpperCase()} ${group.label}: ${group.count} file(s), untracked=${group.untracked}`);
    for (const filePath of group.paths) lines.push(`  - \`${markdownEscape(filePath)}\``);
  }
  for (const note of report.releaseCandidateScope.riskNotes) lines.push(`- Note: ${markdownEscape(note)}`);
  lines.push("", "## External Blockers", "");
  if (!report.externalBlockers.length) lines.push("- None.");
  for (const blocker of report.externalBlockers) {
    lines.push(`### ${blocker.id}`, "");
    lines.push(`- Owner: ${blocker.owner}`);
    lines.push(`- Phase: ${blocker.phase}`);
    lines.push(`- Summary: ${markdownEscape(blocker.summary)}`);
    for (const action of blocker.actionItems) lines.push(`- Action: ${markdownEscape(action)}`);
    for (const evidence of blocker.requiredEvidence) lines.push(`- Evidence: ${markdownEscape(evidence)}`);
    lines.push("");
  }
  lines.push("## Command Plan", "");
  for (const item of report.commandPlan) {
    lines.push(`- ${item.stage}: \`${item.command}\` - ${markdownEscape(item.purpose)}`);
  }
  lines.push(
    "",
    "## Decision Rule",
    "",
    "- PASS means the local evidence is present and contains no failing result.",
    "- BLOCKED means the remaining work needs external credentials, staging, signing, ICP/domain, target Windows or isolated database evidence.",
    "- FAIL means local implementation or evidence parsing must be fixed before handoff.",
    "- An external-domain evidence row may remain FAIL to expose unsafe staging configuration while the top-level handoff stays BLOCKED; it does not count as a local code defect.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function writeReports(report, root = defaultReportRoot) {
  const runDirectory = path.join(root, "runs", report.runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  const runJson = path.join(runDirectory, "report.json");
  const runMarkdown = path.join(runDirectory, "report.zh-CN.md");
  const latestJson = path.join(root, "latest.json");
  const latestMarkdown = path.join(root, "latest.zh-CN.md");
  fs.writeFileSync(runJson, json, "utf8");
  fs.writeFileSync(runMarkdown, markdown, "utf8");
  fs.writeFileSync(latestJson, json, "utf8");
  fs.writeFileSync(latestMarkdown, markdown, "utf8");
  return { runDirectory, runJson, runMarkdown, latestJson, latestMarkdown };
}

function parseArgs(argv) {
  const options = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node tools/delivery-handoff-bundle.js

Collects the latest local acceptance, audit and external-evidence inventory into
.runtime/delivery-handoff/latest.{json,zh-CN.md}. This command does not access
the network, send messages, mutate external payments, run database commands or
create external evidence. Internal payment-proof ledger evidence may be
summarized from existing local-safe reports.`);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return printHelp();
  const report = collectDeliveryHandoffBundle();
  const artifacts = writeReports(report);
  console.log(`[delivery-handoff] status=${report.status} readiness=${report.readiness} pass=${report.summary.pass} blocked=${report.summary.blocked} fail=${report.summary.fail}`);
  console.log(`[delivery-handoff] report=${artifacts.latestMarkdown}`);
  process.exitCode = EXIT_CODE[report.status];
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[delivery-handoff] FAIL: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = EXIT_CODE.FAIL;
  }
}

module.exports = {
  EXIT_CODE,
  SCHEMA_VERSION,
  STATUS,
  collectDeliveryHandoffBundle,
  extractExternalBlockers,
  parseArgs,
  renderMarkdown,
  summarizeReleaseCandidateScope,
  writeReports,
};
