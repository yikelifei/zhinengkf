"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const { CatalogService } = require("../apps/api/src/catalog/catalog.service");
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const { StorageService } = require("../apps/api/src/storage/storage.service");

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);

function emptyStoreData(overrides = {}) {
  return {
    wechatAccounts: [],
    customers: [],
    conversations: [],
    messages: [],
    inboundMessageOperations: [],
    wechatWindowSnapshots: [],
    skus: [],
    skuChangeLogs: [],
    designAssets: [],
    designJobs: [],
    designImages: [],
    designRevisions: [],
    designPlatformExecutions: [],
    notifications: [],
    sendTasks: [],
    sendAttempts: [],
    quoteDrafts: [],
    orderDrafts: [],
    paymentEvents: [],
    reviewLogs: [],
    agents: [],
    agentSkills: [],
    chatImports: [],
    trainingSamples: [],
    knowledgeEntries: [],
    routeEvaluations: [],
    automationRuns: [],
    wechatWorkBindings: [],
    wechatWorkAuditLogs: [],
    wechatWorkSyncCursors: [],
    personalWechatRpaBindings: [],
    personalWechatRpaAuditLogs: [],
    ...overrides,
  };
}

function skuPayload(overrides = {}) {
  return {
    skuCode: "LOCAL-IMG",
    name: "本地图片商品",
    type: "item",
    category: "内搭",
    sceneTags: ["员工福利"],
    costPrice: 10,
    salePrice: 30,
    stock: 20,
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
    material: "纸",
    supplier: "本地供应商",
    leadTimeDays: 3,
    matchingRules: {},
    replacementSkuCodes: [],
    isActive: true,
    ...overrides,
  };
}

test("catalog SKU save archives absolute local product images into previewable storage", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-sku-images-"));
  const sourceDir = path.join(tempDir, "source");
  const storageRoot = path.join(tempDir, "storage");
  fs.mkdirSync(sourceDir, { recursive: true });
  const mainImagePath = path.join(sourceDir, "main.png");
  const angleImagePath = path.join(sourceDir, "angle.png");
  fs.writeFileSync(mainImagePath, VALID_PNG);
  fs.writeFileSync(angleImagePath, VALID_PNG);

  const previousUseLocalStore = appConfig.useLocalStore;
  const previousStorageRoot = appConfig.localStorageRoot;
  t.after(() => {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.localStorageRoot = previousStorageRoot;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  appConfig.useLocalStore = true;
  appConfig.localStorageRoot = storageRoot;

  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  fs.writeFileSync(localStore.filePath, `${JSON.stringify(emptyStoreData(), null, 2)}\n`, "utf8");

  const storage = new StorageService();
  const service = new CatalogService({}, localStore, storage);
  const saved = await service.upsertSku(skuPayload({
    mainImagePath,
    angleImages: [angleImagePath],
  }));

  assert.notEqual(saved.mainImagePath, mainImagePath);
  assert.notEqual(saved.angleImages[0], angleImagePath);
  assert.match(saved.mainImagePath, /[\\/]storage[\\/]assets[\\/]sku[\\/]LOCAL-IMG[\\/]/);
  assert.match(saved.angleImages[0], /[\\/]storage[\\/]assets[\\/]sku[\\/]LOCAL-IMG[\\/]/);
  assert.equal(fs.existsSync(saved.mainImagePath), true);
  assert.equal(fs.existsSync(saved.angleImages[0]), true);

  const file = await storage.readLocalAsset(saved.mainImagePath);
  assert.equal(file.mimeType, "image/png");
  assert.equal(file.inlineSafe, true);

  const stored = localStore.listSkus({ includeInactive: true }).find((sku) => sku.skuCode === "LOCAL-IMG");
  assert.equal(stored.mainImagePath, saved.mainImagePath);
  assert.deepEqual(stored.angleImages, saved.angleImages);

  const skuAssets = localStore.listDesignAssets({ ownerType: "sku", ownerId: "LOCAL-IMG" });
  assert.equal(skuAssets.length, 2);
  assert.equal(skuAssets.every((asset) => asset.role === "sku_image"), true);
  assert.deepEqual(
    skuAssets.map((asset) => asset.localPath).sort(),
    [saved.mainImagePath, saved.angleImages[0]].sort(),
  );
  assert.equal(skuAssets.every((asset) => asset.mimeType === "image/png"), true);
  assert.equal(skuAssets.every((asset) => String(asset.normalizedLocalPath || "").includes("/storage/assets/sku/local-img/")), true);

  await service.upsertSku(skuPayload({
    mainImagePath: saved.mainImagePath,
    angleImages: saved.angleImages,
  }));
  assert.equal(localStore.listDesignAssets({ ownerType: "sku", ownerId: "LOCAL-IMG" }).length, 2);
});

test("demo SKU image generation replaces starter angle URLs with local preview assets", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-demo-sku-images-"));
  const storageRoot = path.join(tempDir, "storage");

  const previousUseLocalStore = appConfig.useLocalStore;
  const previousStorageRoot = appConfig.localStorageRoot;
  const previousAllowDemoDataMutations = appConfig.allowDemoDataMutations;
  t.after(() => {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.localStorageRoot = previousStorageRoot;
    appConfig.allowDemoDataMutations = previousAllowDemoDataMutations;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  appConfig.useLocalStore = true;
  appConfig.localStorageRoot = storageRoot;
  appConfig.allowDemoDataMutations = true;

  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  fs.writeFileSync(localStore.filePath, `${JSON.stringify(emptyStoreData({
    skus: [
      skuPayload({
        skuCode: "DEMO-ANGLE",
        mainImagePath: "https://app.zhenxiai.cloud/smart-kefu/starter-skus/demo-angle.png",
        angleImages: ["https://app.zhenxiai.cloud/smart-kefu/starter-skus/demo-angle-side.png"],
      }),
    ],
  }), null, 2)}\n`, "utf8");

  const service = new CatalogService({}, localStore, new StorageService());
  const result = await service.createDemoSkuImages();
  const saved = result.updated.find((sku) => sku.skuCode === "DEMO-ANGLE");

  assert.equal(result.count, 1);
  assert.match(saved.mainImagePath, /[\\/]storage[\\/]assets[\\/]sku[\\/]DEMO-ANGLE[\\/]/);
  assert.equal(saved.imageUrl, saved.mainImagePath);
  assert.equal(saved.angleImages.length, 1);
  assert.match(saved.angleImages[0], /[\\/]storage[\\/]assets[\\/]sku[\\/]DEMO-ANGLE[\\/]/);
  assert.notEqual(saved.angleImages[0], saved.mainImagePath);
  assert.equal(fs.existsSync(saved.mainImagePath), true);
  assert.equal(fs.existsSync(saved.angleImages[0]), true);
});
