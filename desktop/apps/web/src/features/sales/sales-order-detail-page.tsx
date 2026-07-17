"use client";

import { BellRing, Edit3, RefreshCw, Truck } from "lucide-react";
import Link from "next/link";
import { identityExpectation } from "../../lib/api";
import {
  hasCompleteIdentity,
  identityLabel,
  money,
  SalesEmpty,
  SalesHeader,
  SalesNotice,
} from "./sales-ui";
import styles from "./sales-pages.module.css";
import { useSalesOrders } from "./use-sales-records";

export function SalesOrderDetailPage({ orderId }: { orderId: string }) {
  const { selected, loading, error, ambiguousEmpty, refresh } = useSalesOrders(orderId);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = hasCompleteIdentity(expected);

  return (
    <section className={styles.page} aria-label="订单详情">
      <SalesHeader
        eyebrow="销售 · 订单详情"
        title="核对订单"
        detail="本页只读展示一条订单；编辑与三种客户消息分别进入独立页面。"
        actions={(
          <button type="button" data-action-id="sales-order-detail-refresh" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={16} aria-hidden="true" />刷新详情
          </button>
        )}
      />
      {error ? <SalesNotice tone="danger">{error}</SalesNotice> : null}
      {ambiguousEmpty ? <SalesNotice tone="warning">空结果无法证明订单不存在；请检查服务状态后重试。</SalesNotice> : null}
      {loading ? <SalesEmpty title="正在读取订单" detail={`订单 ${orderId}`} busy /> : selected ? (
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div><h2>{selected.customer?.name || selected.customerId}</h2><p>订单 {selected.id}</p></div>
            <span className={styles.statusPill}>{selected.status}</span>
          </div>
          {identityReady ? (
            <SalesNotice tone="success">身份已绑定：{identityLabel(expected)}。</SalesNotice>
          ) : (
            <SalesNotice tone="danger">身份不完整：{identityLabel(expected)}。所有写入和消息操作均会禁用。</SalesNotice>
          )}
          <dl className={styles.factGrid}>
            <div><dt>总价</dt><dd>{money(selected.totalPrice)}</dd></div>
            <div><dt>数量</dt><dd>{selected.quantity}</dd></div>
            <div><dt>付款状态</dt><dd>{selected.paymentStatus}</dd></div>
            <div><dt>负责人</dt><dd>{selected.owner || "未分配"}</dd></div>
            <div><dt>报价草稿</dt><dd>{selected.quoteDraftId}</dd></div>
            <div><dt>设计任务</dt><dd>{selected.designJobId}</dd></div>
          </dl>
          {selected.customerNotes ? <div className={styles.notesBlock}><strong>客户备注</strong><p>{selected.customerNotes}</p></div> : null}
          <div className={styles.actionChoiceGrid} aria-label="订单后续操作">
            <Link className={styles.actionChoice} href={`/sales/orders/${encodeURIComponent(selected.id)}/edit`} data-action-id="sales-order-open-edit">
              <Edit3 size={20} aria-hidden="true" /><strong>编辑订单字段</strong><span>只保存状态、付款、负责人和备注。</span>
            </Link>
            <Link className={styles.actionChoice} href={`/sales/orders/${encodeURIComponent(selected.id)}/messages/confirmation`} data-action-id="sales-order-open-confirmation">
              <BellRing size={20} aria-hidden="true" /><strong>发送订单确认</strong><span>只把订单确认加入发送队列。</span>
            </Link>
            <Link className={styles.actionChoice} href={`/sales/orders/${encodeURIComponent(selected.id)}/messages/production`} data-action-id="sales-order-open-production">
              <BellRing size={20} aria-hidden="true" /><strong>发送生产跟进</strong><span>只把生产进度跟进加入队列。</span>
            </Link>
            <Link className={styles.actionChoice} href={`/sales/orders/${encodeURIComponent(selected.id)}/messages/delivery`} data-action-id="sales-order-open-delivery">
              <Truck size={20} aria-hidden="true" /><strong>发送发货跟进</strong><span>只把发货进度跟进加入队列。</span>
            </Link>
          </div>
          <Link className={styles.backLink} href="/sales/orders" data-action-id="sales-order-back-list">返回订单列表</Link>
        </article>
      ) : <SalesEmpty title="没有找到订单" detail="返回列表重新选择，避免对错误记录执行操作。" />}
    </section>
  );
}
