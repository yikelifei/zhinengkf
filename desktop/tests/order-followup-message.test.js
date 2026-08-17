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

test("builds a production follow-up from recorded production facts", () => {
  const message = buildOrderFollowupCustomerMessage({
    type: "production",
    customerName: "王总",
    scene: "中秋礼盒",
    quantity: 80,
    totalPrice: 12800,
    paymentStatus: "paid",
    productionStatus: "quality_check",
    productionDueAt: "2026-08-06",
  });

  assert.match(message, /当前生产状态：质检中，预计完成 2026-08-06/);
  assert.match(message, /款项状态已记录/);
  assert.doesNotMatch(message, /如果中间有物料、包装或交期变化/);
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

test("builds a delivery follow-up from recorded logistics facts", () => {
  const message = buildOrderFollowupCustomerMessage({
    type: "delivery",
    customerName: "李总",
    scene: "周年庆礼盒",
    quantity: 20,
    totalPrice: 5600,
    paymentStatus: "paid",
    carrier: "顺丰",
    trackingNo: "SF123456",
    shippedAt: "2026-08-07 15:00",
  });

  assert.match(message, /李总/);
  assert.match(message, /交付信息：物流 顺丰，单号 SF123456，发货时间 2026-08-07 15:00/);
  assert.match(message, /款项状态已记录/);
  assert.doesNotMatch(message, /有物流单号、发货时间或现场交付细节出来/);
});

test("order follow-up messages do not leak unreadable placeholder text", () => {
  const productionMessage = buildOrderFollowupCustomerMessage({
    type: "production",
    customerName: "????",
    scene: "????",
    quantity: 10,
    totalPrice: 1000,
    paymentStatus: "deposit_paid",
    items: [{ name: "????" }, { skuCode: "BOX-A" }],
  });
  const deliveryMessage = buildOrderFollowupCustomerMessage({
    type: "delivery",
    customerName: "????",
    scene: "????",
    quantity: 10,
    totalPrice: 1000,
    paymentStatus: "paid",
    carrier: "SF",
    trackingNo: "SF123",
    shippedAt: "2026-08-07 15:00",
    items: [{ name: "????" }, { skuCode: "BOX-A" }],
  });

  assert.doesNotMatch(productionMessage, /\?\?\?\?|\uFFFD/);
  assert.doesNotMatch(deliveryMessage, /\?\?\?\?|\uFFFD/);
  assert.match(productionMessage, /BOX-A/);
  assert.match(deliveryMessage, /BOX-A/);
});
