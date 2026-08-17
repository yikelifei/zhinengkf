"use client";

import { BellRing, Edit3, LifeBuoy, RefreshCw, Truck } from "lucide-react";
import Link from "next/link";
import { identityExpectation, type IdentityFilters } from "../../lib/api";
import { DesignCommerceJourney } from "../design/design-commerce-journey";
import { SalesOrderDeliveryAudit } from "./sales-order-delivery-audit";
import { SalesDesignVisualSummary } from "./sales-design-visual-summary";
import {
  fulfillmentStatusLabel,
  hasCompleteIdentity,
  identityLabel,
  money,
  SalesEmpty,
  SalesHeader,
  SalesNotice,
  textOrDash,
} from "./sales-ui";
import styles from "./sales-pages.module.css";
import { orderIdentityHref, orderJourneyRecommendation, orderStatusLabel } from "./sales-commerce-state";
import { useSalesOrders } from "./use-sales-records";

export function SalesOrderDetailPage({ orderId, initialIdentityFilters = {} }: { orderId: string; initialIdentityFilters?: IdentityFilters }) {
  const { selected, loading, loaded, error, refresh } = useSalesOrders(orderId, initialIdentityFilters);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = hasCompleteIdentity(expected);
  const orderStatus = String(selected?.status || "").toLowerCase();
  const canEdit = Boolean(selected && !["fulfilled", "cancelled"].includes(orderStatus));
  const canSendConfirmation = orderStatus === "draft";
  const canSendProduction = ["confirmed", "processing"].includes(orderStatus);
  const canSendDelivery = orderStatus === "processing";
  const canOpenAfterSales = Boolean(selected && (["confirmed", "processing", "fulfilled"].includes(orderStatus) || ["deposit_paid", "paid"].includes(selected.paymentStatus)));

  return (
    <section className={styles.page} aria-label="订单详情">
      <SalesHeader
        eyebrow="销售 / 订单详情"
        title="核对订单"
        detail="本页只读展示一条订单；编辑与客户消息分别进入独立页面。"
        actions={(
          <button type="button" data-action-id="sales-order-detail-refresh" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={16} aria-hidden="true" />刷新详情
          </button>
        )}
      />
      {error ? <SalesNotice tone="danger">{error}</SalesNotice> : null}
      {loading && !loaded ? <SalesEmpty title="正在读取订单" detail={`订单 ${orderId}`} busy /> : selected ? (
        <>
        <DesignCommerceJourney
          active="order"
          title="订单履约"
          recommendation={orderJourneyRecommendation(selected)}
          blockedReason={!identityReady ? "订单缺少企业微信账号、客户或会话身份" : selected.status === "cancelled" ? "订单已取消" : undefined}
        />
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div><h2>{selected.customer?.name || selected.customerId}</h2><p>订单 {selected.id}</p></div>
            <span className={styles.statusPill}>{orderStatusLabel(selected.status)}</span>
          </div>
          {identityReady ? (
            <SalesNotice tone="success">身份已绑定：{identityLabel(expected)}。</SalesNotice>
          ) : (
            <SalesNotice tone="danger">身份不完整：{identityLabel(expected)}。所有写入和消息操作均会禁用。</SalesNotice>
          )}
          <SalesDesignVisualSummary record={selected} />
          <dl className={styles.factGrid}>
            <div><dt>总价</dt><dd>{money(selected.totalPrice)}</dd></div>
            <div><dt>数量</dt><dd>{selected.quantity}</dd></div>
            <div><dt>付款状态</dt><dd>{selected.paymentStatus}</dd></div>
            <div><dt>负责人</dt><dd>{selected.owner || "未分配"}</dd></div>
            <div><dt>报价草稿</dt><dd>{selected.quoteDraftId}</dd></div>
            <div><dt>设计任务</dt><dd>{selected.designJobId}</dd></div>
            <div><dt>生产状态</dt><dd>{fulfillmentStatusLabel(selected.productionStatus)}</dd></div>
            <div><dt>预计完成</dt><dd>{textOrDash(selected.productionDueAt)}</dd></div>
            <div><dt>物流公司</dt><dd>{textOrDash(selected.carrier)}</dd></div>
            <div><dt>物流单号</dt><dd>{textOrDash(selected.trackingNo)}</dd></div>
            <div><dt>发货时间</dt><dd>{textOrDash(selected.shippedAt)}</dd></div>
            <div><dt>签收时间</dt><dd>{textOrDash(selected.deliveredAt)}</dd></div>
          </dl>
          {selected.customerNotes ? <div className={styles.notesBlock}><strong>客户备注</strong><p>{selected.customerNotes}</p></div> : null}
          <SalesOrderDeliveryAudit order={selected} identityReady={identityReady} />
          {orderStatus === "cancelled" ? <SalesNotice tone="warning">订单已经取消，编辑、确认、生产和发货消息入口均已关闭。</SalesNotice> : null}
          <div className={styles.actionChoiceGrid} aria-label="订单后续操作">
            {canEdit ? <Link className={styles.actionChoice} href={orderIdentityHref(`/sales/orders/${encodeURIComponent(selected.id)}/edit`, selected)} data-action-id="sales-order-open-edit">
              <Edit3 size={20} aria-hidden="true" /><strong>编辑订单字段</strong><span>只保存状态、付款、负责人和备注。</span>
            </Link> : null}
            {canSendConfirmation ? <Link className={styles.actionChoice} href={orderIdentityHref(`/sales/orders/${encodeURIComponent(selected.id)}/messages/confirmation`, selected)} data-action-id="sales-order-open-confirmation">
              <BellRing size={20} aria-hidden="true" /><strong>发送订单确认</strong><span>只把订单确认加入发送队列。</span>
            </Link> : null}
            {canSendProduction ? <Link className={styles.actionChoice} href={orderIdentityHref(`/sales/orders/${encodeURIComponent(selected.id)}/messages/production`, selected)} data-action-id="sales-order-open-production">
              <BellRing size={20} aria-hidden="true" /><strong>发送生产跟进</strong><span>只把生产进度跟进加入队列。</span>
            </Link> : null}
            {canSendDelivery ? <Link className={styles.actionChoice} href={orderIdentityHref(`/sales/orders/${encodeURIComponent(selected.id)}/messages/delivery`, selected)} data-action-id="sales-order-open-delivery">
              <Truck size={20} aria-hidden="true" /><strong>发送发货跟进</strong><span>只把发货进度跟进加入队列。</span>
            </Link> : null}
            {canOpenAfterSales ? <Link className={styles.actionChoice} href={orderIdentityHref(`/sales/orders/${encodeURIComponent(selected.id)}/after-sales`, selected)} data-action-id="sales-order-open-after-sales">
              <LifeBuoy size={20} aria-hidden="true" /><strong>售后/退款/补发</strong><span>创建售后 case，并记录退款流水或补发处理证据。</span>
            </Link> : null}
          </div>
          <Link className={styles.backLink} href={orderIdentityHref("/sales/orders", selected)} data-action-id="sales-order-back-list">返回当前客户订单</Link>
        </article>
        </>
      ) : <SalesEmpty title={loaded ? "没有找到订单" : "订单状态未确认"} detail={loaded ? "读取成功，请返回列表重新选择。" : "订单列表尚未成功读取，已阻止后续操作。"} />}
    </section>
  );
}
