import { CheckCircle2, Factory, PackageCheck, Truck } from "lucide-react";
import type { OrderDraft } from "../../lib/api";
import type { OrderForm } from "./sales-order-edit-page";
import styles from "./sales-pages.module.css";
import { fulfillmentStatusLabel } from "./sales-ui";

export function SalesOrderFulfillmentWorkflow({
  order,
  form,
  busy,
  identityReady,
  onPatch,
}: {
  order: OrderDraft;
  form: OrderForm;
  busy: boolean;
  identityReady: boolean;
  onPatch: (patch: Partial<OrderForm>) => void;
}) {
  const verifiedPaymentAmount = sumVerifiedPaymentEvents(order.paymentEvents || []);
  const orderTotal = normalizePaymentAmount(order.totalPrice);
  const paymentReady = ["deposit_paid", "paid"].includes(String(order.paymentStatus || "")) && verifiedPaymentAmount > 0;
  const fullPaymentReady = order.paymentStatus === "paid" && orderTotal !== null && verifiedPaymentAmount + 0.0001 >= orderTotal;
  const selectedImageReady = Boolean(order.selectedImageId);
  const logisticsValidation = evaluateLogisticsInput(form);
  const canStartProduction = identityReady && paymentReady && selectedImageReady && ["confirmed", "processing"].includes(order.status);
  const canQualityCheck = canStartProduction && ["in_production", "quality_check", "ready_to_ship", "shipped", "delivered"].includes(form.productionStatus);
  const canReadyToShip = canStartProduction && ["quality_check", "ready_to_ship", "shipped", "delivered"].includes(form.productionStatus);
  const shipmentFactsReady = logisticsValidation.shipmentFactsReady;
  const shippedFactsReady = logisticsValidation.shippedFactsReady;
  const canRecordShipment = canStartProduction && shipmentFactsReady && ["ready_to_ship", "shipped", "delivered"].includes(form.productionStatus);
  const canCompleteDelivery = canStartProduction && fullPaymentReady && shippedFactsReady && logisticsValidation.deliveryTimeReady && ["shipped", "delivered"].includes(form.productionStatus);
  const checks = [
    { key: "identity", label: "身份绑定", ok: identityReady, detail: identityReady ? "企业微信账号、会话和客户已绑定" : "缺少企业微信账号、会话或客户绑定" },
    { key: "payment", label: "付款门槛", ok: paymentReady, detail: paymentReady ? `付款状态 ${order.paymentStatus}` : "需先从报价页核验定金或全款" },
    { key: "image", label: "客户选图", ok: selectedImageReady, detail: selectedImageReady ? order.selectedImageId || "已绑定" : "订单缺少客户确认的效果图" },
    { key: "shipment", label: "发货事实", ok: shippedFactsReady, detail: logisticsValidation.shipmentDetail },
    { key: "delivery", label: "完成条件", ok: canCompleteDelivery, detail: canCompleteDelivery ? "可记录签收并完成订单" : logisticsValidation.deliveryDetail },
  ];

  return (
    <section className={styles.fulfillmentWorkflow} aria-label="订单履约动作">
      <div className={styles.fulfillmentWorkflowHeader}>
        <div>
          <h3>履约动作</h3>
          <p>先选择业务动作，再核对下方字段并确认保存。</p>
        </div>
        <span className={styles.statusPill}>{fulfillmentStatusLabel(form.productionStatus)}</span>
      </div>
      <div className={styles.fulfillmentActionGrid}>
        <button type="button" className={styles.fulfillmentActionButton} data-action-id="sales-order-fulfillment-start-production" disabled={busy || !canStartProduction} onClick={() => onPatch({ status: "processing", productionStatus: "in_production" })}>
          <Factory size={18} aria-hidden="true" /><strong>生产中</strong><span>付款后开始排产</span>
        </button>
        <button type="button" className={styles.fulfillmentActionButton} data-action-id="sales-order-fulfillment-quality-check" disabled={busy || !canQualityCheck} onClick={() => onPatch({ status: "processing", productionStatus: "quality_check" })}>
          <CheckCircle2 size={18} aria-hidden="true" /><strong>质检中</strong><span>生产完成后核对</span>
        </button>
        <button type="button" className={styles.fulfillmentActionButton} data-action-id="sales-order-fulfillment-ready-to-ship" disabled={busy || !canReadyToShip} onClick={() => onPatch({ status: "processing", productionStatus: "ready_to_ship" })}>
          <PackageCheck size={18} aria-hidden="true" /><strong>待发货</strong><span>等待物流信息</span>
        </button>
        <button type="button" className={styles.fulfillmentActionButton} data-action-id="sales-order-fulfillment-ship" disabled={busy || !canRecordShipment} onClick={() => onPatch({ status: "processing", productionStatus: "shipped", shippedAt: form.shippedAt || nowLocalText() })}>
          <Truck size={18} aria-hidden="true" /><strong>已发货</strong><span>写入发货时间</span>
        </button>
        <button type="button" className={styles.fulfillmentActionButton} data-action-id="sales-order-fulfillment-deliver" disabled={busy || !canCompleteDelivery} onClick={() => onPatch({ status: "fulfilled", productionStatus: "delivered", deliveredAt: form.deliveredAt || nowLocalText() })}>
          <CheckCircle2 size={18} aria-hidden="true" /><strong>已签收</strong><span>完成订单</span>
        </button>
      </div>
      <div className={styles.fulfillmentCheckList} aria-label="履约保存条件">
        {checks.map((item) => (
          <div className={`${styles.fulfillmentCheck} ${item.ok ? styles.fulfillmentCheckReady : styles.fulfillmentCheckBlocked}`} key={item.key}>
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function nowLocalText() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function evaluateLogisticsInput(form: OrderForm) {
  const carrier = normalizeCarrier(form.carrier);
  const pickup = isPickupCarrier(carrier);
  const trackingNo = normalizeTrackingNo(form.trackingNo);
  const shippedAt = normalizeOrderDateTime(form.shippedAt);
  const deliveredAt = normalizeOrderDateTime(form.deliveredAt);
  const carrierReady = Boolean(carrier && isValidCarrier(carrier));
  const trackingReady = pickup || Boolean(trackingNo && isValidTrackingNo(trackingNo));
  const shippedAtReady = Boolean(shippedAt && isValidOrderDateTime(shippedAt));
  const deliveryTimeReady = !deliveredAt || (isValidOrderDateTime(deliveredAt) && !isDeliveryBeforeShipment(shippedAt, deliveredAt));
  const shipmentFactsReady = carrierReady && trackingReady;
  const shippedFactsReady = shipmentFactsReady && shippedAtReady;
  const shipmentDetail = shippedFactsReady
    ? [carrier, pickup ? "自提无单号" : trackingNo, shippedAt].filter(Boolean).join(" / ")
    : logisticsBlockerText({ carrierReady, trackingReady, shippedAtReady, pickup });
  const deliveryDetail = deliveryTimeReady
    ? "完成订单需要全款、可核验发货事实，以及签收时间。"
    : "签收时间格式不正确，或早于发货时间。";
  return {
    shipmentFactsReady,
    shippedFactsReady,
    deliveryTimeReady,
    shipmentDetail,
    deliveryDetail,
  };
}

function logisticsBlockerText({
  carrierReady,
  trackingReady,
  shippedAtReady,
  pickup,
}: {
  carrierReady: boolean;
  trackingReady: boolean;
  shippedAtReady: boolean;
  pickup: boolean;
}) {
  const missing = [];
  if (!carrierReady) missing.push("物流公司");
  if (!trackingReady && !pickup) missing.push("真实物流单号");
  if (!shippedAtReady) missing.push("发货时间");
  return `记录发货前需要 ${missing.join("、")}；自提可不填物流单号。`;
}

function normalizeCarrier(value: string) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function normalizeTrackingNo(value: string) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase().slice(0, 120);
}

function normalizeOrderDateTime(value: string) {
  const text = String(value || "").trim().slice(0, 64);
  const parsed = parseOrderDateTime(text);
  if (!parsed) return text;
  const pad = (part: number) => String(part).padStart(2, "0");
  const dateText = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  const timeText = `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  return parsed.dateOnly ? dateText : `${dateText} ${timeText}`;
}

function isPickupCarrier(value: string) {
  return ["自提", "门店自提", "到店自取", "同城自取", "pickup", "self pickup", "customer pickup"].includes(normalizeCarrier(value).toLowerCase());
}

function isValidCarrier(value: string) {
  const carrier = normalizeCarrier(value);
  return carrier.length >= 2 && /[\p{L}\p{Script=Han}]/u.test(carrier);
}

function isValidTrackingNo(value: string) {
  const trackingNo = normalizeTrackingNo(value);
  return trackingNo.length >= 6 && trackingNo.length <= 64 && /[0-9]/.test(trackingNo) && /^[A-Z0-9-]+$/.test(trackingNo);
}

function isValidOrderDateTime(value: string) {
  return Boolean(parseOrderDateTime(value));
}

function isDeliveryBeforeShipment(shippedAt: string, deliveredAt: string) {
  const shipped = parseOrderDateTime(shippedAt);
  const delivered = parseOrderDateTime(deliveredAt);
  return Boolean(shipped && delivered && delivered.getTime() < shipped.getTime());
}

function parseOrderDateTime(value: string): ({ dateOnly: boolean } & Date) | null {
  const text = String(value || "").trim().slice(0, 64);
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0) as ({ dateOnly: boolean } & Date);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  date.dateOnly = match[4] === undefined;
  return date;
}

function sumVerifiedPaymentEvents(events: OrderDraft["paymentEvents"] = []) {
  return Math.round(
    (events || [])
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
