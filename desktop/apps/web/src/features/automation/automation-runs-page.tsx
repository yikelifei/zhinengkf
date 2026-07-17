"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAutomationReadiness,
  getAutomationStatus,
  mergeAutomationStatusRun,
  runAutomationOnce,
  startAutomation,
  stopAutomation,
  type AutomationReadiness,
  type AutomationStatus,
  type IdentityFilters,
} from "../../lib/api";
import styles from "../governance-pages.module.css";

type PendingAutomationAction = "run" | "start" | "stop";

export type AutomationRunsPageProps = {
  identityFilters?: IdentityFilters;
  allowGlobalRun?: boolean;
};

const actionCopy: Record<PendingAutomationAction, { title: string; detail: string }> = {
  run: {
    title: "确认执行一次自动化",
    detail: "本次运行会按当前身份范围处理待办，并可能推进发送队列。请先核对就绪检查与身份范围。",
  },
  start: {
    title: "确认启动周期自动化",
    detail: "启动后服务端会按既定周期持续运行。只有全部阻断项已清除时才允许启动。",
  },
  stop: {
    title: "确认停止周期自动化",
    detail: "停止会关闭后续周期调度，不会撤销已经完成或正在由服务端提交的工作。",
  },
};

export function AutomationRunsPage({ identityFilters, allowGlobalRun = false }: AutomationRunsPageProps) {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [readiness, setReadiness] = useState<AutomationReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAutomationAction | null>(null);
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);

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
      setError("自动化服务未返回完整状态。当前操作已保持禁用，请检查服务端后再刷新。");
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const confirmAction = useCallback(async () => {
    if (!pendingConfirmation) return;
    if (
      pendingConfirmation === "run" &&
      !allowGlobalRun &&
      !stableIdentityFilters.wechatAccountId &&
      !stableIdentityFilters.conversationId &&
      !stableIdentityFilters.customerId
    ) {
      setError("单次运行没有绑定身份范围，且宿主未明确允许全局运行，操作已阻止。");
      setPendingConfirmation(null);
      return;
    }
    if (pendingConfirmation !== "stop" && readiness?.ready !== true) {
      setError("就绪检查未明确通过，自动化操作已阻止。");
      setPendingConfirmation(null);
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (pendingConfirmation !== "stop") {
        const latestReadiness = await getAutomationReadiness();
        setReadiness(latestReadiness);
        if (latestReadiness?.ready !== true) {
          throw new Error("确认时的最新就绪检查未通过，自动化操作没有提交。");
        }
      }
      if (pendingConfirmation === "run") {
        const result = await runAutomationOnce(stableIdentityFilters);
        setStatus((current) => mergeAutomationStatusRun(current, result, { incrementRunCount: true }));
        setNotice(result.skipped ? `本次运行未推进：${result.reason || "服务端跳过"}` : "本次自动化已由服务端执行完成。");
      } else if (pendingConfirmation === "start") {
        setStatus(await startAutomation());
        setNotice("周期自动化已启动。");
      } else {
        setStatus(await stopAutomation());
        setNotice("周期自动化已停止。");
      }
      setPendingConfirmation(null);
      const nextReadiness = await getAutomationReadiness();
      setReadiness(nextReadiness);
      if (!nextReadiness) setError("操作已提交，但最新就绪检查读取失败，请刷新确认服务端状态。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "自动化操作失败，服务端未确认执行结果。");
    } finally {
      setBusy(false);
    }
  }, [allowGlobalRun, pendingConfirmation, readiness, stableIdentityFilters]);

  const ready = readiness?.ready === true;
  const hasIdentityScope = Boolean(
    stableIdentityFilters.wechatAccountId || stableIdentityFilters.conversationId || stableIdentityFilters.customerId,
  );
  const runScopeAllowed = hasIdentityScope || allowGlobalRun;
  const recentRuns = status?.recentRuns ?? (status?.lastRun ? [status.lastRun] : undefined);

  return (
    <section className={styles.page} aria-labelledby="automation-runs-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Automation</span>
          <h1 id="automation-runs-title">自动化运行</h1>
          <p className={styles.description}>这里只负责查看运行状态，以及经人工确认后启动、停止或执行一次。</p>
        </div>
        <button
          type="button"
          className={styles.button}
          data-action-id="automation-runs-refresh"
          aria-label="刷新自动化运行状态"
          onClick={() => void refresh()}
          disabled={busy}
        >
          刷新状态
        </button>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}
      {!runScopeAllowed ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">单次运行未绑定身份范围，且宿主没有明确允许全局运行，因此保持禁用。启动与停止控制的是全局周期服务。</div> : null}

      <section className={styles.summaryGrid} aria-label="自动化运行摘要">
        <div className={styles.summaryCard}><span>周期状态</span><strong>{status?.active ? "运行中" : status ? "已停止" : "未知"}</strong></div>
        <div className={styles.summaryCard}><span>当前任务</span><strong>{status?.running ? "执行中" : status ? "空闲" : "未知"}</strong></div>
        <div className={styles.summaryCard}><span>累计运行</span><strong>{status ? status.runCount : "—"}</strong></div>
        <div className={styles.summaryCard}><span>就绪结论</span><strong>{ready ? "可运行" : readiness ? "已阻止" : "未知"}</strong></div>
      </section>

      <section className={styles.panel} aria-labelledby="automation-control-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="automation-control-title">运行控制</h2>
            <p>{readiness?.summary || "尚未取得服务端就绪检查。"}</p>
          </div>
          <span className={`${styles.badge} ${ready ? styles.toneOk : styles.toneError}`}>
            {ready ? "检查通过" : "默认阻止"}
          </span>
        </header>
        <div className={styles.panelBody}>
          <dl className={styles.definitionList}>
            <div><dt>下次运行</dt><dd>{formatDateTime(status?.nextRunAt)}</dd></div>
            <div><dt>运行间隔</dt><dd>{status ? formatInterval(status.intervalMs) : "未知"}</dd></div>
            <div><dt>发送队列</dt><dd>{status ? (status.processSendQueue ? `启用，单次 ${status.sendQueueLimit}` : "不处理") : "未知"}</dd></div>
          </dl>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="automation-run-request"
              aria-label="请求执行一次自动化并进入确认"
              onClick={() => setPendingConfirmation("run")}
              disabled={busy || !ready || !runScopeAllowed || status?.running === true}
            >
              执行一次
            </button>
            <button
              type="button"
              className={styles.button}
              data-action-id="automation-start-request"
              aria-label="请求启动周期自动化并进入确认"
              onClick={() => setPendingConfirmation("start")}
              disabled={busy || !ready || status?.active === true}
            >
              启动周期运行
            </button>
            <button
              type="button"
              className={styles.dangerButton}
              data-action-id="automation-stop-request"
              aria-label="请求停止周期自动化并进入确认"
              onClick={() => setPendingConfirmation("stop")}
              disabled={busy || status?.active !== true}
            >
              停止周期运行
            </button>
          </div>
        </div>
      </section>

      {pendingConfirmation ? (
        <section className={styles.confirmation} role="alertdialog" aria-modal="true" aria-labelledby="automation-confirm-title">
          <strong id="automation-confirm-title">{actionCopy[pendingConfirmation].title}</strong>
          <p>{actionCopy[pendingConfirmation].detail}</p>
          <p>{pendingConfirmation === "run" ? `运行范围：${hasIdentityScope ? formatIdentityScope(stableIdentityFilters) : "全局范围（宿主已明确允许）"}` : "作用范围：全局周期自动化服务，不受当前页面身份筛选限制"}</p>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={pendingConfirmation === "stop" ? styles.dangerButton : styles.primaryButton}
              data-action-id={`automation-confirm-${pendingConfirmation}`}
              aria-label={`确认${actionCopy[pendingConfirmation].title}`}
              onClick={() => void confirmAction()}
              disabled={busy}
            >
              确认执行
            </button>
            <button
              type="button"
              className={styles.button}
              data-action-id="automation-confirm-cancel"
              aria-label="取消自动化操作"
              onClick={() => setPendingConfirmation(null)}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </section>
      ) : null}

      <section className={styles.panel} aria-labelledby="automation-history-title">
        <header className={styles.panelHeader}>
          <div><h2 id="automation-history-title">最近运行记录</h2><p>服务端返回的最近运行结果，不生成本地占位记录。</p></div>
        </header>
        <div className={styles.panelBody}>
          {recentRuns?.length ? (
            <div className={styles.recordList}>
              {recentRuns.map((run, index) => (
                <article className={styles.record} key={`${run.startedAt}-${run.trigger}-${index}`}>
                  <div className={styles.recordHeader}>
                    <div><h3>{formatTrigger(run.trigger)} · {formatDateTime(run.startedAt)}</h3><p>{run.reason || `${run.steps?.length || 0} 个步骤`}</p></div>
                    <span className={`${styles.badge} ${run.errors.length ? styles.toneError : run.skipped ? styles.toneWarning : styles.toneOk}`}>
                      {run.errors.length ? "失败" : run.skipped ? "已跳过" : "完成"}
                    </span>
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
        </div>
      </section>
    </section>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function formatInterval(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "未知";
  return value >= 60_000 ? `${Math.round(value / 60_000)} 分钟` : `${Math.round(value / 1_000)} 秒`;
}

function formatTrigger(trigger: string) {
  if (trigger === "manual") return "人工触发";
  if (trigger === "interval") return "周期触发";
  return "服务启动触发";
}

function formatIdentityScope(filters: IdentityFilters) {
  const parts = [
    filters.wechatAccountId ? `微信账号 ${filters.wechatAccountId}` : "",
    filters.conversationId ? `会话 ${filters.conversationId}` : "",
    filters.customerId ? `客户 ${filters.customerId}` : "",
  ].filter(Boolean);
  return parts.join(" / ") || "当前工作台全局范围";
}
