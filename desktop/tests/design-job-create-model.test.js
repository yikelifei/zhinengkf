"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const {
  DEFAULT_DESIGN_JOB_FORM,
  customerReferenceReadyForCreate,
  designJobCreateReadiness,
} = require("../apps/web/src/features/design/design-job-create-model");

function readyForm(overrides = {}) {
  return {
    ...DEFAULT_DESIGN_JOB_FORM,
    conversationId: "conversation-1",
    scene: "employee gifts",
    customerText: "make a real product photo for this gift bundle",
    quantity: "20",
    perUnitAmount: "180",
    totalAmount: "3600",
    outputCount: "4",
    productImageUrl: "https://assets.example.test/sku.png",
    productName: "Tea SKU",
    skuCode: "TEA-1",
    ...overrides,
  };
}

test("design job create requires bare local customer references to come from persisted assets", () => {
  const bareLocal = readyForm({
    customerAssetId: "",
    customerAssetUrl: "/local-assets/customer-logo.png",
  });
  const blocked = designJobCreateReadiness(bareLocal, null, true);
  assert.equal(customerReferenceReadyForCreate(bareLocal), false);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.issues.some((issue) => issue.code === "customer_reference_image"), true);

  const persistedLocal = readyForm({
    customerAssetId: "asset-customer-logo",
    customerAssetUrl: "/local-assets/customer-logo.png",
  });
  const ready = designJobCreateReadiness(persistedLocal, null, true);
  assert.equal(customerReferenceReadyForCreate(persistedLocal), true);
  assert.equal(ready.ok, true);
});

test("design job create can upload https or data customer references before creating the job", () => {
  assert.equal(customerReferenceReadyForCreate(readyForm({
    customerAssetUrl: "https://assets.example.test/customer-logo.png",
  })), true);
  assert.equal(customerReferenceReadyForCreate(readyForm({
    customerAssetUrl: "data:image/png;base64,AAAA",
  })), true);
  assert.equal(customerReferenceReadyForCreate(readyForm({
    customerAssetUrl: "http://assets.example.test/customer-logo.png",
  })), false);
});

test("design job create fixes every candidate round at four images", () => {
  const form = { customerAssetId: "asset-customer-logo", customerAssetUrl: "/local-assets/customer-logo.png" };
  assert.equal(DEFAULT_DESIGN_JOB_FORM.outputCount, "4");
  assert.equal(designJobCreateReadiness(readyForm({ ...form, outputCount: "4" }), null, true).ok, true);
  assert.equal(designJobCreateReadiness(readyForm({ ...form, outputCount: "3" }), null, true).ok, false);
  assert.equal(designJobCreateReadiness(readyForm({ ...form, outputCount: "5" }), null, true).ok, false);
});
