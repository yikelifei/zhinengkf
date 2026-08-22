"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const workspaceRoot = path.resolve(__dirname, "../..");
const defaultSourcePath = path.join(workspaceRoot, "outputs", "product-catalog-import-20260811", "normalized_catalog.json");
const defaultStorePath = path.join(workspaceRoot, "desktop", ".runtime-stable", "local-store.json");
const apply = process.argv.includes("--apply");
const fillSalePrice = process.argv.includes("--fill-sale-price");
const sourcePath = resolveArgPath("--source", defaultSourcePath);
const storePath = resolveArgPath("--store", defaultStorePath);
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleep(ms) {
  Atomics.wait(sleepBuffer, 0, 0, ms);
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents, "utf8").digest("hex");
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function resolveArgPath(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = String(process.argv[index + 1] || "").trim();
  if (!value) throw new Error(`${name} requires a path`);
  return path.resolve(value);
}

function removeOwnedDirectory(directoryPath, ownerFileName) {
  try {
    fs.unlinkSync(path.join(directoryPath, ownerFileName));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    fs.rmdirSync(directoryPath);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error.code || ""))) throw error;
  }
}

function acquireStoreLock(filePath) {
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + 3_000;
  while (true) {
    const ownerToken = crypto.randomUUID();
    const ownerFileName = `owner-${ownerToken}.json`;
    const pendingPath = `${lockPath}.pending-${process.pid}-${ownerToken}`;
    fs.mkdirSync(pendingPath);
    fs.writeFileSync(
      path.join(pendingPath, ownerFileName),
      JSON.stringify({ ownerToken, pid: process.pid, acquiredAt: new Date().toISOString() }),
      { encoding: "utf8", flag: "wx" },
    );
    try {
      fs.renameSync(pendingPath, lockPath);
      let released = false;
      const ownerPath = path.join(lockPath, ownerFileName);
      return {
        assertOwned() {
          if (released || !fs.existsSync(ownerPath)) throw new Error("local store lock ownership was lost");
        },
        release() {
          if (released) return;
          released = true;
          removeOwnedDirectory(lockPath, ownerFileName);
        },
      };
    } catch (error) {
      removeOwnedDirectory(pendingPath, ownerFileName);
      if (!["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(String(error.code || ""))) throw error;
    }
    if (Date.now() >= deadline) throw new Error("local store transaction lock timed out");
    sleep(20);
  }
}

function atomicWrite(filePath, contents) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, contents, "utf8");
    const descriptor = fs.openSync(tempPath, "r");
    try {
      try {
        fs.fsyncSync(descriptor);
      } catch (error) {
        if (!["EPERM", "EINVAL", "ENOTSUP"].includes(String(error.code || ""))) throw error;
      }
    } finally {
      fs.closeSync(descriptor);
    }
    const deadline = Date.now() + 3_000;
    while (true) {
      try {
        fs.renameSync(tempPath, filePath);
        break;
      } catch (error) {
        if (!["EPERM", "EACCES", "EBUSY"].includes(String(error.code || "")) || Date.now() >= deadline) throw error;
        sleep(20);
      }
    }
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {}
    throw error;
  }
}

function text(value) {
  const next = String(value ?? "").trim();
  return next || undefined;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function parseDimensions(value) {
  const input = String(value || "").trim();
  if (!input) return {};
  const match = input.match(/^([0-9]+(?:\.[0-9]+)?)\s*[xX*×]\s*([0-9]+(?:\.[0-9]+)?)(?:\s*[xX*×]\s*([0-9]+(?:\.[0-9]+)?))?\s*(?:cm|厘米)?$/i);
  if (!match) return {};
  const result = { lengthCm: Number(match[1]), widthCm: Number(match[2]) };
  if (match[3] !== undefined) result.heightCm = Number(match[3]);
  return result;
}

function hasDimensions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return ["lengthCm", "widthCm", "heightCm", "length", "width", "height", "diameterCm"].some((key) => {
    const number = Number(value[key]);
    return Number.isFinite(number) && number > 0;
  });
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined || item === null) return false;
      if (typeof item === "string" && !item.trim()) return false;
      if (Array.isArray(item) && item.length === 0) return false;
      return true;
    }),
  );
}

function splitIssues(value) {
  return String(value || "")
    .split(/[;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function sameValue(left, right) {
  return stableJson(left ?? null) === stableJson(right ?? null);
}

function sourcePrice(product) {
  return finitePositive(product.salePrice) || finitePositive(product.costPrice);
}

function buildCatalogImportFacts(product, source, options = {}) {
  const price = sourcePrice(product);
  return compactObject({
    version: 1,
    importBatch: "product-catalog-import-20260811",
    sourceFileName: text(source?.source?.fileName),
    sourceSheet: text(product.sourceSheet),
    sourceCell: text(product.sourceCell),
    skuCode: text(product.skuCode),
    rawPrice: text(product.rawPrice),
    rawNote: text(product.rawNote),
    originalDimensions: text(product.dimensions),
    imageId: text(product.imageId),
    sourceMedia: text(product.sourceMedia),
    imageStatus: text(product.imageStatus),
    supplyStatus: text(product.supplyStatus),
    priceStatus: text(product.priceStatus),
    initialReviewStatus: text(product.initialReviewStatus),
    issues: splitIssues(product.issues),
    costPriceSource: finitePositive(product.costPrice) ? "normalized_catalog.costPrice" : undefined,
    dimensionsSource: text(product.dimensions) ? "normalized_catalog.dimensions" : undefined,
    salePriceSource: options.fillSalePrice && price ? "normalized_catalog.price" : undefined,
    salePriceStatus: options.fillSalePrice && price ? "source_price_filled" : finitePositive(product.salePrice) ? "source_confirmed" : "pending_pricing_rule",
    stockStatus: finitePositive(product.stock) ? "source_confirmed" : "pending_inventory_confirmation",
  });
}

function trackedSnapshot(sku) {
  return {
    costPrice: sku.costPrice ?? null,
    salePrice: sku.salePrice ?? null,
    dimensions: sku.dimensions ?? null,
    matchingRules: sku.matchingRules ?? null,
  };
}

function buildReviewLog(result, now) {
  return {
    id: makeId("review"),
    targetType: "sku_catalog",
    targetId: "product-catalog-import-20260811",
    decision: "catalog_existing_facts_filled",
    reviewer: "system",
    note: result.salePriceChangedCount > 0
      ? "Attached normalized catalog source facts and filled salePrice from user-confirmed source prices without changing stock or activation state."
      : "Attached normalized catalog source facts to existing SKU records without changing sale price, stock, or activation state.",
    beforeStatus: "source_facts_missing",
    afterStatus: "source_facts_attached",
    metadata: {
      source: "fill_existing_catalog_facts",
      sourcePath,
      storePath,
      matchedSkuCount: result.matchedSkuCount,
      changedSkuCount: result.changedSkuCount,
      metadataUpdatedCount: result.metadataUpdatedCount,
      costBackfillCount: result.costBackfillCount,
      dimensionsBackfillCount: result.dimensionsBackfillCount,
      salePriceChangedCount: result.salePriceChangedCount,
      stockChangedCount: 0,
      activeStateChangedCount: 0,
      reportPath: result.reportPath || null,
    },
    createdAt: now,
  };
}

function applyExistingFacts(store, source, now) {
  const products = Array.isArray(source.products) ? source.products : [];
  const bySkuCode = new Map(products.map((product) => [String(product.skuCode || "").trim(), product]));
  const result = {
    mode: apply ? "applied" : "dry-run",
    sourcePath,
    storePath,
    backupPath: null,
    reportPath: null,
    matchedSkuCount: 0,
    changedSkuCount: 0,
    metadataUpdatedCount: 0,
    costBackfillCount: 0,
    dimensionsBackfillCount: 0,
    salePriceChangedCount: 0,
    stockChangedCount: 0,
    activeStateChangedCount: 0,
    sourceProductCount: products.length,
    sourceRawPriceCount: products.filter((product) => text(product.rawPrice)).length,
    sourceCostKnownCount: products.filter((product) => finitePositive(product.costPrice)).length,
    sourceSalePriceKnownCount: products.filter((product) => sourcePrice(product)).length,
    sourceDimensionsKnownCount: products.filter((product) => text(product.dimensions)).length,
    changedSamples: [],
    warnings: [],
  };
  if (!Array.isArray(store.skus)) throw new Error("local store has no skus array");
  if (!Array.isArray(store.reviewLogs)) store.reviewLogs = [];

  for (const sku of store.skus) {
    const product = bySkuCode.get(String(sku.skuCode || "").trim());
    if (!product) continue;
    result.matchedSkuCount += 1;
    const before = trackedSnapshot(sku);
    const changedFields = [];
    const sourceCost = finitePositive(product.costPrice);
    if (!finitePositive(sku.costPrice) && sourceCost) {
      changedFields.push({ field: "costPrice", before: sku.costPrice ?? null, after: sourceCost });
      sku.costPrice = sourceCost;
    }
    const salePrice = sourcePrice(product);
    if (fillSalePrice && !finitePositive(sku.salePrice) && salePrice) {
      changedFields.push({ field: "salePrice", before: sku.salePrice ?? null, after: salePrice });
      sku.salePrice = salePrice;
    }
    const parsedDimensions = parseDimensions(product.dimensions);
    if (!hasDimensions(sku.dimensions) && Object.keys(parsedDimensions).length) {
      changedFields.push({ field: "dimensions", before: sku.dimensions ?? null, after: parsedDimensions });
      sku.dimensions = parsedDimensions;
    }
    const existingRules = sku.matchingRules && typeof sku.matchingRules === "object" && !Array.isArray(sku.matchingRules)
      ? sku.matchingRules
      : {};
    const existingCatalogImport = existingRules.catalogImport && typeof existingRules.catalogImport === "object" && !Array.isArray(existingRules.catalogImport)
      ? existingRules.catalogImport
      : {};
    const catalogImport = { ...existingCatalogImport, ...buildCatalogImportFacts(product, source, { fillSalePrice }) };
    const nextRules = { ...existingRules, catalogImport };
    if (!sameValue(existingRules, nextRules)) {
      changedFields.push({ field: "matchingRules", before: sku.matchingRules ?? null, after: nextRules });
      sku.matchingRules = nextRules;
    }
    if (!changedFields.length) continue;
    sku.updatedAt = now;
    result.changedSkuCount += 1;
    if (changedFields.some((item) => item.field === "matchingRules")) result.metadataUpdatedCount += 1;
    if (changedFields.some((item) => item.field === "costPrice")) result.costBackfillCount += 1;
    if (changedFields.some((item) => item.field === "salePrice")) result.salePriceChangedCount += 1;
    if (changedFields.some((item) => item.field === "dimensions")) result.dimensionsBackfillCount += 1;
    if (result.changedSamples.length < 12) {
      result.changedSamples.push({
        skuCode: sku.skuCode,
        name: sku.name,
        fields: changedFields.map((item) => item.field),
        before,
        after: trackedSnapshot(sku),
      });
    }
  }

  const missingLocalSkus = products
    .map((product) => String(product.skuCode || "").trim())
    .filter((skuCode) => skuCode && !store.skus.some((sku) => String(sku.skuCode || "").trim() === skuCode));
  if (missingLocalSkus.length) {
    result.warnings.push({
      code: "source_sku_missing_from_local_store",
      count: missingLocalSkus.length,
      samples: missingLocalSkus.slice(0, 10),
    });
  }
  return result;
}

function main() {
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  if (!Array.isArray(source.products) || !source.products.length) {
    throw new Error("normalized catalog source has no products");
  }

  const lock = acquireStoreLock(storePath);
  let result;
  try {
    lock.assertOwned();
    const beforeRaw = fs.readFileSync(storePath, "utf8");
    const store = JSON.parse(beforeRaw);
    const now = new Date().toISOString();
    result = applyExistingFacts(store, source, now);
    if (result.changedSkuCount > 0) {
      const stamp = now.replace(/[:.]/g, "-");
      result.backupPath = apply ? `${storePath}.before-existing-catalog-facts-${stamp}.bak` : null;
      result.reportPath = path.join(path.dirname(storePath), `catalog-existing-facts-fill-${stamp}.json`);
      store.reviewLogs.push(buildReviewLog(result, now));
    }
    const afterRaw = result.changedSkuCount > 0 ? `${JSON.stringify(store, null, 2)}\n` : beforeRaw;
    result.beforeHash = sha256(beforeRaw);
    result.afterHash = sha256(afterRaw);
    result.beforeSkuCount = JSON.parse(beforeRaw).skus.length;
    result.afterSkuCount = store.skus.length;
    if (apply && result.changedSkuCount > 0) {
      fs.writeFileSync(result.backupPath, beforeRaw, { encoding: "utf8", flag: "wx" });
      lock.assertOwned();
      const currentHash = sha256(fs.readFileSync(storePath, "utf8"));
      if (currentHash !== result.beforeHash) throw new Error("local store changed after the transaction began");
      atomicWrite(storePath, afterRaw);
      fs.writeFileSync(result.reportPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
  } finally {
    lock.release();
  }
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();

module.exports = {
  applyExistingFacts,
  buildCatalogImportFacts,
  parseDimensions,
};
