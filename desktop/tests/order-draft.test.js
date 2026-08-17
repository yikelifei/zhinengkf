"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildOrderDraftFromQuote,
  cleanOrderDraftPatch,
  evaluateOrderFulfillmentTransition,
  quotePatchForOrderDraft,
} = require("../packages/rules");

function deliveryPackageFields() {
  return {
    selectedImageId: "image_1",
    selectedImageSnapshot: {
      schemaVersion: "design_image_snapshot_v1",
      imageId: "candidate_1",
      localPath: "E:\\zhinengkefu\\desktop\\storage\\design-images\\candidate_1.png",
    },
    bundleSnapshot: {
      schemaVersion: "bundle_snapshot_v1",
      items: [{ skuCode: "BOX-A", name: "礼盒 A", mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\box-a.png" }],
    },
  };
}

test("builds an order draft snapshot from a selected quote", () => {
  const quote = {
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
      bundle: {
        items: [{
          skuCode: "BOX-A",
          name: "Box A",
          type: "gift_box",
          salePrice: 80,
          costPrice: 35,
          mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\box-a.png",
          angleImages: ["E:\\zhinengkefu\\desktop\\storage\\assets\\box-a-side.png"],
          matchingRules: { preferWith: ["TEA-A"] },
        }],
      },
      images: [{
        id: "image_1",
        imageId: "external_1",
        designJobId: "design_1",
        position: 1,
        selected: true,
        localPath: "E:\\zhinengkefu\\desktop\\storage\\design-images\\external_1.png",
        downloadUrl: "https://example.test/external_1.png",
        fingerprint: "dhash64:v1:abcd",
        transient: { shouldNotLeak: true },
      }],
    },
  };
  const decision = buildOrderDraftFromQuote(quote);
  quote.designJob.bundle.items[0].mainImagePath = "E:\\zhinengkefu\\desktop\\storage\\assets\\box-a-new.png";
  quote.designJob.images[0].localPath = "E:\\zhinengkefu\\desktop\\storage\\design-images\\external_1_new.png";

  assert.equal(decision.ok, true);
  assert.equal(decision.orderDraft.status, "confirmed");
  assert.equal(decision.orderDraft.quoteDraftId, "quote_1");
  assert.equal(decision.orderDraft.customerId, "customer_1");
  assert.equal(decision.orderDraft.conversationId, "conversation_1");
  assert.equal(decision.orderDraft.wechatAccountId, "wechat_1");
  assert.equal(decision.orderDraft.profitRate, 0.4222);
  assert.equal(decision.orderDraft.productionStatus, "not_started");
  assert.equal(decision.orderDraft.productionDueAt, "");
  assert.equal(decision.orderDraft.carrier, "");
  assert.equal(decision.orderDraft.trackingNo, "");
  assert.equal(decision.orderDraft.shippedAt, "");
  assert.equal(decision.orderDraft.deliveredAt, "");
  assert.deepEqual(decision.orderDraft.bundleSnapshot.items[0].skuCode, "BOX-A");
  assert.equal(decision.orderDraft.bundleSnapshot.schemaVersion, "bundle_snapshot_v1");
  assert.equal(decision.orderDraft.bundleSnapshot.items[0].name, "Box A");
  assert.equal(decision.orderDraft.bundleSnapshot.items[0].type, "gift_box");
  assert.equal(decision.orderDraft.bundleSnapshot.items[0].mainImagePath.endsWith("box-a.png"), true);
  assert.equal(decision.orderDraft.bundleSnapshot.items[0].angleImages[0].endsWith("box-a-side.png"), true);
  assert.equal(decision.orderDraft.bundleSnapshot.items[0].matchingRules, undefined);
  assert.equal(decision.orderDraft.selectedImageSnapshot.schemaVersion, "design_image_snapshot_v1");
  assert.equal(decision.orderDraft.selectedImageSnapshot.imageId, "external_1");
  assert.equal(decision.orderDraft.selectedImageSnapshot.localPath.endsWith("external_1.png"), true);
  assert.equal(decision.orderDraft.selectedImageSnapshot.transient, undefined);
});

test("keeps accepted quote order draft unconfirmed until payment is recorded", () => {
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
    paymentStatus: "unpaid",
    designJob: {
      id: "design_1",
      conversationId: "conversation_1",
      wechatAccountId: "wechat_1",
      bundle: { items: [{ skuCode: "BOX-A", salePrice: 80 }] },
      images: [{ id: "image_1", imageId: "external_1", selected: true }],
    },
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.orderDraft.status, "draft");
  assert.equal(decision.orderDraft.paymentStatus, "unpaid");
});

test("does not build an order draft before quote acceptance or verified payment", () => {
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
    status: "sent",
    paymentStatus: "unpaid",
    designJob: {
      id: "design_1",
      conversationId: "conversation_1",
      wechatAccountId: "wechat_1",
      bundle: { items: [{ skuCode: "BOX-A", salePrice: 80 }] },
      images: [{ id: "image_1", imageId: "external_1", selected: true }],
    },
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "quote_not_sent_or_accepted");

  const paidButUnaccepted = buildOrderDraftFromQuote({
    id: "quote_2",
    designJobId: "design_1",
    customerId: "customer_1",
    selectedImageId: "image_1",
    quantity: 50,
    unitPrice: 180,
    totalPrice: 9000,
    totalCost: 5200,
    profit: 3800,
    status: "sent",
    paymentStatus: "paid",
    designJob: {
      id: "design_1",
      conversationId: "conversation_1",
      wechatAccountId: "wechat_1",
      bundle: { items: [{ skuCode: "BOX-A", salePrice: 80 }] },
      images: [{ id: "image_1", imageId: "external_1", selected: true }],
    },
  });

  assert.equal(paidButUnaccepted.ok, false);
  assert.equal(paidButUnaccepted.reason, "quote_not_sent_or_accepted");
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
    status: "accepted",
    paymentStatus: "unpaid",
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
    status: "accepted",
    paymentStatus: "unpaid",
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
    status: "accepted",
    paymentStatus: "unpaid",
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
    status: "accepted",
    paymentStatus: "unpaid",
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
    productionStatus: "in_production",
    productionDueAt: " 2026-07-30 ",
    carrier: "顺丰",
    trackingNo: " SF123456 ",
    shippedAt: "2026-07-31 16:00",
    deliveredAt: "2026-08-01 09:30",
    totalPrice: 1,
    customerId: "other_customer",
    owner: "Alice",
  });

  assert.deepEqual(patch, {
    status: "processing",
    paymentStatus: "paid",
    productionStatus: "in_production",
    productionDueAt: "2026-07-30",
    carrier: "顺丰",
    trackingNo: "SF123456",
    shippedAt: "2026-07-31 16:00",
    deliveredAt: "2026-08-01 09:30",
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

test("rejects fulfillment status jumps and missing shipment facts", () => {
  const current = {
    status: "confirmed",
    paymentStatus: "paid",
    productionStatus: "in_production",
    selectedImageId: "image_1",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    profit: 1200,
  };

  const jumped = evaluateOrderFulfillmentTransition(current, { productionStatus: "shipped" });
  assert.equal(jumped.ok, false);
  assert.equal(jumped.reason, "production_status_regression");

  const missingFacts = evaluateOrderFulfillmentTransition(
    { ...current, productionStatus: "ready_to_ship" },
    { productionStatus: "shipped" },
  );
  assert.equal(missingFacts.ok, false);
  assert.equal(missingFacts.reason, "shipment_facts_missing");
  assert.deepEqual(missingFacts.missing, ["carrier", "trackingNo", "shippedAt"]);
});

test("rejects invalid logistics facts before marking an order shipped", () => {
  const current = {
    status: "processing",
    paymentStatus: "paid",
    productionStatus: "ready_to_ship",
    selectedImageId: "image_1",
    wechatAccountId: "wechat_1",
    customerId: "customer_1",
    conversationId: "conversation_1",
    profit: 1200,
  };

  const invalidTracking = evaluateOrderFulfillmentTransition(current, {
    productionStatus: "shipped",
    carrier: "SF Express",
    trackingNo: "abc",
    shippedAt: "2026-08-01 10:00",
  });
  assert.equal(invalidTracking.ok, false);
  assert.equal(invalidTracking.reason, "shipment_facts_invalid");
  assert.deepEqual(invalidTracking.invalid, ["trackingNo"]);

  const invalidDate = evaluateOrderFulfillmentTransition(current, {
    productionStatus: "shipped",
    carrier: "SF Express",
    trackingNo: "SF123456789",
    shippedAt: "2026-99-01 10:00",
  });
  assert.equal(invalidDate.ok, false);
  assert.equal(invalidDate.reason, "shipment_facts_invalid");
  assert.deepEqual(invalidDate.invalid, ["shippedAt"]);

  const pickup = evaluateOrderFulfillmentTransition(current, {
    productionStatus: "shipped",
    carrier: "自提",
    trackingNo: "",
    shippedAt: "2026-08-01 10:00",
  });
  assert.equal(pickup.ok, true);
});

test("requires full payment and delivered facts before fulfilling an order", () => {
  const base = {
    status: "processing",
    paymentStatus: "deposit_paid",
    productionStatus: "shipped",
    carrier: "SF",
    trackingNo: "SF123456",
    shippedAt: "2026-08-01 10:00",
    ...deliveryPackageFields(),
  };

  const depositOnly = evaluateOrderFulfillmentTransition(base, { status: "fulfilled" });
  assert.equal(depositOnly.ok, false);
  assert.equal(depositOnly.reason, "fulfilled_requires_full_payment");

  const noDelivery = evaluateOrderFulfillmentTransition(
    { ...base, paymentStatus: "paid" },
    { status: "fulfilled" },
  );
  assert.equal(noDelivery.ok, false);
  assert.equal(noDelivery.reason, "fulfilled_requires_delivery");

  const completed = evaluateOrderFulfillmentTransition(
    { ...base, paymentStatus: "paid" },
    { status: "fulfilled", productionStatus: "delivered", deliveredAt: "2026-08-02 12:00" },
  );
  assert.equal(completed.ok, true);
  assert.equal(completed.next.status, "fulfilled");
  assert.equal(completed.next.productionStatus, "delivered");

  const missingPackage = evaluateOrderFulfillmentTransition(
    { ...base, paymentStatus: "paid", bundleSnapshot: null, selectedImageSnapshot: null },
    { status: "fulfilled", productionStatus: "delivered", deliveredAt: "2026-08-02 12:00" },
  );
  assert.equal(missingPackage.ok, false);
  assert.equal(missingPackage.reason, "delivery_package_missing");
  assert.deepEqual(missingPackage.missing, ["selectedImageSnapshot", "bundleSnapshot"]);
});

test("rejects delivered facts before shipment time", () => {
  const decision = evaluateOrderFulfillmentTransition(
    {
      status: "processing",
      paymentStatus: "paid",
      productionStatus: "shipped",
      carrier: "SF Express",
      trackingNo: "SF123456",
      shippedAt: "2026-08-02 10:00",
    },
    { status: "fulfilled", productionStatus: "delivered", deliveredAt: "2026-08-01 12:00" },
  );

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "delivery_before_shipment");
  assert.deepEqual(decision.invalid, ["deliveredAt"]);
});
