"use client";

import { BellRing, Truck } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { identityExpectation, queueOrderConfirmation, queueOrderFollowup } from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import {
  hasCompleteIdentity,
  identityLabel,
  SalesConfirmation,
  SalesEmpty,
  SalesHeader,
  SalesNotice,
  salesError,
} from "./sales-ui";
import styles from "./sales-pages.module.css";
import { useSalesOrders } from "./use-sales-records";

export type OrderMessageKind = "confirmation" | "production" | "delivery";

const COPY: Record<OrderMessageKind, { title: string; detail: string; label: string }> = {
  confirmation: { title: "发送订单确认", detail: "本页只把订单确认消息加入微信发送队列。", label: "订单确认" },
  production: { title: "发送生产跟进", detail: "本页只把生产进度跟进加入微信发送队列。", label: "生产跟进" },
  delivery: { title: "发送发货跟进", detail: "本页只把发货进度跟进加入微信发送队列。", label: "发货跟进" },
};

export function SalesOrderMessagePage({ orderId, kind }: { orderId: string; kind: OrderMessageKind }) {
  const { selected, loading, loaded, error: loadError, replace } = useSalesOrders(orderId);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);
  const copy = COPY[kind];
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = hasCompleteIdentity(expected);

  async function queueMessage() {
    if (!selected || !identityReady) return;
    setConfirming(false); setBusy(true); setError(""); setNotice("");
    const operation = reserveClientOperation("order-send", { id: selected.id, kind, expected }, pendingOperationRef.current);
    pendingOperationRef.current = operation;
    try {
      const updated = kind === "confirmation"
        ? (await queueOrderConfirmation(selected.id, operation.key, expected)).orderDraft
        : (await queueOrderFollowup(selected.id, kind, operation.key, expected)).orderDraft;
      pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
      replace(updated);
      setNotice(`${copy.label}已入队；入队成功不等于客户已收到。`);
    } catch (cause) { setError(salesError(cause, `${copy.label}入队失败`)); }
    finally { setBusy(false); }
  }

  return (
    <section className={styles.page} aria-label={copy.title}>
      <SalesHeader eyebrow="销售 · 订单消息" title={copy.title} detail={copy.detail} />
      {loadError || error ? <SalesNotice tone="danger">{error || loadError}</SalesNotice> : null}
      {notice ? <SalesNotice tone="success">{notice}</SalesNotice> : null}
      {loading ? <SalesEmpty title="正在读取订单" detail={`订单 ${orderId}`} busy /> : selected ? (
        <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>{selected.customer?.name || selected.customerId}</h2><p>订单 {selected.id}</p></div><span className={styles.statusPill}>{selected.status}</span></div>
          <dl className={styles.factGrid}>
            <div><dt>消息类型</dt><dd>{copy.label}</dd></div>
            <div><dt>客户身份</dt><dd>{identityLabel(expected)}</dd></div>
          </dl>
          {!identityReady ? <SalesNotice tone="danger">身份不完整，操作已禁用。</SalesNotice> : null}
          <div className={styles.formActions}>
            <button type="button" className={styles.primaryButton} data-action-id={`sales-order-${kind}-request`} disabled={busy || !identityReady} onClick={() => setConfirming(true)}>
              {kind === "delivery" ? <Truck size={16} aria-hidden="true" /> : <BellRing size={16} aria-hidden="true" />}
              准备发送{copy.label}
            </button>
          </div>
          <Link className={styles.backLink} href={`/sales/orders/${encodeURIComponent(selected.id)}`} data-action-id="sales-order-message-back">返回订单详情</Link>
        </article>
      ) : <SalesEmpty title={loaded ? "没有找到订单" : "订单状态未确认"} detail={loaded ? "读取成功，请返回订单列表重新选择。" : "订单列表尚未成功读取，已阻止消息入队。"} />}
      {confirming && selected ? <SalesConfirmation title={`确认把${copy.label}加入发送队列？`} detail={`${identityLabel(expected)}。系统会创建真实微信发送任务，且不会自动解除人工接管锁。`} confirmLabel="确认入队" confirmActionId={`sales-order-${kind}-confirm`} cancelActionId={`sales-order-${kind}-cancel`} busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void queueMessage()} /> : null}
    </section>
  );
}
