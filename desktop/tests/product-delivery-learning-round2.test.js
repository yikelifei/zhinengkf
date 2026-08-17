"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("send responsibility links preserve exact account conversation and customer scope", () => {
  const policy = read("apps/web/src/features/send/send-policy.ts");
  const queueRoute = read("apps/web/src/app/send/queue/[id]/page.tsx");
  const blockedRoute = read("apps/web/src/app/send/blocked/[id]/page.tsx");
  assert.match(policy, /scopedSendTaskHref/);
  assert.match(policy, /params\.set\("wechatAccountId"/);
  assert.match(policy, /params\.set\("conversationId"/);
  assert.match(policy, /params\.set\("customerId"/);
  assert.match(policy, /scopedIdentityHref/);
  for (const route of [queueRoute, blockedRoute]) {
    assert.match(route, /identityFiltersFromSearchParams/);
    assert.match(route, /filters=\{filters\}/);
  }
});

test("notification refresh failures retain confirmed content and distinguish partial mark-all success", () => {
  const source = read("apps/web/src/features/notifications/use-notifications-controller.ts");
  const refreshBlock = source.slice(source.indexOf("const refresh = useCallback"), source.indexOf("const unreadCount"));
  assert.doesNotMatch(refreshBlock, /setNotifications\(\[\]\)/);
  assert.match(source, /通知刷新失败，已保留上次成功读取的内容/);
  assert.match(source, /已读操作已由服务端确认，但最新列表重新读取失败/);
});

test("after-sales unknown state disables mutations and cannot render a false empty queue", () => {
  const page = read("apps/web/src/features/sales/sales-order-after-sales-page.tsx");
  const panels = read("apps/web/src/features/sales/sales-order-after-sales-panels.tsx");
  assert.match(page, /recordsFresh && identityReady/);
  assert.match(page, /售后记录尚未成功读取，创建、处理和经验沉淀均已禁用/);
  assert.match(page, /售后记录最新刷新失败，已保留上次内容/);
  assert.match(panels, /售后记录状态未确认/);
  assert.match(panels, /售后记录未确认，不能判断是否存在待处理 case/);
  assert.match(panels, /不能据此认定没有待处理 case/);
});

test("after-sales learning opens only after closed evidence is complete", () => {
  const panels = read("apps/web/src/features/sales/sales-order-after-sales-panels.tsx");
  assert.match(panels, /loaded \? \([\s\S]*!openCount && learning\.ready/);
  assert.match(panels, /缺少客户问题凭证/);
  assert.match(panels, /退款或补偿流水证据不完整/);
  assert.match(panels, /补发物流证据不完整/);
  assert.match(panels, /“进入结果复核”不是训练完成/);
});

test("send-task learning stays hidden until customer-visible delivery is confirmed", () => {
  const source = read("apps/web/src/features/send/send-task-card.tsx");
  assert.match(source, /const customerVisible =/);
  assert.match(source, /manualDeliveryResolution\?\.resolution === "confirmed_sent"/);
  assert.match(source, /if \(customerVisible && task\.wechatAccountId/);
});

test("390px layouts stack recommendation and business action links", () => {
  const sendCss = read("apps/web/src/features/send/send-pages.module.css");
  const salesCss = read("apps/web/src/features/sales/sales-pages.module.css");
  assert.match(sendCss, /@media \(max-width: 520px\)[\s\S]*\.businessContext[\s\S]*\.buttonRow \.secondaryLink/);
  assert.match(salesCss, /@media \(max-width: 640px\)[\s\S]*\.actionBar[\s\S]*\.buttonRow \.primaryButton/);
});
