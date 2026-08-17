"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const journey = read("apps/web/src/components/customer-service-journey.tsx");
const journeyCss = read("apps/web/src/components/customer-service-journey.module.css");
const overview = read("apps/web/src/features/overview/overview-page.tsx");
const overviewData = read("apps/web/src/features/overview/use-overview-data.ts");
const overviewPresentation = read("apps/web/src/features/overview/overview-presentation.ts");
const overviewJourneySource = `${overview}\n${overviewPresentation}`;
const wechatFlow = read("apps/web/src/features/integrations/wechat-work-flow-page.tsx");
const workspace = read("apps/web/src/features/integrations/wechat-work-workspace-page.tsx");
const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");
const thread = read("apps/web/src/components/conversation-workbench/conversation-thread-pane.tsx");
const navigation = read("apps/web/src/components/workbench-shell/navigation.ts");

test("the product exposes one actionable customer-to-order journey", () => {
  assert.match(journey, /业务主链路/);
  assert.match(journey, /steps\.map\(\(step, index\) =>/);
  assert.match(journey, /href=\{step\.href\}/);
  assert.match(journey, /journey\.recommended\.open/);
  assert.match(overview, /<CustomerServiceJourney steps=\{journeySteps\} recommended=\{journeyRecommended\}/);
  assert.match(wechatFlow, /<CustomerServiceJourney steps=\{journeySteps\} recommended=\{recommended\}/);
  for (const route of [
    "/integrations/wechat-work/customers",
    "/integrations/wechat-work/workspace",
    "/catalog/bundles",
    "/reviews/inbox",
    "/sales/quotes",
    "/send/queue",
  ]) {
    assert.ok(overviewJourneySource.includes(`href: "${route}"`), `overview journey must link ${route}`);
    assert.ok(wechatFlow.includes(`href: "${route}"`), `wechat flow journey must link ${route}`);
  }
});

test("journey layout remains usable from desktop to phone", () => {
  assert.match(journeyCss, /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(journeyCss, /@media \(max-width: 1180px\)[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(journeyCss, /@media \(max-width: 760px\)[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(journeyCss, /@media \(max-width: 420px\)[\s\S]*?grid-template-columns:\s*1fr/);
  assert.doesNotMatch(journeyCss, /linear-gradient|radial-gradient/i);
});

test("overview and conversations progressively reveal live data", () => {
  assert.match(overviewData, /progressiveOverviewRead\(getWechatChannelStatus/);
  assert.match(overviewData, /progressiveOverviewRead\(getConversationOperationsQueue/);
  assert.match(overviewData, /已成功读取的内容仍可继续使用/);
  assert.doesNotMatch(overviewData, /const nextChannelStatus = results\[0\]/);

  assert.match(controller, /const conversationRequest = withConversationReadTimeout/);
  assert.match(controller, /setConversations\(records\)/);
  assert.match(controller, /conversationRequest[\s\S]*?\.finally\(\(\) => \{[\s\S]*?setListLoading\(false\)/);
  assert.doesNotMatch(controller, /const \[conversationResult, operationsResult, aiStatusResult\] = await Promise\.allSettled/);
  assert.match(workspace, /正在同步企业微信会话/);
  assert.match(workspace, /会话列表会先加载，AI 和其他运营状态不会阻塞这里/);
});

test("enterprise WeChat conversations keep the next business actions in context", () => {
  assert.match(thread, /thread\.workflowActions\?\.length \? <ConversationWorkflowRail/);
  assert.doesNotMatch(thread, /variant === "default" && thread\.workflowActions/);
  assert.match(workspace, /variant="wecom"/);
});

test("sidebar follows the operator mental model before advanced configuration", () => {
  const today = navigation.indexOf('label: "今日工作"');
  const solution = navigation.indexOf('label: "方案与成交"');
  const operations = navigation.indexOf('label: "运营与提效"');
  const system = navigation.indexOf('label: "能力与配置"');
  assert.ok(today >= 0 && solution > today && operations > solution && system > operations);
  assert.ok(navigation.indexOf('label: "企业微信"') < navigation.indexOf('label: "路由与分配"'));
  assert.ok(navigation.indexOf('label: "人工审核"') < navigation.indexOf('label: "系统管理"'));
});
