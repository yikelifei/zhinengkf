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
const { appConfig } = require("../apps/api/src/shared/app-config");

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);

function createFixture(root) {
  const source = {
    id: "design_source",
    requestId: "request_source",
    status: "completed",
    wechatAccountId: "wechat_source",
    conversationId: "conversation_source",
    customerId: "customer_same",
    budget: {},
    bundle: {},
    requirements: {},
    images: [],
  };
  for (let position = 1; position <= 4; position += 1) {
    const localPath = path.join(root, "source", `candidate_${position}.png`);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, VALID_PNG);
    source.images.push({
      id: `source_image_${position}`,
      imageId: `candidate_${position}`,
      position,
      localPath,
    });
  }

  const jobs = new Map([[source.id, source]]);
  const targetConversation = {
    id: "conversation_target",
    wechatAccountId: "wechat_target",
    customerId: "customer_same",
  };
  const unlocks = [];
  const queued = [];
  let platformCalls = 0;
  const localStore = {
    getDesignJob: (id) => jobs.get(id) || null,
    listConversations: () => [targetConversation],
    createDesignJob: (payload) => {
      const existing = [...jobs.values()].find((job) => job.requestId === payload.requestId);
      if (existing) return existing;
      const job = { id: "design_forwarded", images: [], ...payload };
      jobs.set(job.id, job);
      return job;
    },
    upsertDesignImages: (id, images) => {
      const job = jobs.get(id);
      job.images = images.map((image) => ({ ...image, designJobId: id }));
      return job.images;
    },
    updateDesignJob: (id, patch) => {
      const next = { ...jobs.get(id), ...patch };
      jobs.set(id, next);
      return next;
    },
    createReviewLog: (payload) => ({ id: "review_forwarded", ...payload }),
  };
  const designPlatform = {
    createDesignJob: async () => {
      platformCalls += 1;
      throw new Error("generation must not be called");
    },
  };
  const wechatDispatch = {
    setConversationManualLock: async (id, payload) => {
      unlocks.push({ id, payload });
      return { id, manualLocked: payload.locked };
    },
    enqueueDesignImages: async (payload) => {
      queued.push(payload);
      return { id: "send_forwarded", payload };
    },
  };
  const service = new DesignJobsService(
    {},
    designPlatform,
    localStore,
    { create: async () => ({}) },
    {},
    wechatDispatch,
    {},
    {},
    {},
  );
  return { service, jobs, queued, unlocks, platformCalls: () => platformCalls };
}

function request(overrides = {}) {
  return {
    operationKey: "forward-existing-images-operation-0001",
    expectedWechatAccountId: "wechat_source",
    expectedConversationId: "conversation_source",
    expectedCustomerId: "customer_same",
    targetWechatAccountId: "wechat_target",
    targetConversationId: "conversation_target",
    targetCustomerId: "customer_same",
    reviewer: "test operator",
    ...overrides,
  };
}

test("forwards four existing images to the same customer's target account without regenerating", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "design-forward-"));
  const originalUseLocalStore = appConfig.useLocalStore;
  const originalStorageRoot = appConfig.localStorageRoot;
  appConfig.useLocalStore = true;
  appConfig.localStorageRoot = root;
  try {
    const fixture = createFixture(root);
    const result = await fixture.service.forwardExistingImages("design_source", request());

    assert.equal(result.regenerated, false);
    assert.equal(result.imageCount, 4);
    assert.equal(result.sendTask.id, "send_forwarded");
    assert.equal(fixture.platformCalls(), 0);
    assert.equal(fixture.unlocks.length, 1);
    assert.equal(fixture.unlocks[0].id, "conversation_target");
    assert.equal(fixture.unlocks[0].payload.locked, false);
    assert.equal(fixture.queued.length, 1);
    assert.equal(fixture.queued[0].wechatAccountId, "wechat_target");
    assert.equal(fixture.queued[0].conversationId, "conversation_target");
    assert.equal(fixture.queued[0].customerId, "customer_same");
    assert.equal(fixture.queued[0].imagePaths.length, 4);
    for (const imagePath of fixture.queued[0].imagePaths) {
      assert.equal(fs.existsSync(imagePath), true);
      assert.equal(path.resolve(imagePath).startsWith(path.resolve(root)), true);
    }
  } finally {
    appConfig.useLocalStore = originalUseLocalStore;
    appConfig.localStorageRoot = originalStorageRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refuses to forward existing images to a different customer before queueing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "design-forward-other-customer-"));
  const originalUseLocalStore = appConfig.useLocalStore;
  const originalStorageRoot = appConfig.localStorageRoot;
  appConfig.useLocalStore = true;
  appConfig.localStorageRoot = root;
  try {
    const fixture = createFixture(root);
    await assert.rejects(
      () => fixture.service.forwardExistingImages("design_source", request({ targetCustomerId: "customer_other" })),
      /identity mismatch|same customer/,
    );
    assert.equal(fixture.queued.length, 0);
    assert.equal(fixture.platformCalls(), 0);
  } finally {
    appConfig.useLocalStore = originalUseLocalStore;
    appConfig.localStorageRoot = originalStorageRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
