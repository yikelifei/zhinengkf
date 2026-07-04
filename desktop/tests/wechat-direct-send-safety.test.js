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
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const styles = readProjectFile("apps/web/src/app/globals.css");
  const statusSection = sliceBetween(service, /function channelStatus\(/, /function maskSecret/);
  const topbarSection = sliceBetween(page, /<div className="top-actions">/, /<\/header>/);

  assert.match(statusSection, /const runtimeKeys = new Set\(\["window_observer", "windows_bridge"\]\)/);
  assert.match(statusSection, /const sendAdapterKeys = new Set\(\["safe_send_queue"\]\)/);
  assert.match(statusSection, /return "needs_send_adapter"/);
  assert.match(service, /needsSendAdapter/);
  assert.match(service, /bridgeDispatchPending:\s*bridge\.dispatch\.pendingCount/);
  assert.match(service, /bridgeDispatchStale:\s*bridge\.dispatch\.staleCount/);
  assert.match(api, /"needs_send_adapter"/);
  assert.match(page, /needs_send_adapter:\s*"待发送器"/);
  assert.match(page, /bridgeDispatchPending:\s*"指令"/);
  assert.match(page, /bridgeDispatchStale:\s*"超时指令"/);
  assert.match(page, /function wechatChannelNextStep/);
  assert.match(page, /WECHAT_SEND_ADAPTER=windows_bridge/);
  assert.match(page, /wechat-config-runbook/);
  assert.match(page, /className="wechat-config-sections"/);
  assert.match(page, /aria-label=\{`\$\{channel\.label\}真实接入配置分区`\}/);
  assert.match(page, /className="wechat-config-section"[\s\S]*className="wechat-config-section-head"[\s\S]*channel\.checks\.map/);
  assert.match(page, /className="wechat-config-section"[\s\S]*wechatChannelSetupRows\(channel\)/);
  assert.match(page, /className="wechat-config-section"[\s\S]*Object\.entries\(channel\.entrypoints\)/);
  assert.match(page, /不新增假接口/);
  assert.match(page, /aria-label=\{`\$\{channel\.label\}操作矩阵`\}/);
  assert.match(page, /className="wechat-action-group"/);
  assert.match(page, /<small>采集<\/small>[\s\S]*captureCurrentWindowOnce[\s\S]*scanRealWindowSnapshots/);
  assert.match(page, /<small>发送<\/small>[\s\S]*processSafeQueue/);
  assert.match(page, /<small>演练<\/small>[\s\S]*runWechatChannelInbound\(channel\.key\)/);
  assert.match(page, /<small>路由<\/small>[\s\S]*scrollToWorkspaceSection\("routing-center"\)/);
  assert.doesNotMatch(page, /className="wechat-lane-actions" aria-label="接入通道操作"/);
  assert.match(page, /className="wechat-visual-action-strip"/);
  assert.match(page, /aria-label="个人微信采集"[\s\S]*captureCurrentWindowOnce[\s\S]*scanRealWindowSnapshots/);
  assert.match(page, /aria-label="通道配置"[\s\S]*setWechatWorkbenchView\("config"\)[\s\S]*loadWechatChannelStatusOnly/);
  assert.match(page, /className="wechat-live-action-groups"/);
  assert.match(page, /aria-label="会话处理"[\s\S]*processRouteInbound/);
  assert.match(page, /aria-label="审核发送"[\s\S]*setReviewWorkbenchView\("handoff"\)[\s\S]*setSendWorkbenchView\("queue"\)/);
  assert.match(page, /async function refreshWechatWorkspaceStatus/);
  assert.match(page, /function renderTopStatusPills/);
  assert.match(page, /function renderTopContextActions/);
  assert.match(page, /data-toolbar-scope="wechat-actions"/);
  assert.match(page, /isDesignWorkspace && platformReadiness && !platformReadiness\.canSubmitFormalGeneration/);
  assert.match(topbarSection, /renderTopStatusPills\(\)/);
  assert.match(topbarSection, /renderTopContextActions\(\)/);
  assert.doesNotMatch(topbarSection, /checkDesignPlatform|createDemo|preflightActiveJob|submitActiveJob/);
  assert.match(styles, /\.wechat-channel-card\.needs_send_adapter::before/);
  assert.match(styles, /\.wechat-channel-next-step\.needs_runtime,[\s\S]*\.wechat-channel-next-step\.needs_send_adapter/);
  assert.match(styles, /\.wechat-config-sections/);
  assert.match(styles, /\.wechat-config-section:first-child/);
  assert.match(styles, /\.wechat-config-section-head/);
  assert.match(styles, /WeChat mobile config pager/);
  assert.match(styles, /#wechat-channel-center\.wechat-mode-config \.wechat-channel-summary[\s\S]*grid-auto-flow: column !important/);
  assert.match(styles, /#wechat-channel-center\.wechat-mode-config \.wechat-channel-summary[\s\S]*max-height: 64px !important/);
  assert.match(styles, /#wechat-channel-center\.wechat-mode-config \.wechat-config-list[\s\S]*display: flex !important/);
  assert.match(styles, /#wechat-channel-center\.wechat-mode-config \.wechat-config-list[\s\S]*flex-wrap: nowrap !important/);
  assert.match(styles, /#wechat-channel-center\.wechat-mode-config \.wechat-config-list[\s\S]*scroll-snap-type: x mandatory/);
  assert.match(styles, /#wechat-channel-center\.wechat-mode-config \.wechat-config-card[\s\S]*flex: 0 0 100% !important/);
  assert.match(styles, /#wechat-channel-center\.wechat-mode-config \.wechat-config-card[\s\S]*scroll-snap-align: start/);
  assert.match(styles, /\.wechat-action-group/);
  assert.match(styles, /\.wechat-action-buttons \.primary/);
  assert.match(styles, /\.wechat-visual-action-strip/);
  assert.match(styles, /\.wechat-visual-action-group/);
  assert.match(styles, /\.wechat-live-action-groups/);
  assert.match(styles, /\.wechat-live-secondary-actions/);
  assert.match(styles, /\.readiness-banner\.platform-mode-guide[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) !important/);
  assert.match(styles, /\.readiness-banner\.platform-mode-guide span,[\s\S]*\.readiness-banner\.platform-mode-guide small[\s\S]*overflow-wrap: anywhere !important/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*#wechat-channel-center\.wechat-mode-flow \.wechat-service-canvas \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(styles, /Context toolbar: active app module owns its own commands/);
  assert.match(styles, /\.top-actions \.toolbar-group\.context-toolbar/);
  assert.match(styles, /\.workspace\[data-active-section="wechat-channel-center"\] \.top-actions \.command-context-toolbar/);
  assert.match(styles, /\.workspace\[data-active-section="wechat-channel-center"\] \.readiness-banner\.platform-mode-guide/);
  assert.match(styles, /WeChat mobile toolbar: no clipped status fragments/);
  assert.match(styles, /\.workspace\[data-active-section="wechat-channel-center"\] \.top-actions \.toolbar-group\.status-group,[\s\S]*\.workspace\[data-active-section="wechat-channel-center"\] \.top-actions \.conversation-toolbar \{[\s\S]*display: none !important/);
  assert.match(styles, /\.workspace\[data-active-section="wechat-channel-center"\] \.top-actions \.view-context-toolbar \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.match(styles, /\.workspace\[data-active-section="wechat-channel-center"\] \.top-actions \.command-context-toolbar \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important/);
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const previewSection = sliceBetween(page, /\nfunction BridgeOutboxPreview\(/, /\nfunction bridgeOutboxEntryForTask\(/);
  const dispatchMatcherSection = sliceBetween(page, /\nfunction bridgeDispatchEntryForTask\(/, /\nfunction sendStatusLabel\(/);
  const taskListSection = page.slice(
    page.indexOf("<div className=\"send-task-list\">"),
    page.indexOf("<section className=\"panel review-panel\""),
  );

  assert.match(api, /export type BridgeDispatchEntry/);
  assert.match(api, /export type BridgeDispatchResult = \{[\s\S]*staleCount\?: number/);
  assert.match(api, /dispatch\?:\s*\{[\s\S]*pending:\s*BridgeDispatchEntry\[\]/);
  assert.match(api, /dispatch\?:\s*\{[\s\S]*staleCount\?: number/);
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
  assert.match(page, /bridgeStatus\?\.dispatch\?\.staleCount \? `，指令超时 \$\{bridgeStatus\.dispatch\.staleCount\} 个` : ""/);
  assert.match(dispatchMatcherSection, /bridgeStatus\?\.dispatch\?\.pending/);
  assert.match(dispatchMatcherSection, /entry\.taskId === task\.id/);
  assert.match(dispatchMatcherSection, /entry\.attemptId === latestAttempt\.id/);
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const css = readProjectFile("apps/web/src/app/globals.css");
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const verifyOrderPaymentProofSection = page.slice(
    page.indexOf("async function verifyOrderPaymentProof"),
    page.indexOf("function conversationForQuoteOrder"),
  );

  assert.match(verifyOrderPaymentProofSection, /async function verifyOrderPaymentProof\([\s\S]*order: OrderDraft,[\s\S]*paymentStatus: "deposit_paid" \| "paid"/);
  assert.match(verifyOrderPaymentProofSection, /order\.quoteDraft[\s\S]*quotes\.find\(\(item\) => item\.id === order\.quoteDraftId\)/);
  assert.match(verifyOrderPaymentProofSection, /await verifyQuotePaymentProof\(quote, paymentStatus\)/);
  assert.doesNotMatch(page, /updateOrderDraftStatus\([^)]*, \{ paymentStatus: "deposit_paid"/);
  assert.doesNotMatch(page, /updateOrderDraftStatus\([^)]*, \{ paymentStatus: "paid"/);
  assert.match(page, /verifyOrderPaymentProof\(activeOrderDraft, "deposit_paid"\)/);
  assert.match(page, /verifyOrderPaymentProof\(activeOrderDraft, "paid"\)/);
  assert.match(page, /verifyOrderPaymentProof\(order, "deposit_paid"\)/);
  assert.match(page, /verifyOrderPaymentProof\(order, "paid"\)/);
});

test("manual mutation APIs carry and enforce expected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  assert.match(quoteService, /this\.assertHighValueQuoteHasManualRelease\(quote, options\)/);
  assert.match(quoteService, /private assertHighValueQuoteHasManualRelease/);
  assert.match(quoteService, /private isHighValueQuote\(quote: any\)[\s\S]*isHighValueBudget\(quote\?\.designJob\?\.budget, threshold\)/);
  assert.match(orderService, /assertExpectedIdentity\(quote, expected, "quote draft"\)/);
  assert.match(orderService, /assertExpectedIdentity\(current, patch, "order draft"\)/);
  assert.match(wechatService, /assertExpectedIdentity\(order, payload, "order draft"\)/);
  assert.match(wechatService, /this\.assertHighValueOrderHasManualRelease\(order, payload, "high value order confirmation"\)/);
  assert.match(wechatService, /this\.assertHighValueOrderHasManualRelease\(order, payload, "high value order follow-up"\)/);
  assert.match(wechatService, /this\.orders\.update\(order\.id, \{[\s\S]*expectedWechatAccountId: payload\.expectedWechatAccountId,[\s\S]*expectedConversationId: payload\.expectedConversationId,[\s\S]*expectedCustomerId: payload\.expectedCustomerId/);
  assert.match(reviewsService, /private async updateReviewedOrder/);
  assert.match(reviewsService, /function appendCustomerNote\(current: unknown, next: string\)/);
  assert.match(reviewsService, /approve_confirmation[\s\S]*result\.orderDraft = await this\.updateReviewedOrder\(id, \{[\s\S]*customerNotes: appendCustomerNote/);
  assert.match(reviewsService, /approve_followup[\s\S]*result\.orderDraft = await this\.updateReviewedOrder\(id, \{[\s\S]*customerNotes: appendCustomerNote/);
  assert.match(reviewsService, /decision === "reject_order" \? \{ status: "cancelled" \} : \{\}/);
  assert.match(wechatService, /queueOrderFollowup\([\s\S]*selectedImage: this\.orderSelectedImage\(order\)/);
  assert.match(wechatService, /private expectedIdentityFromOrder\(order: any\): ExpectedIdentityPayload/);
  assert.match(wechatService, /expectedWechatAccountId: order\?\.wechatAccountId \|\| designJob\?\.wechatAccountId/);
  assert.match(wechatService, /expectedConversationId: order\?\.conversationId \|\| designJob\?\.conversationId/);
  assert.match(wechatService, /expectedCustomerId: order\?\.customerId \|\| order\?\.quoteDraft\?\.customerId \|\| designJob\?\.customerId/);
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
});

test("send attempt lists are filtered by selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");

  assert.match(api, /export type SendOperationsScanResult = \{/);
  assert.match(api, /bridgeDispatchExpired\?: number/);
  assert.match(api, /scanSendOperations\(filters: IdentityFilters = \{\}\): Promise<SendOperationsScanResult>/);
  assert.match(api, /postJson<SendOperationsScanResult>\("\/wechat\/send-tasks\/scan-ops", filters\)/);
  assert.match(api, /processSafeSendQueue\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /postJson<SafeSendQueueResult>\("\/wechat\/send-tasks\/process-safe-queue", filters\)/);
  assert.match(page, /scanSendOperations\(activeIdentityFilters\(\)\)/);
  assert.match(page, /sendOperationsScanSummary\(result\)/);
  assert.match(page, /指令过期 \$\{row\.bridgeDispatchExpired \|\| 0\} 个/);
  assert.match(page, /processSafeSendQueue\(activeIdentityFilters\(\)\)/);
  assert.match(controller, /scanSendOperations\(@Body\(\) payload: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(controller, /return this\.wechat\.scanSendOperations\(payload \|\| \{\}\)/);
  assert.match(controller, /processSafeSendQueue\([\s\S]*wechatAccountId\?: string; conversationId\?: string; customerId\?: string/);
  assert.match(service, /scanSendOperations\(filter: IdentityFilter = \{\}\)/);
  assert.match(service, /const tasks = this\.localStore\.listSendTasks\(filter\)/);
  assert.match(service, /processSafeSendQueue\(params: \{ adapter\?: string; limit\?: number; automationOnly\?: boolean \} & IdentityFilter = \{\}\)/);
  assert.match(service, /listSendTasks\(\{[\s\S]*wechatAccountId: params\.wechatAccountId,[\s\S]*conversationId: params\.conversationId,[\s\S]*customerId: params\.customerId,[\s\S]*\}\)/);
});

test("bridge outbox, dispatch and status are scoped by selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  assert.match(reviewsController, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(reviewsController, /return this\.reviews\.list\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(reviewsService, /async list\(filter: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(reviewsService, /\.listDesignJobs\(filter\)/);
  assert.match(reviewsService, /\.listQuoteDrafts\(filter\)/);
  assert.match(reviewsService, /\.listOrderDrafts\(filter\)/);
  assert.match(reviewsService, /function isOrderReviewVisible\(order: any\)/);
  assert.match(reviewsService, /function isOrderHighValue\(order: any\)/);
  assert.match(reviewsService, /listReviewLogs\(\{ \.\.\.filter, limit: 80 \}\)/);
  assert.match(store, /listNotifications\(options: \{ unreadOnly\?: boolean; limit\?: number \} & IdentityListFilter = \{\}\)/);
  assert.match(store, /\.filter\(\(notice\) => this\.matchesIdentityFilter\(notice, options\)\)/);
  assert.match(store, /listReviewLogs\(filter: \(IdentityListFilter & \{ limit\?: number \}\) \| number = 100\)/);
  assert.match(store, /\.filter\(\(log\) => this\.matchesIdentityFilter\(log, options\)\)/);
});

test("notification bulk read is scoped by selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const controller = readProjectFile("apps/api/src/reviews/reviews.controller.ts");
  const service = readProjectFile("apps/api/src/reviews/reviews.service.ts");

  assert.match(api, /reviewDesignJob\(id: string, payload: \{[\s\S]*\} & IdentityExpectation\)/);
  assert.match(api, /reviewQuote\(id: string, payload: \{[\s\S]*\} & IdentityExpectation\)/);
  assert.match(api, /reviewOrder\(id: string, payload: \{[\s\S]*approve_confirmation[\s\S]*approve_followup[\s\S]*\} & IdentityExpectation\)/);
  assert.match(api, /`\/reviews\/orders\/\$\{id\}`/);
  assert.match(page, /reviewDesignJob\(job\.id, \{[\s\S]*\.\.\.identityExpectation\(job\),[\s\S]*decision,/);
  assert.match(page, /reviewQuote\(quote\.id, \{[\s\S]*\.\.\.identityExpectation\(quote\),[\s\S]*decision,/);
  assert.match(page, /reviewOrder\(order\.id, \{[\s\S]*\.\.\.identityExpectation\(order\),[\s\S]*decision,/);
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
    assert.match(page, /submitDesignJob\(activeJob\.id, identityExpectation\(activeJob\)\)/);
  assert.match(page, /preflightDesignJob\(activeJob\.id, identityExpectation\(activeJob\)\)/);
  assert.match(page, /pollDesignJob\(activeJob\.id, identityExpectation\(activeJob\)\)/);
  assert.match(page, /retryDesignJob\(activeJob\.id, identityExpectation\(activeJob\)\)/);
  assert.match(page, /quickConfirmSend\(activeJob\.id, identityExpectation\(activeJob\)\)/);
  assert.match(page, /cancelDesignJob\(activeJob\.id, identityExpectation\(activeJob\)\)/);
  assert.match(page, /createQuote\(activeJob\.id, identityExpectation\(activeJob\)\)/);
  assert.match(page, /markManualReview\(activeJob\.id, identityExpectation\(activeJob\)\)/);
    assert.match(page, /selectDesignImage\(activeJob\.id,[\s\S]*identityExpectation\(activeJob\)\)/);
    assert.match(page, /requestDesignRevision\(activeJob\.id, \{[\s\S]*\.\.\.identityExpectation\(activeJob\)/);
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
});

test("design preflight panel exposes bundle automation readiness", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const preflightSection = page.slice(page.indexOf("function PreflightPanel"), page.indexOf("function CandidateImages"));

  assert.match(preflightSection, /const bundleAutomation = job\.bundle\?\.automation \|\| null/);
  assert.match(preflightSection, /const bundleAutomationBlocked = bundleAutomation\?\.ready === false/);
  assert.match(preflightSection, /组合自动化：\{bundleAutomation\.ready \? "可自动" : "需人工"\}/);
  assert.match(preflightSection, /商品组合自动化：/);
  assert.match(preflightSection, /automationBlockerListLabel\(bundleAutomation\.blockers \|\| \[\]\)/);
});

test("design assets and conversation manual locks carry expected identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const assetsController = readProjectFile("apps/api/src/assets/assets.controller.ts");
  const assetsService = readProjectFile("apps/api/src/assets/assets.service.ts");
  const localStore = readProjectFile("apps/api/src/local-store/local-store.service.ts");
  const identityBinding = readProjectFile("packages/rules/identityBinding.js");
  const designController = readProjectFile("apps/api/src/design-jobs/design-jobs.controller.ts");
  const designService = readProjectFile("apps/api/src/design-jobs/design-jobs.service.ts");
  const wechatController = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");

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
  assert.match(assetsService, /wechatAccountId: payload\.expectedWechatAccountId \|\| null/);
  assert.match(assetsService, /conversationId: payload\.expectedConversationId \|\| null/);
  assert.match(assetsService, /customerId: payload\.expectedCustomerId \|\| \(payload\.ownerType === "customer" \? payload\.ownerId : null\)/);
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  assert.match(controller, /applySkillSuggestions\([\s\S]*wechatAccountId\?: string;[\s\S]*conversationId\?: string;[\s\S]*customerId\?: string;/);
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const controller = readProjectFile("apps/api/src/notifications/notifications.controller.ts");
  const service = readProjectFile("apps/api/src/notifications/notifications.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");
  const expectation = readProjectFile("apps/api/src/shared/identity-expectation.ts");

  assert.match(api, /markNotificationRead\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(page, /markNotificationRead\(notice\.id, identityExpectation\(notice\)\)/);
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

test("web client no longer exposes or renders direct mark-sent actions", () => {
  const apiClient = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/page.tsx");

  assert.doesNotMatch(apiClient, /markSendTaskSent/);
  assert.doesNotMatch(apiClient, /mark-sent/);
  assert.doesNotMatch(page, /markSendTaskSent/);
  assert.doesNotMatch(page, /markSentByCurrentWindow/);
  assert.doesNotMatch(page, /通过后发送/);
  assert.doesNotMatch(page, /快照通过后发送/);
});

test("web client cannot manually forge bridge acknowledgements", () => {
  const apiClient = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/page.tsx");

  assert.doesNotMatch(apiClient, /acknowledgeBridgeSend/);
  assert.doesNotMatch(apiClient, /\/bridge-ack/);
  assert.doesNotMatch(page, /acknowledgeBridgeSend/);
  assert.doesNotMatch(page, /bridgeAck/);
  assert.doesNotMatch(page, /桥接成功回执/);
  assert.doesNotMatch(page, /桥接失败回执/);
});

test("web client confirms before releasing manual conversation lock", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  assert.match(requeueSection, /manual_operator_requeue_from_send_center/);
  assert.match(page, /manual_takeover_cancel_send_task/);
  assert.match(page, /manual_operator_cancel_from_send_center/);
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  assert.match(reviewSection, /reviewLogSubject\(log\)/);
  assert.match(reviewSection, /reviewLogSummary\(log\)/);
  assert.match(helperSection, /blockedSendTaskIds/);
  assert.match(helperSection, /cancelledInFlightSendTaskIds/);
  assert.match(helperSection, /reviewReasonLabel/);
  assert.match(css, /\.review-log-item/);
});

test("review center exposes current manual locked conversations", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  assert.match(page, /const reviewOrderDrafts = dedupeOrdersById\(\[\.\.\.\(reviewCenter\.orderDrafts \|\| \[\]\), \.\.\.orderDrafts\]\)/);
  assert.match(page, /const highValueManualQueueItems[\s\S]*= \[/);
  assert.match(page, /job\.status === "manual_review"/);
  assert.match(page, /isHighValueDesignJob\(job\) && \["completed", "quick_confirm", "timeout", "failed"\]\.includes\(job\.status\)/);
  assert.match(page, /reason: highValueDesignReason\(job\)/);
  assert.match(page, /nextAction: step\.nextAction/);
  assert.match(page, /!orderDraftByQuoteId\.has\(quote\.id\) && \(quote\.status === "manual_review" \|\| isHighValueQuote\(quote\)\)/);
  assert.match(page, /reason: highValueQuoteReason\(quote\)/);
  assert.match(page, /const highValueReviewOrderDrafts = sortHighValueReviewOrderDrafts\(/);
  assert.match(page, /reviewOrderDrafts\.filter\(\(order\) => isHighValueOrder\(order\) && !\["fulfilled", "cancelled"\]\.includes\(order\.status\)\)/);
  assert.match(page, /const highValueOrderReviewFilterOptions = \[/);
  assert.match(page, /\{ value: "payment", label: "待收款" \}/);
  assert.match(page, /\{ value: "confirmation", label: "待发确认" \}/);
  assert.match(page, /\{ value: "delivery", label: "交付跟进" \}/);
  assert.match(page, /\{ value: "overdue", label: "已到跟进" \}/);
  assert.match(page, /const \[highValueOrderReviewFilter, setHighValueOrderReviewFilter\] = useState/);
  assert.match(page, /const highValueOrderReviewFilterCounts = highValueOrderReviewFilterOptions\.reduce/);
  assert.match(page, /const filteredHighValueReviewOrderDrafts = highValueReviewOrderDrafts\.filter/);
  assert.match(page, /function focusHighValueOrderReview\(order: OrderDraft\)/);
  assert.match(page, /setReviewWorkbenchView\("order"\)[\s\S]*setHighValueOrderReviewFilter\(highValueOrderReviewFilterForOrder\(order\)\)[\s\S]*focusOrderDraft\(order\)/);
  assert.match(page, /const highValueOrderReviewFilterLabel = highValueOrderReviewFilterOptionLabel\(highValueOrderReviewFilter\)/);
  assert.match(page, /`\$\{filteredHighValueReviewOrderDrafts\.length\}\/\$\{highValueReviewOrderDrafts\.length\} 个高价值订单 · \$\{highValueOrderReviewFilterLabel\}`/);
  assert.match(page, /\.\.\.highValueReviewOrderDrafts/);
  assert.match(page, /reason: highValueOrderReason\(order\)/);
  assert.match(page, /const action = highValueOrderManualPrimaryAction\(order\)/);
  assert.match(page, /const reviewFilter = highValueOrderReviewFilterForOrder\(order\)/);
  assert.match(page, /const nextFollowLabel = highValueOrderNextFollowLabel\(order\)/);
  assert.match(page, /primaryLabel: action\.label/);
  assert.match(page, /reviewFilterLabel: highValueOrderReviewFilterOptionLabel\(reviewFilter\)/);
  assert.match(page, /nextFollowLabel,/);
  assert.match(page, /action\.type === "queue_confirmation"[\s\S]*reviewOrderDraft\(order, "approve_confirmation"\)/);
  assert.match(page, /action\.type === "queue_delivery"[\s\S]*reviewOrderDraft\(order, "approve_followup", "delivery"\)/);
  assert.match(page, /focus: \(\) => \{[\s\S]*focusHighValueOrderReview\(order\);[\s\S]*\}/);
  assert.match(page, /run: \(\) => \{[\s\S]*setReviewWorkbenchView\("order"\);[\s\S]*setHighValueOrderReviewFilter\(highValueOrderReviewFilterForOrder\(order\)\)/);
  assert.match(page, /highValueManualQueueItems\[0\]\?\.run\(\)/);
  assert.match(page, /item\.reviewFilterLabel \? <small>订单阶段：\{item\.reviewFilterLabel\}<\/small> : null/);
  assert.match(page, /item\.nextFollowLabel \? <small>\{item\.nextFollowLabel\}<\/small> : null/);
  assert.match(page, /setReviewWorkbenchView\("order"\)/);
  assert.match(page, /label="待审订单"/);
  assert.match(page, /highValueReviewOrderDrafts\.length/);
  assert.match(page, /const visibleHighValueReviewOrderDrafts =[\s\S]*reviewWorkbenchView === "order" \? filteredHighValueReviewOrderDrafts : filteredHighValueReviewOrderDrafts\.slice\(0, 2\)/);
  assert.match(page, /className="segmented-control filter-segment high-value-order-filter"/);
  assert.match(page, /aria-label="高价值订单处理筛选"/);
  assert.match(page, /setHighValueOrderReviewFilter\(option\.value\)/);
  assert.match(page, /\{option\.label\}<span>\{highValueOrderReviewFilterCounts\[option\.value\] \|\| 0\}<\/span>/);
  assert.match(page, /visibleHighValueReviewOrderDrafts\.map/);
  assert.match(page, /reviewWorkbenchView !== "order" && filteredHighValueReviewOrderDrafts\.length > visibleHighValueReviewOrderDrafts\.length/);
  assert.match(page, /当前筛选下没有高价值订单/);
  assert.match(page, /setHighValueOrderReviewFilter\("all"\)/);
  assert.match(page, /const followupStatus = orderFollowupStatusText\(order\)/);
  assert.match(page, /paymentStatusLabel\(order\.paymentStatus\)/);
  assert.match(page, /orderStatusLabel\(order\.status\)/);
  assert.match(page, /reviewOrderDraft\(order, "approve_confirmation"\)/);
  assert.match(page, /reviewOrderDraft\(order, "approve_followup", "delivery"\)/);
  assert.match(page, /reviewOrderDraft\(order, "request_followup"\)/);
  assert.match(page, /reviewOrderDraft\(order, "reject_order"\)/);
  assert.match(page, /async function recordHighValueOrderManualFollowup\(order: OrderDraft\)/);
  assert.match(page, /buildHighValueOrderManualNote\(\{/);
  assert.match(page, /appendOrderCustomerNotes\(order\.customerNotes, manualNote\)/);
  assert.match(page, /updateOrderDraft\(order\.id, \{[\s\S]*owner: reviewer,[\s\S]*customerNotes:/);
  assert.match(page, /reviewOrder\(order\.id, \{[\s\S]*decision: "request_followup"[\s\S]*note: manualNote/);
  assert.match(api, /export type ReviewOrderResult = \{/);
  assert.match(api, /export async function reviewOrder[\s\S]*Promise<ReviewOrderResult>/);
  assert.match(page, /function applyReviewOrderResultState\(result: ReviewOrderResult \| null \| undefined\)/);
  assert.match(page, /applyReviewOrderResultState\(reviewed\)/);
  assert.match(page, /upsertOrderDraftState\(reviewResult\.orderDraft \|\| reviewResult\.order/);
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
  assert.match(page, /filter === "payment"[\s\S]*!orderPaymentReady\(order\)/);
  assert.match(page, /filter === "confirmation"[\s\S]*orderPaymentReady\(order\) && !hasActiveOrderConfirmationTask\(order\)/);
  assert.match(page, /filter === "delivery"[\s\S]*order\.status === "processing"/);
  assert.match(page, /filter === "overdue"[\s\S]*nextFollowAt > 0 && nextFollowAt <= Date\.now\(\)/);
  assert.match(page, /function highValueOrderReviewFilterForOrder\(order: OrderDraft\)/);
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
  assert.match(reviewSection, /label="人工接管"/);
  assert.match(reviewSection, /aria-label="高价值人工跟进队列"/);
  assert.match(reviewSection, /高价值人工跟进/);
  assert.match(reviewSection, /处理第一项/);
  assert.match(reviewSection, /审设计/);
  assert.match(reviewSection, /审报价/);
  assert.match(reviewSection, /跟订单/);
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
  assert.match(page, /priority: 14/);
  assert.match(page, /nextAction: "先调整成本、售价或组合/);
  assert.match(page, /高价值报价先确认数量、单价、利润、话术和发送对象/);
  assert.match(page, /function highValueOrderManualStep\(order: OrderDraft\)/);
  assert.match(page, /function highValueOrderManualPrimaryAction\(order: OrderDraft\)/);
  assert.match(page, /async function reviewOrderDraft\(/);
  assert.match(page, /reviewOrder\(order\.id, \{[\s\S]*decision,[\s\S]*followupType,[\s\S]*reviewer: "人工客服"/);
  assert.match(page, /!orderPaymentReady\(order\)[\s\S]*label: "去收款"/);
  assert.match(page, /!hasActiveOrderConfirmationTask\(order\)[\s\S]*label: "核验并发确认"/);
  assert.match(page, /order\.status === "processing"[\s\S]*label: "发交期说明"/);
  assert.match(page, /function highValueOrderReason\(order: OrderDraft\)/);
  assert.match(page, /priority: 18/);
  assert.match(page, /nextAction: "联系客户确认付款安排/);
  assert.match(page, /高价值订单未记录定金或全款/);
  assert.match(css, /\.manual-lock-review-item/);
  assert.match(css, /\.high-value-handoff-list/);
  assert.match(css, /\.manual-lock-review-actions/);
  assert.match(css, /\.manual-lock-review-main small/);
  assert.match(css, /\.manual-lock-review-main em/);
  assert.match(css, /\.manual-lock-review-main mark/);
  assert.match(css, /\.manual-lock-review-more/);
  assert.match(css, /\.send-focus-hint/);
  assert.match(css, /\.manual-send-block/);
  assert.match(css, /\.manual-send-cancelled/);
  assert.match(css, /\.send-requeue-audit/);
  assert.match(css, /\.send-cancel-audit/);
});

test("web deal flow bulk action only progresses low-value quotes", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  assert.match(sourceSection, /acceptedQuotesWithoutOrder\.filter\(\(quote\) => !isHighValueQuote\(quote\)\)/);
  assert.match(section, /const confirmationCandidates = \[\.\.\.dealFlowConfirmationCandidates\]/);
  assert.match(page, /const dealFlowConfirmationCandidates = orderDrafts\.filter/);
  assert.match(page, /!isHighValueOrder\(order\)[\s\S]*order\.status === "confirmed"/);
  assert.doesNotMatch(section, /quote\.status === "manual_review"[\s\S]*queueQuoteSend/);
});

test("web deal flow queues same-cycle order confirmations after order creation", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  assert.match(page, /const manualRelease = confirmHighValueOrderManualRelease\(order, "confirmation"\)/);
  assert.match(queueQuoteSection, /const manualRelease = confirmHighValueOrderManualRelease\(order, "confirmation"\)/);
  assert.match(page, /queueOrderConfirmation\(order\.id, identityExpectation\(order\), manualRelease\)/);
  assert.match(queueQuoteSection, /queueOrderConfirmation\(order\.id, identityExpectation\(order\), manualRelease\)/);
  assert.match(page, /function confirmHighValueOrderManualRelease\([\s\S]*isHighValueOrder\(order\)[\s\S]*window\.confirm/);
  assert.match(page, /manual_approve_order_confirmation/);
  assert.match(page, /manual_approve_order_followup/);
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
  assert.match(quoteListSection, /const rowPreviewWarnings = rowPreview\?\.warnings \|\| \[\]/);
  assert.match(quoteListSection, /const rowSendRisk = quoteSendBlockReason\(quote, rowPreviewWarnings\)/);
  assert.match(quoteListSection, /quoteDealNextStep\(quote, orderDraft, rowSendRisk\)/);
  assert.match(quoteListSection, /const rowProgressSteps = dealProgressSteps\(quote, orderDraft\)/);
  assert.match(quoteListSection, /selectedImage \? `选中第 \$\{selectedImage\.position \|\| "-"\} 张` : "未选图"/);
  assert.match(quoteListSection, /aria-label="报价成交进度"/);
  assert.match(quoteListSection, /rowProgressSteps\.map\(\(step\) =>/);
  assert.match(quoteListSection, /发送检查 \{rowSendRisk\}/);
  assert.match(quoteListSection, /Boolean\(rowSendRisk\)/);
  assert.match(quoteListSection, /title=\{rowSendRisk \|\| "发送报价"\}/);
  assert.match(quoteListSection, /className="quote-preview quote-row-preview"/);
  assert.match(quoteListSection, /toggleQuoteCenterPreview\(quote\)/);
  assert.match(quoteListSection, /copyQuoteCenterPreviewMessage\(rowPreview\)/);
  assert.match(orderListSection, /orderDealNextStep\(order\)/);
  assert.match(orderListSection, /const linkedQuote = order\.quoteDraft \|\| quotes\.find\(\(quote\) => quote\.id === order\.quoteDraftId\) \|\| null/);
  assert.match(orderListSection, /const rowProgressSteps = linkedQuote \? dealProgressSteps\(linkedQuote, order\) : \[\]/);
  assert.match(orderListSection, /selectedImage \? `选中第 \$\{selectedImage\.position \|\| "-"\} 张` : "未选图"/);
  assert.match(orderListSection, /aria-label="订单成交进度"/);
  assert.match(orderListSection, /rowProgressSteps\.map\(\(step\) =>/);
  assert.match(orderSelectedImageSection, /function snapshotDesignImage/);
  assert.match(orderSelectedImageSection, /snapshotDesignImage\(order\.selectedImageSnapshot\)/);
  assert.match(orderSelectedImageSection, /order\.quoteDraft\?\.designJob\?\.images\?\.find/);
  assert.match(page, /function dealProgressSteps\(quote: QuoteDraft, order: OrderDraft \| null\)/);
  assert.match(page, /quoteSent[\s\S]*paid[\s\S]*orderCreated[\s\S]*processing[\s\S]*fulfilled/);
  assert.match(page, /key: "payment"[\s\S]*current: orderCreated && !paid/);
  assert.match(page, /key: "order"[\s\S]*current: quote\.status === "accepted" && !orderCreated/);
  assert.match(css, /\.deal-progress\.compact/);
  assert.match(page, /className=\{`deal-next-step inline \$\{nextStep\.tone\}`\}/);
  assert.match(quoteListSection, /runQuoteDealNextStep\(quote, orderDraft, rowSendRisk\)/);
  assert.match(orderListSection, /runOrderDealNextStep\(order\)/);
  assert.match(page, /nextStep\.action === "none"/);
  assert.match(css, /\.deal-next-step/);
  assert.match(css, /\.deal-next-step\.inline/);
  assert.match(css, /\.quote-row-preview/);
});

test("web quote center can filter records by next-step actionability", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
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

  assert.match(page, /const dealNextStepFilterOptions = \[/);
  assert.match(page, /const dealProgressFilterOptions = \[/);
  assert.match(page, /const \[dealNextStepFilter, setDealNextStepFilter\] = useState<string>\("all"\)/);
  assert.match(page, /const \[dealProgressFilter, setDealProgressFilter\] = useState<string>\("all"\)/);
  assert.match(page, /function upsertOrderDraftState\(order: OrderDraft \| null \| undefined\)/);
  assert.match(page, /function upsertSendTaskState\(task: SendTask \| null \| undefined\)/);
  assert.match(page, /function upsertQuoteState\(quote: QuoteDraft \| null \| undefined\)/);
  assert.match(api, /export async function createQuote\(id: string, expected: IdentityExpectation = \{\}\): Promise<QuoteDraft>/);
  assert.match(page, /async function quoteActiveJob\(\)[\s\S]*const quote = await createQuote\(activeJob\.id, identityExpectation\(activeJob\)\)[\s\S]*upsertQuoteState\(quote\)/);
  assert.match(page, /async function updateQuoteDraft\([\s\S]*const updated = await updateQuote\(quote\.id, nextPatch\)[\s\S]*upsertQuoteState\(updated\)/);
  assert.match(page, /async function reviseQuoteDraftSelection\([\s\S]*const updated = await reviseQuoteSelection\(quote\.id,[\s\S]*upsertQuoteState\(updated\)/);
  assert.match(page, /async function saveActiveQuoteEdit\([\s\S]*const updated = await updateQuote\(activeQuote\.id,[\s\S]*upsertQuoteState\(updated\)/);
  assert.match(page, /async function queueQuoteDraft\([\s\S]*const queued = await queueQuoteSend\(quote\.id, identityExpectation\(quote\)\)[\s\S]*upsertQuoteState\(queued\.quote\)[\s\S]*upsertSendTaskState\(queued\.sendTask\)/);
  assert.match(page, /async function queueQuoteAfterPreviewCheck\([\s\S]*const queued = await queueQuoteSend\(quote\.id, identityExpectation\(quote\)\)[\s\S]*upsertQuoteState\(queued\.quote\)[\s\S]*upsertSendTaskState\(queued\.sendTask\)/);
  assert.match(page, /async function createOrderDraft\(quote: QuoteDraft\)[\s\S]*const orderDraft = await createOrderDraftFromQuote\(quote\.id, identityExpectation\(quote\)\)[\s\S]*upsertOrderDraftState\(orderDraft\)/);
  assert.match(page, /async function updateOrderDraftStatus\([\s\S]*const updated = await updateOrderDraft\(order\.id,[\s\S]*upsertOrderDraftState\(updated\)/);
  assert.match(page, /async function queueOrderDraftConfirmation\([\s\S]*const result = await queueOrderConfirmation\(order\.id, identityExpectation\(order\), manualRelease\)[\s\S]*upsertOrderDraftState\(result\.orderDraft\)[\s\S]*upsertSendTaskState\(result\.sendTask\)/);
  assert.match(page, /async function queueOrderFollowupDraft\([\s\S]*const result = await queueOrderFollowup\(order\.id, type, identityExpectation\(order\), manualRelease\)[\s\S]*upsertOrderDraftState\(result\.orderDraft\)[\s\S]*upsertSendTaskState\(result\.sendTask\)/);
  assert.match(page, /async function queueOrderConfirmationAfterPreviewCheck\([\s\S]*const confirmation = await queueOrderConfirmation\(order\.id, identityExpectation\(order\), manualRelease\)[\s\S]*upsertOrderDraftState\(confirmation\.orderDraft\)[\s\S]*upsertSendTaskState\(confirmation\.sendTask\)/);
  assert.match(quoteFilterSection, /quoteDealNextStep\(quote, orderDraft, quoteSendBlockReason\(quote\)\)/);
  assert.match(quoteFilterSection, /orderDealNextStep\(order\)/);
  assert.match(quoteFilterSection, /matchesDealProgressFilter\(dealProgressSteps\(quote, orderDraft\), dealProgressFilter\)/);
  assert.match(quoteFilterSection, /const linkedQuote = order\.quoteDraft \|\| quotes\.find\(\(quote\) => quote\.id === order\.quoteDraftId\) \|\| null/);
  assert.match(quoteFilterSection, /matchesDealProgressFilter\(dealProgressSteps\(linkedQuote, order\), dealProgressFilter\)/);
  assert.match(quoteFilterSection, /matchesDealNextStepFilter\(step, dealNextStepFilter, quote\.status\)/);
  assert.match(quoteFilterSection, /matchesDealNextStepFilter\(step, dealNextStepFilter, order\.status\)/);
  assert.match(helperSection, /function matchesDealProgressFilter/);
  assert.match(helperSection, /filter === "finish"[\s\S]*step\.state === "done" \|\| step\.state === "current"/);
  assert.match(helperSection, /filter === "actionable"[\s\S]*step\.action !== "none"/);
  assert.match(helperSection, /filter === "blocked"[\s\S]*step\.action === "none"/);
  assert.match(controlsSection, /renderFilterSegment\("成交阶段", dealProgressFilterOptions, dealProgressFilter, setDealProgressFilter\)/);
  assert.match(controlsSection, /renderFilterSegment\("下一步", dealNextStepFilterOptions, dealNextStepFilter, setDealNextStepFilter\)/);
  assert.match(page, /setDealProgressFilter\("confirm"\)/);
  assert.match(page, /setDealProgressFilter\("payment"\)/);
  assert.match(page, /setDealProgressFilter\("order"\)/);
  assert.match(page, /const quoteNextStepCounts = calculateDealNextStepCounts\(quotes, orderDrafts\)/);
  assert.match(page, /const orderNextStepCounts = calculateOrderNextStepCounts\(orderDrafts\)/);
  assert.match(page, /className="deal-next-summary"/);
  assert.match(page, /setDealNextStepFilter\(item\.filter\)/);
  assert.match(page, /setDealNextStepFilter\("all"\)/);
  assert.match(page, /function calculateDealNextStepCounts\(quotes: QuoteDraft\[\], orders: OrderDraft\[\]\)/);
  assert.match(page, /function calculateOrderNextStepCounts\(orders: OrderDraft\[\]\)/);
  assert.match(page, /async function runVisibleActionableDealNextSteps\(\)/);
  assert.match(page, /actionableDealNextStepItems\.slice\(0, 3\)/);
  assert.match(page, /window\.confirm\(`将按顺序执行前 \$\{items\.length\} 个可执行成交事项/);
  assert.match(page, /item\.action === "queue_quote" && item\.quote/);
  assert.match(page, /await queueQuoteAfterPreviewCheck\(item\.quote\)/);
  assert.match(page, /const updatedQuote = await updateQuote\(item\.quote\.id, \{ \.\.\.identityExpectation\(item\.quote\), status: "accepted" \}\)[\s\S]*upsertQuoteState\(updatedQuote\)[\s\S]*const orderDraft = await createOrderDraftFromQuote\(item\.quote\.id, identityExpectation\(item\.quote\)\)[\s\S]*upsertOrderDraftState\(orderDraft\)/);
  assert.match(page, /item\.action === "queue_order_confirmation" && item\.order/);
  assert.match(page, /queueOrderConfirmationAfterPreviewCheck\(item\.order\)/);
  assert.match(page, /const updated = await updateOrderDraft\(item\.order\.id, \{ \.\.\.identityExpectation\(item\.order\), status: "processing" \}\)[\s\S]*upsertOrderDraftState\(updated\)/);
  assert.match(page, /const result = await queueOrderFollowup\(item\.order\.id, "delivery", identityExpectation\(item\.order\)\)[\s\S]*upsertOrderDraftState\(result\.orderDraft\)[\s\S]*upsertSendTaskState\(result\.sendTask\)/);
  assert.match(page, /summary\.skipped \+= 1/);
  assert.match(page, /const dealNextStepInsightItems = \[/);
  assert.match(page, /const actionableDealNextStepItems = dealNextStepInsightItems\.filter\(\(item\) => item\.action !== "none"\)/);
  assert.match(page, /const firstActionableDealNextStep = actionableDealNextStepItems\[0\] \|\| null/);
  assert.match(page, /quoteDealNextStep\(quote, orderDraft, quoteSendBlockReason\(quote\)\)/);
  assert.match(page, /orderDealNextStep\(order\)/);
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
  assert.match(css, /\.deal-attention-list/);
  assert.match(css, /\.deal-attention-grid/);
  assert.match(css, /\.deal-attention-item/);
  assert.match(css, /\.deal-attention-main/);
  assert.match(css, /\.deal-attention-head-actions/);
  assert.match(css, /\.deal-attention-head-actions \.ghost/);
  assert.match(css, /\.deal-attention-actions/);
});

test("web active quote panel uses guarded next-step actions", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
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

  assert.match(activePanelSection, /quoteDealNextStep\(activeQuote, activeOrderDraft, activeQuoteSendRisk\)/);
  assert.match(renderSection, /onClick=\{runActiveDealNextStep\}/);
  assert.match(renderSection, /activeDealNextStep\.action === "none"/);
  assert.match(activeRunSection, /runOrderDealNextStep\(activeOrderDraft\)/);
  assert.match(activeRunSection, /runQuoteDealNextStep\(activeQuote, activeOrderDraft, activeQuoteSendRisk\)/);
  assert.match(quoteRunSection, /step\.action === "queue_quote"[\s\S]*queueQuoteDraft\(quote\)/);
  assert.match(quoteRunSection, /step\.action === "confirm_quote_create_order"[\s\S]*updateQuote\(quote\.id, \{ \.\.\.identityExpectation\(quote\), status: "accepted" \}\)/);
  assert.match(quoteRunSection, /step\.action === "confirm_quote_create_order"[\s\S]*createOrderDraftFromQuote\(quote\.id, identityExpectation\(quote\)\)/);
  assert.match(orderRunSection, /step\.action === "queue_order_confirmation"[\s\S]*queueOrderDraftConfirmation\(order\)/);
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
  assert.match(validationSection, /data\.taskId/);
  assert.match(validationSection, /data\.wechatAccountId/);
  assert.match(validationSection, /data\.conversationId/);
  assert.match(validationSection, /target\.wechatAccountId/);
  assert.match(validationSection, /sendPlanTarget\.wechatAccountId/);
  assert.match(validationSection, /constraints\.singleAccountLock === true/);
  assert.match(validationSection, /constraints\.doNotMarkSentWithoutAck === true/);
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
  assert.match(scanOpsSection, /findPendingBridgeDispatchForTask\(task, pendingBridgeAttempt\)/);
  assert.match(scanOpsSection, /dispatchState\?\.expired/);
  assert.match(scanOpsSection, /recovery: "bridge_dispatch_expired"/);
  assert.match(scanOpsSection, /dispatchFileName: dispatchState\.fileName/);
  assert.match(scanOpsSection, /bridgeDispatchExpired: bridgeDispatchExpired\.length/);
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
  assert.ok(
    recoverySection.indexOf("validateBridgeAckOutboxPayload") < recoverySection.indexOf("updateSendTask"),
    "rejected sent ack recovery must validate the outbox body before failing the task",
  );
});
