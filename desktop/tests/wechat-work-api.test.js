"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("wechat work api is wired into the Nest API module", () => {
  const appModule = read("apps/api/src/app.module.ts");
  assert.match(appModule, /WechatWorkController/);
  assert.match(appModule, /WechatWorkService/);
});

test("wechat work controller exposes callback, sync, send, and status endpoints", () => {
  const controller = read("apps/api/src/wechat-work/wechat-work.controller.ts");
  assert.match(controller, /@Controller\("wechat-work"\)/);
  assert.match(controller, /@Get\("callback"\)/);
  assert.match(controller, /@Post\("callback"\)/);
  assert.match(controller, /@Post\("kf\/sync"\)/);
  assert.match(controller, /@Post\("kf\/send-text"\)/);
  assert.match(controller, /@Get\("status"\)/);
});

test("wechat work service implements encrypted callback and customer service api flow", () => {
  const service = read("apps/api/src/wechat-work/wechat-work.service.ts");
  assert.match(service, /createDecipheriv\("aes-256-cbc"/);
  assert.match(service, /sha1Sorted/);
  assert.match(service, /\/cgi-bin\/gettoken/);
  assert.match(service, /\/cgi-bin\/kf\/sync_msg/);
  assert.match(service, /\/cgi-bin\/kf\/send_msg/);
  assert.match(service, /processInboundMessage/);
  assert.match(service, /WECHAT_WORK_DEFAULT_CONVERSATION_ID/);
});

test("api accepts enterprise wechat xml callback content types", () => {
  const main = read("apps/api/src/main.ts");
  assert.match(main, /registerWechatWorkXmlParsers/);
  assert.match(main, /text\/xml/);
  assert.match(main, /application\/xml/);
});

test("wechat work runtime settings are documented without committing secrets", () => {
  const config = read("apps/api/src/shared/app-config.ts");
  const envExample = read(".env.example");
  for (const key of [
    "WECHAT_WORK_CORP_ID",
    "WECHAT_WORK_AGENT_ID",
    "WECHAT_WORK_SECRET",
    "WECHAT_WORK_TOKEN",
    "WECHAT_WORK_ENCODING_AES_KEY",
    "WECHAT_WORK_OPEN_KFID",
    "WECHAT_WORK_DEFAULT_CONVERSATION_ID",
  ]) {
    assert.match(config, new RegExp(key));
    assert.match(envExample, new RegExp(`${key}=`));
  }
});
