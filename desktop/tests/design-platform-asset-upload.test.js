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

function withTempImage(fileName = "sku.png") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-design-"));
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, Buffer.from("fake image"));
  return {
    filePath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test("design platform payload blocks formal submission when asset upload fails", async () => {
  const designPlatform = {
    uploadAsset: async () => {
      throw new Error("upload endpoint unavailable");
    },
  };
  const service = new DesignJobsService({}, designPlatform, {}, {}, {}, {}, {}, {});

  await assert.rejects(
    () =>
      service.buildDesignPlatformPayload({
        requestId: "request-upload-failure",
        wechatAccountId: "wechat-1",
        customerId: "customer-1",
        conversationId: "conversation-1",
        budget: { mode: "per_box", amount: 200, quantity: 20 },
        scene: "employee gifts",
        bundle: {},
        requirements: { useRealSkuImages: true },
        outputCount: 6,
        renderStyle: "real product photo",
        customerText: "need render",
        assets: [
          {
            id: "asset-1",
            fileName: "customer-logo.png",
            mimeType: "image/png",
            localPath: "C:\\temp\\customer-logo.png",
            sizeBytes: 1024,
            role: "customer_logo",
            ownerType: "customer",
            ownerId: "customer-1",
            source: "test",
          },
        ],
      }),
    /design asset upload failed: customer-logo\.png/,
  );
});

test("standard design platform payload uploads local SKU images from bundle", async () => {
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "standard_v1";
  const giftBoxImage = withTempImage("gift-box.png");
  const skuImage = withTempImage("tea-sku.png");
  const uploaded = [];
  const designPlatform = {
    uploadAsset: async (payload) => {
      uploaded.push(payload);
      return {
        url: `https://design.test/assets/${payload.fileName}`,
      };
    },
  };
  const service = new DesignJobsService({}, designPlatform, {}, {}, {}, {}, {}, {});

  try {
    const payload = await service.buildDesignPlatformPayload({
      requestId: "request-sku-upload",
      wechatAccountId: "wechat-1",
      customerId: "customer-1",
      conversationId: "conversation-1",
      budget: { mode: "per_box", amount: 200, quantity: 20 },
      scene: "employee gifts",
      bundle: {
        giftBox: {
          skuCode: "BOX-001",
          name: "Gift Box",
          localPath: giftBoxImage.filePath,
        },
        items: [
          {
            skuCode: "TEA-001",
            name: "Organic Tea",
            localPath: skuImage.filePath,
          },
        ],
      },
      requirements: { useRealSkuImages: true },
      outputCount: 6,
      renderStyle: "real product photo",
      customerText: "need render",
      assets: [],
    });

    assert.equal(uploaded.length, 2);
    assert.equal(uploaded[0].role, "gift_box");
    assert.equal(uploaded[0].source, "bundle");
    assert.equal(uploaded[0].skuCode, "BOX-001");
    assert.equal(uploaded[0].name, "Gift Box");
    assert.equal(uploaded[0].localPath, giftBoxImage.filePath);
    assert.equal(uploaded[1].role, "sku_image");
    assert.equal(uploaded[1].source, "bundle");
    assert.equal(uploaded[1].skuCode, "TEA-001");
    assert.equal(uploaded[1].name, "Organic Tea");
    assert.equal(uploaded[1].localPath, skuImage.filePath);
    assert.equal(payload.assets.length, 2);
    assert.equal(payload.assets[0].role, "gift_box");
    assert.equal(payload.assets[0].remoteAssetId, "https://design.test/assets/gift-box.png");
    assert.equal(payload.assets[0].url, "https://design.test/assets/gift-box.png");
    assert.equal(payload.assets[1].role, "sku_image");
    assert.equal(payload.assets[1].remoteAssetId, "https://design.test/assets/tea-sku.png");
    assert.equal(payload.assets[1].url, "https://design.test/assets/tea-sku.png");
    assert.equal(payload.assets[1].skuCode, "TEA-001");
  } finally {
    appConfig.designPlatformAdapter = previousAdapter;
    giftBoxImage.cleanup();
    skuImage.cleanup();
  }
});

test("standard design platform payload blocks formal submission when SKU image upload fails", async () => {
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "standard_v1";
  const skuImage = withTempImage("failed-sku.png");
  const designPlatform = {
    uploadAsset: async () => {
      throw new Error("sku upload endpoint unavailable");
    },
  };
  const service = new DesignJobsService({}, designPlatform, {}, {}, {}, {}, {}, {});

  try {
    await assert.rejects(
      () =>
        service.buildDesignPlatformPayload({
          requestId: "request-sku-upload-failure",
          wechatAccountId: "wechat-1",
          customerId: "customer-1",
          conversationId: "conversation-1",
          budget: { mode: "per_box", amount: 200, quantity: 20 },
          scene: "employee gifts",
          bundle: {
            items: [
              {
                skuCode: "SKU-FAIL",
                name: "Failed SKU",
                localPath: skuImage.filePath,
              },
            ],
          },
          requirements: { useRealSkuImages: true },
          outputCount: 6,
          renderStyle: "real product photo",
          customerText: "need render",
          assets: [],
        }),
      /design asset upload failed: failed-sku\.png/,
    );
  } finally {
    appConfig.designPlatformAdapter = previousAdapter;
    skuImage.cleanup();
  }
});

test("initial design submit with an unverifiable response fails closed without a second POST", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-submit-failure",
    requestId: "request-submit-failure",
    status: "draft",
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    isHighValue: false,
    budget: { mode: "per_box", amount: 200, quantity: 20 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    outputCount: 6,
    renderStyle: "real product photo",
    customerText: "need render",
    assets: [],
  };
  const reviewLogs = [];
  const notices = [];
  const manualLocks = [];
  const designPlatform = {
    createDesignJob: async () => {
      throw new Error("design platform offline");
    },
  };
  const localStore = {
    getDesignJob: () => designJob,
    updateDesignJob: (id, patch) => {
      assert.equal(id, designJob.id);
      designJob = { ...designJob, ...patch };
      return designJob;
    },
    beginDesignJobSubmitOperation: ({ designJobId, operationKey, requestFingerprint, operationIdentity }) => {
      assert.equal(designJobId, designJob.id);
      designJob = {
        ...designJob,
        submitOperationKey: operationKey,
        submitRequestFingerprint: requestFingerprint,
        submitOperationIdentity: operationIdentity,
        submitDispatchStatus: "prepared",
      };
      return { job: designJob, created: true };
    },
    createReviewLog: (payload) => {
      reviewLogs.push(payload);
      return payload;
    },
  };
  const notifications = {
    create: async (...args) => {
      notices.push(args);
      return { id: `notice-${notices.length}` };
    },
  };
  const wechatDispatch = {
    setConversationManualLock: async (conversationId, payload) => {
      manualLocks.push({ conversationId, payload });
      return { blockedSendTasks: [], inFlightSendTasks: [] };
    },
  };

  try {
    const service = new DesignJobsService({}, designPlatform, localStore, notifications, {}, wechatDispatch, {}, {});
    service.assertDesignPlatformPreflight = async () => ({ ok: true });

    await assert.rejects(
      () => service.submit(designJob.id, { operationKey: "test-submit-platform-offline-1" }),
      (error) => error?.response?.code === "DESIGN_DISPATCH_OUTCOME_UNKNOWN",
    );

    assert.equal(designJob.status, "manual_review");
    assert.equal(designJob.submitDispatchStatus, "outcome_unknown");
    assert.match(designJob.errorMessage, /可能已接受任务/);
    assert.equal(reviewLogs.length, 0);
    assert.equal(manualLocks.length, 0);
    assert.equal(notices.some((notice) => String(notice[1]).includes("设计平台提交结果未知")), true);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("revision pre-dispatch asset failure stays locally retryable with the same operation key", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;

  let designJob = {
    id: "design-1",
    requestId: "request-revision-upload-failure",
    status: "completed",
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    isHighValue: false,
    budget: { mode: "per_box", amount: 200, quantity: 20 },
    bundle: {},
    requirements: { useRealSkuImages: false },
    outputCount: 6,
    renderStyle: "real product photo",
    customerText: "need revision",
    assets: [
      {
        id: "asset-1",
        fileName: "customer-logo.png",
        mimeType: "image/png",
        localPath: "C:\\temp\\customer-logo.png",
        sizeBytes: 1024,
        role: "customer_logo",
        ownerType: "customer",
        ownerId: "customer-1",
        source: "test",
      },
    ],
    images: [{ id: "image-1", imageId: "candidate_1", selected: true }],
  };
  let revision = null;
  const reviewLogs = [];
  const notices = [];
  let createDesignJobCalled = false;

  const localStore = {
    getDesignJob: () => designJob,
    listDesignRevisions: () => (revision ? [revision] : []),
    createDesignRevision: (payload) => {
      revision = {
        id: "revision-1",
        ...payload,
        status: payload.status || "requested",
      };
      return revision;
    },
    updateDesignRevision: (id, patch) => {
      assert.equal(id, revision.id);
      revision = { ...revision, ...patch };
      return revision;
    },
    updateDesignJob: (id, patch) => {
      assert.equal(id, "design-1");
      designJob = { ...designJob, ...patch };
      return designJob;
    },
    createReviewLog: (payload) => {
      reviewLogs.push(payload);
      return payload;
    },
  };
  const designPlatform = {
    uploadAsset: async () => {
      throw new Error("upload endpoint unavailable");
    },
    createDesignJob: async () => {
      createDesignJobCalled = true;
      return { externalJobId: "external-1" };
    },
  };
  const notifications = {
    create: async (...args) => {
      notices.push(args);
      return { id: `notice-${notices.length}` };
    },
  };
  const wechatDispatch = {
    setConversationManualLock: async () => ({ blockedSendTasks: [], inFlightSendTasks: [] }),
  };

  try {
    const service = new DesignJobsService({}, designPlatform, localStore, notifications, {}, wechatDispatch, {}, {});
    service.assertDesignPlatformPreflight = async () => ({ ok: true });

    await assert.rejects(
      () => service.requestRevision("design-1", {
        operationKey: "test-revision-upload-failure-1",
        instruction: "make the logo bigger",
        expectedWechatAccountId: "wechat-1",
        expectedConversationId: "conversation-1",
        expectedCustomerId: "customer-1",
      }),
      /design asset upload failed: customer-logo\.png/,
    );

    assert.equal(createDesignJobCalled, false);
    assert.equal(revision.status, "requested");
    assert.equal(revision.dispatchStatus, "local_failed");
    assert.match(revision.dispatchError, /design asset upload failed: customer-logo\.png/);
    assert.equal(designJob.status, "completed");
    assert.equal(reviewLogs.length, 0);
    assert.equal(notices.length, 0);
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});
