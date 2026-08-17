"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildOrderConfirmationCustomerMessage, buildQuoteCustomerMessage } = require("../packages/rules");

test("builds a customer-facing quote message with selected design and bundle details", () => {
  const message = buildQuoteCustomerMessage({
    customerName: "王总",
    scene: "端午员工福利礼盒",
    quantity: 50,
    unitPrice: 180,
    totalPrice: 9000,
    hasSelectedImage: true,
    selectedImagePosition: 2,
    items: [
      { name: "红金礼盒A" },
      { name: "茶叶礼品A" },
      { name: "感谢卡A" },
    ],
  });

  assert.match(message, /王总/);
  assert.match(message, /刚刚选中的第2张效果图/);
  assert.match(message, /端午员工福利礼盒/);
  assert.match(message, /红金礼盒A、茶叶礼品A、感谢卡A/);
  assert.match(message, /数量 50 份/);
  assert.match(message, /单价 180 元\/份/);
  assert.match(message, /合计 9000 元/);
});

test("builds a quote message without customer name or bundle item names", () => {
  const message = buildQuoteCustomerMessage({
    quantity: 10,
    unitPrice: 88.5,
    totalPrice: 885,
  });

  assert.match(message, /按我们刚才确认的搭配方向/);
  assert.match(message, /礼盒方案/);
  assert.match(message, /单价 88.5 元\/份/);
  assert.match(message, /合计 885 元/);
});

test("builds a paid low-value order confirmation message", () => {
  const message = buildOrderConfirmationCustomerMessage({
    customerName: "王总",
    scene: "端午员工福利礼盒",
    quantity: 50,
    totalPrice: 9000,
    paymentStatus: "paid",
    hasSelectedImage: true,
    selectedImagePosition: 2,
    items: [{ name: "红金礼盒A" }, { name: "茶叶礼品A" }],
  });

  assert.match(message, /王总/);
  assert.match(message, /按您确认的第2张效果图，端午员工福利礼盒/);
  assert.match(message, /红金礼盒A、茶叶礼品A/);
  assert.match(message, /数量 50 份/);
  assert.match(message, /合计 9000 元/);
  assert.match(message, /已付款记录/);
  assert.match(message, /推进排产/);
});

test("builds an unpaid order confirmation without pretending payment", () => {
  const message = buildOrderConfirmationCustomerMessage({
    quantity: 20,
    totalPrice: 3000,
  });

  assert.match(message, /礼盒方案/);
  assert.match(message, /数量 20 份/);
  assert.match(message, /付款方式、交期和细节/);
  assert.doesNotMatch(message, /已付款记录/);
});

test("quote and order confirmation messages do not leak unreadable placeholder text", () => {
  const quoteMessage = buildQuoteCustomerMessage({
    customerName: "????",
    scene: "????",
    quantity: 10,
    unitPrice: 100,
    totalPrice: 1000,
    items: [{ name: "????" }, { skuCode: "BOX-A" }],
  });
  const orderMessage = buildOrderConfirmationCustomerMessage({
    customerName: "????",
    scene: "????",
    quantity: 10,
    totalPrice: 1000,
    paymentStatus: "paid",
    items: [{ name: "????" }, { skuCode: "BOX-A" }],
  });

  assert.doesNotMatch(quoteMessage, /\?\?\?\?|\uFFFD/);
  assert.doesNotMatch(orderMessage, /\?\?\?\?|\uFFFD/);
  assert.match(quoteMessage, /BOX-A/);
  assert.match(orderMessage, /BOX-A/);
});
