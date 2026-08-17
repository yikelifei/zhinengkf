"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("sales order detail links to a dedicated after-sales workflow", () => {
  const detail = read("apps/web/src/features/sales/sales-order-detail-page.tsx");
  const route = read("apps/web/src/app/sales/orders/[id]/after-sales/page.tsx");
  const manifest = read("apps/web/src/app/route-manifest.ts");

  assert.match(detail, /data-action-id="sales-order-open-after-sales"/);
  assert.match(detail, /售后\/退款\/补发/);
  assert.match(route, /SalesOrderAfterSalesPage/);
  assert.match(route, /routeId="salesOrderAfterSales"/);
  assert.match(manifest, /salesOrderAfterSales/);
  assert.match(manifest, /创建并处理一条订单的售后 case/);
});

test("sales after-sales page exposes create and resolve controls", () => {
  const page = read("apps/web/src/features/sales/sales-order-after-sales-page.tsx");
  const panels = read("apps/web/src/features/sales/sales-order-after-sales-panels.tsx");
  const featureSource = `${page}\n${panels}`;
  const api = read("apps/web/src/lib/api.ts");

  for (const actionId of [
    "sales-after-sales-create-form",
    "sales-after-sales-create-type",
    "sales-after-sales-create-amount",
    "sales-after-sales-create-reason",
    "sales-after-sales-create-submit",
    "sales-after-sales-resolve-form",
    "sales-after-sales-resolve-case",
    "sales-after-sales-resolve-type",
    "sales-after-sales-resolve-amount",
    "sales-after-sales-resolve-carrier",
    "sales-after-sales-resolve-tracking",
    "sales-after-sales-resolve-submit",
    "sales-after-sales-case-list",
  ]) {
    assert.match(featureSource, new RegExp(actionId), `${actionId} should be present`);
  }

  assert.match(page, /reserveClientOperation\("order-after-sales-create"/);
  assert.match(page, /reserveClientOperation\("order-after-sales-resolve"/);
  assert.match(page, /createOrderAfterSalesCase/);
  assert.match(page, /resolveOrderAfterSalesCase/);
  assert.match(page, /getOrderAfterSalesCases/);

  assert.match(api, /export type AfterSalesCase/);
  assert.match(api, /getOrderAfterSalesCases/);
  assert.match(api, /createOrderAfterSalesCase/);
  assert.match(api, /resolveOrderAfterSalesCase/);
  assert.match(api, /\/orders\/\$\{encodeURIComponent\(id\)\}\/after-sales/);
});

test("after-sales refund uses the payment ledger instead of a text-only status", () => {
  const service = read("apps/api/src/orders/orders.service.ts");
  const localStore = read("apps/api/src/local-store/local-store.service.ts");
  const behavior = read("tests/order-after-sales.test.js");

  assert.match(service, /recordAfterSalesRefundEvent/);
  assert.match(service, /paymentStatus:\s*"refunded"/);
  assert.match(service, /manual_after_sales_refund/);
  assert.match(service, /AFTER_SALES_CREATE_DECISION/);
  assert.match(service, /AFTER_SALES_RESOLVE_DECISION/);
  assert.match(localStore, /\["deposit_paid", "paid", "refunded"\]/);
  assert.match(behavior, /refund creates a case, resolves it, and records one refund ledger event/);
});
