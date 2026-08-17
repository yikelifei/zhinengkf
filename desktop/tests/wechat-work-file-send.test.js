"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { strToU8, zipSync } = require("fflate");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { appConfig } = require("../apps/api/src/shared/app-config");
const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
const { resolveWechatWorkMaterialFile } = require("../apps/api/src/wechat-work/wechat-work-media");

test("Enterprise WeChat adapter uploads and sends an approved PPTX material in order", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-work-file-"));
  const previousRoot = appConfig.localStorageRoot;
  appConfig.localStorageRoot = root;
  try {
    const filePath = path.join(root, "materials", "企业伴手礼方案.pptx");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, zipSync({ "ppt/slides/slide1.xml": strToU8("<a:t>企业伴手礼方案</a:t>") }));
    const calls = [];
    const api = {
      async sendText(payload) {
        calls.push({ type: "text", payload });
        return { msgid: `api-${payload.msgid}` };
      },
      async uploadFile(payload) {
        calls.push({ type: "upload_file", payload });
        return { media_id: "media-ppt-1" };
      },
      async sendFile(payload) {
        calls.push({ type: "file", payload });
        return { msgid: `api-${payload.msgid}` };
      },
    };
    const adapter = new WechatSendAdapterService(api);
    const result = await adapter.deliverWechatWorkKf(
      { payload: { textBeforeFiles: "这是适合您预算的产品方案。", filePaths: [filePath] } },
      { openKfid: "wk-file", externalUserId: "wm-file" },
      "message-file-1",
    );

    assert.deepEqual(calls.map((call) => call.type), ["text", "upload_file", "file"]);
    assert.equal(calls[2].payload.mediaId, "media-ppt-1");
    assert.equal(result.messages[1].type, "file");
    assert.equal(result.messages[1].fileName, "企业伴手礼方案.pptx");
    assert.equal(adapter.describe("wechat_work_kf").capabilities.files, true);
  } finally {
    appConfig.localStorageRoot = previousRoot;
  }
});

test("material-file resolver rejects paths outside local storage and disguised office files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-work-file-guard-"));
  const previousRoot = appConfig.localStorageRoot;
  appConfig.localStorageRoot = root;
  try {
    const outside = path.join(path.dirname(root), "outside.pptx");
    fs.writeFileSync(outside, zipSync({ "ppt/slides/slide1.xml": strToU8("<a:t>outside</a:t>") }));
    assert.throws(() => resolveWechatWorkMaterialFile(outside), /inside LOCAL_STORAGE_ROOT/);

    const disguised = path.join(root, "fake.pptx");
    fs.writeFileSync(disguised, "this is not an office archive", "utf8");
    assert.throws(() => resolveWechatWorkMaterialFile(disguised), /does not match its extension/);
  } finally {
    appConfig.localStorageRoot = previousRoot;
  }
});
