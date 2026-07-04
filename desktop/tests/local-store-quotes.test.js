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

function createStore(seed) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-store-quotes-"));
  const store = new LocalStoreService();
  store.filePath = path.join(tempDir, "local-store.json");
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(store.filePath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  return { store, tempDir };
}

test("local design image upsert preserves selected state on repeated callbacks", () => {
  const { store } = createStore(
    emptyStoreData({
      designJobs: [{ id: "design_1", requestId: "request_1" }],
      designImages: [
        {
          id: "image_1",
          designJobId: "design_1",
          imageId: "candidate_1",
          selected: true,
          customerFeedback: "客户选了第一张",
          localPath: "C:\\storage\\old.png",
        },
      ],
    }),
  );

  const [image] = store.upsertDesignImages("design_1", [
    {
      imageId: "candidate_1",
      position: 1,
      downloadUrl: "https://example.test/candidate-1.png",
      localPath: "C:\\storage\\new.png",
    },
  ]);

  assert.equal(image.id, "image_1");
  assert.equal(image.selected, true);
  assert.equal(image.customerFeedback, "客户选了第一张");
  assert.equal(image.localPath, "C:\\storage\\new.png");
});

test("local quote draft goes to manual review when bundle automation is blocked", () => {
  const { store } = createStore(
    emptyStoreData({
      customers: [{ id: "customer_1", name: "Customer" }],
      conversations: [{ id: "conversation_1", customerId: "customer_1", wechatAccountId: "wechat_1" }],
      designJobs: [
        {
          id: "design_1",
          requestId: "request_1",
          customerId: "customer_1",
          conversationId: "conversation_1",
          wechatAccountId: "wechat_1",
          isHighValue: false,
          budget: { quantity: 20 },
          bundle: {
            items: [{ skuCode: "BOX-A", salePrice: 100, costPrice: 60 }],
            automation: { ready: false, blockers: ["size_unknown"] },
          },
        },
      ],
      designImages: [{ id: "image_1", designJobId: "design_1", imageId: "candidate_1", selected: true }],
    }),
  );

  const quote = store.createQuoteFromDesignJob("design_1", "image_1");

  assert.equal(quote.status, "manual_review");
  assert.equal(quote.totalPrice, 2000);
  assert.equal(quote.profit, 800);
});

test("local quote draft goes to manual review when computed amount is high value", () => {
  const { store } = createStore(
    emptyStoreData({
      customers: [{ id: "customer_1", name: "Customer" }],
      conversations: [{ id: "conversation_1", customerId: "customer_1", wechatAccountId: "wechat_1" }],
      designJobs: [
        {
          id: "design_1",
          requestId: "request_1",
          customerId: "customer_1",
          conversationId: "conversation_1",
          wechatAccountId: "wechat_1",
          isHighValue: false,
          budget: { quantity: 100 },
          bundle: {
            items: [{ skuCode: "BOX-A", salePrice: 120, costPrice: 60, imageUrl: "https://example.test/box.png" }],
            automation: { ready: true },
          },
        },
      ],
      designImages: [{ id: "image_1", designJobId: "design_1", imageId: "candidate_1", selected: true }],
    }),
  );

  const quote = store.createQuoteFromDesignJob("design_1", "image_1");

  assert.equal(quote.totalPrice, 12000);
  assert.equal(quote.status, "manual_review");
});

test("local quote draft without explicit image does not reuse an old selected revision image", () => {
  const { store } = createStore(
    emptyStoreData({
      customers: [{ id: "customer_1", name: "Customer" }],
      conversations: [{ id: "conversation_1", customerId: "customer_1", wechatAccountId: "wechat_1" }],
      designJobs: [
        {
          id: "design_1",
          requestId: "request_1",
          customerId: "customer_1",
          conversationId: "conversation_1",
          wechatAccountId: "wechat_1",
          isHighValue: false,
          budget: { quantity: 20 },
          bundle: {
            items: [{ skuCode: "BOX-A", salePrice: 100, costPrice: 60, imageUrl: "https://example.test/box.png" }],
            automation: { ready: true },
          },
        },
      ],
      designImages: [
        { id: "initial_1", designJobId: "design_1", imageId: "candidate_1", position: 1, selected: true },
        { id: "revision_1", designJobId: "design_1", imageId: "r1-candidate_1", position: 101, selected: false },
        { id: "revision_2", designJobId: "design_1", imageId: "r1-candidate_2", position: 102, selected: false },
      ],
    }),
  );

  const quote = store.createQuoteFromDesignJob("design_1");

  assert.equal(quote.selectedImageId, null);
  assert.equal(quote.selectedImage, null);
});

test("local quote draft without explicit image uses the selected image from latest revision round", () => {
  const { store } = createStore(
    emptyStoreData({
      customers: [{ id: "customer_1", name: "Customer" }],
      conversations: [{ id: "conversation_1", customerId: "customer_1", wechatAccountId: "wechat_1" }],
      designJobs: [
        {
          id: "design_1",
          requestId: "request_1",
          customerId: "customer_1",
          conversationId: "conversation_1",
          wechatAccountId: "wechat_1",
          isHighValue: false,
          budget: { quantity: 20 },
          bundle: {
            items: [{ skuCode: "BOX-A", salePrice: 100, costPrice: 60, imageUrl: "https://example.test/box.png" }],
            automation: { ready: true },
          },
        },
      ],
      designImages: [
        { id: "initial_1", designJobId: "design_1", imageId: "candidate_1", position: 1, selected: true },
        { id: "revision_1", designJobId: "design_1", imageId: "r1-candidate_1", position: 101, selected: false },
        { id: "revision_2", designJobId: "design_1", imageId: "r1-candidate_2", position: 102, selected: true },
      ],
    }),
  );

  const quote = store.createQuoteFromDesignJob("design_1");

  assert.equal(quote.selectedImageId, "revision_2");
  assert.equal(quote.selectedImage.imageId, "r1-candidate_2");
});

test("local quote draft still allows an explicit old image selection for manual correction", () => {
  const { store } = createStore(
    emptyStoreData({
      customers: [{ id: "customer_1", name: "Customer" }],
      conversations: [{ id: "conversation_1", customerId: "customer_1", wechatAccountId: "wechat_1" }],
      designJobs: [
        {
          id: "design_1",
          requestId: "request_1",
          customerId: "customer_1",
          conversationId: "conversation_1",
          wechatAccountId: "wechat_1",
          isHighValue: false,
          budget: { quantity: 20 },
          bundle: {
            items: [{ skuCode: "BOX-A", salePrice: 100, costPrice: 60, imageUrl: "https://example.test/box.png" }],
            automation: { ready: true },
          },
        },
      ],
      designImages: [
        { id: "initial_1", designJobId: "design_1", imageId: "candidate_1", position: 1, selected: true },
        { id: "revision_1", designJobId: "design_1", imageId: "r1-candidate_1", position: 101, selected: false },
      ],
    }),
  );

  const quote = store.createQuoteFromDesignJob("design_1", "initial_1");

  assert.equal(quote.selectedImageId, "initial_1");
  assert.equal(quote.selectedImage.imageId, "candidate_1");
});
