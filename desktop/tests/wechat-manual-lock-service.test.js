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
const { ReviewsService } = require("../apps/api/src/reviews/reviews.service");
const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

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

  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  const notifications = new NotificationsService({}, localStore);
  const sendAdapter = new WechatSendAdapterService();
  const orders = overrides.orders || new OrdersService({}, localStore, notifications);
  const service = new WechatDispatchService({}, localStore, sendAdapter, notifications, orders);
  const reviews = new ReviewsService({}, localStore, {}, {}, notifications);

  return { tempDir, localStore, service, reviews, orders };
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

function createPassingWechatWindowSnapshot(localStore, recentMessageText = "") {
  return localStore.createWechatWindowSnapshot({
    source: "test",
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
  return service.acknowledgeBridgeSend(taskId, {
    status: "sent",
    version: "wechat_bridge_ack_v1",
    ackToken: outbox.ackToken,
    taskId,
    attemptId: attempt.id,
    wechatAccountId: task.wechatAccountId,
    conversationId: task.conversationId,
    outboxFileName: path.basename(outboxFile),
    sentAt: new Date().toISOString(),
  });
}

test("manual lock cancels in-flight bridge send tasks and archives outbox", async () => {
  const { localStore, service } = setupService();

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
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
  assert.deepEqual(result.log.metadata.cancelledInFlightSendTaskIds, [task.id]);
  assert.equal(updatedTask.status, "cancelled");
  assert.match(result.log.note, /人工.*接管/);
  assert.equal(updatedAttempt.id, attempt.id);
  assert.equal(updatedAttempt.status, "failed");
  assert.equal(fs.existsSync(outboxFile), false);
  assert.equal(fs.readdirSync(cancelledDir).some((fileName) => fileName.endsWith("manual-lock-send.json")), true);
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
    locked: true,
    reviewer: "test",
    reason: "manual_takeover_test",
  });
  const release = await service.setConversationManualLock("conversation_demo_1", {
    locked: false,
    reviewer: "test",
    reason: "manual_release_test",
    note: "manual handled the customer question and can resume automation",
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
  assert.equal(updatedSendingTask.status, "cancelled");
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === "conversation_demo_1" && task.status === "queued").length, 0);
});

test("manual release requires explicit manual reason and keeps conversation locked", async () => {
  const { localStore, service } = setupService();

  await service.setConversationManualLock("conversation_demo_1", {
    locked: true,
    reviewer: "test",
    reason: "manual_takeover_test",
  });
  const reviewLogCount = localStore.listReviewLogs().length;

  await assert.rejects(
    () => service.setConversationManualLock("conversation_demo_1", { locked: false, reviewer: "test" }),
    /需要填写明确的人工处理原因/,
  );

  const conversation = localStore.listConversations().find((item) => item.id === "conversation_demo_1");
  assert.equal(conversation.manualLocked, true);
  assert.equal(localStore.listReviewLogs().length, reviewLogCount);
});

test("manual release requires a resolution note and keeps conversation locked", async () => {
  const { localStore, service } = setupService();

  await service.setConversationManualLock("conversation_demo_1", {
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
    localPath: path.join("storage", "assets", "customer", "customer_demo_1", "logo.png"),
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
    localPath: path.join("storage", "assets", "sku", "sku_demo_1", "sku.png"),
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

  const task = localStore.createSendTask({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    status: "blocked",
    payload: { kind: "text", text: "manual requeue should keep reason" },
    guardSnapshot: {
      requiredChecks: ["wechatAccount", "activeChatTitle", "recentMessageOrCustomerId"],
      policy: "single-account-serial-queue",
      history: [{ action: "manual_lock_block", fromStatus: "queued", reason: "manual takeover" }],
    },
  });

  const updated = await service.requeueSendTask(task.id, {
    reason: "manual_resolution_before_send_requeue",
  });

  assert.equal(updated.status, "queued");
  assert.equal(updated.guardSnapshot.requeueReason, "manual_resolution_before_send_requeue");
  assert.equal(updated.guardSnapshot.history.at(-1).action, "requeue");
  assert.equal(updated.guardSnapshot.history.at(-1).reason, "manual_resolution_before_send_requeue");
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
        mode: "correct",
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
    mode: "correct",
    expectedWechatAccountId: "wechat_demo_1",
    expectedConversationId: "conversation_demo_1",
    expectedCustomerId: "customer_demo_1",
  });

  assert.equal(result.id, task.id);
  assert.equal(result.wechatAccountId, "wechat_demo_1");
  assert.equal(result.conversationId, "conversation_demo_1");
  assert.equal(result.guardSnapshot.status, "passed");
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
    () => service.createDemoSendTask({ conversationId: "conversation_demo_1", wechatAccountId: "wechat_demo_1" }),
    /demo send task requires conversation identity/,
  );
  assert.throws(
    () =>
      service.createDemoSendTask({
        conversationId: "conversation_demo_1",
        wechatAccountId: "wechat_demo_1",
        expectedWechatAccountId: "wechat_demo_2",
        expectedConversationId: "conversation_demo_1",
        expectedCustomerId: "customer_demo_1",
      }),
    /demo send task identity mismatch/,
  );

  const task = service.createDemoSendTask({
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
        outboxFileName: path.basename(outboxFile),
      }),
    /bridge ack send task binding invalid/,
  );

  assert.equal(localStore.getSendTask(task.id).status, "sending");
  assert.equal(localStore.getLatestSendAttempt(task.id, { adapter: "windows_bridge" }).status, "started");
});

test("manual lock blocks order confirmation queueing before order state changes", async () => {
  const order = buildOrderDraft();
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
  const order = buildOrderDraft();
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

test("send operation scan fails bridge task when pending outbox file is missing", async () => {
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
  assert.equal(updated.status, "failed");
  assert.match(updated.errorMessage, /outbox_file_missing/);
  assert.equal(updatedAttempt.status, "failed");
  assert.match(updatedAttempt.errorMessage, /outbox_file_missing/);
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
  const correction = localStore.correctRouteEvaluation(route.id, {
    agentKey: "gift_design",
    scene: "礼盒设计",
    idealReply: "可以的，我先按您的预算和用途整理礼盒方案。",
  });

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
    text: "我选第2张，按这个报价",
    conversationId: "conversation_demo_1",
  });

  assert.equal(firstSelection.plan.reason, "low_value_customer_selected_image_quote_queued");
  assert.equal(firstSelection.quote.selectedImageId, images[1].id);
  assert.equal(localStore.getDesignJob(job.id).status, "quote_created");

  const reselection = await service.processInboundMessage({
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
