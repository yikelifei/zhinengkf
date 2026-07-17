"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const component = read("apps/web/src/components/operations-overview.tsx");
const css = read("apps/web/src/components/operations-overview.module.css");

test("operations overview exposes an accessible overview-center workspace", () => {
  assert.match(
    component,
    /<section[\s\S]*?className=\{styles\.page\}[\s\S]*?id="overview-center"[\s\S]*?aria-labelledby="operations-overview-title"[\s\S]*?aria-busy=\{busy\}/,
  );
  assert.match(component, /<h2\s+id="operations-overview-title">运营总览<\/h2>/);
  assert.match(component, /<div\s+className=\{styles\.metricGrid\}\s+aria-label="实时运营指标">/);
  assert.match(component, /<th\s+scope="col">客户<\/th>/);
  assert.match(component, /<span\s+className=\{styles\.srOnly\}>操作<\/span>/);
  assert.doesNotMatch(component, /<button(?![^>]*\btype="button")/);
});

test("overview follows the dense Tencent-style operational information hierarchy", () => {
  assert.match(component, /className=\{styles\.priorityGrid\}/);
  assert.match(component, /className=\{styles\.insightGrid\}/);
  assert.match(component, /渠道状态/);
  assert.match(component, /待处理事项/);
  assert.match(component, /自动化与训练/);
  assert.match(component, /快捷操作/);
  assert.match(component, /最近会话/);

  assert.match(css, /--overview-brand:\s*var\(--wk-color-brand\);/);
  assert.match(css, /--overview-surface:\s*var\(--wk-color-surface\);/);
  assert.match(css, /border:\s*1px solid var\(--overview-border\);/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/i);
});

test("channels, actions, metrics, and conversations are rendered from caller-owned live data", () => {
  assert.match(component, /channels\.length\s*\?\s*channels\.map\(\(channel\)\s*=>/);
  assert.match(component, /actions\.reduce\(\(sum, item\)\s*=>\s*sum \+ Number\(item\.count \|\| 0\), 0\)/);
  assert.match(component, /actions\.length\s*\?\s*actions\.map\(\(action\)\s*=>/);
  assert.match(component, /metrics\.map\(\(metric\)\s*=>/);
  assert.match(component, /conversations\.length\s*\?\s*\(/);
  assert.match(component, /conversations\.map\(\(conversation\)\s*=>/);

  assert.match(component, /\{channel\.label\}/);
  assert.match(component, /\{channel\.statusLabel\}/);
  assert.match(component, /\{action\.label\}/);
  assert.match(component, /\{metric\.value\}/);
  assert.match(component, /\{conversation\.customer\}/);
  assert.match(component, /\{conversation\.preview\s*\|\|\s*"暂无消息摘要"\}/);
});

test("overview actions delegate refresh, navigation, conversation, and automation callbacks", () => {
  assert.match(component, /onClick=\{onRefresh\}\s+disabled=\{busy\}/);
  assert.match(component, /onClick=\{action\.onClick\}/);
  assert.match(component, /onClick=\{conversation\.onOpen\}/);
  assert.match(component, /onClick=\{onOpenConversations\}/);
  assert.match(component, /onClick=\{onOpenChannels\}/);
  assert.match(component, /onClick=\{onRunAutomation\}\s+disabled=\{busy\}/);

  assert.ok(
    (component.match(/onClick=\{onRunAutomation\}/g) || []).length >= 2,
    "automation should be available from both the metric panel and quick actions",
  );
  assert.ok(
    (component.match(/onClick=\{onOpenChannels\}/g) || []).length >= 2,
    "channel management should remain reachable from populated and empty states",
  );
});

test("component contains no embedded demo records or mock operational metrics", () => {
  assert.doesNotMatch(component, /\b(?:demo|mock|sample|fake)(?:Channels?|Actions?|Metrics?|Conversations?)\b/i);
  assert.doesNotMatch(component, /const\s+(?:channels|actions|metrics|conversations)\s*=/);
  assert.doesNotMatch(component, /(?:祭小司|设计3号ai出图|测试客户|示例客户|演示账号)/i);
  assert.doesNotMatch(component, /(?:今日会话|待处理会话|平均响应|满意度)\s*[：:]?\s*\d/);
});

test("responsive CSS breakpoint covers a 390px viewport with a usable single-column layout", () => {
  const mobileMedia = /@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)(?=\n@media|$)/g;
  const matchingRules = [...css.matchAll(mobileMedia)].filter((match) => Number(match[1]) >= 390);
  assert.ok(matchingRules.length > 0, "a max-width breakpoint must include a 390px viewport");

  const mobileCss = matchingRules.map((match) => match[2]).join("\n");
  assert.match(mobileCss, /\.page\s*\{[\s\S]*?padding:\s*11px 9px 14px;/);
  assert.match(mobileCss, /\.priorityGrid,\s*\n\s*\.insightGrid,\s*\n\s*\.metricGrid\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(mobileCss, /\.tableWrap table,[\s\S]*?\.tableWrap td\s*\{\s*display:\s*block;/);
  assert.match(mobileCss, /\.footerActions\s*\{\s*display:\s*grid;/);
});
