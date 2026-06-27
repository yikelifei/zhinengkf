"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateDesignAutoSubmit } = require("../packages/rules");

test("allows complete low-value draft to auto submit", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A", imageUrl: "https://example.test/box.png" }] },
    designType: "bundle_render",
    scene: "员工福利",
    assets: [{ id: "asset_1", url: "https://example.test/logo.png" }],
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.action, "submit");
});

test("skips high-value draft", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: true,
    budget: { totalAmount: 30000, quantity: 100 },
    bundle: { items: [{ skuCode: "BOX-A", imageUrl: "https://example.test/box.png" }] },
    designType: "bundle_render",
    scene: "企业礼赠",
    assets: [{ id: "asset_1" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "manual_review_required");
});

test("skips draft when conversation is manually locked", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    conversation: { manualLocked: true },
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A" }] },
    designType: "bundle_render",
    scene: "员工福利",
    assets: [{ id: "asset_1", url: "https://example.test/logo.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "conversation_manual_locked");
});

test("skips draft without real assets", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A" }] },
    designType: "bundle_render",
    scene: "员工福利",
    assets: [],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.missing.includes("assets"), true);
});

test("skips draft when customer asset has no usable image reference", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A", imageUrl: "https://example.test/box.png" }] },
    designType: "bundle_render",
    scene: "employee gift",
    assets: [{ id: "asset_1", fileName: "logo.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "missing_usable_real_images");
  assert.equal(decision.missing.includes("customer_assets"), true);
});

test("skips draft when bundle sku image is missing", () => {
  const decision = evaluateDesignAutoSubmit({
    id: "design_1",
    status: "draft",
    isHighValue: false,
    budget: { perUnitAmount: 180, quantity: 50 },
    bundle: { items: [{ skuCode: "BOX-A" }] },
    designType: "bundle_render",
    scene: "employee gift",
    assets: [{ id: "asset_1", url: "https://example.test/logo.png" }],
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "missing_usable_real_images");
  assert.equal(decision.missing.includes("complete_sku_images"), true);
});
