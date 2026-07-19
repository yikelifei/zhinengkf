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

test("polling a legacy local job without durable execution requires manual review and never retries", async () => {
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
    createReviewLog: () => ({}),
  };
  const designPlatform = {
    isArtImageLocalAdapter: () => true,
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
  const executions = {
    recoverStaleExecutions: async () => [],
    takeoverPreparedExecutions: async () => [],
    listCompletedPending: async () => [],
    get: async () => null,
  };
  const wechatDispatch = {
    setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }),
  };
  const notifications = {
    create: async (...args) => {
      notices.push(args);
      return { id: `notice-${notices.length}` };
    },
  };

  try {
    const service = new DesignJobsService({}, designPlatform, localStore, notifications, {}, wechatDispatch, {}, {}, executions);
    service.assertDesignPlatformPreflight = async () => ({ ok: true });
    service.scheduleResultPoll = () => {};

    const result = await service.pollActiveResults(10);

    assert.equal(createDesignJobCalled, false);
    assert.equal(result.failed.length, 0);
    assert.equal(result.retried.length, 0);
    assert.equal(result.outcomeUnknown.length, 1);
    assert.equal(result.outcomeUnknown[0].status, "manual_review");
    assert.equal(result.outcomeUnknown[0].retryCount, 0);
    assert.equal(notices.some((notice) => String(notice[2]).includes("禁止自动重试")), true);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("single polling a legacy local job marks outcome_unknown without automatic retry", async () => {
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
    createReviewLog: () => ({}),
  };
  const designPlatform = {
    isArtImageLocalAdapter: () => true,
    getDesignJobResults: async () => ({
      externalJobId: "art_single_lost_after_restart_1",
      status: "failed",
      images: [],
      errorMessage: "local design platform job state was lost",
    }),
    createDesignJob: async () => ({ externalJobId: "art_single_retry_after_restart_1" }),
  };
  const executions = { get: async () => null };
  const wechatDispatch = {
    setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }),
  };
  const notifications = {
    create: async () => ({ id: "notice-1" }),
  };

  try {
    const service = new DesignJobsService({}, designPlatform, localStore, notifications, {}, wechatDispatch, {}, {}, executions);
    service.assertDesignPlatformPreflight = async () => ({ ok: true });
    service.scheduleResultPoll = () => {};

    const result = await service.pollResult(designJob.id);

    assert.equal(result.remoteStatus, "outcome_unknown");
    assert.equal(result.autoRetried, false);
    assert.equal(result.job.status, "manual_review");
    assert.equal(result.job.retryCount, 0);
    assert.equal(result.job.externalJobId, "art_single_lost_after_restart_1");
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

test("failed revision callback retries with the same revision instruction", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-revision-failed-retry",
    requestId: "request-revision-failed-retry",
    externalJobId: "revision_external_original",
    status: "submitted",
    retryCount: 0,
    revisionCount: 1,
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
  let revision = {
    id: "revision-1",
    designJobId: designJob.id,
    selectedImageId: "image-1",
    revisionNumber: 1,
    instruction: "把 Logo 放大一点，整体更商务",
    sourceText: "客户说 Logo 放大一点",
    status: "submitted",
    externalJobId: "revision_external_original",
  };
  const submittedPayloads = [];
  const revisionUpdates = [];

  const localStore = {
    getDesignJob: () => designJob,
    getLatestActiveDesignRevision: () =>
      ["submitted", "generating"].includes(revision.status) ? revision : null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, designJob.id);
      designJob = { ...designJob, ...patch };
      return designJob;
    },
    updateDesignRevision: (id, patch) => {
      assert.equal(id, revision.id);
      revision = { ...revision, ...patch };
      revisionUpdates.push({ ...patch });
      return revision;
    },
  };
  const designPlatform = {
    getDesignJobResults: async () => ({
      externalJobId: "revision_external_original",
      status: "failed",
      errorMessage: "revision render failed",
    }),
    createDesignJob: async (payload) => {
      submittedPayloads.push(payload);
      return { externalJobId: "revision_external_retry" };
    },
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
    assert.equal(result.job.externalJobId, "revision_external_retry");
    assert.equal(revision.status, "submitted");
    assert.equal(revision.externalJobId, "revision_external_retry");
    assert.equal(submittedPayloads.length, 1);
    assert.equal(submittedPayloads[0].revision.instruction, "把 Logo 放大一点，整体更商务");
    assert.equal(submittedPayloads[0].revision.selectedImageId, "image-1");
    assert.equal(revisionUpdates.some((patch) => patch.status === "failed"), true);
    assert.equal(revisionUpdates.at(-1).status, "submitted");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("empty revision callback retries with the same revision instruction", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-revision-empty-retry",
    requestId: "request-revision-empty-retry",
    externalJobId: "revision_empty_original",
    status: "submitted",
    retryCount: 0,
    revisionCount: 1,
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
  let revision = {
    id: "revision-empty-1",
    designJobId: designJob.id,
    selectedImageId: "image-2",
    revisionNumber: 1,
    instruction: "背景换成浅色，礼盒放中间",
    sourceText: "客户说背景浅一点",
    status: "submitted",
    externalJobId: "revision_empty_original",
  };
  const submittedPayloads = [];

  const localStore = {
    getDesignJob: () => designJob,
    getLatestActiveDesignRevision: () =>
      ["submitted", "generating"].includes(revision.status) ? revision : null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, designJob.id);
      designJob = { ...designJob, ...patch };
      return designJob;
    },
    updateDesignRevision: (id, patch) => {
      assert.equal(id, revision.id);
      revision = { ...revision, ...patch };
      return revision;
    },
  };
  const designPlatform = {
    getDesignJobResults: async () => ({
      externalJobId: "revision_empty_original",
      status: "completed",
      images: [],
    }),
    createDesignJob: async (payload) => {
      submittedPayloads.push(payload);
      return { externalJobId: "revision_empty_retry" };
    },
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
    assert.equal(result.job.externalJobId, "revision_empty_retry");
    assert.equal(revision.status, "submitted");
    assert.equal(revision.externalJobId, "revision_empty_retry");
    assert.equal(submittedPayloads[0].revision.instruction, "背景换成浅色，礼盒放中间");
    assert.equal(submittedPayloads[0].revision.selectedImageId, "image-2");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("invalid revision callback metadata retries with the same revision instruction", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-revision-invalid-metadata-retry",
    requestId: "request-revision-invalid-metadata-retry",
    externalJobId: "revision_invalid_metadata_original",
    status: "submitted",
    retryCount: 0,
    revisionCount: 1,
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
  let revision = {
    id: "revision-invalid-metadata-1",
    designJobId: designJob.id,
    selectedImageId: "image-3",
    revisionNumber: 1,
    instruction: "换成红色礼盒，整体更喜庆",
    sourceText: "客户说想要红色礼盒",
    status: "submitted",
    externalJobId: "revision_invalid_metadata_original",
  };
  const submittedPayloads = [];

  const localStore = {
    getDesignJob: () => designJob,
    getLatestActiveDesignRevision: () =>
      ["submitted", "generating"].includes(revision.status) ? revision : null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, designJob.id);
      designJob = { ...designJob, ...patch };
      return designJob;
    },
    updateDesignRevision: (id, patch) => {
      assert.equal(id, revision.id);
      revision = { ...revision, ...patch };
      return revision;
    },
    upsertDesignImages: () => {
      throw new Error("invalid revision metadata should not be saved");
    },
  };
  const designPlatform = {
    getDesignJobResults: async () => ({
      externalJobId: "revision_invalid_metadata_original",
      status: "completed",
      images: [
        { imageId: "candidate_1", downloadUrl: "https://example.test/same.png", width: 1024, height: 1024 },
        { imageId: "candidate_2", downloadUrl: "https://example.test/same.png", width: 1024, height: 1024 },
      ],
    }),
    createDesignJob: async (payload) => {
      submittedPayloads.push(payload);
      return { externalJobId: "revision_invalid_metadata_retry" };
    },
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
    assert.equal(result.job.externalJobId, "revision_invalid_metadata_retry");
    assert.equal(revision.status, "submitted");
    assert.equal(revision.externalJobId, "revision_invalid_metadata_retry");
    assert.equal(submittedPayloads[0].revision.instruction, "换成红色礼盒，整体更喜庆");
    assert.equal(submittedPayloads[0].revision.selectedImageId, "image-3");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("revision local image save failure retries with the same revision instruction", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-revision-local-save-retry",
    requestId: "request-revision-local-save-retry",
    externalJobId: "revision_local_save_original",
    status: "submitted",
    retryCount: 0,
    revisionCount: 1,
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
  let revision = {
    id: "revision-local-save-1",
    designJobId: designJob.id,
    selectedImageId: "image-4",
    revisionNumber: 1,
    instruction: "保留原商品，把画面做得更高级",
    sourceText: "客户说想更高级一点",
    status: "submitted",
    externalJobId: "revision_local_save_original",
  };
  const submittedPayloads = [];
  let upsertCalled = false;

  const localStore = {
    getDesignJob: () => designJob,
    getLatestActiveDesignRevision: () =>
      ["submitted", "generating"].includes(revision.status) ? revision : null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, designJob.id);
      designJob = { ...designJob, ...patch };
      return designJob;
    },
    updateDesignRevision: (id, patch) => {
      assert.equal(id, revision.id);
      revision = { ...revision, ...patch };
      return revision;
    },
    upsertDesignImages: () => {
      upsertCalled = true;
      return [];
    },
  };
  const designPlatform = {
    getDesignJobResults: async () => ({
      externalJobId: "revision_local_save_original",
      status: "completed",
      images: [
        { imageId: "candidate_1", downloadUrl: "https://example.test/revision-1.png", width: 1024, height: 1024 },
      ],
    }),
    createDesignJob: async (payload) => {
      submittedPayloads.push(payload);
      return { externalJobId: "revision_local_save_retry" };
    },
  };
  const notifications = {
    create: async () => ({ id: "notice-1" }),
  };
  const storage = {
    saveDesignImage: async () => {
      throw new Error("download failed");
    },
  };

  try {
    const service = new DesignJobsService({}, designPlatform, localStore, notifications, storage, {}, {}, {});
    service.assertDesignPlatformPreflight = async () => ({ ok: true });
    service.scheduleResultPoll = () => {};

    const result = await service.pollResult(designJob.id);

    assert.equal(result.remoteStatus, "completed");
    assert.equal(result.autoRetried, true);
    assert.equal(result.job.status, "submitted");
    assert.equal(result.job.externalJobId, "revision_local_save_retry");
    assert.equal(revision.status, "submitted");
    assert.equal(revision.externalJobId, "revision_local_save_retry");
    assert.equal(upsertCalled, false);
    assert.equal(submittedPayloads[0].revision.instruction, "保留原商品，把画面做得更高级");
    assert.equal(submittedPayloads[0].revision.selectedImageId, "image-4");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("revision retry is independent from an earlier initial design retry", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-revision-independent-retry",
    requestId: "request-revision-independent-retry",
    externalJobId: "revision_independent_original",
    status: "submitted",
    retryCount: 1,
    revisionCount: 1,
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
  let revision = {
    id: "revision-independent-1",
    designJobId: designJob.id,
    selectedImageId: "image-independent-1",
    revisionNumber: 1,
    instruction: "make the selected render more premium and keep the same products",
    sourceText: "customer wants a more premium look",
    status: "submitted",
    retryCount: 0,
    externalJobId: "revision_independent_original",
  };
  const submittedPayloads = [];

  const localStore = {
    getDesignJob: () => designJob,
    getLatestActiveDesignRevision: () =>
      ["submitted", "generating"].includes(revision.status) ? revision : null,
    updateDesignJob: (id, patch) => {
      assert.equal(id, designJob.id);
      designJob = { ...designJob, ...patch };
      return designJob;
    },
    updateDesignRevision: (id, patch) => {
      assert.equal(id, revision.id);
      revision = { ...revision, ...patch };
      return revision;
    },
  };
  const designPlatform = {
    getDesignJobResults: async () => ({
      externalJobId: "revision_independent_original",
      status: "failed",
      errorMessage: "revision render failed after initial retry",
    }),
    createDesignJob: async (payload) => {
      submittedPayloads.push(payload);
      return { externalJobId: "revision_independent_retry" };
    },
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
    assert.equal(result.job.retryCount, 2);
    assert.equal(result.job.externalJobId, "revision_independent_retry");
    assert.equal(revision.status, "submitted");
    assert.equal(revision.retryCount, 1);
    assert.equal(revision.externalJobId, "revision_independent_retry");
    assert.equal(submittedPayloads.length, 1);
    assert.equal(
      submittedPayloads[0].revision.instruction,
      "make the selected render more premium and keep the same products",
    );
    assert.equal(submittedPayloads[0].revision.selectedImageId, "image-independent-1");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("manual retry of a failed revision preserves the revision instruction", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-manual-retry-failed-revision",
    requestId: "request-manual-retry-failed-revision",
    externalJobId: "revision_manual_failed_external",
    status: "manual_review",
    retryCount: 2,
    revisionCount: 1,
    errorMessage: "revision failed after automatic retry",
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
  let revision = {
    id: "revision-manual-retry-1",
    designJobId: designJob.id,
    selectedImageId: "image-manual-retry-1",
    revisionNumber: 1,
    instruction: "make the selected render warmer and more suitable for VIP gifting",
    sourceText: "customer wants a warmer VIP look",
    status: "failed",
    retryCount: 1,
    externalJobId: "revision_manual_failed_external",
  };
  const submittedPayloads = [];

  const localStore = {
    getDesignJob: () => designJob,
    listDesignRevisions: () => [revision],
    updateDesignJob: (id, patch) => {
      assert.equal(id, designJob.id);
      designJob = { ...designJob, ...patch };
      return designJob;
    },
    updateDesignRevision: (id, patch) => {
      assert.equal(id, revision.id);
      revision = { ...revision, ...patch };
      return revision;
    },
  };
  const designPlatform = {
    createDesignJob: async (payload) => {
      submittedPayloads.push(payload);
      return { externalJobId: "revision_manual_retry_external" };
    },
  };
  const notifications = {
    create: async () => ({ id: "notice-1" }),
  };

  try {
    const service = new DesignJobsService({}, designPlatform, localStore, notifications, {}, {}, {}, {});
    service.assertDesignPlatformPreflight = async () => ({ ok: true });
    service.scheduleResultPoll = () => {};

    const updated = await service.retry(designJob.id, {
      expectedWechatAccountId: "wechat-1",
      expectedConversationId: "conversation-1",
      expectedCustomerId: "customer-1",
    });

    assert.equal(updated.status, "submitted");
    assert.equal(updated.retryCount, 3);
    assert.equal(updated.externalJobId, "revision_manual_retry_external");
    assert.equal(revision.status, "submitted");
    assert.equal(revision.retryCount, 2);
    assert.equal(revision.externalJobId, "revision_manual_retry_external");
    assert.equal(submittedPayloads.length, 1);
    assert.equal(
      submittedPayloads[0].revision.instruction,
      "make the selected render warmer and more suitable for VIP gifting",
    );
    assert.equal(submittedPayloads[0].revision.selectedImageId, "image-manual-retry-1");
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});
