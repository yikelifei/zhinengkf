"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { appConfig } = require("../apps/api/src/shared/app-config");
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const {
  fingerprintImageBytes,
  fingerprintImageFile,
  readBoundedRegularFile,
} = require("../apps/api/src/shared/image-fingerprint");
const {
  MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES,
  storeWechatWorkInboundImage,
} = require("../apps/api/src/wechat-work/wechat-work-inbound-media");

async function gradientPng(reverse = false) {
  const row = Array.from({ length: 9 }, (_, index) => reverse ? 255 - index * 24 : index * 24);
  const pixels = Buffer.from(Array.from({ length: 8 }, () => row).flat());
  return sharp(pixels, { raw: { width: 9, height: 8, channels: 1 } }).png().toBuffer();
}

test("dHash64 v1 uses exact algorithm prefix and deterministic 64-bit XOR material", async () => {
  const ascending = await fingerprintImageBytes(await gradientPng());
  const descending = await fingerprintImageBytes(await gradientPng(true));
  assert.equal(ascending.fingerprint, "dhash64:v1:0000000000000000");
  assert.equal(descending.fingerprint, "dhash64:v1:ffffffffffffffff");
});

test("dHash64 applies EXIF orientation before fingerprinting", async () => {
  const source = await gradientPng();
  const oriented = await sharp(source).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const physicallyRotated = await sharp(source).rotate(90).jpeg().toBuffer();
  assert.equal((await fingerprintImageBytes(oriented)).fingerprint, (await fingerprintImageBytes(physicallyRotated)).fingerprint);
});

test("fingerprint file reads only a bounded regular file", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fingerprint-bound-"));
  const oversized = path.join(temp, "oversized.png");
  fs.writeFileSync(oversized, Buffer.alloc(1025, 1));
  await assert.rejects(() => fingerprintImageFile(oversized, 1024), /byte limit/);
  await assert.rejects(() => fingerprintImageFile(temp, 1024), /regular file/);
  await assert.rejects(() => fingerprintImageBytes(Buffer.alloc(1025), 1024), /byte limit/);
});

test("bounded file read fails closed when the same open file changes during the read", async (t) => {
  const promises = require("node:fs/promises");
  const originalOpen = promises.open;
  t.after(() => { promises.open = originalOpen; });
  let statCalls = 0;
  promises.open = async () => ({
    stat: async () => ({
      isFile: () => true,
      size: statCalls++ === 0 ? 4 : 5,
      mtimeMs: statCalls === 1 ? 1 : 2,
    }),
    read: async (buffer, offset, length) => {
      buffer.fill(1, offset, offset + length);
      return { bytesRead: length };
    },
    close: async () => undefined,
  });
  await assert.rejects(() => readBoundedRegularFile("changing.png", 10), /changed while reading/);
});

test("legacy local and Prisma fingerprints move to legacyIdentityHash instead of matching as perceptual data", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-image-fingerprint-"));
  const file = path.join(temp, "local-store.json");
  fs.writeFileSync(file, JSON.stringify({
    designImages: [{ id: "image-1", imageId: "candidate-1", designJobId: "job-1", fingerprint: "abcdef0123456789" }],
  }));
  const store = new LocalStoreService();
  store.filePath = file;
  store.getDesignJob("missing");
  const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(persisted.designImages[0].fingerprint, undefined);
  assert.equal(persisted.designImages[0].legacyIdentityHash, "abcdef0123456789");

  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260719210000_design_image_perceptual_hash", "migration.sql"), "utf8");
  assert.match(migration, /"legacyIdentityHash" = COALESCE\("legacyIdentityHash", "fingerprint"\)/);
  assert.match(migration, /"fingerprint" = NULL/);
  assert.match(migration, /!~ '\^dhash64:v1:/);
});

test("inbound storage is deterministic, concurrent-idempotent, and leaves no temp files", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-media-store-"));
  appConfig.localStorageRoot = path.join(temp, "storage");
  fs.mkdirSync(appConfig.localStorageRoot, { recursive: true });
  const bytes = await gradientPng();
  const media = { bytes, size: bytes.length, contentType: "image/png" };
  const results = await Promise.all([
    storeWechatWorkInboundImage({ msgid: "msg/one", mediaId: "media?id=1", media }),
    storeWechatWorkInboundImage({ msgid: "msg/one", mediaId: "media?id=1", media }),
  ]);
  assert.equal(results[0].localPath, results[1].localPath);
  assert.equal(results[0].fingerprint, "dhash64:v1:0000000000000000");
  const files = fs.readdirSync(path.dirname(results[0].localPath));
  assert.deepEqual(files, [path.basename(results[0].localPath)]);

  const replay = await storeWechatWorkInboundImage({ msgid: "msg/one", mediaId: "media?id=1", media });
  assert.equal(replay.localPath, results[0].localPath);
  assert.deepEqual(fs.readdirSync(path.dirname(replay.localPath)), [path.basename(replay.localPath)]);
});

test("inbound storage never overwrites a conflicting deterministic media identity", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-media-conflict-"));
  appConfig.localStorageRoot = path.join(temp, "storage");
  fs.mkdirSync(appConfig.localStorageRoot, { recursive: true });
  const firstBytes = await gradientPng();
  const first = await storeWechatWorkInboundImage({
    msgid: "msg-conflict",
    mediaId: "media-conflict",
    media: { bytes: firstBytes, size: firstBytes.length, contentType: "image/png" },
  });
  const before = fs.readFileSync(first.localPath);
  const differentBytes = await gradientPng(true);
  await assert.rejects(
    () => storeWechatWorkInboundImage({
      msgid: "msg-conflict",
      mediaId: "media-conflict",
      media: { bytes: differentBytes, size: differentBytes.length, contentType: "image/png" },
    }),
    /identity conflicts/,
  );
  assert.deepEqual(fs.readFileSync(first.localPath), before);
});

test("inbound storage rejects over-limit bytes and a storage-root symlink escape", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-media-symlink-"));
  appConfig.localStorageRoot = path.join(temp, "storage");
  fs.mkdirSync(appConfig.localStorageRoot, { recursive: true });
  await assert.rejects(
    () => storeWechatWorkInboundImage({
      msgid: "oversized",
      mediaId: "oversized",
      media: {
        bytes: Buffer.alloc(MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES + 1),
        size: MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES + 1,
        contentType: "image/png",
      },
    }),
    /2 MB/,
  );

  const outside = path.join(temp, "outside");
  fs.mkdirSync(outside);
  try {
    fs.symlinkSync(outside, path.join(appConfig.localStorageRoot, "wechat-work"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error.code === "EPERM") return t.skip("symlink creation is not permitted on this Windows host");
    throw error;
  }
  const bytes = await gradientPng();
  await assert.rejects(
    () => storeWechatWorkInboundImage({
      msgid: "escape",
      mediaId: "escape",
      media: { bytes, size: bytes.length, contentType: "image/png" },
    }),
    /LOCAL_STORAGE_ROOT/,
  );
});
