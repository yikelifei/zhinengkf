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
const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { PrismaOperationsService } = require("../apps/api/src/prisma/prisma-operations.service");
const { TrainingService } = require("../apps/api/src/training/training.service");
const { WechatPersistence } = require("../apps/api/src/wechat/wechat-persistence");
const { appConfig } = require("../apps/api/src/shared/app-config");
const {
  createChatImportOperationFingerprint,
  deterministicOperationId,
  normalizeOperationKey,
  requestOperationMetadata,
} = require("../apps/api/src/shared/operation-idempotency");
const {
  completeClientOperation,
  reserveClientOperation,
} = require("../apps/web/src/lib/client-operation-key");

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

function mutateStore(store, mutate) {
  const data = JSON.parse(fs.readFileSync(store.filePath, "utf8"));
  mutate(data);
  fs.writeFileSync(store.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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
    mutateStore(store, (data) => { data.conversations = []; });
    assert.equal((await service.create(designPayload())).id, replay.id);
    mutateStore(store, (data) => {
      data.conversations = [{
        id: "conversation-1",
        customerId: "customer-2",
        wechatAccountId: "wechat-1",
        channel: "personal_wechat",
        title: "Rebound customer",
      }];
    });
    assert.equal((await service.create(designPayload())).id, replay.id);
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

test("LocalStore design create resumes interrupted effects without duplicate notifications or reviews", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const { store, tempDir } = createStore();
  const originalNotification = store.createNotification.bind(store);
  const originalReviewLog = store.createReviewLog.bind(store);
  let failHandoffNotificationAfterCommit = true;
  let failReviewAfterCommit = true;
  let manualLockAttempts = 0;
  store.createNotification = (level, title, body, target) => {
    const record = originalNotification(level, title, body, target);
    if (String(target?.effectKey || "").endsWith(":handoff-notification") && failHandoffNotificationAfterCommit) {
      failHandoffNotificationAfterCommit = false;
      throw new Error("simulated response loss after notification commit");
    }
    return record;
  };
  store.createReviewLog = (payload) => {
    const record = originalReviewLog(payload);
    if (String(payload?.metadata?.effectKey || "").endsWith(":handoff-review") && failReviewAfterCommit) {
      failReviewAfterCommit = false;
      throw new Error("simulated response loss after review commit");
    }
    return record;
  };
  const service = new DesignJobsService(
    {},
    {},
    store,
    { create: (...args) => store.createNotification(...args) },
    {},
    {
      setConversationManualLock: async () => {
        manualLockAttempts += 1;
        if (manualLockAttempts === 1) throw new Error("simulated manual lock interruption");
        return { blockedSendTasks: [{ id: "send-1" }], inFlightSendTasks: [] };
      },
    },
    {},
    {},
    {},
  );
  const payload = designPayload({
    budget: { mode: "per_box", perUnitAmount: 2000, quantity: 10, totalAmount: 20000 },
  });
  try {
    appConfig.useLocalStore = true;
    await assert.rejects(service.create(payload), /manual lock interruption/);
    await assert.rejects(service.create(payload), /notification commit/);
    await assert.rejects(service.create(payload), /review commit/);
    const recovered = await service.create(payload);
    const responseLostReplay = await service.create(payload);

    assert.equal(responseLostReplay.id, recovered.id);
    assert.equal(manualLockAttempts, 2);
    assert.ok(recovered.requirements.createEffects.completedAt);
    const notifications = store.listNotifications({ limit: 100 });
    const notificationEffectKeys = notifications.map((item) => item.target.effectKey).filter(Boolean);
    assert.equal(notificationEffectKeys.length, new Set(notificationEffectKeys).size);
    assert.equal(notificationEffectKeys.filter((key) => key.endsWith(":handoff-notification")).length, 1);
    const designReviews = store.listReviewLogs(100).filter((item) => item.targetType === "design_job");
    assert.equal(designReviews.filter((item) => String(item.metadata?.effectKey || "").endsWith(":handoff-review")).length, 1);
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
    mutateStore(store, (data) => { data.conversations = []; });
    assert.equal(training.importChat(payload).id, first.id);
    mutateStore(store, (data) => {
      data.conversations = [{
        id: "conversation-1",
        customerId: "customer-2",
        wechatAccountId: "wechat-1",
        channel: "personal_wechat",
      }];
    });
    assert.equal(training.importChat(payload).id, first.id);
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
  let conversation = { id: "conversation-1", customerId: "customer-1", wechatAccountId: "wechat-1" };
  let conversationLookups = 0;
  let createCalls = 0;
  const prisma = {
    conversation: {
      findUnique: async () => {
        conversationLookups += 1;
        return conversation;
      },
    },
    designJob: {
      findUnique: async ({ where }) => (
        (where.requestId && stored?.requestId === where.requestId)
        || (where.id && stored?.id === where.id)
          ? stored
          : null
      ),
      create: async ({ data }) => {
        createCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (stored) throw Object.assign(new Error("unique requestId"), { code: "P2002" });
        stored = { id: "design-prisma-1", ...data };
        return stored;
      },
      update: async ({ where, data }) => {
        assert.equal(where.id, stored.id);
        stored = { ...stored, ...data };
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
    const lookupsAfterCreate = conversationLookups;
    conversation = null;
    assert.equal((await service.create(designPayload())).id, first.id);
    assert.equal(conversationLookups, lookupsAfterCreate);
    conversation = { id: "conversation-1", customerId: "customer-2", wechatAccountId: "wechat-1" };
    assert.equal((await service.create(designPayload())).id, first.id);
    assert.equal(conversationLookups, lookupsAfterCreate);
    await assert.rejects(
      service.create(designPayload({ customerId: "customer-2" })),
      /already used with different identity or payload/,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("Prisma P2002 winner replay completes interrupted high-value effects exactly once", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  let stored = null;
  let createCalls = 0;
  let manualLockCalls = 0;
  let failReviewAfterCommit = true;
  const notificationsById = new Map();
  const reviewsById = new Map();
  const prisma = {
    conversation: {
      findUnique: async () => ({ id: "conversation-1", customerId: "customer-1", wechatAccountId: "wechat-1" }),
    },
    designJob: {
      findUnique: async ({ where }) => (
        (where.requestId && stored?.requestId === where.requestId)
        || (where.id && stored?.id === where.id)
          ? stored
          : null
      ),
      create: async ({ data }) => {
        createCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (stored) throw Object.assign(new Error("unique requestId"), { code: "P2002" });
        stored = { id: "design-prisma-effects", ...data };
        return stored;
      },
      update: async ({ where, data }) => {
        assert.equal(where.id, stored.id);
        stored = { ...stored, ...data };
        return stored;
      },
    },
    notification: {
      findUnique: async ({ where }) => notificationsById.get(where.id) || null,
      create: async ({ data }) => {
        if (notificationsById.has(data.id)) throw Object.assign(new Error("duplicate notification"), { code: "P2002" });
        const record = { ...data };
        notificationsById.set(data.id, record);
        return record;
      },
    },
    reviewLog: {
      findUnique: async ({ where }) => reviewsById.get(where.id) || null,
      create: async ({ data }) => {
        if (reviewsById.has(data.id)) throw Object.assign(new Error("duplicate review"), { code: "P2002" });
        const record = { ...data };
        reviewsById.set(data.id, record);
        if (failReviewAfterCommit) {
          failReviewAfterCommit = false;
          throw new Error("simulated response loss after prisma review commit");
        }
        return record;
      },
    },
  };
  const service = new DesignJobsService(
    prisma,
    {},
    {},
    new NotificationsService(prisma, {}),
    {},
    {
      setConversationManualLock: async () => {
        manualLockCalls += 1;
        return { blockedSendTasks: [], inFlightSendTasks: [] };
      },
    },
    {},
    {},
    {},
  );
  const payload = designPayload({
    budget: { mode: "per_box", perUnitAmount: 2000, quantity: 10, totalAmount: 20000 },
  });
  try {
    appConfig.useLocalStore = false;
    const outcomes = await Promise.allSettled([service.create(payload), service.create(payload)]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
    assert.equal(createCalls, 2);
    assert.equal(manualLockCalls, 1);
    assert.equal(reviewsById.size, 1);
    assert.equal(notificationsById.size, new Set(notificationsById.keys()).size);
    assert.ok(stored.requirements.createEffects.completedAt);

    const replay = await service.create(payload);
    assert.equal(replay.id, stored.id);
    assert.equal(manualLockCalls, 1);
    assert.equal(reviewsById.size, 1);
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

test("Web create callers retain one operation key until the exact action succeeds", () => {
  const api = fs.readFileSync(path.resolve(__dirname, "../apps/web/src/lib/api.ts"), "utf8");
  const page = fs.readFileSync(
    path.resolve(__dirname, "../apps/web/src/features/training/training-import-page.tsx"),
    "utf8",
  );

  assert.match(api, /function postJsonWithNetworkRetry/);
  assert.match(api, /const serializedBody = JSON\.stringify\(body\)/);
  assert.match(api, /operationKey: string,/);
  assert.doesNotMatch(api, /operationKey = createClientOperationKey\("design-job"\)/);
  assert.match(api, /postJsonWithNetworkRetry<ChatImport>\("\/training\/chat-imports", payload\)/);
  assert.match(page, /pendingImportOperation = useRef<PendingClientOperation \| null>\(null\)/);
  assert.match(page, /reserveClientOperation\("training-import", requestPayload, pendingImportOperation\.current\)/);
  assert.match(page, /operationKey: operation\.key/);
  assert.match(page, /completeClientOperation\(pendingImportOperation\.current, operation\.key\)/);
});

test("Prisma chat import replays stored identity after conversation deletion and rejects wrong identity", async () => {
  const payload = {
    operationKey: TRAINING_KEY,
    conversationId: "conversation-1",
    customerId: "customer-1",
    wechatAccountId: "wechat-1",
    name: "parcel training",
    text: "normalized transcript",
  };
  const storedIdentity = {
    conversationId: "conversation-1",
    customerId: "customer-1",
    wechatAccountId: "wechat-1",
  };
  const operation = requestOperationMetadata(
    TRAINING_KEY,
    createChatImportOperationFingerprint(payload, storedIdentity),
  );
  const record = {
    id: deterministicOperationId("import", TRAINING_KEY),
    ...storedIdentity,
    identityBinding: { status: "passed", ...storedIdentity, requestOperation: operation },
    samples: [],
  };
  let conversationLookups = 0;
  const tx = {
    chatImport: { findUnique: async () => record },
    conversation: {
      findUnique: async () => {
        conversationLookups += 1;
        return null;
      },
    },
  };
  const operations = new PrismaOperationsService({ $transaction: async (callback) => callback(tx) });

  assert.equal((await operations.createChatImport(payload, parsedTranscript)).id, record.id);
  assert.equal(conversationLookups, 0);
  await assert.rejects(
    operations.createChatImport({ ...payload, customerId: "customer-2" }, parsedTranscript),
    /already used with different identity or payload/,
  );
  await assert.rejects(
    operations.createChatImport({ ...payload, conversationId: "conversation-2" }, parsedTranscript),
    /already used with different identity or payload/,
  );
  assert.equal(conversationLookups, 0);
});

test("client operation reservation reuses an unconfirmed form key and rotates only on mutation or success", () => {
  const payload = {
    conversationId: "conversation-1",
    customerId: "customer-1",
    wechatAccountId: "wechat-1",
    text: "same transcript",
  };
  const first = reserveClientOperation("training-import", payload, null);
  const afterTwoLostNetworkResponses = reserveClientOperation(
    "training-import",
    { text: "same transcript", wechatAccountId: "wechat-1", customerId: "customer-1", conversationId: "conversation-1" },
    first,
  );
  assert.equal(afterTwoLostNetworkResponses.key, first.key);
  assert.equal(completeClientOperation(first, "different-key"), first);

  const changedText = reserveClientOperation("training-import", { ...payload, text: "changed transcript" }, first);
  assert.notEqual(changedText.key, first.key);
  const changedIdentity = reserveClientOperation("training-import", { ...payload, customerId: "customer-2" }, first);
  assert.notEqual(changedIdentity.key, first.key);
  assert.equal(completeClientOperation(first, first.key), null);
  const afterSuccess = reserveClientOperation("training-import", payload, null);
  assert.notEqual(afterSuccess.key, first.key);
});

test("LocalStore send task replay survives conversation deletion and rejects guard context drift", () => {
  const { store, tempDir } = createStore();
  const operationKey = "manual-reply:33333333-3333-4333-8333-333333333333";
  const payload = {
    operationKey,
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    payload: { kind: "text", text: "hello" },
    guardSnapshot: {
      policy: "safe-send-queue",
      reason: "manual-agent-reply",
      manualReply: true,
      queuedBy: "operator-1",
      requiredChecks: ["identityBinding"],
    },
  };
  try {
    const first = store.createSendTask(payload);
    mutateStore(store, (data) => {
      data.conversations = data.conversations.filter((item) => item.id !== "conversation-1");
    });
    assert.equal(store.createSendTask(payload).id, first.id);
    assert.throws(
      () => store.createSendTask({
        ...payload,
        guardSnapshot: { ...payload.guardSnapshot, reason: "changed-reason" },
      }),
      /already used with different identity or payload/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("LocalStore inbound externalId is account-scoped and rejects content, attachment and conversation drift", () => {
  const { store, tempDir } = createStore();
  const payload = {
    conversationId: "conversation-1",
    customerId: "customer-1",
    wechatAccountId: "wechat-1",
    direction: "inbound",
    text: "same inbound",
    externalId: "external-message-1",
    attachments: [{ type: "image", mediaId: "media-1" }],
    metadata: { assetIds: ["asset-1"] },
  };
  try {
    const first = store.createMessage(payload);
    const replay = store.createMessage(payload);
    assert.equal(replay.id, first.id);
    assert.equal(replay.deduplicated, true);
    assert.throws(
      () => store.createMessage({ ...payload, text: "changed inbound" }),
      /already used with different identity or payload/,
    );
    assert.throws(
      () => store.createMessage({ ...payload, attachments: [{ type: "image", mediaId: "media-2" }] }),
      /already used with different identity or payload/,
    );
    assert.throws(
      () => store.createMessage({
        ...payload,
        conversationId: "conversation-2",
        customerId: "customer-2",
      }),
      /already used with different identity or payload/,
    );
    const data = JSON.parse(fs.readFileSync(store.filePath, "utf8"));
    assert.equal(data.messages.filter((item) => item.externalId === payload.externalId).length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Prisma send task concurrent create returns the P2002 winner", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  let stored = null;
  let initialReads = 0;
  const conversation = { id: "conversation-1", customerId: "customer-1", wechatAccountId: "wechat-1" };
  const prisma = {
    conversation: { findUnique: async () => conversation },
    quoteDraft: { findMany: async () => [] },
    wechatSendTask: {
      findUnique: async () => {
        initialReads += 1;
        return initialReads <= 2 ? null : stored;
      },
      create: async ({ data }) => {
        await Promise.resolve();
        if (stored) throw Object.assign(new Error("unique"), { code: "P2002" });
        stored = { ...data, conversation, attempts: [], wechatAccount: {}, designJob: null };
        return stored;
      },
    },
  };
  const persistence = new WechatPersistence(prisma, {});
  const payload = {
    operationKey: "order-send:44444444-4444-4444-8444-444444444444",
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    payload: { kind: "text", text: "confirmation" },
    guardSnapshot: { reason: "order-confirmation", orderContext: { orderDraftId: "order-1" } },
  };
  try {
    appConfig.useLocalStore = false;
    const [first, replay] = await Promise.all([
      persistence.createSendTask(payload),
      persistence.createSendTask(payload),
    ]);
    assert.equal(first.id, replay.id);
    await assert.rejects(
      persistence.createSendTask({
        ...payload,
        guardSnapshot: { ...payload.guardSnapshot, orderContext: { orderDraftId: "order-2" } },
      }),
      /already used with different identity or payload/,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("Prisma inbound concurrent cross-conversation externalId creates one account-scoped message", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const conversations = {
    "conversation-1": { id: "conversation-1", customerId: "customer-1", wechatAccountId: "wechat-1" },
    "conversation-2": { id: "conversation-2", customerId: "customer-2", wechatAccountId: "wechat-1" },
  };
  let stored = null;
  let findCount = 0;
  let releaseFind;
  const bothLookups = new Promise((resolve) => { releaseFind = resolve; });
  const tx = {
    conversation: {
      findUnique: async ({ where }) => conversations[where.id] || null,
      update: async () => ({}),
    },
    message: {
      findFirst: async () => {
        findCount += 1;
        if (findCount === 2) releaseFind();
        await bothLookups;
        return null;
      },
      create: async ({ data }) => {
        await Promise.resolve();
        if (stored) throw Object.assign(new Error("unique"), { code: "P2002" });
        stored = { ...data, conversation: conversations[data.conversationId] };
        return stored;
      },
    },
  };
  const prisma = {
    $transaction: async (callback) => callback(tx),
    conversation: { findUnique: async ({ where }) => conversations[where.id] || null },
    message: { findUnique: async () => stored },
  };
  const persistence = new WechatPersistence(prisma, {});
  const base = {
    wechatAccountId: "wechat-1",
    direction: "inbound",
    text: "same body",
    externalId: "account-global-external-1",
    attachments: [{ type: "image", mediaId: "media-1" }],
    metadata: { assetIds: ["asset-1"] },
  };
  try {
    appConfig.useLocalStore = false;
    const outcomes = await Promise.allSettled([
      persistence.createMessage({ ...base, conversationId: "conversation-1", customerId: "customer-1" }),
      persistence.createMessage({ ...base, conversationId: "conversation-2", customerId: "customer-2" }),
    ]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
    assert.match(String(outcomes.find((item) => item.status === "rejected").reason), /already used with different identity or payload/);
    assert.equal(stored.externalId, base.externalId);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("browser send callers reserve sticky keys and clear them only after success", () => {
  const files = [
    "../apps/web/src/features/conversations/use-conversations-controller.ts",
    "../apps/web/src/features/sales/sales-quote-action-page.tsx",
    "../apps/web/src/features/sales/sales-order-message-page.tsx",
    "../apps/web/src/features/reviews/review-design-page.tsx",
    "../apps/web/src/features/reviews/review-quotes-page.tsx",
    "../apps/web/src/features/reviews/review-orders-page.tsx",
  ].map((file) => fs.readFileSync(path.resolve(__dirname, file), "utf8"));
  for (const source of files) {
    assert.match(source, /reserveClientOperation\(/);
    assert.match(source, /completeClientOperation\(/);
    assert.match(source, /operation\.key/);
  }
});
