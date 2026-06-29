"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");

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
