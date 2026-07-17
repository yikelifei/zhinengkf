"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("sales list pages navigate to entity URLs without keeping a hidden selected record", () => {
  const quotes = read("apps/web/src/features/sales/sales-quotes-page.tsx");
  const orders = read("apps/web/src/features/sales/sales-orders-page.tsx");
  assert.match(quotes, /href=\{`\/sales\/quotes\/\$\{encodeURIComponent\(quote\.id\)\}`\}/);
  assert.match(orders, /href=\{`\/sales\/orders\/\$\{encodeURIComponent\(order\.id\)\}`\}/);
  assert.doesNotMatch(`${quotes}\n${orders}`, /initial(?:Quote|Order)Id|selected(?:Quote|Order)Id|resolveSalesSelection/);
});

test("sales detail routes bind exactly the entity id from the URL", () => {
  const quoteRoute = read("apps/web/src/app/sales/quotes/[id]/page.tsx");
  const orderRoute = read("apps/web/src/app/sales/orders/[id]/page.tsx");
  assert.match(quoteRoute, /SalesQuoteDetailPage key=\{id\} quoteId=\{id\}/);
  assert.match(orderRoute, /SalesOrderDetailPage key=\{id\} orderId=\{id\}/);
});

test("the implicit list-selection helper is removed", () => {
  assert.equal(fs.existsSync(path.join(root, "apps/web/src/features/sales/sales-selection.ts")), false);
});
