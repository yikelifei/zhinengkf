"use client";

import { FilePlus2, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createOrderDraftFromQuote, getQuotePreview, identityExpectation, queueQuoteSend, type IdentityFilters, type OrderDraft, type QuotePreview, type SendTask } from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import { DesignCommerceJourney } from "../design/design-commerce-journey";
import { orderIdentityHref, quoteIdentityHref, quoteJourneyRecommendation, quoteOrderReadiness, quoteStatusLabel } from "./sales-commerce-state";
import {
  hasCompleteIdentity,
  identityLabel,
  money,
  SalesConfirmation,
  SalesEmpty,
  SalesHeader,
  SalesMessagePreview,
  SalesNotice,
  salesError,
} from "./sales-ui";
import styles from "./sales-pages.module.css";
import { useSalesQuotes } from "./use-sales-records";

export type QuoteAction = "send" | "create-order";

export function SalesQuoteActionPage({ quoteId, action, initialIdentityFilters = {} }: { quoteId: string; action: QuoteAction; initialIdentityFilters?: IdentityFilters }) {
  const { selected, loading, loaded, error: loadError, replace } = useSalesQuotes(quoteId, initialIdentityFilters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<OrderDraft | null>(null);
  const [queuedSendTask, setQueuedSendTask] = useState<SendTask | null>(null);
  const [preview, setPreview] = useState<QuotePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = hasCompleteIdentity(expected);
  const isSend = action === "send";
  const orderReadiness = selected ? quoteOrderReadiness(selected) : null;
  const sendBlockers = preview?.warnings || [];
  const canRequestAction = !loadError && identityReady && (isSend
    ? !previewLoading && !previewError && Boolean(preview?.message) && sendBlockers.length === 0
    : Boolean(orderReadiness?.ok));

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setPreviewError("");
    if (!isSend || !selected || !identityReady) {
      setPreviewLoading(false);
      return () => { cancelled = true; };
    }
    setPreviewLoading(true);
    void getQuotePreview(selected.id, expected)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((cause) => {
        if (!cancelled) setPreviewError(salesError(cause, "报价消息预览失败"));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [
    isSend,
    selected?.id,
    identityReady,
    expected.expectedWechatAccountId,
    expected.expectedConversationId,
    expected.expectedCustomerId,
  ]);

  async function execute() {
    if (!selected || !identityReady) return;
    setConfirming(false); setBusy(true); setError(""); setNotice(""); setCreatedOrder(null); setQueuedSendTask(null);
    try {
      if (isSend) {
        const operation = reserveClientOperation("quote-send", { id: selected.id, expected }, pendingOperationRef.current);
        pendingOperationRef.current = operation;
        const result = await queueQuoteSend(selected.id, operation.key, expected);
        pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
        replace(result.quote);
        setQueuedSendTask(result.sendTask);
        setNotice(`报价 ${selected.id} 已进入微信安全发送队列；入队成功不等于客户已收到。`);
      } else {
        const order = await createOrderDraftFromQuote(selected.id, expected);
        setCreatedOrder(order);
        setNotice(`已创建订单草稿 ${order.id}；本页没有发送客户消息。`);
      }
    } catch (cause) {
      setError(salesError(cause, isSend ? "报价入队失败" : "订单草稿创建失败"));
    } finally { setBusy(false); }
  }

  return (
    <section className={styles.page} aria-label={isSend ? "发送报价" : "由报价创建订单草稿"}>
      <SalesHeader
        eyebrow="销售 · 报价操作"
        title={isSend ? "发送报价" : "创建订单草稿"}
        detail={isSend ? "本页只把这一条报价加入微信发送队列。" : "本页只由这一条报价创建订单草稿，不发送消息。"}
      />
      {loadError || error ? <SalesNotice tone="danger">{error || loadError}</SalesNotice> : null}
      {notice ? <SalesNotice tone="success">{notice}</SalesNotice> : null}
      {loading && !loaded ? <SalesEmpty title="正在读取报价" detail={`报价 ${quoteId}`} busy /> : selected ? (
        <>
        <DesignCommerceJourney
          active={createdOrder ? "order" : "quote"}
          title={isSend ? "报价发送门槛" : "报价转订单门槛"}
          recommendation={createdOrder ? "订单草稿已创建，继续进入订单详情核对履约信息。" : quoteJourneyRecommendation(selected)}
          blockedReason={!identityReady ? "客户身份不完整" : isSend ? sendBlockers.join("、") || undefined : orderReadiness?.reasons.join("、") || undefined}
        />
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div><h2>{selected.customer?.name || selected.customerId}</h2><p>报价 {selected.id}</p></div>
            <span className={styles.statusPill}>{quoteStatusLabel(selected.status)}</span>
          </div>
          <dl className={styles.factGrid}>
            <div><dt>总价</dt><dd>{money(selected.totalPrice)}</dd></div>
            <div><dt>客户身份</dt><dd>{identityLabel(expected)}</dd></div>
          </dl>
          {!identityReady ? <SalesNotice tone="danger">身份不完整，操作已禁用。</SalesNotice> : null}
          {isSend ? (
            <SalesMessagePreview
              message={preview?.message}
              warnings={preview?.warnings || []}
              loading={previewLoading}
              error={previewError}
            />
          ) : null}
          {!isSend && !orderReadiness?.ok ? <SalesNotice tone="warning">暂不能创建订单：{orderReadiness?.reasons.join("、")}。</SalesNotice> : null}
          {isSend && sendBlockers.length ? <SalesNotice tone="warning">暂不能加入发送队列：{sendBlockers.join("、")}。</SalesNotice> : null}
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id={isSend ? "sales-quote-send-request" : "sales-quote-create-order-request"}
              disabled={busy || !canRequestAction}
              onClick={() => setConfirming(true)}
            >
              {isSend ? <Send size={16} aria-hidden="true" /> : <FilePlus2 size={16} aria-hidden="true" />}
              {isSend ? "准备加入发送队列" : "准备创建订单草稿"}
            </button>
          </div>
          <Link className={styles.backLink} href={quoteIdentityHref(`/sales/quotes/${encodeURIComponent(selected.id)}`, selected)} data-action-id="sales-quote-action-back">返回报价详情</Link>
          {queuedSendTask ? (
            <Link className={styles.backLink} href={`/send/queue/${encodeURIComponent(queuedSendTask.id)}`} data-action-id="sales-quote-open-send-task">
              打开发送任务 {queuedSendTask.id}
            </Link>
          ) : null}
          {createdOrder ? (
            <Link className={styles.backLink} href={orderIdentityHref(`/sales/orders/${encodeURIComponent(createdOrder.id)}`, createdOrder)} data-action-id="sales-quote-open-created-order">
              打开订单 {createdOrder.id}
            </Link>
          ) : null}
        </article>
        </>
      ) : <SalesEmpty title={loaded ? "没有找到报价" : "报价状态未确认"} detail={loaded ? "读取成功，请返回报价列表重新选择。" : "报价列表尚未成功读取，已阻止操作。"} />}
      {confirming && selected ? (
        <SalesConfirmation
          title={isSend ? "确认把报价加入发送队列？" : "确认创建订单草稿？"}
          detail={isSend
            ? `${identityLabel(expected)}。系统会创建真实微信发送任务，但不会把已入队显示成已送达。`
            : `${identityLabel(expected)}。该操作会创建真实订单草稿，不发送客户消息。`}
          confirmLabel={isSend ? "确认入队" : "确认创建"}
          confirmActionId={isSend ? "sales-quote-send-confirm" : "sales-quote-create-order-confirm"}
          cancelActionId="sales-quote-action-cancel"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void execute()}
        />
      ) : null}
    </section>
  );
}
