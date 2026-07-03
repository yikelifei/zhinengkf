"use strict";

function planInboundQuoteAcceptance(input = {}, options = {}) {
  const text = normalizeText(input.text || "");
  const quote = input.quote || null;
  const existingOrderDraft = input.existingOrderDraft || null;
  const intent = detectQuoteAcceptanceIntent(text);

  if (!intent.hasIntent) {
    return skip("no_quote_acceptance_intent", { hasIntent: false });
  }
  if (!quote?.id) return skip("missing_active_quote", { hasIntent: true });

  const designJob = quote.designJob || {};
  const highValueAmount = Number(options.highValueAmountCny || 10000);
  const orderDraft = existingOrderDraft || quote.orderDraft || null;
  if (orderDraft) {
    if (!intent.paymentStatus) return skip("already_has_order_draft", { hasIntent: true });
    if (isHighValueQuoteOrOrder({ quote, orderDraft, designJob, highValueAmount })) {
      return skip("manual_review_required", { hasIntent: true });
    }
    if (!isPaymentUpgrade(orderDraft.paymentStatus || quote.paymentStatus, intent.paymentStatus)) {
      return skip("order_payment_already_recorded", { hasIntent: true });
    }
    const paymentStatus = intent.paymentStatus;
    return {
      ok: true,
      action: "update_existing_order_payment",
      reason: "customer_payment_confirmed_existing_order",
      hasIntent: true,
      orderDraftId: orderDraft.id,
      orderPatch: {
        status: paymentStatus === "paid" || paymentStatus === "deposit_paid" ? "confirmed" : orderDraft.status,
        paymentStatus,
        customerNotes: buildCustomerNotes(text, intent),
        owner: orderDraft.owner || quote.owner || "low_value_automation",
      },
      quotePatch: {
        status: "accepted",
        paymentStatus,
        customerNotes: buildCustomerNotes(text, intent),
        owner: quote.owner || orderDraft.owner || "low_value_automation",
      },
    };
  }

  const totalPrice = Number(quote.totalPrice || 0);
  const unitPrice = Number(quote.unitPrice || 0);
  const profit = Number(quote.profit);
  const quoteSent =
    quote.status === "sent" ||
    quote.status === "accepted" ||
    quote.sendTask?.status === "sent";

  if (!quoteSent && !intent.paymentStatus) return skip("quote_not_sent", { hasIntent: true });
  if (!quote.selectedImageId) return skip("missing_selected_image", { hasIntent: true });
  if (Number.isFinite(profit) && profit < 0) return skip("negative_profit", { hasIntent: true });
  if (!designJob?.id) return skip("missing_design_job", { hasIntent: true });
  if (
    designJob.isHighValue ||
    (Number.isFinite(totalPrice) && totalPrice >= highValueAmount) ||
    (Number.isFinite(unitPrice) && unitPrice >= highValueAmount)
  ) {
    return skip("manual_review_required", { hasIntent: true });
  }
  if (designJob.conversation?.manualLocked || designJob.manualLocked) {
    return skip("conversation_manual_locked", { hasIntent: true });
  }
  if (!designJob.wechatAccountId || !designJob.conversationId) {
    return skip("missing_order_target", { hasIntent: true });
  }

  const paymentStatus = intent.paymentStatus || quote.paymentStatus || "unpaid";
  return {
    ok: true,
    action: "accept_quote_and_create_order",
    reason: intent.paymentStatus ? "customer_payment_confirmed" : "customer_quote_accepted",
    hasIntent: true,
    quotePatch: {
      status: "accepted",
      paymentStatus,
      customerNotes: buildCustomerNotes(text, intent),
      owner: quote.owner || "低价值自动化",
    },
  };
}

function shouldDeferSelectionReviewToQuoteAcceptance(input = {}) {
  const selectionPlan = input.selectionPlan || {};
  if (!selectionPlan.reviewRequired) return false;
  if (selectionPlan.result?.source && selectionPlan.result.source !== "text") return false;
  if (selectionPlan.result?.index || selectionPlan.result?.candidate || selectionPlan.result?.imageId) return false;
  return Boolean(detectQuoteAcceptanceIntent(input.text || "").hasIntent);
}

function detectQuoteAcceptanceIntent(text) {
  if (!text) return { hasIntent: false };
  if (/(不行|不要|算了|取消|先不|再看看|太贵|贵了|换|重新|改一下|不满意)/.test(text)) {
    return { hasIntent: false };
  }

  const hasPayment = hasCompletedPayment(text);
  const hasDeposit = /(定金|订金|预付款|先付一部分)/.test(text);
  const hasPaymentQuestion = hasPaymentQuestionOrPreparation(text);
  const hasAccept =
    /(确认|可以|没问题|就按这个|就这个|按这个|下单|定了|安排|开始做|走这个|做吧|ok|OK|好的|行)/.test(text);

  if (hasPayment) return { hasIntent: true, paymentStatus: hasDeposit ? "deposit_paid" : "paid" };
  if (hasPaymentQuestion) return hasAccept ? { hasIntent: true, paymentStatus: null } : { hasIntent: false };
  if (hasDeposit) return hasAccept ? { hasIntent: true, paymentStatus: null } : { hasIntent: false };
  if (hasAccept) return { hasIntent: true, paymentStatus: null };
  return { hasIntent: false };
}

function hasCompletedPayment(text) {
  return (
    /(已付款|已经付款|付款了|付过了|已支付|已经支付|支付了|支付成功|付款成功|已转账|已经转账|转账了|已打款|已经打款|打款了|钱转了|款已转|款付了|付好了)/i.test(text) ||
    /(付了|已付|已经付).*(定金|订金|预付款)/.test(text) ||
    /(定金|订金|预付款).*(付了|已付|已经付|转账了|已转账|已经转账|打款了|已打款|已经打款)/.test(text)
  );
}

function hasPaymentQuestionOrPreparation(text) {
  return /(怎么付|如何付|付款码|收款码|二维码|付款方式|支付方式|收款账号|收款账户|银行账号|对公账号|公户|发.*码|发.*账号|发.*账户|定金多少|多少定金|付多少|付款.*吗|支付.*吗|转账.*吗|马上付|现在付|待会付|稍后付|一会付|等下付|准备付|去付款|去支付)/.test(text);
}

function isHighValueQuoteOrOrder({ quote = {}, orderDraft = {}, designJob = {}, highValueAmount = 10000 } = {}) {
  const totalPrice = Number(orderDraft.totalPrice ?? quote.totalPrice ?? 0);
  const unitPrice = Number(orderDraft.unitPrice ?? quote.unitPrice ?? 0);
  return (
    designJob.isHighValue === true ||
    (Number.isFinite(totalPrice) && totalPrice >= highValueAmount) ||
    (Number.isFinite(unitPrice) && unitPrice >= highValueAmount)
  );
}

function buildCustomerNotes(text, intent) {
  const prefix = intent.paymentStatus ? "客户确认付款" : "客户确认报价";
  return text ? `${prefix}：${text}` : prefix;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isPaymentUpgrade(current, next) {
  return paymentRank(next) > paymentRank(current || "unpaid");
}

function paymentRank(status) {
  if (status === "paid") return 3;
  if (status === "deposit_paid") return 2;
  if (status === "refunded") return 1;
  return 0;
}

function skip(reason, extra = {}) {
  return {
    ok: false,
    action: "skip",
    reason,
    ...extra,
  };
}

module.exports = {
  detectQuoteAcceptanceIntent,
  planInboundQuoteAcceptance,
  shouldDeferSelectionReviewToQuoteAcceptance,
};
