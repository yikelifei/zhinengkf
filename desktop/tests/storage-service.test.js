"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

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
