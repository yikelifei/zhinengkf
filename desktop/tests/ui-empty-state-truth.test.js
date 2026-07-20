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
  const component = read("apps/web/src/components/operations-overview.tsx");

  assert.doesNotMatch(page, /reviewReadIsAmbiguous|nextNotifications\.length\s*===\s*0/);
  assert.match(page, /setReviewCenter\(nextReviewCenter\)/);
  assert.match(page, /setNotificationsLoaded\(results\[5\]\.status === "fulfilled"\)/);
  assert.match(page, /actionsLoaded=\{channelStatus !== null && operations !== null && reviewCenter !== null && notificationsLoaded\}/);
  assert.match(component, /channelsLoaded:\s*boolean/);
  assert.match(component, /actionsLoaded:\s*boolean/);
  assert.match(component, /conversationsLoaded:\s*boolean/);
  assert.match(component, /actionsLoaded \? \(/);
  assert.match(component, /读取成功，当前没有已登记的渠道/);
  assert.match(component, /待处理数据尚未成功读取/);
  assert.match(component, /最近会话尚未成功读取/);
});

test("shared read hooks mark fulfilled empty reads as loaded and caught failures as unknown", () => {
  const hooks = [
    ["apps/web/src/features/agents/use-agents-directory.ts", /setLoaded\(true\)/, /setAgents\(\[\]\)/],
    ["apps/web/src/features/notifications/use-notifications-controller.ts", /setLoaded\(true\)/, /setNotifications\(\[\]\)/],
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
});

test("listed consumers distinguish trusted empty data from unread or failed data", () => {
  const cases = [
    ["apps/web/src/features/design/design-assets-page.tsx", /assetsLoaded/, /当前客户尚无素材/, /素材状态未确认/],
    ["apps/web/src/features/notifications/notifications-page.tsx", /controller\.loaded/, /读取成功，当前身份范围内没有通知/, /通知列表尚未成功读取/],
    ["apps/web/src/features/agents/agents-page.tsx", /\bloaded\b/, /读取成功，当前没有已配置的智能体/, /智能体目录尚未成功读取/],
    ["apps/web/src/features/training/training-import-page.tsx", /agentsLoaded/, /读取成功，当前没有已配置的智能体/, /智能体选项尚未成功读取/],
    ["apps/web/src/features/training/training-import-history-page.tsx", /\bloaded\b/, /读取成功，当前没有聊天记录导入历史/, /导入历史尚未成功读取/],
    ["apps/web/src/features/training/training-review-page.tsx", /samplesLoaded/, /读取成功，当前筛选没有训练样本/, /训练样本尚未成功读取/],
    ["apps/web/src/features/training/training-review-queue-page.tsx", /\bloaded\b/, /读取成功，当前筛选没有训练样本/, /训练样本队列尚未成功读取/],
    ["apps/web/src/features/reviews/review-queue-pages.tsx", /\bloaded\b/, /读取成功/, /审核队列尚未成功读取/],
    ["apps/web/src/features/sales/sales-quotes-page.tsx", /\bloaded\b/, /读取成功，当前没有报价记录/, /报价列表尚未成功读取/],
    ["apps/web/src/features/sales/sales-orders-page.tsx", /\bloaded\b/, /读取成功，当前没有订单记录/, /订单列表尚未成功读取/],
  ];

  for (const args of cases) assertTrustedAndUnknown(...args);

  const assets = read("apps/web/src/features/design/design-assets-page.tsx");
  assert.match(assets, /setAssetsLoaded\(true\)/);
  assert.match(assets, /onError: \(cause\) => \{ setAssets\(\[\]\); setAssetsLoaded\(false\);/);
  assert.doesNotMatch(assets, /assets\.length \?[^:]+:\s*<DesignEmpty title="当前客户尚无素材"/);
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
  assert.match(agentDetail, /const missing = !busy && loaded && !agent/);
  assert.match(agentDetail, /目录读取成功，但地址中的智能体不存在/);
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
