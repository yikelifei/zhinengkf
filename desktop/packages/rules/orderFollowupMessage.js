"use strict";

function buildOrderFollowupCustomerMessage(input = {}) {
  const type = cleanText(input.type) || inferFollowupType(input.status);
  const customerName = cleanText(input.customerName);
  const scene = cleanText(input.scene) || "礼盒方案";
  const quantity = toNumber(input.quantity, 1);
  const totalPrice = formatMoney(input.totalPrice);
  const paymentStatus = cleanText(input.paymentStatus) || "unpaid";
  const leadTimeDays = positiveInteger(input.leadTimeDays, 0);
  const productionStatus = cleanText(input.productionStatus);
  const productionDueAt = cleanText(input.productionDueAt);
  const carrier = cleanText(input.carrier);
  const trackingNo = cleanText(input.trackingNo);
  const shippedAt = cleanText(input.shippedAt);
  const deliveredAt = cleanText(input.deliveredAt);
  const itemNames = Array.isArray(input.items)
    ? input.items
        .map((item) => cleanText(item && (item.name || item.productName || item.skuName || item.skuCode)))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const greeting = customerName ? `${customerName}，` : "";
  const itemText = itemNames.length ? `，这单搭配是${itemNames.join("、")}` : "";
  const orderText = `${scene}${itemText}，数量 ${quantity} 份，金额 ${totalPrice} 元`;
  const leadText = leadTimeDays
    ? `目前按 ${leadTimeDays} 天左右的交期节奏帮您盯着，`
    : "具体交期我会继续跟进确认，";
  const productionFacts = buildProductionFactText({ productionStatus, productionDueAt });
  const deliveryFacts = buildDeliveryFactText({ carrier, trackingNo, shippedAt, deliveredAt });
  const paymentText =
    paymentStatus === "unpaid"
      ? "付款信息这边我也会同步核对，避免影响后续排产。"
      : paymentStatus === "deposit_paid"
        ? "定金已按当前状态记录，尾款和交付细节我会继续跟您同步。"
        : "款项状态已记录，后续我会重点盯交期和交付细节。";

  if (type === "delivery") {
    const deliveryText = deliveryFacts
      ? `交付信息：${deliveryFacts}。`
      : `这边已经进入交付前跟进阶段，${leadText}有物流单号、发货时间或现场交付细节出来，我会第一时间发您确认。`;
    return `${greeting}跟您同步一下订单进度：${orderText}。${deliveryText}${paymentText}`;
  }

  const productionText = productionFacts
    ? `当前生产状态：${productionFacts}。`
    : `这边已经按您确认的方案进入备货/排产跟进，${leadText}如果中间有物料、包装或交期变化，我会提前跟您说清楚，不让您临近使用时被动。`;
  return `${greeting}跟您同步一下订单进度：${orderText}。${productionText}${paymentText}`;
}

function inferFollowupType(status) {
  return cleanText(status) === "fulfilled" ? "delivery" : "production";
}

function cleanText(value) {
  const text = String(value || "").trim();
  return isUnreadableText(text) ? "" : text;
}

function isUnreadableText(value) {
  if (!value) return false;
  if (value.includes("\uFFFD")) return true;
  const questionMarks = value.match(/\?/g)?.length || 0;
  return questionMarks >= 3 && questionMarks >= Math.ceil(value.length / 2);
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function formatMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/\.?0+$/, "");
}

function buildProductionFactText(input) {
  const parts = [];
  const status = productionStatusLabel(input.productionStatus);
  if (status) parts.push(status);
  if (input.productionDueAt) parts.push(`预计完成 ${input.productionDueAt}`);
  return parts.join("，");
}

function buildDeliveryFactText(input) {
  const parts = [];
  if (input.carrier) parts.push(`物流 ${input.carrier}`);
  if (input.trackingNo) parts.push(`单号 ${input.trackingNo}`);
  if (input.shippedAt) parts.push(`发货时间 ${input.shippedAt}`);
  if (input.deliveredAt) parts.push(`签收时间 ${input.deliveredAt}`);
  return parts.join("，");
}

function productionStatusLabel(value) {
  const labels = {
    not_started: "备货/排产跟进中",
    in_production: "生产中",
    quality_check: "质检中",
    ready_to_ship: "待发货",
    shipped: "已发货",
    delivered: "已签收",
    blocked: "生产受阻",
  };
  return labels[value] || "";
}

module.exports = {
  buildOrderFollowupCustomerMessage,
};
