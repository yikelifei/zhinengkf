"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { selectServiceEnvironment } = require("../packages/runtime/service-environment");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("personal WeChat RPA host receives only the explicit real-send switch", () => {
  const env = selectServiceEnvironment("personal-wechat-rpa-host", {
    PATH: "safe",
    PERSONAL_WECHAT_SEND: "1",
    PERSONAL_WECHAT_RPA_TOKEN: "must-not-leak",
  });
  assert.equal(env.PERSONAL_WECHAT_SEND, "1");
  assert.equal(env.PERSONAL_WECHAT_RPA_TOKEN, undefined);
});

test("stable runtime excludes the retired personal WeChat bridge and RPA host", () => {
  const launcher = read("tools/stable-runtime-launcher.js");
  assert.doesNotMatch(launcher, /personalWechatRuntimeEnabled|ENABLE_PERSONAL_WECHAT_RUNTIME|legacy_personal_wechat/);
  assert.doesNotMatch(launcher, /personal-wechat-rpa-host|personal-wechat-bridge|PERSONAL_WECHAT_SEND/);
});

test("SDK and OCR RPA hosts report and enforce the same real-send switch", () => {
  const sdkHost = read("tools/personal-wechat-rpa-host/Program.cs");
  const ocrHost = read("tools/personal-wechat-rpa-host/OcrRpaHost.cs");
  assert.match(sdkHost, /sendEnabled = _config\.SendEnabled/);
  assert.match(sdkHost, /if \(!_config\.SendEnabled\)\s*return SendResult\.Fail\("real_send_disabled"/);
  assert.match(sdkHost, /Environment\.GetEnvironmentVariable\("PERSONAL_WECHAT_SEND"\)/);
  assert.match(ocrHost, /sendEnabled = _config\.SendEnabled/);
  assert.match(ocrHost, /if \(!_config\.SendEnabled\)\s*return SendResult\.Fail\("real_send_disabled"/);
  assert.doesNotMatch(ocrHost, /sendEnabled = false/);
});

test("OCR host rejects UI noise and can prepare an exact chat before guarded send", () => {
  const sdkHost = read("tools/personal-wechat-rpa-host/Program.cs");
  const ocrHost = read("tools/personal-wechat-rpa-host/OcrRpaHost.cs");
  assert.match(sdkHost, /"uia_accessibility"/);
  assert.match(ocrHost, /"ocr_verified_bubble"/);
  assert.match(ocrHost, /route == "\/open-chat"/);
  assert.match(ocrHost, /StringComparer\.Ordinal\.Equals\(observation\.ChatTitle, chatTitle\)/);
  assert.match(ocrHost, /incomingAnchorEdge/);
  assert.match(ocrHost, /RPA入站测试/);
  assert.match(ocrHost, /星期\[一二三四五六日天\]/);
  assert.match(ocrHost, /\(\?:B\|KB\|MB\|GB\|TB\|K\|M\|G\|T\|字节\)/);
  assert.match(ocrHost, /!text\.Any\(Char\.IsLetterOrDigit\)/);
});
