"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { appConfig } = require("../apps/api/src/shared/app-config");
const { deterministicOperationId } = require("../apps/api/src/shared/operation-idempotency");
const { OrdersService } = require("../apps/api/src/orders/orders.service");

const EXPECTED = {
  expectedWechatAccountId: "wechat_1",
  expectedConversationId: "conversation_1",
  expectedCustomerId: "customer_1",
};

function paymentEvent(overrides = {}) {
  return {
    id: "payment_1",
    quoteDraftId: "quote_1",
    orderDraftId: "order_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    paymentStatus: "paid",
    amountCny: 9000,
    method: "bank_transfer",
    proofReference: "proof-paid-1",
    reviewer: "operator-1",
    note: "verified payment",
    source: "manual_payment_proof",
    idempotencyKey: "paid-proof-1",
    createdAt: "2026-07-29T10:00:00.000Z",
    ...overrides,
  };
}

function createFixture() {
  const now = "2026-07-29T10:00:00.000Z";
  const paymentEvents = [paymentEvent()];
  const reviewLogs = [];
  const notifications = [];
  const quoteDraft = {
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    status: "accepted",
    paymentStatus: "paid",
    totalPrice: 9000,
    paymentEvents,
  };
  const orderRecord = {
    id: "order_1",
    quoteDraftId: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 180,
    totalPrice: 9000,
    totalCost: 5000,
    profit: 4000,
    status: "fulfilled",
    paymentStatus: "paid",
    productionStatus: "delivered",
    carrier: "SF Express",
    trackingNo: "SF202607290001",
    shippedAt: "2026-07-29 10:00",
    deliveredAt: "2026-07-30 10:00",
    quoteDraft,
  };
  const localStore = {
    getOrderDraft: (id) => {
      assert.equal(id, "order_1");
      return {
        ...orderRecord,
        quoteDraft: { ...quoteDraft, paymentEvents },
        paymentEvents,
      };
    },
    listPaymentEvents: (filter = {}) =>
      paymentEvents
        .filter((event) => !filter.quoteDraftId || event.quoteDraftId === filter.quoteDraftId)
        .filter((event) => !filter.orderDraftId || event.orderDraftId === filter.orderDraftId),
    recordPaymentEvent: (payload) => {
      const existing = paymentEvents.find((event) => event.idempotencyKey === payload.idempotencyKey);
      if (existing) return existing;
      const record = { id: `payment_${paymentEvents.length + 1}`, createdAt: now, ...payload };
      paymentEvents.push(record);
      return record;
    },
    listReviewLogs: () => reviewLogs,
    getReviewLog: (id) => reviewLogs.find((log) => log.id === id) || null,
    createReviewLog: (payload) => {
      const effectKey = String(payload?.metadata?.effectKey || "");
      const existing = effectKey
        ? reviewLogs.find((log) => String(log?.metadata?.effectKey || "") === effectKey)
        : null;
      if (existing) return existing;
      const record = {
        id: effectKey ? deterministicOperationId("review", effectKey) : `review_${reviewLogs.length + 1}`,
        createdAt: now,
        ...payload,
      };
      reviewLogs.push(record);
      return record;
    },
  };
  return {
    service: new OrdersService({}, localStore, { create: async (...args) => notifications.push(args) }),
    paymentEvents,
    reviewLogs,
    notifications,
  };
}

test("order after-sales refund creates a case, resolves it, and records one refund ledger event", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createFixture();

  try {
    appConfig.useLocalStore = true;
    const created = await fixture.service.createAfterSalesCase("order_1", {
      ...EXPECTED,
      operationKey: "after-sales-create-0001",
      type: "refund",
      requestedAmountCny: 200,
      reason: "客户收到礼盒后反馈外包装压痕，需要退款 200 元。",
      evidenceReference: "chat-proof-1",
      owner: "operator-1",
    });

    assert.equal(created.status, "open");
    assert.equal(created.type, "refund");
    assert.equal(fixture.reviewLogs.length, 1);

    const resolved = await fixture.service.resolveAfterSalesCase("order_1", created.id, {
      ...EXPECTED,
      operationKey: "after-sales-resolve-0001",
      resolutionType: "refund",
      approvedAmountCny: 200,
      refundMethod: "bank_transfer",
      refundReference: "refund-proof-1",
      note: "已线下退款给客户。",
      owner: "operator-1",
    });

    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.resolution.type, "refund");
    assert.equal(fixture.paymentEvents.length, 2);
    assert.equal(fixture.paymentEvents[1].paymentStatus, "refunded");
    assert.equal(fixture.paymentEvents[1].amountCny, 200);
    assert.equal(fixture.paymentEvents[1].source, "manual_after_sales_refund");
    assert.equal(fixture.reviewLogs.length, 2);

    const replay = await fixture.service.resolveAfterSalesCase("order_1", created.id, {
      ...EXPECTED,
      operationKey: "after-sales-resolve-0001",
      resolutionType: "refund",
      approvedAmountCny: 200,
      refundMethod: "bank_transfer",
      refundReference: "refund-proof-1",
      note: "已线下退款给客户。",
      owner: "operator-1",
    });

    assert.equal(replay.id, created.id);
    assert.equal(fixture.paymentEvents.length, 2);
    assert.equal(fixture.reviewLogs.length, 2);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order after-sales rejects refund amounts above the refundable ledger balance", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createFixture();

  try {
    appConfig.useLocalStore = true;
    await assert.rejects(
      () => fixture.service.createAfterSalesCase("order_1", {
        ...EXPECTED,
        operationKey: "after-sales-create-0002",
        type: "refund",
        requestedAmountCny: 10000,
        reason: "客户要求超额退款。",
        owner: "operator-1",
      }),
      /可退 9000 元/,
    );
    assert.equal(fixture.reviewLogs.length, 0);
    assert.equal(fixture.paymentEvents.length, 1);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order after-sales operation key replay rejects changed create payload", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createFixture();
  const payload = {
    ...EXPECTED,
    operationKey: "after-sales-create-0003",
    type: "refund",
    requestedAmountCny: 300,
    reason: "客户要求退款。",
    owner: "operator-1",
  };

  try {
    appConfig.useLocalStore = true;
    await fixture.service.createAfterSalesCase("order_1", payload);
    await assert.rejects(
      () => fixture.service.createAfterSalesCase("order_1", { ...payload, requestedAmountCny: 500 }),
      /operationKey was already used with different identity or payload/,
    );
    assert.equal(fixture.reviewLogs.length, 1);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order after-sales replacement resolution requires replacement evidence", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createFixture();

  try {
    appConfig.useLocalStore = true;
    const created = await fixture.service.createAfterSalesCase("order_1", {
      ...EXPECTED,
      operationKey: "after-sales-create-0004",
      type: "replacement",
      reason: "客户反馈破损，需要补发。",
      evidenceReference: "photo-proof-1",
      owner: "operator-1",
    });

    await assert.rejects(
      () => fixture.service.resolveAfterSalesCase("order_1", created.id, {
        ...EXPECTED,
        operationKey: "after-sales-resolve-0004",
        resolutionType: "replacement",
        owner: "operator-1",
      }),
      /记录补发完成必须填写物流公司和可核验的补发物流单号/,
    );
    assert.equal(fixture.paymentEvents.length, 1);
    assert.equal(fixture.reviewLogs.length, 1);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order after-sales refund resolution requires real method and proof reference", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createFixture();

  try {
    appConfig.useLocalStore = true;
    const created = await fixture.service.createAfterSalesCase("order_1", {
      ...EXPECTED,
      operationKey: "after-sales-create-0005",
      type: "refund",
      requestedAmountCny: 200,
      reason: "客户反馈包装破损，双方协商退款 200 元。",
      evidenceReference: "photo-proof-2",
      owner: "operator-1",
    });

    await assert.rejects(
      () => fixture.service.resolveAfterSalesCase("order_1", created.id, {
        ...EXPECTED,
        operationKey: "after-sales-resolve-0005a",
        resolutionType: "refund",
        approvedAmountCny: 200,
        refundReference: "refund-proof-2",
        owner: "operator-1",
      }),
      /必须填写实际退款方式/,
    );
    await assert.rejects(
      () => fixture.service.resolveAfterSalesCase("order_1", created.id, {
        ...EXPECTED,
        operationKey: "after-sales-resolve-0005b",
        resolutionType: "refund",
        approvedAmountCny: 200,
        refundMethod: "bank_transfer",
        owner: "operator-1",
      }),
      /必须填写可核验的退款凭证号/,
    );
    assert.equal(fixture.paymentEvents.length, 1);
    assert.equal(fixture.reviewLogs.length, 1);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("order after-sales replacement rejects placeholder logistics", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const fixture = createFixture();

  try {
    appConfig.useLocalStore = true;
    const created = await fixture.service.createAfterSalesCase("order_1", {
      ...EXPECTED,
      operationKey: "after-sales-create-0006",
      type: "replacement",
      reason: "客户反馈少件，确认补发。",
      evidenceReference: "photo-proof-3",
      owner: "operator-1",
    });
    await assert.rejects(
      () => fixture.service.resolveAfterSalesCase("order_1", created.id, {
        ...EXPECTED,
        operationKey: "after-sales-resolve-0006",
        resolutionType: "replacement",
        replacementCarrier: "x",
        replacementTrackingNo: "abc",
        note: "已安排补发。",
        owner: "operator-1",
      }),
      /物流公司或物流单号格式不正确/,
    );
    assert.equal(fixture.reviewLogs.length, 1);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});
