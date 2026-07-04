"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildWaitingMessage,
  decideRevisionPolicy,
  DESIGN_STATUSES,
  evaluateArtImageLocalHealthReadiness,
  evaluateDesignPlatformActivationStatus,
  inspectAssetReferences,
  inspectBundleReferences,
  inspectRealDesignReferences,
  isHighValueBudget,
  matchCustomerSelection,
  matchImageFingerprint,
  matchTextSelection,
  nextStatusAfterDesignCompleted,
  parseBudget,
  planCustomerImageSelection,
  recommendBundle,
  shouldTimeout,
  validateDesignRequest,
} = require("../packages/rules");

test("parses total budget and quantity into per-unit amount", () => {
  const budget = parseBudget("总预算1万，100份");
  assert.equal(budget.mode, "total");
  assert.equal(budget.totalAmount, 10000);
  assert.equal(budget.quantity, 100);
  assert.equal(budget.perUnitAmount, 100);
});

test("reports missing design platform device activation before formal generation", () => {
  const result = evaluateDesignPlatformActivationStatus({
    required: true,
    active: false,
    reason: "missing_device",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_device");
  assert.match(result.detail, /DESIGN_PLATFORM_DEVICE_ID/);
});

test("accepts active design platform activation status", () => {
  const result = evaluateDesignPlatformActivationStatus({
    required: true,
    active: true,
    reason: "active",
    deviceIdSuffix: "abcd",
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "active");
  assert.match(result.detail, /abcd/);
});

test("accepts ready local art image platform health", () => {
  const result = evaluateArtImageLocalHealthReadiness({
    localDemo: { localGenerateEnabled: true },
    ai: { imageConfigured: true, imageModel: "gpt-image-2" },
    checks: [
      { key: "AI provider API key", label: "configured", status: "ready", detail: "provider_api_key" },
      { key: "AI_BASE_URL", label: "configured", status: "ready", detail: "ai_base_url" },
      { key: "AI_TEXT_MODEL", label: "configured", status: "ready", detail: "text_model" },
      { key: "AI_IMAGE_MODEL", label: "configured", status: "ready", detail: "image_model" },
      { key: "GENERATED_ASSETS_BUCKET", label: "configured", status: "ready", detail: "generated_assets_bucket" },
      { key: "STRIPE_SECRET_KEY", label: "not_configured", status: "optional", detail: "stripe_secret_key" },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.every((check) => check.ok || check.severity !== "error"), true);
});

test("blocks local art image platform health when image generation is not ready", () => {
  const result = evaluateArtImageLocalHealthReadiness({
    localDemo: { localGenerateEnabled: false },
    ai: { imageConfigured: false },
    checks: [
      { key: "AI provider API key", label: "not_configured", status: "missing", detail: "provider_api_key" },
      { key: "STRIPE_SECRET_KEY", label: "not_configured", status: "optional", detail: "stripe_secret_key" },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.some((check) => check.key === "art_image_local_generate" && check.severity === "error"), true);
  assert.equal(result.checks.some((check) => check.key === "art_image_model" && check.severity === "error"), true);
  assert.equal(result.checks.some((check) => /ai_provider_api_key/.test(check.key) && check.severity === "error"), true);
});

test("parses per-box budget and quantity into total amount", () => {
  const budget = parseBudget("每盒200元，做50份");
  assert.equal(budget.mode, "per_box");
  assert.equal(budget.perUnitAmount, 200);
  assert.equal(budget.quantity, 50);
  assert.equal(budget.totalAmount, 10000);
});

test("high value hits on total or per-unit amount", () => {
  assert.equal(isHighValueBudget({ totalAmount: 10000, perUnitAmount: 100 }, 10000), true);
  assert.equal(isHighValueBudget({ totalAmount: 9999, perUnitAmount: 10000 }, 10000), true);
  assert.equal(isHighValueBudget({ totalAmount: 9999, perUnitAmount: 9999 }, 10000), false);
});

test("recommends bundle with replacement when stock is missing", () => {
  const result = recommendBundle({
    budget: { perUnitAmount: 300 },
    scene: "员工福利",
    skus: [
      { skuCode: "BOX-A", name: "礼盒A", type: "gift_box", salePrice: 60, costPrice: 30, stock: 10, sceneTags: ["员工福利"] },
      { skuCode: "TEA-A", name: "茶叶A", type: "item", salePrice: 120, costPrice: 70, stock: 0, replacementSkuCodes: ["TEA-B"], sceneTags: ["员工福利"] },
      { skuCode: "TEA-B", name: "茶叶B", type: "item", salePrice: 110, costPrice: 60, stock: 5, sceneTags: ["员工福利"] },
      { skuCode: "CARD-A", name: "贺卡A", type: "accessory", salePrice: 20, costPrice: 5, stock: 99, sceneTags: ["员工福利"] },
    ],
  });

  assert.ok(result.items.some((item) => item.skuCode === "BOX-A"));
  assert.ok(result.items.some((item) => item.replacedOriginalSkuCode === "TEA-A"));
  assert.equal(result.totals.salePrice <= 300, true);
});

test("does not recommend out-of-stock sku without an available replacement", () => {
  const result = recommendBundle({
    budget: { perUnitAmount: 260 },
    scene: "vip",
    skus: [
      { skuCode: "BOX-OUT", name: "Out of stock box", type: "gift_box", salePrice: 50, costPrice: 20, stock: 0, sceneTags: ["vip"] },
      { skuCode: "BOX-IN", name: "Available box", type: "gift_box", salePrice: 60, costPrice: 30, stock: 20, sceneTags: ["daily"] },
      { skuCode: "ITEM-OUT", name: "Out of stock item", type: "item", salePrice: 80, costPrice: 40, stock: 0, sceneTags: ["vip"] },
      { skuCode: "ITEM-IN", name: "Available item", type: "item", salePrice: 90, costPrice: 50, stock: 10, sceneTags: ["daily"] },
    ],
  });

  assert.equal(result.items.some((item) => item.skuCode === "BOX-OUT"), false);
  assert.equal(result.items.some((item) => item.skuCode === "ITEM-OUT"), false);
  assert.equal(result.items.some((item) => item.stockWarning), false);
  assert.ok(result.items.some((item) => item.skuCode === "BOX-IN"));
  assert.ok(result.items.some((item) => item.skuCode === "ITEM-IN"));
});

test("does not duplicate replacement sku in the same bundle", () => {
  const result = recommendBundle({
    budget: { perUnitAmount: 300 },
    scene: "vip",
    skus: [
      { skuCode: "BOX-A", name: "Gift box", type: "gift_box", salePrice: 60, costPrice: 30, stock: 10, sceneTags: ["vip"] },
      { skuCode: "ITEM-A", name: "Original item", type: "item", salePrice: 90, costPrice: 40, stock: 0, replacementSkuCodes: ["ITEM-B"], sceneTags: ["vip"] },
      { skuCode: "ITEM-B", name: "Replacement item", type: "item", salePrice: 90, costPrice: 45, stock: 10, sceneTags: ["vip"] },
      { skuCode: "CARD-A", name: "Card", type: "accessory", salePrice: 20, costPrice: 5, stock: 20, sceneTags: ["vip"] },
    ],
  });

  const itemBCount = result.items.filter((item) => item.skuCode === "ITEM-B").length;
  assert.equal(itemBCount, 1);
  assert.ok(result.items.some((item) => item.replacedOriginalSkuCode === "ITEM-A"));
});

test("requires stock to cover requested quantity when recommending bundle", () => {
  const result = recommendBundle({
    budget: { perUnitAmount: 260, quantity: 50 },
    scene: "vip",
    skus: [
      { skuCode: "BOX-LOW", name: "Low stock box", type: "gift_box", salePrice: 50, costPrice: 20, stock: 20, sceneTags: ["vip"] },
      { skuCode: "BOX-OK", name: "Enough stock box", type: "gift_box", salePrice: 60, costPrice: 30, stock: 80, sceneTags: ["daily"] },
      { skuCode: "ITEM-LOW", name: "Low stock item", type: "item", salePrice: 80, costPrice: 40, stock: 10, replacementSkuCodes: ["ITEM-OK"], sceneTags: ["vip"] },
      { skuCode: "ITEM-OK", name: "Enough stock item", type: "item", salePrice: 85, costPrice: 45, stock: 70, sceneTags: ["daily"] },
    ],
  });

  assert.equal(result.items.some((item) => item.skuCode === "BOX-LOW"), false);
  assert.ok(result.items.some((item) => item.skuCode === "BOX-OK"));
  assert.ok(result.items.some((item) => item.replacedOriginalSkuCode === "ITEM-LOW"));
  assert.equal(result.fulfillment.requestedQuantity, 50);
  assert.equal(result.fulfillment.enough, true);
  assert.equal(result.fulfillment.capacity, 70);
  assert.equal(result.fulfillment.bottleneckSkuCode, "ITEM-OK");
});

test("prefers automation-ready bundle over cheaper risky skus", () => {
  const result = recommendBundle({
    budget: { perUnitAmount: 200, quantity: 20 },
    scene: "vip",
    maxItems: 1,
    skus: [
      { skuCode: "BOX-RISK", name: "Risk box", type: "gift_box", salePrice: 50, costPrice: 49, stock: 50, sceneTags: ["vip"] },
      { skuCode: "BOX-READY", name: "Ready box", type: "gift_box", salePrice: 60, costPrice: 30, stock: 50, sceneTags: ["vip"], dimensions: { lengthCm: 30, widthCm: 20, heightCm: 8 }, weightGram: 600, leadTimeDays: 5 },
      { skuCode: "ITEM-RISK", name: "Large low margin item", type: "item", salePrice: 70, costPrice: 69, stock: 50, sceneTags: ["vip"], dimensions: { lengthCm: 40, widthCm: 25, heightCm: 12 }, weightGram: 500, leadTimeDays: 7 },
      { skuCode: "ITEM-READY", name: "Ready item", type: "item", salePrice: 80, costPrice: 40, stock: 50, sceneTags: ["vip"], dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 }, weightGram: 300, leadTimeDays: 7 },
    ],
  });

  assert.ok(result.items.some((item) => item.skuCode === "BOX-READY"));
  assert.ok(result.items.some((item) => item.skuCode === "ITEM-READY"));
  assert.equal(result.items.some((item) => item.skuCode === "BOX-RISK"), false);
  assert.equal(result.items.some((item) => item.skuCode === "ITEM-RISK"), false);
  assert.equal(result.automation.ready, true);
  assert.deepEqual(result.automation.blockers, []);
  assert.equal(result.status, "ready");
});

test("applies SKU matching rules when recommending bundle items", () => {
  const base = {
    costPrice: 10,
    stock: 40,
    sceneTags: ["vip"],
    dimensions: { lengthCm: 8, widthCm: 6, heightCm: 2 },
    weightGram: 100,
    leadTimeDays: 3,
  };
  const result = recommendBundle({
    budget: { perUnitAmount: 180, quantity: 10 },
    scene: "vip",
    maxItems: 2,
    skus: [
      { ...base, skuCode: "BOX-A", name: "Box A", type: "gift_box", salePrice: 60, costPrice: 30, dimensions: { lengthCm: 30, widthCm: 20, heightCm: 8 }, weightGram: 500 },
      { ...base, skuCode: "TEA-A", name: "Tea A", type: "item", salePrice: 80, matchingRules: { mustWith: ["CARD-A"], cannotWith: ["SNACK-A"] } },
      { ...base, skuCode: "CARD-A", name: "Card A", type: "accessory", salePrice: 10, matchingRules: { preferWith: ["TEA-A"] } },
      { ...base, skuCode: "SNACK-A", name: "Snack A", type: "item", salePrice: 30 },
    ],
  });

  assert.deepEqual(result.items.map((item) => item.skuCode), ["BOX-A", "TEA-A", "CARD-A"]);
  assert.equal(result.items.some((item) => item.skuCode === "SNACK-A"), false);
  assert.equal(result.totals.salePrice, 150);
});

test("skips SKU when required matching companion is unavailable", () => {
  const base = {
    costPrice: 10,
    stock: 20,
    sceneTags: ["vip"],
    dimensions: { lengthCm: 8, widthCm: 6, heightCm: 2 },
    weightGram: 100,
    leadTimeDays: 3,
  };
  const result = recommendBundle({
    budget: { perUnitAmount: 150, quantity: 10 },
    scene: "vip",
    maxItems: 2,
    skus: [
      { ...base, skuCode: "BOX-A", name: "Box A", type: "gift_box", salePrice: 50, costPrice: 25, dimensions: { lengthCm: 30, widthCm: 20, heightCm: 8 }, weightGram: 500 },
      { ...base, skuCode: "TEA-NEEDS-CARD", name: "Tea needs card", type: "item", salePrice: 70, matchingRules: { mustWith: ["CARD-MISSING"] } },
      { ...base, skuCode: "TEA-OK", name: "Tea ok", type: "item", salePrice: 60 },
    ],
  });

  assert.equal(result.items.some((item) => item.skuCode === "TEA-NEEDS-CARD"), false);
  assert.ok(result.items.some((item) => item.skuCode === "TEA-OK"));
});

test("validates design request required fields", () => {
  const result = validateDesignRequest({
    budget: { perUnitAmount: 200 },
    bundle: { items: [{ skuCode: "BOX-A" }] },
    designType: "bundle_render",
    customerText: "想看礼盒效果图",
    assets: [{ assetId: "logo-1" }],
  });

  assert.equal(result.ok, true);
});

test("routes generated jobs according to high value and manual qc", () => {
  assert.equal(
    nextStatusAfterDesignCompleted({ isHighValue: true, manualQcRequired: true }),
    DESIGN_STATUSES.MANUAL_REVIEW,
  );
  assert.equal(
    nextStatusAfterDesignCompleted({ isHighValue: false, manualQcRequired: true }),
    DESIGN_STATUSES.QUICK_CONFIRM,
  );
  assert.equal(
    nextStatusAfterDesignCompleted({
      isHighValue: false,
      budget: { totalAmount: 15000, perUnitAmount: 300 },
      manualQcRequired: true,
    }),
    DESIGN_STATUSES.MANUAL_REVIEW,
  );
});

test("matches customer text selection", () => {
  const result = matchTextSelection("我选第3张，文字改一下", [
    { imageId: "img-1" },
    { imageId: "img-2" },
    { imageId: "img-3" },
  ]);
  assert.equal(result.matched, true);
  assert.equal(result.imageId, "img-3");

  const fallback = matchTextSelection("pick 2", [
    { imageId: "img-1" },
    { imageId: "img-2" },
  ]);
  assert.equal(fallback.matched, true);
  assert.equal(fallback.imageId, "img-2");
});

test("matches customer referenced image selection", () => {
  const result = matchCustomerSelection({
    referencedImageId: "candidate-2",
    candidates: [
      { id: "candidate-1", imageId: "img-1" },
      { id: "candidate-2", imageId: "img-2" },
    ],
  });

  assert.equal(result.matched, true);
  assert.equal(result.source, "reference");
  assert.equal(result.imageId, "img-2");
});

test("does not match referenced image outside current conversation candidates", () => {
  const result = planCustomerImageSelection({
    referencedImageId: "other-conversation-candidate",
    candidates: [
      { id: "candidate-1", imageId: "img-1" },
      { id: "candidate-2", imageId: "img-2" },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.action, "manual_selection_review");
  assert.equal(result.reviewRequired, true);
  assert.equal(result.result.matched, false);
  assert.equal(result.result.source, "reference");
});

test("plans inbound image selection only for explicit selection intent", () => {
  const candidates = [
    { id: "candidate-1", imageId: "img-1" },
    { id: "candidate-2", imageId: "img-2" },
  ];
  const selected = planCustomerImageSelection({
    text: "我选第2张，就按这个报价",
    candidates,
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.action, "select_design_image");
  assert.equal(selected.result.imageId, "img-2");

  const budgetText = planCustomerImageSelection({
    text: "100元一盒，做50份",
    candidates,
  });
  assert.equal(budgetText.action, "skip");
  assert.equal(budgetText.reason, "no_selection_intent");

  const missingCandidates = planCustomerImageSelection({
    text: "选第1张",
    candidates: [],
  });
  assert.equal(missingCandidates.action, "manual_selection_review");
  assert.equal(missingCandidates.reviewRequired, true);
});

test("text image selection uses the latest revision round by default", () => {
  const candidates = [
    { id: "initial-1", imageId: "candidate_1", position: 1 },
    { id: "initial-2", imageId: "candidate_2", position: 2 },
    { id: "revision-1", imageId: "r1-candidate_1", position: 101 },
    { id: "revision-2", imageId: "r1-candidate_2", position: 102 },
  ];

  const selected = planCustomerImageSelection({
    text: "就第1张，按这个报价",
    candidates,
  });

  assert.equal(selected.ok, true);
  assert.equal(selected.result.imageId, "r1-candidate_1");
  assert.equal(selected.result.candidate.id, "revision-1");

  const referencedOldImage = planCustomerImageSelection({
    referencedImageId: "initial-2",
    candidates,
  });
  assert.equal(referencedOldImage.ok, true);
  assert.equal(referencedOldImage.result.candidate.id, "initial-2");
});

test("recognizes common numbered customer image choices without treating bare numbers as selection", () => {
  const candidates = [
    { id: "candidate-1", imageId: "img-1" },
    { id: "candidate-2", imageId: "img-2" },
    { id: "candidate-3", imageId: "img-3" },
  ];
  for (const text of ["NO.2", "no.2", "#2", "2号", "二号", "二款", "二版", "第2套", "第二套", "方案2", "编号2", "效果图2"]) {
    const selected = planCustomerImageSelection({ text, candidates });
    assert.equal(selected.ok, true, text);
    assert.equal(selected.action, "select_design_image", text);
    assert.equal(selected.result.imageId, "img-2", text);
  }

  const bareNumber = planCustomerImageSelection({ text: "2", candidates });
  assert.equal(bareNumber.ok, false);
  assert.equal(bareNumber.action, "skip");
  assert.equal(bareNumber.reason, "no_selection_intent");
  const bareChineseNumber = planCustomerImageSelection({ text: "二", candidates });
  assert.equal(bareChineseNumber.ok, false);
  assert.equal(bareChineseNumber.action, "skip");
  assert.equal(bareChineseNumber.reason, "no_selection_intent");
});

test("recognizes lettered customer image choices without treating bare letters as selection", () => {
  const candidates = [
    { id: "candidate-1", imageId: "img-1" },
    { id: "candidate-2", imageId: "img-2" },
    { id: "candidate-3", imageId: "img-3" },
  ];
  for (const text of ["B款", "b款", "方案B", "选B", "B版", "第B套"]) {
    const selected = planCustomerImageSelection({ text, candidates });
    assert.equal(selected.ok, true, text);
    assert.equal(selected.action, "select_design_image", text);
    assert.equal(selected.result.imageId, "img-2", text);
  }

  const bareLetter = planCustomerImageSelection({ text: "C", candidates });
  assert.equal(bareLetter.ok, false);
  assert.equal(bareLetter.action, "skip");
  assert.equal(bareLetter.reason, "no_selection_intent");
});

test("matches screenshot fingerprint and flags uncertain screenshots", () => {
  const candidates = [
    { id: "candidate-1", imageId: "img-1", fingerprint: "aaaaaaaaaaaaaaaa" },
    { id: "candidate-2", imageId: "img-2", fingerprint: "bbbbbbbbbbbbbbbb" },
  ];
  const matched = matchImageFingerprint("bbbbbbbbbbbbbbbb", candidates);
  assert.equal(matched.matched, true);
  assert.equal(matched.imageId, "img-2");

  const uncertain = matchCustomerSelection({
    screenshotFingerprint: "bbbbcccccccccccc",
    candidates,
  });
  assert.equal(uncertain.matched, false);
  assert.equal(uncertain.source, "fingerprint");
  assert.equal(uncertain.reason, "截图相似度不足，需要人工确认");

  const nearMatchPlan = planCustomerImageSelection({
    screenshotFingerprint: "bbbbbbbbbbbbbbb0",
    candidates,
  });
  assert.equal(nearMatchPlan.ok, false);
  assert.equal(nearMatchPlan.action, "manual_selection_review");
  assert.equal(nearMatchPlan.reviewRequired, true);
});

test("builds warm waiting message", () => {
  const text = buildWaitingMessage({ customerName: "王总", scene: "员工福利", outputCount: 6 });
  assert.match(text, /王总/);
  assert.match(text, /6张/);
});

test("detects design job timeout after configured minutes", () => {
  const now = new Date("2026-06-25T10:30:00.000Z");
  assert.equal(shouldTimeout("2026-06-25T10:09:59.000Z", now, 20), true);
  assert.equal(shouldTimeout("2026-06-25T10:10:01.000Z", now, 20), false);
  assert.equal(shouldTimeout("not-a-date", now, 20), false);
});

test("inspects real image references for assets and bundle items", () => {
  const assets = inspectAssetReferences([
    { id: "asset-1", url: "https://example.test/logo.png" },
    { id: "asset-loopback", url: "http://127.0.0.1:3000/local-assets/logo.png" },
    { id: "asset-localhost", url: "http://localhost:3000/generated/logo.png" },
    { id: "asset-remote-http", url: "http://example.test/local-assets/logo.png" },
    { id: "asset-2" },
  ]);
  assert.equal(assets[0].ok, true);
  assert.equal(assets[1].ok, true);
  assert.equal(assets[2].ok, true);
  assert.equal(assets[3].reason, "unsupported_image_reference");
  assert.equal(assets[4].reason, "missing_asset_image_reference");

  const bundle = inspectBundleReferences({
    giftBox: { skuCode: "BOX-A", mainImageUrl: "http://127.0.0.1:3000/local-assets/box.png" },
    items: [
      { skuCode: "TEA-A", images: [{ url: "https://example.test/tea.png" }] },
      { skuCode: "CARD-LOCAL", images: [{ url: "http://localhost:3000/generated/card.png" }] },
      { skuCode: "CARD-A" },
    ],
  });
  assert.equal(bundle.filter((item) => item.ok).length, 3);
  assert.equal(bundle.find((item) => item.skuCode === "BOX-A").role, "gift_box");
  assert.equal(bundle.find((item) => item.skuCode === "CARD-A").reason, "missing_sku_image_reference");
});

test("requires usable customer assets and complete bundle images for real design", () => {
  const result = inspectRealDesignReferences({
    assets: [{ id: "asset-1", url: "https://example.test/logo.png" }],
    bundle: {
      items: [
        { skuCode: "BOX-A", imageUrl: "https://example.test/box.png" },
        { skuCode: "TEA-A" },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.usableAssetCount, 1);
  assert.equal(result.usableBundleImageCount, 1);
  assert.equal(result.missing.includes("complete_sku_images"), true);
});

test("decides revision policy by customer value and free revision limit", () => {
  const firstLowValue = decideRevisionPolicy({
    instruction: "把背景换成浅色，Logo 放大一点",
    revisionCount: 0,
    isHighValue: false,
  });
  assert.equal(firstLowValue.action, "auto_revision");
  assert.equal(firstLowValue.submitAllowed, true);
  assert.equal(firstLowValue.revisionNumber, 1);

  const overLimit = decideRevisionPolicy({
    instruction: "再换一个摆放角度",
    revisionCount: 2,
    isHighValue: false,
  });
  assert.equal(overLimit.action, "charge_or_manual_review");
  assert.equal(overLimit.submitAllowed, false);
  assert.equal(overLimit.chargeRequired, true);
  assert.equal(overLimit.manualReviewRequired, true);

  const highValue = decideRevisionPolicy({
    instruction: "整体更商务一点",
    revisionCount: 0,
    isHighValue: true,
  });
  assert.equal(highValue.action, "manual_review");
  assert.equal(highValue.submitAllowed, false);
  assert.equal(highValue.manualReviewRequired, true);

  const staleHighValueBudget = decideRevisionPolicy({
    instruction: "整体再稳重一点，适合大客户送礼",
    revisionCount: 0,
    isHighValue: false,
    budget: { totalAmount: 15000, perUnitAmount: 300 },
  });
  assert.equal(staleHighValueBudget.action, "manual_review");
  assert.equal(staleHighValueBudget.submitAllowed, false);
  assert.equal(staleHighValueBudget.manualReviewRequired, true);

  const missingInstruction = decideRevisionPolicy({ instruction: "  " });
  assert.equal(missingInstruction.ok, false);
  assert.equal(missingInstruction.action, "collect_info");
});
