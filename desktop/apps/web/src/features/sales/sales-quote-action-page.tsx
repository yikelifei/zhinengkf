"use client";

import { FilePlus2, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { createOrderDraftFromQuote, identityExpectation, queueQuoteSend } from "../../lib/api";
import {
  hasCompleteIdentity,
  identityLabel,
  money,
  SalesConfirmation,
  SalesEmpty,
  SalesHeader,
  SalesNotice,
  salesError,
} from "./sales-ui";
import styles from "./sales-pages.module.css";
import { useSalesQuotes } from "./use-sales-records";

export type QuoteAction = "send" | "create-order";

export function SalesQuoteActionPage({ quoteId, action }: { quoteId: string; action: QuoteAction }) {
  const { selected, loading, error: loadError, ambiguousEmpty, replace } = useSalesQuotes(quoteId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = hasCompleteIdentity(expected);
  const isSend = action === "send";

  async function execute() {
    if (!selected || !identityReady) return;
    setConfirming(false); setBusy(true); setError(""); setNotice("");
    try {
      if (isSend) {
        const result = await queueQuoteSend(selected.id, expected);
        replace(result.quote);
        setNotice(`报价 ${selected.id} 已进入微信安全发送队列；入队成功不等于客户已收到。`);
      } else {
        const order = await createOrderDraftFromQuote(selected.id, expected);
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
      {ambiguousEmpty ? <SalesNotice tone="warning">空结果无法证明报价不存在；已阻止操作。</SalesNotice> : null}
      {loading ? <SalesEmpty title="正在读取报价" detail={`报价 ${quoteId}`} busy /> : selected ? (
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div><h2>{selected.customer?.name || selected.customerId}</h2><p>报价 {selected.id}</p></div>
            <span className={styles.statusPill}>{selected.status}</span>
          </div>
          <dl className={styles.factGrid}>
            <div><dt>总价</dt><dd>{money(selected.totalPrice)}</dd></div>
            <div><dt>客户身份</dt><dd>{identityLabel(expected)}</dd></div>
          </dl>
          {!identityReady ? <SalesNotice tone="danger">身份不完整，操作已禁用。</SalesNotice> : null}
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id={isSend ? "sales-quote-send-request" : "sales-quote-create-order-request"}
              disabled={busy || !identityReady}
              onClick={() => setConfirming(true)}
            >
              {isSend ? <Send size={16} aria-hidden="true" /> : <FilePlus2 size={16} aria-hidden="true" />}
              {isSend ? "准备加入发送队列" : "准备创建订单草稿"}
            </button>
          </div>
          <Link className={styles.backLink} href={`/sales/quotes/${encodeURIComponent(selected.id)}`} data-action-id="sales-quote-action-back">返回报价详情</Link>
        </article>
      ) : <SalesEmpty title="没有找到报价" detail="返回报价列表重新选择。" />}
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
