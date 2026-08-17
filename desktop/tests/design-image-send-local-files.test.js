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

const originalUseLocalStore = appConfig.useLocalStore;
test.beforeEach(() => {
  appConfig.useLocalStore = true;
});
test.afterEach(() => {
  appConfig.useLocalStore = originalUseLocalStore;
});

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);

function writeImageFixture(root, jobId, imageId) {
  const file = path.join(root, "design-jobs", jobId, `${imageId}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, VALID_PNG);
  return file;
}

function createService({ job, notifications = [] }) {
  const localStore = {
    getDesignJob: () => job,
    updateDesignJob: (id, patch) => ({ ...job, id, ...patch }),
  };
  const notificationService = {
    create: async (level, title, body, metadata) => {
      const record = { level, title, body, metadata };
      notifications.push(record);
      return record;
    },
  };
  const wechatDispatch = {
    enqueueDesignImages: async (payload) => ({ id: "send_1", payload }),
  };

  return {
    service: new DesignJobsService(
      {},
      {},
      localStore,
      notificationService,
      {},
      wechatDispatch,
      {},
      {},
    ),
    notifications,
    wechatDispatch,
  };
}

test("quick confirm refuses design images that only have remote URLs", async () => {
  const notifications = [];
  const { service } = createService({
    notifications,
    job: {
      id: "design_1",
      requestId: "request_1",
      status: "quick_confirm",
      wechatAccountId: "wechat_1",
      customerId: "customer_1",
      conversationId: "conversation_1",
      images: [
        {
          id: "image_1",
          imageId: "candidate_1",
          position: 1,
          downloadUrl: "https://example.test/candidate-1.png",
        },
      ],
    },
  });

  await assert.rejects(
    () => service.quickConfirmAndQueueSend("design_1"),
    /candidate images without local files/,
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, "候选图未保存到本地");
});

test("quick confirm queues only local design image files", async () => {
  const captured = [];
  let updatedPatch = null;
  const job = {
    id: "design_1",
    requestId: "request_1",
    status: "quick_confirm",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    images: [
      {
        id: "image_2",
        imageId: "candidate_2",
        position: 2,
        localPath: "C:\\storage\\design-jobs\\design_1\\candidate_2.png",
        downloadUrl: "https://example.test/candidate-2.png",
      },
      {
        id: "image_1",
        imageId: "candidate_1",
        position: 1,
        localPath: "C:\\storage\\design-jobs\\design_1\\candidate_1.png",
        downloadUrl: "https://example.test/candidate-1.png",
      },
      {
        id: "image_4",
        imageId: "candidate_4",
        position: 4,
        localPath: "C:\\storage\\design-jobs\\design_1\\candidate_4.png",
        downloadUrl: "https://example.test/candidate-4.png",
      },
      {
        id: "image_3",
        imageId: "candidate_3",
        position: 3,
        localPath: "C:\\storage\\design-jobs\\design_1\\candidate_3.png",
        downloadUrl: "https://example.test/candidate-3.png",
      },
    ],
  };
  const localStore = {
    getDesignJob: () => job,
    updateDesignJob: (id, patch) => {
      updatedPatch = patch;
      return { ...job, id, ...patch };
    },
  };
  const service = new DesignJobsService(
    {},
    {},
    localStore,
    { create: async () => ({}) },
    {},
    {
      enqueueDesignImages: async (payload) => {
        captured.push(payload);
        return { id: "send_1", payload };
      },
    },
    {},
    {},
  );

  const sendTask = await service.quickConfirmAndQueueSend("design_1");

  assert.equal(sendTask.id, "send_1");
  assert.deepEqual(captured[0].imagePaths, [
    "C:\\storage\\design-jobs\\design_1\\candidate_1.png",
    "C:\\storage\\design-jobs\\design_1\\candidate_2.png",
    "C:\\storage\\design-jobs\\design_1\\candidate_3.png",
    "C:\\storage\\design-jobs\\design_1\\candidate_4.png",
  ]);
  assert.deepEqual(updatedPatch, { status: "sent", sendTaskId: "send_1" });
});

test("quick confirm refuses an incomplete local candidate round", async () => {
  let enqueueCalled = false;
  const job = {
    id: "design_incomplete_round",
    requestId: "request_incomplete_round",
    status: "quick_confirm",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    images: [1, 2, 3].map((position) => ({
      id: `image_${position}`,
      imageId: `candidate_${position}`,
      position,
      localPath: `C:\\storage\\design-jobs\\design_incomplete_round\\candidate_${position}.png`,
    })),
  };
  const service = new DesignJobsService(
    {},
    {},
    {
      getDesignJob: () => job,
      updateDesignJob: (id, patch) => ({ ...job, id, ...patch }),
    },
    { create: async () => ({}) },
    {},
    {
      enqueueDesignImages: async () => {
        enqueueCalled = true;
        return { id: "unexpected_send" };
      },
    },
    {},
    {},
  );

  await assert.rejects(
    () => service.quickConfirmAndQueueSend(job.id),
    /exactly 4 candidate images/,
  );
  assert.equal(enqueueCalled, false);
});

test("customer creative images pass multimodal QC before entering the send queue", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "creative-visual-qc-pass-"));
  const prompts = [];
  const captured = [];
  const job = {
    id: "creative_qc_pass",
    requestId: "creative_qc_request",
    status: "quick_confirm",
    designType: "zhenxi_image",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    requirements: {
      customerAgent: { deliverable: "greeting_card", deliverableLabel: "贺卡" },
      zhenxi: { copyText: "老师，节日快乐", logoMode: "none" },
    },
    images: [1, 2, 3, 4].map((position) => ({
      id: `creative_image_${position}`,
      imageId: `creative_candidate_${position}`,
      position,
      localPath: writeImageFixture(root, "creative_qc_pass", `creative_candidate_${position}`),
    })),
  };
  const localStore = {
    getDesignJob: () => job,
    updateDesignJob: (id, patch) => ({ ...job, id, ...patch }),
  };
  const service = new DesignJobsService(
    {},
    {},
    localStore,
    { create: async () => ({}) },
    {},
    {
      enqueueDesignImages: async (payload) => {
        captured.push(payload);
        return { id: "creative_send_1", payload };
      },
    },
    {},
    {},
    {},
    {
      understandImages: async ({ images, prompt }) => {
        prompts.push(prompt);
        return { text: JSON.stringify({ pass: true, issues: [], checkedCount: images.length }) };
      },
    },
  );

  const sendTask = await service.quickConfirmAndQueueSend(job.id);
  assert.equal(sendTask.id, "creative_send_1");
  assert.equal(captured.length, 1);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /客户只要求的物料：贺卡/);
  assert.match(prompts[0], /老师，节日快乐/);
  assert.match(captured[0].textBeforeImages, /贺卡的 4 版效果/);
});

test("customer creative visual QC is single-flight when automation overlaps", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "creative-visual-qc-single-flight-"));
  let resolveQc;
  let visionCalls = 0;
  let enqueueCalls = 0;
  const job = {
    id: "creative_qc_single_flight",
    requestId: "creative_qc_single_flight_request",
    status: "quick_confirm",
    designType: "zhenxi_image",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    requirements: {
      customerAgent: { deliverable: "poster", deliverableLabel: "poster" },
      zhenxi: { copyText: "opening gift", logoMode: "none" },
    },
    images: [1, 2, 3, 4].map((position) => ({
      id: `creative_single_flight_image_${position}`,
      imageId: `creative_single_flight_candidate_${position}`,
      position,
      localPath: writeImageFixture(root, "creative_qc_single_flight", `candidate_${position}`),
    })),
  };
  const service = new DesignJobsService(
    {},
    {},
    {
      getDesignJob: () => job,
      updateDesignJob: (id, patch) => ({ ...job, id, ...patch }),
    },
    { create: async () => ({}) },
    {},
    {
      enqueueDesignImages: async (payload) => {
        enqueueCalls += 1;
        return { id: "creative_single_flight_send", payload };
      },
    },
    {},
    {},
    {},
    {
      understandImages: async ({ images }) => {
        visionCalls += 1;
        return await new Promise((resolve) => {
          resolveQc = () => resolve({
            text: JSON.stringify({ pass: true, issues: [], checkedCount: images.length }),
          });
        });
      },
    },
  );

  const first = service.quickConfirmAndQueueSend(job.id);
  while (visionCalls === 0) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => service.quickConfirmAndQueueSend(job.id),
    /visual QC is already processing/,
  );
  resolveQc();
  const sendTask = await first;

  assert.equal(sendTask.id, "creative_single_flight_send");
  assert.equal(visionCalls, 1);
  assert.equal(enqueueCalls, 1);
});

test("customer creative images with text errors are handed to a human instead of auto-sent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "creative-visual-qc-fail-"));
  let enqueueCalled = false;
  let manualLockReason = "";
  const reviewLogs = [];
  const job = {
    id: "creative_qc_fail",
    requestId: "creative_qc_fail_request",
    status: "quick_confirm",
    designType: "zhenxi_image",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    requirements: {
      customerAgent: { deliverable: "hang_tag", deliverableLabel: "吊牌" },
      zhenxi: { copyText: "感谢一路相伴", logoMode: "provided" },
    },
    images: [1, 2, 3, 4].map((position) => ({
      id: `creative_fail_image_${position}`,
      imageId: `creative_fail_candidate_${position}`,
      position,
      localPath: writeImageFixture(root, "creative_qc_fail", `creative_fail_candidate_${position}`),
    })),
  };
  const localStore = {
    getDesignJob: () => job,
    updateDesignJob: (id, patch) => ({ ...job, id, ...patch }),
    createReviewLog: (payload) => {
      reviewLogs.push(payload);
      return payload;
    },
  };
  const service = new DesignJobsService(
    {},
    {},
    localStore,
    { create: async () => ({}) },
    {},
    {
      enqueueDesignImages: async () => {
        enqueueCalled = true;
        return { id: "unexpected_send" };
      },
      setConversationManualLock: async (_id, payload) => {
        manualLockReason = payload.reason;
        return { blockedSendTasks: [], inFlightSendTasks: [] };
      },
    },
    {},
    {},
    {},
    {
      understandImages: async () => ({
        text: JSON.stringify({ pass: false, issues: ["第2张把相伴写成相伴的繁体字"], checkedCount: 4 }),
      }),
    },
  );

  await assert.rejects(() => service.quickConfirmAndQueueSend(job.id), /visual QC failed/);
  assert.equal(enqueueCalled, false);
  assert.equal(manualLockReason, "creative_visual_qc_failed");
  assert.equal(reviewLogs[0].decision, "creative_visual_qc_failed");
});

test("quick confirm sends only the latest revision round images", async () => {
  const captured = [];
  const job = {
    id: "design_revision_send_1",
    requestId: "request_revision_send_1",
    status: "quick_confirm",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    images: [
      {
        id: "initial_image_1",
        imageId: "candidate_1",
        position: 1,
        localPath: "C:\\storage\\design-jobs\\design_revision_send_1\\candidate_1.png",
      },
      {
        id: "initial_image_2",
        imageId: "candidate_2",
        position: 2,
        localPath: "C:\\storage\\design-jobs\\design_revision_send_1\\candidate_2.png",
      },
      {
        id: "revision_image_1",
        imageId: "r1-candidate_1",
        position: 101,
        localPath: "C:\\storage\\design-jobs\\design_revision_send_1\\r1-candidate_1.png",
      },
      {
        id: "revision_image_2",
        imageId: "r1-candidate_2",
        position: 102,
        localPath: "C:\\storage\\design-jobs\\design_revision_send_1\\r1-candidate_2.png",
      },
      {
        id: "revision_image_3",
        imageId: "r1-candidate_3",
        position: 103,
        localPath: "C:\\storage\\design-jobs\\design_revision_send_1\\r1-candidate_3.png",
      },
      {
        id: "revision_image_4",
        imageId: "r1-candidate_4",
        position: 104,
        localPath: "C:\\storage\\design-jobs\\design_revision_send_1\\r1-candidate_4.png",
      },
    ],
  };
  const service = new DesignJobsService(
    {},
    {},
    {
      getDesignJob: () => job,
      updateDesignJob: (id, patch) => ({ ...job, id, ...patch }),
    },
    { create: async () => ({}) },
    {},
    {
      enqueueDesignImages: async (payload) => {
        captured.push(payload);
        return { id: "send_revision_1", payload };
      },
    },
    {},
    {},
  );

  await service.quickConfirmAndQueueSend(job.id);

  assert.deepEqual(captured[0].imagePaths, [
    "C:\\storage\\design-jobs\\design_revision_send_1\\r1-candidate_1.png",
    "C:\\storage\\design-jobs\\design_revision_send_1\\r1-candidate_2.png",
    "C:\\storage\\design-jobs\\design_revision_send_1\\r1-candidate_3.png",
    "C:\\storage\\design-jobs\\design_revision_send_1\\r1-candidate_4.png",
  ]);
});

test("design platform callback with wrong external job id does not write images", async () => {
  let upsertCalled = false;
  let storageCalled = false;
  const job = {
    id: "design_1",
    requestId: "request_1",
    externalJobId: "external_1",
    status: "generating",
    isHighValue: false,
    manualQcRequired: true,
    retryCount: 0,
    images: [],
  };
  const localStore = {
    getDesignJob: () => job,
    getLatestActiveDesignRevision: () => null,
    updateDesignJob: (id, patch) => ({ ...job, id, ...patch }),
    upsertDesignImages: () => {
      upsertCalled = true;
      return [];
    },
  };
  const service = new DesignJobsService(
    {},
    {},
    localStore,
    { create: async () => ({}) },
    {
      saveDesignImage: async () => {
        storageCalled = true;
        return "C:\\storage\\design-jobs\\design_1\\candidate_1.png";
      },
    },
    {},
    {},
    {},
  );

  await assert.rejects(
    () =>
      service.handleDesignPlatformCallback({
        requestId: "request_1",
        externalJobId: "external_2",
        status: "completed",
        images: [
          {
            imageId: "candidate_1",
            downloadUrl: "https://example.test/candidate-1.png",
            width: 1024,
            height: 1024,
          },
        ],
      }),
    /design callback binding invalid/,
  );

  assert.equal(storageCalled, false);
  assert.equal(upsertCalled, false);
});

test("initial design callback retries when candidate image count is below minimum", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let storageCalled = false;
  let upsertCalled = false;
  const createPayloads = [];
  const notifications = [];
  let job = {
    id: "design_insufficient_images_retry",
    requestId: "request_insufficient_images_retry",
    externalJobId: "external_original",
    status: "submitted",
    isHighValue: false,
    manualQcRequired: true,
    retryCount: 0,
    revisionCount: 0,
    outputCount: 6,
    budget: { mode: "per_box", perUnitAmount: 200, quantity: 10, totalAmount: 2000 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    assets: [],
    images: [],
  };
  const localStore = {
    getDesignJob: () => job,
    getLatestActiveDesignRevision: () => null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, job.id);
      job = { ...job, ...patch };
      return job;
    },
    upsertDesignImages: () => {
      upsertCalled = true;
      return [];
    },
  };
  const service = new DesignJobsService(
    {},
    {
      createDesignJob: async (payload) => {
        createPayloads.push(payload);
        return { externalJobId: "external_retry" };
      },
    },
    localStore,
    {
      create: async (level, title, body, metadata) => {
        notifications.push({ level, title, body, metadata });
        return { id: `notice_${notifications.length}` };
      },
    },
    {
      saveDesignImage: async () => {
        storageCalled = true;
        return "C:\\storage\\design-jobs\\candidate.png";
      },
    },
    {},
    {},
    {},
  );
  service.assertDesignPlatformPreflight = async () => ({ ok: true });
  service.scheduleResultPoll = () => {};

  try {
    const updated = await service.handleDesignPlatformCallback({
      requestId: "request_insufficient_images_retry",
      externalJobId: "external_original",
      status: "completed",
      images: [
        {
          imageId: "candidate_1",
          downloadUrl: "https://example.test/candidate-1.png",
          width: 1024,
          height: 1024,
        },
        {
          imageId: "candidate_2",
          downloadUrl: "https://example.test/candidate-2.png",
          width: 1024,
          height: 1024,
        },
      ],
    });

    assert.equal(updated.status, "submitted");
    assert.equal(updated.retryCount, 1);
    assert.equal(updated.externalJobId, "external_retry");
    assert.equal(createPayloads.length, 1);
    assert.equal(storageCalled, false);
    assert.equal(upsertCalled, false);
    assert.equal(
      notifications.some(
        (notice) => notice.metadata?.returnedImageCount === 2 && notice.metadata?.requiredImageCount === 4,
      ),
      true,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("initial design callback hands to manual review when insufficient images repeat", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let storageCalled = false;
  let upsertCalled = false;
  let retrySubmitCalled = false;
  const reviewLogs = [];
  const manualLocks = [];
  let job = {
    id: "design_insufficient_images_manual",
    requestId: "request_insufficient_images_manual",
    externalJobId: "external_retry",
    status: "submitted",
    conversationId: "conversation_1",
    isHighValue: false,
    manualQcRequired: true,
    retryCount: 1,
    revisionCount: 0,
    outputCount: 6,
    budget: { mode: "per_box", perUnitAmount: 200, quantity: 10, totalAmount: 2000 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    assets: [],
    images: [],
  };
  const localStore = {
    getDesignJob: () => job,
    getLatestActiveDesignRevision: () => null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, job.id);
      job = { ...job, ...patch };
      return job;
    },
    upsertDesignImages: () => {
      upsertCalled = true;
      return [];
    },
    createReviewLog: (payload) => {
      reviewLogs.push(payload);
      return payload;
    },
  };
  const service = new DesignJobsService(
    {},
    {
      createDesignJob: async () => {
        retrySubmitCalled = true;
        return { externalJobId: "should_not_retry" };
      },
    },
    localStore,
    { create: async () => ({}) },
    {
      saveDesignImage: async () => {
        storageCalled = true;
        return "C:\\storage\\design-jobs\\candidate.png";
      },
    },
    {
      setConversationManualLock: async (conversationId, payload) => {
        manualLocks.push({ conversationId, payload });
        return { blockedSendTasks: [], inFlightSendTasks: [] };
      },
    },
    {},
    {},
  );

  try {
    const updated = await service.handleDesignPlatformCallback({
      requestId: "request_insufficient_images_manual",
      externalJobId: "external_retry",
      status: "completed",
      images: [
        {
          imageId: "candidate_1",
          downloadUrl: "https://example.test/candidate-1.png",
          width: 1024,
          height: 1024,
        },
        {
          imageId: "candidate_2",
          downloadUrl: "https://example.test/candidate-2.png",
          width: 1024,
          height: 1024,
        },
      ],
    });

    assert.equal(updated.status, "manual_review");
    assert.match(job.errorMessage, /returned only 2 candidate images/);
    assert.equal(reviewLogs.at(-1).decision, "design_platform_insufficient_images");
    assert.equal(manualLocks.at(-1).conversationId, "conversation_1");
    assert.equal(manualLocks.at(-1).payload.reason, "design_platform_insufficient_images");
    assert.equal(retrySubmitCalled, false);
    assert.equal(storageCalled, false);
    assert.equal(upsertCalled, false);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("initial design callback retries when local image files are below minimum", async (t) => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-image-save-retry-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const saveAttempts = [];
  let upsertCalled = false;
  const createPayloads = [];
  const notifications = [];
  let job = {
    id: "design_local_save_retry",
    requestId: "request_local_save_retry",
    externalJobId: "external_original",
    status: "submitted",
    isHighValue: false,
    manualQcRequired: true,
    retryCount: 0,
    revisionCount: 0,
    outputCount: 6,
    budget: { mode: "per_box", perUnitAmount: 200, quantity: 10, totalAmount: 2000 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    assets: [],
    images: [],
  };
  const localStore = {
    getDesignJob: () => job,
    getLatestActiveDesignRevision: () => null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, job.id);
      job = { ...job, ...patch };
      return job;
    },
    upsertDesignImages: () => {
      upsertCalled = true;
      return [];
    },
  };
  const service = new DesignJobsService(
    {},
    {
      createDesignJob: async (payload) => {
        createPayloads.push(payload);
        return { externalJobId: "external_retry" };
      },
    },
    localStore,
    {
      create: async (level, title, body, metadata) => {
        notifications.push({ level, title, body, metadata });
        return { id: `notice_${notifications.length}` };
      },
    },
    {
      saveDesignImage: async (jobId, imageId) => {
        saveAttempts.push({ jobId, imageId });
        if (imageId === "candidate_1") return writeImageFixture(tempRoot, jobId, imageId);
        throw new Error("download failed");
      },
    },
    {},
    {},
    {},
  );
  service.assertDesignPlatformPreflight = async () => ({ ok: true });
  service.scheduleResultPoll = () => {};

  try {
    const updated = await service.handleDesignPlatformCallback({
      requestId: "request_local_save_retry",
      externalJobId: "external_original",
      status: "completed",
      images: [
        { imageId: "candidate_1", downloadUrl: "https://example.test/candidate-1.png", width: 1024, height: 1024 },
        { imageId: "candidate_2", downloadUrl: "https://example.test/candidate-2.png", width: 1024, height: 1024 },
        { imageId: "candidate_3", downloadUrl: "https://example.test/candidate-3.png", width: 1024, height: 1024 },
        { imageId: "candidate_4", downloadUrl: "https://example.test/candidate-4.png", width: 1024, height: 1024 },
      ],
    });

    assert.equal(updated.status, "submitted");
    assert.equal(updated.retryCount, 1);
    assert.equal(updated.externalJobId, "external_retry");
    assert.equal(createPayloads.length, 1);
    assert.equal(saveAttempts.length, 4);
    assert.equal(upsertCalled, false);
    assert.equal(
      notifications.some(
        (notice) => notice.metadata?.localSavedCount === 1 && notice.metadata?.requiredLocalImageCount === 4,
      ),
      true,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("initial design callback hands to manual review when local image save still fails after retry", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  const saveAttempts = [];
  let upsertCalled = false;
  let retrySubmitCalled = false;
  const reviewLogs = [];
  const manualLocks = [];
  let job = {
    id: "design_local_save_manual",
    requestId: "request_local_save_manual",
    externalJobId: "external_retry",
    status: "submitted",
    conversationId: "conversation_1",
    isHighValue: false,
    manualQcRequired: true,
    retryCount: 1,
    revisionCount: 0,
    outputCount: 6,
    budget: { mode: "per_box", perUnitAmount: 200, quantity: 10, totalAmount: 2000 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    assets: [],
    images: [],
  };
  const localStore = {
    getDesignJob: () => job,
    getLatestActiveDesignRevision: () => null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, job.id);
      job = { ...job, ...patch };
      return job;
    },
    upsertDesignImages: () => {
      upsertCalled = true;
      return [];
    },
    createReviewLog: (payload) => {
      reviewLogs.push(payload);
      return payload;
    },
  };
  const service = new DesignJobsService(
    {},
    {
      createDesignJob: async () => {
        retrySubmitCalled = true;
        return { externalJobId: "should_not_retry" };
      },
    },
    localStore,
    { create: async () => ({}) },
    {
      saveDesignImage: async (jobId, imageId) => {
        saveAttempts.push({ jobId, imageId });
        throw new Error("download failed");
      },
    },
    {
      setConversationManualLock: async (conversationId, payload) => {
        manualLocks.push({ conversationId, payload });
        return { blockedSendTasks: [], inFlightSendTasks: [] };
      },
    },
    {},
    {},
  );

  try {
    const updated = await service.handleDesignPlatformCallback({
      requestId: "request_local_save_manual",
      externalJobId: "external_retry",
      status: "completed",
      images: [
        { imageId: "candidate_1", downloadUrl: "https://example.test/candidate-1.png", width: 1024, height: 1024 },
        { imageId: "candidate_2", downloadUrl: "https://example.test/candidate-2.png", width: 1024, height: 1024 },
        { imageId: "candidate_3", downloadUrl: "https://example.test/candidate-3.png", width: 1024, height: 1024 },
        { imageId: "candidate_4", downloadUrl: "https://example.test/candidate-4.png", width: 1024, height: 1024 },
      ],
    });

    assert.equal(updated.status, "manual_review");
    assert.match(job.errorMessage, /saved only 0 local image files/);
    assert.equal(reviewLogs.at(-1).decision, "design_platform_local_image_save_failed");
    assert.equal(manualLocks.at(-1).conversationId, "conversation_1");
    assert.equal(manualLocks.at(-1).payload.reason, "design_platform_local_image_save_failed");
    assert.equal(retrySubmitCalled, false);
    assert.equal(saveAttempts.length, 4);
    assert.equal(upsertCalled, false);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("initial design callback retries invalid image metadata before saving files", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let storageCalled = false;
  let upsertCalled = false;
  const createPayloads = [];
  const notifications = [];
  let job = {
    id: "design_invalid_metadata_retry",
    requestId: "request_invalid_metadata_retry",
    externalJobId: "external_original",
    status: "submitted",
    isHighValue: false,
    manualQcRequired: true,
    retryCount: 0,
    revisionCount: 0,
    outputCount: 6,
    budget: { mode: "per_box", perUnitAmount: 200, quantity: 10, totalAmount: 2000 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    assets: [],
    images: [],
  };
  const localStore = {
    getDesignJob: () => job,
    getLatestActiveDesignRevision: () => null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, job.id);
      job = { ...job, ...patch };
      return job;
    },
    upsertDesignImages: () => {
      upsertCalled = true;
      return [];
    },
  };
  const service = new DesignJobsService(
    {},
    {
      createDesignJob: async (payload) => {
        createPayloads.push(payload);
        return { externalJobId: "external_retry" };
      },
    },
    localStore,
    {
      create: async (level, title, body, metadata) => {
        notifications.push({ level, title, body, metadata });
        return { id: `notice_${notifications.length}` };
      },
    },
    {
      saveDesignImage: async () => {
        storageCalled = true;
        return "C:\\storage\\design-jobs\\candidate.png";
      },
    },
    {},
    {},
    {},
  );
  service.assertDesignPlatformPreflight = async () => ({ ok: true });
  service.scheduleResultPoll = () => {};

  try {
    const updated = await service.handleDesignPlatformCallback({
      requestId: "request_invalid_metadata_retry",
      externalJobId: "external_original",
      status: "completed",
      images: [
        { imageId: "candidate_1", downloadUrl: "https://example.test/candidate-1.png", width: 1024, height: 1024 },
        { imageId: "candidate_1", downloadUrl: "https://example.test/candidate-2.png", width: 1024, height: 1024 },
        { imageId: "candidate_3", downloadUrl: "https://example.test/candidate-3.png", width: 1024, height: 1024 },
        { imageId: "candidate_4", downloadUrl: "https://example.test/candidate-4.png", width: 1024, height: 1024 },
      ],
    });

    assert.equal(updated.status, "submitted");
    assert.equal(updated.retryCount, 1);
    assert.equal(updated.externalJobId, "external_retry");
    assert.equal(createPayloads.length, 1);
    assert.equal(storageCalled, false);
    assert.equal(upsertCalled, false);
    assert.equal(
      notifications.some((notice) => notice.metadata?.invalidImageReasons?.some((reason) => reason.includes("duplicate imageId"))),
      true,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("initial design callback hands to manual review when invalid image metadata repeats", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let storageCalled = false;
  let upsertCalled = false;
  let retrySubmitCalled = false;
  const reviewLogs = [];
  const manualLocks = [];
  let job = {
    id: "design_invalid_metadata_manual",
    requestId: "request_invalid_metadata_manual",
    externalJobId: "external_retry",
    status: "submitted",
    conversationId: "conversation_1",
    isHighValue: false,
    manualQcRequired: true,
    retryCount: 1,
    revisionCount: 0,
    outputCount: 6,
    budget: { mode: "per_box", perUnitAmount: 200, quantity: 10, totalAmount: 2000 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    assets: [],
    images: [],
  };
  const localStore = {
    getDesignJob: () => job,
    getLatestActiveDesignRevision: () => null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, job.id);
      job = { ...job, ...patch };
      return job;
    },
    upsertDesignImages: () => {
      upsertCalled = true;
      return [];
    },
    createReviewLog: (payload) => {
      reviewLogs.push(payload);
      return payload;
    },
  };
  const service = new DesignJobsService(
    {},
    {
      createDesignJob: async () => {
        retrySubmitCalled = true;
        return { externalJobId: "should_not_retry" };
      },
    },
    localStore,
    { create: async () => ({}) },
    {
      saveDesignImage: async () => {
        storageCalled = true;
        return "C:\\storage\\design-jobs\\candidate.png";
      },
    },
    {
      setConversationManualLock: async (conversationId, payload) => {
        manualLocks.push({ conversationId, payload });
        return { blockedSendTasks: [], inFlightSendTasks: [] };
      },
    },
    {},
    {},
  );

  try {
    const updated = await service.handleDesignPlatformCallback({
      requestId: "request_invalid_metadata_manual",
      externalJobId: "external_retry",
      status: "completed",
      images: [
        { imageId: "candidate_1", downloadUrl: "https://example.test/same.png", width: 1024, height: 1024 },
        { imageId: "candidate_2", downloadUrl: "https://example.test/same.png", width: 1024, height: 1024 },
        { imageId: "candidate_3", downloadUrl: "https://example.test/candidate-3.png", width: 1024, height: 1024 },
        { imageId: "candidate_4", downloadUrl: "https://example.test/candidate-4.png", width: 1024, height: 1024 },
      ],
    });

    assert.equal(updated.status, "manual_review");
    assert.match(job.errorMessage, /invalid image metadata/);
    assert.equal(reviewLogs.at(-1).decision, "design_platform_invalid_image_metadata");
    assert.equal(manualLocks.at(-1).conversationId, "conversation_1");
    assert.equal(manualLocks.at(-1).payload.reason, "design_platform_invalid_image_metadata");
    assert.equal(retrySubmitCalled, false);
    assert.equal(storageCalled, false);
    assert.equal(upsertCalled, false);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("revision callback saves local files with versioned image ids", async (t) => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  t.after(() => { appConfig.useLocalStore = previousUseLocalStore; });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-revision-images-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const saved = [];
  let upsertedImages = [];
  const job = {
    id: "design_1",
    requestId: "request_1",
    externalJobId: "external_1",
    status: "submitted",
    isHighValue: false,
    manualQcRequired: true,
    retryCount: 0,
    revisionCount: 1,
    budget: { mode: "per_box", perUnitAmount: 100, quantity: 10, totalAmount: 1000 },
    images: [],
  };
  const localStore = {
    getDesignJob: () => job,
    getLatestActiveDesignRevision: () => ({
      id: "revision_1",
      designJobId: "design_1",
      status: "submitted",
    }),
    updateDesignRevision: (id, patch) => ({ id, ...patch }),
    updateDesignJob: (id, patch) => Object.assign(job, { id, ...patch, images: upsertedImages }),
    upsertDesignImages: (designJobId, images) => {
      upsertedImages = images.map((image) => ({ ...image, designJobId }));
      return upsertedImages;
    },
  };
  const service = new DesignJobsService(
    {},
    {},
    localStore,
    { create: async () => ({}) },
    {
      saveDesignImage: async (jobId, imageId, downloadUrl) => {
        saved.push({ jobId, imageId, downloadUrl });
        return writeImageFixture(tempRoot, jobId, imageId);
      },
    },
    {},
    {},
    {},
  );

  const updated = await service.handleDesignPlatformCallback({
    requestId: "request_1",
    externalJobId: "external_1",
    status: "completed",
    images: [1, 2, 3, 4].map((position) => ({
      imageId: `candidate_${position}`,
      downloadUrl: `https://example.test/revision-candidate-${position}.png`,
      width: 1024,
      height: 1024,
    })),
  });

  assert.equal(saved[0].imageId, "r1-candidate_1");
  assert.equal(saved.length, 4);
  assert.equal(upsertedImages[0].imageId, "r1-candidate_1");
  assert.match(upsertedImages[0].localPath, /r1-candidate_1\.png$/);
  assert.equal(updated.images[0].imageId, "r1-candidate_1");
});

test("revision callback does not double-prefix already versioned image ids", async (t) => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  t.after(() => { appConfig.useLocalStore = previousUseLocalStore; });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-revision-versioned-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const saved = [];
  let upsertedImages = [];
  const job = {
    id: "design_1",
    requestId: "request_1",
    externalJobId: "external_1",
    status: "submitted",
    isHighValue: false,
    manualQcRequired: true,
    retryCount: 0,
    revisionCount: 1,
    budget: { mode: "per_box", perUnitAmount: 100, quantity: 10, totalAmount: 1000 },
    images: [],
  };
  const localStore = {
    getDesignJob: () => job,
    getLatestActiveDesignRevision: () => ({
      id: "revision_1",
      designJobId: "design_1",
      status: "submitted",
    }),
    updateDesignRevision: (id, patch) => ({ id, ...patch }),
    updateDesignJob: (id, patch) => Object.assign(job, { id, ...patch, images: upsertedImages }),
    upsertDesignImages: (designJobId, images) => {
      upsertedImages = images.map((image) => ({ ...image, designJobId }));
      return upsertedImages;
    },
  };
  const service = new DesignJobsService(
    {},
    {},
    localStore,
    { create: async () => ({}) },
    {
      saveDesignImage: async (jobId, imageId, downloadUrl) => {
        saved.push({ jobId, imageId, downloadUrl });
        return writeImageFixture(tempRoot, jobId, imageId);
      },
    },
    {},
    {},
    {},
  );

  const updated = await service.handleDesignPlatformCallback({
    requestId: "request_1",
    externalJobId: "external_1",
    status: "completed",
    images: [1, 2, 3, 4].map((position) => ({
      imageId: `r1-candidate_${position}`,
      downloadUrl: `https://example.test/revision-candidate-${position}.png`,
      width: 1024,
      height: 1024,
    })),
  });

  assert.equal(saved[0].imageId, "r1-candidate_1");
  assert.equal(saved.length, 4);
  assert.equal(upsertedImages[0].imageId, "r1-candidate_1");
  assert.match(upsertedImages[0].localPath, /r1-candidate_1\.png$/);
  assert.equal(updated.images[0].imageId, "r1-candidate_1");
});
