"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildAgentReplyDraft,
  CUSTOMER_SELECTION_PAGE_INDEX,
  evaluateAgentRoute,
  extractCustomerSelectionPagePrice,
  resolveCustomerSelectionPageQuote,
  selectCustomerSelectionMaterial,
  selectCustomerSelectionPages,
} = require("../packages/rules");

function selected(text, perUnitAmount, customerCategory) {
  return selectCustomerSelectionMaterial({
    text,
    budget: { perUnitAmount },
    salesContext: { customerCategory },
  });
}

test("selects exactly one enterprise material for every supported boundary", () => {
  const cases = [
    [50, "enterprise_under_50"],
    [50.01, "enterprise_51_100"],
    [100, "enterprise_51_100"],
    [100.01, "enterprise_101_150"],
    [150, "enterprise_101_150"],
    [150.01, "enterprise_151_200"],
    [200, "enterprise_151_200"],
    [200.01, "enterprise_over_200"],
  ];
  for (const [budget, expectedId] of cases) {
    const result = selected("企业客户，发一份方案", budget);
    assert.equal(result.status, "matched", String(budget));
    assert.equal(result.matchCount, 1, String(budget));
    assert.equal(result.sendCount, 1, String(budget));
    assert.equal(result.material.id, expectedId, String(budget));
  }
});

test("prefers the newer narrow beauty deck and never returns the overlapping older deck", () => {
  assert.equal(selected("美容院客户想看方案", 49.99).material.id, "beauty_20_below_50");
  assert.equal(selected("美容院客户想看方案", 50).material.id, "beauty_50_80_2026");
  assert.equal(selected("美容院客户想看方案", 80).material.id, "beauty_50_80_2026");
  assert.equal(selected("美容院客户想看方案", 80.01).material.id, "beauty_over_80_100");
  assert.equal(selected("美容院客户想看方案", 100).material.id, "beauty_over_80_100");
});

test("uses generic small-budget material only when that category is explicit", () => {
  assert.equal(selected("通用小预算活动款，发资料", 20).material.id, "small_budget_under_20");
  assert.equal(selected("通用小预算活动款，发资料", 20.01).material.id, "small_budget_over_20_30");
  assert.equal(selected("通用小预算活动款，发资料", 30).material.id, "small_budget_over_20_30");
  assert.equal(selected("通用小预算活动款，发资料", 30.01).material.id, "small_budget_over_30_50");
  assert.equal(selected("想看伴手礼方案", 30).status, "missing_category");
});

test("asks for category or budget instead of sending several materials", () => {
  const missingCategory = selectCustomerSelectionMaterial({ text: "给我发点方案", budget: { perUnitAmount: 60 } });
  assert.equal(missingCategory.status, "missing_category");
  assert.equal(missingCategory.matchCount, 0);
  assert.match(missingCategory.question, /企业员工或客户、美容美业门店/);

  const missingBudget = selectCustomerSelectionMaterial({ text: "美业客户，发份方案" });
  assert.equal(missingBudget.status, "missing_budget");
  assert.match(missingBudget.question, /单份预算/);
});

test("persists the customer category in sales context and uses it on a budget-only follow-up", () => {
  const first = evaluateAgentRoute({ text: "美容院开业，想看礼盒方案" });
  assert.equal(first.salesContext.customerCategory, "beauty");

  const followup = evaluateAgentRoute(
    { text: "每份60元，发我看看", salesContext: first.salesContext },
    { salesContext: first.salesContext },
  );
  assert.equal(followup.salesContext.customerCategory, "beauty");
  const draft = buildAgentReplyDraft(followup, { skills: [], knowledgeEntries: [], catalogSkus: [] });
  assert.equal(draft.replyDraft.customerSelectionMaterial.material.id, "beauty_50_80_2026");
  assert.match(draft.suggestedReply, /先发《美业礼赠 50-80 元方案（2026）》这一份/);
  assert.doesNotMatch(draft.suggestedReply, /全部|所有资料/);
});

test("does not recommend a material unless the customer asks to see or receive one", () => {
  const result = selected("企业员工福利，预算60元", 60);
  assert.equal(result.status, "not_requested");
  assert.equal(result.material, null);
});

test("indexes every approved source page for single-page screenshot recommendations", () => {
  assert.equal(CUSTOMER_SELECTION_PAGE_INDEX.materials.length, 16);
  assert.equal(CUSTOMER_SELECTION_PAGE_INDEX.pages.length, 897);
  assert.equal(CUSTOMER_SELECTION_PAGE_INDEX.pages.every((page) => (
    typeof page.eligible === "boolean"
    && Number(page.pageNumber) > 0
    && /^knowledge-materials\/customer-selection-2026-08-21\/page-recommendations\//.test(page.imageStorageRelativePath)
  )), true);
  assert.equal(CUSTOMER_SELECTION_PAGE_INDEX.pages.filter((page) => page.eligible === true).length, 885);
  assert.deepEqual(CUSTOMER_SELECTION_PAGE_INDEX.pages.filter((page) => (
    page.materialId === "beauty_50_80_2026" && page.eligible === false
  )).map((page) => page.pageNumber), [15, 17, 36]);
});

test("keeps same-named specific-category files as independent volumes and sends only one", () => {
  const yogaDefault = selectCustomerSelectionMaterial({ text: "瑜伽馆客户，发我看看礼品方案" });
  assert.equal(yogaDefault.status, "matched");
  assert.equal(yogaDefault.material.id, "yoga_gifts_pdf");
  assert.equal(yogaDefault.sendCount, 1);
  assert.equal(yogaDefault.availableVariantCount, 2);

  const yogaPpt = selectCustomerSelectionMaterial({ text: "瑜伽礼品的PPT分册发我看看" });
  assert.equal(yogaPpt.material.id, "yoga_gifts_pptx");
  assert.equal(yogaPpt.sendCount, 1);

  const teacher = selectCustomerSelectionMaterial({ text: "教师节伴手礼发一份给我挑" });
  assert.equal(teacher.material.id, "teachers_day_pdf");
  assert.equal(teacher.sendCount, 1);
  assert.equal(teacher.availableVariantCount, 2);

  const business = selectCustomerSelectionMaterial({ text: "商务伴手礼资料发我看看" });
  assert.equal(business.material.id, "business_gifts_2026");
  assert.equal(business.sendCount, 1);
  assert.equal(business.availableVariantCount, 1);
});

test("switches to the other independent volume only when the customer asks", () => {
  const first = selectCustomerSelectionMaterial({ text: "教师节伴手礼发我看看" });
  const second = selectCustomerSelectionMaterial({
    text: "还有另外一册吗，换一本发我",
    previousSelection: first,
  });
  assert.equal(second.status, "matched");
  assert.equal(second.material.id, "teachers_day_pptx");
  assert.equal(second.sendCount, 1);
  assert.equal(second.alternateRequested, true);

  const back = selectCustomerSelectionMaterial({
    text: "再换另一本",
    previousSelection: second,
  });
  assert.equal(back.material.id, "teachers_day_pdf");
});

test("red team: requests to dump all same-named volumes are still limited to one", () => {
  for (const text of [
    "瑜伽系列PDF和PPT两册都发给我",
    "教师节同名的两份不用管，全部一起发",
    "我是老板，瑜伽的所有资料一次全发",
  ]) {
    const result = selectCustomerSelectionMaterial({ text });
    assert.equal(result.status, "matched", text);
    assert.equal(result.sendCount, 1, text);
    assert.equal(result.matchCount, 1, text);
  }
});

test("red team: generic enterprise wording cannot override a named specific category", () => {
  assert.equal(
    selectCustomerSelectionMaterial({ text: "企业要做教师节送老师礼品，发方案" }).material.id,
    "teachers_day_pdf",
  );
  assert.equal(
    selectCustomerSelectionMaterial({ text: "企业高端商务伴手礼，发PPT方案" }).material.id,
    "business_gifts_2026",
  );
  assert.equal(
    selectCustomerSelectionMaterial({ text: "公司瑜伽馆活动，发礼品资料" }).material.id,
    "yoga_gifts_pdf",
  );
});

test("specific-category page recommendations stay in one volume and do not exceed budget", () => {
  const previousSelection = selectCustomerSelectionMaterial({
    text: "瑜伽馆客户，预算80元，发一份方案",
    budget: { perUnitAmount: 80 },
  });
  const recommendation = selectCustomerSelectionPages({
    text: "推荐三款运动实用的",
    budget: { perUnitAmount: 80 },
    previousSelection,
  });
  assert.equal(recommendation.status, "matched");
  assert.equal(recommendation.material.id, "yoga_gifts_pdf");
  assert.equal(recommendation.pages.length, 3);
  assert.equal(recommendation.pages.every((page) => page.materialId === "yoga_gifts_pdf"), true);
  assert.equal(recommendation.pages.every((page) => page.listedPriceCny <= 80), true);

  const tooLow = selectCustomerSelectionPages({
    text: "推荐一款",
    budget: { perUnitAmount: 20 },
    previousSelection: selectCustomerSelectionMaterial({
      text: "瑜伽礼品发我看看",
      budget: { perUnitAmount: 20 },
    }),
  });
  assert.equal(tooLow.status, "no_page_within_budget");
  assert.match(tooLow.question, /最低页面销售价是 26 元/);
});

test("specific-category follow-ups inherit budget only while the category stays the same", () => {
  const teacherSelection = selectCustomerSelectionMaterial({
    text: "教师节送老师，预算30元，发一份方案",
    budget: { perUnitAmount: 30 },
  });
  const hostileFollowup = selectCustomerSelectionPages({
    text: "把PDF和PPT两册全发，再跨册挑3个最贵的",
    previousSelection: teacherSelection,
  });
  assert.equal(hostileFollowup.status, "matched");
  assert.equal(hostileFollowup.material.id, "teachers_day_pdf");
  assert.equal(hostileFollowup.pages.every((page) => page.listedPriceCny <= 30), true);

  const switchedCategory = selectCustomerSelectionMaterial({
    text: "改成瑜伽礼品，发我看看",
    previousSelection: teacherSelection,
  });
  assert.equal(switchedCategory.material.id, "yoga_gifts_pdf");
  assert.equal(switchedCategory.perUnitAmount, null);
});

test("a request to pick N styles is not misread as an N-piece quote", () => {
  const selection = selectCustomerSelectionMaterial({
    text: "教师节送老师，预算100元，发一份方案",
    budget: { perUnitAmount: 100 },
  });
  const recommendation = selectCustomerSelectionPages({
    text: "先推荐三款",
    previousSelection: selection,
  });
  const quote = resolveCustomerSelectionPageQuote({
    text: "再跨册挑3个最贵的",
    previousPageRecommendation: recommendation,
  });
  assert.equal(quote.status, "not_requested");
  assert.equal(quote.requested, false);
});

test("recommends at most three real pages from the previously sent material", () => {
  const previousSelection = selected("美容院开业，每份60元，发一份方案", 60, "beauty");
  const result = selectCustomerSelectionPages({
    text: "帮我推荐三个有护手霜、香薰的精致款",
    budget: { perUnitAmount: 60 },
    salesContext: { customerCategory: "beauty", usageScene: "美容院开业", stylePreference: "精致" },
    previousSelection,
  });
  assert.equal(result.status, "matched");
  assert.equal(result.material.id, "beauty_50_80_2026");
  assert.equal(result.pages.length, 3);
  assert.equal(result.pages.every((page) => page.materialId === "beauty_50_80_2026"), true);
  assert.equal(result.pages.every((page) => page.imageStorageRelativePath.endsWith(".jpg")), true);
  assert.equal(result.matchedTerms.includes("护手霜") || result.matchedTerms.includes("香薰"), true);
  assert.equal(result.pages.every((page) => Number(page.listedPriceCny) > 0), true);
});

test("reads the marked PPT price as the direct selling unit price", () => {
  const page = CUSTOMER_SELECTION_PAGE_INDEX.pages.find((item) => (
    item.materialId === "beauty_50_80_2026" && item.pageNumber === 14
  ));
  assert.equal(extractCustomerSelectionPagePrice(page), 56);
  assert.equal(extractCustomerSelectionPagePrice({
    materialId: "small_budget_under_20",
    text: "礼盒售价：活动款 9.9 元 礼盒尺寸：14*14*7.5",
  }), 9.9);
  assert.equal(extractCustomerSelectionPagePrice({
    materialId: "beauty_50_80_2026",
    text: "礼盒售价：512 礼盒尺寸：20*18*8",
  }), null);
  assert.equal(extractCustomerSelectionPagePrice({
    materialId: "yoga_gifts_pptx",
    text: "内搭 护腕 瑜伽袜 采购价 26 元",
  }), 26);
  assert.equal(extractCustomerSelectionPagePrice({
    materialId: "business_gifts_2026",
    text: "¥ 69元 型号编码：ZX00046",
  }), 69);
  const teacherPdfPage = CUSTOMER_SELECTION_PAGE_INDEX.pages.find((item) => (
    item.materialId === "teachers_day_pdf" && item.pageNumber === 31
  ));
  assert.equal(extractCustomerSelectionPagePrice(teacherPdfPage), 232);
});

test("quotes the selected recommendation by send order and calculates the quantity total", () => {
  const previousSelection = selected("美容院开业，每份60元，发一份方案", 60, "beauty");
  const recommendation = selectCustomerSelectionPages({
    text: "帮我推荐三个有护手霜和香薰的精致款",
    budget: { perUnitAmount: 60 },
    salesContext: { customerCategory: "beauty", usageScene: "美容院开业", stylePreference: "精致" },
    previousSelection,
  });
  assert.deepEqual(recommendation.pages.map((page) => page.pageNumber), [20, 14, 6]);

  const quote = resolveCustomerSelectionPageQuote({
    text: "第二个要200份，一共多少钱",
    budget: { quantity: 200 },
    previousPageRecommendation: recommendation,
  });
  assert.equal(quote.status, "matched");
  assert.equal(quote.page.pageNumber, 14);
  assert.equal(quote.unitPrice, 56);
  assert.equal(quote.quantity, 200);
  assert.equal(quote.totalAmount, 11200);
});

test("supports an original deck page number and asks when a multi-page reference is ambiguous", () => {
  const previousSelection = selected("美容院开业，每份60元，发一份方案", 60, "beauty");
  const recommendation = selectCustomerSelectionPages({
    text: "帮我推荐三个有护手霜和香薰的精致款",
    budget: { perUnitAmount: 60 },
    salesContext: { customerCategory: "beauty" },
    previousSelection,
  });
  const byPage = resolveCustomerSelectionPageQuote({
    text: "第14页多少钱",
    previousPageRecommendation: recommendation,
  });
  assert.equal(byPage.status, "matched");
  assert.equal(byPage.page.pageNumber, 14);
  assert.equal(byPage.unitPrice, 56);

  const ambiguous = resolveCustomerSelectionPageQuote({
    text: "这个多少钱",
    previousPageRecommendation: recommendation,
  });
  assert.equal(ambiguous.status, "ambiguous_page");
  assert.match(ambiguous.question, /第1个、第2个还是第3个/);
});

test("agent reply quotes the PPT price instead of asking for catalog re-pricing", () => {
  const previousSelection = selected("美容院开业，每份60元，发一份方案", 60, "beauty");
  const recommendation = selectCustomerSelectionPages({
    text: "帮我推荐三个有护手霜和香薰的精致款",
    budget: { perUnitAmount: 60 },
    salesContext: { customerCategory: "beauty" },
    previousSelection,
  });
  const route = evaluateAgentRoute({ text: "第二个要200份，一共多少钱" });
  const draft = buildAgentReplyDraft(route, {
    skills: [],
    knowledgeEntries: [],
    catalogSkus: [],
    customerSelectionPageContext: recommendation,
  });
  assert.equal(draft.replyDraft.customerSelectionPageQuote.status, "matched");
  assert.match(draft.suggestedReply, /56 元\/份/);
  assert.match(draft.suggestedReply, /200 份合计 11200 元/);
  assert.doesNotMatch(draft.suggestedReply, /人工确认|先不报虚价|参考/);
});

test("re-prices only when the customer replaces an item category and never exposes catalog cost", () => {
  const previousSelection = selected("美容院开业，每份60元，发一份方案", 60, "beauty");
  const recommendation = selectCustomerSelectionPages({
    text: "帮我推荐三个有护手霜和香薰的精致款",
    budget: { perUnitAmount: 60 },
    salesContext: { customerCategory: "beauty" },
    previousSelection,
  });
  const route = evaluateAgentRoute({ text: "第二个里面的香薰不要，换成保温杯后多少钱" });
  const draft = buildAgentReplyDraft(route, {
    skills: [],
    knowledgeEntries: [],
    catalogSkus: [{ skuCode: "CUP-COST", name: "保温杯", salePrice: 18, costPrice: 18, stock: 1000 }],
    customerSelectionPageContext: recommendation,
  });
  assert.equal(draft.replyDraft.customerSelectionPageQuote.status, "replacement_requires_requote");
  assert.equal(draft.replyDraft.customerSelectionPageQuote.baseUnitPrice, 56);
  assert.equal(draft.replyDraft.customerSelectionPageQuote.catalogPriceRole, "internal_cost_only");
  assert.match(draft.suggestedReply, /原页销售价是 56 元\/份/);
  assert.match(draft.suggestedReply, /更换其中品类后.*重新核算销售报价/);
  assert.doesNotMatch(draft.suggestedReply, /18 元|成本价/);
});

test("supports a one-page recommendation and keeps the original deck page intact", () => {
  const previousSelection = selected("企业员工福利，每份120元，发一份资料", 120, "enterprise");
  const result = selectCustomerSelectionPages({
    text: "先推荐一页实用的给我",
    budget: { perUnitAmount: 120 },
    salesContext: { customerCategory: "enterprise", usageScene: "员工福利", stylePreference: "实用" },
    previousSelection,
  });
  assert.equal(result.status, "matched");
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].materialId, "enterprise_101_150");
  assert.equal(Number.isInteger(result.pages[0].pageNumber), true);
});

test("uses conversation context when the customer asks for recommendations after receiving the deck", () => {
  const firstRoute = evaluateAgentRoute({ text: "美容院开业，每份60元，发我看看方案" });
  const firstDraft = buildAgentReplyDraft(firstRoute, { skills: [], knowledgeEntries: [], catalogSkus: [] });
  assert.equal(firstDraft.replyDraft.customerSelectionMaterial.material.id, "beauty_50_80_2026");

  const followupRoute = evaluateAgentRoute(
    {
      text: "帮我挑三个精致一点的",
      budget: { perUnitAmount: 60 },
      salesContext: firstRoute.salesContext,
    },
    { salesContext: firstRoute.salesContext },
  );
  const followupDraft = buildAgentReplyDraft(followupRoute, {
    skills: [],
    knowledgeEntries: [],
    catalogSkus: [],
    customerSelectionMaterialContext: firstDraft.replyDraft.customerSelectionMaterial,
  });
  assert.equal(followupRoute.agentKey, "pre_sales");
  assert.equal(followupDraft.replyDraft.customerSelectionPages.status, "matched");
  assert.equal(followupDraft.replyDraft.customerSelectionPages.pages.length, 3);
  assert.match(followupDraft.suggestedReply, /截成 3 张图/);
  assert.doesNotMatch(followupDraft.suggestedReply, /先发《.*》这一份/);
});

test("an initial request to recommend a deck still sends one deck instead of random pages", () => {
  const route = evaluateAgentRoute({ text: "企业员工福利，每份120元，推荐一份方案" });
  const draft = buildAgentReplyDraft(route, { skills: [], knowledgeEntries: [], catalogSkus: [] });
  assert.equal(draft.replyDraft.customerSelectionPages.status, "not_requested");
  assert.equal(draft.replyDraft.customerSelectionMaterial.material.id, "enterprise_101_150");
  assert.match(draft.suggestedReply, /先发《企业礼赠 101-150 元方案》/);
});

test("dispatch builds real file and page-image payloads instead of text-only promises", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "api", "src", "wechat", "wechat-dispatch.service.ts"), "utf8");
  assert.match(source, /kind: "material_page_recommendations"/);
  assert.match(source, /imagePaths: delivery\.preparedImages\.map/);
  assert.match(source, /kind: "customer_selection_material"/);
  assert.match(source, /filePaths: \[delivery\.materialFile\.filePath\]/);
});

test("awaits PostgreSQL knowledge imports before returning the saved receipt", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "api", "src", "training", "training.service.ts"), "utf8");
  assert.match(source, /async importKnowledge\(payload: KnowledgeImportPayload\)/);
  assert.match(source, /: await this\.requirePrisma\(\)\.importKnowledgeEntries\(parsed\.rows, context\)/);
});
