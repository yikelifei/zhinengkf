import type { OrderDraft, SendTask } from "../../lib/api";
import { scopedSendTaskHref } from "../send/send-policy";

type DeliveryAudit = {
  items: Array<{ key: string; ok: boolean; detail: string }>;
  sendTasks: Array<{ label: string; task: SendTask }>;
};

export function buildDeliveryNextAction(order: OrderDraft, audit: DeliveryAudit) {
  const failedTask = audit.sendTasks.find(({ task }) => sendTaskResponsibility(task)?.kind === "blocked")?.task;
  if (failedTask) {
    return {
      label: "先处理发送失败",
      reason: "订单相关消息被阻断或投递结果不确定，必须先收敛发送结果，再继续交付。",
      href: scopedSendTaskHref("/send/blocked", failedTask),
      actionLabel: "处理失败任务",
    };
  }

  const firstBlockedItem = audit.items.find((item) => !item.ok);
  if (!firstBlockedItem) {
    return {
      label: "完成售后回访与经验沉淀",
      reason: "交付事实已经闭环；继续记录客户结果并把可复用经验送入人工复核。",
      href: orderTrainingHref(order),
      actionLabel: "沉淀交付结果",
    };
  }
  if (firstBlockedItem.key === "identity") {
    return {
      label: "核对客户身份绑定",
      reason: firstBlockedItem.detail,
      href: order.conversationId ? `/conversations/${encodeURIComponent(order.conversationId)}` : "/sales/orders",
      actionLabel: "返回客户会话",
    };
  }
  if (["payment-ledger", "paid"].includes(firstBlockedItem.key)) {
    return {
      label: "先核验付款事实",
      reason: firstBlockedItem.detail,
      href: `/sales/quotes/${encodeURIComponent(order.quoteDraftId)}/verify-payment`,
      actionLabel: "核验付款",
    };
  }
  if (["production", "shipment", "delivered", "delivery-package"].includes(firstBlockedItem.key)) {
    return {
      label: "补齐履约事实",
      reason: firstBlockedItem.detail,
      href: `/sales/orders/${encodeURIComponent(order.id)}/edit`,
      actionLabel: "更新履约",
    };
  }

  const messageKind = firstBlockedItem.key === "confirmation-message"
    ? "confirmation"
    : firstBlockedItem.key === "production-message"
      ? "production"
      : "delivery";
  const waitingTask = audit.sendTasks.find(({ task }) => Boolean(sendTaskResponsibility(task)))?.task;
  if (firstBlockedItem.key === "customer-message" && waitingTask) {
    const responsibility = sendTaskResponsibility(waitingTask)!;
    return {
      label: responsibility.kind === "blocked" ? "处理发送异常" : "核对发送进度",
      reason: firstBlockedItem.detail,
      href: responsibility.href,
      actionLabel: responsibility.label,
    };
  }
  if (firstBlockedItem.key === "customer-message" && audit.sendTasks.some(({ task }) => task.status === "sent")) {
    return {
      label: "核对客户是否可见",
      reason: "渠道已接受发送不等于客户已经看到；请回到会话或客户侧记录核对送达事实。",
      href: `/conversations/${encodeURIComponent(order.conversationId)}`,
      actionLabel: "核对客户会话",
    };
  }
  return {
    label: "补齐客户通知",
    reason: firstBlockedItem.detail,
    href: `/sales/orders/${encodeURIComponent(order.id)}/messages/${messageKind}`,
    actionLabel: "准备客户消息",
  };
}

export function sendTaskResponsibility(task: SendTask) {
  const deliveryState = String(task.guardSnapshot?.deliveryState || task.guardSnapshot?.wechatWorkDeliveryState || "").toLowerCase();
  if (["blocked", "failed", "uncertain", "dry_run"].includes(String(task.status || "")) || ["unknown", "partial", "unknown_after_cancel"].includes(deliveryState)) {
    return { kind: "blocked", href: scopedSendTaskHref("/send/blocked", task), label: "处理异常" };
  }
  if (["queued", "sending", "pending_ack"].includes(String(task.status || ""))) {
    return { kind: "queue", href: scopedSendTaskHref("/send/queue", task), label: "查看队列" };
  }
  return null;
}

function orderTrainingHref(order: OrderDraft) {
  const params = new URLSearchParams({
    wechatAccountId: order.wechatAccountId,
    conversationId: order.conversationId,
    customerId: order.customerId,
  });
  return `/training/overview?${params.toString()}`;
}
