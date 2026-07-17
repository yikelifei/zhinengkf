"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("routing feature uses only the existing explicit-error route APIs", () => {
  const api = read("apps/web/src/features/routing/api.ts");
  const controller = read("apps/web/src/features/routing/use-routing-controller.ts");

  for (const apiName of [
    "getOperatorAccessStatus",
    "getWechatConversations",
    "evaluateRoute",
    "processInboundMessage",
  ]) {
    assert.match(api, new RegExp(`\\b${apiName}\\b`));
  }
  assert.doesNotMatch(`${api}\n${controller}`, /\bfetch\s*\(|\baxios\b|getRouteEvaluations|return\s+\[\]/);
  assert.match(controller, /status\.enforcementReady/);
  assert.match(controller, /reply_conversations/);
  assert.match(controller, /conversationId:\s*conversation\.id/);
  assert.match(controller, /wechatAccountId:\s*conversation\.wechatAccountId/);
  assert.match(controller, /customerId:\s*conversation\.customerId/);
});

test("routing page makes evaluation and real processing visibly different", () => {
  const page = read("apps/web/src/features/routing/routing-feature-page.tsx");
  const index = read("apps/web/src/features/routing/index.ts");

  assert.match(index, /RoutingFeaturePage/);
  assert.match(page, /仅评估/);
  assert.match(page, /不会写入客户消息或触发后续业务流程/);
  assert.match(page, /处理客户消息/);
  assert.match(page, /会写入客户消息，并可能创建任务、报价、订单或发送任务/);
  assert.match(page, /role="region"/);
  assert.match(page, /aria-live="polite"/);
  assert.doesNotMatch(page, /aria-modal="true"|role="alertdialog"/);
  assert.match(page, /data-action-id="routing-evaluate-only"/);
  assert.match(page, /data-action-id="routing-process-message"/);
  assert.match(page, /data-action-id="routing-process-confirm"/);
  assert.match(page, /aria-label="路由判断"/);
  assert.doesNotMatch(page, /(?:演示|demo|mock|示例客户)/i);
});

test("route presentation exposes scene, value, action and missing fields", () => {
  require("ts-node").register({
    transpileOnly: true,
    compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
  });
  const { presentRouteEvaluation } = require("../apps/web/src/features/routing/model");
  const presentation = presentRouteEvaluation({
    id: "route-1",
    channel: "wechat",
    text: "我要定 100 份",
    agentKey: "quote-agent",
    scene: "报价咨询",
    action: "collect_info",
    confidence: 0.82,
    isHighValue: true,
    budget: { quantity: 100, totalAmount: 5000 },
    missingFields: ["材质", "交付日期"],
    riskFlags: ["budget_confirmation_required"],
    suggestedReply: "请确认材质与交付日期。",
    createdAt: "2026-07-17T03:00:00.000Z",
  });

  assert.equal(presentation.scene, "报价咨询");
  assert.equal(presentation.valueTier, "高价值");
  assert.equal(presentation.action, "先补齐信息");
  assert.deepEqual(presentation.missingFields, ["材质", "交付日期"]);
});

test("routing CSS collapses actions and results for a 390px viewport", () => {
  const css = read("apps/web/src/features/routing/routing-feature-page.module.css");
  assert.match(css, /max-width:\s*100%/);
  assert.match(css, /var\(--wk-color-brand\)/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|overflow-x:\s*(?:auto|scroll)/i);
});
