"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAutomationReadiness,
  getAutomationStatus,
  type AutomationReadiness,
  type AutomationRun,
  type AutomationStatus,
} from "../../lib/api";
import styles from "../governance-pages.module.css";

type AutomationIssue = {
  id: string;
  title: string;
  detail: string;
  action: string;
  tone: "warning" | "error";
  source: string;
};

export function AutomationIssuesPage() {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [readiness, setReadiness] = useState<AutomationReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    const [statusResult, readinessResult] = await Promise.allSettled([
      getAutomationStatus(),
      getAutomationReadiness(),
    ]);
    const nextStatus = statusResult.status === "fulfilled" ? statusResult.value : null;
    const nextReadiness = readinessResult.status === "fulfilled" ? readinessResult.value : null;
    setStatus(nextStatus);
    setReadiness(nextReadiness);
    if (!nextStatus || !nextReadiness) {
      setError("无法确认完整自动化状态，问题中心已停止给出可运行结论。");
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const issues = useMemo(() => collectIssues(readiness, status), [readiness, status]);

  return (
    <section className={styles.page} aria-labelledby="automation-issues-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Automation</span>
          <h1 id="automation-issues-title">自动化问题</h1>
          <p className={styles.description}>这里只归集阻断、警告和最近运行错误；修复后回到运行页重新确认。</p>
        </div>
        <button
          type="button"
          className={styles.button}
          data-action-id="automation-issues-refresh"
          aria-label="刷新自动化问题"
          onClick={() => void refresh()}
          disabled={busy}
        >
          刷新问题
        </button>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}

      <section className={styles.summaryGrid} aria-label="自动化问题摘要">
        <div className={styles.summaryCard}><span>阻断</span><strong>{readiness?.blockers.length ?? "—"}</strong></div>
        <div className={styles.summaryCard}><span>警告</span><strong>{readiness?.warnings.length ?? "—"}</strong></div>
        <div className={styles.summaryCard}><span>运行错误</span><strong>{countRunErrors(status)}</strong></div>
        <div className={styles.summaryCard}><span>结论</span><strong>{readiness?.ready ? "无阻断" : readiness ? "需处理" : "未知"}</strong></div>
      </section>

      <section className={styles.panel} aria-labelledby="automation-issue-list-title">
        <header className={styles.panelHeader}>
          <div><h2 id="automation-issue-list-title">待处理项</h2><p>每条问题保留来源与服务端建议，不在前端虚构修复结果。</p></div>
        </header>
        <div className={styles.panelBody}>
          {issues.length ? (
            <div className={styles.recordList}>
              {issues.map((issue) => (
                <article className={styles.record} key={issue.id}>
                  <div className={styles.recordHeader}>
                    <div><h3>{issue.title}</h3><p>{issue.detail}</p></div>
                    <span className={`${styles.badge} ${issue.tone === "error" ? styles.toneError : styles.toneWarning}`}>
                      {issue.tone === "error" ? "阻断" : "警告"}
                    </span>
                  </div>
                  <div className={styles.recordMeta}><span>来源：{issue.source}</span><span>下一步：{issue.action}</span></div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>{readiness?.ready ? "当前没有服务端报告的自动化问题。" : "尚未取得可核验的问题数据。"}</div>
          )}
        </div>
      </section>
    </section>
  );
}

function collectIssues(readiness: AutomationReadiness | null, status: AutomationStatus | null): AutomationIssue[] {
  const readinessIssues = readiness
    ? [...readiness.blockers, ...readiness.warnings].map((check) => ({
        id: `check-${check.key}-${check.severity}`,
        title: check.label,
        detail: check.detail,
        action: check.action || "按服务端检查说明处理后刷新",
        tone: check.severity === "error" ? "error" as const : "warning" as const,
        source: "就绪检查",
      }))
    : undefined;
  const runIssues = status?.recentRuns?.flatMap((run, runIndex) => collectRunIssues(run, runIndex));
  return [...(readinessIssues ?? []), ...(runIssues ?? [])];
}

function collectRunIssues(run: AutomationRun, runIndex: number): AutomationIssue[] {
  const errors: AutomationIssue[] = run.errors.map((entry, index) => ({
    id: `run-${run.startedAt}-${runIndex}-${entry.step}-${index}`,
    title: `${entry.step} 执行失败`,
    detail: entry.errorMessage,
    action: "核对对应服务与数据后，再由运行页人工确认重试",
    tone: "error" as const,
    source: formatRunSource(run),
  }));
  if (run.skipped && !errors.length) {
    errors.push({
      id: `run-${run.startedAt}-${runIndex}-skipped`,
      title: "运行被服务端跳过",
      detail: run.reason || "服务端未提供跳过原因",
      action: "检查运行状态与并发任务",
      tone: "warning",
      source: formatRunSource(run),
    });
  }
  return errors;
}

function formatRunSource(run: AutomationRun) {
  return `${run.trigger} · ${run.startedAt}`;
}

function countRunErrors(status: AutomationStatus | null) {
  if (!status) return "—";
  return (status.recentRuns ?? (status.lastRun ? [status.lastRun] : undefined))?.reduce((sum, run) => sum + run.errors.length, 0) ?? 0;
}
