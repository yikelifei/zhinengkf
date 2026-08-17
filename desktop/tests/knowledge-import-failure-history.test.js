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
const { TrainingService } = require("../apps/api/src/training/training.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

test("failed knowledge import preview is persisted as an idempotent import batch log", () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  try {
    const { store } = createStore(emptyStoreData());
    const service = new TrainingService(store, { create: async () => ({}) });
    const payload = {
      operationKey: "knowledge:preview:failure:0001",
      source: "bad-sop-preview",
      text: "[]",
    };

    const first = service.previewKnowledgeImport(payload);
    const replay = service.previewKnowledgeImport(payload);

    assert.equal(first.ok, false);
    assert.equal(first.history.afterStatus, "failed");
    assert.equal(first.history.targetType, "knowledge_import");
    assert.equal(first.history.metadata.source, "bad-sop-preview");
    assert.equal(first.history.metadata.failure.phase, "preview_failed");
    assert.equal(replay.history.id, first.history.id);
    assert.equal(store.listReviewLogs(20).filter((log) => log.targetType === "knowledge_import").length, 1);

    assert.throws(
      () => service.previewKnowledgeImport({ ...payload, text: "{invalid json" }),
      /operationKey was already used|OPERATION_KEY_REUSED/,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
  }
});

test("knowledge import with only skipped rows records a failed retryable batch", () => {
  const { store } = createStore(emptyStoreData());
  const saved = store.importKnowledgeEntries(
    [{
      title: "Logistics exception SOP",
      content: "When delivery is delayed, confirm carrier status, promise a new ETA, and document the customer decision.",
      agentKey: "missing_agent",
      tags: ["logistics"],
      qualityScore: 90,
    }],
    {
      operationKey: "knowledge:import:skipped:0001",
      source: "bad-agent-import",
    },
  );

  assert.equal(saved.count, 0);
  assert.equal(saved.failed, true);
  assert.equal(saved.skipped.length, 1);
  assert.equal(saved.reviewLog.afterStatus, "failed");
  assert.equal(saved.reviewLog.metadata.failure.reason, "no_importable_rows");
  assert.equal(saved.reviewLog.metadata.skipped[0].reason, "agent_not_found");
  assert.equal(store.listKnowledgeEntries({ includeReview: true }).some((entry) => entry.sourceId === "bad-agent-import"), false);
  assert.equal(store.listReviewLogs(20).filter((log) => log.targetType === "knowledge_import").length, 1);
});

function createStore(seed) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-import-failure-"));
  const store = new LocalStoreService();
  store.filePath = path.join(tempDir, "local-store.json");
  fs.writeFileSync(store.filePath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  return { store, tempDir };
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
