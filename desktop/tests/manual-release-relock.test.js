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
const { ReviewsService } = require("../apps/api/src/reviews/reviews.service");

test("approved high-value budget design job stays in manual review after image approval", async () => {
  const reviewLogs = [];
  const notifications = [];
  const job = {
    id: "design_1",
    requestId: "request_1",
    status: "manual_review",
    isHighValue: false,
    budget: { totalAmount: 15000, perUnitAmount: 300 },
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
  };
  const service = new ReviewsService(
    {},
    {
      getDesignJob: () => job,
      updateDesignJob: (id, patch) => ({ ...job, id, ...patch }),
      createReviewLog: (payload) => {
        reviewLogs.push(payload);
        return payload;
      },
    },
    {},
    {},
    {
      create: async (...args) => {
        notifications.push(args);
        return {};
      },
    },
    {},
  );

  const result = await service.reviewDesignJob("design_1", {
    decision: "approve_images",
    reviewer: "Alice",
    expectedWechatAccountId: "wechat_1",
    expectedConversationId: "conversation_1",
    expectedCustomerId: "customer_1",
  });

  assert.equal(result.result.status, "manual_review");
  assert.equal(result.result.manualQcRequired, true);
  assert.equal(result.log.afterStatus, "manual_review");
  assert.equal(reviewLogs[0].decision, "approve_images");
  assert.equal(notifications.length, 1);
});

test("review list includes high-value budget design jobs that are already quick confirm", async () => {
  const job = {
    id: "design_1",
    requestId: "request_1",
    status: "quick_confirm",
    isHighValue: false,
    budget: { totalAmount: 15000, perUnitAmount: 300 },
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
  };
  const service = new ReviewsService(
    {},
    {
      listDesignJobs: () => [job],
      listQuoteDrafts: () => [],
      listOrderDrafts: () => [],
      listReviewLogs: () => [],
    },
    {},
    {},
    {},
    {},
  );

  const result = await service.list({
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
  });

  assert.equal(result.designJobs.length, 1);
  assert.equal(result.designJobs[0].id, "design_1");
});

test("review list includes stale high-value quote drafts outside manual review", async () => {
  const highValueQuote = {
    id: "quote_high",
    status: "auto_sent",
    totalPrice: 15000,
    unitPrice: 300,
    designJob: {
      id: "design_high",
      isHighValue: false,
      budget: { totalAmount: 8000, perUnitAmount: 300 },
    },
  };
  const lowValueQuote = {
    id: "quote_low",
    status: "auto_sent",
    totalPrice: 3000,
    unitPrice: 150,
    designJob: {
      id: "design_low",
      isHighValue: false,
      budget: { totalAmount: 3000, perUnitAmount: 150 },
    },
  };
  const highBudgetQuote = {
    id: "quote_budget",
    status: "draft",
    totalPrice: 3000,
    unitPrice: 150,
    designJob: {
      id: "design_budget",
      isHighValue: false,
      budget: { totalAmount: 12000, perUnitAmount: 150 },
    },
  };
  const service = new ReviewsService(
    {},
    {
      listDesignJobs: () => [],
      listQuoteDrafts: () => [highValueQuote, lowValueQuote, highBudgetQuote],
      listOrderDrafts: () => [],
      listReviewLogs: () => [],
    },
    {},
    {},
    {},
    {},
  );

  const result = await service.list();

  assert.deepEqual(
    result.quoteDrafts.map((quote) => quote.id),
    ["quote_high", "quote_budget"],
  );
});

test("review list includes active high-value order drafts", async () => {
  const highValueOrder = {
    id: "order_high",
    status: "confirmed",
    totalPrice: 10000,
    unitPrice: 200,
    quoteDraft: { id: "quote_high", totalPrice: 10000, unitPrice: 200 },
  };
  const highBudgetOrder = {
    id: "order_budget",
    status: "processing",
    totalPrice: 3000,
    unitPrice: 150,
    quoteDraft: {
      id: "quote_budget",
      totalPrice: 3000,
      unitPrice: 150,
      designJob: { id: "design_budget", budget: { totalAmount: 12000, perUnitAmount: 150 } },
    },
  };
  const lowValueOrder = {
    id: "order_low",
    status: "confirmed",
    totalPrice: 3000,
    unitPrice: 150,
    quoteDraft: { id: "quote_low", totalPrice: 3000, unitPrice: 150 },
  };
  const fulfilledHighValueOrder = {
    id: "order_done",
    status: "fulfilled",
    totalPrice: 20000,
    unitPrice: 200,
    quoteDraft: { id: "quote_done", totalPrice: 20000, unitPrice: 200 },
  };
  const service = new ReviewsService(
    {},
    {
      listDesignJobs: () => [],
      listQuoteDrafts: () => [],
      listOrderDrafts: () => [highValueOrder, lowValueOrder, highBudgetOrder, fulfilledHighValueOrder],
      listReviewLogs: () => [],
    },
    {},
    {},
    {},
    {},
  );

  const result = await service.list();

  assert.deepEqual(
    result.orderDrafts.map((order) => order.id),
    ["order_high", "order_budget"],
  );
});

test("review list includes low-value order drafts that need manual send attention", async () => {
  const manualSendAttentionOrder = {
    id: "order_attention",
    status: "confirmed",
    totalPrice: 3000,
    unitPrice: 150,
    owner: "人工客服",
    customerNotes: "[发送任务:send_1]订单确认发送失败，需要人工处理：bridge ack rejected",
    quoteDraft: { id: "quote_attention", totalPrice: 3000, unitPrice: 150 },
  };
  const lowValueOrder = {
    id: "order_low",
    status: "confirmed",
    totalPrice: 3000,
    unitPrice: 150,
    owner: "low_value_automation",
    customerNotes: "低价值订单确认已自动进入微信安全发送队列。",
    quoteDraft: { id: "quote_low", totalPrice: 3000, unitPrice: 150 },
  };
  const fulfilledAttentionOrder = {
    ...manualSendAttentionOrder,
    id: "order_done_attention",
    status: "fulfilled",
  };
  const service = new ReviewsService(
    {},
    {
      listDesignJobs: () => [],
      listQuoteDrafts: () => [],
      listOrderDrafts: () => [lowValueOrder, manualSendAttentionOrder, fulfilledAttentionOrder],
      listReviewLogs: () => [],
    },
    {},
    {},
    {},
    {},
  );

  const result = await service.list();

  assert.deepEqual(
    result.orderDrafts.map((order) => order.id),
    ["order_attention"],
  );
});

test("manual-approved order review queues confirmation and records audit log", async () => {
  const reviewLogs = [];
  let queuedPayload = null;
  const order = {
    id: "order_high",
    status: "confirmed",
    quoteDraftId: "quote_high",
    designJobId: "design_high",
    paymentStatus: "deposit_paid",
    selectedImageId: "image_high_1",
    totalPrice: 10000,
    totalCost: 6000,
    profit: 4000,
    unitPrice: 200,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
  };
  const service = new ReviewsService(
    {},
    {
      getOrderDraft: () => order,
      updateOrderDraft: (id, patch) => ({ ...order, ...patch, id }),
      createReviewLog: (payload) => {
        reviewLogs.push(payload);
        return payload;
      },
    },
    {},
    {},
    { create: async () => ({}) },
    {
      queueOrderConfirmation: async (id, payload) => {
        queuedPayload = { id, payload };
        return {
          orderDraft: { ...order, status: "confirmed" },
          sendTask: { id: "send_order_1" },
          message: "queued",
        };
      },
    },
  );

  const result = await service.reviewOrder("order_high", {
    decision: "approve_confirmation",
    reviewer: "Alice",
    expectedWechatAccountId: "wechat_1",
    expectedConversationId: "conversation_1",
    expectedCustomerId: "customer_1",
  });

  assert.equal(queuedPayload.id, "order_high");
  assert.equal(queuedPayload.payload.releaseManualLock, true);
  assert.equal(queuedPayload.payload.releaseReason, "manual_approve_order_confirmation");
  assert.equal(reviewLogs.length, 1);
  assert.equal(reviewLogs[0].targetType, "order_draft");
  assert.equal(reviewLogs[0].decision, "approve_confirmation");
  assert.equal(reviewLogs[0].metadata.sendTaskId, "send_order_1");
  assert.equal(result.log.afterStatus, "confirmed");
});

test("manual-approved high-value order review rejects missing selected image before queueing", async () => {
  let queueCalled = false;
  const order = {
    id: "order_high_without_image",
    status: "confirmed",
    quoteDraftId: "quote_high_without_image",
    designJobId: "design_high_without_image",
    paymentStatus: "deposit_paid",
    totalPrice: 10000,
    totalCost: 6000,
    profit: 4000,
    unitPrice: 200,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
  };
  const service = new ReviewsService(
    {},
    {
      getOrderDraft: () => order,
      createReviewLog: () => {
        throw new Error("review log should not be created");
      },
    },
    {},
    {},
    { create: async () => ({}) },
    {
      queueOrderConfirmation: async () => {
        queueCalled = true;
        throw new Error("queue should not be called");
      },
    },
  );

  await assert.rejects(
    () =>
      service.reviewOrder("order_high_without_image", {
        decision: "approve_confirmation",
        reviewer: "Alice",
        expectedWechatAccountId: "wechat_1",
        expectedConversationId: "conversation_1",
        expectedCustomerId: "customer_1",
      }),
    /高价值订单未绑定客户选中的效果图/,
  );

  assert.equal(queueCalled, false);
});

test("manual-approved high-value order review rejects unpaid order before queueing", async () => {
  let queueCalled = false;
  const order = {
    id: "order_high_unpaid",
    status: "processing",
    quoteDraftId: "quote_high_unpaid",
    designJobId: "design_high_unpaid",
    paymentStatus: "unpaid",
    selectedImageId: "image_high_1",
    totalPrice: 10000,
    totalCost: 6000,
    profit: 4000,
    unitPrice: 200,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
  };
  const service = new ReviewsService(
    {},
    {
      getOrderDraft: () => order,
      createReviewLog: () => {
        throw new Error("review log should not be created");
      },
    },
    {},
    {},
    { create: async () => ({}) },
    {
      queueOrderFollowup: async () => {
        queueCalled = true;
        throw new Error("queue should not be called");
      },
    },
  );

  await assert.rejects(
    () =>
      service.reviewOrder("order_high_unpaid", {
        decision: "approve_followup",
        followupType: "delivery",
        reviewer: "Alice",
        expectedWechatAccountId: "wechat_1",
        expectedConversationId: "conversation_1",
        expectedCustomerId: "customer_1",
      }),
    /高价值订单未核验定金或全款/,
  );

  assert.equal(queueCalled, false);
});

test("manual-approved high-value order review rejects negative profit before queueing", async () => {
  let queueCalled = false;
  const order = {
    id: "order_high_negative_profit",
    status: "confirmed",
    quoteDraftId: "quote_high_negative_profit",
    designJobId: "design_high_negative_profit",
    paymentStatus: "deposit_paid",
    selectedImageId: "image_high_1",
    totalPrice: 10000,
    totalCost: 12000,
    profit: -2000,
    unitPrice: 200,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
  };
  const service = new ReviewsService(
    {},
    {
      getOrderDraft: () => order,
      createReviewLog: () => {
        throw new Error("review log should not be created");
      },
    },
    {},
    {},
    { create: async () => ({}) },
    {
      queueOrderConfirmation: async () => {
        queueCalled = true;
        throw new Error("queue should not be called");
      },
    },
  );

  await assert.rejects(
    () =>
      service.reviewOrder("order_high_negative_profit", {
        decision: "approve_confirmation",
        reviewer: "Alice",
        expectedWechatAccountId: "wechat_1",
        expectedConversationId: "conversation_1",
        expectedCustomerId: "customer_1",
      }),
    /高价值订单利润为负/,
  );

  assert.equal(queueCalled, false);
});

test("manual-approved design image send relocks conversation when queueing fails", async () => {
  const locks = [];
  const job = {
    id: "design_1",
    requestId: "request_1",
    status: "draft",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
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
        operationKey: "test-manual-design-relock-queue-failure-1",
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
    {},
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
        operationKey: "test-manual-quote-relock-queue-failure-1",
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
        customerId: "customer_1",
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
    () => service.quickConfirmAndQueueSend("design_1", {
      operationKey: "test-manual-design-release-reason-required-1",
      releaseManualLock: true,
      reviewer: "Alice",
    }),
    /需要填写明确的人工处理原因/,
  );

  assert.equal(locks.length, 0);
});

test("automatic design image send refuses high-value budget before queueing", async () => {
  let enqueueCalled = false;
  const job = {
    id: "design_1",
    requestId: "request_1",
    status: "quick_confirm",
    isHighValue: false,
    budget: { mode: "per_box", perUnitAmount: 10000, totalAmount: 9000 },
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
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
        throw new Error("should not mark sent for high-value automatic send");
      },
    },
    { create: async () => ({}) },
    {},
    {
      enqueueDesignImages: async () => {
        enqueueCalled = true;
        return { id: "send_1" };
      },
    },
    {},
    {},
  );

  await assert.rejects(
    () => service.quickConfirmAndQueueSend("design_1"),
    /manual approval: manual_review_required/,
  );

  assert.equal(enqueueCalled, false);
});

test("manual-approved design image send writes review log with send task id", async () => {
  const reviewLogs = [];
  const job = {
    id: "design_1",
    requestId: "request_1",
    status: "manual_review",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
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
    operationKey: "test-manual-design-review-log-1",
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
    {},
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

test("quote send refuses high-value total without manual release", async () => {
  let enqueueCalled = false;
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
        throw new Error("should not queue high-value quote without manual release");
      },
    },
    {},
    {
      enqueueQuoteMessage: async () => {
        enqueueCalled = true;
        return { id: "send_1" };
      },
    },
  );

  await assert.rejects(
    () => service.queueSend("quote_1", {}),
    /高价值报价必须先由人工审核/,
  );
  assert.equal(enqueueCalled, false);
});

test("quote send refuses high-value budget without manual release", async () => {
  let enqueueCalled = false;
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 20,
    unitPrice: 150,
    totalPrice: 3000,
    totalCost: 1800,
    profit: 1200,
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
      budget: { totalAmount: 12000, perUnitAmount: 150 },
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
        throw new Error("should not queue high-value budget quote without manual release");
      },
    },
    {},
    {
      enqueueQuoteMessage: async () => {
        enqueueCalled = true;
        return { id: "send_1" };
      },
    },
  );

  await assert.rejects(
    () => service.queueSend("quote_1", {}),
    /高价值报价必须先由人工审核/,
  );
  assert.equal(enqueueCalled, false);
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
    paymentStatus: "unpaid",
    customerNotes: "客户发送付款凭证，需要人工核验金额和收款账户。",
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
    {},
    {
      setConversationManualLock: async () => ({}),
      enqueueQuoteMessage: async () => ({ id: "send_1" }),
    },
  );

  const preview = await service.preview("quote_1", {
    expectedWechatAccountId: "wechat_1",
    expectedConversationId: "conversation_1",
    expectedCustomerId: "customer_1",
  });

  assert.ok(preview.warnings.includes("报价已进入发送队列"));
  assert.ok(preview.warnings.includes("报价还没有选图"));
  assert.ok(preview.warnings.includes("付款凭证需要先人工核验金额和收款账户"));
  assert.ok(preview.warnings.includes("报价正在等待人工审核"));
  assert.ok(preview.warnings.includes("报价利润为负，需要人工确认"));
  assert.doesNotMatch(preview.warnings.join(" "), /quote has no selected image|quote is waiting for manual review/);
  await assert.rejects(
    () =>
      service.preview("quote_1", {
        expectedWechatAccountId: "wechat_2",
        expectedConversationId: "conversation_1",
        expectedCustomerId: "customer_1",
      }),
    /quote draft identity mismatch: wechatAccountId expected wechat_2, got wechat_1/,
  );
  await assert.rejects(
    () => service.queueSend("quote_1", {}),
    /付款凭证需要先人工核验金额和收款账户/,
  );
});

test("manual-approved quote send writes review log with send task id", async () => {
  const reviewLogs = [];
  let enqueuedPayload = null;
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
    {},
    {
      setConversationManualLock: async () => ({}),
      enqueueQuoteMessage: async (payload) => {
        enqueuedPayload = payload;
        return { id: "send_1" };
      },
    },
  );

  await service.queueSend("quote_1", {
    operationKey: "test-manual-quote-review-log-1",
    releaseManualLock: true,
    owner: "Alice",
    releaseReason: "manual_approve_quote",
    source: "order_confirmation",
    queuedBy: "low_value_automation",
    orderDraftId: "forged-order",
    paymentStatus: "paid",
    automation: {
      source: "low_value_quote_send",
      valueLevel: "low",
      quoteDraftId: "forged-quote",
      queuedBy: "low_value_automation",
    },
  });

  assert.ok(enqueuedPayload);
  assert.equal(enqueuedPayload.operationKey, "test-manual-quote-review-log-1");
  assert.equal(enqueuedPayload.automation, undefined);
  assert.equal(reviewLogs.length, 1);
  assert.equal(reviewLogs[0].targetType, "quote");
  assert.equal(reviewLogs[0].decision, "manual_approve_quote");
  assert.equal(reviewLogs[0].metadata.sendTaskId, "send_1");
  assert.equal(reviewLogs[0].metadata.conversationId, "conversation_1");
});

test("quote send refuses payment proof review quotes before payment verification", async () => {
  let enqueueCalled = false;
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 180,
    totalPrice: 9000,
    totalCost: 6000,
    profit: 3000,
    status: "manual_review",
    paymentStatus: "unpaid",
    customerNotes: "客户文字说明已付款并发送凭证，需要人工核验金额和收款账户。",
    selectedImage: {
      id: "image_1",
      designJobId: "design_1",
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
        throw new Error("should not queue payment proof quote before verification");
      },
    },
    {},
    {
      enqueueQuoteMessage: async () => {
        enqueueCalled = true;
        return { id: "send_1" };
      },
    },
  );

  await assert.rejects(
    () => service.queueSend("quote_1", {}),
    /付款凭证需要先人工核验金额和收款账户/,
  );
  assert.equal(enqueueCalled, false);
});

test("verified quote payment proof creates confirmed order and queues safe confirmation", async () => {
  const locks = [];
  const queuedConfirmations = [];
  const reviewLogs = [];
  const quote = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 180,
    totalPrice: 9000,
    totalCost: 5000,
    profit: 4000,
    status: "sent",
    paymentStatus: "unpaid",
    owner: "Alice",
    customer: { id: "customer_1", name: "客户A" },
    selectedImage: { id: "image_1", designJobId: "design_1", position: 1 },
    designJob: {
      id: "design_1",
      customerId: "customer_1",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      scene: "企业礼盒",
      bundle: { items: [{ name: "红金礼盒", salePrice: 180, costPrice: 100 }] },
      conversation: {
        id: "conversation_1",
        customerId: "customer_1",
        wechatAccountId: "wechat_1",
      },
    },
  };
  let quoteRecord = quote;
  let orderRecord = null;
  const localStore = {
    getQuoteDraft: () => quoteRecord,
    updateQuoteDraft: (id, patch) => {
      quoteRecord = { ...quoteRecord, id, ...patch };
      return quoteRecord;
    },
    createReviewLog: (payload) => {
      reviewLogs.push(payload);
      return payload;
    },
  };
  const orders = {
    createFromQuote: async (quoteId, expected) => {
      assert.equal(quoteId, quote.id);
      assert.equal(expected.expectedConversationId, "conversation_1");
      assert.equal(quoteRecord.status, "accepted");
      assert.equal(quoteRecord.paymentStatus, "deposit_paid");
      orderRecord = {
        id: "order_1",
        quoteDraftId: quote.id,
        designJobId: "design_1",
        customerId: "customer_1",
        conversationId: "conversation_1",
        wechatAccountId: "wechat_1",
        selectedImageId: "image_1",
        status: "draft",
        paymentStatus: "deposit_paid",
        quantity: 50,
        unitPrice: 180,
        totalPrice: 9000,
        totalCost: 5000,
        profit: 4000,
        quoteDraft: quoteRecord,
      };
      return orderRecord;
    },
    recordVerifiedPayment: async (id, patch) => {
      assert.equal(id, "order_1");
      orderRecord = { ...orderRecord, ...patch, status: "confirmed" };
      return orderRecord;
    },
  };
  const wechat = {
    setConversationManualLock: async (conversationId, payload) => {
      locks.push({ conversationId, payload });
      return { conversation: { id: conversationId, manualLocked: payload.locked } };
    },
    queueOrderConfirmation: async (orderId, payload) => {
      queuedConfirmations.push({ orderId, payload });
      return { orderDraft: orderRecord, sendTask: { id: "send_1", status: "queued" }, message: "订单确认" };
    },
  };
  const service = new QuotesService({}, localStore, orders, wechat);

  const result = await service.verifyPaymentProofAndQueueConfirmation("quote_1", {
    operationKey: "test-manual-payment-proof-confirmation-1",
    paymentStatus: "deposit_paid",
    owner: "Alice",
    expectedWechatAccountId: "wechat_1",
    expectedConversationId: "conversation_1",
    expectedCustomerId: "customer_1",
  });

  assert.equal(result.quote.status, "accepted");
  assert.equal(result.orderDraft.status, "confirmed");
  assert.equal(result.orderDraft.paymentStatus, "deposit_paid");
  assert.equal(result.sendTask.status, "queued");
  assert.deepEqual(
    locks.map((item) => ({ conversationId: item.conversationId, locked: item.payload.locked, reason: item.payload.reason })),
    [{ conversationId: "conversation_1", locked: false, reason: "manual_payment_proof_verified" }],
  );
  assert.equal(queuedConfirmations.length, 1);
  assert.equal(queuedConfirmations[0].payload.reason, "manual_payment_proof_verified");
  assert.equal(queuedConfirmations[0].payload.automation, undefined);
  assert.equal(reviewLogs[0].decision, "manual_payment_proof_verified");
  assert.equal(reviewLogs[0].metadata.sendTaskId, "send_1");
});

test("verified high-value payment proof keeps manual handoff instead of queueing confirmation", async () => {
  const locks = [];
  const reviewLogs = [];
  const queuedConfirmations = [];
  const quote = {
    id: "quote_high_1",
    status: "manual_review",
    paymentStatus: "unpaid",
    designJobId: "design_high_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 100,
    unitPrice: 180,
    totalPrice: 18000,
    totalCost: 10000,
    profit: 8000,
    owner: "Alice",
    designJob: {
      id: "design_high_1",
      customerId: "customer_1",
      conversationId: "conversation_1",
      wechatAccountId: "wechat_1",
      isHighValue: true,
      budget: { totalAmount: 18000, perUnitAmount: 180 },
      conversation: {
        id: "conversation_1",
        customerId: "customer_1",
        wechatAccountId: "wechat_1",
      },
      images: [{ id: "image_1", imageId: "candidate_1", designJobId: "design_high_1", selected: true }],
    },
    selectedImage: { id: "image_1", imageId: "candidate_1", designJobId: "design_high_1", selected: true },
  };
  let quoteRecord = quote;
  let orderRecord = null;
  const localStore = {
    getQuoteDraft: () => quoteRecord,
    updateQuoteDraft: (id, patch) => {
      quoteRecord = { ...quoteRecord, id, ...patch };
      return quoteRecord;
    },
    createReviewLog: (payload) => {
      reviewLogs.push(payload);
      return payload;
    },
  };
  const orders = {
    createFromQuote: async (quoteId) => {
      assert.equal(quoteId, quote.id);
      orderRecord = {
        id: "order_high_1",
        quoteDraftId: quote.id,
        designJobId: "design_high_1",
        customerId: "customer_1",
        conversationId: "conversation_1",
        wechatAccountId: "wechat_1",
        selectedImageId: "image_1",
        status: "draft",
        paymentStatus: "paid",
        quantity: 100,
        unitPrice: 180,
        totalPrice: 18000,
        totalCost: 10000,
        profit: 8000,
        quoteDraft: quoteRecord,
      };
      return orderRecord;
    },
    recordVerifiedPayment: async (id, patch) => {
      assert.equal(id, "order_high_1");
      orderRecord = { ...orderRecord, ...patch, status: "confirmed" };
      return orderRecord;
    },
  };
  const wechat = {
    setConversationManualLock: async (conversationId, payload) => {
      locks.push({ conversationId, payload });
      return { conversation: { id: conversationId, manualLocked: payload.locked } };
    },
    queueOrderConfirmation: async (orderId, payload) => {
      queuedConfirmations.push({ orderId, payload });
      throw new Error("high-value payment verification must not queue automatically");
    },
  };
  const service = new QuotesService({}, localStore, orders, wechat);

  const result = await service.verifyPaymentProofAndQueueConfirmation("quote_high_1", {
    operationKey: "test-manual-high-value-payment-proof-1",
    paymentStatus: "paid",
    owner: "Alice",
    expectedWechatAccountId: "wechat_1",
    expectedConversationId: "conversation_1",
    expectedCustomerId: "customer_1",
  });

  assert.equal(result.quote.status, "accepted");
  assert.equal(result.orderDraft.status, "confirmed");
  assert.equal(result.orderDraft.paymentStatus, "paid");
  assert.equal(result.sendTask, null);
  assert.match(result.message, /高价值订单付款已核验/);
  assert.deepEqual(
    locks.map((item) => ({ conversationId: item.conversationId, locked: item.payload.locked, reason: item.payload.reason })),
    [{ conversationId: "conversation_1", locked: true, reason: "manual_payment_proof_high_value" }],
  );
  assert.equal(queuedConfirmations.length, 0);
  assert.equal(reviewLogs[0].decision, "manual_payment_proof_verified_high_value");
  assert.equal(reviewLogs[0].metadata.sendTaskId, null);
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
      selectDesignImage: (designJobId, imageId, feedback) => {
        assert.equal(designJobId, "design_1");
        for (const image of designJob.images) {
          image.selected = image.id === imageId || image.imageId === imageId;
          if (image.selected) image.customerFeedback = feedback;
        }
      },
      createReviewLog: (payload) => {
        reviewLogs.push(payload);
        return payload;
      },
    },
    {},
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
  assert.equal(designJob.images[0].selected, false);
  assert.equal(designJob.images[1].selected, true);
  assert.match(designJob.images[1].customerFeedback, /客户改选第二张/);
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
    {},
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
      selectDesignImage: (designJobId, imageId, feedback) => {
        assert.equal(designJobId, "design_1");
        for (const image of designJob.images) {
          image.selected = image.id === imageId || image.imageId === imageId;
          if (image.selected) image.customerFeedback = feedback;
        }
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
    note: "客户改选第二张",
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
  assert.equal(designJob.images[0].selected, false);
  assert.equal(designJob.images[1].selected, true);
  assert.match(designJob.images[1].customerFeedback, /客户改选第二张/);
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
    () => service.update(order.id, { status: "fulfilled" }),
    (error) => {
      assert.match(error.message, /订单未绑定客户选中的效果图，不能标记为完成/);
      assert.doesNotMatch(error.message, /selectedImageId|order has no selected image/);
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

  const preview = await service.confirmationPreview("order_1", {
    expectedWechatAccountId: "wechat_1",
    expectedConversationId: "conversation_1",
    expectedCustomerId: "customer_1",
  });

  assert.equal(preview.orderDraft.id, "order_1");
  assert.equal(typeof preview.message, "string");
  assert.ok(preview.message.length > 20);
  assert.deepEqual(preview.warnings, []);
  await assert.rejects(
    () =>
      service.confirmationPreview("order_1", {
        expectedWechatAccountId: "wechat_1",
        expectedConversationId: "conversation_2",
        expectedCustomerId: "customer_1",
      }),
    /order draft identity mismatch: conversationId expected conversation_2, got conversation_1/,
  );
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
