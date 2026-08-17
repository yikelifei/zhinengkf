"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Zhenxi workspace has an honest initial load state and remains a bounded page", () => {
  const page = read("apps/web/src/features/design/design-zhenxi-workspace-page.tsx");
  const model = read("apps/web/src/features/design/design-zhenxi-embedded-model.ts");
  assert.ok(page.split(/\r?\n/).length < 250, "workspace page must remain below the feature-page limit");
  assert.match(page, /connectionLoaded, setConnectionLoaded/);
  assert.match(page, /!connectionLoaded \? \(/);
  assert.match(page, /正在读取臻希 AI 连接状态/);
  assert.match(page, /data-action-id="zhenxi-workspace-retry-connection"/);
  assert.match(model, /export function preferredHealthyLocalUrl/);
  assert.match(model, /export function embeddedBounds/);
  assert.doesNotMatch(page, /function preferredHealthyLocalUrl|function embeddedBounds/);
});

test("design identity query survives every transition and scopes the next read", () => {
  const handoff = read("apps/web/src/features/catalog/catalog-bundle-design-handoff.tsx");
  const state = read("apps/web/src/features/design/design-commerce-state.ts");
  const hook = read("apps/web/src/features/design/use-design-job.ts");
  const api = read("apps/web/src/features/design/api.ts");
  assert.match(handoff, /conversationIdentityHref\(`\/design\/jobs\/\$\{encodeURIComponent\(createdJobId\)\}`/);
  assert.match(state, /export function designIdentityHref/);
  assert.match(state, /wechatAccountId/);
  assert.match(state, /conversationId/);
  assert.match(state, /customerId/);
  assert.match(hook, /useDesignJobs\(jobId = "", filters: IdentityFilters = \{\}\)/);
  assert.match(hook, /getVerifiedDesignJobs\(filters\)/);
  assert.match(api, /getDesignJobs\(filters\)/);

  for (const route of [
    "apps/web/src/app/design/jobs/[id]/page.tsx",
    "apps/web/src/app/design/jobs/[id]/submit/page.tsx",
    "apps/web/src/app/design/jobs/[id]/status/page.tsx",
    "apps/web/src/app/design/jobs/[id]/quote/page.tsx",
  ]) {
    const source = read(route);
    assert.match(source, /identityFiltersFromSearchParams\(searchParams\)/, route);
    assert.match(source, /initialIdentityFilters=\{identityFilters\}/, route);
  }
});

test("sales identity query reaches quote and order reads instead of being decorative", () => {
  const state = read("apps/web/src/features/sales/sales-commerce-state.ts");
  const quoteDetail = read("apps/web/src/features/sales/sales-quote-detail-page.tsx");
  const quoteAction = read("apps/web/src/features/sales/sales-quote-action-page.tsx");
  const payment = read("apps/web/src/features/sales/sales-quote-payment-page.tsx");
  const orderDetail = read("apps/web/src/features/sales/sales-order-detail-page.tsx");
  assert.match(state, /export function quoteIdentityHref/);
  assert.match(state, /export function orderIdentityHref/);
  assert.match(quoteDetail, /useSalesQuotes\(quoteId, initialIdentityFilters\)/);
  assert.match(quoteAction, /useSalesQuotes\(quoteId, initialIdentityFilters\)/);
  assert.match(payment, /useSalesQuotes\(quoteId, initialIdentityFilters\)/);
  assert.match(orderDetail, /useSalesOrders\(orderId, initialIdentityFilters\)/);

  for (const route of [
    "apps/web/src/app/sales/quotes/[id]/page.tsx",
    "apps/web/src/app/sales/quotes/[id]/send/page.tsx",
    "apps/web/src/app/sales/quotes/[id]/create-order/page.tsx",
    "apps/web/src/app/sales/quotes/[id]/verify-payment/page.tsx",
    "apps/web/src/app/sales/orders/[id]/page.tsx",
  ]) {
    const source = read(route);
    assert.match(source, /identityFiltersFromSearchParams\(searchParams\)/, route);
    assert.match(source, /initialIdentityFilters=\{identityFilters\}/, route);
  }
});

test("refresh failures preserve the last successful design and sales records", () => {
  const designHook = read("apps/web/src/features/design/use-design-job.ts");
  const salesHook = read("apps/web/src/features/sales/use-sales-records.ts");
  assert.match(designHook, /hasSuccessfulRead/);
  assert.match(designHook, /刷新失败，仍显示上次成功结果/);
  assert.match(salesHook, /hasSuccessfulRead/g);
  assert.match(salesHook, /报价刷新失败，仍显示上次成功结果/);
  assert.match(salesHook, /订单刷新失败，仍显示上次成功结果/);
  for (const page of [
    "apps/web/src/features/design/design-job-detail-page.tsx",
    "apps/web/src/features/design/design-job-quote-page.tsx",
    "apps/web/src/features/sales/sales-quote-detail-page.tsx",
    "apps/web/src/features/sales/sales-quote-action-page.tsx",
    "apps/web/src/features/sales/sales-order-detail-page.tsx",
  ]) assert.match(read(page), /loading && !loaded/, page);
  assert.match(read("apps/web/src/features/design/design-job-quote-page.tsx"), /selected && !loadError && identityReady/);
  assert.match(read("apps/web/src/features/design/design-job-submit-page.tsx"), /Boolean\(loadError\)/);
  assert.match(read("apps/web/src/features/design/design-job-status-page.tsx"), /Boolean\(loadError\)/);
  assert.match(read("apps/web/src/features/sales/sales-quote-action-page.tsx"), /const canRequestAction = !loadError/);
  assert.match(read("apps/web/src/features/sales/sales-quote-payment-page.tsx"), /Boolean\(loadError\)/);
});

test("new journey and review gallery collapse to one column at phone width", () => {
  const journeyCss = read("apps/web/src/features/design/design-commerce-journey.module.css");
  const galleryCss = read("apps/web/src/features/reviews/review-design-gallery.module.css");
  assert.match(journeyCss, /@media \(max-width: 720px\)[\s\S]*?grid-template-columns: 1fr/);
  assert.match(galleryCss, /@media \(max-width: 520px\)[\s\S]*?grid-template-columns: 1fr/);
  assert.doesNotMatch(`${journeyCss}\n${galleryCss}`, /overflow-x:\s*(?:auto|scroll)/);
});
