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

test("timeout scan polls design platform first and skips timeout notice when result is recovered", async () => {
  const previous = {
    useLocalStore: appConfig.useLocalStore,
    designTimeoutMinutes: appConfig.designTimeoutMinutes,
  };
  const oldSubmittedAt = new Date(Date.now() - 25 * 60 * 1000).toISOString();
  const job = {
    id: "design-timeout-poll-1",
    requestId: "request-timeout-poll-1",
    externalJobId: "external-timeout-poll-1",
    status: "submitted",
    submittedAt: oldSubmittedAt,
    createdAt: oldSubmittedAt,
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
  };
  const notifications = [];
  const queuedMessages = [];
  const localStore = {
    listDesignJobs: () => [job],
    updateDesignJob: (id, patch) => {
      Object.assign(job, patch);
      return job;
    },
  };

  try {
    appConfig.useLocalStore = true;
    appConfig.designTimeoutMinutes = 20;

    const service = new DesignJobsService(
      {},
      {},
      localStore,
      { create: async (...args) => notifications.push(args) },
      {},
      {},
      {},
      {},
    );
    service.pollResult = async (id) => {
      assert.equal(id, job.id);
      return {
        remoteStatus: "completed",
        job: { ...job, status: "quick_confirm" },
        result: { status: "completed" },
      };
    };
    service.queueDesignTextMessage = async (...args) => {
      queuedMessages.push(args);
    };

    const result = await service.scanTimeouts();

    assert.equal(result.scanned, 1);
    assert.equal(result.candidates, 1);
    assert.equal(result.recovered, 1);
    assert.equal(result.timedOut, 0);
    assert.equal(result.jobs.length, 0);
    assert.equal(result.recoveredJobs[0].status, "quick_confirm");
    assert.equal(notifications.length, 0);
    assert.equal(queuedMessages.length, 0);
    assert.equal(job.status, "submitted");
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("timeout scan still marks timeout when poll fallback is still generating", async () => {
  const previous = {
    useLocalStore: appConfig.useLocalStore,
    designTimeoutMinutes: appConfig.designTimeoutMinutes,
  };
  const oldSubmittedAt = new Date(Date.now() - 25 * 60 * 1000).toISOString();
  const job = {
    id: "design-timeout-generating-1",
    requestId: "request-timeout-generating-1",
    externalJobId: "external-timeout-generating-1",
    status: "submitted",
    submittedAt: oldSubmittedAt,
    createdAt: oldSubmittedAt,
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    scene: "员工福利",
  };
  const notifications = [];
  const queuedMessages = [];
  const localStore = {
    listDesignJobs: () => [job],
    updateDesignJob: (id, patch) => {
      assert.equal(id, job.id);
      Object.assign(job, patch);
      return job;
    },
  };

  try {
    appConfig.useLocalStore = true;
    appConfig.designTimeoutMinutes = 20;

    const service = new DesignJobsService(
      {},
      {},
      localStore,
      { create: async (...args) => notifications.push(args) },
      {},
      {},
      {},
      {},
    );
    service.pollResult = async () => ({
      remoteStatus: "generating",
      job: { ...job, status: "generating" },
      result: { status: "generating" },
    });
    service.queueDesignTextMessage = async (...args) => {
      queuedMessages.push(args);
    };

    const result = await service.scanTimeouts();

    assert.equal(result.recovered, 0);
    assert.equal(result.timedOut, 1);
    assert.equal(result.jobs[0].status, "timeout");
    assert.match(result.jobs[0].errorMessage, /超过 20 分钟/);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0][1], "设计任务出图超时");
    assert.equal(queuedMessages.length, 1);
    assert.equal(queuedMessages[0][2], "design-timeout-customer-explain");
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("timeout scan records poll errors and still hands off overdue design jobs", async () => {
  const previous = {
    useLocalStore: appConfig.useLocalStore,
    designTimeoutMinutes: appConfig.designTimeoutMinutes,
  };
  const oldSubmittedAt = new Date(Date.now() - 25 * 60 * 1000).toISOString();
  const job = {
    id: "design-timeout-poll-error-1",
    requestId: "request-timeout-poll-error-1",
    externalJobId: "external-timeout-poll-error-1",
    status: "generating",
    submittedAt: oldSubmittedAt,
    createdAt: oldSubmittedAt,
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
  };
  const notifications = [];
  const queuedMessages = [];
  const localStore = {
    listDesignJobs: () => [job],
    updateDesignJob: (id, patch) => {
      assert.equal(id, job.id);
      Object.assign(job, patch);
      return job;
    },
  };

  try {
    appConfig.useLocalStore = true;
    appConfig.designTimeoutMinutes = 20;

    const service = new DesignJobsService(
      {},
      {},
      localStore,
      { create: async (...args) => notifications.push(args) },
      {},
      {},
      {},
      {},
    );
    service.pollResult = async () => {
      throw new Error("design platform unavailable");
    };
    service.queueDesignTextMessage = async (...args) => {
      queuedMessages.push(args);
    };

    const result = await service.scanTimeouts();

    assert.equal(result.recovered, 0);
    assert.equal(result.timedOut, 1);
    assert.equal(result.pollErrors.length, 1);
    assert.equal(result.pollErrors[0].designJobId, job.id);
    assert.equal(result.pollErrors[0].externalJobId, job.externalJobId);
    assert.match(result.pollErrors[0].errorMessage, /design platform unavailable/);
    assert.equal(result.jobs[0].status, "timeout");
    assert.equal(notifications.length, 1);
    assert.equal(queuedMessages.length, 1);
  } finally {
    Object.assign(appConfig, previous);
  }
});
