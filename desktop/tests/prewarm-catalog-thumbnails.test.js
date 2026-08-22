"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "tools", "prewarm-catalog-thumbnails.js");
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);

test("catalog thumbnail prewarm generates reusable local cache files", async (t) => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "smart-kefu-thumbnail-prewarm-"));
  t.after(async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });
  const storageRoot = path.join(tempRoot, "storage");
  const assetDir = path.join(storageRoot, "assets", "sku-import-20260811");
  const reportPath = path.join(tempRoot, "report.json");
  const storePath = path.join(tempRoot, "local-store.json");
  const firstImage = path.join(assetDir, "first.png");
  const secondImage = path.join(assetDir, "second.png");
  await fsp.mkdir(assetDir, { recursive: true });
  await fsp.writeFile(firstImage, VALID_PNG);
  await fsp.writeFile(secondImage, VALID_PNG);
  await fsp.writeFile(
    storePath,
    `${JSON.stringify({
      skus: [
        {
          skuCode: "SRC-1",
          mainImagePath: firstImage,
          imageUrl: firstImage,
          angleImages: [secondImage, { localPath: secondImage }, path.join(assetDir, "missing.png")],
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  const first = runPrewarm(storePath, storageRoot, reportPath);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstReport = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(firstReport.uniqueExistingCount, 2);
  assert.equal(firstReport.missingCount, 1);
  assert.equal(firstReport.generatedCount, 4);
  assert.equal(firstReport.skippedCount, 0);
  assert.equal(listCacheFiles(storageRoot).length, 4);

  const second = runPrewarm(storePath, storageRoot, reportPath);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const secondReport = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(secondReport.generatedCount, 0);
  assert.equal(secondReport.skippedCount, 4);
  assert.equal(listCacheFiles(storageRoot).length, 4);
});

function runPrewarm(storePath, storageRoot, reportPath) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      "--store",
      storePath,
      "--storage",
      storageRoot,
      "--sizes",
      "64x64,128x128",
      "--concurrency",
      "1",
      "--progress-every",
      "1",
      "--report",
      reportPath,
    ],
    { cwd: root, encoding: "utf8" },
  );
}

function listCacheFiles(storageRoot) {
  const cacheRoot = path.join(storageRoot, ".cache", "thumbnails");
  if (!fs.existsSync(cacheRoot)) return [];
  const files = [];
  const pending = [cacheRoot];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  return files.sort();
}
