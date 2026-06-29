"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  auditSkuCatalog,
  buildSkuImportTemplateCsv,
  getSkuImportFieldGuide,
  isLikelyImageBuffer,
  parseSkuImportText,
} = require("../packages/rules");

test("parses real Chinese SKU rows with product images and logistics fields", () => {
  const result = parseSkuImportText(`SKU编号\t商品名称\t商品类型\t分类\t成本价\t售价\t库存\t场景标签\t主图\t多角度图\t尺寸\t重量g\t材质\t供应商\t交期天数\t替代SKU
BOX-REAL\t红金礼盒\t礼盒\t礼盒\t42\t88\t30\t员工福利、客户拜访\tC:\\img\\box.jpg\tC:\\img\\box-side.jpg、C:\\img\\box-open.jpg\t30*22*9\t600\t特种纸\t杭州礼盒厂\t5\tBOX-B`);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].skuCode, "BOX-REAL");
  assert.equal(result.rows[0].type, "gift_box");
  assert.equal(result.rows[0].mainImagePath, "C:\\img\\box.jpg");
  assert.equal(result.rows[0].angleImages.length, 2);
  assert.deepEqual(result.rows[0].dimensions, { lengthCm: 30, widthCm: 22, heightCm: 9 });
  assert.equal(result.rows[0].weightGram, 600);
  assert.equal(result.rows[0].supplier, "杭州礼盒厂");
  assert.equal(result.rows[0].leadTimeDays, 5);
  assert.deepEqual(result.rows[0].replacementSkuCodes, ["BOX-B"]);
});

test("parses tab-separated SKU rows copied from spreadsheet", () => {
  const result = parseSkuImportText(`SKU编号\t商品名称\t商品类型\t分类\t成本价\t售价\t库存\t场景标签
BOX-B\t雅黑礼盒B\t礼盒\t礼盒\t40\t80\t20\t员工福利、客户拜访
TEA-C\t乌龙茶C\t内搭\t茶叶\t55\t120\t15\t员工福利`);

  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].type, "gift_box");
  assert.deepEqual(result.rows[0].sceneTags, ["员工福利", "客户拜访"]);
  assert.equal(result.rows[1].salePrice, 120);
});

test("parses comma-separated SKU rows", () => {
  const result = parseSkuImportText(`sku,name,type,cost,price,stock
CARD-B,感谢卡B,accessory,3,12,200`);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].skuCode, "CARD-B");
  assert.equal(result.rows[0].type, "accessory");
});

test("reports invalid SKU rows with line numbers", () => {
  const result = parseSkuImportText(`SKU编号\t商品名称\t商品类型\t成本价\t售价
\t无编号商品\t内搭\t10\t20
GOOD-1\t正常商品\t内搭\t10\t30`);

  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 2);
});

test("reports SKU import field mapping and missing required headers", () => {
  const result = parseSkuImportText(`商品名称,售价,自定义备注
测试商品,10,这列不会导入`);

  assert.deepEqual(result.missingRequiredFields.map((field) => field.field), ["skuCode"]);
  assert.equal(result.fieldMapping.find((field) => field.field === "name").sourceHeader, "商品名称");
  assert.deepEqual(result.unmappedHeaders, ["自定义备注"]);
});

test("builds a standard CSV template from the shared SKU field guide", () => {
  const fields = getSkuImportFieldGuide();
  const csv = buildSkuImportTemplateCsv();

  assert.ok(fields.some((field) => field.field === "skuCode" && field.required));
  assert.ok(csv.includes("SKU编号,商品名称,商品类型"));
  assert.ok(csv.includes("BOX-001"));
});

test("audits SKU catalog readiness for real sales usage", () => {
  const result = auditSkuCatalog([
    {
      skuCode: "GOOD-1",
      name: "真实商品",
      type: "item",
      salePrice: 100,
      costPrice: 60,
      stock: 20,
      sceneTags: ["员工福利"],
      mainImagePath: "good.jpg",
      supplier: "供应商A",
      dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
      weightGram: 300,
    },
    {
      skuCode: "BAD-1",
      name: "资料不完整商品",
      type: "item",
      salePrice: 50,
      costPrice: 70,
      stock: 0,
      sceneTags: [],
    },
  ]);

  assert.equal(result.total, 2);
  assert.equal(result.readyCount, 1);
  assert.equal(result.negativeMarginCount, 1);
  assert.equal(result.missingImageCount, 1);
  assert.equal(result.imageIssueCount, 1);
  assert.equal(result.lowStockCount, 1);
  assert.equal(result.repairQueueCount, 1);
  assert.equal(result.blockingRepairCount, 1);
  assert.equal(result.repairQueue[0].skuCode, "BAD-1");
  assert.ok(result.repairQueue[0].missingFields.some((field) => field.field === "costPrice"));
});

test("audits SKU image paths that point to missing local files", () => {
  const result = auditSkuCatalog([
    {
      skuCode: "MISSING-IMAGE-FILE",
      name: "主图路径失效商品",
      type: "item",
      salePrice: 100,
      costPrice: 50,
      stock: 20,
      sceneTags: ["员工福利"],
      mainImagePath: "C:\\missing\\product.jpg",
      mainImageFileMissing: true,
      supplier: "供应商A",
      dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
      weightGram: 300,
    },
  ]);

  assert.equal(result.readyCount, 0);
  assert.equal(result.missingImageCount, 1);
  assert.equal(result.issues[0].code, "local_main_image_missing");
  assert.equal(result.repairQueue[0].recommendedAction, "重新上传主图，当前本地图片路径已经失效");
});

test("audits SKU image references that are not usable product images", () => {
  const result = auditSkuCatalog([
    {
      skuCode: "BAD-IMAGE-TYPE",
      name: "主图格式异常商品",
      type: "item",
      salePrice: 100,
      costPrice: 50,
      stock: 20,
      sceneTags: ["员工福利"],
      mainImagePath: "C:\\products\\sku-spec.pdf",
      mainImageInvalidType: true,
      angleImages: ["C:\\products\\detail.txt", "C:\\missing\\angle.jpg"],
      angleImageIssues: [
        { index: 0, path: "C:\\products\\detail.txt", invalidType: true },
        { index: 1, path: "C:\\missing\\angle.jpg", fileMissing: true },
      ],
      supplier: "供应商A",
      dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
      weightGram: 300,
    },
  ]);

  assert.equal(result.readyCount, 0);
  assert.equal(result.missingImageCount, 1);
  assert.equal(result.imageIssueCount, 3);
  assert.equal(result.invalidImageCount, 2);
  assert.equal(result.missingAngleImageCount, 1);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "invalid_main_image_type",
    "invalid_angle_image_type",
    "local_angle_image_missing",
  ]);
  assert.deepEqual(result.imageProblems.map((problem) => ({
    code: problem.code,
    role: problem.imageRole,
    index: problem.imageIndex,
    path: problem.path,
  })), [
    { code: "invalid_main_image_type", role: "main", index: null, path: "C:\\products\\sku-spec.pdf" },
    { code: "invalid_angle_image_type", role: "angle", index: 0, path: "C:\\products\\detail.txt" },
    { code: "local_angle_image_missing", role: "angle", index: 1, path: "C:\\missing\\angle.jpg" },
  ]);
  assert.equal(result.repairQueue[0].missingFields[0].field, "mainImagePath");
  assert.ok(result.repairQueue[0].missingFields.some((field) => field.field === "angleImages"));
});

test("detects real image bytes instead of trusting file names", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const jpeg = Buffer.from("ffd8ffe000104a4649460001", "hex");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
  const svg = Buffer.from("<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "utf8");
  const fakeJpeg = Buffer.from("this is not really an image", "utf8");

  assert.equal(isLikelyImageBuffer(png), true);
  assert.equal(isLikelyImageBuffer(jpeg), true);
  assert.equal(isLikelyImageBuffer(webp), true);
  assert.equal(isLikelyImageBuffer(svg), true);
  assert.equal(isLikelyImageBuffer(fakeJpeg), false);
});

test("audits duplicate SKU codes and names before automation uses products", () => {
  const base = {
    type: "item",
    salePrice: 100,
    costPrice: 50,
    stock: 20,
    sceneTags: ["员工福利"],
    mainImagePath: "good.jpg",
    supplier: "供应商A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const result = auditSkuCatalog([
    { ...base, skuCode: "DUP-1", name: "同款茶礼" },
    { ...base, skuCode: "dup-1", name: "另一款茶礼" },
    { ...base, skuCode: "UNIQUE-1", name: "同款茶礼" },
  ]);

  assert.equal(result.readyCount, 0);
  assert.equal(result.duplicateSkuCodeCount, 2);
  assert.equal(result.duplicateNameCount, 2);
  assert.ok(result.issues.some((issue) => issue.code === "duplicate_sku_code" && issue.severity === "error"));
  assert.ok(result.issues.some((issue) => issue.code === "duplicate_name" && issue.severity === "warning"));
  assert.ok(result.repairQueue.some((item) => item.missingFields.some((field) => field.field === "skuCode")));
});

test("audits unsafe SKU codes before cross-module identity binding uses them", () => {
  const base = {
    type: "item",
    salePrice: 100,
    costPrice: 50,
    stock: 20,
    sceneTags: ["员工福利"],
    mainImagePath: "good.jpg",
    supplier: "供应商A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const result = auditSkuCatalog([
    { ...base, skuCode: "BOX-OK_01", name: "标准编号" },
    { ...base, skuCode: " BOX-SPACE ", name: "首尾空格编号" },
    { ...base, skuCode: "中文SKU", name: "中文编号" },
    { ...base, skuCode: "BAD CODE", name: "中间空格编号" },
  ]);

  assert.equal(result.unsafeSkuCodeCount, 3);
  assert.ok(result.issues.some((issue) => issue.code === "sku_code_whitespace" && issue.field === "skuCode"));
  assert.ok(result.issues.some((issue) => issue.code === "unsafe_sku_code" && issue.skuCode === "中文SKU"));
  assert.ok(result.issues.some((issue) => issue.code === "unsafe_sku_code" && issue.skuCode === "BAD CODE"));
  assert.ok(!result.issues.some((issue) => issue.skuCode === "BOX-OK_01" && ["unsafe_sku_code", "sku_code_whitespace"].includes(issue.code)));
});

test("audits SKU types before bundle matching assigns product roles", () => {
  const base = {
    salePrice: 100,
    costPrice: 50,
    stock: 20,
    sceneTags: ["员工福利"],
    mainImagePath: "good.jpg",
    supplier: "供应商A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const result = auditSkuCatalog([
    { ...base, skuCode: "TYPE-OK", name: "类型正常", type: "gift_box" },
    { ...base, skuCode: "TYPE-MISSING", name: "缺类型" },
    { ...base, skuCode: "TYPE-BAD", name: "类型错误", type: "service" },
  ]);

  assert.equal(result.typeIssueCount, 2);
  assert.ok(result.issues.some((issue) => issue.code === "missing_sku_type" && issue.severity === "error"));
  assert.ok(result.issues.some((issue) => issue.code === "invalid_sku_type" && issue.severity === "error"));
  assert.ok(!result.issues.some((issue) => issue.skuCode === "TYPE-OK" && ["missing_sku_type", "invalid_sku_type"].includes(issue.code)));
});

test("audits catalog role structure required for bundle matching", () => {
  const base = {
    salePrice: 100,
    costPrice: 50,
    stock: 20,
    sceneTags: ["员工福利"],
    mainImagePath: "good.jpg",
    supplier: "供应商A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const ready = auditSkuCatalog([
    { ...base, skuCode: "BOX-READY", name: "可用礼盒", type: "gift_box" },
    { ...base, skuCode: "ITEM-READY", name: "可用内搭", type: "item" },
    { ...base, skuCode: "CARD-READY", name: "可用配件", type: "accessory" },
  ]);
  const missingBox = auditSkuCatalog([
    { ...base, skuCode: "ITEM-ONLY", name: "只有内搭", type: "item" },
  ]);
  const missingItem = auditSkuCatalog([
    { ...base, skuCode: "BOX-ONLY", name: "只有礼盒", type: "gift_box" },
  ]);

  assert.equal(ready.availableGiftBoxCount, 1);
  assert.equal(ready.availableItemCount, 1);
  assert.equal(ready.availableAccessoryCount, 1);
  assert.equal(ready.catalogStructureIssueCount, 0);
  assert.equal(missingBox.catalogStructureIssueCount, 1);
  assert.equal(missingItem.catalogStructureIssueCount, 1);
});

test("summarizes available SKU category and scene coverage", () => {
  const base = {
    type: "item",
    salePrice: 100,
    costPrice: 50,
    stock: 20,
    mainImagePath: "good.jpg",
    supplier: "Supplier A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const result = auditSkuCatalog([
    { ...base, skuCode: "TEA-A", name: "Tea A", category: "tea", sceneTags: ["employee_gift", "client_visit"] },
    { ...base, skuCode: "TEA-B", name: "Tea B", category: "tea", sceneTags: ["employee_gift"] },
    { ...base, skuCode: "CARD-A", name: "Card A", type: "accessory", category: "card", sceneTags: ["client_visit"] },
    { ...base, skuCode: "OFFLINE", name: "Offline item", category: "ignored", sceneTags: ["ignored"], isActive: false },
    { ...base, skuCode: "NO-STOCK", name: "No stock item", category: "ignored", sceneTags: ["ignored"], stock: 0 },
  ]);
  const emptyCoverage = auditSkuCatalog([
    { ...base, skuCode: "NO-TAGS", name: "No tags item", sceneTags: [] },
  ]);

  assert.equal(result.availableSceneTagCount, 2);
  assert.equal(result.availableCategoryCount, 2);
  assert.equal(result.catalogCoverageIssueCount, 0);
  assert.deepEqual(result.topSceneTags[0], { name: "client_visit", count: 2 });
  assert.deepEqual(result.topCategories[0], { name: "tea", count: 2 });
  assert.equal(emptyCoverage.catalogCoverageIssueCount, 2);
});

test("summarizes minimum budget needed for a basic gift bundle", () => {
  const base = {
    costPrice: 20,
    stock: 20,
    sceneTags: ["employee_gift"],
    mainImagePath: "good.jpg",
    supplier: "Supplier A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const ready = auditSkuCatalog([
    { ...base, skuCode: "BOX-LOW", name: "Box low", type: "gift_box", salePrice: 60 },
    { ...base, skuCode: "BOX-HIGH", name: "Box high", type: "gift_box", salePrice: 120 },
    { ...base, skuCode: "ITEM-LOW", name: "Item low", type: "item", salePrice: 35 },
    { ...base, skuCode: "ITEM-NO-STOCK", name: "Item no stock", type: "item", salePrice: 10, stock: 0 },
  ]);
  const missingItem = auditSkuCatalog([
    { ...base, skuCode: "BOX-ONLY", name: "Box only", type: "gift_box", salePrice: 60 },
  ]);

  assert.equal(ready.minGiftBoxPrice, 60);
  assert.equal(ready.minItemPrice, 35);
  assert.equal(ready.minBundleBudget, 95);
  assert.equal(ready.availableGiftBoxStock, 40);
  assert.equal(ready.availableItemStock, 20);
  assert.equal(ready.basicBundleCapacity, 20);
  assert.equal(ready.bundleCapacityBottleneck, "item");
  assert.equal(ready.bundleCapacityBottleneckLabel, "内搭库存限制");
  assert.deepEqual(ready.bundleCapacityChecks, [
    { quantity: 50, enough: false, shortage: 30 },
    { quantity: 100, enough: false, shortage: 80 },
    { quantity: 200, enough: false, shortage: 180 },
  ]);
  assert.equal(ready.bundleCapacityRiskCount, 3);
  assert.equal(ready.bundleReadinessIssueCount, 3);
  assert.equal(missingItem.minBundleBudget, 0);
  assert.equal(missingItem.basicBundleCapacity, 0);
  assert.equal(missingItem.bundleCapacityBottleneck, "item");
  assert.equal(missingItem.bundleReadinessIssueCount, 4);
  assert.ok(missingItem.bundleReadinessWarnings.some((warning) => warning.includes("内搭")));
});

test("identifies which SKU role limits basic bundle capacity", () => {
  const base = {
    costPrice: 20,
    sceneTags: ["employee_gift"],
    mainImagePath: "good.jpg",
    supplier: "Supplier A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const giftBoxLimited = auditSkuCatalog([
    { ...base, skuCode: "BOX-10", name: "Box 10", type: "gift_box", salePrice: 60, stock: 10 },
    { ...base, skuCode: "ITEM-50", name: "Item 50", type: "item", salePrice: 35, stock: 50 },
  ]);
  const balanced = auditSkuCatalog([
    { ...base, skuCode: "BOX-30", name: "Box 30", type: "gift_box", salePrice: 60, stock: 30 },
    { ...base, skuCode: "ITEM-30", name: "Item 30", type: "item", salePrice: 35, stock: 30 },
  ]);

  assert.equal(giftBoxLimited.bundleCapacityBottleneck, "gift_box");
  assert.equal(giftBoxLimited.bundleCapacityBottleneckLabel, "礼盒库存限制");
  assert.equal(balanced.bundleCapacityBottleneck, "balanced");
  assert.equal(balanced.bundleCapacityBottleneckLabel, "礼盒与内搭库存均衡");
});

test("allows custom bundle capacity checkpoints without changing audit rules", () => {
  const base = {
    costPrice: 20,
    sceneTags: ["employee_gift"],
    mainImagePath: "good.jpg",
    supplier: "Supplier A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const result = auditSkuCatalog([
    { ...base, skuCode: "BOX-80", name: "Box 80", type: "gift_box", salePrice: 60, stock: 80 },
    { ...base, skuCode: "ITEM-120", name: "Item 120", type: "item", salePrice: 35, stock: 120 },
  ], { quantityCheckpoints: [30, 80, 150] });

  assert.equal(result.basicBundleCapacity, 80);
  assert.deepEqual(result.bundleCapacityChecks, [
    { quantity: 30, enough: true, shortage: 0 },
    { quantity: 80, enough: true, shortage: 0 },
    { quantity: 150, enough: false, shortage: 70 },
  ]);
  assert.equal(result.bundleCapacityRiskCount, 1);
});

test("audits replacement SKU references before stock fallback uses them", () => {
  const base = {
    type: "item",
    salePrice: 100,
    costPrice: 50,
    stock: 20,
    sceneTags: ["员工福利"],
    mainImagePath: "good.jpg",
    supplier: "供应商A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const result = auditSkuCatalog([
    { ...base, skuCode: "TEA-A", name: "茶礼A", replacementSkuCodes: ["TEA-B", "MISSING-SKU"] },
    { ...base, skuCode: "TEA-B", name: "茶礼B", replacementSkuCodes: ["TEA-B"] },
  ]);

  assert.equal(result.invalidReplacementCount, 2);
  assert.ok(result.issues.some((issue) => issue.code === "invalid_replacement_sku" && issue.field === "replacementSkuCodes"));
  assert.ok(result.issues.some((issue) => issue.code === "self_replacement_sku" && issue.field === "replacementSkuCodes"));
  assert.ok(result.repairQueue.some((item) => item.missingFields.some((field) => field.field === "replacementSkuCodes")));
});

test("audits matching rule SKU references before bundle matching uses them", () => {
  const base = {
    type: "item",
    salePrice: 100,
    costPrice: 50,
    stock: 20,
    sceneTags: ["员工福利"],
    mainImagePath: "good.jpg",
    supplier: "供应商A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const result = auditSkuCatalog([
    { ...base, skuCode: "BOX-A", name: "礼盒A", type: "gift_box", matchingRules: { mustWith: ["CARD-A", "MISSING-CARD"], cannotWith: "BOX-A" } },
    { ...base, skuCode: "CARD-A", name: "贺卡A", type: "accessory" },
  ]);

  assert.equal(result.invalidMatchingRuleCount, 2);
  assert.ok(result.issues.some((issue) => issue.code === "invalid_matching_rule_sku" && issue.field === "matchingRules"));
  assert.ok(result.issues.some((issue) => issue.code === "self_matching_rule_sku" && issue.field === "matchingRules"));
  assert.ok(result.repairQueue.some((item) => item.missingFields.some((field) => field.field === "matchingRules")));
});

test("audits unrealistic lead time without requiring every SKU to have one", () => {
  const base = {
    type: "item",
    salePrice: 100,
    costPrice: 50,
    stock: 20,
    sceneTags: ["员工福利"],
    mainImagePath: "good.jpg",
    supplier: "供应商A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const result = auditSkuCatalog([
    { ...base, skuCode: "FAST-OK", name: "正常交期", leadTimeDays: 5 },
    { ...base, skuCode: "BAD-LEAD", name: "错误交期", leadTimeDays: -1 },
    { ...base, skuCode: "LONG-LEAD", name: "超长交期", leadTimeDays: 60 },
    { ...base, skuCode: "EMPTY-LEAD", name: "未填交期" },
  ]);

  assert.equal(result.leadTimeIssueCount, 2);
  assert.ok(result.issues.some((issue) => issue.code === "invalid_lead_time" && issue.severity === "warning"));
  assert.ok(result.issues.some((issue) => issue.code === "long_lead_time" && issue.severity === "info"));
  assert.ok(!result.issues.some((issue) => issue.skuCode === "EMPTY-LEAD" && issue.field === "leadTimeDays"));
});

test("audits price and margin risks before automatic quoting uses SKUs", () => {
  const base = {
    type: "item",
    stock: 20,
    sceneTags: ["员工福利"],
    mainImagePath: "good.jpg",
    supplier: "供应商A",
    dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 },
    weightGram: 300,
  };
  const result = auditSkuCatalog([
    { ...base, skuCode: "NO-COST", name: "缺成本商品", salePrice: 100, costPrice: 0 },
    { ...base, skuCode: "LOSS", name: "亏损商品", salePrice: 100, costPrice: 120 },
    { ...base, skuCode: "LOW-MARGIN", name: "低毛利商品", salePrice: 100, costPrice: 90 },
    { ...base, skuCode: "OK-MARGIN", name: "正常毛利商品", salePrice: 100, costPrice: 60 },
  ]);

  assert.equal(result.negativeMarginCount, 3);
  assert.ok(result.issues.some((issue) => issue.code === "invalid_cost_price" && issue.severity === "warning"));
  assert.ok(result.issues.some((issue) => issue.code === "negative_margin" && issue.severity === "warning"));
  assert.ok(result.issues.some((issue) => issue.code === "low_margin_rate" && issue.severity === "info"));
  assert.ok(!result.issues.some((issue) => issue.skuCode === "OK-MARGIN" && ["invalid_cost_price", "negative_margin", "low_margin_rate"].includes(issue.code)));
});

test("audits product specifications needed for packing and design scale", () => {
  const base = {
    type: "item",
    salePrice: 100,
    costPrice: 50,
    stock: 20,
    sceneTags: ["员工福利"],
    mainImagePath: "good.jpg",
    supplier: "供应商A",
  };
  const result = auditSkuCatalog([
    { ...base, skuCode: "NO-DIM", name: "缺尺寸", weightGram: 300 },
    { ...base, skuCode: "PART-DIM", name: "尺寸不完整", dimensions: { lengthCm: 10, widthCm: 8 }, weightGram: 300 },
    { ...base, skuCode: "BAD-DIM", name: "尺寸错误", dimensions: { lengthCm: 10, widthCm: 0, heightCm: 4 }, weightGram: 300 },
    { ...base, skuCode: "BAD-WEIGHT", name: "重量错误", dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 }, weightGram: 0 },
    { ...base, skuCode: "SPEC-OK", name: "规格正常", dimensions: { lengthCm: 10, widthCm: 8, heightCm: 4 }, weightGram: 300 },
  ]);

  assert.equal(result.specificationIssueCount, 4);
  assert.ok(result.issues.some((issue) => issue.code === "missing_dimensions" && issue.field === "dimensions"));
  assert.ok(result.issues.some((issue) => issue.code === "incomplete_dimensions" && issue.field === "dimensions"));
  assert.ok(result.issues.some((issue) => issue.code === "invalid_dimensions" && issue.severity === "warning"));
  assert.ok(result.issues.some((issue) => issue.code === "invalid_weight" && issue.severity === "warning"));
  assert.ok(!result.issues.some((issue) => issue.skuCode === "SPEC-OK" && ["missing_dimensions", "incomplete_dimensions", "invalid_dimensions", "missing_weight", "invalid_weight"].includes(issue.code)));
});

test("prioritizes blocking SKU repair work before low risk info", () => {
  const result = auditSkuCatalog([
    {
      skuCode: "INFO-1",
      name: "只缺尺寸重量",
      type: "item",
      salePrice: 100,
      costPrice: 60,
      stock: 20,
      sceneTags: ["员工福利"],
      mainImagePath: "good.jpg",
      supplier: "供应商A",
    },
    {
      skuCode: "BLOCK-1",
      name: "缺主图商品",
      type: "item",
      salePrice: 100,
      costPrice: 60,
      stock: 20,
      sceneTags: ["员工福利"],
      supplier: "供应商A",
      dimensions: { lengthCm: 10 },
      weightGram: 100,
    },
  ]);

  assert.equal(result.repairQueue[0].skuCode, "BLOCK-1");
  assert.equal(result.repairQueue[0].blocking, true);
  assert.equal(result.repairQueue[0].missingFields[0].field, "mainImagePath");
  assert.equal(result.repairQueue[1].severity, "info");
});
