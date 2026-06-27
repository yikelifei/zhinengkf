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
  if (existingOrderDraft || quote.orderDraft) return skip("already_has_order_draft", { hasIntent: true });

  const designJob = quote.designJob || {};
  const highValueAmount = Number(options.highValueAmountCny || 10000);
  const totalPrice = Number(quote.totalPrice || 0);
  const profit = Number(quote.profit);
  const quoteSent =
    quote.status === "sent" ||
    quote.status === "accepted" ||
    quote.sendTask?.status === "sent";

  if (!quoteSent && !intent.paymentStatus) return skip("quote_not_sent", { hasIntent: true });
  if (!quote.selectedImageId) return skip("missing_selected_image", { hasIntent: true });
  if (Number.isFinite(profit) && profit < 0) return skip("negative_profit", { hasIntent: true });
  if (!designJob?.id) return skip("missing_design_job", { hasIntent: true });
  if (designJob.isHighValue || (Number.isFinite(totalPrice) && totalPrice >= highValueAmount)) {
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

function detectQuoteAcceptanceIntent(text) {
  if (!text) return { hasIntent: false };
  if (/(不行|不要|算了|取消|先不|再看看|太贵|贵了|换|重新|改一下|不满意)/.test(text)) {
    return { hasIntent: false };
  }

  const hasPayment = /(已付款|付款了|付过了|付了|已支付|支付了|转账了|已转账|打款了|已打款|钱转了|款已转|款付了)/i.test(text);
  const hasDeposit = /(定金|订金|预付款|先付一部分)/.test(text);
  const hasAccept =
    /(确认|可以|没问题|就按这个|就这个|按这个|下单|定了|安排|开始做|走这个|做吧|ok|OK|好的|行)/.test(text);

  if (hasPayment) return { hasIntent: true, paymentStatus: hasDeposit ? "deposit_paid" : "paid" };
  if (hasDeposit) return { hasIntent: true, paymentStatus: "deposit_paid" };
  if (hasAccept) return { hasIntent: true, paymentStatus: null };
  return { hasIntent: false };
}

function buildCustomerNotes(text, intent) {
  const prefix = intent.paymentStatus ? "客户确认付款" : "客户确认报价";
  return text ? `${prefix}：${text}` : prefix;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
};
