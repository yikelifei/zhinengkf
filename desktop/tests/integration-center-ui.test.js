"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const component = fs.readFileSync(
  path.join(root, "apps/web/src/components/integration-center/integration-center-header.tsx"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(root, "apps/web/src/components/integration-center/integration-center-header.module.css"),
  "utf8",
);
const page = fs.readFileSync(path.join(root, "apps/web/src/app/legacy-workbench.tsx"), "utf8");

test("integration center header is controlled and delegates every action", () => {
  assert.match(component, /activeView:\s*IntegrationCenterView;/);
  assert.match(component, /onViewChange:\s*\(view: IntegrationCenterView\) => void;/);
  assert.match(component, /onRefresh:\s*\(\) => void;/);
  assert.match(component, /aria-pressed=\{activeView === view\.value\}/);
  assert.match(component, /onClick=\{\(\) => onViewChange\(view\.value\)\}/);
  assert.match(component, /onClick=\{onRefresh\}/);
  assert.doesNotMatch(component, /\bfetch\s*\(|axios|localStorage|sessionStorage/);
});

test("integration summary is caller-owned and rendered as an accessible definition list", () => {
  assert.match(component, /summary:\s*IntegrationSummaryItem\[\];/);
  assert.match(component, /<dl\s+className=\{styles\.summary\}\s+aria-label="微信接入摘要">/);
  assert.match(component, /summary\.map\(\(item\) =>/);
  assert.match(component, /<dt>\{item\.label\}<\/dt>/);
  assert.match(component, /<dd>\{item\.value\}<\/dd>/);
  assert.doesNotMatch(component, /(?:demo|mock|sample)(?:Channel|Summary|Account)/i);
});

test("page integrates the module with real channel status and existing callbacks", () => {
  assert.match(page, /<IntegrationCenterHeader/);
  assert.match(page, /activeView=\{wechatWorkbenchView\}/);
  assert.match(page, /onRefresh=\{\(\) => void loadWechatChannelStatusOnly\(\)\}/);
  assert.match(page, /onViewChange=\{setWechatWorkbenchView\}/);
  assert.match(page, /wechatChannelStatus\?\.summary\.pendingSendTasks/);
  assert.match(page, /wechatChannelStatus\?\.summary\.manualLockedConversations/);
});

test("shared tokens and responsive rules cover the 390px viewport", () => {
  assert.match(css, /var\(--wk-color-brand\)/);
  assert.match(css, /var\(--wk-color-border\)/);
  assert.match(css, /@media\s*\(max-width:\s*620px\)/);
  assert.match(css, /\.summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)/);
});
