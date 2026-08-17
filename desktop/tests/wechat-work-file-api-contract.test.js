"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { strToU8, zipSync } = require("fflate");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { appConfig } = require("../apps/api/src/shared/app-config");
const { WechatWorkApiClient } = require("../apps/api/src/wechat-work/wechat-work-api.client");

test("WeCom file client uses official media upload and kf file message fields", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-work-file-contract-"));
  const filePath = path.join(root, "materials", "中秋方案.pptx");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, zipSync({ "ppt/slides/slide1.xml": strToU8("<a:t>中秋伴手礼方案</a:t>") }));

  const previous = {
    localStorageRoot: appConfig.localStorageRoot,
    corpId: appConfig.wechatWorkCorpId,
    secret: appConfig.wechatWorkSecret,
    baseUrl: appConfig.wechatWorkApiBaseUrl,
    fetch: global.fetch,
  };
  appConfig.localStorageRoot = root;
  appConfig.wechatWorkCorpId = "corp-file-contract";
  appConfig.wechatWorkSecret = "secret-file-contract";
  appConfig.wechatWorkApiBaseUrl = "https://qyapi.weixin.qq.com";
  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("/cgi-bin/gettoken?")) {
      return jsonResponse({ errcode: 0, errmsg: "ok", access_token: "access-file", expires_in: 7200 });
    }
    if (String(url).includes("/cgi-bin/media/upload?")) {
      assert.match(String(url), /access_token=access-file&type=file$/);
      assert.equal(init.method, "POST");
      assert.ok(init.body instanceof FormData);
      const media = init.body.get("media");
      assert.equal(media.name, "中秋方案.pptx");
      return jsonResponse({ errcode: 0, errmsg: "ok", type: "file", media_id: "media-file-contract" });
    }
    const body = JSON.parse(init.body);
    assert.equal(body.msgtype, "file");
    assert.deepEqual(body.file, { media_id: "media-file-contract" });
    assert.equal(body.touser, "wm-file-contract");
    assert.equal(body.open_kfid, "wk-file-contract");
    return jsonResponse({ errcode: 0, errmsg: "ok", msgid: "api-file-message" });
  };

  try {
    const client = new WechatWorkApiClient();
    const upload = await client.uploadFile({ filePath });
    const sent = await client.sendFile({
      externalUserId: "wm-file-contract",
      openKfid: "wk-file-contract",
      mediaId: upload.media_id,
      msgid: "file-message-contract",
    });
    assert.equal(sent.msgid, "api-file-message");
    assert.equal(requests.length, 3);
  } finally {
    appConfig.localStorageRoot = previous.localStorageRoot;
    appConfig.wechatWorkCorpId = previous.corpId;
    appConfig.wechatWorkSecret = previous.secret;
    appConfig.wechatWorkApiBaseUrl = previous.baseUrl;
    global.fetch = previous.fetch;
  }
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
