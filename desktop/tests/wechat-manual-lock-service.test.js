"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { OrdersService } = require("../apps/api/src/orders/orders.service");
const { QuotesService } = require("../apps/api/src/quotes/quotes.service");
const { ReviewsService } = require("../apps/api/src/reviews/reviews.service");
const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const {
  createWechatWindowObserverAttestation,
  createWechatWindowObserverEvidence,
} = require("../packages/rules/wechatWindowEvidence");

const observerProofToken = "e".repeat(64);

function setupService(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-lock-send-"));
  process.env.WECHAT_BRIDGE_OUTBOX_DIR = path.join(tempDir, "outbox");
  process.env.WECHAT_BRIDGE_INBOX_DIR = path.join(tempDir, "inbox");
  process.env.WECHAT_BRIDGE_DISPATCH_DIR = path.join(tempDir, "dispatch");
  process.env.WECHAT_BRIDGE_LOCK_DIR = path.join(tempDir, "locks");
  process.env.WECHAT_BRIDGE_WORKER_STATUS_FILE = path.join(tempDir, "worker-status.json");

  appConfig.wechatBridgeOutboxDir = process.env.WECHAT_BRIDGE_OUTBOX_DIR;
  appConfig.wechatBridgeInboxDir = process.env.WECHAT_BRIDGE_INBOX_DIR;
  appConfig.wechatBridgeDispatchDir = process.env.WECHAT_BRIDGE_DISPATCH_DIR;
  appConfig.wechatBridgeLockDir = process.env.WECHAT_BRIDGE_LOCK_DIR;
  appConfig.wechatBridgeWorkerStatusFile = process.env.WECHAT_BRIDGE_WORKER_STATUS_FILE;
  appConfig.wechatWindowObserverProofFile = path.join(tempDir, "wechat-window-observer-proof.key");
  fs.writeFileSync(appConfig.wechatWindowObserverProofFile, `${observerProofToken}\n`, "utf8");

  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  const notifications = new NotificationsService({}, localStore);
  const sendAdapter = new WechatSendAdapterService();
  const orders = overrides.orders || new OrdersService({}, localStore, notifications);
  const service = new WechatDispatchService({}, localStore, sendAdapter, notifications, orders);
  const quotes = new QuotesService({}, localStore, orders, service);
  const reviews = new ReviewsService({}, localStore, {}, {}, notifications, service, orders);

  return { tempDir, localStore, service, reviews, orders, quotes };
}

function demoExpectedIdentity() {
  return {
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
  };
}

test("wechat manual review copy stays readable Chinese", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "api", "src", "wechat", "wechat-dispatch.service.ts"), "utf8");

  assert.match(source, /buildOrderConfirmationCustomerMessage/);
  assert.match(source, /planInboundAutomation/);
  assert.match(source, /evaluateLowValueQuoteSend/);
  assert.match(source, /订单确认已进入微信安全发送队列/);
});

function buildOrderDraft(overrides = {}) {
  const conversation = {
    id: "conversation_demo_1",
    customerId: "customer_demo_1",
    wechatAccountId: "wechat_demo_1",
  };
  const designJob = {
    id: "design_demo_1",
    customerId: "customer_demo_1",
    conversationId: conversation.id,
    wechatAccountId: conversation.wechatAccountId,
    scene: "employee welfare",
    bundle: { items: [{ name: "thermos", salePrice: 80, cost: 45 }] },
    conversation,
  };
  const selectedImage = {
    id: "image_demo_1",
    designJobId: designJob.id,
  };
  const quoteDraft = {
    id: "quote_demo_1",
    designJobId: designJob.id,
    customerId: conversation.customerId,
    selectedImageId: selectedImage.id,
    customer: { id: conversation.customerId, name: "Customer A" },
    selectedImage,
    designJob,
  };
  return {
    id: "order_demo_1",
    quoteDraftId: quoteDraft.id,
    designJobId: designJob.id,
    customerId: conversation.customerId,
    conversationId: conversation.id,
    wechatAccountId: conversation.wechatAccountId,
    selectedImageId: selectedImage.id,
    quantity: 50,
    unitPrice: 100,
    totalPrice: 5000,
    totalCost: 3000,
    profit: 2000,
    paymentStatus: "unpaid",
    status: "accepted",
    bundleSnapshot: designJob.bundle,
    customer: quoteDraft.customer,
    conversation,
    designJob,
    quoteDraft,
    selectedImage,
    ...overrides,
  };
}

function seedStoredOrderDraft(localStore, overrides = {}) {
  const job = localStore.createDesignJob({
    requestId: `order_requeue_${Date.now()}_${Math.random()}`,
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 50 },
    scene: "employee welfare",
    bundle: {
      items: [{ name: "thermos", salePrice: 100, costPrice: 60, quantity: 1 }],
    },
    assets: [],
    requirements: {},
    status: "completed",
  });
  const [image] = localStore.upsertDesignImages(job.id, [
    {
      imageId: `image_${Date.now()}_${Math.random()}`,
      downloadUrl: "http://design.local/image.png",
      localPath: "C:\\temp\\image.png",
      position: 1,
      width: 1024,
      height: 1024,
    },
  ]);
  const selectedImageId = image.id || image.imageId;
  localStore.selectDesignImage(job.id, selectedImageId, "客户选择第1张");
  const quote = localStore.createQuoteFromDesignJob(job.id, selectedImageId);
  const paymentStatus = overrides.paymentStatus || "deposit_paid";
  const updatedQuote = localStore.updateQuoteDraft(quote.id, {
    status: "accepted",
    paymentStatus,
  });
  return localStore.upsertOrderDraftFromQuote(updatedQuote.id, {
    id: overrides.id || "order_demo_1",
    designJobId: job.id,
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    selectedImageId,
    quantity: 50,
    unitPrice: 100,
    totalPrice: 5000,
    totalCost: 3000,
    profit: 2000,
    paymentStatus,
    status: overrides.status || "processing",
    bundleSnapshot: job.bundle,
    ...overrides,
  });
}

test("manual quote status update cancels pending quote send task", async () => {
  const { localStore, quotes } = setupService();
  const job = localStore.createDesignJob({
    requestId: "quote_manual_review_cancels_send_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 50 },
    scene: "端午员工福利礼盒",
    bundle: {
      items: [{ name: "保温杯", salePrice: 100, costPrice: 60, quantity: 1 }],
    },
    assets: [],
    requirements: {},
    status: "completed",
  });
  const [image] = localStore.upsertDesignImages(job.id, [
    {
      imageId: "quote_manual_review_cancel_candidate_1",
      downloadUrl: "http://127.0.0.1:3700/files/quote-manual-review-cancel.png",
      localPath: "C:\\storage\\design-jobs\\quote_manual_review_cancel\\candidate_1.png",
      position: 1,
      width: 1024,
      height: 1024,
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(job.id, image.id);
  const sendTask = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: job.id,
    quoteDraftId: quote.id,
    status: "queued",
    payload: {
      kind: "quote",
      quoteDraftId: quote.id,
      text: "这条报价不应该继续自动发出",
    },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "low_value_quote_send",
        valueLevel: "low",
        quoteDraftId: quote.id,
      },
    },
  });
  localStore.updateQuoteDraft(quote.id, {
    status: "send_queued",
    sendTaskId: sendTask.id,
  });

  const updated = await quotes.update(quote.id, {
    ...demoExpectedIdentity(),
    status: "manual_review",
    owner: "人工客服",
    customerNotes: "客户改需求，报价回到人工审核。",
  });
  const cancelled = localStore.getSendTask(sendTask.id);

  assert.equal(updated.status, "manual_review");
  assert.equal(updated.sendTaskId, null);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.guardSnapshot.status, "cancelled");
  assert.match(cancelled.guardSnapshot.cancelReason, /客户改需求/);
  assert.match(updated.customerNotes, /原报价发送任务/);
});

test("manual quote status update unlinks an already cancelled quote send task", async () => {
  const { localStore, quotes } = setupService();
  const job = localStore.createDesignJob({
    requestId: "quote_manual_review_unlinks_cancelled_send_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 50 },
    scene: "端午员工福利礼盒",
    bundle: {
      items: [{ name: "保温杯", salePrice: 100, costPrice: 60, quantity: 1 }],
    },
    assets: [],
    requirements: {},
    status: "completed",
  });
  const [image] = localStore.upsertDesignImages(job.id, [
    {
      imageId: "quote_manual_review_cancelled_candidate_1",
      downloadUrl: "http://127.0.0.1:3700/files/quote-manual-review-cancelled.png",
      localPath: "C:\\storage\\design-jobs\\quote_manual_review_cancelled\\candidate_1.png",
      position: 1,
      width: 1024,
      height: 1024,
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(job.id, image.id);
  const sendTask = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: job.id,
    quoteDraftId: quote.id,
    status: "cancelled",
    payload: {
      kind: "quote",
      quoteDraftId: quote.id,
      text: "这条报价已经取消过，不应该再次取消",
    },
    guardSnapshot: {
      status: "cancelled",
      cancelReason: "manual_lock_before_revision",
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "low_value_quote_send",
        valueLevel: "low",
        quoteDraftId: quote.id,
      },
    },
  });
  localStore.updateQuoteDraft(quote.id, {
    status: "send_queued",
    sendTaskId: sendTask.id,
  });

  const updated = await quotes.update(quote.id, {
    ...demoExpectedIdentity(),
    status: "manual_review",
    owner: "人工客服",
    customerNotes: "客户改需求，旧报价不再发送。",
  });
  const keptCancelled = localStore.getSendTask(sendTask.id);

  assert.equal(updated.status, "manual_review");
  assert.equal(updated.sendTaskId, null);
  assert.equal(keptCancelled.status, "cancelled");
  assert.equal(keptCancelled.guardSnapshot.cancelReason, "manual_lock_before_revision");
  assert.match(updated.customerNotes, /已经取消/);
});

function createPassingWechatWindowSnapshot(localStore, recentMessageText = "") {
  return createTrustedTestWindowSnapshot(localStore, {
    source: "windows_foreground_observer",
    isOnline: true,
    wechatAccountId: "wechat_demo_1",
    accountDisplayName: "微信客服1号",
    chatTitle: "王总-端午礼盒",
    activeChatTitle: "王总-端午礼盒",
    externalChatId: "demo_wang_chat",
    recentCustomerId: "customer_demo_1",
    recentMessageText,
    confidence: 1,
    capturedAt: new Date().toISOString(),
    diagnostic: {
      observerEvidence: {
        verified: true,
        version: "wechat_window_observer_v1",
        nonceHash: "b".repeat(64),
      },
    },
  });
}

function createTrustedTestWindowSnapshot(localStore, payload) {
  const snapshot = { ...payload, capturedAt: payload.capturedAt || new Date().toISOString() };
  const evidence = payload.diagnostic?.observerEvidence || {};
  const observerEvidence = createWechatWindowObserverAttestation(
    snapshot,
    {
      version: evidence.version || "wechat_window_observer_v1",
      issuedAt: snapshot.capturedAt,
      nonceHash: evidence.nonceHash || "b".repeat(64),
    },
    observerProofToken,
  );
  return localStore.createWechatWindowSnapshot({
    ...snapshot,
    diagnostic: { ...(payload.diagnostic || {}), observerEvidence },
  });
}

function safeBridgeFileSegment(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function writeDispatchInstructionForStartedBridgeSend(localStore, taskId) {
  const task = localStore.getSendTask(taskId);
  const attempt = localStore.getLatestSendAttempt(taskId, {
    adapter: "windows_bridge",
    status: "started",
  });
  assert.ok(task, "send task should exist before bridge dispatch instruction");
  assert.ok(attempt, "started bridge attempt should exist before bridge dispatch instruction");
  fs.mkdirSync(appConfig.wechatBridgeDispatchDir, { recursive: true });

  const outboxFileName = path.basename(String(attempt.metadata?.outboxFile || attempt.metadata?.outboxFileName || ""));
  const fileName = `${safeBridgeFileSegment(task.wechatAccountId)}-${safeBridgeFileSegment(task.id)}-${safeBridgeFileSegment(
    attempt.id,
  )}.dispatch.json`;
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const text = String(task.payload?.textBeforeImages || task.payload?.text || "test bridge send").trim();
  const actions = text ? [{ type: "text", text }] : [{ type: "text", text: "test bridge send" }];
  fs.writeFileSync(
    path.join(appConfig.wechatBridgeDispatchDir, fileName),
    `${JSON.stringify(
      {
        version: "wechat_bridge_dispatch_v1",
        taskId: task.id,
        attemptId: attempt.id,
        wechatAccountId: task.wechatAccountId,
        conversationId: task.conversationId,
        sourceOutboxFileName: outboxFileName,
        sendPlan: {
          kind: task.payload?.kind || "text",
          actionCount: actions.length,
          actions,
          constraints: { doNotSendAfter: expiresAt },
        },
        ack: {
          requiredAttemptId: attempt.id,
          requiredOutboxFileName: outboxFileName,
          fileNameHint: `${safeBridgeFileSegment(task.wechatAccountId)}-${safeBridgeFileSegment(task.id)}-${safeBridgeFileSegment(
            attempt.id,
          )}-sent.ack.json`,
        },
        createdAt: new Date().toISOString(),
        expiresAt,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return fileName;
}

function acknowledgeStartedBridgeSend(service, localStore, taskId) {
  const task = localStore.getSendTask(taskId);
  const attempt = localStore.getLatestSendAttempt(taskId, {
    adapter: "windows_bridge",
    status: "started",
  });
  assert.ok(task, "send task should exist before bridge ack");
  assert.ok(attempt, "started bridge attempt should exist before bridge ack");
  writeDispatchInstructionForStartedBridgeSend(localStore, taskId);
  const outboxFile = attempt.metadata.outboxFile;
  const outbox = JSON.parse(fs.readFileSync(outboxFile, "utf8"));
  const outboxCustomerId = outbox.target?.customerId || outbox.sendPlan?.target?.customerId || "";
  return service.acknowledgeBridgeSend(taskId, {
    status: "sent",
    version: "wechat_bridge_ack_v1",
    ackToken: outbox.ackToken,
    taskId,
    attemptId: attempt.id,
    wechatAccountId: task.wechatAccountId,
    conversationId: task.conversationId,
    customerId: task.customerId || outboxCustomerId,
    outboxFileName: path.basename(outboxFile),
    sentAt: new Date().toISOString(),
  });
}

test("manual lock protects in-flight bridge sends as unknown without archiving unsent evidence", async () => {
  const { localStore, service } = setupService();

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    status: "sending",
    payload: { kind: "text", text: "manual lock should cancel this" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });

  fs.mkdirSync(process.env.WECHAT_BRIDGE_OUTBOX_DIR, { recursive: true });
  const outboxFile = path.join(process.env.WECHAT_BRIDGE_OUTBOX_DIR, "manual-lock-send.json");
  fs.writeFileSync(
    outboxFile,
    JSON.stringify({
      version: "wechat_bridge_outbox_v1",
      taskId: task.id,
      wechatAccountId: task.wechatAccountId,
      conversationId: task.conversationId,
      payload: task.payload,
    }),
    "utf8",
  );
  const attempt = localStore.createSendAttempt({
    sendTaskId: task.id,
    adapter: "windows_bridge",
    status: "started",
    metadata: { outboxFile },
  });

  const result = await service.setConversationManualLock("conversation_demo_1", {
    ...demoExpectedIdentity(),
    locked: true,
    reviewer: "test",
    reason: "manual_takeover_test",
  });

  const updatedTask = localStore.getSendTask(task.id);
  const updatedAttempt = localStore.listSendAttempts({ sendTaskId: task.id })[0];
  const cancelledDir = path.join(process.env.WECHAT_BRIDGE_OUTBOX_DIR, "cancelled");

  assert.equal(result.conversation.manualLocked, true);
  assert.equal(result.inFlightSendTasks.length, 1);
  assert.equal(result.inFlightSendTasks[0].id, task.id);
  assert.equal(result.log.metadata.conversationTitle, result.conversation.title);
  assert.equal(result.log.metadata.customerName, result.conversation.customer.name);
  assert.equal(result.log.metadata.wechatAccountName, result.conversation.wechatAccount.displayName);
  assert.deepEqual(result.log.metadata.protectedUnknownInFlightSendTaskIds, [task.id]);
  assert.deepEqual(result.log.metadata.cancelledInFlightSendTaskIds, []);
  assert.equal(updatedTask.status, "sending");
  assert.equal(updatedTask.guardSnapshot.deliveryState, "unknown");
  assert.equal(updatedTask.guardSnapshot.manualReviewRequired, true);
  assert.equal(updatedTask.guardSnapshot.automaticRetryBlocked, true);
  assert.match(result.log.note, /人工.*接管/);
  assert.equal(updatedAttempt.id, attempt.id);
  assert.equal(updatedAttempt.status, "started");
  assert.equal(fs.existsSync(outboxFile), true);
  assert.equal(fs.existsSync(cancelledDir), false);
});

test("manual release does not requeue tasks paused by manual lock", async () => {
  const { localStore, service } = setupService();

  const queuedTask = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "queued task should stay blocked" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });
  const sendingTask = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "sending",
    payload: { kind: "text", text: "sending task should stay cancelled" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });

  await service.setConversationManualLock("conversation_demo_1", {
    ...demoExpectedIdentity(),
    locked: true,
    reviewer: "test",
    reason: "manual_takeover_test",
  });
  const release = await service.setConversationManualLock("conversation_demo_1", {
    locked: false,
    reviewer: "test",
    reason: "manual_release_test",
    note: "manual handled the customer question and can resume automation",
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
  });

  const updatedQueuedTask = localStore.getSendTask(queuedTask.id);
  const updatedSendingTask = localStore.getSendTask(sendingTask.id);

  assert.equal(release.conversation.manualLocked, false);
  assert.equal(release.log.metadata.conversationTitle, release.conversation.title);
  assert.equal(release.log.metadata.customerName, release.conversation.customer.name);
  assert.equal(release.log.metadata.wechatAccountName, release.conversation.wechatAccount.displayName);
  assert.equal(release.log.metadata.reason, "manual_release_test");
  assert.equal(release.blockedSendTasks.length, 0);
  assert.equal(release.inFlightSendTasks.length, 0);
  assert.equal(updatedQueuedTask.status, "blocked");
  assert.equal(updatedQueuedTask.guardSnapshot.blockedByManualLock, true);
  assert.equal(updatedSendingTask.status, "sending");
  assert.equal(updatedSendingTask.guardSnapshot.deliveryState, "unknown");
  assert.equal(updatedSendingTask.guardSnapshot.manualReviewRequired, true);
  assert.equal(updatedSendingTask.guardSnapshot.automaticRetryBlocked, true);
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === "conversation_demo_1" && task.status === "queued").length, 0);
});

test("manual lock blocked order task records order note without changing quote status", async () => {
  const { localStore, service } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_manual_lock_block_note_1",
    status: "confirmed",
    paymentStatus: "deposit_paid",
  });
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "queued",
    payload: { kind: "text", text: "manual lock should write order note" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "low_value_quote_acceptance",
        valueLevel: "low",
        quoteDraftId: order.quoteDraftId,
        orderDraftId: order.id,
      },
    },
  });

  await service.setConversationManualLock("conversation_demo_1", {
    ...demoExpectedIdentity(),
    locked: true,
    reviewer: "test",
    reason: "manual_takeover_test",
  });

  const blockedTask = localStore.getSendTask(task.id);
  const blockedOrder = localStore.getOrderDraft(order.id);
  const quote = localStore.getQuoteDraft(order.quoteDraftId);

  assert.equal(blockedTask.status, "blocked");
  assert.equal(blockedTask.guardSnapshot.blockedByManualLock, true);
  assert.match(blockedOrder.customerNotes, new RegExp(`\\[发送任务:${task.id}\\]`));
  assert.match(blockedOrder.customerNotes, /订单确认发送失败，需要人工处理/);
  assert.match(blockedOrder.customerNotes, /会话已人工接管，自动发送暂停/);
  assert.equal(quote.status, "accepted");
});

test("manual release requires explicit manual reason and keeps conversation locked", async () => {
  const { localStore, service } = setupService();

  await service.setConversationManualLock("conversation_demo_1", {
    ...demoExpectedIdentity(),
    locked: true,
    reviewer: "test",
    reason: "manual_takeover_test",
  });
  const reviewLogCount = localStore.listReviewLogs().length;

  await assert.rejects(
    () =>
      service.setConversationManualLock("conversation_demo_1", {
        locked: false,
        reviewer: "test",
        expectedWechatAccountId: "wechat_demo_1",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
      }),
    /需要填写明确的人工处理原因/,
  );

  const conversation = localStore.listConversations().find((item) => item.id === "conversation_demo_1");
  assert.equal(conversation.manualLocked, true);
  assert.equal(localStore.listReviewLogs().length, reviewLogCount);
});

test("manual release requires a resolution note and keeps conversation locked", async () => {
  const { localStore, service } = setupService();

  await service.setConversationManualLock("conversation_demo_1", {
    ...demoExpectedIdentity(),
    locked: true,
    reviewer: "test",
    reason: "manual_takeover_test",
  });
  const reviewLogCount = localStore.listReviewLogs().length;

  await assert.rejects(
    () =>
      service.setConversationManualLock("conversation_demo_1", {
        locked: false,
        reviewer: "test",
        reason: "manual_release_test",
        expectedWechatAccountId: "wechat_demo_1",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
      }),
    /manual|reason|result|note|处理|结果/,
  );

  const conversation = localStore.listConversations().find((item) => item.id === "conversation_demo_1");
  assert.equal(conversation.manualLocked, true);
  assert.equal(localStore.listReviewLogs().length, reviewLogCount);
});

test("customer asset upload rejects mismatched account conversation identity", async () => {
  const { localStore } = setupService();
  const { AssetsService } = require("../apps/api/src/assets/assets.service");
  const storage = {
    saveAssetFromBase64(payload) {
      return {
        localPath: path.join("storage", "assets", payload.ownerType, payload.ownerId, payload.fileName),
        sizeBytes: 12,
      };
    },
    saveAssetFromText(payload) {
      return {
        localPath: path.join("storage", "assets", payload.ownerType, payload.ownerId, payload.fileName),
        sizeBytes: Buffer.byteLength(payload.text || "", "utf8"),
      };
    },
    saveAssetFromUrl(payload) {
      return {
        localPath: path.join("storage", "assets", payload.ownerType, payload.ownerId, payload.fileName),
        sizeBytes: 0,
      };
    },
  };
  const assets = new AssetsService({}, localStore, storage);
  const primaryConversation = localStore.listConversations().find((item) => item.id === "conversation_demo_1");
  assert.ok(primaryConversation);

  await assert.rejects(
    () =>
      assets.upload({
        ownerType: "customer",
        ownerId: "customer_demo_1",
        expectedWechatAccountId: "wechat_demo_2",
        expectedConversationId: "conversation_demo_2",
        expectedCustomerId: "customer_demo_1",
        role: "customer_logo",
        fileName: "logo.png",
        mimeType: "image/png",
        base64: "data:image/png;base64,AAAA",
      }),
    /customer asset (conversation|conversation customer) identity mismatch/,
  );

  const asset = await assets.upload({
    ownerType: "customer",
    ownerId: primaryConversation.customerId,
    expectedWechatAccountId: primaryConversation.wechatAccountId,
    expectedConversationId: primaryConversation.id,
    expectedCustomerId: primaryConversation.customerId,
    role: "customer_logo",
    fileName: "logo.png",
    mimeType: "image/png",
    base64: "data:image/png;base64,AAAA",
  });

  assert.equal(asset.ownerType, "customer");
  assert.equal(asset.ownerId, primaryConversation.customerId);
  assert.equal(asset.wechatAccountId, primaryConversation.wechatAccountId);
  assert.equal(asset.conversationId, primaryConversation.id);
  assert.equal(asset.customerId, primaryConversation.customerId);
  assert.equal(localStore.listDesignAssets({ ownerType: "customer", ownerId: primaryConversation.customerId }).length, 1);
  assert.equal(
    localStore.listDesignAssets({
      ownerType: "customer",
      ownerId: primaryConversation.customerId,
      wechatAccountId: primaryConversation.wechatAccountId,
      conversationId: primaryConversation.id,
      customerId: primaryConversation.customerId,
    }).length,
    1,
  );
  assert.equal(
    localStore.listDesignAssets({
      ownerType: "customer",
      ownerId: primaryConversation.customerId,
      conversationId: "conversation_demo_2",
      customerId: primaryConversation.customerId,
    }).length,
    0,
  );

  assert.throws(
    () => assets.list({ ownerType: "customer", ownerId: primaryConversation.customerId }),
    /customer asset list requires conversation identity: wechatAccountId, conversationId, customerId/,
  );
  assert.throws(
    () =>
      assets.list({
        ownerType: "customer",
        ownerId: primaryConversation.customerId,
        wechatAccountId: "wechat_demo_2",
        conversationId: primaryConversation.id,
        customerId: primaryConversation.customerId,
      }),
    /customer asset list conversation identity mismatch/,
  );
  assert.deepEqual(
    assets
      .list({
        ownerType: "customer",
        ownerId: primaryConversation.customerId,
        wechatAccountId: primaryConversation.wechatAccountId,
        conversationId: primaryConversation.id,
        customerId: primaryConversation.customerId,
      })
      .map((item) => item.id),
    [asset.id],
  );
});

test("customer asset upload requires explicit account conversation identity", async () => {
  const { localStore } = setupService();
  const { AssetsService } = require("../apps/api/src/assets/assets.service");
  const storage = {
    saveAssetFromBase64(payload) {
      return {
        localPath: path.join("storage", "assets", payload.ownerType, payload.ownerId, payload.fileName),
        sizeBytes: 12,
      };
    },
    saveAssetFromText(payload) {
      return {
        localPath: path.join("storage", "assets", payload.ownerType, payload.ownerId, payload.fileName),
        sizeBytes: Buffer.byteLength(payload.text || "", "utf8"),
      };
    },
    saveAssetFromUrl(payload) {
      return {
        localPath: path.join("storage", "assets", payload.ownerType, payload.ownerId, payload.fileName),
        sizeBytes: 0,
      };
    },
  };
  const assets = new AssetsService({}, localStore, storage);

  await assert.rejects(
    () =>
      assets.upload({
        ownerType: "customer",
        ownerId: "customer_demo_1",
        role: "customer_logo",
        fileName: "logo.png",
        mimeType: "image/png",
        base64: "data:image/png;base64,AAAA",
      }),
    /customer asset requires conversation identity: expectedWechatAccountId, expectedConversationId, expectedCustomerId/,
  );

  const skuAsset = await assets.upload({
    ownerType: "sku",
    ownerId: "sku_demo_1",
    role: "sku_image",
    fileName: "sku.png",
    mimeType: "image/png",
    base64: "data:image/png;base64,AAAA",
  });

  assert.equal(skuAsset.ownerType, "sku");
  assert.equal(skuAsset.ownerId, "sku_demo_1");
  assert.equal(skuAsset.wechatAccountId, null);
  assert.equal(skuAsset.conversationId, null);
  assert.equal(skuAsset.customerId, null);
  assert.deepEqual(assets.list({ ownerType: "sku", ownerId: "sku_demo_1" }).map((item) => item.id), [skuAsset.id]);
});

test("local customer asset read requires matching account conversation identity", async () => {
  const { localStore } = setupService();
  const { AssetsService } = require("../apps/api/src/assets/assets.service");
  const storage = {
    readPath: "",
    async readLocalAsset(localPath) {
      this.readPath = localPath;
      return {
        stream: Readable.from(Buffer.from("x")),
        mimeType: "image/png",
        sizeBytes: 1,
      };
    },
  };
  const assets = new AssetsService({}, localStore, storage);
  const customerAsset = localStore.createDesignAsset({
    ownerType: "customer",
    ownerId: "customer_demo_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    role: "customer_logo",
    fileName: "logo.png",
    mimeType: "image/png",
    localPath: path.resolve("storage", "assets", "customer", "customer_demo_1", "logo.png"),
    source: "test",
  });

  await assert.rejects(
    () => assets.readLocalAsset(customerAsset.localPath),
    /local customer asset requires conversation identity: expectedWechatAccountId, expectedConversationId, expectedCustomerId/,
  );
  await assert.rejects(
    () =>
      assets.readLocalAsset(customerAsset.localPath, {
        expectedWechatAccountId: "wechat_demo_2",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
      }),
    /local asset identity mismatch/,
  );

  const file = await assets.readLocalAsset(customerAsset.localPath, {
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
  });

  assert.equal(file.mimeType, "image/png");
  assert.equal(storage.readPath, customerAsset.localPath);
});

test("local sku asset read stays available without customer identity", async () => {
  const { localStore } = setupService();
  const { AssetsService } = require("../apps/api/src/assets/assets.service");
  const storage = {
    readPath: "",
    async readLocalAsset(localPath) {
      this.readPath = localPath;
      return {
        stream: Readable.from(Buffer.from("x")),
        mimeType: "image/png",
        sizeBytes: 1,
      };
    },
  };
  const assets = new AssetsService({}, localStore, storage);
  const skuAsset = localStore.createDesignAsset({
    ownerType: "sku",
    ownerId: "sku_demo_1",
    role: "sku_image",
    fileName: "sku.png",
    mimeType: "image/png",
    localPath: path.resolve("storage", "assets", "sku", "sku_demo_1", "sku.png"),
    source: "test",
  });

  const file = await assets.readLocalAsset(skuAsset.localPath);

  assert.equal(file.mimeType, "image/png");
  assert.equal(storage.readPath, skuAsset.localPath);
});

test("design job asset binding rejects and hides cross conversation customer assets", () => {
  const { localStore } = setupService();
  const matchingAsset = localStore.createDesignAsset({
    ownerType: "customer",
    ownerId: "customer_demo_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    role: "customer_logo",
    fileName: "matching-logo.png",
    mimeType: "image/png",
    localPath: "C:\\temp\\matching-logo.png",
    source: "test",
  });
  const crossConversationAsset = localStore.createDesignAsset({
    ownerType: "customer",
    ownerId: "customer_demo_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_2",
    wechatAccountId: "wechat_demo_2",
    role: "customer_logo",
    fileName: "wrong-conversation-logo.png",
    mimeType: "image/png",
    localPath: "C:\\temp\\wrong-conversation-logo.png",
    source: "test",
  });
  const designJob = localStore.createDesignJob({
    requestId: "asset_binding_identity_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [] },
  });

  assert.throws(
    () => localStore.attachDesignAssetsToJob(designJob.id, [matchingAsset.id, crossConversationAsset.id]),
    /design asset binding invalid/,
  );

  const dirtyJob = localStore.createDesignJob({
    requestId: "dirty_asset_binding_identity_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    assetIds: [matchingAsset.id, crossConversationAsset.id],
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [] },
  });

  assert.deepEqual(
    dirtyJob.assets.map((asset) => asset.id),
    [matchingAsset.id],
  );
});

test("requeue rejects send task after its design binding becomes invalid", async () => {
  const { localStore, service } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "requeue_bad_binding_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [] },
    requirements: {},
    status: "completed",
  });
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: designJob.id,
    status: "failed",
    payload: { kind: "text", text: "should not requeue with bad binding" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });
  localStore.updateSendTask(task.id, { errorMessage: "previous failure" });
  localStore.updateDesignJob(designJob.id, { conversationId: "conversation_demo_2" }, { skipIdentityValidation: true });

  await assert.rejects(
    () => service.requeueSendTask(task.id, { reason: "test invalid binding" }),
    /send task binding invalid/,
  );

  const updatedTask = localStore.getSendTask(task.id);
  assert.equal(updatedTask.status, "failed");
  assert.equal(updatedTask.errorMessage, "previous failure");
});

test("requeue records explicit manual audit reason", async () => {
  const { localStore, service } = setupService();
  const order = seedStoredOrderDraft(localStore, { id: "order_demo_1", status: "processing", paymentStatus: "deposit_paid" });

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "blocked",
    payload: { kind: "text", text: "manual requeue should keep reason" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_followup",
        valueLevel: "low",
        followupType: "production",
        orderDraftId: "order_demo_1",
      },
      history: [{ action: "manual_lock_block", fromStatus: "queued", reason: "manual takeover" }],
    },
  });

  const updated = await service.requeueSendTask(task.id, {
    reason: "manual_resolution_before_send_requeue",
  });

  assert.equal(updated.status, "queued");
  assert.equal(updated.guardSnapshot.requeueReason, "manual_resolution_before_send_requeue");
  assert.equal(updated.guardSnapshot.automation.valueLevel, "low");
  assert.equal(updated.guardSnapshot.automation.source, "order_followup");
  assert.equal(updated.guardSnapshot.automation.followupType, "production");
  assert.equal(updated.guardSnapshot.opsAlertedStatus, "requeued");
  assert.equal(updated.guardSnapshot.history.at(-1).action, "requeue");
  assert.equal(updated.guardSnapshot.history.at(-1).reason, "manual_resolution_before_send_requeue");

  const orderAfterRequeue = localStore.getOrderDraft("order_demo_1");
  assert.match(orderAfterRequeue.customerNotes, /\[发送任务:.*:requeue\]订单跟进发送已人工重新排队/);
  assert.match(orderAfterRequeue.customerNotes, /manual_resolution_before_send_requeue/);
  assert.equal(localStore.getQuoteDraft(order.quoteDraftId).status, "accepted");
});

test("requeue allows manual reply task while conversation remains manually locked", async () => {
  const { localStore, service } = setupService();
  localStore.updateConversation("conversation_demo_1", { manualLocked: true });

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    status: "blocked",
    payload: {
      kind: "text",
      text: "manual reply should requeue while locked",
      source: "manual_reply",
      manualReply: true,
      customerId: "customer_demo_1",
    },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      manualReply: true,
      history: [{ action: "manual_reply_blocked", fromStatus: "queued", reason: "expired window snapshot" }],
    },
  });

  const updated = await service.requeueSendTask(task.id, {
    ...demoExpectedIdentity(),
    reason: "manual_reply_retry_after_fresh_window_snapshot",
  });

  assert.equal(updated.status, "queued");
  assert.equal(updated.guardSnapshot.binding.ok, true);
  assert.equal(updated.guardSnapshot.binding.reason, "发送任务绑定关系正确");
  assert.equal(updated.guardSnapshot.manualReply, true);
  assert.equal(updated.guardSnapshot.requeueReason, "manual_reply_retry_after_fresh_window_snapshot");
  assert.equal(localStore.listConversations().find((item) => item.id === "conversation_demo_1").manualLocked, true);
});

test("low-value failed send task retries once before human alert", async () => {
  const { localStore, service } = setupService();
  seedStoredOrderDraft(localStore, { id: "order_demo_1", status: "processing", paymentStatus: "deposit_paid" });

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "failed",
    payload: { kind: "text", text: "low value automation should retry once" },
    errorMessage: "bridge temporary failure",
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_followup",
        valueLevel: "low",
        followupType: "production",
        orderDraftId: "order_demo_1",
      },
    },
  });

  const firstScan = await service.scanSendOperations();
  const retried = localStore.getSendTask(task.id);

  assert.equal(firstScan.autoRetriedLowValue, 1);
  assert.equal(firstScan.alerted, 0);
  assert.equal(firstScan.tasks.autoRetriedLowValue[0].id, task.id);
  assert.equal(retried.status, "queued");
  assert.equal(retried.guardSnapshot.lowValueAutoRetryCount, 1);
  assert.equal(retried.guardSnapshot.automation.valueLevel, "low");
  assert.equal(retried.guardSnapshot.automation.source, "order_followup");
  assert.equal(retried.guardSnapshot.opsAlertedStatus, "auto_retried");
  const retryNotice = localStore
    .listNotifications({ conversationId: "conversation_demo_1", customerId: "customer_demo_1" })
    .find((notice) => notice.target?.sendTaskId === task.id && notice.title === "低价值自动发送已重试");
  assert.ok(retryNotice);
  assert.equal(retryNotice.target.wechatAccountId, "wechat_demo_1");
  assert.equal(retryNotice.target.conversationId, "conversation_demo_1");
  assert.equal(retryNotice.target.customerId, "customer_demo_1");

  localStore.updateSendTask(task.id, {
    status: "failed",
    errorMessage: "second bridge failure",
  });
  const secondScan = await service.scanSendOperations();
  const failedAgain = localStore.getSendTask(task.id);

  assert.equal(secondScan.autoRetriedLowValue, 0);
  assert.equal(secondScan.alerted, 1);
  assert.equal(secondScan.tasks.alerted[0].id, task.id);
  assert.equal(failedAgain.status, "failed");
  assert.equal(failedAgain.guardSnapshot.lowValueAutoRetryCount, 1);
  assert.equal(failedAgain.guardSnapshot.opsAlertedStatus, "failed");
});

test("manual order queues ignore forged automation provenance and never auto retry", async () => {
  const { localStore, service } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_manual_provenance_1",
    status: "processing",
    paymentStatus: "deposit_paid",
  });
  const forgedAutomation = {
    source: "order_followup",
    valueLevel: "low",
    orderDraftId: "forged-order",
    quoteDraftId: "forged-quote",
    paymentStatus: "paid",
    queuedBy: "low_value_automation",
  };

  const confirmation = await service.queueOrderConfirmation(order.id, {
    ...demoExpectedIdentity(),
    operationKey: "manual-order-confirmation-provenance",
    owner: "local_admin",
    reason: "manual_confirmation",
    automation: forgedAutomation,
    source: forgedAutomation.source,
    queuedBy: forgedAutomation.queuedBy,
    orderDraftId: forgedAutomation.orderDraftId,
    paymentStatus: forgedAutomation.paymentStatus,
  });
  const followup = await service.queueOrderFollowup(order.id, {
    ...demoExpectedIdentity(),
    operationKey: "manual-order-followup-provenance",
    owner: "local_admin",
    type: "production",
    reason: "manual_followup",
    automation: forgedAutomation,
    source: forgedAutomation.source,
    queuedBy: forgedAutomation.queuedBy,
    orderDraftId: forgedAutomation.orderDraftId,
    paymentStatus: forgedAutomation.paymentStatus,
  });

  assert.equal(confirmation.sendTask.guardSnapshot.automation, undefined);
  assert.equal(followup.sendTask.guardSnapshot.automation, undefined);
  assert.deepEqual(confirmation.sendTask.guardSnapshot.orderContext, {
    source: "order_confirmation",
    orderDraftId: order.id,
    quoteDraftId: order.quoteDraftId,
    paymentStatus: "deposit_paid",
  });
  assert.deepEqual(followup.sendTask.guardSnapshot.orderContext, {
    source: "order_followup",
    orderDraftId: order.id,
    quoteDraftId: order.quoteDraftId,
    paymentStatus: "deposit_paid",
    followupType: "production",
  });
  localStore.updateSendTask(confirmation.sendTask.id, { status: "failed", errorMessage: "manual send failed" });
  localStore.updateSendTask(followup.sendTask.id, { status: "failed", errorMessage: "manual send failed" });

  const scan = await service.scanSendOperations();

  assert.equal(scan.autoRetriedLowValue, 0);
  assert.equal(scan.alerted, 2);
  assert.equal(localStore.getSendTask(confirmation.sendTask.id).status, "failed");
  assert.equal(localStore.getSendTask(followup.sendTask.id).status, "failed");

  const requeued = await service.requeueSendTask(confirmation.sendTask.id, {
    ...demoExpectedIdentity(),
    reason: "manual_retry_after_triage",
  });
  assert.equal(requeued.status, "queued");
  assert.equal(requeued.guardSnapshot.automation, undefined);
  assert.equal(requeued.guardSnapshot.orderContext.orderDraftId, order.id);
  assert.match(localStore.getOrderDraft(order.id).customerNotes, new RegExp(`发送任务:${confirmation.sendTask.id}:requeue`));
});

test("requeue rejects order confirmation task after order payment is refunded", async () => {
  const { localStore, service } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_demo_1",
    status: "confirmed",
    paymentStatus: "refunded",
  });

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "failed",
    payload: { kind: "text", text: "refunded order confirmation should not requeue" },
    errorMessage: "previous bridge failure",
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_confirmation",
        valueLevel: "low",
        orderDraftId: order.id,
      },
    },
  });

  await assert.rejects(() => service.requeueSendTask(task.id), /订单确认重新排队需要先核验定金或全款/);
  assert.equal(localStore.getSendTask(task.id).status, "failed");
});

test("requeue records order note for low-value quote acceptance order task", async () => {
  const { localStore, service } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_quote_acceptance_requeue_1",
    status: "confirmed",
    paymentStatus: "deposit_paid",
  });

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "failed",
    payload: { kind: "text", text: "quote acceptance order confirmation should requeue safely" },
    errorMessage: "previous bridge failure",
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "low_value_quote_acceptance",
        valueLevel: "low",
        quoteDraftId: order.quoteDraftId,
        orderDraftId: order.id,
      },
    },
  });

  const updated = await service.requeueSendTask(task.id, {
    reason: "quote_acceptance_order_requeue_after_operator_review",
  });
  const orderAfterRequeue = localStore.getOrderDraft(order.id);

  assert.equal(updated.status, "queued");
  assert.match(orderAfterRequeue.customerNotes, /\[发送任务:.*:requeue\]订单确认发送已人工重新排队/);
  assert.match(orderAfterRequeue.customerNotes, /quote_acceptance_order_requeue_after_operator_review/);
  assert.equal(localStore.getQuoteDraft(order.quoteDraftId).status, "accepted");
});

test("requeue rejects low-value quote acceptance order task after payment is refunded", async () => {
  const { localStore, service } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_quote_acceptance_refund_1",
    status: "confirmed",
    paymentStatus: "refunded",
  });

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "failed",
    payload: { kind: "text", text: "quote acceptance order confirmation should still recheck order" },
    errorMessage: "previous bridge failure",
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "low_value_quote_acceptance",
        valueLevel: "low",
        quoteDraftId: order.quoteDraftId,
        orderDraftId: order.id,
      },
    },
  });

  await assert.rejects(() => service.requeueSendTask(task.id), /订单确认重新排队需要先核验定金或全款/);
  assert.equal(localStore.getSendTask(task.id).status, "failed");
  assert.equal(localStore.getQuoteDraft(order.quoteDraftId).status, "accepted");
});

test("requeue rejects order follow-up task while conversation is manually locked", async () => {
  const { localStore, service } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_demo_1",
    status: "processing",
    paymentStatus: "deposit_paid",
  });

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "failed",
    payload: { kind: "text", text: "manual locked order follow-up should not requeue" },
    errorMessage: "previous bridge failure",
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_followup",
        valueLevel: "low",
        followupType: "production",
        orderDraftId: order.id,
      },
    },
  });
  await service.setConversationManualLock("conversation_demo_1", {
    ...demoExpectedIdentity(),
    locked: true,
    reviewer: "test",
    reason: "manual_takeover_test",
  });

  await assert.rejects(() => service.requeueSendTask(task.id), /会话已人工接管/);
  assert.equal(localStore.getSendTask(task.id).status, "failed");
});

test("low-value order confirmation scan skips failed confirmation for manual attention", async () => {
  const { localStore, service } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_scan_failed_confirmation_1",
    status: "confirmed",
    paymentStatus: "paid",
  });
  localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "failed",
    payload: { kind: "text", text: "failed confirmation should require manual attention" },
    errorMessage: "previous send failed",
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_confirmation",
        valueLevel: "low",
        orderDraftId: order.id,
      },
    },
  });

  const scan = await service.scanLowValueOrderConfirmations();

  assert.equal(scan.queued.length, 0);
  assert.equal(scan.failed.length, 0);
  assert.equal(scan.skipped.some((item) => item.orderDraftId === order.id && item.reason === "manual_send_attention_required"), true);
});

test("low-value order follow-up scan skips blocked current stage for manual attention", async () => {
  const { localStore, service } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_scan_blocked_followup_1",
    status: "processing",
    paymentStatus: "paid",
  });
  localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "blocked",
    payload: { kind: "text", text: "blocked production follow-up should require manual attention" },
    errorMessage: "window guard blocked",
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_followup",
        valueLevel: "low",
        followupType: "production",
        orderDraftId: order.id,
      },
    },
  });

  const scan = await service.scanLowValueOrderFollowups();

  assert.equal(scan.queued.length, 0);
  assert.equal(scan.failed.length, 0);
  assert.equal(scan.skipped.some((item) => item.orderDraftId === order.id && item.reason === "manual_send_attention_required"), true);
});

test("low-value auto retry failure keeps retry error for manual triage", async () => {
  const { localStore, service } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "low_value_retry_bad_binding_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [{ name: "礼盒", salePrice: 100, costPrice: 60 }] },
    requirements: {},
    status: "completed",
  });
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: designJob.id,
    status: "failed",
    payload: { kind: "text", text: "low value retry should keep failed reason" },
    errorMessage: "bridge temporary failure",
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_confirmation",
        valueLevel: "low",
        orderDraftId: "order_demo_1",
      },
    },
  });
  localStore.updateDesignJob(designJob.id, { conversationId: "conversation_demo_2" }, { skipIdentityValidation: true });

  const scan = await service.scanSendOperations();
  const updated = localStore.getSendTask(task.id);

  assert.equal(scan.autoRetriedLowValue, 0);
  assert.equal(scan.alerted, 1);
  assert.equal(scan.tasks.alerted[0].id, task.id);
  assert.equal(updated.status, "failed");
  assert.match(updated.guardSnapshot.lowValueAutoRetryError, /send task binding invalid/);
  assert.equal(updated.guardSnapshot.opsAlertedStatus, "failed");
  assert.equal(updated.guardSnapshot.automation.valueLevel, "low");
  const retryFailureNotice = localStore
    .listNotifications({ conversationId: "conversation_demo_1", customerId: "customer_demo_1" })
    .find((notice) => notice.target?.sendTaskId === task.id && notice.title === "低价值自动发送重试失败");
  assert.ok(retryFailureNotice);
  assert.equal(retryFailureNotice.target.wechatAccountId, "wechat_demo_1");
  assert.equal(retryFailureNotice.target.conversationId, "conversation_demo_1");
  assert.equal(retryFailureNotice.target.customerId, "customer_demo_1");
});

test("cancel records explicit manual audit reason", () => {
  const { localStore, service } = setupService();

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "blocked",
    payload: { kind: "text", text: "manual cancel should keep reason" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      blockedByManualLock: true,
      history: [{ action: "manual_lock_block", fromStatus: "queued", reason: "manual takeover" }],
    },
  });

  const updated = service.cancelSendTask(task.id, {
    reason: "manual_takeover_cancel_send_task",
  });

  assert.equal(updated.status, "cancelled");
  assert.equal(updated.guardSnapshot.cancelReason, "manual_takeover_cancel_send_task");
  assert.ok(updated.guardSnapshot.cancelledAt);
  assert.equal(updated.guardSnapshot.history.at(-1).action, "cancel");
  assert.equal(updated.guardSnapshot.history.at(-1).reason, "manual_takeover_cancel_send_task");
});

test("cancel order send task records order note without changing quote status", () => {
  const { localStore, service } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_cancel_note_1",
    status: "confirmed",
    paymentStatus: "deposit_paid",
  });
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "queued",
    payload: { kind: "text", text: "cancel order send task should write order note" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "low_value_quote_acceptance",
        valueLevel: "low",
        quoteDraftId: order.quoteDraftId,
        orderDraftId: order.id,
      },
    },
  });

  const updated = service.cancelSendTask(task.id, {
    reason: "manual_cancel_order_confirmation_before_send",
  });
  const cancelledOrder = localStore.getOrderDraft(order.id);
  const quote = localStore.getQuoteDraft(order.quoteDraftId);

  assert.equal(updated.status, "cancelled");
  assert.match(cancelledOrder.customerNotes, new RegExp(`\\[发送任务:${task.id}\\]`));
  assert.match(cancelledOrder.customerNotes, /订单确认发送失败，需要人工处理/);
  assert.match(cancelledOrder.customerNotes, /manual_cancel_order_confirmation_before_send/);
  assert.equal(quote.status, "accepted");
});

test("cancelled order draft cancels pending order send tasks only", async () => {
  const { localStore, orders } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_cancel_clears_pending_sends_1",
    status: "confirmed",
    paymentStatus: "deposit_paid",
  });
  const confirmation = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "queued",
    payload: { kind: "text", text: "pending order confirmation should be cancelled" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "low_value_quote_acceptance",
        valueLevel: "low",
        quoteDraftId: order.quoteDraftId,
        orderDraftId: order.id,
      },
    },
  });
  const followup = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "blocked",
    payload: { kind: "text", text: "pending production follow-up should be cancelled", followupType: "production" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_followup",
        valueLevel: "low",
        followupType: "production",
        orderDraftId: order.id,
      },
    },
  });
  const unrelated = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "normal conversation reply should stay queued" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: { source: "scene_reply", valueLevel: "low" },
    },
  });

  const updated = await orders.update(order.id, {
    ...demoExpectedIdentity(),
    status: "cancelled",
    owner: "人工客服",
    customerNotes: "客户取消订单",
  });

  const cancelledConfirmation = localStore.getSendTask(confirmation.id);
  const cancelledFollowup = localStore.getSendTask(followup.id);
  const keptUnrelated = localStore.getSendTask(unrelated.id);
  const notification = localStore
    .listNotifications()
    .find((item) => item.target?.orderDraftId === order.id && item.target?.cancelledSendTaskIds?.length === 2);

  assert.equal(updated.status, "cancelled");
  assert.equal(cancelledConfirmation.status, "cancelled");
  assert.equal(cancelledConfirmation.guardSnapshot.cancelReason, "order_cancelled_before_send");
  assert.equal(cancelledConfirmation.guardSnapshot.orderSendState.reason, "orderCancelledBeforeSend");
  assert.equal(cancelledConfirmation.guardSnapshot.history.at(-1).fromStatus, "queued");
  assert.equal(cancelledFollowup.status, "cancelled");
  assert.equal(cancelledFollowup.guardSnapshot.history.at(-1).fromStatus, "blocked");
  assert.equal(keptUnrelated.status, "queued");
  assert.ok(notification);
});

test("generic order update rejects refunded payment before touching pending sends", async () => {
  const { localStore, orders } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_refund_clears_pending_sends_1",
    status: "confirmed",
    paymentStatus: "deposit_paid",
  });
  const confirmation = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "queued",
    payload: { kind: "text", text: "pending order confirmation should be cancelled after refund" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_confirmation",
        valueLevel: "low",
        quoteDraftId: order.quoteDraftId,
        orderDraftId: order.id,
      },
    },
  });
  const unrelated = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "normal conversation reply should stay queued after refund" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: { source: "scene_reply", valueLevel: "low" },
    },
  });

  await assert.rejects(
    orders.update(order.id, {
      ...demoExpectedIdentity(),
      paymentStatus: "refunded",
      owner: "人工客服",
      customerNotes: "客户退款，停止自动确认",
    }),
    /付款状态只能通过报价付款凭证核验入口更新/,
  );

  const cancelledConfirmation = localStore.getSendTask(confirmation.id);
  const keptUnrelated = localStore.getSendTask(unrelated.id);
  const notification = localStore
    .listNotifications()
    .find((item) => item.target?.orderDraftId === order.id && item.target?.cancelledSendTaskIds?.includes(confirmation.id));

  assert.equal(localStore.getOrderDraft(order.id).paymentStatus, "deposit_paid");
  assert.equal(cancelledConfirmation.status, "queued");
  assert.equal(cancelledConfirmation.errorMessage, undefined);
  assert.equal(keptUnrelated.status, "queued");
  assert.equal(notification, undefined);
});

test("generic quote update rejects refunded payment before touching linked order sends", async () => {
  const { localStore, quotes } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_quote_refund_clears_pending_sends_1",
    status: "confirmed",
    paymentStatus: "deposit_paid",
  });
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "queued",
    payload: { kind: "text", text: "pending order confirmation should be cancelled after quote refund" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_confirmation",
        valueLevel: "low",
        quoteDraftId: order.quoteDraftId,
        orderDraftId: order.id,
      },
    },
  });

  await assert.rejects(
    quotes.update(order.quoteDraftId, {
      ...demoExpectedIdentity(),
      paymentStatus: "refunded",
      owner: "人工客服",
      customerNotes: "客户退款，报价停止推进",
    }),
    /付款状态只能通过付款凭证核验入口更新/,
  );

  const syncedOrder = localStore.getOrderDraft(order.id);
  const cancelledTask = localStore.getSendTask(task.id);

  assert.equal(localStore.getQuoteDraft(order.quoteDraftId).paymentStatus, "deposit_paid");
  assert.equal(syncedOrder.paymentStatus, "deposit_paid");
  assert.equal(cancelledTask.status, "queued");
});

test("manual rejected order review reuses order cancellation send cleanup", async () => {
  const { localStore, reviews } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_review_reject_clears_pending_sends_1",
    status: "confirmed",
    paymentStatus: "deposit_paid",
    totalPrice: 12000,
    unitPrice: 240,
  });
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "queued",
    payload: { kind: "text", text: "pending high-value confirmation should be cancelled after rejection" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "manual_order_review",
        valueLevel: "high",
        orderDraftId: order.id,
      },
    },
  });

  const result = await reviews.reviewOrder(order.id, {
    ...demoExpectedIdentity(),
    decision: "reject_order",
    reviewer: "人工客服",
    note: "人工审核不通过，停止推进",
  });

  const rejectedOrder = localStore.getOrderDraft(order.id);
  const cancelledTask = localStore.getSendTask(task.id);

  assert.equal(result.result.orderDraft.status, "cancelled");
  assert.equal(result.log.afterStatus, "cancelled");
  assert.equal(rejectedOrder.status, "cancelled");
  assert.equal(cancelledTask.status, "cancelled");
  assert.equal(cancelledTask.guardSnapshot.cancelReason, "order_cancelled_before_send");
  assert.equal(cancelledTask.guardSnapshot.orderSendState.reason, "orderCancelledBeforeSend");
});

test("requeue rejects audited cancelled send task", async () => {
  const { localStore, service } = setupService();

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "blocked",
    payload: { kind: "text", text: "cancelled task should stay terminal" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });
  service.cancelSendTask(task.id, {
    reason: "manual_takeover_cancel_send_task",
  });

  await assert.rejects(
    () => service.requeueSendTask(task.id, { reason: "manual_resolution_before_send_requeue" }),
    /人工取消|审计|audited_cancelled_task/,
  );

  const updated = localStore.getSendTask(task.id);
  assert.equal(updated.status, "cancelled");
  assert.equal(updated.guardSnapshot.cancelReason, "manual_takeover_cancel_send_task");
});

test("cancel rejects audited cancelled send task without overwriting audit", () => {
  const { localStore, service } = setupService();
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "cancel audit should stay immutable" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });
  const firstCancel = service.cancelSendTask(task.id, {
    reason: "manual_takeover_cancel_send_task",
  });

  assert.throws(
    () => service.cancelSendTask(task.id, { reason: "second_cancel_should_not_overwrite" }),
    /已人工取消并记录审计/,
  );

  const updated = localStore.getSendTask(task.id);
  assert.equal(updated.status, "cancelled");
  assert.equal(updated.guardSnapshot.cancelReason, "manual_takeover_cancel_send_task");
  assert.equal(updated.guardSnapshot.cancelledAt, firstCancel.guardSnapshot.cancelledAt);
  assert.equal(
    updated.guardSnapshot.history.filter((entry) => entry.action === "cancel").length,
    1,
  );
});

test("execute send blocks task after its design binding becomes invalid", () => {
  const { localStore, service } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "execute_bad_binding_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [] },
    requirements: {},
    status: "completed",
  });
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: designJob.id,
    status: "queued",
    payload: { kind: "text", text: "should not execute with bad binding" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });
  localStore.updateDesignJob(designJob.id, { conversationId: "conversation_demo_2" }, { skipIdentityValidation: true });

  const result = service.executeDryRunSend(task.id);
  const attempts = localStore.listSendAttempts({ sendTaskId: task.id });

  assert.equal(result.task.status, "blocked");
  assert.match(result.task.errorMessage, /send task binding invalid/);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "blocked");
  assert.equal(attempts[0].guardStatus, "binding_failed");
});

test("execute send blocks queued quote task when quote returned to manual review before send", () => {
  const { localStore, service } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "execute_manual_quote_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [{ name: "保温杯", salePrice: 100, costPrice: 60 }] },
    requirements: {},
    status: "completed",
  });
  const images = localStore.upsertDesignImages(designJob.id, [
    {
      imageId: "execute_manual_quote_candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\execute_manual_quote_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/execute_manual_quote_candidate_1.png",
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(designJob.id, images[0].id);
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: designJob.id,
    quoteDraftId: quote.id,
    status: "queued",
    payload: { kind: "quote", quoteDraftId: quote.id, text: "这条报价状态变化后不能再发送" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "low_value_quote_send",
        valueLevel: "low",
        quoteDraftId: quote.id,
      },
    },
  });
  localStore.updateQuoteDraft(quote.id, {
    status: "send_queued",
    sendTaskId: task.id,
  });
  localStore.updateQuoteDraft(quote.id, {
    status: "manual_review",
    sendTaskId: null,
    customerNotes: "客户改需求，报价回到人工审核。",
  });

  const result = service.executeDryRunSend(task.id);
  const attempts = localStore.listSendAttempts({ sendTaskId: task.id });
  const quoteAfterBlock = localStore.getQuoteDraft(quote.id);

  assert.equal(result.task.status, "blocked");
  assert.match(result.task.errorMessage, /quote is no longer bound to this send task/);
  assert.equal(result.task.guardSnapshot.quoteSendState.reason, "quoteSendTaskChangedBeforeSend");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "blocked");
  assert.equal(attempts[0].guardStatus, "quoteSendTaskChangedBeforeSend");
  assert.equal(quoteAfterBlock.status, "manual_review");
  assert.equal(quoteAfterBlock.sendTaskId, null);
  assert.match(quoteAfterBlock.customerNotes, /客户改需求/);
});

test("execute send blocks queued order task when payment is refunded before send", () => {
  const { localStore, service } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "execute_refunded_order_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [{ name: "保温杯", salePrice: 100, costPrice: 60 }] },
    requirements: {},
    status: "completed",
  });
  const images = localStore.upsertDesignImages(designJob.id, [
    {
      imageId: "execute_refunded_order_candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\execute_refunded_order_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/execute_refunded_order_candidate_1.png",
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(designJob.id, images[0].id);
  const order = localStore.upsertOrderDraftFromQuote(quote.id, {
    designJobId: designJob.id,
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    selectedImageId: images[0].id,
    quantity: 10,
    unitPrice: 100,
    totalPrice: 1000,
    totalCost: 600,
    profit: 400,
    status: "confirmed",
    paymentStatus: "deposit_paid",
    bundleSnapshot: designJob.bundle,
  });
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: designJob.id,
    quoteDraftId: quote.id,
    status: "queued",
    payload: { kind: "text", text: "订单确认发送前必须重新校验付款状态" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_confirmation",
        valueLevel: "low",
        orderDraftId: order.id,
      },
    },
  });
  localStore.updateOrderDraft(order.id, { paymentStatus: "refunded" });

  const result = service.executeDryRunSend(task.id);
  const attempts = localStore.listSendAttempts({ sendTaskId: task.id });

  assert.equal(result.task.status, "blocked");
  assert.match(result.task.errorMessage, /payment is no longer verified/);
  assert.equal(result.task.guardSnapshot.orderSendState.reason, "orderPaymentNotReadyBeforeSend");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "blocked");
  assert.equal(attempts[0].guardStatus, "orderPaymentNotReadyBeforeSend");
  const blockedOrder = localStore.getOrderDraft(order.id);
  assert.equal(blockedOrder.owner, "人工客服");
  assert.match(blockedOrder.customerNotes, new RegExp(`\\[发送任务:${task.id}\\]`));
  assert.match(blockedOrder.customerNotes, /订单确认发送失败，需要人工处理/);
});

test("execute send blocks queued order follow-up when order is cancelled before send", () => {
  const { localStore, service } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "execute_cancelled_order_followup_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [{ name: "保温杯", salePrice: 100, costPrice: 60 }] },
    requirements: {},
    status: "completed",
  });
  const images = localStore.upsertDesignImages(designJob.id, [
    {
      imageId: "execute_cancelled_order_followup_candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\execute_cancelled_order_followup_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/execute_cancelled_order_followup_candidate_1.png",
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(designJob.id, images[0].id);
  const order = localStore.upsertOrderDraftFromQuote(quote.id, {
    designJobId: designJob.id,
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    selectedImageId: images[0].id,
    quantity: 10,
    unitPrice: 100,
    totalPrice: 1000,
    totalCost: 600,
    profit: 400,
    status: "processing",
    paymentStatus: "paid",
    bundleSnapshot: designJob.bundle,
  });
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: designJob.id,
    quoteDraftId: quote.id,
    status: "queued",
    payload: { kind: "text", text: "生产跟进发送前必须重新校验订单状态" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_followup",
        valueLevel: "low",
        followupType: "production",
        orderDraftId: order.id,
      },
    },
  });
  localStore.updateOrderDraft(order.id, { status: "cancelled" });

  const result = service.executeDryRunSend(task.id);
  const attempts = localStore.listSendAttempts({ sendTaskId: task.id });

  assert.equal(result.task.status, "blocked");
  assert.match(result.task.errorMessage, /order was cancelled/);
  assert.equal(result.task.guardSnapshot.orderSendState.reason, "orderCancelledBeforeSend");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "blocked");
  assert.equal(attempts[0].guardStatus, "orderCancelledBeforeSend");
  const blockedOrder = localStore.getOrderDraft(order.id);
  assert.equal(blockedOrder.owner, "人工客服");
  assert.match(blockedOrder.customerNotes, new RegExp(`\\[发送任务:${task.id}\\]`));
  assert.match(blockedOrder.customerNotes, /订单跟进发送失败，需要人工处理/);
});

test("send task validation requires matching account conversation identity", () => {
  const { localStore, service } = setupService();
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "identity scoped validation" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });

  assert.throws(
    () =>
      service.validateSendTask(task.id, {
        expectedWechatAccountId: "wechat_demo_2",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
      }),
    /send task identity mismatch/,
  );
  assert.throws(
    () =>
      service.validateSendTaskWithCurrentWindow(task.id, {
        expectedWechatAccountId: "wechat_demo_1",
        expectedConversationId: "conversation_demo_2",
        expectedCustomerId: "customer_demo_1",
      }),
    /send task identity mismatch/,
  );

  const result = service.validateSendTask(task.id, {
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
    activeWindow: {
      source: "windows_foreground_observer",
      wechatAccountId: "wechat_demo_1",
      chatTitle: "forged-browser-window",
      recentCustomerId: "customer_demo_1",
      diagnostic: {
        observerEvidence: {
          verified: true,
          version: "wechat_window_observer_v1",
          nonceHash: "a".repeat(64),
        },
      },
    },
  });

  assert.equal(result.id, task.id);
  assert.equal(result.wechatAccountId, "wechat_demo_1");
  assert.equal(result.conversationId, "conversation_demo_1");
  assert.equal(result.guardSnapshot.status, "blocked");
  assert.equal(result.guardSnapshot.failedKeys.includes("windowSnapshotMissing"), true);
  assert.equal(result.guardSnapshot.activeWindow, null);
});

test("current window validation records missing snapshot diagnostic for operator triage", () => {
  const { localStore, service } = setupService();
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "missing current window snapshot should be auditable" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });

  const result = service.validateSendTaskWithCurrentWindow(task.id, demoExpectedIdentity());

  assert.equal(result.status, "blocked");
  assert.equal(result.guardSnapshot.status, "blocked");
  assert.equal(result.guardSnapshot.windowSnapshotId, null);
  assert.equal(result.guardSnapshot.activeWindow, null);
  assert.equal(result.guardSnapshot.windowDiagnostic.ok, false);
  assert.equal(result.guardSnapshot.windowDiagnostic.reason, "没有可用的微信窗口快照");
  assert.deepEqual(result.guardSnapshot.failedKeys, ["windowSnapshotMissing"]);
});

test("current window validation preserves failed window diagnostic details", () => {
  const { localStore, service } = setupService();
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "failed current window snapshot should be visible" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });
  const snapshot = localStore.createWechatWindowSnapshot({
    source: "test",
    isOnline: true,
    wechatAccountId: "wechat_demo_1",
    chatTitle: "not a known customer",
    activeChatTitle: "not a known customer",
    recentCustomerId: "customer_demo_2",
    confidence: 1,
    capturedAt: new Date().toISOString(),
  });

  const result = service.validateSendTaskWithCurrentWindow(task.id, demoExpectedIdentity());

  assert.equal(snapshot.diagnostic.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.guardSnapshot.windowSnapshotId, snapshot.id);
  assert.equal(result.guardSnapshot.activeWindow.id, snapshot.id);
  assert.equal(result.guardSnapshot.windowDiagnostic.ok, false);
  assert.equal(result.guardSnapshot.windowDiagnostic.reason, snapshot.diagnostic.reason);
  assert.deepEqual(result.guardSnapshot.failedKeys, snapshot.diagnostic.failedKeys);
});

test("window snapshot inbox accepts only fresh signed observer evidence and rejects replay plus demo sending", () => {
  const { tempDir, localStore, service } = setupService();
  const proofToken = "9".repeat(64);
  const inboxDir = path.join(tempDir, "window-snapshots");
  appConfig.wechatWindowSnapshotInboxDir = inboxDir;
  appConfig.wechatWindowObserverProofToken = proofToken;
  fs.writeFileSync(appConfig.wechatWindowObserverProofFile, `${proofToken}\n`, "utf8");
  appConfig.wechatWindowSnapshotMaxAgeSeconds = 30;
  fs.mkdirSync(inboxDir, { recursive: true });

  fs.writeFileSync(path.join(inboxDir, "forged.json"), JSON.stringify({
    source: "windows_foreground_observer",
    isOnline: true,
    wechatAccountId: "wechat_demo_1",
    chatTitle: "王总-端午礼盒",
    recentCustomerId: "customer_demo_1",
    confidence: 1,
    capturedAt: new Date().toISOString(),
  }));
  const forgedScan = service.scanWindowSnapshotInbox();
  assert.equal(forgedScan.processed.length, 0);
  assert.equal(forgedScan.failed.length, 1);
  assert.match(forgedScan.failed[0].errorMessage, /observer evidence\[0\] rejected/);
  assert.equal(localStore.listWechatWindowSnapshots().length, 0);

  const capturedAt = new Date().toISOString();
  const evidence = createWechatWindowObserverEvidence({
    source: "attacker_source_is_canonicalized",
    isOnline: true,
    wechatAccountId: "wechat_demo_1",
    accountDisplayName: "微信客服1号",
    windowHandle: "123",
    processId: 456,
    chatTitle: "王总-端午礼盒",
    activeChatTitle: "王总-端午礼盒",
    externalChatId: "demo_wang_chat",
    recentCustomerId: "customer_demo_1",
    recentMessageText: "observer proof",
    confidence: 0.1,
    capturedAt,
    raw: { processName: "WeChat" },
  }, proofToken, { issuedAt: capturedAt, nonce: "e".repeat(48) });
  fs.writeFileSync(path.join(inboxDir, "signed.json"), JSON.stringify(evidence));
  const signedScan = service.scanWindowSnapshotInbox();
  assert.equal(signedScan.failed.length, 0);
  assert.equal(signedScan.processed.length, 1);
  const trusted = localStore.getLatestWechatWindowSnapshot("wechat_demo_1");
  assert.equal(trusted.source, "windows_foreground_observer");
  assert.equal(trusted.capturedAt, capturedAt);
  assert.equal(trusted.confidence, 0.95);
  assert.equal(trusted.diagnostic.observerEvidence.verified, true);

  fs.writeFileSync(path.join(inboxDir, "replay.json"), JSON.stringify(evidence));
  const replayScan = service.scanWindowSnapshotInbox();
  assert.equal(replayScan.processed.length, 0);
  assert.equal(replayScan.failed.length, 1);
  assert.match(replayScan.failed[0].errorMessage, /replay rejected/);
  assert.equal(localStore.listWechatWindowSnapshots().length, 1);

  const rotatedToken = "8".repeat(64);
  fs.writeFileSync(appConfig.wechatWindowObserverProofFile, `${rotatedToken}\n`, "utf8");
  const rotatedCapturedAt = new Date().toISOString();
  const rotatedEvidence = createWechatWindowObserverEvidence(
    { ...evidence.snapshot, capturedAt: rotatedCapturedAt },
    rotatedToken,
    { issuedAt: rotatedCapturedAt, nonce: "f".repeat(48) },
  );
  fs.writeFileSync(path.join(inboxDir, "rotated.json"), JSON.stringify(rotatedEvidence));
  const rotatedScan = service.scanWindowSnapshotInbox();
  assert.equal(rotatedScan.failed.length, 0);
  assert.equal(rotatedScan.processed.length, 1);
  const trustedAfterRotation = localStore.getLatestWechatWindowSnapshot("wechat_demo_1");
  assert.match(trustedAfterRotation.diagnostic.observerEvidence.attestation, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(trustedAfterRotation).includes(rotatedToken), false);

  const demo = service.createDemoWindowSnapshot({
    mode: "correct",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    ...demoExpectedIdentity(),
  });
  assert.equal(demo.diagnostic.observerEvidence.verified, false);
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "demo must not send" },
  });
  const execution = service.executeSend(task.id, { adapter: "windows_bridge", ...demoExpectedIdentity() });
  assert.equal(execution.task.status, "blocked");
  assert.equal(execution.attempt.status, "blocked");
  assert.equal(execution.task.guardSnapshot.failedKeys.includes("verifiedObserverEvidence"), true);
});

test("send attempt list by task id requires matching account conversation identity", () => {
  const { localStore, service } = setupService();
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "identity scoped attempts" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });
  const attempt = localStore.createSendAttempt({
    sendTaskId: task.id,
    adapter: "dry_run",
    status: "started",
    guardStatus: "passed",
    payloadSummary: { kind: "text", textLength: 24 },
  });

  assert.throws(
    () => service.listSendAttempts({ sendTaskId: task.id }),
    /send attempts require conversation identity: wechatAccountId, conversationId, customerId/,
  );
  assert.throws(
    () =>
      service.listSendAttempts({
        sendTaskId: task.id,
        wechatAccountId: "wechat_demo_2",
        conversationId: "conversation_demo_1",
        customerId: "customer_demo_1",
      }),
    /send task identity mismatch/,
  );

  const attempts = service.listSendAttempts({
    sendTaskId: task.id,
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  });

  assert.deepEqual(attempts.map((item) => item.id), [attempt.id]);
});

test("manual send scans and queue processing stay scoped to selected conversation identity", async () => {
  const { localStore, service } = setupService();
  localStore.updateConversation("conversation_demo_1", { manualLocked: false });
  const taskOne = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "only selected conversation should be scanned" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });
  localStore.updateConversation("conversation_demo_2", { manualLocked: false });
  const taskTwo = localStore.createSendTask({
    wechatAccountId: "wechat_demo_2",
    conversationId: "conversation_demo_2",
    status: "queued",
    payload: { kind: "text", text: "other account should not be touched" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });

  const filter = {
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  };
  const scan = await service.scanSendOperations(filter);
  assert.equal(scan.scanned, 1);

  const queue = await service.processSafeSendQueue({ ...filter, adapter: "dry_run" });
  assert.equal(queue.scanned, 1);
  assert.equal(localStore.getSendTask(taskOne.id).status !== "queued", true);
  assert.equal(localStore.getSendTask(taskTwo.id).status, "queued");
});

test("demo send task and window snapshot require matching conversation identity", () => {
  const { service } = setupService();

  assert.throws(
    () => service.createDemoSendTask({ operationKey: "demo-send-missing-identity", conversationId: "conversation_demo_1", wechatAccountId: "wechat_demo_1" }),
    /demo send task requires conversation identity/,
  );
  assert.throws(
    () =>
      service.createDemoSendTask({
        operationKey: "demo-send-mismatched-identity",
        conversationId: "conversation_demo_1",
        wechatAccountId: "wechat_demo_1",
        expectedWechatAccountId: "wechat_demo_2",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
      }),
    /demo send task identity mismatch/,
  );

  const task = service.createDemoSendTask({
    operationKey: "demo-send-matching-identity",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
  });
  assert.equal(task.wechatAccountId, "wechat_demo_1");
  assert.equal(task.conversationId, "conversation_demo_1");

  assert.throws(
    () =>
      service.createDemoWindowSnapshot({
        mode: "correct",
        conversationId: "conversation_demo_1",
        wechatAccountId: "wechat_demo_1",
      }),
    /demo window snapshot requires conversation identity/,
  );
  assert.throws(
    () =>
      service.createDemoWindowSnapshot({
        mode: "correct",
        conversationId: "conversation_demo_1",
        wechatAccountId: "wechat_demo_1",
        expectedWechatAccountId: "wechat_demo_1",
        expectedConversationId: "conversation_demo_2",
        expectedCustomerId: "customer_demo_1",
      }),
    /demo window snapshot identity mismatch/,
  );

  const snapshot = service.createDemoWindowSnapshot({
    mode: "correct",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
  });
  assert.equal(snapshot.wechatAccountId, "wechat_demo_1");
  assert.equal(snapshot.diagnostic.activeConversationId, "conversation_demo_1");
});

test("channel inbound test requires matching account conversation identity", async () => {
  const { service } = setupService();

  await assert.rejects(
    () =>
      service.processChannelInboundTest("personal_wechat", {
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
        customerId: "customer_demo_1",
        text: "我要看礼盒效果图",
      }),
    /channel inbound test requires conversation identity/,
  );
  await assert.rejects(
    () =>
      service.processChannelInboundTest("personal_wechat", {
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
        customerId: "customer_demo_1",
        expectedWechatAccountId: "wechat_demo_2",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
        text: "我要看礼盒效果图",
      }),
    /channel inbound test identity mismatch/,
  );

  const result = await service.processChannelInboundTest("personal_wechat", {
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
    text: "我要看礼盒效果图",
  });

  assert.equal(result.normalized.wechatAccountId, "wechat_demo_1");
  assert.equal(result.normalized.conversationId, "conversation_demo_1");
  assert.equal(result.normalized.customerId, "customer_demo_1");
});

test("local send task update rejects invalid binding changes by default", () => {
  const { localStore } = setupService();

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "normal task should keep valid binding" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });

  assert.throws(
    () => localStore.updateSendTask(task.id, { designJobId: "missing_design_job" }),
    /send task binding invalid/,
  );

  const updated = localStore.getSendTask(task.id);
  assert.equal(updated.designJobId, undefined);
  assert.equal(updated.status, "queued");
});

test("local send task creation rejects payload identity from another conversation", () => {
  const { localStore } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "payload_identity_request_1",
    status: "completed",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "礼盒设计",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    bundle: { items: [] },
  });
  const quote = localStore.createQuoteFromDesignJob(designJob.id);

  assert.throws(
    () =>
      localStore.createSendTask({
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
        designJobId: designJob.id,
        quoteDraftId: quote.id,
        status: "queued",
        payload: {
          kind: "quote",
          text: "wrong identity payload",
          wechatAccountId: "wechat_demo_2",
          conversationId: "conversation_demo_2",
          customerId: "customer_demo_2",
          designJobId: "other_design_job",
          quoteDraftId: "other_quote",
        },
      }),
    /send task binding invalid/,
  );
});

test("local send task image payload rejects paths from another design job", () => {
  const { localStore } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "send_image_binding_request_1",
    status: "completed",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "礼盒设计",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    bundle: { items: [] },
  });
  const otherJob = localStore.createDesignJob({
    requestId: "send_image_binding_request_2",
    status: "completed",
    customerId: "customer_demo_2",
    conversationId: "conversation_demo_2",
    wechatAccountId: "wechat_demo_2",
    scene: "enterprise gift",
    budget: { mode: "per_box", amount: 200, quantity: 20 },
    bundle: { items: [] },
  });
  const images = localStore.upsertDesignImages(designJob.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\send_image_binding_request_1\\candidate_1.png",
    },
  ]);
  const otherImages = localStore.upsertDesignImages(otherJob.id, [
    {
      imageId: "candidate_2",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\send_image_binding_request_2\\candidate_2.png",
    },
  ]);

  assert.throws(
    () =>
      localStore.createSendTask({
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
        designJobId: designJob.id,
        status: "queued",
        payload: {
          kind: "design_images",
          imagePaths: [otherImages[0].localPath],
        },
      }),
    /send task image binding invalid/,
  );

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: designJob.id,
    status: "queued",
    payload: {
      kind: "design_images",
      imagePaths: [images[0].localPath.toUpperCase()],
    },
  });

  assert.equal(task.payload.imagePaths[0], images[0].localPath.toUpperCase());
  assert.throws(
    () =>
      localStore.updateSendTask(task.id, {
        payload: {
          kind: "design_images",
          imagePaths: [otherImages[0].localPath],
        },
      }),
    /send task image binding invalid/,
  );
  assert.deepEqual(localStore.getSendTask(task.id).payload.imagePaths, [images[0].localPath.toUpperCase()]);
});

test("local send attempts reject identity metadata from another task context", () => {
  const { localStore } = setupService();

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "attempt should stay bound to one conversation" },
  });
  const wrongAccountSnapshot = localStore.createWechatWindowSnapshot({
    source: "test",
    isOnline: true,
    wechatAccountId: "wechat_demo_2",
    accountDisplayName: "wechat 2",
    chatTitle: "other chat",
    activeChatTitle: "other chat",
    recentCustomerId: "customer_demo_2",
    confidence: 1,
    capturedAt: new Date().toISOString(),
  });

  assert.throws(
    () =>
      localStore.createSendAttempt({
        sendTaskId: task.id,
        adapter: "dry_run",
        status: "blocked",
        metadata: {
          wechatAccountId: "wechat_demo_2",
          conversationId: "conversation_demo_2",
        },
      }),
    /send attempt binding invalid/,
  );
  assert.throws(
    () =>
      localStore.createSendAttempt({
        sendTaskId: task.id,
        adapter: "dry_run",
        status: "blocked",
        windowSnapshotId: wrongAccountSnapshot.id,
        metadata: { guardSnapshot: { status: "blocked" } },
      }),
    /send attempt binding invalid/,
  );

  const validSnapshot = createPassingWechatWindowSnapshot(localStore);
  const attempt = localStore.createSendAttempt({
    sendTaskId: task.id,
    adapter: "dry_run",
    status: "blocked",
    windowSnapshotId: validSnapshot.id,
    metadata: {
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      target: {
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
      },
    },
  });

  assert.equal(attempt.sendTaskId, task.id);
  assert.throws(
    () =>
      localStore.updateSendAttempt(attempt.id, {
        metadata: {
          sendTaskId: "send_other",
          target: {
            wechatAccountId: "wechat_demo_2",
            conversationId: "conversation_demo_2",
          },
        },
      }),
    /send attempt binding invalid/,
  );
  assert.equal(localStore.getLatestSendAttempt(task.id).metadata.wechatAccountId, "wechat_demo_1");
});

test("local notifications and review logs inherit target identity and reject conflicts", () => {
  const { localStore } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "notice_identity_request_1",
    status: "manual_review",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "identity notice",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    bundle: { items: [] },
  });
  const quote = localStore.createQuoteFromDesignJob(designJob.id);
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: designJob.id,
    quoteDraftId: quote.id,
    status: "queued",
    payload: { kind: "quote", text: "identity-bound quote" },
  });

  const notice = localStore.createNotification("warning", "identity notice", "body", {
    designJobId: designJob.id,
  });
  assert.equal(notice.target.conversationId, "conversation_demo_1");
  assert.equal(notice.target.customerId, "customer_demo_1");
  assert.equal(notice.target.wechatAccountId, "wechat_demo_1");
  assert.equal(notice.target.identityBinding.ok, true);
  assert.throws(
    () =>
      localStore.createNotification("warning", "wrong notice", "body", {
        designJobId: designJob.id,
        wechatAccountId: "wechat_demo_2",
      }),
    /notification target conversation binding invalid/,
  );

  const log = localStore.createReviewLog({
    targetType: "send_task",
    targetId: task.id,
    decision: "identity_check",
    metadata: {
      sendTaskId: task.id,
    },
  });
  assert.equal(log.metadata.conversationId, "conversation_demo_1");
  assert.equal(log.metadata.customerId, "customer_demo_1");
  assert.equal(log.metadata.wechatAccountId, "wechat_demo_1");
  assert.equal(log.metadata.identityBinding.ok, true);
  assert.throws(
    () =>
      localStore.createReviewLog({
        targetType: "quote",
        targetId: quote.id,
        decision: "wrong_identity",
        metadata: {
          quoteDraftId: quote.id,
          customerId: "customer_demo_2",
        },
      }),
    /review log metadata customer binding invalid/,
  );
});

test("local identity list filters keep account customer and conversation data isolated", () => {
  const { localStore } = setupService();
  localStore.updateConversation("conversation_demo_2", { manualLocked: false });

  const job1 = localStore.createDesignJob({
    requestId: "list_filter_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "list filter one",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    bundle: { items: [{ skuCode: "BOX-A", name: "box one", costPrice: 30, salePrice: 60 }] },
  });
  const job2 = localStore.createDesignJob({
    requestId: "list_filter_request_2",
    status: "sent",
    customerId: "customer_demo_2",
    conversationId: "conversation_demo_2",
    wechatAccountId: "wechat_demo_2",
    scene: "list filter two",
    budget: { mode: "per_box", amount: 200, quantity: 5 },
    bundle: { items: [{ skuCode: "BOX-B", name: "box two", costPrice: 40, salePrice: 90 }] },
  });
  const [image1] = localStore.upsertDesignImages(job1.id, [
    { imageId: "candidate_filter_1", position: 1, localPath: "C:\\storage\\list-filter\\one.png" },
  ]);
  const [image2] = localStore.upsertDesignImages(job2.id, [
    { imageId: "candidate_filter_2", position: 1, localPath: "C:\\storage\\list-filter\\two.png" },
  ]);
  const quote1 = localStore.createQuoteFromDesignJob(job1.id, image1.id);
  const quote2 = localStore.createQuoteFromDesignJob(job2.id, image2.id);
  const order1 = localStore.upsertOrderDraftFromQuote(quote1.id, {
    designJobId: job1.id,
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    selectedImageId: image1.id,
    quantity: 10,
    unitPrice: 60,
    totalPrice: 600,
    totalCost: 300,
    profit: 300,
    status: "confirmed",
    paymentStatus: "unpaid",
  });
  const order2 = localStore.upsertOrderDraftFromQuote(quote2.id, {
    designJobId: job2.id,
    customerId: "customer_demo_2",
    conversationId: "conversation_demo_2",
    wechatAccountId: "wechat_demo_2",
    selectedImageId: image2.id,
    quantity: 5,
    unitPrice: 90,
    totalPrice: 450,
    totalCost: 200,
    profit: 250,
    status: "confirmed",
    paymentStatus: "unpaid",
  });
  const send1 = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: job1.id,
    quoteDraftId: quote1.id,
    status: "queued",
    payload: { kind: "quote", text: "quote one" },
  });
  const send2 = localStore.createSendTask({
    wechatAccountId: "wechat_demo_2",
    conversationId: "conversation_demo_2",
    designJobId: job2.id,
    quoteDraftId: quote2.id,
    status: "queued",
    payload: { kind: "quote", text: "quote two" },
  });

  assert.deepEqual(localStore.listDesignJobs({ wechatAccountId: "wechat_demo_1" }).map((item) => item.id), [job1.id]);
  assert.deepEqual(localStore.listDesignJobs({ customerId: "customer_demo_2" }).map((item) => item.id), [job2.id]);
  assert.deepEqual(localStore.listQuoteDrafts({ wechatAccountId: "wechat_demo_1" }).map((item) => item.id), [quote1.id]);
  assert.deepEqual(localStore.listQuoteDrafts({ conversationId: "conversation_demo_2" }).map((item) => item.id), [quote2.id]);
  assert.deepEqual(localStore.listOrderDrafts({ customerId: "customer_demo_1" }).map((item) => item.id), [order1.id]);
  assert.deepEqual(localStore.listOrderDrafts({ wechatAccountId: "wechat_demo_2" }).map((item) => item.id), [order2.id]);
  assert.deepEqual(localStore.listSendTasks({ conversationId: "conversation_demo_1" }).map((item) => item.id), [send1.id]);
  assert.deepEqual(localStore.listSendTasks({ wechatAccountId: "wechat_demo_2" }).map((item) => item.id), [send2.id]);
  assert.deepEqual(localStore.listSendTasks({ wechatAccountId: "wechat_demo_1", customerId: "customer_demo_2" }), []);
});

test("local design job update rejects invalid conversation binding changes by default", () => {
  const { localStore } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "design_update_binding_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [] },
    requirements: {},
    status: "completed",
  });

  assert.throws(
    () => localStore.updateDesignJob(designJob.id, { conversationId: "conversation_demo_2" }),
    /design job identity invalid/,
  );

  const updated = localStore.getDesignJob(designJob.id);
  assert.equal(updated.conversationId, "conversation_demo_1");
  assert.equal(updated.customerId, "customer_demo_1");
  assert.equal(updated.wechatAccountId, "wechat_demo_1");
});

test("local design images stay bound to their target design job", () => {
  const { localStore } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "image_binding_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [] },
    requirements: {},
    status: "completed",
  });

  const images = localStore.upsertDesignImages(designJob.id, [
    {
      imageId: "candidate_1",
      designJobId: "other_design_job",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\image_binding_request_1\\candidate_1.png",
    },
  ]);

  assert.equal(images.length, 1);
  assert.equal(images[0].designJobId, designJob.id);
  assert.throws(
    () => localStore.selectDesignImage(designJob.id, "other_conversation_candidate", "bad selection"),
    /design image not found in design job/,
  );

  localStore.selectDesignImage(designJob.id, images[0].id, "valid selection");
  const updated = localStore.getDesignJob(designJob.id);
  assert.equal(updated.images[0].selected, true);
  assert.equal(updated.images[0].customerFeedback, "valid selection");
});

test("order image revision syncs selected marker on design candidates", async () => {
  const { localStore, orders } = setupService();
  const job = localStore.createDesignJob({
    requestId: "order_selection_marker_sync_request_1",
    status: "completed",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "端午员工福利礼盒",
    budget: { mode: "per_box", amount: 180, quantity: 20 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\order_selection_marker_sync_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
    {
      imageId: "candidate_2",
      position: 2,
      localPath: "C:\\storage\\design-jobs\\order_selection_marker_sync_request_1\\candidate_2.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_2.png",
    },
  ]);
  localStore.selectDesignImage(job.id, images[0].id, "客户先选第1张");
  const quote = localStore.createQuoteFromDesignJob(job.id, images[0].id);
  localStore.updateQuoteDraft(quote.id, { status: "accepted", paymentStatus: "unpaid" });
  const order = await orders.createFromQuote(quote.id);

  const revised = await orders.reviseSelectedImage(order.id, {
    selectedImageId: images[1].id,
    owner: "人工客服",
  });
  const updatedJob = localStore.getDesignJob(job.id);
  const firstImage = updatedJob.images.find((image) => image.id === images[0].id);
  const secondImage = updatedJob.images.find((image) => image.id === images[1].id);
  const updatedQuote = localStore.getQuoteDraft(quote.id);

  assert.equal(revised.selectedImageId, images[1].id);
  assert.equal(updatedQuote.selectedImageId, images[1].id);
  assert.equal(firstImage.selected, false);
  assert.equal(secondImage.selected, true);
  assert.match(secondImage.customerFeedback, /重新选择第 2 张效果图/);
});

test("local design revisions reject selected images from another design job", () => {
  const { localStore } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "revision_binding_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [] },
    requirements: {},
    status: "completed",
  });
  const otherJob = localStore.createDesignJob({
    requestId: "revision_binding_request_2",
    customerId: "customer_demo_2",
    conversationId: "conversation_demo_2",
    wechatAccountId: "wechat_demo_2",
    budget: { mode: "per_box", amount: 300, quantity: 20 },
    scene: "enterprise gift",
    bundle: { items: [] },
    requirements: {},
    status: "completed",
  });
  const images = localStore.upsertDesignImages(designJob.id, [{ imageId: "candidate_1", position: 1 }]);
  const otherImages = localStore.upsertDesignImages(otherJob.id, [{ imageId: "candidate_2", position: 1 }]);

  assert.throws(
    () =>
      localStore.createDesignRevision({
        designJobId: designJob.id,
        selectedImageId: otherImages[0].id,
        instruction: "不要引用别的客户图片",
      }),
    /design revision binding invalid/,
  );

  const revision = localStore.createDesignRevision({
    designJobId: designJob.id,
    selectedImageId: images[0].id,
    instruction: "change background",
  });
  assert.throws(
    () => localStore.updateDesignRevision(revision.id, { selectedImageId: otherImages[0].id }),
    /design revision binding invalid/,
  );

  const revisions = localStore.listDesignRevisions(designJob.id);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].selectedImageId, images[0].id);
});

test("design job revision list carries and enforces expected conversation identity", async () => {
  const { localStore } = setupService();
  const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");

  const designJob = localStore.createDesignJob({
    requestId: "revision_list_identity_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "revision identity test",
    bundle: { items: [] },
    requirements: {},
    status: "completed",
  });
  const images = localStore.upsertDesignImages(designJob.id, [{ imageId: "candidate_1", position: 1 }]);
  localStore.createDesignRevision({
    designJobId: designJob.id,
    selectedImageId: images[0].id,
    instruction: "change background",
  });
  const service = new DesignJobsService({}, {}, localStore, {}, {}, {}, {}, {});

  const revisions = await service.listRevisions(designJob.id, {
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
  });

  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].designJobId, designJob.id);
  await assert.rejects(
    () =>
      service.listRevisions(designJob.id, {
        expectedWechatAccountId: "wechat_demo_2",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
      }),
    /design job identity mismatch: wechatAccountId expected wechat_demo_2, got wechat_demo_1/,
  );
});

test("design demo jobs require matching conversation identity", () => {
  const { localStore } = setupService();
  const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
  const service = new DesignJobsService({}, {}, localStore, {}, {}, {}, {}, {});

  assert.throws(
    () => service.createTimeoutDemo({ conversationId: "conversation_demo_1" }),
    /timeout demo requires conversation identity/,
  );
  assert.throws(
    () =>
      service.createTimeoutDemo({
        conversationId: "conversation_demo_1",
        expectedWechatAccountId: "wechat_demo_2",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
      }),
    /timeout demo identity mismatch/,
  );

  const timeoutJob = service.createTimeoutDemo({
    conversationId: "conversation_demo_1",
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
  });
  assert.equal(timeoutJob.wechatAccountId, "wechat_demo_1");
  assert.equal(timeoutJob.conversationId, "conversation_demo_1");
  assert.equal(timeoutJob.customerId, "customer_demo_1");

  assert.throws(
    () => service.createFailureDemo({ conversationId: "conversation_demo_1" }),
    /failure demo requires conversation identity/,
  );
  assert.throws(
    () =>
      service.createFailureDemo({
        conversationId: "conversation_demo_1",
        expectedWechatAccountId: "wechat_demo_1",
        expectedConversationId: "conversation_demo_2",
        expectedCustomerId: "customer_demo_1",
      }),
    /failure demo identity mismatch/,
  );

  const failureJob = service.createFailureDemo({
    conversationId: "conversation_demo_1",
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
  });
  assert.equal(failureJob.wechatAccountId, "wechat_demo_1");
  assert.equal(failureJob.conversationId, "conversation_demo_1");
  assert.equal(failureJob.customerId, "customer_demo_1");
});

test("local quote draft update rejects invalid customer binding changes", () => {
  const { localStore } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "quote_binding_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [{ name: "thermos", salePrice: 100, cost: 60 }] },
    requirements: {},
    status: "completed",
  });
  const quote = localStore.createQuoteFromDesignJob(designJob.id);

  assert.throws(
    () => localStore.updateQuoteDraft(quote.id, { customerId: "customer_demo_2" }),
    /quote draft identity invalid/,
  );

  const updated = localStore.getQuoteDraft(quote.id);
  assert.equal(updated.customerId, "customer_demo_1");
});

test("local order draft create and update reject invalid quote binding changes", () => {
  const { localStore } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "order_binding_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [{ name: "thermos", salePrice: 100, cost: 60 }] },
    requirements: {},
    status: "completed",
  });
  const quote = localStore.createQuoteFromDesignJob(designJob.id);
  const baseOrderDraft = {
    designJobId: quote.designJobId,
    customerId: quote.customerId,
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    selectedImageId: quote.selectedImageId,
    quantity: quote.quantity,
    unitPrice: quote.unitPrice,
    totalPrice: quote.totalPrice,
    totalCost: quote.totalCost,
    profit: quote.profit,
    status: "accepted",
    paymentStatus: "unpaid",
    bundleSnapshot: quote.designJob?.bundle || {},
    selectedImageSnapshot: quote.selectedImage || null,
  };

  assert.throws(
    () => localStore.upsertOrderDraftFromQuote(quote.id, { ...baseOrderDraft, customerId: "customer_demo_2" }),
    /order draft binding invalid/,
  );

  const order = localStore.upsertOrderDraftFromQuote(quote.id, baseOrderDraft);
  assert.throws(
    () => localStore.updateOrderDraft(order.id, { customerId: "customer_demo_2" }),
    /order draft binding invalid/,
  );

  const updated = localStore.getOrderDraft(order.id);
  assert.equal(updated.customerId, "customer_demo_1");
});

test("bridge sent ack rejects task after its design binding becomes invalid", () => {
  const { localStore, service } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "bridge_bad_binding_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [] },
    requirements: {},
    status: "completed",
  });
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: designJob.id,
    status: "sending",
    payload: { kind: "text", text: "should not be marked sent with bad binding" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });
  localStore.updateDesignJob(designJob.id, { conversationId: "conversation_demo_2" }, { skipIdentityValidation: true });
  const outboxFile = path.join(process.env.WECHAT_BRIDGE_OUTBOX_DIR, "bad-binding-sent-ack.json");
  const attempt = localStore.createSendAttempt({
    sendTaskId: task.id,
    adapter: "windows_bridge",
    status: "started",
    metadata: { outboxFile },
  });
  writeDispatchInstructionForStartedBridgeSend(localStore, task.id);

  assert.throws(
    () =>
      service.acknowledgeBridgeSend(task.id, {
        status: "sent",
        version: "wechat_bridge_ack_v1",
        ackToken: "d".repeat(64),
        taskId: task.id,
        attemptId: attempt.id,
        wechatAccountId: task.wechatAccountId,
        conversationId: task.conversationId,
        customerId: designJob.customerId,
        outboxFileName: path.basename(outboxFile),
      }),
    /bridge ack send task binding invalid/,
  );

  assert.equal(localStore.getSendTask(task.id).status, "sending");
  assert.equal(localStore.getLatestSendAttempt(task.id, { adapter: "windows_bridge" }).status, "started");
});

test("bridge sent ack rejects order task after payment is refunded while waiting for ack", () => {
  const { localStore, service } = setupService();
  const order = seedStoredOrderDraft(localStore, {
    id: "order_ack_refund_1",
    status: "confirmed",
    paymentStatus: "deposit_paid",
  });
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: order.designJobId,
    quoteDraftId: order.quoteDraftId,
    status: "queued",
    payload: { kind: "text", text: "sent ack should recheck order payment" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "order_confirmation",
        valueLevel: "low",
        orderDraftId: order.id,
      },
    },
  });
  createPassingWechatWindowSnapshot(localStore, "sent ack should recheck order payment");
  const started = service.executeSend(task.id, { adapter: "windows_bridge" });
  const outboxFile = started.attempt.metadata.outboxFile;
  const outbox = JSON.parse(fs.readFileSync(outboxFile, "utf8"));
  writeDispatchInstructionForStartedBridgeSend(localStore, task.id);
  localStore.updateOrderDraft(order.id, { paymentStatus: "refunded" });

  assert.throws(
    () =>
      service.acknowledgeBridgeSend(task.id, {
        status: "sent",
        version: "wechat_bridge_ack_v1",
        ackToken: outbox.ackToken,
        taskId: task.id,
        attemptId: started.attempt.id,
        wechatAccountId: task.wechatAccountId,
        conversationId: task.conversationId,
        customerId: "customer_demo_1",
        outboxFileName: path.basename(outboxFile),
      }),
    /bridge ack order state invalid: order send blocked: payment is no longer verified before send/,
  );

  const rejectedTask = localStore.getSendTask(task.id);
  const rejectedAttempt = localStore.getLatestSendAttempt(task.id, { adapter: "windows_bridge" });
  assert.equal(rejectedTask.status, "failed");
  assert.match(rejectedTask.errorMessage, /bridge ack order state invalid/);
  assert.equal(rejectedTask.guardSnapshot.reason, "bridge_ack_rejected_after_trusted_validation");
  assert.equal(rejectedAttempt.status, "failed");
  assert.match(rejectedAttempt.errorMessage, /payment is no longer verified/);
  assert.equal(rejectedAttempt.metadata.bridgeAckRejected.source, "direct_ack");
  assert.equal(rejectedAttempt.metadata.bridgeAckRejected.fileName, "direct-bridge-ack");
  const failedOrder = localStore.getOrderDraft(order.id);
  assert.equal(failedOrder.owner, "人工客服");
  assert.match(failedOrder.customerNotes, new RegExp(`\\[发送任务:${task.id}\\]`));
  assert.match(failedOrder.customerNotes, /订单确认发送失败，需要人工处理/);
  assert.match(failedOrder.customerNotes, /bridge ack order state invalid/);
});

test("bridge sent ack rejects quote task after quote returned to manual review while waiting for ack", () => {
  const { localStore, service } = setupService();
  const designJob = localStore.createDesignJob({
    requestId: "bridge_manual_quote_request_1",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    budget: { mode: "per_box", amount: 100, quantity: 10 },
    scene: "员工福利",
    bundle: { items: [{ name: "保温杯", salePrice: 100, costPrice: 60 }] },
    requirements: {},
    status: "completed",
  });
  const images = localStore.upsertDesignImages(designJob.id, [
    {
      imageId: "bridge_manual_quote_candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\bridge_manual_quote_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/bridge_manual_quote_candidate_1.png",
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(designJob.id, images[0].id);
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: designJob.id,
    quoteDraftId: quote.id,
    status: "queued",
    payload: { kind: "quote", quoteDraftId: quote.id, text: "桥接等待时状态变化不能标记已发送" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: {
        source: "low_value_quote_send",
        valueLevel: "low",
        quoteDraftId: quote.id,
      },
    },
  });
  localStore.updateQuoteDraft(quote.id, {
    status: "send_queued",
    sendTaskId: task.id,
  });
  createPassingWechatWindowSnapshot(localStore, "桥接等待时状态变化不能标记已发送");
  const started = service.executeSend(task.id, { adapter: "windows_bridge" });
  const outboxFile = started.attempt.metadata.outboxFile;
  const outbox = JSON.parse(fs.readFileSync(outboxFile, "utf8"));
  writeDispatchInstructionForStartedBridgeSend(localStore, task.id);
  localStore.updateQuoteDraft(quote.id, {
    status: "manual_review",
    sendTaskId: null,
    customerNotes: "客户临时修改需求，报价回到人工审核。",
  });

  assert.throws(
    () =>
      service.acknowledgeBridgeSend(task.id, {
        status: "sent",
        version: "wechat_bridge_ack_v1",
        ackToken: outbox.ackToken,
        taskId: task.id,
        attemptId: started.attempt.id,
        wechatAccountId: task.wechatAccountId,
        conversationId: task.conversationId,
        customerId: "customer_demo_1",
        outboxFileName: path.basename(outboxFile),
      }),
    /bridge ack quote state invalid: quote send blocked: quote is no longer bound to this send task/,
  );

  const rejectedTask = localStore.getSendTask(task.id);
  const rejectedAttempt = localStore.getLatestSendAttempt(task.id, { adapter: "windows_bridge" });
  const quoteAfterReject = localStore.getQuoteDraft(quote.id);
  assert.equal(rejectedTask.status, "failed");
  assert.match(rejectedTask.errorMessage, /bridge ack quote state invalid/);
  assert.equal(rejectedTask.guardSnapshot.reason, "bridge_ack_rejected_after_trusted_validation");
  assert.equal(rejectedAttempt.status, "failed");
  assert.match(rejectedAttempt.errorMessage, /quote is no longer bound to this send task/);
  assert.equal(quoteAfterReject.status, "manual_review");
  assert.equal(quoteAfterReject.sendTaskId, null);
  assert.match(quoteAfterReject.customerNotes, /客户临时修改需求/);
});

test("manual lock blocks order confirmation queueing before order state changes", async () => {
  const order = buildOrderDraft({ paymentStatus: "deposit_paid" });
  let updateCalled = false;
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
      update: async () => {
        updateCalled = true;
        return order;
      },
    },
  });

  await service.setConversationManualLock("conversation_demo_1", {
    ...demoExpectedIdentity(),
    locked: true,
    reviewer: "test",
    reason: "manual_takeover_test",
  });

  await assert.rejects(
    () => service.queueOrderConfirmation(order.id, { owner: "low_value_automation" }),
    /会话已人工接管/,
  );
  assert.equal(updateCalled, false);
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("manual lock blocks order follow-up queueing before notification is created", async () => {
  const order = buildOrderDraft({ status: "processing", paymentStatus: "deposit_paid" });
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
      update: async () => order,
    },
  });
  const notificationsBefore = localStore.listNotifications().length;

  await service.setConversationManualLock("conversation_demo_1", {
    ...demoExpectedIdentity(),
    locked: true,
    reviewer: "test",
    reason: "manual_takeover_test",
  });
  const notificationsAfterLock = localStore.listNotifications().length;

  await assert.rejects(
    () => service.queueOrderFollowup(order.id, { owner: "low_value_automation", type: "production" }),
    /会话已人工接管/,
  );

  assert.equal(localStore.listNotifications().length, notificationsAfterLock);
  assert.equal(notificationsAfterLock, notificationsBefore + 1);
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("embedded manual lock blocks order confirmation before payment and binding side effects", async () => {
  const order = buildOrderDraft({
    paymentStatus: "paid",
    conversation: {
      id: "conversation_demo_1",
      customerId: "customer_demo_1",
      wechatAccountId: "wechat_demo_1",
      manualLocked: true,
    },
  });
  let updateCalled = false;
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
      update: async () => {
        updateCalled = true;
        return order;
      },
    },
  });

  await assert.rejects(
    () => service.queueOrderConfirmation(order.id, { owner: "low_value_automation" }),
    /会话已人工接管/,
  );

  assert.equal(updateCalled, false);
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("order confirmation queue rejects refunded order before send task creation", async () => {
  const order = buildOrderDraft({ status: "confirmed", paymentStatus: "refunded" });
  let updateCalled = false;
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
      update: async () => {
        updateCalled = true;
        return order;
      },
    },
  });

  await assert.rejects(
    () => service.queueOrderConfirmation(order.id, { owner: "low_value_automation" }),
    /订单确认需要先核验定金或全款/,
  );

  assert.equal(updateCalled, false);
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("order follow-up queue rejects refunded order before send task creation", async () => {
  const order = buildOrderDraft({ status: "processing", paymentStatus: "refunded" });
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
    },
  });

  await assert.rejects(
    () => service.queueOrderFollowup(order.id, { owner: "low_value_automation", type: "production" }),
    /订单跟进需要先核验定金或全款/,
  );

  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("order confirmation queue rejects paid order without selected image before send task creation", async () => {
  const order = buildOrderDraft({
    status: "confirmed",
    paymentStatus: "deposit_paid",
    selectedImageId: null,
    selectedImage: null,
  });
  order.quoteDraft = { ...order.quoteDraft, selectedImageId: null, selectedImage: null };
  order.selectedImageSnapshot = null;
  let updateCalled = false;
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
      update: async () => {
        updateCalled = true;
        return order;
      },
    },
  });

  await assert.rejects(
    () => service.queueOrderConfirmation(order.id, { owner: "low_value_automation" }),
    /订单确认需要先绑定客户选中的效果图/,
  );

  assert.equal(updateCalled, false);
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("order follow-up queue rejects paid order without selected image before send task creation", async () => {
  const order = buildOrderDraft({
    status: "processing",
    paymentStatus: "deposit_paid",
    selectedImageId: null,
    selectedImage: null,
  });
  order.quoteDraft = { ...order.quoteDraft, selectedImageId: null, selectedImage: null };
  order.selectedImageSnapshot = null;
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
      update: async () => order,
    },
  });

  await assert.rejects(
    () => service.queueOrderFollowup(order.id, { owner: "low_value_automation", type: "production" }),
    /订单跟进需要先绑定客户选中的效果图/,
  );

  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("order confirmation queue rejects negative profit order before send task creation", async () => {
  const order = buildOrderDraft({
    status: "confirmed",
    paymentStatus: "deposit_paid",
    totalPrice: 1000,
    totalCost: 1200,
    profit: -200,
  });
  let updateCalled = false;
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
      update: async () => {
        updateCalled = true;
        return order;
      },
    },
  });

  await assert.rejects(
    () => service.queueOrderConfirmation(order.id, { owner: "low_value_automation" }),
    /订单确认发现订单利润为负/,
  );

  assert.equal(updateCalled, false);
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("high-value order confirmation requires explicit manual release before queueing", async () => {
  const order = buildOrderDraft({
    status: "confirmed",
    paymentStatus: "paid",
    totalPrice: 10000,
    unitPrice: 200,
  });
  let updateCalled = false;
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
      update: async () => {
        updateCalled = true;
        return order;
      },
    },
  });

  await assert.rejects(
    () => service.queueOrderConfirmation(order.id, { owner: "low_value_automation" }),
    /高价值订单必须先由人工审核/,
  );

  assert.equal(updateCalled, false);
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("high-value budget order follow-up requires explicit manual release before queueing", async () => {
  const order = buildOrderDraft({
    status: "processing",
    paymentStatus: "deposit_paid",
    totalPrice: 5000,
    unitPrice: 100,
  });
  order.designJob = {
    ...order.designJob,
    budget: { totalAmount: 12000, perUnitAmount: 100 },
  };
  order.quoteDraft = {
    ...order.quoteDraft,
    designJob: order.designJob,
  };
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
      update: async () => order,
    },
  });
  const notificationsBefore = localStore.listNotifications().length;

  await assert.rejects(
    () => service.queueOrderFollowup(order.id, { owner: "low_value_automation", type: "production" }),
    /高价值订单必须先由人工审核/,
  );

  assert.equal(localStore.listNotifications().length, notificationsBefore);
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("order follow-up rejects order bound to another design conversation", async () => {
  const order = buildOrderDraft({ status: "processing", paymentStatus: "deposit_paid" });
  order.designJob = {
    ...order.designJob,
    conversationId: "conversation_demo_2",
    conversation: {
      id: "conversation_demo_2",
      customerId: order.customerId,
      wechatAccountId: order.wechatAccountId,
    },
  };
  order.quoteDraft = {
    ...order.quoteDraft,
    designJob: order.designJob,
  };
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
    },
  });

  await assert.rejects(
    () => service.queueOrderFollowup(order.id, { owner: "low_value_automation", type: "production" }),
    /order follow-up binding invalid/,
  );

  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("order confirmation rejects order bound to another design conversation", async () => {
  const order = buildOrderDraft({ paymentStatus: "deposit_paid" });
  order.designJob = {
    ...order.designJob,
    conversationId: "conversation_demo_2",
    conversation: {
      id: "conversation_demo_2",
      customerId: order.customerId,
      wechatAccountId: order.wechatAccountId,
    },
  };
  order.quoteDraft = {
    ...order.quoteDraft,
    designJob: order.designJob,
  };
  let updateCalled = false;
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
      update: async () => {
        updateCalled = true;
        return order;
      },
    },
  });

  await assert.rejects(
    () => service.queueOrderConfirmation(order.id, { owner: "low_value_automation" }),
    /order confirmation binding invalid/,
  );

  assert.equal(updateCalled, false);
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("external failed bridge ack still requires outbox proof while internal timeout can fail safely", async () => {
  const { localStore, service } = setupService();

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "sending",
    payload: { kind: "text", text: "pending bridge send" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });

  fs.mkdirSync(process.env.WECHAT_BRIDGE_OUTBOX_DIR, { recursive: true });
  const outboxFile = path.join(process.env.WECHAT_BRIDGE_OUTBOX_DIR, "external-failed-ack.json");
  fs.writeFileSync(
    outboxFile,
    `${JSON.stringify({
      version: "wechat_bridge_outbox_v1",
      ackToken: "c".repeat(64),
      taskId: task.id,
      wechatAccountId: task.wechatAccountId,
      conversationId: task.conversationId,
      target: {
        wechatAccountId: task.wechatAccountId,
        conversationId: task.conversationId,
      },
      sendPlan: {
        kind: "text",
        target: {
          wechatAccountId: task.wechatAccountId,
          conversationId: task.conversationId,
        },
        actionCount: 1,
        actions: [{ type: "text", text: "pending bridge send" }],
        constraints: {
          singleAccountLock: true,
          requireActiveWindowMatch: true,
          requireRecentCustomerMatch: true,
          doNotMarkSentWithoutAck: true,
        },
      },
      payload: task.payload,
      guardSnapshot: { status: "passed", ok: true },
      context: { guardStatus: "passed" },
    })}\n`,
    "utf8",
  );
  const attempt = localStore.createSendAttempt({
    sendTaskId: task.id,
    adapter: "windows_bridge",
    status: "started",
    metadata: { outboxFile },
  });

  assert.throws(
    () => service.acknowledgeBridgeSend(task.id, { status: "failed", errorMessage: "external failure without proof" }),
    /bridge outbox payload invalid/,
  );
  assert.equal(localStore.getSendTask(task.id).status, "sending");

  assert.throws(
    () =>
      service.acknowledgeBridgeSend(task.id, {
        status: "failed",
        version: "wechat_bridge_ack_v1",
        ackToken: "c".repeat(64),
        taskId: task.id,
        attemptId: attempt.id,
        outboxFileName: "external-failed-ack.json",
        errorMessage: "external failure without account and conversation",
      }),
    /ackWechatAccountId|ackConversationId/,
  );
  assert.equal(localStore.getSendTask(task.id).status, "sending");

  const result = service.acknowledgeBridgeSend(
    task.id,
    { status: "failed", errorMessage: "internal timeout" },
    { internal: true },
  );

  const failedDir = path.join(process.env.WECHAT_BRIDGE_OUTBOX_DIR, "failed");
  assert.equal(result.task.status, "failed");
  assert.equal(fs.existsSync(outboxFile), false);
  assert.equal(fs.readdirSync(failedDir).some((fileName) => fileName.endsWith("external-failed-ack.json")), true);
});

test("send operation scan protects bridge task as delivery-unknown when pending outbox file is missing", async () => {
  const { localStore, service } = setupService();

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "pending bridge send should not hang forever" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });
  createPassingWechatWindowSnapshot(localStore, "pending bridge send should not hang forever");

  const execution = service.executeSend(task.id, { adapter: "windows_bridge" });
  assert.equal(execution.task.status, "sending");
  const outboxFile = execution.attempt.metadata.outboxFile;
  assert.equal(fs.existsSync(outboxFile), true);

  fs.unlinkSync(outboxFile);

  const scan = await service.scanSendOperations();
  const updated = localStore.getSendTask(task.id);
  const updatedAttempt = localStore.getLatestSendAttempt(task.id, {
    adapter: "windows_bridge",
  });

  assert.equal(scan.bridgeOutboxBroken, 1);
  assert.equal(scan.tasks.bridgeOutboxBroken[0].id, task.id);
  assert.equal(updated.status, "sending");
  assert.match(updated.errorMessage, /outbox_file_missing/);
  assert.equal(updated.guardSnapshot.deliveryState, "unknown");
  assert.equal(updated.guardSnapshot.deliveryUnknownReason, "bridge_outbox_unavailable");
  assert.equal(updatedAttempt.status, "started");
  assert.equal(localStore.listNotifications().some((notice) => notice.target?.sendTaskId === task.id), true);
});

test("execute send rejects duplicate execution while bridge ack is pending", () => {
  const { localStore, service } = setupService();

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "queued",
    payload: { kind: "text", text: "do not duplicate bridge outbox" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
    },
  });
  createPassingWechatWindowSnapshot(localStore, "do not duplicate bridge outbox");

  const first = service.executeSend(task.id, { adapter: "windows_bridge" });
  const outboxBefore = fs.readdirSync(process.env.WECHAT_BRIDGE_OUTBOX_DIR).filter((fileName) => fileName.endsWith(".json"));

  assert.equal(first.task.status, "sending");
  assert.equal(outboxBefore.length, 1);
  assert.throws(() => service.executeSend(task.id, { adapter: "windows_bridge" }), /send task is not queued: sending/);

  const outboxAfter = fs.readdirSync(process.env.WECHAT_BRIDGE_OUTBOX_DIR).filter((fileName) => fileName.endsWith(".json"));
  assert.deepEqual(outboxAfter, outboxBefore);
  assert.equal(localStore.listSendAttempts({ sendTaskId: task.id }).length, 1);
});

test("inbound message rejects customer assets from another conversation", async () => {
  const { localStore, service } = setupService();

  const otherCustomerAsset = localStore.createDesignAsset({
    ownerType: "customer",
    ownerId: "customer_demo_2",
    role: "customer_logo",
    fileName: "other-customer-logo.png",
    mimeType: "image/png",
    localPath: "C:\\temp\\other-customer-logo.png",
    source: "test",
  });

  await assert.rejects(
    () =>
      service.processInboundMessage({
        externalId: "manual-lock-inbound-asset-mismatch",
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
        text: "端午员工福利礼盒，每盒180元，想看效果图，logo已发",
        assetIds: [otherCustomerAsset.id],
      }),
    /inbound asset binding invalid/,
  );
});

test("local messages reject account or customer binding from another conversation", () => {
  const { localStore } = setupService();

  assert.throws(
    () =>
      localStore.createMessage({
        conversationId: "conversation_demo_1",
        wechatAccountId: "wechat_demo_2",
        customerId: "customer_demo_1",
        text: "wrong account",
      }),
    /message conversation binding invalid/,
  );

  assert.throws(
    () =>
      localStore.createMessage({
        conversationId: "conversation_demo_1",
        wechatAccountId: "wechat_demo_1",
        customerId: "customer_demo_2",
        text: "wrong customer",
      }),
    /message customer binding invalid/,
  );

  const message = localStore.createMessage({
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    customerId: "customer_demo_1",
    text: "correct binding",
  });

  assert.equal(message.conversationId, "conversation_demo_1");
  assert.equal(message.wechatAccountId, "wechat_demo_1");
  assert.equal(message.customerId, "customer_demo_1");
  assert.equal(message.identityBinding.conversationId, "conversation_demo_1");
});

test("local conversation updates reject invalid identity changes", async () => {
  const { localStore, service } = setupService();

  assert.throws(
    () => localStore.updateConversation("conversation_demo_1", { customerId: "missing_customer" }),
    /conversation binding invalid/,
  );

  assert.throws(
    () => localStore.updateConversation("conversation_demo_1", { wechatAccountId: "missing_wechat" }),
    /conversation binding invalid/,
  );

  localStore.updateConversation("conversation_demo_1", { externalChatId: "same_chat" });
  localStore.updateConversation("conversation_demo_2", { externalChatId: "same_chat" });
  assert.throws(
    () => localStore.updateConversation("conversation_demo_2", { wechatAccountId: "wechat_demo_1" }),
    /conversation binding invalid/,
  );

  const result = await service.setConversationManualLock("conversation_demo_1", {
    locked: true,
    reviewer: "test",
    reason: "manual_review",
    ...demoExpectedIdentity(),
  });
  assert.equal(result.conversation.manualLocked, true);
  assert.equal(result.conversation.customerId, "customer_demo_1");
  assert.equal(result.conversation.wechatAccountId, "wechat_demo_1");
});

test("wechat window snapshots only match conversations from the same account", () => {
  const { localStore } = setupService();

  const snapshot = localStore.createWechatWindowSnapshot({
    source: "test",
    isOnline: true,
    wechatAccountId: "wechat_demo_1",
    chatTitle: "Manager Li enterprise gift",
    activeChatTitle: "Manager Li enterprise gift",
    recentCustomerId: "customer_demo_2",
    confidence: 1,
  });

  assert.equal(snapshot.wechatAccountId, "wechat_demo_1");
  assert.equal(snapshot.activeConversation, null);
  assert.equal(snapshot.diagnostic.ok, false);
  assert.equal(snapshot.diagnostic.activeConversationId, null);
  assert.equal(snapshot.diagnostic.failedKeys.includes("activeConversationKnown"), true);

  const sameAccountSnapshot = localStore.createWechatWindowSnapshot({
    source: "test",
    isOnline: true,
    wechatAccountId: "wechat_demo_2",
    chatTitle: "Manager Li enterprise gift",
    activeChatTitle: "Manager Li enterprise gift",
    recentCustomerId: "customer_demo_2",
    confidence: 1,
  });

  assert.equal(sameAccountSnapshot.activeConversation.id, "conversation_demo_2");
  assert.equal(sameAccountSnapshot.activeConversation.wechatAccountId, "wechat_demo_2");
  assert.equal(sameAccountSnapshot.diagnostic.ok, true);
  assert.equal(sameAccountSnapshot.diagnostic.activeConversationId, "conversation_demo_2");
});

test("chat import training samples keep conversation identity and reject cross-account bindings", () => {
  const { localStore } = setupService();
  const parsed = {
    messageCount: 2,
    pairCount: 1,
    warnings: [],
    pairs: [
      {
        agentKey: "gift_design",
        sceneScore: 30,
        matchedKeywords: ["gift"],
        sceneScores: [{ scene: "gift", agentKey: "gift_design", score: 30, matchedKeywords: ["gift"] }],
        sceneCheck: { status: "clear", reason: "top_scene_confident", needsReview: false, scoreGap: 30 },
        scene: "礼盒设计",
        question: "Need gift box render",
        answer: "I will prepare a gift plan first.",
        score: 92,
        sourceLineStart: 1,
        sourceLineEnd: 2,
      },
    ],
  };

  assert.throws(
    () =>
      localStore.createChatImport(
        {
          text: "demo",
          conversationId: "conversation_demo_1",
          wechatAccountId: "wechat_demo_2",
          customerId: "customer_demo_1",
        },
        parsed,
      ),
    /chat import conversation binding invalid/,
  );

  assert.throws(
    () =>
      localStore.createChatImport(
        {
          text: "demo",
          conversationId: "conversation_demo_1",
          wechatAccountId: "wechat_demo_1",
          customerId: "customer_demo_2",
        },
        parsed,
      ),
    /chat import customer binding invalid/,
  );

  const result = localStore.createChatImport(
    {
      text: "demo",
      conversationId: "conversation_demo_1",
      wechatAccountId: "wechat_demo_1",
      customerId: "customer_demo_1",
    },
    parsed,
  );
  const sample = result.samples[0];
  const knowledge = localStore.listKnowledgeEntries(sample.agentId).find((entry) => entry.sourceId === sample.id);

  assert.equal(result.conversationId, "conversation_demo_1");
  assert.equal(result.wechatAccountId, "wechat_demo_1");
  assert.equal(sample.customerId, "customer_demo_1");
  assert.equal(sample.conversationId, "conversation_demo_1");
  assert.equal(sample.wechatAccountId, "wechat_demo_1");
  assert.equal(sample.sourceType, "chat_import");
  assert.equal(sample.sceneScore, 30);
  assert.deepEqual(sample.matchedKeywords, ["gift"]);
  assert.equal(sample.sceneCheck.status, "clear");
  assert.equal(sample.identityBinding.conversationId, "conversation_demo_1");
  assert.equal(knowledge.conversationId, "conversation_demo_1");
  assert.equal(knowledge.wechatAccountId, "wechat_demo_1");
});

test("chat import list filters keep account customer and conversation isolated", () => {
  const { localStore } = setupService();

  const accountOneImport = localStore.createChatImport(
    {
      name: "账号一聊天记录",
      source: "manual_text",
      channel: "wechat",
      customerId: "customer_demo_1",
      conversationId: "conversation_demo_1",
      wechatAccountId: "wechat_demo_1",
      text: "Customer: I need gift box render`nAgent: I will prepare a plan first.",
    },
    { messageCount: 2, pairCount: 1, warnings: [], pairs: [] },
  );
  const accountTwoImport = localStore.createChatImport(
    {
      name: "Account two chat import",
      source: "manual_text",
      channel: "wechat",
      customerId: "customer_demo_2",
      conversationId: "conversation_demo_2",
      wechatAccountId: "wechat_demo_2",
      text: "Customer: How to handle after sales`nAgent: I will verify the order.",
    },
    { messageCount: 2, pairCount: 1, warnings: [], pairs: [] },
  );

  assert.deepEqual(
    localStore.listChatImports({ wechatAccountId: "wechat_demo_1" }).map((item) => item.id),
    [accountOneImport.id],
  );
  assert.deepEqual(
    localStore.listChatImports({ conversationId: "conversation_demo_2", customerId: "customer_demo_2" }).map((item) => item.id),
    [accountTwoImport.id],
  );
  assert.deepEqual(localStore.listChatImports({ conversationId: "conversation_demo_2", customerId: "customer_demo_1" }), []);
});

test("knowledge entry list filters keep account customer and conversation isolated", () => {
  const { localStore } = setupService();
  const parsed = {
    messageCount: 2,
    pairCount: 1,
    warnings: [],
    pairs: [
      {
        question: "我要看礼盒效果图",
        answer: "I will prepare a gift box plan based on your budget.",
        scene: "礼盒设计",
        agentKey: "gift_design",
        score: 92,
        skillHints: ["棰勭畻璇嗗埆"],
        sceneScore: 80,
        matchedKeywords: ["礼盒"],
        sceneCheck: { status: "clear", reason: "strong_signal", needsReview: false },
      },
    ],
  };
  const accountOneImport = localStore.createChatImport(
    {
      text: "demo",
      customerId: "customer_demo_1",
      conversationId: "conversation_demo_1",
      wechatAccountId: "wechat_demo_1",
    },
    parsed,
  );
  const accountTwoImport = localStore.createChatImport(
    {
      text: "demo",
      customerId: "customer_demo_2",
      conversationId: "conversation_demo_2",
      wechatAccountId: "wechat_demo_2",
    },
    parsed,
  );
  const accountOneSample = accountOneImport.samples[0];
  const accountTwoSample = accountTwoImport.samples[0];

  assert.deepEqual(
    localStore
      .listKnowledgeEntries({
        agentId: accountOneSample.agentId,
        wechatAccountId: "wechat_demo_1",
        conversationId: "conversation_demo_1",
        customerId: "customer_demo_1",
      })
      .map((entry) => entry.sourceId),
    [accountOneSample.id],
  );
  assert.deepEqual(
    localStore
      .listKnowledgeEntries({
        agentId: accountTwoSample.agentId,
        wechatAccountId: "wechat_demo_2",
        conversationId: "conversation_demo_2",
        customerId: "customer_demo_2",
      })
      .map((entry) => entry.sourceId),
    [accountTwoSample.id],
  );
  assert.deepEqual(
    localStore.listKnowledgeEntries({
      agentId: accountTwoSample.agentId,
      conversationId: "conversation_demo_2",
      customerId: "customer_demo_1",
    }),
    [],
  );
});

test("route correction training samples inherit route conversation identity", () => {
  const { localStore } = setupService();

  assert.throws(
    () =>
      localStore.createRouteEvaluation(
        {
          channel: "wechat",
          text: "我要看礼盒效果图",
          customerId: "customer_demo_2",
          conversationId: "conversation_demo_1",
          wechatAccountId: "wechat_demo_1",
        },
        {
          agentKey: "gift_design",
          scene: "礼盒设计",
          action: "auto_agent",
          confidence: 90,
          isHighValue: false,
        },
      ),
    /route evaluation customer binding invalid/,
  );

  const route = localStore.createRouteEvaluation(
    {
      channel: "wechat",
      text: "我要看礼盒效果图",
      customerId: "customer_demo_1",
      conversationId: "conversation_demo_1",
      wechatAccountId: "wechat_demo_1",
    },
    {
      agentKey: "gift_design",
      scene: "礼盒设计",
      action: "auto_agent",
      confidence: 90,
      isHighValue: false,
      sceneMemory: {
        matched: true,
        applied: true,
        sampleId: "sample_memory_1",
        score: 100,
      },
      sceneAudit: {
        level: "pass",
        label: "memory applied",
        evidence: ["route correction memory: applied 100"],
        warnings: [],
      },
    },
  );
  const beforeSampleCount = localStore.listTrainingSamples().length;
  const correctionPayload = {
    agentKey: "gift_design",
    scene: "礼盒设计",
    idealReply: "可以的，我先按您的预算和用途整理礼盒方案。",
  };
  const correction = localStore.correctRouteEvaluation(route.id, correctionPayload);
  const retried = localStore.correctRouteEvaluation(route.id, correctionPayload);

  assert.equal(route.wechatAccountId, "wechat_demo_1");
  assert.equal(route.identityBinding.conversationId, "conversation_demo_1");
  assert.equal(route.sceneMemory.sampleId, "sample_memory_1");
  assert.equal(correction.route.sceneAudit.label, "人工已纠正");
  assert.equal(correction.route.sceneMemory, null);
  assert.equal(correction.route.sceneAudit.label, "人工已纠正");
  assert.equal(correction.trainingSample.customerId, "customer_demo_1");
  assert.equal(correction.trainingSample.conversationId, "conversation_demo_1");
  assert.equal(correction.trainingSample.wechatAccountId, "wechat_demo_1");
  assert.equal(correction.knowledgeEntry.conversationId, "conversation_demo_1");
  assert.equal(correction.knowledgeEntry.wechatAccountId, "wechat_demo_1");
  assert.equal(retried.trainingSample.id, correction.trainingSample.id);
  assert.equal(retried.knowledgeEntry.id, correction.knowledgeEntry.id);
  assert.equal(localStore.listTrainingSamples().length, beforeSampleCount + 1);
  assert.throws(
    () => localStore.correctRouteEvaluation("missing-route", correctionPayload),
    (error) => error?.getStatus?.() === 404,
  );
  assert.throws(
    () => localStore.correctRouteEvaluation(route.id, { ...correctionPayload, agentKey: "missing-agent" }),
    (error) => error?.getStatus?.() === 400,
  );
});

test("route evaluation list filters keep account customer and conversation isolated", () => {
  const { localStore } = setupService();

  const accountOneRoute = localStore.createRouteEvaluation(
    {
      channel: "wechat",
      text: "我要看端午礼盒效果图",
      customerId: "customer_demo_1",
      conversationId: "conversation_demo_1",
      wechatAccountId: "wechat_demo_1",
    },
    {
      agentKey: "gift_design",
      scene: "礼盒设计",
      score: 95,
      matchedKeywords: ["礼盒"],
      action: "auto_agent",
    },
  );
  const accountTwoRoute = localStore.createRouteEvaluation(
    {
      channel: "wechat",
      text: "售后退换货怎么处理",
      customerId: "customer_demo_2",
      conversationId: "conversation_demo_2",
      wechatAccountId: "wechat_demo_2",
    },
    {
      agentKey: "after_sales",
      scene: "售后服务",
      score: 91,
      matchedKeywords: ["售后"],
      action: "auto_agent",
    },
  );

  assert.deepEqual(
    localStore.listRouteEvaluations({ wechatAccountId: "wechat_demo_1" }).map((route) => route.id),
    [accountOneRoute.id],
  );
  assert.deepEqual(
    localStore.listRouteEvaluations({ conversationId: "conversation_demo_2", customerId: "customer_demo_2" }).map((route) => route.id),
    [accountTwoRoute.id],
  );
  assert.deepEqual(localStore.listRouteEvaluations({ conversationId: "conversation_demo_2", customerId: "customer_demo_1" }), []);
});

test("inbound customer image selection queues low-value quote safely", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_quote_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "端午员工福利礼盒",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\selection_quote_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
    {
      imageId: "candidate_2",
      position: 2,
      localPath: "C:\\storage\\design-jobs\\selection_quote_request_1\\candidate_2.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_2.png",
    },
  ]);

  const result = await service.processInboundMessage({
    externalId: "manual-lock-selection-numeric",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "我选第2张，按这个报价",
  });

  assert.equal(result.plan.type, "select_design_image_and_create_quote");
  assert.equal(result.plan.reason, "low_value_customer_selected_image_quote_queued");
  assert.equal(result.plan.shouldQueueReply, true);
  assert.equal(result.quote.status, "send_queued");
  assert.equal(result.quote.selectedImageId, images[1].id);
  assert.match(result.quote.customerNotes, /quote|send|queue|报价|发送|队列/);
  assert.doesNotMatch(result.quote.customerNotes || "", /Customer selected/);
  assert.equal(result.sendTask.status, "queued");
  assert.equal(result.sendTask.quoteDraftId, result.quote.id);
  assert.equal(result.sendTask.wechatAccountId, "wechat_demo_1");
  assert.equal(result.sendTask.conversationId, "conversation_demo_1");
  assert.equal(result.sendTask.payload.kind, "quote");
  assert.match(result.sendTask.payload.text, /报价|礼盒|9000/);
});

test("inbound numbered image shorthand queues low-value quote safely", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_quote_no_2_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "商务伴手礼",
    budget: { mode: "per_box", amount: 160, quantity: 40 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 30, salePrice: 70 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 55, salePrice: 90 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\selection_quote_no_2_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
    {
      imageId: "candidate_2",
      position: 2,
      localPath: "C:\\storage\\design-jobs\\selection_quote_no_2_request_1\\candidate_2.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_2.png",
    },
  ]);

  const result = await service.processInboundMessage({
    externalId: "manual-lock-selection-number-shorthand",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "NO.2",
  });

  assert.equal(result.plan.type, "select_design_image_and_create_quote");
  assert.equal(result.plan.reason, "low_value_customer_selected_image_quote_queued");
  assert.equal(result.plan.shouldQueueReply, true);
  assert.equal(result.quote.status, "send_queued");
  assert.equal(result.quote.selectedImageId, images[1].id);
  assert.equal(result.sendTask.status, "queued");
  assert.equal(result.sendTask.quoteDraftId, result.quote.id);
  assert.equal(result.sendTask.wechatAccountId, "wechat_demo_1");
  assert.equal(result.sendTask.conversationId, "conversation_demo_1");
  assert.equal(result.sendTask.payload.kind, "quote");
  assert.match(result.sendTask.payload.text, /第2张效果图/);
});

test("inbound lettered image shorthand queues low-value quote safely", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_quote_b_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "商务礼盒",
    budget: { mode: "per_box", amount: 160, quantity: 40 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 30, salePrice: 70 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 55, salePrice: 90 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_a",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\selection_quote_b_request_1\\candidate_a.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_a.png",
    },
    {
      imageId: "candidate_b",
      position: 2,
      localPath: "C:\\storage\\design-jobs\\selection_quote_b_request_1\\candidate_b.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_b.png",
    },
    {
      imageId: "candidate_c",
      position: 3,
      localPath: "C:\\storage\\design-jobs\\selection_quote_b_request_1\\candidate_c.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_c.png",
    },
  ]);

  const result = await service.processInboundMessage({
    externalId: "manual-lock-selection-letter-shorthand",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "B款",
  });

  assert.equal(result.plan.type, "select_design_image_and_create_quote");
  assert.equal(result.plan.reason, "low_value_customer_selected_image_quote_queued");
  assert.equal(result.plan.shouldQueueReply, true);
  assert.equal(result.quote.status, "send_queued");
  assert.equal(result.quote.selectedImageId, images[1].id);
  assert.equal(result.sendTask.status, "queued");
  assert.equal(result.sendTask.quoteDraftId, result.quote.id);
  assert.equal(result.sendTask.wechatAccountId, "wechat_demo_1");
  assert.equal(result.sendTask.conversationId, "conversation_demo_1");
  assert.equal(result.sendTask.payload.kind, "quote");
});

test("low value automation queue skips queued task when design budget became high value", async () => {
  const { localStore, service } = setupService();

  const designJob = localStore.createDesignJob({
    requestId: "queued_high_value_budget_request_1",
    status: "completed",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "gift box",
    budget: { totalAmount: 15000, quantity: 50 },
    bundle: {
      items: [{ skuCode: "BOX-A", name: "box", costPrice: 50, salePrice: 100 }],
      automation: { ready: true },
    },
    isHighValue: false,
  });
  const quote = localStore.createQuoteFromDesignJob(designJob.id);
  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    designJobId: designJob.id,
    quoteDraftId: quote.id,
    status: "queued",
    payload: { kind: "quote", text: "should not auto process high value budget" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      automation: { valueLevel: "low", source: "low_value_automation" },
    },
  });

  createPassingWechatWindowSnapshot(localStore, "ready to send");
  const sendScan = await service.processSafeSendQueue({ adapter: "windows_bridge", automationOnly: true });
  const freshTask = localStore.getSendTask(task.id);

  assert.equal(sendScan.scanned, 0);
  assert.equal(sendScan.processed.length, 0);
  assert.equal(freshTask.status, "queued");

  const manualQueueScan = await service.processSafeSendQueue({ adapter: "windows_bridge" });
  const blockedTask = localStore.getSendTask(task.id);

  assert.equal(manualQueueScan.processed.length, 0);
  assert.equal(manualQueueScan.blocked.length, 1);
  assert.equal(manualQueueScan.blocked[0].reason, "manual_review_required");
  assert.equal(blockedTask.status, "blocked");
  assert.equal(blockedTask.guardSnapshot.blockedByHighValueReview, true);
});

test("inbound customer image reselection after quote queueing goes to manual review", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_quote_reselect_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "gift box",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "box", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "tea", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\selection_quote_reselect_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
    {
      imageId: "candidate_2",
      position: 2,
      localPath: "C:\\storage\\design-jobs\\selection_quote_reselect_request_1\\candidate_2.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_2.png",
    },
  ]);

  const firstSelection = await service.processInboundMessage({
    externalId: "manual-lock-selection-first",
    text: "我选第2张，按这个报价",
    conversationId: "conversation_demo_1",
  });

  assert.equal(firstSelection.plan.reason, "low_value_customer_selected_image_quote_queued");
  assert.equal(firstSelection.quote.selectedImageId, images[1].id);
  assert.equal(localStore.getDesignJob(job.id).status, "quote_created");

  const reselection = await service.processInboundMessage({
    externalId: "manual-lock-selection-reselect",
    text: "我又看了一下，换第1张",
    conversationId: "conversation_demo_1",
  });

  const quoteAfterReselection = localStore.getQuoteDraft(firstSelection.quote.id);
  const conversation = localStore.listConversations().find((item) => item.id === "conversation_demo_1");

  assert.equal(reselection.plan.reason, "quote_already_queued_or_sent");
  assert.equal(reselection.plan.shouldNotifyHuman, true);
  assert.equal(reselection.sendTask, null);
  assert.equal(reselection.notification.target.reason, "quote_already_queued_or_sent");
  assert.equal(reselection.notification.target.selectedImageId, images[0].id);
  assert.equal(quoteAfterReselection.selectedImageId, images[1].id);
  assert.equal(conversation.manualLocked, true);
  const manualLockLog = localStore
    .listReviewLogs()
    .find((log) => log.targetType === "conversation" && log.targetId === "conversation_demo_1" && log.decision === "manual_lock");
  assert.ok(manualLockLog);
  assert.match(manualLockLog.note, /已转人工处理/);
  assert.match(manualLockLog.note, /客户在报价进入发送流程后又修改选择/);
  assert.doesNotMatch(manualLockLog.note, /Manual review is required/);
});

test("inbound text image selection binds the latest revision round", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_latest_revision_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "gift box",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "box", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "tea", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\selection_latest_revision_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
    {
      imageId: "candidate_2",
      position: 2,
      localPath: "C:\\storage\\design-jobs\\selection_latest_revision_request_1\\candidate_2.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_2.png",
    },
    {
      imageId: "r1-candidate_1",
      position: 101,
      localPath: "C:\\storage\\design-jobs\\selection_latest_revision_request_1\\r1-candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/r1-candidate_1.png",
    },
    {
      imageId: "r1-candidate_2",
      position: 102,
      localPath: "C:\\storage\\design-jobs\\selection_latest_revision_request_1\\r1-candidate_2.png",
      downloadUrl: "http://127.0.0.1:3700/files/r1-candidate_2.png",
    },
  ]);

  const result = await service.processInboundMessage({
    externalId: "manual-lock-selection-latest-revision",
    text: "就第1张，按这个报价",
    conversationId: "conversation_demo_1",
  });

  const updatedJob = localStore.getDesignJob(job.id);
  const selectedImage = updatedJob.images.find((image) => image.selected);

  assert.equal(result.plan.reason, "low_value_customer_selected_image_quote_queued");
  assert.equal(result.quote.selectedImageId, images[2].id);
  assert.equal(selectedImage.id, images[2].id);
});

test("inbound screenshot fingerprint selection queues low-value quote safely", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_screenshot_fingerprint_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "端午员工福利礼盒",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      fingerprint: "dhash64:v1:0000000000000000",
      localPath: "C:\\storage\\design-jobs\\selection_screenshot_fingerprint_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
    {
      imageId: "candidate_2",
      position: 2,
      fingerprint: "dhash64:v1:ffffffffffffffff",
      localPath: "C:\\storage\\design-jobs\\selection_screenshot_fingerprint_request_1\\candidate_2.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_2.png",
    },
  ]);

  const result = await service.processInboundMessage({
    externalId: "manual-lock-selection-screenshot",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "就这个图，麻烦按这个报价",
    attachments: [{ type: "image", fileName: "客户回传截图.png", screenshotFingerprint: "dhash64:v1:ffffffffffffffff" }],
  });

  const updatedJob = localStore.getDesignJob(job.id);
  const selectedImage = updatedJob.images.find((image) => image.selected);

  assert.equal(result.plan.type, "select_design_image_and_create_quote");
  assert.equal(result.plan.reason, "low_value_customer_selected_image_quote_queued");
  assert.equal(result.selection.result.source, "fingerprint");
  assert.equal(result.selection.result.imageId, "candidate_2");
  assert.equal(result.quote.status, "send_queued");
  assert.equal(result.quote.selectedImageId, images[1].id);
  assert.equal(selectedImage.id, images[1].id);
  assert.equal(result.sendTask.status, "queued");
  assert.equal(result.sendTask.quoteDraftId, result.quote.id);
  assert.equal(result.sendTask.wechatAccountId, "wechat_demo_1");
  assert.equal(result.sendTask.conversationId, "conversation_demo_1");
});

test("uncertain inbound screenshot selection goes to manual review without quoting", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_uncertain_screenshot_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "端午员工福利礼盒",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      fingerprint: "dhash64:v1:0000000000000000",
      localPath: "C:\\storage\\design-jobs\\selection_uncertain_screenshot_request_1\\candidate_1.png",
    },
    {
      imageId: "candidate_2",
      position: 2,
      fingerprint: "dhash64:v1:ffffffffffffffff",
      localPath: "C:\\storage\\design-jobs\\selection_uncertain_screenshot_request_1\\candidate_2.png",
    },
  ]);

  const result = await service.processInboundMessage({
    externalId: "manual-lock-selection-uncertain-screenshot",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "就按这个截图里的来",
    attachments: [{ type: "image", fileName: "客户回传截图.png", imageFingerprint: "dhash64:v1:fffffffffffffffc" }],
  });

  const updatedJob = localStore.getDesignJob(job.id);
  const conversation = localStore.listConversations().find((item) => item.id === "conversation_demo_1");

  assert.equal(result.plan.type, "manual_selection_review");
  assert.equal(result.plan.shouldNotifyHuman, true);
  assert.equal(result.selection.reviewRequired, true);
  assert.equal(result.selection.result.source, "fingerprint");
  assert.equal(result.sendTask, null);
  assert.equal(result.quote, null);
  assert.equal(updatedJob.images.some((image) => image.selected), false);
  assert.equal(localStore.listQuoteDrafts().some((quote) => quote.designJobId === job.id), false);
  assert.equal(conversation.manualLocked, true);
  assert.equal(result.notification.target.designJobId, job.id);
  assert.equal(result.notification.target.reason, "截图感知距离过大，需要人工确认");
  assert.equal(images.length, 2);
});

test("inbound high value image selection locks conversation and leaves human review note", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_high_value_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "gift box",
    budget: { mode: "total", amount: 15000, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "box", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "tea", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: true,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\selection_high_value_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
    {
      imageId: "candidate_2",
      position: 2,
      localPath: "C:\\storage\\design-jobs\\selection_high_value_request_1\\candidate_2.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_2.png",
    },
  ]);

  const result = await service.processInboundMessage({
    externalId: "manual-lock-selection-high-value",
    text: "我选第2张，按这个继续报价",
    conversationId: "conversation_demo_1",
  });

  const conversation = localStore.listConversations().find((item) => item.id === "conversation_demo_1");
  const updatedJob = localStore.getDesignJob(job.id);
  const selectedImage = updatedJob.images.find((image) => image.selected);
  const designLog = localStore
    .listReviewLogs()
    .find((log) => log.targetType === "design_job" && log.targetId === job.id && log.decision === "high_value_customer_selected_image");
  const lockLog = localStore
    .listReviewLogs()
    .find((log) => log.targetType === "conversation" && log.targetId === "conversation_demo_1" && log.decision === "manual_lock");

  assert.equal(result.plan.shouldNotifyHuman, true);
  assert.equal(result.quote, null);
  assert.equal(result.sendTask, null);
  assert.equal(updatedJob.status, "manual_review");
  assert.equal(selectedImage.id, images[1].id);
  assert.equal(conversation.manualLocked, true);
  assert.ok(designLog);
  assert.match(designLog.note, /high|value|selected|manual|高|人工/);
  assert.match(designLog.note, /人工复核报价/);
  assert.doesNotMatch(designLog.note, /High-value customer selected/);
  assert.ok(lockLog);
  assert.match(lockLog.note, /高价值客户已选图/);
});

test("inbound high value image selection resumes durable lock review and notification after a post-commit crash", async () => {
  const { localStore, service } = setupService();
  const job = localStore.createDesignJob({
    requestId: "selection_high_value_crash_recovery_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "gift box",
    budget: { mode: "total", amount: 15000, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A", name: "box", costPrice: 35, salePrice: 80 }] },
    isHighValue: true,
  });
  const images = localStore.upsertDesignImages(job.id, [
    { imageId: "crash_candidate_1", position: 1, localPath: "C:\\storage\\crash_candidate_1.png" },
    { imageId: "crash_candidate_2", position: 2, localPath: "C:\\storage\\crash_candidate_2.png" },
  ]);
  const payload = {
    externalId: "manual-lock-selection-high-value-crash-recovery",
    text: "我选第2张，按这个继续报价",
    conversationId: "conversation_demo_1",
  };
  const originalLock = service.lockConversationForManualReview.bind(service);
  let injectCrash = true;
  service.lockConversationForManualReview = async (...args) => {
    if (injectCrash) {
      injectCrash = false;
      throw new Error("injected crash after durable high-value selection commit");
    }
    return originalLock(...args);
  };

  await assert.rejects(
    () => service.processInboundMessage(payload),
    /injected crash after durable high-value selection commit/,
  );
  const failedDocument = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"));
  const failedOperation = failedDocument.inboundMessageOperations.find((item) => item.externalId === payload.externalId);
  const committedJob = localStore.getDesignJob(job.id);
  const conversationBeforeRecovery = localStore.listConversations().find((item) => item.id === "conversation_demo_1");
  assert.equal(failedOperation.status, "retryable");
  assert.equal(failedOperation.stage, "routed");
  assert.equal(failedOperation.result.recoveryEffect.kind, "high_value_image_selection");
  assert.equal(failedOperation.result.recoveryEffect.designJobId, job.id);
  assert.equal(failedOperation.result.recoveryEffect.selectedImageId, images[1].id);
  assert.equal(committedJob.status, "manual_review");
  assert.equal(committedJob.images.find((image) => image.selected).id, images[1].id);
  assert.equal(conversationBeforeRecovery.manualLocked, false);
  assert.equal(localStore.listReviewLogs().filter((log) => log.targetId === job.id && log.decision === "high_value_customer_selected_image").length, 0);
  assert.equal(localStore.listNotifications().filter((notice) => notice.target?.designJobId === job.id).length, 0);

  service.lockConversationForManualReview = originalLock;
  const recovered = await service.processInboundMessage(payload);
  const completedOperation = localStore.getInboundMessageOperation("wechat_demo_1", payload.externalId);
  const reviewLogs = localStore.listReviewLogs().filter(
    (log) => log.targetId === job.id && log.decision === "high_value_customer_selected_image",
  );
  const notifications = localStore.listNotifications().filter(
    (notice) => notice.target?.effectKey?.endsWith(":high-value-selection-notification"),
  );
  const conversationAfterRecovery = localStore.listConversations().find((item) => item.id === "conversation_demo_1");
  assert.equal(recovered.plan.reason, "high_value_customer_selected_image");
  assert.equal(recovered.selection.result.source, "durable_recovery");
  assert.equal(recovered.designJob.id, job.id);
  assert.equal(recovered.quote, null);
  assert.equal(recovered.sendTask, null);
  assert.equal(conversationAfterRecovery.manualLocked, true);
  assert.equal(reviewLogs.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].target.designJobId, job.id);
  assert.equal(completedOperation.status, "completed");
  assert.equal(completedOperation.stage, "completed");
});

test("inbound high value budget image selection locks conversation even when flag is stale", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_high_value_budget_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "gift box",
    budget: { totalAmount: 15000, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "box", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "tea", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\selection_high_value_budget_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
    {
      imageId: "candidate_2",
      position: 2,
      localPath: "C:\\storage\\design-jobs\\selection_high_value_budget_request_1\\candidate_2.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_2.png",
    },
  ]);

  const result = await service.processInboundMessage({
    externalId: "manual-lock-selection-high-budget",
    text: "我选第2张，按这个报价",
    conversationId: "conversation_demo_1",
  });

  const conversation = localStore.listConversations().find((item) => item.id === "conversation_demo_1");
  const updatedJob = localStore.getDesignJob(job.id);
  const selectedImage = updatedJob.images.find((image) => image.selected);

  assert.equal(result.plan.reason, "high_value_customer_selected_image");
  assert.equal(result.plan.shouldNotifyHuman, true);
  assert.equal(result.quote, null);
  assert.equal(result.sendTask, null);
  assert.equal(updatedJob.status, "manual_review");
  assert.equal(selectedImage.id, images[1].id);
  assert.equal(conversation.manualLocked, true);
});

test("inbound image selection ignores design jobs with mismatched account identity", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_mismatched_account_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "gift box",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "box", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "tea", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\selection_mismatched_account_request_1\\candidate_1.png",
    },
  ]);
  localStore.updateDesignJob(job.id, { wechatAccountId: "wechat_demo_2" }, { skipIdentityValidation: true });
  const conversation = localStore.listConversations().find((item) => item.id === "conversation_demo_1");

  assert.equal(service.findLatestSelectableDesignJob(conversation), null);

  const result = await service.processInboundMessage({
    externalId: "manual-lock-selection-account-mismatch",
    text: "我选第1张",
    conversationId: "conversation_demo_1",
  });

  assert.notEqual(result.plan.type, "select_design_image_and_create_quote");
  assert.equal(result.sendTask, null);
  assert.equal(localStore.listQuoteDrafts().some((quote) => quote.designJobId === job.id), false);
});

test("inbound quote acceptance ignores quotes whose design job identity no longer matches conversation", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "quote_accept_mismatched_account_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "gift box",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "box", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "tea", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\quote_accept_mismatched_account_request_1\\candidate_1.png",
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(job.id, images[0].id);
  localStore.updateQuoteDraft(quote.id, { status: "sent" });
  localStore.updateDesignJob(job.id, { wechatAccountId: "wechat_demo_2" }, { skipIdentityValidation: true });
  const conversation = localStore.listConversations().find((item) => item.id === "conversation_demo_1");

  assert.equal(service.findLatestQuoteForConversation(conversation), undefined);

  const result = await service.processInboundMessage({
    externalId: "manual-lock-quote-identity-mismatch",
    text: "可以，就按这个方案下单",
    conversationId: "conversation_demo_1",
  });

  assert.notEqual(result.plan.type, "quote_accepted");
  assert.equal(result.orderDraft, undefined);
  assert.equal(localStore.listOrderDrafts().some((order) => order.quoteDraftId === quote.id), false);
});

test("sent low-value quote becomes unpaid order draft after customer accepts without payment", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_quote_order_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "端午员工福利礼盒",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\selection_quote_order_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
    {
      imageId: "candidate_2",
      position: 2,
      localPath: "C:\\storage\\design-jobs\\selection_quote_order_request_1\\candidate_2.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_2.png",
    },
  ]);

  const selection = await service.processInboundMessage({
    externalId: "manual-lock-quote-accept-selection",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "我选第2张，就按这个报价",
  });

  assert.equal(selection.plan.reason, "low_value_customer_selected_image_quote_queued");
  assert.equal(selection.quote.status, "send_queued");
  assert.equal(selection.quote.selectedImageId, images[1].id);
  assert.equal(selection.sendTask.status, "queued");

  createPassingWechatWindowSnapshot(localStore, "我选第2张，就按这个报价");
  const sendScan = await service.processSafeSendQueue({ adapter: "windows_bridge" });
  assert.equal(sendScan.processed.length, 1);
  assert.equal(sendScan.processed[0].task.id, selection.sendTask.id);
  assert.equal(sendScan.processed[0].task.status, "sending");

  const ack = acknowledgeStartedBridgeSend(service, localStore, selection.sendTask.id);
  assert.equal(ack.task.status, "sent");
  const sentQuote = localStore.getQuoteDraft(selection.quote.id);
  assert.equal(sentQuote.status, "sent");
  assert.equal(sentQuote.sendTask.status, "sent");

  const acceptance = await service.processInboundMessage({
    externalId: "manual-lock-quote-accept-unpaid",
    text: "可以，就按这个方案下单",
    conversationId: "conversation_demo_1",
  });

  assert.equal(acceptance.plan.type, "quote_accepted");
  assert.equal(acceptance.plan.reason, "customer_quote_accepted");
  assert.equal(acceptance.plan.shouldQueueReply, false);
  assert.equal(acceptance.quote.status, "accepted");
  assert.equal(acceptance.orderDraft.quoteDraftId, selection.quote.id);
  assert.equal(acceptance.orderDraft.status, "draft");
  assert.equal(acceptance.orderDraft.paymentStatus, "unpaid");
  assert.equal(acceptance.sendTask, null);
  const notification = localStore
    .listNotifications()
    .find((item) => item.target?.quoteDraftId === selection.quote.id && item.target?.orderDraftId === acceptance.orderDraft.id);
  assert.ok(notification);
  assert.match(notification.body, /order|draft|payment|订单|付款/);
  assert.equal(notification.target.confirmationReason, "payment_not_ready");
});

test("sent low-value quote does not mark paid when customer asks how to pay deposit", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_quote_deposit_question_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "端午员工福利礼盒",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\selection_quote_deposit_question_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(job.id, images[0].id);
  localStore.updateQuoteDraft(quote.id, { status: "sent", paymentStatus: "unpaid" });

  const acceptance = await service.processInboundMessage({
    externalId: "manual-lock-quote-payment-question",
    text: "可以，就这套，定金怎么付",
    conversationId: "conversation_demo_1",
  });

  assert.equal(acceptance.plan.type, "quote_accepted");
  assert.equal(acceptance.plan.reason, "customer_quote_accepted");
  assert.equal(acceptance.plan.shouldQueueReply, false);
  assert.equal(acceptance.quote.status, "accepted");
  assert.equal(acceptance.quote.paymentStatus, "unpaid");
  assert.equal(acceptance.orderDraft.status, "draft");
  assert.equal(acceptance.orderDraft.paymentStatus, "unpaid");
  assert.equal(acceptance.sendTask, null);
});

test("sent low-value quote queues order confirmation after customer confirms deposit", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "selection_quote_paid_order_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "端午员工福利礼盒",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\selection_quote_paid_order_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(job.id, images[0].id);
  localStore.updateQuoteDraft(quote.id, { status: "sent", paymentStatus: "unpaid" });

  const acceptance = await service.processInboundMessage({
    externalId: "manual-lock-quote-payment-confirmed",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "定金已经转账了，麻烦安排制作",
  });

  assert.equal(acceptance.plan.type, "quote_accepted");
  assert.equal(acceptance.plan.reason, "customer_payment_confirmed");
  assert.equal(acceptance.plan.shouldQueueReply, true);
  assert.equal(acceptance.quote.status, "accepted");
  assert.equal(acceptance.quote.paymentStatus, "deposit_paid");
  assert.equal(acceptance.orderDraft.quoteDraftId, quote.id);
  assert.equal(acceptance.orderDraft.status, "confirmed");
  assert.equal(acceptance.orderDraft.paymentStatus, "deposit_paid");
  assert.equal(acceptance.sendTask.status, "queued");
  assert.equal(acceptance.sendTask.quoteDraftId, quote.id);
  assert.equal(acceptance.sendTask.guardSnapshot.automation.source, "low_value_quote_acceptance");
  assert.equal(acceptance.sendTask.guardSnapshot.automation.orderDraftId, acceptance.orderDraft.id);
  assert.match(acceptance.sendTask.payload.text, /订单|确认|9000/);
  assert.match(acceptance.sendTask.payload.text, /第1张效果图/);
});

test("inbound payment proof attachment with paid wording still requires manual verification", async () => {
  const { localStore, service, reviews } = setupService();

  const job = localStore.createDesignJob({
    requestId: "payment_proof_paid_text_manual_review_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "端午员工福利礼盒",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\payment_proof_paid_text_manual_review_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(job.id, images[0].id);
  localStore.updateQuoteDraft(quote.id, { status: "sent", paymentStatus: "unpaid" });

  const result = await service.processInboundMessage({
    externalId: "manual-lock-payment-proof-paid-wording",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "定金已经转账了，截图发你",
    attachments: [{ role: "payment_proof", fileName: "定金转账截图.png" }],
  });

  const updatedQuote = localStore.getQuoteDraft(quote.id);
  const notification = localStore
    .listNotifications()
    .find((item) => item.target?.quoteDraftId === quote.id && item.target?.reason === "payment_proof_needs_manual_verification");
  const reviewCenter = await reviews.list({ conversationId: "conversation_demo_1" });

  assert.equal(result.plan.type, "quote_payment_proof_manual_review");
  assert.equal(result.plan.shouldNotifyHuman, true);
  assert.equal(result.quoteAcceptance.reason, "payment_proof_needs_manual_verification");
  assert.equal(result.quoteAcceptance.originalReason, "customer_payment_confirmed");
  assert.equal(result.sendTask, null);
  assert.equal(updatedQuote.paymentStatus, "unpaid");
  assert.equal(updatedQuote.status, "manual_review");
  assert.equal(result.quote.status, "manual_review");
  assert.match(updatedQuote.customerNotes, /manual|verification|payment|人工|核验/);
  assert.equal(localStore.listOrderDrafts().some((order) => order.quoteDraftId === quote.id), false);
  assert.ok(notification);
  assert.match(notification.body, /manual|verification|payment|人工|核对/);
  assert.equal(reviewCenter.quoteDrafts.some((item) => item.id === quote.id), true);
  await assert.rejects(
    () =>
      reviews.reviewQuote(quote.id, {
        decision: "approve_quote",
        reviewer: "人工客服",
        expectedWechatAccountId: "wechat_demo_1",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
      }),
    /payment|proof|manual|verification|付款|凭证/,
  );
});

test("manual payment proof verification rejects quote without selected image before order queueing", async () => {
  const { localStore, quotes } = setupService();

  const job = localStore.createDesignJob({
    requestId: "payment_proof_without_selected_image_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "端午员工福利礼盒",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\payment_proof_without_selected_image_request_1\\candidate_1.png",
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(job.id);
  localStore.updateQuoteDraft(quote.id, { status: "manual_review", paymentStatus: "unpaid" });

  await assert.rejects(
    () =>
      quotes.verifyPaymentProofAndQueueConfirmation(quote.id, {
        ...demoExpectedIdentity(),
        operationKey: "manual-lock-payment-proof-without-selected-image",
        paymentStatus: "deposit_paid",
        owner: "人工客服",
        note: "人工核验付款前必须先绑定客户选图。",
      }),
    /selected design image/,
  );

  const unchangedQuote = localStore.getQuoteDraft(quote.id);
  assert.equal(unchangedQuote.paymentStatus, "unpaid");
  assert.equal(unchangedQuote.selectedImageId, null);
  assert.equal(localStore.listOrderDrafts().some((order) => order.quoteDraftId === quote.id), false);
  assert.equal(localStore.listSendTasks().some((task) => task.quoteDraftId === quote.id), false);
});

test("payment proof screenshot fingerprint is not treated as design image selection", async () => {
  const { localStore, service } = setupService();

  const job = localStore.createDesignJob({
    requestId: "payment_proof_fingerprint_manual_review_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "端午员工福利礼盒",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      fingerprint: "aaaaaaaaaaaaaaaa",
      localPath: "C:\\storage\\design-jobs\\payment_proof_fingerprint_manual_review_request_1\\candidate_1.png",
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(job.id, images[0].id);
  localStore.updateQuoteDraft(quote.id, { status: "sent", paymentStatus: "unpaid" });
  const originalSelectedImageId = quote.selectedImageId;

  const result = await service.processInboundMessage({
    externalId: "manual-lock-payment-proof-fingerprint",
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "定金已经转账了，付款截图发你",
    attachments: [
      {
        role: "payment_proof",
        type: "image",
        fileName: "付款截图.png",
        screenshotFingerprint: "aaaaaaaaaaaaaaaa",
      },
    ],
  });

  const updatedQuote = localStore.getQuoteDraft(quote.id);
  const updatedJob = localStore.getDesignJob(job.id);

  assert.equal(result.plan.type, "quote_payment_proof_manual_review");
  assert.equal(result.plan.shouldNotifyHuman, true);
  assert.equal(result.quoteAcceptance.reason, "payment_proof_needs_manual_verification");
  assert.equal(result.sendTask, null);
  assert.equal(result.quote.id, quote.id);
  assert.equal(updatedQuote.paymentStatus, "unpaid");
  assert.equal(updatedQuote.status, "manual_review");
  assert.equal(updatedQuote.selectedImageId, originalSelectedImageId);
  assert.equal(updatedJob.images.filter((image) => image.selected).length, 0);
  assert.equal(localStore.listQuoteDrafts().filter((item) => item.designJobId === job.id).length, 1);
  assert.equal(localStore.listOrderDrafts().some((order) => order.quoteDraftId === quote.id), false);
});

test("inbound payment proof attachment goes to manual verification without marking paid", async () => {
  const { localStore, service, reviews } = setupService();

  const job = localStore.createDesignJob({
    requestId: "payment_proof_manual_review_request_1",
    status: "sent",
    customerId: "customer_demo_1",
    conversationId: "conversation_demo_1",
    wechatAccountId: "wechat_demo_1",
    scene: "端午员工福利礼盒",
    budget: { mode: "per_box", amount: 180, quantity: 50 },
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", costPrice: 35, salePrice: 80 },
        { skuCode: "TEA-A", name: "明前绿茶A", costPrice: 60, salePrice: 100 },
      ],
    },
    isHighValue: false,
  });
  const images = localStore.upsertDesignImages(job.id, [
    {
      imageId: "candidate_1",
      position: 1,
      localPath: "C:\\storage\\design-jobs\\payment_proof_manual_review_request_1\\candidate_1.png",
      downloadUrl: "http://127.0.0.1:3700/files/candidate_1.png",
    },
  ]);
  const quote = localStore.createQuoteFromDesignJob(job.id, images[0].id);
  localStore.updateQuoteDraft(quote.id, { status: "sent", paymentStatus: "unpaid" });

  const result = await service.processInboundMessage({
    externalId: "manual-lock-payment-proof-attachment",
    text: "付款截图发你了",
    conversationId: "conversation_demo_1",
    attachments: [{ role: "payment_proof", fileName: "付款截图.png" }],
  });

  const updatedQuote = localStore.getQuoteDraft(quote.id);
  const notification = localStore
    .listNotifications()
    .find((item) => item.target?.quoteDraftId === quote.id && item.target?.reason === "payment_proof_needs_manual_verification");
  const reviewLog = localStore
    .listReviewLogs()
    .find((log) => log.targetType === "quote_draft" && log.targetId === quote.id && log.decision === "payment_proof_needs_manual_verification");
  const reviewCenter = await reviews.list({ conversationId: "conversation_demo_1" });

  assert.equal(result.plan.type, "quote_payment_proof_manual_review");
  assert.equal(result.plan.shouldNotifyHuman, true);
  assert.equal(result.sendTask, null);
  assert.match(
    fs.readFileSync(path.join(process.cwd(), "apps/api/src/wechat/wechat-dispatch.service.ts"), "utf8"),
    /payment_proof_needs_manual_verification/,
  );
  assert.equal(updatedQuote.paymentStatus, "unpaid");
  assert.equal(updatedQuote.status, "manual_review");
  assert.equal(result.quote.status, "manual_review");
  assert.match(updatedQuote.customerNotes, /manual|verification|payment|人工|核验/);
  assert.equal(localStore.listOrderDrafts().some((order) => order.quoteDraftId === quote.id), false);
  assert.ok(notification);
  assert.match(reviewLog.note, /人工核对|人工|付款/);
  assert.ok(reviewLog);
  assert.match(reviewLog.note, /manual|payment|status|人工|付款/);
  assert.equal(reviewCenter.quoteDrafts.some((item) => item.id === quote.id), true);
});
