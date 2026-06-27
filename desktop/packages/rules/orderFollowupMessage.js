"use strict";

function buildOrderFollowupCustomerMessage(input = {}) {
  const type = cleanText(input.type) || inferFollowupType(input.status);
  const customerName = cleanText(input.customerName);
  const scene = cleanText(input.scene) || "礼盒方案";
  const quantity = toNumber(input.quantity, 1);
  const totalPrice = formatMoney(input.totalPrice);
  const paymentStatus = cleanText(input.paymentStatus) || "unpaid";
  const leadTimeDays = positiveInteger(input.leadTimeDays, 0);
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
  const paymentText =
    paymentStatus === "unpaid"
      ? "付款信息这边我也会同步核对，避免影响后续排产。"
      : paymentStatus === "deposit_paid"
        ? "定金已按当前状态记录，尾款和交付细节我会继续跟您同步。"
        : "款项状态已记录，后续我会重点盯交期和交付细节。";

  if (type === "delivery") {
    return `${greeting}跟您同步一下订单进度：${orderText}。这边已经进入交付前跟进阶段，${leadText}有物流单号、发货时间或现场交付细节出来，我会第一时间发您确认。${paymentText}`;
  }

  return `${greeting}跟您同步一下订单进度：${orderText}。这边已经按您确认的方案进入备货/排产跟进，${leadText}如果中间有物料、包装或交期变化，我会提前跟您说清楚，不让您临近使用时被动。${paymentText}`;
}

function inferFollowupType(status) {
  return cleanText(status) === "fulfilled" ? "delivery" : "production";
}

function cleanText(value) {
  return String(value || "").trim();
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

module.exports = {
  buildOrderFollowupCustomerMessage,
};
