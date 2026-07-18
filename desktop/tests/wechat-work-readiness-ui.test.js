"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Enterprise WeChat preflight client is read-only and calls only the offline preflight endpoint", () => {
  const api = read("apps/web/src/lib/api.ts");
  const start = api.indexOf("export async function getWechatWorkProductionPreflight");
  const end = api.indexOf("export async function getWechatConversations", start);
  const section = api.slice(start, end);

  assert.ok(start >= 0, "preflight client should exist");
  assert.match(section, /\/wechat-work\/preflight/);
  assert.match(section, /cache:\s*"no-store"/);
  assert.doesNotMatch(section, /method:\s*"POST"|send-text|dispatch|\/kf\/sync|\/callback/);
});

test("readiness panel separates local checks from external acceptance blockers", () => {
  const component = read("apps/web/src/components/wechat-work-readiness-panel.tsx");

  assert.match(component, /本机代码与配置/);
  assert.match(component, /公网与管理后台验收/);
  assert.match(component, /readiness\.local\.checks/);
  assert.match(component, /readiness\.external\.checks/);
  assert.match(component, /readiness\.identityPolicy\.channel/);
  assert.match(component, /callerSelectableAdapter/);
  assert.match(component, /本机已就绪，等待公网验收/);
  assert.match(component, /没有备案时可先使用合规公网隧道或已备案域名/);
  assert.doesNotMatch(component, /fetch\(|sendCustomerService|dispatchCustomerService|syncCustomerService/);
});

test("the Enterprise WeChat preflight route owns the real readiness loader and panel", () => {
  const page = read("apps/web/src/features/integrations/wechat-work-preflight-page.tsx");
  const route = read("apps/web/src/app/integrations/wechat-work/page.tsx");

  assert.match(page, /getWechatWorkProductionPreflight/);
  assert.match(page, /useAsyncResource\(/);
  assert.match(page, /<WechatWorkReadinessPanel/);
  assert.match(page, /readiness=\{readiness\}/);
  assert.match(page, /onRefresh=\{\(\) => void refresh\(\)\}/);
  assert.match(page, /不把离线检查误报为上线成功/);
  assert.match(route, /routeId="wechatWorkChannels"/);
  assert.match(route, /<WechatWorkPreflightPage/);
});

test("Enterprise WeChat readiness layout covers a 390px viewport", () => {
  const css = read("apps/web/src/components/wechat-work-readiness-panel.module.css");
  const mobileStart = css.indexOf("@media (max-width: 760px)");
  const mobile = css.slice(mobileStart);

  assert.ok(mobileStart >= 0, "responsive breakpoint should include 390px");
  assert.match(mobile, /\.checkColumns\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(mobile, /\.identityBar\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mobile, /overflow-wrap:\s*anywhere/);
});
