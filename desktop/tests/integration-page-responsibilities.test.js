"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("channel overview renders only status and real navigation", () => {
  const source = read("apps/web/src/features/integrations/channels-status-page.tsx");
  assert.match(source, /CHANNEL_DESTINATIONS/);
  assert.match(source, /<Link/);
  assert.match(source, /enterpriseChannels\.map/);
  assert.match(source, /channel\.key === "work_wechat"/);
  assert.doesNotMatch(source, /personal_wechat:|mini_program/);
  assert.doesNotMatch(source, /channel\.checks|status\.visualFlow|<input|<textarea/);
});

test("Enterprise WeChat flow and settings are real independent pages", () => {
  const customersRoute = read("apps/web/src/app/integrations/wechat-work/customers/page.tsx");
  const flowRoute = read("apps/web/src/app/integrations/wechat-work/flow/page.tsx");
  const settingsRoute = read("apps/web/src/app/integrations/wechat-work/settings/page.tsx");
  assert.match(customersRoute, /WechatWorkCustomerEntryPage/);
  assert.match(flowRoute, /WechatWorkFlowPage/);
  assert.match(settingsRoute, /WechatWorkConfigurationPage/);
  assert.doesNotMatch(`${customersRoute}\n${flowRoute}\n${settingsRoute}`, /redirect\(/);
});

test("personal WeChat routes are absent from the production app", () => {
  for (const route of [
    "control/page.tsx",
    "inbound-drill/page.tsx",
    "instances/page.tsx",
    "instances/configure/page.tsx",
    "safety/page.tsx",
    "voice-assist/page.tsx",
    "window-inbound/page.tsx",
  ]) assert.equal(
    fs.existsSync(path.join(root, "apps/web/src/app/integrations/personal-wechat", route)),
    false,
  );
  assert.doesNotMatch(read("apps/web/src/app/route-manifest.ts"), /personalWechat|personal-wechat/);
});

test("active integration page components stay below the maintainability threshold", () => {
  const files = [
    "channels-status-page.tsx",
    "wechat-work-preflight-page.tsx",
    "wechat-work-customer-entry-page.tsx",
    "wechat-work-configuration-page.tsx",
    "wechat-work-flow-page.tsx",
  ];
  for (const file of files) {
    const lines = read(`apps/web/src/features/integrations/${file}`).split(/\r?\n/).length;
    assert.ok(lines <= 250, `${file} has ${lines} lines; split the controller or view`);
  }
});

test("integration mobile styles collapse lists without horizontal scrolling", () => {
  const css = read("apps/web/src/features/integrations/integration-pages.module.css");
  const mobile = css.slice(css.indexOf("@media (max-width: 520px)"));
  assert.match(mobile, /\.channelRow,[\s\S]*?\.accountRow,[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(mobile, /\.operationLinks\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)/);
});
