"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function setupService(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-lock-send-"));
  process.env.WECHAT_BRIDGE_OUTBOX_DIR = path.join(tempDir, "outbox");
  process.env.WECHAT_BRIDGE_INBOX_DIR = path.join(tempDir, "inbox");
  process.env.WECHAT_BRIDGE_LOCK_DIR = path.join(tempDir, "locks");
  process.env.WECHAT_BRIDGE_WORKER_STATUS_FILE = path.join(tempDir, "worker-status.json");

  require("ts-node").register({
    transpileOnly: true,
    compilerOptions: { module: "CommonJS" },
  });
  const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
  const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
  const { OrdersService } = require("../apps/api/src/orders/orders.service");
  const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
  const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
  const { appConfig } = require("../apps/api/src/shared/app-config");

  appConfig.wechatBridgeOutboxDir = process.env.WECHAT_BRIDGE_OUTBOX_DIR;
  appConfig.wechatBridgeInboxDir = process.env.WECHAT_BRIDGE_INBOX_DIR;
  appConfig.wechatBridgeLockDir = process.env.WECHAT_BRIDGE_LOCK_DIR;
  appConfig.wechatBridgeWorkerStatusFile = process.env.WECHAT_BRIDGE_WORKER_STATUS_FILE;

  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  const notifications = new NotificationsService({}, localStore);
  const sendAdapter = new WechatSendAdapterService();
  const orders = overrides.orders || new OrdersService({}, localStore, notifications);
  const service = new WechatDispatchService({}, localStore, sendAdapter, notifications, orders);

  return { tempDir, localStore, service };
}

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
    scene: "员工福利",
    bundle: { items: [{ name: "保温杯", salePrice: 80, cost: 45 }] },
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
    customer: { id: conversation.customerId, name: "王总" },
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

function acknowledgeStartedBridgeSend(service, localStore, taskId) {
  const task = localStore.getSendTask(taskId);
  const attempt = localStore.getLatestSendAttempt(taskId, {
    adapter: "windows_bridge",
    status: "started",
  });
  assert.ok(task, "send task should exist before bridge ack");
  assert.ok(attempt, "started bridge attempt should exist before bridge ack");
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
  assert.match(updatedTask.errorMessage, /人工接管/);
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
    /explicit manual release reason/,
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
    /manual resolution note/,
  );

  const conversation = localStore.listConversations().find((item) => item.id === "conversation_demo_1");
  assert.equal(conversation.manualLocked, true);
  assert.equal(localStore.listReviewLogs().length, reviewLogCount);
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
    /已人工取消并记录审计|audited_cancelled_task/,
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
    status: "blocked",
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
    /audited cancelled task cannot be cancelled again/,
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
    scene: "企业伴手礼",
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
    scene: "企业伴手礼",
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
    instruction: "把背景换浅一点",
  });
  assert.throws(
    () => localStore.updateDesignRevision(revision.id, { selectedImageId: otherImages[0].id }),
    /design revision binding invalid/,
  );

  const revisions = localStore.listDesignRevisions(designJob.id);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].selectedImageId, images[0].id);
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
    bundle: { items: [{ name: "保温杯", salePrice: 100, cost: 60 }] },
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
    bundle: { items: [{ name: "保温杯", salePrice: 100, cost: 60 }] },
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
    /会话已人工接管|浜哄伐鎺ョ/,
  );

  assert.equal(updateCalled, false);
  assert.equal(localStore.listSendTasks().filter((task) => task.conversationId === order.conversationId).length, 0);
});

test("manual lock blocks order follow-up queueing before notification is created", async () => {
  const order = buildOrderDraft({ status: "processing", paymentStatus: "deposit_paid" });
  const { localStore, service } = setupService({
    orders: {
      getById: async () => order,
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
    /会话已人工接管|浜哄伐鎺ョ/,
  );

  assert.equal(localStore.listNotifications().length, notificationsAfterLock);
  assert.equal(notificationsAfterLock, notificationsBefore + 1);
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
    chatTitle: "李经理-企业伴手礼",
    activeChatTitle: "李经理-企业伴手礼",
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
    chatTitle: "李经理-企业伴手礼",
    activeChatTitle: "李经理-企业伴手礼",
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
        question: "想看端午礼盒效果图",
        answer: "我先按员工福利场景给您搭一套再出图。",
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
  assert.equal(route.sceneAudit.evidence.includes("route correction memory: applied 100"), true);
  assert.equal(correction.route.sceneMemory, null);
  assert.equal(correction.route.sceneAudit.label, "人工已纠正");
  assert.equal(correction.trainingSample.customerId, "customer_demo_1");
  assert.equal(correction.trainingSample.conversationId, "conversation_demo_1");
  assert.equal(correction.trainingSample.wechatAccountId, "wechat_demo_1");
  assert.equal(correction.knowledgeEntry.conversationId, "conversation_demo_1");
  assert.equal(correction.knowledgeEntry.wechatAccountId, "wechat_demo_1");
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
    text: "我选第2张，就按这个报价",
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
  assert.match(result.sendTask.payload.text, /报价|礼盒|9000/);
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
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "我选第2张，按这个报价",
  });

  assert.equal(firstSelection.plan.reason, "low_value_customer_selected_image_quote_queued");
  assert.equal(firstSelection.quote.selectedImageId, images[1].id);
  assert.equal(localStore.getDesignJob(job.id).status, "quote_created");

  const reselection = await service.processInboundMessage({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "我又看了下，换第1张",
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
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "我选第2张，按这个继续报价",
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
  assert.match(designLog.note, /高价值客户已选定效果图/);
  assert.match(designLog.note, /人工复核报价/);
  assert.doesNotMatch(designLog.note, /High-value customer selected/);
  assert.ok(lockLog);
  assert.match(lockLog.note, /高价值客户已选图/);
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
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "我选第1张",
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
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "可以，就按这个方案下单",
  });

  assert.notEqual(result.plan.type, "quote_accepted");
  assert.equal(result.orderDraft, undefined);
  assert.equal(localStore.listOrderDrafts().some((order) => order.quoteDraftId === quote.id), false);
});

test("sent low-value quote can become order confirmation after customer accepts", async () => {
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
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    text: "可以，就按这个方案下单",
  });

  assert.equal(acceptance.plan.type, "quote_accepted");
  assert.equal(acceptance.plan.reason, "customer_quote_accepted");
  assert.equal(acceptance.plan.shouldQueueReply, true);
  assert.equal(acceptance.quote.status, "accepted");
  assert.equal(acceptance.orderDraft.quoteDraftId, selection.quote.id);
  assert.equal(acceptance.orderDraft.status, "confirmed");
  assert.equal(acceptance.orderDraft.paymentStatus, "unpaid");
  assert.equal(acceptance.sendTask.status, "queued");
  assert.equal(acceptance.sendTask.quoteDraftId, selection.quote.id);
  assert.equal(acceptance.sendTask.guardSnapshot.automation.source, "low_value_quote_acceptance");
  assert.equal(acceptance.sendTask.guardSnapshot.automation.orderDraftId, acceptance.orderDraft.id);
  assert.match(acceptance.sendTask.payload.text, /订单|确认|9000/);
});
