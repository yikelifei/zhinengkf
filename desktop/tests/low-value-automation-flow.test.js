"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { OrdersService } = require("../apps/api/src/orders/orders.service");
const { QuotesService } = require("../apps/api/src/quotes/quotes.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");

function emptyStoreData(overrides = {}) {
  return {
    wechatAccounts: [],
    customers: [],
    conversations: [],
    messages: [],
    wechatWindowSnapshots: [],
    skus: [],
    skuChangeLogs: [],
    designAssets: [],
    designJobs: [],
    designImages: [],
    designRevisions: [],
    notifications: [],
    sendTasks: [],
    sendAttempts: [],
    quoteDrafts: [],
    orderDrafts: [],
    reviewLogs: [],
    agents: [],
    agentSkills: [],
    chatImports: [],
    trainingSamples: [],
    knowledgeEntries: [],
    routeEvaluations: [],
    automationRuns: [],
    ...overrides,
  };
}

function createStore(seed) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "low-value-automation-flow-"));
  const store = new LocalStoreService();
  store.filePath = path.join(tempDir, "local-store.json");
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(store.filePath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  return { store, tempDir };
}

function configureBridgeDirs(tempDir) {
  appConfig.wechatBridgeOutboxDir = path.join(tempDir, "outbox");
  appConfig.wechatBridgeInboxDir = path.join(tempDir, "inbox");
  appConfig.wechatBridgeDispatchDir = path.join(tempDir, "dispatch");
  appConfig.wechatBridgeLockDir = path.join(tempDir, "locks");
  appConfig.wechatBridgeWorkerStatusFile = path.join(tempDir, "worker-status.json");
}

function createServices(store, notifications) {
  const notificationService = {
    create: async (level, title, body, metadata) => {
      const record = { level, title, body, metadata };
      notifications.push(record);
      return { id: `notice_${notifications.length}`, ...record };
    },
  };
  const orders = new OrdersService({}, store, notificationService);
  const sendAdapter = new WechatSendAdapterService();
  const wechatDispatch = new WechatDispatchService({}, store, sendAdapter, notificationService, orders);
  const quotes = new QuotesService({}, store, orders, wechatDispatch);
  const designJobs = new DesignJobsService(
    {},
    {},
    store,
    notificationService,
    {},
    wechatDispatch,
    quotes,
    orders,
  );

  return { designJobs, quotes, orders, wechatDispatch };
}

function createPassingWechatWindowSnapshot(store, recentMessageText = "") {
  return store.createWechatWindowSnapshot({
    source: "test",
    isOnline: true,
    wechatAccountId: "wechat_1",
    accountDisplayName: "客服微信1",
    chatTitle: "张经理-员工福利礼盒",
    activeChatTitle: "张经理-员工福利礼盒",
    externalChatId: "customer_1_chat",
    recentCustomerId: "customer_1",
    recentMessageText,
    confidence: 1,
    capturedAt: new Date().toISOString(),
  });
}

function safeBridgeFileSegment(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function writeDispatchInstructionForStartedBridgeSend(store, taskId) {
  const task = store.getSendTask(taskId);
  const attempt = store.getLatestSendAttempt(taskId, {
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
          actionCount: 1,
          actions: [{ type: "text", text }],
          constraints: { doNotSendAfter: expiresAt },
        },
        ack: {
          requiredAttemptId: attempt.id,
          requiredOutboxFileName: outboxFileName,
        },
        createdAt: new Date().toISOString(),
        expiresAt,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function acknowledgeStartedBridgeSend(service, store, taskId) {
  const task = store.getSendTask(taskId);
  const attempt = store.getLatestSendAttempt(taskId, {
    adapter: "windows_bridge",
    status: "started",
  });
  assert.ok(task, "send task should exist before bridge ack");
  assert.ok(attempt, "started bridge attempt should exist before bridge ack");
  writeDispatchInstructionForStartedBridgeSend(store, taskId);
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

test("low-value customer image selection flows to quote send queue and order draft without identity drift", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousBridgeConfig = {
    outbox: appConfig.wechatBridgeOutboxDir,
    inbox: appConfig.wechatBridgeInboxDir,
    dispatch: appConfig.wechatBridgeDispatchDir,
    lock: appConfig.wechatBridgeLockDir,
    worker: appConfig.wechatBridgeWorkerStatusFile,
  };
  appConfig.useLocalStore = true;

  const { store, tempDir } = createStore(
    emptyStoreData({
      wechatAccounts: [{ id: "wechat_1", nickname: "客服微信1", status: "online" }],
      customers: [{ id: "customer_1", name: "张经理" }],
      conversations: [
        {
          id: "conversation_1",
          wechatAccountId: "wechat_1",
          customerId: "customer_1",
          customerName: "张经理",
          title: "张经理-员工福利礼盒",
          externalChatId: "customer_1_chat",
          status: "active",
          manualLocked: false,
        },
      ],
      designJobs: [
        {
          id: "design_1",
          requestId: "request_1",
          status: "sent",
          wechatAccountId: "wechat_1",
          customerId: "customer_1",
          conversationId: "conversation_1",
          isHighValue: false,
          budget: {
            mode: "per_box",
            perUnitAmount: 160,
            quantity: 20,
            totalAmount: 3200,
          },
          scene: "员工福利",
          customerText: "想看员工福利礼盒，预算不高但要显得用心。",
          bundle: {
            items: [
              { skuCode: "BOX-A", name: "礼盒", salePrice: 60, costPrice: 30 },
              { skuCode: "TEA-A", name: "茶叶", salePrice: 80, costPrice: 38 },
            ],
            automation: { ready: true, blockers: [] },
          },
          outputCount: 6,
        },
      ],
      designImages: [
        {
          id: "image_1",
          designJobId: "design_1",
          imageId: "candidate_1",
          position: 1,
          localPath: "C:\\storage\\design_1\\candidate_1.png",
          selected: false,
        },
        {
          id: "image_2",
          designJobId: "design_1",
          imageId: "candidate_2",
          position: 2,
          localPath: "C:\\storage\\design_1\\candidate_2.png",
          selected: false,
        },
      ],
    }),
  );
  configureBridgeDirs(tempDir);
  const notifications = [];
  const { designJobs, quotes, orders, wechatDispatch } = createServices(store, notifications);

  try {
    const selection = await designJobs.selectImage("design_1", {
      text: "就第2张吧，按这个报价",
      expectedWechatAccountId: "wechat_1",
      expectedConversationId: "conversation_1",
      expectedCustomerId: "customer_1",
    });

    assert.equal(selection.matched, true);
    assert.equal(selection.reviewRequired, false);
    assert.equal(selection.autoQuoteCreated, true);
    assert.equal(selection.nextStatus, "quote_created");
    assert.equal(selection.quote.status, "auto_sent");
    assert.equal(selection.quote.selectedImageId, "image_2");
    assert.equal(selection.quote.totalPrice, 2800);
    assert.equal(selection.quote.profit, 1440);

    const quoteSend = await quotes.scanLowValueAutoQuoteSends({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
    });

    assert.equal(quoteSend.queued.length, 1);
    assert.equal(quoteSend.failed.length, 0);
    const queuedQuote = quoteSend.queued[0].quote;
    const quoteSendTask = quoteSend.queued[0].sendTask;
    assert.equal(queuedQuote.status, "send_queued");
    assert.equal(queuedQuote.selectedImageId, "image_2");
    assert.equal(quoteSendTask.wechatAccountId, "wechat_1");
    assert.equal(quoteSendTask.conversationId, "conversation_1");
    assert.equal(quoteSendTask.quoteDraftId, queuedQuote.id);
    assert.equal(quoteSendTask.designJobId, "design_1");
    assert.equal(quoteSendTask.payload.kind, "quote");
    assert.equal(quoteSendTask.guardSnapshot.binding.ok, true);

    store.updateQuoteDraft(queuedQuote.id, {
      status: "sent",
      customerNotes: "测试中模拟微信桥已确认报价发送。",
    });
    store.updateSendTask(quoteSendTask.id, {
      status: "sent",
      sentAt: new Date().toISOString(),
      errorMessage: "",
    });

    const orderDraft = await orders.scanLowValueAutoOrderDrafts({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
    });

    assert.equal(orderDraft.created.length, 1);
    assert.equal(orderDraft.failed.length, 0);
    assert.equal(orderDraft.skipped.length, 0);
    const order = orderDraft.created[0];
    assert.equal(order.quoteDraftId, queuedQuote.id);
    assert.equal(order.designJobId, "design_1");
    assert.equal(order.wechatAccountId, "wechat_1");
    assert.equal(order.conversationId, "conversation_1");
    assert.equal(order.customerId, "customer_1");
    assert.equal(order.selectedImageId, "image_2");
    assert.equal(order.status, "draft");
    assert.equal(order.paymentStatus, "unpaid");
    assert.equal(order.totalPrice, 2800);
    assert.equal(order.profit, 1440);

    const unacceptedConfirmation = await wechatDispatch.scanLowValueOrderConfirmations({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
    });

    assert.equal(unacceptedConfirmation.queued.length, 0);
    assert.equal(unacceptedConfirmation.failed.length, 0);
    assert.equal(unacceptedConfirmation.skipped.length, 1);
    assert.equal(unacceptedConfirmation.skipped[0].orderDraftId, order.id);
    assert.equal(unacceptedConfirmation.skipped[0].reason, "quote_not_accepted");

    store.updateQuoteDraft(queuedQuote.id, {
      status: "accepted",
      customerNotes: "测试中模拟客户已确认报价但还没有付款。",
    });

    const unpaidConfirmation = await wechatDispatch.scanLowValueOrderConfirmations({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
    });

    assert.equal(unpaidConfirmation.queued.length, 0);
    assert.equal(unpaidConfirmation.failed.length, 0);
    assert.equal(unpaidConfirmation.skipped.length, 1);
    assert.equal(unpaidConfirmation.skipped[0].orderDraftId, order.id);
    assert.equal(unpaidConfirmation.skipped[0].reason, "payment_not_ready");

    await assert.rejects(
      () =>
        orders.update(order.id, {
          expectedWechatAccountId: "wechat_1",
          expectedConversationId: "conversation_1",
          expectedCustomerId: "customer_1",
          status: "processing",
          owner: "测试客服",
        }),
      /付款|定金|全款/,
    );

    await orders.recordVerifiedPayment(order.id, {
      expectedWechatAccountId: "wechat_1",
      expectedConversationId: "conversation_1",
      expectedCustomerId: "customer_1",
      paymentStatus: "deposit_paid",
      owner: "测试客服",
    });

    const confirmation = await wechatDispatch.scanLowValueOrderConfirmations({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
    });

    assert.equal(confirmation.queued.length, 1);
    assert.equal(confirmation.failed.length, 0);
    const confirmationSendTask = confirmation.queued[0].sendTask;
    assert.equal(confirmationSendTask.wechatAccountId, "wechat_1");
    assert.equal(confirmationSendTask.conversationId, "conversation_1");
    assert.equal(confirmationSendTask.designJobId, "design_1");
    assert.equal(confirmationSendTask.quoteDraftId, queuedQuote.id);
    assert.equal(confirmationSendTask.guardSnapshot.binding.ok, true);
    assert.equal(confirmationSendTask.guardSnapshot.reason, "low_value_order_confirmation");
    assert.equal(confirmationSendTask.guardSnapshot.automation.source, "order_confirmation");
    assert.equal(confirmationSendTask.guardSnapshot.automation.orderDraftId, order.id);
    assert.match(confirmationSendTask.payload.text, /第2张效果图/);
    assert.match(confirmationSendTask.payload.text, /员工福利/);
    assert.match(confirmationSendTask.payload.text, /数量 20 份/);
    assert.match(confirmationSendTask.payload.text, /合计 2800 元/);
    assert.match(confirmationSendTask.payload.text, /定金/);

    createPassingWechatWindowSnapshot(store, "定金已经转了，麻烦安排制作");
    const confirmationSend = await wechatDispatch.processSafeSendQueue({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
      adapter: "windows_bridge",
    });
    assert.equal(confirmationSend.processed.length, 1);
    assert.equal(confirmationSend.processed[0].task.id, confirmationSendTask.id);
    assert.equal(confirmationSend.processed[0].task.status, "sending");
    const confirmationAck = acknowledgeStartedBridgeSend(wechatDispatch, store, confirmationSendTask.id);
    assert.equal(confirmationAck.task.status, "sent");
    assert.equal(store.getSendTask(confirmationSendTask.id).status, "sent");

    const duplicateConfirmation = await wechatDispatch.scanLowValueOrderConfirmations({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
    });
    assert.equal(duplicateConfirmation.queued.length, 0);
    assert.equal(duplicateConfirmation.skipped[0].reason, "already_queued");

    await orders.update(order.id, {
      expectedWechatAccountId: "wechat_1",
      expectedConversationId: "conversation_1",
      expectedCustomerId: "customer_1",
      status: "processing",
      owner: "测试客服",
    });

    const productionFollowup = await wechatDispatch.scanLowValueOrderFollowups({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
    });

    assert.equal(productionFollowup.queued.length, 1);
    assert.equal(productionFollowup.failed.length, 0);
    const productionSendTask = productionFollowup.queued[0].sendTask;
    assert.equal(productionSendTask.wechatAccountId, "wechat_1");
    assert.equal(productionSendTask.conversationId, "conversation_1");
    assert.equal(productionSendTask.designJobId, "design_1");
    assert.equal(productionSendTask.quoteDraftId, queuedQuote.id);
    assert.equal(productionSendTask.guardSnapshot.binding.ok, true);
    assert.equal(productionSendTask.guardSnapshot.reason, "low_value_order_followup");
    assert.equal(productionSendTask.guardSnapshot.automation.source, "order_followup");
    assert.equal(productionSendTask.guardSnapshot.automation.followupType, "production");
    assert.equal(productionSendTask.guardSnapshot.automation.orderDraftId, order.id);
    assert.match(productionSendTask.payload.text, /订单进度/);
    assert.match(productionSendTask.payload.text, /员工福利/);
    assert.match(productionSendTask.payload.text, /礼盒、茶叶/);
    assert.match(productionSendTask.payload.text, /数量 20 份/);
    assert.match(productionSendTask.payload.text, /金额 2800 元/);
    assert.match(productionSendTask.payload.text, /备货|排产/);

    createPassingWechatWindowSnapshot(store, "好的，有进度麻烦同步");
    const productionSend = await wechatDispatch.processSafeSendQueue({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
      adapter: "windows_bridge",
    });
    assert.equal(productionSend.processed.length, 1);
    assert.equal(productionSend.processed[0].task.id, productionSendTask.id);
    assert.equal(productionSend.processed[0].task.status, "sending");
    const productionAck = acknowledgeStartedBridgeSend(wechatDispatch, store, productionSendTask.id);
    assert.equal(productionAck.task.status, "sent");
    assert.equal(store.getSendTask(productionSendTask.id).status, "sent");

    const duplicateProductionFollowup = await wechatDispatch.scanLowValueOrderFollowups({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
    });
    assert.equal(duplicateProductionFollowup.queued.length, 0);
    assert.equal(duplicateProductionFollowup.skipped.length, 1);
    assert.equal(duplicateProductionFollowup.skipped[0].reason, "already_queued");
    assert.deepEqual(duplicateProductionFollowup.skipped[0].missing, ["productionFollowupSendTask"]);

    await orders.recordVerifiedPayment(order.id, {
      expectedWechatAccountId: "wechat_1",
      expectedConversationId: "conversation_1",
      expectedCustomerId: "customer_1",
      paymentStatus: "paid",
      owner: "测试客服",
    });
    await orders.update(order.id, {
      expectedWechatAccountId: "wechat_1",
      expectedConversationId: "conversation_1",
      expectedCustomerId: "customer_1",
      status: "fulfilled",
      owner: "测试客服",
    });

    const deliveryFollowup = await wechatDispatch.scanLowValueOrderFollowups({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
    });

    assert.equal(deliveryFollowup.queued.length, 1);
    assert.equal(deliveryFollowup.failed.length, 0);
    const deliverySendTask = deliveryFollowup.queued[0].sendTask;
    assert.equal(deliverySendTask.wechatAccountId, "wechat_1");
    assert.equal(deliverySendTask.conversationId, "conversation_1");
    assert.equal(deliverySendTask.designJobId, "design_1");
    assert.equal(deliverySendTask.quoteDraftId, queuedQuote.id);
    assert.equal(deliverySendTask.guardSnapshot.binding.ok, true);
    assert.equal(deliverySendTask.guardSnapshot.reason, "low_value_order_followup");
    assert.equal(deliverySendTask.guardSnapshot.automation.source, "order_followup");
    assert.equal(deliverySendTask.guardSnapshot.automation.followupType, "delivery");
    assert.equal(deliverySendTask.guardSnapshot.automation.orderDraftId, order.id);
    assert.match(deliverySendTask.payload.text, /订单进度/);
    assert.match(deliverySendTask.payload.text, /员工福利/);
    assert.match(deliverySendTask.payload.text, /金额 2800 元/);
    assert.match(deliverySendTask.payload.text, /交付|物流|发货/);
    assert.match(deliverySendTask.payload.text, /款项状态已记录/);

    createPassingWechatWindowSnapshot(store, "收到，发货前告诉我");
    const deliverySend = await wechatDispatch.processSafeSendQueue({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
      adapter: "windows_bridge",
    });
    assert.equal(deliverySend.processed.length, 1);
    assert.equal(deliverySend.processed[0].task.id, deliverySendTask.id);
    assert.equal(deliverySend.processed[0].task.status, "sending");
    const deliveryAck = acknowledgeStartedBridgeSend(wechatDispatch, store, deliverySendTask.id);
    assert.equal(deliveryAck.task.status, "sent");
    assert.equal(store.getSendTask(deliverySendTask.id).status, "sent");

    const duplicateDeliveryFollowup = await wechatDispatch.scanLowValueOrderFollowups({
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
    });
    assert.equal(duplicateDeliveryFollowup.queued.length, 0);
    assert.equal(duplicateDeliveryFollowup.skipped.length, 1);
    assert.equal(duplicateDeliveryFollowup.skipped[0].reason, "already_queued");
    assert.deepEqual(duplicateDeliveryFollowup.skipped[0].missing, ["deliveryFollowupSendTask"]);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.wechatBridgeOutboxDir = previousBridgeConfig.outbox;
    appConfig.wechatBridgeInboxDir = previousBridgeConfig.inbox;
    appConfig.wechatBridgeDispatchDir = previousBridgeConfig.dispatch;
    appConfig.wechatBridgeLockDir = previousBridgeConfig.lock;
    appConfig.wechatBridgeWorkerStatusFile = previousBridgeConfig.worker;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
