"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { evaluateAgentRoute, parseBudget, parseKnowledgeImportText } = require("../packages/rules");

const evaluationPath = path.join(
  __dirname,
  "..",
  "docs",
  "knowledge-base",
  "companion-gift-industry-evaluation-2026-08-14.json",
);
const knowledgePath = path.join(
  __dirname,
  "..",
  "docs",
  "knowledge-base",
  "companion-gift-industry-knowledge-2026-08-14.json",
);
const highVolumeEvaluationPath = path.join(
  __dirname,
  "..",
  "docs",
  "knowledge-base",
  "companion-gift-high-volume-low-unit-evaluation-2026-08-14.json",
);
const highVolumeKnowledgePath = path.join(
  __dirname,
  "..",
  "docs",
  "knowledge-base",
  "companion-gift-high-volume-low-unit-knowledge-2026-08-14.json",
);

const evaluation = JSON.parse(fs.readFileSync(evaluationPath, "utf8"));

test("routes all companion-gift industry evaluation questions to the intended agent", () => {
  assert.equal(evaluation.cases.length, evaluation.meta.caseCount);
  for (const item of evaluation.cases) {
    const result = evaluateAgentRoute({ text: item.customerMessage });
    assert.equal(result.agentKey, item.expectedAgentKey, `${item.id}: ${item.customerMessage}`);
  }
});

test("keeps companion-gift payment, unsafe artwork and mooncake mixing risks on manual review", () => {
  const expectedRiskById = {
    "gift-eval-013": "外部图片或仿制风险",
    "gift-eval-015": "错误设计稿生产风险",
    "gift-eval-016": "虚构品牌素材风险",
    "gift-eval-017": "双重支付或退款流程",
    "gift-eval-020": "月饼混装合规风险",
  };

  for (const [id, risk] of Object.entries(expectedRiskById)) {
    const item = evaluation.cases.find((candidate) => candidate.id === id);
    assert.ok(item, `missing evaluation case: ${id}`);
    const result = evaluateAgentRoute({ text: item.customerMessage });
    assert.equal(result.action, "manual_review", id);
    assert.equal(result.manualRequired, true, id);
    assert.ok(result.riskFlags.includes(risk), `${id}: ${risk}`);
  }
});

test("parses every companion-gift knowledge row without skips", () => {
  const raw = fs.readFileSync(knowledgePath, "utf8");
  const source = JSON.parse(raw);
  const parsed = parseKnowledgeImportText(raw);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.importedCount, source.rows.length);
  assert.equal(parsed.skippedCount, 0);
  assert.equal(parsed.errors.length, 0);
});

test("treats a low unit price and large quantity as a high-total-value order", () => {
  const budget = parseBudget("酒店开业礼，2千份，每份8元，要印logo");
  assert.deepEqual(budget, {
    mode: "per_box",
    totalAmount: 16000,
    quantity: 2000,
    perUnitAmount: 8,
    confidence: "high",
  });

  const result = evaluateAgentRoute({ text: "酒店开业礼，2千份，每份8元，要印logo" });
  assert.equal(result.agentKey, "pre_sales");
  assert.equal(result.isHighValue, true);
  assert.equal(result.routingPolicy.lane, "high_value_guided_reply");
  assert.ok(result.routingPolicy.safeguards.includes("final_quote_manual_review"));
});

test("parses ten-thousand-scale quantities without mistaking them for a low-value inquiry", () => {
  const budget = parseBudget("宣传伴手礼1万份，单价2元");
  assert.equal(budget.quantity, 10000);
  assert.equal(budget.perUnitAmount, 2);
  assert.equal(budget.totalAmount, 20000);
});

test("asks for missing quantity or budget before advancing a vague bulk inquiry", () => {
  const missingQuantity = evaluateAgentRoute({ text: "酒店伴手礼要大批量做，每份8元左右" });
  assert.equal(missingQuantity.agentKey, "pre_sales");
  assert.ok(missingQuantity.missingFields.includes("quantity"));
  assert.equal(missingQuantity.action, "collect_info");

  const missingBudget = evaluateAgentRoute({ text: "酒店伴手礼要2000份，预算和单价还没定" });
  assert.equal(missingBudget.agentKey, "pre_sales");
  assert.ok(missingBudget.missingFields.includes("budget"));
  assert.equal(missingBudget.action, "collect_info");
});

test("routes the dedicated high-volume evaluation set and parses its knowledge rows", () => {
  const highVolumeEvaluation = JSON.parse(fs.readFileSync(highVolumeEvaluationPath, "utf8"));
  assert.equal(highVolumeEvaluation.cases.length, highVolumeEvaluation.meta.caseCount);
  for (const item of highVolumeEvaluation.cases) {
    const result = evaluateAgentRoute({ text: item.customerMessage });
    assert.equal(result.agentKey, item.expectedAgentKey, `${item.id}: ${item.customerMessage}`);
    if (typeof item.expectedHighValue === "boolean") {
      assert.equal(result.isHighValue, item.expectedHighValue, item.id);
    }
  }

  const raw = fs.readFileSync(highVolumeKnowledgePath, "utf8");
  const source = JSON.parse(raw);
  const parsed = parseKnowledgeImportText(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.importedCount, source.rows.length);
  assert.equal(parsed.skippedCount, 0);
  assert.equal(parsed.errors.length, 0);
});
