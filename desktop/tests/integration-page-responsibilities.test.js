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
  assert.match(source, /status\.channels\.map/);
  assert.doesNotMatch(source, /channel\.checks|status\.visualFlow|<input|<textarea/);
});

test("Enterprise WeChat flow and settings are real independent pages", () => {
  const flowRoute = read("apps/web/src/app/integrations/wechat-work/flow/page.tsx");
  const settingsRoute = read("apps/web/src/app/integrations/wechat-work/settings/page.tsx");
  assert.match(flowRoute, /WechatWorkFlowPage/);
  assert.match(settingsRoute, /WechatWorkConfigurationPage/);
  assert.doesNotMatch(`${flowRoute}\n${settingsRoute}`, /redirect\(/);
});

test("personal WeChat instance list cannot mutate and configuration owns mutations", () => {
  const list = read("apps/web/src/features/integrations/personal-wechat-instances-page.tsx");
  const config = read("apps/web/src/features/integrations/personal-wechat-instance-config-page.tsx");
  const danger = read("apps/web/src/features/integrations/personal-wechat-instance-danger-zone.tsx");
  assert.doesNotMatch(list, /validatePersonalWechatRpaInstance|savePersonalWechatRpaInstance|disablePersonalWechatRpaInstance/);
  assert.match(list, /instances\/configure\?accountId=/);
  assert.match(config, /savePersonalWechatRpaInstance/);
  assert.match(config, /disablePersonalWechatRpaInstance/);
  assert.match(danger, /role="region"/);
  assert.match(danger, /confirmed/);
  assert.doesNotMatch(danger, /window\.confirm|role="alertdialog"|aria-modal/);
});

test("control, window evidence, inbound drill, and safety keep separate data contracts", () => {
  const control = read("apps/web/src/features/integrations/personal-wechat-control-page.tsx");
  const windowEvidence = read("apps/web/src/features/integrations/window-evidence-page.tsx");
  const inbound = read("apps/web/src/features/integrations/personal-wechat-inbound-drill-page.tsx");
  const safety = read("apps/web/src/features/integrations/personal-wechat-safety-page.tsx");

  assert.match(control, /getPersonalWechatRpaRegistry/);
  assert.doesNotMatch(control, /getSendTasks|testWechatChannelInbound|captureWindowObserverOnce/);
  assert.match(windowEvidence, /captureWindowObserverOnce/);
  assert.doesNotMatch(windowEvidence, /testWechatChannelInbound|scanWindowSnapshotInbox/);
  assert.match(inbound, /testWechatChannelInbound\("personal_wechat"/);
  assert.doesNotMatch(inbound, /captureWindowObserverOnce|getWechatWindowSnapshots/);
  assert.match(safety, /getSendTasks/);
  assert.match(safety, /personalAccountIds\.has\(accountId\)/);
  assert.doesNotMatch(safety, /executeSendTask|requeueSendTask|MessageSafetyGovernance/);
});

test("active integration page components stay below the maintainability threshold", () => {
  const files = [
    "channels-status-page.tsx",
    "wechat-work-preflight-page.tsx",
    "wechat-work-configuration-page.tsx",
    "wechat-work-flow-page.tsx",
    "personal-wechat-instances-page.tsx",
    "personal-wechat-instance-config-page.tsx",
    "personal-wechat-instance-form.tsx",
    "personal-wechat-instance-danger-zone.tsx",
    "personal-wechat-control-page.tsx",
    "window-evidence-page.tsx",
    "personal-wechat-inbound-drill-page.tsx",
    "personal-wechat-safety-page.tsx",
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
