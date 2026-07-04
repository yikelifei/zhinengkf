"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

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
  ]);
  assert.deepEqual(updatedPatch, { status: "sent", sendTaskId: "send_1" });
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

test("initial design callback retries when local image files are below minimum", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

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
        if (imageId === "candidate_1") return `C:\\storage\\design-jobs\\${jobId}\\${imageId}.png`;
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

test("revision callback saves local files with versioned image ids", async () => {
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
    updateDesignJob: (id, patch) => ({ ...job, id, ...patch, images: upsertedImages }),
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
        return `C:\\storage\\design-jobs\\${jobId}\\${imageId}.png`;
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
    images: [
      {
        imageId: "candidate_1",
        downloadUrl: "https://example.test/revision-candidate-1.png",
        width: 1024,
        height: 1024,
      },
    ],
  });

  assert.equal(saved[0].imageId, "r1-candidate_1");
  assert.equal(upsertedImages[0].imageId, "r1-candidate_1");
  assert.match(upsertedImages[0].localPath, /r1-candidate_1\.png$/);
  assert.equal(updated.images[0].imageId, "r1-candidate_1");
});
