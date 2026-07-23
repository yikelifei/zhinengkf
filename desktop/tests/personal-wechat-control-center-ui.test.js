"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const component = read("apps/web/src/components/personal-wechat-control-center/personal-wechat-control-center.tsx");
const fleet = read("apps/web/src/components/personal-wechat-control-center/account-fleet-pane.tsx");
const inspector = read("apps/web/src/components/personal-wechat-control-center/account-inspector-pane.tsx");
const types = read("apps/web/src/components/personal-wechat-control-center/types.ts");
const css = read("apps/web/src/components/personal-wechat-control-center/personal-wechat-control-center.module.css");

test("personal WeChat control center is modular and caller-controlled", () => {
  assert.match(component, /import \{ AccountFleetPane \} from "\.\/account-fleet-pane";/);
  assert.match(component, /import \{ AccountInspectorPane \} from "\.\/account-inspector-pane";/);
  assert.match(types, /accounts: PersonalWechatAccount\[\];/);
  assert.match(types, /approvals: PersonalWechatApproval\[\];/);
  assert.match(types, /selectedAccountId\?: string \| null;/);
  assert.match(types, /onSelectAccount: \(accountId: string\) => void;/);
  assert.match(types, /onGlobalSendModeChange: \(mode: PersonalWechatGlobalSendMode\) => void;/);
  assert.doesNotMatch(`${component}\n${fleet}\n${inspector}`, /\bfetch\s*\(|\baxios\b|useEffect\s*\(|localStorage|sessionStorage/);
});

test("global sending and voice policies fail closed by default", () => {
  assert.match(component, /globalSendMode = "disabled"/);
  assert.match(component, /voicePolicy = "disabled"/);
  assert.match(component, /<option value="disabled">禁用发送（默认）<\/option>/);
  assert.match(component, /全局发送已禁用/);
  assert.match(component, /不模拟真人节奏规避平台治理/);
  assert.match(component, /禁止冒充真人或仿冒特定个人声纹/);
  assert.doesNotMatch(component, /一键群发|自动群发|随机延迟|模拟真人打字|绕过风控/);
});

test("fleet exposes account, Windows session, endpoint and verified window identity", () => {
  assert.match(fleet, /account\.displayName/);
  assert.match(fleet, /account\.windowsSessionLabel/);
  assert.match(fleet, /account\.windowsSessionId/);
  assert.match(inspector, /account\.endpoint\.url/);
  assert.match(inspector, /identity\.verified \? "已核验" : "未核验"/);
  assert.match(inspector, /account\.windowIdentity\.processId/);
  assert.match(inspector, /account\.windowIdentity\.windowHandle/);
  assert.match(inspector, /批量运营只统一管理队列与审批/);
});

test("online, isolated, manual takeover and approvals remain explicit", () => {
  assert.match(types, /"online" \| "offline" \| "isolated" \| "manual"/);
  assert.match(component, /account\.state === "online"/);
  assert.match(component, /account\.state === "isolated"/);
  assert.match(component, /account\.state === "manual"/);
  assert.match(component, /approvals\.map\(\(approval\) =>/);
  assert.match(component, /actions\.onOpenApproval\(approval\.id\)/);
  assert.match(inspector, /onRequestManualTakeover\(account\.id\)/);
  assert.match(inspector, /onIsolateAccount\(account\.id\)/);
  assert.match(inspector, /onRequestReleaseIsolation\(account\.id\)/);
});

test("responsive CSS keeps the 390px control center single-column", () => {
  assert.match(css, /\.controlCenter\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /var\(--wk-color-brand\)/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|overflow-x:\s*(?:auto|scroll)/i);

  const mobileMedia = /@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)(?=\n@media|$)/g;
  const matchingRules = [...css.matchAll(mobileMedia)].filter((match) => Number(match[1]) >= 390);
  assert.ok(matchingRules.length > 0, "a max-width breakpoint must cover 390px");
  const mobileCss = matchingRules.map((match) => match[2]).join("\n");
  assert.match(mobileCss, /\.workspace,\s*\n\s*\.lowerGrid\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(mobileCss, /\.accountRow\s*\{\s*grid-template-columns:\s*38px minmax\(0, 1fr\) 16px;/);
  assert.match(mobileCss, /\.controlActions\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*1fr;/);
});
