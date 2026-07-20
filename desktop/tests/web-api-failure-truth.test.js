"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", moduleResolution: "Node" },
});

const fs = require("node:fs");
const path = require("node:path");
const {
  getAgents,
  getAssets,
  getAutomationReadiness,
  getAutomationStatus,
  getChatImports,
  getDesignJobs,
  getNotifications,
  getOrderDrafts,
  getQuotes,
  getReviewCenter,
  getRouteEvaluations,
  getSendAdapter,
  getSendAttempts,
  getSendTasks,
  getSkillSuggestions,
  getSkus,
  getTrainingOverview,
  getTrainingSamples,
  getWechatWindowSnapshots,
} = require("../apps/web/src/lib/api.ts");

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

const reads = [
  ["design jobs", () => getDesignJobs({})],
  ["SKUs", () => getSkus()],
  ["assets", () => getAssets()],
  ["agents", () => getAgents()],
  ["chat imports", () => getChatImports()],
  ["training samples", () => getTrainingSamples()],
  ["training overview", () => getTrainingOverview()],
  ["send tasks", () => getSendTasks()],
  ["send attempts", () => getSendAttempts()],
  ["send adapter", () => getSendAdapter()],
  ["window snapshots", () => getWechatWindowSnapshots()],
  ["route evaluations", () => getRouteEvaluations()],
  ["skill suggestions", () => getSkillSuggestions()],
  ["automation status", () => getAutomationStatus()],
  ["automation readiness", () => getAutomationReadiness()],
  ["quotes", () => getQuotes()],
  ["order drafts", () => getOrderDrafts()],
  ["review center", () => getReviewCenter()],
  ["notifications", () => getNotifications()],
];

for (const [name, read] of reads) {
  test(`${name} exposes a rejected fetch instead of returning demo or empty data`, async () => {
    global.fetch = async () => {
      throw new TypeError("network unavailable");
    };

    await assert.rejects(read, /network unavailable/);
  });

  for (const status of [403, 500]) {
    test(`${name} exposes HTTP ${status} instead of returning demo or empty data`, async () => {
      global.fetch = async () => ({
        ok: false,
        status,
        async json() {
          throw new Error("error responses must not be decoded as successful data");
        },
      });

      await assert.rejects(read, new RegExp(`api ${status}`));
    });
  }
}

test("successful reads still return the API payload unchanged", async () => {
  const payload = [{ id: "real-api-row" }];
  global.fetch = async () => ({ ok: true, status: 200, async json() { return payload; } });

  for (const [, read] of reads) assert.equal(await read(), payload);
});

test("successful empty API payloads remain trusted empty results", async () => {
  const payload = [];
  global.fetch = async () => ({ ok: true, status: 200, async json() { return payload; } });

  for (const [, read] of reads) assert.equal(await read(), payload);

  const assetsPage = fs.readFileSync(
    path.resolve(__dirname, "../apps/web/src/features/design/design-assets-page.tsx"),
    "utf8",
  );
  assert.doesNotMatch(assetsPage, /请求失败折叠为空数组|当前空结果不能证明/);
  assert.match(assetsPage, /当前客户尚无素材/);
});
