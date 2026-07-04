"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { DesignJobsService } = require("../apps/api/src/design-jobs/design-jobs.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

test("design image local preview reads only the image bound to the expected design job", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousStorageRoot = appConfig.localStorageRoot;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-image-preview-"));
  const localPath = path.join(tempRoot, "design-jobs", "design_preview_1", "candidate_1.png");
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, Buffer.from("candidate image"));

  const job = {
    id: "design_preview_1",
    requestId: "request_preview_1",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
    images: [{ id: "image_1", imageId: "candidate_1", localPath }],
  };
  let readPath = "";

  try {
    appConfig.useLocalStore = true;
    appConfig.localStorageRoot = tempRoot;
    const service = new DesignJobsService(
      {},
      {},
      { getDesignJob: (id) => (id === job.id ? job : null) },
      {},
      {
        readLocalAsset: async (filePath) => {
          readPath = filePath;
          return {
            stream: Readable.from(Buffer.from("candidate image")),
            mimeType: "image/png",
            sizeBytes: 15,
          };
        },
      },
      {},
      {},
      {},
    );

    const file = await service.readLocalDesignImage(job.id, "candidate_1", {
      expectedWechatAccountId: "wechat_1",
      expectedConversationId: "conversation_1",
      expectedCustomerId: "customer_1",
    });

    assert.equal(file.mimeType, "image/png");
    assert.equal(readPath, localPath);
    await assert.rejects(
      () =>
        service.readLocalDesignImage(job.id, "candidate_1", {
          expectedWechatAccountId: "wechat_2",
          expectedConversationId: "conversation_1",
          expectedCustomerId: "customer_1",
        }),
      /identity mismatch/,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.localStorageRoot = previousStorageRoot;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("design image local preview rejects a local file outside the bound design job folder", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousStorageRoot = appConfig.localStorageRoot;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-image-preview-boundary-"));
  const localPath = path.join(tempRoot, "design-jobs", "other_design", "candidate_1.png");
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, Buffer.from("other image"));

  try {
    appConfig.useLocalStore = true;
    appConfig.localStorageRoot = tempRoot;
    const service = new DesignJobsService(
      {},
      {},
      {
        getDesignJob: () => ({
          id: "design_preview_1",
          requestId: "request_preview_1",
          wechatAccountId: "wechat_1",
          conversationId: "conversation_1",
          customerId: "customer_1",
          images: [{ id: "image_1", imageId: "candidate_1", localPath }],
        }),
      },
      {},
      { readLocalAsset: async () => ({ stream: Readable.from(Buffer.alloc(0)), mimeType: "image/png", sizeBytes: 0 }) },
      {},
      {},
      {},
    );

    await assert.rejects(
      () =>
        service.readLocalDesignImage("design_preview_1", "image_1", {
          expectedWechatAccountId: "wechat_1",
          expectedConversationId: "conversation_1",
          expectedCustomerId: "customer_1",
        }),
      /not bound to this design job/,
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.localStorageRoot = previousStorageRoot;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("web image tiles prefer the scoped design-image local preview endpoint", () => {
  const apiSource = fs.readFileSync(path.join(__dirname, "..", "apps", "web", "src", "lib", "api.ts"), "utf8");
  const pageSource = fs.readFileSync(path.join(__dirname, "..", "apps", "web", "src", "app", "page.tsx"), "utf8");
  const controllerSource = fs.readFileSync(path.join(__dirname, "..", "apps", "api", "src", "design-jobs", "design-jobs.controller.ts"), "utf8");

  assert.match(apiSource, /localDesignImageUrl/);
  assert.match(apiSource, /\/design-jobs\/\$\{encodeURIComponent\(jobId\)\}\/images\/\$\{encodeURIComponent\(imageKey\)\}\/local-file/);
  assert.match(pageSource, /src=\{designImagePreviewSrc\(activeJob, image\)\}/);
  assert.match(pageSource, /function designImagePreviewSrc\(job: DesignJob,[\s\S]*localDesignImageUrl\(job\.id, image, identityExpectation\(job\)\) \|\| image\.downloadUrl/);
  assert.match(controllerSource, /@Get\(":id\/images\/:imageId\/local-file"\)/);
});
