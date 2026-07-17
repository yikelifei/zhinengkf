"use client";

import { type IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { formatReviewDate, formatReviewMoney, useReviewCenter } from "./review-page-shared";

export type ReviewInboxPageProps = {
  identityFilters?: IdentityFilters;
};

export function ReviewInboxPage({ identityFilters }: ReviewInboxPageProps) {
  const { center, busy, error, refresh } = useReviewCenter(identityFilters);
  const total = center ? center.designJobs.length + center.quoteDrafts.length + center.orderDrafts.length : 0;

  return (
    <section className={styles.page} aria-labelledby="review-inbox-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Reviews</span>
          <h1 id="review-inbox-title">审核收件箱</h1>
          <p className={styles.description}>只汇总各审核队列及最新对象；具体决策必须进入对应责任页。</p>
        </div>
        <button
          type="button"
          className={styles.button}
          data-action-id="review-inbox-refresh"
          aria-label="刷新审核收件箱"
          onClick={() => void refresh()}
          disabled={busy}
        >
          刷新收件箱
        </button>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}

      <section className={styles.summaryGrid} aria-label="审核队列摘要">
        <div className={styles.summaryCard}><span>全部待办</span><strong>{center ? total : "—"}</strong></div>
        <div className={styles.summaryCard}><span>设计审核</span><strong>{center?.designJobs.length ?? "—"}</strong></div>
        <div className={styles.summaryCard}><span>报价审核</span><strong>{center?.quoteDrafts.length ?? "—"}</strong></div>
        <div className={styles.summaryCard}><span>订单审核</span><strong>{center?.orderDrafts.length ?? "—"}</strong></div>
      </section>

      <section className={styles.grid} aria-label="审核队列预览">
        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>设计队列</h2><p>图像、修改与发送前审核。</p></div></header>
          <div className={styles.panelBody}>
            {center?.designJobs.length ? center.designJobs.slice(0, 5).map((job) => (
              <div className={styles.record} key={job.id}>
                <div className={styles.recordHeader}><div><h3>{job.customer?.name || job.requestId}</h3><p>{job.scene || "未标注场景"}</p></div><span className={styles.badge}>{job.status}</span></div>
                <div className={styles.recordMeta}><span>{job.outputCount} 张结果</span><span>{formatReviewDate(job.updatedAt)}</span></div>
              </div>
            )) : <div className={styles.empty}>当前没有设计审核待办。</div>}
          </div>
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>报价队列</h2><p>金额、利润与跟进决策。</p></div></header>
          <div className={styles.panelBody}>
            {center?.quoteDrafts.length ? center.quoteDrafts.slice(0, 5).map((quote) => (
              <div className={styles.record} key={quote.id}>
                <div className={styles.recordHeader}><div><h3>{quote.customer?.name || quote.id}</h3><p>{formatReviewMoney(quote.totalPrice)} · {quote.quantity} 件</p></div><span className={styles.badge}>{quote.status}</span></div>
                <div className={styles.recordMeta}><span>利润 {formatReviewMoney(quote.profit)}</span><span>{formatReviewDate(quote.updatedAt)}</span></div>
              </div>
            )) : <div className={styles.empty}>当前没有报价审核待办。</div>}
          </div>
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>订单队列</h2><p>确认消息与后续跟进审核。</p></div></header>
          <div className={styles.panelBody}>
            {center?.orderDrafts.length ? center.orderDrafts.slice(0, 5).map((order) => (
              <div className={styles.record} key={order.id}>
                <div className={styles.recordHeader}><div><h3>{order.customer?.name || order.id}</h3><p>{formatReviewMoney(order.totalPrice)} · {order.quantity} 件</p></div><span className={styles.badge}>{order.status}</span></div>
                <div className={styles.recordMeta}><span>支付 {order.paymentStatus}</span><span>{formatReviewDate(order.updatedAt)}</span></div>
              </div>
            )) : <div className={styles.empty}>当前没有订单审核待办。</div>}
          </div>
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>审核记录</h2><p>最近服务端审计结果。</p></div></header>
          <div className={styles.panelBody}>
            {center?.logs.length ? center.logs.slice(0, 5).map((log) => (
              <div className={styles.record} key={log.id}>
                <div className={styles.recordHeader}><div><h3>{log.decision}</h3><p>{log.reviewer} · {log.targetType}</p></div><span className={styles.badge}>{log.afterStatus || "已记录"}</span></div>
                <div className={styles.recordMeta}><span>{formatReviewDate(log.createdAt)}</span></div>
              </div>
            )) : <div className={styles.empty}>当前没有审核记录。</div>}
          </div>
        </article>
      </section>
    </section>
  );
}
