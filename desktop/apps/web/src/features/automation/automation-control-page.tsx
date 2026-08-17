"use client";

import type { IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { useOperatorCapability } from "../access/use-operator-capability";
import {
  automationActionCopy,
  formatAutomationDateTime,
  formatAutomationIdentityScope,
  formatAutomationInterval,
  useAutomationOperations,
} from "./use-automation-operations";

export type AutomationControlPageProps = {
  identityFilters?: IdentityFilters;
  allowGlobalRun?: boolean;
  allowGlobalSchedulerControl?: boolean;
};

export function AutomationControlPage({ identityFilters, allowGlobalRun = false, allowGlobalSchedulerControl = false }: AutomationControlPageProps) {
  const controlAccess = useOperatorCapability("approve_send");
  const automation = useAutomationOperations({ identityFilters, allowGlobalRun, allowGlobalSchedulerControl, mutationAuthorized: controlAccess.readState === "ready" && controlAccess.allowed });
  const pending = automation.pendingConfirmation;
  const pageBusy = automation.busy || controlAccess.busy;

  return (
    <section className={styles.page} aria-labelledby="automation-control-title" aria-busy={pageBusy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <h1 id="automation-control-title">运行控制</h1>
          <p className={styles.description}>只负责启动、停止或执行一次自动化；运行记录不在本页展开。</p>
        </div>
        <button type="button" className={styles.button} data-action-id="automation-control-refresh" onClick={() => void Promise.all([automation.refresh(), controlAccess.refresh()])} disabled={pageBusy}>
          重新检查
        </button>
      </header>

      {automation.error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{automation.error}</div> : null}
      {controlAccess.error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">自动化控制权限未确认：{controlAccess.error}</div> : null}
      {controlAccess.readState === "ready" && !controlAccess.allowed ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">当前可信操作员未获 approve_send 权限；状态仍可查看，运行、启动和停止均保持禁用。</div> : null}
      {automation.notice ? <div className={`${styles.notice} ${automation.noticeTone === "warning" ? styles.noticeWarning : styles.noticeSuccess}`} role="status">{automation.notice}</div> : null}
      {automation.readState === "stale" ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">当前展示的是上次完整读取的旧状态；刷新成功前，执行一次和启动周期运行均保持禁用。</div> : null}
      {!automation.runScopeAllowed ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">单次运行未绑定身份范围，且宿主没有明确允许全局运行，因此保持禁用。</div> : null}
      {!automation.schedulerControlAllowed ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">周期运行会处理全局任务；当前页面未被宿主授权控制全局调度，因此启动操作保持禁用。</div> : null}

      <section className={styles.panel} aria-labelledby="automation-control-readiness-title">
        <header className={styles.panelHeader}>
          <div><h2 id="automation-control-readiness-title">提交前检查</h2><p>{automation.readiness?.summary || "尚未取得服务端就绪检查。"}</p></div>
          <span className={`${styles.badge} ${automation.ready ? styles.toneOk : styles.toneError}`}>{automation.ready ? "检查通过" : "默认阻止"}</span>
        </header>
        <div className={styles.panelBody}>
          <dl className={styles.definitionList}>
            <div><dt>下次运行</dt><dd>{formatAutomationDateTime(automation.status?.nextRunAt)}</dd></div>
            <div><dt>运行间隔</dt><dd>{automation.status ? formatAutomationInterval(automation.status.intervalMs) : "未知"}</dd></div>
            <div><dt>发送队列</dt><dd>{automation.status ? (automation.status.processSendQueue ? `启用，单次 ${automation.status.sendQueueLimit}` : "不处理") : "未知"}</dd></div>
          </dl>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.primaryButton} data-action-id="automation-run-request" onClick={() => automation.requestAction("run")} disabled={pageBusy || !automation.mutationAuthorized || !automation.ready || !automation.runScopeAllowed || automation.status?.running === true}>执行一次</button>
            <button type="button" className={styles.button} data-action-id="automation-start-request" onClick={() => automation.requestAction("start")} disabled={pageBusy || !automation.mutationAuthorized || !automation.ready || !automation.schedulerControlAllowed || automation.status?.active === true}>启动周期运行</button>
            <button type="button" className={styles.dangerButton} data-action-id="automation-stop-request" onClick={() => automation.requestAction("stop")} disabled={pageBusy || !automation.mutationAuthorized || automation.status?.active !== true}>停止周期运行</button>
          </div>
        </div>
      </section>

      {pending ? (
        <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="automation-confirm-title">
          <strong id="automation-confirm-title">{automationActionCopy[pending].title}</strong>
          <p>{automationActionCopy[pending].detail}</p>
          <p>{pending === "run" ? `运行范围：${automation.hasIdentityScope ? formatAutomationIdentityScope(automation.stableIdentityFilters) : "全局范围（宿主已明确允许）"}` : "作用范围：全局周期自动化服务，不局限于当前会话"}</p>
          <div className={styles.buttonRow}>
            <button type="button" className={pending === "stop" ? styles.dangerButton : styles.primaryButton} data-action-id={`automation-confirm-${pending}`} onClick={() => void automation.confirmAction()} disabled={pageBusy || !automation.mutationAuthorized || (pending !== "stop" && automation.readState !== "ready")}>确认执行</button>
            <button type="button" className={styles.button} data-action-id="automation-confirm-cancel" onClick={() => automation.requestAction(null)} disabled={pageBusy}>取消</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
