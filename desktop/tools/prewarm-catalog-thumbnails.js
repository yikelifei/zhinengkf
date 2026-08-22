"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const desktopRoot = path.resolve(__dirname, "..");

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const store = readJson(options.storePath);
  const imagePaths = collectCatalogImagePaths(store);
  const uniqueExisting = [];
  const seen = new Set();
  const missing = [];
  const outsideStorage = [];

  for (const imagePath of imagePaths) {
    const resolved = path.resolve(imagePath);
    let canonicalPath = "";
    try {
      canonicalPath = await fsp.realpath(resolved);
    } catch {
      missing.push(imagePath);
      continue;
    }
    if (!isInsideDirectory(canonicalPath, options.storageRoot)) {
      outsideStorage.push(imagePath);
      continue;
    }
    const key = canonicalPath.toLocaleLowerCase("zh-CN");
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueExisting.push(canonicalPath);
  }

  const candidates = options.limit > 0 ? uniqueExisting.slice(0, options.limit) : uniqueExisting;
  const result = {
    storePath: options.storePath,
    storageRoot: options.storageRoot,
    sizes: options.sizes.map((size) => `${size.width}x${size.height}`),
    dryRun: options.dryRun,
    skuCount: Array.isArray(store.skus) ? store.skus.length : 0,
    imageReferenceCount: imagePaths.length,
    uniqueExistingCount: uniqueExisting.length,
    selectedImageCount: candidates.length,
    missingCount: missing.length,
    outsideStorageCount: outsideStorage.length,
    generatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failures: [],
    startedAt: new Date().toISOString(),
    finishedAt: "",
  };

  const jobs = [];
  for (const imagePath of candidates) {
    for (const size of options.sizes) jobs.push({ imagePath, size });
  }

  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(options.concurrency, Math.max(1, jobs.length)) }, async () => {
    while (nextIndex < jobs.length) {
      const index = nextIndex++;
      const job = jobs[index];
      try {
        const status = await prewarmThumbnail(job.imagePath, options.storageRoot, job.size, options.dryRun);
        if (status === "generated") result.generatedCount += 1;
        else result.skippedCount += 1;
      } catch (error) {
        result.failedCount += 1;
        if (result.failures.length < 20) {
          result.failures.push({
            imagePath: job.imagePath,
            size: `${job.size.width}x${job.size.height}`,
            error: error?.message || String(error),
          });
        }
      }
      const done = result.generatedCount + result.skippedCount + result.failedCount;
      if (done % options.progressEvery === 0 || done === jobs.length) {
        console.log(`[prewarm] ${done}/${jobs.length} generated=${result.generatedCount} skipped=${result.skippedCount} failed=${result.failedCount}`);
      }
    }
  });
  await Promise.all(workers);
  result.finishedAt = new Date().toISOString();

  if (options.reportPath) {
    await fsp.mkdir(path.dirname(options.reportPath), { recursive: true });
    await fsp.writeFile(options.reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.failedCount > 0) process.exitCode = 1;
}

function parseOptions(args) {
  const storePath = resolveArgPath(args, "--store", path.join(desktopRoot, ".runtime-stable", "local-store.json"));
  const storageRoot = resolveArgPath(args, "--storage", path.join(desktopRoot, ".runtime-stable", "storage"));
  const reportPath = optionalArgPath(args, "--report");
  return {
    storePath,
    storageRoot,
    reportPath,
    sizes: parseSizes(argValue(args, "--sizes") || "360x270,128x128"),
    concurrency: clampNumber(argValue(args, "--concurrency"), 1, 8, 3),
    progressEvery: clampNumber(argValue(args, "--progress-every"), 10, 1000, 250),
    limit: clampNumber(argValue(args, "--limit"), 0, 1_000_000, 0),
    dryRun: args.includes("--dry-run"),
  };
}

function argValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  const value = String(args[index + 1] || "").trim();
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function resolveArgPath(args, name, fallback) {
  const value = argValue(args, name);
  return path.resolve(value || fallback);
}

function optionalArgPath(args, name) {
  const value = argValue(args, name);
  return value ? path.resolve(value) : "";
}

function clampNumber(value, min, max, fallback) {
  const numeric = Math.floor(Number(value || fallback));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function parseSizes(value) {
  const sizes = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = /^(\d+)x(\d+)$/i.exec(item);
      if (!match) throw new Error(`invalid thumbnail size: ${item}`);
      return {
        width: clampNumber(match[1], 32, 1024, 360),
        height: clampNumber(match[2], 32, 1024, 270),
      };
    });
  if (!sizes.length) throw new Error("at least one thumbnail size is required");
  return sizes;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectCatalogImagePaths(store) {
  const paths = [];
  for (const sku of Array.isArray(store.skus) ? store.skus : []) {
    collectImageValue(sku.mainImagePath, paths);
    collectImageValue(sku.imageUrl, paths);
    collectImageValue(sku.angleImages, paths);
  }
  return paths.filter(Boolean);
}

function collectImageValue(value, paths) {
  if (!value) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || /^https?:\/\//i.test(text) || /^data:/i.test(text)) return;
    paths.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageValue(item, paths);
    return;
  }
  if (typeof value === "object") {
    collectImageValue(value.localPath || value.mainImagePath || value.path || value.src || value.url, paths);
  }
}

function isInsideDirectory(filePath, directoryPath) {
  const root = path.resolve(directoryPath);
  const relative = path.relative(root, path.resolve(filePath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function prewarmThumbnail(imagePath, storageRoot, size, dryRun) {
  const stat = await fsp.stat(imagePath);
  if (!stat.isFile()) throw new Error("image path is not a file");
  const cachePath = thumbnailCachePath(storageRoot, imagePath, stat, size.width, size.height);
  if (fs.existsSync(cachePath)) return "skipped";
  if (dryRun) return "generated";

  const thumbnail = await sharp(imagePath, { animated: false, limitInputPixels: 100_000_000 })
    .rotate()
    .resize(size.width, size.height, { fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .webp({ quality: 75, effort: 4 })
    .toBuffer();
  await writeFileAtomic(cachePath, thumbnail);
  return "generated";
}

function thumbnailCachePath(storageRoot, canonicalPath, stat, width, height) {
  const root = path.resolve(storageRoot);
  const relative = path.relative(root, canonicalPath).toLocaleLowerCase("zh-CN");
  const key = crypto.createHash("sha256")
    .update(["v1", relative, String(stat.size), String(Math.floor(stat.mtimeMs)), String(width), String(height)].join("\n"))
    .digest("hex");
  return path.join(root, ".cache", "thumbnails", key.slice(0, 2), `${key}.webp`);
}

async function writeFileAtomic(filePath, buffer) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, buffer);
  try {
    await fsp.rename(tempPath, filePath);
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
  }
}
