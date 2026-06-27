"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildOrderDraftFromQuote, cleanOrderDraftPatch, quotePatchForOrderDraft } = require("../packages/rules");

test("builds an order draft snapshot from a selected quote", () => {
  const decision = buildOrderDraftFromQuote({
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 180,
    totalPrice: 9000,
    totalCost: 5200,
    profit: 3800,
    status: "accepted",
    paymentStatus: "paid",
    customerNotes: "customer approved image 1",
    designJob: {
      id: "design_1",
      conversationId: "conversation_1",
      wechatAccountId: "wechat_1",
      bundle: { items: [{ skuCode: "BOX-A", salePrice: 80 }] },
      images: [{ id: "image_1", imageId: "external_1", selected: true }],
    },
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.orderDraft.status, "confirmed");
  assert.equal(decision.orderDraft.quoteDraftId, "quote_1");
  assert.equal(decision.orderDraft.wechatAccountId, "wechat_1");
  assert.equal(decision.orderDraft.profitRate, 0.4222);
  assert.deepEqual(decision.orderDraft.bundleSnapshot.items[0].skuCode, "BOX-A");
});

test("does not build an order draft without selected image and send binding", () => {
  const decision = buildOrderDraftFromQuote({
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    quantity: 10,
    unitPrice: 100,
    totalPrice: 1000,
    totalCost: 800,
    profit: 200,
    designJob: { id: "design_1" },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "missing_order_fields");
  assert.deepEqual(decision.missing.sort(), ["conversationId", "selectedImageId", "wechatAccountId"]);
});

test("does not build an order draft with negative profit", () => {
  const decision = buildOrderDraftFromQuote({
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 10,
    unitPrice: 100,
    totalPrice: 1000,
    totalCost: 1200,
    profit: -200,
    designJob: {
      id: "design_1",
      conversationId: "conversation_1",
      wechatAccountId: "wechat_1",
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "negative_profit");
});

test("does not build an order draft when quote points to another design job", () => {
  const decision = buildOrderDraftFromQuote({
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 10,
    unitPrice: 100,
    totalPrice: 1000,
    totalCost: 800,
    profit: 200,
    designJob: {
      id: "design_2",
      customerId: "customer_1",
      conversationId: "conversation_1",
      wechatAccountId: "wechat_1",
      images: [{ id: "image_1", designJobId: "design_2" }],
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "missing_order_fields");
  assert.equal(decision.missing.includes("designJobIdentity"), true);
});

test("does not build an order draft when quote customer differs from design job", () => {
  const decision = buildOrderDraftFromQuote({
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_2",
    selectedImageId: "image_1",
    quantity: 10,
    unitPrice: 100,
    totalPrice: 1000,
    totalCost: 800,
    profit: 200,
    designJob: {
      id: "design_1",
      customerId: "customer_1",
      conversationId: "conversation_1",
      wechatAccountId: "wechat_1",
      images: [{ id: "image_1", designJobId: "design_1" }],
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "missing_order_fields");
  assert.equal(decision.missing.includes("customerIdentity"), true);
});

test("does not build an order draft when selected image is not in the design job", () => {
  const decision = buildOrderDraftFromQuote({
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_2",
    quantity: 10,
    unitPrice: 100,
    totalPrice: 1000,
    totalCost: 800,
    profit: 200,
    designJob: {
      id: "design_1",
      customerId: "customer_1",
      conversationId: "conversation_1",
      wechatAccountId: "wechat_1",
      images: [{ id: "image_1", designJobId: "design_1" }],
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "selected_image_not_found");
});

test("does not build an order draft when selected image belongs to another design job", () => {
  const decision = buildOrderDraftFromQuote({
    id: "quote_1",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 10,
    unitPrice: 100,
    totalPrice: 1000,
    totalCost: 800,
    profit: 200,
    selectedImage: { id: "image_1", designJobId: "design_2" },
    designJob: {
      id: "design_1",
      customerId: "customer_1",
      conversationId: "conversation_1",
      wechatAccountId: "wechat_1",
      images: [{ id: "image_1", designJobId: "design_1" }],
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "selected_image_design_job_mismatch");
});

test("cleans order draft status and payment patch", () => {
  const patch = cleanOrderDraftPatch({
    status: "processing",
    paymentStatus: "paid",
    totalPrice: 1,
    customerId: "other_customer",
    owner: "Alice",
  });

  assert.deepEqual(patch, {
    status: "processing",
    paymentStatus: "paid",
    owner: "Alice",
  });
});

test("maps paid order draft update back to accepted quote", () => {
  const patch = quotePatchForOrderDraft(
    { id: "order_1", quoteDraftId: "quote_1", status: "draft", paymentStatus: "unpaid" },
    { paymentStatus: "paid" },
  );

  assert.equal(patch.paymentStatus, "paid");
  assert.equal(patch.status, "accepted");
});

test("maps cancelled order draft update back to cancelled quote", () => {
  const patch = quotePatchForOrderDraft(
    { id: "order_1", quoteDraftId: "quote_1", status: "confirmed", paymentStatus: "deposit_paid" },
    { status: "cancelled" },
  );

  assert.equal(patch.paymentStatus, "deposit_paid");
  assert.equal(patch.status, "cancelled");
});
