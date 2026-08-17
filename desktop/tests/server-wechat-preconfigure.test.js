"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("server WeCom preconfiguration is domain-bound, secret-free and keeps sending disabled", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "tools", "server-wechat-preconfigure.js"), "utf8");
  assert.match(source, /https:\/\/kefu\.zhenxiliye\.cn/);
  assert.match(source, /crypto\.randomBytes\(16\)/);
  assert.match(source, /crypto\.randomBytes\(32\)/);
  assert.match(source, /WECHAT_SEND_ADAPTER=dry_run/);
  assert.match(source, /realSendEnabled:\s*false/);
  assert.match(source, /secretValuesPrinted:\s*false/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:token|aesKey)\b/i);
});
