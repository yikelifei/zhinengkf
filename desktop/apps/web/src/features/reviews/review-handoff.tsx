"use client";

import Link from "next/link";
import type {
  DesignJob,
  IdentityFilters,
  NotificationItem,
  OrderDraft,
  QuoteDraft,
  ReviewDesignJobResult,
  ReviewOrderResult,
  ReviewQuoteResult,
  SendTask,
} from "../../lib/api";
import styles from "../governance-pages.module.css";

export type ReviewHandoff = {
  sendTask?: SendTask | null;
  orderDraft?: OrderDraft | null;
  quoteDraft?: QuoteDraft | null;
  designJob?: DesignJob | null;
  conversationId?: string | null;
  notification?: NotificationItem | null;
};

export function reviewDesignHandoff(response: ReviewDesignJobResult, fallback: DesignJob): ReviewHandoff {
  const result = objectValue(response.result);
  const designJob = objectValue(result?.designJob) as DesignJob | null || designJobValue(response.result) || fallback;
  const sendTask = objectValue(result?.sendTask) as SendTask | null;
  return { designJob, sendTask, conversationId: sendTask?.conversationId || designJob?.conversationId || fallback.conversationId, notification: response.notification || null };
}

export function reviewQuoteHandoff(response: ReviewQuoteResult, fallback: QuoteDraft): ReviewHandoff {
  const result = objectValue(response.result);
  const quoteDraft = objectValue(result?.quote) as QuoteDraft | null || quoteValue(response.result) || fallback;
  const sendTask = objectValue(result?.sendTask) as SendTask | null || quoteDraft?.sendTask || null;
  const notification = response.notification || objectValue(result?.notification) as NotificationItem | null;
  return { quoteDraft, sendTask, conversationId: sendTask?.conversationId || quoteDraft?.designJob?.conversationId || null, notification };
}

export function reviewOrderHandoff(response: ReviewOrderResult, fallback: OrderDraft): ReviewHandoff {
  const result = objectValue(response.result);
  const orderDraft = objectValue(result?.orderDraft) as OrderDraft | null || objectValue(result?.order) as OrderDraft | null || orderValue(response.result) || fallback;
  const sendTask = objectValue(result?.sendTask) as SendTask | null
    || orderDraft?.confirmationSendTask
    || orderDraft?.productionFollowupSendTask
    || orderDraft?.deliveryFollowupSendTask
    || orderDraft?.followupSendTask
    || null;
  const notification = response.notification || objectValue(result?.notification) as NotificationItem | null;
  return { orderDraft, sendTask, conversationId: sendTask?.conversationId || orderDraft?.conversationId || fallback.conversationId, notification };
}

export function reviewIdentityHref(href: string, identityFilters?: IdentityFilters) {
  const params = new URLSearchParams();
  if (identityFilters?.wechatAccountId) params.set("wechatAccountId", identityFilters.wechatAccountId);
  if (identityFilters?.conversationId) params.set("conversationId", identityFilters.conversationId);
  if (identityFilters?.customerId) params.set("customerId", identityFilters.customerId);
  const query = params.toString();
  return query ? `${href}?${query}` : href;
}

export function ReviewHandoffPanel({ handoff, actionIdPrefix }: { handoff: ReviewHandoff | null; actionIdPrefix: string }) {
  if (!handoff) return null;
  const link = reviewHandoffNextLink(handoff);
  if (!link) return null;
  return (
    <section className={styles.handoffPanel} aria-label="审核后续处理">
      <h2>后续处理</h2>
      <div className={styles.buttonRow}>
        <Link className={styles.primaryButton} href={link.href} data-action-id={`${actionIdPrefix}-${link.action}`}>
          {link.label}
        </Link>
      </div>
    </section>
  );
}

export function reviewHandoffNextLink(handoff: ReviewHandoff) {
  let link: { href: string; label: string; action: string } | null = null;
  if (handoff.sendTask?.id) {
    const blocked = ["blocked", "failed"].includes(String(handoff.sendTask.status || "").toLowerCase());
    link = blocked
      ? { href: `/send/blocked/${encodeURIComponent(handoff.sendTask.id)}`, label: "处理发送阻断", action: "open-blocked-send" }
      : { href: `/send/queue/${encodeURIComponent(handoff.sendTask.id)}`, label: "打开发送任务", action: "open-send-task" };
  } else if (handoff.orderDraft?.id) {
    link = { href: `/sales/orders/${encodeURIComponent(handoff.orderDraft.id)}`, label: "打开订单", action: "open-order" };
  } else if (handoff.quoteDraft?.id) {
    link = { href: `/sales/quotes/${encodeURIComponent(handoff.quoteDraft.id)}`, label: "打开报价", action: "open-quote" };
  } else if (handoff.designJob?.id) {
    link = { href: `/design/jobs/${encodeURIComponent(handoff.designJob.id)}`, label: "打开设计任务", action: "open-design-job" };
  } else if (handoff.conversationId) {
    link = { href: `/conversations/${encodeURIComponent(handoff.conversationId)}`, label: "回到会话", action: "open-conversation" };
  }
  if (!link) return null;
  return { ...link, href: reviewIdentityHref(link.href, reviewHandoffIdentity(handoff)) };
}

function reviewHandoffIdentity(handoff: ReviewHandoff): IdentityFilters {
  const designJob = handoff.designJob || handoff.quoteDraft?.designJob || null;
  const sendConversation = handoff.sendTask?.conversation;
  return {
    wechatAccountId: handoff.sendTask?.wechatAccountId || handoff.orderDraft?.wechatAccountId || designJob?.wechatAccountId || undefined,
    conversationId: handoff.sendTask?.conversationId || handoff.orderDraft?.conversationId || designJob?.conversationId || handoff.conversationId || undefined,
    customerId: sendConversation?.customerId || handoff.orderDraft?.customerId || handoff.quoteDraft?.customerId || designJob?.customerId || undefined,
  };
}

function objectValue(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function designJobValue(value: unknown): DesignJob | null {
  const record = objectValue(value);
  return record?.requestId && record?.status ? record as DesignJob : null;
}

function quoteValue(value: unknown): QuoteDraft | null {
  const record = objectValue(value);
  return record?.designJobId && record?.totalPrice !== undefined ? record as QuoteDraft : null;
}

function orderValue(value: unknown): OrderDraft | null {
  const record = objectValue(value);
  return record?.quoteDraftId && record?.wechatAccountId ? record as OrderDraft : null;
}
