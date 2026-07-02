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
  const reviewSection = page.slice(
    page.indexOf("<section className=\"panel\" id=\"review-center\""),
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
  assert.match(focusNoticeSection, /focusQuoteCenter\(quoteDraftId\)/);
  assert.match(focusNoticeSection, /setActiveId\(designJobId\)/);
  assert.match(focusNoticeSection, /await focusConversation\(conversationId, "conversation-center"\)/);
  assert.match(noticeSection, /className="notice-main"/);
  assert.match(noticeSection, /noticeTargetSummary\(notice\)/);
  assert.match(noticeSection, /focusNoticeTarget\(notice\)/);
  assert.match(noticeSection, /noticeHasTarget\(notice\)/);
  assert.match(page, /function noticeTargetSummary\(notice: NotificationItem\)/);
  assert.match(page, /inboundSelectionReasonLabel\(reason\)/);
  assert.match(page, /客户想选图 \$\{target\.selectedImageId\}/);
  assert.match(css, /\.notice-main/);
  assert.match(css, /\.notice-target-actions/);
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
  assert.match(orderService, /assertExpectedIdentity\(quote, expected, "quote draft"\)/);
  assert.match(orderService, /assertExpectedIdentity\(current, patch, "order draft"\)/);
  assert.match(wechatService, /assertExpectedIdentity\(order, payload, "order draft"\)/);
  assert.match(wechatService, /assertExpectedIdentity\(taskBeforeValidation, params, "send task"\)/);
  assert.match(wechatService, /assertExpectedIdentity\(task, payload, "send task"\)/);
  assert.match(page, /executeSendTask\(task\.id, identityExpectation\(task\)\)/);
  assert.match(page, /queueQuoteSend\(quote\.id, identityExpectation\(quote\)\)/);
  assert.match(page, /createOrderDraftFromQuote\(quote\.id, identityExpectation\(quote\)\)/);
  assert.match(page, /queueOrderConfirmation\(order\.id, identityExpectation\(order\)\)/);
  assert.match(page, /queueOrderFollowup\(order\.id, type, identityExpectation\(order\)\)/);
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
  assert.match(service, /return this\.localStore\.listSendAttempts\(filter\)/);
  assert.match(store, /listSendAttempts\(filter: \{ sendTaskId\?: string; limit\?: number \} & IdentityListFilter = \{\}\)/);
  assert.match(store, /\.filter\(\(attempt\) => this\.matchesIdentityFilter\(attempt, filter\)\)/);
  assert.match(store, /const sendTask = record\?\.sendTask \|\| null/);
  assert.match(store, /sendTask\?\.conversationId/);
  assert.match(store, /sendTask\?\.wechatAccountId/);
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
  assert.match(api, /\/reviews\$\{identityQuery\(filters\)\}/);
  assert.match(page, /getNotifications\(false, identityFilters\)/);
  assert.match(page, /getReviewCenter\(identityFilters\)/);
  assert.match(notificationsController, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(notificationsController, /conversationId/);
  assert.match(notificationsController, /customerId/);
  assert.match(notificationsService, /list\(options: \{ unreadOnly\?: boolean; limit\?: number; wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(reviewsController, /@Query\("wechatAccountId"\) wechatAccountId\?: string/);
  assert.match(reviewsController, /return this\.reviews\.list\(\{ wechatAccountId, conversationId, customerId \}\)/);
  assert.match(reviewsService, /async list\(filter: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(reviewsService, /\.listDesignJobs\(filter\)/);
  assert.match(reviewsService, /\.listQuoteDrafts\(filter\)/);
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
  assert.match(page, /reviewDesignJob\(job\.id, \{[\s\S]*\.\.\.identityExpectation\(job\),[\s\S]*decision,/);
  assert.match(page, /reviewQuote\(quote\.id, \{[\s\S]*\.\.\.identityExpectation\(quote\),[\s\S]*decision,/);
  assert.match(controller, /ExpectedIdentityPayload/);
  assert.match(controller, /reviewDesignJob\([\s\S]*\} & ExpectedIdentityPayload/);
  assert.match(controller, /reviewQuote\([\s\S]*\} & ExpectedIdentityPayload/);
  assert.match(service, /ExpectedIdentityPayload, assertExpectedIdentity/);
  assert.match(service, /type ReviewPayload = ExpectedIdentityPayload & \{/);
  assert.match(service, /assertExpectedIdentity\(job, payload, "design job"\)/);
  assert.match(service, /assertExpectedIdentity\(quote, payload, "quote draft"\)/);
});

test("design job manual actions carry and enforce expected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const controller = readProjectFile("apps/api/src/design-jobs/design-jobs.controller.ts");
  const service = readProjectFile("apps/api/src/design-jobs/design-jobs.service.ts");

  assert.match(api, /submitDesignJob\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /preflightDesignJob\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /pollDesignJob\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /retryDesignJob\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /quickConfirmSend\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /cancelDesignJob\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /createQuote\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /markManualReview\(id: string, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /selectDesignImage\(id: string, input: SelectImagePayload, expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /requestDesignRevision\(id: string, payload: \{[\s\S]*\} & IdentityExpectation\)/);
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
  assert.match(controller, /ExpectedIdentityPayload/);
  assert.match(controller, /submit\(@Param\("id"\) id: string, @Body\(\) body: ExpectedIdentityPayload = \{\}\)/);
  assert.match(controller, /quickConfirmSend\(@Param\("id"\) id: string, @Body\(\) body: ExpectedIdentityPayload = \{\}\)/);
  assert.match(controller, /requestRevision\(@Param\("id"\) id: string, @Body\(\) payload: CreateDesignRevisionPayload & ExpectedIdentityPayload\)/);
  assert.match(service, /ExpectedIdentityPayload, assertExpectedIdentity/);
  assert.match(service, /async submit\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(service, /async quickConfirmAndQueueSend\([\s\S]*ExpectedIdentityPayload = \{\}/);
  assert.match(service, /async requestRevision\(id: string, payload: CreateDesignRevisionPayload & ExpectedIdentityPayload\)/);
  assert.match(service, /private async retryDesignJob\([\s\S]*expected: ExpectedIdentityPayload = \{\}/);
  assert.match(service, /assertExpectedIdentity\(job, expected, "design job"\)/);
  assert.match(service, /assertExpectedIdentity\(job, payload, "design job"\)/);
  assert.match(service, /assertExpectedIdentity\(job, options, "design job"\)/);
});

test("design assets and conversation manual locks carry expected identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const designController = readProjectFile("apps/api/src/design-jobs/design-jobs.controller.ts");
  const designService = readProjectFile("apps/api/src/design-jobs/design-jobs.service.ts");
  const wechatController = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");

  assert.match(api, /attachDesignJobAssets\(id: string, assetIds: string\[\], expected: IdentityExpectation = \{\}\)/);
  assert.match(api, /postJson<DesignJob>\(`\/design-jobs\/\$\{id\}\/assets`, \{ \.\.\.expected, assetIds \}\)/);
  assert.match(api, /setConversationManualLock\([\s\S]*\} & IdentityExpectation/);
  assert.match(api, /createDemoSendTask\(conversationId: string, wechatAccountId\?: string\)/);
  assert.match(page, /function conversationIdentityExpectation\(conversation: Conversation\)/);
  assert.match(page, /expectedWechatAccountId: conversation\.wechatAccountId/);
  assert.match(page, /expectedConversationId: conversation\.id/);
  assert.match(page, /expectedCustomerId: conversation\.customerId/);
  assert.match(page, /attachDesignJobAssets\(activeJob\.id, selectedAssetIds, identityExpectation\(activeJob\)\)/);
  assert.match(page, /createDemoSendTask\(targetConversation\.id, targetConversation\.wechatAccountId\)/);
  assert.match(page, /setConversationManualLock\(conversation\.id, \{[\s\S]*\.\.\.conversationIdentityExpectation\(conversation\)/);
  assert.match(designController, /attachAssets\(@Param\("id"\) id: string, @Body\(\) body: \{ assetIds: string\[\] \} & ExpectedIdentityPayload\)/);
  assert.match(designController, /this\.designJobs\.attachAssets\(id, body\?\.assetIds \|\| \[\], body \|\| \{\}\)/);
  assert.match(designService, /async attachAssets\(id: string, assetIds: string\[\], expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(designService, /assertExpectedIdentity\(job, expected, "design job"\)/);
  assert.match(designService, /assertExpectedIdentity\(designJob, expected, "design job"\)/);
  assert.match(wechatController, /setConversationManualLock\([\s\S]*\} & ExpectedIdentityPayload/);
  assert.match(wechatService, /setConversationManualLock\([\s\S]*\} & ExpectedIdentityPayload = \{\}/);
  assert.match(wechatService, /assertExpectedIdentity\(\{ \.\.\.before, conversationId: before\.id \}, payload, "conversation"\)/);
  assert.match(wechatService, /this\.localStore\.listConversations\(payload\.wechatAccountId\)/);
});

test("routing decisions and chat imports stay bound to selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const page = readProjectFile("apps/web/src/app/page.tsx");
  const routingController = readProjectFile("apps/api/src/routing/routing.controller.ts");
  const routingService = readProjectFile("apps/api/src/routing/routing.service.ts");
  const wechatController = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");

  assert.match(api, /evaluateRoute\(text: string, filters: IdentityFilters = \{\}\)/);
  assert.match(api, /postJson<RouteEvaluation>\("\/routing\/evaluate", \{ channel: "wechat", \.\.\.filters, text \}\)/);
  assert.match(api, /correctRouteEvaluation\([\s\S]*\} & IdentityExpectation/);
  assert.match(api, /processInboundMessage\(payload: \{[\s\S]*customerId\?: string/);
  assert.match(page, /importChatTranscript\(\{[\s\S]*\.\.\.activeIdentityFilters\(\),[\s\S]*text: chatText/);
  assert.match(page, /evaluateRoute\(routeText, activeIdentityFilters\(\)\)/);
  assert.match(page, /correctRouteEvaluation\(route\.id, \{[\s\S]*\.\.\.identityExpectation\(route\),[\s\S]*agentKey: agent\.key/);
  assert.match(page, /processInboundMessage\(\{[\s\S]*wechatAccountId: conversation\.wechatAccountId,[\s\S]*conversationId: conversation\.id,[\s\S]*customerId: conversation\.customerId/);
  assert.match(routingController, /wechatAccountId\?: string/);
  assert.match(routingController, /ExpectedIdentityPayload/);
  assert.match(routingService, /ExpectedIdentityPayload, assertExpectedIdentity/);
  assert.match(routingService, /wechatAccountId\?: string/);
  assert.match(routingService, /const route = this\.localStore\.listRouteEvaluations\(\)\.find/);
  assert.match(routingService, /assertExpectedIdentity\(route, payload, "route evaluation"\)/);
  assert.match(wechatController, /customerId\?: string/);
  assert.match(wechatService, /customerId\?: string/);
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
  assert.match(reviewSection, /label="人工接管"/);
  assert.match(reviewSection, /manual-lock-review-list/);
  assert.match(reviewSection, /prioritizedManualLockedConversations\.slice\(0, 5\)/);
  assert.match(reviewSection, /manualLockLogByConversationId\.get\(conversation\.id\)/);
  assert.match(reviewSection, /manualLockBlockedSendCountByConversationId\.get\(conversation\.id\)/);
  assert.match(reviewSection, /reviewLogSummary\(manualLockLog\)/);
  assert.match(reviewSection, /blockedSendCount/);
  assert.match(reviewSection, /formatDateTime\(manualLockLog\.createdAt\)/);
  assert.match(reviewSection, /hiddenManualLockedConversationCount/);
  assert.match(reviewSection, /focusConversation\(conversation\.id, "conversation-center"\)/);
  assert.match(reviewSection, /focusConversation\(conversation\.id, "send-center"\)/);
  assert.match(reviewSection, /toggleConversationManualLock\(conversation, false\)/);
  assert.match(page, /activeConversationId && visibleActiveConversationSendTaskCount/);
  assert.match(page, /className="send-focus-hint"/);
  assert.match(css, /\.manual-lock-review-item/);
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
  const queueIndex = section.indexOf("await queueOrderConfirmation(order.id, identityExpectation(order))");

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
  assert.match(queueQuoteSection, /getQuotePreview\(quote\.id\)/);
  assert.match(queueQuoteSection, /async function checkQuoteReadyForSend\(quote: QuoteDraft\)/);
  assert.match(queueQuoteSection, /async function queueQuoteAfterPreviewCheck\(quote: QuoteDraft\)/);
  assert.match(queueQuoteSection, /报价话术预览生成失败/);
  assert.match(queueQuoteSection, /const previewRisk = quoteSendBlockReason\(preview\.quote, preview\.warnings\)/);
  assert.match(queueQuoteSection, /if \(previewRisk\)/);
  assert.match(queueQuoteSection, /setMessage\(`发送前检查未通过：\$\{result\.reason\}`\)/);
  assert.match(queueQuoteSection, /queueQuoteSend\(quote\.id, identityExpectation\(quote\)\)/);
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
  assert.match(page, /queueOrderConfirmation\(item\.order\.id, identityExpectation\(item\.order\)\)/);
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
