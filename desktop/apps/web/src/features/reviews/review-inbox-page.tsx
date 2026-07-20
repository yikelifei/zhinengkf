"use client";

import Link from "next/link";
import { type IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { useReviewCenter } from "./review-page-shared";

export type ReviewInboxPageProps = {
  identityFilters?: IdentityFilters;
};

export function ReviewInboxPage({ identityFilters }: ReviewInboxPageProps) {
  const { center, loaded, busy, error, refresh } = useReviewCenter(identityFilters);
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
      {!busy && !loaded ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">审核收件箱尚未成功读取，队列数量保持未确认。</div> : null}

      <section className={styles.summaryGrid} aria-label="审核队列摘要">
        <div className={styles.summaryCard}><span>全部待办</span><strong>{center ? total : "—"}</strong></div>
        <div className={styles.summaryCard}><span>设计审核</span><strong>{center?.designJobs.length ?? "—"}</strong></div>
        <div className={styles.summaryCard}><span>报价审核</span><strong>{center?.quoteDrafts.length ?? "—"}</strong></div>
        <div className={styles.summaryCard}><span>订单审核</span><strong>{center?.orderDrafts.length ?? "—"}</strong></div>
      </section>

      <section className={styles.recordList} aria-label="审核责任页入口">
        <ReviewQueueLink href="/reviews/design" title="设计审核" count={center?.designJobs.length} detail="检查图稿、修改要求与发送资格。" />
        <ReviewQueueLink href="/reviews/quotes" title="报价审核" count={center?.quoteDrafts.length} detail="检查金额、利润与跟进判断。" />
        <ReviewQueueLink href="/reviews/orders" title="订单审核" count={center?.orderDrafts.length} detail="检查确认消息与生产、交付跟进。" />
        <ReviewQueueLink href="/reviews/logs" title="审核记录" count={center?.logs.length} detail="只读查看服务端审核轨迹。" />
      </section>
    </section>
  );
}

function ReviewQueueLink({ href, title, count, detail }: { href: string; title: string; count?: number; detail: string }) {
  return (
    <article className={styles.record}>
      <div className={styles.recordHeader}>
        <div><h2>{title}</h2><p>{detail}</p></div>
        <strong className={styles.queueCount}>{count ?? "—"}</strong>
      </div>
      <Link className={styles.primaryButton} href={href}>进入{title}</Link>
    </article>
  );
}
