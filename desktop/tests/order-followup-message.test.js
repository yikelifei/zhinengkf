"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildOrderFollowupCustomerMessage } = require("../packages/rules");

test("builds a production follow-up without pretending shipment", () => {
  const message = buildOrderFollowupCustomerMessage({
    type: "production",
    customerName: "王总",
    scene: "端午员工福利礼盒",
    quantity: 50,
    totalPrice: 9000,
    paymentStatus: "deposit_paid",
    leadTimeDays: 7,
    items: [{ name: "红金礼盒A" }, { name: "茶叶礼品A" }],
  });

  assert.match(message, /王总/);
  assert.match(message, /端午员工福利礼盒/);
  assert.match(message, /红金礼盒A、茶叶礼品A/);
  assert.match(message, /数量 50 份/);
  assert.match(message, /进入备货\/排产跟进/);
  assert.match(message, /7 天左右/);
  assert.match(message, /尾款和交付细节/);
  assert.doesNotMatch(message, /已经发货/);
});

test("builds a delivery follow-up with careful logistics wording", () => {
  const message = buildOrderFollowupCustomerMessage({
    type: "delivery",
    quantity: 12,
    totalPrice: 3600,
    paymentStatus: "paid",
  });

  assert.match(message, /礼盒方案/);
  assert.match(message, /数量 12 份/);
  assert.match(message, /交付前跟进阶段/);
  assert.match(message, /物流单号、发货时间或现场交付细节/);
  assert.match(message, /款项状态已记录/);
  assert.doesNotMatch(message, /已经发货/);
});
