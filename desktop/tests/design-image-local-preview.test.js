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

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);

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

test("design image local preview returns a diagnostic stale-record state outside the bound design job folder", async () => {
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
      (error) => {
        assert.equal(error.getStatus(), 409);
        assert.deepEqual(error.getResponse(), {
          code: "DESIGN_IMAGE_LOCAL_FILE_STALE_RECORD",
          state: "stale_record",
          message: "图片记录指向其他设计任务目录，可重新下载并修复绑定。",
          canRepair: false,
        });
        return true;
      },
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.localStorageRoot = previousStorageRoot;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("design job list diagnoses ready, missing, stale and unsaved historical image records", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousStorageRoot = appConfig.localStorageRoot;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-image-preview-diagnostics-"));
  const jobId = "design_diagnostics_1";
  const readyPath = path.join(tempRoot, "design-jobs", jobId, "ready.png");
  const missingPath = path.join(tempRoot, "design-jobs", jobId, "missing.png");
  const stalePath = path.join(os.tmpdir(), "old-runtime", "design-jobs", jobId, "stale.png");
  fs.mkdirSync(path.dirname(readyPath), { recursive: true });
  fs.writeFileSync(readyPath, Buffer.from("ready"));
  const job = {
    id: jobId,
    requestId: "request_diagnostics_1",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
    images: [
      { id: "image_ready", imageId: "ready", localPath: readyPath, downloadUrl: "http://example.test/ready.png" },
      { id: "image_missing", imageId: "missing", localPath: missingPath, downloadUrl: "http://example.test/missing.png" },
      { id: "image_stale", imageId: "stale", localPath: stalePath, downloadUrl: "http://example.test/stale.png" },
      { id: "image_unsaved", imageId: "unsaved", downloadUrl: "" },
    ],
  };

  try {
    appConfig.useLocalStore = true;
    appConfig.localStorageRoot = tempRoot;
    const service = new DesignJobsService(
      {},
      {},
      { listDesignJobs: () => [job] },
      {},
      {},
      {},
      {},
      {},
    );
    const [decorated] = await service.list();
    assert.deepEqual(
      decorated.images.map((image) => [image.imageId, image.localFile.state, image.localFile.canRepair]),
      [
        ["ready", "ready", false],
        ["missing", "missing_file", true],
        ["stale", "stale_record", true],
        ["unsaved", "not_saved", false],
      ],
    );
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.localStorageRoot = previousStorageRoot;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("stale historical image can be redownloaded into the current job folder", async () => {
  const previousUseLocalStore = appConfig.useLocalStore;
  const previousStorageRoot = appConfig.localStorageRoot;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-image-preview-repair-"));
  const job = {
    id: "design_repair_1",
    requestId: "request_repair_1",
    wechatAccountId: "wechat_1",
    conversationId: "conversation_1",
    customerId: "customer_1",
    images: [
      {
        id: "image_repair_1",
        imageId: "candidate_1",
        position: 1,
        localPath: path.join(os.tmpdir(), "old-runtime", "design-jobs", "design_repair_1", "candidate_1.png"),
        downloadUrl: "http://example.test/candidate_1.png",
      },
    ],
  };
  const localStore = {
    getDesignJob: () => job,
    upsertDesignImages: (_jobId, images) => {
      job.images = job.images.map((image) =>
        image.imageId === images[0].imageId ? { ...image, ...images[0] } : image,
      );
      return job.images;
    },
  };

  try {
    appConfig.useLocalStore = true;
    appConfig.localStorageRoot = tempRoot;
    const service = new DesignJobsService(
      {},
      {},
      localStore,
      {},
      {
        saveDesignImage: async (jobId, imageId) => {
          const savedPath = path.join(tempRoot, "design-jobs", jobId, `${imageId}.png`);
          fs.mkdirSync(path.dirname(savedPath), { recursive: true });
          fs.writeFileSync(savedPath, VALID_PNG);
          return savedPath;
        },
      },
      {},
      {},
      {},
    );

    const result = await service.repairLocalDesignImage(job.id, "candidate_1", {
      expectedWechatAccountId: "wechat_1",
      expectedConversationId: "conversation_1",
      expectedCustomerId: "customer_1",
    });
    assert.equal(result.repaired, true);
    assert.equal(result.image.localFile.state, "ready");
    assert.equal(result.image.localPath, path.join(tempRoot, "design-jobs", job.id, "candidate_1.png"));
  } finally {
    appConfig.useLocalStore = previousUseLocalStore;
    appConfig.localStorageRoot = previousStorageRoot;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("web image tiles prefer the scoped design-image local preview endpoint", () => {
  const apiSource = fs.readFileSync(path.join(__dirname, "..", "apps", "web", "src", "lib", "api.ts"), "utf8");
  const pageSource = fs.readFileSync(path.join(__dirname, "..", "apps", "web", "src", "features", "design", "design-job-detail-page.tsx"), "utf8");
  const modelSource = fs.readFileSync(path.join(__dirname, "..", "apps", "web", "src", "features", "design", "model.ts"), "utf8");
  const controllerSource = fs.readFileSync(path.join(__dirname, "..", "apps", "api", "src", "design-jobs", "design-jobs.controller.ts"), "utf8");

  assert.match(apiSource, /localDesignImageUrl/);
  assert.match(apiSource, /\/design-jobs\/\$\{encodeURIComponent\(jobId\)\}\/images\/\$\{encodeURIComponent\(imageKey\)\}\/local-file/);
  assert.match(pageSource, /designImagePreviewSrc\(selected, image\)/);
  assert.match(pageSource, /<img src=\{src\}/);
  assert.match(modelSource, /function designImagePreviewSrc[\s\S]*localDesignImageUrl\(job\.id, image, identityExpectation\(job\)\) \|\| image\.downloadUrl/);
  assert.match(controllerSource, /@Get\(":id\/images\/:imageId\/local-file"\)/);
  assert.match(controllerSource, /@Get\(":id\/images\/:imageId\/local-file-status"\)/);
  assert.match(controllerSource, /@Post\(":id\/images\/:imageId\/repair-local-file"\)/);
  assert.match(pageSource, /image\.localFile && image\.localFile\.state !== "ready"/);
  assert.match(pageSource, /历史图片已重新下载到当前存储目录/);
});
