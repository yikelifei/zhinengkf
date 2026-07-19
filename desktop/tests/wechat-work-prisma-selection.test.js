"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
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
  const calls = { jobQueries: [], jobUpdates: [], imageUpdates: [], quotes: [], reviews: [], notifications: [] };
  const tx = {
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
    conversation: conversation(conversationPatch),
    message: { id: "message-a" },
    route: { id: "route-a" },
    payload,
  };
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
