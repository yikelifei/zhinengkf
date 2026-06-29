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
    { id: "asset-2" },
  ]);
  assert.equal(assets[0].ok, true);
  assert.equal(assets[1].reason, "missing_asset_image_reference");

  const bundle = inspectBundleReferences({
    giftBox: { skuCode: "BOX-A", mainImageUrl: "https://example.test/box.png" },
    items: [
      { skuCode: "TEA-A", images: [{ url: "https://example.test/tea.png" }] },
      { skuCode: "CARD-A" },
    ],
  });
  assert.equal(bundle.filter((item) => item.ok).length, 2);
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

  const missingInstruction = decideRevisionPolicy({ instruction: "  " });
  assert.equal(missingInstruction.ok, false);
  assert.equal(missingInstruction.action, "collect_info");
});
