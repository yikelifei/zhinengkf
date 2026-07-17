"use client";

import Link from "next/link";
import type { IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { formatReviewDate, formatReviewMoney, useReviewCenter } from "./review-page-shared";

type QueueKind = "design" | "quotes" | "orders";
type ReviewQueuePageProps = { identityFilters?: IdentityFilters };
type QueueItem = { id: string; title: string; detail: string; status: string; updatedAt?: string | null };

const queueCopy = {
  design: {
    title: "设计审核队列",
    description: "这里只选择待审核设计；批准、改图或驳回必须进入单个任务决策页。",
    empty: "当前没有设计审核待办。",
  },
  quotes: {
    title: "报价审核队列",
    description: "这里只选择待审核报价；金额、利润和跟进决策在单个报价页完成。",
    empty: "当前没有报价审核待办。",
  },
  orders: {
    title: "订单审核队列",
    description: "这里只选择待审核订单；确认消息和跟进决策在单个订单页完成。",
    empty: "当前没有订单审核待办。",
  },
} as const;

export function ReviewDesignQueuePage(props: ReviewQueuePageProps) {
  return <ReviewQueuePage {...props} kind="design" />;
}

export function ReviewQuotesQueuePage(props: ReviewQueuePageProps) {
  return <ReviewQueuePage {...props} kind="quotes" />;
}

export function ReviewOrdersQueuePage(props: ReviewQueuePageProps) {
  return <ReviewQueuePage {...props} kind="orders" />;
}

function ReviewQueuePage({ identityFilters, kind }: ReviewQueuePageProps & { kind: QueueKind }) {
  const { center, busy, error, refresh } = useReviewCenter(identityFilters);
  const items = toQueueItems(kind, center);
  const copy = queueCopy[kind];
  const titleId = "review-" + kind + "-queue-title";

  return (
    <section className={styles.page} aria-labelledby={titleId} aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Reviews</span>
          <h1 id={titleId}>{copy.title}</h1>
          <p className={styles.description}>{copy.description}</p>
        </div>
        <button
          className={styles.button}
          type="button"
          data-action-id={"review-" + kind + "-queue-refresh"}
          aria-label={"刷新" + copy.title}
          onClick={() => void refresh()}
          disabled={busy}
        >
          刷新队列
        </button>
      </header>

      {error ? <div className={styles.notice + " " + styles.noticeError} role="alert">{error}</div> : null}
      <section className={styles.panel} aria-label={copy.title}>
        <header className={styles.panelHeader}><div><h2>待选择对象</h2><p>共 {items.length} 项；列表不提供审核写操作。</p></div></header>
        <div className={styles.panelBody}>
          {items.length ? (
            <div className={styles.recordList}>
              {items.map((item) => (
                <article className={styles.record} key={item.id}>
                  <div className={styles.recordHeader}>
                    <div><h3>{item.title}</h3><p>{item.detail}</p></div>
                    <span className={styles.badge}>{item.status}</span>
                  </div>
                  <div className={styles.recordMeta}><span>{formatReviewDate(item.updatedAt)}</span></div>
                  <Link className={styles.primaryButton} href={"/reviews/" + kind + "/" + encodeURIComponent(item.id)}>
                    打开审核决策
                  </Link>
                </article>
              ))}
            </div>
          ) : <div className={styles.empty}>{copy.empty}</div>}
        </div>
      </section>
    </section>
  );
}

function toQueueItems(kind: QueueKind, center: ReturnType<typeof useReviewCenter>["center"]): QueueItem[] {
  if (!center) return [];
  if (kind === "design") {
    return center.designJobs.map((job) => ({
      id: job.id,
      title: job.customer?.name || job.requestId,
      detail: (job.scene || "未标注场景") + " · " + job.outputCount + " 张结果",
      status: job.status,
      updatedAt: job.updatedAt,
    }));
  }
  if (kind === "quotes") {
    return center.quoteDrafts.map((quote) => ({
      id: quote.id,
      title: quote.customer?.name || quote.id,
      detail: formatReviewMoney(quote.totalPrice) + " · " + quote.quantity + " 件",
      status: quote.status,
      updatedAt: quote.updatedAt,
    }));
  }
  return center.orderDrafts.map((order) => ({
    id: order.id,
    title: order.customer?.name || order.id,
    detail: formatReviewMoney(order.totalPrice) + " · " + order.quantity + " 件",
    status: order.status,
    updatedAt: order.updatedAt,
  }));
}
