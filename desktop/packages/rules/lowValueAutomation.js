"use strict";

const { CUSTOMER_DESIGN_CANDIDATE_COUNT, inspectBundleAutomationReadiness } = require("./designWorkflow");
const { isHighValueBudget } = require("./budget");

function evaluateLowValueDesignImageSend(job = {}, options = {}) {
  if (!job || !job.id) return skip("invalid_job", ["job"]);
  const highValueAmount = Number(options.highValueAmountCny || 10000);
  if (job.isHighValue || isHighValueBudget(job.budget, highValueAmount)) {
    return skip("manual_review_required", ["manualReview"]);
  }
  if (job.status !== "quick_confirm") return skip("status_not_ready", ["status"]);
  if (job.conversation?.manualLocked || job.manualLocked) return skip("conversation_manual_locked", ["manualLocked"]);
  if (!job.wechatAccountId || !job.conversationId) {
    return skip("missing_send_target", ["wechatAccountId", "conversationId"]);
  }
  if (String(job.designType || "") !== "zhenxi_image") {
    const automation = inspectBundleAutomationReadiness(job.bundle || {});
    if (!automation.ok) return skip(automation.reason, automation.blockers || []);
  }

  const images = Array.isArray(job.images) ? job.images : [];
  const sendableImages = images.filter((image) => image.localPath);
  if (!sendableImages.length) return skip("missing_images", ["images"]);
  if (images.length !== CUSTOMER_DESIGN_CANDIDATE_COUNT) {
    return skip("candidate_count_mismatch", [`images:${CUSTOMER_DESIGN_CANDIDATE_COUNT}`]);
  }
  if (sendableImages.length !== CUSTOMER_DESIGN_CANDIDATE_COUNT) {
    return skip("missing_images", ["images"]);
  }

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
  const unitPrice = Number(quote.unitPrice || 0);
  const profit = Number(quote.profit);

  if (quote.sendTaskId) return skip("already_queued", ["sendTaskId"]);
  if (quote.status !== "auto_sent") return skip("status_not_ready", ["status"]);
  if (!quote.selectedImageId) return skip("missing_selected_image", ["selectedImageId"]);
  if (Number.isFinite(profit) && profit < 0) return skip("negative_profit", ["profit"]);
  if (!designJob || !designJob.id) return skip("missing_design_job", ["designJob"]);
  if (isHighValueAmount({ totalPrice, unitPrice, highValueAmount }) || isHighValueDesignJob(designJob, highValueAmount)) {
    return skip("manual_review_required", ["manualReview"]);
  }
  if (designJob.conversation?.manualLocked || designJob.manualLocked) {
    return skip("conversation_manual_locked", ["manualLocked"]);
  }
  if (!designJob.wechatAccountId || !designJob.conversationId) {
    return skip("missing_send_target", ["wechatAccountId", "conversationId"]);
  }
  const automation = inspectBundleAutomationReadiness(designJob.bundle || {});
  if (!automation.ok) return skip(automation.reason, automation.blockers || []);

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
  const unitPrice = Number(quote.unitPrice || 0);
  const profit = Number(quote.profit);
  const paymentStatus = quote.paymentStatus || "unpaid";
  const readyStatuses = new Set(["accepted"]);
  const readyPayments = new Set(["deposit_paid", "paid"]);

  if (!readyStatuses.has(quote.status)) {
    return skip("status_not_ready", ["status"]);
  }
  if (!quote.selectedImageId) return skip("missing_selected_image", ["selectedImageId"]);
  if (Number.isFinite(profit) && profit < 0) return skip("negative_profit", ["profit"]);
  if (!designJob || !designJob.id) return skip("missing_design_job", ["designJob"]);
  if (isHighValueAmount({ totalPrice, unitPrice, highValueAmount }) || isHighValueDesignJob(designJob, highValueAmount)) {
    return skip("manual_review_required", ["manualReview"]);
  }
  if (designJob.conversation?.manualLocked || designJob.manualLocked) {
    return skip("conversation_manual_locked", ["manualLocked"]);
  }
  if (!readyPayments.has(paymentStatus)) {
    return skip("payment_not_ready", ["paymentStatus"]);
  }
  if (!designJob.wechatAccountId || !designJob.conversationId) {
    return skip("missing_order_target", ["wechatAccountId", "conversationId"]);
  }
  const automation = inspectBundleAutomationReadiness(designJob.bundle || quote.bundleSnapshot || {});
  if (!automation.ok) return skip(automation.reason, automation.blockers || []);

  return {
    ok: true,
    action: "create_order_draft",
    reason: "low_value_quote_ready_for_order_draft",
    missing: [],
  };
}

function evaluateLowValueOrderConfirmationSend(order = {}, options = {}) {
  if (!order || !order.id) return skip("invalid_order_draft", ["orderDraft"]);
  const confirmationTask = order.confirmationSendTask || (order.confirmationSendTaskId ? { id: order.confirmationSendTaskId } : null);
  if (sendTaskNeedsManualAttention(confirmationTask)) {
    return skip("manual_send_attention_required", ["confirmationSendTask"]);
  }
  if (sendTaskCountsAsHandled(confirmationTask)) {
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
    isHighValueDesignJob(designJob, highValueAmount) ||
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
  const automation = inspectBundleAutomationReadiness(designJob.bundle || order.bundleSnapshot || quote.bundleSnapshot || {});
  if (!automation.ok) return skip(automation.reason, automation.blockers || []);

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
    (
      Array.isArray(options.existingFollowupTypes)
        ? options.existingFollowupTypes
        : existingOrderHandledFollowupTypes(order)
    )
      .filter(Boolean)
      .map(String),
  );
  const attentionFollowupTypes = new Set(
    (
      Array.isArray(options.attentionFollowupTypes)
        ? options.attentionFollowupTypes
        : existingOrderAttentionFollowupTypes(order)
    )
      .filter(Boolean)
      .map(String),
  );
  if (attentionFollowupTypes.has(followupType) || attentionFollowupTypes.has("any")) {
    return skip("manual_send_attention_required", [`${followupType}FollowupSendTask`]);
  }
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
    isHighValueDesignJob(designJob, highValueAmount) ||
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
  const automation = inspectBundleAutomationReadiness(designJob.bundle || order.bundleSnapshot || quote.bundleSnapshot || {});
  if (!automation.ok) return skip(automation.reason, automation.blockers || []);

  return {
    ok: true,
    action: "queue_order_followup",
    reason: "low_value_order_followup_ready",
    followupType,
    missing: [],
  };
}

function existingOrderHandledFollowupTypes(order = {}) {
  const tasks = [
    ...(Array.isArray(order.followupSendTasks) ? order.followupSendTasks : []),
    order.followupSendTask,
    order.productionFollowupSendTask,
    order.deliveryFollowupSendTask,
  ].filter(Boolean);
  return tasks
    .filter(sendTaskCountsAsHandled)
    .map((task) => taskFollowupType(task));
}

function existingOrderAttentionFollowupTypes(order = {}) {
  const tasks = [
    ...(Array.isArray(order.followupSendTasks) ? order.followupSendTasks : []),
    order.followupSendTask,
    order.productionFollowupSendTask,
    order.deliveryFollowupSendTask,
  ].filter(Boolean);
  return tasks
    .filter(sendTaskNeedsManualAttention)
    .map((task) => taskFollowupType(task));
}

function taskFollowupType(task = {}) {
  const type = task?.guardSnapshot?.automation?.followupType || task?.payload?.followupType;
  return type === "production" || type === "delivery" ? type : "any";
}

function sendTaskNeedsManualAttention(task) {
  if (!task) return false;
  return ["failed", "blocked", "cancelled", "dry_run"].includes(String(task.status || ""));
}

function sendTaskCountsAsHandled(task) {
  if (!task) return false;
  if (!task.status) return Boolean(task.id);
  return ["queued", "sending", "sent"].includes(String(task.status));
}

function isHighValueAmount({ totalPrice = 0, unitPrice = 0, highValueAmount = 10000 } = {}) {
  return (
    (Number.isFinite(totalPrice) && totalPrice >= highValueAmount) ||
    (Number.isFinite(unitPrice) && unitPrice >= highValueAmount)
  );
}

function isHighValueDesignJob(designJob = {}, highValueAmount = 10000) {
  return Boolean(designJob?.isHighValue) || isHighValueBudget(designJob?.budget, highValueAmount);
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
