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

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const {
  auditSkuCatalog,
  inspectRealDesignReferences,
  recommendBundle,
} = require("../packages/rules");

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);

function createStore(t, seed) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-store-demo-skus-"));
  const store = new LocalStoreService();
  store.filePath = path.join(root, "local-store.json");
  if (seed) fs.writeFileSync(store.filePath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return store;
}

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

function oldDemoSkus(now = new Date().toISOString()) {
  return [
    { id: "sku_box_a", skuCode: "BOX-A", name: "红金礼盒A", type: "gift_box", category: "礼盒", sceneTags: ["员工福利", "节日礼赠"], costPrice: 30, salePrice: 60, stock: 120, dimensions: { width: 320, height: 90, depth: 240 }, replacementSkuCodes: [], isActive: true, createdAt: now, updatedAt: now },
    { id: "sku_tea_a", skuCode: "TEA-A", name: "茶叶礼品A", type: "item", category: "内搭", sceneTags: ["员工福利"], costPrice: 65, salePrice: 110, stock: 42, dimensions: { width: 90, height: 160, depth: 60 }, replacementSkuCodes: ["TEA-B"], isActive: true, createdAt: now, updatedAt: now },
    { id: "sku_tea_b", skuCode: "TEA-B", name: "茶叶礼品B", type: "item", category: "内搭", sceneTags: ["员工福利"], costPrice: 60, salePrice: 105, stock: 80, dimensions: { width: 90, height: 160, depth: 60 }, replacementSkuCodes: [], isActive: true, createdAt: now, updatedAt: now },
    { id: "sku_card_a", skuCode: "CARD-A", name: "定制贺卡A", type: "accessory", category: "贺卡", sceneTags: ["节日礼赠", "客户拜访"], costPrice: 5, salePrice: 20, stock: 500, dimensions: { width: 120, height: 80 }, replacementSkuCodes: [], isActive: true, createdAt: now, updatedAt: now },
  ];
}

function assertAutomationReadyCatalog(skus) {
  const audit = auditSkuCatalog(skus);
  assert.equal(audit.total, 13);
  assert.equal(audit.readyCount, 13);
  assert.equal(audit.catalogStructureIssueCount, 0);
  assert.equal(audit.blockingRepairCount, 0);
  assert.equal(audit.missingImageCount, 0);
  assert.equal(audit.commercialReadiness.canSubmitDesign, true);
  assert.equal(audit.commercialReadiness.canAutoQuote, true);

  const recommendation = recommendBundle({
    skus,
    budget: { perUnitAmount: 100, quantity: 50 },
    scene: "员工福利",
  });
  assert.equal(recommendation.status, "ready");
  assert.equal(recommendation.automation.ready, true);
  assert.equal(recommendation.totals.salePrice <= 100, true);

  const imageReadiness = inspectRealDesignReferences({
    assets: [{ id: "customer-logo", url: "https://example.test/customer/logo.png" }],
    bundle: { items: recommendation.items },
    requireCustomerAssets: true,
    requireCompleteBundle: true,
  });
  assert.equal(imageReadiness.ok, true);
}

test("seeded local store demo SKUs support low-value automation", (t) => {
  const store = createStore(t);
  const skus = store.listSkus();
  assertAutomationReadyCatalog(skus);
  const knowledgeEntries = store.listKnowledgeEntries();
  assert.equal(knowledgeEntries.filter((entry) => entry.sourceType === "starter_knowledge").length, 6);
  assert.equal(knowledgeEntries.some((entry) => /臻希 AI/.test(entry.content)), true);
});

test("normalizes existing old demo SKUs into an automation-ready catalog", (t) => {
  const store = createStore(t, emptyStoreData({ skus: oldDemoSkus() }));
  const skus = store.listSkus();

  assert.equal(skus.find((sku) => sku.skuCode === "TEA-B").salePrice, 45);
  assert.equal(skus.length, 13);
  assert.equal(skus.some((sku) => sku.skuCode === "BOX-REAL-1"), true);
  assert.equal(skus.find((sku) => sku.skuCode === "BOX-A").dimensions.lengthCm, 32);
  assert.match(skus.find((sku) => sku.skuCode === "CARD-A").mainImagePath, /^https:\/\/app\.zhenxiai\.cloud\/smart-kefu\/starter-skus\/card-a\.png$/);
  assertAutomationReadyCatalog(skus);
});

test("normalizing demo SKUs preserves locally archived product image references", (t) => {
  const imageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "local-store-demo-sku-existing-images-"));
  const localMainImage = path.join(imageRoot, "box-a-local.png");
  const localAngleImage = path.join(imageRoot, "box-a-angle.png");
  fs.writeFileSync(localMainImage, VALID_PNG);
  fs.writeFileSync(localAngleImage, VALID_PNG);
  t.after(() => fs.rmSync(imageRoot, { recursive: true, force: true }));
  const staleSkus = oldDemoSkus();
  staleSkus[0] = {
    ...staleSkus[0],
    mainImagePath: localMainImage,
    angleImages: [localAngleImage],
  };

  const store = createStore(t, emptyStoreData({ skus: staleSkus }));
  const skus = store.listSkus({ includeInactive: true });
  const box = skus.find((sku) => sku.skuCode === "BOX-A");

  assert.equal(box.mainImagePath, localMainImage);
  assert.deepEqual(box.angleImages, [localAngleImage]);
  assert.equal(box.dimensions.lengthCm, 32);
  assert.equal(skus.length, 13);
});

test("normalizing demo SKUs drops stale missing local product image references", (t) => {
  const imageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "local-store-demo-sku-missing-images-"));
  const missingMainImage = path.join(imageRoot, "box-a-missing.png");
  const missingAngleImage = path.join(imageRoot, "box-a-angle-missing.png");
  t.after(() => fs.rmSync(imageRoot, { recursive: true, force: true }));
  const staleSkus = oldDemoSkus();
  staleSkus[0] = {
    ...staleSkus[0],
    mainImagePath: missingMainImage,
    imageUrl: missingMainImage,
    angleImages: [missingAngleImage],
  };

  const store = createStore(t, emptyStoreData({ skus: staleSkus }));
  const skus = store.listSkus({ includeInactive: true });
  const box = skus.find((sku) => sku.skuCode === "BOX-A");

  assert.notEqual(box.mainImagePath, missingMainImage);
  assert.notEqual(box.imageUrl, missingMainImage);
  assert.equal(box.angleImages.includes(missingAngleImage), false);
  assert.match(box.mainImagePath, /^https:\/\/app\.zhenxiai\.cloud\/smart-kefu\/starter-skus\/box-a\.png$/);
  assertAutomationReadyCatalog(skus);
});
