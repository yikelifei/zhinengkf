"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("catalog handoff preserves customer identity through design and quote routes", () => {
  const handoff = read("apps/web/src/features/catalog/catalog-bundle-design-handoff.tsx");
  const create = read("apps/web/src/features/design/design-job-create-page.tsx");
  const createForm = read("apps/web/src/features/design/design-job-create-form.tsx");
  const detail = read("apps/web/src/features/design/design-job-detail-page.tsx");
  const quote = read("apps/web/src/features/design/design-job-quote-page.tsx");
  const salesQuote = read("apps/web/src/features/sales/sales-quote-detail-page.tsx");
  const detailRoute = read("apps/web/src/app/design/jobs/[id]/page.tsx");
  const quoteRoute = read("apps/web/src/app/design/jobs/[id]/quote/page.tsx");
  const salesQuoteRoute = read("apps/web/src/app/sales/quotes/[id]/page.tsx");

  assert.match(handoff, /conversationIdentityHref\(`\/design\/jobs\/\$\{encodeURIComponent\(createdJobId\)\}`/);
  assert.match(createForm, /designIdentityHref\(`\/design\/jobs\/\$\{encodeURIComponent\(createdJob\.id\)\}`, createdJob\)/);
  assert.match(createForm, /conversationIdentityHref\("\/design\/jobs", selectedConversation\)/);
  assert.match(detail, /designIdentityHref\(`\/sales\/quotes\/\$\{encodeURIComponent\(selectionNotice\.quoteId\)\}`, selected\)/);
  assert.match(detail, /designIdentityHref\("\/design\/jobs", selected\)/);
  assert.match(quote, /designIdentityHref\(`\/sales\/quotes\/\$\{encodeURIComponent\(quote\.id\)\}`, selected\)/);
  assert.match(salesQuote, /quoteIdentityHref\("\/sales\/quotes", selected\)/);

  for (const route of [detailRoute, quoteRoute, salesQuoteRoute]) {
    assert.match(route, /identityFiltersFromSearchParams\(searchParams\)/);
    assert.match(route, /initialIdentityFilters=\{identityFilters\}/);
  }
});

test("refresh failures keep design and quote writes behind one disabled next step", () => {
  const create = read("apps/web/src/features/design/design-job-create-page.tsx");
  const createForm = read("apps/web/src/features/design/design-job-create-form.tsx");
  const detail = read("apps/web/src/features/design/design-job-detail-page.tsx");
  const salesQuote = read("apps/web/src/features/sales/sales-quote-detail-page.tsx");
  assert.match(create, /const dataFresh = !loadError/);
  assert.match(create, /requiredReady = readiness\.ok && dataFresh/);
  assert.match(createForm, /disabled=\{busy \|\| !canPrepare\}/);
  assert.match(detail, /const dataFresh = !error/);
  assert.match(detail, /!dataFresh \? <div[\s\S]*data-action-id="design-job-next-action-stale"/);
  assert.match(detail, /任务刷新失败，已暂停提交、审核和报价入口/);
  assert.match(salesQuote, /const dataFresh = !error/);
  assert.match(salesQuote, /!dataFresh \? <div[\s\S]*data-action-id="sales-quote-next-action-stale"/);
  assert.match(salesQuote, /报价刷新失败，已暂停审核、发送、付款和创建订单入口/);
});

test("review handoff exposes one status-correct identity-scoped destination", () => {
  const source = read("apps/web/src/features/reviews/review-handoff.tsx");
  assert.match(source, /export function reviewHandoffNextLink/);
  assert.match(source, /\["blocked", "failed"\]\.includes/);
  assert.match(source, /blocked[\s\S]*\/send\/blocked/);
  assert.match(source, /: \{ href: `\/send\/queue/);
  assert.match(source, /else if \(handoff\.orderDraft\?\.id\)/);
  assert.match(source, /else if \(handoff\.quoteDraft\?\.id\)/);
  assert.match(source, /else if \(handoff\.designJob\?\.id\)/);
  assert.match(source, /reviewIdentityHref\(link\.href, reviewHandoffIdentity\(handoff\)\)/);
  assert.doesNotMatch(source, /links\.push/);
});

test("review read failures are unknown rather than fake not-found results", () => {
  const shared = read("apps/web/src/features/reviews/review-page-shared.tsx");
  const design = read("apps/web/src/features/reviews/review-design-page.tsx");
  const quotes = read("apps/web/src/features/reviews/review-quotes-page.tsx");
  const orders = read("apps/web/src/features/reviews/review-orders-page.tsx");
  const catchBlock = shared.slice(shared.indexOf("export function useReviewRecord<T>"));
  assert.match(catchBlock, /setRecord\(null\)[\s\S]*setLoaded\(false\)/);
  for (const source of [design, quotes, orders]) {
    assert.match(source, /已阻止审核操作/);
    assert.match(source, /busy \? "正在读取/);
  }
});

test("repeated design image controls have unique action ids and phone layouts remain bounded", () => {
  const detail = read("apps/web/src/features/design/design-job-detail-page.tsx");
  const catalogCss = read("apps/web/src/features/catalog/catalog-pages.module.css");
  const designCss = read("apps/web/src/features/design/design-pages.module.css");
  const salesCss = read("apps/web/src/features/sales/sales-pages.module.css");
  assert.match(detail, /const imageActionKey = safeActionId\(`\$\{imageKey \|\| "image"\}-\$\{index \+ 1\}`\)/);
  assert.match(detail, /design-image-select-customer-choice-\$\{imageActionKey\}/);
  assert.match(detail, /design-image-repair-local-file-\$\{imageActionKey\}/);
  assert.match(catalogCss, /@media \(max-width: 640px\)[\s\S]*\.formActions/);
  assert.match(designCss, /@media \(max-width: 760px\)[\s\S]*\.actionChoiceGrid/);
  assert.match(salesCss, /@media \(max-width: 640px\)[\s\S]*\.actionChoiceGrid/);
});
