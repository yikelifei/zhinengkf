"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { PrismaOperationsService } = require("../apps/api/src/prisma/prisma-operations.service");
const { TrainingService } = require("../apps/api/src/training/training.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const {
  normalizeOperationKey,
} = require("../apps/api/src/shared/operation-idempotency");

const DESIGN_KEY = "design-job:11111111-1111-4111-8111-111111111111";
const TRAINING_KEY = "training-import:22222222-2222-4222-8222-222222222222";

function emptyStoreData(overrides = {}) {
  return {
    wechatAccounts: [],
    customers: [],
    conversations: [],
    messages: [],
    wechatWindowSnapshots: [],
    skus: [],
    skuChangeLogs: [],
    designAssets: [],
    designJobs: [],
    designImages: [],
    designRevisions: [],
    designPlatformExecutions: [],
    notifications: [],
    sendTasks: [],
    sendAttempts: [],
    quoteDrafts: [],
    orderDrafts: [],
    reviewLogs: [],
    agents: [{ id: "agent-general", key: "general", name: "General" }],
    agentSkills: [],
    chatImports: [],
    trainingSamples: [],
    knowledgeEntries: [],
    routeEvaluations: [],
    automationRuns: [],
    ...overrides,
  };
}

function createStore(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "request-idempotency-"));
  const store = new LocalStoreService();
  store.filePath = path.join(tempDir, "local-store.json");
  const conversation = {
    id: "conversation-1",
    customerId: "customer-1",
    wechatAccountId: "wechat-1",
    channel: "personal_wechat",
    title: "Customer",
  };
  const otherConversation = {
    id: "conversation-2",
    customerId: "customer-2",
    wechatAccountId: "wechat-1",
    channel: "personal_wechat",
    title: "Other customer",
  };
  fs.writeFileSync(
    store.filePath,
    `${JSON.stringify(emptyStoreData({
      wechatAccounts: [{ id: "wechat-1", name: "Wechat" }],
      customers: [{ id: "customer-1", name: "Customer" }, { id: "customer-2", name: "Other customer" }],
      conversations: [conversation, otherConversation],
      ...overrides,
    }), null, 2)}\n`,
    "utf8",
  );
  return { store, tempDir };
}

function designPayload(overrides = {}) {
  return {
    operationKey: DESIGN_KEY,
    customerId: "customer-1",
    conversationId: "conversation-1",
    wechatAccountId: "wechat-1",
    budget: { mode: "per_box", perUnitAmount: 100, quantity: 10, totalAmount: 1000 },
    scene: "employee gift",
    bundle: { items: [{ skuCode: "SKU-1", name: "Gift" }] },
    assets: [],
    assetIds: [],
    customerText: "Please create a gift design.",
    designType: "bundle_render",
    outputCount: 6,
    ...overrides,
  };
}

const parsedTranscript = {
  messageCount: 2,
  pairCount: 1,
  warnings: [],
  pairs: [
    {
      question: "Where is my parcel?",
      answer: "I will check the latest tracking status.",
      scene: "logistics",
      agentKey: "general",
      score: 90,
    },
  ],
};

test("operationKey contract requires an explicit bounded portable key", () => {
  assert.equal(normalizeOperationKey(DESIGN_KEY), DESIGN_KEY);
  assert.throws(() => normalizeOperationKey(undefined), /operationKey is required/);
  assert.throws(() => normalizeOperationKey("too-short"), /length must be between 16 and 128/);
  assert.throws(() => normalizeOperationKey(` ${DESIGN_KEY}`), /leading or trailing whitespace/);
  assert.throws(() => normalizeOperationKey(`${DESIGN_KEY}/other`), /may only contain/);
  assert.throws(() => normalizeOperationKey("x".repeat(129)), /length must be between 16 and 128/);
});

test("LocalStore design create replays after a lost response and rejects key reuse with changed payload", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const { store, tempDir } = createStore();
  let notificationCount = 0;
  const service = new DesignJobsService(
    {},
    {},
    store,
    { create: async () => { notificationCount += 1; } },
    {},
    {},
    {},
    {},
    {},
  );
  try {
    appConfig.useLocalStore = true;
    await service.create(designPayload()); // Simulate a committed response that the caller never receives.
    const replay = await service.create(designPayload());

    assert.equal(replay.requestId, DESIGN_KEY);
    assert.equal(store.listDesignJobs().length, 1);
    assert.equal(notificationCount, 1);
    await assert.rejects(
      service.create(designPayload({ customerText: "Changed request under the same key." })),
      /already used with different identity or payload/,
    );
    await assert.rejects(
      service.create(designPayload({ customerId: "customer-2", conversationId: "conversation-2" })),
      /already used with different identity or payload/,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("concurrent LocalStore chat imports create one import, sample and knowledge row", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const { store, tempDir } = createStore();
  const training = new TrainingService(store, {}, {});
  const payload = {
    operationKey: TRAINING_KEY,
    conversationId: "conversation-1",
    customerId: "customer-1",
    wechatAccountId: "wechat-1",
    name: "parcel training",
    text: "客户：快递到哪里了？\n客服：我帮您核对最新物流进度。",
  };
  try {
    appConfig.useLocalStore = true;
    const [first, replay] = await Promise.all([
      Promise.resolve(training.importChat(payload)),
      Promise.resolve(training.importChat(payload)),
    ]);

    assert.equal(first.id, replay.id);
    assert.equal(store.listChatImports().length, 1);
    assert.equal(store.listTrainingSamples().length, 1);
    assert.equal(store.listKnowledgeEntries().length, 1);
    assert.throws(
      () => training.importChat({ ...payload, text: `${payload.text}\n客户：changed` }),
      /already used with different identity or payload/,
    );
    assert.throws(
      () => training.importChat({ ...payload, customerId: "customer-2", conversationId: "conversation-2" }),
      /already used with different identity or payload/,
    );
    assert.throws(
      () => training.importChat({ ...payload, operationKey: "bad" }),
      /length must be between 16 and 128/,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("concurrent Prisma design create relies on unique requestId and returns the winning job", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  let stored = null;
  let createCalls = 0;
  const prisma = {
    conversation: {
      findUnique: async () => ({ id: "conversation-1", customerId: "customer-1", wechatAccountId: "wechat-1" }),
    },
    designJob: {
      findUnique: async ({ where }) => (where.requestId && stored?.requestId === where.requestId ? stored : null),
      create: async ({ data }) => {
        createCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (stored) throw Object.assign(new Error("unique requestId"), { code: "P2002" });
        stored = { id: "design-prisma-1", ...data };
        return stored;
      },
    },
  };
  const service = new DesignJobsService(prisma, {}, {}, { create: async () => ({}) }, {}, {}, {}, {}, {});
  try {
    appConfig.useLocalStore = false;
    const [first, replay] = await Promise.all([
      service.create(designPayload()),
      service.create(designPayload()),
    ]);

    assert.equal(first.id, "design-prisma-1");
    assert.equal(replay.id, first.id);
    assert.equal(stored.requestId, DESIGN_KEY);
    assert.equal(createCalls, 2);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("concurrent Prisma chat imports wait for the unique import claim and replay committed samples", async () => {
  let committedRecord = null;
  let pendingRecord = null;
  let pendingSamples = [];
  let pendingKnowledge = [];
  let commitPromise = null;
  let resolveCommit = null;
  let importCreateCalls = 0;

  const tx = {
    chatImport: {
      findUnique: async () => committedRecord
        ? { ...committedRecord, samples: [...committedRecord.samples] }
        : null,
      create: async ({ data }) => {
        importCreateCalls += 1;
        if (pendingRecord) {
          await commitPromise;
          throw Object.assign(new Error("unique import id"), { code: "P2002" });
        }
        pendingRecord = { ...data, sceneSummary: null };
        commitPromise = new Promise((resolve) => { resolveCommit = resolve; });
        return pendingRecord;
      },
      update: async ({ data }) => {
        pendingRecord = { ...pendingRecord, ...data };
        return pendingRecord;
      },
    },
    customerServiceAgent: {
      findUnique: async ({ where }) => ({ id: "agent-general", key: where.key || "general", name: "General" }),
    },
    trainingSample: {
      create: async ({ data }) => {
        const sample = { ...data };
        pendingSamples.push(sample);
        return sample;
      },
    },
    knowledgeEntry: {
      create: async ({ data }) => {
        pendingKnowledge.push({ ...data });
        return data;
      },
    },
  };
  const prisma = {
    ...tx,
    $transaction: async (callback) => {
      try {
        const result = await callback(tx);
        if (!committedRecord && pendingRecord) {
          committedRecord = { ...pendingRecord, samples: [...pendingSamples] };
          resolveCommit();
        }
        return result;
      } catch (error) {
        throw error;
      }
    },
  };
  const operations = new PrismaOperationsService(prisma);
  const payload = { operationKey: TRAINING_KEY, name: "parcel training", text: "normalized transcript" };

  const [first, replay] = await Promise.all([
    operations.createChatImport(payload, parsedTranscript),
    operations.createChatImport(payload, parsedTranscript),
  ]);

  assert.equal(first.id, replay.id);
  assert.equal(replay.samples.length, 1);
  assert.equal(importCreateCalls, 2);
  assert.equal(pendingSamples.length, 1);
  assert.equal(pendingKnowledge.length, 1);
  await assert.rejects(
    operations.createChatImport({ ...payload, text: "changed transcript" }, parsedTranscript),
    /already used with different identity or payload/,
  );
});

test("Web create callers generate one operation key per action and retry the serialized request unchanged", () => {
  const api = fs.readFileSync(path.resolve(__dirname, "../apps/web/src/lib/api.ts"), "utf8");
  const page = fs.readFileSync(
    path.resolve(__dirname, "../apps/web/src/features/training/training-import-page.tsx"),
    "utf8",
  );

  assert.match(api, /function postJsonWithNetworkRetry/);
  assert.match(api, /const serializedBody = JSON\.stringify\(body\)/);
  assert.match(api, /operationKey = createClientOperationKey\("design-job"\)/);
  assert.match(api, /postJsonWithNetworkRetry<ChatImport>\("\/training\/chat-imports", payload\)/);
  assert.match(page, /const operationKey = createClientOperationKey\("training-import"\)/);
  assert.match(page, /operationKey,/);
});
