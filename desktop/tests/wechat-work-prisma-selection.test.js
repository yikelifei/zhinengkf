"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { createOrderDraftBusinessFingerprint } = require("../apps/api/src/orders/orders.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");

function candidate(id, imageId, position) {
  return { id, imageId, position, selected: false };
}

function designJob(patch = {}) {
  return {
    id: "job-selection",
    status: "sent",
    wechatAccountId: "account-a",
    conversationId: "conversation-a",
    customerId: "customer-a",
    isHighValue: false,
    budget: { total: 1000 },
    bundle: { automation: { ready: false, blockers: ["fixture_manual_quote"] }, items: [] },
    revisionCount: 1,
    images: [candidate("old-1", "r0-1", 1), candidate("new-1", "r1-1", 101), candidate("new-2", "r1-2", 102)],
    revisions: [{ id: "revision-1", revisionNumber: 1, status: "completed", resultImageIds: ["r1-1", "r1-2"] }],
    ...patch,
  };
}

function setup(options = {}) {
  appConfig.useLocalStore = false;
  appConfig.highValueAmountCny = 10000;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-work-prisma-selection-"));
  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  const initialJob = options.initialJob === undefined ? designJob() : options.initialJob;
  const currentJob = options.currentJob === undefined ? initialJob : options.currentJob;
  const calls = {
    jobQueries: [], jobUpdates: [], imageUpdates: [], operationUpdates: [], quotes: [], reviews: [], notifications: [],
    messageWrites: [], routeWrites: [],
  };
  const tx = {
    wechatAccount: {
      async updateMany() { return { count: 1 }; },
    },
    designJob: {
      async findFirst(query) {
        calls.jobQueries.push({ phase: "commit", query });
        return currentJob;
      },
      async update(query) {
        calls.jobUpdates.push(query);
        return { ...currentJob, ...query.data };
      },
    },
    designImageCandidate: {
      async updateMany(query) {
        calls.imageUpdates.push({ type: "many", query });
        return { count: currentJob?.images?.length || 0 };
      },
      async update(query) {
        calls.imageUpdates.push({ type: "one", query });
        return query;
      },
    },
    inboundMessageOperation: {
      async updateMany(query) {
        calls.operationUpdates.push(query);
        return { count: options.fenceCount === undefined ? 1 : options.fenceCount };
      },
    },
    message: {
      async findFirst() { return null; },
      async create(query) { calls.messageWrites.push(query); return { id: "message-created", ...query.data }; },
    },
    routeEvaluation: {
      async findUnique() { return null; },
      async create(query) { calls.routeWrites.push(query); return { id: query.data.id, ...query.data }; },
    },
    conversation: {
      async findUnique() { return conversation(); },
      async updateMany() { return { count: 1 }; },
    },
    quoteDraft: {
      async create(query) {
        const record = { id: "quote-created", ...query.data, customer: { name: "客户" }, selectedImage: { position: 101 }, designJob: currentJob };
        calls.quotes.push({ type: "create", query });
        return record;
      },
      async update(query) {
        const record = { id: query.where.id, ...query.data, customer: { name: "客户" }, selectedImage: { position: 101 }, designJob: currentJob };
        calls.quotes.push({ type: "update", query });
        return record;
      },
    },
  };
  const prisma = {
    designJob: {
      async findFirst(query) {
        calls.jobQueries.push({ phase: "initial", query });
        return initialJob;
      },
      async findUnique(query) {
        calls.jobQueries.push({ phase: "recovery", query });
        return options.recoveryJob || currentJob;
      },
    },
    quoteDraft: {
      async findFirst() { return options.quote || null; },
      async update({ where, data }) { return { id: where.id, ...data }; },
    },
    conversation: {
      async findUnique() { return conversation(); },
      async update(query) { return { ...conversation(), ...query.data }; },
    },
    wechatSendTask: {
      async findMany() { return []; },
    },
    reviewLog: {
      async create({ data }) { calls.reviews.push(data); return data; },
    },
    async $transaction(callback) { return callback(tx); },
  };
  const notifications = {
    async create(level, title, body, metadata) {
      const record = { level, title, body, metadata };
      calls.notifications.push(record);
      return record;
    },
  };
  const service = new WechatDispatchService(prisma, localStore, {}, notifications, {});
  return { service, calls };
}

function conversation(patch = {}) {
  return {
    id: "conversation-a",
    customerId: "customer-a",
    wechatAccountId: "account-a",
    channel: "work_wechat",
    title: "企业微信客户",
    manualLocked: false,
    ...patch,
  };
}

function params(payload = { text: "第1张" }, conversationPatch = {}) {
  return {
    operationId: "inbound-selection-operation",
    claimToken: "inbound-selection-owner",
    conversation: conversation(conversationPatch),
    message: { id: "message-a" },
    route: { id: "route-a" },
    payload,
  };
}

function prismaQuote(patch = {}) {
  const job = designJob({
    id: "job-quote",
    status: "quote_created",
    wechatAccountId: "account-a",
    conversationId: "conversation-a",
    customerId: "customer-a",
    isHighValue: false,
    budget: { total: 1000 },
  });
  return {
    id: "quote-prisma",
    status: "sent",
    paymentStatus: "unpaid",
    selectedImageId: "new-1",
    totalPrice: 1000,
    totalCost: 800,
    unitPrice: 10,
    profit: 200,
    quantity: 100,
    customerId: "customer-a",
    designJobId: job.id,
    owner: null,
    customerNotes: "",
    customer: { id: "customer-a", name: "客户" },
    selectedImage: { id: "new-1", position: 1 },
    designJob: job,
    orderDraft: null,
    ...patch,
  };
}

function setupPrismaQuoteAcceptance(quote) {
  appConfig.useLocalStore = false;
  appConfig.highValueAmountCny = 10000;
  const calls = {
    quoteQueries: [], quoteUpdates: [], orderCreates: [], finishes: [], reviews: [], fences: [], operationAdvances: [],
  };
  const tx = {
    wechatAccount: {
      async updateMany() { return { count: 1 }; },
    },
    inboundMessageOperation: {
      async updateMany(query) {
        calls.fences.push(query);
        return { count: 1 };
      },
    },
    quoteDraft: {
      async updateMany() { return { count: 1 }; },
      async findFirst(query) {
        calls.quoteQueries.push({ phase: "commit", query });
        return quote;
      },
      async update(query) {
        calls.quoteUpdates.push(query);
        return { ...quote, ...query.data };
      },
    },
  };
  const prisma = {
    quoteDraft: {
      async findFirst(query) {
        calls.quoteQueries.push({ phase: "initial_or_recovery", query });
        return quote;
      },
      async update(query) {
        calls.quoteUpdates.push(query);
        return { ...quote, ...query.data };
      },
    },
    async $transaction(callback) { return callback(tx); },
  };
  const orders = {
    async createFromQuote(quoteId, expected, options) {
      calls.orderCreates.push({ quoteId, expected, options });
      return quote.orderDraft || {
        id: "order-prisma",
        quoteDraftId: quoteId,
        designJobId: quote.designJobId,
        wechatAccountId: "account-a",
        conversationId: "conversation-a",
        customerId: "customer-a",
        status: "pending",
        paymentStatus: "unpaid",
        totalPrice: quote.totalPrice,
      };
    },
  };
  const service = new WechatDispatchService(prisma, {}, {}, {}, orders);
  service.persistence.advanceInboundOperation = async (operationId, claimToken, patch) => {
    calls.operationAdvances.push({ operationId, claimToken, patch });
    return { id: operationId, claimToken, ...patch };
  };
  service.finishLocalQuoteAcceptance = async (...args) => {
    calls.finishes.push(args);
    return {
      message: args[0].message,
      route: args[0].route,
      plan: { type: "quote_accepted", reason: args[3].reason, shouldQueueReply: false },
      quote: args[1],
      orderDraft: args[2],
      quoteAcceptance: args[3],
    };
  };
  service.createInboundQuoteReview = async (_conversation, _route, reviewedQuote, options) => {
    calls.reviews.push({ reviewedQuote, options });
    return { id: "review-notification", ...options };
  };
  return { service, calls };
}

test("Prisma inbound selection binds exact identity and only the latest revision round", async () => {
  const { service, calls } = setup();
  const result = await service.handlePrismaInboundImageSelection(params());
  assert.equal(result.plan.type, "select_design_image_and_create_quote");
  assert.equal(result.designJob.status, "quote_created");
  assert.equal(result.quote.id, "quote-created");
  assert.equal(calls.jobQueries[0].query.where.wechatAccountId, "account-a");
  assert.equal(calls.jobQueries[0].query.where.conversationId, "conversation-a");
  assert.equal(calls.jobQueries[0].query.where.customerId, "customer-a");
  assert.equal(calls.imageUpdates.find((item) => item.type === "one").query.where.id, "new-1");
  assert.equal(calls.imageUpdates.some((item) => item.query.where?.id === "old-1"), false);
});

test("Prisma quote acceptance creates an unpaid order with exact conversation identity", async () => {
  const quote = prismaQuote();
  const { service, calls } = setupPrismaQuoteAcceptance(quote);
  const result = await service.handlePrismaInboundQuoteAcceptance({
    operationId: "prisma-quote-accept",
    claimToken: "prisma-quote-owner",
    operationResult: { stage: "routed" },
    conversation: conversation(),
    message: { id: "message-quote-accept" },
    route: { id: "route-quote-accept" },
    payload: { text: "确认，就按这个做" },
  });

  assert.equal(result.plan.type, "quote_accepted");
  assert.equal(calls.quoteUpdates.length, 1);
  assert.equal(calls.quoteUpdates[0].data.status, "accepted");
  assert.equal(calls.quoteUpdates[0].data.paymentStatus, "unpaid");
  assert.equal(calls.orderCreates.length, 1);
  assert.equal(calls.orderCreates[0].quoteId, quote.id);
  assert.deepEqual(calls.orderCreates[0].expected, {
    expectedWechatAccountId: "account-a",
    expectedConversationId: "conversation-a",
    expectedCustomerId: "customer-a",
  });
  assert.equal(calls.orderCreates[0].options.inboundFence.operationId, "prisma-quote-accept");
  assert.equal(calls.orderCreates[0].options.inboundFence.claimToken, "prisma-quote-owner");
  assert.deepEqual(calls.orderCreates[0].options.inboundFence.operationResult, { stage: "routed" });
  assert.equal(calls.orderCreates[0].options.notificationEffectKey, "prisma-quote-accept:order-draft-created-notification");
  assert.equal(calls.finishes[0][0].orderCreatedNotificationAlreadySent, true);
  assert.equal(calls.fences.length, 2);
  assert.equal(calls.fences[0].where.claimToken, "prisma-quote-owner");
  assert.equal(calls.fences[1].data.result.recoveryEffect.phase, "quote_committed_pending_order");
  assert.match(calls.fences[1].data.result.recoveryEffect.orderBusinessFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(calls.orderCreates[0].options.inboundFence.recoveryEffect.phase, "quote_committed_pending_order");
  assert.equal(
    calls.orderCreates[0].options.inboundFence.orderBusinessFingerprint,
    calls.fences[1].data.result.recoveryEffect.orderBusinessFingerprint,
  );
  assert.equal(calls.operationAdvances.length, 0);
  assert.equal(calls.reviews.length, 0);
});

test("Prisma quote acceptance resumes the exact persisted order after a post-quote crash", async () => {
  const acceptedOrder = {
    id: "order-prisma-recovered",
    quoteDraftId: "quote-prisma",
    designJobId: "job-quote",
    wechatAccountId: "account-a",
    conversationId: "conversation-a",
    customerId: "customer-a",
    status: "pending",
    paymentStatus: "unpaid",
    totalPrice: 1000,
  };
  const quote = prismaQuote({ status: "accepted", orderDraft: acceptedOrder });
  const { service, calls } = setupPrismaQuoteAcceptance(quote);
  const orderBusinessFingerprint = createOrderDraftBusinessFingerprint(acceptedOrder);
  const acceptancePlan = {
    ok: true,
    hasIntent: true,
    action: "accept_quote_and_create_order",
    reason: "quote_accepted",
    quotePatch: { status: "accepted", paymentStatus: "unpaid" },
  };
  const result = await service.handlePrismaInboundQuoteAcceptance({
    operationId: "prisma-quote-recovery",
    claimToken: "prisma-quote-recovery-owner",
    operationResult: {
      recoveryEffect: {
        kind: "low_value_quote_acceptance",
        phase: "quote_committed_pending_order",
        quoteDraftId: quote.id,
        orderBusinessFingerprint,
        acceptancePlan,
        routeEvaluationId: "route-quote-recovery",
      },
    },
    conversation: conversation(),
    message: { id: "message-quote-recovery" },
    route: { id: "route-quote-recovery" },
    payload: { text: "确认，就按这个做" },
  });

  assert.equal(result.orderDraft.id, acceptedOrder.id);
  assert.equal(calls.orderCreates.length, 1);
  assert.equal(calls.quoteUpdates.length, 0);
  assert.equal(calls.fences.length, 0);
  assert.equal(calls.orderCreates[0].options.inboundFence.operationId, "prisma-quote-recovery");
  assert.equal(calls.orderCreates[0].options.inboundFence.recoveryEffect.quoteDraftId, quote.id);
  assert.equal(calls.operationAdvances.length, 0);
  assert.equal(calls.finishes[0][0].orderCreatedNotificationAlreadySent, true);
});

test("Prisma committed quote recovery reads the original order without upserting changed quote values", async () => {
  const acceptedOrder = {
    id: "order-prisma-committed",
    quoteDraftId: "quote-prisma",
    designJobId: "job-quote",
    wechatAccountId: "account-a",
    conversationId: "conversation-a",
    customerId: "customer-a",
    selectedImageId: "new-1",
    quantity: 100,
    unitPrice: 10,
    totalPrice: 1000,
    totalCost: 800,
    profit: 200,
    status: "pending",
    paymentStatus: "unpaid",
  };
  const quote = prismaQuote({
    status: "accepted",
    unitPrice: 99,
    totalPrice: 9900,
    profit: 9100,
    orderDraft: acceptedOrder,
  });
  const { service, calls } = setupPrismaQuoteAcceptance(quote);
  const orderBusinessFingerprint = createOrderDraftBusinessFingerprint(acceptedOrder);
  const result = await service.handlePrismaInboundQuoteAcceptance({
    operationId: "prisma-quote-committed-recovery",
    claimToken: "prisma-quote-committed-owner",
    operationResult: {
      recoveryEffect: {
        kind: "low_value_quote_acceptance",
        phase: "quote_and_order_committed",
        quoteDraftId: quote.id,
        orderDraftId: acceptedOrder.id,
        orderBusinessFingerprint,
        acceptancePlan: {
          ok: true,
          action: "accept_quote_and_create_order",
          reason: "quote_accepted",
          quotePatch: { status: "accepted", paymentStatus: "unpaid" },
        },
        routeEvaluationId: "route-quote-committed-recovery",
      },
    },
    conversation: conversation(),
    message: { id: "message-quote-committed-recovery" },
    route: { id: "route-quote-committed-recovery" },
    payload: { text: "确认" },
  });

  assert.equal(result.orderDraft.id, acceptedOrder.id);
  assert.equal(result.orderDraft.totalPrice, 1000);
  assert.equal(calls.orderCreates.length, 0);
  assert.equal(calls.fences.length, 0);
  assert.equal(calls.finishes[0][0].orderCreatedNotificationAlreadySent, false);
});

test("Prisma payment claim never changes an existing order without server ledger proof", async () => {
  const quote = prismaQuote({
    orderDraft: {
      id: "order-existing",
      status: "pending",
      paymentStatus: "unpaid",
      totalPrice: 1000,
    },
  });
  const { service, calls } = setupPrismaQuoteAcceptance(quote);
  const result = await service.handlePrismaInboundQuoteAcceptance({
    operationId: "prisma-payment-claim",
    claimToken: "prisma-payment-owner",
    conversation: conversation(),
    message: { id: "message-payment-claim" },
    route: { id: "route-payment-claim" },
    payload: { text: "定金已经付了" },
  });

  assert.equal(result.plan.type, "quote_payment_claim_manual_review");
  assert.equal(result.plan.reason, "payment_claim_needs_manual_verification");
  assert.equal(calls.orderCreates.length, 0);
  assert.equal(calls.finishes.length, 0);
  assert.equal(calls.quoteUpdates.length, 1);
  assert.equal(calls.quoteUpdates[0].data.status, "manual_review");
  assert.equal(calls.reviews.length, 1);
});

test("Prisma high-value image selection enters manual review and never auto-progresses", async () => {
  const highValue = designJob({ isHighValue: true, budget: { total: 20000 } });
  const { service, calls } = setup({ initialJob: highValue, currentJob: highValue });
  const result = await service.handlePrismaInboundImageSelection(params());
  assert.equal(result.plan.reason, "high_value_customer_selected_image");
  assert.equal(result.plan.shouldNotifyHuman, true);
  assert.equal(calls.jobUpdates[0].data.status, "manual_review");
  assert.equal(calls.jobUpdates[0].data.manualQcRequired, true);
  assert.ok(calls.reviews.some((item) => item.targetType === "design_job"));
  assert.ok(calls.notifications.some((item) => /高价值客户已选图/.test(item.title)));
});

test("Prisma high-value selection records a fenced recovery marker before post-commit effects and resumes it", async () => {
  const highValue = designJob({ isHighValue: true, budget: { total: 20000 } });
  const recoveryJob = designJob({ ...highValue, status: "manual_review", manualQcRequired: true });
  const { service, calls } = setup({ initialJob: highValue, currentJob: highValue, recoveryJob });
  const operationId = "inbound-prisma-high-value-recovery";
  const claimToken = "prisma-high-value-owner";
  const firstParams = {
    ...params(),
    operationId,
    claimToken,
    operationResult: { messageId: "message-a", routeEvaluationId: "route-a" },
  };
  const originalLock = service.lockConversationForManualReview.bind(service);
  service.lockConversationForManualReview = async () => {
    throw new Error("injected Prisma post-commit effect crash");
  };
  await assert.rejects(
    () => service.handlePrismaInboundImageSelection(firstParams),
    /injected Prisma post-commit effect crash/,
  );
  assert.equal(calls.jobUpdates[0].data.status, "manual_review");
  assert.equal(calls.operationUpdates.length, 1);
  assert.equal(calls.operationUpdates[0].where.id, operationId);
  assert.equal(calls.operationUpdates[0].where.claimToken, claimToken);
  assert.equal(calls.operationUpdates[0].where.status, "processing");
  assert.ok(calls.operationUpdates[0].where.leaseExpiresAt.gt instanceof Date);
  const recoveryEffect = calls.operationUpdates[0].data.result.recoveryEffect;
  assert.equal(recoveryEffect.kind, "high_value_image_selection");
  assert.equal(recoveryEffect.designJobId, highValue.id);
  assert.equal(recoveryEffect.selectedImageId, "new-1");
  assert.equal(calls.reviews.length, 0);
  assert.equal(calls.notifications.length, 0);

  service.lockConversationForManualReview = originalLock;
  const recovered = await service.handlePrismaInboundImageSelection({
    ...firstParams,
    operationResult: { recoveryEffect },
  });
  assert.equal(recovered.plan.reason, "high_value_customer_selected_image");
  assert.equal(recovered.selection.result.source, "durable_recovery");
  assert.equal(recovered.designJob.id, highValue.id);
  assert.equal(recovered.quote, null);
  assert.equal(recovered.sendTask, null);
  assert.equal(calls.reviews.length, 2);
  assert.equal(calls.reviews.filter((item) => item.targetType === "design_job").length, 1);
  assert.equal(calls.notifications.filter((item) => item.metadata?.effectKey?.endsWith(":high-value-selection-notification")).length, 1);
});

test("Prisma selection lease CAS failure performs no business mutation, lock, review or notification", async () => {
  const { service, calls } = setup({ fenceCount: 0 });
  let lockCalls = 0;
  service.lockConversationForManualReview = async () => {
    lockCalls += 1;
    return {};
  };

  await assert.rejects(
    () => service.handlePrismaInboundImageSelection(params()),
    (error) => {
      assert.equal(error.name, "InboundLeaseLostError");
      assert.equal(error.getResponse().code, "INBOUND_LEASE_LOST");
      return true;
    },
  );

  assert.equal(calls.operationUpdates.length, 1);
  assert.equal(calls.jobUpdates.length, 0);
  assert.equal(calls.imageUpdates.length, 0);
  assert.equal(calls.quotes.length, 0);
  assert.equal(calls.reviews.length, 0);
  assert.equal(calls.notifications.length, 0);
  assert.equal(lockCalls, 0);
});

test("Prisma message and route durable writes fence the inbound owner in the same transaction", async () => {
  const { service, calls } = setup({ fenceCount: 0 });
  const fence = {
    operationId: "inbound-stale-owner",
    claimToken: "owner-a",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  await assert.rejects(
    () => service.persistence.createMessage({
      inboundFence: fence,
      conversationId: "conversation-a",
      customerId: "customer-a",
      wechatAccountId: "account-a",
      externalId: "external-a",
      text: "stale write",
    }),
    (error) => error.name === "InboundLeaseLostError",
  );
  await assert.rejects(
    () => service.createPrismaInboundRouteEvaluationOnce(
      fence.operationId,
      fence.claimToken,
      { conversationId: "conversation-a", customerId: "customer-a", text: "stale write" },
    ),
    (error) => error.name === "InboundLeaseLostError",
  );

  assert.equal(calls.messageWrites.length, 0);
  assert.equal(calls.routeWrites.length, 0);
  assert.equal(calls.operationUpdates.length, 2);
});

test("Prisma selection defers quote-acceptance text to the quote acceptance policy", async () => {
  const { service, calls } = setup();
  const result = await service.handlePrismaInboundImageSelection(params({ text: "就这个，确认下单" }));
  assert.equal(result, null);
  assert.equal(calls.imageUpdates.length, 0);
});

test("Prisma selection with mismatched identity fails closed into manual review", async () => {
  const { service, calls } = setup({ initialJob: null, currentJob: null });
  const result = await service.handlePrismaInboundImageSelection(params());
  assert.equal(result.plan.type, "manual_selection_review");
  assert.equal(result.plan.reason, "selection_without_active_design_job");
  assert.equal(result.manualLock.conversation.manualLocked, true);
  assert.equal(calls.imageUpdates.length, 0);
});

test("Prisma selection detects a concurrent latest-revision change before mutation", async () => {
  const initial = designJob();
  const changed = designJob({
    revisionCount: 2,
    images: [...initial.images, candidate("newer-1", "r2-1", 201)],
    revisions: [...initial.revisions, { id: "revision-2", revisionNumber: 2, status: "completed", resultImageIds: ["r2-1"] }],
  });
  const { service, calls } = setup({ initialJob: initial, currentJob: changed });
  const result = await service.handlePrismaInboundImageSelection(params());
  assert.equal(result.plan.type, "manual_selection_review");
  assert.equal(result.plan.reason, "selection_revision_changed_before_commit");
  assert.equal(calls.imageUpdates.length, 0);
});
