"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { appConfig } = require("../apps/api/src/shared/app-config");
const {
  MAX_WECHAT_WORK_IMAGE_BYTES,
  prepareWechatWorkImageFile,
  resolveWechatWorkImageFile,
} = require("../apps/api/src/wechat-work/wechat-work-media");

test("oversized design image is copied to a deterministic WeChat-safe JPEG while the original stays untouched", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-outbound-image-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  appConfig.localStorageRoot = root;
  const sourceDirectory = path.join(root, "design-jobs", "design_1");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  const sourcePath = path.join(sourceDirectory, "candidate_4.png");
  const width = 1200;
  const height = 1200;
  const raw = crypto.randomBytes(width * height * 3);
  await sharp(raw, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toFile(sourcePath);
  const before = fs.readFileSync(sourcePath);
  assert.ok(before.length > MAX_WECHAT_WORK_IMAGE_BYTES);

  const first = await prepareWechatWorkImageFile(sourcePath);
  const replay = await prepareWechatWorkImageFile(sourcePath);

  assert.equal(first.optimized, true);
  assert.equal(first.contentType, "image/jpeg");
  assert.ok(first.size <= MAX_WECHAT_WORK_IMAGE_BYTES);
  assert.equal(replay.filePath, first.filePath);
  assert.deepEqual(fs.readFileSync(sourcePath), before);
  assert.equal(resolveWechatWorkImageFile(first.filePath).size, first.size);
});
