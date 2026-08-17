"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("sales order pages expose production and delivery facts", () => {
  const detail = read("apps/web/src/features/sales/sales-order-detail-page.tsx");
  const audit = [
    read("apps/web/src/features/sales/sales-order-delivery-audit.tsx"),
    read("apps/web/src/features/sales/sales-order-delivery-next-action.ts"),
  ].join("\n");
  const editPage = read("apps/web/src/features/sales/sales-order-edit-page.tsx");
  const workflow = read("apps/web/src/features/sales/sales-order-fulfillment-workflow.tsx");
  const edit = `${editPage}\n${workflow}`;
  const message = read("apps/web/src/features/sales/sales-order-message-page.tsx");
  const api = read("apps/web/src/lib/api.ts");

  for (const field of ["productionStatus", "productionDueAt", "carrier", "trackingNo", "shippedAt", "deliveredAt"]) {
    assert.match(detail, new RegExp(`selected\\.${field}`), `order detail must display ${field}`);
    assert.match(edit, new RegExp(field), `order edit must maintain ${field}`);
    assert.match(api, new RegExp(`${field}\\?: string`), `api order fulfillment patch must allow ${field}`);
  }

  assert.match(detail, /<SalesOrderDeliveryAudit order=\{selected\} identityReady=\{identityReady\}/);
  assert.match(audit, /buildDeliveryAudit\(order, identityReady\)/);
  assert.match(audit, /sales-order-delivery-audit-title/);
  assert.match(audit, /付款台账/);
  assert.match(audit, /客户消息状态/);
  assert.match(audit, /order\.paymentEvents/);
  assert.match(audit, /buildOrderSendState\(order\)/);
  assert.match(audit, /key: "confirmation-message"/);
  assert.match(audit, /key: "production-message"/);
  assert.match(audit, /key: "delivery-message"/);
  assert.match(audit, /confirmation: taskHasQueueRecord\(order\.confirmationSendTask\)/);
  assert.match(audit, /production: taskHasQueueRecord\(order\.productionFollowupSendTask\)/);
  assert.match(audit, /delivery: taskHasQueueRecord\(order\.deliveryFollowupSendTask\)/);
  assert.match(audit, /confirmationSendTask/);
  assert.match(audit, /productionFollowupSendTask/);
  assert.match(audit, /deliveryFollowupSendTask/);

  assert.match(edit, /ORDER_FORM_FIELDS\.some/);
  assert.match(edit, /Partial<OrderForm>/);
  assert.match(edit, /SalesOrderFulfillmentWorkflow/);
  assert.match(edit, /data-action-id="sales-order-fulfillment-start-production"/);
  assert.match(edit, /data-action-id="sales-order-fulfillment-quality-check"/);
  assert.match(edit, /data-action-id="sales-order-fulfillment-ready-to-ship"/);
  assert.match(edit, /data-action-id="sales-order-fulfillment-ship"/);
  assert.match(edit, /data-action-id="sales-order-fulfillment-deliver"/);
  assert.match(edit, /data-action-id="sales-order-edit-carrier"/);
  assert.match(edit, /data-action-id="sales-order-edit-tracking-no"/);
  assert.match(edit, /data-action-id="sales-order-edit-shipped-at"/);
  assert.match(edit, /data-action-id="sales-order-edit-delivered-at"/);
  assert.match(edit, /canStartProduction/);
  assert.match(edit, /evaluateLogisticsInput/);
  assert.match(edit, /sumVerifiedPaymentEvents\(order\.paymentEvents \|\| \[\]\)/);
  assert.match(edit, /verifiedPaymentAmount > 0/);
  assert.match(edit, /verifiedPaymentAmount \+ 0\.0001 >= orderTotal/);
  assert.match(edit, /shipmentFactsReady/);
  assert.match(edit, /canCompleteDelivery/);
  assert.match(edit, /nowLocalText/);
  assert.match(edit, /updateOrderFulfillment/);
  assert.match(editPage, /evaluateOrderFulfillmentTransition/);
  assert.match(editPage, /fulfillmentSaveBlockerText/);
  assert.match(editPage, /disabled=\{busy \|\| !canSave\}/);
  assert.match(edit, /reserveClientOperation\("order-fulfillment"/);
  assert.match(edit, /operationKey:\s*operation\.key/);
  assert.match(api, /\/orders\/\$\{id\}\/fulfillment/);
  assert.match(api, /operationKey:\s*string/);
  assert.match(message, /queueOrderFollowup/);
  assert.match(message, /getOrderConfirmationPreview/);
  assert.match(message, /getOrderFollowupPreview/);
  assert.match(message, /SalesMessagePreview/);
  assert.match(message, /canRequestMessage/);
  assert.match(api, /export type OrderFollowupPreview/);
  assert.match(api, /followup-preview/);
});

test("invalid logistics screenshot blocks both delivery and fulfillment save", () => {
  const screenshotEval = read("tools/sales-order-logistics-invalid-screenshot-eval.js");

  assert.match(screenshotEval, /sales-order-fulfillment-deliver/);
  assert.match(screenshotEval, /sales-order-edit-save-request/);
  assert.match(screenshotEval, /delivery completion action must stay disabled/);
  assert.match(screenshotEval, /order fulfillment save must stay disabled/);
});

test("order detail uses payment ledger and send state for delivery audit", () => {
  const audit = [
    read("apps/web/src/features/sales/sales-order-delivery-audit.tsx"),
    read("apps/web/src/features/sales/sales-order-delivery-next-action.ts"),
  ].join("\n");
  const css = read("apps/web/src/features/sales/sales-pages.module.css");
  const service = read("apps/api/src/orders/orders.service.ts");

  assert.match(audit, /const paymentEvents = Array\.isArray\(order\.paymentEvents\)/);
  assert.match(audit, /sumVerifiedPaymentEvents\(paymentEvents\)/);
  assert.match(audit, /verifiedPaymentAmount \+ 0\.0001 >= orderTotal/);
  assert.match(audit, /isPickupCarrier\(carrier\)/);
  assert.match(audit, /自提无需物流单号/);
  assert.match(audit, /collectOrderSendTasks\(order\)/);
  assert.match(audit, /queuedMessageCount/);
  assert.match(audit, /deliveredMessageCount/);
  assert.match(audit, /taskHasQueueRecord/);
  assert.match(audit, /taskHasCustomerDeliveryEvidence/);
  assert.match(audit, /manualDeliveryResolution\?\.resolution === "confirmed_sent"/);
  assert.match(audit, /渠道已接受，但还没有客户可见或人工确认送达证据/);
  assert.match(audit, /缺项时不能当作已完成交付/);
  assert.match(service, /paymentEvents:\s*\{[\s\S]*orderBy:\s*\{ createdAt: "desc" \}[\s\S]*take:\s*20/);
  assert.match(css, /\.auditSection/);
  assert.match(css, /\.auditRowOk/);
  assert.match(css, /\.auditRowBlocked/);
  for (const selector of [
    ".fulfillmentWorkflow",
    ".fulfillmentActionGrid",
    ".fulfillmentActionButton",
    ".fulfillmentCheckList",
    ".fulfillmentCheckReady",
    ".fulfillmentCheckBlocked",
  ]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
});

test("sales order follow-up messages are backed by stored fulfillment fields", () => {
  const dispatch = read("apps/api/src/wechat/wechat-dispatch.service.ts");
  const ordersController = read("apps/api/src/orders/orders.controller.ts");
  const ordersService = read("apps/api/src/orders/orders.service.ts");
  const rules = read("packages/rules/orderFollowupMessage.js");

  for (const field of ["productionStatus", "productionDueAt", "carrier", "trackingNo", "shippedAt", "deliveredAt"]) {
    assert.match(dispatch, new RegExp(`${field}: order\\.${field}`), `dispatch must pass order.${field}`);
    assert.match(ordersService, new RegExp(`${field}: order\\.${field}`), `preview must pass order.${field}`);
    assert.match(rules, new RegExp(field), `follow-up rule must read ${field}`);
  }

  assert.match(rules, /buildProductionFactText/);
  assert.match(rules, /buildDeliveryFactText/);
  assert.match(ordersController, /@Get\(":id\/followup-preview"\)/);
  assert.match(ordersService, /async followupPreview\(id: string, type: "production" \| "delivery" = "production"/);
  assert.match(ordersService, /buildOrderFollowupCustomerMessage/);
  assert.match(ordersService, /const bundleSnapshot = order\.bundleSnapshot \|\| \{\}/);
  assert.match(ordersService, /Array\.isArray\(\(bundleSnapshot as any\)\.items\)[\s\S]*\(bundleSnapshot as any\)\.items[\s\S]*designJob\.bundle\.items/);
  assert.match(ordersService, /return order\?\.selectedImageSnapshot \|\| order\?\.selectedImage \|\| order\?\.quoteDraft\?\.selectedImage \|\| null/);
  assert.match(ordersService, /selectedImageSnapshot: normalizeDesignImageSnapshot\(selectedImage\)/);
});

test("order controller keeps generic updates separate from fulfillment updates", () => {
  const controller = read("apps/api/src/orders/orders.controller.ts");
  const genericUpdate = controller.slice(controller.indexOf('@Post(":id/update")'), controller.indexOf('@Post(":id/fulfillment")'));
  const fulfillmentUpdate = controller.slice(controller.indexOf('@Post(":id/fulfillment")'), controller.indexOf('@Post(":id/revise-selection")'));

  assert.doesNotMatch(genericUpdate, /productionStatus|productionDueAt|carrier|trackingNo|shippedAt|deliveredAt/);
  assert.match(genericUpdate, /owner:\s*principal\.id/);
  assert.match(fulfillmentUpdate, /@Post\(":id\/fulfillment"\)/);
  assert.match(fulfillmentUpdate, /this\.orders\.updateFulfillment/);
  assert.match(fulfillmentUpdate, /operationKey: payload\?\.operationKey/);
  for (const field of ["productionStatus", "productionDueAt", "carrier", "trackingNo", "shippedAt", "deliveredAt"]) {
    assert.match(fulfillmentUpdate, new RegExp(`${field}: payload\\?\\.${field}`));
  }
  assert.match(fulfillmentUpdate, /owner:\s*principal\.id/);
});

test("sales order edit route metadata describes fulfillment facts", () => {
  const manifest = read("apps/web/src/app/route-manifest.ts");
  const start = manifest.indexOf("salesOrderEdit:");
  const end = manifest.indexOf("salesOrderConfirmation:", start);
  const block = manifest.slice(start, end);

  assert.match(block, /履约状态/);
  assert.match(block, /物流事实/);
  assert.match(block, /签收事实/);
  assert.doesNotMatch(block, /付款状态/);
});

test("UI acceptance matrix keeps order payment read-only on the fulfillment edit route", () => {
  const matrix = read("docs/UI_ACCEPTANCE_MATRIX.md");
  const line = matrix.split(/\r?\n/).find((item) => item.includes("/sales/orders/[id]/edit")) || "";

  assert.match(line, /生产状态/);
  assert.match(line, /物流单号/);
  assert.match(line, /发货时间/);
  assert.match(line, /签收时间/);
  assert.match(line, /付款状态只读/);
  assert.match(line, /修改付款/);
  assert.doesNotMatch(line, /状态、付款、履约状态机/);
});
