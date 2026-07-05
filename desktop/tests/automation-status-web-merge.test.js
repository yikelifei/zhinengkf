"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { mergeAutomationStatusRun } = require("../apps/web/src/lib/api");
const webApi = fs.readFileSync(path.join(__dirname, "../apps/web/src/lib/api.ts"), "utf8");
const webPage = fs.readFileSync(path.join(__dirname, "../apps/web/src/app/page.tsx"), "utf8");
const webCss = fs.readFileSync(path.join(__dirname, "../apps/web/src/app/globals.css"), "utf8");

function baseStatus(overrides = {}) {
  return {
    enabled: true,
    running: true,
    active: true,
    startedAt: "2026-01-01T00:00:00.000Z",
    runningStartedAt: "2026-01-01T00:01:00.000Z",
    nextRunAt: "2026-01-01T00:02:00.000Z",
    intervalMs: 30000,
    processSendQueue: true,
    sendQueueLimit: 5,
    pollLimit: 10,
    runCount: 3,
    lastRun: null,
    recentRuns: [],
    ...overrides,
  };
}

function automationRun(overrides = {}) {
  return {
    trigger: "manual",
    startedAt: "2026-01-01T00:01:00.000Z",
    completedAt: "2026-01-01T00:01:01.000Z",
    durationMs: 1000,
    steps: [],
    errors: [],
    results: {},
    ...overrides,
  };
}

test("web automation status merge records completed run and increments count", () => {
  const run = automationRun();
  const status = mergeAutomationStatusRun(baseStatus(), run, { incrementRunCount: true });

  assert.equal(status.running, false);
  assert.equal(status.runningStartedAt, null);
  assert.equal(status.lastRun, run);
  assert.equal(status.recentRuns[0], run);
  assert.equal(status.runCount, 4);
});

test("web automation status merge does not increment count for skipped run", () => {
  const run = automationRun({
    completedAt: "2026-01-01T00:01:00.000Z",
    skipped: true,
    reason: "automation_already_running",
  });
  const status = mergeAutomationStatusRun(baseStatus(), run, { incrementRunCount: false });

  assert.equal(status.lastRun, run);
  assert.equal(status.recentRuns[0], run);
  assert.equal(status.runCount, 3);
});

test("web automation status merge de-duplicates recent runs and keeps newest first", () => {
  const oldRun = automationRun({ startedAt: "2026-01-01T00:00:30.000Z", completedAt: "2026-01-01T00:00:31.000Z" });
  const run = automationRun();
  const duplicateWithFreshPayload = { ...run, durationMs: 1500 };
  const status = mergeAutomationStatusRun(
    baseStatus({ recentRuns: [oldRun, run] }),
    duplicateWithFreshPayload,
    { incrementRunCount: true },
  );

  assert.equal(status.recentRuns.length, 2);
  assert.equal(status.recentRuns[0], duplicateWithFreshPayload);
  assert.equal(status.recentRuns[1], oldRun);
});

test("web automation readiness checks route to existing repair centers", () => {
  assert.match(webPage, /function handleAutomationReadinessCheck/);
  assert.match(webPage, /function getAutomationReadinessPrimaryCheck/);
  assert.match(webPage, /readiness\.blockers\[0\][\s\S]*readiness\.warnings\[0\][\s\S]*readiness\.checks\.find\(\(check\) => !check\.ok\)/);
  assert.match(webPage, /function handleAutomationReadinessPrimaryCheck/);
  assert.match(webPage, /handleAutomationReadinessCheck\(check\)/);
  assert.match(webPage, /处理首个问题/);
  assert.match(webPage, /check\.key === "sku_catalog"[\s\S]*const firstBlockingRepair = skuRepairQueue\.find[\s\S]*repairSku\(firstBlockingRepair\)[\s\S]*setSkuIssueFilter\(check\.ok \? "ready" : "problem"\)[\s\S]*scrollToWorkspaceSection\("sku-library"\)/);
  assert.match(webPage, /check\.key === "design_platform"[\s\S]*scrollToWorkspaceSection\("design-platform-config"\)/);
  assert.match(webPage, /check\.key === "manual_locks"[\s\S]*const firstLockedConversation = prioritizedManualLockedConversations\[0\][\s\S]*changeActiveConversation\(firstLockedConversation\.id\)[\s\S]*scrollToWorkspaceSection\("review-center"\)/);
  assert.match(webPage, /check\.key === "send_queue"[\s\S]*const firstPendingTask = sendTasks\.find[\s\S]*changeActiveConversation\(firstPendingTask\.conversationId\)[\s\S]*scrollToWorkspaceSection\("send-center"\)/);
  assert.match(webPage, /id="design-platform-config"/);
});

test("web automation history renders identity audit from latest run", () => {
  assert.match(webApi, /identityAudit\?: \{/);
  assert.match(webApi, /status: "passed" \| "warning"/);
  assert.match(webApi, /identities: Array<\{/);
  assert.match(webApi, /warnings: Array<\{ step: string; path: string; reason: string; fields\?: string\[\] \}>/);
  assert.match(webPage, /const lowValueAutomationIdentityAudit = automationStatus\?\.lastRun\?\.identityAudit \|\| null/);
  assert.match(webPage, /aria-label="上一轮自动化身份审计"/);
  assert.match(webPage, /上一轮身份审计有警告/);
  assert.match(webPage, /automationIdentityWarningLabel\(warning\.reason, warning\.fields\)/);
  assert.match(webPage, /identity\.wechatAccountId \|\| "全局账号"/);
  assert.match(webPage, /function automationIdentityWarningLabel/);
  assert.match(webCss, /\.automation-identity-audit/);
  assert.match(webCss, /\.automation-identity-grid/);
});

test("web automation history renders skipped reason summary from latest run", () => {
  assert.match(webApi, /skipSummary\?: \{/);
  assert.match(webApi, /sampleTargets: string\[\]/);
  assert.match(webPage, /const lowValueAutomationSkipSummary = useMemo/);
  assert.match(webPage, /buildAutomationSkipSummaryPanel\(automationStatus\?\.lastRun\)/);
  assert.match(webPage, /aria-label="上一轮自动化跳过原因汇总"/);
  assert.match(webPage, /className="automation-skip-summary"/);
  assert.match(webPage, /lowValueAutomationSkipSummary\.reasons\.map/);
  assert.match(webPage, /function buildAutomationSkipSummaryPanel/);
  assert.match(webPage, /LOW_VALUE_NORMAL_SKIP_REASONS\.has\(item\.reason\) \? "ok" : lowValueIssueTone\(item\.reason\)/);
  assert.match(webPage, /manual_send_attention_required: "发送异常需人工处理"/);
  assert.match(webPage, /打开订单和发送中心，先核对失败\/拦截原因/);
  assert.match(webPage, /const nextStep = lowValueIssueNextStep\(issue\)/);
  assert.match(webPage, /const priority = lowValueIssuePriority\(issue\)/);
  assert.match(webPage, /className=\{`automation-issue-priority \$\{priority\.tone\}`\}/);
  assert.match(webPage, /\{priority\.label\}/);
  assert.match(webPage, /function lowValueIssueNextStep\(issue: LowValueAutomationIssue\)/);
  assert.match(webPage, /function lowValueIssuePriority\(issue: LowValueAutomationIssue\)/);
  assert.match(webPage, /manual_send_attention_required[\s\S]*先处理发送/);
  assert.match(webPage, /conversation_manual_locked[\s\S]*人工接管中/);
  assert.match(webPage, /issue\.tone === "error"[\s\S]*阻断自动化/);
  assert.match(webPage, /人工确认/);
  assert.match(webPage, /issue\.reason === "manual_send_attention_required"[\s\S]*先看发送中心[\s\S]*定位发送/);
  assert.match(webPage, /issue\.reason\.includes\("send_target"\) \|\| issue\.reason\.includes\("order_target"\)[\s\S]*先补发送对象/);
  assert.match(webPage, /issue\.reason === "payment_not_ready"[\s\S]*先核验付款/);
  assert.match(webPage, /className="automation-issue-next"/);
  assert.match(webPage, /\{nextStep\.buttonLabel\}/);
  assert.match(webPage, /function lowValueIssueResolutionPlan\(issues: LowValueAutomationIssue\[\]\)/);
  assert.match(webPage, /const hasOnlySendAttention = hasSendAttention && issues\.every/);
  assert.match(webPage, /resolutionAction: "scan_send_ops" as const[\s\S]*扫发送异常/);
  assert.match(webPage, /resolutionAction: "run_low_value" as const[\s\S]*复跑低价值/);
  assert.match(webPage, /function findLowValueAutomationIssueForMetric\(/);
  assert.match(webPage, /kind === "errors"[\s\S]*issue\.tone === "error"/);
  assert.match(webPage, /kind === "warnings"[\s\S]*issue\.tone === "warning"/);
  assert.match(webPage, /kind === "missing"[\s\S]*issue\.missing\.length/);
  assert.match(webPage, /kind === "sendTargets"[\s\S]*issue\.reason\.includes\("send_target"\)[\s\S]*issue\.missing\.includes\("conversationId"\)/);
  assert.match(webPage, /kind === "manualLocks"[\s\S]*conversation_manual_locked[\s\S]*manualLocked/);
  assert.match(webPage, /const issue = findLowValueAutomationIssueForMetric\(lowValueAutomationIssues, kind\)/);
  assert.match(webPage, /已定位「\$\{lowValueIssueMetricLabel\(kind\)\}」卡点/);
  assert.ok(webPage.includes('const [activeAutomationIssueKey, setActiveAutomationIssueKey] = useState<string>("")'));
  assert.ok(webPage.includes("setActiveAutomationIssueKey(issue.key)"));
  assert.ok(webPage.includes("lowValueAutomationIssues.some((issue) => issue.key === activeAutomationIssueKey)"));
  assert.ok(webPage.includes('setActiveAutomationIssueKey("")'));
  assert.ok(webPage.includes("const issueSelected = activeAutomationIssueKey === issue.key"));
  assert.ok(webPage.includes('aria-current={issueSelected ? "true" : undefined}'));
  assert.ok(webPage.includes('issueSelected ? "selected" : ""'));
  assert.ok(webPage.includes("disabled={Boolean(busy) || !lowValueAutomationIssueSummary.errors}"));
  assert.ok(webPage.includes("disabled={Boolean(busy) || !lowValueAutomationIssueSummary.warnings}"));
  assert.ok(webPage.includes("disabled={Boolean(busy) || !lowValueAutomationIssueSummary.missingFields}"));
  assert.ok(webPage.includes("disabled={Boolean(busy) || !lowValueAutomationIssueSummary.sendTargets}"));
  assert.ok(webPage.includes("disabled={Boolean(busy) || !lowValueAutomationIssueSummary.manualLocks}"));
  assert.match(webPage, /className="automation-issue-resolution"/);
  assert.match(webPage, /lowValueAutomationIssueSummary\.resolutionAction === "scan_send_ops" \? scanSendOps : runLowValueAutomation/);
  assert.match(webCss, /\.automation-issue-resolution/);
  assert.match(webCss, /\.automation-issue-next/);
  assert.match(webCss, /\.automation-issue-item\.selected/);
  assert.match(webCss, /\.automation-issue-priority/);
  assert.match(webCss, /\.automation-issue-priority\.error/);
  assert.match(webCss, /\.automation-skip-summary/);
  assert.match(webCss, /\.automation-skip-grid/);
});

test("web automation summary renders split order confirmation and follow-up stages", () => {
  const summarySection = webPage.slice(
    webPage.indexOf("function buildLowValueAutomationSummary"),
    webPage.indexOf("function lowValueRunSubtitle"),
  );

  assert.match(summarySection, /stageByKey\.get\("orderConfirmation"\)/);
  assert.match(summarySection, /stageByKey\.get\("orderFollowup"\)/);
  assert.match(summarySection, /label: "订单确认"/);
  assert.match(summarySection, /label: "订单跟进"/);
  assert.doesNotMatch(summarySection, /stageByKey\.get\("orderSend"\)/);
  assert.doesNotMatch(summarySection, /label: "确认\/跟进"/);
});

test("web automation send operations summary renders low value auto retry count", () => {
  assert.match(webApi, /autoRetriedLowValue\?: number/);
  assert.match(webPage, /row\.autoRetriedLowValue \|\| 0/);
  assert.match(webPage, /自动重试/);
});

test("web automation step list matches backend queue before send order", () => {
  const stepSection = webPage.slice(
    webPage.indexOf("function buildAutomationStepItems"),
    webPage.indexOf("return stepDefs.map", webPage.indexOf("function buildAutomationStepItems")),
  );
  const timeoutIndex = stepSection.indexOf('key: "scanTimeouts"');
  const pollIndex = stepSection.indexOf('key: "pollActiveResults"');
  const lowValueIndex = stepSection.indexOf('key: "lowValueAutomation"');
  const orderDraftIndex = stepSection.indexOf('key: "scanLowValueOrderDrafts"');
  const orderConfirmationIndex = stepSection.indexOf('key: "scanLowValueOrderConfirmations"');
  const orderFollowupIndex = stepSection.indexOf('key: "scanLowValueOrderFollowups"');
  const sendOpsIndex = stepSection.indexOf('key: "scanSendOperations"');
  const safeSendIndex = stepSection.indexOf('key: "processLowValueSendQueue"');

  assert.ok(timeoutIndex > 0);
  assert.ok(pollIndex > timeoutIndex);
  assert.ok(lowValueIndex > pollIndex);
  assert.ok(orderDraftIndex > lowValueIndex);
  assert.ok(orderConfirmationIndex > orderDraftIndex);
  assert.ok(orderFollowupIndex > orderConfirmationIndex);
  assert.ok(sendOpsIndex > orderFollowupIndex);
  assert.ok(safeSendIndex > sendOpsIndex);
});

test("web automation safe send step detail exposes skipped queue head blocks", () => {
  const detailSection = webPage.slice(
    webPage.indexOf("function describeSafeSendQueueStep"),
    webPage.indexOf("function describeOrderDraftStep"),
  );

  assert.match(detailSection, /row\.skipped\?\.filter\(\(item\) => item\.reason === "not_account_queue_head"\)/);
  assert.match(detailSection, /跳过 \$\{row\.skipped\?\.length \|\| 0\}/);
  assert.match(detailSection, /前序任务卡住 \$\{queueHeadBlocked\}/);
});

test("web manual automation summaries expose safe send skipped queue blocks", () => {
  const lowValueRunSection = webPage.slice(
    webPage.indexOf("async function runLowValueAutomation"),
    webPage.indexOf("async function runAutomationCycle"),
  );
  const automationCycleSection = webPage.slice(
    webPage.indexOf("async function runAutomationCycle"),
    webPage.indexOf("async function toggleAutomationActive"),
  );
  const dealFlowSection = webPage.slice(
    webPage.indexOf("async function progressQuoteDealFlow"),
    webPage.indexOf("async function evaluateCustomerRoute"),
  );

  assert.match(lowValueRunSection, /sendQueue\?\.skipped\.filter\(\(item\) => item\.reason === "not_account_queue_head"\)/);
  assert.match(lowValueRunSection, /安全发送处理 \$\{sendQueue\?\.processed\.length \|\| 0\} 个，跳过 \$\{sendQueue\?\.skipped\.length \|\| 0\} 个/);
  assert.match(lowValueRunSection, /被前序发送任务卡住/);
  assert.match(automationCycleSection, /安全发送处理 \$\{sendQueue\?\.processed\.length \|\| 0\} 个，跳过 \$\{sendQueue\?\.skipped\.length \|\| 0\} 个/);
  assert.match(automationCycleSection, /被前序发送任务卡住/);
  assert.match(dealFlowSection, /queueHeadBlocked: 0/);
  assert.match(dealFlowSection, /sendResult\.skipped\.filter\(\(item\) => item\.reason === "not_account_queue_head"\)\.length/);
  assert.match(dealFlowSection, /其中 \$\{summary\.queueHeadBlocked\} 个被前序发送任务卡住/);
});

test("web automation summary metric actions route split order stages", () => {
  const metricHandlerSection = webPage.slice(
    webPage.indexOf("function handleLowValueAutomationSummaryMetric"),
    webPage.indexOf("function handleAutomationStepItem"),
  );

  assert.match(metricHandlerSection, /label === "订单草稿"/);
  assert.match(metricHandlerSection, /label === "订单确认"/);
  assert.match(metricHandlerSection, /label === "订单跟进"/);
  assert.match(metricHandlerSection, /progressQuoteDealFlow\(\)/);
  assert.doesNotMatch(metricHandlerSection, /确认\/跟进/);
});

test("web low value automation run is blocked by readiness blockers", () => {
  const runSection = webPage.slice(
    webPage.indexOf("async function runLowValueAutomation"),
    webPage.indexOf("async function runAutomationCycle"),
  );
  const blockerIndex = runSection.indexOf("const firstBlocker = latestReadiness?.blockers[0]");
  const processIndex = runSection.indexOf("const result = await runAutomationOnce(activeIdentityFilters())");

  assert.ok(blockerIndex > 0);
  assert.ok(processIndex > blockerIndex);
  assert.match(runSection, /await getAutomationReadiness\(\)/);
  assert.match(runSection, /handleAutomationReadinessCheck\(firstBlocker\)/);
  assert.match(runSection, /return;\s*}\s*let summary/);
  assert.doesNotMatch(runSection, /autoProcessLowValue\(\)/);
  assert.match(webApi, /runAutomationOnce\(filters: IdentityFilters = \{\}\)/);
  assert.match(webApi, /\/automation\/run-once", filters/);
  assert.match(runSection, /runAutomationOnce\(activeIdentityFilters\(\)\)/);
  assert.match(runSection, /processLowValueSendQueue/);
  assert.match(runSection, /mergeAutomationStatusRun\(current, result, \{ incrementRunCount: !result\.skipped \}\)/);
});
