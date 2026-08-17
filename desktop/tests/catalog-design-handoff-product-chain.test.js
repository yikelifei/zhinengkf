"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
});

const {
  bundleRecommendationHandoffReadiness,
  catalogAuditPrimaryAction,
  identityMatchesConversation,
  validateCatalogBundleBudget,
} = require("../apps/web/src/features/catalog/catalog-journey-state");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function budget(overrides = {}) {
  return { scene: "员工福利", quantity: "50", perUnitAmount: "200", totalAmount: "10000", maxItems: "6", ...overrides };
}

function audit(overrides = {}) {
  return {
    total: 10,
    issues: [],
    repairQueueCount: 0,
    dataReadiness: { customerReplyReady: true },
    commercialReadiness: { canAutoBundle: true },
    ...overrides,
  };
}

test("bundle budget rejects contradictory totals and non-integer quantities", () => {
  assert.equal(validateCatalogBundleBudget(budget()).ok, true);
  const mismatch = validateCatalogBundleBudget(budget({ totalAmount: "9000" }));
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.message, /10000\.00/);
  assert.match(validateCatalogBundleBudget(budget({ quantity: "1.5", totalAmount: "300" })).message, /整数/);
});

test("design handoff requires a gift box, an inner item and readable images", () => {
  assert.equal(bundleRecommendationHandoffReadiness(null).ok, false);
  assert.match(bundleRecommendationHandoffReadiness({ items: [{ type: "item", skuCode: "TEA", mainImagePath: "/tea.png" }] }).reason, /礼盒/);
  assert.match(bundleRecommendationHandoffReadiness({ items: [{ type: "gift_box", skuCode: "BOX", mainImagePath: "/box.png" }] }).reason, /内搭/);
  assert.match(bundleRecommendationHandoffReadiness({ items: [
    { type: "gift_box", skuCode: "BOX", mainImagePath: "/box.png" },
    { type: "item", skuCode: "TEA" },
  ] }).reason, /缺少可读取图片/);
  assert.equal(bundleRecommendationHandoffReadiness({ items: [
    { type: "gift_box", skuCode: "BOX", mainImagePath: "/box.png" },
    { type: "item", skuCode: "TEA", imageUrl: "https://example.test/tea.png" },
  ] }).ok, true);
});

test("catalog audit exposes exactly one state-driven primary next step", () => {
  assert.equal(catalogAuditPrimaryAction(audit({ total: 0 })).key, "import");
  assert.equal(catalogAuditPrimaryAction(audit({ repairQueueCount: 2 })).key, "repair");
  assert.equal(catalogAuditPrimaryAction(audit({ dataReadiness: { customerReplyReady: false } })).key, "import");
  assert.equal(catalogAuditPrimaryAction(audit()).key, "bundle");
  assert.equal(catalogAuditPrimaryAction(audit({ commercialReadiness: { canAutoBundle: false } })).key, "products");
});

test("customer identity matching never substitutes another conversation", () => {
  const filters = { wechatAccountId: "wa-1", conversationId: "conv-1", customerId: "customer-1" };
  assert.equal(identityMatchesConversation({ wechatAccountId: "wa-1", id: "conv-1", customerId: "customer-1" }, filters), true);
  assert.equal(identityMatchesConversation({ wechatAccountId: "wa-1", id: "conv-2", customerId: "customer-2" }, filters), false);
});

test("import, audit, bundle and design pages implement the guarded handoff", () => {
  const api = read("apps/api/src/catalog/catalog.service.ts");
  const importPage = read("apps/web/src/features/catalog/catalog-import-page.tsx");
  const auditPage = read("apps/web/src/features/catalog/catalog-audit-page.tsx");
  const bundlePage = read("apps/web/src/features/catalog/catalog-bundles-page.tsx");
  const handoff = read("apps/web/src/features/catalog/catalog-bundle-design-handoff.tsx");
  const designCreate = read("apps/web/src/features/design/design-job-create-page.tsx");
  const catalogPicker = read("apps/web/src/features/design/design-job-create-catalog-picker.tsx");
  const catalogRecords = read("apps/web/src/features/catalog/use-catalog-records.ts");
  const repairDetail = read("apps/web/src/features/catalog/catalog-repair-detail-page.tsx");

  assert.match(api, /context\.source === "import_confirm" && payload\.isActive === undefined/);
  assert.match(api, /\{ \.\.\.payload, isActive: false \}/);
  assert.match(importPage, /data-action-id="catalog-import-open-audit"/);
  assert.match(auditPage, /catalogAuditPrimaryAction\(audit\)/);
  assert.match(auditPage, /商品链路唯一推荐下一步/);
  assert.match(bundlePage, /validateCatalogBundleBudget/);
  assert.match(handoff, /bundleRecommendationHandoffReadiness\(result\)/);
  assert.match(handoff, /allRecords\.filter\(\(conversation\) => identityMatchesConversation/);
  assert.match(designCreate, /identityScoped \? undefined : scopedRows\[0\]/);
  assert.match(designCreate, /customerAssetId: ""/);
  assert.match(catalogPicker, /recommendationIntentRef/);
  assert.match(catalogPicker, /上一次可信商品/);
  assert.match(catalogRecords, /当前显示上一次可信快照/);
  assert.match(catalogRecords, /当前显示上一次可信审计/);
  assert.match(repairDetail, /await refresh\(\)/);
  assert.match(repairDetail, /data-action-id="catalog-repair-detail-next"/);
});

test("390px layouts collapse chain controls and reconciliation actions have stable ids", () => {
  const catalogCss = read("apps/web/src/features/catalog/catalog-pages.module.css");
  const designCss = read("apps/web/src/features/design/design-pages.module.css");
  const reconciliation = read("apps/web/src/components/design-execution-reconciliation-panel.tsx");
  assert.match(catalogCss, /@media \(max-width: 640px\)[\s\S]*\.twoColumn[\s\S]*\.formGrid[\s\S]*\.formActions/);
  assert.match(designCss, /@media \(max-width: 760px\)[\s\S]*\.formGrid[\s\S]*\.assetPickerHeader/);
  for (const actionId of [
    "design-execution-reconciliation-refresh",
    "design-execution-reconciliation-cancel",
    "design-execution-reconciliation-confirm",
  ]) assert.match(reconciliation, new RegExp(actionId));
  assert.match(reconciliation, /design-execution-reconciliation-open-\$\{execution\.id\}/);
});
