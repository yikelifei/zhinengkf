"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { appConfig } = require("../apps/api/src/shared/app-config");
const { QuotesService } = require("../apps/api/src/quotes/quotes.service");

const EXPECTED = {
  expectedWechatAccountId: "wechat_1",
  expectedConversationId: "conversation_1",
  expectedCustomerId: "customer_1",
};

function createPaymentFixture({ totalPrice = 9000, priorPaymentEvents = [] } = {}) {
  const now = "2026-07-29T10:00:00.000Z";
  const selectedImage = { id: "image_1", imageId: "candidate_1", designJobId: "design_1", position: 1, selected: true };
  const designJob = {
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
    images: [selectedImage],
  };
  let quoteRecord = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 180,
    totalPrice,
    totalCost: 5000,
    profit: totalPrice - 5000,
    status: "sent",
    paymentStatus: "unpaid",
    owner: "Alice",
    customer: { id: "customer_1", name: "客户A" },
    selectedImage,
    designJob,
  };
  let orderRecord = null;
  const paymentEvents = priorPaymentEvents.map((event, index) => ({
    id: `prior_payment_${index + 1}`,
    quoteDraftId: "quote_1",
    orderDraftId: "order_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    method: "bank_transfer",
    proofReference: `prior-proof-${index + 1}`,
    reviewer: "Alice",
    note: "prior verified payment",
    source: "manual_payment_proof",
    idempotencyKey: `prior-payment-${index + 1}`,
    createdAt: now,
    ...event,
  }));
  const reviewLogs = [];
  const locks = [];
  const queuedConfirmations = [];
  const localStore = {
    getQuoteDraft: () => quoteRecord,
    updateQuoteDraft: (id, patch) => {
      quoteRecord = { ...quoteRecord, id, ...patch };
      return quoteRecord;
    },
    listPaymentEvents: (filter = {}) =>
      paymentEvents
        .filter((event) => !filter.quoteDraftId || event.quoteDraftId === filter.quoteDraftId)
        .filter((event) => !filter.orderDraftId || event.orderDraftId === filter.orderDraftId),
    recordPaymentEvent: (payload) => {
      const existing = paymentEvents.find((event) => event.idempotencyKey === payload.idempotencyKey);
      if (existing) return existing;
      const event = { id: `payment_${paymentEvents.length + 1}`, ...payload, createdAt: now };
      paymentEvents.push(event);
      return event;
    },
    getReviewLog: () => null,
    listReviewLogs: () => reviewLogs,
    createReviewLog: (payload) => {
      const effectKey = String(payload?.metadata?.effectKey || "");
      const existing = effectKey
        ? reviewLogs.find((log) => String(log?.metadata?.effectKey || "") === effectKey)
        : null;
      if (existing) return existing;
      const log = { id: `review_${reviewLogs.length + 1}`, createdAt: now, ...payload };
      reviewLogs.push(log);
      return log;
    },
  };
  const orders = {
    createFromQuote: async (quoteId, expected) => {
      assert.equal(quoteId, quoteRecord.id);
      assert.equal(expected.expectedConversationId, EXPECTED.expectedConversationId);
      orderRecord = {
        id: "order_1",
        quoteDraftId: quoteRecord.id,
        designJobId: quoteRecord.designJobId,
        customerId: quoteRecord.customerId,
        conversationId: quoteRecord.designJob.conversationId,
        wechatAccountId: quoteRecord.designJob.wechatAccountId,
        selectedImageId: quoteRecord.selectedImageId,
        status: "draft",
        paymentStatus: quoteRecord.paymentStatus,
        quantity: quoteRecord.quantity,
        unitPrice: quoteRecord.unitPrice,
        totalPrice: quoteRecord.totalPrice,
        totalCost: quoteRecord.totalCost,
        profit: quoteRecord.profit,
        quoteDraft: quoteRecord,
        designJob,
        selectedImage,
      };
      return orderRecord;
    },
    getById: async (id, expected = {}) => {
      assert.equal(id, "order_1");
      assert.equal(expected.expectedConversationId || EXPECTED.expectedConversationId, EXPECTED.expectedConversationId);
      if (!orderRecord) throw new Error(`order not found: ${id}`);
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
      const sendTask = { id: "send_1", status: "queued" };
      orderRecord = { ...orderRecord, confirmationSendTaskId: sendTask.id, confirmationSendTask: sendTask };
      queuedConfirmations.push({ orderId, payload, sendTask });
      return { orderDraft: orderRecord, sendTask, message: "订单确认" };
    },
  };
  return {
    service: new QuotesService({}, localStore, orders, wechat),
    paymentEvents,
    reviewLogs,
    locks,
    queuedConfirmations,
    get quoteRecord() {
      return quoteRecord;
    },
    get orderRecord() {
      return orderRecord;
    },
  };
}

test("quote payment proof verification replays one exact operation without duplicate effects", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createPaymentFixture();
  const payload = {
    ...EXPECTED,
    operationKey: "quote-payment-proof:11111111-1111-4111-8111-111111111111",
    paymentStatus: "deposit_paid",
    amountCny: 3000,
    method: "bank_transfer",
    proofReference: "proof-quote-1",
    owner: "operator-1",
  };

  try {
    appConfig.useLocalStore = true;
    const first = await fixture.service.verifyPaymentProofAndQueueConfirmation("quote_1", payload);
    const replay = await fixture.service.verifyPaymentProofAndQueueConfirmation("quote_1", payload);

    assert.equal(first.paymentEvent.id, replay.paymentEvent.id);
    assert.equal(replay.sendTask.id, "send_1");
    assert.equal(fixture.paymentEvents.length, 1);
    assert.equal(fixture.reviewLogs.length, 1);
    assert.equal(fixture.queuedConfirmations.length, 1);
    assert.equal(fixture.locks.length, 1);
    assert.equal(fixture.orderRecord.status, "confirmed");
    assert.equal(fixture.orderRecord.paymentStatus, "deposit_paid");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("quote payment proof verification rejects operationKey reuse with changed amount", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createPaymentFixture();
  const payload = {
    ...EXPECTED,
    operationKey: "quote-payment-proof:22222222-2222-4222-8222-222222222222",
    paymentStatus: "deposit_paid",
    amountCny: 3000,
    method: "bank_transfer",
    proofReference: "proof-quote-1",
    owner: "operator-1",
  };

  try {
    appConfig.useLocalStore = true;
    await fixture.service.verifyPaymentProofAndQueueConfirmation("quote_1", payload);
    await assert.rejects(
      () => fixture.service.verifyPaymentProofAndQueueConfirmation("quote_1", { ...payload, amountCny: 5000 }),
      /operationKey was already used with different identity or payload/,
    );

    assert.equal(fixture.paymentEvents.length, 1);
    assert.equal(fixture.reviewLogs.length, 1);
    assert.equal(fixture.queuedConfirmations.length, 1);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("quote payment proof verification rejects the same proof reference with a new operation key", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createPaymentFixture();
  const payload = {
    ...EXPECTED,
    operationKey: "quote-payment-proof:55555555-5555-4555-8555-555555555555",
    paymentStatus: "deposit_paid",
    amountCny: 3000,
    method: "bank_transfer",
    proofReference: "proof-quote-duplicate",
    owner: "operator-1",
  };

  try {
    appConfig.useLocalStore = true;
    await fixture.service.verifyPaymentProofAndQueueConfirmation("quote_1", payload);
    await assert.rejects(
      () =>
        fixture.service.verifyPaymentProofAndQueueConfirmation("quote_1", {
          ...payload,
          operationKey: "quote-payment-proof:66666666-6666-4666-8666-666666666666",
        }),
      /付款凭证已经核验过|重复入账/,
    );

    assert.equal(fixture.paymentEvents.length, 1);
    assert.equal(fixture.reviewLogs.length, 1);
    assert.equal(fixture.queuedConfirmations.length, 1);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("full payment verification requires the current and prior verified amount to cover quote total", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createPaymentFixture({ totalPrice: 9000 });

  try {
    appConfig.useLocalStore = true;
    await assert.rejects(
      () => fixture.service.verifyPaymentProofAndQueueConfirmation("quote_1", {
        ...EXPECTED,
        operationKey: "quote-payment-proof:33333333-3333-4333-8333-333333333333",
        paymentStatus: "paid",
        amountCny: 1000,
        method: "bank_transfer",
        proofReference: "proof-too-low",
        owner: "operator-1",
      }),
      /全款核验金额不足/,
    );

    assert.equal(fixture.quoteRecord.status, "sent");
    assert.equal(fixture.paymentEvents.length, 0);
    assert.equal(fixture.queuedConfirmations.length, 0);
    assert.equal(fixture.locks.length, 0);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("full payment verification can use a prior verified deposit amount", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createPaymentFixture({
    totalPrice: 9000,
    priorPaymentEvents: [{ paymentStatus: "deposit_paid", amountCny: 8000 }],
  });

  try {
    appConfig.useLocalStore = true;
    const result = await fixture.service.verifyPaymentProofAndQueueConfirmation("quote_1", {
      ...EXPECTED,
      operationKey: "quote-payment-proof:44444444-4444-4444-8444-444444444444",
      paymentStatus: "paid",
      amountCny: 1000,
      method: "bank_transfer",
      proofReference: "proof-full-balance",
      owner: "operator-1",
    });

    assert.equal(result.quote.paymentStatus, "paid");
    assert.equal(result.orderDraft.paymentStatus, "paid");
    assert.equal(fixture.paymentEvents.length, 2);
    assert.equal(fixture.queuedConfirmations.length, 1);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});
