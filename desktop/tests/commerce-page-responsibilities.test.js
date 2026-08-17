"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
});

const {
  CatalogBundlesPage,
  bundleIntentFingerprint,
} = require("../apps/web/src/features/catalog/catalog-bundles-page");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function renderBundlesWithState(stateValues) {
  const originals = {
    useCallback: React.useCallback,
    useEffect: React.useEffect,
    useMemo: React.useMemo,
    useRef: React.useRef,
    useState: React.useState,
  };
  let stateIndex = 0;
  const catalogDefaults = [[], false, "", true];
  const values = [...stateValues, ...catalogDefaults];
  React.useCallback = (callback) => callback;
  React.useMemo = (factory) => factory();
  React.useState = (initialValue) => [stateIndex < values.length ? values[stateIndex++] : initialValue, () => {}];
  React.useRef = (initialValue) => ({ current: initialValue });
  React.useEffect = () => {};
  try {
    return renderToStaticMarkup(CatalogBundlesPage());
  } finally {
    Object.assign(React, originals);
  }
}

test("commerce list routes do not mount detail or write controllers", () => {
  const contracts = [
    ["apps/web/src/features/sales/sales-quotes-page.tsx", /queueQuoteSend|createOrderDraftFromQuote|SalesQuoteDetailPage/],
    ["apps/web/src/features/sales/sales-orders-page.tsx", /updateOrderDraft|queueOrderConfirmation|queueOrderFollowup|SalesOrderDetailPage/],
    ["apps/web/src/features/design/design-jobs-page.tsx", /preflightDesignJob|submitDesignJob|pollDesignJob|designImagePreviewSrc/],
    ["apps/web/src/features/catalog/catalog-products-page.tsx", /upsertSku|CatalogProductEditorPage/],
    ["apps/web/src/features/catalog/catalog-repair-page.tsx", /batchUpdateSkus|CatalogRepairDetailPage/],
  ];
  for (const [file, forbidden] of contracts) assert.doesNotMatch(read(file), forbidden, `${file} regained another page's responsibility`);
});

test("entity detail routes are read-only and link to explicit action pages", () => {
  const quoteDetail = read("apps/web/src/features/sales/sales-quote-detail-page.tsx");
  const orderDetail = read("apps/web/src/features/sales/sales-order-detail-page.tsx");
  const designDetail = read("apps/web/src/features/design/design-job-detail-page.tsx");
  const productDetail = read("apps/web/src/features/catalog/catalog-product-detail-page.tsx");

  assert.doesNotMatch(quoteDetail, /queueQuoteSend|createOrderDraftFromQuote/);
  assert.match(quoteDetail, /\/send/);
  assert.match(quoteDetail, /\/create-order/);
  assert.doesNotMatch(orderDetail, /updateOrderDraft|queueOrderConfirmation|queueOrderFollowup/);
  for (const target of ["/edit", "/messages/confirmation", "/messages/production", "/messages/delivery"]) assert.ok(orderDetail.includes(target));
  assert.doesNotMatch(designDetail, /preflightDesignJob|submitDesignJob|pollDesignJob|createQuote/);
  assert.match(designDetail, /\/submit/);
  assert.match(designDetail, /\/status/);
  assert.match(designDetail, /\/quote/);
  assert.doesNotMatch(productDetail, /upsertSku/);
  assert.match(productDetail, /\/catalog\/editor\?sku=/);
});

test("each write URL selects exactly one explicit commerce action", () => {
  assert.match(read("apps/web/src/app/sales/quotes/[id]/send/page.tsx"), /action="send"/);
  assert.match(read("apps/web/src/app/sales/quotes/[id]/create-order/page.tsx"), /action="create-order"/);
  assert.match(read("apps/web/src/app/sales/orders/[id]/messages/confirmation/page.tsx"), /kind="confirmation"/);
  assert.match(read("apps/web/src/app/sales/orders/[id]/messages/production/page.tsx"), /kind="production"/);
  assert.match(read("apps/web/src/app/sales/orders/[id]/messages/delivery/page.tsx"), /kind="delivery"/);

  const editor = read("apps/web/src/features/catalog/catalog-product-editor-page.tsx");
  const repair = read("apps/web/src/features/catalog/catalog-repair-detail-page.tsx");
  const submit = read("apps/web/src/features/design/design-job-submit-page.tsx");
  const status = read("apps/web/src/features/design/design-job-status-page.tsx");
  const quote = read("apps/web/src/features/design/design-job-quote-page.tsx");
  assert.match(editor, /upsertSku/);
  assert.doesNotMatch(editor, /batchUpdateSkus|getSkuCatalogAudit/);
  assert.match(repair, /batchUpdateSkus/);
  assert.doesNotMatch(repair, /upsertSku/);
  assert.match(submit, /preflightDesignJob/);
  assert.match(submit, /submitDesignJob/);
  assert.doesNotMatch(submit, /pollDesignJob/);
  assert.match(status, /pollDesignJob/);
  assert.doesNotMatch(status, /preflightDesignJob|submitDesignJob/);
  assert.match(quote, /createQuote/);
  assert.match(quote, /reserveClientOperation\(\s*"quote-create"/);
  assert.doesNotMatch(quote, /preflightDesignJob|submitDesignJob|pollDesignJob|queueQuoteSend/);
});

test("catalog import and audit remain separate workflows", () => {
  const importPage = read("apps/web/src/features/catalog/catalog-import-page.tsx");
  const auditPage = read("apps/web/src/features/catalog/catalog-audit-page.tsx");
  const catalogReads = read("apps/web/src/features/catalog/use-catalog-records.ts");
  assert.match(importPage, /previewSkuImportText/);
  assert.match(importPage, /bulkUpsertSkus/);
  assert.doesNotMatch(importPage, /batchUpdateSkus|recommendBundle/);
  assert.match(auditPage, /useCatalogRepairQueue/);
  assert.match(catalogReads, /getSkuCatalogAudit/);
  assert.doesNotMatch(auditPage, /bulkUpsertSkus|batchUpdateSkus|upsertSku/);
  assert.doesNotMatch(catalogReads, /bulkUpsertSkus|batchUpdateSkus|upsertSku/);
});

test("catalog write forms bind mutable inputs to the active request", () => {
  const importPage = read("apps/web/src/features/catalog/catalog-import-page.tsx");
  assert.match(importPage, /previewSequence = useRef\(0\)/);
  assert.match(importPage, /sequence !== previewSequence\.current/);
  assert.ok((importPage.match(/disabled=\{Boolean\(busy\)\}/g) || []).length >= 5);

  const editor = read("apps/web/src/features/catalog/catalog-product-editor-page.tsx");
  assert.match(editor, /saveSequence = useRef\(0\)/);
  assert.match(editor, /editorIdentityRef\.current !== requestIdentity/);
  assert.ok((editor.match(/disabled=\{busy\}/g) || []).length >= 13);
  assert.match(editor, /imageReady/);
  assert.match(editor, /mainImagePath: requestDraft\.mainImagePath\?\.trim\(\)/);
  assert.match(editor, /angleImages: \(requestDraft\.angleImages \|\| \[\]\)\.map/);
  assert.match(editor, /parseImageList/);

  const repair = read("apps/web/src/features/catalog/catalog-repair-detail-page.tsx");
  assert.match(repair, /repairSequence = useRef\(0\)/);
  assert.ok((repair.match(/disabled=\{busy\}/g) || []).length >= 4);

  const bundles = read("apps/web/src/features/catalog/catalog-bundles-page.tsx");
  assert.ok((bundles.match(/disabled=\{busy\}/g) || []).length >= 6);
  assert.match(bundles, /bundleIntentFingerprint/);
  assert.match(bundles, /requestSequence = useRef\(0\)/);
  assert.match(bundles, /status: "error"/);
});

test("catalog bundle SSR hides stale intent results and distinguishes failed attempts from idle", () => {
  const draft = {
    scene: "客户拜访",
    quantity: "50",
    perUnitAmount: "200",
    totalAmount: "10000",
    maxItems: "6",
    selectedSkuCodes: [],
  };
  const intentKey = bundleIntentFingerprint(draft);
  const failure = renderBundlesWithState([
    draft.scene,
    draft.quantity,
    draft.perUnitAmount,
    draft.totalAmount,
    draft.maxItems,
    draft.selectedSkuCodes,
    { status: "error", intentKey, message: "组合推荐失败：timeout", attempted: true },
  ]);
  assert.match(failure, /组合推荐失败/);
  assert.match(failure, /本次请求未得到可用组合/);
  assert.doesNotMatch(failure, /尚未计算组合/);

  const staleResult = {
    status: "old-result",
    items: [],
    totals: { salePrice: 0, cost: 0, profit: 0, profitRate: 0 },
    warnings: [],
    automation: null,
  };
  const changed = renderBundlesWithState([
    "员工福利",
    draft.quantity,
    draft.perUnitAmount,
    draft.totalAmount,
    draft.maxItems,
    draft.selectedSkuCodes,
    { status: "success", intentKey, result: staleResult },
  ]);
  assert.match(changed, /尚未计算组合/);
  assert.doesNotMatch(changed, /old-result/);
});
