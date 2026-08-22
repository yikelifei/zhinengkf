"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const desktopRoot = path.resolve(__dirname, "..");
const sourceStorePath = resolveArgPath("--source-store", path.join(desktopRoot, ".runtime-stable", "local-store.json"));
const targetStorePath = resolveArgPath("--target-store", path.join(desktopRoot, ".runtime", "local-store.json"));
const sourceStorageRoot = resolveArgPath("--source-storage", path.join(desktopRoot, ".runtime-stable", "storage"));
const targetStorageRoot = resolveArgPath("--target-storage", path.join(desktopRoot, ".runtime", "storage"));
const apply = process.argv.includes("--apply");
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleep(ms) {
  Atomics.wait(sleepBuffer, 0, 0, ms);
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents, "utf8").digest("hex");
}

function resolveArgPath(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = String(process.argv[index + 1] || "").trim();
  if (!value) throw new Error(`${name} requires a path`);
  return path.resolve(value);
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

function rewriteStoragePath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const sourceRoot = path.resolve(sourceStorageRoot);
  const targetRoot = path.resolve(targetStorageRoot);
  const resolved = path.resolve(text);
  const relative = path.relative(sourceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return text;
  return path.join(targetRoot, relative);
}

function stableComparable(value) {
  if (Array.isArray(value)) return value.map(stableComparable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== "updatedAt")
      .sort()
      .map((key) => [key, stableComparable(value[key])]),
  );
}

function isSameImportedSku(left, right) {
  return JSON.stringify(stableComparable(left)) === JSON.stringify(stableComparable(right));
}

function normalizeImportedSku(sku) {
  return {
    ...sku,
    mainImagePath: rewriteStoragePath(sku.mainImagePath),
    imageUrl: rewriteStoragePath(sku.imageUrl),
    angleImages: Array.isArray(sku.angleImages) ? sku.angleImages.map(rewriteStoragePath).filter(Boolean) : [],
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function importedSkus(store) {
  return (Array.isArray(store.skus) ? store.skus : []).filter((sku) => String(sku.skuCode || "").startsWith("SRC-"));
}

function copyImportedImagesIfNeeded() {
  const sourceDir = path.join(sourceStorageRoot, "assets", "sku-import-20260811");
  const targetDir = path.join(targetStorageRoot, "assets", "sku-import-20260811");
  if (!fs.existsSync(sourceDir)) return { sourceDir, targetDir, copied: false, reason: "source_missing" };
  if (fs.existsSync(targetDir)) return { sourceDir, targetDir, copied: false, reason: "target_exists" };
  if (!apply) return { sourceDir, targetDir, copied: false, reason: "dry_run" };
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  return { sourceDir, targetDir, copied: true, reason: "copied" };
}

function main() {
  const sourceStore = readJson(sourceStorePath);
  const sourceImported = importedSkus(sourceStore);
  if (!sourceImported.length) throw new Error("source store has no SRC- imported SKUs");

  const imageCopy = copyImportedImagesIfNeeded();
  const lock = acquireStoreLock(targetStorePath);
  let result;
  try {
    lock.assertOwned();
    const beforeRaw = fs.readFileSync(targetStorePath, "utf8");
    const targetStore = JSON.parse(beforeRaw);
    if (!Array.isArray(targetStore.skus)) throw new Error("target store has no skus array");
    if (!Array.isArray(targetStore.reviewLogs)) targetStore.reviewLogs = [];

    const now = new Date().toISOString();
    const bySkuCode = new Map(targetStore.skus.map((sku, index) => [String(sku.skuCode || ""), { sku, index }]));
    let createdCount = 0;
    let updatedCount = 0;
    let matchedCount = 0;
    const samples = [];
    for (const sourceSku of sourceImported) {
      const next = normalizeImportedSku(sourceSku);
      const existing = bySkuCode.get(String(next.skuCode || ""));
      if (existing) {
        const merged = { ...existing.sku, ...next, id: existing.sku.id || next.id };
        if (isSameImportedSku(existing.sku, merged)) {
          matchedCount += 1;
        } else {
          targetStore.skus[existing.index] = { ...merged, updatedAt: now };
          updatedCount += 1;
        }
      } else {
        targetStore.skus.push({ ...next, updatedAt: next.updatedAt || now });
        createdCount += 1;
      }
      if (samples.length < 10) {
        samples.push({
          skuCode: next.skuCode,
          name: next.name,
          salePrice: next.salePrice,
          mainImagePath: next.mainImagePath,
          imageExists: next.mainImagePath ? fs.existsSync(next.mainImagePath) : false,
        });
      }
    }

    const changedSkuCount = createdCount + updatedCount;
    const stamp = now.replace(/[:.]/g, "-");
    result = {
      mode: apply ? "applied" : "dry-run",
      sourceStorePath,
      targetStorePath,
      sourceStorageRoot,
      targetStorageRoot,
      imageCopy,
      backupPath: apply && changedSkuCount ? `${targetStorePath}.before-catalog-runtime-sync-${stamp}.bak` : null,
      reportPath: changedSkuCount ? path.join(path.dirname(targetStorePath), `catalog-runtime-sync-${stamp}.json`) : null,
      sourceImportedCount: sourceImported.length,
      createdCount,
      updatedCount,
      matchedCount,
      changedSkuCount,
      targetSkuCountBefore: JSON.parse(beforeRaw).skus.length,
      targetSkuCountAfter: targetStore.skus.length,
      sourceSaleKnownCount: sourceImported.filter((sku) => Number(sku.salePrice) > 0).length,
      sourceImageCount: sourceImported.filter((sku) => String(sku.mainImagePath || "").trim()).length,
      samples,
    };

    if (changedSkuCount) {
      targetStore.reviewLogs.push({
        id: makeId("review"),
        targetType: "sku_catalog",
        targetId: "product-catalog-import-20260811",
        decision: "catalog_import_synced_to_runtime",
        reviewer: "system",
        note: "Synced imported catalog SKUs and local image paths from stable runtime into current runtime store.",
        beforeStatus: "runtime_catalog_missing_import",
        afterStatus: "runtime_catalog_import_synced",
        metadata: {
          source: "sync_catalog_import_to_runtime",
          sourceImportedCount: result.sourceImportedCount,
          createdCount,
          updatedCount,
          sourceSaleKnownCount: result.sourceSaleKnownCount,
          sourceImageCount: result.sourceImageCount,
          reportPath: result.reportPath,
        },
        createdAt: now,
      });
    }
    const afterRaw = changedSkuCount ? `${JSON.stringify(targetStore, null, 2)}\n` : beforeRaw;
    result.beforeHash = sha256(beforeRaw);
    result.afterHash = sha256(afterRaw);
    if (apply && changedSkuCount) {
      fs.writeFileSync(result.backupPath, beforeRaw, { encoding: "utf8", flag: "wx" });
      lock.assertOwned();
      const currentHash = sha256(fs.readFileSync(targetStorePath, "utf8"));
      if (currentHash !== result.beforeHash) throw new Error("target store changed after the transaction began");
      atomicWrite(targetStorePath, afterRaw);
      fs.writeFileSync(result.reportPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
  } finally {
    lock.release();
  }
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();
