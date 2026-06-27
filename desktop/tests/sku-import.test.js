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
      salePrice: 100,
      costPrice: 60,
      stock: 20,
      sceneTags: ["员工福利"],
      mainImagePath: "good.jpg",
      supplier: "供应商A",
      dimensions: { lengthCm: 10, widthCm: 8 },
      weightGram: 300,
    },
    {
      skuCode: "BAD-1",
      name: "资料不完整商品",
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
      salePrice: 100,
      costPrice: 50,
      stock: 20,
      sceneTags: ["员工福利"],
      mainImagePath: "C:\\missing\\product.jpg",
      mainImageFileMissing: true,
      supplier: "供应商A",
      dimensions: { lengthCm: 10, widthCm: 8 },
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
      dimensions: { lengthCm: 10, widthCm: 8 },
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

test("prioritizes blocking SKU repair work before low risk info", () => {
  const result = auditSkuCatalog([
    {
      skuCode: "INFO-1",
      name: "只缺尺寸重量",
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
