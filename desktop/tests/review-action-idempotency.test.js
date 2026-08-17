"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { ReviewsService } = require("../apps/api/src/reviews/reviews.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const { deterministicOperationId } = require("../apps/api/src/shared/operation-idempotency");

const identity = {
  expectedWechatAccountId: "wechat_1",
  expectedConversationId: "conversation_1",
  expectedCustomerId: "customer_1",
};

test("design review action replays by operationKey before duplicate side effects", async (t) => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  t.after(() => {
    appConfig.useLocalStore = previousUseLocalStore;
  });

  let job = {
    id: "design_review_idempotent",
    status: "manual_review",
    isHighValue: false,
    budget: { totalAmount: 2000, perUnitAmount: 100 },
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
  };
  const store = createReviewStore({
    getDesignJob: () => job,
    updateDesignJob: (id, patch) => {
      store.counts.designUpdates += 1;
      job = { ...job, ...patch, id };
      return job;
    },
  });
  const notifications = createNotificationStub();
  const service = new ReviewsService({}, store, {}, {}, notifications, {});

  const payload = {
    ...identity,
    operationKey: "review:design:approve:0001",
    decision: "approve_images",
    reviewer: "operator-1",
    note: "looks good",
  };

  const first = await service.reviewDesignJob(job.id, payload);
  const second = await service.reviewDesignJob(job.id, payload);

  assert.equal(first.log.id, second.log.id);
  assert.equal(second.replayed, true);
  assert.equal(store.counts.designUpdates, 1);
  assert.equal(notifications.calls.length, 1);
  assert.equal(store.logs.length, 1);
  assert.equal(store.logs[0].metadata.requestOperation.key, payload.operationKey);
});

test("quote review action rejects operationKey reuse with different payload", async (t) => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  t.after(() => {
    appConfig.useLocalStore = previousUseLocalStore;
  });

  let quote = {
    id: "quote_review_idempotent",
    status: "manual_review",
    totalPrice: 18000,
    unitPrice: 300,
    customerId: "customer_1",
    designJobId: "design_1",
    designJob: {
      id: "design_1",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      customerId: "customer_1",
    },
  };
  const store = createReviewStore({
    getQuoteDraft: () => quote,
  });
  const quotes = {
    update: async (id, patch) => {
      store.counts.quoteUpdates += 1;
      quote = { ...quote, ...patch, id };
      return quote;
    },
  };
  const notifications = createNotificationStub();
  const service = new ReviewsService({}, store, {}, quotes, notifications, {});

  const payload = {
    ...identity,
    operationKey: "review:quote:reject:0001",
    decision: "reject_quote",
    reviewer: "operator-1",
    note: "pricing mismatch",
  };

  const first = await service.reviewQuote(quote.id, payload);
  const second = await service.reviewQuote(quote.id, payload);

  assert.equal(first.log.id, second.log.id);
  assert.equal(second.replayed, true);
  assert.equal(store.counts.quoteUpdates, 1);
  assert.equal(notifications.calls.length, 1);
  assert.equal(store.logs.length, 1);

  await assert.rejects(
    () => service.reviewQuote(quote.id, { ...payload, note: "different note" }),
    /OPERATION_KEY_REUSED|operationKey/,
  );
  assert.equal(store.counts.quoteUpdates, 1);
  assert.equal(notifications.calls.length, 1);
  assert.equal(store.logs.length, 1);
});

test("order review action replays before duplicate followup queue and rejects drift", async (t) => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousHighValueAmount = appConfig.highValueAmountCny;
  appConfig.useLocalStore = true;
  appConfig.highValueAmountCny = 10000;
  t.after(() => {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.highValueAmountCny = previousHighValueAmount;
  });

  let order = {
    id: "order_review_idempotent",
    status: "processing",
    totalPrice: 24000,
    unitPrice: 800,
    paymentStatus: "deposit_paid",
    selectedImageId: "image_1",
    customerNotes: "",
    quoteDraftId: "quote_1",
    designJobId: "design_1",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
    quoteDraft: {
      id: "quote_1",
      totalPrice: 24000,
      unitPrice: 800,
      selectedImageId: "image_1",
    },
  };
  const store = createReviewStore({
    getOrderDraft: () => order,
    updateOrderDraft: (id, patch) => {
      store.counts.orderUpdates += 1;
      order = { ...order, ...patch, id };
      return order;
    },
  });
  const wechat = {
    queueOrderFollowup: async (id, payload) => {
      store.counts.orderFollowups += 1;
      return {
        sendTask: {
          id: `send_${store.counts.orderFollowups}`,
          orderDraftId: id,
          operationKey: payload.operationKey,
        },
      };
    },
  };
  const service = new ReviewsService({}, store, {}, {}, createNotificationStub(), wechat);

  const payload = {
    ...identity,
    operationKey: "review:order:followup:0001",
    decision: "approve_followup",
    followupType: "delivery",
    reviewer: "operator-1",
    note: "send delivery followup",
  };

  const first = await service.reviewOrder(order.id, payload);
  const second = await service.reviewOrder(order.id, payload);

  assert.equal(first.log.id, second.log.id);
  assert.equal(second.replayed, true);
  assert.equal(store.counts.orderFollowups, 1);
  assert.equal(store.counts.orderUpdates, 1);
  assert.equal(store.logs.length, 1);

  await assert.rejects(
    () => service.reviewOrder(order.id, { ...payload, followupType: "production" }),
    /OPERATION_KEY_REUSED|operationKey/,
  );
  assert.equal(store.counts.orderFollowups, 1);
  assert.equal(store.counts.orderUpdates, 1);
  assert.equal(store.logs.length, 1);
});

function createReviewStore(overrides = {}) {
  const logs = [];
  const store = {
    logs,
    counts: {
      designUpdates: 0,
      quoteUpdates: 0,
      orderUpdates: 0,
      orderFollowups: 0,
    },
    getReviewLog: (id) => logs.find((log) => log.id === id) || null,
    listReviewLogs: () => [...logs],
    createReviewLog: (payload) => {
      const effectKey = String(payload?.metadata?.effectKey || "");
      const id = effectKey ? deterministicOperationId("review", effectKey) : `review_${logs.length + 1}`;
      const existing = logs.find((log) => log.id === id);
      if (existing) return existing;
      const record = {
        id,
        ...payload,
        metadata: { ...(payload.metadata || {}) },
        createdAt: new Date().toISOString(),
      };
      logs.push(record);
      return record;
    },
    ...overrides,
  };
  return store;
}

function createNotificationStub() {
  const calls = [];
  return {
    calls,
    create: async (...args) => {
      calls.push(args);
      return { id: `notification_${calls.length}` };
    },
  };
}
