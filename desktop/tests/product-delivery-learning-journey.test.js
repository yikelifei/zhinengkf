"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("send task detail links back to business fulfillment and learning", () => {
  const source = read("apps/web/src/features/send/send-task-card.tsx");
  assert.match(source, /返回订单交付/);
  assert.match(source, /回到客户会话/);
  assert.match(source, /沉淀本次结果/);
  assert.match(source, /不要把“已入队”当成客户已收到/);
});

test("delivery audit exposes a single recommended next action and direct send recovery", () => {
  const source = [
    read("apps/web/src/features/sales/sales-order-delivery-audit.tsx"),
    read("apps/web/src/features/sales/sales-order-delivery-next-action.ts"),
  ].join("\n");
  assert.match(source, /推荐下一步/);
  assert.match(source, /先处理发送失败/);
  assert.match(source, /scopedSendTaskHref\("\/send\/blocked"/);
  assert.match(source, /渠道已接受发送不等于客户已经看到/);
  assert.doesNotMatch(source, /String\(task\.status \|\| ""\) === "sent"\) return true/);
  assert.match(source, /沉淀交付结果/);
});

test("after-sales completion requires evidence and offers customer follow-up plus reviewed learning", () => {
  const page = read("apps/web/src/features/sales/sales-order-after-sales-page.tsx");
  const panels = read("apps/web/src/features/sales/sales-order-after-sales-panels.tsx");
  const service = read("apps/api/src/orders/orders.service.ts");
  assert.match(page, /refundMethod\.trim\(\).*refundReference\.trim\(\)/s);
  assert.match(service, /退款或补偿处理必须填写实际退款方式/);
  assert.match(service, /退款或补偿处理必须填写可核验的退款凭证号/);
  assert.match(service, /记录补发完成必须填写物流公司和可核验的补发物流单号/);
  assert.match(service, /物流公司或物流单号格式不正确/);
  assert.match(panels, /回访客户/);
  assert.match(panels, /afterSalesLearningReadiness/);
  assert.match(panels, /进入结果复核/);
  assert.match(panels, /复核通过前不会自动写成可用话术/);
});

test("training overview keeps partial successes and requires confirmation evidence", () => {
  const source = [
    read("apps/web/src/features/training/training-overview-page.tsx"),
    read("apps/web/src/features/training/conversation-feedback-record.tsx"),
  ].join("\n");
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /已保留成功读取的内容/);
  assert.match(source, /请填写客户原话、订单事实或人工判断依据/);
  assert.match(source, /training-outcome-confirm/);
  assert.match(source, /不会自动启用为知识或 Skill/);
});

test("notifications route after-sales and send failures to the correct responsibility page", () => {
  const source = [
    read("apps/web/src/features/notifications/notifications-page.tsx"),
    read("apps/web/src/features/notifications/notification-navigation.ts"),
  ].join("\n");
  assert.match(source, /afterSalesCaseId/);
  assert.match(source, /处理售后 case/);
  assert.match(source, /notificationNeedsBlockedSendHandling/);
  assert.match(source, /查看发送进度/);
});
