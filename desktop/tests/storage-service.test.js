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

const axiosModule = require("axios");
const axios = axiosModule.default || axiosModule;
const { appConfig } = require("../apps/api/src/shared/app-config");
const { StorageService } = require("../apps/api/src/storage/storage.service");

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
  const originalGet = axios.get;
  const calls = [];

  appConfig.localStorageRoot = tempRoot;
  appConfig.designPlatformBaseUrl = "http://127.0.0.1:3700";
  appConfig.designPlatformApiKey = "api-key";
  appConfig.designPlatformAccessToken = "access-token";
  appConfig.designPlatformCookie = "sid=design";
  appConfig.designPlatformDeviceId = "device-1";
  appConfig.designPlatformTimeoutMs = 1234;
  axios.get = async (url, config) => {
    calls.push({ url, config });
    return { data: Buffer.from(`image:${calls.length}`) };
  };

  t.after(async () => {
    axios.get = originalGet;
    Object.assign(appConfig, originalConfig);
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });

  const localPath = await service.saveDesignImage("job_1", "candidate_1", "/v1/results/candidate.png");

  assert.equal(calls[0].url, "http://127.0.0.1:3700/v1/results/candidate.png");
  assert.equal(calls[0].config.responseType, "arraybuffer");
  assert.equal(calls[0].config.timeout, 1234);
  assert.deepEqual(calls[0].config.headers, {
    Authorization: "Bearer access-token",
    Cookie: "sid=design",
    "x-art-device-id": "device-1",
  });
  assert.equal(fs.existsSync(localPath), true);

  await service.saveDesignImage("job_1", "candidate_2", "https://cdn.example.com/candidate.png");

  assert.equal(calls[1].url, "https://cdn.example.com/candidate.png");
  assert.equal(calls[1].config.responseType, "arraybuffer");
  assert.equal(calls[1].config.timeout, 1234);
  assert.equal(calls[1].config.headers, undefined);
});
