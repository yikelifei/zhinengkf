"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("customer entry page generates a real Enterprise WeChat link and shareable QR code", () => {
  const page = read("apps/web/src/features/integrations/wechat-work-customer-entry-page.tsx");
  const journey = read("apps/web/src/features/integrations/wechat-work-customer-entry-journey.tsx");
  const visible = `${page}\n${journey}`;
  const api = read("apps/web/src/lib/api.ts");
  const route = read("apps/web/src/app/integrations/wechat-work/customers/page.tsx");
  const navigation = read("apps/web/src/components/workbench-shell/navigation.ts");

  assert.match(route, /routeId="wechatWorkCustomers"/);
  assert.match(navigation, /label: "客户入口"/);
  assert.match(page, /createWechatWorkCustomerEntry/);
  assert.match(page, /bindAllWechatWorkCustomerEntries/);
  assert.match(page, /entryBindingBusy/);
  assert.match(page, /getWechatWorkCustomerEntry/);
  assert.match(page, /importWechatWorkCustomerEntry/);
  assert.match(page, /diagnoseWechatWorkConnection/);
  assert.match(page, /检测真实互通/);
  assert.match(page, /最近客户来信/);
  assert.match(page, /validateWechatWorkCustomerServiceSecret/);
  assert.match(page, /saveWechatWorkCustomerServiceCredential/);
  assert.match(page, /保存并一键开通/);
  assert.match(page, /立即同步企业微信消息、自动生成客户二维码/);
  assert.match(page, /type="password"/);
  assert.match(page, /autoComplete="new-password"/);
  assert.match(page, /保存并生成二维码/);
  assert.match(page, /软件重启后仍会保留/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(visible, /需要开通企业微信升级服务/);
  assert.match(visible, /<QRCode/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.match(page, /企业微信客服入口二维码\.svg/);
  assert.match(visible, /客户发送第一句话后会自动进入会话列表/);
  assert.match(api, /\/wechat-work\/kf\/contact-way/);
  assert.match(api, /\/wechat-work\/kf\/contact-ways\/bind-all/);
  assert.match(api, /\/wechat-work\/kf\/contact-way\/import/);
  assert.match(api, /\/wechat-work\/kf\/connection\/diagnose/);
  assert.match(api, /\/wechat-work\/kf\/connection\/validate-credential/);
  assert.match(api, /\/wechat-work\/kf\/connection\/save-credential/);
  assert.doesNotMatch(visible, /personal_wechat|个人微信|演示客户|mock/i);
});

test("conversation detail upgrades only a bound customer through configured member service", () => {
  const action = read("apps/web/src/features/conversations/customer-upgrade-action.tsx");
  const controller = read("apps/api/src/wechat-work/wechat-work.controller.ts");
  const service = read("apps/api/src/wechat-work/wechat-work.service.ts");

  assert.match(action, /upgradeWechatWorkCustomerService/);
  assert.match(action, /客户确认添加企业微信专员后/);
  assert.match(action, /reserveClientOperation\(\s*"customer-upgrade"/);
  assert.match(controller, /@Post\("kf\/customers\/upgrade-service"\)/);
  assert.match(controller, /@RequireOperatorCapability\("approve_send"\)/);
  assert.match(service, /findWechatWorkBindingByIdentity/);
  assert.match(service, /config\.memberUserIds\.includes\(memberUserId\)/);
  assert.match(service, /customer_upgrade_recommended/);
});

test("customer entry and long-term customer controls collapse at narrow widths", () => {
  const integrationCss = read("apps/web/src/features/integrations/integration-pages.module.css");
  const conversationCss = read("apps/web/src/features/conversations/conversation-pages.module.css");

  assert.match(integrationCss, /\.customerEntryGrid\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(integrationCss.slice(integrationCss.indexOf("@media (max-width: 900px)")), /\.customerEntryGrid\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(conversationCss.slice(conversationCss.indexOf("@media (max-width: 760px)")), /\.upgradeForm\s*\{\s*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(`${integrationCss}\n${conversationCss}`, /overflow-x:\s*(?:auto|scroll)/);
});
