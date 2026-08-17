import type { IdentityFilters, NotificationItem } from "../../lib/api";

export function notificationTargetHref(notification: NotificationItem, scope?: IdentityFilters) {
  const target = notification.target || {};
  const orderDraftId = stringTarget(target, "orderDraftId") || stringTarget(target, "orderId");
  const afterSalesCaseId = stringTarget(target, "afterSalesCaseId");
  if (orderDraftId && afterSalesCaseId) {
    return { href: "/sales/orders/" + encodeURIComponent(orderDraftId) + "/after-sales", label: "处理售后 case" };
  }
  const sendTaskId = stringTarget(target, "sendTaskId") || stringTarget(target, "taskId");
  if (sendTaskId) {
    const blocked = notificationNeedsBlockedSendHandling(notification);
    const query = notificationIdentityQuery(target, scope);
    return {
      href: (blocked ? "/send/blocked/" : "/send/queue/") + encodeURIComponent(sendTaskId) + query,
      label: blocked ? "处理发送异常" : "查看发送进度",
    };
  }
  if (orderDraftId) return { href: "/sales/orders/" + encodeURIComponent(orderDraftId), label: "打开订单" };
  const quoteDraftId = stringTarget(target, "quoteDraftId") || stringTarget(target, "quoteId");
  if (quoteDraftId) return { href: "/sales/quotes/" + encodeURIComponent(quoteDraftId), label: "打开报价" };
  const designJobId = stringTarget(target, "designJobId");
  if (designJobId) return { href: "/design/jobs/" + encodeURIComponent(designJobId), label: "打开设计任务" };
  const conversationId = stringTarget(target, "conversationId");
  if (!conversationId) return null;

  const identity = notificationConversationIdentity(target, scope);
  if (identity.wechatAccountId && identity.customerId) {
    return {
      href: "/conversations/" + encodeURIComponent(conversationId) + notificationIdentityQuery(identity),
      label: "回到会话处置",
    };
  }
  const params = new URLSearchParams({ q: conversationId });
  return {
    href: `/conversations?${params.toString()}`,
    label: "去会话列表核对身份",
  };
}

export function notificationNeedsBlockedSendHandling(notification: NotificationItem) {
  const text = `${notification.title || ""} ${notification.body || ""}`;
  return notification.level === "error"
    || /失败|阻断|拦截|异常|未知|不确定|超限|95001|95011|failed|blocked|uncertain|unknown/i.test(text);
}

function notificationConversationIdentity(target: Record<string, unknown>, scope?: IdentityFilters) {
  const conversationId = stringTarget(target, "conversationId");
  const scopeConversationId = String(scope?.conversationId || "").trim();
  const canUseScope = Boolean(scopeConversationId && scopeConversationId === conversationId);
  return {
    wechatAccountId: stringTarget(target, "wechatAccountId") || (canUseScope ? String(scope?.wechatAccountId || "").trim() : ""),
    conversationId,
    customerId: stringTarget(target, "customerId") || (canUseScope ? String(scope?.customerId || "").trim() : ""),
  };
}

function notificationIdentityQuery(target: Record<string, unknown>, scope?: IdentityFilters) {
  const identity = notificationConversationIdentity(target, scope);
  const params = new URLSearchParams();
  for (const key of ["wechatAccountId", "conversationId", "customerId"] as const) {
    const value = identity[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function stringTarget(target: Record<string, unknown>, key: string) {
  const value = target[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
