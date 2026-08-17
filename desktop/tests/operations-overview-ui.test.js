"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const component = read("apps/web/src/components/operations-overview.tsx");
const overviewPage = read("apps/web/src/features/overview/overview-page.tsx");
const overviewData = read("apps/web/src/features/overview/use-overview-data.ts");
const overviewRoute = read("apps/web/src/app/overview-route-feature.tsx");
const automationPresentation = read("apps/web/src/features/overview/automation-status-presentation.ts");
const css = read("apps/web/src/components/operations-overview.module.css");

test("operations overview exposes an accessible overview-center workspace", () => {
  assert.match(
    component,
    /<section[\s\S]*?className=\{styles\.page\}[\s\S]*?id="overview-center"[\s\S]*?aria-labelledby="operations-overview-title"[\s\S]*?aria-busy=\{busy\}/,
  );
  assert.match(component, /<h1\s+id="operations-overview-title">运营总览<\/h1>/);
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
  assert.match(component, /上线计划/);
  assert.match(component, /企业微信上线计划/);
  assert.match(component, /自动化与训练/);
  assert.doesNotMatch(component, /快捷操作|quickActions|footerActions/);
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
  assert.match(component, /launchLoaded \? \(/);
  assert.match(component, /launchItems\.map\(\(item\)\s*=>/);
  assert.match(component, /\{item\.action\}/);
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
  assert.match(component, /onClick=\{onOpenLaunchPlan\}/);
  assert.match(component, /onClick=\{onRunAutomation\}\s+disabled=\{busy\}/);

  assert.equal(
    (component.match(/onClick=\{onRunAutomation\}/g) || []).length,
    1,
    "automation should have one clear navigation entry instead of duplicate quick actions",
  );
  assert.ok(
    (component.match(/onClick=\{onOpenChannels\}/g) || []).length >= 2,
    "channel management should remain reachable from populated and empty states",
  );
});

test("overview surfaces delivery readiness as a first-screen production handoff signal", () => {
  assert.match(overviewData, /getDeliveryReadiness/);
  assert.match(overviewPage, /type OverviewDestination =[\s\S]*\|\s*"delivery"/);
  assert.match(overviewPage, /id:\s*"delivery-readiness"/);
  assert.match(overviewPage, /onClick:\s*\(\)\s*=>\s*navigate\("delivery"\)/);
  assert.match(overviewPage, /id:\s*"delivery"/);
  assert.match(overviewPage, /deliveryReadiness !== null/);
  assert.match(overviewRoute, /delivery:\s*"\/settings\/delivery-readiness"/);
});

test("overview distinguishes durable scheduling from the optional in-process loop", () => {
  assert.match(overviewPage, /automationOverviewPresentation/);
  assert.match(automationPresentation, /持久调度运行中/);
  assert.match(automationPresentation, /status\.mode === "durable"/);
  assert.match(automationPresentation, /进程内循环无需保持激活/);
  assert.doesNotMatch(overviewPage, /automationStatus\?\.active \? "周期自动化运行中" : automationStatus \? "周期自动化已停止"/);
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
  assert.match(mobileCss, /\.page\s*\{[\s\S]*?gap:\s*9px;[\s\S]*?padding:\s*0;/);
  assert.match(mobileCss, /\.priorityGrid,\s*\n\s*\.insightGrid,\s*\n\s*\.metricGrid\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(mobileCss, /\.tableWrap table,[\s\S]*?\.tableWrap td\s*\{\s*display:\s*block;/);
  assert.match(css, /@media\s*\(max-width:\s*390px\)[\s\S]*?\.page\s*\{[\s\S]*?padding-right:\s*7px;[\s\S]*?padding-left:\s*7px;/);
  assert.doesNotMatch(css, /\.quickActions|\.footerActions/);
});
