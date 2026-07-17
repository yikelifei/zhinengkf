"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function sliceBetween(source, startPattern, endPattern) {
  const start = source.search(startPattern);
  assert.notEqual(start, -1, `missing start pattern: ${startPattern}`);
  const afterStart = source.slice(start);
  const end = afterStart.search(endPattern);
  assert.notEqual(end, -1, `missing end pattern: ${endPattern}`);
  return afterStart.slice(0, end);
}

test("legacy direct mark-sent service paths are disabled", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const legacySection = service.slice(
    service.indexOf("markSentAfterGuard"),
    service.indexOf("executeDryRunSend"),
  );

  assert.match(legacySection, /Direct mark-sent is disabled/);
  assert.doesNotMatch(legacySection, /status:\s*"sent"/);
  assert.doesNotMatch(legacySection, /markLinkedQuoteSent/);
});

test("dry run execution is not mapped to real sent status", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const executeSection = service.slice(
    service.indexOf("  executeSend("),
    service.indexOf("  acknowledgeBridgeSend("),
  );

  assert.match(executeSection, /adapterResult\.status === "dry_run"/);
  assert.match(executeSection, /\?\s*"dry_run"\s*:\s*"sent"/);
});

test("wechat channel status distinguishes runtime from real send adapter readiness", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const channelsPage = readProjectFile("apps/web/src/features/integrations/channels-status-page.tsx");
  const preflightPage = readProjectFile("apps/web/src/features/integrations/wechat-work-preflight-page.tsx");
  const inboundPage = readProjectFile("apps/web/src/features/integrations/window-inbound-operations-page.tsx");
  const channelsRoute = readProjectFile("apps/web/src/app/integrations/channels/page.tsx");
  const preflightRoute = readProjectFile("apps/web/src/app/integrations/wechat-work/page.tsx");
  const inboundRoute = readProjectFile("apps/web/src/app/integrations/personal-wechat/window-inbound/page.tsx");
  const styles = readProjectFile("apps/web/src/features/integrations/integration-pages.module.css");
  const statusSection = sliceBetween(service, /function channelStatus\(/, /function maskSecret/);

  assert.match(statusSection, /const runtimeKeys = new Set\(\["window_observer", "windows_bridge"\]\)/);
  assert.match(statusSection, /const sendAdapterKeys = new Set\(\["safe_send_queue"\]\)/);
  assert.match(statusSection, /return "needs_send_adapter"/);
  assert.match(service, /needsSendAdapter/);
  assert.match(service, /bridgeDispatchPending:\s*bridge\.dispatch\.pendingCount/);
  assert.match(service, /bridgeDispatchStale:\s*bridge\.dispatch\.staleCount/);
  assert.match(api, /"needs_send_adapter"/);
  assert.match(channelsPage, /needs_send_adapter:\s*"待发送适配器"/);
  assert.match(channelsPage, /channel\.ready \? "已就绪" : channelStatusLabel\(channel\.status\)/);
  assert.match(channelsPage, /channel\.checks\.map/);
  assert.match(channelsPage, /链路只展示服务端返回的真实步骤，不在前端推断通道能力/);
  assert.doesNotMatch(channelsPage, /executeSend|processSafeQueue|runWechatChannelInbound/);

  assert.match(preflightPage, /readiness && !readiness\.productionReady/);
  assert.match(preflightPage, /不把离线检查误报为上线成功/);
  assert.doesNotMatch(preflightPage, /startAutomation|executeSend/);

  assert.match(inboundPage, /identityExpectation\(identity\)/);
  assert.match(inboundPage, /!identity\.wechatAccountId \|\| !identity\.conversationId \|\| !identity\.customerId/);
  assert.match(inboundPage, /drillConfirmed/);
  assert.match(inboundPage, /data-action-id="integrations\.window\.capture-current"/);
  assert.match(inboundPage, /data-action-id="integrations\.inbound\.run-controlled-drill"/);

  assert.match(channelsRoute, /routeId="integrationChannels"[\s\S]*<ChannelsStatusPage/);
  assert.match(preflightRoute, /routeId="wechatWorkChannels"[\s\S]*<WechatWorkPreflightPage/);
  assert.match(inboundRoute, /routeId="personalWechatInbound"[\s\S]*<WindowInboundOperationsPage/);
  assert.match(styles, /\.page button \{[\s\S]*min-height: 44px/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*grid-template-columns: 1fr/);
});

test("execute send only starts queued tasks", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const executeSection = service.slice(
    service.indexOf("  executeSend("),
    service.indexOf("  acknowledgeBridgeSend("),
  );

  assert.match(executeSection, /taskBeforeValidation\.status !== "queued"/);
  assert.match(executeSection, /send task is not queued/);
  assert.ok(
    executeSection.indexOf('taskBeforeValidation.status !== "queued"') < executeSection.indexOf("this.sendAdapter.execute"),
    "queued status must be checked before adapter execution writes outbox",
  );
});

test("execute send revalidates queued order payment and cancellation before adapter execution", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const executeSection = service.slice(
    service.indexOf("  executeSend("),
    service.indexOf("  acknowledgeBridgeSend("),
  );

  assert.match(service, /private validateQueuedOrderSendState\(task: any\)/);
  assert.match(service, /orderDraftId = String\(automation\.orderDraftId \|\| ""\)/);
  assert.match(service, /this\.localStore\.getOrderDraft\(orderDraftId\)/);
  assert.match(service, /orderCancelledBeforeSend/);
  assert.match(service, /orderPaymentNotReadyBeforeSend/);
  assert.match(service, /paymentStatus !== "deposit_paid" && paymentStatus !== "paid"/);
  assert.ok(
    executeSection.indexOf("this.validateQueuedOrderSendState(taskBeforeValidation)") <
      executeSection.indexOf("this.validateExistingSendTaskBinding(taskBeforeValidation)"),
    "queued order state must be checked before normal binding/window guard execution",
  );
  assert.ok(
    executeSection.indexOf("this.validateQueuedOrderSendState(taskBeforeValidation)") <
      executeSection.indexOf("this.sendAdapter.execute"),
    "queued order state must be checked before adapter execution writes outbox",
  );
});

test("execute send blocks queued tasks when routing policy requires manual handling", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const sendGuardRules = readProjectFile("packages/rules/sendGuard.js");
  const executeSection = service.slice(
    service.indexOf("  executeSend("),
    service.indexOf("  acknowledgeBridgeSend("),
  );
  const scanSendOperationsSection = sliceBetween(
    service,
    /\n  async scanSendOperations\(filter: IdentityFilter = \{\}\)/,
    /\n  async processSafeSendQueue\(/,
  );
  const createLocalSendTaskSection = sliceBetween(
    service,
    /\n  private createLocalSendTask\(payload: any\)/,
    /\n  private async assertSendTaskBinding\(/,
  );
  const routingPolicySection = sliceBetween(
    service,
    /\n  private validateQueuedRoutingPolicySendState\(task: any\)/,
    /\n  private expectedIdentityFromOrder\(/,
  );

  assert.match(routingPolicySection, /task\?\.payload\?\.routingPolicy/);
  assert.match(routingPolicySection, /routingPolicy\.manualRequired === true/);
  assert.match(routingPolicySection, /routingPolicy\.canQueueAutoReply !== false/);
  assert.match(routingPolicySection, /canQueueClarificationReply/);
  assert.match(routingPolicySection, /task\?\.payload\?\.automationPlan === "queue_reply" && routingPolicy\.canAskClarification === true/);
  assert.match(routingPolicySection, /canQueueAutoReply \|\| canQueueClarificationReply/);
  assert.match(routingPolicySection, /routingPolicyManualRequired/);
  assert.match(routingPolicySection, /routingPolicyQueueDisabled/);
  assert.match(sendGuardRules, /task\.guardSnapshot\?\.blockedByRoutingPolicy/);
  assert.match(sendGuardRules, /reason: "routing_policy_manual_required"/);
  assert.match(sendGuardRules, /failedKeys: \["routingPolicyManualRequired"\]/);
  assert.match(executeSection, /const routingPolicyState = this\.validateQueuedRoutingPolicySendState\(taskBeforeValidation\)/);
  assert.match(executeSection, /blockedByRoutingPolicy: true/);
  assert.match(executeSection, /guardStatus: routingPolicyState\.reason/);
  assert.match(scanSendOperationsSection, /const blockedByRoutingPolicy = Boolean\(task\.guardSnapshot\?\.blockedByRoutingPolicy\)/);
  assert.match(scanSendOperationsSection, /const routingPolicyLane = String\(task\.guardSnapshot\?\.routingPolicyLane \|\| routingPolicy\?\.lane \|\| ""\)/);
  assert.match(scanSendOperationsSection, /blockedByRoutingPolicy[\s\S]*"路由策略转人工处理"/);
  assert.match(scanSendOperationsSection, /customerId: task\.conversation\?\.customerId \|\| task\.customerId/);
  assert.match(scanSendOperationsSection, /routingPolicyLane/);
  assert.match(createLocalSendTaskSection, /const routingPolicyState = this\.validateQueuedRoutingPolicySendState\(payload\)/);
  assert.match(createLocalSendTaskSection, /throw new BadRequestException\(routingPolicyState\.message\)/);
  assert.ok(
    createLocalSendTaskSection.indexOf("this.validateQueuedRoutingPolicySendState(payload)") <
      createLocalSendTaskSection.indexOf("this.localStore.createSendTask(payload)"),
    "routing policy must be checked before a local send task is queued",
  );
  assert.ok(
    executeSection.indexOf("this.validateQueuedRoutingPolicySendState(taskBeforeValidation)") <
      executeSection.indexOf("this.validateQueuedOrderSendState(taskBeforeValidation)"),
    "routing policy must be checked before order and quote send validation",
  );
  assert.ok(
    executeSection.indexOf("this.validateQueuedRoutingPolicySendState(taskBeforeValidation)") <
      executeSection.indexOf("this.sendAdapter.execute"),
    "routing policy must be checked before adapter execution writes outbox",
  );
});

test("current window validation preserves diagnostic context for blocked send tasks", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const currentWindowSection = service.slice(
    service.indexOf("  validateSendTaskWithCurrentWindow("),
    service.indexOf("  markSentAfterGuard("),
  );

  assert.match(currentWindowSection, /if \(!latestWindow\) \{[\s\S]*activeWindow: null/);
  assert.match(currentWindowSection, /windowSnapshotId: null/);
  assert.match(currentWindowSection, /windowDiagnostic: \{[\s\S]*windowSnapshotMissing/);
  assert.match(currentWindowSection, /latestWindow\.diagnostic && latestWindow\.diagnostic\.ok === false/);
  assert.match(currentWindowSection, /activeWindow: latestWindow/);
  assert.match(currentWindowSection, /windowDiagnostic: latestWindow\.diagnostic/);
  assert.match(currentWindowSection, /failedKeys: Array\.isArray\(latestWindow\.diagnostic\.failedKeys\)/);
});

test("bridge outbox list exposes preview instead of raw outbox data", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const listSection = sliceBetween(service, /\n  listBridgeOutbox\(/, /\n  private matchesBridgeEntryIdentity\(/);
  const itemSection = sliceBetween(service, /\n  private buildBridgeOutboxListItem\(/, /\n  private buildBridgeInboxListItem\(/);

  assert.doesNotMatch(listSection, /outboxDir:\s*appConfig\.wechatBridgeOutboxDir/);
  assert.match(itemSection, /preview:\s*this\.buildBridgeOutboxPreview/);
  assert.doesNotMatch(itemSection, /\.\.\.entry/);
  assert.doesNotMatch(itemSection, /data:\s*entry\.data/);
  assert.doesNotMatch(itemSection, /filePath:\s*entry\.filePath/);
  assert.doesNotMatch(itemSection, /accountDisplayName/);
  assert.doesNotMatch(itemSection, /conversationTitle/);
  assert.doesNotMatch(itemSection, /customerName/);
  assert.doesNotMatch(itemSection, /textPreview/);
  assert.doesNotMatch(itemSection, /imageFileNames/);
});

test("web send task cards show dispatch instruction state", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const styles = readProjectFile("apps/web/src/app/globals.css");
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const sendGuardRules = readProjectFile("packages/rules/sendGuard.js");
  const bridgeProtocol = readProjectFile("docs/WECHAT_BRIDGE_PROTOCOL.md");
  const previewSection = sliceBetween(page, /\nfunction BridgeOutboxPreview\(/, /\nfunction bridgeOutboxEntryForTask\(/);
  const preflightSection = sliceBetween(page, /\nfunction SendPreflightStatus\(/, /\nfunction SendQueueAdvice\(/);
  const executeSection = sliceBetween(wechatService, /\n  executeSend\(/, /\n  private validateQueuedOrderSendState\(/);
  const dispatchMatcherSection = sliceBetween(page, /\nfunction bridgeDispatchEntryForTask\(/, /\nfunction sendStatusLabel\(/);
  const taskListSection = page.slice(
    page.indexOf("<div className=\"send-task-list\">"),
    page.indexOf("<section className=\"panel review-panel\""),
  );

  assert.match(api, /export type BridgeDispatchEntry/);
  assert.match(api, /export type BridgeDispatchResult = \{[\s\S]*staleCount\?: number/);
  assert.match(api, /dispatch\?:\s*\{[\s\S]*pending:\s*BridgeDispatchEntry\[\]/);
  assert.match(api, /dispatch\?:\s*\{[\s\S]*staleCount\?: number/);
  assert.match(api, /routingPolicy\?: RouteEvaluation\["routingPolicy"\]/);
  assert.match(taskListSection, /const latestWindow = latestWindowByAccount\.get\(task\.wechatAccountId\) \|\| null/);
  assert.match(taskListSection, /<SendRoutingPolicy task=\{task\} \/>/);
  assert.match(taskListSection, /<SendPreflightStatus task=\{task\} latestWindow=\{latestWindow\} \/>/);
  assert.match(page, /function SendRoutingPolicy\(\{ task \}: \{ task: SendTask \}\)/);
  assert.match(page, /路由策略：\{routingPolicyLaneLabel\(policy\.lane \|\| ""\)\}/);
  assert.match(page, /policy\.safeguards\?\.slice\(0, 4\)\.map/);
  assert.match(preflightSection, /failedChecks = checks\.filter\(\(check\) => !check\.passed\)/);
  assert.match(api, /windowDiagnostic\?: \{/);
  assert.match(preflightSection, /storedWindowDiagnostic = task\.guardSnapshot\?\.windowDiagnostic \|\| null/);
  assert.match(preflightSection, /effectiveWindowDiagnostic = latestWindowDiagnostic \|\| storedWindowDiagnostic/);
  assert.match(preflightSection, /sendWindowDiagnosticKeyLabel\(key\)/);
  assert.match(preflightSection, /诊断失败项/);
  assert.match(preflightSection, /sendPreflightStatus\(task, guardStatus, failedChecks\.length, latestWindow \|\| null\)/);
  assert.match(preflightSection, /sendGuardCheckLabel\(check\)/);
  assert.match(page, /function sendPreflightStatus\(task: SendTask, guardStatus: string, failedCheckCount: number, latestWindow: WechatWindowSnapshot \| null\)/);
  assert.match(page, /task\.guardSnapshot\?\.windowDiagnostic\?\.ok === false/);
  assert.match(page, /label: "不可发送"/);
  assert.match(page, /label: "待校验"/);
  assert.match(page, /function sendGuardCheckLabel/);
  assert.match(page, /conversationManualUnlocked: "会话未被人工接管"/);
  assert.match(page, /conversationManualLocked: "会话已人工接管"/);
  assert.match(page, /routingPolicyManualRequired: "路由策略要求人工处理"/);
  assert.match(page, /routingPolicyQueueDisabled: "路由策略禁止自动排队"/);
  assert.match(page, /sendTaskManualAttentionSummary[\s\S]*map\(\(key\) => sendGuardCheckLabel\(\{ key \}\)\)/);
  assert.match(taskListSection, /const taskBlockedByRoutingPolicy = Boolean\(task\.guardSnapshot\?\.blockedByRoutingPolicy\)/);
  assert.match(taskListSection, /!taskBlockedByRoutingPolicy[\s\S]*\["blocked", "failed", "dry_run"\]\.includes\(task\.status\)/);
  assert.match(page, /task\.guardSnapshot\?\.blockedByRoutingPolicy[\s\S]*title: "路由策略转人工"/);
  assert.match(page, /function sendWindowDiagnosticKeyLabel\(key: string\)/);
  assert.match(page, /windowSnapshotMissing: "无窗口快照"/);
  assert.match(wechatService, /failedKeys: \["conversationManualUnlocked", "conversationManualLocked"\]/);
  assert.match(sendGuardRules, /function expandSendGuardFailedKeys\(keys\)/);
  assert.match(sendGuardRules, /key === "conversationManualUnlocked"[\s\S]*conversationManualLocked/);
  assert.match(sendGuardRules, /failedKeys: \["conversationManualUnlocked", "conversationManualLocked"\]/);
  assert.match(styles, /\.send-preflight-status/);
  assert.match(styles, /\.send-preflight-status\.danger/);
  assert.match(taskListSection, /const bridgeDispatchEntry = bridgeDispatchEntryForTask\(task, bridgeStatus\)/);
  assert.match(taskListSection, /dispatchEntry=\{bridgeDispatchEntry\}/);
  assert.match(previewSection, /dispatchEntry\?: BridgeDispatchEntry \| null/);
  assert.match(previewSection, /桥接指令已生成/);
  assert.match(previewSection, /等待外部微信桥发送后回执/);
  assert.match(previewSection, /dispatchEntry\?\.ackFileNameHint/);
  assert.match(previewSection, /回执建议文件/);
  assert.match(previewSection, /dispatchEntry\?\.protocolVersion/);
  assert.match(previewSection, /dispatchEntry\?\.expiresAt/);
  assert.match(previewSection, /dispatchEntry\.expired \? "，已过期请重新生成" : ""/);
  assert.match(api, /preflight\?: \{/);
  assert.match(api, /requiredBeforeSend\?: string\[\]/);
  assert.match(previewSection, /dispatchEntry\?\.preflight\?\.requiredBeforeSend\?\.length/);
  assert.match(previewSection, /任一失败即停止/);
  assert.match(previewSection, /preview\?\.customerId \|\| entry\?\.customerId \|\| dispatchEntry\?\.preflight\?\.expectedCustomerId/);
  assert.match(bridgeProtocol, /customer identity/);
  assert.match(bridgeProtocol, /"customerId": "customer_demo_1"/);
  assert.match(bridgeProtocol, /Ack customer matches the send task/);
  assert.match(page, /bridgeStatus\?\.dispatch\?\.staleCount \? `，指令超时 \$\{bridgeStatus\.dispatch\.staleCount\} 个` : ""/);
  assert.match(dispatchMatcherSection, /bridgeStatus\?\.dispatch\?\.pending/);
  assert.match(dispatchMatcherSection, /entry\.taskId === task\.id/);
  assert.match(dispatchMatcherSection, /entry\.attemptId === latestAttempt\.id/);
});

test("web send task cards expose trusted bridge ack rejection audit", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const styles = readProjectFile("apps/web/src/app/globals.css");
  const attemptSummarySection = sliceBetween(page, /\nfunction SendAttemptSummary\(/, /\nfunction BridgeOutboxPreview\(/);
  const ackAuditSection = sliceBetween(page, /\nfunction sendAttemptBridgeAckRejected\(/, /\nfunction windowSnapshotStatus\(/);

  assert.match(attemptSummarySection, /sendAttemptBridgeAckRejected\(attempt\)/);
  assert.match(attemptSummarySection, /回执被拒绝/);
  assert.match(attemptSummarySection, /rejectedAck\.sourceLabel/);
  assert.match(attemptSummarySection, /rejectedAck\.fileName/);
  assert.match(attemptSummarySection, /rejectedAck\.reason/);
  assert.match(ackAuditSection, /attempt\?\.metadata\?\.bridgeAckRejected/);
  assert.match(ackAuditSection, /direct_ack:\s*"直接回执"/);
  assert.match(ackAuditSection, /bridge_inbox:\s*"回执文件"/);
  assert.match(styles, /\.attempt-audit-note/);
});

test("bridge status and inbox scan expose sanitized inbox summaries only", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const statusSection = sliceBetween(service, /\n  getBridgeStatus\(/, /\n  listBridgeOutbox\(/);
  const scanSection = sliceBetween(service, /\n  scanBridgeInbox\(/, /\n  async scanSendOperations\(/);
  const inboxSummarySection = sliceBetween(service, /\n  private buildBridgeInboxListItem\(/, /\n  scanBridgeInbox\(/);

  assert.match(statusSection, /listBridgeInbox\(\)[\s\S]*matchesBridgeEntryIdentity\(entry, null, filter\)[\s\S]*buildBridgeInboxListItem\(entry\)/);
  assert.match(statusSection, /sanitizeBridgeWorkerStatus\(worker\)/);
  assert.match(statusSection, /active:\s*locks\.map\(sanitizeBridgeLockItem\)/);
  assert.doesNotMatch(statusSection, /outboxDir:\s*outbox\.outboxDir/);
  assert.doesNotMatch(statusSection, /inboxDir:\s*appConfig\.wechatBridgeInboxDir/);
  assert.doesNotMatch(statusSection, /lockDir:\s*appConfig\.wechatBridgeLockDir/);
  assert.match(scanSection, /buildBridgeInboxListItem/);
  assert.match(inboxSummarySection, /hasAckToken/);
  assert.doesNotMatch(inboxSummarySection, /\backToken\s*:/);
  assert.doesNotMatch(inboxSummarySection, /filePath:\s*entry\?\.\filePath/);
  assert.doesNotMatch(inboxSummarySection, /data:\s*data/);
  assert.doesNotMatch(scanSection, /processed\.push\(\{\s*\.\.\.entry/);
  assert.doesNotMatch(scanSection, /failed\.push\(\{\s*\.\.\.entry/);
});

test("frontend list APIs pass identity filters to multi-account resources", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  assert.match(api, /export type IdentityFilters/);
  assert.match(api, /function identityQuery/);
  assert.match(api, /getAgents\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/agents\$\{identityQuery\(filters\)\}/);
  assert.match(api, /getDesignJobs\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/design-jobs\$\{identityQuery\(filters\)\}/);
  assert.match(api, /getSendTasks\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/wechat\/send-tasks\$\{identityQuery\(filters\)\}/);
  assert.match(api, /getQuotes\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/quotes\$\{identityQuery\(filters\)\}/);
  assert.match(api, /getOrderDrafts\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/orders\$\{identityQuery\(filters\)\}/);
});

test("frontend conversation picker reloads business lists with selected conversation identity", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const loadSection = page.slice(page.indexOf("  async function load("), page.indexOf("  async function runAction"));
  const pickerSection = page.slice(page.indexOf("  function renderConversationSelect()"), page.indexOf("  const manualLockLogByConversationId"));

  assert.match(loadSection, /identityFilterOverride/);
  assert.match(loadSection, /getAgents\(identityFilters\)/);
  assert.match(loadSection, /getDesignJobs\(identityFilters\)/);
  assert.match(loadSection, /getSendTasks\(identityFilters\)/);
  assert.match(loadSection, /getQuotes\(identityFilters\)/);
  assert.match(loadSection, /getOrderDrafts\(identityFilters\)/);
  assert.match(loadSection, /async function changeActiveConversation/);
  assert.match(loadSection, /wechatAccountId:\s*conversation\.wechatAccountId/);
  assert.match(loadSection, /customerId:\s*conversation\.customerId/);
  assert.match(loadSection, /async function focusConversation/);
  assert.match(loadSection, /await changeActiveConversation\(conversationId\)/);
  assert.match(pickerSection, /changeActiveConversation\(""\)/);
  assert.match(pickerSection, /changeActiveConversation\(conversation\.id\)/);
});

test("frontend conversation focus actions refresh scoped business lists", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const allowedDirectSetters = (page.match(/setActiveConversationId\(/g) || []).length;
  const sendTaskSection = page.slice(
    page.indexOf("<div className=\"send-task-list\">"),
    page.indexOf("<section className=\"panel review-panel\""),
  );
  const reviewCenterIdIndex = page.indexOf("id=\"review-center\"");
  const reviewSection = page.slice(
    page.lastIndexOf("<section", reviewCenterIdIndex),
    page.indexOf("<section className=\"panel deal-panel\""),
  );
  const readinessSection = page.slice(
    page.indexOf("async function handleAutomationReadinessCheck"),
    page.indexOf("function getAutomationReadinessPrimaryCheck"),
  );

  assert.equal(allowedDirectSetters, 2);
  assert.match(sendTaskSection, /focusConversation\(task\.conversation\?\.id \|\| "", "conversation-center"\)/);
  assert.doesNotMatch(sendTaskSection, /setActiveConversationId\(task\.conversation/);
  assert.match(reviewSection, /focusConversation\(conversation\.id, "conversation-center"\)/);
  assert.match(reviewSection, /focusConversation\(conversation\.id, "send-center"\)/);
  assert.doesNotMatch(reviewSection, /setActiveConversationId\(conversation\.id\)/);
  assert.match(readinessSection, /await changeActiveConversation\(firstLockedConversation\.id\)/);
  assert.match(readinessSection, /await changeActiveConversation\(firstPendingTask\.conversationId\)/);
});

test("notice center exposes manual selection targets for operator follow-up", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const css = readProjectFile("apps/web/src/app/globals.css");
  const quotesService = readProjectFile("apps/api/src/quotes/quotes.service.ts");
  const focusNoticeSection = page.slice(
    page.indexOf("async function focusNoticeTarget"),
    page.indexOf("async function preflightActiveJob"),
  );
  const noticeSection = page.slice(
    page.indexOf("<div className=\"notice-list\">"),
    page.indexOf("<div className=\"empty empty-cta\"", page.indexOf("<div className=\"notice-list\">")),
  );

  assert.match(focusNoticeSection, /const quoteDraftId = String\(target\.quoteDraftId \|\| ""\)/);
  assert.match(focusNoticeSection, /const reason = String\(target\.reason \|\| ""\)/);
  assert.match(focusNoticeSection, /focusQuoteCenter\(quoteDraftId\)/);
  assert.match(focusNoticeSection, /reason === "payment_proof_needs_manual_verification"/);
  assert.match(focusNoticeSection, /客户发送了付款凭证，请先人工核验金额/);
  assert.match(focusNoticeSection, /setActiveId\(designJobId\)/);
  assert.match(focusNoticeSection, /await focusConversation\(conversationId, "conversation-center"\)/);
  assert.match(noticeSection, /className="notice-main"/);
  assert.match(noticeSection, /noticeTargetSummary\(notice\)/);
  assert.match(noticeSection, /focusNoticeTarget\(notice\)/);
  assert.match(noticeSection, /noticeHasTarget\(notice\)/);
  assert.match(page, /function noticeTargetSummary\(notice: NotificationItem\)/);
  assert.match(page, /inboundSelectionReasonLabel\(reason\)/);
  assert.match(page, /payment_proof_needs_manual_verification: "客户发送了付款凭证，需要人工核验金额"/);
  assert.match(page, /result\.plan\.type === "quote_payment_proof_manual_review"/);
  assert.match(page, /付款凭证待人工核验/);
  assert.match(page, /quotes\.filter\(quoteNeedsPaymentProofReview\)\.length/);
  assert.match(page, /quoteNeedsPaymentProofReview\(activeQuote\) \? <span>/);
  assert.match(page, /quoteNeedsPaymentProofReview\(quote\) \? <small>/);
  assert.match(page, /quoteNeedsPaymentProofReview\(quote\) \? <span>/);
  assert.match(page, /if \(quoteNeedsPaymentProofReview\(quote\)\) \{[\s\S]*不能直接通过并入队[\s\S]*return;/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| quoteNeedsPaymentProofReview\(quote\)\}/);
  assert.match(page, /付款凭证单需要先核验收款/);
  const verifyPaymentProofSection = page.slice(
    page.indexOf("async function verifyQuotePaymentProof"),
    page.indexOf("function conversationForQuoteOrder"),
  );
  assert.match(verifyPaymentProofSection, /async function verifyQuotePaymentProof\([\s\S]*quote: QuoteDraft,[\s\S]*paymentStatus: "deposit_paid" \| "paid"/);
  assert.doesNotMatch(verifyPaymentProofSection, /const existingOrder = orderDrafts\.find\(\(order\) => order\.quoteDraftId === quote\.id\) \|\| null/);
  assert.doesNotMatch(verifyPaymentProofSection, /updateOrderDraft\(existingOrder\.id, \{[\s\S]*paymentStatus,[\s\S]*status: "confirmed"/);
  assert.doesNotMatch(verifyPaymentProofSection, /updateQuote\(quote\.id, \{[\s\S]*paymentStatus,[\s\S]*status: "accepted"/);
  assert.doesNotMatch(verifyPaymentProofSection, /options: \{ queueConfirmation\?: boolean \} = \{\}/);
  assert.match(page, /function confirmQuotePaymentProofVerification\(quote: QuoteDraft, paymentStatus: "deposit_paid" \| "paid"\)/);
  assert.match(page, /confirmQuotePaymentProofVerification\([\s\S]*orderDrafts\.find\(\(order\) => order\.quoteDraftId === quote\.id\)/);
  assert.match(page, /const selectedImageLabel = selectedImage\?\.position[\s\S]*: quote\.selectedImageId[\s\S]*选图：已绑定/);
  assert.match(page, /: "选图：未绑定"/);
  assert.match(page, /确认后会把报价\/订单标记为已付款/);
  assert.match(page, /function quotePaymentProofBlockReason\(quote: QuoteDraft\)/);
  assert.match(page, /quotePaymentProofBlockReason\([\s\S]*!quote\.selectedImageId[\s\S]*报价还没有绑定客户选中的效果图，不能核验付款/);
  assert.match(page, /quotePaymentProofBlockReason\([\s\S]*!designJob\?\.wechatAccountId \|\| !quote\.customerId \|\| !designJob\?\.conversationId[\s\S]*报价缺少微信账号、客户或会话绑定，不能核验付款/);
  assert.match(verifyPaymentProofSection, /const blocker = quotePaymentProofBlockReason\(quote\)/);
  assert.match(verifyPaymentProofSection, /if \(blocker\) \{[\s\S]*setMessage\(blocker\);[\s\S]*return;/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| Boolean\(quotePaymentProofBlockReason\(activeQuote\)\)\}/);
  assert.match(quotesService, /verifyPaymentProofAndQueueConfirmation\([\s\S]*this\.assertQuoteHasSelectedImageForPaymentProof\(quote\)/);
  assert.match(quotesService, /private assertQuoteHasSelectedImageForPaymentProof\(quote: any\)[\s\S]*selected design image/);
  assert.match(page, /title=\{quotePaymentProofBlockReason\(activeQuote\) \|\| "核验定金并确认订单"\}/);
  assert.match(page, /title=\{quotePaymentProofBlockReason\(activeQuote\) \|\| "核验全款并确认订单"\}/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| Boolean\(quotePaymentProofBlockReason\(quote\)\)\}/);
  assert.match(verifyPaymentProofSection, /if \(!confirmQuotePaymentProofVerification\(quote, paymentStatus\)\) \{[\s\S]*已取消核验\$\{paymentLabel\}付款操作/);
  assert.match(api, /function verifyQuotePaymentProofAndQueueConfirmation/);
  assert.match(api, /\/quotes\/\$\{id\}\/verify-payment-proof/);
  assert.match(api, /sendTask\?: SendTask \| null/);
  assert.match(verifyPaymentProofSection, /verifyQuotePaymentProofAndQueueConfirmation\([\s\S]*quote\.id,[\s\S]*paymentStatus,[\s\S]*identityExpectation\(quote\)/);
  assert.match(verifyPaymentProofSection, /upsertQuoteState\(result\.quote\)/);
  assert.match(verifyPaymentProofSection, /function upsertQuoteState\(quote: QuoteDraft \| null \| undefined\)/);
  assert.match(verifyPaymentProofSection, /upsertOrderDraftState\(result\.orderDraft\)/);
  assert.match(verifyPaymentProofSection, /function upsertOrderDraftState\(order: OrderDraft \| null \| undefined\)/);
  assert.match(verifyPaymentProofSection, /setOrderDrafts\(\(items\) =>[\s\S]*item\.id === order\.id[\s\S]*\[order, \.\.\.items\]/);
  assert.match(verifyPaymentProofSection, /if \(result\.sendTask\?\.id\)/);
  assert.doesNotMatch(verifyPaymentProofSection, /result\.sendTask\.id/);
  assert.match(verifyPaymentProofSection, /upsertSendTaskState\(result\.sendTask\)/);
  assert.match(verifyPaymentProofSection, /function upsertSendTaskState\(task: SendTask \| null \| undefined\)/);
  assert.match(verifyPaymentProofSection, /setSendTasks\(\(items\) =>[\s\S]*item\.id === task\.id[\s\S]*\[task, \.\.\.items\]/);
  assert.match(verifyPaymentProofSection, /queuedSendTask[\s\S]*订单确认已进入微信安全发送队列/);
  assert.match(verifyPaymentProofSection, /订单已更新，请人工确认后再发送/);
  assert.doesNotMatch(page, /verifyQuotePaymentProof\(quote, "deposit_paid", \{ queueConfirmation: true \}\)/);
  assert.doesNotMatch(page, /verifyQuotePaymentProof\(quote, "paid", \{ queueConfirmation: true \}\)/);
  assert.match(page, /定金并确认/);
  assert.match(page, /全款并确认/);
  assert.match(page, /核验定金并确认/);
  assert.match(page, /核验全款并确认/);
  assert.match(page, /客户想选图 \$\{target\.selectedImageId\}/);
  assert.match(css, /\.notice-main/);
  assert.match(css, /\.notice-target-actions/);
});

test("order payment buttons must verify the linked quote before confirmation queueing", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const verifyOrderPaymentProofSection = page.slice(
    page.indexOf("async function verifyOrderPaymentProof"),
    page.indexOf("function conversationForQuoteOrder"),
  );

  assert.match(verifyOrderPaymentProofSection, /async function verifyOrderPaymentProof\([\s\S]*order: OrderDraft,[\s\S]*paymentStatus: "deposit_paid" \| "paid"/);
  assert.match(page, /function orderPaymentProofBlockReason\(order: OrderDraft\)/);
  assert.match(page, /orderPaymentProofBlockReason\([\s\S]*!orderSelectedImageIdValue\(order\)[\s\S]*订单还没有绑定客户选中的效果图，不能核验付款/);
  assert.match(page, /function orderStrictIdentityMissing\(order: OrderDraft\)/);
  assert.match(page, /return !order\.wechatAccountId \|\| !order\.customerId \|\| !order\.conversationId/);
  assert.match(page, /function orderStrictIdentityBlockReason\(actionLabel: string\)/);
  assert.match(page, /orderPaymentProofBlockReason\([\s\S]*orderStrictIdentityMissing\(order\)[\s\S]*orderStrictIdentityBlockReason\("核验付款"\)/);
  assert.match(verifyOrderPaymentProofSection, /const blocker = orderPaymentProofBlockReason\(order\)/);
  assert.match(verifyOrderPaymentProofSection, /if \(blocker\) \{[\s\S]*setMessage\(blocker\);[\s\S]*return;/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| Boolean\(orderPaymentProofBlockReason\(activeOrderDraft\)\)\}/);
  assert.match(page, /title=\{orderPaymentProofBlockReason\(activeOrderDraft\) \|\| "核验定金并确认订单"\}/);
  assert.match(page, /title=\{orderPaymentProofBlockReason\(activeOrderDraft\) \|\| "核验全款并确认订单"\}/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| Boolean\(orderPaymentProofBlockReason\(order\)\)\}/);
  assert.match(verifyOrderPaymentProofSection, /order\.quoteDraft[\s\S]*quotes\.find\(\(item\) => item\.id === order\.quoteDraftId\)/);
  assert.match(verifyOrderPaymentProofSection, /await verifyQuotePaymentProof\(quote, paymentStatus\)/);
  assert.doesNotMatch(page, /updateOrderDraftStatus\([^)]*, \{ paymentStatus: "deposit_paid"/);
  assert.doesNotMatch(page, /updateOrderDraftStatus\([^)]*, \{ paymentStatus: "paid"/);
  assert.match(page, /verifyOrderPaymentProof\(activeOrderDraft, "deposit_paid"\)/);
  assert.match(page, /verifyOrderPaymentProof\(activeOrderDraft, "paid"\)/);
  assert.match(page, /verifyOrderPaymentProof\(order, "deposit_paid"\)/);
  assert.match(page, /verifyOrderPaymentProof\(order, "paid"\)/);
  assert.match(wechatService, /queueOrderConfirmation\([\s\S]*this\.assertOrderHasSelectedImageForSend\(order, "order confirmation"\)/);
  assert.match(wechatService, /queueOrderFollowup\([\s\S]*this\.assertOrderHasSelectedImageForSend\(order, "order follow-up"\)/);
  assert.match(wechatService, /assertOrderSendTaskStillQueueable\(task: any\)[\s\S]*this\.assertOrderHasSelectedImageForSend\(order, context\)/);
  assert.match(wechatService, /private assertOrderHasSelectedImageForSend\(order: any, context: string\)[\s\S]*需要先绑定客户选中的效果图/);
});

test("manual mutation APIs carry and enforce expected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const quoteService = readProjectFile("apps/api/src/quotes/quotes.service.ts");
  const orderService = readProjectFile("apps/api/src/orders/orders.service.ts");
  const reviewsService = readProjectFile("apps/api/src/reviews/reviews.service.ts");
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const identityHelper = readProjectFile("apps/api/src/shared/identity-expectation.ts");
  const lowValueOrderConfirmationSection = sliceBetween(
    wechatService,
    /\n  async scanLowValueOrderConfirmations\(/,
    /\n  async scanLowValueOrderFollowups\(/,
  );
  const lowValueOrderFollowupSection = sliceBetween(
    wechatService,
    /\n  async scanLowValueOrderFollowups\(/,
    /\n  listAccounts\(/,
  );
  const inboundAcceptanceSection = sliceBetween(
    wechatService,
    /\n  private async handleInboundQuoteAcceptance\(/,
    /\n  private findLatestQuoteForConversation\(/,
  );

  assert.match(identityHelper, /export function assertExpectedIdentity/);
  assert.match(identityHelper, /expectedWechatAccountId/);
  assert.match(identityHelper, /expectedConversationId/);
  assert.match(identityHelper, /expectedCustomerId/);
  assert.match(api, /export function identityExpectation/);
  assert.match(api, /expectedWechatAccountId/);
  assert.match(api, /expectedConversationId/);
  assert.match(api, /expectedCustomerId/);
  assert.match(quoteService, /assertExpectedIdentity\(current, patch, "quote draft"\)/);
  assert.match(quoteService, /assertExpectedIdentity\(quote, options, "quote draft"\)/);
  assert.match(quoteService, /this\.assertQuoteHasCompleteSendIdentity\(quote\)/);
  assert.match(quoteService, /private assertQuoteHasCompleteSendIdentity\(quote: any\)/);
  assert.match(quoteService, /const wechatAccountId = String\(quote\?\.designJob\?\.wechatAccountId \|\| ""\)\.trim\(\)/);
  assert.match(quoteService, /const customerId = String\(quote\?\.customerId \|\| quote\?\.designJob\?\.customerId \|\| ""\)\.trim\(\)/);
  assert.match(quoteService, /const conversationId = String\(quote\?\.designJob\?\.conversationId \|\| ""\)\.trim\(\)/);
  assert.match(quoteService, /throw new BadRequestException\("报价缺少微信账号、客户或会话绑定，不能进入微信发送队列。"\)/);
  assert.match(quoteService, /setConversationManualLock\(designJob\.conversationId, \{[\s\S]*expectedWechatAccountId: designJob\.wechatAccountId,[\s\S]*expectedConversationId: designJob\.conversationId,[\s\S]*expectedCustomerId: quote\.customerId \|\| designJob\.customerId,[\s\S]*locked: false/);
  assert.match(quoteService, /setConversationManualLock\(designJob\.conversationId, \{[\s\S]*expectedWechatAccountId: designJob\.wechatAccountId,[\s\S]*expectedConversationId: designJob\.conversationId,[\s\S]*expectedCustomerId: quote\.customerId \|\| designJob\.customerId,[\s\S]*locked: true/);
  assert.match(quoteService, /setConversationManualLock\(conversationId, \{[\s\S]*expectedWechatAccountId: designJob\.wechatAccountId,[\s\S]*expectedConversationId: conversationId,[\s\S]*expectedCustomerId: quote\.customerId \|\| designJob\.customerId,[\s\S]*locked: true/);
  assert.match(quoteService, /this\.assertHighValueQuoteHasManualRelease\(quote, options\)/);
  assert.match(quoteService, /private assertHighValueQuoteHasManualRelease/);
  assert.match(quoteService, /private isHighValueQuote\(quote: any\)[\s\S]*isHighValueBudget\(quote\?\.designJob\?\.budget, threshold\)/);
  assert.match(orderService, /assertExpectedIdentity\(quote, expected, "quote draft"\)/);
  assert.match(orderService, /assertExpectedIdentity\(current, patch, "order draft"\)/);
  assert.match(wechatService, /assertExpectedIdentity\(order, payload, "order draft"\)/);
  assert.match(wechatService, /this\.assertOrderHasCompleteSendIdentity\(order\)/);
  assert.match(wechatService, /private assertOrderHasCompleteSendIdentity\(order: any\)/);
  assert.match(wechatService, /const wechatAccountId = String\(order\?\.wechatAccountId \|\| ""\)\.trim\(\)/);
  assert.match(wechatService, /const customerId = String\(order\?\.customerId \|\| ""\)\.trim\(\)/);
  assert.match(wechatService, /const conversationId = String\(order\?\.conversationId \|\| ""\)\.trim\(\)/);
  assert.match(wechatService, /throw new BadRequestException\("订单缺少微信账号、客户或会话绑定，不能进入微信发送队列。"\)/);
  assert.match(wechatService, /this\.assertHighValueOrderHasManualRelease\(order, payload, "high value order confirmation"\)/);
  assert.match(wechatService, /this\.assertHighValueOrderHasManualRelease\(order, payload, "high value order follow-up"\)/);
  assert.match(wechatService, /this\.orders\.update\(order\.id, \{[\s\S]*expectedWechatAccountId: payload\.expectedWechatAccountId,[\s\S]*expectedConversationId: payload\.expectedConversationId,[\s\S]*expectedCustomerId: payload\.expectedCustomerId/);
  assert.match(reviewsService, /private async updateReviewedOrder/);
  assert.match(reviewsService, /assertHighValueOrderHasCompleteIdentity\(order, decision\)/);
  assert.match(reviewsService, /assertHighValueOrderApprovalReady\(order, decision\)/);
  assert.match(reviewsService, /function assertHighValueOrderHasCompleteIdentity\(order: any, decision: string\)/);
  assert.match(reviewsService, /\["approve_confirmation", "approve_followup"\]\.includes\(decision\)/);
  assert.match(reviewsService, /if \(!isOrderHighValue\(order\)\) return/);
  assert.match(reviewsService, /const wechatAccountId = String\(order\?\.wechatAccountId \|\| ""\)\.trim\(\)/);
  assert.match(reviewsService, /const conversationId = String\(order\?\.conversationId \|\| ""\)\.trim\(\)/);
  assert.match(reviewsService, /const customerId = String\(order\?\.customerId \|\| ""\)\.trim\(\)/);
  assert.doesNotMatch(reviewsService, /const customerId = String\(order\?\.customerId \|\| order\?\.quoteDraft\?\.customerId \|\| order\?\.designJob\?\.customerId/);
  assert.match(reviewsService, /throw new BadRequestException\("高价值订单缺少微信账号、客户或会话绑定，不能批准订单确认或跟进发送。"\)/);
  assert.match(reviewsService, /function assertHighValueOrderApprovalReady\(order: any, decision: string\)/);
  assert.match(reviewsService, /const selectedImageId = String\(order\?\.selectedImageId \|\| order\?\.quoteDraft\?\.selectedImageId \|\| ""\)\.trim\(\)/);
  assert.match(reviewsService, /高价值订单未绑定客户选中的效果图，不能批准订单确认或跟进发送/);
  assert.match(reviewsService, /\["deposit_paid", "paid"\]\.includes\(paymentStatus\)/);
  assert.match(reviewsService, /高价值订单未核验定金或全款，不能批准订单确认或跟进发送/);
  assert.match(reviewsService, /Number\(order\?\.profit \|\| 0\) < 0/);
  assert.match(reviewsService, /高价值订单利润为负，必须人工确认报价和成本后再批准发送/);
  assert.match(reviewsService, /function appendCustomerNote\(current: unknown, next: string\)/);
  assert.match(reviewsService, /approve_confirmation[\s\S]*result\.orderDraft = await this\.updateReviewedOrder\(id, \{[\s\S]*customerNotes: appendCustomerNote/);
  assert.match(reviewsService, /approve_followup[\s\S]*result\.orderDraft = await this\.updateReviewedOrder\(id, \{[\s\S]*customerNotes: appendCustomerNote/);
  assert.match(reviewsService, /decision === "reject_order" \? \{ status: "cancelled" \} : \{\}/);
  assert.match(reviewsService, /let notification: any = null/);
  assert.match(reviewsService, /notification = await this\.notifications\.create/);
  assert.match(reviewsService, /wechatAccountId: order\.wechatAccountId/);
  assert.match(reviewsService, /conversationId: order\.conversationId/);
  assert.match(reviewsService, /customerId: order\.customerId/);
  assert.doesNotMatch(reviewsService, /customerId: order\.customerId \|\| order\.quoteDraft\?\.customerId \|\| order\.designJob\?\.customerId/);
  assert.match(reviewsService, /return \{ result, log, notification: result\?\.notification \|\| notification \|\| null \}/);
  assert.match(wechatService, /const notification = await this\.notifications\.create\([\s\S]*orderDraftId: order\.id,[\s\S]*sendTaskId: sendTask\.id/);
  assert.match(wechatService, /wechatAccountId: order\.wechatAccountId/);
  assert.match(wechatService, /conversationId: order\.conversationId/);
  assert.match(wechatService, /customerId: order\.customerId/);
  assert.match(wechatService, /return \{ orderDraft: updatedOrder, sendTask, message, notification \}/);
  assert.match(wechatService, /return \{ orderDraft: await this\.orders\.getById\(order\.id\), sendTask, message, notification \}/);
  assert.match(wechatService, /queueOrderFollowup\([\s\S]*selectedImage: this\.orderSelectedImage\(order\)/);
  assert.match(wechatService, /private expectedIdentityFromOrder\(order: any\): ExpectedIdentityPayload/);
  assert.match(wechatService, /private expectedIdentityFromOrder\(order: any\): ExpectedIdentityPayload[\s\S]*expectedWechatAccountId: order\?\.wechatAccountId/);
  assert.match(wechatService, /private expectedIdentityFromOrder\(order: any\): ExpectedIdentityPayload[\s\S]*expectedConversationId: order\?\.conversationId/);
  assert.match(wechatService, /private expectedIdentityFromOrder\(order: any\): ExpectedIdentityPayload[\s\S]*expectedCustomerId: order\?\.customerId/);
  assert.doesNotMatch(wechatService, /expectedCustomerId: order\?\.customerId \|\| order\?\.quoteDraft\?\.customerId \|\| designJob\?\.customerId/);
  assert.match(lowValueOrderConfirmationSection, /queueOrderConfirmation\(order\.id, \{[\s\S]*\.\.\.this\.expectedIdentityFromOrder\(order\)/);
  assert.match(lowValueOrderFollowupSection, /queueOrderFollowup\(order\.id, \{[\s\S]*\.\.\.this\.expectedIdentityFromOrder\(order\)/);
  assert.match(inboundAcceptanceSection, /queueOrderConfirmation\(result\.orderDraft\.id, \{[\s\S]*\.\.\.this\.expectedIdentityFromOrder\(result\.orderDraft\)/);
  assert.match(wechatService, /private assertHighValueOrderHasManualRelease/);
  assert.match(wechatService, /private isHighValueOrder\(order: any\)[\s\S]*isHighValueBudget\(designJob\?\.budget, threshold\)/);
  assert.match(wechatService, /assertExpectedIdentity\(taskBeforeValidation, params, "send task"\)/);
  assert.match(wechatService, /assertExpectedIdentity\(task, payload, "send task"\)/);
  assert.match(page, /executeSendTask\(task\.id, identityExpectation\(task\)\)/);
  assert.match(page, /queueQuoteSend\(quote\.id, identityExpectation\(quote\)\)/);
  assert.match(page, /createOrderDraftFromQuote\(quote\.id, identityExpectation\(quote\)\)/);
  assert.match(page, /queueOrderConfirmation\(order\.id, identityExpectation\(order\), manualRelease\)/);
  assert.match(page, /queueOrderFollowup\(order\.id, type, identityExpectation\(order\)(?:, manualRelease)?\)/);
  assert.match(api, /notification\?: NotificationItem \| null/);
  assert.match(page, /function upsertNotificationState\(notice: NotificationItem \| null \| undefined\)/);
  assert.match(page, /upsertNotificationState\(result\?\.notification\)/);
  assert.match(page, /upsertNotificationState\(reviewResult\.notification\)/);
});

test("send attempt lists are filtered by selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");

  assert.match(api, /export async function getSendAttempts\(sendTaskId\?: string, filters: IdentityFilters = \{\}\)/);
  assert.match(api, /params\.set\("sendTaskId", sendTaskId\)/);
  assert.match(page, /getSendAttempts\(undefined, identityFilters\)/);
  assert.match(controller, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(controller, /return this\.wechat\.listSendAttempts\(\{ sendTaskId, wechatAccountId, conversationId, customerId \}\)/);
  assert.match(service, /listSendAttempts\(filter: \{ sendTaskId\?: string; wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(service, /if \(filter\.sendTaskId\) \{[\s\S]*this\.assertSendAttemptListIdentity\(filter\)[\s\S]*return this\.localStore\.listSendAttempts\(\{ sendTaskId: filter\.sendTaskId \}\)/);
  assert.match(service, /return this\.localStore\.listSendAttempts\(filter\)/);
  assert.match(store, /listSendAttempts\(filter: \{ sendTaskId\?: string; limit\?: number \} & IdentityListFilter = \{\}\)/);
  assert.match(store, /\.filter\(\(attempt\) => this\.matchesIdentityFilter\(attempt, filter\)\)/);
  assert.match(store, /const sendTask = record\?\.sendTask \|\| null/);
  assert.match(store, /sendTask\?\.conversationId/);
    assert.match(store, /sendTask\?\.wechatAccountId/);
  });

test("manual send operation scans are scoped by selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");

  assert.match(api, /export type SendOperationsScanResult = \{/);
  assert.match(api, /bridgeDispatchExpired\?: number/);
  assert.match(api, /autoRetriedLowValue\?: number/);
  assert.match(api, /scanSendOperations\(filters: IdentityFilters = \{\}\): Promise<SendOperationsScanResult>/);
  assert.match(api, /postJson<SendOperationsScanResult>\("\/wechat\/send-tasks\/scan-ops", filters\)/);
  assert.match(api, /processSafeSendQueue\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /postJson<SafeSendQueueResult>\("\/wechat\/send-tasks\/process-safe-queue", filters\)/);
  assert.match(page, /scanSendOperations\(activeIdentityFilters\(\)\)/);
  assert.match(page, /sendOperationsScanSummary\(result\)/);
  assert.match(page, /自动重试 \$\{row\.autoRetriedLowValue \|\| 0\} 个/);
  assert.match(page, /指令过期 \$\{row\.bridgeDispatchExpired \|\| 0\} 个/);
  assert.match(page, /processSafeSendQueue\(activeIdentityFilters\(\)\)/);
  assert.match(controller, /scanSendOperations\(@Body\(\) payload: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(controller, /return this\.wechat\.scanSendOperations\(payload \|\| \{\}\)/);
  assert.match(controller, /processSafeSendQueue\([\s\S]*wechatAccountId\?: string; conversationId\?: string; customerId\?: string/);
  assert.match(service, /scanSendOperations\(filter: IdentityFilter = \{\}\)/);
  assert.match(service, /const tasks = this\.localStore\.listSendTasks\(filter\)/);
  assert.match(service, /const autoRetriedLowValue: any\[\] = \[\]/);
  assert.match(service, /autoRetriedLowValue: autoRetriedLowValue\.length/);
  assert.match(service, /tasks: \{[\s\S]*autoRetriedLowValue/);
  assert.match(service, /processSafeSendQueue\(params: \{ adapter\?: string; limit\?: number; automationOnly\?: boolean \} & IdentityFilter = \{\}\)/);
  assert.match(service, /listSendTasks\(\{[\s\S]*wechatAccountId: params\.wechatAccountId,[\s\S]*conversationId: params\.conversationId,[\s\S]*customerId: params\.customerId,[\s\S]*\}\)/);
});

test("bridge outbox, dispatch and status are scoped by selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");

  assert.match(api, /export async function getBridgeOutbox\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/wechat\/bridge\/outbox\$\{identityQuery\(filters\)\}/);
  assert.match(api, /export type BridgeDispatchResult/);
  assert.match(api, /export async function getBridgeDispatch\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/wechat\/bridge\/dispatch\$\{identityQuery\(filters\)\}/);
  assert.match(api, /export async function getBridgeStatus\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/wechat\/bridge\/status\$\{identityQuery\(filters\)\}/);
  assert.match(page, /getBridgeOutbox\(identityFilters\)/);
  assert.match(page, /getBridgeStatus\(identityFilters\)/);
  assert.match(page, /getBridgeOutbox\([\s\S]*wechatAccountId: conversation\.wechatAccountId[\s\S]*conversationId: conversation\.id[\s\S]*customerId: conversation\.customerId/);
  assert.match(controller, /listBridgeOutbox\([\s\S]*@Query\("wechatAccountId"\) wechatAccountId\?: string[\s\S]*return this\.wechat\.listBridgeOutbox\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(controller, /listBridgeDispatch\([\s\S]*@Query\("wechatAccountId"\) wechatAccountId\?: string[\s\S]*return this\.wechat\.listBridgeDispatch\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(controller, /getBridgeStatus\([\s\S]*@Query\("wechatAccountId"\) wechatAccountId\?: string[\s\S]*return this\.wechat\.getBridgeStatus\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(service, /type IdentityFilter = \{/);
  assert.match(service, /getBridgeStatus\(filter: IdentityFilter = \{\}\)/);
  assert.match(service, /const outbox = this\.listBridgeOutbox\(filter\)/);
  assert.match(service, /listBridgeDispatch\(filter: IdentityFilter = \{\}\)/);
  assert.match(service, /listBridgeDispatch\(\)[\s\S]*matchesBridgeEntryIdentity\(entry, null, filter\)[\s\S]*buildBridgeDispatchListItem\(entry\)/);
  assert.match(service, /expiresAt:\s*typeof data\.expiresAt === "string" \? data\.expiresAt : ""/);
  assert.match(service, /const preflight = isPlainObject\(data\.preflight\) \? data\.preflight : \{\}/);
  assert.match(service, /requiredBeforeSend:\s*Array\.isArray\(preflight\.requiredBeforeSend\)/);
  assert.match(service, /rejectIfWindowChanged:\s*preflight\.rejectIfWindowChanged === true/);
  assert.match(service, /expired:\s*this\.isBridgeDispatchEntryStale/);
  assert.match(api, /expiresAt\?: string/);
  assert.match(api, /expired\?: boolean/);
  assert.match(service, /isBridgeDispatchEntryStale\(entry\)/);
  assert.match(service, /Date\.parse\(String\(entry\?\.expiresAt \|\| ""\)\)/);
  assert.match(service, /sendBridgeAckTimeoutMinutes \* 60/);
  assert.match(service, /listBridgeOutbox\(filter: IdentityFilter = \{\}\)/);
  assert.match(service, /matchesBridgeEntryIdentity\(entry, task, filter\)/);
  assert.match(service, /actualWechatAccountId/);
  assert.match(service, /actualConversationId/);
  assert.match(service, /actualCustomerId/);
});

test("wechat window snapshots are scoped by selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");

  assert.match(api, /export async function getWechatWindowSnapshots\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/wechat\/window-snapshots\$\{identityQuery\(filters\)\}/);
  assert.match(page, /getWechatWindowSnapshots\(identityFilters\)/);
  assert.match(controller, /listWindowSnapshots\([\s\S]*@Query\("wechatAccountId"\) wechatAccountId\?: string[\s\S]*return this\.wechat\.listWindowSnapshots\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(service, /listWindowSnapshots\(filter: IdentityFilter = \{\}\)/);
  assert.match(service, /return this\.localStore\.listWechatWindowSnapshots\(filter\)/);
  assert.match(store, /listWechatWindowSnapshots\(filter: \(IdentityListFilter & \{ limit\?: number \}\) \| number = \{\}\)/);
  assert.match(store, /\.filter\(\(snapshot\) => this\.matchesIdentityFilter\(snapshot, options\)\)/);
  assert.match(store, /record\?\.activeConversation/);
});

test("wechat window snapshot diagnosis only uses conversations from the snapshot account", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");
  const createSection = sliceBetween(store, /\n  createWechatWindowSnapshot\(/, /\n  getLatestWechatWindowSnapshot\(/);
  const demoSection = sliceBetween(service, /\n  createDemoWindowSnapshot\(/, /\n  listSendTasks\(/);

  assert.match(
    createSection,
    /data\.conversations\.filter\(\(conversation\) => conversation\.wechatAccountId === record\.wechatAccountId\)/,
  );
    assert.match(createSection, /diagnoseWechatWindowSnapshot\(\{[\s\S]*conversations,[\s\S]*\}\)/);
    assert.doesNotMatch(createSection, /conversations:\s*data\.conversations/);
    assert.match(demoSection, /this\.assertDemoConversationIdentity\(conversation, payload, "demo window snapshot"\)/);
    assert.match(demoSection, /const otherConversation = conversations\.find\(\(item\) => item\.id !== conversation\.id\) \|\| null/);
    assert.doesNotMatch(demoSection, /this\.localStore\s*\.\s*listConversations\(\)\s*\.\s*find/);
  });

test("notifications and review center are scoped by selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const notificationsController = readProjectFile("apps/api/src/notifications/notifications.controller.ts");
  const notificationsService = readProjectFile("apps/api/src/notifications/notifications.service.ts");
  const reviewsController = readProjectFile("apps/api/src/reviews/reviews.controller.ts");
  const reviewsService = readProjectFile("apps/api/src/reviews/reviews.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");

  assert.match(api, /export async function getNotifications\(unreadOnly = false, filters: IdentityFilters = \{\}\)/);
  assert.match(api, /params\.set\("unreadOnly", unreadOnly \? "true" : "false"\)/);
  assert.match(api, /export async function getReviewCenter\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /export type ReviewCenter = \{[\s\S]*orderDrafts: OrderDraft\[\]/);
  assert.match(api, /return \{ designJobs: \[\], quoteDrafts: \[\], orderDrafts: \[\], logs: \[\] \}/);
  assert.match(api, /\/reviews\$\{identityQuery\(filters\)\}/);
  assert.match(page, /getNotifications\(false, identityFilters\)/);
  assert.match(page, /getReviewCenter\(identityFilters\)/);
  assert.match(page, /useState<ReviewCenter>\(\{ designJobs: \[\], quoteDrafts: \[\], orderDrafts: \[\], logs: \[\] \}\)/);
  assert.match(notificationsController, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(notificationsController, /conversationId/);
  assert.match(notificationsController, /customerId/);
  assert.match(notificationsService, /list\(options: \{ unreadOnly\?: boolean; limit\?: number; wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(notificationsService, /if \(options\.wechatAccountId \|\| options\.conversationId \|\| options\.customerId\)/);
  assert.match(notificationsService, /take: Math\.min\(limit \* 5, 1000\)/);
  assert.match(notificationsService, /\.then\(\(rows\) => rows\.filter\(\(row\) => this\.matchesTargetIdentity\(row\.target, options\)\)\.slice\(0, limit\)\)/);
  assert.match(reviewsController, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(reviewsController, /return this\.reviews\.list\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(reviewsService, /async list\(filter: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(reviewsService, /\.listDesignJobs\(filter\)/);
  assert.match(reviewsService, /\.listQuoteDrafts\(filter\)/);
  assert.match(reviewsService, /\.listOrderDrafts\(filter\)/);
  assert.match(reviewsService, /function isOrderReviewVisible\(order: any\)/);
  assert.match(reviewsService, /return isOrderHighValue\(order\) \|\| orderNeedsManualSendAttention\(order\)/);
  assert.match(reviewsService, /function orderNeedsManualSendAttention\(order: any\)/);
  assert.match(reviewsService, /function isOrderHighValue\(order: any\)/);
  assert.match(reviewsService, /listReviewLogs\(\{ \.\.\.filter, limit: 80 \}\)/);
  assert.match(reviewsService, /prisma\.reviewLog\.findMany\(\{ orderBy: \{ createdAt: "desc" \}, take: hasIdentityFilter\(filter\) \? 240 : 80 \}\)/);
  assert.match(reviewsService, /logs: logs\.filter\(\(log: any\) => matchesReviewLogIdentity\(log, filter\)\)\.slice\(0, 80\)/);
  assert.match(reviewsService, /function hasIdentityFilter\(filter: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \}\)/);
  assert.match(reviewsService, /function matchesReviewLogIdentity\(log: any, filter: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(reviewsService, /metadata\.wechatAccountId/);
  assert.match(reviewsService, /metadata\.conversationId/);
  assert.match(reviewsService, /metadata\.customerId/);
  assert.match(store, /listNotifications\(options: \{ unreadOnly\?: boolean; limit\?: number \} & IdentityListFilter = \{\}\)/);
  assert.match(store, /\.filter\(\(notice\) => this\.matchesIdentityFilter\(notice, options\)\)/);
  assert.match(store, /listReviewLogs\(filter: \(IdentityListFilter & \{ limit\?: number \}\) \| number = 100\)/);
  assert.match(store, /\.filter\(\(log\) => this\.matchesIdentityFilter\(log, options\)\)/);
});

test("manual review logs persist complete account conversation and customer identity", () => {
  const designJobsService = readProjectFile("apps/api/src/design-jobs/design-jobs.service.ts");
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const quotesService = readProjectFile("apps/api/src/quotes/quotes.service.ts");

  const revisionPolicySection = sliceBetween(designJobsService, /source: "design_revision_policy"/, /await this\.assertDesignPlatformPreflight/);
  const handoffMetadataSection = sliceBetween(designJobsService, /private buildManualHandoffMetadata/, /private async queueDesignTextMessage/);
  const inboundSelectionSection = sliceBetween(wechatService, /this\.localStore\.selectDesignImage/, /const existingQuote = this\.localStore/);
  const inboundQuoteReviewSection = sliceBetween(wechatService, /private async createInboundQuoteReview/, /private hasInboundPaymentProof/);
  const inboundSelectionReviewSection = sliceBetween(wechatService, /private async createInboundSelectionReview/, /private async lockConversationForManualReview/);
  const quoteRevisionSection = sliceBetween(quotesService, /decision: "manual_quote_revision"/, /\n  async preview/);
  const quoteReleaseSection = sliceBetween(quotesService, /source: "manual_release_quote_send"/, /\n    return \{ quote: updated, sendTask \}/);
  const paymentProofSection = sliceBetween(quotesService, /decision: "manual_payment_proof_verified"/, /\n      \}\);/);

  assert.match(revisionPolicySection, /wechatAccountId: job\.wechatAccountId/);
  assert.match(revisionPolicySection, /conversationId: job\.conversationId/);
  assert.match(revisionPolicySection, /customerId: job\.customerId/);
  assert.match(handoffMetadataSection, /metadata\.wechatAccountId = job\.wechatAccountId/);
  assert.match(handoffMetadataSection, /metadata\.conversationId = job\.conversationId/);
  assert.match(handoffMetadataSection, /metadata\.customerId = job\.customerId/);
  assert.match(inboundSelectionSection, /wechatAccountId: params\.conversation\.wechatAccountId/);
  assert.match(inboundSelectionSection, /conversationId: params\.conversation\.id/);
  assert.match(inboundSelectionSection, /customerId: params\.conversation\.customerId/);
  assert.match(inboundQuoteReviewSection, /wechatAccountId: conversation\.wechatAccountId/);
  assert.match(inboundQuoteReviewSection, /conversationId: conversation\.id/);
  assert.match(inboundQuoteReviewSection, /customerId: conversation\.customerId/);
  assert.match(inboundSelectionReviewSection, /wechatAccountId: conversation\.wechatAccountId/);
  assert.match(inboundSelectionReviewSection, /conversationId: conversation\.id/);
  assert.match(inboundSelectionReviewSection, /customerId: conversation\.customerId/);
  assert.match(quoteRevisionSection, /wechatAccountId: current\.designJob\?\.wechatAccountId/);
  assert.match(quoteRevisionSection, /conversationId: current\.designJob\?\.conversationId/);
  assert.match(quoteRevisionSection, /customerId: current\.customerId \|\| current\.designJob\?\.customerId/);
  assert.match(quoteReleaseSection, /wechatAccountId: designJob\.wechatAccountId/);
  assert.match(quoteReleaseSection, /conversationId: designJob\.conversationId/);
  assert.match(quoteReleaseSection, /customerId: quote\.customerId \|\| designJob\.customerId/);
  assert.match(paymentProofSection, /wechatAccountId: confirmedOrder\.wechatAccountId \|\| quote\.designJob\?\.wechatAccountId/);
  assert.match(paymentProofSection, /conversationId: confirmedOrder\.conversationId \|\| quote\.designJob\?\.conversationId/);
  assert.match(paymentProofSection, /customerId: confirmedOrder\.customerId \|\| quote\.customerId \|\| quote\.designJob\?\.customerId/);
  assert.match(quotesService, /if \(this\.isHighValueQuote\(quote\)\) \{[\s\S]*reason: "manual_payment_proof_high_value"/);
  assert.match(quotesService, /decision: "manual_payment_proof_verified_high_value"/);
  assert.match(quotesService, /sendTask: null,[\s\S]*高价值订单付款已核验/);
});

test("notification bulk read is scoped by selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const controller = readProjectFile("apps/api/src/notifications/notifications.controller.ts");
  const service = readProjectFile("apps/api/src/notifications/notifications.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");

  assert.match(api, /export async function markAllNotificationsRead\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /postJson<\{ count: number \}>\("\/notifications\/read-all", filters\)/);
  assert.match(page, /function activeIdentityFilters\(\)/);
  assert.match(page, /markAllNotificationsRead\(activeIdentityFilters\(\)\)/);
  assert.match(controller, /markAllRead\(@Body\(\) body: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(controller, /return this\.notifications\.markAllRead\(\{[\s\S]*wechatAccountId: body\?\.wechatAccountId,[\s\S]*conversationId: body\?\.conversationId,[\s\S]*customerId: body\?\.customerId,[\s\S]*\}\)/);
  assert.match(service, /markAllRead\(filter: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(service, /this\.localStore\.markAllNotificationsRead\(filter\)/);
  assert.match(store, /markAllNotificationsRead\(filter: IdentityListFilter = \{\}\)/);
  assert.match(store, /if \(!notice\.readAt && this\.matchesIdentityFilter\(notice, filter\)\)/);
});

test("review decisions carry and enforce expected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const controller = readProjectFile("apps/api/src/reviews/reviews.controller.ts");
  const service = readProjectFile("apps/api/src/reviews/reviews.service.ts");

  assert.match(api, /export type ReviewDesignJobResult = \{/);
  assert.match(api, /designJob\?: DesignJob \| null/);
  assert.match(api, /export type ReviewQuoteResult = \{/);
  assert.match(api, /reviewDesignJob\(id: string, payload: \{[\s\S]*\} & IdentityExpectation\): Promise<ReviewDesignJobResult>/);
  assert.match(api, /reviewQuote\(id: string, payload: \{[\s\S]*\} & IdentityExpectation\): Promise<ReviewQuoteResult>/);
  assert.match(api, /reviewOrder\(id: string, payload: \{[\s\S]*approve_confirmation[\s\S]*approve_followup[\s\S]*\} & IdentityExpectation\)/);
  assert.match(api, /`\/reviews\/orders\/\$\{id\}`/);
  assert.match(page, /reviewDesignJob\(job\.id, \{[\s\S]*\.\.\.identityExpectation\(job\),[\s\S]*decision,/);
  assert.match(page, /reviewQuote\(quote\.id, \{[\s\S]*\.\.\.identityExpectation\(quote\),[\s\S]*decision,/);
  assert.match(page, /reviewOrder\(order\.id, \{[\s\S]*\.\.\.identityExpectation\(order\),[\s\S]*decision,/);
  assert.match(page, /function applyReviewDesignJobResultState\(result: ReviewDesignJobResult \| null \| undefined\)/);
  assert.match(page, /const job = reviewResult\.designJob \|\| \(reviewResult\.requestId \? \(reviewResult as DesignJob\) : null\)/);
  assert.match(page, /upsertSendTaskState\(reviewResult\.sendTask\)/);
  assert.match(page, /function applyReviewQuoteResultState\(result: ReviewQuoteResult \| null \| undefined\)/);
  assert.match(page, /applyReviewDesignJobResultState\(reviewed\)/);
  assert.match(page, /applyReviewQuoteResultState\(reviewed\)/);
  assert.match(controller, /ExpectedIdentityPayload/);
  assert.match(controller, /reviewDesignJob\([\s\S]*\} & ExpectedIdentityPayload/);
  assert.match(controller, /reviewQuote\([\s\S]*\} & ExpectedIdentityPayload/);
  assert.match(controller, /@Post\("orders\/:id"\)/);
  assert.match(controller, /reviewOrder\([\s\S]*approve_confirmation[\s\S]*approve_followup[\s\S]*\} & ExpectedIdentityPayload/);
  assert.match(service, /ExpectedIdentityPayload, assertExpectedIdentity/);
  assert.match(service, /type ReviewPayload = ExpectedIdentityPayload & \{/);
  assert.match(service, /assertExpectedIdentity\(job, payload, "design job"\)/);
  assert.match(service, /assertExpectedIdentity\(quote, payload, "quote draft"\)/);
  assert.match(service, /assertExpectedIdentity\(order, payload, "order draft"\)/);
  assert.match(service, /const designJobTarget = \{[\s\S]*designJobId: id,[\s\S]*wechatAccountId: job\.wechatAccountId,[\s\S]*conversationId: job\.conversationId,[\s\S]*customerId: job\.customerId/);
  assert.match(service, /const sendTask = await this\.designJobs\.quickConfirmAndQueueSend\(id,/);
  assert.match(service, /result = \{ designJob, sendTask \}/);
  assert.match(service, /let notification: any = null/);
  assert.match(service, /notification = await this\.notifications\.create\("info", "人工审核已批准发送"/);
  assert.match(service, /metadata: \{[\s\S]*\.\.\.designJobTarget/);
  assert.match(service, /const quoteTarget = \{[\s\S]*quoteDraftId: id,[\s\S]*designJobId: quote\.designJobId \|\| quote\.designJob\?\.id,[\s\S]*wechatAccountId: quote\.designJob\?\.wechatAccountId,[\s\S]*conversationId: quote\.designJob\?\.conversationId,[\s\S]*customerId: quote\.customerId \|\| quote\.designJob\?\.customerId/);
  assert.match(service, /notification = await this\.notifications\.create\([\s\S]*decision === "reject_quote" \? "warning" : "info"/);
  assert.match(service, /return \{ result, log, notification \}/);
  assert.match(service, /\{ \.\.\.quoteTarget, sendTaskId: result\?\.sendTask\?\.id \}/);
  assert.match(service, /metadata: \{[\s\S]*\.\.\.quoteTarget,[\s\S]*sendTaskId: result\?\.sendTask\?\.id/);
  assert.match(service, /\.filter\(\(job: any\) => isDesignJobReviewVisible\(job\)\)/);
  assert.match(service, /where: \{ status: \{ in: \["manual_review", "failed", "timeout", "completed", "quick_confirm"\] \} \}/);
  assert.match(service, /function isDesignJobReviewVisible\(job: any\)[\s\S]*isDesignJobHighValue\(job\)[\s\S]*"completed", "quick_confirm"/);
  assert.match(service, /\.filter\(\(quote: any\) => isQuoteReviewVisible\(quote\)\)/);
  assert.match(service, /where: \{ status: \{ in: \["manual_review", "draft", "auto_sent", "send_queued", "sent", "accepted"\] \} \}/);
  assert.match(service, /function isQuoteHighValue\(quote: any\)[\s\S]*isDesignJobHighValue\(quote\?\.designJob \|\| \{\}\)[\s\S]*totalPrice >= highValueAmount/);
  assert.match(service, /quickConfirmAndQueueSend\(id, \{[\s\S]*expectedWechatAccountId: payload\.expectedWechatAccountId,[\s\S]*expectedConversationId: payload\.expectedConversationId,[\s\S]*expectedCustomerId: payload\.expectedCustomerId,/);
  assert.match(service, /this\.quotes\.queueSend\(id, \{[\s\S]*expectedWechatAccountId: payload\.expectedWechatAccountId,[\s\S]*expectedConversationId: payload\.expectedConversationId,[\s\S]*expectedCustomerId: payload\.expectedCustomerId,/);
  assert.match(service, /this\.wechat\.queueOrderConfirmation\(id, \{[\s\S]*releaseManualLock: true,[\s\S]*releaseReason: "manual_approve_order_confirmation"/);
  assert.match(service, /this\.wechat\.queueOrderFollowup\(id, \{[\s\S]*releaseManualLock: true,[\s\S]*releaseReason: "manual_approve_order_followup"/);
  assert.match(service, /targetType: "order_draft"/);
});

test("design job manual actions carry and enforce expected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const controller = readProjectFile("apps/api/src/design-jobs/design-jobs.controller.ts");
  const service = readProjectFile("apps/api/src/design-jobs/design-jobs.service.ts");

  assert.match(api, /submitDesignJob\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /preflightDesignJob\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /pollDesignJob\(\s*id: string,\s*expected: IdentityExpectation = \{\},/);
  assert.match(api, /retryDesignJob\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /quickConfirmSend\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /cancelDesignJob\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /createQuote\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /markManualReview\(id: string, expected: IdentityExpectation = \{\}\)/);
    assert.match(api, /selectDesignImage\(id: string, input: SelectImagePayload, expected: IdentityExpectation = \{\}\)/);
    assert.match(api, /requestDesignRevision\(id: string, payload: \{[\s\S]*\} & IdentityExpectation\)/);
    assert.match(api, /scanDesignTimeouts\(filters: IdentityFilters = \{\}\)/);
    assert.match(api, /pollActiveDesignResults\(filters: IdentityFilters = \{\}\)/);
    assert.match(api, /autoSubmitDesignDrafts\(filters: IdentityFilters = \{\}\)/);
    assert.match(api, /scanHighValueHandoffs\(filters: IdentityFilters = \{\}\)/);
    assert.match(page, /submitDesignJob\(job\.id, identityExpectation\(job\)\)/);
  assert.match(page, /runDesignJobPreflight\(job\)/);
  assert.match(page, /function runDesignJobPreflight\(job: DesignJob\)[\s\S]*preflightDesignJob\(job\.id, identityExpectation\(job\)\)/);
  assert.match(page, /pollDesignJobIntoState\(activeJob\)/);
  assert.match(page, /function pollDesignJobIntoState\(job: DesignJob\)[\s\S]*pollDesignJob\(job\.id, identityExpectation\(job\)\)/);
  assert.match(page, /function confirmDesignRevisionRequest\(job: DesignJob, instruction: string,[\s\S]*designJobIdentityConfirmLines\(job\)/);
  assert.match(page, /confirmDesignRevisionRequest[\s\S]*当前选图[\s\S]*客户改图要求[\s\S]*clippedInstruction/);
  assert.match(page, /function confirmDesignJobRetry\(job: DesignJob\)[\s\S]*designJobIdentityConfirmLines\(job\)/);
  assert.match(page, /confirmDesignJobRetry[\s\S]*designStatusLabel\(job\.status\)[\s\S]*operatorStatusMessage\(job\.errorMessage, job\.errorMessage\)/);
  assert.match(page, /function confirmDesignJobCancel\(job: DesignJob\)[\s\S]*designJobIdentityConfirmLines\(job\)/);
  assert.match(page, /confirmDesignJobCancel[\s\S]*当前选图[\s\S]*取消后不会继续出图或发图/);
  assert.match(page, /async function retryActiveJob\([\s\S]*if \(!confirmDesignJobRetry\(activeJob\)\) \{[\s\S]*已取消重试设计任务/);
  assert.match(page, /retryDesignJob\(activeJob\.id, identityExpectation\(activeJob\)\)/);
  assert.match(page, /quickConfirmSend\(activeJob\.id, identityExpectation\(activeJob\)\)/);
  assert.match(page, /async function cancelActiveJob\([\s\S]*if \(!confirmDesignJobCancel\(activeJob\)\) \{[\s\S]*已取消设计任务取消操作/);
  assert.match(page, /cancelDesignJob\(activeJob\.id, identityExpectation\(activeJob\)\)/);
  assert.match(page, /createQuoteForJob\(activeJob\)/);
  assert.match(page, /createQuote\(job\.id, identityExpectation\(job\)\)/);
  assert.match(page, /markManualReview\(activeJob\.id, identityExpectation\(activeJob\)\)/);
    assert.match(page, /selectDesignImage\(activeJob\.id,[\s\S]*identityExpectation\(activeJob\)\)/);
    assert.match(page, /requestRevisionForJob[\s\S]*if \(!confirmDesignRevisionRequest\(job, instruction, selectedImage\)\) \{[\s\S]*已取消提交客户改图/);
    assert.match(page, /requestDesignRevision\(job\.id, \{[\s\S]*\.\.\.identityExpectation\(job\)/);
    assert.match(page, /scanDesignTimeouts\(activeIdentityFilters\(\)\)/);
    assert.match(page, /pollActiveDesignResults\(activeIdentityFilters\(\)\)/);
    assert.match(page, /autoSubmitDesignDrafts\(activeIdentityFilters\(\)\)/);
    assert.match(page, /scanHighValueHandoffs\(activeIdentityFilters\(\)\)/);
    assert.match(controller, /ExpectedIdentityPayload/);
    assert.match(controller, /scanTimeouts\(@Body\(\) payload: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
    assert.match(controller, /pollActiveResults\(@Body\(\) payload: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
    assert.match(controller, /autoSubmitDrafts\(@Body\(\) payload: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
    assert.match(controller, /scanHighValueHandoffs\(@Body\(\) payload: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
    assert.match(controller, /submit\(@Param\("id"\) id: string, @Body\(\) body: ExpectedIdentityPayload = \{\}\)/);
  assert.match(controller, /quickConfirmSend\(@Param\("id"\) id: string, @Body\(\) body: ExpectedIdentityPayload = \{\}\)/);
  assert.match(controller, /requestRevision\(@Param\("id"\) id: string, @Body\(\) payload: CreateDesignRevisionPayload & ExpectedIdentityPayload\)/);
    assert.match(service, /ExpectedIdentityPayload, assertExpectedIdentity/);
    assert.match(service, /type IdentityFilter = \{/);
    assert.match(service, /scanHighValueHandoffs\(filter: IdentityFilter = \{\}\)/);
    assert.match(service, /scanAutoSubmitDrafts\(filter: IdentityFilter = \{\}\)/);
    assert.match(service, /pollActiveResults\(limit = appConfig\.lowValueAutomationPollLimit, filter: IdentityFilter = \{\}\)/);
    assert.match(service, /scanTimeouts\(filter: IdentityFilter = \{\}\)/);
    assert.match(service, /this\.localStore\.listDesignJobs\(filter\)/);
  assert.match(service, /cleanIdentityWhere\(filter\)/);
  assert.match(service, /async submit\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(service, /async quickConfirmAndQueueSend\([\s\S]*ExpectedIdentityPayload = \{\}/);
  assert.match(service, /this\.assertDesignJobHasCompleteSendIdentity\(job\)/);
  assert.match(service, /private assertDesignJobHasCompleteSendIdentity\(job: any\)/);
  assert.match(service, /const wechatAccountId = String\(job\?\.wechatAccountId \|\| ""\)\.trim\(\)/);
  assert.match(service, /const customerId = String\(job\?\.customerId \|\| ""\)\.trim\(\)/);
  assert.match(service, /const conversationId = String\(job\?\.conversationId \|\| ""\)\.trim\(\)/);
  assert.match(service, /throw new BadRequestException\("设计任务缺少微信账号、客户或会话绑定，不能进入微信发送队列。"\)/);
  assert.match(service, /setConversationManualLock\(job\.conversationId, \{[\s\S]*expectedWechatAccountId: job\.wechatAccountId,[\s\S]*expectedConversationId: job\.conversationId,[\s\S]*expectedCustomerId: job\.customerId,[\s\S]*locked: false/);
  assert.match(service, /setConversationManualLock\(job\.conversationId, \{[\s\S]*expectedWechatAccountId: job\.wechatAccountId,[\s\S]*expectedConversationId: job\.conversationId,[\s\S]*expectedCustomerId: job\.customerId,[\s\S]*locked: true/);
  assert.match(service, /evaluateLowValueDesignImageSend\(job, \{ highValueAmountCny: appConfig\.highValueAmountCny \}\)/);
  assert.match(service, /async requestRevision\(id: string, payload: CreateDesignRevisionPayload & ExpectedIdentityPayload\)/);
  assert.match(service, /decideRevisionPolicy\(\{[\s\S]*isHighValue: job\.isHighValue,[\s\S]*budget: job\.budget,[\s\S]*highValueAmountCny: appConfig\.highValueAmountCny/);
  assert.match(service, /isHighValue: this\.isHighValueDesignJob\(job\)/);
  assert.match(service, /private async afterImageSelected[\s\S]*if \(this\.isHighValueDesignJob\(job\)\)/);
  assert.match(service, /private isHighValueDesignJob\(job: any\)[\s\S]*isHighValueBudget\(job\?\.budget, Number\(appConfig\.highValueAmountCny \|\| 10000\)\)/);
  assert.match(service, /private async retryDesignJob\([\s\S]*expected: ExpectedIdentityPayload = \{\}/);
  assert.match(service, /assertExpectedIdentity\(job, expected, "design job"\)/);
  assert.match(service, /assertExpectedIdentity\(job, payload, "design job"\)/);
  assert.match(service, /assertExpectedIdentity\(job, options, "design job"\)/);
  assert.match(service, /source: "manual_release_design_send"[\s\S]*conversationId: job\.conversationId,[\s\S]*wechatAccountId: job\.wechatAccountId,[\s\S]*customerId: job\.customerId/);
});

test("design preflight panel exposes bundle automation readiness", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const preflightSection = page.slice(page.indexOf("function PreflightPanel"), page.indexOf("function CandidateImages"));

  assert.match(preflightSection, /const bundleAutomation = job\.bundle\?\.automation \|\| null/);
  assert.match(preflightSection, /const bundleAutomationBlocked = bundleAutomation\?\.ready === false/);
  assert.match(preflightSection, /组合自动化：\{bundleAutomation\.ready \? "可自动" : "需人工"\}/);
  assert.match(preflightSection, /商品组合自动化：/);
  assert.match(preflightSection, /automationBlockerListLabel\(bundleAutomation\.blockers \|\| \[\]\)/);
});

test("design assets and conversation manual locks carry expected identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const assetsController = readProjectFile("apps/api/src/assets/assets.controller.ts");
  const assetsService = readProjectFile("apps/api/src/assets/assets.service.ts");
  const localStore = readProjectFile("apps/api/src/local-store/local-store.service.ts");
  const identityBinding = readProjectFile("packages/rules/identityBinding.js");
  const designController = readProjectFile("apps/api/src/design-jobs/design-jobs.controller.ts");
  const designService = readProjectFile("apps/api/src/design-jobs/design-jobs.service.ts");
  const wechatController = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const prismaSchema = readProjectFile("prisma/schema.prisma");
  const designAssetIdentityMigration = readProjectFile(
    "prisma/migrations/20260705010000_add_design_asset_identity/migration.sql",
  );

  assert.match(api, /export type UploadAssetPayload = \{[\s\S]*\} & IdentityExpectation/);
  assert.match(api, /export async function getAssets\(ownerType\?: string, ownerId\?: string, filters: IdentityFilters = \{\}\)/);
  assert.match(api, /if \(filters\.wechatAccountId\) params\.set\("wechatAccountId", filters\.wechatAccountId\)/);
  assert.match(api, /if \(filters\.conversationId\) params\.set\("conversationId", filters\.conversationId\)/);
  assert.match(api, /if \(filters\.customerId\) params\.set\("customerId", filters\.customerId\)/);
  assert.match(api, /createDemoCustomerLogo\(customerId: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /postJson<DesignAsset>\("\/assets\/demo-customer-logo", \{ customerId, \.\.\.expected \}\)/);
  assert.match(api, /attachDesignJobAssets\(id: string, assetIds: string\[\], expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /postJson<DesignJob>\(`\/design-jobs\/\$\{id\}\/assets`, \{ \.\.\.expected, assetIds \}\)/);
  assert.match(api, /getDesignJobRevisions\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /\/design-jobs\/\$\{id\}\/revisions\$\{expectedIdentityQuery\(expected\)\}/);
  assert.match(api, /localAssetUrl\(localPath\?: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /new URLSearchParams\(expectedIdentityQuery\(expected\)\.replace\(/);
  assert.match(api, /params\.set\("path", value\)/);
  assert.match(api, /setConversationManualLock\([\s\S]*\} & IdentityExpectation/);
  assert.match(api, /createDemoSendTask\([\s\S]*expected: IdentityExpectation = \{\}/);
  assert.match(api, /export type ManualReleaseOptions = \{/);
  assert.match(api, /queueOrderConfirmation\([\s\S]*manualRelease: ManualReleaseOptions = \{\}/);
  assert.match(api, /queueOrderFollowup\([\s\S]*manualRelease: ManualReleaseOptions = \{\}/);
  assert.match(api, /\.\.\.manualRelease,[\s\S]*owner: "人工客服"/);
  assert.match(api, /validateSendTask\(id: string, mode: "correct" \| "wrong_chat", expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /`\/wechat\/send-tasks\/\$\{id\}\/validate`, \{ \.\.\.expected, mode \}/);
  assert.match(api, /validateSendTaskCurrentWindow\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /`\/wechat\/send-tasks\/\$\{id\}\/validate-current-window`, expected/);
  assert.match(page, /function conversationIdentityExpectation\(conversation: Conversation\)/);
  assert.match(page, /expectedWechatAccountId: conversation\.wechatAccountId/);
  assert.match(page, /expectedConversationId: conversation\.id/);
  assert.match(page, /expectedCustomerId: conversation\.customerId/);
  assert.match(page, /createDemoCustomerLogo\(activeConversation\.customerId, conversationIdentityExpectation\(activeConversation\)\)/);
  assert.match(page, /uploadAsset\(\{[\s\S]*\.\.\.conversationIdentityExpectation\(activeConversation\),[\s\S]*ownerType: "customer"/);
  assert.match(page, /getAssets\("customer", customerId, \{[\s\S]*wechatAccountId: activeConversation\?\.wechatAccountId \|\| "",[\s\S]*conversationId: activeConversation\?\.id \|\| "",[\s\S]*customerId/);
  assert.match(page, /attachDesignJobAssets\(activeJob\.id, selectedAssetIds, identityExpectation\(activeJob\)\)/);
  assert.match(page, /createDemoSendTask\([\s\S]*targetConversation\.id,[\s\S]*targetConversation\.wechatAccountId,[\s\S]*conversationIdentityExpectation\(targetConversation\)/);
  assert.match(page, /validateSendTask\(task\.id, "wrong_chat", identityExpectation\(task\)\)/);
  assert.match(page, /validateSendTask\(task\.id, "correct", identityExpectation\(task\)\)/);
  assert.match(page, /validateSendTaskCurrentWindow\(task\.id, identityExpectation\(task\)\)/);
  assert.match(page, /setConversationManualLock\(conversation\.id, \{[\s\S]*\.\.\.conversationIdentityExpectation\(conversation\)/);
  assert.match(assetsController, /ExpectedIdentityPayload/);
  assert.match(assetsController, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(assetsController, /@Query\("conversationId"\) conversationId\?: string/);
  assert.match(assetsController, /@Query\("customerId"\) customerId\?: string/);
  assert.match(assetsController, /this\.assets\.list\(\{ ownerType, ownerId, wechatAccountId, conversationId, customerId \}\)/);
  assert.match(assetsController, /async localFile\([\s\S]*@Query\("wechatAccountId"\) wechatAccountId: string,[\s\S]*@Query\("conversationId"\) conversationId: string,[\s\S]*@Query\("customerId"\) customerId: string/);
  assert.match(assetsController, /this\.assets\.readLocalAsset\(localPath, \{[\s\S]*expectedWechatAccountId: wechatAccountId,[\s\S]*expectedConversationId: conversationId,[\s\S]*expectedCustomerId: customerId/);
  assert.match(assetsController, /createDemoCustomerLogo\(@Body\(\) payload: \{ customerId\?: string \} & ExpectedIdentityPayload\)/);
  assert.match(assetsController, /this\.assets\.createDemoCustomerLogo\(payload\.customerId, payload\)/);
  assert.match(assetsService, /ExpectedIdentityPayload, assertExpectedIdentity/);
  assert.match(assetsService, /list\(filter: \{ ownerType\?: string; ownerId\?: string; wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(assetsService, /this\.assertCustomerAssetListIdentity\(filter\)/);
  assert.match(assetsService, /customer asset list requires conversation identity: \$\{missing\.join\(", "\)\}/);
  assert.match(assetsService, /assertExpectedIdentity\([\s\S]*\{ customerId: filter\.ownerId \},[\s\S]*\{ expectedCustomerId: filter\.customerId \},[\s\S]*"customer asset list owner"/);
  assert.match(assetsService, /"customer asset list conversation customer"/);
  assert.match(assetsService, /\.\.\.\(filter\.wechatAccountId \? \{ wechatAccountId: filter\.wechatAccountId \} : \{\}\)/);
  assert.match(assetsService, /\.\.\.\(filter\.conversationId \? \{ conversationId: filter\.conversationId \} : \{\}\)/);
  assert.match(assetsService, /\.\.\.\(filter\.customerId \? \{ customerId: filter\.customerId \} : \{\}\)/);
  assert.match(assetsService, /wechatAccountId: payload\.expectedWechatAccountId \|\| null/);
  assert.match(assetsService, /conversationId: payload\.expectedConversationId \|\| null/);
  assert.match(assetsService, /customerId: payload\.expectedCustomerId \|\| \(payload\.ownerType === "customer" \? payload\.ownerId : null\)/);
  assert.match(assetsService, /wechatAccountId: record\.wechatAccountId/);
  assert.match(assetsService, /conversationId: record\.conversationId/);
  assert.match(assetsService, /customerId: record\.customerId/);
  assert.match(assetsService, /this\.assertCustomerAssetIdentity\(payload\)/);
  assert.match(assetsService, /customer asset requires conversation identity: \$\{missing\.join\(", "\)\}/);
  assert.match(assetsService, /!payload\.expectedWechatAccountId \? "expectedWechatAccountId" : ""/);
  assert.match(assetsService, /!payload\.expectedConversationId \? "expectedConversationId" : ""/);
  assert.match(assetsService, /!payload\.expectedCustomerId \? "expectedCustomerId" : ""/);
  assert.match(assetsService, /assertExpectedIdentity\(\{ customerId: payload\.ownerId \}, \{ expectedCustomerId: payload\.expectedCustomerId \}, "customer asset"\)/);
  assert.match(assetsService, /async readLocalAsset\(localPath: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(assetsService, /await this\.assertLocalAssetReadIdentity\(localPath, expected\)/);
  assert.match(assetsService, /local customer asset requires conversation identity: \$\{missing\.join\(", "\)\}/);
  assert.match(assetsService, /assertExpectedIdentity\(asset, expected, "local asset"\)/);
  assert.match(assetsService, /private async findDesignAssetByLocalPath\(localPath: string\)/);
  assert.match(assetsService, /this\.localStore\.listConversations\(payload\.expectedWechatAccountId\)/);
  assert.match(assetsService, /conversation \? \{ \.\.\.conversation, conversationId: conversation\.id \} : conversation/);
  assert.match(assetsService, /"customer asset conversation customer"/);
  assert.match(prismaSchema, /model DesignAsset \{[\s\S]*wechatAccountId String\?/);
  assert.match(prismaSchema, /model DesignAsset \{[\s\S]*conversationId\s+String\?/);
  assert.match(prismaSchema, /model DesignAsset \{[\s\S]*customerId\s+String\?/);
  assert.match(prismaSchema, /@@index\(\[ownerType, ownerId\]\)/);
  assert.match(prismaSchema, /@@index\(\[wechatAccountId, conversationId, customerId\]\)/);
  assert.match(designAssetIdentityMigration, /ALTER TABLE "DesignAsset" ADD COLUMN "wechatAccountId" TEXT/);
  assert.match(designAssetIdentityMigration, /ALTER TABLE "DesignAsset" ADD COLUMN "conversationId" TEXT/);
  assert.match(designAssetIdentityMigration, /ALTER TABLE "DesignAsset" ADD COLUMN "customerId" TEXT/);
  assert.match(designAssetIdentityMigration, /CREATE INDEX "DesignAsset_wechatAccountId_conversationId_customerId_idx"/);
  assert.match(localStore, /listDesignAssets\(filter: \{ ownerType\?: string; ownerId\?: string \} & IdentityListFilter = \{\}\)/);
  assert.match(localStore, /\.filter\(\(asset\) => this\.matchesIdentityFilter\(asset, filter\)\)/);
  assert.match(localStore, /wechatAccountId: payload\.wechatAccountId \|\| null/);
  assert.match(localStore, /conversationId: payload\.conversationId \|\| null/);
  assert.match(localStore, /customerId: payload\.customerId \|\| \(payload\.ownerType === "customer" \? payload\.ownerId : null\)/);
  assert.match(localStore, /\.filter\(\(item\) => this\.designAssetMatchesJobIdentity\(item, job\)\)/);
  assert.match(localStore, /private designAssetMatchesJobIdentity\(asset: any, job: any\)/);
  assert.match(localStore, /asset\.conversationId !== job\.conversationId/);
  assert.match(localStore, /asset\.wechatAccountId !== job\.wechatAccountId/);
  assert.match(identityBinding, /assetConversationMatchesJob:\$\{assetId\}/);
  assert.match(identityBinding, /assetWechatAccountMatchesJob:\$\{assetId\}/);
  assert.match(identityBinding, /assetCustomerIdentityMatchesJob:\$\{assetId\}/);
  assert.match(designController, /attachAssets\(@Param\("id"\) id: string, @Body\(\) body: \{ assetIds: string\[\] \} & ExpectedIdentityPayload\)/);
  assert.match(designController, /this\.designJobs\.attachAssets\(id, body\?\.assetIds \|\| \[\], body \|\| \{\}\)/);
  assert.match(designController, /listRevisions\([\s\S]*@Query\("wechatAccountId"\) wechatAccountId\?: string,[\s\S]*@Query\("conversationId"\) conversationId\?: string,[\s\S]*@Query\("customerId"\) customerId\?: string/);
  assert.match(designController, /this\.designJobs\.listRevisions\(id, \{[\s\S]*expectedWechatAccountId: wechatAccountId,[\s\S]*expectedConversationId: conversationId,[\s\S]*expectedCustomerId: customerId/);
  assert.match(designService, /async attachAssets\(id: string, assetIds: string\[\], expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(designService, /assertExpectedIdentity\(job, expected, "design job"\)/);
  assert.match(designService, /async listRevisions\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(designService, /assertExpectedIdentity\(job, expected, "design job"\)[\s\S]*return this\.localStore\.listDesignRevisions\(id\)/);
  assert.match(designService, /assertExpectedIdentity\(designJob, expected, "design job"\)/);
  assert.match(wechatController, /setConversationManualLock\([\s\S]*\} & ExpectedIdentityPayload/);
  assert.match(wechatController, /queueOrderConfirmation\([\s\S]*releaseManualLock\?: boolean;[\s\S]*releaseReason\?: string;/);
  assert.match(wechatController, /queueOrderFollowup\([\s\S]*releaseManualLock\?: boolean;[\s\S]*releaseReason\?: string;/);
  assert.match(wechatController, /@Body\(\) payload: \{ mode\?: "correct" \| "wrong_chat"; activeWindow\?: Record<string, unknown> \} & ExpectedIdentityPayload/);
  assert.match(wechatController, /validateWithCurrentWindow\(@Param\("id"\) id: string, @Body\(\) payload: ExpectedIdentityPayload = \{\}\)/);
  assert.match(wechatController, /this\.wechat\.validateSendTaskWithCurrentWindow\(id, payload \|\| \{\}\)/);
  assert.match(wechatController, /listSendAttempts\([\s\S]*@Query\("sendTaskId"\) sendTaskId\?: string,[\s\S]*@Query\("wechatAccountId"\) wechatAccountId\?: string,[\s\S]*@Query\("conversationId"\) conversationId\?: string,[\s\S]*@Query\("customerId"\) customerId\?: string/);
  assert.match(wechatController, /this\.wechat\.listSendAttempts\(\{ sendTaskId, wechatAccountId, conversationId, customerId \}\)/);
  assert.match(wechatService, /setConversationManualLock\([\s\S]*\} & ExpectedIdentityPayload = \{\}/);
  assert.match(wechatService, /assertExpectedIdentity\(\{ \.\.\.before, conversationId: before\.id \}, payload, "conversation"\)/);
  assert.match(wechatService, /payload\.locked === true[\s\S]*this\.assertManualLockTransitionHasExpectedIdentity\(payload, "人工接管"\)/);
  assert.match(wechatService, /payload\.locked === false && before\.manualLocked[\s\S]*this\.assertManualLockTransitionHasExpectedIdentity\(payload, "解除人工接管"\)/);
  assert.match(wechatService, /private assertManualLockTransitionHasExpectedIdentity\(payload: ExpectedIdentityPayload, action: string\)/);
  assert.match(wechatService, /throw new BadRequestException\(`\$\{action\}必须带完整会话身份：\$\{missing\.join\(", "\)\}`\)/);
  assert.match(wechatService, /cancelInFlightSendTasksForManualLock\(conversationId: string, reviewer: string\)[\s\S]*this\.cancelSendTask\(task\.id, \{[\s\S]*expectedWechatAccountId: task\.wechatAccountId,[\s\S]*expectedConversationId: task\.conversationId,[\s\S]*expectedCustomerId: task\.customerId \|\| task\.conversation\?\.customerId,[\s\S]*reason,/);
  assert.match(wechatService, /validateSendTask\([\s\S]*\} & ExpectedIdentityPayload = \{\}/);
  assert.match(wechatService, /assertExpectedIdentity\(task, params, "send task"\)/);
  assert.match(wechatService, /validateSendTaskWithCurrentWindow\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(wechatService, /assertExpectedIdentity\(task, expected, "send task"\)/);
  assert.match(wechatService, /this\.validateSendTaskWithCurrentWindow\(id, params\)/);
  assert.match(wechatService, /listSendAttempts\(filter: \{ sendTaskId\?: string; wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(wechatService, /if \(filter\.sendTaskId\) \{[\s\S]*this\.assertSendAttemptListIdentity\(filter\)/);
  assert.match(wechatService, /send attempts require conversation identity: \$\{missing\.join\(", "\)\}/);
  assert.match(wechatService, /assertExpectedIdentity\([\s\S]*"send task"[\s\S]*\)/);
  assert.match(wechatService, /this\.localStore\.listConversations\(payload\.wechatAccountId\)/);
});

test("routing decisions and chat imports stay bound to selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const routingController = readProjectFile("apps/api/src/routing/routing.controller.ts");
  const routingService = readProjectFile("apps/api/src/routing/routing.service.ts");
  const trainingController = readProjectFile("apps/api/src/training/training.controller.ts");
  const trainingService = readProjectFile("apps/api/src/training/training.service.ts");
  const wechatController = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");

  assert.match(api, /getRouteEvaluations\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/routing\/evaluations\$\{identityQuery\(filters\)\}/);
  assert.match(api, /getChatImports\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/training\/chat-imports\$\{identityQuery\(filters\)\}/);
  assert.match(api, /evaluateRoute\(text: string, filters: IdentityFilters = \{\}\)/);
  assert.match(api, /postJson<RouteEvaluation>\("\/routing\/evaluate", \{ channel: "wechat", \.\.\.filters, text \}\)/);
    assert.match(api, /correctRouteEvaluation\([\s\S]*\} & IdentityExpectation/);
    assert.match(api, /processInboundMessage\(payload: \{[\s\S]*customerId\?: string/);
    assert.match(api, /testWechatChannelInbound\([\s\S]*\} & IdentityExpectation/);
    assert.match(page, /getChatImports\(identityFilters\)/);
    assert.match(page, /getRouteEvaluations\(identityFilters\)/);
    assert.match(page, /importChatTranscript\(\{[\s\S]*\.\.\.activeIdentityFilters\(\),[\s\S]*text: chatText/);
    assert.match(page, /evaluateRoute\(routeText, activeIdentityFilters\(\)\)/);
    assert.match(page, /correctRouteEvaluation\(route\.id, \{[\s\S]*\.\.\.identityExpectation\(route\),[\s\S]*agentKey: agent\.key/);
    assert.match(page, /processInboundMessage\(\{[\s\S]*wechatAccountId: conversation\.wechatAccountId,[\s\S]*conversationId: conversation\.id,[\s\S]*customerId: conversation\.customerId/);
    assert.match(page, /testWechatChannelInbound\(channel, \{[\s\S]*\.\.\.conversationIdentityExpectation\(conversation\),[\s\S]*wechatAccountId: conversation\.wechatAccountId,[\s\S]*conversationId: conversation\.id,[\s\S]*customerId: conversation\.customerId/);
  assert.match(routingController, /list\([\s\S]*@Query\("wechatAccountId"\) wechatAccountId\?: string[\s\S]*return this\.routing\.list\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(routingController, /wechatAccountId\?: string/);
  assert.match(routingController, /ExpectedIdentityPayload/);
  assert.match(routingService, /ExpectedIdentityPayload, assertExpectedIdentity/);
  assert.match(routingService, /type IdentityFilter = \{/);
  assert.match(routingService, /list\(filter: IdentityFilter = \{\}\)/);
  assert.match(routingService, /return this\.localStore\.listRouteEvaluations\(filter\)/);
  assert.match(routingService, /wechatAccountId\?: string/);
  assert.match(routingService, /const identityFilter = \{[\s\S]*wechatAccountId: payload\.wechatAccountId,[\s\S]*conversationId: payload\.conversationId,[\s\S]*customerId: payload\.customerId,[\s\S]*\}/);
  assert.match(routingService, /const sceneMemory = this\.listSceneMemorySamples\(identityFilter\)/);
    assert.match(routingService, /this\.localStore\.listKnowledgeEntries\(\{[\s\S]*agentId: agent\.id,[\s\S]*\.\.\.identityFilter,[\s\S]*\}\)/);
    assert.match(wechatController, /processChannelInboundTest\([\s\S]*\} & ExpectedIdentityPayload/);
    assert.match(wechatService, /processChannelInboundTest\([\s\S]*\} & ExpectedIdentityPayload/);
    assert.match(wechatService, /this\.assertDemoConversationIdentity\(fallbackConversation, payload, "channel inbound test"\)/);
  assert.match(routingService, /listSceneMemorySamples\(filter: IdentityFilter = \{\}\)/);
  assert.match(routingService, /\.listTrainingSamples\(filter\)/);
  assert.match(routingService, /const route = this\.localStore\.listRouteEvaluations\(\)\.find/);
  assert.match(routingService, /assertExpectedIdentity\(route, payload, "route evaluation"\)/);
  assert.match(trainingController, /listChatImports\([\s\S]*@Query\("wechatAccountId"\) wechatAccountId\?: string[\s\S]*return this\.training\.listChatImports\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(trainingService, /type IdentityFilter = \{/);
  assert.match(trainingService, /listChatImports\(filter: IdentityFilter = \{\}\)/);
  assert.match(trainingService, /return this\.localStore\.listChatImports\(filter\)/);
  assert.match(wechatController, /customerId\?: string/);
  assert.match(wechatService, /customerId\?: string/);
  assert.match(wechatService, /wechatAccountId: conversation\.wechatAccountId/);
  assert.match(wechatService, /this\.localStore\.listKnowledgeEntries\(\{[\s\S]*agentId: agent\.id,[\s\S]*wechatAccountId: conversation\.wechatAccountId,[\s\S]*conversationId: conversation\.id,[\s\S]*customerId: conversation\.customerId,[\s\S]*\}\)/);
  assert.match(wechatService, /findPendingSceneClarificationContext\(this\.localStore\.listRouteEvaluations\(\{ conversationId \}\), conversationId\)/);
  assert.match(store, /listRouteEvaluations\(filter: IdentityListFilter = \{\}\)/);
  assert.match(store, /\.filter\(\(route\) => this\.matchesIdentityFilter\(route, filter\)\)/);
  assert.match(store, /listChatImports\(filter: IdentityListFilter = \{\}\)/);
  assert.match(store, /\.filter\(\(chatImport\) => this\.matchesIdentityFilter\(chatImport, filter\)\)/);
  assert.match(store, /listKnowledgeEntries\(filter: string \| \(\{ agentId\?: string \} & IdentityListFilter\) = \{\}\)/);
  assert.match(store, /\.filter\(\(entry\) => this\.matchesIdentityFilter\(entry, options\)\)/);
});

test("training sample review actions carry and enforce expected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const controller = readProjectFile("apps/api/src/training/training.controller.ts");
  const service = readProjectFile("apps/api/src/training/training.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");

  assert.match(api, /customerId\?: string \| null/);
  assert.match(api, /conversationId\?: string \| null/);
  assert.match(api, /wechatAccountId\?: string \| null/);
  assert.match(api, /getTrainingSamples\(filters: \{[\s\S]*\} & IdentityFilters = \{\}\)/);
  assert.match(api, /params\.set\("wechatAccountId", filters\.wechatAccountId\)/);
  assert.match(api, /export async function getTrainingOverview\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/training\/overview\$\{identityQuery\(filters\)\}/);
  assert.match(api, /getSkillSuggestions\(filters: \(\{ agentId\?: string; minScore\?: number \} & IdentityFilters\) \| string = \{\}\)/);
  assert.match(api, /params\.set\("conversationId", options\.conversationId\)/);
  assert.match(api, /applySkillSuggestions\([\s\S]*\} & IdentityFilters = \{\}/);
  assert.match(page, /getTrainingSamples\(\{ \.\.\.identityFilters,[\s\S]*quality: trainingSampleApiQualityFilter/);
  assert.match(page, /getTrainingSamples\(\{ \.\.\.identityFilters,[\s\S]*sourceType: "route_correction"/);
  assert.match(page, /getTrainingOverview\(identityFilters\)/);
  assert.match(page, /getSkillSuggestions\(identityFilters\)/);
  assert.match(page, /applySkillSuggestions\(\{ \.\.\.activeIdentityFilters\(\), minScore: 70, suggestionKeys, includeNeedsReview \}\)/);
  assert.match(page, /getTrainingOverview\(activeIdentityFilters\(\)\)/);
  assert.match(page, /getTrainingSamples\(\{[\s\S]*\.\.\.activeIdentityFilters\(\),[\s\S]*quality: trainingSampleApiQualityFilter\(filter\)/);
  assert.match(page, /getTrainingSamples\(\{[\s\S]*\.\.\.activeIdentityFilters\(\),[\s\S]*quality: trainingSampleApiQualityFilter\(trainingSampleQualityFilter\)/);
  assert.match(api, /reviewTrainingSample\([\s\S]*\} & IdentityExpectation/);
  assert.match(api, /expectedBySampleId\?: Record<string, IdentityExpectation>/);
  assert.match(page, /reviewTrainingSample\(sample\.id, \{[\s\S]*\.\.\.identityExpectation\(sample\),[\s\S]*status,/);
  assert.match(page, /expectedBySampleId: Object\.fromEntries\(candidates\.map\(\(sample\) => \[sample\.id, identityExpectation\(sample\)\]\)\)/);
  assert.match(controller, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(controller, /@Query\("conversationId"\) conversationId\?: string/);
  assert.match(controller, /@Query\("customerId"\) customerId\?: string/);
  assert.match(controller, /listSkillSuggestions\([\s\S]*@Query\("wechatAccountId"\) wechatAccountId\?: string[\s\S]*return this\.training\.listSkillSuggestions\(\{[\s\S]*wechatAccountId,[\s\S]*conversationId,[\s\S]*customerId,/);
  assert.match(controller, /import \{ ApplySkillSuggestionsPayload, TrainingService \} from "\.\/training\.service"/);
  assert.match(controller, /applySkillSuggestions\([\s\S]*payload: ApplySkillSuggestionsPayload/);
  assert.match(service, /export type ApplySkillSuggestionsPayload = \{[\s\S]*wechatAccountId\?: string;[\s\S]*conversationId\?: string;[\s\S]*customerId\?: string;/);
  assert.match(controller, /ExpectedIdentityPayload/);
  assert.match(controller, /skillHints\?: string\[\] \| string;[\s\S]*\} & ExpectedIdentityPayload/);
  assert.match(controller, /expectedBySampleId\?: Record<string, ExpectedIdentityPayload>/);
  assert.match(service, /ExpectedIdentityPayload, assertExpectedIdentity/);
  assert.match(service, /wechatAccountId\?: string/);
  assert.match(service, /conversationId\?: string/);
  assert.match(service, /customerId\?: string/);
  assert.match(service, /this\.localStore\.listTrainingSamples\(\{[\s\S]*agentId: filters\.agentId,[\s\S]*wechatAccountId: filters\.wechatAccountId,[\s\S]*conversationId: filters\.conversationId,[\s\S]*customerId: filters\.customerId,[\s\S]*\}\)/);
  assert.match(service, /listSkillSuggestions\(options: \{ agentId\?: string; minScore\?: number \} & IdentityFilter = \{\}\)/);
  assert.match(service, /this\.localStore\.listTrainingSamples\(\{[\s\S]*agentId: options\.agentId,[\s\S]*wechatAccountId: options\.wechatAccountId,[\s\S]*conversationId: options\.conversationId,[\s\S]*customerId: options\.customerId,[\s\S]*\}\)/);
  assert.match(service, /this\.localStore\.listTrainingSamples\(options\)/);
  assert.match(store, /listTrainingSamples\(filter: string \| \(\{ agentId\?: string \} & IdentityListFilter\) = \{\}\)/);
  assert.match(store, /\.filter\(\(sample\) => this\.matchesIdentityFilter\(sample, options\)\)/);
  assert.match(service, /type TrainingSampleReviewPayload = ExpectedIdentityPayload & \{/);
  assert.match(service, /expectedBySampleId\?: Record<string, ExpectedIdentityPayload>/);
  assert.match(service, /assertExpectedIdentity\(sample, payload, "training sample"\)/);
  assert.match(service, /assertExpectedIdentity\(sample, payload\.expectedBySampleId\?\.\[sampleId\] \|\| \{\}, "training sample"\)/);
});

test("single notification read carries and enforces expected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const controller = readProjectFile("apps/api/src/notifications/notifications.controller.ts");
  const service = readProjectFile("apps/api/src/notifications/notifications.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");
  const expectation = readProjectFile("apps/api/src/shared/identity-expectation.ts");

  assert.match(api, /markNotificationRead\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(page, /markNotificationRead\(notice\.id, identityExpectation\(notice\)\)/);
  assert.match(page, /const updated = await markNotificationRead\(notice\.id, identityExpectation\(notice\)\)/);
  assert.match(page, /upsertNotificationState\(updated\)/);
  assert.match(page, /setNotifications\(\(items\) => items\.map\(\(notice\) => \(notice\.readAt \? notice : \{ \.\.\.notice, readAt \}\)\)\)/);
  assert.match(api, /target\?: \{ wechatAccountId\?: string \| null; conversationId\?: string \| null; customerId\?: string \| null \} \| null/);
  assert.match(api, /record\.target\?\.conversationId/);
  assert.match(controller, /markRead\(@Param\("id"\) id: string, @Body\(\) body: ExpectedIdentityPayload = \{\}\)/);
  assert.match(service, /markRead\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(service, /assertExpectedIdentity\(notice, expected, "notification"\)/);
  assert.match(store, /markNotificationRead\(id: string, filter: IdentityListFilter = \{\}\)/);
  assert.match(store, /notification identity mismatch/);
  assert.match(store, /target\?\.conversationId/);
  assert.match(expectation, /record\?\.target\?\.conversationId/);
});

test("window observer public endpoints expose summaries without local paths", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const apiClient = readProjectFile("apps/web/src/lib/api.ts");
  const statusSection = service.slice(
    service.indexOf("  getWindowObserverStatus()"),
    service.indexOf("  captureWindowObserverOnce()"),
  );
  const captureSection = service.slice(
    service.indexOf("  captureWindowObserverOnce()"),
    service.indexOf("  createWindowSnapshot("),
  );
  const scanSection = service.slice(
    service.indexOf("  scanWindowSnapshotInbox()"),
    service.indexOf("  createDemoWindowSnapshot("),
  );
  const sanitizerSection = service.slice(
    service.indexOf("function sanitizeWindowObserverStatus"),
    service.indexOf("function sanitizeBridgeWorkerStatus"),
  );

  assert.match(statusSection, /sanitizeWindowObserverStatus/);
  assert.match(captureSection, /summary:\s*sanitizeWindowObserverStdout\(result\.stdout\)/);
  assert.doesNotMatch(captureSection, /stdout:\s*String\(result\.stdout/);
  assert.doesNotMatch(scanSection, /inboxDir,\s*scanned/);
  assert.doesNotMatch(scanSection, /archivedPath/);
  assert.doesNotMatch(scanSection, /processed\.push\(\{\s*\.\.\.entry/);
  assert.doesNotMatch(scanSection, /failed\.push\(\{\s*\.\.\.entry/);
  assert.match(scanSection, /snapshots:\s*created\.map\(sanitizeWindowSnapshotScanItem\)/);
  assert.doesNotMatch(sanitizerSection, /statusFile/);
  assert.doesNotMatch(sanitizerSection, /snapshotFile/);
  assert.doesNotMatch(sanitizerSection, /inboxDir/);
  assert.doesNotMatch(apiClient, /WindowObserverStatus[\s\S]*statusFile\?: string/);
  assert.doesNotMatch(apiClient, /WindowObserverStatus[\s\S]*snapshotFile\?: string/);
  assert.doesNotMatch(apiClient, /WindowSnapshotInboxScanResult = \{[\s\S]*inboxDir: string/);
  assert.doesNotMatch(apiClient, /stdout\?: string/);
});

test("send diagnostics view exposes live worker readiness without changing send execution", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const styles = readProjectFile("apps/web/src/app/globals.css");
  const sendSection = sliceBetween(page, /id="send-center"/, /<section className="routing-grid">/);

  assert.match(sendSection, /sendWorkbenchView === "diagnostics"/);
  assert.match(sendSection, /className="send-runtime-diagnostics"/);
  assert.match(sendSection, /bridgeStatus\?\.worker\?\.ok/);
  assert.match(sendSection, /windowObserverStatus\?\.ok/);
  assert.match(sendSection, /bridgeStatus\?\.locks\?\.activeCount/);
  assert.match(sendSection, /bridgeStatus\?\.dispatch\?\.staleCount/);
  assert.match(sendSection, /operatorStatusName\(windowObserverStatus\?\.status\)/);
  assert.match(styles, /\.send-runtime-diagnostics/);
  assert.match(styles, /\.send-runtime-diagnostics > div\.ok/);
  assert.match(styles, /\.send-runtime-diagnostics > div\.warn/);
  assert.match(styles, /@media \(max-width: 920px\)[\s\S]*\.send-runtime-diagnostics/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.send-runtime-diagnostics/);
  assert.match(styles, /Iteration 78 Last mobile send-workbench guard/);
  assert.match(styles, /#send-center \.segmented-control[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /#send-center \.segmented-control button:nth-child\(3\)[\s\S]*grid-column: 1 \/ -1/);
  assert.match(styles, /Iteration 81 Mobile topbar final pass/);
  assert.match(styles, /\.topbar \.top-actions \.conversation-toolbar[\s\S]*display: none !important/);
  assert.match(styles, /Iteration 82 Mobile topbar status final containment/);
  assert.match(styles, /\.toolbar-group\.status-group \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(styles, /\.toolbar-group\.status-group \.platform-pill \{[\s\S]*white-space: normal !important/);
  assert.match(styles, /Iteration 83 Mobile app chrome/);
  assert.match(styles, /Iteration 83 Mobile app chrome[\s\S]*\.toolbar-group\.status-group \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(styles, /Iteration 83 Mobile app chrome[\s\S]*\.toolbar-group\.status-group \.platform-pill \{[\s\S]*overflow-wrap: anywhere !important/);
});

test("web client no longer exposes or renders direct mark-sent actions", () => {
  const apiClient = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");

  assert.doesNotMatch(apiClient, /markSendTaskSent/);
  assert.doesNotMatch(apiClient, /mark-sent/);
  assert.doesNotMatch(page, /markSendTaskSent/);
  assert.doesNotMatch(page, /markSentByCurrentWindow/);
  assert.doesNotMatch(page, /通过后发送/);
  assert.doesNotMatch(page, /快照通过后发送/);
});

test("web client cannot manually forge bridge acknowledgements", () => {
  const apiClient = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");

  assert.doesNotMatch(apiClient, /acknowledgeBridgeSend/);
  assert.doesNotMatch(apiClient, /\/bridge-ack/);
  assert.doesNotMatch(page, /acknowledgeBridgeSend/);
  assert.doesNotMatch(page, /bridgeAck(?!Rejected)/);
  assert.doesNotMatch(page, /ackToken/);
  assert.doesNotMatch(page, /\/bridge-ack/);
  assert.doesNotMatch(page, /桥接成功回执/);
  assert.doesNotMatch(page, /桥接失败回执/);
});

test("web client confirms before releasing manual conversation lock", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const toggleSection = page.slice(
    page.indexOf("async function toggleConversationManualLock"),
    page.indexOf("async function validateWrong"),
  );

  assert.match(toggleSection, /if \(!locked\)/);
  assert.match(toggleSection, /manualLockBlockedSendTaskCount\(conversation\.id\)/);
  assert.match(toggleSection, /普通解除只恢复后续自动化判断/);
  assert.match(toggleSection, /发送中心逐条/);
  assert.match(toggleSection, /window\.confirm/);
  assert.match(toggleSection, /promptManualResolutionNote\(conversation\.title\)/);
  assert.match(toggleSection, /resolutionNote/);
  assert.match(toggleSection, /恢复自动化判断/);
  assert.match(toggleSection, /已取消解除人工接管/);
  assert.match(toggleSection, /manual_resolution_from_workbench/);
  assert.match(toggleSection, /note: locked[\s\S]*resolutionNote/);
  assert.match(page, /function promptManualResolutionNote/);
  assert.match(page, /function manualLockBlockedSendTaskCount/);
  assert.match(page, /task\.guardSnapshot\?\.blockedByManualLock/);
  assert.match(page, /window\.prompt/);
});

test("web client confirms before releasing manual lock and requeueing send task", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const apiClient = readProjectFile("apps/web/src/lib/api.ts");
  const releaseAndRequeueSection = page.slice(
    page.indexOf("async function releaseManualLockAndRequeueTask"),
    page.indexOf("function isSendTaskConversationLocked"),
  );
  const requeueSection = page.slice(
    page.indexOf("async function requeueTask"),
    page.indexOf("async function releaseManualLockAndRequeueTask"),
  );
  const sendTaskSection = page.slice(
    page.indexOf("<div className=\"send-task-list\">"),
    page.indexOf("<section className=\"panel review-panel\""),
  );

  assert.match(apiClient, /export async function requeueSendTask\(id: string, payload: \{ reason\?: string \} & IdentityExpectation = \{\}\)/);
  assert.match(apiClient, /\.\.\.payload/);
  assert.match(apiClient, /requeueReason\?: string/);
  assert.match(apiClient, /requeuedAt\?: string/);
  assert.match(apiClient, /cancelReason\?: string/);
  assert.match(apiClient, /cancelledAt\?: string/);
  assert.match(apiClient, /history\?: Array/);
  assert.match(apiClient, /export async function cancelSendTask\(id: string, payload: \{ reason\?: string \} & IdentityExpectation = \{\}\)/);
  assert.match(page, /function sendTaskConfirmLines\(task: SendTask, actionLabel: string, scopeLabel: string\)/);
  assert.match(page, /sendTaskConfirmLines[\s\S]*const customerName =[\s\S]*task\.conversation\?\.customer\?\.name[\s\S]*task\.conversation\?\.customerId[\s\S]*windowDiagnostic\?\.activeCustomerId/);
  assert.match(page, /sendTaskConfirmLines[\s\S]*const orderDraftId = sendTaskOrderDraftId\(task\)/);
  assert.match(page, /sendTaskConfirmLines[\s\S]*\$\{customerName\}[\s\S]*\$\{orderDraftId\}/);
  assert.match(page, /function confirmSendTaskRequeue\(task: SendTask, scopeLabel: string\)/);
  assert.match(page, /function confirmSendTaskCancel\(task: SendTask, scopeLabel: string\)/);
  assert.match(page, /sendTaskConfirmLines\([\s\S]*任务状态：\$\{sendStatusLabel\(task\.status\)\}/);
  assert.match(page, /重新排队后仍会重新校验微信账号、聊天对象和最近消息/);
  assert.match(page, /取消后这条消息不会继续自动发送/);
  assert.match(requeueSection, /manual_operator_requeue_from_send_center/);
  assert.match(requeueSection, /if \(!confirmSendTaskRequeue\(task, "发送任务"\)\)/);
  assert.match(requeueSection, /已取消重新排队发送任务/);
  assert.match(page, /manual_takeover_cancel_send_task/);
  assert.match(page, /manual_operator_cancel_from_send_center/);
  assert.match(page, /if \(!confirmSendTaskCancel\(task, "发送任务"\)\)[\s\S]*已取消发送任务取消操作/);
  assert.match(releaseAndRequeueSection, /isSendTaskConversationLocked\(task\)/);
  assert.match(releaseAndRequeueSection, /window\.confirm/);
  assert.match(releaseAndRequeueSection, /promptManualResolutionNote\(conversation\.title/);
  assert.match(releaseAndRequeueSection, /resolutionNote/);
  assert.match(releaseAndRequeueSection, /解除人工接管后重新排队这条发送任务/);
  assert.match(releaseAndRequeueSection, /manual_resolution_before_send_requeue/);
  assert.match(releaseAndRequeueSection, /note: resolutionNote/);
  assert.match(page, /function SendRequeueAudit/);
  assert.match(page, /sendRequeueReasonLabel/);
  assert.match(page, /function SendCancelAudit/);
  assert.match(page, /sendCancelReasonLabel/);
  assert.match(page, /manual_operator_requeue_from_send_center: "人工从发送中心重新排队"/);
  assert.match(page, /manual_resolution_before_send_requeue: "人工处理完成后解除接管并重排"/);
  assert.match(page, /<SendRequeueAudit task=\{task\} \/>/);
  assert.match(page, /<SendCancelAudit task=\{task\} \/>/);
  assert.match(sendTaskSection, /taskCancelledWithAudit[\s\S]*guardSnapshot\?\.cancelledAt[\s\S]*guardSnapshot\?\.cancelReason/);
  assert.match(page, /function isAuditedCancelledSendTask\(task\?: SendTask \| null\)/);
  assert.match(page, /canRequeueOrderConfirmationTask[\s\S]*isAuditedCancelledSendTask\(task\)[\s\S]*return false/);
  assert.match(page, /canRequeueOrderFollowupTask[\s\S]*isAuditedCancelledSendTask\(task\)[\s\S]*return false/);
  assert.match(sendTaskSection, /taskCanBeRequeued[\s\S]*"blocked", "failed", "dry_run"[\s\S]*task\.status === "cancelled" && !taskCancelledWithAudit/);
  assert.match(sendTaskSection, /className="manual-send-cancelled"/);
  assert.match(releaseAndRequeueSection, /await setConversationManualLock[\s\S]*locked: false[\s\S]*await requeueSendTask\(task\.id,[\s\S]*manual_resolution_before_send_requeue/);
  assert.match(sendTaskSection, /taskConversationLocked[\s\S]*releaseManualLockAndRequeueTask\(task\)[\s\S]*解除并重排/);
});

test("review center renders manual lock audit details", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const css = readProjectFile("apps/web/src/app/globals.css");
  const reviewSection = page.slice(
    page.indexOf("<div className=\"review-log-list\">"),
    page.indexOf("<section className=\"quote-grid\""),
  );
  const helperSection = page.slice(
    page.indexOf("function reviewLogSummary"),
    page.indexOf("function RouteResult"),
  );

  assert.match(reviewSection, /review-log-item/);
  assert.match(reviewSection, /review-log-head/);
  assert.match(reviewSection, /reviewLogTraceItems\(log\)/);
  assert.match(reviewSection, /className="review-log-trace"/);
  assert.match(page, /className="review-conversation-trace"/);
  assert.match(page, /activeConversationReviewLogs\.map/);
  assert.match(page, /focusConversation\(activeConversation\.id, "conversation-center"\)/);
  assert.match(page, /const activeConversationBlockedSendCount = activeConversationId \? manualLockBlockedSendTaskCount\(activeConversationId\) : 0/);
  assert.match(page, /const activeConversationPendingReviewDesignJobs = activeConversationDesignJobs\.filter/);
  assert.match(page, /const activeConversationPendingReviewQuotes = activeConversationId/);
  assert.match(page, /const activeConversationPendingReviewOrders = activeConversationId/);
  assert.match(page, /const activeConversationReviewActionItems = \[/);
  assert.match(page, /activeConversationDesignJobIds\.has\(quote\.designJobId\)/);
  assert.match(page, /const job = activeConversationPendingReviewDesignJobs\[0\]/);
  assert.match(page, /const quote = activeConversationPendingReviewQuotes\[0\]/);
  assert.match(page, /const order = activeConversationPendingReviewOrders\[0\]/);
  assert.match(page, /label: identityMissing \? "补身份" : "审设计"/);
  assert.match(page, /label: identityMissing \? "补身份" : "审报价"/);
  assert.match(page, /label: identityMissing \? "补身份" : "审订单"/);
  assert.match(page, /focusQuoteCenter\(quote\.id\)/);
  assert.match(page, /focusHighValueOrderReview\(order\)/);
  assert.match(page, /setMessage\("当前客户设计任务缺少微信账号、客户或会话绑定，请先补齐身份。"\)/);
  assert.match(page, /setMessage\("当前客户报价缺少微信账号、客户或会话绑定，请先补齐身份。"\)/);
  assert.match(page, /setMessage\("当前客户订单缺少微信账号、客户或会话绑定，已拦截后续批准动作，请先补齐身份。"\)/);
  assert.match(page, /activeConversation\.manualLocked \? <em>人工接管中，智能体自动回复和自动发送已暂停。<\/em> : null/);
  assert.match(page, /待发 \{activeConversationBlockedSendCount\}/);
  assert.match(page, /toggleConversationManualLock\(activeConversation, false\)/);
  assert.match(page, /解除接管不会自动发送旧任务/);
  assert.match(page, /className="review-conversation-next-actions"/);
  assert.match(page, /aria-label="当前客户待处理事项"/);
  assert.match(page, /review-conversation-action \$\{item\.tone\}/);
  assert.match(page, /title=\{item\.detail\}/);
  assert.match(page, /<span>\{item\.label\}<\/span>/);
  assert.match(page, /<strong>\{item\.count\}<\/strong>/);
  assert.match(page, /item\.identityMissing \? <em>身份缺失<\/em> : null/);
  assert.match(reviewSection, /reviewLogSubject\(log\)/);
  assert.match(reviewSection, /reviewLogSummary\(log\)/);
  assert.match(page, /const activeConversationReviewLogs = useMemo/);
  assert.match(page, /reviewCenter\.logs\.filter\(\(log\) => reviewLogMatchesConversation\(log, activeConversationId\)\)[\s\S]*\.slice\(0, 3\)/);
  assert.match(helperSection, /function reviewLogMatchesConversation\(log: ReviewLog, conversationId: string\)/);
  assert.match(helperSection, /metadata\.conversationId/);
  assert.match(helperSection, /log\.targetType === "conversation" && log\.targetId === conversationId/);
  assert.match(helperSection, /function reviewLogTraceItems\(log: ReviewLog\)/);
  assert.match(helperSection, /metadata\.wechatAccountName \|\| metadata\.wechatAccountId/);
  assert.match(helperSection, /metadata\.customerName \|\| metadata\.customerId/);
  assert.match(helperSection, /metadata\.conversationTitle \|\| metadata\.conversationId/);
  assert.match(helperSection, /function reviewTraceValue\(value: string\)/);
  assert.match(helperSection, /blockedSendTaskIds/);
  assert.match(helperSection, /cancelledInFlightSendTaskIds/);
  assert.match(helperSection, /reviewReasonLabel/);
  assert.match(page, /approve_confirmation: "批准订单确认"/);
  assert.match(page, /approve_followup: "批准订单跟进"/);
  assert.match(page, /reject_order: "驳回订单"/);
  assert.match(page, /metadata\.orderDraftId/);
  assert.match(page, /metadata\.quoteDraftId/);
  assert.match(page, /metadata\.designJobId/);
  assert.match(page, /metadata\.sendTaskId/);
  assert.match(helperSection, /order_draft: "订单"/);
  assert.match(helperSection, /manual_order_review: "高价值订单人工审核"/);
  assert.match(helperSection, /orderFollowupTypeLabel\(String\(metadata\.followupType\)\)/);
  assert.match(helperSection, /function orderFollowupTypeLabel\(type: string\)/);
  assert.match(css, /\.review-log-item/);
  assert.match(css, /\.review-log-head/);
  assert.match(css, /\.review-log-trace/);
  assert.match(css, /\.review-conversation-trace/);
  assert.match(css, /\.review-conversation-trace-list/);
  assert.match(css, /\.review-conversation-trace-warning/);
  assert.match(css, /\.review-conversation-next-actions/);
  assert.match(css, /\.review-conversation-action/);
  assert.match(css, /\.review-conversation-action em/);
});

test("review center exposes current manual locked conversations", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const css = readProjectFile("apps/web/src/app/globals.css");
  const reviewCenterIdIndex = page.indexOf("id=\"review-center\"");
  const reviewSection = page.slice(
    page.lastIndexOf("<section", reviewCenterIdIndex),
    page.indexOf("<section className=\"quote-grid\""),
  );

  assert.match(page, /const manualLockedConversations = conversations\.filter/);
  assert.match(page, /const manualLockLogByConversationId = useMemo/);
  assert.match(page, /log\.targetType !== "conversation" \|\| log\.decision !== "manual_lock"/);
  assert.match(page, /const manualLockBlockedSendCountByConversationId = useMemo/);
  assert.match(page, /task\.guardSnapshot\?\.blockedByManualLock/);
  assert.match(page, /const activeConversationSendTasks = activeConversationId/);
  assert.match(page, /activeConversationSendTasks[\s\S]*task\.conversationId === activeConversationId/);
  assert.match(page, /const activeConversationSendTaskCount = activeConversationSendTasks\.length/);
  assert.doesNotMatch(page, /activeConversationSendTaskScopeMatched/);
  assert.match(page, /\.\.\.activeConversationSendTasks/);
  assert.match(page, /const prioritizeSendTasks = \(tasks: SendTask\[\], limit = 4\) => \{[\s\S]*\[\.\.\.activeConversationSendTasks, \.\.\.tasks\]/);
  assert.match(page, /prioritizeSendTasks[\s\S]*!tasks\.some\(\(candidate\) => candidate\.id === task\.id\)/);
  assert.match(page, /const visibleActiveConversationSendTaskCount = activeConversationId[\s\S]*visibleSendTasks\.filter\(\(task\) => task\.conversationId === activeConversationId\)/);
  assert.match(page, /const taskBlockedByManualLock =[\s\S]*task\.guardSnapshot\?\.blockedByManualLock/);
  assert.match(page, /task\.guardSnapshot\?\.blockedBy === "manual_lock"/);
  assert.match(page, /className="manual-send-block"/);
  assert.match(page, /const prioritizedManualLockedConversations = useMemo/);
  assert.match(page, /Date\.parse\(manualLockLogByConversationId\.get\(left\.id\)\?\.createdAt/);
  assert.match(page, /const hiddenManualLockedConversationCount = Math\.max/);
  assert.match(page, /const orderDraftByQuoteId = new Map\(orderDrafts\.map\(\(order\) => \[order\.quoteDraftId, order\]\)\)/);
  assert.match(page, /const reviewOrderDrafts = dedupeOrdersById\(\[\.\.\.orderDrafts, \.\.\.\(reviewCenter\.orderDrafts \|\| \[\]\)\]\)/);
  assert.match(page, /const orderDraftId = String\(target\.orderDraftId \|\| ""\)/);
  assert.match(page, /const sendTaskId = String\(target\.sendTaskId \|\| ""\)/);
  assert.match(page, /\[\.\.\.orderDrafts, \.\.\.\(reviewCenter\.orderDrafts \|\| \[\]\)\]\.find\(\(item\) => item\.id === orderDraftId\)/);
  assert.match(page, /focusHighValueOrderReview\(order\)/);
  assert.match(page, /setSendWorkbenchView\("queue"\)[\s\S]*scrollToWorkspaceSection\("send-center"\)/);
  assert.match(page, /target\.orderDraftId \|\| target\.quoteDraftId \|\| target\.designJobId \|\| target\.sendTaskId \|\| target\.conversationId/);
  assert.match(page, /if \(target\.orderDraftId\) parts\.push\(`订单 \$\{target\.orderDraftId\}`\)/);
  assert.match(page, /if \(target\.sendTaskId\) parts\.push\(`发送任务 \$\{target\.sendTaskId\}`\)/);
  assert.match(page, /const highValueManualQueueItems[\s\S]*= \[/);
  assert.match(page, /job\.status === "manual_review"/);
  assert.match(page, /isHighValueDesignJob\(job\) && \["completed", "quick_confirm", "timeout", "failed"\]\.includes\(job\.status\)/);
  assert.match(page, /reason: highValueDesignReason\(job\)/);
  assert.match(page, /nextAction: identityMissing \? highValueQueueIdentityMissingNextAction\(\) : step\.nextAction/);
  assert.match(page, /!orderDraftByQuoteId\.has\(quote\.id\) && \(quote\.status === "manual_review" \|\| isHighValueQuote\(quote\)\)/);
  assert.match(page, /reason: highValueQuoteReason\(quote\)/);
  assert.match(page, /const highValueReviewOrderDrafts = sortHighValueReviewOrderDrafts\(/);
  assert.match(page, /reviewOrderDrafts\.filter\([\s\S]*isHighValueOrder\(order\) \|\| orderNeedsManualSendAttention\(order\)[\s\S]*!\["fulfilled", "cancelled"\]\.includes\(order\.status\)/);
  assert.match(page, /const highValueOrderReviewFilterOptions = \[/);
  assert.match(page, /\{ value: "send_attention", label: "发送异常" \}/);
  assert.match(page, /\{ value: "payment", label: "待收款" \}/);
  assert.match(page, /\{ value: "confirmation", label: "待发确认" \}/);
  assert.match(page, /\{ value: "delivery", label: "交付跟进" \}/);
  assert.match(page, /\{ value: "overdue", label: "已到跟进" \}/);
  assert.match(page, /const \[highValueOrderReviewFilter, setHighValueOrderReviewFilter\] = useState/);
  assert.match(page, /const highValueOrderReviewFilterCounts = highValueOrderReviewFilterOptions\.reduce/);
  assert.match(page, /const filteredHighValueReviewOrderDrafts = highValueReviewOrderDrafts\.filter/);
  assert.match(page, /function focusHighValueOrderReview\(order: OrderDraft\)/);
  assert.match(page, /setReviewWorkbenchView\("order"\)[\s\S]*setHighValueOrderReviewFilter\(highValueOrderReviewFilterForOrder\(order\)\)[\s\S]*focusOrderDraft\(order\)/);
  assert.match(page, /function orderSendAttentionTasks\(order: OrderDraft\)/);
  assert.match(page, /const automation = \(task\.guardSnapshot as \{ automation\?: Record<string, unknown> \} \| undefined\)\?\.automation \|\| \{\}/);
  assert.match(page, /function sendTaskNeedsManualAttention\(task: SendTask\)/);
  assert.match(page, /\["blocked", "failed", "cancelled", "dry_run"\]\.includes\(String\(task\.status \|\| ""\)\)/);
  assert.match(page, /<SendOrderContext task=\{task\} \/>/);
  assert.match(page, /function SendOrderContext\(\{ task \}: \{ task: SendTask \}\)/);
  assert.match(page, /function sendOrderContext\(task: SendTask\)/);
  assert.match(page, /function sendTaskOrderDraftId\(task: SendTask\)/);
  assert.match(page, /automation\.orderDraftId \|\| task\.payload\?\.orderDraftId/);
  assert.match(page, /function sendTaskManualAttentionSummary\(task: SendTask\)/);
  assert.match(page, /task\.errorMessage \|\| guardReason \|\| attemptReason \|\| failedKeys/);
  assert.match(page, /<SendManualAttentionActionHint[\s\S]*task=\{task\}[\s\S]*canRequeue=\{taskCanBeRequeued\}[\s\S]*conversationLocked=\{taskConversationLocked\}/);
  assert.match(page, /function SendManualAttentionActionHint\(/);
  assert.match(page, /aria-label="人工处理下一步"/);
  assert.match(page, /function sendManualAttentionActionHint\(task: SendTask, canRequeue: boolean, conversationLocked: boolean\)/);
  assert.match(page, /status === "cancelled"[\s\S]*任务已取消，不会自动重排/);
  assert.match(page, /conversationLocked && canRequeue[\s\S]*先解除人工锁[\s\S]*解除并重排/);
  assert.match(page, /status === "dry_run"[\s\S]*演练不会真实发送给客户/);
  assert.match(page, /canRequeue[\s\S]*可重新排队[\s\S]*确认无误后，可点“重新排队”/);
  assert.match(page, /const manualAttentionTask = orderSendAttentionTasks\(order\)\.find\(\(task\) => sendTaskNeedsManualAttention\(task\)\) \|\| null/);
  assert.match(page, /\{manualAttentionSummary \? <small>\{manualAttentionSummary\}<\/small> : null\}/);
  assert.match(page, /function focusSendTaskOrder\(task: SendTask\)/);
  assert.match(page, /const orderDraftId = sendTaskOrderDraftId\(task\)/);
  assert.match(page, /dedupeOrdersById\(\[\.\.\.orderDrafts, \.\.\.\(reviewCenter\.orderDrafts \|\| \[\]\)\]\)\.find\(\(item\) => item\.id === orderDraftId\)/);
  assert.match(page, /<Search size=\{16\} aria-hidden="true" \/>定位订单/);
  assert.match(page, /source === "order_followup" \|\| followupType[\s\S]*订单跟进发送/);
  assert.match(page, /low_value_quote_acceptance: "低价值报价成交"/);
  assert.match(page, /async function focusOrderManualSendAttention\(order: OrderDraft\)/);
  assert.match(page, /setHighValueOrderReviewFilter\("send_attention"\)/);
  assert.match(page, /setSendWorkbenchView\(task && sendTaskNeedsManualAttention\(task\) \? "blocked" : "queue"\)/);
  assert.match(page, /await focusConversation\(conversationId, "send-center"\)/);
  assert.match(page, /issue\.reason === "manual_send_attention_required"[\s\S]*focusOrderManualSendAttention\(order\)/);
  assert.match(page, /openSendTasks\.filter\(\(task\) => !sendTaskNeedsManualAttention\(task\) && !isSendTaskConversationLocked\(task\)\)/);
  assert.match(page, /sendTasks\.filter\([\s\S]*sendTaskNeedsManualAttention\(task\)[\s\S]*isSendTaskConversationLocked\(task\)/);
  assert.match(page, /const manualAttentionSendTaskCount = sendTasks\.filter\(\(task\) => task\.status !== "sent" && sendTaskNeedsManualAttention\(task\)\)\.length/);
  assert.match(page, /const highValueOrderReviewFilterLabel = highValueOrderReviewFilterOptionLabel\(highValueOrderReviewFilter\)/);
  assert.match(page, /`\$\{filteredHighValueReviewOrderDrafts\.length\}\/\$\{highValueReviewOrderDrafts\.length\} 个待人工订单 · \$\{highValueOrderReviewFilterLabel\}`/);
  assert.match(page, /\.\.\.highValueReviewOrderDrafts/);
  assert.match(page, /reason: highValueOrderReason\(order\)/);
  assert.match(page, /const action = highValueOrderManualPrimaryAction\(order\)/);
  assert.match(page, /const reviewFilter = highValueOrderReviewFilterForOrder\(order\)/);
  assert.match(page, /const nextFollowLabel = highValueOrderNextFollowLabel\(order\)/);
  assert.match(page, /primaryLabel: identityMissing \? [\s\S]* : action\.label/);
  assert.match(page, /reviewFilterLabel: highValueOrderReviewFilterOptionLabel\(reviewFilter\)/);
  assert.match(page, /nextFollowLabel,/);
  assert.match(page, /order,/);
  assert.match(page, /action\.type === "queue_confirmation"[\s\S]*reviewOrderDraft\(order, "approve_confirmation"\)/);
  assert.match(page, /action\.type === "queue_delivery"[\s\S]*reviewOrderDraft\(order, "approve_followup", "delivery"\)/);
  assert.match(page, /focus: \(\) => \{[\s\S]*focusHighValueOrderReview\(order\);[\s\S]*\}/);
  assert.match(page, /run: \(\) => \{[\s\S]*setReviewWorkbenchView\("order"\);[\s\S]*setHighValueOrderReviewFilter\(highValueOrderReviewFilterForOrder\(order\)\)/);
  assert.match(page, /highValueManualQueueItems\[0\]\?\.run\(\)/);
  assert.match(page, /item\.reviewFilterLabel \? <small>订单阶段：\{item\.reviewFilterLabel\}<\/small> : null/);
  assert.match(page, /item\.nextFollowLabel \? <small>\{item\.nextFollowLabel\}<\/small> : null/);
  assert.match(page, /item\.order \? <OrderSendPreflightPanel order=\{item\.order\} \/> : null/);
  assert.match(page, /setReviewWorkbenchView\("order"\)/);
  assert.match(page, /label="待审订单"/);
  assert.match(page, /highValueReviewOrderDrafts\.length/);
  assert.match(page, /const visibleHighValueReviewOrderDrafts =[\s\S]*reviewWorkbenchView === "order" \? filteredHighValueReviewOrderDrafts : filteredHighValueReviewOrderDrafts\.slice\(0, 2\)/);
  assert.match(page, /className="segmented-control filter-segment high-value-order-filter"/);
  assert.match(page, /aria-label="人工订单处理筛选"/);
  assert.match(page, /setHighValueOrderReviewFilter\(option\.value\)/);
  assert.match(page, /\{option\.label\}<span>\{highValueOrderReviewFilterCounts\[option\.value\] \|\| 0\}<\/span>/);
  assert.match(page, /visibleHighValueReviewOrderDrafts\.map/);
  assert.match(page, /reviewWorkbenchView !== "order" && filteredHighValueReviewOrderDrafts\.length > visibleHighValueReviewOrderDrafts\.length/);
  assert.match(page, /当前筛选下没有待人工订单/);
  assert.match(page, /setHighValueOrderReviewFilter\("all"\)/);
  assert.match(page, /const followupStatus = orderFollowupStatusText\(order\)/);
  assert.match(page, /paymentStatusLabel\(orderPaymentStatusValue\(order\)\)/);
  assert.match(page, /orderStatusLabel\(order\.status\)/);
  assert.match(page, /reviewOrderDraft\(order, "approve_confirmation"\)/);
  assert.match(page, /reviewOrderDraft\(order, "approve_followup", "delivery"\)/);
  assert.match(page, /reviewOrderDraft\(order, "request_followup"\)/);
  assert.match(page, /reviewOrderDraft\(order, "reject_order"\)/);
  assert.match(page, /async function recordHighValueOrderManualFollowup\(order: OrderDraft\)/);
  assert.match(page, /recordHighValueOrderManualFollowup[\s\S]*const identityLines = orderIdentityConfirmLines\(order\)/);
  assert.match(page, /recordHighValueOrderManualFollowup[\s\S]*order\.id[\s\S]*\.\.\.identityLines/);
  assert.match(page, /buildHighValueOrderManualNote\(\{/);
  assert.match(page, /appendOrderCustomerNotes\(order\.customerNotes, manualNote\)/);
  assert.match(page, /updateOrderDraft\(order\.id, \{[\s\S]*owner: reviewer,[\s\S]*customerNotes:/);
  assert.match(page, /reviewOrder\(order\.id, \{[\s\S]*decision: "request_followup"[\s\S]*note: manualNote/);
  assert.match(api, /export type ReviewOrderResult = \{/);
  assert.match(api, /export async function reviewOrder[\s\S]*Promise<ReviewOrderResult>/);
  assert.match(page, /function upsertReviewLogState\(log: ReviewLog \| null \| undefined\)/);
  assert.match(page, /setReviewCenter\(\(current\) => \(\{[\s\S]*logs: \[log, \.\.\.current\.logs\.filter/);
  assert.match(page, /\.slice\(0, 80\)/);
  assert.match(page, /function upsertReviewOrderDraftState\(order: OrderDraft \| null \| undefined\)/);
  assert.match(page, /\["fulfilled", "cancelled"\]\.includes\(order\.status\)[\s\S]*current\.orderDrafts\.filter\(\(item\) => item\.id !== order\.id\)/);
  assert.match(page, /\[order, \.\.\.current\.orderDrafts\.filter\(\(item\) => item\.id !== order\.id\)\]\.slice\(0, 80\)/);
  assert.match(page, /function applyReviewOrderResultState\(result: ReviewOrderResult \| null \| undefined\)/);
  assert.match(page, /upsertReviewLogState\(result\?\.log\)/);
  assert.match(page, /applyReviewOrderResultState\(reviewed\)/);
  assert.match(page, /const order = reviewResult\.orderDraft \|\| reviewResult\.order/);
  assert.match(page, /upsertOrderDraftState\(order\)/);
  assert.match(page, /upsertReviewOrderDraftState\(order\)/);
  assert.match(page, /upsertSendTaskState\(reviewResult\.sendTask\)/);
  assert.match(page, /latestHighValueOrderManualNote\(order\.customerNotes\)/);
  assert.match(page, /recordHighValueOrderManualFollowup\(order\)/);
  assert.match(page, /function sortHighValueReviewOrderDrafts\(orders: OrderDraft\[\]\)/);
  assert.match(page, /highValueOrderManualStep\(left\)/);
  assert.match(page, /highValueOrderNextFollowTime\(left\)/);
  assert.match(page, /rightAmount - leftAmount/);
  assert.match(page, /orderUpdatedTime\(left\) - orderUpdatedTime\(right\)/);
  assert.match(page, /function highValueOrderFollowRank/);
  assert.match(page, /function highValueOrderNextFollowTime\(order: OrderDraft\)/);
  assert.match(page, /line\.match\(\/下次跟进：\(\[\^；\\n\]\+\)\/\)/);
  assert.match(page, /function highValueOrderMatchesReviewFilter\(order: OrderDraft, filter:/);
  assert.match(page, /filter === "send_attention"[\s\S]*orderNeedsManualSendAttention\(order\)/);
  assert.match(page, /filter === "payment"[\s\S]*!orderPaymentReady\(order\)/);
  assert.match(page, /filter === "confirmation"[\s\S]*orderPaymentReady\(order\) && !highValueOrderApprovalBlockReason\(order, \{ includePayment: false \}\) && !hasActiveOrderConfirmationTask\(order\)/);
  assert.match(page, /filter === "delivery"[\s\S]*order\.status === "processing" && !highValueOrderApprovalBlockReason\(order, \{ includePayment: false \}\)/);
  assert.match(page, /filter === "overdue"[\s\S]*nextFollowAt > 0 && nextFollowAt <= Date\.now\(\)/);
  assert.match(page, /function highValueOrderReviewFilterForOrder\(order: OrderDraft\)/);
  assert.match(page, /highValueOrderMatchesReviewFilter\(order, "send_attention"\)[\s\S]*return "send_attention"/);
  assert.match(page, /highValueOrderMatchesReviewFilter\(order, "payment"\)[\s\S]*return "payment"/);
  assert.match(page, /highValueOrderMatchesReviewFilter\(order, "confirmation"\)[\s\S]*return "confirmation"/);
  assert.match(page, /highValueOrderMatchesReviewFilter\(order, "delivery"\)[\s\S]*return "delivery"/);
  assert.match(page, /highValueOrderMatchesReviewFilter\(order, "overdue"\)[\s\S]*return "overdue"/);
  assert.match(page, /function highValueOrderReviewFilterOptionLabel\(filter:/);
  assert.match(page, /highValueOrderReviewFilterOptions\.find\(\(option\) => option\.value === filter\)\?\.label \|\| "全部"/);
  assert.match(page, /function highValueOrderNextFollowLabel\(order: OrderDraft\)/);
  assert.match(page, /const nextFollowAt = highValueOrderNextFollowTime\(order\)/);
  assert.match(page, /nextFollowAt <= Date\.now\(\) \? `已到跟进：\$\{label\}` : `下次跟进：\$\{label\}`/);
  assert.match(page, /function buildHighValueOrderManualNote/);
  assert.match(page, /function appendOrderCustomerNotes/);
  assert.match(page, /function latestHighValueOrderManualNote/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.review-card\.order\.amber/);
  assert.match(css, /\.review-card\.order\.red/);
  assert.match(css, /\.review-card\.order\.green/);
  assert.match(css, /review-mode-order :is\(\.manual-lock-review-list, \.review-log-list\)/);
  assert.match(css, /review-mode-order \.review-columns/);
  assert.match(css, /review-mode-order \.review-columns > \.review-list:nth-child\(1\)/);
  assert.match(css, /review-mode-order \.review-columns > \.review-list:nth-child\(2\)/);
  assert.match(css, /review-mode-design, \.review-mode-quote, \.review-mode-order/);
  assert.match(page, /reason: blockedSendCount \? "发送任务被人工接管拦截" : "会话已人工接管"/);
  assert.match(page, /\.sort\(\(left, right\) => left\.priority - right\.priority\)\.slice\(0, 8\)/);
  assert.match(page, /highValueDesignManualStep\(job\)/);
  assert.match(page, /highValueQuoteManualStep\(quote, orderDraft\)/);
  assert.match(page, /highValueOrderManualStep\(order\)/);
  assert.match(page, /accountLabel: string/);
  assert.match(page, /customerLabel: string/);
  assert.match(page, /detail: identityMissing \? highValueQueueIdentityMissingDetail\(\) : step\.detail/);
  assert.match(page, /nextAction: identityMissing \? highValueQueueIdentityMissingNextAction\(\) : step\.nextAction/);
  assert.match(page, /primaryLabel: identityMissing \? "[^"]+" : "[^"]+"/);
  assert.match(page, /primaryLabel: identityMissing \? "[^"]+" : action\.label/);
  assert.match(page, /if \(identityMissing\) \{[\s\S]*focusHighValueOrderReview\(order\)[\s\S]*setMessage\("[^"]+"/);
  assert.match(page, /if \(identityMissing\) \{[\s\S]*return;[\s\S]*setReviewWorkbenchView\("order"\)/);
  assert.match(page, /conversationLabel: string/);
  assert.match(page, /identityMissing: boolean/);
  assert.match(page, /isActiveConversation: boolean/);
  assert.match(page, /const identityMissing = highValueQueueIdentityMissing\(accountIdentity, customerIdentity, conversationIdentity\)/);
  assert.match(page, /label: identityMissing \? "身份缺失" : step\.label/);
  assert.match(page, /tone: identityMissing \? "red" : step\.tone/);
  assert.match(page, /priority: identityMissing \? 6 : step\.priority/);
  assert.match(page, /const accountIdentity = job\.wechatAccountId \|\| job\.conversation\?\.wechatAccountId/);
  assert.match(page, /const customerIdentity = job\.customer\?\.name \|\| job\.customerId \|\| job\.conversation\?\.customerId/);
  assert.match(page, /const conversationIdentity = job\.conversationId \|\| job\.conversation\?\.id \|\| job\.conversation\?\.title/);
  assert.match(page, /const accountIdentity = quote\.designJob\?\.wechatAccountId \|\| quote\.designJob\?\.conversation\?\.wechatAccountId/);
  assert.match(page, /const customerIdentity = quote\.customer\?\.name \|\| quote\.customerId \|\| quote\.designJob\?\.customerId/);
  assert.match(page, /quote\.designJob\?\.conversationId \|\| quote\.designJob\?\.conversation\?\.id \|\| quote\.designJob\?\.conversation\?\.title/);
  assert.match(page, /const identityMissing = orderStrictIdentityMissing\(order\)/);
  assert.match(page, /const accountIdentity = order\.wechatAccountId/);
  assert.match(page, /const customerIdentity = order\.customerId/);
  assert.match(page, /const conversationIdentity = order\.conversationId/);
  assert.match(page, /conversationLabel: highValueQueueConversationLabel\(order\.conversationId \? order\.designJob\?\.conversation\?\.title \|\| order\.conversationId : ""\)/);
  assert.doesNotMatch(page, /const accountIdentity = order\.wechatAccountId \|\| order\.designJob\?\.wechatAccountId/);
  assert.doesNotMatch(page, /const customerIdentity = order\.customer\?\.name \|\| order\.customerId \|\| order\.quoteDraft/);
  assert.match(page, /accountLabel: highValueQueueAccountLabel\(accountIdentity\)/);
  assert.match(page, /customerLabel: highValueQueueCustomerLabel\(customerIdentity\)/);
  assert.match(page, /className=\{`deal-attention-item \$\{item\.tone\} \$\{item\.isActiveConversation \? "active-conversation" : ""\}`\}/);
  assert.match(reviewSection, /className="deal-attention-identity"/);
  assert.match(reviewSection, /aria-label="高价值事项身份校验"/);
  assert.match(reviewSection, /item\.accountLabel/);
  assert.match(reviewSection, /item\.customerLabel/);
  assert.match(reviewSection, /item\.conversationLabel/);
  assert.match(reviewSection, /item\.identityMissing \? <mark className="danger">身份缺失<\/mark> : null/);
  assert.match(reviewSection, /item\.isActiveConversation \? <mark className="active">当前会话<\/mark> : null/);
  assert.match(reviewSection, /label="人工接管"/);
  assert.match(reviewSection, /aria-label="人工跟进队列"/);
  assert.match(reviewSection, /高价值 \/ 发送异常人工跟进/);
  assert.match(reviewSection, /处理第一项/);
  assert.match(reviewSection, /审设计/);
  assert.match(reviewSection, /审报价/);
  assert.match(reviewSection, /item\.primaryLabel/);
  assert.match(reviewSection, /manual-lock-review-list/);
  assert.match(reviewSection, /prioritizedManualLockedConversations\.slice\(0, 5\)/);
  assert.match(reviewSection, /manualLockLogByConversationId\.get\(conversation\.id\)/);
  assert.match(reviewSection, /manualLockBlockedSendCountByConversationId\.get\(conversation\.id\)/);
  assert.match(reviewSection, /reviewLogSummary\(manualLockLog\)/);
  assert.match(reviewSection, /blockedSendCount/);
  assert.match(reviewSection, /item\.reason/);
  assert.match(reviewSection, /item\.nextAction/);
  assert.match(reviewSection, /onClick=\{item\.run\}/);
  assert.match(reviewSection, /formatDateTime\(manualLockLog\.createdAt\)/);
  assert.match(reviewSection, /hiddenManualLockedConversationCount/);
  assert.match(reviewSection, /focusConversation\(conversation\.id, "conversation-center"\)/);
  assert.match(reviewSection, /focusConversation\(conversation\.id, "send-center"\)/);
  assert.match(reviewSection, /toggleConversationManualLock\(conversation, false\)/);
  assert.match(page, /activeConversationId && visibleActiveConversationSendTaskCount/);
  assert.match(page, /className="send-focus-hint"/);
  assert.match(page, /function designImageSendBlockReason\(job: DesignJob, options: \{ allowHighValueManualApproval\?: boolean \} = \{\}\)/);
  assert.match(page, /isHighValueDesignJob\(job\) && !options\.allowHighValueManualApproval/);
  assert.match(page, /designImageSendBlockReason\(job, \{ allowHighValueManualApproval: true \}\)/);
  assert.match(page, /function confirmHighValueManualApproval/);
  assert.match(page, /确认人工批准/);
  assert.match(page, /不会把 A 客户内容发给 B 客户/);
  assert.match(page, /批准发送前检查未通过/);
  assert.match(page, /人工批准报价前检查未通过/);
  assert.match(page, /已取消高价值设计人工批准/);
  assert.match(page, /已取消高价值报价人工批准/);
  assert.match(page, /function highValueDesignManualStep\(job: DesignJob\)/);
  assert.match(page, /function highValueDesignReason\(job: DesignJob\)/);
  assert.match(page, /function highValueBudgetReason\(budget\?: DesignJob\["budget"\]\)/);
  assert.match(page, /function highValueAmountReason\(totalAmount: number, perUnitAmount: number, quantity\?: number\)/);
  assert.match(page, /const HIGH_VALUE_AMOUNT_CNY = 10000/);
  assert.match(page, /function isHighValueAmount\(totalAmount\?: number \| string \| null, perUnitAmount\?: number \| string \| null\)/);
  assert.match(page, /total >= HIGH_VALUE_AMOUNT_CNY \|\| perUnit >= HIGH_VALUE_AMOUNT_CNY/);
  assert.match(page, /function isHighValueBudget\(budget\?: DesignJob\["budget"\]\)/);
  assert.match(page, /function isHighValueDesignJob\(job: DesignJob\)/);
  assert.match(page, /isHighValueBudget\(quote\.designJob\?\.budget\)/);
  assert.match(page, /isHighValueBudget\(order\.designJob\?\.budget \|\| order\.quoteDraft\?\.designJob\?\.budget\)/);
  assert.match(page, /isHighValueAmount\(order\.totalPrice, order\.unitPrice\)/);
  assert.match(page, /isHighValueAmount\(order\.quoteDraft\?\.totalPrice, order\.quoteDraft\?\.unitPrice\)/);
  assert.match(page, /达到高价值线，需要人工批准/);
  assert.match(page, /达到高价值线，需要人工确认订单/);
  assert.match(page, /priority: 10/);
  assert.match(page, /nextAction: "打开设计任务/);
  assert.match(page, /高价值客户不要自动发送/);
  assert.match(page, /function highValueQuoteManualStep\(quote: QuoteDraft, order: OrderDraft \| null\)/);
  assert.match(page, /function highValueQuoteReason\(quote: QuoteDraft\)/);
  assert.match(page, /function highValueQueueAccountLabel\(value\?: string \| null\)/);
  assert.match(page, /function highValueQueueCustomerLabel\(value\?: string \| null\)/);
  assert.match(page, /function highValueQueueConversationLabel\(value\?: string \| null\)/);
  assert.match(page, /function highValueQueueIdentityMissing\(account\?: string \| null, customer\?: string \| null, conversation\?: string \| null\)/);
  assert.match(page, /function highValueQueueIdentityMissingDetail\(\)/);
  assert.match(page, /function highValueQueueIdentityMissingNextAction\(\)/);
  assert.match(page, /!String\(account \|\| ""\)\.trim\(\) \|\| !String\(customer \|\| ""\)\.trim\(\) \|\| !String\(conversation \|\| ""\)\.trim\(\)/);
  assert.match(page, /reviewTraceValue\(String\(value \|\| "未绑定"\)\)/);
  assert.match(page, /priority: 14/);
  assert.match(page, /nextAction: "先调整成本、售价或组合/);
  assert.match(page, /高价值报价先确认数量、单价、利润、话术和发送对象/);
  assert.match(page, /function highValueOrderManualStep\(order: OrderDraft\)/);
  assert.match(page, /function orderPaymentStatusValue\(order: OrderDraft\)/);
  assert.match(page, /return order\.paymentStatus \|\| order\.quoteDraft\?\.paymentStatus \|\| "unpaid"/);
  assert.match(page, /function orderPaymentReady\(order: OrderDraft\)[\s\S]*orderPaymentStatusValue\(order\)/);
  assert.match(page, /confirmOrderConfirmationSendQueue\(order: OrderDraft[\s\S]*paymentStatusLabel\(orderPaymentStatusValue\(previewOrder\)\)/);
  assert.match(page, /function dealProgressSteps\(quote: QuoteDraft, order: OrderDraft \| null\)[\s\S]*const paymentStatus = order \? orderPaymentStatusValue\(order\) : quote\.paymentStatus/);
  assert.match(page, /if \(!\["deposit_paid", "paid"\]\.includes\(orderPaymentStatusValue\(order\)\)\)/);
  assert.match(page, /orderPaymentFilter !== "all" && orderPaymentStatusValue\(order\) !== orderPaymentFilter/);
  assert.match(page, /orderPaymentStatusValue\(order\) === "unpaid"/);
  assert.match(page, /function orderSelectedImageIdValue\(order: OrderDraft\)/);
  assert.match(page, /return order\.selectedImageId \|\| order\.quoteDraft\?\.selectedImageId \|\| ""/);
  assert.match(page, /function orderSelectedImage\(order: OrderDraft\)[\s\S]*const selectedImageId = String\(orderSelectedImageIdValue\(order\)\)/);
  assert.match(page, /function orderNeedsManualSendAttention\(order: OrderDraft\)/);
  assert.match(page, /orderNeedsManualSendAttention\(order\)[\s\S]*label: "发送异常"/);
  assert.match(page, /const approvalBlocker = highValueOrderApprovalBlockReason\(order, \{ includePayment: false \}\)/);
  assert.match(page, /approvalBlocker[\s\S]*label: "先补资料"[\s\S]*detail: approvalBlocker/);
  assert.match(page, /function highValueOrderApprovalBlockReason\(order: OrderDraft, options: \{ includePayment\?: boolean \} = \{\}\)/);
  assert.match(page, /highValueOrderApprovalBlockReason\(order: OrderDraft[\s\S]*!orderSelectedImageIdValue\(order\)/);
  assert.match(page, /highValueOrderApprovalBlockReason\(order: OrderDraft[\s\S]*orderStrictIdentityMissing\(order\)[\s\S]*高价值\$\{orderStrictIdentityBlockReason\("批准订单确认或跟进发送"\)\}/);
  assert.match(page, /高价值订单未绑定客户选中的效果图，不能批准订单确认或跟进发送/);
  assert.match(page, /function orderStrictIdentityBlockReason\(actionLabel: string\)[\s\S]*订单\$\{orderStrictIdentityWarning\(\)\}，不能\$\{actionLabel\}。/);
  assert.match(page, /options\.includePayment !== false && !orderPaymentReady\(order\)/);
  assert.match(page, /高价值订单未核验定金或全款，不能批准订单确认或跟进发送/);
  assert.match(page, /高价值订单利润为负，必须人工确认报价和成本后再批准发送/);
  assert.match(page, /function highValueOrderManualPrimaryAction\(order: OrderDraft\)[\s\S]*orderNeedsManualSendAttention\(order\)[\s\S]*label: "查发送"/);
  assert.match(page, /function highValueOrderManualPrimaryAction\(order: OrderDraft\)/);
  assert.match(page, /highValueOrderApprovalBlockReason\(order, \{ includePayment: false \}\)[\s\S]*label: "补资料"/);
  assert.match(reviewSection, /visibleHighValueReviewOrderDrafts\.map\(\(order\) =>/);
  assert.match(reviewSection, /<OrderSendPreflightPanel order=\{order\} \/>[\s\S]*reviewOrderDraft\(order, "approve_confirmation"\)/);
  assert.match(page, /async function reviewOrderDraft\(/);
  assert.match(page, /decision === "approve_confirmation" \|\| decision === "approve_followup"[\s\S]*const blocker = highValueOrderApprovalBlockReason\(order\)[\s\S]*setMessage\(blocker\)[\s\S]*return/);
  assert.match(page, /reviewOrder\(order\.id, \{[\s\S]*decision,[\s\S]*followupType,[\s\S]*reviewer: "人工客服"/);
  assert.match(page, /!orderPaymentReady\(order\)[\s\S]*label: "去收款"/);
  assert.match(page, /function highValueOrderManualStep\(order: OrderDraft\)[\s\S]*if \(!orderPaymentReady\(order\)\) \{[\s\S]*label: "先跟收款"/);
  assert.match(page, /!hasActiveOrderConfirmationTask\(order\)[\s\S]*label: "核验并发确认"/);
  assert.match(page, /order\.status === "processing"[\s\S]*label: "发交期说明"/);
  assert.match(page, /function highValueOrderReason\(order: OrderDraft\)/);
  assert.match(page, /priority: 18/);
  assert.match(page, /nextAction: "联系客户确认付款安排/);
  assert.match(page, /高价值订单未记录定金或全款/);
  assert.match(css, /\.manual-lock-review-item/);
  assert.match(css, /\.high-value-handoff-list/);
  assert.match(css, /\.deal-attention-item\.active-conversation/);
  assert.match(css, /\.deal-attention-item \.order-send-preflight/);
  assert.match(css, /\.deal-attention-item \.order-send-preflight-checks/);
  assert.match(css, /\.deal-attention-identity/);
  assert.match(css, /\.deal-attention-identity mark/);
  assert.match(css, /\.deal-attention-identity mark\.active/);
  assert.match(css, /\.deal-attention-identity mark\.danger/);
  assert.match(css, /\.manual-lock-review-actions/);
  assert.match(css, /\.manual-lock-review-main small/);
  assert.match(css, /\.manual-lock-review-main em/);
  assert.match(css, /\.manual-lock-review-main mark/);
  assert.match(css, /\.manual-lock-review-more/);
  assert.match(css, /\.send-focus-hint/);
  assert.match(css, /\.manual-send-block/);
  assert.match(css, /\.manual-send-cancelled/);
  assert.match(css, /\.send-order-context/);
  assert.match(css, /\.send-requeue-audit/);
  assert.match(css, /\.send-cancel-audit/);
});

test("web deal flow bulk action only progresses low-value quotes", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const section = page.slice(
    page.indexOf("async function progressQuoteDealFlow"),
    page.indexOf("async function evaluateCustomerRoute"),
  );
  const sourceSection = page.slice(
    page.indexOf("const dealFlowSendableQuotes = quotes.filter"),
    page.indexOf("const quoteDealBoardItems"),
  );

  assert.match(section, /const sendableQuotes = dealFlowSendableQuotes/);
  assert.match(section, /const acceptedWithoutOrder = dealFlowAcceptedQuotesWithoutOrder/);
  assert.match(section, /await queueQuoteAfterPreviewCheck\(quote\)/);
  assert.doesNotMatch(section, /await queueQuoteSend\(quote\.id\)/);
  assert.match(sourceSection, /const dealFlowSendableQuotes = quotes\.filter/);
  assert.match(sourceSection, /!isHighValueQuote\(quote\)[\s\S]*\["draft", "auto_sent"\]/);
  assert.match(sourceSection, /const dealFlowAcceptedQuotesWithoutOrder = acceptedQuotesWithoutOrder\.filter/);
  assert.match(sourceSection, /!isHighValueQuote\(quote\) && !quoteOrderDraftBlockReason\(quote\)/);
  assert.match(section, /const confirmationCandidates = \[\.\.\.dealFlowConfirmationCandidates\]/);
  assert.match(page, /const dealFlowConfirmationCandidates = orderDrafts\.filter/);
  assert.match(page, /guardedOrderDealNextStep\(order\)\.action === "queue_order_confirmation"/);
  assert.doesNotMatch(section, /quote\.status === "manual_review"[\s\S]*queueQuoteSend/);
});

test("web deal flow queues same-cycle order confirmations after order creation", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const section = page.slice(
    page.indexOf("async function progressQuoteDealFlow"),
    page.indexOf("async function evaluateCustomerRoute"),
  );

  const createIndex = section.indexOf("const orderDraft = await createOrderDraftFromQuote(quote.id, identityExpectation(quote))");
  const pushIndex = section.indexOf("confirmationCandidates.push(orderDraft)");
  const queueIndex = section.indexOf("await queueOrderConfirmationAfterPreviewCheck(order)");

  assert.ok(createIndex > 0);
  assert.ok(pushIndex > createIndex);
  assert.ok(queueIndex > pushIndex);
  assert.match(section, /for \(const order of dedupeOrdersById\(confirmationCandidates\)\)/);
});

test("inbound quote acceptance carries conversation identity into order mutations", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const acceptanceSection = sliceBetween(
    service,
    /\n  private async handleInboundQuoteAcceptance\(/,
    /\n  private findLatestQuoteForConversation\(/,
  );

  assert.match(acceptanceSection, /this\.orders\.update\(orderDraftId, \{[\s\S]*expectedWechatAccountId: params\.conversation\.wechatAccountId/);
  assert.match(acceptanceSection, /this\.orders\.update\(orderDraftId, \{[\s\S]*expectedConversationId: params\.conversation\.id/);
  assert.match(acceptanceSection, /this\.orders\.update\(orderDraftId, \{[\s\S]*expectedCustomerId: params\.conversation\.customerId/);
  assert.match(acceptanceSection, /this\.orders\.createFromQuote\(updatedQuote\.id, \{[\s\S]*expectedWechatAccountId: params\.conversation\.wechatAccountId/);
  assert.match(acceptanceSection, /this\.orders\.createFromQuote\(updatedQuote\.id, \{[\s\S]*expectedConversationId: params\.conversation\.id/);
  assert.match(acceptanceSection, /this\.orders\.createFromQuote\(updatedQuote\.id, \{[\s\S]*expectedCustomerId: params\.conversation\.customerId/);
});

test("web quote center renders guarded next-step guidance", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const quotesController = readProjectFile("apps/api/src/quotes/quotes.controller.ts");
  const quotesService = readProjectFile("apps/api/src/quotes/quotes.service.ts");
  const ordersController = readProjectFile("apps/api/src/orders/orders.controller.ts");
  const ordersService = readProjectFile("apps/api/src/orders/orders.service.ts");
  const css = readProjectFile("apps/web/src/app/globals.css");
  const quoteHelper = page.slice(
    page.indexOf("function quoteDealNextStep"),
    page.indexOf("function orderDealNextStep"),
  );
  const orderHelper = page.slice(
    page.indexOf("function orderDealNextStep"),
    page.indexOf("function fieldLabel"),
  );
  const quoteListSection = page.slice(
    page.indexOf("filteredQuotes.map"),
    page.indexOf("<div className=\"order-panel\">"),
  );
  const queueQuoteSection = page.slice(
    page.indexOf("async function queueQuoteDraft"),
    page.indexOf("async function toggleQuoteCenterPreview"),
  );
  const orderListStart = page.indexOf("filteredOrderDrafts.map");
  const orderListSection = page.slice(
    orderListStart,
    page.indexOf("<div className=\"empty empty-cta small\"", orderListStart),
  );
  const orderSelectedImageSection = page.slice(
    page.indexOf("function snapshotDesignImage"),
    page.indexOf("function matchesQuoteSearch"),
  );
  const getQuoteForSendSection = sliceBetween(
    quotesService,
    /\n  private async getQuoteForSend\(/,
    /\n  private async findExistingForDesignJob\(/,
  );
  const findExistingQuoteSection = sliceBetween(
    quotesService,
    /\n  private async findExistingForDesignJob\(/,
    /\n  private ensureQuoteIdentity\(/,
  );
  const syncExistingQuoteSelectionSection = sliceBetween(
    quotesService,
    /\n  private async syncExistingQuoteSelection\(/,
    /\n  private resolveQuoteDesignImage\(/,
  );
  const quoteReviseSelectionSection = sliceBetween(
    quotesService,
    /\n  async reviseSelectedImage\(/,
    /\n  async preview\(/,
  );
  const quoteMarkSelectionSection = sliceBetween(
    quotesService,
    /\n  private async markDesignImageSelected\(/,
    /\n  private async cancelLinkedQuoteSendTaskForRevision\(/,
  );
  const orderReviseSelectionSection = sliceBetween(
    ordersService,
    /\n  async reviseSelectedImage\(/,
    /\n  async scanLowValueAutoOrderDrafts\(/,
  );
  const orderAutoDraftScanSection = sliceBetween(
    ordersService,
    /\n  async scanLowValueAutoOrderDrafts\(/,
    /\n  private async getQuote\(/,
  );
  const orderPrismaSelectionSection = sliceBetween(
    ordersService,
    /\n  private async updatePrismaOrderAndQuoteSelection\(/,
    /\n  private async attachOrderSendTasks\(/,
  );
  const orderIncludeSection = sliceBetween(
    ordersService,
    /\n  private orderInclude\(/,
    /\n  private async getOrderDraft\(/,
  );

  assert.match(quoteHelper, /isHighValueQuote\(quote\)/);
  assert.match(orderHelper, /isHighValueOrder\(order\)/);
  assert.match(quoteHelper, /sendRisk/);
  assert.match(orderHelper, /hasActiveOrderConfirmationTask\(order\)/);
  assert.match(queueQuoteSection, /getQuotePreview\(quote\.id, identityExpectation\(quote\)\)/);
  assert.match(queueQuoteSection, /async function checkQuoteReadyForSend\(quote: QuoteDraft\)/);
  assert.match(queueQuoteSection, /async function queueQuoteAfterPreviewCheck\(quote: QuoteDraft\)/);
  assert.match(queueQuoteSection, /async function checkQuoteReadyForManualApproval/);
  assert.match(queueQuoteSection, /quoteSendBlockReason\(preview\.quote, preview\.warnings, \{ allowManualReview: true \}\)/);
  assert.match(page, /if \(quoteNeedsPaymentProofReview\(quote\)\) warnings\.push\("付款凭证需要先人工核验金额和收款账户"\)/);
  assert.match(queueQuoteSection, /async function checkOrderReadyForConfirmation\(\s*order: OrderDraft/);
  assert.match(queueQuoteSection, /async function queueOrderConfirmationAfterPreviewCheck\(order: OrderDraft\)/);
  assert.match(queueQuoteSection, /报价话术预览生成失败/);
  assert.match(queueQuoteSection, /const previewRisk = quoteSendBlockReason\(preview\.quote, preview\.warnings\)/);
  assert.match(queueQuoteSection, /getOrderConfirmationPreview\(order\.id, identityExpectation\(order\)\)/);
  assert.match(queueQuoteSection, /const previewRisk = orderConfirmationBlockReason\(preview\.orderDraft, preview\.warnings\)/);
  assert.match(queueQuoteSection, /订单确认话术预览生成失败/);
  assert.match(queueQuoteSection, /if \(previewRisk\)/);
  assert.match(queueQuoteSection, /setMessage\(`发送前检查未通过：\$\{result\.reason\}`\)/);
  assert.match(queueQuoteSection, /setMessage\(`订单确认发送前检查未通过：\$\{result\.reason\}`\)/);
  assert.match(queueQuoteSection, /queueQuoteSend\(quote\.id, identityExpectation\(quote\)\)/);
  assert.match(page, /function confirmOrderConfirmationSendQueue\(order: OrderDraft, preview: OrderConfirmationPreview\)/);
  assert.match(page, /confirmOrderConfirmationSendQueue\([\s\S]*系统会继续通过账号、聊天对象、最近消息三重校验后再发送/);
  assert.match(page, /if \(!confirmOrderConfirmationSendQueue\(order, result\.preview\)\)/);
  assert.match(page, /setMessage\("已取消订单确认发送入队。"\)/);
  assert.match(page, /canRequeueOrderConfirmationTask\(order\)[\s\S]*if \(!confirmSendTaskRequeue\(task, "订单确认任务"\)\)/);
  assert.match(page, /已取消重新排队订单确认/);
  assert.match(page, /if \(!confirmSendTaskCancel\(task, "订单确认任务"\)\)[\s\S]*已取消订单确认发送取消操作/);
  assert.match(page, /const manualRelease = confirmHighValueOrderManualRelease\(order, "confirmation"\)/);
  assert.match(queueQuoteSection, /const manualRelease = confirmHighValueOrderManualRelease\(order, "confirmation"\)/);
  assert.match(page, /queueOrderConfirmation\(order\.id, identityExpectation\(order\), manualRelease\)/);
  assert.match(queueQuoteSection, /queueOrderConfirmation\(order\.id, identityExpectation\(order\), manualRelease\)/);
  assert.match(page, /function confirmHighValueOrderManualRelease\([\s\S]*isHighValueOrder\(order\)[\s\S]*window\.confirm/);
  assert.match(page, /manual_approve_order_confirmation/);
  assert.match(page, /manual_approve_order_followup/);
  assert.match(page, /function confirmOrderFollowupSendQueue\(order: OrderDraft, type: "production" \| "delivery"\)/);
  assert.match(page, /confirmOrderFollowupSendQueue\([\s\S]*系统会继续通过账号、聊天对象、最近消息三重校验后再发送/);
  assert.match(page, /if \(!confirmOrderFollowupSendQueue\(order, type\)\)/);
  assert.match(page, /setMessage\(`已取消\$\{orderFollowupStageLabel\(type\)\}发送入队。`\)/);
  assert.match(page, /canRequeueOrderFollowupTask\(order, type\) && task[\s\S]*if \(!confirmSendTaskRequeue\(task, `\$\{orderFollowupStageLabel\(type\)\}任务`\)\)/);
  assert.match(page, /已取消重新排队\$\{orderFollowupStageLabel\(type\)\}/);
  assert.match(page, /if \(!confirmSendTaskCancel\(task, `\$\{orderFollowupStageLabel\(type\)\}任务`\)\)[\s\S]*已取消\$\{orderFollowupStageLabel\(type\)\}发送取消操作/);
  assert.match(page, /queueOrderFollowup\(order\.id, type, identityExpectation\(order\), manualRelease\)/);
  assert.match(api, /function expectedIdentityQuery\(expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /export async function getQuotePreview\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /\/quotes\/\$\{id\}\/preview\$\{expectedIdentityQuery\(expected\)\}/);
  assert.match(api, /export async function getOrderConfirmationPreview\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /confirmation-preview\$\{expectedIdentityQuery\(expected\)\}/);
  assert.match(quotesController, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(quotesController, /this\.quotes\.preview\(id, \{[\s\S]*expectedWechatAccountId: wechatAccountId,[\s\S]*expectedConversationId: conversationId,[\s\S]*expectedCustomerId: customerId/);
  assert.match(quotesService, /async preview\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(quotesService, /assertExpectedIdentity\(quote, expected, "quote draft"\)/);
  assert.match(quotesService, /if \(!quote\.customerId && !quote\.designJob\?\.customerId\) warnings\.push\("报价缺少客户绑定"\)/);
  assert.match(getQuoteForSendSection, /images:\s*true/);
  assert.match(findExistingQuoteSection, /images:\s*true/);
  assert.match(syncExistingQuoteSelectionSection, /Array\.isArray\(existing\.designJob\.images\)/);
  assert.match(syncExistingQuoteSelectionSection, /await this\.getDesignJobForQuote\(existing\.designJobId\)/);
  assert.match(syncExistingQuoteSelectionSection, /markDesignImageSelected\(existing\.designJobId, selectedImage/);
  assert.match(quoteReviseSelectionSection, /markDesignImageSelected\(current\.designJobId, selectedImage/);
  assert.match(quoteMarkSelectionSection, /localStore\.selectDesignImage\(designJobId, selectedImage\.id, feedback\)/);
  assert.match(quoteMarkSelectionSection, /designImageCandidate\.updateMany\([\s\S]*data: \{ selected: false \}/);
  assert.match(quoteMarkSelectionSection, /designImageCandidate\.update\([\s\S]*selected: true, customerFeedback: feedback/);
  assert.match(orderReviseSelectionSection, /updateLocalOrderAndQuoteSelection\(current, orderPatch, quotePatch, selectedImage, note\)/);
  assert.match(orderReviseSelectionSection, /updatePrismaOrderAndQuoteSelection\(id, current\.quoteDraftId, current\.designJobId, orderPatch, quotePatch, selectedImage, note\)/);
  assert.match(orderAutoDraftScanSection, /createFromQuote\(quote\.id, this\.expectedIdentityFromQuote\(quote\)\)/);
  assert.match(ordersService, /this\.assertCreatedOrderDraftBinding\(orderDraft, quote\)/);
  assert.match(ordersService, /private assertCreatedOrderDraftBinding\(orderDraft: any, quote: any\)/);
  assert.match(ordersService, /validateOrderDraftQuoteBinding\(\{[\s\S]*orderDraft,[\s\S]*quoteDraft: quote,[\s\S]*designJob: orderDraft\?\.designJob \|\| quote\?\.designJob,[\s\S]*conversation: orderDraft\?\.conversation \|\| quote\?\.designJob\?\.conversation/);
  assert.match(ordersService, /throw new BadRequestException\(`订单草稿生成后绑定校验失败：\$\{orderBindingReasonLabel\(binding\.reason\)\}`\)/);
  assert.match(ordersService, /wechatAccountId: orderDraft\.wechatAccountId/);
  assert.match(ordersService, /conversationId: orderDraft\.conversationId/);
  assert.match(ordersService, /customerId: orderDraft\.customerId/);
  assert.doesNotMatch(ordersService, /customerId: orderDraft\.customerId \|\| quote\.customerId \|\| quote\.designJob\?\.customerId/);
  assert.match(ordersService, /private expectedIdentityFromQuote\(quote: any\): ExpectedIdentityPayload/);
  assert.match(ordersService, /expectedWechatAccountId: quote\?\.designJob\?\.wechatAccountId \|\| quote\?\.wechatAccountId/);
  assert.match(ordersService, /expectedConversationId: quote\?\.designJob\?\.conversationId \|\| quote\?\.conversationId/);
  assert.match(ordersService, /expectedCustomerId: quote\?\.customerId \|\| quote\?\.designJob\?\.customerId/);
  assert.match(orderPrismaSelectionSection, /designImageCandidate\.updateMany\([\s\S]*where: \{ designJobId \}[\s\S]*selected: false/);
  assert.match(orderPrismaSelectionSection, /designImageCandidate\.update\([\s\S]*selected: true, customerFeedback: feedback/);
  assert.ok((ordersService.match(/include: this\.orderInclude\(\)/g) || []).length >= 5);
  assert.match(orderIncludeSection, /designJob:\s*\{[\s\S]*include:\s*\{[\s\S]*conversation:\s*true,[\s\S]*wechatAccount:\s*true,[\s\S]*images:\s*true/);
  assert.match(orderIncludeSection, /quoteDraft:\s*\{[\s\S]*include:\s*\{[\s\S]*selectedImage:\s*true,[\s\S]*customer:\s*true,[\s\S]*designJob:\s*\{[\s\S]*images:\s*true/);
  assert.match(ordersController, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(ordersController, /this\.orders\.confirmationPreview\(id, \{[\s\S]*expectedWechatAccountId: wechatAccountId,[\s\S]*expectedConversationId: conversationId,[\s\S]*expectedCustomerId: customerId/);
  assert.match(ordersService, /async confirmationPreview\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(ordersService, /assertExpectedIdentity\(order, expected, "order draft"\)/);
  assert.match(ordersService, /if \(!order\.customerId\) warnings\.push\("订单缺少客户绑定"\)/);
  assert.match(quoteListSection, /const rowPreviewWarnings = rowPreview\?\.warnings \|\| \[\]/);
  assert.match(quoteListSection, /const rowSendRisk = quoteSendBlockReason\(quote, rowPreviewWarnings\)/);
  assert.match(quoteListSection, /guardedQuoteDealNextStep\(quote, orderDraft, rowSendRisk\)/);
  assert.match(quoteListSection, /const rowProgressSteps = dealProgressSteps\(quote, orderDraft\)/);
  assert.match(quoteListSection, /selectedImage \? `选中第 \$\{selectedImage\.position \|\| "-"\} 张` : "未选图"/);
  assert.match(quoteListSection, /className="commercial-review-strip"/);
  assert.match(quoteListSection, /aria-label="报价商业核对"/);
  assert.match(quoteListSection, /commercialReviewItems\(quote\)\.map/);
  assert.match(quoteListSection, /const rowRiskItems = dealRiskItemsForQuote\(quote, rowSendRisk\)/);
  assert.match(quoteListSection, /className="deal-risk-strip"/);
  assert.match(quoteListSection, /aria-label="报价风险提示"/);
  assert.match(quoteListSection, /rowRiskItems\.map\(\(item\) =>/);
  assert.match(quoteListSection, /const rowCustomerNote = customerNoteSummary\(quote\.customerNotes\)/);
  assert.match(quoteListSection, /className="quote-note-strip"/);
  assert.match(quoteListSection, /aria-label="报价备注"/);
  assert.match(quoteListSection, /aria-label="报价成交进度"/);
  assert.match(quoteListSection, /rowProgressSteps\.map\(\(step\) =>/);
  assert.match(quoteListSection, /发送检查 \{rowSendRisk\}/);
  assert.match(quoteListSection, /Boolean\(rowSendRisk\)/);
  assert.match(quoteListSection, /title=\{rowSendRisk \|\| "发送报价"\}/);
  assert.match(quoteListSection, /className="quote-preview quote-row-preview"/);
  assert.match(quoteListSection, /toggleQuoteCenterPreview\(quote\)/);
  assert.match(quoteListSection, /copyQuoteCenterPreviewMessage\(rowPreview\)/);
  assert.match(orderListSection, /guardedOrderDealNextStep\(order\)/);
  assert.match(orderListSection, /confirmAndUpdateOrderDraftStatus\(order, "fulfilled"\)/);
  assert.match(orderListSection, /confirmAndUpdateOrderDraftStatus\(order, "cancelled"\)/);
  assert.match(orderListSection, /const linkedQuote = order\.quoteDraft \|\| quotes\.find\(\(quote\) => quote\.id === order\.quoteDraftId\) \|\| null/);
  assert.match(orderListSection, /const rowProgressSteps = linkedQuote \? dealProgressSteps\(linkedQuote, order\) : \[\]/);
  assert.match(orderListSection, /selectedImage \? `选中第 \$\{selectedImage\.position \|\| "-"\} 张` : "未选图"/);
  assert.match(orderListSection, /className="commercial-review-strip"/);
  assert.match(orderListSection, /aria-label="订单商业核对"/);
  assert.match(orderListSection, /commercialReviewItems\(order\)\.map/);
  assert.match(orderListSection, /const rowRiskItems = dealRiskItemsForOrder\(order\)/);
  assert.match(orderListSection, /className="deal-risk-strip"/);
  assert.match(orderListSection, /aria-label="订单风险提示"/);
  assert.match(orderListSection, /rowRiskItems\.map\(\(item\) =>/);
  assert.match(orderListSection, /const rowCustomerNote = customerNoteSummary\(order\.customerNotes \|\| order\.quoteDraft\?\.customerNotes\)/);
  assert.match(orderListSection, /className="quote-note-strip"/);
  assert.match(orderListSection, /aria-label="订单备注"/);
  assert.match(orderListSection, /aria-label="订单成交进度"/);
  assert.match(orderListSection, /rowProgressSteps\.map\(\(step\) =>/);
  assert.match(orderListSection, /<OrderSendPreflightPanel order=\{order\} \/>/);
  assert.match(orderSelectedImageSection, /function snapshotDesignImage/);
  assert.match(orderSelectedImageSection, /snapshotDesignImage\(order\.selectedImageSnapshot\)/);
  assert.match(orderSelectedImageSection, /order\.quoteDraft\?\.designJob\?\.images\?\.find/);
  assert.match(page, /function dealProgressSteps\(quote: QuoteDraft, order: OrderDraft \| null\)/);
  assert.match(page, /function commercialReviewItems\(record: Pick<QuoteDraft \| OrderDraft/);
  assert.match(page, /const calculatedProfitRate = totalPrice > 0 \? profit \/ totalPrice : 0/);
  assert.match(page, /const profitTone = profit < 0 \? "danger" : profitRate < 0\.15 \? "warning" : "good"/);
  assert.match(page, /label: "利润率"/);
  assert.match(page, /function dealRiskItemsForQuote\(quote: QuoteDraft, sendRisk = ""\)/);
  assert.match(page, /function dealRiskItemsForOrder\(order: OrderDraft\)/);
  assert.match(page, /function orderSendPreflightItems\(order: OrderDraft\)/);
  assert.match(page, /key: "wechat-account"[\s\S]*label: "微信账号"[\s\S]*order\.wechatAccountId \? "passed" : "error"/);
  assert.match(page, /key: "customer"[\s\S]*label: "客户"[\s\S]*order\.customerId \? "passed" : "error"/);
  assert.match(page, /key: "conversation"[\s\S]*label: "会话"[\s\S]*order\.conversationId \? "passed" : "error"/);
  assert.match(page, /key: "selected-image"[\s\S]*label: "选图"[\s\S]*selectedImage \? "passed" : "error"/);
  assert.match(page, /key: "payment"[\s\S]*label: "付款"[\s\S]*paymentReady \? "passed" : "error"/);
  assert.match(page, /key: "amount"[\s\S]*label: "金额"[\s\S]*profit < 0 \? "error" : "passed"/);
  assert.match(page, /key: "high-value"[\s\S]*label: "高价值"[\s\S]*highValue \? "warning" : "passed"/);
  assert.match(page, /key: "send-task"[\s\S]*label: "发送队列"[\s\S]*activeConfirmation \? "warning" : "passed"/);
  assert.match(page, /function OrderSendPreflightPanel\(\{ order \}: \{ order: OrderDraft \}\)/);
  assert.match(page, /aria-label="订单确认发送前核对"/);
  assert.match(page, /const blockReason = orderConfirmationBlockReason\(order\)/);
  assert.match(page, /账号、客户、会话、选图、付款和金额已具备入队条件/);
  assert.match(page, /function dedupeDealRiskItems\(items: Array<\{ label: string; tone: string \}>\)/);
  assert.match(page, /highValueQuoteReason\(quote\)/);
  assert.match(page, /highValueOrderReason\(order\)/);
  assert.match(page, /缺少微信账号、客户或会话绑定/);
  assert.match(page, /orderStrictIdentityMissing\(order\)[\s\S]*orderStrictIdentityWarning\(\)/);
  assert.match(page, /利润为负，需要人工确认/);
  assert.match(page, /function orderCommercialBlockReason\(order: OrderDraft\)/);
  assert.match(page, /orderCommercialBlockReason\(order\)/);
  assert.match(page, /orderCommercialBlockReason\(order: OrderDraft\)[\s\S]*!orderSelectedImageIdValue\(order\)/);
  assert.match(page, /orderCommercialBlockReason\(order: OrderDraft\)[\s\S]*orderStrictIdentityMissing\(order\)[\s\S]*orderStrictIdentityBlockReason\("继续自动推进"\)/);
  assert.match(page, /订单未绑定客户选中的效果图，不能继续自动推进/);
  assert.match(page, /function orderStrictIdentityWarning\(\)[\s\S]*缺少微信账号、客户或会话绑定/);
  assert.match(page, /订单利润为负，需要人工确认报价和成本后再推进/);
  assert.match(page, /function customerNoteSummary\(notes\?: string \| null\)/);
  assert.match(page, /\.split\(\/\\r\?\\n\/\)/);
  assert.match(page, /text\.length > 90 \? `\$\{text\.slice\(0, 90\)\}\.\.\.` : text/);
  assert.match(page, /quoteSent[\s\S]*paid[\s\S]*orderCreated[\s\S]*processing[\s\S]*fulfilled/);
  assert.match(page, /key: "payment"[\s\S]*current: orderCreated && !paid/);
  assert.match(page, /key: "order"[\s\S]*current: quote\.status === "accepted" && !orderCreated/);
  assert.match(css, /\.deal-progress\.compact/);
  assert.match(css, /\.commercial-review-strip/);
  assert.match(css, /\.commercial-review-strip \.good/);
  assert.match(css, /\.commercial-review-strip \.warning/);
  assert.match(css, /\.commercial-review-strip \.danger/);
  assert.match(css, /\.deal-risk-strip/);
  assert.match(css, /\.deal-risk-strip \.danger/);
  assert.match(css, /\.order-send-preflight/);
  assert.match(css, /\.order-send-preflight-checks/);
  assert.match(css, /\.order-send-preflight-badge\.error/);
  assert.match(css, /\.quote-note-strip/);
  assert.match(page, /className=\{`deal-next-step inline \$\{nextStep\.tone\}`\}/);
  assert.match(quoteListSection, /runQuoteDealNextStep\(quote, orderDraft, rowSendRisk\)/);
  assert.match(orderListSection, /runOrderDealNextStep\(order\)/);
  assert.match(page, /nextStep\.action === "none"/);
  assert.match(css, /\.deal-next-step/);
  assert.match(css, /\.deal-next-step\.inline/);
  assert.match(css, /\.quote-row-preview/);
});

test("web quote center can filter records by next-step actionability", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const css = readProjectFile("apps/web/src/app/globals.css");
  const quoteFilterSection = page.slice(
    page.indexOf("const filteredQuotes = quotes.filter"),
    page.indexOf("const acceptedQuotesWithoutOrder"),
  );
  const helperSection = page.slice(
    page.indexOf("function matchesDealNextStepFilter"),
    page.indexOf("function fieldLabel"),
  );
  const controlsSection = page.slice(
    page.indexOf("aria-label=\"搜索客户、场景、报价、订单\""),
    page.indexOf("<div className=\"quote-section-head\">"),
  );
  const focusSection = page.slice(
    page.indexOf("function focusQuoteCenter"),
    page.indexOf("function handleLowValueAutomationIssue"),
  );
  const visibleBulkSection = page.slice(
    page.indexOf("async function runVisibleActionableDealNextSteps"),
    page.indexOf("async function reviewJob"),
  );
  const orderProductionBlockSection = sliceBetween(
    page,
    /\n  function orderProductionBlockReason\(order: OrderDraft\)/,
    /\n  function orderFulfillmentBlockReason\(order: OrderDraft\)/,
  );
  const orderFulfillmentBlockSection = sliceBetween(
    page,
    /\n  function orderFulfillmentBlockReason\(order: OrderDraft\)/,
    /\n  async function verifyQuotePaymentProof\(/,
  );
  const updateOrderDraftStatusSection = sliceBetween(
    page,
    /\n  async function confirmAndUpdateOrderDraftStatus\(order: OrderDraft, status: "fulfilled" \| "cancelled"\)/,
    /\n  async function confirmAndStartOrderProduction\(order: OrderDraft\)/,
  );

  assert.match(page, /const dealNextStepFilterOptions = \[/);
  assert.match(page, /const dealProgressFilterOptions = \[/);
  assert.match(page, /const \[dealNextStepFilter, setDealNextStepFilter\] = useState<string>\("all"\)/);
  assert.match(page, /const \[dealProgressFilter, setDealProgressFilter\] = useState<string>\("all"\)/);
  assert.match(page, /const dealProgressStageCounts = calculateDealProgressStageCounts\(quotes, orderDrafts\)/);
  assert.match(page, /const dealProgressSummaryItems = dealProgressFilterOptions\.map/);
  assert.match(page, /const activeDealProgressFilterLabel =[\s\S]*dealProgressFilterOptions\.find\(\(option\) => option\.value === dealProgressFilter\)\?\.label \|\| "全部阶段"/);
  assert.match(page, /const activeDealNextStepFilterLabel =[\s\S]*dealNextStepFilterOptions\.find\(\(option\) => option\.value === dealNextStepFilter\)\?\.label \|\| "全部下一步"/);
  assert.match(page, /const activeQuoteCenterFocusText = quoteCenterSearch\.trim\(\)/);
  assert.match(focusSection, /function focusQuoteCenter\(searchTerm: string, view: "quotes" \| "orders" = "quotes"\)/);
  assert.match(focusSection, /setQuoteWorkbenchView\(view\)/);
  assert.match(focusSection, /function focusOrderDraft\(order: OrderDraft\)[\s\S]*focusQuoteCenter\(order\.quoteDraftId \|\| order\.id, "orders"\)/);
  assert.match(focusSection, /function clearQuoteCenterFocus\(\)/);
  assert.match(focusSection, /setQuoteCenterSearch\(""\)/);
  assert.match(focusSection, /setDealProgressFilter\("all"\)/);
  assert.match(page, /function upsertOrderDraftState\(order: OrderDraft \| null \| undefined\)/);
  assert.match(page, /function upsertSendTaskState\(task: SendTask \| null \| undefined\)/);
  assert.match(page, /function upsertQuoteState\(quote: QuoteDraft \| null \| undefined\)/);
  assert.match(api, /export async function createQuote\(id: string, expected: IdentityExpectation = \{\}\): Promise<QuoteDraft>/);
  assert.match(page, /createQuoteForJob\(activeJob\)/);
  assert.match(page, /const quote = await createQuote\(job\.id, identityExpectation\(job\)\)/);
  assert.match(page, /upsertQuoteState\(quote\)/);
  assert.match(page, /async function updateQuoteDraft\([\s\S]*const updated = await updateQuote\(quote\.id, nextPatch\)[\s\S]*upsertQuoteState\(updated\)/);
  assert.match(page, /async function confirmQuoteManualFollowup\(quote: QuoteDraft\)/);
  assert.match(page, /confirmQuoteManualFollowup\([\s\S]*const confirmed = window\.confirm\(/);
  assert.match(page, /confirmQuoteManualFollowup[\s\S]*const identityLines = quoteIdentityConfirmLines\(quote\)/);
  assert.match(page, /confirmQuoteManualFollowup[\s\S]*`报价ID：\$\{quote\.id\}`[\s\S]*\.\.\.identityLines/);
  assert.match(page, /已取消报价人工跟进操作/);
  assert.match(page, /confirmQuoteManualFollowup\([\s\S]*updateQuoteDraft\(quote, \{ status: "manual_review", owner: "人工客服" \}\)/);
  assert.match(page, /function confirmQuoteReviewDecision\(quote: QuoteDraft, decision: "approve_quote" \| "request_followup" \| "reject_quote"\)/);
  assert.match(page, /confirmQuoteReviewDecision[\s\S]*const identityLines = quoteIdentityConfirmLines\(quote\)/);
  assert.match(page, /confirmQuoteReviewDecision[\s\S]*`报价ID：\$\{quote\.id\}`[\s\S]*\.\.\.identityLines/);
  assert.match(page, /confirmQuoteReviewDecision\([\s\S]*quoteSelectedImage\(quote\)[\s\S]*paymentStatusLabel\(quote\.paymentStatus \|\| "unpaid"\)/);
  assert.match(page, /if \(!confirmQuoteReviewDecision\(quote, decision\)\) \{[\s\S]*已取消报价审核操作/);
  assert.match(page, /function confirmOrderReviewDecision\([\s\S]*decision: "approve_confirmation" \| "approve_followup" \| "request_followup" \| "reject_order"/);
  assert.match(page, /confirmOrderReviewDecision\([\s\S]*orderSelectedImage\(order\)[\s\S]*orderStatusLabel\(order\.status\)[\s\S]*paymentStatusLabel\(orderPaymentStatusValue\(order\)\)/);
  assert.match(page, /confirmOrderReviewDecision[\s\S]*const identityLines = orderIdentityConfirmLines\(order\)/);
  assert.match(page, /confirmOrderReviewDecision[\s\S]*order\.id[\s\S]*\.\.\.identityLines/);
  assert.match(page, /if \(!confirmOrderReviewDecision\(order, decision, followupType\)\) \{[\s\S]*已取消订单审核操作/);
  assert.match(page, /function confirmQuoteSelectionRevision\(quote: QuoteDraft, selectedImage: NonNullable<DesignJob\["images"\]>\[number\]\)/);
  assert.match(page, /confirmQuoteSelectionRevision[\s\S]*const identityLines = quoteIdentityConfirmLines\(quote\)/);
  assert.match(page, /confirmQuoteSelectionRevision[\s\S]*`报价ID：\$\{quote\.id\}`[\s\S]*\.\.\.identityLines/);
  assert.match(page, /confirmQuoteSelectionRevision\([\s\S]*报价会回到人工审核/);
  assert.match(page, /if \(!confirmQuoteSelectionRevision\(quote, selectedImage\)\)/);
  assert.match(page, /已取消报价选图修订/);
  assert.match(page, /async function reviseQuoteDraftSelection\([\s\S]*const updated = await reviseQuoteSelection\(quote\.id,[\s\S]*upsertQuoteState\(updated\)/);
  assert.match(page, /function confirmOrderSelectionRevision\(order: OrderDraft, selectedImage: NonNullable<DesignJob\["images"\]>\[number\]\)/);
  assert.match(page, /confirmOrderSelectionRevision\([\s\S]*订单会回到待确认/);
  assert.match(page, /if \(!confirmOrderSelectionRevision\(order, selectedImage\)\)/);
  assert.match(page, /已取消订单选图修订/);
  assert.match(page, /async function reviseOrderDraftSelection\([\s\S]*reviseOrderSelection\(order\.id,[\s\S]*selectedImageId: selectedImage\.id/);
  assert.match(page, /function confirmActiveQuoteEditSave\(quote: QuoteDraft\)/);
  assert.match(page, /confirmActiveQuoteEditSave[\s\S]*const identityLines = quoteIdentityConfirmLines\(quote\)/);
  assert.match(page, /confirmActiveQuoteEditSave[\s\S]*`报价ID：\$\{quote\.id\}`[\s\S]*\.\.\.identityLines/);
  assert.match(page, /confirmActiveQuoteEditSave\([\s\S]*预估利润/);
  assert.match(page, /if \(!confirmActiveQuoteEditSave\(activeQuote\)\)/);
  assert.match(page, /已取消保存报价调整/);
  assert.match(page, /async function saveActiveQuoteEdit\([\s\S]*const updated = await updateQuote\(activeQuote\.id,[\s\S]*upsertQuoteState\(updated\)/);
  assert.match(page, /function confirmQuoteSendQueue\(quote: QuoteDraft, preview: QuotePreview\)/);
  assert.match(page, /confirmQuoteSendQueue\([\s\S]*window\.confirm\(lines\.join\("\\n"\)\)/);
  assert.match(page, /confirmQuoteSendQueue[\s\S]*const selectedImage = quoteSelectedImage\(previewQuote\)/);
  assert.match(page, /confirmQuoteSendQueue[\s\S]*`报价ID：\$\{previewQuote\.id \|\| quote\.id\}`/);
  assert.match(page, /confirmQuoteSendQueue[\s\S]*`微信账号：\$\{wechatAccountLabel\}`[\s\S]*`客户ID：\$\{customerLabel\}`[\s\S]*`会话：\$\{conversationLabel\}`/);
  assert.match(page, /confirmQuoteSendQueue[\s\S]*selectedImage\?\.position \? `选图：第 \$\{selectedImage\.position\} 张` : "选图：已通过发送前检查"/);
  assert.match(page, /系统会继续通过账号、聊天对象、最近消息三重校验后再发送/);
  assert.match(page, /async function queueQuoteDraft\([\s\S]*const queued = await queueQuoteSend\(quote\.id, identityExpectation\(quote\)\)[\s\S]*upsertQuoteState\(queued\.quote\)[\s\S]*upsertSendTaskState\(queued\.sendTask\)/);
  assert.match(page, /async function queueQuoteDraft\([\s\S]*if \(!confirmQuoteSendQueue\(quote, result\.preview\)\) \{[\s\S]*已取消报价发送入队/);
  assert.match(page, /async function queueQuoteAfterPreviewCheck\([\s\S]*const queued = await queueQuoteSend\(quote\.id, identityExpectation\(quote\)\)[\s\S]*upsertQuoteState\(queued\.quote\)[\s\S]*upsertSendTaskState\(queued\.sendTask\)/);
  assert.match(page, /function quoteIdentityConfirmLines\(quote: QuoteDraft\)/);
  assert.match(page, /quoteIdentityConfirmLines[\s\S]*`微信账号：\$\{wechatAccountLabel\}`[\s\S]*`客户ID：\$\{customerLabel\}`[\s\S]*`会话：\$\{conversationLabel\}`/);
  assert.match(page, /function confirmQuoteOrderDraftCreation\(quote: QuoteDraft\)/);
  assert.match(page, /confirmQuoteOrderDraftCreation\([\s\S]*orderDrafts\.find\(\(order\) => order\.quoteDraftId === quote\.id\)/);
  assert.match(page, /confirmQuoteOrderDraftCreation[\s\S]*const identityLines = quoteIdentityConfirmLines\(quote\)/);
  assert.match(page, /confirmQuoteOrderDraftCreation[\s\S]*`报价ID：\$\{quote\.id\}`[\s\S]*\.\.\.identityLines/);
  assert.match(page, /confirmQuoteOrderDraftCreation\([\s\S]*const selectedImageLabel = selectedImage\?\.position[\s\S]*: quote\.selectedImageId[\s\S]*选图：已绑定/);
  assert.match(page, /confirmQuoteOrderDraftCreation\([\s\S]*: "选图：未绑定"/);
  assert.match(page, /function quoteOrderDraftBlockReason\(quote: QuoteDraft\)/);
  assert.match(page, /quoteOrderDraftBlockReason\([\s\S]*!quote\.selectedImageId[\s\S]*报价还没有绑定客户选中的效果图，不能生成订单/);
  assert.match(page, /quoteOrderDraftBlockReason\([\s\S]*!quoteSelectedImage\(quote\)[\s\S]*报价选中的效果图不在当前设计任务里，不能生成订单/);
  assert.match(page, /quoteOrderDraftBlockReason\([\s\S]*!designJob\?\.conversationId \|\| !designJob\?\.wechatAccountId[\s\S]*报价缺少微信账号或客户会话，不能生成订单/);
  assert.match(page, /quoteOrderDraftBlockReason\([\s\S]*Number\(quote\.profit \|\| 0\) < 0[\s\S]*报价利润为负，不能生成订单/);
  assert.match(page, /系统会把报价、选图和客户信息生成订单草稿/);
  assert.match(page, /function confirmQuoteAcceptanceOrderCreation\(quote: QuoteDraft\)/);
  assert.match(page, /confirmQuoteAcceptanceOrderCreation[\s\S]*const identityLines = quoteIdentityConfirmLines\(quote\)/);
  assert.match(page, /confirmQuoteAcceptanceOrderCreation[\s\S]*`报价ID：\$\{quote\.id\}`[\s\S]*\.\.\.identityLines/);
  assert.match(page, /confirmQuoteAcceptanceOrderCreation\([\s\S]*客户在当前会话里明确说了确认、要这个、可以做/);
  assert.match(page, /function confirmQuotePaymentProofVerification\(quote: QuoteDraft, paymentStatus: "deposit_paid" \| "paid"\)/);
  assert.match(page, /confirmQuotePaymentProofVerification[\s\S]*const identityLines = quoteIdentityConfirmLines\(quote\)/);
  assert.match(page, /confirmQuotePaymentProofVerification[\s\S]*`报价ID：\$\{quote\.id\}`[\s\S]*\.\.\.identityLines/);
  assert.match(page, /if \(!confirmQuoteAcceptanceOrderCreation\(quote\)\) \{[\s\S]*已取消客户确认成单操作/);
  assert.match(page, /async function createOrderDraft\(quote: QuoteDraft\)[\s\S]*const orderDraft = await createOrderDraftFromQuote\(quote\.id, identityExpectation\(quote\)\)[\s\S]*upsertOrderDraftState\(orderDraft\)/);
  assert.match(page, /async function createOrderDraft\(quote: QuoteDraft\)[\s\S]*const blocker = quoteOrderDraftBlockReason\(quote\)[\s\S]*setMessage\(blocker\)[\s\S]*return/);
  assert.match(page, /async function createOrderDraft\(quote: QuoteDraft\)[\s\S]*if \(!confirmQuoteOrderDraftCreation\(quote\)\) \{[\s\S]*已取消生成订单草稿操作/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| Boolean\(quoteOrderDraftBlockReason\(activeQuote\)\)\}/);
  assert.match(page, /title=\{quoteOrderDraftBlockReason\(activeQuote\) \|\| "按当前报价生成或更新订单草稿"\}/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| Boolean\(quoteOrderDraftBlockReason\(quote\)\)\}/);
  assert.match(page, /title=\{quoteOrderDraftBlockReason\(quote\) \|\| "按当前报价生成或更新订单草稿"\}/);
  assert.match(page, /async function updateOrderDraftStatus\([\s\S]*const updated = await updateOrderDraft\(order\.id,[\s\S]*upsertOrderDraftState\(updated\)/);
  const ordersService = readProjectFile("apps/api/src/orders/orders.service.ts");
  const wechatDispatchService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  assert.match(ordersService, /assertOrderStatusPaymentReady\(current, data\)/);
  assert.match(ordersService, /assertOrderStatusCommercialReady\(current, data\)/);
  assert.match(ordersService, /function orderDraftPaymentStatus\(order: any, patch: OrderDraftUpdatePatch = \{\}\)/);
  assert.match(ordersService, /return patch\.paymentStatus \|\| order\?\.paymentStatus \|\| order\?\.quoteDraft\?\.paymentStatus \|\| "unpaid"/);
  assert.match(ordersService, /paymentStatus: orderDraftPaymentStatus\(order\)/);
  assert.match(ordersService, /订单 \$\{id\} 已更新为 \$\{updated\.status\} \/ \$\{orderDraftPaymentStatus\(\{ \.\.\.current, \.\.\.updated \}, data\)\}/);
  assert.match(ordersService, /function assertOrderStatusPaymentReady\(current: any, patch: OrderDraftUpdatePatch\)/);
  assert.match(ordersService, /\["processing", "fulfilled"\]\.includes\(nextStatus\)/);
  assert.match(ordersService, /const nextPaymentStatus = orderDraftPaymentStatus\(current, patch\)/);
  assert.match(ordersService, /\["deposit_paid", "paid"\]\.includes\(nextPaymentStatus\)/);
  assert.match(ordersService, /function assertOrderStatusCommercialReady\(current: any, patch: OrderDraftUpdatePatch\)/);
  assert.match(ordersService, /function orderDraftSelectedImageId\(order: any\)/);
  assert.match(ordersService, /return order\?\.selectedImageId \|\| order\?\.quoteDraft\?\.selectedImageId \|\| ""/);
  assert.match(ordersService, /const selectedImageId = orderDraftSelectedImageId\(current\)/);
  assert.match(ordersService, /!selectedImageId[\s\S]*订单未绑定客户选中的效果图/);
  assert.match(ordersService, /!current\?\.wechatAccountId \|\| !current\?\.customerId \|\| !current\?\.conversationId[\s\S]*订单缺少微信账号、客户或会话绑定/);
  assert.match(ordersService, /Number\(current\?\.profit \|\| 0\) < 0[\s\S]*订单利润为负/);
  assert.match(wechatDispatchService, /this\.assertOrderConversationUnlocked\(order, "order confirmation"\)[\s\S]*this\.assertOrderPaymentReadyForSend\(order, "order confirmation"\)/);
  assert.match(wechatDispatchService, /this\.assertOrderConversationUnlocked\(order, "order follow-up"\)[\s\S]*this\.assertOrderPaymentReadyForSend\(order, "order follow-up"\)/);
  assert.match(wechatDispatchService, /this\.assertOrderProfitReadyForSend\(order, "order confirmation"\)/);
  assert.match(wechatDispatchService, /this\.assertOrderProfitReadyForSend\(order, "order follow-up"\)/);
  assert.match(wechatDispatchService, /private assertOrderConversationUnlocked\(order: any, context: string\)/);
  assert.match(wechatDispatchService, /manualLocked[\s\S]*会话已人工接管/);
  assert.match(wechatDispatchService, /this\.assertOrderPaymentReadyForSend\(order, "order confirmation"\)/);
  assert.match(wechatDispatchService, /this\.assertOrderPaymentReadyForSend\(order, "order follow-up"\)/);
  assert.match(wechatDispatchService, /private orderPaymentStatus\(order: any\)[\s\S]*order\?\.paymentStatus \|\| order\?\.quoteDraft\?\.paymentStatus \|\| "unpaid"/);
  assert.match(wechatDispatchService, /buildOrderConfirmationCustomerMessage\([\s\S]*const paymentStatus = this\.orderPaymentStatus\(order\)[\s\S]*paymentStatus,/);
  assert.match(wechatDispatchService, /buildOrderFollowupCustomerMessage\([\s\S]*const paymentStatus = this\.orderPaymentStatus\(order\)[\s\S]*paymentStatus,/);
  assert.match(wechatDispatchService, /source: "order_confirmation"[\s\S]*paymentStatus,/);
  assert.match(wechatDispatchService, /source: "order_followup"[\s\S]*paymentStatus,/);
  assert.match(wechatDispatchService, /function assertOrderPaymentReadyForSend|private assertOrderPaymentReadyForSend/);
  assert.match(wechatDispatchService, /const paymentStatus = this\.orderPaymentStatus\(order\)/);
  assert.match(wechatDispatchService, /paymentStatus === "deposit_paid" \|\| paymentStatus === "paid"/);
  assert.match(wechatDispatchService, /需要先核验定金或全款，不能进入微信发送队列/);
  assert.match(wechatDispatchService, /需要先绑定客户选中的效果图，不能进入微信发送队列/);
  assert.match(wechatDispatchService, /private assertOrderProfitReadyForSend\(order: any, context: string\)/);
  assert.match(wechatDispatchService, /发现订单利润为负，必须人工确认报价和成本后再发送/);
  assert.match(wechatDispatchService, /function orderSendContextLabel\(context: string\)/);
  assert.match(wechatDispatchService, /this\.assertOrderSendTaskStillQueueable\(task\)/);
  assert.match(wechatDispatchService, /private assertOrderSendTaskStillQueueable\(task: any\)/);
  assert.match(wechatDispatchService, /const orderDraftId = String\(automation\.orderDraftId \|\| ""\)/);
  assert.match(wechatDispatchService, /if \(!orderDraftId\) return/);
  assert.match(wechatDispatchService, /order draft not found for send task requeue/);
  assert.match(wechatDispatchService, /this\.assertOrderConversationUnlocked\(order, context\)[\s\S]*this\.assertOrderPaymentReadyForSend\(order, context\)/);
  assert.match(wechatDispatchService, /this\.assertOrderProfitReadyForSend\(order, context\)/);
  assert.match(wechatDispatchService, /order send task requeue binding invalid/);
  assert.match(wechatDispatchService, /private markLinkedOrderSendFailed\(task: any, reason: string\)/);
  assert.match(wechatDispatchService, /const orderDraftId = String\(automation\.orderDraftId \|\| task\?\.payload\?\.orderDraftId \|\| ""\)\.trim\(\)/);
  assert.match(wechatDispatchService, /source === "order_followup" \|\| automation\.followupType/);
  assert.match(wechatDispatchService, /private hasOrderDraftBinding\(task: any\)/);
  assert.match(wechatDispatchService, /markLinkedQuoteSent\(task: any\)[\s\S]*if \(this\.hasOrderDraftBinding\(task\)\) return/);
  assert.match(wechatDispatchService, /markLinkedQuoteFailed\(task: any, reason: string\)[\s\S]*if \(this\.hasOrderDraftBinding\(task\)\) \{[\s\S]*this\.markLinkedOrderSendFailed\(task, reason\);[\s\S]*return;[\s\S]*\}/);
  assert.match(wechatDispatchService, /markLinkedQuoteRequeued\(task: any, reason: string\)[\s\S]*if \(this\.hasOrderDraftBinding\(task\)\) return/);
  assert.match(wechatDispatchService, /customerNotes: appendCustomerNote\(order\.customerNotes, note\)/);
  assert.match(wechatDispatchService, /this\.markLinkedOrderSendFailed\(updated, reason\)/);
  assert.match(updateOrderDraftStatusSection, /async function confirmAndUpdateOrderDraftStatus\(order: OrderDraft, status: "fulfilled" \| "cancelled"\)/);
  assert.match(orderProductionBlockSection, /function orderProductionBlockReason\(order: OrderDraft\)/);
  assert.match(orderProductionBlockSection, /order\.status === "cancelled"[\s\S]*不能标记生产中/);
  assert.match(orderProductionBlockSection, /!orderPaymentReady\(order\)[\s\S]*不能标记生产中/);
  assert.match(orderProductionBlockSection, /!orderSelectedImageIdValue\(order\)[\s\S]*不能标记生产中/);
  assert.match(orderProductionBlockSection, /orderStrictIdentityMissing\(order\)[\s\S]*orderStrictIdentityBlockReason\("标记生产中"\)/);
  assert.match(orderFulfillmentBlockSection, /function orderFulfillmentBlockReason\(order: OrderDraft\)/);
  assert.match(orderFulfillmentBlockSection, /order\.status !== "processing"[\s\S]*不能直接标记完成/);
  assert.match(orderFulfillmentBlockSection, /!orderPaymentReady\(order\)[\s\S]*不能标记完成/);
  assert.match(orderFulfillmentBlockSection, /!orderSelectedImageIdValue\(order\)[\s\S]*不能标记完成/);
  assert.match(orderFulfillmentBlockSection, /orderStrictIdentityMissing\(order\)[\s\S]*orderStrictIdentityBlockReason\("标记完成"\)/);
  assert.match(updateOrderDraftStatusSection, /const blocker = status === "fulfilled" \? orderFulfillmentBlockReason\(order\) : ""/);
  assert.match(updateOrderDraftStatusSection, /const identityLines = orderIdentityConfirmLines\(order\)/);
  assert.match(updateOrderDraftStatusSection, /`订单ID：\$\{order\.id\}`[\s\S]*\.\.\.identityLines/);
  assert.match(updateOrderDraftStatusSection, /if \(blocker\) \{[\s\S]*setMessage\(blocker\);[\s\S]*return;/);
  assert.match(updateOrderDraftStatusSection, /const confirmed = window\.confirm\(/);
  assert.match(updateOrderDraftStatusSection, /已取消\$\{statusText\}订单操作/);
  assert.match(page, /async function confirmAndStartOrderProduction\(order: OrderDraft\)/);
  assert.match(page, /confirmAndStartOrderProduction\([\s\S]*const blocker = orderProductionBlockReason\(order\)[\s\S]*setMessage\(blocker\)[\s\S]*return/);
  assert.match(page, /confirmAndStartOrderProduction[\s\S]*const identityLines = orderIdentityConfirmLines\(order\)/);
  assert.match(page, /confirmAndStartOrderProduction[\s\S]*`订单ID：\$\{order\.id\}`[\s\S]*\.\.\.identityLines/);
  assert.match(page, /confirmAndStartOrderProduction\([\s\S]*window\.confirm\(/);
  assert.match(page, /confirmAndStartOrderProduction\([\s\S]*updateOrderDraftStatus\(order, \{ status: "processing" \}\)/);
  assert.match(page, /function confirmOrderSelectionRevision\(order: OrderDraft, selectedImage: NonNullable<DesignJob\["images"\]>\[number\]\)/);
  assert.match(page, /confirmOrderSelectionRevision[\s\S]*const identityLines = orderIdentityConfirmLines\(order\)/);
  assert.match(page, /confirmOrderSelectionRevision[\s\S]*`订单ID：\$\{order\.id\}`[\s\S]*\.\.\.identityLines/);
  assert.match(page, /function orderIdentityConfirmLines\(order: OrderDraft\)/);
  assert.match(page, /orderIdentityConfirmLines[\s\S]*`微信账号：\$\{wechatAccountLabel\}`[\s\S]*`客户ID：\$\{customerLabel\}`[\s\S]*`会话：\$\{conversationLabel\}`/);
  assert.match(page, /function confirmHighValueOrderManualRelease\([\s\S]*const identityLines = orderIdentityConfirmLines\(order\)/);
  assert.match(page, /confirmHighValueOrderManualRelease[\s\S]*`订单ID：\$\{order\.id\}`[\s\S]*\.\.\.identityLines/);
  assert.match(page, /onClick=\{\(\) => confirmQuoteManualFollowup\(activeQuote\)\}/);
  assert.match(page, /onClick=\{\(\) => confirmQuoteManualFollowup\(quote\)\}/);
  assert.match(page, /onClick=\{\(\) => confirmAndStartOrderProduction\(activeOrderDraft\)\}/);
  assert.match(page, /onClick=\{\(\) => confirmAndStartOrderProduction\(order\)\}/);
  assert.match(page, /onClick=\{\(\) => confirmAndUpdateOrderDraftStatus\(activeOrderDraft, "fulfilled"\)\}/);
  assert.match(page, /onClick=\{\(\) => confirmAndUpdateOrderDraftStatus\(activeOrderDraft, "cancelled"\)\}/);
  assert.match(page, /<OrderSendPreflightPanel order=\{activeOrderDraft\} \/>/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| Boolean\(orderProductionBlockReason\(activeOrderDraft\)\)\}/);
  assert.match(page, /title=\{orderProductionBlockReason\(activeOrderDraft\) \|\| "核验付款和选图后标记生产中"\}/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| Boolean\(orderFulfillmentBlockReason\(activeOrderDraft\)\)\}/);
  assert.match(page, /title=\{orderFulfillmentBlockReason\(activeOrderDraft\) \|\| "生产完成后标记订单完成"\}/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| Boolean\(orderProductionBlockReason\(order\)\)\}/);
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| Boolean\(orderFulfillmentBlockReason\(order\)\)\}/);
  assert.match(page, /function orderConfirmationButtonTitle\(order: OrderDraft\)[\s\S]*const blocker = orderConfirmationBlockReason\(order\)[\s\S]*if \(blocker\) return blocker/);
  assert.match(page, /onClick=\{\(\) => queueOrderDraftConfirmation\(activeOrderDraft\)\}[\s\S]*disabled=\{[\s\S]*Boolean\(orderConfirmationBlockReason\(activeOrderDraft\)\)/);
  assert.match(page, /onClick=\{\(\) => queueOrderDraftConfirmation\(order\)\}[\s\S]*disabled=\{[\s\S]*Boolean\(orderConfirmationBlockReason\(order\)\)/);
  assert.match(page, /function orderFollowupBlockReason\(order: OrderDraft, type: "production" \| "delivery"\)/);
  assert.match(page, /orderFollowupBlockReason\([\s\S]*orderStrictIdentityMissing\(order\)[\s\S]*orderStrictIdentityBlockReason\("发送跟进消息"\)/);
  assert.match(page, /orderFollowupBlockReason\([\s\S]*!orderPaymentReady\(order\)/);
  assert.match(page, /orderFollowupBlockReason\([\s\S]*!orderSelectedImageIdValue\(order\)/);
  assert.match(page, /function orderSendFailureStep\(order: OrderDraft\)/);
  assert.match(page, /const failedSendStep = orderSendFailureStep\(order\)/);
  assert.match(page, /if \(failedSendStep\) return failedSendStep/);
  assert.match(page, /订单确认发送\$\{sendStatusLabel\(failedConfirmation\.status\)\}/);
  assert.match(page, /订单跟进发送\$\{sendStatusLabel\(failedFollowup\.status\)\}/);
  assert.match(page, /async function queueOrderDraftConfirmation\([\s\S]*const result = await queueOrderConfirmation\(order\.id, identityExpectation\(order\), manualRelease\)[\s\S]*upsertOrderDraftState\(result\.orderDraft\)[\s\S]*upsertSendTaskState\(result\.sendTask\)/);
  assert.match(page, /function confirmOrderConfirmationSendQueue\(order: OrderDraft, preview: OrderConfirmationPreview\)[\s\S]*const selectedImage = orderSelectedImage\(previewOrder\)/);
  assert.match(page, /confirmOrderConfirmationSendQueue[\s\S]*`微信账号：\$\{wechatAccountLabel\}`[\s\S]*`客户ID：\$\{customerLabel\}`[\s\S]*`会话：\$\{conversationLabel\}`/);
  assert.match(page, /confirmOrderConfirmationSendQueue[\s\S]*selectedImage\?\.position \? `选图：第 \$\{selectedImage\.position\} 张` : "选图：已通过发送前检查"/);
  assert.match(page, /function confirmOrderFollowupSendQueue\(order: OrderDraft, type: "production" \| "delivery"\)[\s\S]*const selectedImage = orderSelectedImage\(order\)/);
  assert.match(page, /confirmOrderFollowupSendQueue[\s\S]*`微信账号：\$\{wechatAccountLabel\}`[\s\S]*`客户ID：\$\{customerLabel\}`[\s\S]*`会话：\$\{conversationLabel\}`/);
  assert.match(page, /confirmOrderFollowupSendQueue[\s\S]*selectedImage\?\.position \? `选图：第 \$\{selectedImage\.position\} 张` : "选图：已通过发送前检查"/);
  assert.match(page, /async function queueOrderFollowupDraft\([\s\S]*const result = await queueOrderFollowup\(order\.id, type, identityExpectation\(order\), manualRelease\)[\s\S]*upsertOrderDraftState\(result\.orderDraft\)[\s\S]*upsertSendTaskState\(result\.sendTask\)/);
  assert.match(page, /async function queueOrderConfirmationAfterPreviewCheck\([\s\S]*const confirmation = await queueOrderConfirmation\(order\.id, identityExpectation\(order\), manualRelease\)[\s\S]*upsertOrderDraftState\(confirmation\.orderDraft\)[\s\S]*upsertSendTaskState\(confirmation\.sendTask\)/);
  assert.match(quoteFilterSection, /guardedQuoteDealNextStep\(quote, orderDraft, quoteSendBlockReason\(quote\)\)/);
  assert.match(quoteFilterSection, /guardedOrderDealNextStep\(order\)/);
  assert.match(quoteFilterSection, /matchesDealProgressFilter\(dealProgressSteps\(quote, orderDraft\), dealProgressFilter\)/);
  assert.match(quoteFilterSection, /const linkedQuote = order\.quoteDraft \|\| quotes\.find\(\(quote\) => quote\.id === order\.quoteDraftId\) \|\| null/);
  assert.match(quoteFilterSection, /matchesDealProgressFilter\(dealProgressSteps\(linkedQuote, order\), dealProgressFilter\)/);
  assert.match(quoteFilterSection, /matchesDealNextStepFilter\(step, dealNextStepFilter, quote\.status\)/);
  assert.match(quoteFilterSection, /matchesDealNextStepFilter\(step, dealNextStepFilter, order\.status\)/);
  assert.match(helperSection, /function matchesDealProgressFilter/);
  assert.match(helperSection, /filter === "finish"[\s\S]*step\.state === "done" \|\| step\.state === "current"/);
  assert.match(helperSection, /function currentDealProgressStage/);
  assert.match(helperSection, /function calculateDealProgressStageCounts\(quotes: QuoteDraft\[\], orders: OrderDraft\[\]\)/);
  assert.match(helperSection, /function dealProgressStageDetail/);
  assert.match(helperSection, /function dealProgressStageView\(stage: string\): "overview" \| "actions" \| "quotes" \| "orders"/);
  assert.match(helperSection, /filter === "actionable"[\s\S]*step\.action !== "none"/);
  assert.match(helperSection, /filter === "blocked"[\s\S]*step\.action === "none"/);
  assert.match(page, /className="deal-progress-summary"/);
  assert.match(page, /aria-label="成交阶段数量概览"/);
  assert.match(page, /dealProgressSummaryItems\.map\(\(item\) =>/);
  assert.match(page, /setQuoteWorkbenchView\(item\.view\)/);
  assert.match(controlsSection, /renderFilterSegment\("成交阶段", dealProgressFilterOptions, dealProgressFilter, setDealProgressFilter\)/);
  assert.match(controlsSection, /renderFilterSegment\("下一步", dealNextStepFilterOptions, dealNextStepFilter, setDealNextStepFilter\)/);
  assert.match(page, /className="quote-focus-strip"/);
  assert.match(page, /aria-label="当前报价订单聚焦条件"/);
  assert.match(page, /aria-label="当前订单聚焦条件"/);
  assert.match(page, /正在聚焦：\{activeQuoteCenterFocusText\}/);
  assert.match(page, /onClick=\{clearQuoteCenterFocus\}/);
  assert.match(page, /清除聚焦/);
  assert.match(page, /setDealProgressFilter\("confirm"\)/);
  assert.match(page, /setDealProgressFilter\("payment"\)/);
  assert.match(page, /setDealProgressFilter\("order"\)/);
  assert.match(page, /className="quote-section-meta"/);
  assert.match(page, /className="active-filter-chip"/);
  assert.match(page, /title="清除成交阶段筛选"/);
  assert.match(page, /阶段：\{activeDealProgressFilterLabel\}/);
  assert.match(page, /onClick=\{\(\) => setDealProgressFilter\("all"\)\}/);
  assert.match(page, /title="清除下一步筛选"/);
  assert.match(page, /下一步：\{activeDealNextStepFilterLabel\}/);
  assert.match(page, /onClick=\{\(\) => setDealNextStepFilter\("all"\)\}/);
  assert.match(page, /const quoteNextStepCounts = quotes\.reduce/);
  assert.match(page, /const orderNextStepCounts = orderDrafts\.reduce/);
  assert.match(page, /className="deal-next-summary"/);
  assert.match(page, /setDealNextStepFilter\(item\.filter\)/);
  assert.match(page, /setDealNextStepFilter\("all"\)/);
  assert.match(page, /guardedQuoteDealNextStep\(quote, orderDraft, quoteSendBlockReason\(quote\)\)/);
  assert.match(page, /guardedOrderDealNextStep\(order\)/);
  assert.match(page, /async function runVisibleActionableDealNextSteps\(\)/);
  assert.match(page, /actionableDealNextStepItems\.slice\(0, 3\)/);
  assert.match(page, /批量模式只会处理低风险的报价入队和订单确认入队/);
  assert.match(page, /客户确认成单、生成订单、排产和交期跟进必须逐条人工确认/);
  assert.match(page, /item\.action === "queue_quote" && item\.quote/);
  assert.match(page, /await queueQuoteAfterPreviewCheck\(item\.quote\)/);
  assert.match(visibleBulkSection, /item\.action === "confirm_quote_create_order" && item\.quote[\s\S]*summary\.skipped \+= 1/);
  assert.match(visibleBulkSection, /item\.action === "create_order" && item\.quote[\s\S]*summary\.skipped \+= 1/);
  assert.doesNotMatch(visibleBulkSection, /updateQuote\(item\.quote\.id, \{ \.\.\.identityExpectation\(item\.quote\), status: "accepted" \}/);
  assert.doesNotMatch(visibleBulkSection, /createOrderDraftFromQuote\(item\.quote\.id, identityExpectation\(item\.quote\)\)/);
  assert.match(page, /item\.action === "queue_order_confirmation" && item\.order/);
  assert.match(page, /queueOrderConfirmationAfterPreviewCheck\(item\.order\)/);
  assert.match(visibleBulkSection, /item\.action === "start_production" && item\.order[\s\S]*summary\.skipped \+= 1/);
  assert.match(visibleBulkSection, /item\.action === "send_delivery_followup" && item\.order[\s\S]*summary\.skipped \+= 1/);
  assert.doesNotMatch(visibleBulkSection, /updateOrderDraft\(item\.order\.id, \{ \.\.\.identityExpectation\(item\.order\), status: "processing" \}/);
  assert.doesNotMatch(visibleBulkSection, /queueOrderFollowup\(item\.order\.id, "delivery", identityExpectation\(item\.order\)\)/);
  assert.match(page, /summary\.skipped \+= 1/);
  assert.match(page, /const dealNextStepInsightItems = \[/);
  assert.match(page, /const actionableDealNextStepItems = dealNextStepInsightItems\.filter\(\(item\) => item\.action !== "none"\)/);
  assert.match(page, /const firstActionableDealNextStep = actionableDealNextStepItems\[0\] \|\| null/);
  assert.match(page, /const step = guardedQuoteDealNextStep\(quote, orderDraft, sendRisk\)/);
  assert.match(page, /const step = guardedOrderDealNextStep\(order\)/);
  assert.match(page, /className="deal-attention-list"/);
  assert.match(page, /aria-label="成交优先处理提醒"/);
  assert.match(page, /className="deal-attention-head-actions"/);
  assert.match(page, /firstActionableDealNextStep\?\.execute\(\)/);
  assert.match(page, /!firstActionableDealNextStep/);
  assert.match(page, /执行第一项/);
  assert.match(page, /onClick=\{runVisibleActionableDealNextSteps\}/);
  assert.match(page, /!actionableDealNextStepItems\.length/);
  assert.match(page, /执行前三项/);
  assert.match(page, /dealNextStepInsightItems\.map/);
  assert.match(page, /onClick=\{item\.focus\}/);
  assert.match(page, /execute: \(\) => runQuoteDealNextStep\(quote, orderDraft, sendRisk\)/);
  assert.match(page, /execute: \(\) => runOrderDealNextStep\(order\)/);
  assert.match(page, /className="deal-attention-actions"/);
  assert.match(page, /onClick=\{item\.execute\}/);
  assert.match(page, /item\.action === "none"/);
  assert.match(page, /focusQuoteCenter\(quote\.id\)/);
  assert.match(page, /focusOrderDraft\(order\)/);
  assert.match(css, /\.deal-next-summary/);
  assert.match(css, /\.deal-progress-summary/);
  assert.match(css, /\.quote-section-meta/);
  assert.match(css, /\.active-filter-chip/);
  assert.match(css, /\.quote-focus-strip/);
  assert.match(css, /quote-mode-overview \.deal-progress-summary/);
  assert.match(css, /\.deal-attention-list/);
  assert.match(css, /\.deal-attention-grid/);
  assert.match(css, /\.deal-attention-item/);
  assert.match(css, /\.deal-attention-main/);
  assert.match(css, /\.deal-attention-head-actions/);
  assert.match(css, /\.deal-attention-head-actions \.ghost/);
  assert.match(css, /\.deal-attention-actions/);
});

test("web active quote panel uses guarded next-step actions", () => {
  const page = readProjectFile("apps/web/src/app/legacy-workbench.tsx");
  const quoteRunSectionStart = page.indexOf("async function runQuoteDealNextStep");
  const quoteRunSection = page.slice(
    quoteRunSectionStart,
    page.indexOf("async function runOrderDealNextStep", quoteRunSectionStart),
  );
  const orderRunSectionStart = page.indexOf("async function runOrderDealNextStep");
  const orderRunSection = page.slice(
    orderRunSectionStart,
    page.indexOf("async function runActiveDealNextStep", orderRunSectionStart),
  );
  const activeRunSectionStart = page.indexOf("async function runActiveDealNextStep");
  const activeRunSection = page.slice(
    activeRunSectionStart,
    page.indexOf("async function reviewJob", activeRunSectionStart),
  );
  const activePanelSection = page.slice(
    page.indexOf("const activeDealNextStep = activeOrderDraft"),
    page.indexOf("const unreadNoticeCount"),
  );
  const renderSection = page.slice(
    page.indexOf("<div className={`deal-next-step active"),
    page.indexOf("{activeQuote ? ("),
  );

  assert.match(activePanelSection, /guardedQuoteDealNextStep\(activeQuote, activeOrderDraft, activeQuoteSendRisk\)/);
  assert.match(renderSection, /onClick=\{runActiveDealNextStep\}/);
  assert.match(renderSection, /activeDealNextStep\.action === "none"/);
  assert.match(activeRunSection, /runOrderDealNextStep\(activeOrderDraft\)/);
  assert.match(activeRunSection, /runQuoteDealNextStep\(activeQuote, activeOrderDraft, activeQuoteSendRisk\)/);
  assert.match(page, /function confirmDesignImageQuickSend\(job: DesignJob\)/);
  assert.match(page, /function designJobIdentityConfirmLines\(job: DesignJob\)/);
  assert.match(page, /designJobIdentityConfirmLines[\s\S]*`设计任务ID：\$\{job\.id\}`[\s\S]*`微信账号：\$\{wechatAccountLabel\}`[\s\S]*`客户ID：\$\{customerLabel\}`[\s\S]*`会话：\$\{conversationLabel\}`/);
  assert.match(page, /function confirmDesignImageSelection\(job: DesignJob, input: Parameters<typeof selectDesignImage>\[1\], label: string\)/);
  assert.match(page, /confirmDesignImageSelection[\s\S]*designJobIdentityConfirmLines\(job\)[\s\S]*referencedImageId[\s\S]*screenshotFingerprint[\s\S]*客户原话/);
  assert.match(page, /selectFromCustomerText[\s\S]*if \(!confirmDesignImageSelection\(activeJob, customerSelectionText, "识别客户选图"\)\)/);
  assert.match(page, /selectDesignImageForJob[\s\S]*if \(!confirmDesignImageSelection\(job, input, label\)\)/);
  assert.match(page, /confirmDesignImageQuickSend[\s\S]*const identityLines = designJobIdentityConfirmLines\(job\)/);
  assert.match(page, /confirmDesignImageQuickSend[\s\S]*\.\.\.identityLines[\s\S]*`选图：第 \$\{selectedImage\.position \|\| "-"\} 张`/);
  assert.match(page, /if \(!confirmDesignImageQuickSend\(activeJob\)\) return/);
  assert.match(page, /function confirmDesignJobQuoteCreation\(job: DesignJob\)/);
  assert.match(page, /confirmDesignJobQuoteCreation[\s\S]*const identityLines = designJobIdentityConfirmLines\(job\)/);
  assert.match(page, /confirmDesignJobQuoteCreation[\s\S]*\.\.\.identityLines[\s\S]*`选图：第 \$\{selectedImage\.position \|\| "-"\} 张`/);
  assert.match(page, /if \(!confirmDesignJobQuoteCreation\(job\)\) return/);
  assert.match(page, /function confirmHighValueManualApproval\([\s\S]*identityLines\?: string\[\]/);
  assert.match(page, /confirmHighValueManualApproval[\s\S]*\.\.\.\(options\.identityLines\?\.length \? \["", \.\.\.options\.identityLines\] : \[\]\)/);
  assert.match(page, /confirmHighValueManualApproval\(\{[\s\S]*identityLines: designJobIdentityConfirmLines\(job\)/);
  assert.match(page, /confirmHighValueManualApproval\(\{[\s\S]*identityLines: \[`报价ID：\$\{quote\.id\}`, \.\.\.quoteIdentityConfirmLines\(quote\)\]/);
  assert.match(page, /async function quoteActiveJob\(\)[\s\S]*await createQuoteForJob\(activeJob\)/);
  assert.match(quoteRunSection, /step\.action === "queue_quote"[\s\S]*queueQuoteDraft\(quote\)/);
  assert.match(quoteRunSection, /step\.action === "confirm_quote_create_order"[\s\S]*if \(!confirmQuoteAcceptanceOrderCreation\(quote\)\)/);
  assert.match(quoteRunSection, /step\.action === "confirm_quote_create_order"[\s\S]*const blocker = quoteOrderDraftBlockReason\(quote\)[\s\S]*setMessage\(blocker\)[\s\S]*return/);
  assert.match(quoteRunSection, /已取消客户确认成单操作/);
  assert.match(quoteRunSection, /step\.action === "confirm_quote_create_order"[\s\S]*updateQuote\(quote\.id, \{ \.\.\.identityExpectation\(quote\), status: "accepted" \}\)/);
  assert.match(quoteRunSection, /step\.action === "confirm_quote_create_order"[\s\S]*createOrderDraftFromQuote\(quote\.id, identityExpectation\(quote\)\)/);
  assert.match(orderRunSection, /step\.action === "queue_order_confirmation"[\s\S]*queueOrderDraftConfirmation\(order\)/);
  assert.match(orderRunSection, /step\.action === "start_production"[\s\S]*confirmAndStartOrderProduction\(order\)/);
  assert.doesNotMatch(orderRunSection, /step\.action === "start_production"[\s\S]*updateOrderDraftStatus\(order, \{ status: "processing" \}\)/);
  assert.match(page, /isHighValueQuote\(quote\)[\s\S]*action: "none"/);
  assert.match(page, /isHighValueOrder\(order\)[\s\S]*action: "none"/);
});

test("bridge acknowledgement preserves original attempt audit metadata", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const ackSection = service.slice(
    service.indexOf("  acknowledgeBridgeSend"),
    service.indexOf("  requeueSendTask"),
  );

  assert.match(ackSection, /\.\.\.\(isPlainObject\(pendingAttempt\.metadata\) \? pendingAttempt\.metadata : \{\}\)/);
  assert.match(ackSection, /bridgeAckOutboxFileName/);
  assert.match(ackSection, /archivedOutboxPath/);
});

test("bridge acknowledgement audit metadata redacts ack tokens before persistence", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const ackSection = service.slice(
    service.indexOf("  acknowledgeBridgeSend("),
    service.indexOf("  requeueSendTask("),
  );
  const sanitizerSection = service.slice(
    service.indexOf("function sanitizeBridgeAckMetadata"),
    service.indexOf("function listJsonInboxFiles"),
  );

  assert.match(ackSection, /bridgeAck:\s*sanitizeBridgeAckMetadata\(payload\.metadata\)/);
  assert.match(sanitizerSection, /redactBridgeAckSecrets/);
  assert.match(sanitizerSection, /normalizedKey\.includes\("acktoken"\)/);
  assert.match(sanitizerSection, /normalizedKey === "token"/);
  assert.match(sanitizerSection, /compactKey\.includes\("token"\)/);
  assert.match(sanitizerSection, /compactKey\.includes\("secret"\)/);
  assert.match(sanitizerSection, /compactKey\.includes\("password"\)/);
  assert.match(sanitizerSection, /compactKey\.includes\("apikey"\)/);
  assert.match(sanitizerSection, /normalizedKey === "authorization"/);
  assert.match(sanitizerSection, /normalizedKey === "cookie"/);
});

test("external bridge acknowledgement validates local outbox file body before archiving", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const ackSection = service.slice(
    service.indexOf("  acknowledgeBridgeSend("),
    service.indexOf("  requeueSendTask("),
  );
  const validationIndex = ackSection.indexOf("validateBridgeAckOutboxPayload");
  const archiveIndex = ackSection.indexOf("archiveBridgeOutboxFile");

  assert.ok(validationIndex > 0);
  assert.ok(archiveIndex > validationIndex);
  assert.match(ackSection, /status === "sent" \|\| !options\.internal/);
  assert.match(ackSection, /validateBridgeAckOutboxPayload/);
  assert.match(ackSection, /bridgeOutboxPayloadValidation/);
  assert.match(ackSection, /status === "sent"[\s\S]*const orderState = this\.validateQueuedOrderSendState\(task\)/);
  assert.match(ackSection, /bridge ack order state invalid/);
  assert.ok(
    ackSection.indexOf("validateQueuedOrderSendState") < ackSection.indexOf("archiveBridgeOutboxFile"),
    "sent bridge ack must re-check order state before archiving outbox or marking the task sent",
  );
});

test("bridge acknowledgement rejects late ack after task leaves sending state", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const ackSection = service.slice(
    service.indexOf("  acknowledgeBridgeSend("),
    service.indexOf("  requeueSendTask("),
  );

  assert.match(ackSection, /task\.status !== "sending"/);
  assert.match(ackSection, /send task is no longer waiting for bridge ack/);
  assert.match(ackSection, /!pendingAttempt \|\| pendingAttempt\.status !== "started"/);
  assert.match(ackSection, /no active bridge send attempt is waiting for ack/);
  assert.ok(
    ackSection.indexOf('task.status !== "sending"') < ackSection.indexOf("this.resolveBridgeAckAttempt"),
    "task status must be checked before resolving or mutating bridge ack attempts",
  );
  assert.ok(
    ackSection.indexOf('pendingAttempt.status !== "started"') < ackSection.indexOf("validateBridgeAckBinding"),
    "attempt status must be checked before bridge ack binding and persistence",
  );
});

test("bridge acknowledgement rejects sent ack after dispatch instruction expires", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const ackSection = service.slice(
    service.indexOf("  acknowledgeBridgeSend("),
    service.indexOf("  requeueSendTask("),
  );

  assert.match(ackSection, /const dispatchState = this\.findPendingBridgeDispatchForTask\(task, pendingAttempt\)/);
  assert.match(ackSection, /const requiresBridgeDispatch = pendingAttempt\.adapter === "windows_bridge" \|\| bridgeAttemptMetadata\.requiresBridge === true/);
  assert.match(ackSection, /status === "sent" && requiresBridgeDispatch && !dispatchState/);
  assert.match(ackSection, /bridge ack rejected: dispatch instruction is required before marking sent/);
  assert.match(ackSection, /status === "sent" && dispatchState\?\.expired/);
  assert.match(ackSection, /bridge ack rejected: dispatch instruction expired/);
  assert.ok(
    ackSection.indexOf("!dispatchState") < ackSection.indexOf("validateBridgeAckBinding"),
    "missing dispatch sent ack must be rejected before binding and persistence",
  );
  assert.ok(
    ackSection.indexOf("dispatchState?.expired") < ackSection.indexOf("validateBridgeAckBinding"),
    "expired dispatch sent ack must be rejected before binding and persistence",
  );
  assert.ok(
    ackSection.indexOf("dispatchState?.expired") < ackSection.indexOf("archiveBridgeOutboxFile"),
    "expired dispatch sent ack must be rejected before archiving files",
  );
});

test("bridge acknowledgement fails trusted sent ack when queued order state changed", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const ackSection = service.slice(
    service.indexOf("  acknowledgeBridgeSend("),
    service.indexOf("  requeueSendTask("),
  );

  assert.match(ackSection, /const orderState = this\.validateQueuedOrderSendState\(task\)/);
  assert.match(ackSection, /bridge ack order state invalid/);
  assert.match(ackSection, /this\.failTaskForRejectedTrustedBridgeAck\(id, payload, \{ fileName: "direct-bridge-ack", source: "direct_ack" \}, errorMessage\)/);
  assert.match(service, /const rejectionSource = entry\?\.source \|\| \(entry\?\.filePath \? "bridge_inbox" : "direct_ack"\)/);
  assert.match(service, /bridgeAckRejected: \{[\s\S]*source: rejectionSource/);
  assert.ok(
    ackSection.indexOf("this.failTaskForRejectedTrustedBridgeAck") < ackSection.indexOf("throw new BadRequestException(errorMessage)"),
    "trusted sent ack rejected by order state must fail the task before throwing",
  );
});

test("bridge ack and cancellation archive dispatch instruction files", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const adapter = readProjectFile("apps/api/src/wechat/wechat-send-adapter.service.ts");
  const ackSection = service.slice(
    service.indexOf("  acknowledgeBridgeSend("),
    service.indexOf("  requeueSendTask("),
  );
  const cancelSection = service.slice(
    service.indexOf("  cancelSendTask("),
    service.indexOf("  private blockSendTask("),
  );
  const dispatchArchiveSection = service.slice(
    service.indexOf("  private archiveBridgeDispatchFile"),
    service.indexOf("  private buildWindowState"),
  );

  assert.match(ackSection, /archiveBridgeDispatchFile\([\s\S]*status === "sent" \? "processed" : "failed"/);
  assert.match(ackSection, /archivedDispatchPath/);
  assert.match(cancelSection, /archiveBridgeDispatchFile\(task, pendingBridgeAttempt, "cancelled"\)/);
  assert.match(cancelSection, /archivedDispatchPath/);
  assert.match(dispatchArchiveSection, /resolveBridgeDispatchFileName/);
  assert.match(dispatchArchiveSection, /safeBridgeFileSegment/);
  assert.match(dispatchArchiveSection, /appConfig\.wechatBridgeDispatchDir/);
  assert.match(adapter, /moveBridgeDispatchFile\(filePath: string, outcome: "processed" \| "failed" \| "cancelled"\)/);
  assert.match(adapter, /resolveBridgeChildFile\(filePath, appConfig\.wechatBridgeDispatchDir, "bridge dispatch"\)/);
});

test("backend bridge outbox payload validation checks ack protocol, identity and guard constraints", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const sendGuard = readProjectFile("packages/rules/sendGuard.js");
  const validationSection = service.slice(
    service.indexOf("  private validateBridgeAckOutboxPayload"),
    service.indexOf("  private resolveBridgeAckAttempt"),
  );
  assert.ok(validationSection.length > 0);

  assert.match(validationSection, /BRIDGE_ACK_VERSION/);
  assert.match(validationSection, /ackProtocolVersion/);
  assert.match(validationSection, /BRIDGE_OUTBOX_VERSION/);
  assert.match(validationSection, /outboxAckToken/);
  assert.match(validationSection, /ackTokenMatches/);
  assert.match(validationSection, /ackTaskId/);
  assert.match(validationSection, /ackAttemptId/);
  assert.match(validationSection, /ackWechatAccountId/);
  assert.match(validationSection, /ackConversationId/);
  assert.match(validationSection, /ackCustomerId/);
  assert.match(validationSection, /String\(payload\?\.customerId \|\| ""\) === taskCustomerId/);
  assert.match(sendGuard, /key: "ackCustomerPresent"/);
  assert.match(sendGuard, /key: "ackCustomerMatches"/);
  assert.match(sendGuard, /payload\.customerId === expectedCustomerId/);
  assert.match(validationSection, /data\.taskId/);
  assert.match(validationSection, /data\.wechatAccountId/);
  assert.match(validationSection, /data\.conversationId/);
  assert.match(validationSection, /target\.wechatAccountId/);
  assert.match(validationSection, /const taskCustomerId = String\(task\?\.conversation\?\.customerId \|\| task\?\.customerId \|\| task\?\.designJob\?\.customerId \|\| task\?\.quoteDraft\?\.customerId \|\| ""\)/);
  assert.match(validationSection, /String\(target\.customerId \|\| ""\) === taskCustomerId/);
  assert.match(validationSection, /sendPlanTarget\.wechatAccountId/);
  assert.match(validationSection, /String\(sendPlanTarget\.customerId \|\| ""\) === taskCustomerId/);
  assert.match(service, /customerId\?: string;[\s\S]*outboxFileName\?: string/);
  assert.match(service, /bridgeAckIdentity: \{[\s\S]*customerId: payload\.customerId \|\| ""/);
  const adapter = readProjectFile("apps/api/src/wechat/wechat-send-adapter.service.ts");
  assert.match(adapter, /customerId\?: string/);
  assert.match(adapter, /customerId: data\.target\?\.customerId \|\| data\.sendPlan\?\.target\?\.customerId \|\| data\.customerId/);
  assert.match(validationSection, /constraints\.singleAccountLock === true/);
  assert.match(validationSection, /constraints\.doNotMarkSentWithoutAck === true/);
  assert.match(validationSection, /const preflight = isPlainObject\(data\.preflight\) \? data\.preflight : \{\}/);
  assert.match(validationSection, /const hasPreflightWindowPolicy = Boolean\(preflight\.expectedWindowSnapshotId \|\| preflight\.rejectIfAnyCheckFails \|\| preflight\.rejectIfWindowChanged\)/);
  assert.match(validationSection, /const expectedWindowSnapshotId = String\(preflight\.expectedWindowSnapshotId \|\| target\.windowSnapshotId \|\| attempt\?\.windowSnapshotId \|\| ""\)/);
  assert.match(validationSection, /const actualWindowSnapshotId = String\(context\.windowSnapshotId \|\| target\.windowSnapshotId \|\| ""\)/);
  assert.match(validationSection, /key: "preflightWindowChangePolicy"/);
  assert.match(validationSection, /!hasPreflightWindowPolicy \|\| \(preflight\.rejectIfAnyCheckFails === true && preflight\.rejectIfWindowChanged === true\)/);
  assert.match(validationSection, /key: "preflightWindowSnapshot"/);
  assert.match(validationSection, /expectedWindowSnapshotId === actualWindowSnapshotId/);
  assert.match(validationSection, /validateBridgeSendPlanActions\(actions\)/);
  assert.match(validationSection, /sendPlanActionDetails/);
  assert.match(validationSection, /guardSnapshot/);
});

test("send operations scan is the only internal simplified failed bridge ack path", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const scanOpsSection = service.slice(
    service.indexOf("  async scanSendOperations("),
    service.indexOf("  acknowledgeBridgeSend("),
  );
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");

  assert.match(scanOpsSection, /acknowledgeBridgeSend\([\s\S]*\{ internal: true \}/);
  assert.match(scanOpsSection, /const bridgeDispatchExpired: any\[\] = \[\]/);
  assert.match(scanOpsSection, /const autoRetriedLowValue: any\[\] = \[\]/);
  assert.match(scanOpsSection, /findPendingBridgeDispatchForTask\(task, pendingBridgeAttempt\)/);
  assert.match(scanOpsSection, /dispatchState\?\.expired/);
  assert.match(scanOpsSection, /recovery: "bridge_dispatch_expired"/);
  assert.match(scanOpsSection, /dispatchFileName: dispatchState\.fileName/);
  assert.match(scanOpsSection, /bridgeDispatchExpired: bridgeDispatchExpired\.length/);
  assert.match(scanOpsSection, /autoRetriedLowValue: autoRetriedLowValue\.length/);
  assert.match(scanOpsSection, /tasks: \{[\s\S]*autoRetriedLowValue/);
  assert.match(scanOpsSection, /微信桥接发送指令过期/);
  assert.match(service, /private findPendingBridgeDispatchForTask\(task: any, attempt: any\)/);
  assert.match(service, /listBridgeDispatch\(\)[\s\S]*buildBridgeDispatchListItem\(entry\)[\s\S]*entry\.taskId === task\.id[\s\S]*entry\.attemptId === attempt\?\.id/);
  assert.doesNotMatch(controller, /internal:\s*true/);
});

test("backend bridge send action validation requires local image files", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const actionValidationSection = service.slice(
    service.indexOf("function validateBridgeSendPlanActions"),
    service.indexOf("function listJsonInboxFiles"),
  );

  assert.match(actionValidationSection, /type === "text"/);
  assert.match(actionValidationSection, /type === "image"/);
  assert.match(actionValidationSection, /resolveBridgeLocalStorageFile\(action\.filePath\)/);
  assert.match(actionValidationSection, /fs\.lstatSync\(candidate\)\.isFile\(\)/);
  assert.match(actionValidationSection, /fs\.realpathSync\(storageRoot\)/);
  assert.match(actionValidationSection, /fs\.realpathSync\(candidate\)/);
  assert.match(actionValidationSection, /appConfig\.localStorageRoot/);
  assert.match(actionValidationSection, /\^\[a-z\]\[a-z0-9\+\.-\]\*:/);
  assert.match(actionValidationSection, /test\(raw\)\) return ""/);
});

test("bridge file proof and archive paths use realpath regular-file checks", () => {
  const dispatchService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const sendAdapter = readProjectFile("apps/api/src/wechat/wechat-send-adapter.service.ts");
  const validationSection = dispatchService.slice(
    dispatchService.indexOf("  private validateBridgeAckOutboxPayload"),
    dispatchService.indexOf("  private resolveBridgeAckAttempt"),
  );

  assert.match(validationSection, /fs\.lstatSync\(resolved\)\.isFile\(\)/);
  assert.match(validationSection, /fs\.realpathSync\(root\)/);
  assert.match(validationSection, /fs\.realpathSync\(resolved\)/);
  assert.match(validationSection, /realRelative\.startsWith\("\.\."\)/);
  assert.match(sendAdapter, /function resolveBridgeChildFile/);
  assert.match(sendAdapter, /fs\.lstatSync\(resolved\)\.isFile\(\)/);
  assert.match(sendAdapter, /fs\.realpathSync\(root\)/);
  assert.match(sendAdapter, /fs\.realpathSync\(resolved\)/);
});

test("bridge inbox scan forwards acknowledgement protocol version", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const scanSection = service.slice(
    service.indexOf("  scanBridgeInbox()"),
    service.indexOf("  scanSendOperations()"),
  );
  const controllerAckSection = controller.slice(
    controller.indexOf('@Post("send-tasks/:id/bridge-ack")'),
    controller.indexOf("  ) {", controller.indexOf('@Post("send-tasks/:id/bridge-ack")')),
  );

  assert.match(scanSection, /version:\s*typeof data\.version === "string" \? data\.version : undefined/);
  assert.match(scanSection, /protocolVersion:\s*typeof data\.protocolVersion === "string" \? data\.protocolVersion : undefined/);
  assert.match(scanSection, /ackToken:\s*typeof data\.ackToken === "string" \? data\.ackToken : undefined/);
  assert.match(scanSection, /taskId:\s*typeof data\.taskId === "string"/);
  assert.match(controllerAckSection, /taskId\?: string/);
});

test("bridge inbox scan keeps system provenance after external ack metadata", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const scanSection = service.slice(
    service.indexOf("  scanBridgeInbox()"),
    service.indexOf("  scanSendOperations()"),
  );
  const metadataSection = scanSection.slice(
    scanSection.indexOf("metadata: {"),
    scanSection.indexOf("sentAt: typeof data.sentAt"),
  );

  const externalMetadataIndex = metadataSection.indexOf("...(isPlainObject(data.metadata) ? data.metadata : {})");
  const sourceIndex = metadataSection.indexOf('source: "bridge_inbox"');
  const fileNameIndex = metadataSection.indexOf("fileName: entry.fileName");

  assert.ok(externalMetadataIndex >= 0);
  assert.ok(sourceIndex > externalMetadataIndex);
  assert.ok(fileNameIndex > externalMetadataIndex);
});

test("bridge inbox scan fails trusted rejected sent acknowledgements without bypassing validation", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const scanSection = service.slice(
    service.indexOf("  scanBridgeInbox()"),
    service.indexOf("  scanSendOperations()"),
  );
  const recoverySection = service.slice(
    service.indexOf("  private failTaskForRejectedTrustedBridgeAck("),
    service.indexOf("  private validateBridgeAckOutboxPayload("),
  );

  assert.match(scanSection, /const ackPayload = \{/);
  assert.match(scanSection, /acknowledgeBridgeSend\(taskId, ackPayload\)/);
  assert.match(scanSection, /failTaskForRejectedTrustedBridgeAck\(taskId, ackPayload, entry, errorMessage\)/);
  assert.match(recoverySection, /payload\?\.status !== "sent"/);
  assert.match(recoverySection, /resolveBridgeAckAttempt\(task, payload\)/);
  assert.match(recoverySection, /validateBridgeAckBinding\(\{ task, attempt: pendingAttempt, payload \}\)/);
  assert.match(recoverySection, /validateExistingSendTaskBinding\(task\)/);
  assert.match(recoverySection, /validateBridgeAckOutboxPayload\(task, pendingAttempt, payload, outboxFileName\)/);
  assert.match(recoverySection, /archiveBridgeOutboxFile\(outboxFileName, "failed"\)/);
  assert.match(recoverySection, /archiveBridgeDispatchFile\(task, pendingAttempt, "failed"\)/);
  assert.match(recoverySection, /status: "failed"/);
  assert.match(recoverySection, /reason: "bridge_ack_rejected_after_trusted_validation"/);
  assert.match(recoverySection, /markLinkedQuoteFailed\(updatedTask, failureReason\)/);
  assert.match(service, /private markLinkedOrderSendFailed\(task: any, reason: string\)/);
  assert.match(service, /\[发送任务:\$\{task\.id\}\]/);
  assert.ok(
    recoverySection.indexOf("validateBridgeAckOutboxPayload") < recoverySection.indexOf("updateSendTask"),
    "rejected sent ack recovery must validate the outbox body before failing the task",
  );
});
