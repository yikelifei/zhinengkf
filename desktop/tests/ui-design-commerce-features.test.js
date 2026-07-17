"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function featureSource(domain) {
  const directory = path.join(root, `apps/web/src/features/${domain}`);
  return fs.readdirSync(directory)
    .filter((name) => /\.(?:ts|tsx)$/.test(name))
    .map((name) => read(`apps/web/src/features/${domain}/${name}`))
    .join("\n");
}

test("design exports one page per operator goal", () => {
  const index = read("apps/web/src/features/design/index.ts");
  for (const page of ["DesignSettingsPage", "DesignActivationPage", "DesignAccountPage", "DesignAssetsPage", "DesignJobsPage", "DesignJobDetailPage", "DesignJobSubmitPage", "DesignJobStatusPage"]) {
    assert.match(index, new RegExp(`\\b${page}\\b`));
  }

  const source = featureSource("design");
  for (const api of [
    "getDesignPlatformConfig",
    "getDesignPlatformHealth",
    "getDesignPlatformReadiness",
    "updateDesignPlatformConfig",
    "redeemDesignPlatformActivation",
    "loginDesignPlatform",
    "runDesignPlatformSmokeTest",
    "getAssets",
    "uploadAsset",
    "getDesignJobs",
    "preflightDesignJob",
    "submitDesignJob",
    "pollDesignJob",
  ]) {
    assert.match(source, new RegExp(`\\b${api}\\b`));
  }
  assert.doesNotMatch(source, /createDemo|createFailureDemo|createTimeoutDemo|return\s+\[\]/i);
});

test("catalog exports separate product, repair, import, audit, and bundle pages", () => {
  const index = read("apps/web/src/features/catalog/index.ts");
  for (const page of [
    "CatalogProductsPage",
    "CatalogRepairPage",
    "CatalogImportPage",
    "CatalogAuditPage",
    "CatalogBundlesPage",
    "CatalogProductDetailPage",
    "CatalogProductEditorPage",
    "CatalogRepairDetailPage",
  ]) {
    assert.match(index, new RegExp(`\\b${page}\\b`));
  }

  const source = featureSource("catalog");
  for (const api of [
    "getSkus",
    "getSkuCatalogAudit",
    "upsertSku",
    "batchUpdateSkus",
    "previewSkuImportFile",
    "previewSkuImportText",
    "bulkUpsertSkus",
    "recommendBundle",
  ]) {
    assert.match(source, new RegExp(`\\b${api}\\b`));
  }
  assert.doesNotMatch(source, /createDemoSkuImages|createDemoCustomerLogo|return\s+\[\]/i);
});

test("sales keeps quote and order controllers independent", () => {
  const index = read("apps/web/src/features/sales/index.ts");
  assert.match(index, /SalesQuotesPage/);
  assert.match(index, /SalesOrdersPage/);

  const quotes = [
    read("apps/web/src/features/sales/sales-quotes-page.tsx"),
    read("apps/web/src/features/sales/sales-quote-detail-page.tsx"),
    read("apps/web/src/features/sales/sales-quote-action-page.tsx"),
    read("apps/web/src/features/sales/use-sales-records.ts"),
  ].join("\n");
  const orders = [
    read("apps/web/src/features/sales/sales-orders-page.tsx"),
    read("apps/web/src/features/sales/sales-order-detail-page.tsx"),
    read("apps/web/src/features/sales/sales-order-edit-page.tsx"),
    read("apps/web/src/features/sales/sales-order-message-page.tsx"),
    read("apps/web/src/features/sales/use-sales-records.ts"),
  ].join("\n");
  assert.match(quotes, /getQuotes/);
  assert.match(quotes, /queueQuoteSend/);
  assert.match(quotes, /createOrderDraftFromQuote/);
  assert.match(orders, /getOrderDrafts/);
  assert.match(orders, /updateOrderDraft/);
  assert.match(orders, /queueOrderConfirmation/);
  assert.match(orders, /queueOrderFollowup/);
  assert.match(`${quotes}\n${orders}`, /identityExpectation/);
  assert.match(`${quotes}\n${orders}`, /SalesConfirmation/);
  assert.match(`${quotes}\n${orders}`, /confirming/);
  assert.doesNotMatch(`${quotes}\n${orders}`, /createDemo|mock|示例客户/i);
});

test("feature pages expose stable actions and remain bounded modules", () => {
  for (const domain of ["design", "catalog", "sales"]) {
    const directory = path.join(root, `apps/web/src/features/${domain}`);
    const pages = fs.readdirSync(directory).filter((name) => name.endsWith("-page.tsx"));
    assert.ok(pages.length > 0, `${domain} must expose page modules`);
    for (const name of pages) {
      const source = read(`apps/web/src/features/${domain}/${name}`);
      assert.ok(source.split(/\r?\n/).length < 250, `${domain}/${name} is becoming another giant page`);
      for (const button of source.matchAll(/<button\b[\s\S]*?>/g)) {
        assert.match(button[0], /data-action-id=/, `${domain}/${name} button needs a stable action id`);
      }
      assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\b|function\s+load\s*\(/);
    }
  }
});

test("design, catalog, and sales styles support 390px without horizontal scroll", () => {
  for (const cssPath of [
    "apps/web/src/features/design/design-pages.module.css",
    "apps/web/src/features/catalog/catalog-pages.module.css",
    "apps/web/src/features/sales/sales-pages.module.css",
  ]) {
    const css = read(cssPath);
    assert.match(css, /@media\s*\(max-width:\s*(?:520|640|760)px\)/);
    assert.match(css, /grid-template-columns:\s*1fr/);
    assert.match(css, /min-height:\s*44px/);
    assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)|linear-gradient|radial-gradient/i);
  }
});
