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

test("design job preflight blocks formal generation below first-round output count and exposes callback fallback", async () => {
  const previous = {
    useLocalStore: appConfig.useLocalStore,
    designPlatformAdapter: appConfig.designPlatformAdapter,
    designPlatformBaseUrl: appConfig.designPlatformBaseUrl,
    designPlatformCallbackUrl: appConfig.designPlatformCallbackUrl,
    customerServicePublicBaseUrl: appConfig.customerServicePublicBaseUrl,
    callbackApiKey: appConfig.callbackApiKey,
    defaultOutputCount: appConfig.defaultOutputCount,
  };

  const job = {
    id: "design-preflight-1",
    requestId: "request-preflight-1",
    wechatAccountId: "wechat-1",
    customerId: "customer-1",
    conversationId: "conversation-1",
    status: "draft",
    scene: "员工福利",
    budget: { mode: "per_box", perUnitAmount: 200, quantity: 20, totalAmount: 4000 },
    bundle: {
      automation: { ready: true, blockers: [] },
      items: [{ skuCode: "BOX-A", name: "红金礼盒", imageUrl: "https://example.test/box.png" }],
    },
    assets: [{ id: "asset-logo", url: "https://example.test/logo.png" }],
    requirements: { useRealSkuImages: true },
    outputCount: 3,
    isHighValue: false,
  };

  try {
    appConfig.useLocalStore = true;
    appConfig.designPlatformAdapter = "standard_v1";
    appConfig.designPlatformBaseUrl = "http://127.0.0.1:3700";
    appConfig.designPlatformCallbackUrl = "";
    appConfig.customerServicePublicBaseUrl = "http://127.0.0.1:3200";
    appConfig.callbackApiKey = "callback-secret";
    appConfig.defaultOutputCount = 6;

    const service = new DesignJobsService(
      {},
      { health: async () => ({ ok: true }) },
      { getDesignJob: () => job },
      {},
      {},
      {},
      {},
      {},
    );

    const result = await service.preflight(job.id);
    const outputCountCheck = result.checks.find((check) => check.key === "design_output_count");
    const deliveryCheck = result.checks.find((check) => check.key === "design_result_delivery");

    assert.equal(result.ok, false);
    assert.equal(result.outputCount, 3);
    assert.deepEqual(result.requiredOutputCountRange, { min: 4, max: 6 });
    assert.equal(outputCountCheck.ok, false);
    assert.equal(outputCountCheck.severity, "error");
    assert.match(outputCountCheck.detail, /至少 4 张/);
    assert.equal(result.callback.fallbackPolling, true);
    assert.equal(result.callback.hasAuthorization, true);
    assert.equal(JSON.stringify(result).includes("callback-secret"), false);
    assert.equal(deliveryCheck.ok, true);
    assert.match(deliveryCheck.detail, /轮询兜底/);
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("design job submit stops before calling platform when output count is below first-round minimum", async () => {
  const previous = {
    useLocalStore: appConfig.useLocalStore,
    designPlatformAdapter: appConfig.designPlatformAdapter,
    designPlatformBaseUrl: appConfig.designPlatformBaseUrl,
    defaultOutputCount: appConfig.defaultOutputCount,
  };

  const job = {
    id: "design-preflight-submit-1",
    requestId: "request-preflight-submit-1",
    wechatAccountId: "wechat-1",
    customerId: "customer-1",
    conversationId: "conversation-1",
    status: "draft",
    scene: "员工福利",
    budget: { mode: "per_box", perUnitAmount: 200, quantity: 20, totalAmount: 4000 },
    bundle: {
      automation: { ready: true, blockers: [] },
      items: [{ skuCode: "BOX-A", name: "红金礼盒", imageUrl: "https://example.test/box.png" }],
    },
    assets: [{ id: "asset-logo", url: "https://example.test/logo.png" }],
    requirements: { useRealSkuImages: true },
    outputCount: 3,
    isHighValue: false,
  };

  let platformCalled = false;
  const notifications = [];
  const manualLocks = [];
  const reviewLogs = [];
  let currentJob = { ...job };

  try {
    appConfig.useLocalStore = true;
    appConfig.designPlatformAdapter = "standard_v1";
    appConfig.designPlatformBaseUrl = "http://127.0.0.1:3700";
    appConfig.defaultOutputCount = 6;

    const service = new DesignJobsService(
      {},
      {
        health: async () => ({ ok: true }),
        createDesignJob: async () => {
          platformCalled = true;
          return { externalJobId: "external-should-not-happen" };
        },
      },
      {
        getDesignJob: () => currentJob,
        updateDesignJob: (id, patch) => {
          assert.equal(id, job.id);
          currentJob = { ...currentJob, ...patch };
          return currentJob;
        },
        createReviewLog: (payload) => {
          reviewLogs.push(payload);
          return { id: `review-${reviewLogs.length}`, ...payload };
        },
      },
      {},
      {},
      {
        setConversationManualLock: async (conversationId, payload) => {
          manualLocks.push({ conversationId, payload });
          return { blockedSendTasks: [], inFlightSendTasks: [] };
        },
      },
      {},
      {},
    );
    service.notifications = {
      create: async (...args) => {
        notifications.push(args);
        return { id: `notice-${notifications.length}` };
      },
    };

    await assert.rejects(() => service.submit(job.id), /design job preflight failed/);

    assert.equal(platformCalled, false);
    assert.equal(currentJob.status, "manual_review");
    assert.equal(currentJob.manualQcRequired, true);
    assert.match(currentJob.errorMessage, /preflight failed/);
    assert.equal(manualLocks.at(-1).conversationId, "conversation-1");
    assert.equal(manualLocks.at(-1).payload.reason, "design_platform_submit_failed");
    assert.equal(reviewLogs.at(-1).decision, "design_platform_submit_failed");
    assert.equal(reviewLogs.at(-1).beforeStatus, "failed");
    assert.equal(reviewLogs.at(-1).afterStatus, "manual_review");
    assert.equal(reviewLogs.at(-1).metadata.source, "submit_design_job");
    assert.equal(notifications.at(-1)[0], "warning");
    assert.equal(notifications.at(-1)[3].designJobId, job.id);
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("standard submit with a missing callback key stops before asset upload or remote create", async () => {
  const previous = { ...appConfig };
  const job = {
    id: "design-callback-preflight-1",
    requestId: "request-callback-preflight-1",
    wechatAccountId: "wechat-1",
    customerId: "customer-1",
    conversationId: "conversation-1",
    status: "draft",
    scene: "员工福利",
    budget: { mode: "per_box", perUnitAmount: 200, quantity: 20, totalAmount: 4000 },
    bundle: {
      automation: { ready: true, blockers: [] },
      items: [{ skuCode: "BOX-A", name: "礼盒", imageUrl: "https://example.test/box.png" }],
    },
    assets: [{ id: "asset-logo", url: "https://example.test/logo.png" }],
    requirements: { useRealSkuImages: true },
    outputCount: 6,
  };
  let uploadCalls = 0;
  let createCalls = 0;
  let currentJob = { ...job };
  try {
    Object.assign(appConfig, {
      useLocalStore: true,
      designPlatformAdapter: "standard_v1",
      callbackApiKey: "",
      internalApiToken: "",
      designPlatformApiKey: "",
      designPlatformAccessToken: "",
      designPlatformCookie: "",
    });
    const service = new DesignJobsService(
      {},
      {
        health: async () => ({ ok: true }),
        uploadAsset: async () => { uploadCalls += 1; return {}; },
        createDesignJob: async () => { createCalls += 1; return {}; },
      },
      {
        getDesignJob: () => currentJob,
        updateDesignJob: (_id, patch) => (currentJob = { ...currentJob, ...patch }),
        createReviewLog: () => ({}),
      },
      { create: async () => ({}) },
      {},
      { setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }) },
      {},
      {},
      {},
    );
    const preflight = await service.preflight(job.id);
    const callbackCheck = preflight.checks.find((check) => check.key === "design_platform_callback_auth");
    assert.equal(callbackCheck.ok, false);
    assert.equal(callbackCheck.severity, "error");
    await assert.rejects(() => service.submit(job.id), /design job preflight failed/);
    assert.equal(uploadCalls, 0);
    assert.equal(createCalls, 0);
  } finally {
    Object.assign(appConfig, previous);
  }
});

test("art local preflight does not require the standard callback key", async () => {
  const previous = { ...appConfig };
  const job = {
    id: "design-art-callback-preflight-1",
    requestId: "request-art-callback-preflight-1",
    customerId: "customer-1",
    conversationId: "conversation-1",
    status: "draft",
    scene: "员工福利",
    budget: { mode: "per_box", perUnitAmount: 200, quantity: 20, totalAmount: 4000 },
    bundle: { automation: { ready: true, blockers: [] }, items: [] },
    assets: [],
    requirements: { useRealSkuImages: false },
    outputCount: 6,
  };
  try {
    Object.assign(appConfig, { useLocalStore: true, designPlatformAdapter: "art_image_local", callbackApiKey: "" });
    const service = new DesignJobsService(
      {},
      {
        health: async () => ({ ok: true }),
        getArtImageLocalAuthSession: async () => ({ authenticated: true }),
        getArtImageLocalActivationStatus: async () => ({ required: true, active: true }),
      },
      { getDesignJob: () => job },
      {},
      {},
      {},
      {},
      {},
      {},
    );
    const result = await service.preflight(job.id);
    assert.equal(result.checks.some((check) => check.key === "design_platform_callback_auth"), false);
  } finally {
    Object.assign(appConfig, previous);
  }
});
