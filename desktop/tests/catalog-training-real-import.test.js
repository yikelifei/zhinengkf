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

const {
  buildKnowledgeImportAcceptance,
  buildKnowledgeImportTemplateCsv,
  getKnowledgeImportFieldGuide,
  parseKnowledgeImportText,
} = require("../packages/rules/knowledgeImport");
const { parseSkuImportText } = require("../packages/rules/skuImport");
const { buildSkuImportOperationalAcceptance } = require("../apps/web/src/features/catalog/catalog-import-page");

test("knowledge import parser validates real SOP rows before writing", () => {
  const parsed = parseKnowledgeImportText([
    "知识标题,知识正文,Agent Key,场景标签,资料来源,质量分",
    "\"报价 SOP\",\"客户问价格时先确认用途、数量、预算和交付时间；高价值订单必须人工复核。\",pre_sales,\"报价、预算\",\"客服主管 SOP\",92",
    "\"坏行\",\"太短\",pre_sales,\"报价\",\"客服主管 SOP\",90",
  ].join("\n"));

  assert.equal(parsed.ok, false);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /content must include actionable SOP text/);
  assert.equal(parsed.acceptance.blocked, true);
});

test("knowledge import template and fields expose required operational columns", () => {
  const fields = getKnowledgeImportFieldGuide();
  const template = buildKnowledgeImportTemplateCsv();
  assert.deepEqual(fields.filter((field) => field.required).map((field) => field.field), ["title", "content"]);
  assert.match(template, /知识标题/);
  assert.match(template, /知识正文/);
  assert.match(template, /Agent Key/);
});

test("SKU import parser accepts common skuCode spreadsheet headers", () => {
  const parsed = parseSkuImportText([
    "skuCode,name,type,salePrice,costPrice,stock,mainImagePath",
    "BOX-HEADER-1,表头验收礼盒,gift_box,88,42,30,E:\\products\\box-main.jpg",
  ].join("\n"));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].skuCode, "BOX-HEADER-1");
  assert.equal(parsed.missingRequiredFields.length, 0);
});

test("knowledge import acceptance marks missing agent and tags as pending work", () => {
  const acceptance = buildKnowledgeImportAcceptance([
    { title: "售后 SOP", content: "客户反馈破损时先收集照片、面单和订单号，再判断补发或人工复核。", qualityScore: 70, tags: [] },
  ]);
  assert.equal(acceptance.blocked, false);
  assert.equal(acceptance.missingAgentCount, 1);
  assert.equal(acceptance.missingTagsCount, 1);
  assert.equal(acceptance.needsReviewCount, 1);
  assert.match(acceptance.nextActions.join("\n"), /补齐 Agent 归属/);
});

test("catalog import acceptance reuses preview audit and exposes missing real data", () => {
  const acceptance = buildSkuImportOperationalAcceptance({
    ok: true,
    importedCount: 1,
    skippedCount: 0,
    rows: [{ skuCode: "BOX-9", name: "真实礼盒", type: "gift_box", costPrice: 10, salePrice: 20 }],
    errors: [],
    missingRequiredFields: [],
    fieldMapping: [
      { field: "skuCode", label: "SKU", required: true, example: "", description: "", aliases: [], sourceHeader: "skuCode", column: 1, matched: true },
      { field: "name", label: "名称", required: true, example: "", description: "", aliases: [], sourceHeader: "name", column: 2, matched: true },
      { field: "salePrice", label: "售价", required: true, example: "", description: "", aliases: [], sourceHeader: "salePrice", column: 3, matched: true },
    ],
    audit: {
      total: 1,
      readyCount: 0,
      issueCount: 3,
      errorCount: 0,
      warningCount: 3,
      infoCount: 0,
      missingImageCount: 1,
      lowStockCount: 1,
      negativeMarginCount: 0,
      leadTimeIssueCount: 1,
      invalidImageCount: 0,
      imageIssueCount: 1,
      availableCategoryCount: 1,
      availableSceneTagCount: 2,
      commercialReadiness: {
        score: 42,
        level: "blocked",
        canAutoBundle: false,
        canSubmitDesign: false,
        canAutoQuote: false,
        summary: "商品库暂不适合自动化，需要先补齐基础商品结构和关键资料。",
        blockers: ["missing_image"],
        nextActions: ["补真实商品图片", "补可搭配礼盒和内搭"],
      },
      issues: [],
    },
  });
  assert.equal(acceptance.blocked, false);
  assert.equal(acceptance.warnings.length, 3);
  assert.match(acceptance.warnings.join("\n"), /缺真实主图/);
  assert.match(acceptance.warnings.join("\n"), /供应商或交期/);
  assert.equal(acceptance.imageCoverageLabel, "0 / 1");
  assert.equal(acceptance.categoryCoverageLabel, "1 分类 / 2 场景");
  assert.equal(acceptance.bundleReadinessLabel, "待补礼盒或内搭");
  assert.equal(acceptance.designReadinessLabel, "待补图片/规格/组合");
  assert.equal(acceptance.quoteReadinessLabel, "需人工报价复核");
  assert.equal(acceptance.readinessScore, 42);
  assert.deepEqual(acceptance.nextActions, ["补真实商品图片", "补可搭配礼盒和内搭"]);
});

test("catalog import preview renders real product package readiness", () => {
  const source = read("apps/web/src/features/catalog/catalog-import-page.tsx");
  assert.match(source, /downloadSkuImportTemplate\("xlsx"\)/);
  assert.match(source, /data-action-id="catalog-import-download-template"/);
  assert.match(source, /commercialReadiness/);
  assert.match(source, /imageCoverageLabel/);
  for (const actionId of [
    "catalog-import-image-coverage",
    "catalog-import-category-coverage",
    "catalog-import-bundle-readiness",
    "catalog-import-design-readiness",
    "catalog-import-quote-readiness",
    "catalog-import-commercial-score",
    "catalog-import-readiness-summary",
    "catalog-import-next-actions",
  ]) {
    assert.match(source, new RegExp(actionId));
  }
});

test("training import page exposes knowledge import without faking training completion", () => {
  const source = read("apps/web/src/features/training/training-import-page.tsx");
  const preview = read("apps/web/src/features/training/training-knowledge-preview.tsx");
  const api = read("apps/web/src/lib/api.ts");
  const doc = read("docs/CATALOG_TRAINING_REAL_IMPORT.md");
  assert.match(source, /training-import-mode-knowledge/);
  assert.match(source, /handleKnowledgeFileChange/);
  assert.match(source, /data-action-id="training-knowledge-file"/);
  assert.match(source, /accept="\.csv,\.tsv,\.json,text\/csv,text\/tab-separated-values,application\/json"/);
  assert.match(source, /file\.text\(\)/);
  assert.match(source, /training-knowledge-preview/);
  assert.match(source, /training-knowledge-confirm/);
  assert.match(preview, /data-knowledge-import-acceptance-summary/);
  assert.match(preview, /data-knowledge-import-save-summary/);
  assert.match(preview, /data-knowledge-import-next-actions/);
  assert.match(preview, /data-knowledge-import-blockers/);
  assert.match(preview, /data-knowledge-import-saved-next/);
  assert.match(preview, /saved\.count/);
  assert.match(preview, /saved\.failed/);
  assert.match(preview, /确认写入知识库/);
  assert.match(source, /不会自动变成已训练技能|不会自动应用为 Agent 技能/);
  assert.match(api, /\/training\/knowledge\/import-preview/);
  assert.match(api, /\/training\/knowledge\/import/);
  assert.match(doc, /写入现有 `KnowledgeEntry`/);
  assert.match(doc, /不会自动应用为 Agent 技能/);
});
