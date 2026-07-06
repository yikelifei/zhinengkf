"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const webApi = fs.readFileSync(path.join(__dirname, "../apps/web/src/lib/api.ts"), "utf8");
const webPage = fs.readFileSync(path.join(__dirname, "../apps/web/src/app/page.tsx"), "utf8");

test("web design active poll result exposes retried jobs", () => {
  assert.match(webApi, /export type DesignActivePollResult = \{[\s\S]*retried: DesignJob\[\];[\s\S]*errors: Array/);
});

test("web design active poll summary reports automatic retries separately", () => {
  assert.match(webPage, /自动重试 \$\{result\.retried\?\.length \|\| 0\} 个/);
});

test("web single design poll reports automatic retry instead of plain failure", () => {
  assert.match(webApi, /autoRetried\?: boolean/);
  assert.match(webPage, /result\.remoteStatus === "terminal"/);
  assert.match(webPage, /result\.autoRetried/);
  assert.match(webPage, /设计平台状态：已自动重试，正在重新出图。/);
  assert.match(webPage, /设计平台状态：任务已进入客户确认后的终态，已跳过轮询。/);
});
