"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
const { OrdersService } = require("../apps/api/src/orders/orders.service");
const { QuotesService } = require("../apps/api/src/quotes/quotes.service");

test("manual-approved design image send relocks conversation when queueing fails", async () => {
  const locks = [];
  const job = {
    id: "design_1",
    requestId: "request_1",
    status: "draft",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    images: [
      {
        id: "image_1",
        imageId: "candidate_1",
        position: 1,
        localPath: "C:\\storage\\design-jobs\\design_1\\candidate_1.png",
      },
    ],
  };
  const service = new DesignJobsService(
    {},
    {},
    {
      getDesignJob: () => job,
      updateDesignJob: () => {
        throw new Error("should not mark sent after queue failure");
      },
    },
    { create: async () => ({}) },
    {},
    {
      setConversationManualLock: async (conversationId, payload) => locks.push({ conversationId, payload }),
      enqueueDesignImages: async () => {
        throw new Error("binding failed");
      },
    },
    {},
    {},
  );

  await assert.rejects(
    () =>
      service.quickConfirmAndQueueSend("design_1", {
        releaseManualLock: true,
        reviewer: "Alice",
        releaseReason: "manual_approve_send",
      }),
    /binding failed/,
  );

  assert.equal(locks.length, 2);
  assert.deepEqual(
    locks.map((item) => ({ conversationId: item.conversationId, locked: item.payload.locked, reason: item.payload.reason })),
    [
      { conversationId: "conversation_1", locked: false, reason: "manual_approve_send" },
      { conversationId: "conversation_1", locked: true, reason: "manual_approve_send_queue_failed" },
    ],
  );
});

test("manual-approved quote send relocks conversation when queueing fails", async () => {
  const locks = [];
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 200,
    totalPrice: 10000,
    totalCost: 7000,
    profit: 3000,
    status: "draft",
    paymentStatus: "unpaid",
    selectedImage: {
      id: "image_1",
      designJobId: "design_1",
    },
    customer: {
      id: "customer_1",
      name: "客户A",
    },
    designJob: {
      id: "design_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      scene: "企业礼盒",
      bundle: { items: [] },
      conversation: {
        id: "conversation_1",
        customerId: "customer_1",
        wechatAccountId: "wechat_1",
      },
    },
  };
  const service = new QuotesService(
    {},
    {
      getQuoteDraft: () => quote,
      updateQuoteDraft: () => {
        throw new Error("should not mark quote queued after queue failure");
      },
    },
    {
      setConversationManualLock: async (conversationId, payload) => locks.push({ conversationId, payload }),
      enqueueQuoteMessage: async () => {
        throw new Error("binding failed");
      },
    },
  );

  await assert.rejects(
    () =>
      service.queueSend("quote_1", {
        releaseManualLock: true,
        owner: "Alice",
        releaseReason: "manual_approve_quote",
      }),
    /binding failed/,
  );

  assert.equal(locks.length, 2);
  assert.deepEqual(
    locks.map((item) => ({ conversationId: item.conversationId, locked: item.payload.locked, reason: item.payload.reason })),
    [
      { conversationId: "conversation_1", locked: false, reason: "manual_approve_quote" },
      { conversationId: "conversation_1", locked: true, reason: "manual_approve_quote_queue_failed" },
    ],
  );
});

test("design image send refuses to release manual lock without explicit manual reason", async () => {
  const locks = [];
  const service = new DesignJobsService(
    {},
    {},
    {
      getDesignJob: () => ({
        id: "design_1",
        requestId: "request_1",
        wechatAccountId: "wechat_1",
        conversationId: "conversation_1",
        images: [
          {
            id: "image_1",
            imageId: "candidate_1",
            position: 1,
            localPath: "C:\\storage\\design-jobs\\design_1\\candidate_1.png",
          },
        ],
      }),
    },
    { create: async () => ({}) },
    {},
    {
      setConversationManualLock: async (conversationId, payload) => locks.push({ conversationId, payload }),
      enqueueDesignImages: async () => ({ id: "send_1" }),
    },
    {},
    {},
  );

  await assert.rejects(
    () => service.quickConfirmAndQueueSend("design_1", { releaseManualLock: true, reviewer: "Alice" }),
    /需要填写明确的人工处理原因/,
  );

  assert.equal(locks.length, 0);
});

test("manual-approved design image send writes review log with send task id", async () => {
  const reviewLogs = [];
  const job = {
    id: "design_1",
    requestId: "request_1",
    status: "manual_review",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    images: [
      {
        id: "image_1",
        imageId: "candidate_1",
        position: 1,
        localPath: "C:\\storage\\design-jobs\\design_1\\candidate_1.png",
      },
    ],
  };
  const service = new DesignJobsService(
    {},
    {},
    {
      getDesignJob: () => job,
      updateDesignJob: (id, patch) => ({ ...job, id, ...patch }),
      createReviewLog: (payload) => {
        reviewLogs.push(payload);
        return payload;
      },
    },
    { create: async () => ({}) },
    {},
    {
      setConversationManualLock: async () => ({}),
      enqueueDesignImages: async () => ({ id: "send_1" }),
    },
    {},
    {},
  );

  await service.quickConfirmAndQueueSend("design_1", {
    releaseManualLock: true,
    reviewer: "Alice",
    releaseReason: "manual_approve_send",
  });

  assert.equal(reviewLogs.length, 1);
  assert.equal(reviewLogs[0].targetType, "design_job");
  assert.equal(reviewLogs[0].decision, "manual_approve_send");
  assert.equal(reviewLogs[0].metadata.sendTaskId, "send_1");
  assert.equal(reviewLogs[0].metadata.conversationId, "conversation_1");
});

test("quote send refuses to release manual lock without explicit manual reason", async () => {
  const locks = [];
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 200,
    totalPrice: 10000,
    totalCost: 7000,
    profit: 3000,
    status: "draft",
    paymentStatus: "unpaid",
    selectedImage: {
      id: "image_1",
      designJobId: "design_1",
    },
    customer: {
      id: "customer_1",
      name: "客户A",
    },
    designJob: {
      id: "design_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      scene: "企业礼盒",
      bundle: { items: [] },
      conversation: {
        id: "conversation_1",
        customerId: "customer_1",
        wechatAccountId: "wechat_1",
      },
    },
  };
  const service = new QuotesService(
    {},
    {
      getQuoteDraft: () => quote,
    },
    {
      setConversationManualLock: async (conversationId, payload) => locks.push({ conversationId, payload }),
      enqueueQuoteMessage: async () => ({ id: "send_1" }),
    },
  );

  await assert.rejects(
    () => service.queueSend("quote_1", { releaseManualLock: true, owner: "Alice" }),
    /需要填写明确的人工处理原因/,
  );

  assert.equal(locks.length, 0);
});

test("quote preview and send readiness warnings stay readable Chinese", async () => {
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "",
    quantity: 50,
    unitPrice: 200,
    totalPrice: 10000,
    totalCost: 12000,
    profit: -2000,
    status: "manual_review",
    sendTaskId: "send_1",
    customer: { id: "customer_1", name: "客户A" },
    designJob: {
      id: "design_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      scene: "端午礼盒",
      bundle: { items: [] },
      conversation: {
        id: "conversation_1",
        customerId: "customer_1",
        wechatAccountId: "wechat_1",
      },
    },
  };
  const service = new QuotesService(
    {},
    {
      getQuoteDraft: () => quote,
    },
    {
      setConversationManualLock: async () => ({}),
      enqueueQuoteMessage: async () => ({ id: "send_1" }),
    },
  );

  const preview = await service.preview("quote_1");

  assert.ok(preview.warnings.includes("报价已进入发送队列"));
  assert.ok(preview.warnings.includes("报价还没有选图"));
  assert.ok(preview.warnings.includes("报价正在等待人工审核"));
  assert.ok(preview.warnings.includes("报价利润为负，需要人工确认"));
  assert.doesNotMatch(preview.warnings.join(" "), /quote has no selected image|quote is waiting for manual review/);
  await assert.rejects(
    () => service.queueSend("quote_1", {}),
    /报价还不能发送：/,
  );
});

test("manual-approved quote send writes review log with send task id", async () => {
  const reviewLogs = [];
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 200,
    totalPrice: 10000,
    totalCost: 7000,
    profit: 3000,
    status: "draft",
    paymentStatus: "unpaid",
    selectedImage: {
      id: "image_1",
      designJobId: "design_1",
    },
    customer: {
      id: "customer_1",
      name: "客户A",
    },
    designJob: {
      id: "design_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      scene: "企业礼盒",
      bundle: { items: [] },
      conversation: {
        id: "conversation_1",
        customerId: "customer_1",
        wechatAccountId: "wechat_1",
      },
    },
  };
  const service = new QuotesService(
    {},
    {
      getQuoteDraft: () => quote,
      updateQuoteDraft: (id, patch) => ({ ...quote, id, ...patch }),
      createReviewLog: (payload) => {
        reviewLogs.push(payload);
        return payload;
      },
    },
    {
      setConversationManualLock: async () => ({}),
      enqueueQuoteMessage: async () => ({ id: "send_1" }),
    },
  );

  await service.queueSend("quote_1", {
    releaseManualLock: true,
    owner: "Alice",
    releaseReason: "manual_approve_quote",
  });

  assert.equal(reviewLogs.length, 1);
  assert.equal(reviewLogs[0].targetType, "quote");
  assert.equal(reviewLogs[0].decision, "manual_approve_quote");
  assert.equal(reviewLogs[0].metadata.sendTaskId, "send_1");
  assert.equal(reviewLogs[0].metadata.conversationId, "conversation_1");
});

test("queued quote selection cannot be changed by later customer image selection", async () => {
  let updateCount = 0;
  const designJob = {
    id: "design_1",
    customerId: "customer_1",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    conversation: {
      id: "conversation_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
    },
    images: [
      { id: "image_1", imageId: "candidate_1", designJobId: "design_1", position: 1 },
      { id: "image_2", imageId: "candidate_2", designJobId: "design_1", position: 2 },
    ],
  };
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    status: "send_queued",
    sendTaskId: "send_1",
    paymentStatus: "unpaid",
    selectedImage: designJob.images[0],
    designJob,
  };
  const service = new QuotesService(
    {},
    {
      listQuoteDrafts: () => [quote],
      getDesignJob: () => designJob,
      updateQuoteDraft: () => {
        updateCount += 1;
        throw new Error("should not update locked quote selection");
      },
    },
    {},
  );

  await assert.rejects(
    () => service.createFromDesignJob("design_1", "image_2"),
    /quote selection is locked/,
  );

  assert.equal(updateCount, 0);
  assert.equal(quote.selectedImageId, "image_1");
});

test("manual quote revision changes selected image and cancels queued send task", async () => {
  const cancelled = [];
  const reviewLogs = [];
  const designJob = {
    id: "design_1",
    customerId: "customer_1",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    conversation: {
      id: "conversation_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
    },
    images: [
      { id: "image_1", imageId: "candidate_1", designJobId: "design_1", position: 1 },
      { id: "image_2", imageId: "candidate_2", designJobId: "design_1", position: 2 },
    ],
  };
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 200,
    totalPrice: 10000,
    totalCost: 7000,
    profit: 3000,
    status: "send_queued",
    sendTaskId: "send_1",
    paymentStatus: "unpaid",
    selectedImage: designJob.images[0],
    sendTask: { id: "send_1", status: "queued" },
    designJob,
  };
  const service = new QuotesService(
    {},
    {
      getQuoteDraft: () => quote,
      listOrderDrafts: () => [],
      updateQuoteDraft: (id, patch) => ({
        ...quote,
        id,
        ...patch,
        selectedImage: designJob.images.find((image) => image.id === patch.selectedImageId) || quote.selectedImage,
      }),
      createReviewLog: (payload) => {
        reviewLogs.push(payload);
        return payload;
      },
    },
    {
      cancelSendTask: (id, payload) => {
        cancelled.push({ id, payload });
        return { id, status: "cancelled" };
      },
    },
  );

  const updated = await service.reviseSelectedImage("quote_1", {
    selectedImageId: "image_2",
    owner: "Alice",
    note: "客户改选第二张",
    expectedWechatAccountId: "wechat_1",
    expectedConversationId: "conversation_1",
    expectedCustomerId: "customer_1",
  });

  assert.equal(updated.selectedImageId, "image_2");
  assert.equal(updated.status, "manual_review");
  assert.equal(updated.sendTaskId, null);
  assert.equal(updated.owner, "Alice");
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].id, "send_1");
  assert.equal(reviewLogs.length, 1);
  assert.equal(reviewLogs[0].decision, "manual_quote_revision");
  assert.equal(reviewLogs[0].metadata.previousSelectedImageId, "image_1");
  assert.equal(reviewLogs[0].metadata.selectedImageId, "image_2");
  assert.equal(reviewLogs[0].metadata.cancelledSendTaskId, "send_1");
});

test("manual quote revision is blocked after order draft exists", async () => {
  let cancelCount = 0;
  let updateCount = 0;
  const designJob = {
    id: "design_1",
    customerId: "customer_1",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    conversation: {
      id: "conversation_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
    },
    images: [
      { id: "image_1", imageId: "candidate_1", designJobId: "design_1", position: 1 },
      { id: "image_2", imageId: "candidate_2", designJobId: "design_1", position: 2 },
    ],
  };
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    status: "send_queued",
    sendTaskId: "send_1",
    paymentStatus: "unpaid",
    selectedImage: designJob.images[0],
    sendTask: { id: "send_1", status: "queued" },
    designJob,
  };
  const service = new QuotesService(
    {},
    {
      getQuoteDraft: () => quote,
      listOrderDrafts: () => [{ id: "order_1", quoteDraftId: "quote_1" }],
      updateQuoteDraft: () => {
        updateCount += 1;
        throw new Error("should not update quote with existing order draft");
      },
      createReviewLog: () => {
        throw new Error("should not create revision log with existing order draft");
      },
    },
    {
      cancelSendTask: () => {
        cancelCount += 1;
        throw new Error("should not cancel send task with existing order draft");
      },
    },
  );

  await assert.rejects(
    () => service.reviseSelectedImage("quote_1", { selectedImageId: "image_2" }),
    /already has an order draft/,
  );

  assert.equal(cancelCount, 0);
  assert.equal(updateCount, 0);
  assert.equal(quote.selectedImageId, "image_1");
});

test("manual order revision changes selected image and syncs bound quote", async () => {
  const reviewLogs = [];
  const notifications = [];
  const designJob = {
    id: "design_1",
    customerId: "customer_1",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    conversation: {
      id: "conversation_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
    },
    images: [
      { id: "image_1", imageId: "candidate_1", designJobId: "design_1", position: 1 },
      { id: "image_2", imageId: "candidate_2", designJobId: "design_1", position: 2 },
    ],
  };
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    status: "accepted",
    paymentStatus: "paid",
    selectedImage: designJob.images[0],
    designJob,
  };
  const order = {
    id: "order_1",
    quoteDraftId: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 200,
    totalPrice: 10000,
    totalCost: 7000,
    profit: 3000,
    status: "confirmed",
    paymentStatus: "paid",
    selectedImage: designJob.images[0],
    quoteDraft: quote,
    designJob,
  };
  const updated = { quote, order };
  const service = new OrdersService(
    {},
    {
      getOrderDraft: () => updated.order,
      getDesignJob: () => designJob,
      updateQuoteDraft: (id, patch) => {
        updated.quote = {
          ...updated.quote,
          id,
          ...patch,
          selectedImage: designJob.images.find((image) => image.id === patch.selectedImageId) || updated.quote.selectedImage,
        };
        updated.order = { ...updated.order, quoteDraft: updated.quote };
        return updated.quote;
      },
      updateOrderDraft: (id, patch) => {
        updated.order = {
          ...updated.order,
          id,
          ...patch,
          selectedImage: designJob.images.find((image) => image.id === patch.selectedImageId) || updated.order.selectedImage,
          quoteDraft: updated.quote,
        };
        return updated.order;
      },
      createReviewLog: (payload) => {
        reviewLogs.push(payload);
        return payload;
      },
    },
    {
      create: async (...args) => {
        notifications.push(args);
        return {};
      },
    },
  );

  const result = await service.reviseSelectedImage("order_1", {
    selectedImageId: "image_2",
    owner: "Alice",
    note: "瀹㈡埛鏀归€夌浜屽紶",
    expectedWechatAccountId: "wechat_1",
    expectedConversationId: "conversation_1",
    expectedCustomerId: "customer_1",
  });

  assert.equal(result.selectedImageId, "image_2");
  assert.equal(result.status, "draft");
  assert.equal(updated.quote.selectedImageId, "image_2");
  assert.equal(reviewLogs.length, 1);
  assert.equal(reviewLogs[0].decision, "manual_order_selection_revision");
  assert.equal(reviewLogs[0].metadata.previousSelectedImageId, "image_1");
  assert.equal(reviewLogs[0].metadata.selectedImageId, "image_2");
  assert.equal(notifications.length, 1);
});

test("manual order revision is blocked while confirmation send task is active", async () => {
  let quoteUpdateCount = 0;
  let orderUpdateCount = 0;
  const designJob = {
    id: "design_1",
    customerId: "customer_1",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    images: [
      { id: "image_1", imageId: "candidate_1", designJobId: "design_1", position: 1 },
      { id: "image_2", imageId: "candidate_2", designJobId: "design_1", position: 2 },
    ],
  };
  const order = {
    id: "order_1",
    quoteDraftId: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    selectedImageId: "image_1",
    status: "confirmed",
    paymentStatus: "paid",
    selectedImage: designJob.images[0],
    quoteDraft: { id: "quote_1", designJobId: "design_1", customerId: "customer_1", selectedImageId: "image_1", designJob },
    designJob,
    confirmationSendTask: { id: "send_1", status: "queued" },
  };
  const service = new OrdersService(
    {},
    {
      getOrderDraft: () => order,
      getDesignJob: () => designJob,
      updateQuoteDraft: () => {
        quoteUpdateCount += 1;
        throw new Error("should not update quote while order send task is active");
      },
      updateOrderDraft: () => {
        orderUpdateCount += 1;
        throw new Error("should not update order while send task is active");
      },
      createReviewLog: () => {
        throw new Error("should not log blocked revision");
      },
    },
    { create: async () => ({}) },
  );

  await assert.rejects(
    () => service.reviseSelectedImage("order_1", { selectedImageId: "image_2" }),
    /订单选图暂不能修改/,
  );

  assert.equal(quoteUpdateCount, 0);
  assert.equal(orderUpdateCount, 0);
  assert.equal(order.selectedImageId, "image_1");
});

test("manual order revision explains missing or wrong selected image in Chinese", async () => {
  const designJob = {
    id: "design_1",
    customerId: "customer_1",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    images: [
      { id: "image_1", imageId: "candidate_1", designJobId: "design_1", position: 1 },
      { id: "image_2", imageId: "candidate_2", designJobId: "other_design", position: 2 },
    ],
  };
  const order = {
    id: "order_1",
    quoteDraftId: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    selectedImageId: "image_1",
    status: "confirmed",
    selectedImage: designJob.images[0],
    quoteDraft: { id: "quote_1", designJobId: "design_1", customerId: "customer_1", selectedImageId: "image_1", designJob },
    designJob,
  };
  const service = new OrdersService(
    {},
    {
      getOrderDraft: () => order,
      getDesignJob: () => designJob,
      updateQuoteDraft: () => {
        throw new Error("should not update quote for invalid image");
      },
      updateOrderDraft: () => {
        throw new Error("should not update order for invalid image");
      },
      createReviewLog: () => {
        throw new Error("should not log invalid image revision");
      },
    },
    { create: async () => ({}) },
  );

  await assert.rejects(
    () => service.reviseSelectedImage("order_1", {}),
    /请选择要改成哪一张候选图/,
  );
  await assert.rejects(
    () => service.reviseSelectedImage("order_1", { selectedImageId: "missing_image" }),
    /没有找到这张候选图/,
  );
  await assert.rejects(
    () => service.reviseSelectedImage("order_1", { selectedImageId: "image_2" }),
    /不属于当前订单的设计任务/,
  );
});

test("order service customer-facing failures stay readable Chinese", async () => {
  const quote = {
    id: "quote_missing_fields",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "",
    quantity: 0,
    unitPrice: 200,
    totalPrice: 0,
    totalCost: 0,
    profit: 0,
    status: "sent",
    paymentStatus: "unpaid",
    designJob: {
      id: "design_1",
      customerId: "customer_1",
      conversationId: "conversation_1",
      wechatAccountId: "wechat_1",
      conversation: {
        id: "conversation_1",
        customerId: "customer_1",
        wechatAccountId: "wechat_1",
      },
      images: [],
    },
  };
  const order = {
    id: "order_1",
    status: "processing",
    paymentStatus: "paid",
    quoteDraftId: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
  };
  const service = new OrdersService(
    {},
    {
      getQuoteDraft: (id) => (id === quote.id ? quote : null),
      getOrderDraft: (id) => (id === order.id ? order : null),
      updateOrderDraft: () => {
        throw new Error("should not update invalid order request");
      },
    },
    { create: async () => ({}) },
  );

  await assert.rejects(
    () => service.confirmationPreview("missing_order"),
    (error) => {
      assert.match(error.message, /没有找到订单草稿/);
      assert.doesNotMatch(error.message, /order draft not found/);
      return true;
    },
  );
  await assert.rejects(
    () => service.createFromQuote("missing_quote"),
    (error) => {
      assert.match(error.message, /没有找到报价草稿/);
      assert.doesNotMatch(error.message, /quote draft not found/);
      return true;
    },
  );
  await assert.rejects(
    () => service.createFromQuote(quote.id),
    (error) => {
      assert.match(error.message, /报价还不能生成订单草稿/);
      assert.match(error.message, /客户选中的效果图|数量|总价/);
      assert.doesNotMatch(error.message, /order draft is not ready|missing_order_fields|selectedImageId/);
      return true;
    },
  );
  await assert.rejects(
    () => service.update(order.id, {}),
    (error) => {
      assert.match(error.message, /订单草稿没有可更新的字段/);
      assert.doesNotMatch(error.message, /order draft update has no allowed fields/);
      return true;
    },
  );
  await assert.rejects(
    () => service.reviseSelectedImage(order.id, { selectedImageId: "image_1" }),
    (error) => {
      assert.match(error.message, /不能再修改选中的效果图/);
      assert.doesNotMatch(error.message, /order selection can only be revised/);
      return true;
    },
  );
});

test("order confirmation preview returns message and readiness warnings", async () => {
  const designJob = {
    id: "design_1",
    customerId: "customer_1",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    scene: "端午礼盒",
    bundle: { items: [{ name: "茶叶" }, { name: "糕点" }] },
    conversation: {
      id: "conversation_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
    },
    images: [{ id: "image_1", imageId: "candidate_1", designJobId: "design_1", position: 1 }],
  };
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    selectedImage: designJob.images[0],
    designJob,
  };
  const order = {
    id: "order_1",
    quoteDraftId: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    selectedImageId: "image_1",
    quantity: 20,
    unitPrice: 200,
    totalPrice: 4000,
    totalCost: 2600,
    profit: 1400,
    status: "confirmed",
    paymentStatus: "deposit_paid",
    customer: { id: "customer_1", name: "客户A" },
    selectedImage: designJob.images[0],
    quoteDraft: quote,
    designJob,
    conversation: designJob.conversation,
  };
  const service = new OrdersService(
    {},
    { getOrderDraft: () => order },
    { create: async () => ({}) },
  );

  const preview = await service.confirmationPreview("order_1");

  assert.equal(preview.orderDraft.id, "order_1");
  assert.equal(typeof preview.message, "string");
  assert.ok(preview.message.length > 20);
  assert.deepEqual(preview.warnings, []);
});

test("order confirmation preview warns when selected image is missing", async () => {
  const order = {
    id: "order_1",
    quoteDraftId: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    selectedImageId: "",
    quantity: 20,
    unitPrice: 200,
    totalPrice: 4000,
    totalCost: 2600,
    profit: 1400,
    status: "confirmed",
    paymentStatus: "unpaid",
    quoteDraft: {
      id: "quote_1",
      designJobId: "design_1",
      customerId: "customer_1",
      selectedImageId: "",
    },
    designJob: {
      id: "design_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      conversation: {
        id: "conversation_1",
        customerId: "customer_1",
        wechatAccountId: "wechat_1",
      },
    },
    conversation: {
      id: "conversation_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
    },
  };
  const service = new OrdersService(
    {},
    { getOrderDraft: () => order },
    { create: async () => ({}) },
  );

  const preview = await service.confirmationPreview("order_1");

  assert.ok(preview.warnings.includes("订单还没有选图"));
  assert.doesNotMatch(preview.warnings.join(" "), /order has no selected image/);
  assert.ok(preview.message.length > 20);
});
