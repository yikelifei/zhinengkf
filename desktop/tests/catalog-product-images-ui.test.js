"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("catalog pages consume product images instead of rendering text-only SKU lists", () => {
  const ui = read("apps/web/src/features/catalog/catalog-ui.tsx");
  assert.match(ui, /export function CatalogProductImage/);
  assert.match(ui, /export function catalogSkuImageRefs/);
  assert.match(ui, /export function catalogSkuRenderableImageRefs/);
  assert.match(ui, /export function catalogSkuImageSummary/);
  assert.match(ui, /safeRenderableImageSrc/);
  assert.match(ui, /mainImagePath/);
  assert.match(ui, /angleImages/);
  assert.match(ui, /localAssetUrl/);
  assert.match(ui, /data-image-state=\{runtimeState\}/);
  assert.match(ui, /"missing"/);
  assert.match(ui, /"invalid"/);
  assert.match(ui, /"failed"/);
  assert.doesNotMatch(ui, /<img[^>]+src=\{(?:sku|record)\.mainImagePath\}/);

  const list = read("apps/web/src/features/catalog/catalog-products-page.tsx");
  assert.match(list, /groupSkusByCategory/);
  assert.match(list, /CatalogProductImage/);
  assert.match(list, /catalogSkuImageRefs/);
  assert.match(list, /catalogSkuImageSummary/);
  assert.match(list, /categoryGrid/);
  assert.match(list, /productImageGrid/);
  assert.match(list, /data-image-status=\{imageSummary\.status\}/);
  assert.match(list, /imageReadyCount/);
  assert.match(list, /missingImageCount/);
  assert.match(list, /invalidImageCount/);

  const detail = read("apps/web/src/features/catalog/catalog-product-detail-page.tsx");
  assert.match(detail, /CatalogProductImage/);
  assert.match(detail, /variant="hero"/);
  assert.match(detail, /imageRefs\.slice\(1\)/);
  assert.match(detail, /productAngleGrid/);

  const bundles = read("apps/web/src/features/catalog/catalog-bundles-page.tsx");
  const selector = read("apps/web/src/features/catalog/catalog-bundle-image-selector.tsx");
  const api = read("apps/web/src/lib/api.ts");
  const designCatalogPicker = read("apps/web/src/features/design/design-job-create-catalog-picker.tsx");
  assert.match(bundles, /useCatalogProducts/);
  assert.match(bundles, /skuByCode/);
  assert.match(bundles, /CatalogProductImage/);
  assert.match(bundles, /CatalogBundleImageSelector/);
  assert.match(bundles, /selectedSkuCodes,/);
  assert.match(bundles, /requireImages:\s*true/);
  assert.match(bundles, /setResultState\(IDLE_BUNDLE_RESULT\)/);
  assert.match(api, /selectedSkuCodes\?:\s*string\[\]/);
  assert.match(api, /requireImages\?:\s*boolean/);
  assert.match(designCatalogPicker, /requireImages:\s*true/);
  assert.match(selector, /bundleCatalogCandidateGroups/);
  assert.match(selector, /candidateImageGrid/);
  assert.match(selector, /catalogSkuRenderableImageRefs/);
  assert.match(selector, /selectedSkuCodes/);
  assert.match(selector, /onToggleSku/);
  assert.match(selector, /aria-pressed=\{selected\}/);
  assert.match(selector, /bundleSelectionBoard/);
  assert.match(selector, /CatalogProductImage/);
  assert.match(selector, /blockedImageCount/);
  assert.match(bundles, /bundleImageList/);
  assert.match(bundles, /catalogSkuImageSummary/);
  assert.match(bundles, /data-image-status=\{imageSummary\.status\}/);

  const editor = read("apps/web/src/features/catalog/catalog-product-editor-page.tsx");
  const preview = read("apps/web/src/features/catalog/catalog-product-image-preview.tsx");
  assert.match(editor, /CatalogProductImagePreview/);
  assert.match(preview, /catalogSkuImageRefs/);
  assert.match(preview, /CatalogProductImage/);
  assert.match(preview, /imageRefs\.slice\(1,\s*5\)/);

  const repairList = read("apps/web/src/features/catalog/catalog-repair-page.tsx");
  const repairDetail = read("apps/web/src/features/catalog/catalog-repair-detail-page.tsx");
  assert.match(repairList, /imageIssueCount/);
  assert.match(repairList, /图片问题/);
  assert.match(repairDetail, /CatalogRepairImagePanel/);
  assert.match(repairDetail, /repairImageIssues/);
  assert.match(repairDetail, /mainImagePath/);
  assert.match(repairDetail, /angleImages/);
  assert.match(repairDetail, /\/catalog\/editor\?sku=/);
  assert.match(repairDetail, /data-action-id="catalog-repair-open-image-editor"/);
  assert.match(repairDetail, /图片问题请打开商品编辑页补图/);
});

test("catalog image layout has stable desktop and mobile dimensions", () => {
  const css = read("apps/web/src/features/catalog/catalog-pages.module.css");
  for (const selector of [
    ".productImageGrid",
    ".productImage",
    ".productImagePlaceholder",
    ".productDetailLayout",
    ".productAngleGrid",
    ".candidateImageGrid",
    ".candidateImageButton",
    ".bundleSelectionBoard",
    ".bundleSelectionList",
    ".productImagePreview",
    ".productImagePreviewGrid",
    ".imageRepairPanel",
    ".primaryLink",
    ".bundleImageList",
  ]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /aspect-ratio:\s*4\s*\/\s*3/);
  assert.match(css, /aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /productDetailLayout/);
  assert.match(css, /productImagePreviewGrid/);
  assert.match(css, /bundleSelectionList/);
  assert.match(css, /\.candidateImageGrid,\s*\.bundleSelectionList/);
  assert.match(css, /productImageLoading\s*\{\s*opacity:\s*1/);
  assert.match(css, /data-image-state="invalid"/);
  assert.match(css, /data-image-state="failed"/);
  assert.match(css, /data-image-status="ready"/);
  assert.match(css, /data-image-status="missing"/);
  assert.match(css, /data-image-status="invalid"/);
});

test("screenshot tool executes evaluate files for visual acceptance scripts", () => {
  const tool = read("tools/capture-page-screenshot.js");
  assert.match(tool, /camelCaseOption/);
  assert.match(tool, /evaluateFile/);
  assert.match(tool, /afterEvaluateDelay/);
  assert.match(tool, /exception\.description/);
  assert.match(tool, /replace\(\/-\(\[a-z\]\)\/g/);

  const productsEval = read("tools/catalog-products-screenshot-eval.js");
  const selectedBundleEval = read("tools/catalog-bundles-selected-screenshot-eval.js");
  const importReadinessEval = read("tools/catalog-import-readiness-screenshot-eval.js");
  assert.match(productsEval, /__catalogProductsScreenshotEval/);
  assert.match(productsEval, /data-image-state/);
  assert.match(productsEval, /data-image-status/);
  assert.match(selectedBundleEval, /__catalogBundleSelectedScreenshotEval/);
  assert.match(selectedBundleEval, /selectedImageStates/);
  assert.match(selectedBundleEval, /resultImageStates/);
  assert.match(importReadinessEval, /__catalogImportReadinessScreenshotEval/);
  assert.match(importReadinessEval, /catalog-import-image-coverage/);
  assert.match(importReadinessEval, /catalog-import-bundle-readiness/);
});

test("renderable image src rejects unsafe or non-image catalog references", () => {
  require("ts-node").register({
    transpileOnly: true,
    compilerOptions: { module: "CommonJS" },
  });
  const { safeRenderableImageSrc, hasUnsupportedRenderableImageExtension } = require("../apps/web/src/lib/renderable-image-src");

  assert.equal(safeRenderableImageSrc("https://app.zhenxiai.cloud/local/sku.png"), "https://app.zhenxiai.cloud/local/sku.png");
  assert.equal(safeRenderableImageSrc("/api/assets/local-file?path=E%3A%5Cstorage%5Cassets%5Csku%5CBOX-A%5Cmain.png"), "/api/assets/local-file?path=E%3A%5Cstorage%5Cassets%5Csku%5CBOX-A%5Cmain.png");
  assert.equal(safeRenderableImageSrc("http://example.test/sku.png"), "");
  assert.equal(safeRenderableImageSrc("E:\\catalog\\sku.txt"), "");
  assert.equal(hasUnsupportedRenderableImageExtension("/api/assets/local-file?path=E%3A%5Ccatalog%5Csku.txt"), true);
});
