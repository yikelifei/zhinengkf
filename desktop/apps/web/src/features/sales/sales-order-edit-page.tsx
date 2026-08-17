"use client";

import { Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { identityExpectation, updateOrderFulfillment, type OrderDraft } from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import { evaluateOrderFulfillmentTransition } from "../../../../../packages/rules/orderDraft";
import {
  hasCompleteIdentity,
  identityLabel,
  SalesConfirmation,
  SalesEmpty,
  SalesHeader,
  SalesNotice,
  salesError,
} from "./sales-ui";
import { SalesOrderFulfillmentWorkflow } from "./sales-order-fulfillment-workflow";
import styles from "./sales-pages.module.css";
import { useSalesOrders } from "./use-sales-records";

export type OrderForm = {
  status: string;
  productionStatus: string;
  productionDueAt: string;
  carrier: string;
  trackingNo: string;
  shippedAt: string;
  deliveredAt: string;
  customerNotes: string;
};

const ORDER_FORM_FIELDS: Array<keyof OrderForm> = [
  "status",
  "productionStatus",
  "productionDueAt",
  "carrier",
  "trackingNo",
  "shippedAt",
  "deliveredAt",
  "customerNotes",
];

function formFromOrder(order: OrderDraft): OrderForm {
  return {
    status: order.status,
    productionStatus: order.productionStatus || "not_started",
    productionDueAt: order.productionDueAt || "",
    carrier: order.carrier || "",
    trackingNo: order.trackingNo || "",
    shippedAt: order.shippedAt || "",
    deliveredAt: order.deliveredAt || "",
    customerNotes: order.customerNotes || "",
  };
}

function fulfillmentPatchFromForm(order: OrderDraft, form: OrderForm) {
  const current = formFromOrder(order);
  return ORDER_FORM_FIELDS.reduce((memo, key) => {
    if (form[key] !== current[key]) memo[key] = form[key] as never;
    return memo;
  }, {} as Partial<OrderForm>);
}

function fulfillmentSaveBlockerText(decision: { reason?: string; missing?: string[]; invalid?: string[] }) {
  const fields = [...(decision.missing || []), ...(decision.invalid || [])].filter(Boolean);
  const fieldText = fields.length ? `：${fields.join("、")}` : "";
  const labels: Record<string, string> = {
    order_status_regression: "订单状态不能倒退",
    production_status_regression: "生产状态不能跳步或倒退",
    fulfilled_requires_full_payment: "订单完成前必须完成全款核验",
    shipment_facts_missing: "发货事实缺项",
    shipment_facts_invalid: "发货事实格式不合法",
    delivery_fact_missing: "缺少签收时间",
    delivery_fact_invalid: "签收事实格式不合法",
    delivery_before_shipment: "签收时间不能早于发货时间",
    fulfilled_requires_delivery: "完成订单前必须先完成签收事实",
    delivery_package_missing: "缺少客户选图或搭配商品快照",
  };
  return `${labels[decision.reason || ""] || "履约字段未通过校验"}${fieldText}`;
}

export function SalesOrderEditPage({ orderId }: { orderId: string }) {
  const { selected, loading, loaded, error: loadError, replace } = useSalesOrders(orderId);
  const [form, setForm] = useState<OrderForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);

  useEffect(() => {
    setForm(selected ? formFromOrder(selected) : null);
  }, [selected]);

  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = hasCompleteIdentity(expected);
  const dirty = useMemo(
    () => Boolean(selected && form && ORDER_FORM_FIELDS.some((key) => form[key] !== formFromOrder(selected)[key])),
    [form, selected],
  );
  const saveDecision = useMemo(
    () => selected && form && dirty
      ? evaluateOrderFulfillmentTransition(selected, fulfillmentPatchFromForm(selected, form))
      : { ok: true },
    [dirty, form, selected],
  );
  const saveBlocker = saveDecision.ok ? "" : fulfillmentSaveBlockerText(saveDecision);
  const canSave = Boolean(identityReady && dirty && saveDecision.ok);

  function update<K extends keyof OrderForm>(key: K, value: OrderForm[K]) {
    setForm((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!selected || !form || !identityReady) return;
    const patch = fulfillmentPatchFromForm(selected, form);
    const decision = evaluateOrderFulfillmentTransition(selected, patch);
    if (!decision.ok) {
      setConfirming(false);
      setError(`履约字段不能保存：${fulfillmentSaveBlockerText(decision)}`);
      return;
    }
    setConfirming(false);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const operation = reserveClientOperation("order-fulfillment", { id: selected.id, patch, expected }, pendingOperationRef.current);
      pendingOperationRef.current = operation;
      const updated = await updateOrderFulfillment(selected.id, { ...patch, ...expected, operationKey: operation.key });
      pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
      replace(updated);
      setNotice(`订单 ${updated.id} 的字段已保存，没有发送客户消息。`);
    } catch (cause) {
      setError(salesError(cause, "订单保存失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page} aria-label="编辑订单字段">
      <SalesHeader
        eyebrow="销售 / 订单编辑"
        title="编辑订单字段"
        detail="本页只保存订单状态、生产交付事实和客户备注；付款状态只读，需从报价页核验付款凭证。"
      />
      {loadError || error ? <SalesNotice tone="danger">{error || loadError}</SalesNotice> : null}
      {notice ? <SalesNotice tone="success">{notice}</SalesNotice> : null}
      {loading ? (
        <SalesEmpty title="正在读取订单" detail={`订单 ${orderId}`} busy />
      ) : selected && form ? (
        <form className={styles.card} onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) {
            if (saveBlocker) setError(`履约字段不能保存：${saveBlocker}`);
            return;
          }
          setConfirming(true);
        }}>
          <div className={styles.cardHeader}>
            <div>
              <h2>{selected.customer?.name || selected.customerId}</h2>
              <p>订单 {selected.id}</p>
            </div>
          </div>
          {!identityReady ? <SalesNotice tone="danger">身份不完整：{identityLabel(expected)}。已禁用保存。</SalesNotice> : null}
          {saveBlocker ? <SalesNotice tone="warning">履约字段不能保存：{saveBlocker}</SalesNotice> : null}
          <SalesOrderFulfillmentWorkflow
            order={selected}
            form={form}
            busy={busy}
            identityReady={identityReady}
            onPatch={(patch) => setForm((current) => current ? { ...current, ...patch } : current)}
          />
          <div className={styles.formGrid}>
            <label>
              <span>订单状态</span>
              <select value={form.status} disabled={busy || !identityReady} onChange={(event) => update("status", event.target.value)}>
                <option value="draft">草稿</option>
                <option value="confirmed" disabled={selected.status !== "confirmed"}>已确认（付款核验后自动写入）</option>
                <option value="processing">生产中</option>
                <option value="fulfilled">已完成</option>
                <option value="cancelled">已取消</option>
              </select>
            </label>
            <label><span>付款状态（只读）</span><input value={selected.paymentStatus} disabled /></label>
            <label><span>负责人（可信会话记录）</span><input value={selected.owner || "未记录"} disabled /></label>
            <label>
              <span>生产状态</span>
              <select value={form.productionStatus || "not_started"} disabled={busy || !identityReady} onChange={(event) => update("productionStatus", event.target.value)}>
                <option value="not_started">未开始生产</option>
                <option value="in_production">生产中</option>
                <option value="quality_check">质检中</option>
                <option value="ready_to_ship">待发货</option>
                <option value="shipped">已发货</option>
                <option value="delivered">已签收</option>
                <option value="blocked">生产受阻</option>
              </select>
            </label>
            <label><span>预计完成</span><input value={form.productionDueAt || ""} disabled={busy || !identityReady} placeholder="例如 2026-07-30 或 7 月 30 日" onChange={(event) => update("productionDueAt", event.target.value)} /></label>
            <label><span>物流公司</span><input value={form.carrier || ""} data-action-id="sales-order-edit-carrier" disabled={busy || !identityReady} placeholder="顺丰 / 京东 / 自提" onChange={(event) => update("carrier", event.target.value)} /></label>
            <label><span>物流单号</span><input value={form.trackingNo || ""} data-action-id="sales-order-edit-tracking-no" disabled={busy || !identityReady} onChange={(event) => update("trackingNo", event.target.value)} /></label>
            <label><span>发货时间</span><input value={form.shippedAt || ""} data-action-id="sales-order-edit-shipped-at" disabled={busy || !identityReady} placeholder="例如 2026-07-31 16:00" onChange={(event) => update("shippedAt", event.target.value)} /></label>
            <label><span>签收时间</span><input value={form.deliveredAt || ""} data-action-id="sales-order-edit-delivered-at" disabled={busy || !identityReady} placeholder="客户确认签收后填写" onChange={(event) => update("deliveredAt", event.target.value)} /></label>
            <label className={styles.fullField}><span>客户备注</span><textarea rows={4} value={form.customerNotes} disabled={busy || !identityReady} onChange={(event) => update("customerNotes", event.target.value)} /></label>
          </div>
          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryButton} data-action-id="sales-order-edit-save-request" disabled={busy || !canSave}><Save size={16} aria-hidden="true" />准备保存字段</button>
          </div>
          <Link className={styles.backLink} href={`/sales/orders/${encodeURIComponent(selected.id)}`} data-action-id="sales-order-edit-back">返回订单详情</Link>
        </form>
      ) : (
        <SalesEmpty
          title={loaded ? "没有找到订单" : "订单状态未确认"}
          detail={loaded ? "读取成功，请返回订单列表重新选择。" : "订单列表尚未成功读取，已阻止保存。"}
        />
      )}
      {confirming && selected ? (
        <SalesConfirmation
          title="确认保存订单字段？"
          detail={`${identityLabel(expected)}。只保存订单状态、生产交付事实和客户备注，不发送消息。`}
          confirmLabel="确认保存"
          confirmActionId="sales-order-edit-save-confirm"
          cancelActionId="sales-order-edit-save-cancel"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void save()}
        />
      ) : null}
    </section>
  );
}
