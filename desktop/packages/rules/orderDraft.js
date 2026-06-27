"use strict";

function buildOrderDraftFromQuote(quote, options = {}) {
  const missing = [];
  if (!quote?.id) missing.push("quoteDraftId");
  if (!quote?.designJobId) missing.push("designJobId");
  if (!quote?.customerId) missing.push("customerId");
  if (!quote?.selectedImageId) missing.push("selectedImageId");

  const designJob = quote?.designJob || {};
  if (quote?.designJobId && designJob.id && quote.designJobId !== designJob.id) {
    missing.push("designJobIdentity");
  }
  if (quote?.customerId && designJob.customerId && quote.customerId !== designJob.customerId) {
    missing.push("customerIdentity");
  }
  if (designJob.conversation?.customerId && quote?.customerId && designJob.conversation.customerId !== quote.customerId) {
    missing.push("conversationCustomerIdentity");
  }
  if (designJob.conversation?.wechatAccountId && designJob.wechatAccountId && designJob.conversation.wechatAccountId !== designJob.wechatAccountId) {
    missing.push("conversationWechatIdentity");
  }
  if (!designJob.conversationId) missing.push("conversationId");
  if (!designJob.wechatAccountId) missing.push("wechatAccountId");

  const quantity = positiveInteger(quote?.quantity, 0);
  const unitPrice = moneyNumber(quote?.unitPrice, -1);
  const totalPrice = moneyNumber(quote?.totalPrice, -1);
  const totalCost = moneyNumber(quote?.totalCost, -1);
  const profit = moneyNumber(quote?.profit, Number.NaN);

  if (quantity <= 0) missing.push("quantity");
  if (unitPrice < 0) missing.push("unitPrice");
  if (totalPrice <= 0) missing.push("totalPrice");
  if (totalCost < 0) missing.push("totalCost");
  if (!Number.isFinite(profit)) missing.push("profit");

  if (missing.length) {
    return { ok: false, reason: "missing_order_fields", missing: [...new Set(missing)] };
  }

  if (profit < 0 && options.allowNegativeProfit !== true) {
    return { ok: false, reason: "negative_profit", missing: [] };
  }

  const paymentStatus = quote.paymentStatus || "unpaid";
  const status = quote.status === "accepted" || paymentStatus === "paid" ? "confirmed" : "draft";
  const profitRate = totalPrice > 0 ? round(profit / totalPrice) : 0;
  const selectedImage = quote.selectedImage || findSelectedImage(designJob, quote.selectedImageId);
  if (!selectedImage) {
    return { ok: false, reason: "selected_image_not_found", missing: ["selectedImage"] };
  }
  if (selectedImage.designJobId && selectedImage.designJobId !== quote.designJobId) {
    return { ok: false, reason: "selected_image_design_job_mismatch", missing: ["selectedImage"] };
  }

  return {
    ok: true,
    orderDraft: {
      quoteDraftId: quote.id,
      designJobId: quote.designJobId,
      customerId: quote.customerId,
      conversationId: designJob.conversationId,
      wechatAccountId: designJob.wechatAccountId,
      selectedImageId: quote.selectedImageId,
      quantity,
      unitPrice,
      totalPrice,
      totalCost,
      profit,
      profitRate,
      status,
      paymentStatus,
      customerNotes: quote.customerNotes || "",
      owner: quote.owner || "",
      bundleSnapshot: normalizeJson(designJob.bundle),
      selectedImageSnapshot: normalizeJson(selectedImage),
    },
  };
}

function cleanOrderDraftPatch(patch = {}) {
  const data = {};
  if (isAllowed(patch.status, ["draft", "confirmed", "processing", "fulfilled", "cancelled"])) {
    data.status = patch.status;
  }
  if (isAllowed(patch.paymentStatus, ["unpaid", "deposit_paid", "paid", "refunded"])) {
    data.paymentStatus = patch.paymentStatus;
  }
  if (typeof patch.customerNotes === "string") data.customerNotes = patch.customerNotes;
  if (typeof patch.owner === "string") data.owner = patch.owner;
  return data;
}

function quotePatchForOrderDraft(orderDraft = {}, patch = {}) {
  const data = {};
  const nextStatus = patch.status || orderDraft.status;
  const nextPaymentStatus = patch.paymentStatus || orderDraft.paymentStatus;

  if (isAllowed(nextPaymentStatus, ["unpaid", "deposit_paid", "paid", "refunded"])) {
    data.paymentStatus = nextPaymentStatus;
  }
  if (["confirmed", "processing", "fulfilled"].includes(nextStatus) || nextPaymentStatus === "paid") {
    data.status = "accepted";
  }
  if (nextStatus === "cancelled") {
    data.status = "cancelled";
  }
  if (typeof patch.customerNotes === "string") data.customerNotes = patch.customerNotes;
  if (typeof patch.owner === "string") data.owner = patch.owner;
  return data;
}

function findSelectedImage(designJob, selectedImageId) {
  const images = Array.isArray(designJob?.images) ? designJob.images : [];
  return images.find((image) => image.id === selectedImageId || image.imageId === selectedImageId) || null;
}

function normalizeJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(1, Math.floor(number));
}

function moneyNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return roundMoney(number);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function round(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function isAllowed(value, allowed) {
  return typeof value === "string" && allowed.includes(value);
}

module.exports = {
  buildOrderDraftFromQuote,
  cleanOrderDraftPatch,
  quotePatchForOrderDraft,
};
