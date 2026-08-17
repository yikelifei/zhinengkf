import type { DesignJob, IdentityFilters } from "../../lib/api";
import type { DesignCommerceStep } from "./design-commerce-journey";

const POLLING_STATUSES = new Set(["submitted", "generating", "processing", "dispatching"]);
const REVIEW_STATUSES = new Set(["completed", "manual_review", "failed", "timeout", "outcome_unknown", "customer_selected"]);
const QUOTE_STATUSES = new Set(["quick_confirm", "quote_created"]);
const TERMINAL_STATUSES = new Set(["sent", "cancelled", "rejected"]);

const STATUS_LABELS: Record<string, string> = {
  draft: "待预检提交",
  submitted: "已提交设计平台",
  generating: "正在生成",
  processing: "正在处理",
  dispatching: "正在提交",
  completed: "候选图已生成",
  manual_review: "等待人工审核",
  customer_selected: "客户已选图，待人工处理",
  quick_confirm: "图稿已通过",
  quote_created: "已生成报价",
  sent: "候选图已进入发送队列",
  failed: "生成失败，待人工处理",
  timeout: "生成超时，待核查",
  outcome_unknown: "生成结果未知，待核销",
  cancelled: "任务已取消",
  rejected: "任务已驳回",
};

export type DesignCommerceState = {
  step: DesignCommerceStep;
  statusLabel: string;
  recommendation: string;
  blockedReason?: string;
  canSubmit: boolean;
  canPoll: boolean;
  canReview: boolean;
  canQuote: boolean;
  quoteAlreadyCreated: boolean;
};

export function designCommerceState(job: DesignJob): DesignCommerceState {
  const status = String(job.status || "").toLowerCase();
  const hasImages = Boolean(job.images?.length);
  const hasSelectedImage = Boolean(job.images?.some((image) => image.selected));
  const hasBundle = Boolean(job.bundle?.items?.length);
  const canSubmit = status === "draft";
  const canPoll = POLLING_STATUSES.has(status);
  const canReview = REVIEW_STATUSES.has(status) || (hasImages && !QUOTE_STATUSES.has(status) && !TERMINAL_STATUSES.has(status));
  const canQuote = QUOTE_STATUSES.has(status) && hasSelectedImage && hasBundle;
  const quoteAlreadyCreated = status === "quote_created";

  if (canSubmit) return base("design", "先执行预检；只有二次确认才会调用外部设计平台。", { canSubmit, canPoll, canReview, canQuote, quoteAlreadyCreated }, status);
  if (canPoll) return base("design", "同步这一条任务的远端状态，生成未完成前不要进入报价。", { canSubmit, canPoll, canReview, canQuote, quoteAlreadyCreated }, status);
  if (canReview) return base("review", hasSelectedImage ? "进入人工审核，确认图稿与客户选图后再报价。" : "进入人工审核；如图稿可用，先标记客户选图再生成报价。", { canSubmit, canPoll, canReview, canQuote, quoteAlreadyCreated }, status);
  if (quoteAlreadyCreated) return base("quote", "报价已创建，下一步应进入报价详情核对、发送或付款状态。", { canSubmit, canPoll, canReview, canQuote, quoteAlreadyCreated }, status);
  if (status === "quick_confirm" && !canQuote) {
    const missing = [!hasSelectedImage ? "客户选图" : "", !hasBundle ? "商品搭配明细" : ""].filter(Boolean).join("、");
    return base("review", "图稿虽已通过，但报价资料仍不完整，请先补齐后再推进。", { canSubmit, canPoll, canReview: true, canQuote, quoteAlreadyCreated }, status, `缺少${missing}`);
  }
  if (canQuote) return base("quote", "图稿、客户选图和商品明细已就绪，可以生成报价草稿。", { canSubmit, canPoll, canReview, canQuote, quoteAlreadyCreated }, status);
  if (status === "sent") return base("review", "候选图仅表示已入发送队列；收到客户选图后再进入报价。", { canSubmit, canPoll, canReview, canQuote, quoteAlreadyCreated }, status, "尚未取得客户选图确认");
  if (status === "cancelled" || status === "rejected") return base("design", "当前设计任务已终止；如客户需求仍有效，请从原会话重新搭品并创建新任务。", { canSubmit, canPoll, canReview, canQuote, quoteAlreadyCreated }, status, "任务已终止");
  return base("design", "当前状态没有可安全自动推进的动作，请人工核对任务记录。", { canSubmit, canPoll, canReview: true, canQuote, quoteAlreadyCreated }, status, `未识别状态 ${job.status || "空"}`);
}

function base(
  step: DesignCommerceStep,
  recommendation: string,
  actions: Pick<DesignCommerceState, "canSubmit" | "canPoll" | "canReview" | "canQuote" | "quoteAlreadyCreated">,
  status: string,
  blockedReason?: string,
): DesignCommerceState {
  return { step, statusLabel: designJobStatusLabel(status), recommendation, blockedReason, ...actions };
}

export function designJobStatusLabel(status?: string | null) {
  const value = String(status || "").toLowerCase();
  return STATUS_LABELS[value] || status || "状态未确认";
}

export function designReviewHref(job: DesignJob) {
  return designIdentityHref(`/reviews/design/${encodeURIComponent(job.id)}`, job);
}

export function designQuotesHref(job: DesignJob) {
  return designIdentityHref("/sales/quotes", job);
}

export function designIdentityHref(path: string, job: DesignJob) {
  const params = new URLSearchParams();
  appendIdentity(params, {
    wechatAccountId: job.wechatAccountId || undefined,
    conversationId: job.conversationId || undefined,
    customerId: job.customerId || undefined,
  });
  const query = params.toString();
  return `${path}${query ? `${path.includes("?") ? "&" : "?"}${query}` : ""}`;
}

function appendIdentity(params: URLSearchParams, identity: IdentityFilters) {
  if (identity.wechatAccountId) params.set("wechatAccountId", identity.wechatAccountId);
  if (identity.conversationId) params.set("conversationId", identity.conversationId);
  if (identity.customerId) params.set("customerId", identity.customerId);
}
