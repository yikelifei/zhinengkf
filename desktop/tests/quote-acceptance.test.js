"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { detectQuoteAcceptanceIntent, planInboundQuoteAcceptance } = require("../packages/rules");

const sentLowValueQuote = {
  id: "quote_1",
  status: "sent",
  paymentStatus: "unpaid",
  selectedImageId: "image_1",
  totalPrice: 9000,
  profit: 3600,
  owner: "",
  designJob: {
    id: "design_1",
    isHighValue: false,
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
  },
};

test("detects clear quote acceptance without payment", () => {
  const intent = detectQuoteAcceptanceIntent("可以，就按这个方案下单");

  assert.equal(intent.hasIntent, true);
  assert.equal(intent.paymentStatus, null);
});

test("detects customer payment confirmation", () => {
  const intent = detectQuoteAcceptanceIntent("我这边已经付款了，你安排制作吧");

  assert.equal(intent.hasIntent, true);
  assert.equal(intent.paymentStatus, "paid");
});

test("ignores negative or revision wording", () => {
  const intent = detectQuoteAcceptanceIntent("这个太贵了，先不下单，再改一下");

  assert.equal(intent.hasIntent, false);
});

test("plans accepted low-value quote into order creation", () => {
  const plan = planInboundQuoteAcceptance({
    text: "好的，就按这个做吧",
    quote: sentLowValueQuote,
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.action, "accept_quote_and_create_order");
  assert.equal(plan.quotePatch.status, "accepted");
  assert.equal(plan.quotePatch.paymentStatus, "unpaid");
});

test("plans paid low-value quote into paid order creation", () => {
  const plan = planInboundQuoteAcceptance({
    text: "定金已经转账了",
    quote: { ...sentLowValueQuote, status: "send_queued" },
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.quotePatch.paymentStatus, "deposit_paid");
});

test("updates existing order draft when customer later confirms payment", () => {
  const plan = planInboundQuoteAcceptance({
    text: "定金已经转账了，麻烦安排制作",
    quote: { ...sentLowValueQuote, status: "accepted", paymentStatus: "unpaid" },
    existingOrderDraft: {
      id: "order_1",
      status: "draft",
      paymentStatus: "unpaid",
      owner: "",
    },
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.action, "update_existing_order_payment");
  assert.equal(plan.reason, "customer_payment_confirmed_existing_order");
  assert.equal(plan.orderDraftId, "order_1");
  assert.equal(plan.orderPatch.status, "confirmed");
  assert.equal(plan.orderPatch.paymentStatus, "deposit_paid");
  assert.equal(plan.quotePatch.status, "accepted");
  assert.equal(plan.quotePatch.paymentStatus, "deposit_paid");
});

test("does not downgrade or repeat already recorded existing order payment", () => {
  const plan = planInboundQuoteAcceptance({
    text: "定金已经转账了",
    quote: { ...sentLowValueQuote, status: "accepted", paymentStatus: "paid" },
    existingOrderDraft: {
      id: "order_1",
      status: "confirmed",
      paymentStatus: "paid",
    },
  });

  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "order_payment_already_recorded");
});

test("does not create another order draft after existing order acceptance text", () => {
  const plan = planInboundQuoteAcceptance({
    text: "可以，就按这个做",
    quote: { ...sentLowValueQuote, status: "accepted", paymentStatus: "unpaid" },
    existingOrderDraft: {
      id: "order_1",
      status: "draft",
      paymentStatus: "unpaid",
    },
  });

  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "already_has_order_draft");
});

test("does not accept high-value quote automatically", () => {
  const plan = planInboundQuoteAcceptance({
    text: "可以，下单",
    quote: { ...sentLowValueQuote, totalPrice: 12000 },
  });

  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "manual_review_required");
});

test("does not accept unsent quote without payment proof text", () => {
  const plan = planInboundQuoteAcceptance({
    text: "可以",
    quote: { ...sentLowValueQuote, status: "send_queued" },
  });

  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "quote_not_sent");
});
