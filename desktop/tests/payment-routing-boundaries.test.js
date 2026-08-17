"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("quote detail exposes a dedicated payment verification route", () => {
  const detail = read("apps/web/src/features/sales/sales-quote-detail-page.tsx");
  const route = read("apps/web/src/app/sales/quotes/[id]/verify-payment/page.tsx");
  const manifest = read("apps/web/src/app/route-manifest.ts");

  assert.match(detail, /\/verify-payment/);
  assert.match(detail, /data-action-id="sales-quote-open-verify-payment"/);
  assert.match(route, /routeId="salesQuoteVerifyPayment"/);
  assert.match(route, /<SalesQuotePaymentPage key=\{id\} quoteId=\{id\}/);
  assert.match(manifest, /salesQuoteVerifyPayment/);
  assert.match(manifest, /verify-payment/);
});

test("payment verification uses the dedicated quote API and operation key", () => {
  const payment = read("apps/web/src/features/sales/sales-quote-payment-page.tsx");
  const api = read("apps/web/src/lib/api.ts");
  const orderEdit = read("apps/web/src/features/sales/sales-order-edit-page.tsx");

  assert.match(payment, /verifyQuotePaymentProofAndQueueConfirmation/);
  assert.match(payment, /reserveClientOperation\(\s*"payment-proof"/);
  assert.match(payment, /paymentStatus/);
  assert.match(payment, /amountCny/);
  assert.match(payment, /method/);
  assert.match(payment, /proofReference/);
  assert.match(payment, /paymentDetailsReady/);
  assert.match(payment, /Number\.isFinite\(paymentAmount\) && paymentAmount > 0/);
  assert.match(payment, /disabled=\{busy \|\| Boolean\(loadError\) \|\| !identityReady \|\| !paymentDetailsReady\}/);
  assert.match(payment, /paymentEvent\.id/);
  assert.match(payment, /confirmedOrder, setConfirmedOrder/);
  assert.match(payment, /setConfirmedOrder\(result\.orderDraft\)/);
  assert.match(payment, /data-action-id="sales-quote-payment-open-order"/);
  assert.match(payment, /\/sales\/orders\/\$\{encodeURIComponent\(confirmedOrder\.id\)\}/);
  assert.match(payment, /setNote/);
  assert.match(api, /\/quotes\/\$\{id\}\/verify-payment-proof/);
  assert.match(api, /paymentDetails/);
  assert.match(api, /paymentEvent:\s*PaymentEvent/);
  assert.doesNotMatch(orderEdit, /paymentStatus:\s*form|update\("paymentStatus"|name="paymentStatus"/);
});

test("quote action page opens the concrete send task or created order after success", () => {
  const action = read("apps/web/src/features/sales/sales-quote-action-page.tsx");

  assert.match(action, /queuedSendTask, setQueuedSendTask/);
  assert.match(action, /createdOrder, setCreatedOrder/);
  assert.match(action, /setQueuedSendTask\(result\.sendTask\)/);
  assert.match(action, /setCreatedOrder\(order\)/);
  assert.match(action, /data-action-id="sales-quote-open-send-task"/);
  assert.match(action, /\/send\/queue\/\$\{encodeURIComponent\(queuedSendTask\.id\)\}/);
  assert.match(action, /data-action-id="sales-quote-open-created-order"/);
  assert.match(action, /\/sales\/orders\/\$\{encodeURIComponent\(createdOrder\.id\)\}/);
});

test("payment proof verification records an internal payment event ledger", () => {
  const schema = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20260726143000_payment_event_ledger/migration.sql");
  const localStore = read("apps/api/src/local-store/local-store.service.ts");
  const service = read("apps/api/src/quotes/quotes.service.ts");
  const controller = read("apps/api/src/quotes/quotes.controller.ts");

  assert.match(schema, /model PaymentEvent/);
  assert.match(schema, /idempotencyKey\s+String\s+@unique/);
  assert.match(schema, /amountCny\s+Decimal\?/);
  assert.match(migration, /CREATE TABLE "PaymentEvent"/);
  assert.match(migration, /CREATE UNIQUE INDEX "PaymentEvent_idempotencyKey_key"/);
  assert.match(localStore, /paymentEvents:\s*any\[\]/);
  assert.match(localStore, /recordPaymentEvent\(payload: any\)/);
  assert.match(localStore, /const existing = data\.paymentEvents\.find/);
  assert.match(localStore, /paymentEvents: data\.paymentEvents/);
  assert.match(read("apps/api/src/orders/orders.service.ts"), /paymentEvents:\s*\{[\s\S]*orderBy:\s*\{ createdAt: "desc" \}[\s\S]*take:\s*20/);
  assert.match(service, /recordPaymentEvent\(updatedQuote, null/);
  assert.match(service, /normalizeRequiredPaymentProof\(payload\)/);
  assert.match(service, /amountCny === null \|\| amountCny <= 0/);
  assert.match(service, /付款核验必须填写凭证引用/);
  assert.match(service, /paymentEventId: paymentEvent\.id/);
  assert.match(service, /idempotencyKey = `\$\{payload\.operationKey\}:payment-event`/);
  assert.match(controller, /amountCny\?: number \| string/);
  assert.match(controller, /proofReference\?: string/);
});
