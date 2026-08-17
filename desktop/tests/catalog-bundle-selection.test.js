"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { recommendBundle } = require("../packages/rules");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function readySku(overrides = {}) {
  return {
    type: "item",
    salePrice: 40,
    costPrice: 20,
    stock: 50,
    sceneTags: ["vip"],
    dimensions: { lengthCm: 8, widthCm: 6, heightCm: 2 },
    weightGram: 120,
    leadTimeDays: 3,
    mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\sku\\ready.png",
    ...overrides,
  };
}

function skuCodes(result) {
  return result.items.map((item) => item.skuCode);
}

test("recommendBundle anchors manually selected image-backed SKU when images are required", () => {
  const result = recommendBundle({
    budget: { perUnitAmount: 160, quantity: 10 },
    scene: "vip",
    maxItems: 1,
    selectedSkuCodes: ["ITEM-SELECTED"],
    requireImages: true,
    skus: [
      readySku({
        skuCode: "BOX-A",
        name: "Image backed box",
        type: "gift_box",
        salePrice: 60,
        costPrice: 30,
        dimensions: { lengthCm: 30, widthCm: 20, heightCm: 8 },
        weightGram: 600,
        mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\sku\\box-a.png",
      }),
      readySku({
        skuCode: "ITEM-AUTO",
        name: "Higher priority automatic item",
        salePrice: 30,
        priority: 100,
        mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\sku\\auto.png",
      }),
      readySku({
        skuCode: "ITEM-SELECTED",
        name: "Manual image backed item",
        salePrice: 70,
        priority: 1,
        mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\sku\\selected.png",
      }),
    ],
  });

  assert.deepEqual(skuCodes(result), ["BOX-A", "ITEM-SELECTED"]);
  assert.equal(result.items.every((item) => item.mainImagePath), true);
  assert.equal(result.warnings.some((warning) => String(warning).includes("selected_sku_missing_image")), false);
});

test("recommendBundle rejects manually selected SKU without image and warns explicitly", () => {
  const result = recommendBundle({
    budget: { perUnitAmount: 160, quantity: 10 },
    scene: "vip",
    maxItems: 1,
    selectedSkuCodes: ["ITEM-NO-IMAGE"],
    requireImages: true,
    skus: [
      readySku({
        skuCode: "BOX-A",
        name: "Image backed box",
        type: "gift_box",
        salePrice: 60,
        costPrice: 30,
        dimensions: { lengthCm: 30, widthCm: 20, heightCm: 8 },
        weightGram: 600,
        mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\sku\\box-a.png",
      }),
      readySku({
        skuCode: "ITEM-NO-IMAGE",
        name: "Manual item missing image",
        salePrice: 40,
        priority: 100,
        mainImagePath: undefined,
      }),
      readySku({
        skuCode: "ITEM-WITH-IMAGE",
        name: "Fallback image backed item",
        salePrice: 40,
        priority: 1,
        mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\sku\\fallback.png",
      }),
    ],
  });

  assert.deepEqual(skuCodes(result), ["BOX-A", "ITEM-WITH-IMAGE"]);
  assert.equal(result.items.some((item) => item.skuCode === "ITEM-NO-IMAGE"), false);
  assert.ok(result.warnings.includes("ITEM-NO-IMAGE selected_sku_missing_image"));
});

test("recommendBundle does not treat non-image references as image-backed SKUs", () => {
  const result = recommendBundle({
    budget: { perUnitAmount: 160, quantity: 10 },
    scene: "vip",
    maxItems: 1,
    selectedSkuCodes: ["ITEM-TXT-IMAGE"],
    requireImages: true,
    skus: [
      readySku({
        skuCode: "BOX-A",
        name: "Image backed box",
        type: "gift_box",
        salePrice: 60,
        costPrice: 30,
        dimensions: { lengthCm: 30, widthCm: 20, heightCm: 8 },
        weightGram: 600,
        mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\sku\\box-a.png",
      }),
      readySku({
        skuCode: "ITEM-TXT-IMAGE",
        name: "Text file pretending to be an image",
        salePrice: 40,
        priority: 100,
        mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\sku\\not-image.txt",
      }),
      readySku({
        skuCode: "ITEM-WITH-IMAGE",
        name: "Fallback image backed item",
        salePrice: 40,
        priority: 1,
        mainImagePath: "E:\\zhinengkefu\\desktop\\storage\\assets\\sku\\fallback.webp",
      }),
    ],
  });

  assert.deepEqual(skuCodes(result), ["BOX-A", "ITEM-WITH-IMAGE"]);
  assert.equal(result.items.some((item) => item.skuCode === "ITEM-TXT-IMAGE"), false);
  assert.ok(result.warnings.includes("ITEM-TXT-IMAGE selected_sku_missing_image"));
});

test("CatalogBundlesPage calculate request carries selectedSkuCodes and requireImages", () => {
  const source = read("apps/web/src/features/catalog/catalog-bundles-page.tsx");
  const calculateBody = extractFunctionBody(source, "async function calculate()");
  const requestBlock = extractConstObject(calculateBody, "request");

  assert.match(requestBlock, /\bselectedSkuCodes\s*,/);
  assert.match(requestBlock, /\brequireImages:\s*true\b/);
  assert.match(calculateBody, /await\s+recommendBundle\(request\)/);
});

test("conversation identity reaches bundle handoff and cannot silently fall back to another customer", () => {
  const page = read("apps/web/src/app/catalog/bundles/page.tsx");
  const bundles = read("apps/web/src/features/catalog/catalog-bundles-page.tsx");
  const handoff = read("apps/web/src/features/catalog/catalog-bundle-design-handoff.tsx");
  const identityModel = read("apps/web/src/features/catalog/catalog-journey-state.ts");
  const identitySource = `${handoff}\n${identityModel}`;

  assert.match(page, /identityFiltersFromSearchParams\(searchParams\)/);
  assert.match(page, /<CatalogBundlesPage initialIdentityFilters=\{identityFilters\}/);
  assert.match(bundles, /initialIdentityFilters=\{initialIdentityFilters\}/);
  assert.match(handoff, /initialBundleConversation\(next, initialIdentityFilters\)/);
  assert.match(handoff, /if \(identityScoped\) return preferred\?\.id \|\| ""/);
  assert.match(identitySource, /conversation\.id === filters\.conversationId/);
  assert.match(identitySource, /conversation\.customerId === filters\.customerId/);
  assert.match(identitySource, /conversation\.wechatAccountId === filters\.wechatAccountId/);
});

function extractFunctionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const openBrace = source.indexOf("{", start);
  assert.notEqual(openBrace, -1, `${signature} must have a body`);
  return source.slice(openBrace, findMatchingBrace(source, openBrace) + 1);
}

function extractConstObject(source, constName) {
  const assignment = `const ${constName} = {`;
  const start = source.indexOf(assignment);
  assert.notEqual(start, -1, `${assignment} must exist`);
  const openBrace = source.indexOf("{", start);
  return source.slice(openBrace, findMatchingBrace(source, openBrace) + 1);
}

function findMatchingBrace(source, openBrace) {
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  assert.fail(`No matching brace at index ${openBrace}`);
}
