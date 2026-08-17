"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("review decision pages read one record by id instead of searching capped review center lists", () => {
  const api = read("apps/web/src/lib/api.ts");
  const shared = read("apps/web/src/features/reviews/review-page-shared.tsx");
  const design = read("apps/web/src/features/reviews/review-design-page.tsx");
  const quotes = read("apps/web/src/features/reviews/review-quotes-page.tsx");
  const orders = read("apps/web/src/features/reviews/review-orders-page.tsx");

  assert.match(api, /export async function getReviewDesignJob\(id: string, filters: IdentityFilters = \{\}\): Promise<DesignJob>/);
  assert.match(api, /\/reviews\/design-jobs\/\$\{encodeURIComponent\(id\)\}\$\{identityQuery\(filters\)\}/);
  assert.match(api, /export async function getReviewQuote\(id: string, filters: IdentityFilters = \{\}\): Promise<QuoteDraft>/);
  assert.match(api, /\/reviews\/quotes\/\$\{encodeURIComponent\(id\)\}\$\{identityQuery\(filters\)\}/);
  assert.match(api, /export async function getReviewOrder\(id: string, filters: IdentityFilters = \{\}\): Promise<OrderDraft>/);
  assert.match(api, /\/reviews\/orders\/\$\{encodeURIComponent\(id\)\}\$\{identityQuery\(filters\)\}/);

  assert.match(shared, /export function useReviewRecord<T>/);
  assert.match(shared, /loadRecord\(reviewId, stableIdentityFilters\)/);
  assert.match(shared, /setRecord\(null\)/);

  assert.match(design, /useReviewRecord\(getReviewDesignJob, reviewId, identityFilters\)/);
  assert.match(quotes, /useReviewRecord\(getReviewQuote, reviewId, identityFilters\)/);
  assert.match(orders, /useReviewRecord\(getReviewOrder, reviewId, identityFilters\)/);
  for (const source of [design, quotes, orders]) {
    assert.doesNotMatch(source, /useReviewCenter\(/);
    assert.doesNotMatch(source, /center\?/);
    assert.doesNotMatch(source, /find\(\([a-z]+(?:Job|Quote|Order)?\) => [a-z]+(?:Job|Quote|Order)?\.id === reviewId\)/);
    assert.match(source, /不依赖审核队列截断列表/);
  }
});

test("reviews controller exposes identity-checked single record routes", () => {
  const controller = read("apps/api/src/reviews/reviews.controller.ts");
  const service = read("apps/api/src/reviews/reviews.service.ts");

  assert.match(controller, /@Get\("design-jobs\/:id"\)\s+getDesignJob/);
  assert.match(controller, /return this\.reviews\.getDesignJob\(id/);
  assert.match(controller, /@Get\("quotes\/:id"\)\s+getQuote/);
  assert.match(controller, /return this\.reviews\.getQuote\(id/);
  assert.match(controller, /@Get\("orders\/:id"\)\s+getOrder/);
  assert.match(controller, /return this\.reviews\.getOrder\(id/);

  assert.match(service, /async getDesignJob\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(service, /assertExpectedIdentity\(job, expected, "design job"\)/);
  assert.match(service, /async getQuote\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(service, /return this\.quotes\.getById\(id, expected\)/);
  assert.match(service, /async getOrder\(id: string, expected: ExpectedIdentityPayload = \{\}\)/);
  assert.match(service, /return this\.orders\.getById\(id, expected\)/);
});
