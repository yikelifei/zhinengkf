import { identityExpectation, type OrderDraft, type QuoteDraft } from "../../lib/api";

const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: "报价草稿",
  manual_review: "等待人工审核",
  approved: "审核已通过",
  auto_sent: "可进入发送处理",
  send_queued: "已进入发送队列",
  sent: "服务端已发送",
  accepted: "客户已确认",
  rejected: "客户未接受",
  cancelled: "报价已取消",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "订单草稿",
  confirmed: "订单已确认",
  processing: "正在履约",
  fulfilled: "订单已完成",
  cancelled: "订单已取消",
};

export function quoteStatusLabel(status?: string | null) {
  return QUOTE_STATUS_LABELS[String(status || "").toLowerCase()] || status || "状态未确认";
}

export function orderStatusLabel(status?: string | null) {
  return ORDER_STATUS_LABELS[String(status || "").toLowerCase()] || status || "状态未确认";
}

export function quoteOrderReadiness(quote: QuoteDraft) {
  const reasons: string[] = [];
  const expected = identityExpectation(quote);
  if (!expected.expectedWechatAccountId || !expected.expectedConversationId || !expected.expectedCustomerId) reasons.push("客户身份不完整");
  if (quote.status !== "accepted") reasons.push("报价尚未被客户确认");
  if (!quote.selectedImageId) reasons.push("尚未绑定客户选图");
  if (!positiveInteger(quote.quantity)) reasons.push("数量无效");
  if (!positiveMoney(quote.totalPrice)) reasons.push("总价无效");
  if (!nonNegativeMoney(quote.unitPrice) || !nonNegativeMoney(quote.totalCost) || !Number.isFinite(Number(quote.profit))) reasons.push("价格或利润数据不完整");
  return { ok: reasons.length === 0, reasons };
}

export function quotePaymentReadiness(quote: QuoteDraft) {
  const reasons: string[] = [];
  const expected = identityExpectation(quote);
  if (!expected.expectedWechatAccountId || !expected.expectedConversationId || !expected.expectedCustomerId) reasons.push("客户身份不完整");
  if (!quote.selectedImageId) reasons.push("尚未绑定客户选图");
  if (!positiveMoney(quote.totalPrice)) reasons.push("报价金额无效");
  return { ok: reasons.length === 0, reasons };
}

export function quoteJourneyRecommendation(quote: QuoteDraft) {
  return quoteNextAction(quote).recommendation;
}

export type QuoteNextAction = "review" | "send" | "wait_delivery" | "payment" | "order" | "restart" | "blocked";

export function quoteNextAction(quote: QuoteDraft): { action: QuoteNextAction; recommendation: string; blockedReason?: string } {
  const status = String(quote.status || "").toLowerCase();
  if (status === "manual_review") return { action: "review", recommendation: "报价正在等待人工审核；先完成金额、利润、选图与身份复核。" };
  if (status === "accepted") {
    const order = quoteOrderReadiness(quote);
    return order.ok
      ? { action: "order", recommendation: "客户已确认报价，可以创建订单草稿。" }
      : { action: "blocked", recommendation: "客户已确认，但订单资料仍不完整。", blockedReason: order.reasons.join("、") };
  }
  if (status === "sent") return { action: "payment", recommendation: "服务端记录为已发送；取得客户付款凭证后再进入付款核验。" };
  if (status === "send_queued" || quote.sendTaskId) return { action: "wait_delivery", recommendation: "报价仅已进入发送队列；等待真实送达与客户确认，暂不重复发送。" };
  if (status === "rejected" || status === "cancelled") return { action: "restart", recommendation: "当前报价已终止，请回到客户会话确认是否需要重新搭品或报价。" };
  const payment = quotePaymentReadiness(quote);
  return payment.ok
    ? { action: "send", recommendation: "下一步核对报价预览并发送；客户明确确认后才能创建订单。" }
    : { action: "blocked", recommendation: "报价资料不完整，不能进入发送。", blockedReason: payment.reasons.join("、") };
}

export function orderJourneyRecommendation(order: OrderDraft) {
  const status = String(order.status || "").toLowerCase();
  if (status === "draft") return "订单草稿已形成；核对付款、负责人和履约信息后再确认。";
  if (status === "confirmed") return "订单已确认，下一步维护生产节点并向客户同步进度。";
  if (status === "processing") return "订单正在履约；发货和签收都必须保留真实物流证据。";
  if (status === "fulfilled") return "订单已完成；确认签收证据后进入售后与复盘。";
  if (status === "cancelled") return "订单已取消；不要继续发送生产或发货通知。";
  return "订单状态未识别，请先人工核对，避免错误推进履约。";
}

export function quoteIdentityHref(path: string, quote: QuoteDraft) {
  return identityHref(path, identityExpectation(quote));
}

export function orderIdentityHref(path: string, order: OrderDraft) {
  return identityHref(path, identityExpectation(order));
}

function identityHref(path: string, expected: ReturnType<typeof identityExpectation>) {
  const params = new URLSearchParams();
  if (expected.expectedWechatAccountId) params.set("wechatAccountId", expected.expectedWechatAccountId);
  if (expected.expectedConversationId) params.set("conversationId", expected.expectedConversationId);
  if (expected.expectedCustomerId) params.set("customerId", expected.expectedCustomerId);
  const query = params.toString();
  return `${path}${query ? `${path.includes("?") ? "&" : "?"}${query}` : ""}`;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

function positiveMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function nonNegativeMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}
