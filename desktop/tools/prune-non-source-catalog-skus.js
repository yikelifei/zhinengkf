"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const desktopRoot = path.resolve(__dirname, "..");
const storePath = resolveArgPath("--store", path.join(desktopRoot, ".runtime", "local-store.json"));
const apply = process.argv.includes("--apply");
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleep(ms) {
  Atomics.wait(sleepBuffer, 0, 0, ms);
}

function resolveArgPath(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = String(process.argv[index + 1] || "").trim();
  if (!value) throw new Error(`${name} requires a path`);
  return path.resolve(value);
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents, "utf8").digest("hex");
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function atomicWrite(filePath, contents) {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
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
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {}
    throw error;
  }
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

function isSourceSku(sku) {
  return String(sku?.skuCode || "").startsWith("SRC-");
}

function main() {
  const lock = acquireStoreLock(storePath);
  let result;
  try {
    lock.assertOwned();
    const beforeRaw = fs.readFileSync(storePath, "utf8");
    const data = JSON.parse(beforeRaw);
    if (!Array.isArray(data.skus)) throw new Error("store has no skus array");
    if (!Array.isArray(data.designAssets)) data.designAssets = [];
    if (!Array.isArray(data.reviewLogs)) data.reviewLogs = [];

    const now = new Date().toISOString();
    const removedSkus = data.skus.filter((sku) => !isSourceSku(sku));
    const removedCodes = new Set(removedSkus.map((sku) => String(sku.skuCode || "")));
    const assetCountBefore = data.designAssets.length;
    data.skus = data.skus.filter(isSourceSku);
    data.designAssets = data.designAssets.filter((asset) =>
      !(String(asset.ownerType || "") === "sku" && removedCodes.has(String(asset.ownerId || ""))),
    );
    const removedAssetCount = assetCountBefore - data.designAssets.length;
    if (removedSkus.length) {
      data.reviewLogs.push({
        id: makeId("review"),
        targetType: "sku_catalog",
        targetId: "non_source_skus",
        decision: "non_source_skus_pruned",
        reviewer: "system",
        note: "Removed non-source demo/manual SKUs from the product catalog while preserving image files on disk.",
        beforeStatus: "catalog_contains_non_source_skus",
        afterStatus: "catalog_source_only",
        metadata: {
          source: "prune_non_source_catalog_skus",
          removedSkuCodes: [...removedCodes],
          removedSkuCount: removedSkus.length,
          removedAssetCount,
        },
        createdAt: now,
      });
    }

    const afterRaw = removedSkus.length ? `${JSON.stringify(data, null, 2)}\n` : beforeRaw;
    const stamp = now.replace(/[:.]/g, "-");
    const backupPath = apply && removedSkus.length ? `${storePath}.before-prune-non-source-skus-${stamp}.bak` : null;
    const reportPath = removedSkus.length ? path.join(path.dirname(storePath), `prune-non-source-skus-${stamp}.json`) : null;
    result = {
      mode: apply ? "applied" : "dry-run",
      storePath,
      backupPath,
      reportPath,
      skuCountBefore: JSON.parse(beforeRaw).skus.length,
      skuCountAfter: data.skus.length,
      removedSkuCount: removedSkus.length,
      removedSkuCodes: removedSkus.map((sku) => sku.skuCode),
      removedAssetCount,
      beforeHash: sha256(beforeRaw),
      afterHash: sha256(afterRaw),
    };

    if (apply && removedSkus.length) {
      fs.writeFileSync(backupPath, beforeRaw, { encoding: "utf8", flag: "wx" });
      lock.assertOwned();
      const currentHash = sha256(fs.readFileSync(storePath, "utf8"));
      if (currentHash !== result.beforeHash) throw new Error("target store changed after the transaction began");
      atomicWrite(storePath, afterRaw);
      fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
  } finally {
    lock.release();
  }
  console.log(JSON.stringify(result, null, 2));
}

main();
