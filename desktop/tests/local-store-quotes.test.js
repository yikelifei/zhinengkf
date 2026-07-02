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
