"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { appConfig } = require("../apps/api/src/shared/app-config");
const { OrdersService } = require("../apps/api/src/orders/orders.service");

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
