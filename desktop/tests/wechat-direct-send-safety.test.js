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
  const flowPage = readProjectFile("apps/web/src/features/integrations/wechat-work-flow-page.tsx");
  const preflightPage = readProjectFile("apps/web/src/features/integrations/wechat-work-preflight-page.tsx");
  const windowPage = readProjectFile("apps/web/src/features/integrations/window-evidence-page.tsx");
  const inboundPage = readProjectFile("apps/web/src/features/integrations/personal-wechat-inbound-drill-page.tsx");
  const channelsRoute = readProjectFile("apps/web/src/app/integrations/channels/page.tsx");
  const preflightRoute = readProjectFile("apps/web/src/app/integrations/wechat-work/page.tsx");
  const windowRoute = readProjectFile("apps/web/src/app/integrations/personal-wechat/window-inbound/page.tsx");
  const inboundRoute = readProjectFile("apps/web/src/app/integrations/personal-wechat/inbound-drill/page.tsx");
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
  assert.doesNotMatch(channelsPage, /channel\.checks\.map|status\.visualFlow/);
  assert.match(flowPage, /status\.visualFlow\.map/);
  assert.doesNotMatch(channelsPage, /executeSend|processSafeQueue|runWechatChannelInbound/);
  assert.match(preflightPage, /readiness && !readiness\.productionReady/);
  assert.match(preflightPage, /不把离线检查误报为上线成功/);
  assert.doesNotMatch(preflightPage, /startAutomation|executeSend/);
  assert.match(inboundPage, /identityExpectation\(identity\)/);
  assert.match(inboundPage, /wechatAccountId\.trim\(\) && conversationId\.trim\(\) && customerId\.trim\(\)/);
  assert.match(inboundPage, /confirmed/);
  assert.match(inboundPage, /data-action-id="integrations\.personal-wechat\.inbound-drill\.submit"/);
  assert.doesNotMatch(inboundPage, /captureWindowObserverOnce|scanWindowSnapshotInbox/);
  assert.match(windowPage, /data-action-id="integrations\.window\.capture-current"/);
  assert.doesNotMatch(windowPage, /testWechatChannelInbound/);
  assert.match(channelsRoute, /routeId="integrationChannels"[\s\S]*<ChannelsStatusPage/);
  assert.match(preflightRoute, /routeId="wechatWorkChannels"[\s\S]*<WechatWorkPreflightPage/);
  assert.match(windowRoute, /routeId="personalWechatInbound"[\s\S]*<WindowEvidencePage/);
  assert.match(inboundRoute, /routeId="personalWechatInboundDrill"[\s\S]*<PersonalWechatInboundDrillPage/);
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

test("bridge dispatch contracts expose instruction state without raw payloads", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const sendGuardRules = readProjectFile("packages/rules/sendGuard.js");
  const bridgeProtocol = readProjectFile("docs/WECHAT_BRIDGE_PROTOCOL.md");
  const executeSection = sliceBetween(wechatService, /\n  executeSend\(/, /\n  private validateQueuedOrderSendState\(/);

  assert.match(api, /export type BridgeDispatchEntry/);
  assert.match(api, /export type BridgeDispatchResult = \{[\s\S]*staleCount\?: number/);
  assert.match(api, /dispatch\?:\s*\{[\s\S]*pending:\s*BridgeDispatchEntry\[\]/);
  assert.match(api, /dispatch\?:\s*\{[\s\S]*staleCount\?: number/);
  assert.match(api, /routingPolicy\?: RouteEvaluation\["routingPolicy"\]/);
  assert.match(api, /windowDiagnostic\?: \{/);
  assert.match(wechatService, /failedKeys: \["conversationManualUnlocked", "conversationManualLocked"\]/);
  assert.match(sendGuardRules, /function expandSendGuardFailedKeys\(keys\)/);
  assert.match(sendGuardRules, /key === "conversationManualUnlocked"[\s\S]*conversationManualLocked/);
  assert.match(sendGuardRules, /failedKeys: \["conversationManualUnlocked", "conversationManualLocked"\]/);
  assert.match(api, /preflight\?: \{/);
  assert.match(api, /requiredBeforeSend\?: string\[\]/);
  assert.match(bridgeProtocol, /customer identity/);
  assert.match(bridgeProtocol, /"customerId": "customer_demo_1"/);
  assert.match(bridgeProtocol, /Ack customer matches the send task/);
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

test("notification contracts carry manual follow-up targets", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const quotesService = readProjectFile("apps/api/src/quotes/quotes.service.ts");
  assert.match(quotesService, /verifyPaymentProofAndQueueConfirmation\([\s\S]*this\.assertQuoteHasSelectedImageForPaymentProof\(quote\)/);
  assert.match(quotesService, /private assertQuoteHasSelectedImageForPaymentProof\(quote: any\)[\s\S]*selected design image/);
  assert.match(api, /function verifyQuotePaymentProofAndQueueConfirmation/);
  assert.match(api, /\/quotes\/\$\{id\}\/verify-payment-proof/);
  assert.match(api, /sendTask\?: SendTask \| null/);
});

test("order payment confirmation verifies the linked quote before queueing", () => {
  const wechatService = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  assert.match(wechatService, /queueOrderConfirmation\([\s\S]*this\.assertOrderHasSelectedImageForSend\(order, "order confirmation"\)/);
  assert.match(wechatService, /queueOrderFollowup\([\s\S]*this\.assertOrderHasSelectedImageForSend\(order, "order follow-up"\)/);
  assert.match(wechatService, /assertOrderSendTaskStillQueueable\(task: any\)[\s\S]*this\.assertOrderHasSelectedImageForSend\(order, context\)/);
  assert.match(wechatService, /private assertOrderHasSelectedImageForSend\(order: any, context: string\)[\s\S]*需要先绑定客户选中的效果图/);
});

test("manual mutation APIs carry and enforce expected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
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
  assert.match(api, /notification\?: NotificationItem \| null/);
});

test("send attempt lists are filtered by selected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");

  assert.match(api, /export async function getSendAttempts\(sendTaskId\?: string, filters: IdentityFilters = \{\}\)/);
  assert.match(api, /params\.set\("sendTaskId", sendTaskId\)/);
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
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");

  assert.match(api, /export type SendOperationsScanResult = \{/);
  assert.match(api, /bridgeDispatchExpired\?: number/);
  assert.match(api, /autoRetriedLowValue\?: number/);
  assert.match(api, /scanSendOperations\(filters: IdentityFilters = \{\}\): Promise<SendOperationsScanResult>/);
  assert.match(api, /postJson<SendOperationsScanResult>\("\/wechat\/send-tasks\/scan-ops", filters\)/);
  assert.match(api, /processSafeSendQueue\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /postJson<SafeSendQueueResult>\("\/wechat\/send-tasks\/process-safe-queue", filters\)/);
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
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");

  assert.match(api, /export async function getBridgeOutbox\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/wechat\/bridge\/outbox\$\{identityQuery\(filters\)\}/);
  assert.match(api, /export type BridgeDispatchResult/);
  assert.match(api, /export async function getBridgeDispatch\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/wechat\/bridge\/dispatch\$\{identityQuery\(filters\)\}/);
  assert.match(api, /export async function getBridgeStatus\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/wechat\/bridge\/status\$\{identityQuery\(filters\)\}/);
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
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");

  assert.match(api, /export async function getWechatWindowSnapshots\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /\/wechat\/window-snapshots\$\{identityQuery\(filters\)\}/);
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
  const controller = readProjectFile("apps/api/src/notifications/notifications.controller.ts");
  const service = readProjectFile("apps/api/src/notifications/notifications.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");

  assert.match(api, /export async function markAllNotificationsRead\(filters: IdentityFilters = \{\}\)/);
  assert.match(api, /postJson<\{ count: number \}>\("\/notifications\/read-all", filters\)/);
  assert.match(controller, /markAllRead\(@Body\(\) body: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(controller, /return this\.notifications\.markAllRead\(\{[\s\S]*wechatAccountId: body\?\.wechatAccountId,[\s\S]*conversationId: body\?\.conversationId,[\s\S]*customerId: body\?\.customerId,[\s\S]*\}\)/);
  assert.match(service, /markAllRead\(filter: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
  assert.match(service, /this\.localStore\.markAllNotificationsRead\(filter\)/);
  assert.match(store, /markAllNotificationsRead\(filter: IdentityListFilter = \{\}\)/);
  assert.match(store, /if \(!notice\.readAt && this\.matchesIdentityFilter\(notice, filter\)\)/);
});

test("review decisions carry and enforce expected conversation identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const controller = readProjectFile("apps/api/src/reviews/reviews.controller.ts");
  const service = readProjectFile("apps/api/src/reviews/reviews.service.ts");

  assert.match(api, /export type ReviewDesignJobResult = \{/);
  assert.match(api, /designJob\?: DesignJob \| null/);
  assert.match(api, /export type ReviewQuoteResult = \{/);
  assert.match(api, /reviewDesignJob\(id: string, payload: \{[\s\S]*\} & IdentityExpectation\): Promise<ReviewDesignJobResult>/);
  assert.match(api, /reviewQuote\(id: string, payload: \{[\s\S]*\} & IdentityExpectation\): Promise<ReviewQuoteResult>/);
  assert.match(api, /reviewOrder\(id: string, payload: \{[\s\S]*approve_confirmation[\s\S]*approve_followup[\s\S]*\} & IdentityExpectation\)/);
  assert.match(api, /`\/reviews\/orders\/\$\{id\}`/);
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
    assert.match(controller, /ExpectedIdentityPayload/);
    assert.match(controller, /scanTimeouts\(@Body\(\) payload: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
    assert.match(controller, /pollActiveResults\(@Body\(\) payload: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
    assert.match(controller, /autoSubmitDrafts\(@Body\(\) payload: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
    assert.match(controller, /scanHighValueHandoffs\(@Body\(\) payload: \{ wechatAccountId\?: string; conversationId\?: string; customerId\?: string \} = \{\}\)/);
    assert.match(controller, /submit\(@Param\("id"\) id: string, @Body\(\) body: ExpectedIdentityPayload = \{\}\)/);
  assert.match(controller, /@Post\(":id\/quick-confirm-send"\)[\s\S]*?@RequireOperatorCapability\("approve_send"\)/);
  assert.match(controller, /quickConfirmSend\([\s\S]*?@TrustedOperator\(\) principal: TrustedOperatorPrincipal/);
  assert.match(controller, /reviewer: `\$\{principal\.displayName\} \[\$\{principal\.id\}\]`/);
  assert.match(controller, /\.\.\.\(body \|\| \{\}\)/);
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

test("design assets and conversation manual locks carry expected identity", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
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
  assert.match(assetsService, /await this\.assertLocalAssetReadIdentity\(canonicalLocalPath, expected\)/);
  assert.match(assetsService, /local customer asset requires conversation identity: \$\{missing\.join\(", "\)\}/);
  assert.match(assetsService, /assertExpectedIdentity\(asset, expected, "local asset"\)/);
  assert.match(assetsService, /private async findDesignAssetByLocalPath\(localPath: string\)/);
  assert.match(assetsService, /this\.localStore\.listConversations\(wechatAccountId\)/);
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
  assert.match(api, /reviewTrainingSample\([\s\S]*\} & IdentityExpectation/);
  assert.match(api, /expectedBySampleId\?: Record<string, IdentityExpectation>/);
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
  const controller = readProjectFile("apps/api/src/notifications/notifications.controller.ts");
  const service = readProjectFile("apps/api/src/notifications/notifications.service.ts");
  const store = readProjectFile("apps/api/src/local-store/local-store.service.ts");
  const expectation = readProjectFile("apps/api/src/shared/identity-expectation.ts");

  assert.match(api, /markNotificationRead\(id: string, expected: IdentityExpectation = \{\}\)/);
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
    service.indexOf("  private createVerifiedWindowSnapshot("),
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

test("web API client exposes no direct mark-sent action", () => {
  const apiClient = readProjectFile("apps/web/src/lib/api.ts");

  assert.doesNotMatch(apiClient, /markSendTaskSent/);
  assert.doesNotMatch(apiClient, /mark-sent/);
});

test("web API client cannot manually forge bridge acknowledgements", () => {
  const apiClient = readProjectFile("apps/web/src/lib/api.ts");

  assert.doesNotMatch(apiClient, /acknowledgeBridgeSend/);
  assert.doesNotMatch(apiClient, /\/bridge-ack/);
});

test("web API client requires explicit reason when releasing a manual lock and requeueing", () => {
  const apiClient = readProjectFile("apps/web/src/lib/api.ts");

  assert.match(apiClient, /export async function requeueSendTask\(id: string, payload: \{ reason\?: string \} & IdentityExpectation = \{\}\)/);
  assert.match(apiClient, /\.\.\.payload/);
  assert.match(apiClient, /requeueReason\?: string/);
  assert.match(apiClient, /requeuedAt\?: string/);
  assert.match(apiClient, /cancelReason\?: string/);
  assert.match(apiClient, /cancelledAt\?: string/);
  assert.match(apiClient, /history\?: Array/);
  assert.match(apiClient, /export async function cancelSendTask\(id: string, payload: \{ reason\?: string \} & IdentityExpectation = \{\}\)/);
});

test("web API exposes current manually locked conversations", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  assert.match(api, /export type ReviewOrderResult = \{/);
  assert.match(api, /export async function reviewOrder[\s\S]*Promise<ReviewOrderResult>/);
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

test("quote and order contracts expose guarded next-step guidance", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  const quotesController = readProjectFile("apps/api/src/quotes/quotes.controller.ts");
  const quotesService = readProjectFile("apps/api/src/quotes/quotes.service.ts");
  const ordersController = readProjectFile("apps/api/src/orders/orders.controller.ts");
  const ordersService = readProjectFile("apps/api/src/orders/orders.service.ts");
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
});

test("quote and order APIs filter records by next-step actionability", () => {
  const api = readProjectFile("apps/web/src/lib/api.ts");
  assert.match(api, /export async function createQuote\(id: string, expected: IdentityExpectation = \{\}\): Promise<QuoteDraft>/);
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
  assert.match(wechatDispatchService, /private async markLinkedOrderSendFailed\(task: any, reason: string\)/);
  assert.match(wechatDispatchService, /const orderDraftId = String\(automation\.orderDraftId \|\| task\?\.payload\?\.orderDraftId \|\| ""\)\.trim\(\)/);
  assert.match(wechatDispatchService, /source === "order_followup" \|\| automation\.followupType/);
  assert.match(wechatDispatchService, /private hasOrderDraftBinding\(task: any\)/);
  assert.match(wechatDispatchService, /markLinkedQuoteSent\(task: any\)[\s\S]*if \(this\.hasOrderDraftBinding\(task\)\) return/);
  assert.match(wechatDispatchService, /markLinkedQuoteFailed\(task: any, reason: string\)[\s\S]*if \(this\.hasOrderDraftBinding\(task\)\) \{[\s\S]*this\.markLinkedOrderSendFailed\(task, reason\);[\s\S]*return;[\s\S]*\}/);
  assert.match(wechatDispatchService, /markLinkedQuoteRequeued\(task: any, reason: string\)[\s\S]*if \(this\.hasOrderDraftBinding\(task\)\) return/);
  assert.match(wechatDispatchService, /customerNotes: appendCustomerNote\(order\.customerNotes, note\)/);
  assert.match(wechatDispatchService, /this\.markLinkedOrderSendFailed\(updated, reason\)/);
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

test("bridge ack, cancellation, and unknown delivery archive dispatch instruction files", () => {
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
  assert.match(adapter, /moveBridgeDispatchFile\(filePath: string, outcome: "processed" \| "failed" \| "cancelled" \| "uncertain"\)/);
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

test("send operations scan protects unknown bridge delivery without fabricating a failed ack", () => {
  const service = readProjectFile("apps/api/src/wechat/wechat-dispatch.service.ts");
  const scanOpsSection = service.slice(
    service.indexOf("  async scanSendOperations("),
    service.indexOf("  acknowledgeBridgeSend("),
  );
  const controller = readProjectFile("apps/api/src/wechat/wechat.controller.ts");

  assert.doesNotMatch(scanOpsSection, /acknowledgeBridgeSend\([\s\S]*\{ internal: true \}/);
  assert.match(scanOpsSection, /markBridgeDeliveryUnknown\(task, "bridge_outbox_unavailable"/);
  assert.match(scanOpsSection, /markBridgeDeliveryUnknown\(task, "bridge_ack_timeout"/);
  assert.match(scanOpsSection, /const bridgeDispatchExpired: any\[\] = \[\]/);
  assert.match(scanOpsSection, /const autoRetriedLowValue: any\[\] = \[\]/);
  assert.match(scanOpsSection, /findPendingBridgeDispatchForTask\(task, pendingBridgeAttempt\)/);
  assert.match(scanOpsSection, /dispatchState\?\.expired/);
  assert.match(scanOpsSection, /markBridgeDeliveryUnknown\(task, "bridge_dispatch_expired"/);
  assert.match(scanOpsSection, /dispatchFileName: dispatchState\.fileName/);
  assert.match(scanOpsSection, /bridgeDispatchExpired: bridgeDispatchExpired\.length/);
  assert.match(scanOpsSection, /autoRetriedLowValue: autoRetriedLowValue\.length/);
  assert.match(scanOpsSection, /tasks: \{[\s\S]*autoRetriedLowValue/);
  assert.match(scanOpsSection, /微信桥接发送指令过期/);
  assert.match(service, /deliveryState: "unknown"/);
  assert.match(service, /automaticRetryBlocked: true/);
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
  assert.match(recoverySection, /resolveLocalBridgeAckAttempt\(task, payload\)/);
  assert.match(recoverySection, /validateBridgeAckBinding\(\{ task, attempt: pendingAttempt, payload \}\)/);
  assert.match(recoverySection, /validateExistingSendTaskBinding\(task\)/);
  assert.match(recoverySection, /validateBridgeAckOutboxPayload\(task, pendingAttempt, payload, outboxFileName\)/);
  assert.match(recoverySection, /archiveBridgeOutboxFile\(outboxFileName, "failed"\)/);
  assert.match(recoverySection, /archiveBridgeDispatchFile\(task, pendingAttempt, "failed"\)/);
  assert.match(recoverySection, /status: "failed"/);
  assert.match(recoverySection, /reason: "bridge_ack_rejected_after_trusted_validation"/);
  assert.match(recoverySection, /markLinkedQuoteFailed\(updatedTask, failureReason\)/);
  assert.match(service, /private async markLinkedOrderSendFailed\(task: any, reason: string\)/);
  assert.match(service, /\[发送任务:\$\{task\.id\}\]/);
  assert.ok(
    recoverySection.indexOf("validateBridgeAckOutboxPayload") < recoverySection.indexOf("updateSendTask"),
    "rejected sent ack recovery must validate the outbox body before failing the task",
  );
});
