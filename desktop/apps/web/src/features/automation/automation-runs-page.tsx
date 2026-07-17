"use client";

import Link from "next/link";
import type { IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { useAutomationOperations } from "./use-automation-operations";

export type AutomationRunsPageProps = {
  identityFilters?: IdentityFilters;
  allowGlobalRun?: boolean;
};

export function AutomationRunsPage({ identityFilters, allowGlobalRun = false }: AutomationRunsPageProps) {
  const automation = useAutomationOperations({ identityFilters, allowGlobalRun });

  return (
    <section className={styles.page} aria-labelledby="automation-runs-title" aria-busy={automation.busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <h1 id="automation-runs-title">自动化状态</h1>
          <p className={styles.description}>本页只回答自动化当前是否可运行；控制、历史和问题分别进入独立页面。</p>
        </div>
        <button type="button" className={styles.button} data-action-id="automation-runs-refresh" onClick={() => void automation.refresh()} disabled={automation.busy}>
          刷新状态
        </button>
      </header>

      {automation.error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{automation.error}</div> : null}

      <section className={styles.summaryGrid} aria-label="自动化状态摘要">
        <div className={styles.summaryCard}><span>周期状态</span><strong>{automation.status?.active ? "运行中" : automation.status ? "已停止" : "未知"}</strong></div>
        <div className={styles.summaryCard}><span>当前任务</span><strong>{automation.status?.running ? "执行中" : automation.status ? "空闲" : "未知"}</strong></div>
        <div className={styles.summaryCard}><span>累计运行</span><strong>{automation.status ? automation.status.runCount : "—"}</strong></div>
        <div className={styles.summaryCard}><span>就绪结论</span><strong>{automation.ready ? "可运行" : automation.readiness ? "已阻止" : "未知"}</strong></div>
      </section>

      <nav className={styles.taskList} aria-label="自动化责任页面">
        <Link className={styles.taskLink} href="/automation/control">
          <span><strong>运行控制</strong><small>启动、停止或人工执行一次，并在提交前再次确认。</small></span><b>进入</b>
        </Link>
        <Link className={styles.taskLink} href="/automation/history">
          <span><strong>运行历史</strong><small>查看服务端返回的运行结果、耗时、推进与阻断。</small></span><b>进入</b>
        </Link>
        <Link className={styles.taskLink} href="/automation/issues">
          <span><strong>阻断问题</strong><small>定位身份、商品、设计和发送链路中的待处理问题。</small></span><b>进入</b>
        </Link>
      </nav>
    </section>
  );
}
