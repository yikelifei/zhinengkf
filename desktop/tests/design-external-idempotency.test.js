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
const { appConfig } = require("../apps/api/src/shared/app-config");

const SUBMIT_KEY = "design-submit:11111111-1111-4111-8111-111111111111";
const REVISION_KEY = "design-revision:22222222-2222-4222-8222-222222222222";

function emptyStoreData(job) {
  return {
    wechatAccounts: [{ id: "wechat-1", name: "Wechat" }],
    customers: [{ id: "customer-1", name: "Customer" }],
    conversations: [{
      id: "conversation-1",
      customerId: "customer-1",
      wechatAccountId: "wechat-1",
      channel: "personal_wechat",
      title: "Customer",
      manualLocked: false,
    }],
    messages: [],
    wechatWindowSnapshots: [],
    skus: [],
    skuChangeLogs: [],
    designAssets: [],
    designJobs: [job],
    designImages: [],
    designRevisions: [],
    designPlatformExecutions: [],
    notifications: [],
    sendTasks: [],
    sendAttempts: [],
    quoteDrafts: [],
    orderDrafts: [],
    reviewLogs: [],
    agents: [],
    agentSkills: [],
    chatImports: [],
    trainingSamples: [],
    knowledgeEntries: [],
    routeEvaluations: [],
    automationRuns: [],
    wechatWorkBindings: [],
    wechatWorkAuditLogs: [],
    wechatWorkSyncCursors: [],
    personalWechatRpaBindings: [],
    personalWechatRpaAuditLogs: [],
  };
}

function makeJob(id = "design-1") {
  const now = new Date().toISOString();
  return {
    id,
    requestId: `design-create:${id}:1111111111111111`,
    externalJobId: null,
    status: "draft",
    designType: "bundle_render",
    renderStyle: "真实产品摆拍",
    outputCount: 6,
    budget: { mode: "per_box", totalAmount: 1000, quantity: 10 },
    bundle: { items: [{ skuCode: "SKU-1", name: "Gift" }] },
    requirements: { useRealSkuImages: false },
    customerText: "Please prepare a design.",
    scene: "employee gift",
    isHighValue: false,
    manualQcRequired: true,
    retryCount: 0,
    revisionCount: 0,
    revisionPolicy: null,
    errorMessage: "",
    waitMessageSentAt: null,
    submittedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    customerId: "customer-1",
    conversationId: "conversation-1",
    wechatAccountId: "wechat-1",
    orderId: null,
    assetIds: [],
  };
}

function createFixture({ createDesignJob, cancelDesignJob, storage = {}, failWaitResponseOnce = false } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "design-external-idempotency-"));
  const store = new LocalStoreService();
  store.filePath = path.join(tempDir, "local-store.json");
  fs.writeFileSync(store.filePath, `${JSON.stringify(emptyStoreData(makeJob()), null, 2)}\n`, "utf8");
  const externalPayloads = [];
  const sendTasks = new Map();
  let loseWaitResponse = failWaitResponseOnce;
  const designPlatform = {
    createDesignJob: async (payload) => {
      externalPayloads.push(payload);
      if (createDesignJob) return createDesignJob(payload, externalPayloads.length);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { externalJobId: `external-${payload.requestId}` };
    },
    cancelDesignJob: async (externalJobId) => cancelDesignJob ? cancelDesignJob(externalJobId) : { externalJobId, status: "cancelled" },
  };
  const service = new DesignJobsService(
    {},
    designPlatform,
    store,
    { create: (...args) => store.createNotification(...args) },
    storage,
    {
      enqueueTextMessage: async (payload) => {
        const existing = sendTasks.get(payload.operationKey);
        if (existing) return existing;
        const task = { id: `send-${sendTasks.size + 1}`, ...payload };
        sendTasks.set(payload.operationKey, task);
        if (loseWaitResponse) {
          loseWaitResponse = false;
          throw new Error("simulated response loss after send task commit");
        }
        return task;
      },
    },
    {},
    {},
    {},
  );
  service.assertDesignPlatformPreflight = async () => ({ ok: true });
  service.buildDesignPlatformPayload = async (job, revision, requestIdOverride) => ({
    requestId: requestIdOverride || job.requestId,
    customerId: job.customerId,
    conversationId: job.conversationId,
    wechatAccountId: job.wechatAccountId,
    budget: job.budget,
    bundle: job.bundle,
    assets: [],
    outputCount: job.outputCount,
    renderStyle: job.renderStyle,
    requirements: job.requirements,
    callback: {
      url: "http://127.0.0.1/callback",
      method: "POST",
      events: ["completed", "failed"],
      requestId: requestIdOverride || job.requestId,
      fallbackPolling: true,
    },
    revision: revision ? { revisionId: revision.id, instruction: revision.instruction } : null,
  });
  service.scheduleResultPoll = () => undefined;
  return { service, store, tempDir, externalPayloads, sendTasks };
}

async function withLocalStandard(run) {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.useLocalStore = true;
  appConfig.designPlatformAdapter = "standard_v1";
  try {
    await run();
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.designPlatformAdapter = previousAdapter;
  }
}

function expectedIdentity(operationKey) {
  return {
    operationKey,
    expectedWechatAccountId: "wechat-1",
    expectedConversationId: "conversation-1",
    expectedCustomerId: "customer-1",
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function completedCallback(externalJobId = "external-callback-1") {
  return {
    requestId: "design-create:design-1:1111111111111111",
    externalJobId,
    status: "completed",
    images: [{
      imageId: "candidate_1",
      downloadUrl: "https://design.example.test/candidate_1.png",
      width: 1024,
      height: 1024,
    }],
  };
}

function failedCallback(externalJobId = "external-callback-1") {
  return {
    requestId: "design-create:design-1:1111111111111111",
    externalJobId,
    status: "failed",
    images: [],
    errorMessage: "generator rejected the request",
  };
}

function callbackStorage(tempDir, gate) {
  let saveCount = 0;
  const started = deferred();
  return {
    storage: {
      saveDesignImage: async (designJobId, imageId) => {
        saveCount += 1;
        started.resolve();
        if (gate) await gate.promise;
        const directory = path.join(tempDir, "design-jobs", designJobId);
        fs.mkdirSync(directory, { recursive: true });
        const filePath = path.join(directory, `${imageId}.png`);
        fs.writeFileSync(
          filePath,
          Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC", "base64"),
        );
        return filePath;
      },
    },
    saveCount: () => saveCount,
    started: started.promise,
  };
}

test("submit keeps one external request and one wait task across concurrent and response-lost replay", async () => {
  await withLocalStandard(async () => {
    const fixture = createFixture({ failWaitResponseOnce: true });
    try {
      const first = fixture.service.submit("design-1", expectedIdentity(SUBMIT_KEY));
      const concurrent = fixture.service.submit("design-1", expectedIdentity(SUBMIT_KEY));
      const outcomes = await Promise.allSettled([first, concurrent]);
      assert.equal(outcomes.every((item) => item.status === "rejected"), true);

      const replay = await fixture.service.submit("design-1", expectedIdentity(SUBMIT_KEY));
      assert.equal(replay.submitDispatchStatus, "accepted");
      assert.equal(fixture.externalPayloads.length, 1);
      assert.equal(fixture.externalPayloads[0].requestId, replay.requestId);
      assert.equal(fixture.sendTasks.size, 1);
      assert.equal(fixture.store.listDesignJobs().length, 1);

      fixture.store.updateDesignJob("design-1", { scene: "changed intent" });
      await assert.rejects(
        fixture.service.submit("design-1", expectedIdentity(SUBMIT_KEY)),
        /already used with different identity or payload/,
      );
    } finally {
      fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
  });
});

test("uncertain standard_v1 acceptance is persisted and same-key replay fails closed without another POST", async () => {
  await withLocalStandard(async () => {
    const fixture = createFixture({
      createDesignJob: async () => {
        throw Object.assign(new Error("socket timed out after upstream acceptance"), { code: "ETIMEDOUT" });
      },
    });
    try {
      const assertUnknown = (error) => {
        assert.equal(error.getResponse().code, "DESIGN_DISPATCH_OUTCOME_UNKNOWN");
        return true;
      };
      await assert.rejects(fixture.service.submit("design-1", expectedIdentity(SUBMIT_KEY)), assertUnknown);
      await assert.rejects(fixture.service.submit("design-1", expectedIdentity(SUBMIT_KEY)), assertUnknown);
      assert.equal(fixture.externalPayloads.length, 1);
      assert.equal(fixture.store.getDesignJob("design-1").submitDispatchStatus, "outcome_unknown");
      assert.equal(fixture.sendTasks.size, 0);
    } finally {
      fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
  });
});

test("revision concurrency allocates one number, one stable requestId and one wait task", async () => {
  await withLocalStandard(async () => {
    const fixture = createFixture();
    try {
      fixture.store.updateDesignJob("design-1", { status: "completed" });
      const payload = {
        ...expectedIdentity(REVISION_KEY),
        instruction: "Move the logo higher and use a warmer background.",
        sourceText: "Move the logo higher and use a warmer background.",
      };
      const [first, replay] = await Promise.all([
        fixture.service.requestRevision("design-1", payload),
        fixture.service.requestRevision("design-1", payload),
      ]);
      assert.equal(first.revision.id, replay.revision.id);
      assert.equal(first.revision.revisionNumber, 1);
      assert.equal(fixture.store.listDesignRevisions("design-1").length, 1);
      assert.equal(fixture.externalPayloads.length, 1);
      assert.equal(fixture.externalPayloads[0].requestId, first.revision.externalRequestId);
      assert.equal(fixture.sendTasks.size, 1);

      await assert.rejects(
        fixture.service.requestRevision("design-1", { ...payload, instruction: "Different revision intent." }),
        /already used with different identity or payload/,
      );
    } finally {
      fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
  });
});

test("concurrent completed callbacks claim once and commit one image and notification", async () => {
  await withLocalStandard(async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-callback-storage-"));
    const previousStorageRoot = appConfig.localStorageRoot;
    const callbackFiles = callbackStorage(storageRoot);
    const fixture = createFixture({ storage: callbackFiles.storage });
    appConfig.localStorageRoot = storageRoot;
    try {
      fixture.store.updateDesignJob("design-1", {
        externalJobId: "external-callback-1",
        status: "submitted",
        outputCount: 1,
        manualQcRequired: false,
      });
      const payload = completedCallback();
      const [first, second] = await Promise.all([
        fixture.service.handleDesignPlatformCallback(payload),
        fixture.service.handleDesignPlatformCallback(payload),
      ]);
      assert.equal(first.id, second.id);
      assert.equal(callbackFiles.saveCount(), 1);
      assert.equal(
        fixture.store.getDesignJob("design-1").images.length,
        1,
        JSON.stringify(fixture.store.listNotifications().map((notice) => notice.title)),
      );
      assert.equal(fixture.store.getDesignJob("design-1").callbackStatus, "settled");
      assert.equal(
        fixture.store.listNotifications().filter((notice) => notice.title === "设计图已生成").length,
        1,
      );
    } finally {
      appConfig.localStorageRoot = previousStorageRoot;
      fs.rmSync(fixture.tempDir, { recursive: true, force: true });
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});

test("completed and failed callbacks for one external job share the completed winner", async () => {
  await withLocalStandard(async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-callback-race-"));
    const previousStorageRoot = appConfig.localStorageRoot;
    const gate = deferred();
    const callbackFiles = callbackStorage(storageRoot, gate);
    const fixture = createFixture({ storage: callbackFiles.storage });
    appConfig.localStorageRoot = storageRoot;
    try {
      fixture.store.updateDesignJob("design-1", {
        externalJobId: "external-callback-1",
        status: "submitted",
        outputCount: 1,
        manualQcRequired: false,
      });
      const completed = fixture.service.handleDesignPlatformCallback(completedCallback());
      await callbackFiles.started;
      const failed = fixture.service.handleDesignPlatformCallback(failedCallback());
      gate.resolve();
      await Promise.all([completed, failed]);
      const job = fixture.store.getDesignJob("design-1");
      assert.equal(job.callbackStatus, "settled");
      assert.notEqual(job.status, "failed");
      assert.equal(fixture.externalPayloads.length, 0);
      assert.equal(fixture.store.getDesignJob("design-1").images.length, 1);
    } finally {
      appConfig.localStorageRoot = previousStorageRoot;
      fs.rmSync(fixture.tempDir, { recursive: true, force: true });
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});

test("cancellation claimed during a completed callback prevents image commit and cleans only callback files", async () => {
  await withLocalStandard(async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-callback-cancel-"));
    const previousStorageRoot = appConfig.localStorageRoot;
    const gate = deferred();
    const callbackFiles = callbackStorage(storageRoot, gate);
    let cancelCount = 0;
    const fixture = createFixture({
      storage: callbackFiles.storage,
      cancelDesignJob: async () => {
        cancelCount += 1;
        return { status: "cancelled" };
      },
    });
    appConfig.localStorageRoot = storageRoot;
    try {
      fixture.store.updateDesignJob("design-1", {
        externalJobId: "external-callback-1",
        status: "submitted",
        outputCount: 1,
        manualQcRequired: false,
      });
      const completed = fixture.service.handleDesignPlatformCallback(completedCallback());
      await callbackFiles.started;
      const cancellation = await fixture.service.cancel("design-1", {
        expectedWechatAccountId: "wechat-1",
        expectedConversationId: "conversation-1",
        expectedCustomerId: "customer-1",
      });
      gate.resolve();
      await completed;
      assert.equal(cancellation.job.status, "cancelled");
      assert.equal(fixture.store.getDesignJob("design-1").status, "cancelled");
      assert.equal(cancelCount, 1);
      assert.equal(fixture.store.getDesignJob("design-1").images.length, 0);
      assert.equal(
        fixture.store.listNotifications().filter((notice) => notice.title === "设计图已生成").length,
        0,
      );
      const savedPath = path.join(storageRoot, "design-jobs", "design-1", "candidate_1.png");
      assert.equal(fs.existsSync(savedPath), false);
    } finally {
      gate.resolve();
      appConfig.localStorageRoot = previousStorageRoot;
      fs.rmSync(fixture.tempDir, { recursive: true, force: true });
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});

test("concurrent failed callbacks settle once and start at most one retry", async () => {
  await withLocalStandard(async () => {
    const fixture = createFixture();
    try {
      fixture.store.updateDesignJob("design-1", {
        externalJobId: "external-callback-1",
        status: "submitted",
        outputCount: 1,
      });
      const payload = failedCallback();
      await Promise.all([
        fixture.service.handleDesignPlatformCallback(payload),
        fixture.service.handleDesignPlatformCallback(payload),
      ]);
      const job = fixture.store.getDesignJob("design-1");
      assert.equal(job.status, "submitted");
      assert.equal(job.retryCount, 1);
      assert.equal(fixture.externalPayloads.length, 1);
      assert.equal(job.callbackOperationKey, null);
      assert.equal(
        fixture.store.listNotifications().filter((notice) => notice.title === "设计平台出图失败").length,
        1,
      );
    } finally {
      fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
  });
});

function createPrismaCallbackRaceFixture(storageRoot, gate) {
  const callbackFiles = callbackStorage(storageRoot, gate);
  let stateJob = {
    ...makeJob(),
    externalJobId: "external-callback-1",
    status: "submitted",
    outputCount: 1,
    manualQcRequired: false,
    images: [],
    callbackOperationKey: null,
    callbackRequestFingerprint: null,
    callbackStatus: null,
    callbackClaimedAt: null,
  };
  const persistedImages = [];
  const updateMany = async ({ data }) => {
    if (data.callbackStatus === "processing") {
      if (stateJob.callbackOperationKey || !["submitted", "generating"].includes(stateJob.status)) return { count: 0 };
    } else if (data.callbackStatus === "outcome_unknown") {
      if (!["processing", "retry_dispatching"].includes(stateJob.callbackStatus)) return { count: 0 };
    } else if (data.callbackStatus === "settled") {
      if (stateJob.callbackStatus !== "processing" || !["submitted", "generating"].includes(stateJob.status)) return { count: 0 };
    } else {
      return { count: 0 };
    }
    stateJob = { ...stateJob, ...data };
    return { count: 1 };
  };
  const prisma = {
    designJob: {
      findUnique: async ({ where }) => {
        if (where.id && where.id !== stateJob.id) return null;
        if (where.requestId && where.requestId !== stateJob.requestId) return null;
        return { ...stateJob, images: [...persistedImages] };
      },
      updateMany,
    },
    designRevision: {
      findUnique: async () => null,
      findFirst: async () => null,
    },
    designImageCandidate: {
      upsert: async ({ create }) => {
        persistedImages.push(create);
        return create;
      },
    },
  };
  prisma.$transaction = async (action) => action(prisma);
  const notices = [];
  const buildService = () => new DesignJobsService(
    prisma,
    { createDesignJob: async () => assert.fail("callback loser must not retry upstream") },
    {},
    { create: async (...args) => { notices.push(args); return {}; } },
    callbackFiles.storage,
    {},
    {},
    {},
    {},
  );
  return {
    buildService,
    callbackFiles,
    notices,
    persistedImages,
    getJob: () => stateJob,
    expireClaim: () => { stateJob = { ...stateJob, callbackClaimedAt: new Date(Date.now() - 60 * 60 * 1000) }; },
  };
}

async function withPrismaCallbackRace(run) {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousAdapter = appConfig.designPlatformAdapter;
  const previousStorageRoot = appConfig.localStorageRoot;
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-callback-prisma-"));
  const gate = deferred();
  const fixture = createPrismaCallbackRaceFixture(storageRoot, gate);
  appConfig.useLocalStore = false;
  appConfig.designPlatformAdapter = "standard_v1";
  appConfig.localStorageRoot = storageRoot;
  try {
    await run({ ...fixture, gate });
  } finally {
    gate.resolve();
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.designPlatformAdapter = previousAdapter;
    appConfig.localStorageRoot = previousStorageRoot;
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
}

test("fresh Prisma cross-process completed callbacks leave the first claim in progress", async () => {
  await withPrismaCallbackRace(async ({ buildService, callbackFiles, gate, getJob, persistedImages, notices }) => {
    const firstService = buildService();
    const secondService = buildService();
    const first = firstService.handleDesignPlatformCallback(completedCallback());
    await callbackFiles.started;
    const replay = await secondService.handleDesignPlatformCallback(completedCallback());
    assert.equal(replay.callbackStatus, "processing");
    gate.resolve();
    await first;
    assert.equal(getJob().callbackStatus, "settled");
    assert.equal(persistedImages.length, 1);
    assert.equal(notices.filter((notice) => notice[1] === "设计图已生成").length, 1);
  });
});

test("fresh Prisma cross-process completed-vs-failed callbacks preserve the completed winner", async () => {
  await withPrismaCallbackRace(async ({ buildService, callbackFiles, gate, getJob, persistedImages, notices }) => {
    const firstService = buildService();
    const secondService = buildService();
    const first = firstService.handleDesignPlatformCallback(completedCallback());
    await callbackFiles.started;
    const replay = await secondService.handleDesignPlatformCallback(failedCallback());
    assert.equal(replay.callbackStatus, "processing");
    gate.resolve();
    await first;
    assert.equal(getJob().callbackStatus, "settled");
    assert.notEqual(getJob().status, "failed");
    assert.equal(persistedImages.length, 1);
    assert.equal(notices.filter((notice) => notice[1] === "设计平台出图失败").length, 0);
  });
});

test("stale Prisma callback claim fails closed as outcome unknown without another upstream effect", async () => {
  await withPrismaCallbackRace(async ({ buildService, callbackFiles, gate, expireClaim, getJob, persistedImages, notices }) => {
    const firstService = buildService();
    const secondService = buildService();
    const first = firstService.handleDesignPlatformCallback(completedCallback());
    await callbackFiles.started;
    expireClaim();
    const loser = await Promise.allSettled([secondService.handleDesignPlatformCallback(failedCallback())]);
    assert.equal(loser[0].status, "rejected");
    assert.equal(loser[0].reason.getResponse().code, "DESIGN_CALLBACK_OUTCOME_UNKNOWN");
    gate.resolve();
    await first;
    assert.equal(getJob().status, "manual_review");
    assert.equal(getJob().callbackStatus, "outcome_unknown");
    assert.equal(persistedImages.length, 0);
    assert.equal(notices.filter((notice) => notice[1] === "设计图已生成").length, 0);
  });
});

test("Prisma schema and migration enforce operation and revision-number uniqueness", () => {
  const schema = fs.readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8");
  const migration = fs.readFileSync(
    path.resolve(__dirname, "../prisma/migrations/20260720113000_design_external_operation_idempotency/migration.sql"),
    "utf8",
  );
  assert.match(schema, /submitOperationKey\s+String\?\s+@unique/);
  assert.match(schema, /operationKey\s+String\?\s+@unique/);
  assert.match(schema, /externalRequestId\s+String\?\s+@unique/);
  assert.match(schema, /callbackOperationKey\s+String\?\s+@unique/);
  assert.match(schema, /@@unique\(\[designJobId, revisionNumber\]\)/);
  assert.match(migration, /ROW_NUMBER\(\) OVER/);
  assert.match(migration, /DesignRevision_designJobId_revisionNumber_key/);
});
