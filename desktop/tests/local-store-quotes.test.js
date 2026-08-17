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
    paymentEvents: [],
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

test("local quote and order bundle snapshots backfill product images from sku catalog", () => {
  const { store } = createStore(
    emptyStoreData({
      skus: [
        {
          id: "sku_box_a",
          skuCode: "BOX-A",
          name: "Gift Box A",
          type: "gift_box",
          category: "box",
          mainImagePath: "storage/skus/box-a.png",
          imageUrl: "storage/skus/box-a.png",
          angleImages: ["storage/skus/box-a-side.png"],
        },
      ],
      designJobs: [
        {
          id: "design_1",
          requestId: "request_1",
          customerId: "customer_1",
          conversationId: "conversation_1",
          wechatAccountId: "wechat_1",
          bundle: {
            items: [{ skuCode: "BOX-A", name: "????A", salePrice: 100, costPrice: 60 }],
            automation: { ready: true },
          },
        },
      ],
      quoteDrafts: [
        {
          id: "quote_1",
          designJobId: "design_1",
          customerId: "customer_1",
          selectedImageId: "image_1",
          quantity: 10,
          unitPrice: 100,
          totalPrice: 1000,
          totalCost: 600,
          profit: 400,
          status: "accepted",
          paymentStatus: "unpaid",
          owner: "????",
          customerNotes: "??????????????",
        },
      ],
      orderDrafts: [
        {
          id: "order_1",
          quoteDraftId: "quote_1",
          designJobId: "design_1",
          customerId: "customer_1",
          conversationId: "conversation_1",
          wechatAccountId: "wechat_1",
          selectedImageId: "image_1",
          quantity: 10,
          unitPrice: 100,
          totalPrice: 1000,
          totalCost: 600,
          profit: 400,
          status: "draft",
          paymentStatus: "unpaid",
          owner: "????",
          customerNotes: "??????????????",
        },
      ],
      designImages: [{ id: "image_1", designJobId: "design_1", imageId: "candidate_1" }],
    }),
  );

  const quote = store.getQuoteDraft("quote_1");
  const order = store.getOrderDraft("order_1");
  const designJob = store.getDesignJob("design_1");

  assert.equal(designJob.bundle.items[0].imageUrl, "storage/skus/box-a.png");
  assert.equal(designJob.bundle.items[0].mainImagePath, "storage/skus/box-a.png");
  assert.equal(designJob.bundle.items[0].name, "红金礼盒A");
  assert.deepEqual(designJob.bundle.items[0].angleImages, ["storage/skus/box-a-side.png"]);
  assert.equal(quote.bundleSnapshot.items[0].imageUrl, "storage/skus/box-a.png");
  assert.equal(quote.bundleSnapshot.items[0].mainImagePath, "storage/skus/box-a.png");
  assert.equal(quote.bundleSnapshot.items[0].name, "红金礼盒A");
  assert.equal(quote.owner, "人工客服");
  assert.equal(quote.customerNotes, "历史备注不可读，请人工复核。");
  assert.deepEqual(quote.bundleSnapshot.items[0].angleImages, ["storage/skus/box-a-side.png"]);
  assert.equal(order.bundleSnapshot.items[0].imageUrl, "storage/skus/box-a.png");
  assert.equal(order.bundleSnapshot.items[0].name, "红金礼盒A");
  assert.equal(order.owner, "人工客服");
  assert.equal(order.customerNotes, "历史备注不可读，请人工复核。");
  assert.equal(order.quoteDraft.bundleSnapshot.items[0].imageUrl, "storage/skus/box-a.png");
  assert.equal(order.quoteDraft.bundleSnapshot.items[0].name, "红金礼盒A");
  assert.equal(order.quoteDraft.owner, "人工客服");
  assert.equal(order.quoteDraft.customerNotes, "历史备注不可读，请人工复核。");
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

test("local payment event rejects operationKey reuse with changed proof details", () => {
  const { store } = createStore(
    emptyStoreData({
      quoteDrafts: [{ id: "quote_1", customerId: "customer_1", designJobId: "design_1" }],
      orderDrafts: [{
        id: "order_1",
        quoteDraftId: "quote_1",
        customerId: "customer_1",
        conversationId: "conversation_1",
        wechatAccountId: "wechat_1",
      }],
    }),
  );
  const payload = {
    quoteDraftId: "quote_1",
    orderDraftId: "order_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    wechatAccountId: "wechat_1",
    paymentStatus: "deposit_paid",
    amountCny: 3000,
    method: "bank_transfer",
    proofReference: "proof-quote-1",
    reviewer: "operator-1",
    note: "verified deposit",
    source: "manual_payment_proof",
    idempotencyKey: "payment-proof:11111111-1111-4111-8111-111111111111:payment-event",
  };

  const first = store.recordPaymentEvent(payload);
  const replay = store.recordPaymentEvent(payload);

  assert.equal(replay.id, first.id);
  assert.throws(
    () => store.recordPaymentEvent({ ...payload, amountCny: 5000 }),
    /operationKey was already used with different payment proof details/,
  );
  assert.equal(store.listPaymentEvents({ quoteDraftId: "quote_1" }).length, 1);
});
