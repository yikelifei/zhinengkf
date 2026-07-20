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

function createService({ job, designPlatform = {}, storage = {}, notifications = [], localStoreOverrides = {} }) {
  const localStore = {
    getDesignJob: (id) => (id === job.id || id === job.requestId ? job : null),
    updateDesignJob: (id, patch) => {
      assert.equal(id, job.id);
      Object.assign(job, patch);
      return job;
    },
    upsertDesignImages: () => {
      throw new Error("terminal design job callback must not save images");
    },
    ...localStoreOverrides,
  };
  return new DesignJobsService(
    {},
    designPlatform,
    localStore,
    { create: async (...args) => notifications.push(args) },
    storage,
    {},
    {},
    {},
  );
}

test("design job cancel refuses irreversible customer-facing statuses before remote cancel", async () => {
  const previous = { useLocalStore: appConfig.useLocalStore };
  const job = {
    id: "design-cancel-blocked-1",
    requestId: "request-cancel-blocked-1",
    externalJobId: "external-cancel-blocked-1",
    status: "quote_created",
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
  };
  let remoteCancelCalled = false;

  try {
    appConfig.useLocalStore = true;
    const service = createService({
      job,
      designPlatform: {
        cancelDesignJob: async () => {
          remoteCancelCalled = true;
          return { status: "cancelled" };
        },
      },
    });

    await assert.rejects(
      () => service.cancel(job.id, {
        wechatAccountId: job.wechatAccountId,
        conversationId: job.conversationId,
        customerId: job.customerId,
      }),
      /design job cannot be cancelled/,
    );

    assert.equal(remoteCancelCalled, false);
    assert.equal(job.status, "quote_created");
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("cancelled design job ignores late completed callbacks without saving images", async () => {
  const previous = { useLocalStore: appConfig.useLocalStore };
  const job = {
    id: "design-cancel-late-callback-1",
    requestId: "request-cancel-late-callback-1",
    externalJobId: "external-cancel-late-callback-1",
    status: "cancelled",
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
  };
  const notifications = [];
  let savedImage = false;

  try {
    appConfig.useLocalStore = true;
    const service = createService({
      job,
      notifications,
      storage: {
        saveDesignImage: async () => {
          savedImage = true;
          return "storage/design-cancel-late-callback-1/image-1.png";
        },
      },
    });

    const result = await service.handleDesignPlatformCallback({
      requestId: job.requestId,
      externalJobId: job.externalJobId,
      status: "completed",
      images: [{ imageId: "candidate-1", downloadUrl: "http://127.0.0.1:3700/result.png", width: 1024, height: 1024 }],
    });

    assert.equal(result, job);
    assert.equal(job.status, "cancelled");
    assert.equal(savedImage, false);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0][1], "已忽略取消任务回调");
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("customer-facing terminal design jobs ignore late callbacks after quote creation", async () => {
  const previous = { useLocalStore: appConfig.useLocalStore };
  const job = {
    id: "design-terminal-late-callback-1",
    requestId: "request-terminal-late-callback-1",
    externalJobId: "external-terminal-late-callback-1",
    status: "quote_created",
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
  };
  const notifications = [];
  let savedImage = false;

  try {
    appConfig.useLocalStore = true;
    const service = createService({
      job,
      notifications,
      storage: {
        saveDesignImage: async () => {
          savedImage = true;
          return "storage/design-terminal-late-callback-1/image-1.png";
        },
      },
    });

    const result = await service.handleDesignPlatformCallback({
      requestId: job.requestId,
      externalJobId: job.externalJobId,
      status: "completed",
      images: [{ imageId: "candidate-1", downloadUrl: "http://127.0.0.1:3700/result.png", width: 1024, height: 1024 }],
    });

    assert.equal(result, job);
    assert.equal(job.status, "quote_created");
    assert.equal(savedImage, false);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0][1], "已忽略终态任务回调");
    assert.equal(notifications[0][3].designJobStatus, "quote_created");
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("polling terminal design jobs does not query platform or overwrite local status", async () => {
  const previous = { useLocalStore: appConfig.useLocalStore };
  const job = {
    id: "design-terminal-poll-1",
    requestId: "request-terminal-poll-1",
    externalJobId: "external-terminal-poll-1",
    status: "quote_created",
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
  };
  const notifications = [];
  let remotePolled = false;

  try {
    appConfig.useLocalStore = true;
    const service = createService({
      job,
      notifications,
      designPlatform: {
        getDesignJobResults: async () => {
          remotePolled = true;
          return { status: "cancelled" };
        },
      },
    });

    const result = await service.pollResult(job.id, {
      wechatAccountId: job.wechatAccountId,
      conversationId: job.conversationId,
      customerId: job.customerId,
    });

    assert.equal(remotePolled, false);
    assert.equal(result.remoteStatus, "terminal");
    assert.equal(result.result.reason, "terminal_design_job");
    assert.equal(result.job.status, "quote_created");
    assert.equal(job.status, "quote_created");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0][1], "已跳过终态任务轮询");
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("manual retry refuses customer-facing terminal design jobs before platform submit", async () => {
  const previous = { useLocalStore: appConfig.useLocalStore };
  const job = {
    id: "design-terminal-retry-1",
    requestId: "request-terminal-retry-1",
    externalJobId: "external-terminal-retry-1",
    status: "sent",
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
  };
  let remoteSubmitted = false;

  try {
    appConfig.useLocalStore = true;
    const service = createService({
      job,
      designPlatform: {
        createDesignJob: async () => {
          remoteSubmitted = true;
          return { externalJobId: "external-retry-new" };
        },
      },
    });

    await assert.rejects(
      () =>
        service.retry(job.id, {
          wechatAccountId: job.wechatAccountId,
          conversationId: job.conversationId,
          customerId: job.customerId,
        }),
      /design job cannot be retried/,
    );

    assert.equal(remoteSubmitted, false);
    assert.equal(job.status, "sent");
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("revision request refuses customer-facing terminal design jobs before creating revision", async () => {
  const previous = { useLocalStore: appConfig.useLocalStore };
  const job = {
    id: "design-terminal-revision-1",
    requestId: "request-terminal-revision-1",
    externalJobId: "external-terminal-revision-1",
    status: "quote_created",
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    isHighValue: false,
    budget: { mode: "per_box", amount: 200, quantity: 50 },
  };
  let remoteSubmitted = false;
  let revisionStoreTouched = false;

  try {
    appConfig.useLocalStore = true;
    const service = createService({
      job,
      designPlatform: {
        createDesignJob: async () => {
          remoteSubmitted = true;
          return { externalJobId: "external-revision-new" };
        },
      },
      localStoreOverrides: {
        listDesignRevisions: () => [],
        createDesignRevision: () => {
          revisionStoreTouched = true;
          throw new Error("terminal design job revision must not be created");
        },
      },
    });

    await assert.rejects(
      () =>
        service.requestRevision(job.id, {
          operationKey: "test-revision-terminal-blocked-1",
          wechatAccountId: job.wechatAccountId,
          conversationId: job.conversationId,
          customerId: job.customerId,
          instruction: "把背景改成暖色",
        }),
      /design job cannot request revision/,
    );

    assert.equal(remoteSubmitted, false);
    assert.equal(revisionStoreTouched, false);
    assert.equal(job.status, "quote_created");
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("revision request still allows sent design jobs before quote creation", async () => {
  const previous = { useLocalStore: appConfig.useLocalStore };
  let job = {
    id: "design-sent-revision-1",
    requestId: "request-sent-revision-1",
    externalJobId: "external-sent-revision-1",
    status: "sent",
    wechatAccountId: "",
    conversationId: "",
    customerId: "customer-1",
    isHighValue: false,
    budget: { mode: "per_box", amount: 200, quantity: 50 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    assets: [],
    images: [{ id: "image-1", imageId: "candidate_1", selected: true }],
    outputCount: 6,
    renderStyle: "real product photo",
    customerText: "客户想看礼盒效果图",
  };
  let revision = null;
  let remoteSubmitted = false;

  try {
    appConfig.useLocalStore = true;
    const service = createService({
      job,
      designPlatform: {
        createDesignJob: async (payload) => {
          remoteSubmitted = true;
          assert.equal(payload.revision.instruction, "把背景改成暖色");
          return { externalJobId: "external-revision-new" };
        },
      },
      localStoreOverrides: {
        getDesignJob: () => job,
        listDesignRevisions: () => (revision ? [revision] : []),
        createDesignRevision: (payload) => {
          revision = { id: "revision-1", ...payload };
          return revision;
        },
        updateDesignRevision: (id, patch) => {
          assert.equal(id, revision.id);
          revision = { ...revision, ...patch };
          return revision;
        },
        updateDesignJob: (id, patch) => {
          assert.equal(id, job.id);
          job = { ...job, ...patch };
          return job;
        },
      },
    });
    service.assertDesignPlatformPreflight = async () => ({ ok: true });
    service.scheduleResultPoll = () => {};

    const result = await service.requestRevision(job.id, {
      operationKey: "test-revision-sent-allowed-1",
      instruction: "把背景改成暖色",
    });

    assert.equal(remoteSubmitted, true);
    assert.equal(result.revision.status, "submitted");
    assert.equal(result.job.status, "submitted");
    assert.equal(result.job.externalJobId, "external-revision-new");
  } finally {
    Object.assign(appConfig, previous);
  }
});
