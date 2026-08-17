"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { planZhenxiCustomerRequest } = require("../packages/rules");

test("asks only for the missing information required by the requested creative item", () => {
  const plan = planZhenxiCustomerRequest({
    text: "给我做一张贺卡，不要吊牌，也不要腰封",
    requestContextId: "msg-card-1",
  });

  assert.equal(plan.kind, "clarify");
  assert.deepEqual(plan.requestedDeliverables, ["greeting_card"]);
  assert.deepEqual(new Set(plan.missingFields), new Set(["copy_text", "logo_decision", "finished_size"]));
  assert.match(plan.replyText, /文案/);
  assert.match(plan.replyText, /Logo/);
  assert.match(plan.replyText, /成品尺寸/);
  assert.doesNotMatch(plan.replyText, /吊牌|腰封/);
});

test("continues a pending creative conversation and preserves exact customer copy", () => {
  const pending = planZhenxiCustomerRequest({
    text: "给我做一张教师节贺卡",
    requestContextId: "msg-card-2",
  });
  const ready = planZhenxiCustomerRequest({
    text: "文案写“老师，节日快乐”，不放logo，尺寸90x54mm",
    previousPlan: pending,
    requestContextId: "msg-card-3",
  });

  assert.equal(ready.kind, "image");
  assert.deepEqual(ready.missingFields, []);
  assert.equal(ready.copyText, "老师，节日快乐");
  assert.equal(ready.logoMode, "none");
  assert.equal(ready.physicalSize, "90×54mm");
  assert.equal(ready.ratio, "5:3");
  assert.equal(ready.designRequests.length, 1);
  assert.equal(ready.designRequests[0].deliverable, "greeting_card");
  assert.equal(ready.designRequests[0].outputCount, 4);
  assert.equal(ready.designRequests[0].copyText, "老师，节日快乐");
  assert.deepEqual(ready.designRequests[0].assetIds, []);

  const spacedReply = planZhenxiCustomerRequest({
    text: "文案写“老师，节日快乐”  不放logo，尺寸90x54mm",
    previousPlan: pending,
    requestContextId: "msg-card-4",
  });
  assert.equal(spacedReply.kind, "image");
});

test("creates only the requested multiple deliverables and reuses the supplied logo", () => {
  const plan = planZhenxiCustomerRequest({
    text: "请做贺卡和吊牌，文案是“感谢一路相伴”，尺寸90x54mm",
    requestContextId: "msg-multi-1",
    assetIds: ["asset-logo-1"],
    availableAssets: [{ id: "asset-logo-1", role: "customer_logo" }],
  });

  assert.equal(plan.kind, "multi");
  assert.deepEqual(plan.requestedDeliverables, ["greeting_card", "hang_tag"]);
  assert.equal(plan.logoMode, "provided");
  assert.equal(plan.designRequests.length, 2);
  assert.deepEqual(plan.designRequests.map((item) => item.deliverable), ["greeting_card", "hang_tag"]);
  assert.ok(plan.designRequests.every((item) => item.outputCount === 4));
  assert.ok(plan.designRequests.every((item) => item.assetIds[0] === "asset-logo-1"));
  assert.ok(plan.designRequests.every((item) => !/腰封/.test(item.prompt)));
});

test("routes a bundle-effect request through the catalog before Zhenxi rendering", () => {
  const pending = planZhenxiCustomerRequest({
    text: "给我搭一套商务伴手礼并出搭品效果图",
    requestContextId: "msg-bundle-1",
  });
  assert.equal(pending.kind, "clarify");
  assert.deepEqual(pending.missingFields, ["bundle_selection"]);
  assert.equal(pending.toolIntents.catalog, true);

  const ready = planZhenxiCustomerRequest({
    text: "给我搭一套商务伴手礼并出搭品效果图",
    requestContextId: "msg-bundle-2",
    bundleRecommendation: {
      items: [{ skuCode: "TEA-01", imageUrl: "https://assets.example.test/tea.png" }],
    },
  });
  assert.equal(ready.kind, "bundle");
  assert.equal(ready.designRequests[0].deliverable, "bundle_effect");
  assert.equal(ready.designRequests[0].outputCount, 4);
});

test("turns a copy-only hotel opening poster into a grounded production specification", () => {
  const plan = planZhenxiCustomerRequest({
    text: "请做酒店开业伴手礼活动海报效果图，暖咖色简约风，画面只包含文案“开业有礼”，尺寸1024x1024",
    requestContextId: "msg-poster-copy-only-1",
  });

  assert.equal(plan.kind, "image");
  assert.deepEqual(plan.requestedDeliverables, ["poster"]);
  assert.equal(plan.copyText, "开业有礼");
  assert.equal(plan.logoMode, "none");
  assert.equal(plan.visualContentMode, "graphic_only");
  assert.equal(plan.exactCopyOnly, true);
  assert.equal(plan.designRequests[0].forbidInventedProducts, true);
  assert.equal(plan.designRequests[0].referenceRequired, false);
  assert.match(plan.designRequests[0].prompt, /不得添加副标题/);
  assert.match(plan.designRequests[0].prompt, /不展示或虚构任何商品/);
});

test("asks one grounded question before charging for an ambiguous product-context poster", () => {
  const plan = planZhenxiCustomerRequest({
    text: "做一张酒店开业伴手礼活动海报，文案“开业有礼”，不放Logo，尺寸1024x1024",
    requestContextId: "msg-poster-ambiguous-1",
  });

  assert.equal(plan.kind, "clarify");
  assert.deepEqual(plan.requestedDeliverables, ["poster"]);
  assert.deepEqual(plan.missingFields, ["visual_content_mode"]);
  assert.match(plan.replyText, /纯文字氛围/);
  assert.match(plan.replyText, /展示实际商品/);
});

test("requires real product sources before a product poster can enter paid generation", () => {
  const pending = planZhenxiCustomerRequest({
    text: "做一张酒店开业伴手礼活动海报，要展示实际伴手礼商品，文案“开业有礼”，不放Logo，尺寸1024x1024",
    requestContextId: "msg-poster-product-1",
  });
  assert.equal(pending.kind, "clarify");
  assert.deepEqual(pending.missingFields, ["product_assets_or_selection"]);

  const ready = planZhenxiCustomerRequest({
    text: "做一张酒店开业伴手礼活动海报，要展示实际伴手礼商品，文案“开业有礼”，不放Logo，尺寸1024x1024",
    requestContextId: "msg-poster-product-2",
    bundleRecommendation: {
      items: [{ skuCode: "GIFT-01", imageUrl: "https://assets.example.test/gift-01.png" }],
    },
  });
  assert.equal(ready.kind, "image");
  assert.equal(ready.visualContentMode, "real_product");
  assert.equal(ready.toolIntents.catalog, true);
  assert.equal(ready.designRequests[0].referenceRequired, true);
  assert.equal(ready.designRequests[0].forbidInventedProducts, false);
});

test("does not reopen a creative plan that already has a durable design job", () => {
  const pending = planZhenxiCustomerRequest({
    text: "帮我做贺卡",
    requestContextId: "msg-once-1",
  });
  const result = planZhenxiCustomerRequest({
    text: "好的",
    previousPlan: pending,
    existingJobs: [{ requirements: { customerAgent: { planId: pending.planId } } }],
  });
  assert.equal(result, null);
});

test("stops unquoted creative copy before following logo and size instructions", () => {
  const plan = planZhenxiCustomerRequest({
    text: "这是内部链路测试。只需要做贺卡，不要搭品图，不要吊牌，不要腰封。贺卡文案：感谢一路相伴。不要Logo，成品尺寸90×54mm。",
    requestContextId: "msg-copy-boundary-1",
  });

  assert.equal(plan.kind, "image");
  assert.deepEqual(plan.requestedDeliverables, ["greeting_card"]);
  assert.equal(plan.copyText, "感谢一路相伴");
  assert.equal(plan.logoMode, "none");
  assert.equal(plan.physicalSize, "90×54mm");
  assert.equal(plan.designRequests[0].copyText, "感谢一路相伴");
  assert.doesNotMatch(plan.designRequests[0].prompt, /客户文案：感谢一路相伴。不要/);
});

test("does not treat a negated image phrase as a paid generation request", () => {
  const cases = [
    "酒店开业伴手礼要100份，单份预算20元左右，有哪些可以做？只回复文字建议，不要出图。",
    "先聊方案，不出图",
    "不用效果图，只要文字推荐",
    "无需生成图片，给我说说有哪些合适的",
    "别做设计图，先报可选产品",
  ];

  for (const text of cases) {
    const plan = planZhenxiCustomerRequest({ text });
    assert.equal(plan.kind, "cancel", text);
    assert.equal(plan.reason, "explicit_image_generation_declined", text);
  }
});

test("keeps copy-only work while suppressing explicitly declined images", () => {
  const plan = planZhenxiCustomerRequest({ text: "不要出图，帮我写一份教师节海报文案" });
  assert.equal(plan.kind, "copy");
  assert.equal(plan.outputCount, 1);
});

test("still accepts a later explicit positive image request after a local negation", () => {
  const plan = planZhenxiCustomerRequest({
    text: "不要旧的效果图，请重新做一张教师节海报图，画面只包含文案“老师辛苦了”，不放Logo，尺寸1080x1440",
  });
  assert.equal(plan.kind, "image");
  assert.equal(plan.designRequests[0].outputCount, 4);
});

test("an explicit customer request to generate images starts a new image lifecycle after a prior refusal", () => {
  const cancelled = planZhenxiCustomerRequest({
    text: "先不要出图，只回复文字",
    requestContextId: "msg-image-declined-1",
  });
  const requested = planZhenxiCustomerRequest({
    text: "现在要出图，按刚才的酒店开业伴手礼方案做效果图",
    previousPlan: cancelled,
    requestContextId: "msg-image-requested-2",
  });

  assert.equal(cancelled.kind, "cancel");
  assert.equal(requested.kind, "image");
  assert.equal(requested.outputCount, 4);
});

test("an explicit no-image reply terminates a pending creative plan", () => {
  const pending = planZhenxiCustomerRequest({
    text: "给我做一张教师节贺卡",
    requestContextId: "msg-card-cancel-1",
  });
  const cancelled = planZhenxiCustomerRequest({
    text: "先不要出图了，只回复文字建议",
    previousPlan: pending,
    requestContextId: "msg-card-cancel-2",
  });

  assert.equal(cancelled.kind, "cancel");
  assert.equal(cancelled.reason, "explicit_image_generation_declined");
  assert.equal(cancelled.planId, pending.planId);
  assert.deepEqual(cancelled.missingFields, []);

  const textOnlyCancellation = planZhenxiCustomerRequest({
    text: "只回复文字",
    previousPlan: pending,
    requestContextId: "msg-card-cancel-3",
  });
  assert.equal(textOnlyCancellation.kind, "cancel");
  assert.equal(textOnlyCancellation.planId, pending.planId);
});
