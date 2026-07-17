"use client";

import { Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { identityExpectation, updateOrderDraft, type OrderDraft } from "../../lib/api";
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

type OrderForm = Pick<OrderDraft, "status" | "paymentStatus"> & { owner: string; customerNotes: string };

function formFromOrder(order: OrderDraft): OrderForm {
  return { status: order.status, paymentStatus: order.paymentStatus, owner: order.owner || "", customerNotes: order.customerNotes || "" };
}

export function SalesOrderEditPage({ orderId }: { orderId: string }) {
  const { selected, loading, error: loadError, ambiguousEmpty, replace } = useSalesOrders(orderId);
  const [form, setForm] = useState<OrderForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { setForm(selected ? formFromOrder(selected) : null); }, [selected]);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = hasCompleteIdentity(expected);
  const dirty = useMemo(() => Boolean(selected && form && (
    form.status !== selected.status || form.paymentStatus !== selected.paymentStatus
      || form.owner !== (selected.owner || "") || form.customerNotes !== (selected.customerNotes || "")
  )), [form, selected]);

  function update<K extends keyof OrderForm>(key: K, value: OrderForm[K]) {
    setForm((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!selected || !form || !identityReady) return;
    setConfirming(false); setBusy(true); setError(""); setNotice("");
    try {
      const updated = await updateOrderDraft(selected.id, { ...form, ...expected });
      replace(updated); setNotice(`订单 ${updated.id} 的字段已保存；没有发送客户消息。`);
    } catch (cause) { setError(salesError(cause, "订单保存失败")); }
    finally { setBusy(false); }
  }

  return (
    <section className={styles.page} aria-label="编辑订单字段">
      <SalesHeader eyebrow="销售 · 订单编辑" title="编辑订单字段" detail="本页只保存订单状态、付款状态、负责人和客户备注，不发送消息。" />
      {loadError || error ? <SalesNotice tone="danger">{error || loadError}</SalesNotice> : null}
      {notice ? <SalesNotice tone="success">{notice}</SalesNotice> : null}
      {ambiguousEmpty ? <SalesNotice tone="warning">空结果无法证明订单不存在；已阻止保存。</SalesNotice> : null}
      {loading ? <SalesEmpty title="正在读取订单" detail={`订单 ${orderId}`} busy /> : selected && form ? (
        <form className={styles.card} onSubmit={(event) => { event.preventDefault(); setConfirming(true); }}>
          <div className={styles.cardHeader}><div><h2>{selected.customer?.name || selected.customerId}</h2><p>订单 {selected.id}</p></div></div>
          {!identityReady ? <SalesNotice tone="danger">身份不完整：{identityLabel(expected)}。已禁用保存。</SalesNotice> : null}
          <div className={styles.formGrid}>
            <label><span>订单状态</span><input value={form.status} disabled={busy || !identityReady} onChange={(event) => update("status", event.target.value)} /></label>
            <label><span>付款状态</span><input value={form.paymentStatus} disabled={busy || !identityReady} onChange={(event) => update("paymentStatus", event.target.value)} /></label>
            <label><span>负责人</span><input value={form.owner} disabled={busy || !identityReady} onChange={(event) => update("owner", event.target.value)} /></label>
            <label className={styles.fullField}><span>客户备注</span><textarea rows={4} value={form.customerNotes} disabled={busy || !identityReady} onChange={(event) => update("customerNotes", event.target.value)} /></label>
          </div>
          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryButton} data-action-id="sales-order-edit-save-request" disabled={busy || !identityReady || !dirty}><Save size={16} aria-hidden="true" />准备保存字段</button>
          </div>
          <Link className={styles.backLink} href={`/sales/orders/${encodeURIComponent(selected.id)}`} data-action-id="sales-order-edit-back">返回订单详情</Link>
        </form>
      ) : <SalesEmpty title="没有找到订单" detail="返回订单列表重新选择。" />}
      {confirming && selected ? <SalesConfirmation title="确认保存订单字段？" detail={`${identityLabel(expected)}。只保存当前四个字段，不发送消息。`} confirmLabel="确认保存" confirmActionId="sales-order-edit-save-confirm" cancelActionId="sales-order-edit-save-cancel" busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void save()} /> : null}
    </section>
  );
}
