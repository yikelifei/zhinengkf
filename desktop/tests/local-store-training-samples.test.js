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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-store-training-"));
  const store = new LocalStoreService();
  store.filePath = path.join(tempDir, "local-store.json");
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(store.filePath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  return { store, tempDir };
}

test("human approval confirms uncertain imported scene for route memory", () => {
  const now = "2026-07-02T00:00:00.000Z";
  const { store } = createStore(
    emptyStoreData({
      trainingSamples: [
        {
          id: "sample_uncertain_import",
          importId: "import_1",
          sourceType: "chat_import",
          status: "review",
          agentId: "agent_general",
          agentKey: "general",
          scene: "unclassified",
          sceneScore: 8,
          matchedKeywords: ["refund"],
          sceneCheck: { status: "weak", reason: "only_weak_scene_signal", needsReview: true },
          customerText: "cup broken refund help",
          idealReply: "I can help confirm the issue and give the next step.",
          score: 96,
          skillHints: ["after sales"],
          createdAt: now,
          updatedAt: now,
        },
      ],
      chatImports: [
        {
          id: "import_1",
          name: "manual chat",
          pairCount: 1,
          sceneSummary: {
            sampleCount: 1,
            clearCount: 0,
            weakCount: 1,
            ambiguousCount: 0,
            unmatchedCount: 0,
            sceneUncertainCount: 1,
            readyCount: 0,
            reviewCount: 1,
            rejectedCount: 0,
          },
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  );

  const result = store.reviewTrainingSample("sample_uncertain_import", {
    status: "ready",
    agentKey: "after_sales",
    scene: "after_sales",
    reviewer: "operator",
    note: "confirmed after-sales scene",
  });

  assert.equal(result.sample.status, "ready");
  assert.equal(result.sample.agentKey, "after_sales");
  assert.equal(result.sample.sceneCheck.status, "clear");
  assert.equal(result.sample.sceneCheck.reason, "human_confirmed_scene");
  assert.equal(result.sample.sceneCheck.needsReview, false);
  assert.equal(result.sample.sceneCheck.topScene.agentKey, "after_sales");
  assert.equal(result.sample.sceneCheck.topScene.score, 30);
  assert.equal(
    result.reviewLog.metadata.changedFields.some((field) => field.field === "sceneCheck"),
    true,
  );
  assert.deepEqual(store.listChatImports()[0].sceneSummary, {
    sampleCount: 1,
    clearCount: 1,
    weakCount: 0,
    ambiguousCount: 0,
    unmatchedCount: 0,
    sceneUncertainCount: 0,
    readyCount: 1,
    reviewCount: 0,
    rejectedCount: 0,
  });
});

test("chat import stores scene summary for later review", () => {
  const { store } = createStore(
    emptyStoreData({
      agents: [
        { id: "agent_general", key: "general", name: "General Agent" },
        { id: "agent_after_sales", key: "after_sales", name: "After Sales Agent" },
      ],
    }),
  );

  const result = store.createChatImport(
    { name: "manual chat", text: "customer/service pairs" },
    {
      messageCount: 4,
      pairCount: 2,
      warnings: ["line ignored"],
      pairs: [
        {
          question: "broken cup refund",
          answer: "I will help check the issue.",
          scene: "after_sales",
          agentKey: "after_sales",
          sceneScore: 8,
          matchedKeywords: ["refund"],
          sceneScores: [],
          sceneCheck: { status: "weak", reason: "only_weak_scene_signal", needsReview: true },
          score: 96,
        },
        {
          question: "hello",
          answer: "I can help.",
          scene: "general",
          agentKey: "general",
          sceneScore: 20,
          matchedKeywords: ["hello"],
          sceneScores: [],
          sceneCheck: { status: "clear", reason: "top_scene_confident", needsReview: false },
          score: 62,
        },
      ],
    },
  );

  assert.deepEqual(result.sceneSummary, {
    sampleCount: 2,
    clearCount: 1,
    weakCount: 1,
    ambiguousCount: 0,
    unmatchedCount: 0,
    sceneUncertainCount: 1,
    readyCount: 1,
    reviewCount: 1,
    rejectedCount: 0,
  });
  assert.equal(result.samples.length, 2);
  assert.equal(Boolean(result.samples[0].quality), true);
  assert.deepEqual(store.listChatImports()[0].sceneSummary, result.sceneSummary);
});
