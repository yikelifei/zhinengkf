"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
});

const { designCommerceState, designJobStatusLabel } = require("../apps/web/src/features/design/design-commerce-state");
const { quoteNextAction, quoteOrderReadiness, quoteStatusLabel } = require("../apps/web/src/features/sales/sales-commerce-state");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function designJob(overrides = {}) {
  return {
    id: "design-1",
    requestId: "request-1",
    status: "draft",
    isHighValue: false,
    outputCount: 4,
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    budget: { quantity: 20, totalAmount: 3000 },
    images: [],
    bundle: { items: [{ skuCode: "SKU-1" }] },
    ...overrides,
  };
}

function quote(overrides = {}) {
  return {
    id: "quote-1",
    designJobId: "design-1",
    customerId: "customer-1",
    selectedImageId: "image-1",
    quantity: 20,
    unitPrice: 150,
    totalPrice: 3000,
    totalCost: 1800,
    profit: 1200,
    status: "accepted",
    paymentStatus: "unpaid",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    designJob: designJob({
      status: "quote_created",
      images: [{ id: "image-1", imageId: "remote-image-1", position: 0, selected: true }],
      conversation: { id: "conversation-1", customerId: "customer-1", wechatAccountId: "wechat-1" },
    }),
    ...overrides,
  };
}

test("design journey recommends one safe next stage instead of every action", () => {
  const draft = designCommerceState(designJob());
  assert.equal(draft.canSubmit, true);
  assert.equal(draft.canPoll, false);
  assert.equal(draft.canReview, false);
  assert.equal(draft.canQuote, false);
  assert.equal(draft.statusLabel, "待预检提交");

  const generating = designCommerceState(designJob({ status: "generating" }));
  assert.equal(generating.canPoll, true);
  assert.equal(generating.canSubmit, false);

  const manualReview = designCommerceState(designJob({
    status: "manual_review",
    images: [{ id: "image-1", imageId: "remote-1", position: 0, selected: true }],
  }));
  assert.equal(manualReview.canReview, true);
  assert.equal(manualReview.canQuote, false);
  assert.equal(designJobStatusLabel("manual_review"), "等待人工审核");

  const approved = designCommerceState(designJob({
    status: "quick_confirm",
    images: [{ id: "image-1", imageId: "remote-1", position: 0, selected: true }],
  }));
  assert.equal(approved.canQuote, true);
  assert.equal(approved.canReview, false);

  const approvedButIncomplete = designCommerceState(designJob({ status: "quick_confirm" }));
  assert.equal(approvedButIncomplete.canQuote, false);
  assert.equal(approvedButIncomplete.canReview, true);
  assert.match(approvedButIncomplete.blockedReason, /客户选图/);
});

test("quote to order readiness matches the server customer-acceptance gate", () => {
  assert.deepEqual(quoteOrderReadiness(quote()), { ok: true, reasons: [] });
  const notAccepted = quoteOrderReadiness(quote({ status: "send_queued" }));
  assert.equal(notAccepted.ok, false);
  assert.ok(notAccepted.reasons.includes("报价尚未被客户确认"));

  const noSelection = quoteOrderReadiness(quote({ selectedImageId: null }));
  assert.equal(noSelection.ok, false);
  assert.ok(noSelection.reasons.includes("尚未绑定客户选图"));
  assert.equal(quoteStatusLabel("send_queued"), "已进入发送队列");
});

test("every quote state resolves to one recommended next action", () => {
  assert.equal(quoteNextAction(quote({ status: "manual_review" })).action, "review");
  assert.equal(quoteNextAction(quote({ status: "draft" })).action, "send");
  assert.equal(quoteNextAction(quote({ status: "send_queued", sendTaskId: "send-1" })).action, "wait_delivery");
  assert.equal(quoteNextAction(quote({ status: "sent", sendTaskId: "send-1" })).action, "payment");
  assert.equal(quoteNextAction(quote({ status: "accepted" })).action, "order");
  assert.equal(quoteNextAction(quote({ status: "cancelled" })).action, "restart");
  assert.equal(quoteNextAction(quote({ status: "accepted", selectedImageId: null })).action, "blocked");
});

test("commerce pages render the same five-stage journey and block fake actions", () => {
  const journey = read("apps/web/src/features/design/design-commerce-journey.tsx");
  const detail = read("apps/web/src/features/design/design-job-detail-page.tsx");
  const quotePage = read("apps/web/src/features/design/design-job-quote-page.tsx");
  const review = read("apps/web/src/features/reviews/review-design-page.tsx");
  const reviewGallery = read("apps/web/src/features/reviews/review-design-gallery.tsx");
  const quoteAction = read("apps/web/src/features/sales/sales-quote-action-page.tsx");
  const quoteDetail = read("apps/web/src/features/sales/sales-quote-detail-page.tsx");
  const orderDetail = read("apps/web/src/features/sales/sales-order-detail-page.tsx");

  for (const label of ["AI 搭品", "设计任务", "人工审核", "报价", "订单"]) assert.match(journey, new RegExp(label));
  assert.match(detail, /commerceState\?\.canSubmit/);
  assert.match(detail, /commerceState\?\.canPoll/);
  assert.match(detail, /commerceState\?\.canReview/);
  assert.match(detail, /commerceState\?\.canQuote/);
  assert.match(detail, /data-action-id="design-job-open-review"/);
  assert.match(quotePage, /selectedImage && bundleItemCount > 0 && commerceState\?\.canQuote/);
  assert.match(quotePage, /尚未标记客户选中的候选图，已阻止生成报价/);
  assert.match(review, /designReviewDecisionBlockedReason/);
  assert.match(review, /候选图不足 4 张/);
  assert.match(review, /<ReviewDesignGallery job=\{activeJob\}/);
  assert.match(reviewGallery, /aria-label="待人工审核候选图"/);
  assert.match(reviewGallery, /designImagePreviewSrc\(job, image\)/);
  assert.match(reviewGallery, /image\.localFile\.state !== "ready"/);
  assert.match(reviewGallery, /客户已选/);
  assert.match(quoteAction, /sendBlockers\.length === 0/);
  assert.match(quoteAction, /Boolean\(orderReadiness\?\.ok\)/);
  assert.match(quoteDetail, /sales-quote-next-action-blocked/);
  assert.match(quoteDetail, /nextAction\?\.action === "wait_delivery"/);
  assert.match(quoteDetail, /sales-quote-open-review/);
  assert.match(orderDetail, /orderJourneyRecommendation/);
  assert.match(orderDetail, /canSendConfirmation \? <Link/);
  assert.match(orderDetail, /canSendProduction \? <Link/);
  assert.match(orderDetail, /canSendDelivery \? <Link/);
  assert.match(orderDetail, /订单已经取消，编辑、确认、生产和发货消息入口均已关闭/);
});
