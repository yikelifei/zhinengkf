"use client";

import { type IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { formatReviewDate, useReviewCenter } from "./review-page-shared";

export type ReviewLogsPageProps = {
  identityFilters?: IdentityFilters;
};

export function ReviewLogsPage({ identityFilters }: ReviewLogsPageProps) {
  const { center, loaded, busy, error, refresh } = useReviewCenter(identityFilters);

  return (
    <section className={styles.page} aria-labelledby="review-logs-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Reviews</span>
          <h1 id="review-logs-title">审核记录</h1>
          <p className={styles.description}>只读展示服务端审计记录，不在浏览记录时提供业务决策按钮。</p>
        </div>
        <button
          type="button"
          className={styles.button}
          data-action-id="review-logs-refresh"
          aria-label="刷新审核记录"
          onClick={() => void refresh()}
          disabled={busy}
        >
          刷新记录
        </button>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}

      <section className={styles.panel} aria-labelledby="review-log-list-title">
        <header className={styles.panelHeader}><div><h2 id="review-log-list-title">服务端审计日志</h2><p>{loaded ? `共 ${center?.logs.length ?? 0} 条。` : "审计日志尚未成功读取。"}</p></div></header>
        <div className={styles.panelBody}>
          {center?.logs.length ? (
            <div className={styles.recordList}>
              {center.logs.map((log) => (
                <article className={styles.record} key={log.id}>
                  <div className={styles.recordHeader}>
                    <div><h3>{log.decision}</h3><p>{log.note || "未填写补充说明。"}</p></div>
                    <span className={styles.badge}>{log.afterStatus || "已记录"}</span>
                  </div>
                  <div className={styles.recordMeta}>
                    <span>操作人 {log.reviewer}</span>
                    <span>{log.targetType} / {log.targetId}</span>
                    <span>{log.beforeStatus || "—"} → {log.afterStatus || "—"}</span>
                    <span>{formatReviewDate(log.createdAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className={styles.empty}>{loaded
            ? "读取成功，当前没有审核记录。"
            : "审核记录尚未成功读取，当前状态未确认。"}</div>}
        </div>
      </section>
    </section>
  );
}
