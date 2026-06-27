"use strict";

function evaluateLowValueDesignImageSend(job = {}) {
  if (!job || !job.id) return skip("invalid_job", ["job"]);
  if (job.isHighValue) return skip("manual_review_required", ["manualReview"]);
  if (job.status !== "quick_confirm") return skip("status_not_ready", ["status"]);
  if (job.conversation?.manualLocked || job.manualLocked) return skip("conversation_manual_locked", ["manualLocked"]);
  if (!job.wechatAccountId || !job.conversationId) {
    return skip("missing_send_target", ["wechatAccountId", "conversationId"]);
  }

  const images = Array.isArray(job.images) ? job.images : [];
  const sendableImages = images.filter((image) => image.localPath);
  if (!sendableImages.length) return skip("missing_images", ["images"]);

  return {
    ok: true,
    action: "queue_design_images",
    reason: "low_value_ready_to_send_images",
    missing: [],
  };
}

function evaluateLowValueQuoteSend(quote = {}, options = {}) {
  if (!quote || !quote.id) return skip("invalid_quote", ["quote"]);
  const designJob = quote.designJob || {};
  const highValueAmount = Number(options.highValueAmountCny || 10000);
  const totalPrice = Number(quote.totalPrice || 0);
  const profit = Number(quote.profit);

  if (quote.sendTaskId) return skip("already_queued", ["sendTaskId"]);
  if (quote.status !== "auto_sent") return skip("status_not_ready", ["status"]);
  if (!quote.selectedImageId) return skip("missing_selected_image", ["selectedImageId"]);
  if (Number.isFinite(profit) && profit < 0) return skip("negative_profit", ["profit"]);
  if (!designJob || !designJob.id) return skip("missing_design_job", ["designJob"]);
  if (designJob.isHighValue || (Number.isFinite(totalPrice) && totalPrice >= highValueAmount)) {
    return skip("manual_review_required", ["manualReview"]);
  }
  if (designJob.conversation?.manualLocked || designJob.manualLocked) {
    return skip("conversation_manual_locked", ["manualLocked"]);
  }
  if (!designJob.wechatAccountId || !designJob.conversationId) {
    return skip("missing_send_target", ["wechatAccountId", "conversationId"]);
  }

  return {
    ok: true,
    action: "queue_quote",
    reason: "low_value_quote_ready_to_send",
    missing: [],
  };
}

function evaluateLowValueOrderDraftFromQuote(quote = {}, options = {}) {
  if (!quote || !quote.id) return skip("invalid_quote", ["quote"]);
  if (options.existingOrderDraft || quote.orderDraftId || quote.orderDraft) {
    return skip("already_has_order_draft", ["orderDraft"]);
  }

  const designJob = quote.designJob || {};
  const highValueAmount = Number(options.highValueAmountCny || 10000);
  const totalPrice = Number(quote.totalPrice || 0);
  const profit = Number(quote.profit);
  const paymentStatus = quote.paymentStatus || "unpaid";
  const readyStatuses = new Set(["sent", "accepted"]);
  const readyPayments = new Set(["deposit_paid", "paid"]);

  if (!readyStatuses.has(quote.status) && !readyPayments.has(paymentStatus)) {
    return skip("status_not_ready", ["status"]);
  }
  if (!quote.selectedImageId) return skip("missing_selected_image", ["selectedImageId"]);
  if (Number.isFinite(profit) && profit < 0) return skip("negative_profit", ["profit"]);
  if (!designJob || !designJob.id) return skip("missing_design_job", ["designJob"]);
  if (designJob.isHighValue || (Number.isFinite(totalPrice) && totalPrice >= highValueAmount)) {
    return skip("manual_review_required", ["manualReview"]);
  }
  if (designJob.conversation?.manualLocked || designJob.manualLocked) {
    return skip("conversation_manual_locked", ["manualLocked"]);
  }
  if (!designJob.wechatAccountId || !designJob.conversationId) {
    return skip("missing_order_target", ["wechatAccountId", "conversationId"]);
  }

  return {
    ok: true,
    action: "create_order_draft",
    reason: "low_value_quote_ready_for_order_draft",
    missing: [],
  };
}

function evaluateLowValueOrderConfirmationSend(order = {}, options = {}) {
  if (!order || !order.id) return skip("invalid_order_draft", ["orderDraft"]);
  if (order.confirmationSendTaskId || order.confirmationSendTask) {
    return skip("already_queued", ["confirmationSendTask"]);
  }
  if (order.status === "cancelled") return skip("order_cancelled", ["status"]);

  const quote = order.quoteDraft || {};
  const designJob = order.designJob || quote.designJob || {};
  const highValueAmount = Number(options.highValueAmountCny || 10000);
  const totalPrice = Number(order.totalPrice ?? quote.totalPrice ?? 0);
  const unitPrice = Number(order.unitPrice ?? quote.unitPrice ?? 0);
  const profit = Number(order.profit ?? quote.profit);
  const paymentStatus = order.paymentStatus || quote.paymentStatus || "unpaid";
  const acceptedByCustomer =
    quote.status === "accepted" ||
    order.status === "confirmed" ||
    paymentStatus === "deposit_paid" ||
    paymentStatus === "paid";

  if (!acceptedByCustomer) return skip("quote_not_accepted", ["acceptedQuoteOrPayment"]);
  if (!order.selectedImageId && !quote.selectedImageId) {
    return skip("missing_selected_image", ["selectedImageId"]);
  }
  if (Number.isFinite(profit) && profit < 0) return skip("negative_profit", ["profit"]);
  if (!designJob || (!designJob.id && !order.designJobId && !quote.designJobId)) {
    return skip("missing_design_job", ["designJob"]);
  }
  if (
    designJob.isHighValue ||
    (Number.isFinite(totalPrice) && totalPrice >= highValueAmount) ||
    (Number.isFinite(unitPrice) && unitPrice >= highValueAmount)
  ) {
    return skip("manual_review_required", ["manualReview"]);
  }
  if (
    order.conversation?.manualLocked ||
    designJob.conversation?.manualLocked ||
    designJob.manualLocked ||
    order.manualLocked
  ) {
    return skip("conversation_manual_locked", ["manualLocked"]);
  }
  if (!order.wechatAccountId || !order.conversationId) {
    return skip("missing_send_target", ["wechatAccountId", "conversationId"]);
  }

  return {
    ok: true,
    action: "queue_order_confirmation",
    reason: "low_value_order_confirmation_ready",
    missing: [],
  };
}

function evaluateLowValueOrderFollowupSend(order = {}, options = {}) {
  if (!order || !order.id) return skip("invalid_order_draft", ["orderDraft"]);
  if (order.status === "cancelled") return skip("order_cancelled", ["status"]);

  const followupType = order.status === "fulfilled" ? "delivery" : "production";
  if (!["processing", "fulfilled"].includes(order.status)) {
    return skip("status_not_ready", ["status"]);
  }

  const existingFollowupTypes = new Set(
    (Array.isArray(options.existingFollowupTypes) ? options.existingFollowupTypes : existingOrderFollowupTypes(order))
      .filter(Boolean)
      .map(String),
  );
  if (existingFollowupTypes.has(followupType) || existingFollowupTypes.has("any")) {
    return skip("already_queued", [`${followupType}FollowupSendTask`]);
  }

  const quote = order.quoteDraft || {};
  const designJob = order.designJob || quote.designJob || {};
  const highValueAmount = Number(options.highValueAmountCny || 10000);
  const totalPrice = Number(order.totalPrice ?? quote.totalPrice ?? 0);
  const unitPrice = Number(order.unitPrice ?? quote.unitPrice ?? 0);
  const profit = Number(order.profit ?? quote.profit);
  const paymentStatus = order.paymentStatus || quote.paymentStatus || "unpaid";

  if (!["deposit_paid", "paid"].includes(paymentStatus)) {
    return skip("payment_not_ready", ["paymentStatus"]);
  }
  if (!order.selectedImageId && !quote.selectedImageId) {
    return skip("missing_selected_image", ["selectedImageId"]);
  }
  if (Number.isFinite(profit) && profit < 0) return skip("negative_profit", ["profit"]);
  if (!designJob || (!designJob.id && !order.designJobId && !quote.designJobId)) {
    return skip("missing_design_job", ["designJob"]);
  }
  if (
    designJob.isHighValue ||
    (Number.isFinite(totalPrice) && totalPrice >= highValueAmount) ||
    (Number.isFinite(unitPrice) && unitPrice >= highValueAmount)
  ) {
    return skip("manual_review_required", ["manualReview"]);
  }
  if (
    order.conversation?.manualLocked ||
    designJob.conversation?.manualLocked ||
    designJob.manualLocked ||
    order.manualLocked
  ) {
    return skip("conversation_manual_locked", ["manualLocked"]);
  }
  if (!order.wechatAccountId || !order.conversationId) {
    return skip("missing_send_target", ["wechatAccountId", "conversationId"]);
  }

  return {
    ok: true,
    action: "queue_order_followup",
    reason: "low_value_order_followup_ready",
    followupType,
    missing: [],
  };
}

function existingOrderFollowupTypes(order = {}) {
  const tasks = [
    ...(Array.isArray(order.followupSendTasks) ? order.followupSendTasks : []),
    order.followupSendTask,
  ].filter(Boolean);
  return tasks.map((task) => task?.guardSnapshot?.automation?.followupType || "any");
}

function skip(reason, missing = []) {
  return {
    ok: false,
    action: "skip",
    reason,
    missing,
  };
}

module.exports = {
  evaluateLowValueDesignImageSend,
  evaluateLowValueOrderConfirmationSend,
  evaluateLowValueOrderFollowupSend,
  evaluateLowValueOrderDraftFromQuote,
  evaluateLowValueQuoteSend,
};
