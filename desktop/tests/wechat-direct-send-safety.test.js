"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
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

test("bridge outbox list exposes preview instead of raw outbox data", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const listSection = service.slice(
    service.indexOf("  listBridgeOutbox()"),
    service.indexOf("  private buildBridgeOutboxListItem"),
  );
  const itemSection = service.slice(
    service.indexOf("  private buildBridgeOutboxListItem"),
    service.indexOf("  private buildBridgeInboxListItem"),
  );

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
  const statusSection = service.slice(
    service.indexOf("  getBridgeStatus()"),
    service.indexOf("  listBridgeOutbox()"),
  );
  const scanSection = service.slice(
    service.indexOf("  scanBridgeInbox()"),
    service.indexOf("  scanSendOperations()"),
  );
  const inboxSummarySection = service.slice(
    service.indexOf("  private buildBridgeInboxListItem"),
    service.indexOf("  scanBridgeInbox()"),
  );

  assert.match(statusSection, /listBridgeInbox\(\)\.map\(\(entry\) => this\.buildBridgeInboxListItem\(entry\)\)/);
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
  assert.match(toggleSection, /window\.confirm/);
  assert.match(toggleSection, /恢复自动化判断/);
  assert.match(toggleSection, /已取消解除人工接管/);
  assert.match(toggleSection, /manual_resolution_from_workbench/);
});

test("web client confirms before releasing manual lock and requeueing send task", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const releaseAndRequeueSection = page.slice(
    page.indexOf("async function releaseManualLockAndRequeueTask"),
    page.indexOf("function isSendTaskConversationLocked"),
  );
  const sendTaskSection = page.slice(
    page.indexOf("<div className=\"send-task-list\">"),
    page.indexOf("<section className=\"panel review-panel\""),
  );

  assert.match(releaseAndRequeueSection, /isSendTaskConversationLocked\(task\)/);
  assert.match(releaseAndRequeueSection, /window\.confirm/);
  assert.match(releaseAndRequeueSection, /解除人工接管后重新排队这条发送任务/);
  assert.match(releaseAndRequeueSection, /manual_resolution_before_send_requeue/);
  assert.match(releaseAndRequeueSection, /await setConversationManualLock[\s\S]*locked: false[\s\S]*await requeueSendTask\(task\.id\)/);
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
  const reviewSection = page.slice(
    page.indexOf("<section className=\"panel\" id=\"review-center\">"),
    page.indexOf("<section className=\"quote-grid\""),
  );

  assert.match(page, /const manualLockedConversations = conversations\.filter/);
  assert.match(page, /const manualLockLogByConversationId = useMemo/);
  assert.match(page, /log\.targetType !== "conversation" \|\| log\.decision !== "manual_lock"/);
  assert.match(page, /const manualLockBlockedSendCountByConversationId = useMemo/);
  assert.match(page, /task\.guardSnapshot\?\.blockedByManualLock/);
  assert.match(page, /const activeConversationSendTasks = activeConversationId/);
  assert.match(page, /activeConversationSendTasks[\s\S]*task\.conversationId === activeConversationId/);
  assert.match(page, /const activeConversationSendTaskCount = .*activeConversationSendTasks\.length/);
  assert.match(page, /\.\.\.activeConversationSendTasks/);
  assert.match(page, /latestSendTasks[\s\S]*task\.conversationId !== activeConversationId/);
  assert.match(page, /const prioritizedManualLockedConversations = useMemo/);
  assert.match(page, /Date\.parse\(manualLockLogByConversationId\.get\(left\.id\)\?\.createdAt/);
  assert.match(page, /const hiddenManualLockedConversationCount = Math\.max/);
  assert.match(reviewSection, /label="人工接管"/);
  assert.match(reviewSection, /manual-lock-review-list/);
  assert.match(reviewSection, /prioritizedManualLockedConversations\.slice\(0, 5\)/);
  assert.match(reviewSection, /manualLockLogByConversationId\.get\(conversation\.id\)/);
  assert.match(reviewSection, /manualLockBlockedSendCountByConversationId\.get\(conversation\.id\)/);
  assert.match(reviewSection, /reviewLogSummary\(manualLockLog\)/);
  assert.match(reviewSection, /blockedSendCount/);
  assert.match(reviewSection, /formatDateTime\(manualLockLog\.createdAt\)/);
  assert.match(reviewSection, /hiddenManualLockedConversationCount/);
  assert.match(reviewSection, /setActiveConversationId\(conversation\.id\)/);
  assert.match(reviewSection, /scrollToWorkspaceSection\("send-center"\)/);
  assert.match(reviewSection, /toggleConversationManualLock\(conversation, false\)/);
  assert.match(page, /className="send-focus-hint"/);
  assert.match(css, /\.manual-lock-review-item/);
  assert.match(css, /\.manual-lock-review-actions/);
  assert.match(css, /\.manual-lock-review-main small/);
  assert.match(css, /\.manual-lock-review-main em/);
  assert.match(css, /\.manual-lock-review-main mark/);
  assert.match(css, /\.manual-lock-review-more/);
  assert.match(css, /\.send-focus-hint/);
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

  const createIndex = section.indexOf("const orderDraft = await createOrderDraftFromQuote(quote.id)");
  const pushIndex = section.indexOf("confirmationCandidates.push(orderDraft)");
  const queueIndex = section.indexOf("await queueOrderConfirmation(order.id)");

  assert.ok(createIndex > 0);
  assert.ok(pushIndex > createIndex);
  assert.ok(queueIndex > pushIndex);
  assert.match(section, /for \(const order of dedupeOrdersById\(confirmationCandidates\)\)/);
});

test("web quote center renders guarded next-step guidance", () => {
  const page = readProjectFile("apps/web/src/app/page.tsx");
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
  const orderListStart = page.indexOf("filteredOrderDrafts.map");
  const orderListSection = page.slice(
    orderListStart,
    page.indexOf("<div className=\"empty empty-cta small\"", orderListStart),
  );

  assert.match(quoteHelper, /isHighValueQuote\(quote\)/);
  assert.match(orderHelper, /isHighValueOrder\(order\)/);
  assert.match(quoteHelper, /sendRisk/);
  assert.match(orderHelper, /hasActiveOrderConfirmationTask\(order\)/);
  assert.match(quoteListSection, /quoteDealNextStep\(quote, orderDraft, sendRisk\)/);
  assert.match(orderListSection, /orderDealNextStep\(order\)/);
  assert.match(page, /className=\{`deal-next-step inline \$\{nextStep\.tone\}`\}/);
  assert.match(quoteListSection, /runQuoteDealNextStep\(quote, orderDraft, sendRisk\)/);
  assert.match(orderListSection, /runOrderDealNextStep\(order\)/);
  assert.match(page, /nextStep\.action === "none"/);
  assert.match(css, /\.deal-next-step/);
  assert.match(css, /\.deal-next-step\.inline/);
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
  assert.match(page, /const dealNextStepInsightItems = \[/);
  assert.match(page, /quoteDealNextStep\(quote, orderDraft, quoteSendBlockReason\(quote\)\)/);
  assert.match(page, /orderDealNextStep\(order\)/);
  assert.match(page, /className="deal-attention-list"/);
  assert.match(page, /aria-label="成交优先处理提醒"/);
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
  assert.match(quoteRunSection, /step\.action === "confirm_quote_create_order"[\s\S]*updateQuote\(quote\.id, \{ status: "accepted" \}\)/);
  assert.match(quoteRunSection, /step\.action === "confirm_quote_create_order"[\s\S]*createOrderDraftFromQuote\(quote\.id\)/);
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
    service.indexOf("  async scanSendOperations()"),
    service.indexOf("  async processSafeSendQueue("),
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
