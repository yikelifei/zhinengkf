"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true },
});

const { OrdersService } = require("../apps/api/src/orders/orders.service");
const { QuotesService } = require("../apps/api/src/quotes/quotes.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

function selectedImage() {
  return { id: "image-1", imageId: "candidate-1", designJobId: "design-1", position: 1 };
}

function designJob() {
  return {
    id: "design-1",
    customerId: "customer-1",
    conversationId: "conversation-1",
    wechatAccountId: "account-1",
    selectedImageId: "image-1",
    conversation: conversation(),
    images: [selectedImage()],
  };
}

function conversation() {
  return { id: "conversation-1", customerId: "customer-1", wechatAccountId: "account-1" };
}

function baseOrder(patch = {}) {
  return {
    id: "order-1",
    quoteDraftId: "quote-1",
    designJobId: "design-1",
    customerId: "customer-1",
    conversationId: "conversation-1",
    wechatAccountId: "account-1",
    selectedImageId: "image-1",
    quantity: 1,
    unitPrice: 100,
    totalPrice: 100,
    totalCost: 40,
    profit: 60,
    status: "confirmed",
    paymentStatus: "deposit_paid",
    owner: "operator-1",
    customerNotes: "",
    ...patch,
  };
}

function baseQuote(patch = {}) {
  return {
    id: "quote-1",
    designJobId: "design-1",
    customerId: "customer-1",
    selectedImageId: "image-1",
    quantity: 1,
    unitPrice: 100,
    totalPrice: 100,
    totalCost: 40,
    profit: 60,
    status: "accepted",
    paymentStatus: "deposit_paid",
    sendTaskId: null,
    owner: "operator-1",
    customerNotes: "",
    ...patch,
  };
}

function sendTask(id, status, source, patch = {}) {
  return {
    id,
    status,
    wechatAccountId: "account-1",
    conversationId: "conversation-1",
    designJobId: "design-1",
    quoteDraftId: "quote-1",
    payload: {},
    guardSnapshot: {
      reason: source === "order_followup" ? "order-followup" : "order-confirmation",
      automation: { source, orderDraftId: "order-1", quoteDraftId: "quote-1" },
      history: [{ action: "queue", at: "2026-07-19T00:00:00.000Z" }],
    },
    createdAt: "2026-07-19T00:00:00.000Z",
    sentAt: status === "sent" ? "2026-07-19T00:01:00.000Z" : null,
    errorMessage: null,
    ...patch,
  };
}

function clone(value) {
  return structuredClone(value);
}

function hydrateOrder(db) {
  const job = { ...clone(db.designJob), conversation: clone(db.conversation), images: [clone(db.selectedImage)] };
  const quote = {
    ...clone(db.quote),
    customer: clone(db.customer),
    selectedImage: clone(db.selectedImage),
    designJob: job,
  };
  return {
    ...clone(db.order),
    customer: clone(db.customer),
    conversation: clone(db.conversation),
    wechatAccount: clone(db.wechatAccount),
    designJob: job,
    quoteDraft: quote,
    selectedImage: clone(db.selectedImage),
  };
}

function hydrateQuote(db) {
  return {
    ...clone(db.quote),
    customer: clone(db.customer),
    selectedImage: clone(db.selectedImage),
    designJob: { ...clone(db.designJob), conversation: clone(db.conversation), images: [clone(db.selectedImage)] },
    sendTask: null,
  };
}

function replaceDb(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, clone(source));
}

function taskMatches(task, where = {}) {
  if (where.id && task.id !== where.id) return false;
  if (where.quoteDraftId) {
    if (typeof where.quoteDraftId === "object" && Array.isArray(where.quoteDraftId.in)) {
      if (!where.quoteDraftId.in.includes(task.quoteDraftId)) return false;
    } else if (task.quoteDraftId !== where.quoteDraftId) return false;
  }
  if (where.wechatAccountId && task.wechatAccountId !== where.wechatAccountId) return false;
  if (where.conversationId && task.conversationId !== where.conversationId) return false;
  if (where.status) {
    if (typeof where.status === "object" && Array.isArray(where.status.in)) {
      if (!where.status.in.includes(task.status)) return false;
    } else if (task.status !== where.status) return false;
  }
  return true;
}

function createModels(db, calls, options = {}) {
  return {
    orderDraft: {
      async findUnique({ where }) {
        return db.order.id === where.id || db.order.quoteDraftId === where.quoteDraftId ? hydrateOrder(db) : null;
      },
      async update({ where, data }) {
        assert.equal(where.id, db.order.id);
        Object.assign(db.order, clone(data));
        calls.orderUpdates.push(clone(data));
        return hydrateOrder(db);
      },
    },
    quoteDraft: {
      async findUnique({ where }) {
        return db.quote.id === where.id ? hydrateQuote(db) : null;
      },
      async update({ where, data }) {
        assert.equal(where.id, db.quote.id);
        Object.assign(db.quote, clone(data));
        calls.quoteUpdates.push(clone(data));
        return hydrateQuote(db);
      },
    },
    wechatSendTask: {
      async findMany({ where = {}, take = 200 }) {
        calls.taskQueries.push(clone(where));
        return db.tasks.filter((task) => taskMatches(task, where)).slice(0, take).map(clone);
      },
      async updateMany({ where, data }) {
        if (options.throwOnTaskUpdate) throw new Error("simulated task update failure");
        const task = db.tasks.find((item) => taskMatches(item, where));
        if (!task) return { count: 0 };
        Object.assign(task, clone(data));
        calls.taskUpdates.push({ where: clone(where), data: clone(data) });
        return { count: 1 };
      },
    },
    reviewLog: {
      async create({ data }) {
        db.reviews.push(clone(data));
        calls.reviews.push(clone(data));
        return clone(data);
      },
    },
  };
}

function setup(options = {}) {
  const db = {
    order: baseOrder(options.order),
    quote: baseQuote(options.quote),
    designJob: designJob(),
    conversation: conversation(),
    selectedImage: selectedImage(),
    customer: { id: "customer-1", name: "客户甲" },
    wechatAccount: { id: "account-1", displayName: "客服一号" },
    tasks: clone(options.tasks || []),
    reviews: [],
  };
  const calls = { orderUpdates: [], quoteUpdates: [], taskQueries: [], taskUpdates: [], reviews: [], notifications: [] };
  const models = createModels(db, calls);
  const prisma = {
    ...models,
    async $transaction(callback) {
      const transactionDb = clone(db);
      const tx = createModels(transactionDb, calls, options);
      const result = await callback(tx);
      replaceDb(db, transactionDb);
      return result;
    },
  };
  const localStore = new Proxy({}, {
    get(_target, property) {
      throw new Error(`Prisma order invalidation attempted LocalStore fallback: ${String(property)}`);
    },
  });
  const notifications = {
    async create(level, title, body, metadata) {
      const record = { level, title, body, metadata };
      calls.notifications.push(record);
      return record;
    },
  };
  const orders = new OrdersService(prisma, localStore, notifications);
  return { db, calls, prisma, orders, localStore };
}

function expectedIdentity() {
  return {
    expectedWechatAccountId: "account-1",
    expectedConversationId: "conversation-1",
    expectedCustomerId: "customer-1",
  };
}

async function withPrismaMode(callback) {
  const previous = appConfig.useLocalStore;
  appConfig.useLocalStore = false;
  try {
    return await callback();
  } finally {
    appConfig.useLocalStore = previous;
  }
}

test("Prisma cancellation atomically updates order and quote while cancelling only exact eligible order sends", async () => {
  await withPrismaMode(async () => {
    const tasks = [
      sendTask("confirmation-queued", "queued", "order_confirmation"),
      sendTask("followup-blocked", "blocked", "order_followup"),
      sendTask("followup-failed", "failed", "order_followup"),
      sendTask("confirmation-sending", "sending", "order_confirmation"),
      sendTask("confirmation-sent", "sent", "order_confirmation"),
      sendTask("quote-only", "queued", "quote_send", {
        guardSnapshot: { automation: { source: "quote_send", quoteDraftId: "quote-1" }, history: [] },
      }),
      sendTask("wrong-order", "queued", "order_confirmation", {
        guardSnapshot: { automation: { source: "order_confirmation", orderDraftId: "order-2" }, history: [] },
      }),
      sendTask("wrong-conversation", "queued", "order_followup", { conversationId: "conversation-2" }),
    ];
    const { orders, db, calls } = setup({ tasks });
    await orders.update("order-1", { ...expectedIdentity(), status: "cancelled", owner: "auditor" });

    assert.equal(db.order.status, "cancelled");
    assert.equal(db.quote.status, "cancelled");
    for (const id of ["confirmation-queued", "followup-blocked", "followup-failed"]) {
      const task = db.tasks.find((item) => item.id === id);
      assert.equal(task.status, "cancelled");
      assert.equal(task.errorMessage, "order_cancelled_before_send");
      assert.equal(task.guardSnapshot.cancelReason, "order_cancelled_before_send");
      assert.equal(task.guardSnapshot.orderSendState.reason, "orderCancelledBeforeSend");
      assert.equal(task.guardSnapshot.history.at(-1).action, "cancel");
    }
    for (const id of ["confirmation-sending", "confirmation-sent", "quote-only", "wrong-order", "wrong-conversation"]) {
      assert.notEqual(db.tasks.find((item) => item.id === id).status, "cancelled");
    }
    assert.equal(calls.taskUpdates.length, 3);
    assert.deepEqual(calls.taskUpdates.map((item) => item.where.status).sort(), ["blocked", "failed", "queued"]);
    assert.equal(db.reviews.length, 1);
    assert.equal(db.reviews[0].targetType, "order");
    assert.equal(db.reviews[0].targetId, "order-1");
    assert.equal(db.reviews[0].reviewer, "system_order_invalidation");
    assert.equal(db.reviews[0].note, "order_send_invalidation:order_cancelled_before_send;cancelled_count:3");
    assert.deepEqual(db.reviews[0].metadata.cancelledSendTaskIds.sort(), ["confirmation-queued", "followup-blocked", "followup-failed"]);
    assert.deepEqual(db.reviews[0].metadata.eligibleStatuses, ["queued", "blocked", "failed"]);
    assert.equal(JSON.stringify(db.reviews[0]).includes("客户甲"), false);
    assert.deepEqual(calls.notifications[0].metadata.cancelledSendTaskIds.sort(), db.reviews[0].metadata.cancelledSendTaskIds.sort());
  });
});

test("Prisma unpaid and refunded transitions cancel pending sends with payment invalidation history", async (t) => {
  for (const paymentStatus of ["unpaid", "refunded"]) {
    await t.test(paymentStatus, async () => {
      await withPrismaMode(async () => {
        const { orders, db } = setup({ tasks: [sendTask(`payment-${paymentStatus}`, "queued", "order_confirmation")] });
        await orders.update("order-1", { ...expectedIdentity(), paymentStatus });
        const task = db.tasks[0];
        assert.equal(db.order.paymentStatus, paymentStatus);
        assert.equal(db.quote.paymentStatus, paymentStatus);
        assert.equal(task.status, "cancelled");
        assert.equal(task.errorMessage, "order_payment_not_ready_before_send");
        assert.equal(task.guardSnapshot.orderSendState.reason, "orderPaymentNotReadyBeforeSend");
        assert.equal(task.guardSnapshot.history.at(-1).fromStatus, "queued");
      });
    });
  }
});

test("Prisma quote payment synchronization reuses transactional order-send invalidation", async () => {
  await withPrismaMode(async () => {
    const { orders, prisma, localStore, db } = setup({
      tasks: [sendTask("quote-refund-order-send", "blocked", "order_followup")],
    });
    const quotes = new QuotesService(prisma, localStore, orders, {
      async setConversationManualLock() {
        throw new Error("manual lock must not run for a payment-only quote update");
      },
    });
    await quotes.update("quote-1", { ...expectedIdentity(), paymentStatus: "refunded", owner: "finance-reviewer" });
    assert.equal(db.quote.paymentStatus, "refunded");
    assert.equal(db.order.paymentStatus, "refunded");
    assert.match(db.order.customerNotes, /报价付款状态已同步为 refunded/);
    assert.equal(db.tasks[0].status, "cancelled");
    assert.equal(db.tasks[0].guardSnapshot.cancelReason, "order_payment_not_ready_before_send");
  });
});

test("Prisma repeated invalidation is idempotent and does not duplicate task history or no-op audit", async () => {
  await withPrismaMode(async () => {
    const { orders, db, calls } = setup({ tasks: [sendTask("idempotent", "failed", "order_confirmation")] });
    await orders.update("order-1", { ...expectedIdentity(), status: "cancelled" });
    await orders.update("order-1", { ...expectedIdentity(), status: "cancelled" });
    assert.equal(db.tasks[0].guardSnapshot.history.filter((item) => item.action === "cancel").length, 1);
    assert.equal(calls.taskUpdates.length, 1);
    assert.equal(db.reviews.length, 1);
  });
});

test("Prisma task cancellation failure rolls back order, quote, task and audit together", async () => {
  await withPrismaMode(async () => {
    const { orders, db } = setup({
      tasks: [sendTask("rollback", "queued", "order_confirmation")],
      throwOnTaskUpdate: true,
    });
    await assert.rejects(
      orders.update("order-1", { ...expectedIdentity(), status: "cancelled" }),
      /simulated task update failure/,
    );
    assert.equal(db.order.status, "confirmed");
    assert.equal(db.quote.status, "accepted");
    assert.equal(db.tasks[0].status, "queued");
    assert.equal(db.reviews.length, 0);
  });
});
