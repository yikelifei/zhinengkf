"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
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
    /explicit manual release reason/,
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
    /explicit manual release reason/,
  );

  assert.equal(locks.length, 0);
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
