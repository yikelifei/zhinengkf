"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { detectQuoteAcceptanceIntent, planInboundQuoteAcceptance } = require("../packages/rules");

const sentLowValueQuote = {
  id: "quote_real_chinese_1",
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

test("detects real Chinese quote acceptance and payment wording", () => {
  assert.deepEqual(detectQuoteAcceptanceIntent("可以，就按这个做"), {
    hasIntent: true,
    paymentStatus: null,
  });
  assert.deepEqual(detectQuoteAcceptanceIntent("定金已经转账了，麻烦安排制作"), {
    hasIntent: true,
    paymentStatus: "deposit_paid",
  });
  assert.deepEqual(detectQuoteAcceptanceIntent("我已付款了，按这个方案下单"), {
    hasIntent: true,
    paymentStatus: "paid",
  });
});

test("does not treat real Chinese rejection or revision as acceptance", () => {
  assert.equal(detectQuoteAcceptanceIntent("这个太贵了，先不下单").hasIntent, false);
  assert.equal(detectQuoteAcceptanceIntent("再改一下背景，暂时不做").hasIntent, false);
});

test("plans real Chinese paid low-value quote into order creation", () => {
  const plan = planInboundQuoteAcceptance({
    text: "定金已经转账了，麻烦安排制作",
    quote: { ...sentLowValueQuote, status: "send_queued" },
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.action, "accept_quote_and_create_order");
  assert.equal(plan.quotePatch.status, "accepted");
  assert.equal(plan.quotePatch.paymentStatus, "deposit_paid");
});
