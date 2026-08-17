import Link from "next/link";
import type { OrderDraft, PaymentEvent, SendTask } from "../../lib/api";
import {
  evaluateOrderDeliveryPackage,
  isDeliveryBeforeShipment,
  isPickupCarrier,
  isValidCarrier,
  isValidOrderDateTime,
  isValidTrackingNo,
  normalizeCarrier,
  normalizeOrderDateTime,
  normalizeTrackingNo,
} from "../../../../../packages/rules/orderDraft";
import styles from "./sales-pages.module.css";
import { fulfillmentStatusLabel, money, textOrDash } from "./sales-ui";
import { buildDeliveryNextAction, sendTaskResponsibility } from "./sales-order-delivery-next-action";

export { buildDeliveryNextAction } from "./sales-order-delivery-next-action";

export function SalesOrderDeliveryAudit({
  order,
  identityReady,
}: {
  order: OrderDraft;
  identityReady: boolean;
}) {
  const deliveryAudit = buildDeliveryAudit(order, identityReady);
  const nextAction = buildDeliveryNextAction(order, deliveryAudit);

  return (
    <>
      <section className={styles.auditSection} aria-labelledby="sales-order-delivery-audit-title">
        <div className={styles.auditHeader}>
          <div>
            <h3 id="sales-order-delivery-audit-title">交付核对</h3>
            <p>只读核对付款、履约事实和客户消息队列；缺项时不能当作已完成交付。</p>
          </div>
          <span className={`${styles.statusPill} ${deliveryAudit.ready ? styles.auditReady : styles.auditBlocked}`}>
            {deliveryAudit.ready ? "可交付" : "交付未闭环"}
          </span>
        </div>
        <div className={styles.auditList} aria-label="订单交付核对项">
          {deliveryAudit.items.map((item) => (
            <div className={`${styles.auditRow} ${item.ok ? styles.auditRowOk : styles.auditRowBlocked}`} key={item.key}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
          ))}
        </div>
        <div className={styles.actionBar} aria-label="订单交付下一步">
          <div>
            <strong>推荐下一步：{nextAction.label}</strong>
            <p className={styles.helpText}>{nextAction.reason}</p>
          </div>
          <Link className={styles.button} href={nextAction.href} data-action-id="sales-order-delivery-next-action">
            {nextAction.actionLabel}
          </Link>
        </div>
      </section>

      <section className={styles.auditSection} aria-labelledby="sales-order-payment-ledger-title">
        <div className={styles.auditHeader}>
          <div>
            <h3 id="sales-order-payment-ledger-title">付款台账</h3>
            <p>来自服务端付款核验事件，不在本页新增或修改。</p>
          </div>
          <span className={styles.statusPill}>{(order.paymentEvents || []).length} 条</span>
        </div>
        {order.paymentEvents?.length ? (
          <div className={styles.auditList} aria-label="订单付款事件">
            {order.paymentEvents.map((event) => <PaymentEventRow event={event} key={event.id} />)}
          </div>
        ) : (
          <p className={styles.auditEmpty}>还没有付款核验事件；请先从报价详情进入付款核验。</p>
        )}
      </section>

      <section className={styles.auditSection} aria-labelledby="sales-order-send-state-title">
        <div className={styles.auditHeader}>
          <div>
            <h3 id="sales-order-send-state-title">客户消息状态</h3>
            <p>这里只展示企业微信发送队列状态，不会直接发送消息。</p>
          </div>
        </div>
        {deliveryAudit.sendTasks.length ? (
          <div className={styles.auditList} aria-label="订单发送任务状态">
            {deliveryAudit.sendTasks.map((item) => <SendTaskRow label={item.label} task={item.task} key={`${item.label}:${item.task.id}`} />)}
          </div>
        ) : (
          <p className={styles.auditEmpty}>还没有订单确认、生产跟进或发货跟进消息进入队列。</p>
        )}
      </section>
    </>
  );
}

export function buildDeliveryAudit(order: OrderDraft, identityReady: boolean) {
  const paymentEvents = Array.isArray(order.paymentEvents) ? order.paymentEvents : [];
  const sendTasks = collectOrderSendTasks(order);
  const sendState = buildOrderSendState(order);
  const shipmentAudit = buildShipmentAudit(order);
  const deliveryFactAudit = buildDeliveryFactAudit(order, shipmentAudit.shippedAt);
  const deliveryPackageAudit = evaluateOrderDeliveryPackage(order);
  const orderTotal = normalizePaymentAmount(order.totalPrice);
  const verifiedPaymentAmount = sumVerifiedPaymentEvents(paymentEvents);
  const paymentReady = order.paymentStatus === "paid" && orderTotal !== null && verifiedPaymentAmount + 0.0001 >= orderTotal;
  const queuedMessageCount = sendTasks.filter(({ task }) => taskHasQueueRecord(task)).length;
  const deliveredMessageCount = sendTasks.filter(({ task }) => taskHasCustomerDeliveryEvidence(task)).length;
  const customerMessageReady = deliveredMessageCount > 0;
  const items = [
    {
      key: "identity",
      label: "身份绑定",
      ok: identityReady,
      detail: identityReady ? "订单已绑定企业微信账号、会话和客户。" : "缺少企业微信账号、会话或客户身份。",
    },
    {
      key: "payment-ledger",
      label: "付款台账",
      ok: paymentEvents.length > 0,
      detail: paymentEvents.length
        ? `已有 ${paymentEvents.length} 条付款核验事件，已核验金额 ${money(verifiedPaymentAmount)}。`
        : "没有付款核验事件。",
    },
    {
      key: "paid",
      label: "全款状态",
      ok: paymentReady,
      detail: paymentReady
        ? `付款台账金额已覆盖订单总额 ${money(orderTotal)}。`
        : `当前付款状态为 ${paymentStatusLabel(order.paymentStatus)}，付款流水 ${money(verifiedPaymentAmount)} / 订单总额 ${orderTotal === null ? "未记录" : money(orderTotal)}。`,
    },
    {
      key: "production",
      label: "生产事实",
      ok: ["ready_to_ship", "shipped", "delivered"].includes(String(order.productionStatus || "")),
      detail: `生产状态：${fulfillmentStatusLabel(order.productionStatus)}。`,
    },
    {
      key: "shipment",
      label: "物流事实",
      ok: shipmentAudit.ok,
      detail: shipmentAudit.detail,
    },
    {
      key: "delivered",
      label: "签收事实",
      ok: deliveryFactAudit.ok,
      detail: deliveryFactAudit.detail,
    },
    {
      key: "delivery-package",
      label: "交付资料包",
      ok: deliveryPackageAudit.ok,
      detail: buildDeliveryPackageDetail(deliveryPackageAudit),
    },
    {
      key: "confirmation-message",
      label: "订单确认消息",
      ok: sendState.confirmation,
      detail: sendState.confirmation ? "订单确认消息已有队列或发送记录。" : "还没有订单确认消息队列记录。",
    },
    {
      key: "production-message",
      label: "生产跟进消息",
      ok: sendState.production,
      detail: sendState.production ? "生产跟进消息已有队列或发送记录。" : "还没有生产跟进消息队列记录。",
    },
    {
      key: "delivery-message",
      label: "发货跟进消息",
      ok: sendState.delivery,
      detail: sendState.delivery ? "发货跟进消息已有队列或发送记录。" : "还没有发货跟进消息队列记录。",
    },
    {
      key: "customer-message",
      label: "客户消息",
      ok: customerMessageReady,
      detail: customerMessageReady
        ? `已有 ${deliveredMessageCount} 条订单相关消息具备人工核对的客户可见证据。`
        : queuedMessageCount
          ? `已有 ${queuedMessageCount} 条订单相关消息入队、发送中或渠道已接受，但还没有客户可见或人工确认送达证据。`
          : "尚未形成订单确认、生产或发货跟进消息队列记录。",
    },
  ];
  return {
    ready: items.every((item) => item.ok),
    items,
    sendTasks,
  };
}

function buildShipmentAudit(order: OrderDraft) {
  const carrier = normalizeCarrier(order.carrier || "");
  const trackingNo = normalizeTrackingNo(order.trackingNo || "");
  const shippedAt = normalizeOrderDateTime(order.shippedAt || "");
  const pickup = isPickupCarrier(carrier);
  const missing = [];
  if (!carrier) missing.push("物流公司");
  if (!pickup && !trackingNo) missing.push("物流单号");
  if (!shippedAt) missing.push("发货时间");
  if (missing.length) {
    return {
      ok: false,
      carrier,
      trackingNo,
      shippedAt,
      detail: `缺少${missing.join("、")}；自提可不填物流单号。`,
    };
  }

  const invalid = [];
  if (!isValidCarrier(carrier)) invalid.push("物流公司");
  if (!pickup && !isValidTrackingNo(trackingNo)) invalid.push("物流单号");
  if (!isValidOrderDateTime(shippedAt)) invalid.push("发货时间");
  if (invalid.length) {
    return {
      ok: false,
      carrier,
      trackingNo,
      shippedAt,
      detail: `${invalid.join("、")}格式不正确；物流单号请填写真实承运方单号，自提可不填。`,
    };
  }

  return {
    ok: true,
    carrier,
    trackingNo,
    shippedAt,
    detail: `${carrier} / ${pickup ? "自提无需物流单号" : trackingNo} / ${shippedAt}`,
  };
}

function buildDeliveryFactAudit(order: OrderDraft, shippedAt: string) {
  const deliveredAt = normalizeOrderDateTime(order.deliveredAt || "");
  if (order.status !== "fulfilled") {
    return { ok: false, detail: "订单尚未记录 fulfilled 状态，不能视为已签收。" };
  }
  if (String(order.productionStatus || "") !== "delivered") {
    return { ok: false, detail: "订单生产状态尚未记录为已签收/已交付。" };
  }
  if (!deliveredAt) {
    return { ok: false, detail: "订单尚未记录签收时间。" };
  }
  if (!isValidOrderDateTime(deliveredAt)) {
    return { ok: false, detail: "签收时间格式不正确。" };
  }
  if (isDeliveryBeforeShipment({ shippedAt, deliveredAt })) {
    return { ok: false, detail: "签收时间不能早于发货时间。" };
  }
  return { ok: true, detail: `已记录签收时间 ${deliveredAt}。` };
}

function buildDeliveryPackageDetail(decision: { ok?: boolean; missing?: string[] }) {
  if (decision.ok) return "已保留客户选图和商品组合快照，可作为交付资料包。";
  const missing = (decision.missing || []).map(deliveryPackageMissingLabel).join("、") || "交付资料";
  return `缺少${missing}，不能视为已完成交付。`;
}

function deliveryPackageMissingLabel(field: string) {
  const labels: Record<string, string> = {
    selectedImageId: "客户确认效果图",
    selectedImageSnapshot: "客户确认效果图快照",
    bundleSnapshot: "商品组合快照",
  };
  return labels[field] || field;
}

function buildOrderSendState(order: OrderDraft) {
  return {
    confirmation: taskHasQueueRecord(order.confirmationSendTask),
    production: taskHasQueueRecord(order.productionFollowupSendTask),
    delivery: taskHasQueueRecord(order.deliveryFollowupSendTask),
  };
}

function taskHasQueueRecord(task?: SendTask | null) {
  return ["queued", "sending", "pending_ack", "sent"].includes(String(task?.status || ""));
}

function taskHasCustomerDeliveryEvidence(task?: SendTask | null) {
  if (!task) return false;
  return task.guardSnapshot?.manualDeliveryResolution?.resolution === "confirmed_sent"
    || task.guardSnapshot?.wechatWorkDeliveryState === "confirmed_sent";
}

function collectOrderSendTasks(order: OrderDraft) {
  const candidates: Array<{ label: string; task?: SendTask | null }> = [
    { label: "订单确认", task: order.confirmationSendTask },
    { label: "生产跟进", task: order.productionFollowupSendTask },
    { label: "发货跟进", task: order.deliveryFollowupSendTask },
    ...(order.followupSendTasks || []).map((task) => ({ label: "订单跟进", task })),
  ];
  const seen = new Set<string>();
  return candidates.flatMap(({ label, task }) => {
    if (!task?.id || seen.has(task.id)) return [];
    seen.add(task.id);
    return [{ label, task }];
  });
}

function PaymentEventRow({ event }: { event: PaymentEvent }) {
  return (
    <div className={styles.auditRow}>
      <strong>{paymentStatusLabel(event.paymentStatus)} / {paymentAmount(event.amountCny)}</strong>
      <span>{textOrDash(event.method)} / 凭证 {textOrDash(event.proofReference)} / {textOrDash(event.createdAt)}</span>
    </div>
  );
}

function SendTaskRow({ label, task }: { label: string; task: SendTask }) {
  const responsibility = sendTaskResponsibility(task);
  return (
    <div className={styles.auditRow}>
      <div>
        <strong>{label} / {sendTaskStatusLabel(task.status)}</strong>
        <span>{task.id} / {task.sentAt ? `发送时间 ${task.sentAt}` : `创建时间 ${task.createdAt}`}{task.errorMessage ? ` / ${task.errorMessage}` : ""}</span>
      </div>
      {responsibility ? <Link className={styles.button} href={responsibility.href} data-action-id={`sales-order-send-task-${responsibility.kind}`}>{responsibility.label}</Link> : null}
    </div>
  );
}

function paymentStatusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    unpaid: "未付款",
    deposit_paid: "已付定金",
    paid: "已付全款",
  };
  return labels[String(value || "")] || textOrDash(value);
}

function sendTaskStatusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    queued: "排队中",
    sending: "发送中",
    blocked: "已阻断",
    pending_ack: "等待回执",
    sent: "渠道已接受",
    failed: "发送失败",
    cancelled: "已取消",
  };
  return labels[String(value || "")] || textOrDash(value);
}

function paymentAmount(value?: number | string | null) {
  const amount = typeof value === "string" ? Number(value) : value;
  return typeof amount === "number" && Number.isFinite(amount) ? money(amount) : "金额未记录";
}

function sumVerifiedPaymentEvents(events: PaymentEvent[]) {
  return Math.round(
    events
      .filter((event) => event.paymentStatus === "deposit_paid" || event.paymentStatus === "paid")
      .reduce((sum, event) => sum + (normalizePaymentAmount(event.amountCny) || 0), 0) * 100,
  ) / 100;
}

function normalizePaymentAmount(value?: number | string | null) {
  if (value === undefined || value === null || value === "") return null;
  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return Math.round(amount * 100) / 100;
}
