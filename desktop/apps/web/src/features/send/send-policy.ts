import type { IdentityFilters, SendAdapterInfo, SendTask } from "../../lib/api";

export function isManualLocked(task: SendTask) {
  const manualLocked = Boolean(
    task.conversation?.manualLocked ||
    task.guardSnapshot?.blockedByManualLock ||
    task.guardSnapshot?.blockedBy === "manual_lock",
  );
  return manualLocked;
}

export function isManualReplySendTask(task: SendTask) {
  return Boolean(
    task.payload?.source === "manual_reply" &&
    task.payload?.manualReply === true &&
    task.guardSnapshot?.manualReply === true,
  );
}

function isManualLockBlocking(task: SendTask) {
  return isManualLocked(task) && !isManualReplySendTask(task);
}

export function hasUnknownDelivery(task: SendTask) {
  if (task.status === "uncertain") return true;
  if (
    task.guardSnapshot?.deliveryState === "unknown" ||
    task.guardSnapshot?.wechatWorkDeliveryState === "unknown" ||
    (task.guardSnapshot?.manualReviewRequired === true && task.guardSnapshot?.automaticRetryBlocked === true)
  ) return true;
  const attemptStatus = String(task.latestAttempt?.status || task.attempts?.[0]?.status || "").toLowerCase();
  const attemptMetadata = task.latestAttempt?.metadata || task.attempts?.[0]?.metadata || {};
  const attemptDeliveryState = String(attemptMetadata.deliveryState || "").toLowerCase();
  return attemptStatus === "unknown" || attemptStatus === "uncertain" || ["unknown", "partial", "unknown_after_cancel"].includes(attemptDeliveryState);
}

export function canResolveUnknownDelivery(task: SendTask) {
  const hasExactIdentity = Boolean(
    task.wechatAccountId && task.conversationId && task.conversation?.customerId,
  );
  return hasExactIdentity && hasUnknownDelivery(task) && !task.guardSnapshot?.manualDeliveryResolution?.resolution;
}

export function canExecuteSendTask(task: SendTask, adapter: SendAdapterInfo | null) {
  if (!adapter?.realSend) return false;
  if (task.status === "sending" || ["sent", "cancelled", "uncertain"].includes(task.status)) return false;
  if (task.status !== "queued") return false;
  if (isManualLockBlocking(task) || task.guardSnapshot?.blockedByRoutingPolicy || hasUnknownDelivery(task)) return false;
  return task.guardSnapshot?.status === "passed";
}

export function canRequeueSendTask(task: SendTask) {
  if (!["blocked", "failed", "dry_run"].includes(task.status)) return false;
  if (isManualLockBlocking(task) || task.guardSnapshot?.blockedByRoutingPolicy || hasUnknownDelivery(task)) return false;
  return true;
}

export function canCancelSendTask(task: SendTask) {
  if (task.status === "sending" || hasUnknownDelivery(task)) return false;
  return ["queued", "blocked", "failed", "dry_run"].includes(task.status);
}

export function isQueueSendTask(task: SendTask) {
  return task.status === "queued" || (task.status === "sending" && !hasUnknownDelivery(task));
}

export function isBlockedSendTask(task: SendTask) {
  return ["blocked", "failed", "dry_run", "uncertain"].includes(task.status) || hasUnknownDelivery(task);
}

export function taskCustomerLabel(task: SendTask) {
  return task.conversation?.customer?.name || task.conversation?.title || task.conversationId || "客户身份缺失";
}

export function taskMessagePreview(task: SendTask) {
  const text = typeof task.payload?.text === "string" ? task.payload.text.trim() : "";
  if (!text) return "当前任务没有可展示的文本内容；执行前仍需核对任务类型与附件。";
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

export function sendStatusLabel(status: string) {
  return ({
    queued: "待校验",
    blocked: "已拦截",
    sending: "等待回执",
    dry_run: "仅审计",
    sent: "渠道已接受",
    failed: "失败",
    cancelled: "已取消",
    uncertain: "投递不确定",
  } as Record<string, string>)[status] || status;
}

export function scopedSendTaskHref(basePath: string, task: SendTask) {
  const customerId = task.conversation?.customerId || task.payload?.customerId;
  const params = new URLSearchParams();
  if (task.wechatAccountId) params.set("wechatAccountId", task.wechatAccountId);
  if (task.conversationId) params.set("conversationId", task.conversationId);
  if (typeof customerId === "string" && customerId.trim()) params.set("customerId", customerId.trim());
  const query = params.toString();
  return `${basePath}/${encodeURIComponent(task.id)}${query ? `?${query}` : ""}`;
}

export function scopedIdentityHref(basePath: string, identity: IdentityFilters) {
  const params = new URLSearchParams();
  if (identity.wechatAccountId) params.set("wechatAccountId", identity.wechatAccountId);
  if (identity.conversationId) params.set("conversationId", identity.conversationId);
  if (identity.customerId) params.set("customerId", identity.customerId);
  const query = params.toString();
  return `${basePath}${query ? `?${query}` : ""}`;
}

export function operationBlockReason(task: SendTask, adapter?: SendAdapterInfo | null) {
  if (hasUnknownDelivery(task)) return "投递状态不确定，禁止自动重试、取消或再次执行；请先核对官方记录或客户会话。";
  if (task.status === "sending") return "任务正在等待发送回执，禁止重复执行。";
  if (isManualLockBlocking(task)) return "会话已被人工接管，必须先在会话页完成人工处理。";
  if (task.guardSnapshot?.blockedByRoutingPolicy) return "路由策略要求人工处理，不能从发送页绕过。";
  if (adapter && !adapter.realSend) return "真实发送适配器未就绪，本页不会退回演练发送。";
  if (task.guardSnapshot?.status !== "passed") return "必须先基于当前真实窗口完成账号、会话和客户校验。";
  return "当前任务状态不允许执行该操作。";
}
