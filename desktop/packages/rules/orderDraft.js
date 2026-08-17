"use strict";

const {
  normalizeBundleSnapshot,
  normalizeDesignImageSnapshot,
} = require("./imageSnapshot");

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
  if (quote.status !== "accepted") {
    return { ok: false, reason: "quote_not_sent_or_accepted", missing: [] };
  }
  const status = paymentStatus === "paid" || paymentStatus === "deposit_paid" ? "confirmed" : "draft";
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
      productionStatus: "not_started",
      productionDueAt: "",
      carrier: "",
      trackingNo: "",
      shippedAt: "",
      deliveredAt: "",
      customerNotes: quote.customerNotes || "",
      owner: quote.owner || "",
      bundleSnapshot: normalizeBundleSnapshot(designJob.bundle),
      selectedImageSnapshot: normalizeDesignImageSnapshot(selectedImage),
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
  if (
    isAllowed(patch.productionStatus, [
      "not_started",
      "in_production",
      "quality_check",
      "ready_to_ship",
      "shipped",
      "delivered",
      "blocked",
    ])
  ) {
    data.productionStatus = patch.productionStatus;
  }
  if (typeof patch.productionDueAt === "string") data.productionDueAt = cleanOrderText(patch.productionDueAt, 64);
  if (typeof patch.carrier === "string") data.carrier = normalizeCarrier(patch.carrier);
  if (typeof patch.trackingNo === "string") data.trackingNo = normalizeTrackingNo(patch.trackingNo);
  if (typeof patch.shippedAt === "string") data.shippedAt = normalizeOrderDateTime(patch.shippedAt);
  if (typeof patch.deliveredAt === "string") data.deliveredAt = normalizeOrderDateTime(patch.deliveredAt);
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

function evaluateOrderFulfillmentTransition(current = {}, patch = {}) {
  const next = { ...current, ...patch };
  const currentStatus = cleanOrderText(current.status || "draft", 32) || "draft";
  const nextStatus = cleanOrderText(next.status || currentStatus, 32) || currentStatus;
  const currentProductionStatus = cleanOrderText(current.productionStatus || "not_started", 64) || "not_started";
  const nextProductionStatus = cleanOrderText(next.productionStatus || currentProductionStatus, 64) || currentProductionStatus;

  if (!orderStatusCanMove(currentStatus, nextStatus)) {
    return { ok: false, reason: "order_status_regression", currentStatus, nextStatus };
  }
  if (!productionStatusCanMove(currentProductionStatus, nextProductionStatus)) {
    return {
      ok: false,
      reason: "production_status_regression",
      currentProductionStatus,
      nextProductionStatus,
    };
  }

  if (nextStatus === "fulfilled" && (next.paymentStatus || "unpaid") !== "paid") {
    return { ok: false, reason: "fulfilled_requires_full_payment", missing: ["paymentStatus"] };
  }

  if (["shipped", "delivered"].includes(nextProductionStatus)) {
    const missing = requiredShippingFacts(next);
    if (missing.length) return { ok: false, reason: "shipment_facts_missing", missing, nextProductionStatus };
    const invalid = invalidShippingFacts(next);
    if (invalid.length) return { ok: false, reason: "shipment_facts_invalid", invalid, nextProductionStatus };
  }

  if (nextProductionStatus === "delivered" && !cleanOrderText(next.deliveredAt || "", 64)) {
    return { ok: false, reason: "delivery_fact_missing", missing: ["deliveredAt"], nextProductionStatus };
  }
  if (nextProductionStatus === "delivered") {
    const invalidDelivery = invalidDeliveryFacts(next);
    if (invalidDelivery.length) return { ok: false, reason: "delivery_fact_invalid", invalid: invalidDelivery, nextProductionStatus };
    if (isDeliveryBeforeShipment(next)) {
      return { ok: false, reason: "delivery_before_shipment", invalid: ["deliveredAt"], nextProductionStatus };
    }
  }

  if (nextStatus === "fulfilled") {
    const missing = [];
    if (nextProductionStatus !== "delivered") missing.push("productionStatus");
    if (!cleanOrderText(next.deliveredAt || "", 64)) missing.push("deliveredAt");
    if (missing.length) return { ok: false, reason: "fulfilled_requires_delivery", missing, nextProductionStatus };

    const deliveryPackage = evaluateOrderDeliveryPackage(next);
    if (!deliveryPackage.ok) return deliveryPackage;
  }

  return {
    ok: true,
    next: {
      status: nextStatus,
      productionStatus: nextProductionStatus,
    },
  };
}

function orderStatusCanMove(currentStatus, nextStatus) {
  const allowed = {
    draft: ["draft", "confirmed", "cancelled"],
    confirmed: ["confirmed", "processing", "cancelled"],
    processing: ["processing", "fulfilled", "cancelled"],
    fulfilled: ["fulfilled"],
    cancelled: ["cancelled"],
  };
  return (allowed[currentStatus] || [currentStatus]).includes(nextStatus);
}

function productionStatusCanMove(currentStatus, nextStatus) {
  const allowed = {
    not_started: ["not_started", "in_production", "blocked"],
    in_production: ["in_production", "quality_check", "ready_to_ship", "blocked"],
    quality_check: ["quality_check", "ready_to_ship", "blocked"],
    ready_to_ship: ["ready_to_ship", "shipped", "blocked"],
    shipped: ["shipped", "delivered"],
    delivered: ["delivered"],
    blocked: ["blocked", "in_production", "quality_check", "ready_to_ship"],
  };
  return (allowed[currentStatus] || [currentStatus]).includes(nextStatus);
}

function requiredShippingFacts(orderDraft = {}) {
  const missing = [];
  const carrier = normalizeCarrier(orderDraft.carrier || "");
  const trackingNo = normalizeTrackingNo(orderDraft.trackingNo || "");
  if (!carrier) missing.push("carrier");
  if (!isPickupCarrier(carrier) && !trackingNo) missing.push("trackingNo");
  if (!normalizeOrderDateTime(orderDraft.shippedAt || "")) missing.push("shippedAt");
  return missing;
}

function invalidShippingFacts(orderDraft = {}) {
  const invalid = [];
  const carrier = normalizeCarrier(orderDraft.carrier || "");
  const trackingNo = normalizeTrackingNo(orderDraft.trackingNo || "");
  const shippedAt = normalizeOrderDateTime(orderDraft.shippedAt || "");
  if (carrier && !isValidCarrier(carrier)) invalid.push("carrier");
  if (trackingNo && !isPickupCarrier(carrier) && !isValidTrackingNo(trackingNo)) invalid.push("trackingNo");
  if (shippedAt && !isValidOrderDateTime(shippedAt)) invalid.push("shippedAt");
  return invalid;
}

function invalidDeliveryFacts(orderDraft = {}) {
  const invalid = [];
  const deliveredAt = normalizeOrderDateTime(orderDraft.deliveredAt || "");
  if (deliveredAt && !isValidOrderDateTime(deliveredAt)) invalid.push("deliveredAt");
  return invalid;
}

function isDeliveryBeforeShipment(orderDraft = {}) {
  const shipped = parseOrderDateTime(orderDraft.shippedAt);
  const delivered = parseOrderDateTime(orderDraft.deliveredAt);
  return Boolean(shipped && delivered && delivered.getTime() < shipped.getTime());
}

function evaluateOrderDeliveryPackage(orderDraft = {}) {
  const missing = [];
  const selectedImageId = cleanOrderText(orderDraft.selectedImageId || orderDraft.quoteDraft?.selectedImageId || "", 120);
  const selectedImageSnapshot =
    orderDraft.selectedImageSnapshot ||
    orderDraft.selectedImage ||
    orderDraft.quoteDraft?.selectedImage ||
    null;
  const bundleSnapshot =
    orderDraft.bundleSnapshot ||
    orderDraft.designJob?.bundle ||
    orderDraft.quoteDraft?.bundleSnapshot ||
    orderDraft.quoteDraft?.designJob?.bundle ||
    null;

  if (!selectedImageId) missing.push("selectedImageId");
  if (!hasDesignImageDeliverySnapshot(selectedImageSnapshot)) missing.push("selectedImageSnapshot");
  if (!hasBundleDeliverySnapshot(bundleSnapshot)) missing.push("bundleSnapshot");

  return missing.length
    ? { ok: false, reason: "delivery_package_missing", missing }
    : { ok: true };
}

function hasDesignImageDeliverySnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Boolean(
    cleanOrderText(value.imageId || value.id || "", 120) ||
    cleanOrderText(value.localPath || value.downloadUrl || value.publicUrl || value.url || "", 500) ||
    cleanOrderText(value.fingerprint || "", 160),
  );
}

function hasBundleDeliverySnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const items = Array.isArray(value.items) ? value.items : [];
  if (items.some(hasBundleDeliveryItem)) return true;
  return hasBundleDeliveryItem(value.giftBox);
}

function hasBundleDeliveryItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return Boolean(
    cleanOrderText(item.skuCode || item.id || "", 120) ||
    cleanOrderText(item.name || item.title || item.type || item.category || "", 160) ||
    Number.isFinite(Number(item.salePrice ?? item.price ?? item.costPrice ?? item.cost)),
  );
}

function findSelectedImage(designJob, selectedImageId) {
  const images = Array.isArray(designJob?.images) ? designJob.images : [];
  return images.find((image) => image.id === selectedImageId || image.imageId === selectedImageId) || null;
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

function cleanOrderText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeCarrier(value) {
  return cleanOrderText(value, 80).replace(/\s+/g, " ");
}

function normalizeTrackingNo(value) {
  return cleanOrderText(value, 120).replace(/\s+/g, "").toUpperCase();
}

function normalizeOrderDateTime(value) {
  const text = cleanOrderText(value, 64);
  const parsed = parseOrderDateTime(text);
  if (!parsed) return text;
  const pad = (part) => String(part).padStart(2, "0");
  const date = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  const time = `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  return parsed._dateOnly ? date : `${date} ${time}`;
}

function isPickupCarrier(value) {
  const carrier = normalizeCarrier(value).toLowerCase();
  return ["自提", "门店自提", "到店自取", "同城自取", "pickup", "self pickup", "customer pickup"].includes(carrier);
}

function isValidCarrier(value) {
  const carrier = normalizeCarrier(value);
  if (!carrier) return false;
  if (carrier.length < 2 || carrier.length > 80) return false;
  return /[\p{L}\p{Script=Han}]/u.test(carrier);
}

function isValidTrackingNo(value) {
  const trackingNo = normalizeTrackingNo(value);
  if (trackingNo.length < 6 || trackingNo.length > 64) return false;
  if (!/[0-9]/.test(trackingNo)) return false;
  return /^[A-Z0-9-]+$/.test(trackingNo);
}

function isValidOrderDateTime(value) {
  return Boolean(parseOrderDateTime(value));
}

function parseOrderDateTime(value) {
  const text = cleanOrderText(value, 64);
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  date._dateOnly = match[4] === undefined;
  return date;
}

module.exports = {
  buildOrderDraftFromQuote,
  cleanOrderDraftPatch,
  evaluateOrderDeliveryPackage,
  evaluateOrderFulfillmentTransition,
  isDeliveryBeforeShipment,
  isPickupCarrier,
  isValidCarrier,
  isValidOrderDateTime,
  isValidTrackingNo,
  normalizeCarrier,
  normalizeOrderDateTime,
  normalizeTrackingNo,
  quotePatchForOrderDraft,
};
