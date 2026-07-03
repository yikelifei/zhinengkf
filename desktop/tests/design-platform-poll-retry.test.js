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

test("polling a lost local design-platform job triggers retry instead of failed summary", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-lost-local-job",
    requestId: "request-lost-local-job",
    externalJobId: "art_lost_after_restart_1",
    status: "submitted",
    retryCount: 0,
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    budget: { mode: "per_box", amount: 200, quantity: 20 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    assets: [],
    outputCount: 6,
    renderStyle: "real product photo",
    customerText: "need gift box render",
  };
  const notices = [];
  let createDesignJobCalled = false;

  const localStore = {
    listDesignJobs: () => [designJob],
    getDesignJob: () => designJob,
    getLatestActiveDesignRevision: () => null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, designJob.id);
      designJob = { ...designJob, ...patch };
      return designJob;
    },
  };
  const designPlatform = {
    getDesignJobResults: async () => ({
      externalJobId: "art_lost_after_restart_1",
      status: "failed",
      images: [],
      errorMessage: "local design platform job state was lost",
    }),
    createDesignJob: async () => {
      createDesignJobCalled = true;
      return { externalJobId: "art_retry_after_restart_1" };
    },
  };
  const notifications = {
    create: async (...args) => {
      notices.push(args);
      return { id: `notice-${notices.length}` };
    },
  };

  try {
    const service = new DesignJobsService({}, designPlatform, localStore, notifications, {}, {}, {}, {});
    service.assertDesignPlatformPreflight = async () => ({ ok: true });
    service.scheduleResultPoll = () => {};

    const result = await service.pollActiveResults(10);

    assert.equal(createDesignJobCalled, true);
    assert.equal(result.failed.length, 0);
    assert.equal(result.retried.length, 1);
    assert.equal(result.retried[0].externalJobId, "art_retry_after_restart_1");
    assert.equal(result.retried[0].status, "submitted");
    assert.equal(result.retried[0].retryCount, 1);
    assert.equal(notices.some((notice) => String(notice[2]).includes("local design platform job state was lost")), true);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("single polling a lost local design-platform job marks automatic retry", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-single-lost-local-job",
    requestId: "request-single-lost-local-job",
    externalJobId: "art_single_lost_after_restart_1",
    status: "submitted",
    retryCount: 0,
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    budget: { mode: "per_box", amount: 200, quantity: 20 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    assets: [],
    outputCount: 6,
    renderStyle: "real product photo",
    customerText: "need gift box render",
  };

  const localStore = {
    getDesignJob: () => designJob,
    getLatestActiveDesignRevision: () => null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, designJob.id);
      designJob = { ...designJob, ...patch };
      return designJob;
    },
  };
  const designPlatform = {
    getDesignJobResults: async () => ({
      externalJobId: "art_single_lost_after_restart_1",
      status: "failed",
      images: [],
      errorMessage: "local design platform job state was lost",
    }),
    createDesignJob: async () => ({ externalJobId: "art_single_retry_after_restart_1" }),
  };
  const notifications = {
    create: async () => ({ id: "notice-1" }),
  };

  try {
    const service = new DesignJobsService({}, designPlatform, localStore, notifications, {}, {}, {}, {});
    service.assertDesignPlatformPreflight = async () => ({ ok: true });
    service.scheduleResultPoll = () => {};

    const result = await service.pollResult(designJob.id);

    assert.equal(result.remoteStatus, "failed");
    assert.equal(result.autoRetried, true);
    assert.equal(result.job.status, "submitted");
    assert.equal(result.job.retryCount, 1);
    assert.equal(result.job.externalJobId, "art_single_retry_after_restart_1");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("polling completed result with invalid image metadata reports retry instead of completed", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-poll-invalid-metadata",
    requestId: "request-poll-invalid-metadata",
    externalJobId: "art_poll_invalid_metadata_1",
    status: "submitted",
    retryCount: 0,
    revisionCount: 0,
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    budget: { mode: "per_box", amount: 200, quantity: 20 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    assets: [],
    images: [],
    outputCount: 6,
    renderStyle: "real product photo",
    customerText: "need gift box render",
  };
  const notices = [];
  let retrySubmitCalled = false;

  const localStore = {
    listDesignJobs: () => [designJob],
    getDesignJob: () => designJob,
    getLatestActiveDesignRevision: () => null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, designJob.id);
      designJob = { ...designJob, ...patch };
      return designJob;
    },
    upsertDesignImages: () => {
      throw new Error("invalid image metadata should not be saved");
    },
  };
  const designPlatform = {
    getDesignJobResults: async () => ({
      externalJobId: "art_poll_invalid_metadata_1",
      status: "completed",
      images: [
        { imageId: "candidate_1", downloadUrl: "https://example.test/candidate-1.png", width: 1024, height: 1024 },
        { imageId: "candidate_1", downloadUrl: "https://example.test/candidate-2.png", width: 1024, height: 1024 },
        { imageId: "candidate_3", downloadUrl: "https://example.test/candidate-3.png", width: 1024, height: 1024 },
        { imageId: "candidate_4", downloadUrl: "https://example.test/candidate-4.png", width: 1024, height: 1024 },
      ],
    }),
    createDesignJob: async () => {
      retrySubmitCalled = true;
      return { externalJobId: "art_poll_invalid_metadata_retry_1" };
    },
  };
  const notifications = {
    create: async (level, title, body, metadata) => {
      const notice = { level, title, body, metadata };
      notices.push(notice);
      return notice;
    },
  };

  try {
    const service = new DesignJobsService({}, designPlatform, localStore, notifications, {}, {}, {}, {});
    service.assertDesignPlatformPreflight = async () => ({ ok: true });
    service.scheduleResultPoll = () => {};

    const result = await service.pollActiveResults(10);

    assert.equal(retrySubmitCalled, true);
    assert.equal(result.completed.length, 0);
    assert.equal(result.failed.length, 0);
    assert.equal(result.retried.length, 1);
    assert.equal(result.retried[0].status, "submitted");
    assert.equal(result.retried[0].retryCount, 1);
    assert.equal(result.retried[0].externalJobId, "art_poll_invalid_metadata_retry_1");
    assert.equal(
      notices.some((notice) => notice.metadata?.invalidImageReasons?.some((reason) => reason.includes("duplicate imageId"))),
      true,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("single polling completed result marks automatic retry when metadata is invalid", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-single-poll-invalid-metadata",
    requestId: "request-single-poll-invalid-metadata",
    externalJobId: "art_single_poll_invalid_metadata_1",
    status: "submitted",
    retryCount: 0,
    revisionCount: 0,
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    budget: { mode: "per_box", amount: 200, quantity: 20 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    assets: [],
    images: [],
    outputCount: 6,
    renderStyle: "real product photo",
    customerText: "need gift box render",
  };

  const localStore = {
    getDesignJob: () => designJob,
    getLatestActiveDesignRevision: () => null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, designJob.id);
      designJob = { ...designJob, ...patch };
      return designJob;
    },
    upsertDesignImages: () => {
      throw new Error("invalid image metadata should not be saved");
    },
  };
  const designPlatform = {
    getDesignJobResults: async () => ({
      externalJobId: "art_single_poll_invalid_metadata_1",
      status: "completed",
      images: [
        { imageId: "candidate_1", downloadUrl: "https://example.test/same.png", width: 1024, height: 1024 },
        { imageId: "candidate_2", downloadUrl: "https://example.test/same.png", width: 1024, height: 1024 },
        { imageId: "candidate_3", downloadUrl: "https://example.test/candidate-3.png", width: 1024, height: 1024 },
        { imageId: "candidate_4", downloadUrl: "https://example.test/candidate-4.png", width: 1024, height: 1024 },
      ],
    }),
    createDesignJob: async () => ({ externalJobId: "art_single_poll_invalid_metadata_retry_1" }),
  };
  const notifications = {
    create: async () => ({ id: "notice-1" }),
  };

  try {
    const service = new DesignJobsService({}, designPlatform, localStore, notifications, {}, {}, {}, {});
    service.assertDesignPlatformPreflight = async () => ({ ok: true });
    service.scheduleResultPoll = () => {};

    const result = await service.pollResult(designJob.id);

    assert.equal(result.remoteStatus, "completed");
    assert.equal(result.autoRetried, true);
    assert.equal(result.job.status, "submitted");
    assert.equal(result.job.retryCount, 1);
    assert.equal(result.job.externalJobId, "art_single_poll_invalid_metadata_retry_1");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});
