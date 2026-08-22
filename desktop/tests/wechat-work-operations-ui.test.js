"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Enterprise WeChat operations page manages accounts and servicers through official APIs", () => {
  const page = read("apps/web/src/features/integrations/wechat-work-operations-page.tsx");
  const api = read("apps/web/src/lib/api.ts");
  const controller = read("apps/api/src/wechat-work/wechat-work.controller.ts");
  const service = read("apps/api/src/wechat-work/wechat-work.service.ts");
  const client = read("apps/api/src/wechat-work/wechat-work-api.client.ts");
  const route = read("apps/web/src/app/integrations/wechat-work/operations/page.tsx");
  const navigation = read("apps/web/src/components/workbench-shell/navigation.ts");

  assert.match(route, /routeId="wechatWorkOperations"/);
  assert.match(navigation, /label: "企业微信运营"/);
  assert.match(page, /getWechatWorkCustomerServiceOperations/);
  assert.match(page, /createWechatWorkCustomerServiceAccount/);
  assert.match(page, /updateWechatWorkCustomerServiceAccount/);
  assert.match(page, /deleteWechatWorkCustomerServiceAccount/);
  assert.match(page, /addWechatWorkCustomerServiceServicers/);
  assert.match(page, /deleteWechatWorkCustomerServiceServicers/);
  assert.match(page, /getWechatWorkCustomerServiceStatistics/);
  assert.match(page, /客服经营统计/);
  assert.match(page, /查询官方统计/);
  assert.match(page, /statistics\.status === "empty"/);
  assert.match(page, /statistics\?\.error/);
  assert.match(page, /部分接待人员统计未返回/);
  assert.match(page, /成员中文名称来自企业微信通讯录/);
  assert.match(page, /deleteConfirmation !== selectedAccount\.name/);
  assert.match(controller, /@Get\("kf\/operations"\)/);
  assert.match(controller, /@Get\("kf\/statistics"\)[\s\S]*?@RequireOperatorCapability\("view_console"\)/);
  assert.match(controller, /@RequireOperatorCapability\("manage_channels"\)/);
  assert.match(service, /每个客服账号至少保留一名接待人员/);
  assert.match(service, /当前正在使用的客服账号不能删除/);
  assert.match(service, /recordWechatWorkAudit/);
  assert.match(service, /action: "kf_statistics_read"/);
  assert.match(service, /WECHAT_WORK_STATISTICS_PERMISSION_REQUIRED/);
  assert.match(service, /WECHAT_WORK_STATISTICS_RATE_LIMITED/);
  assert.match(client, /\/cgi-bin\/kf\/account\/add/);
  assert.match(client, /\/cgi-bin\/kf\/account\/update/);
  assert.match(client, /\/cgi-bin\/kf\/account\/del/);
  assert.match(client, /\/cgi-bin\/kf\/servicer\/list/);
  assert.match(client, /\/cgi-bin\/kf\/servicer\/add/);
  assert.match(client, /\/cgi-bin\/kf\/servicer\/del/);
  assert.match(client, /\/cgi-bin\/user\/list_id/);
  assert.match(client, /\/cgi-bin\/kf\/get_corp_statistic/);
  assert.match(client, /\/cgi-bin\/kf\/get_servicer_statistic/);
  assert.match(api, /\/wechat-work\/kf\/statistics/);
});

test("operations layout keeps stable desktop and mobile dimensions", () => {
  const css = read("apps/web/src/features/integrations/wechat-work-operations-page.module.css");

  assert.match(css, /\.workspace\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.servicerRow\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.statisticsControls\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.statisticsTable\s*\{[\s\S]*?min-width:/);
  assert.match(css.slice(css.indexOf("@media (max-width: 720px)")), /\.workspace,[\s\S]*?grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /border-radius:\s*(?:1[0-9]|[2-9][0-9])px/);
});
