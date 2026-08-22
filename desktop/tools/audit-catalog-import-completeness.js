"use strict";

const fs = require("fs");
const path = require("path");

const desktopRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(desktopRoot, "..");

const sourcePath = resolveArgPath(
  "--source",
  path.join(workspaceRoot, "outputs", "catalog-audit-20260818", "normalized_catalog.json"),
);
const storePath = resolveArgPath("--store", path.join(desktopRoot, ".runtime", "local-store.json"));
const outDir = resolveArgPath("--out-dir", path.join(workspaceRoot, "outputs", "catalog-audit-20260818"));
const requireViews = Math.max(1, Math.min(9, Number(readArg("--require-views", "3")) || 3));
const write = process.argv.includes("--write");

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = String(process.argv[index + 1] || "").trim();
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function resolveArgPath(name, fallback) {
  return path.resolve(readArg(name, fallback));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function text(value) {
  return String(value ?? "").trim();
}

function hasPositiveNumber(value) {
  return Number(value) > 0;
}

function imageRefs(sku) {
  return [
    text(sku?.mainImagePath),
    ...(Array.isArray(sku?.angleImages) ? sku.angleImages.map(text) : []),
  ].filter(Boolean);
}

function hasDimensions(sku) {
  const dimensions = sku?.dimensions || {};
  if (typeof dimensions === "string") return text(dimensions) !== "";
  if (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) return false;
  return [
    dimensions.lengthCm,
    dimensions.widthCm,
    dimensions.heightCm,
    dimensions.diameterCm,
    dimensions.length,
    dimensions.width,
    dimensions.height,
    dimensions["长"],
    dimensions["宽"],
    dimensions["高"],
  ].some((value) => Number(value) > 0 || text(value) !== "");
}

function fileExists(value) {
  const ref = text(value);
  return ref ? fs.existsSync(ref) : false;
}

function csvEscape(value) {
  const raw = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function writeCsv(filePath, rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function byKey(rows, keySelector) {
  const groups = new Map();
  for (const row of rows) {
    const key = keySelector(row);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function rowFromProduct(product, storeSku, issue) {
  return {
    issue,
    skuCode: product.skuCode,
    name: product.name,
    category: product.category,
    type: product.type,
    sourceSheet: product.sourceSheet,
    sourceCell: product.sourceCell,
    rawPrice: product.rawPrice,
    salePrice: storeSku?.salePrice ?? "",
    dimensions: product.dimensions || "",
    currentDimensions: storeSku?.dimensions ? JSON.stringify(storeSku.dimensions) : "",
    imageId: product.imageId,
    sourceMedia: product.sourceMedia,
    mainImagePath: storeSku?.mainImagePath || "",
    imageExists: storeSku?.mainImagePath ? fileExists(storeSku.mainImagePath) : false,
    angleImageCount: Array.isArray(storeSku?.angleImages) ? storeSku.angleImages.length : 0,
    isActive: storeSku?.isActive === false ? "false" : "true",
    supplyStatus: product.supplyStatus,
    priceStatus: product.priceStatus,
  };
}

function main() {
  const normalized = readJson(sourcePath);
  const sourceProducts = Array.isArray(normalized.products) ? normalized.products : [];
  if (!sourceProducts.length) throw new Error("source normalized catalog has no products");
  const store = readJson(storePath);
  const skus = Array.isArray(store.skus) ? store.skus : [];
  const importedSkus = skus.filter((sku) => text(sku.skuCode).startsWith("SRC-"));
  const storeBySkuCode = new Map(skus.map((sku) => [text(sku.skuCode), sku]));
  const importedBySkuCode = new Map(importedSkus.map((sku) => [text(sku.skuCode), sku]));

  const missingInStore = sourceProducts.filter((product) => !importedBySkuCode.has(text(product.skuCode)));
  const extraImported = importedSkus.filter((sku) => !sourceProducts.some((product) => text(product.skuCode) === text(sku.skuCode)));
  const nonSourceSkus = skus.filter((sku) => !text(sku.skuCode).startsWith("SRC-"));
  const sourcePriceMissing = sourceProducts.filter((product) => !hasPositiveNumber(product.costPrice));
  const storeSaleMissing = sourceProducts.filter((product) => !hasPositiveNumber(storeBySkuCode.get(text(product.skuCode))?.salePrice));
  const dimensionsMissing = sourceProducts.filter((product) => !hasDimensions(storeBySkuCode.get(text(product.skuCode))));
  const sourceImageMissing = sourceProducts.filter((product) => !text(product.sourceMedia));
  const storeMainImageMissing = sourceProducts.filter((product) => !text(storeBySkuCode.get(text(product.skuCode))?.mainImagePath));
  const storeMainImageFileMissing = sourceProducts.filter((product) => {
    const ref = text(storeBySkuCode.get(text(product.skuCode))?.mainImagePath);
    return ref && !fileExists(ref);
  });
  const threeViewMissing = sourceProducts.filter((product) => imageRefs(storeBySkuCode.get(text(product.skuCode))).length < requireViews);

  const sourceMediaGroups = byKey(sourceProducts, (product) => text(product.sourceMedia));
  const sourceDuplicateMediaGroups = [...sourceMediaGroups.entries()].filter(([, rows]) => rows.length > 1);
  const mainPathGroups = byKey(importedSkus, (sku) => text(sku.mainImagePath) ? path.normalize(text(sku.mainImagePath)).toLowerCase() : "");
  const currentDuplicateMainPathGroups = [...mainPathGroups.entries()].filter(([, rows]) => rows.length > 1);
  const duplicateSourceButNoCurrentPath = sourceProducts.filter((product) => {
    const media = text(product.sourceMedia);
    return media && (sourceMediaGroups.get(media)?.length || 0) > 1 && !text(storeBySkuCode.get(text(product.skuCode))?.mainImagePath);
  });

  const issueRows = [
    ...missingInStore.map((product) => rowFromProduct(product, null, "source_sku_missing_in_store")),
    ...sourcePriceMissing.map((product) => rowFromProduct(product, storeBySkuCode.get(text(product.skuCode)), "source_price_missing_or_ambiguous")),
    ...storeSaleMissing.map((product) => rowFromProduct(product, storeBySkuCode.get(text(product.skuCode)), "sale_price_missing_in_store")),
    ...dimensionsMissing.map((product) => rowFromProduct(product, storeBySkuCode.get(text(product.skuCode)), "dimensions_missing")),
    ...sourceImageMissing.map((product) => rowFromProduct(product, storeBySkuCode.get(text(product.skuCode)), "source_main_image_missing")),
    ...storeMainImageMissing.map((product) => rowFromProduct(product, storeBySkuCode.get(text(product.skuCode)), "main_image_path_missing_in_store")),
    ...storeMainImageFileMissing.map((product) => rowFromProduct(product, storeBySkuCode.get(text(product.skuCode)), "main_image_file_missing")),
    ...threeViewMissing.map((product) => rowFromProduct(product, storeBySkuCode.get(text(product.skuCode)), "three_view_missing")),
    ...extraImported.map((sku) => ({
      issue: "imported_sku_not_in_source",
      skuCode: sku.skuCode,
      name: sku.name,
      category: sku.category,
      type: sku.type,
      sourceSheet: "",
      sourceCell: "",
      rawPrice: "",
      salePrice: sku.salePrice,
      dimensions: "",
      currentDimensions: sku.dimensions ? JSON.stringify(sku.dimensions) : "",
      imageId: "",
      sourceMedia: "",
      mainImagePath: sku.mainImagePath || "",
      imageExists: sku.mainImagePath ? fileExists(sku.mainImagePath) : false,
      angleImageCount: Array.isArray(sku.angleImages) ? sku.angleImages.length : 0,
      isActive: sku.isActive === false ? "false" : "true",
      supplyStatus: "",
      priceStatus: "",
    })),
    ...nonSourceSkus.map((sku) => ({
      issue: "non_source_sku",
      skuCode: sku.skuCode,
      name: sku.name,
      category: sku.category,
      type: sku.type,
      sourceSheet: "",
      sourceCell: "",
      rawPrice: "",
      salePrice: sku.salePrice,
      dimensions: "",
      currentDimensions: sku.dimensions ? JSON.stringify(sku.dimensions) : "",
      imageId: "",
      sourceMedia: "",
      mainImagePath: sku.mainImagePath || "",
      imageExists: sku.mainImagePath ? fileExists(sku.mainImagePath) : false,
      angleImageCount: Array.isArray(sku.angleImages) ? sku.angleImages.length : 0,
      isActive: sku.isActive === false ? "false" : "true",
      supplyStatus: "",
      priceStatus: "",
    })),
  ];

  const summary = {
    sourcePath,
    storePath,
    requireViews,
    sourceProductCount: sourceProducts.length,
    currentSkuCount: skus.length,
    importedSkuCount: importedSkus.length,
    missingInStoreCount: missingInStore.length,
    extraImportedCount: extraImported.length,
    nonSourceSkuCount: nonSourceSkus.length,
    sourcePriceKnownCount: sourceProducts.filter((product) => hasPositiveNumber(product.costPrice)).length,
    sourcePriceMissingOrAmbiguousCount: sourcePriceMissing.length,
    storeSaleKnownCount: sourceProducts.length - storeSaleMissing.length,
    storeSaleMissingCount: storeSaleMissing.length,
    sourceDimensionKnownCount: sourceProducts.filter((product) => text(product.dimensions)).length,
    storeDimensionKnownCount: sourceProducts.length - dimensionsMissing.length,
    storeDimensionMissingCount: dimensionsMissing.length,
    sourceImageLocatedCount: sourceProducts.filter((product) => text(product.sourceMedia)).length,
    sourceImageMissingCount: sourceImageMissing.length,
    storeMainImagePathCount: sourceProducts.length - storeMainImageMissing.length,
    storeMainImagePathMissingCount: storeMainImageMissing.length,
    storeMainImageFileMissingCount: storeMainImageFileMissing.length,
    sourceDuplicateMediaGroupCount: sourceDuplicateMediaGroups.length,
    sourceDuplicateMediaExtraUseCount: sourceDuplicateMediaGroups.reduce((count, [, rows]) => count + rows.length - 1, 0),
    currentDuplicateMainPathGroupCount: currentDuplicateMainPathGroups.length,
    duplicateSourceButNoCurrentPathCount: duplicateSourceButNoCurrentPath.length,
    threeViewReadyCount: sourceProducts.length - threeViewMissing.length,
    threeViewMissingCount: threeViewMissing.length,
    inactiveImportedCount: importedSkus.filter((sku) => sku.isActive === false).length,
    unavailableSourceCount: sourceProducts.filter((product) => product.supplyStatus === "缺货/停供").length,
    outputs: {},
  };

  const duplicateRows = sourceDuplicateMediaGroups.flatMap(([sourceMedia, rows]) =>
    rows.map((product) => ({
      sourceMedia,
      duplicateUseCount: rows.length,
      skuCode: product.skuCode,
      name: product.name,
      sourceSheet: product.sourceSheet,
      sourceCell: product.sourceCell,
      mainImagePath: storeBySkuCode.get(text(product.skuCode))?.mainImagePath || "",
      imageExists: fileExists(storeBySkuCode.get(text(product.skuCode))?.mainImagePath),
    })),
  );

  if (write) {
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const summaryPath = path.join(outDir, `catalog-completeness-audit-${stamp}.json`);
    const issuePath = path.join(outDir, `catalog-completeness-issues-${stamp}.csv`);
    const duplicatesPath = path.join(outDir, `catalog-duplicate-source-images-${stamp}.csv`);
    summary.outputs = { summaryPath, issuePath, duplicatesPath };
    fs.writeFileSync(summaryPath, `${JSON.stringify({ summary, issueSamples: issueRows.slice(0, 50) }, null, 2)}\n`, "utf8");
    writeCsv(issuePath, issueRows, [
      "issue",
      "skuCode",
      "name",
      "category",
      "type",
      "sourceSheet",
      "sourceCell",
      "rawPrice",
      "salePrice",
      "dimensions",
      "currentDimensions",
      "imageId",
      "sourceMedia",
      "mainImagePath",
      "imageExists",
      "angleImageCount",
      "isActive",
      "supplyStatus",
      "priceStatus",
    ]);
    writeCsv(duplicatesPath, duplicateRows, [
      "sourceMedia",
      "duplicateUseCount",
      "skuCode",
      "name",
      "sourceSheet",
      "sourceCell",
      "mainImagePath",
      "imageExists",
    ]);
  }

  console.log(JSON.stringify({ summary, samples: { issues: issueRows.slice(0, 10), duplicateSourceImages: duplicateRows.slice(0, 10) } }, null, 2));
}

main();
