"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("sales detail hooks use single-record APIs when an id is present", () => {
  const hook = read("apps/web/src/features/sales/use-sales-records.ts");
  const api = read("apps/web/src/lib/api.ts");

  assert.match(api, /export async function getQuoteDraft\(id: string/);
  assert.match(api, /\/quotes\/\$\{id\}\$\{expectedIdentityQuery\(expected\)\}/);
  assert.match(api, /export async function getOrderDraft\(id: string/);
  assert.match(api, /\/orders\/\$\{id\}\$\{expectedIdentityQuery\(expected\)\}/);
  assert.match(hook, /quoteId \? \[await getQuoteDraft\(quoteId\)\] : await getQuotes\(filters\)/);
  assert.match(hook, /orderId \? \[await getOrderDraft\(orderId\)\] : await getOrderDrafts\(filters\)/);
});

test("quote and order controllers expose identity-checked single-record routes", () => {
  const quotesController = read("apps/api/src/quotes/quotes.controller.ts");
  const quotesService = read("apps/api/src/quotes/quotes.service.ts");
  const ordersController = read("apps/api/src/orders/orders.controller.ts");
  const ordersService = read("apps/api/src/orders/orders.service.ts");

  assert.match(quotesController, /@Get\(":id"\)\s+getById/);
  assert.match(quotesController, /return this\.quotes\.getById\(id/);
  assert.match(quotesService, /async getById\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(quotesService, /assertExpectedIdentity\(quote, expected, "quote draft"\)/);
  assert.match(ordersController, /@Get\(":id"\)\s+getById/);
  assert.match(ordersController, /return this\.orders\.getById\(id/);
  assert.match(ordersService, /async getById\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(ordersService, /assertExpectedIdentity\(order, expected, "order draft"\)/);
});
