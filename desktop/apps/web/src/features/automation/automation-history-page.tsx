"use client";

import type { IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { formatAutomationDateTime, formatAutomationTrigger, useAutomationOperations } from "./use-automation-operations";

export function AutomationHistoryPage({ identityFilters }: { identityFilters?: IdentityFilters }) {
  const automation = useAutomationOperations({ identityFilters });

  return (
    <section className={styles.page} aria-labelledby="automation-history-title" aria-busy={automation.busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <h1 id="automation-history-title">运行历史</h1>
          <p className={styles.description}>只查看服务端真实运行记录；启动、停止和人工执行在控制页完成。</p>
        </div>
        <button type="button" className={styles.button} data-action-id="automation-history-refresh" onClick={() => void automation.refresh()} disabled={automation.busy}>刷新记录</button>
      </header>

      {automation.error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{automation.error}</div> : null}

      {automation.recentRuns.length ? (
        <div className={styles.recordList} aria-label="最近自动化运行记录">
          {automation.recentRuns.map((run, index) => (
            <article className={styles.record} key={`${run.startedAt}-${run.trigger}-${index}`}>
              <div className={styles.recordHeader}>
                <div><h2>{formatAutomationTrigger(run.trigger)} · {formatAutomationDateTime(run.startedAt)}</h2><p>{run.reason || `${run.steps?.length || 0} 个步骤`}</p></div>
                <span className={`${styles.badge} ${run.errors.length ? styles.toneError : run.skipped ? styles.toneWarning : styles.toneOk}`}>{run.errors.length ? "失败" : run.skipped ? "已跳过" : "完成"}</span>
              </div>
              <div className={styles.recordMeta}>
                <span>耗时 {typeof run.durationMs === "number" ? `${run.durationMs} ms` : "未知"}</span>
                <span>推进 {run.stageSummary?.progressed ?? "—"}</span>
                <span>阻断 {run.stageSummary?.blocked ?? "—"}</span>
                <span>错误 {run.errors.length}</span>
              </div>
            </article>
          ))}
        </div>
      ) : <div className={styles.empty}>服务端尚未返回运行记录。</div>}
    </section>
  );
}
