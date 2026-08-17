"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require.extensions[".css"] = () => {};
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", jsx: "react-jsx" },
});

const {
  buildDeliveryAudit,
  buildDeliveryNextAction,
} = require("../apps/web/src/features/sales/sales-order-delivery-audit.tsx");

function readyOrder(overrides = {}) {
  return {
    id: "order-1",
    quoteDraftId: "quote-1",
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
    status: "fulfilled",
    paymentStatus: "paid",
    totalPrice: 9000,
    productionStatus: "delivered",
    carrier: "SF",
    trackingNo: "SF1234567890",
    shippedAt: "2026-07-29 10:00",
    deliveredAt: "2026-07-29 16:00",
    selectedImageId: "image-1",
    selectedImageSnapshot: {
      schemaVersion: "design_image_snapshot_v1",
      imageId: "candidate-1",
      localPath: "E:\\zhinengkefu\\desktop\\storage\\design-images\\candidate-1.png",
    },
    bundleSnapshot: {
      schemaVersion: "bundle_snapshot_v1",
      items: [{
        skuCode: "BOX-A",
        name: "礼盒 A",
        mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\box-a.png",
      }],
    },
    paymentEvents: [{ id: "pay-1", paymentStatus: "paid", amountCny: 9000, createdAt: "2026-07-29T09:00:00.000Z" }],
    confirmationSendTask: sendTask("confirm", "sent", { wechatWorkDeliveryState: "confirmed_sent" }),
    productionFollowupSendTask: sendTask("production", "sent", { wechatWorkDeliveryState: "confirmed_sent" }),
    deliveryFollowupSendTask: sendTask("delivery", "sent", { wechatWorkDeliveryState: "confirmed_sent" }),
    followupSendTasks: [],
    ...overrides,
  };
}

function sendTask(id, status, guardSnapshot = {}) {
  return {
    id: `task-${id}`,
    status,
    wechatAccountId: "wechat-1",
    conversationId: "conversation-1",
    payload: { kind: "order_followup" },
    guardSnapshot,
    createdAt: "2026-07-29T10:00:00.000Z",
    sentAt: status === "sent" ? "2026-07-29T10:01:00.000Z" : undefined,
  };
}

test("queued order messages do not make a delivery audit ready", () => {
  const audit = buildDeliveryAudit(readyOrder({
    confirmationSendTask: sendTask("confirm", "queued"),
    productionFollowupSendTask: sendTask("production", "pending_ack"),
    deliveryFollowupSendTask: sendTask("delivery", "queued"),
  }), true);

  const customerMessage = audit.items.find((item) => item.key === "customer-message");
  assert.equal(customerMessage.ok, false);
  assert.equal(audit.ready, false);
  assert.match(customerMessage.detail, /入队、发送中或渠道已接受/);
  assert.match(customerMessage.detail, /还没有客户可见或人工确认送达证据/);
});

test("channel-accepted sent alone cannot close delivery, while customer-visible confirmation can", () => {
  const acceptedAudit = buildDeliveryAudit(readyOrder({
    confirmationSendTask: sendTask("confirm", "sent"),
    productionFollowupSendTask: sendTask("production", "sent"),
    deliveryFollowupSendTask: sendTask("delivery", "sent"),
  }), true);
  assert.equal(acceptedAudit.items.find((item) => item.key === "customer-message").ok, false);
  assert.equal(acceptedAudit.ready, false);
  assert.match(acceptedAudit.items.find((item) => item.key === "customer-message").detail, /渠道已接受/);
  assert.deepEqual(buildDeliveryNextAction(readyOrder(), acceptedAudit), {
    label: "核对客户是否可见",
    reason: "渠道已接受发送不等于客户已经看到；请回到会话或客户侧记录核对送达事实。",
    href: "/conversations/conversation-1",
    actionLabel: "核对客户会话",
  });

  const confirmedAudit = buildDeliveryAudit(readyOrder({
    confirmationSendTask: sendTask("confirm", "pending_ack", {
      manualDeliveryResolution: { resolution: "confirmed_sent", reviewer: "ops" },
    }),
    productionFollowupSendTask: sendTask("production", "queued"),
    deliveryFollowupSendTask: sendTask("delivery", "queued"),
  }), true);
  assert.equal(confirmedAudit.items.find((item) => item.key === "customer-message").ok, true);
  assert.equal(confirmedAudit.ready, true);
});

test("blocked delivery message routes to the scoped send recovery task before fulfillment", () => {
  const order = readyOrder({
    deliveryFollowupSendTask: sendTask("delivery", "failed", {
      wechatWorkDeliveryState: "unknown",
    }),
  });
  const audit = buildDeliveryAudit(order, true);
  const nextAction = buildDeliveryNextAction(order, audit);

  assert.equal(nextAction.label, "先处理发送失败");
  assert.match(nextAction.href, /^\/send\/blocked\/task-delivery\?/);
  assert.match(nextAction.href, /conversationId=conversation-1/);
});

test("delivery audit requires payment ledger amount to cover the order total", () => {
  const shortfallAudit = buildDeliveryAudit(readyOrder({
    paymentEvents: [{ id: "pay-1", paymentStatus: "paid", amountCny: 1000, createdAt: "2026-07-29T09:00:00.000Z" }],
  }), true);
  const shortfallPaid = shortfallAudit.items.find((item) => item.key === "paid");
  assert.equal(shortfallPaid.ok, false);
  assert.equal(shortfallAudit.ready, false);
  assert.match(shortfallPaid.detail, /1,000|9000|9,000|付款流水/);

  const combinedAudit = buildDeliveryAudit(readyOrder({
    paymentEvents: [
      { id: "pay-1", paymentStatus: "deposit_paid", amountCny: 3000, createdAt: "2026-07-29T09:00:00.000Z" },
      { id: "pay-2", paymentStatus: "paid", amountCny: 6000, createdAt: "2026-07-29T10:00:00.000Z" },
    ],
  }), true);
  assert.equal(combinedAudit.items.find((item) => item.key === "paid").ok, true);
  assert.equal(combinedAudit.ready, true);
});

test("delivery audit accepts pickup shipment without a tracking number", () => {
  const audit = buildDeliveryAudit(readyOrder({
    carrier: "自提",
    trackingNo: "",
    shippedAt: "2026-07-29 10:00",
  }), true);
  const shipment = audit.items.find((item) => item.key === "shipment");

  assert.equal(shipment.ok, true);
  assert.match(shipment.detail, /自提无需物流单号/);
  assert.equal(audit.ready, true);
});

test("delivery audit blocks invalid logistics facts from looking complete", () => {
  const invalidTrackingAudit = buildDeliveryAudit(readyOrder({
    trackingNo: "ABCDEF",
  }), true);
  const invalidTracking = invalidTrackingAudit.items.find((item) => item.key === "shipment");

  assert.equal(invalidTracking.ok, false);
  assert.equal(invalidTrackingAudit.ready, false);
  assert.match(invalidTracking.detail, /物流单号格式不正确/);

  const timeAudit = buildDeliveryAudit(readyOrder({
    shippedAt: "2026-07-29 10:00",
    deliveredAt: "2026-07-28 10:00",
  }), true);
  const delivered = timeAudit.items.find((item) => item.key === "delivered");

  assert.equal(delivered.ok, false);
  assert.equal(timeAudit.ready, false);
  assert.match(delivered.detail, /签收时间不能早于发货时间/);
});

test("delivery audit blocks fulfilled orders when the delivery package snapshot is missing", () => {
  const audit = buildDeliveryAudit(readyOrder({
    selectedImageSnapshot: null,
    selectedImage: null,
    bundleSnapshot: null,
    designJob: null,
    quoteDraft: null,
  }), true);
  const deliveryPackage = audit.items.find((item) => item.key === "delivery-package");

  assert.equal(deliveryPackage.ok, false);
  assert.equal(audit.ready, false);
  assert.match(deliveryPackage.detail, /客户确认效果图快照|商品组合快照/);
});
