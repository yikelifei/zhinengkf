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
  const end = api.indexOf("export async function getWechatWorkAuthorizationStatus", start);
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
  assert.match(component, /状态来源/);
  assert.match(component, /readiness\.source\.kind === "production_server"/);
  assert.match(component, /生产状态连接失败/);
  assert.match(component, /readiness\.callback\.consoleFields/);
  assert.match(component, /readiness\.preLiveChecklist\.duringIcp/);
  assert.match(component, /readiness\.preLiveChecklist\.beforeExternalJointTest/);
  assert.match(component, /CallbackConsoleFields/);
  assert.match(component, /ChecklistGroup/);
  assert.match(component, /check\.reason/);
  assert.match(component, /check\.fix/);
  assert.match(component, /企业微信后台回调字段/);
  assert.match(component, /备案期间本地验收/);
  assert.match(component, /外部联调前置清单/);
  assert.match(component, /Token 和 AESKey 只显示配置状态/);
  assert.match(component, /readiness\.identityPolicy\.channel/);
  assert.match(component, /callerSelectableAdapter/);
  assert.match(component, /readiness\.launchPlan\.currentPhase/);
  assert.match(component, /readiness\.launchPlan\.duringIcp/);
  assert.match(component, /readiness\.launchPlan\.afterIcp/);
  assert.match(component, /LaunchPlanGroup/);
  assert.match(component, /本机已就绪，等待公网验收/);
  assert.match(component, /没有备案时可先使用合规公网隧道或已备案域名/);
  assert.doesNotMatch(component, /fetch\(|sendCustomerService|dispatchCustomerService|syncCustomerService/);
});

test("the Enterprise WeChat preflight route owns the real readiness loader and panel", () => {
  const page = read("apps/web/src/features/integrations/wechat-work-preflight-page.tsx");
  const route = read("apps/web/src/app/integrations/wechat-work/page.tsx");

  assert.match(page, /getWechatWorkProductionPreflight/);
  assert.match(page, /getWechatConversations/);
  assert.match(page, /useAsyncResource\(/);
  assert.match(page, /<WechatWorkReadinessPanel/);
  assert.match(page, /readiness=\{readiness \|\| null\}/);
  assert.match(page, /企业微信官方客服已接入客户端/);
  assert.match(page, /href="\/conversations"/);
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
  assert.match(css, /\.launchPlan/);
  assert.match(css, /\.callbackFields/);
  assert.match(css, /\.verificationColumns/);
  assert.match(css, /\.checklistGroup/);
  assert.match(mobile, /\.planColumns\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(mobile, /\.verificationColumns\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(mobile, /\.planGroup li\s*\{\s*flex-direction:\s*column/);
  assert.match(mobile, /\.callbackFields li,\s*\.checklistGroup li\s*\{\s*flex-direction:\s*column/);
  assert.match(mobile, /overflow-wrap:\s*anywhere/);
});

test("Enterprise WeChat settings exposes only the official guarded authorization action", () => {
  const page = [
    read("apps/web/src/features/integrations/wechat-work-configuration-page.tsx"),
    read("apps/web/src/features/integrations/wechat-work-authorization-panel.tsx"),
  ].join("\n");
  const css = read("apps/web/src/features/integrations/integration-pages.module.css");

  assert.match(page, /Promise\.all\(\[/);
  assert.match(page, /createWechatWorkAuthorizationInstallLink/);
  assert.match(page, /打开官方扫码授权页/);
  assert.match(page, /单企业直连参数已填写，尚未证明互通/);
  assert.match(page, /可选：服务商多企业扫码授权/);
  assert.match(page, /未启用（可选）/);
  assert.match(page, /页面不显示任何密钥/);
  assert.match(page, /authorization\.callbacks\.command/);
  assert.match(page, /readiness\.callback\.consoleFields/);
  assert.match(page, /单企业直连模式无需配置/);
  assert.match(page, /已配置（明文隐藏）/);
  assert.match(page, /!configured \? <small>\{check\.reason\}/);
  assert.match(page, /!configured \? <small>\{check\.fix\}/);
  assert.match(page, /open_kfid/);
  assert.match(page, /直连配置已完成/);
  assert.match(page, /isDesktopConfigurationCheckReady/);
  assert.match(page, /桌面端本地存储已启用/);
  assert.match(page, /readiness\.callback\.publicHttpsFormatReady/);
  assert.doesNotMatch(page, /WechatWorkLaunchPlanSection|readiness\.launchPlan/);
  assert.doesNotMatch(page, /<input|type="password"|permanentCode|suiteTicket/);

  const mobileStart = css.indexOf("@media (max-width: 520px)");
  assert.match(css.slice(mobileStart), /\.authorizationList li/);
  assert.match(css, /\.planColumns/);
  assert.match(css, /\.planGroup li/);
  assert.match(css.slice(mobileStart), /\.planColumns\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css.slice(mobileStart), /\.planGroup li\s*\{\s*flex-direction:\s*column/);
});
