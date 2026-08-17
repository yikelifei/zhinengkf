"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { identityExpectation, verifyQuotePaymentProofAndQueueConfirmation, type IdentityFilters, type OrderDraft } from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
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
import { orderIdentityHref, quoteIdentityHref, quoteStatusLabel } from "./sales-commerce-state";
import { useSalesQuotes } from "./use-sales-records";

type PaymentStatus = "deposit_paid" | "paid";

export function SalesQuotePaymentPage({ quoteId, initialIdentityFilters = {} }: { quoteId: string; initialIdentityFilters?: IdentityFilters }) {
  const { selected, loading, loaded, error: loadError, replace } = useSalesQuotes(quoteId, initialIdentityFilters);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("deposit_paid");
  const [amountCny, setAmountCny] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [proofReference, setProofReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmedOrder, setConfirmedOrder] = useState<OrderDraft | null>(null);
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = hasCompleteIdentity(expected);
  const paymentAmount = Number(amountCny);
  const paymentDetailsReady = Number.isFinite(paymentAmount) && paymentAmount > 0 && Boolean(method.trim() && proofReference.trim());

  async function verifyPayment() {
    if (!selected || !identityReady) return;
    if (!paymentDetailsReady) {
      setConfirming(false);
      setError("付款核验必须填写大于 0 的金额、收款方式和凭证引用。");
      return;
    }
    setConfirming(false);
    setBusy(true);
    setError("");
    setNotice("");
    setConfirmedOrder(null);
    const operation = reserveClientOperation(
      "payment-proof",
      { id: selected.id, paymentStatus, amountCny, method, proofReference, expected, note },
      pendingOperationRef.current,
    );
    pendingOperationRef.current = operation;
    try {
      const result = await verifyQuotePaymentProofAndQueueConfirmation(
        selected.id,
        paymentStatus,
        operation.key,
        expected,
        note,
        { amountCny, method, proofReference },
      );
      pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
      replace(result.quote);
      setConfirmedOrder(result.orderDraft);
      setNotice(
        result.sendTask
          ? `付款已核验，台账 ${result.paymentEvent.id} 已记录，订单 ${result.orderDraft.id} 已确认，订单确认消息已进入发送队列 ${result.sendTask.id}。`
          : `付款已核验，台账 ${result.paymentEvent.id} 已记录，订单 ${result.orderDraft.id} 已确认；${result.message}`,
      );
    } catch (cause) {
      setError(salesError(cause, "付款核验失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page} aria-label="核验报价付款">
      <SalesHeader
        eyebrow="销售 · 付款核验"
        title="核验付款凭证"
        detail="本页只记录人工已核验的定金或全款，并按规则创建订单草稿或把订单确认加入安全发送队列。"
      />
      {loadError || error ? <SalesNotice tone="danger">{error || loadError}</SalesNotice> : null}
      {notice ? <SalesNotice tone="success">{notice}</SalesNotice> : null}
      {loading && !loaded ? <SalesEmpty title="正在读取报价" detail={`报价 ${quoteId}`} busy /> : selected ? (
        <form className={styles.card} onSubmit={(event) => { event.preventDefault(); setConfirming(true); }}>
          <div className={styles.cardHeader}>
            <div><h2>{selected.customer?.name || selected.customerId}</h2><p>报价 {selected.id}</p></div>
            <span className={styles.statusPill}>{selected.paymentStatus}</span>
          </div>
          <dl className={styles.factGrid}>
            <div><dt>总价</dt><dd>{money(selected.totalPrice)}</dd></div>
            <div><dt>客户身份</dt><dd>{identityLabel(expected)}</dd></div>
            <div><dt>报价状态</dt><dd>{quoteStatusLabel(selected.status)}</dd></div>
            <div><dt>负责人</dt><dd>{selected.owner || "未分配"}</dd></div>
          </dl>
          {!identityReady ? <SalesNotice tone="danger">身份不完整，付款核验已禁用。</SalesNotice> : null}
          {identityReady && !paymentDetailsReady ? <SalesNotice tone="warning">付款核验必须填写大于 0 的金额、收款方式和凭证引用。</SalesNotice> : null}
          <div className={styles.formGrid}>
            <label>
              <span>核验结果</span>
              <select
                value={paymentStatus}
                disabled={busy || !identityReady}
                onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)}
              >
                <option value="deposit_paid">已收定金</option>
                <option value="paid">已收全款</option>
              </select>
            </label>
            <label>
              <span>核验金额</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amountCny}
                disabled={busy || !identityReady}
                placeholder={String(selected.totalPrice || "")}
                onChange={(event) => setAmountCny(event.target.value)}
              />
            </label>
            <label>
              <span>收款方式</span>
              <select value={method} disabled={busy || !identityReady} onChange={(event) => setMethod(event.target.value)}>
                <option value="bank_transfer">银行转账</option>
                <option value="wechat_pay">微信支付</option>
                <option value="alipay">支付宝</option>
                <option value="cash">现金</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              <span>凭证引用</span>
              <input
                value={proofReference}
                disabled={busy || !identityReady}
                placeholder="例如：截图文件名、流水号后四位或附件编号"
                onChange={(event) => setProofReference(event.target.value)}
              />
            </label>
            <label className={styles.fullField}>
              <span>核验说明</span>
              <textarea
                rows={4}
                value={note}
                disabled={busy || !identityReady}
                placeholder="例如：已核对客户转账截图、收款账户和金额。"
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>
          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryButton} data-action-id="sales-quote-payment-verify-request" disabled={busy || Boolean(loadError) || !identityReady || !paymentDetailsReady}>
              <ShieldCheck size={16} aria-hidden="true" />
              准备核验付款
            </button>
          </div>
          {confirmedOrder ? (
            <Link className={styles.backLink} href={orderIdentityHref(`/sales/orders/${encodeURIComponent(confirmedOrder.id)}`, confirmedOrder)} data-action-id="sales-quote-payment-open-order">
              打开订单 {confirmedOrder.id}
            </Link>
          ) : null}
          <Link className={styles.backLink} href={quoteIdentityHref(`/sales/quotes/${encodeURIComponent(selected.id)}`, selected)} data-action-id="sales-quote-payment-back">返回报价详情</Link>
        </form>
      ) : <SalesEmpty title={loaded ? "没有找到报价" : "报价状态未确认"} detail={loaded ? "读取成功，请返回报价列表重新选择。" : "报价列表尚未成功读取，已阻止付款核验。"} />}
      {confirming && selected ? (
        <SalesConfirmation
          title="确认付款凭证已人工核验？"
          detail={`${identityLabel(expected)}。该操作会记录${paymentStatus === "paid" ? "全款" : "定金"}台账${amountCny ? `，金额 ${amountCny} 元` : ""}，创建或确认订单，并可能生成真实微信安全发送任务。`}
          confirmLabel="确认核验"
          confirmActionId="sales-quote-payment-verify-confirm"
          cancelActionId="sales-quote-payment-verify-cancel"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void verifyPayment()}
        />
      ) : null}
    </section>
  );
}
