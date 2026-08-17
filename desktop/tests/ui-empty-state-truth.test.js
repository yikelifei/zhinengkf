"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function assertTrustedAndUnknown(relativePath, loadedMarker, trustedCopy, unknownCopy) {
  const source = read(relativePath);
  assert.match(source, loadedMarker, `${relativePath} must use an explicit fulfilled-read marker`);
  assert.match(source, trustedCopy, `${relativePath} must render a trusted successful-empty state`);
  assert.match(source, unknownCopy, `${relativePath} must render an unconfirmed failed/unread state`);
}

test("overview derives empty-state truth from fulfilled reads instead of array length", () => {
  const page = read("apps/web/src/features/overview/overview-page.tsx");
  const dataHook = read("apps/web/src/features/overview/use-overview-data.ts");
  const component = read("apps/web/src/components/operations-overview.tsx");
  const model = read("apps/web/src/components/operations-overview-model.ts");

  assert.doesNotMatch(`${page}\n${dataHook}`, /reviewReadIsAmbiguous|nextNotifications\.length\s*===\s*0/);
  assert.match(dataHook, /progressiveOverviewRead\(getReviewCenter\(stableIdentityFilters\)[\s\S]*?setReviewCenterRead\(\{ scopeKey: requestScopeKey, value \}\);/);
  assert.match(dataHook, /progressiveOverviewRead\(getNotifications\(false, stableIdentityFilters\)[\s\S]*?setNotificationsRead\(\{ scopeKey: requestScopeKey, value \}\);/);
  assert.match(dataHook, /const notificationsLoaded = notificationsRead\?\.scopeKey === identityScopeKey/);
  assert.match(dataHook, /function scopedValue<T>[\s\S]*?read\?\.scopeKey === scopeKey \? read\.value : null/);
  assert.match(dataHook, /const results = await Promise\.allSettled\(reads\)/);
  assert.match(dataHook, /已成功读取的内容仍可继续使用，未读到的状态保持未确认/);
  assert.doesNotMatch(dataHook, /setReviewCenterRead\(null\)|setNotificationsRead\(null\)/);
  assert.match(page, /useOverviewData\(identityFilters\)/);
  assert.match(page, /actionsLoaded=\{channelStatus !== null && operations !== null && reviewCenter !== null && wechatWorkReadiness !== null && deliveryReadiness !== null && notificationsLoaded\}/);
  assert.match(dataHook, /getWechatWorkProductionPreflight/);
  assert.match(model, /channelsLoaded:\s*boolean/);
  assert.match(model, /actionsLoaded:\s*boolean/);
  assert.match(model, /conversationsLoaded:\s*boolean/);
  assert.match(component, /actionsLoaded \? \(/);
  assert.match(component, /读取成功，当前没有已登记的渠道/);
  assert.match(component, /待处理数据尚未成功读取/);
  assert.match(component, /最近会话尚未成功读取/);
});

test("shared read hooks mark fulfilled empty reads as loaded and caught failures as unknown", () => {
  const hooks = [
    ["apps/web/src/features/reviews/review-page-shared.tsx", /setLoaded\(true\)/, /setCenter\(null\)/],
    ["apps/web/src/features/training/use-training-samples.ts", /setLoaded\(true\)/, /setSamples\(\[\]\)/],
    ["apps/web/src/features/sales/use-sales-records.ts", /setLoaded\(true\)/, /setLoaded\(false\)/],
  ];

  for (const [relativePath, fulfilled, rejected] of hooks) {
    const source = read(relativePath);
    assert.match(source, fulfilled, `${relativePath} must record fulfilled reads`);
    assert.match(source, rejected, `${relativePath} must fail closed after a caught read error`);
    assert.doesNotMatch(source, /无法区分真实|接口返回空结果|ambiguousEmpty/);
  }

  const agentHook = read("apps/web/src/features/agents/use-agents-directory.ts");
  assert.match(agentHook, /setLoadedScopeKey\(requestScopeKey\)/);
  assert.match(agentHook, /loadedScopeKeyRef\.current === requestScopeKey/);
  assert.match(agentHook, /setStaleScopeKey\(requestScopeKey\)/);
  assert.match(agentHook, /const scopedAgents = loadedScopeKey === scopeKey \? agents : \[\]/);
  assert.doesNotMatch(agentHook, /setAgents\(\[\]\)/);
});

test("listed consumers distinguish trusted empty data from unread or failed data", () => {
  const cases = [
    ["apps/web/src/features/design/design-assets-list-panel.tsx", /assetsLoaded/, /当前客户尚无素材/, /素材状态未确认/],
    ["apps/web/src/features/notifications/notifications-page.tsx", /controller\.loaded/, /读取成功，当前身份范围内没有通知/, /通知列表尚未成功读取/],
    ["apps/web/src/features/agents/agents-page.tsx", /readState === "ready"/, /读取成功，当前没有已配置的智能体/, /智能体目录尚未成功读取/],
    ["apps/web/src/features/training/training-import-page.tsx", /agentsLoaded/, /读取成功，当前没有已配置的智能体/, /智能体选项尚未成功读取/],
    ["apps/web/src/features/training/training-import-history-page.tsx", /importsKnown/, /读取成功，当前没有聊天记录导入历史/, /导入历史尚未成功读取/],
    ["apps/web/src/features/training/training-review-page.tsx", /samplesLoaded/, /读取成功，当前筛选没有训练样本/, /训练样本尚未成功读取/],
    ["apps/web/src/features/training/training-review-queue-page.tsx", /\bloaded\b/, /读取成功，当前筛选没有训练样本/, /训练样本队列尚未成功读取/],
    ["apps/web/src/features/reviews/review-queue-pages.tsx", /\bloaded\b/, /读取成功/, /审核队列尚未成功读取/],
    ["apps/web/src/features/sales/sales-quotes-page.tsx", /\bloaded\b/, /读取成功，当前没有报价记录/, /报价列表尚未成功读取/],
    ["apps/web/src/features/sales/sales-orders-page.tsx", /\bloaded\b/, /读取成功，当前没有订单记录/, /订单列表尚未成功读取/],
  ];

  for (const args of cases) assertTrustedAndUnknown(...args);

  const assetsPage = read("apps/web/src/features/design/design-assets-page.tsx");
  const assetsList = read("apps/web/src/features/design/design-assets-list-panel.tsx");
  assert.match(assetsPage, /setAssetsLoaded\(true\)/);
  assert.match(assetsPage, /onError: \(cause\) => \{ setAssets\(\[\]\); setAssetsLoaded\(false\);/);
  assert.doesNotMatch(`${assetsPage}\n${assetsList}`, /assets\.length \?[^:]+:\s*<DesignEmpty title="当前客户尚无素材"/);
});

test("notification reads use an explicit same-scope stale cache without cross-scope leakage", () => {
  const controller = read("apps/web/src/features/notifications/use-notifications-controller.ts");
  const page = read("apps/web/src/features/notifications/notifications-page.tsx");
  assert.match(controller, /const scopeLoaded = loaded && loadedScopeKey === scopeKey/);
  assert.match(controller, /const scopedNotifications = scopeLoaded \? notifications : \[\]/);
  assert.match(controller, /notificationReadState\(\{ busy, currentScopeKey: scopeKey, loadedScopeKey, staleScopeKey \}\)/);
  assert.match(controller, /loadedScopeKeyRef\.current === requestScopeKey/);
  assert.match(controller, /setStaleScopeKey\(requestScopeKey\)/);
  assert.doesNotMatch(controller, /setNotifications\(\[\]\)/);
  assert.match(page, /最新刷新失败，当前显示上次在同一身份范围内成功读取的可信结果/);
  assert.match(page, /通知列表尚未成功读取，不能据此认定没有未读通知/);
});

test("review and sales detail consumers do not claim a record is missing after a failed read", () => {
  const details = [
    "apps/web/src/features/reviews/review-design-page.tsx",
    "apps/web/src/features/reviews/review-quotes-page.tsx",
    "apps/web/src/features/reviews/review-orders-page.tsx",
    "apps/web/src/features/sales/sales-quote-detail-page.tsx",
    "apps/web/src/features/sales/sales-quote-action-page.tsx",
    "apps/web/src/features/sales/sales-order-detail-page.tsx",
    "apps/web/src/features/sales/sales-order-edit-page.tsx",
    "apps/web/src/features/sales/sales-order-message-page.tsx",
  ];

  for (const relativePath of details) {
    const source = read(relativePath);
    assert.match(source, /\bloaded\b/);
    assert.match(source, /读取成功/);
    assert.match(source, /未确认|尚未成功读取/);
  }

  const agentDetail = read("apps/web/src/features/agents/agent-detail-page.tsx");
  assert.match(agentDetail, /const missing = !busy && readState === "ready" && !agent/);
  assert.match(agentDetail, /目录读取成功，但地址中的智能体不存在/);
  assert.match(agentDetail, /disabled=\{!executionAllowed \|\| executingSkillId === skill\.id\}/);
});

test("empty-state pages retain responsive rules that cover a 390px viewport", () => {
  const stylesheets = [
    "apps/web/src/components/operations-overview.module.css",
    "apps/web/src/features/governance-pages.module.css",
    "apps/web/src/features/design/design-pages.module.css",
    "apps/web/src/features/sales/sales-pages.module.css",
  ];

  for (const relativePath of stylesheets) {
    const css = read(relativePath);
    const breakpoints = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((match) => Number(match[1]));
    assert.ok(breakpoints.some((width) => width >= 390), `${relativePath} must include a mobile breakpoint covering 390px`);
    assert.doesNotMatch(css, /min-width:\s*(?:39[1-9]|[4-9]\d\d|\d{4,})px/);
  }
});
