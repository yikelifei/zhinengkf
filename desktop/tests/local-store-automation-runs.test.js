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

function createStore(seed) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-store-automation-"));
  const store = new LocalStoreService();
  store.filePath = path.join(tempDir, "local-store.json");
  if (seed) {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(store.filePath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  }
  return { store, tempDir };
}

function automationRun(overrides = {}) {
  return {
    trigger: "manual",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    steps: [],
    errors: [],
    results: {},
    ...overrides,
  };
}

test("local store persists automation runs newest first with a limit", () => {
  const { store } = createStore();

  for (let index = 0; index < 12; index += 1) {
    store.saveAutomationRun(
      automationRun({
        trigger: index % 2 ? "interval" : "manual",
        startedAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
        completedAt: `2026-01-01T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
      }),
      10,
    );
  }

  const runs = store.listAutomationRuns(20);
  assert.equal(runs.length, 10);
  assert.equal(runs[0].startedAt, "2026-01-01T00:00:11.000Z");
  assert.equal(runs.at(-1).startedAt, "2026-01-01T00:00:02.000Z");
});

test("local store de-duplicates automation run persistence by identity", () => {
  const { store } = createStore();
  const run = automationRun({
    trigger: "interval",
    startedAt: "2026-01-01T00:00:05.000Z",
    completedAt: "2026-01-01T00:00:06.000Z",
  });

  store.saveAutomationRun(run, 10);
  store.saveAutomationRun({ ...run, durationMs: 1200 }, 10);

  const runs = store.listAutomationRuns(10);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].durationMs, 1200);
});

test("local store normalizes legacy data without automation run history", () => {
  const { store } = createStore({
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
  });

  assert.deepEqual(store.listAutomationRuns(10), []);

  const stored = JSON.parse(fs.readFileSync(store.filePath, "utf8"));
  assert.deepEqual(stored.automationRuns, []);
});
