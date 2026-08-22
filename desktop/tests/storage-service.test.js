"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { appConfig } = require("../apps/api/src/shared/app-config");
const { MAX_IMAGE_FINGERPRINT_BYTES } = require("../apps/api/src/shared/image-fingerprint");
const { StorageService } = require("../apps/api/src/storage/storage.service");

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);
const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34", family: 4 }];

async function storageFixture(t) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "smart-kefu-storage-assets-"));
  const originalRoot = appConfig.localStorageRoot;
  appConfig.localStorageRoot = tempRoot;
  t.after(async () => {
    appConfig.localStorageRoot = originalRoot;
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });
  return tempRoot;
}

async function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  return files.sort();
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("asset base64 ingestion is strict and rejected payloads never reach disk", async (t) => {
  const service = new StorageService();
  const tempRoot = await storageFixture(t);
  const invalidValues = [
    "",
    "not base64",
    "AAAA=",
    "AA=A",
    "data:text/plain,hello",
    "data:text/plain;base64,%%%",
    "data:text/plain;base64,AAAA\n",
  ];

  for (const base64 of invalidValues) {
    await assert.rejects(
      () => service.saveAssetFromBase64({ ownerType: "customer", ownerId: "c1", fileName: "bad.bin", base64 }),
      (error) => error?.getStatus?.() === 400,
    );
  }
  assert.deepEqual(await listFiles(tempRoot), []);
});

test("local image thumbnails are bounded WebP derivatives of stored assets", async (t) => {
  const service = new StorageService();
  const tempRoot = await storageFixture(t);
  const saved = await service.saveAssetFromBase64({
    ownerType: "sku",
    ownerId: "BOX-A",
    fileName: "main.png",
    mimeType: "image/png",
    base64: VALID_PNG.toString("base64"),
  });

  const thumbnail = await service.readLocalImageThumbnail(saved.localPath, { width: 128, height: 96 });
  const bytes = await streamToBuffer(thumbnail.stream);

  assert.equal(thumbnail.mimeType, "image/webp");
  assert.equal(thumbnail.inlineSafe, true);
  assert.match(thumbnail.fileName, /main-thumb\.webp$/);
  assert.equal(bytes.length, thumbnail.sizeBytes);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");

  const cacheFiles = (await listFiles(tempRoot)).filter((file) => file.includes(`${path.sep}.cache${path.sep}thumbnails${path.sep}`));
  assert.equal(cacheFiles.length, 1);

  const cachedThumbnail = await service.readLocalImageThumbnail(saved.localPath, { width: 128, height: 96 });
  const cachedBytes = await streamToBuffer(cachedThumbnail.stream);
  assert.equal(cachedThumbnail.mimeType, "image/webp");
  assert.equal(cachedThumbnail.sizeBytes, thumbnail.sizeBytes);
  assert.deepEqual(cachedBytes, bytes);
  assert.equal((await listFiles(tempRoot)).filter((file) => file.includes(`${path.sep}.cache${path.sep}thumbnails${path.sep}`)).length, 1);
});

test("base64 and UTF-8 text assets share the exact byte boundary before writing", async (t) => {
  const service = new StorageService();
  const tempRoot = await storageFixture(t);
  const boundary = Buffer.alloc(MAX_IMAGE_FINGERPRINT_BYTES, 0x61);

  const base64Saved = await service.saveAssetFromBase64({
    ownerType: "customer",
    ownerId: "c1",
    fileName: "boundary.txt",
    base64: `data:text/plain;base64,${boundary.toString("base64")}`,
  });
  const textSaved = await service.saveAssetFromText({
    ownerType: "customer",
    ownerId: "c1",
    fileName: "boundary.txt",
    text: "a".repeat(MAX_IMAGE_FINGERPRINT_BYTES),
  });
  assert.equal(base64Saved.sizeBytes, MAX_IMAGE_FINGERPRINT_BYTES);
  assert.equal(textSaved.sizeBytes, MAX_IMAGE_FINGERPRINT_BYTES);
  assert.equal((await listFiles(tempRoot)).length, 2);

  await assert.rejects(
    () =>
      service.saveAssetFromBase64({
        ownerType: "customer",
        ownerId: "c1",
        fileName: "too-large.txt",
        base64: Buffer.alloc(MAX_IMAGE_FINGERPRINT_BYTES + 1).toString("base64"),
      }),
    (error) => error?.getStatus?.() === 400 && /maximum size/.test(error.message),
  );
  await assert.rejects(
    () =>
      service.saveAssetFromText({
        ownerType: "customer",
        ownerId: "c1",
        fileName: "too-large.txt",
        text: "a".repeat(MAX_IMAGE_FINGERPRINT_BYTES + 1),
      }),
    (error) => error?.getStatus?.() === 400 && /maximum size/.test(error.message),
  );
  assert.equal((await listFiles(tempRoot)).length, 2);
});

test("asset URL ingestion rejects non-http schemes before axios or disk", async (t) => {
  const service = new StorageService();
  const tempRoot = await storageFixture(t);
  let calls = 0;
  const request = async () => {
    calls += 1;
    return { data: Buffer.from("unexpected") };
  };

  for (const url of ["ftp://example.com/a.png", "file:///C:/temp/a.png", "data:image/png;base64,AAAA", "not-a-url"]) {
    await assert.rejects(
      () => service.saveAssetFromUrl({ ownerType: "customer", ownerId: "c1", fileName: "bad.bin", url }, { request }),
      (error) => error?.getStatus?.() === 400 && /http\(s\)/.test(error.message),
    );
  }
  assert.equal(calls, 0);
  assert.deepEqual(await listFiles(tempRoot), []);
});

test("asset URL download uses bounded timeout options and checks bytes again before disk", async (t) => {
  const service = new StorageService();
  const tempRoot = await storageFixture(t);
  const originalTimeout = appConfig.designPlatformTimeoutMs;
  const calls = [];
  appConfig.designPlatformTimeoutMs = 4321;
  const request = async (url, config) => {
    calls.push({ url, config });
    return { data: Buffer.alloc(calls.length === 1 ? MAX_IMAGE_FINGERPRINT_BYTES : MAX_IMAGE_FINGERPRINT_BYTES + 1, 0x61) };
  };
  t.after(() => {
    appConfig.designPlatformTimeoutMs = originalTimeout;
  });

  const saved = await service.saveAssetFromUrl({
    ownerType: "customer",
    ownerId: "c1",
    fileName: "boundary.txt",
    url: "https://cdn.example.com/boundary.bin",
  }, { lookup: PUBLIC_LOOKUP, request });
  assert.equal(saved.sizeBytes, MAX_IMAGE_FINGERPRINT_BYTES);
  assert.equal(calls[0].config.responseType, "arraybuffer");
  assert.equal(calls[0].config.timeout, 4321);
  assert.equal(calls[0].config.maxContentLength, MAX_IMAGE_FINGERPRINT_BYTES);
  assert.equal(calls[0].config.maxBodyLength, MAX_IMAGE_FINGERPRINT_BYTES);
  assert.equal(calls[0].config.maxRedirects, 0);
  assert.equal(calls[0].config.proxy, false);
  assert.ok(calls[0].config.httpsAgent);
  assert.equal((await listFiles(tempRoot)).length, 1);

  await assert.rejects(
    () =>
      service.saveAssetFromUrl({
        ownerType: "customer",
        ownerId: "c1",
        fileName: "too-large.txt",
        url: "http://cdn.example.com/too-large.bin",
      }, { lookup: PUBLIC_LOOKUP, request }),
    (error) => error?.getStatus?.() === 400 && /maximum size/.test(error.message),
  );
  assert.equal((await listFiles(tempRoot)).length, 1);
});

test("axios download size rejection becomes BadRequest without creating an asset file", async (t) => {
  const service = new StorageService();
  const tempRoot = await storageFixture(t);
  const request = async () => {
    const error = new Error("maxContentLength size of 20971520 exceeded");
    error.code = "ERR_BAD_RESPONSE";
    throw error;
  };

  await assert.rejects(
    () =>
      service.saveAssetFromUrl({
        ownerType: "customer",
        ownerId: "c1",
        fileName: "too-large.txt",
        url: "https://cdn.example.com/too-large.bin",
      }, { lookup: PUBLIC_LOOKUP, request }),
    (error) => error?.getStatus?.() === 400 && /maximum size/.test(error.message),
  );
  assert.deepEqual(await listFiles(tempRoot), []);
});

test("design image downloader rejects local file paths from callbacks", async () => {
  const service = new StorageService();

  await assert.rejects(
    () => service.saveDesignImage("job_1", "candidate_1", "C:\\temp\\candidate.png"),
    /downloadUrl must be http\(s\) or design-platform relative path/,
  );
});

test("design image downloader rejects data URLs from callbacks", async () => {
  const service = new StorageService();

  await assert.rejects(
    () => service.saveDesignImage("job_1", "candidate_1", "data:image/png;base64,AAAA"),
    /downloadUrl must be http\(s\) or design-platform relative path/,
  );
});

test("design image downloader sends design platform credentials only to design platform URLs", async (t) => {
  const service = new StorageService();
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "smart-kefu-storage-"));
  const originalConfig = {
    localStorageRoot: appConfig.localStorageRoot,
    designPlatformBaseUrl: appConfig.designPlatformBaseUrl,
    designPlatformApiKey: appConfig.designPlatformApiKey,
    designPlatformAccessToken: appConfig.designPlatformAccessToken,
    designPlatformCookie: appConfig.designPlatformCookie,
    designPlatformDeviceId: appConfig.designPlatformDeviceId,
    designPlatformTimeoutMs: appConfig.designPlatformTimeoutMs,
  };
  const calls = [];

  appConfig.localStorageRoot = tempRoot;
  appConfig.designPlatformBaseUrl = "https://design.example";
  appConfig.designPlatformApiKey = "api-key";
  appConfig.designPlatformAccessToken = "access-token";
  appConfig.designPlatformCookie = "sid=design";
  appConfig.designPlatformDeviceId = "device-1";
  appConfig.designPlatformTimeoutMs = 1234;
  const request = async (url, config) => {
    calls.push({ url, config });
    return { data: VALID_PNG };
  };
  const lookup = async (hostname) => [{ address: hostname === "cdn.example.com" ? "93.184.216.35" : "93.184.216.34", family: 4 }];

  t.after(async () => {
    Object.assign(appConfig, originalConfig);
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });

  const localPath = await service.saveDesignImage("job_1", "candidate_1", "/v1/results/candidate.png", { lookup, request });

  assert.equal(calls[0].url, "https://design.example/v1/results/candidate.png");
  assert.equal(calls[0].config.responseType, "arraybuffer");
  assert.equal(calls[0].config.timeout, 1234);
  assert.deepEqual(calls[0].config.headers, {
    Authorization: "Bearer access-token",
    Cookie: "sid=design",
    "x-art-device-id": "device-1",
  });
  assert.equal(fs.existsSync(localPath), true);

  await service.saveDesignImage("job_1", "candidate_2", "https://cdn.example.com/candidate.png", { lookup, request });

  assert.equal(calls[1].url, "https://cdn.example.com/candidate.png");
  assert.equal(calls[1].config.responseType, "arraybuffer");
  assert.equal(calls[1].config.timeout, 1234);
  assert.equal(calls[1].config.headers, undefined);
});
