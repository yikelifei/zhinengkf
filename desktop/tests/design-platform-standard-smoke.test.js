"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
const { DesignPlatformClient } = require("../apps/api/src/integrations/design-platform/design-platform.client");
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { StorageService } = require("../apps/api/src/storage/storage.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

test("standard design platform smoke submits, polls, saves images, and keeps uploaded asset urls", async () => {
  const originalConfig = {
    useLocalStore: appConfig.useLocalStore,
    localStorageRoot: appConfig.localStorageRoot,
    designPlatformAdapter: appConfig.designPlatformAdapter,
    designPlatformBaseUrl: appConfig.designPlatformBaseUrl,
    designPlatformApiKey: appConfig.designPlatformApiKey,
    designPlatformAccessToken: appConfig.designPlatformAccessToken,
    designPlatformCookie: appConfig.designPlatformCookie,
    designPlatformDeviceId: appConfig.designPlatformDeviceId,
    designPlatformTimeoutMs: appConfig.designPlatformTimeoutMs,
    customerServicePublicBaseUrl: appConfig.customerServicePublicBaseUrl,
    designPlatformCallbackUrl: appConfig.designPlatformCallbackUrl,
    callbackApiKey: appConfig.callbackApiKey,
  };
  const port = await freePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "standard-design-smoke-"));
  const storageRoot = path.join(tempDir, "storage");
  const localStoreFile = path.join(tempDir, "local-store.json");
  const logoPath = path.join(storageRoot, "assets", "customer", "customer_smoke_1", "customer-logo.png");
  const boxPath = path.join(storageRoot, "sku", "gift-box.png");
  const skuPath = path.join(storageRoot, "sku", "tea-sku.png");

  writeFile(logoPath, "customer logo bytes");
  writeFile(boxPath, "gift box image bytes");
  writeFile(skuPath, "sku image bytes");
  writeJson(localStoreFile, emptyStoreData({
    wechatAccounts: [{ id: "wechat_smoke_1", displayName: "微信一号", platform: "wechat", status: "online" }],
    customers: [{ id: "customer_smoke_1", name: "测试客户" }],
    conversations: [
      {
        id: "conversation_smoke_1",
        customerId: "customer_smoke_1",
        wechatAccountId: "wechat_smoke_1",
        customerName: "测试客户",
        status: "active",
        updatedAt: new Date().toISOString(),
      },
    ],
  }));

  const child = spawn(process.execPath, ["tools/mock-design-platform.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, MOCK_DESIGN_PLATFORM_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    appConfig.useLocalStore = true;
    appConfig.localStorageRoot = storageRoot;
    appConfig.designPlatformAdapter = "standard_v1";
    appConfig.designPlatformBaseUrl = `http://127.0.0.1:${port}`;
    appConfig.designPlatformApiKey = "test-design-key";
    appConfig.designPlatformAccessToken = "";
    appConfig.designPlatformCookie = "";
    appConfig.designPlatformDeviceId = "";
    appConfig.designPlatformTimeoutMs = 5000;
    appConfig.customerServicePublicBaseUrl = "http://127.0.0.1:33200";
    appConfig.designPlatformCallbackUrl = "";
    appConfig.callbackApiKey = "test-callback-key";

    await waitForHealth(port);

    const localStore = new LocalStoreService();
    localStore.filePath = localStoreFile;
    const notifications = new NotificationsService({}, localStore);
    const storage = new StorageService();
    const designPlatform = new DesignPlatformClient();
    const uploadResponses = [];
    const createdPayloads = [];
    const originalUploadAsset = designPlatform.uploadAsset.bind(designPlatform);
    const originalCreateDesignJob = designPlatform.createDesignJob.bind(designPlatform);
    designPlatform.uploadAsset = async (payload) => {
      const response = await originalUploadAsset(payload);
      uploadResponses.push({ payload, response });
      return response;
    };
    designPlatform.createDesignJob = async (payload) => {
      createdPayloads.push(payload);
      return originalCreateDesignJob(payload);
    };
    const queuedTexts = [];
    const wechatDispatch = {
      enqueueTextMessage: async (payload) => {
        queuedTexts.push(payload);
        return { id: `send-${queuedTexts.length}`, ...payload };
      },
    };
    const service = new DesignJobsService({}, designPlatform, localStore, notifications, storage, wechatDispatch, {}, {});
    service.scheduleResultPoll = () => {};

    const customerLogo = localStore.createDesignAsset({
      ownerType: "customer",
      ownerId: "customer_smoke_1",
      customerId: "customer_smoke_1",
      conversationId: "conversation_smoke_1",
      wechatAccountId: "wechat_smoke_1",
      role: "customer_logo",
      fileName: "customer-logo.png",
      mimeType: "image/png",
      localPath: logoPath,
      sizeBytes: fs.statSync(logoPath).size,
      source: "customer_upload",
    });
    const job = localStore.createDesignJob({
      requestId: "request_standard_smoke_1",
      status: "draft",
      customerId: "customer_smoke_1",
      conversationId: "conversation_smoke_1",
      wechatAccountId: "wechat_smoke_1",
      budget: { mode: "per_box", amount: 200, quantity: 20, totalAmount: 4000 },
      scene: "员工福利",
      bundle: {
        giftBox: { skuCode: "BOX-SMOKE", name: "红金礼盒", localPath: boxPath, salePrice: 60, cost: 30 },
        items: [{ skuCode: "TEA-SMOKE", name: "有机茶", localPath: skuPath, salePrice: 80, cost: 40 }],
      },
      requirements: { useRealSkuImages: true, showAllItems: true, noWatermark: true, highResolution: true },
      assetIds: [customerLogo.id],
      outputCount: 4,
      renderStyle: "真实产品摆拍",
      customerText: "客户要员工福利礼盒效果图，带公司Logo。",
      manualQcRequired: true,
    });

    const submitted = await service.submit(job.id, {
      expectedWechatAccountId: "wechat_smoke_1",
      expectedConversationId: "conversation_smoke_1",
      expectedCustomerId: "customer_smoke_1",
    });
    assert.equal(submitted.status, "submitted");
    assert.equal(Boolean(submitted.externalJobId), true);
    assert.equal(queuedTexts.length, 1);
    assert.equal(queuedTexts[0].conversationId, "conversation_smoke_1");
    assert.equal(uploadResponses.length, 3);
    assert.equal(createdPayloads.length, 1);
    assert.equal(createdPayloads[0].assets.length, 3);
    assert.equal(createdPayloads[0].assets.every((asset) => String(asset.url || "").startsWith(`http://127.0.0.1:${port}/assets/`)), true);
    assert.deepEqual(
      createdPayloads[0].assets.map((asset) => asset.role).sort(),
      ["customer_logo", "gift_box", "sku_image"],
    );
    assert.equal(
      createdPayloads[0].callback.url,
      "http://127.0.0.1:33200/api/integrations/design-platform/callback",
    );
    assert.equal(createdPayloads[0].callback.method, "POST");
    assert.deepEqual(createdPayloads[0].callback.events, ["completed", "failed"]);
    assert.equal(createdPayloads[0].callback.headers.Authorization, "Bearer test-callback-key");
    assert.equal(createdPayloads[0].callback.requestId, "request_standard_smoke_1");
    assert.equal(createdPayloads[0].callback.fallbackPolling, true);

    const completed = await waitForCompletedPoll(service, job.id);
    assert.equal(completed.remoteStatus, "completed");
    assert.equal(completed.job.status, "quick_confirm");

    const saved = localStore.getDesignJob(job.id);
    assert.equal(saved.images.length, 4);
    assert.equal(saved.images.every((image) => image.localPath && fs.existsSync(image.localPath)), true);
    assert.equal(saved.images.every((image) => image.downloadUrl.includes(`/files/${submitted.externalJobId}/`)), true);
    assert.equal(localStore.listNotifications().some((notice) => notice.title === "设计图已生成"), true);
  } finally {
    child.kill("SIGTERM");
    Object.assign(appConfig, originalConfig);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

async function waitForCompletedPoll(service, jobId) {
  const deadline = Date.now() + 5000;
  let lastResult = null;
  while (Date.now() < deadline) {
    lastResult = await service.pollResult(jobId, {
      expectedWechatAccountId: "wechat_smoke_1",
      expectedConversationId: "conversation_smoke_1",
      expectedCustomerId: "customer_smoke_1",
    });
    if (lastResult.remoteStatus === "completed") return lastResult;
    await sleep(200);
  }
  throw new Error(`design platform did not complete in time: ${lastResult?.remoteStatus || "unknown"}`);
}

function emptyStoreData(overrides = {}) {
  return {
    wechatAccounts: [],
    customers: [],
    conversations: [],
    messages: [],
    wechatWindowSnapshots: [],
    skus: [],
    skuChangeLogs: [],
    designAssets: [],
    designJobs: [],
    designImages: [],
    designRevisions: [],
    notifications: [],
    sendTasks: [],
    sendAttempts: [],
    quoteDrafts: [],
    orderDrafts: [],
    reviewLogs: [],
    agents: [],
    agentSkills: [],
    chatImports: [],
    trainingSamples: [],
    knowledgeEntries: [],
    routeEvaluations: [],
    automationRuns: [],
    ...overrides,
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port) {
  const deadline = Date.now() + 5000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await getJson(port, "/v1/health");
      if (health.ok === true && health.service === "mock-design-platform") return;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw lastError || new Error("mock design platform did not become healthy");
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path: pathname }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(text));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
