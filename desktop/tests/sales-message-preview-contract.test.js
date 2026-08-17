"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("sales send pages require a server message preview before queueing", () => {
  const quoteAction = read("apps/web/src/features/sales/sales-quote-action-page.tsx");
  const orderMessage = read("apps/web/src/features/sales/sales-order-message-page.tsx");
  const shared = read("apps/web/src/features/sales/sales-ui.tsx");
  const css = read("apps/web/src/features/sales/sales-pages.module.css");

  assert.match(shared, /export function SalesMessagePreview/);
  assert.match(css, /\.messagePreview/);
  assert.match(quoteAction, /getQuotePreview/);
  assert.match(quoteAction, /SalesMessagePreview/);
  assert.match(quoteAction, /canRequestAction/);
  assert.match(orderMessage, /getOrderConfirmationPreview/);
  assert.match(orderMessage, /getOrderFollowupPreview/);
  assert.match(orderMessage, /SalesMessagePreview/);
  assert.match(orderMessage, /canRequestMessage/);
});

test("order message pages keep operator-facing copy readable", () => {
  const orderMessage = read("apps/web/src/features/sales/sales-order-message-page.tsx");

  for (const text of ["发送订单确认", "发送生产跟进", "发送发货跟进", "消息类型", "客户身份", "物流公司", "确认入队"]) {
    assert.match(orderMessage, new RegExp(text));
  }
  assert.doesNotMatch(orderMessage, /鍙戦|娑堟|璁㈠|鐗╂|绛炬|韬|\uFFFD/);
});

test("order followup preview endpoint reuses stored fulfillment facts", () => {
  const controller = read("apps/api/src/orders/orders.controller.ts");
  const service = read("apps/api/src/orders/orders.service.ts");
  const api = read("apps/web/src/lib/api.ts");

  assert.match(controller, /@Get\(":id\/followup-preview"\)/);
  assert.match(api, /export type OrderFollowupPreview/);
  assert.match(api, /getOrderFollowupPreview/);
  for (const field of ["productionStatus", "productionDueAt", "carrier", "trackingNo", "shippedAt", "deliveredAt"]) {
    assert.match(service, new RegExp(`${field}: order\\.${field}`));
  }
});
