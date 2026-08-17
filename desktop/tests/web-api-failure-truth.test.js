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
  getReviewDesignJob,
  getReviewOrder,
  getReviewQuote,
  getRouteEvaluations,
  getSendAdapter,
  getSendAttempts,
  getSendTasks,
  getSkillSuggestions,
  getSkus,
  getTrainingOverview,
  getTrainingSamples,
  getWechatConversations,
  getWechatWindowSnapshots,
  isTrustedDesktopSessionError,
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
  ["wechat conversations", () => getWechatConversations()],
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
  ["review design job", () => getReviewDesignJob("design_1")],
  ["review quote", () => getReviewQuote("quote_1")],
  ["review order", () => getReviewOrder("order_1")],
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

test("desktop session 403 explains the desktop-window requirement", async () => {
  global.fetch = async () => ({
    ok: false,
    status: 403,
    async text() {
      return JSON.stringify({
        statusCode: 403,
        error: "Forbidden",
        code: "desktop_session_unavailable",
        message: "A verified Electron desktop session is required.",
      });
    },
  });

  await assert.rejects(() => getSendTasks(), (error) => {
    assert.equal(isTrustedDesktopSessionError(error), true);
    assert.match(error.message, /桌面端重新打开客服系统/);
    assert.doesNotMatch(error.message, /api 403/);
    return true;
  });
});

test("operator guard 403 is treated as a desktop-session problem, not a bare api 403", async () => {
  global.fetch = async () => ({
    ok: false,
    status: 403,
    async text() {
      return JSON.stringify({
        statusCode: 403,
        error: "Forbidden",
        code: "trusted_local_session_required",
        message: "A trusted local desktop session is required.",
      });
    },
  });

  await assert.rejects(() => getReviewCenter(), (error) => {
    assert.equal(isTrustedDesktopSessionError(error), true);
    assert.match(error.message, /可信会话鉴权|桌面端窗口/);
    assert.doesNotMatch(error.message, /api 403/);
    return true;
  });
});

test("design workspace reads translate desktop-session JSON instead of leaking raw 403 text", async () => {
  const designReads = [
    ["design jobs", () => getDesignJobs({})],
    ["SKUs", () => getSkus()],
    ["assets", () => getAssets()],
    ["wechat conversations", () => getWechatConversations()],
  ];

  for (const [name, read] of designReads) {
    global.fetch = async () => ({
      ok: false,
      status: 403,
      async text() {
        return JSON.stringify({
          statusCode: 403,
          error: "Forbidden",
          code: "desktop_session_proof_missing",
          message: "A verified Electron desktop session is required.",
        });
      },
    });

    await assert.rejects(read, (error) => {
      assert.equal(isTrustedDesktopSessionError(error), true, `${name} should be treated as a desktop session error`);
      assert.match(error.message, /桌面端重新打开客服系统|桌面端窗口/);
      assert.doesNotMatch(error.message, /api 403|statusCode|Forbidden/);
      return true;
    });
  }
});

test("unavailable launcher token tells the operator to restart the desktop launcher", async () => {
  global.fetch = async () => ({
    ok: false,
    status: 503,
    async text() {
      return JSON.stringify({
        statusCode: 503,
        error: "Service Unavailable",
        code: "trusted_local_session_unavailable",
        message: "The trusted local desktop session is unavailable.",
      });
    },
  });

  await assert.rejects(() => getSendAdapter(), (error) => {
    assert.equal(isTrustedDesktopSessionError(error), true);
    assert.match(error.message, /客服桌面启动器|Web 和 API/);
    assert.doesNotMatch(error.message, /api 503/);
    return true;
  });
});

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
  const assetsList = fs.readFileSync(
    path.resolve(__dirname, "../apps/web/src/features/design/design-assets-list-panel.tsx"),
    "utf8",
  );
  const assetsFeature = `${assetsPage}\n${assetsList}`;
  assert.doesNotMatch(assetsFeature, /请求失败折叠为空数组|当前空结果不能证明/);
  assert.match(assetsFeature, /assetsLoaded && assets\.length/);
  assert.match(assetsFeature, /assetsLoaded \? <DesignEmpty title="当前客户尚无素材"/);
  assert.match(assetsFeature, /<DesignEmpty title="素材状态未确认"/);
  assert.match(assetsFeature, /当前客户尚无素材/);
});
