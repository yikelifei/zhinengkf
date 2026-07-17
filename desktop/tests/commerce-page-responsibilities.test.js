"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

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
  assert.doesNotMatch(designDetail, /preflightDesignJob|submitDesignJob|pollDesignJob/);
  assert.match(designDetail, /\/submit/);
  assert.match(designDetail, /\/status/);
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
  assert.match(editor, /upsertSku/);
  assert.doesNotMatch(editor, /batchUpdateSkus|getSkuCatalogAudit/);
  assert.match(repair, /batchUpdateSkus/);
  assert.doesNotMatch(repair, /upsertSku/);
  assert.match(submit, /preflightDesignJob/);
  assert.match(submit, /submitDesignJob/);
  assert.doesNotMatch(submit, /pollDesignJob/);
  assert.match(status, /pollDesignJob/);
  assert.doesNotMatch(status, /preflightDesignJob|submitDesignJob/);
});

test("catalog import and audit remain separate workflows", () => {
  const importPage = read("apps/web/src/features/catalog/catalog-import-page.tsx");
  const auditPage = read("apps/web/src/features/catalog/catalog-audit-page.tsx");
  assert.match(importPage, /previewSkuImportText/);
  assert.match(importPage, /bulkUpsertSkus/);
  assert.doesNotMatch(importPage, /batchUpdateSkus|recommendBundle/);
  assert.match(auditPage, /getSkuCatalogAudit/);
  assert.doesNotMatch(auditPage, /bulkUpsertSkus|batchUpdateSkus|upsertSku/);
});
