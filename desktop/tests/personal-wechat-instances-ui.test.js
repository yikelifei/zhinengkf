"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const componentPath = path.join(root, "apps/web/src/components/personal-wechat-instances-panel.tsx");
const cssPath = path.join(root, "apps/web/src/components/personal-wechat-instances-panel.module.css");
const component = fs.readFileSync(componentPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

test("personal WeChat instances panel is driven only by redacted caller-owned contracts", () => {
  assert.match(component, /registry:\s*PersonalWechatRegistryReadiness \| null;/);
  assert.match(component, /onValidate:\s*\(draft: PersonalWechatInstanceDraft\) => Promise<PersonalWechatInstanceValidation>;/);
  assert.match(component, /onSave:\s*\(draft: PersonalWechatInstanceDraft\) => Promise<void>;/);
  assert.match(component, /onDisable:\s*\(wechatAccountId: string\) => Promise<void>;/);
  assert.match(component, /registry\?\.instances\.length \? registry\.instances\.map\(\(instance\) =>/);

  assert.doesNotMatch(component, /\bfetch\s*\(|\baxios\b|from\s+["'][^"']*(?:\/api|api\.ts)["']/i);
  assert.doesNotMatch(component, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(component, /(?:demo|mock|sample)(?:Instance|Registry|Account)/i);
});

test("token stays in a password field and is cleared instead of being read from registry data", () => {
  const viewType = component.match(/export type PersonalWechatInstanceView = \{([\s\S]*?)\n\};/)?.[1] || "";
  assert.doesNotMatch(viewType, /^\s*token\??\s*:/m);
  assert.match(viewType, /^\s*tokenConfigured:\s*boolean;/m);
  assert.match(component, /type="password"/);
  assert.match(component, /autoComplete="new-password"/);
  assert.match(component, /token:\s*token\.trim\(\) \|\| undefined/);
  assert.ok((component.match(/setToken\(""\)/g) || []).length >= 4, "token must be cleared on open, edit, close, save and failure paths");
  assert.doesNotMatch(component, /instance\.token(?!Configured)/);
  assert.doesNotMatch(component, /value=\{[^}]*tokenConfigured[^}]*\}/);
  assert.match(component, /placeholder=\{editorMode === "edit" \? "留空则保留现有令牌"/);
});

test("save validates first and disable requires an explicit second confirmation", () => {
  assert.match(component, /const result = await onValidate\(draft\);[\s\S]*?if \(!result\.ok\) return;[\s\S]*?await onSave\(draft\);/);
  assert.match(component, /onClick=\{\(\) => setConfirmDisableId\(instance\.wechatAccountId\)\}/);
  assert.match(component, /role="region"/);
  assert.match(component, /aria-live="polite"/);
  assert.doesNotMatch(component, /aria-modal="true"|role="alertdialog"/);
  assert.match(component, /onClick=\{\(\) => void confirmDisable\(\)\}/);
  assert.match(component, /await onDisable\(accountId\);/);
  assert.doesNotMatch(component, /window\.confirm|confirm\s*\(/);
});

test("panel presents account, nickname, loopback endpoint, state and validation errors", () => {
  assert.match(component, /\{instance\.accountNickname \|\| "未命名微信"\}/);
  assert.match(component, /\{instance\.wechatAccountId\}/);
  assert.match(component, /\{instance\.endpoint \|\| "无有效本机地址"\}/);
  assert.match(component, /instance\.enabled \? "已启用" : "已停用"/);
  assert.match(component, /instance\.tokenConfigured \? "令牌已配置" : "令牌未配置"/);
  assert.match(component, /collectReadinessErrors\(registry\)/);
  assert.match(component, /collectInstanceErrors\(instance\)/);
  assert.match(component, /127\.0\.0\.1、localhost 或 ::1/);
});

test("server rendering never exposes an unexpected token carried by caller data", () => {
  require("ts-node").register({
    transpileOnly: true,
    compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
  });
  require.extensions[".css"] = (module) => {
    module.exports = new Proxy({}, {
      get: (_target, property) => property === "__esModule" ? false : String(property),
    });
  };
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { PersonalWechatInstancesPanel } = require(componentPath);
  const markup = renderToStaticMarkup(React.createElement(PersonalWechatInstancesPanel, {
    registry: {
      version: "personal_wechat_rpa_registry_v1",
      ready: true,
      mode: "registry",
      activeCount: 1,
      disabledCount: 0,
      checks: [],
      errors: [],
      instances: [{
        wechatAccountId: "account_1",
        accountNickname: "客服一号",
        endpoint: "http://127.0.0.1:3211",
        port: 3211,
        enabled: true,
        tokenConfigured: true,
        token: "unexpected-secret-from-caller",
      }],
    },
    onValidate: async () => ({ ok: true, errors: [] }),
    onSave: async () => undefined,
    onDisable: async () => undefined,
  }));

  assert.match(markup, /account_1/);
  assert.match(markup, /客服一号/);
  assert.match(markup, /http:\/\/127\.0\.0\.1:3211/);
  assert.doesNotMatch(markup, /unexpected-secret-from-caller/);
});

test("responsive CSS keeps the 390px layout single-column without horizontal overflow", () => {
  assert.match(css, /\.panel\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow:\s*hidden;[\s\S]*?background:\s*(?:#ffffff|var\(--wk-color-surface\));/);
  assert.match(css, /overflow-wrap:\s*anywhere;/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)/);
  assert.doesNotMatch(css, /min-width:\s*(?:[4-9]\d\d|\d{4,})px/);

  const mobileMedia = /@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)(?=\n@media|$)/g;
  const matchingRules = [...css.matchAll(mobileMedia)].filter((match) => Number(match[1]) >= 390);
  assert.ok(matchingRules.length > 0, "a max-width breakpoint must include a 390px viewport");
  const mobileCss = matchingRules.map((match) => match[2]).join("\n");
  assert.match(mobileCss, /\.formGrid\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(mobileCss, /\.instanceRow\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(mobileCss, /\.endpointCell code\s*\{[\s\S]*?white-space:\s*normal;/);
  assert.match(mobileCss, /\.rowActions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
});
