"use strict";

function buildQuoteCustomerMessage(input = {}) {
  const customerName = cleanText(input.customerName);
  const scene = cleanText(input.scene) || "礼盒方案";
  const quantity = toNumber(input.quantity, 1);
  const unitPrice = formatMoney(input.unitPrice);
  const totalPrice = formatMoney(input.totalPrice);
  const itemNames = Array.isArray(input.items)
    ? input.items
        .map((item) => cleanText(item && (item.name || item.productName || item.skuName || item.skuCode)))
        .filter(Boolean)
        .slice(0, 6)
    : [];

  const greeting = customerName ? `${customerName}，` : "";
  const imageContext = input.hasSelectedImage ? "按您刚刚选中的效果图" : "按我们刚才确认的搭配方向";
  const bundleText = itemNames.length
    ? `这套里包含${itemNames.join("、")}`
    : "这套搭配我已经重新核过";

  return `${greeting}${imageContext}，${scene}的报价我给您核好了：${bundleText}。数量 ${quantity} 份，单价 ${unitPrice} 元/份，合计 ${totalPrice} 元。您先看下这个价格和搭配是否合适，没问题我再继续帮您整理后面的确认信息。`;
}

function buildOrderConfirmationCustomerMessage(input = {}) {
  const customerName = cleanText(input.customerName);
  const scene = cleanText(input.scene) || "礼盒方案";
  const quantity = toNumber(input.quantity, 1);
  const totalPrice = formatMoney(input.totalPrice);
  const paymentStatus = cleanText(input.paymentStatus) || "unpaid";
  const itemNames = Array.isArray(input.items)
    ? input.items
        .map((item) => cleanText(item && (item.name || item.productName || item.skuName || item.skuCode)))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const greeting = customerName ? `${customerName}，` : "";
  const itemText = itemNames.length ? `，搭配按${itemNames.join("、")}这套来` : "";
  const base = `${greeting}收到，我这边先按您确认的${scene}${itemText}锁定下来。数量 ${quantity} 份，合计 ${totalPrice} 元。`;

  if (paymentStatus === "paid") {
    return `${base}款项我先按已付款记录，接下来给您整理订单信息并推进排产；交期或细节有变化，我会及时跟您同步。`;
  }
  if (paymentStatus === "deposit_paid") {
    return `${base}定金我先按已确认记录，接下来给您整理订单信息并推进排产；剩余款项和交期我会再跟您逐项确认。`;
  }
  return `${base}接下来我给您整理订单确认信息，付款方式、交期和细节会再跟您逐项确认，避免后面有遗漏。`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function formatMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/\.?0+$/, "");
}

module.exports = {
  buildOrderConfirmationCustomerMessage,
  buildQuoteCustomerMessage,
};
