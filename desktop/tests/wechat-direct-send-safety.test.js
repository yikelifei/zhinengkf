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

  assert.match(statusSection, /const runtimeKeys = new Set\(\["window_observer", "windows_bridge"\]\)/);
  assert.match(statusSection, /const sendAdapterKeys = new Set\(\["safe_send_queue"\]\)/);
  assert.match(statusSection, /return "needs_send_adapter"/);
  assert.match(service, /needsSendAdapter/);
  assert.match(api, /"needs_send_adapter"/);
  assert.match(page, /needs_send_adapter:\s*"待发送器"/);
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
  assert.match(verifyPaymentProofSection, /verifyQuotePaymentProofAndQueueConfirmation\([\s\S]*quote\.id,[\s\S]*paymentStatus,[\s\S]*identityExpectation\(quote\)/);
  assert.match(verifyPaymentProofSection, /setQuotes\(\(items\) =>[\s\S]*item\.id === result\.quote\.id[\s\S]*\[result\.quote, \.\.\.items\]/);
  assert.match(verifyPaymentProofSection, /setOrderDrafts\(\(items\) =>[\s\S]*item\.id === result\.orderDraft\.id[\s\S]*\[result\.orderDraft, \.\.\.items\]/);
  assert.match(verifyPaymentProofSection, /setSendTasks\(\(items\) =>[\s\S]*item\.id === result\.sendTask\.id[\s\S]*\[result\.sendTask, \.\.\.items\]/);
  assert.match(verifyPaymentProofSection, /setMessage\(`\$\{paymentLabel\}已核验，订单确认已进入微信安全发送队列。`\)/);
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
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const identityHelper = readProjectFile("apps/api/src/shared/identity-expectation.ts");

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

  assert.match(api, /scanSendOperations\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /postJson<Record<string, unknown>>\("\/wechat\/send-tasks\/scan-ops", filters\)/);
  assert.match(api, /processSafeSendQueue\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /postJson<SafeSendQueueResult>\("\/wechat\/send-tasks\/process-safe-queue", filters\)/);
  assert.match(page, /scanSendOperations\(activeIdentityFilters\(\)\)/);
  assert.match(page, /processSafeSendQueue\(activeIdentityFilters\(\)\)/);
  assert.match(controller, /scanSendOperations\(@Body\(\) payload: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(controller, /return this\.wechat\.scanSendOperations\(payload \|\| \{\}\)/);
  assert.match(controller, /processSafeSendQueue\([\s\S]*wechatAccountId\?: string; conversationId\?: string; customerId\?: string/);
  assert.match(service, /scanSendOperations\(filter: IdentityFilter = \{\}\)/);
  assert.match(service, /const tasks = this\.localStore\.listSendTasks\(filter\)/);
  assert.match(service, /processSafeSendQueue\(params: \{ adapter\?: string; limit\?: number; automationOnly\?: boolean \} & IdentityFilter = \{\}\)/);
  assert.match(service, /listSendTasks\(\{[\s\S]*wechatAccountId: params\.wechatAccountId,[\s\S]*conversationId: params\.conversationId,[\s\S]*customerId: params\.customerId,[\s\S]*\}\)/);
});

  test("bridge outbox and status are scoped by selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");

  assert.match(api, /export async function getBridgeOutbox\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/wechat\/bridge\/outbox\$\{identityQuery\(filters\)\}/);
  assert.match(api, /export async function getBridgeStatus\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/wechat\/bridge\/status\$\{identityQuery\(filters\)\}/);
  assert.match(page, /getBridgeOutbox\(identityFilters\)/);
  assert.match(page, /getBridgeStatus\(identityFilters\)/);
  assert.match(page, /getBridgeOutbox\([\s\S]*wechatAccountId: conversation\.wechatAccountId[\s\S]*conversationId: conversation\.id[\s\S]*customerId: conversation\.customerId/);
  assert.match(controller, /listBridgeOutbox\([\s\S]*@Query\("wechatAccountId"\) wechatAccountId\?: string[\s\S]*return this\.wechat\.listBridgeOutbox\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(controller, /getBridgeStatus\([\s\S]*@Query\("wechatAccountId"\) wechatAccountId\?: string[\s\S]*return this\.wechat\.getBridgeStatus\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(service, /type IdentityFilter = \{/);
  assert.match(service, /getBridgeStatus\(filter: IdentityFilter = \{\}\)/);
  assert.match(service, /const outbox = this\.listBridgeOutbox\(filter\)/);
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
  assert.match(page, /const highValueManualQueueItems = \[/);
  assert.match(page, /job\.status === "manual_review"/);
  assert.match(page, /isHighValueDesignJob\(job\) && \["completed", "quick_confirm", "timeout", "failed"\]\.includes\(job\.status\)/);
  assert.match(page, /reason: highValueDesignReason\(job\)/);
  assert.match(page, /nextAction: step\.nextAction/);
  assert.match(page, /!orderDraftByQuoteId\.has\(quote\.id\) && \(quote\.status === "manual_review" \|\| isHighValueQuote\(quote\)\)/);
  assert.match(page, /reason: highValueQuoteReason\(quote\)/);
  assert.match(page, /const highValueReviewOrderDrafts = reviewOrderDrafts\.filter\(\(order\) => isHighValueOrder\(order\) && !\["fulfilled", "cancelled"\]\.includes\(order\.status\)\)/);
  assert.match(page, /\.\.\.highValueReviewOrderDrafts/);
  assert.match(page, /reason: highValueOrderReason\(order\)/);
  assert.match(page, /const action = highValueOrderManualPrimaryAction\(order\)/);
  assert.match(page, /primaryLabel: action\.label/);
  assert.match(page, /action\.type === "queue_confirmation"[\s\S]*reviewOrderDraft\(order, "approve_confirmation"\)/);
  assert.match(page, /action\.type === "queue_delivery"[\s\S]*reviewOrderDraft\(order, "approve_followup", "delivery"\)/);
  assert.match(page, /highValueManualQueueItems\[0\]\?\.run\(\)/);
  assert.match(page, /setReviewWorkbenchView\("order"\)/);
  assert.match(page, /label="待审订单"/);
  assert.match(page, /highValueReviewOrderDrafts\.length/);
  assert.match(page, /highValueReviewOrderDrafts\.slice\(0, 2\)\.map/);
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
  assert.match(page, /latestHighValueOrderManualNote\(order\.customerNotes\)/);
  assert.match(page, /recordHighValueOrderManualFollowup\(order\)/);
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
  assert.match(ordersController, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(ordersController, /this\.orders\.confirmationPreview\(id, \{[\s\S]*expectedWechatAccountId: wechatAccountId,[\s\S]*expectedConversationId: conversationId,[\s\S]*expectedCustomerId: customerId/);
  assert.match(ordersService, /async confirmationPreview\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(ordersService, /assertExpectedIdentity\(order, expected, "order draft"\)/);
  assert.match(quoteListSection, /const rowPreviewWarnings = rowPreview\?\.warnings \|\| \[\]/);
  assert.match(quoteListSection, /const rowSendRisk = quoteSendBlockReason\(quote, rowPreviewWarnings\)/);
  assert.match(quoteListSection, /quoteDealNextStep\(quote, orderDraft, rowSendRisk\)/);
  assert.match(quoteListSection, /发送检查 \{rowSendRisk\}/);
  assert.match(quoteListSection, /Boolean\(rowSendRisk\)/);
  assert.match(quoteListSection, /title=\{rowSendRisk \|\| "发送报价"\}/);
  assert.match(quoteListSection, /className="quote-preview quote-row-preview"/);
  assert.match(quoteListSection, /toggleQuoteCenterPreview\(quote\)/);
  assert.match(quoteListSection, /copyQuoteCenterPreviewMessage\(rowPreview\)/);
  assert.match(orderListSection, /orderDealNextStep\(order\)/);
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
  assert.match(page, /const \[dealNextStepFilter, setDealNextStepFilter\] = useState<string>\("all"\)/);
  assert.match(quoteFilterSection, /quoteDealNextStep\(quote, orderDraft, quoteSendBlockReason\(quote\)\)/);
  assert.match(quoteFilterSection, /orderDealNextStep\(order\)/);
  assert.match(quoteFilterSection, /matchesDealNextStepFilter\(step, dealNextStepFilter, quote\.status\)/);
  assert.match(quoteFilterSection, /matchesDealNextStepFilter\(step, dealNextStepFilter, order\.status\)/);
  assert.match(helperSection, /filter === "actionable"[\s\S]*step\.action !== "none"/);
  assert.match(helperSection, /filter === "blocked"[\s\S]*step\.action === "none"/);
  assert.match(controlsSection, /renderFilterSegment\("下一步", dealNextStepFilterOptions, dealNextStepFilter, setDealNextStepFilter\)/);
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
  assert.match(page, /createOrderDraftFromQuote\(item\.quote\.id, identityExpectation\(item\.quote\)\)/);
  assert.match(page, /item\.action === "queue_order_confirmation" && item\.order/);
  assert.match(page, /queueOrderConfirmationAfterPreviewCheck\(item\.order\)/);
  assert.match(page, /updateOrderDraft\(item\.order\.id, \{ \.\.\.identityExpectation\(item\.order\), status: "processing" \}\)/);
  assert.match(page, /queueOrderFollowup\(item\.order\.id, "delivery", identityExpectation\(item\.order\)\)/);
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
