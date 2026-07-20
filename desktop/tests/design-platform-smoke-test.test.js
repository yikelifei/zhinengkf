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

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);

test("design platform smoke test uploads sample assets, polls results, and saves a candidate image", async () => {
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
    designResultPollIntervalMs: appConfig.designResultPollIntervalMs,
  };
  const port = await freePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "design-platform-smoke-test-"));
  const storageRoot = path.join(tempDir, "storage");
  const localStoreFile = path.join(tempDir, "local-store.json");
  writeJson(localStoreFile, emptyStoreData());

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
    appConfig.designPlatformTimeoutMs = 8000;
    appConfig.designResultPollIntervalMs = 150;

    await waitForHealth(port);

    const localStore = new LocalStoreService();
    localStore.filePath = localStoreFile;
    const service = new DesignJobsService(
      {},
      new DesignPlatformClient(),
      localStore,
      new NotificationsService({}, localStore),
      mockedPublicStorage(),
      { enqueueTextMessage: async () => ({}) },
      {},
      {},
    );

    const result = await service.runDesignPlatformSmokeTest();

    assert.equal(result.ok, true);
    assert.equal(result.adapter, "standard_v1");
    assert.equal(result.assetUploadCount, 3);
    assert.equal(result.expectedCandidateCount, 1);
    assert.equal(result.candidateCount, 1);
    assert.equal(result.savedImageCount, 1);
    assert.equal(result.savedImagePreviews.length, 1);
    assert.equal(result.contractChecks.every((check) => check.ok), true);
    assert.deepEqual(
      result.contractChecks.map((check) => check.key),
      ["asset_remote_reference", "external_job_id", "candidate_count", "image_metadata", "local_image_save_count"],
    );
    assert.match(result.savedImagePreviews[0].dataUrl, /^data:image\/png;base64,/);
    assert.equal(result.steps.every((step) => step.ok), true);
    assert.equal(Boolean(result.externalJobId), true);
    assert.equal(result.savedImagePaths.length, 1);
    assert.equal(fs.existsSync(result.savedImagePaths[0]), true);
    assert.match(result.savedImagePaths[0], /design-jobs/);
  } finally {
    child.kill("SIGTERM");
    Object.assign(appConfig, originalConfig);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("design platform smoke test reports result contract failures clearly", async () => {
  const originalConfig = {
    useLocalStore: appConfig.useLocalStore,
    localStorageRoot: appConfig.localStorageRoot,
    designPlatformAdapter: appConfig.designPlatformAdapter,
    designPlatformBaseUrl: appConfig.designPlatformBaseUrl,
    designPlatformTimeoutMs: appConfig.designPlatformTimeoutMs,
    designResultPollIntervalMs: appConfig.designResultPollIntervalMs,
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "design-platform-smoke-contract-"));
  const storageRoot = path.join(tempDir, "storage");
  const localStoreFile = path.join(tempDir, "local-store.json");
  writeJson(localStoreFile, emptyStoreData());

  try {
    appConfig.useLocalStore = true;
    appConfig.localStorageRoot = storageRoot;
    appConfig.designPlatformAdapter = "standard_v1";
    appConfig.designPlatformBaseUrl = "http://127.0.0.1:3999";
    appConfig.designPlatformTimeoutMs = 8000;
    appConfig.designResultPollIntervalMs = 150;

    const localStore = new LocalStoreService();
    localStore.filePath = localStoreFile;
    const designPlatform = {
      health: async () => ({ ok: true }),
      uploadAsset: async (asset) => ({
        assetId: `remote_${asset.assetId}`,
        url: `http://127.0.0.1:3999/assets/${asset.assetId}.png`,
      }),
      createDesignJob: async () => ({ externalJobId: "bad_contract_job", status: "generating" }),
      getDesignJobResults: async () => ({
        externalJobId: "bad_contract_job",
        status: "completed",
        images: [{ imageId: "candidate_without_url" }],
      }),
    };
    const service = new DesignJobsService(
      {},
      designPlatform,
      localStore,
      new NotificationsService({}, localStore),
      new StorageService(),
      { enqueueTextMessage: async () => ({}) },
      {},
      {},
    );

    const result = await service.runDesignPlatformSmokeTest();

    assert.equal(result.ok, false);
    assert.equal(result.expectedCandidateCount, 1);
    assert.equal(result.candidateCount, 1);
    assert.equal(result.savedImageCount, 0);
    assert.match(result.errorMessage, /缺少 imageId 或 downloadUrl|invalid candidate image metadata/);
    const imageMetadataCheck = result.contractChecks.find((check) => check.key === "image_metadata");
    assert.equal(imageMetadataCheck.ok, false);
    assert.match(imageMetadataCheck.detail, /缺少 imageId 或 downloadUrl/);
    assert.equal(result.steps.at(-1).key, "error");
  } finally {
    Object.assign(appConfig, originalConfig);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("art image local smoke fails closed before health, upload or generation because it requires a durable DesignJob", async () => {
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "art_image_local";
  try {
    const calls = { health: 0, upload: 0, create: 0 };
    const platform = {
      isArtImageLocalAdapter: () => true,
      health: async () => { calls.health += 1; },
      uploadAsset: async () => { calls.upload += 1; },
      createDesignJob: async () => { calls.create += 1; },
    };
    const service = new DesignJobsService(
      {}, platform, {}, { create: async () => ({}) }, {}, {}, {}, {}, {},
    );
    const result = await service.runDesignPlatformSmokeTest();
    assert.equal(result.ok, false);
    assert.equal(result.status, "blocked");
    assert.match(result.errorMessage, /persisted DesignJob and durable execution/);
    assert.deepEqual(calls, { health: 0, upload: 0, create: 0 });
  } finally {
    appConfig.designPlatformAdapter = previousAdapter;
  }
});

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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockedPublicStorage() {
  const storage = new StorageService();
  const saveDesignImage = storage.saveDesignImage.bind(storage);
  storage.saveDesignImage = (jobId, imageId) => saveDesignImage(
    jobId,
    imageId,
    `https://mock-public.example/${encodeURIComponent(imageId)}.png`,
    {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => ({ status: 200, headers: {}, data: VALID_PNG }),
    },
  );
  return storage;
}
