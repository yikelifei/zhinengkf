"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
});

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const { buildCatalogOperationReadiness } = require("../apps/web/src/features/catalog/catalog-audit-page");
const { buildKnowledgeImportHistory } = require("../apps/web/src/features/training/training-import-history-page");
const { buildTrainingKnowledgeAcceptance } = require("../apps/web/src/features/training/training-overview-page");

test("catalog operations acceptance is driven by real audit results", () => {
  const readyAudit = {
    total: 13,
    readyCount: 13,
    issueCount: 0,
    errorCount: 0,
    warningCount: 0,
    missingImageCount: 0,
    lowStockCount: 0,
    negativeMarginCount: 0,
    availableSceneTagCount: 6,
    budgetBandCoverage: [{ available: true }, { available: true }, { available: false }],
    commercialReadiness: {
      score: 95,
      level: "ready",
      canAutoBundle: true,
      canSubmitDesign: true,
      canAutoQuote: true,
      summary: "ready",
      blockers: [],
      nextActions: [],
    },
    dataReadiness: {
      level: "verified",
      totalCount: 13,
      operatorProvidedCount: 13,
      demoImageCount: 0,
      customerReplyEligibleCount: 13,
      unverifiedCount: 0,
      internalTestReady: true,
      customerReplyReady: true,
      summary: "verified",
      blockers: [],
      nextActions: [],
    },
    repairQueueCount: 0,
    blockingRepairCount: 0,
    issues: [],
  };
  const ready = buildCatalogOperationReadiness(readyAudit);
  assert.deepEqual(ready.map((item) => item.key), ["view", "import", "audit", "repair", "bundle", "quote"]);
  assert.equal(ready.find((item) => item.key === "view").status, "ready");
  assert.equal(ready.find((item) => item.key === "import").status, "review");
  assert.equal(ready.find((item) => item.key === "bundle").status, "ready");
  assert.equal(ready.find((item) => item.key === "quote").status, "ready");

  const testOnly = buildCatalogOperationReadiness({
    ...readyAudit,
    dataReadiness: {
      ...readyAudit.dataReadiness,
      level: "test_only",
      operatorProvidedCount: 0,
      demoImageCount: 13,
      customerReplyEligibleCount: 0,
      unverifiedCount: 13,
      customerReplyReady: false,
    },
  });
  assert.equal(testOnly.find((item) => item.key === "view").status, "review");
  assert.equal(testOnly.find((item) => item.key === "bundle").status, "review");
  assert.equal(testOnly.find((item) => item.key === "quote").status, "blocked");

  const blocked = buildCatalogOperationReadiness({
    ...readyAudit,
    total: 0,
    readyCount: 0,
    issueCount: 3,
    errorCount: 2,
    warningCount: 1,
    repairQueueCount: 3,
    blockingRepairCount: 2,
    commercialReadiness: {
      ...readyAudit.commercialReadiness,
      level: "blocked",
      canAutoBundle: false,
      canSubmitDesign: false,
      canAutoQuote: false,
      blockers: ["missing sku"],
    },
  });
  assert.equal(blocked.find((item) => item.key === "view").status, "blocked");
  assert.equal(blocked.find((item) => item.key === "audit").status, "blocked");
  assert.equal(blocked.find((item) => item.key === "repair").status, "blocked");
  assert.equal(blocked.find((item) => item.key === "quote").status, "blocked");
});

test("training knowledge acceptance separates starter SOP from custom knowledge", () => {
  const acceptance = buildTrainingKnowledgeAcceptance([
    { id: "starter-1", agentId: "agent_pre_sales", title: "报价 SOP", sourceType: "starter_knowledge", tags: ["报价", "预算"], qualityScore: 95 },
    { id: "starter-2", agentId: "agent_logistics", title: "物流 SOP", sourceType: "starter_knowledge", tags: ["物流"] },
    { id: "custom-1", agentId: "agent_pre_sales", title: "客户纠错", sourceType: "route_correction", tags: ["报价", "纠错"], qualityScore: 82 },
    { id: "custom-2", agentKey: "after_sales", title: "售后沉淀", sourceType: "chat_import", tags: ["售后"] },
  ]);

  assert.equal(acceptance.total, 4);
  assert.equal(acceptance.starterCount, 2);
  assert.equal(acceptance.customCount, 2);
  assert.equal(acceptance.agentCount, 3);
  assert.deepEqual(acceptance.topTags[0], { name: "报价", count: 2 });
  assert.equal(acceptance.latestEntries.length, 4);
});

test("knowledge import history groups manual knowledge batches for review and retry", () => {
  const history = buildKnowledgeImportHistory([
    {
      id: "knowledge-1",
      sourceType: "manual_knowledge_import",
      sourceId: "2026-07售前SOP",
      title: "报价澄清 SOP",
      status: "review",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T01:00:00.000Z",
    },
    {
      id: "knowledge-2",
      sourceType: "manual_knowledge_import",
      sourceId: "2026-07售前SOP",
      title: "预算确认 SOP",
      status: "ready",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T02:00:00.000Z",
    },
    {
      id: "knowledge-3",
      sourceType: "manual_knowledge_import",
      sourceId: "2026-07物流SOP",
      title: "发货异常 SOP",
      status: "ready",
      createdAt: "2026-07-02T00:00:00.000Z",
    },
    {
      id: "starter-knowledge",
      sourceType: "starter_knowledge",
      sourceId: "starter",
      title: "内置 SOP",
      status: "ready",
    },
  ]);

  assert.equal(history.length, 2);
  assert.equal(history[0].source, "2026-07物流SOP");
  assert.equal(history[0].needsAction, false);
  assert.equal(history[1].source, "2026-07售前SOP");
  assert.equal(history[1].total, 2);
  assert.equal(history[1].ready, 1);
  assert.equal(history[1].review, 1);
  assert.equal(history[1].needsAction, true);
  assert.deepEqual(history[1].sampleTitles, ["报价澄清 SOP", "预算确认 SOP"]);
});

test("knowledge import history surfaces failed batches from review logs", () => {
  const history = buildKnowledgeImportHistory([], [
    {
      id: "review-knowledge-failed",
      targetType: "knowledge_import",
      targetId: "knowledge:preview:failure:0001",
      decision: "import_manual_knowledge_failed",
      reviewer: "operator",
      note: "failed",
      beforeStatus: "",
      afterStatus: "failed",
      metadata: {
        source: "bad-sop-preview",
        skipped: [{ line: 0, message: "JSON 中没有 rows 数组或知识条目数组" }],
        failure: { phase: "preview_failed", errors: [{ line: 0, message: "JSON 中没有 rows 数组或知识条目数组" }] },
      },
      createdAt: "2026-07-03T00:00:00.000Z",
    },
  ]);

  assert.equal(history.length, 1);
  assert.equal(history[0].source, "bad-sop-preview");
  assert.equal(history[0].failed, 1);
  assert.equal(history[0].needsAction, true);
  assert.deepEqual(history[0].sampleTitles, ["JSON 中没有 rows 数组或知识条目数组"]);
});

test("catalog and training acceptance pages reuse wrappers and do not fake business states", () => {
  const catalogAudit = read("apps/web/src/features/catalog/catalog-audit-page.tsx");
  const trainingOverview = read("apps/web/src/features/training/training-overview-page.tsx");
  const catalogApi = read("apps/web/src/features/catalog/api.ts");

  assert.match(catalogAudit, /buildCatalogOperationReadiness\(audit\)/);
  assert.match(catalogAudit, /\/catalog\/products/);
  assert.match(catalogAudit, /\/catalog\/import/);
  assert.match(catalogAudit, /\/catalog\/repair/);
  assert.match(catalogAudit, /\/catalog\/bundles/);
  assert.match(catalogAudit, /\/sales\/quotes/);
  assert.match(trainingOverview, /getTrainingKnowledgeEntries/);
  assert.match(trainingOverview, /buildTrainingKnowledgeAcceptance\(knowledgeEntries\)/);
  assert.match(trainingOverview, /Skill 与知识运营验收/);
  assert.match(catalogApi, /getSkuCatalogAudit/);
  assert.match(catalogAudit, /不声明已付款、已发货/);
  assert.match(trainingOverview, /不声明已训练完成/);
  for (const source of [catalogAudit, trainingOverview]) {
    assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\b|return\s+\[\]/);
    assert.doesNotMatch(source, /\b(status|state)\s*[:=]\s*["'](?:paid|fulfilled|delivered)["']/i);
  }
});

test("catalog and knowledge acceptance documentation records real remaining data work", () => {
  const doc = read("docs/CATALOG_TRAINING_ACCEPTANCE.md");
  for (const phrase of [
    "商品库运营验收",
    "知识库运营验收",
    "不伪造已付款、已发货、已训练",
    "用户需要补充",
  ]) {
    assert.match(doc, new RegExp(phrase));
  }
});
