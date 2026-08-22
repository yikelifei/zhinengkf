"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { appConfig } = require("../apps/api/src/shared/app-config");
const { createOrderDraftBusinessFingerprint, OrdersService } = require("../apps/api/src/orders/orders.service");
const { buildOrderDraftFromQuote } = require("../packages/rules");

function createQuote(paymentStatus, paymentEvents = [], overrides = {}) {
  const selectedImage = { id: "image_1", imageId: "candidate_1", designJobId: "design_1", position: 1, selected: true };
  return {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 180,
    totalPrice: 9000,
    totalCost: 5000,
    profit: 4000,
    status: "accepted",
    paymentStatus,
    customer: { id: "customer_1", name: "客户A" },
    selectedImage,
    paymentEvents,
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
      bundle: { items: [{ name: "礼盒", salePrice: 180, costPrice: 100 }] },
      images: [selectedImage],
    },
    ...overrides,
  };
}

function createService(quote) {
  let orderRecord = null;
  const hydrateOrder = () =>
    orderRecord
      ? {
          ...orderRecord,
          quoteDraft: quote,
          paymentEvents: (quote.paymentEvents || []).filter((event) => event.quoteDraftId === orderRecord.quoteDraftId),
        }
      : null;
  const localStore = {
    getQuoteDraft: () => quote,
    getOrderDraft: () => hydrateOrder(),
    getReviewLog: () => null,
    createReviewLog: (payload) => ({ id: "review_1", ...payload }),
    listPaymentEvents: (filter = {}) =>
      (quote.paymentEvents || []).filter((event) => !filter.quoteDraftId || event.quoteDraftId === filter.quoteDraftId),
    updateQuoteDraft: (id, patch) => {
      assert.equal(id, "quote_1");
      Object.assign(quote, patch);
      return quote;
    },
    upsertOrderDraftFromQuote: (quoteId, draft) => {
      orderRecord = { id: "order_1", ...draft, quoteDraftId: quoteId };
      return hydrateOrder();
    },
    updateOrderDraft: (id, patch) => {
      assert.equal(id, "order_1");
      orderRecord = { ...orderRecord, ...patch };
      return hydrateOrder();
    },
  };
  const notifications = { create: async () => ({ id: "notice_1" }) };
  return {
    service: new OrdersService({}, localStore, notifications),
    get orderRecord() {
      return orderRecord;
    },
  };
}

function paymentEvent(patch = {}) {
  return {
    id: "payment_1",
    quoteDraftId: "quote_1",
    orderDraftId: null,
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    paymentStatus: "paid",
    amountCny: 9000,
    method: "bank_transfer",
    proofReference: "proof-1",
    idempotencyKey: "proof-1:payment-event",
    createdAt: "2026-07-29T10:00:00.000Z",
    ...patch,
  };
}

test("order creation rejects paid quote status without verified payment ledger", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createService(createQuote("paid", []));

  try {
    appConfig.useLocalStore = true;
    await assert.rejects(
      () => fixture.service.createFromQuote("quote_1"),
      /缺少已核验付款流水|付款凭证/,
    );
    assert.equal(fixture.orderRecord, null);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order creation rejects full-payment status when ledger amount is insufficient", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createService(createQuote("paid", [paymentEvent({ amountCny: 1000 })]));

  try {
    appConfig.useLocalStore = true;
    await assert.rejects(
      () => fixture.service.createFromQuote("quote_1"),
      /全款流水金额不足/,
    );
    assert.equal(fixture.orderRecord, null);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order creation accepts paid quote only when ledger covers the total price", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createService(createQuote("paid", [paymentEvent({ amountCny: 4000 }), paymentEvent({ id: "payment_2", amountCny: 5000 })]));

  try {
    appConfig.useLocalStore = true;
    const order = await fixture.service.createFromQuote("quote_1");

    assert.equal(order.status, "confirmed");
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.totalPrice, 9000);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order creation accepts deposit-paid quote only when a verified deposit event exists", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const missingLedger = createService(createQuote("deposit_paid", []));
  const withLedger = createService(createQuote("deposit_paid", [paymentEvent({ paymentStatus: "deposit_paid", amountCny: 3000 })]));

  try {
    appConfig.useLocalStore = true;
    await assert.rejects(
      () => missingLedger.service.createFromQuote("quote_1"),
      /缺少已核验付款流水|付款凭证/,
    );

    const order = await withLedger.service.createFromQuote("quote_1");
    assert.equal(order.status, "confirmed");
    assert.equal(order.paymentStatus, "deposit_paid");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order execution rejects paid status when payment ledger is missing", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const quote = createQuote("paid", [paymentEvent()]);
  const fixture = createService(quote);

  try {
    appConfig.useLocalStore = true;
    await fixture.service.createFromQuote("quote_1");
    quote.paymentEvents = [];

    await assert.rejects(
      () => fixture.service.update("order_1", { status: "processing", owner: "operator-1" }),
      /付款流水|付款状态字段/,
    );
    assert.equal(fixture.orderRecord.status, "confirmed");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order execution accepts production start when deposit ledger exists", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createService(createQuote("deposit_paid", [paymentEvent({ paymentStatus: "deposit_paid", amountCny: 3000 })]));

  try {
    appConfig.useLocalStore = true;
    await fixture.service.createFromQuote("quote_1");
    const updated = await fixture.service.update("order_1", { status: "processing", owner: "operator-1" });

    assert.equal(updated.status, "processing");
    assert.equal(updated.paymentStatus, "deposit_paid");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order completion rejects paid status when full-payment ledger amount is insufficient", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const quote = createQuote("paid", [paymentEvent()]);
  const fixture = createService(quote);

  try {
    appConfig.useLocalStore = true;
    await fixture.service.createFromQuote("quote_1");
    fixture.orderRecord.status = "processing";
    fixture.orderRecord.productionStatus = "shipped";
    quote.paymentEvents = [paymentEvent({ amountCny: 1000 })];

    await assert.rejects(
      () =>
        fixture.service.updateFulfillment("order_1", {
          status: "fulfilled",
          productionStatus: "delivered",
          carrier: "SF Express",
          trackingNo: "SF202607290001",
          shippedAt: "2026-07-29 10:00",
          deliveredAt: "2026-07-30 10:00",
          operationKey: "order-completion-ledger-shortfall",
          owner: "operator-1",
        }),
      /全款流水金额不足/,
    );
    assert.equal(fixture.orderRecord.status, "processing");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order completion rejects fulfilled status when the delivery package snapshot is missing", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const quote = createQuote("paid", [paymentEvent()]);
  const fixture = createService(quote);

  try {
    appConfig.useLocalStore = true;
    await fixture.service.createFromQuote("quote_1");
    fixture.orderRecord.status = "processing";
    fixture.orderRecord.paymentStatus = "paid";
    fixture.orderRecord.productionStatus = "shipped";
    fixture.orderRecord.bundleSnapshot = null;
    fixture.orderRecord.selectedImageSnapshot = null;
    quote.designJob.bundle = null;
    quote.selectedImage = null;

    await assert.rejects(
      () =>
        fixture.service.updateFulfillment("order_1", {
          status: "fulfilled",
          productionStatus: "delivered",
          carrier: "SF Express",
          trackingNo: "SF202607290001",
          shippedAt: "2026-07-29 10:00",
          deliveredAt: "2026-07-30 10:00",
          operationKey: "order-completion-missing-delivery-package",
          owner: "operator-1",
        }),
      /交付资料包|客户选图|商品组合快照/,
    );
    assert.equal(fixture.orderRecord.status, "processing");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("Prisma inbound order creation fences, upserts and commits its recovery marker in one transaction", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const quote = createQuote("unpaid");
  const transactionEvents = [];
  const notificationTargets = [];
  const transactionClient = {
    inboundMessageOperation: {
      async updateMany(query) {
        transactionEvents.push({ type: "operation", query });
        return { count: 1 };
      },
    },
    quoteDraft: {
      async updateMany(query) {
        transactionEvents.push({ type: "quote-lock", query });
        return { count: 1 };
      },
      async findUnique() {
        transactionEvents.push({ type: "quote" });
        return quote;
      },
    },
    orderDraft: {
      async upsert(query) {
        transactionEvents.push({ type: "order", query });
        return {
          id: "order_prisma_1",
          quoteDraftId: quote.id,
          ...query.create,
          customer: quote.customer,
          conversation: quote.designJob.conversation,
          wechatAccount: { id: quote.designJob.wechatAccountId },
          designJob: quote.designJob,
          selectedImage: quote.selectedImage,
          quoteDraft: quote,
          paymentEvents: [],
        };
      },
    },
  };
  const prisma = {
    quoteDraft: { async findUnique() { return quote; } },
    async $transaction(callback) { return callback(transactionClient); },
  };
  const notifications = {
    async create(_level, _title, _body, target) {
      notificationTargets.push(target);
      return { id: "notice_prisma_1", target };
    },
  };
  const service = new OrdersService(prisma, {}, notifications);
  const initialDecision = buildOrderDraftFromQuote(quote);
  assert.equal(initialDecision.ok, true);
  const orderBusinessFingerprint = createOrderDraftBusinessFingerprint(initialDecision.orderDraft);
  const createOptions = {
    inboundFence: {
      operationId: "inbound_order_1",
      claimToken: "claim_order_1",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      operationResult: { stage: "routed" },
      recoveryEffect: {
        kind: "low_value_quote_acceptance",
        phase: "quote_committed_pending_order",
        quoteDraftId: quote.id,
        orderBusinessFingerprint,
      },
      orderBusinessFingerprint,
    },
    notificationEffectKey: "inbound_order_1:order-draft-created-notification",
  };

  try {
    appConfig.useLocalStore = false;
    const order = await service.createFromQuote(quote.id, {
      expectedWechatAccountId: "wechat_1",
      expectedConversationId: "conversation_1",
      expectedCustomerId: "customer_1",
    }, createOptions);

    assert.equal(order.id, "order_prisma_1");
    assert.deepEqual(transactionEvents.map((event) => event.type), ["operation", "quote-lock", "quote", "order", "operation"]);
    assert.equal(transactionEvents[0].query.where.claimToken, "claim_order_1");
    assert.equal(transactionEvents[4].query.data.result.recoveryEffect.phase, "quote_and_order_committed");
    assert.equal(transactionEvents[4].query.data.result.recoveryEffect.orderDraftId, order.id);
    assert.equal(notificationTargets[0].effectKey, "inbound_order_1:order-draft-created-notification");

    const orderWritesBeforeRecovery = transactionEvents.filter((event) => event.type === "order").length;
    quote.unitPrice = 190;
    quote.totalPrice = 9500;
    quote.profit = 4500;
    await assert.rejects(
      () => service.createFromQuote(quote.id, {
        expectedWechatAccountId: "wechat_1",
        expectedConversationId: "conversation_1",
        expectedCustomerId: "customer_1",
      }, createOptions),
      /business fields changed|refusing to overwrite/,
    );
    assert.equal(transactionEvents.filter((event) => event.type === "order").length, orderWritesBeforeRecovery);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("Prisma order replay never overwrites an existing order with revised quote money", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const originalQuote = createQuote("unpaid");
  const originalDecision = buildOrderDraftFromQuote(originalQuote);
  assert.equal(originalDecision.ok, true);
  const existingOrder = {
    id: "order_existing_prisma",
    quoteDraftId: originalQuote.id,
    ...originalDecision.orderDraft,
    customer: originalQuote.customer,
    conversation: originalQuote.designJob.conversation,
    wechatAccount: { id: originalQuote.designJob.wechatAccountId },
    designJob: originalQuote.designJob,
    selectedImage: originalQuote.selectedImage,
    quoteDraft: originalQuote,
    paymentEvents: [],
  };
  const revisedQuote = createQuote("unpaid", [], {
    unitPrice: 190,
    totalPrice: 9500,
    profit: 4500,
  });
  let attemptedUpdate = null;
  const prisma = {
    quoteDraft: { async findUnique() { return revisedQuote; } },
    orderDraft: {
      async upsert(query) {
        attemptedUpdate = query.update;
        return existingOrder;
      },
    },
  };
  const service = new OrdersService(prisma, {}, { create: async () => ({}) });

  try {
    appConfig.useLocalStore = false;
    await assert.rejects(
      () => service.createFromQuote(revisedQuote.id, {
        expectedWechatAccountId: "wechat_1",
        expectedConversationId: "conversation_1",
        expectedCustomerId: "customer_1",
      }),
      /refusing to overwrite/,
    );
    assert.deepEqual(attemptedUpdate, {});
    assert.equal(existingOrder.totalPrice, 9000);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});
