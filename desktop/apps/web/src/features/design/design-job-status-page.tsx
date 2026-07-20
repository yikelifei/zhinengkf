"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DesignExecutionReconciliationPanel } from "../../components/design-execution-reconciliation-panel";
import { identityExpectation, type DesignPlatformExecutionView } from "../../lib/api";
import {
  getDesignJobExecutions,
  getOperatorAccessStatus,
  pollDesignJob,
  resolveDesignExecutionRefund,
  resolveUnknownDesignExecution,
} from "./api";
import styles from "./design-pages.module.css";
import { DesignEmpty, DesignNotice, DesignPageHeader, errorText, formatDesignDate } from "./design-ui";
import { useDesignJobs } from "./use-design-job";

export function DesignJobStatusPage({ jobId }: { jobId: string }) {
  const { selected, loading, loaded, error: loadError, replace } = useDesignJobs(jobId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [executions, setExecutions] = useState<DesignPlatformExecutionView[]>([]);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [executionsError, setExecutionsError] = useState("");
  const [canManageExecutions, setCanManageExecutions] = useState(false);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = Boolean(expected.expectedWechatAccountId && expected.expectedConversationId && expected.expectedCustomerId);

  useEffect(() => {
    if (!selected || !identityReady) {
      setExecutions([]);
      setExecutionsLoading(false);
      setExecutionsError("");
      setCanManageExecutions(false);
      return;
    }
    let cancelled = false;
    setExecutionsLoading(true);
    setExecutionsError("");
    void Promise.allSettled([
      getDesignJobExecutions(selected.id, identityExpectation(selected)),
      getOperatorAccessStatus(),
    ]).then(([executionResult, accessResult]) => {
      if (cancelled) return;
      if (executionResult.status === "fulfilled") {
        setExecutions(executionResult.value);
      } else {
        setExecutions([]);
        setExecutionsError("读取执行记录失败；详情已隐藏，请稍后刷新。");
      }
      setCanManageExecutions(
        accessResult.status === "fulfilled"
          && accessResult.value.enforcementReady
          && accessResult.value.capabilities.includes("manage_design_executions"),
      );
      setExecutionsLoading(false);
    });
    return () => { cancelled = true; };
  }, [
    identityReady,
    selected?.id,
    selected?.wechatAccountId,
    selected?.conversationId,
    selected?.customerId,
  ]);

  async function refreshExecutions() {
    if (!selected || !identityReady) return;
    setExecutionsLoading(true);
    setExecutionsError("");
    try {
      setExecutions(await getDesignJobExecutions(selected.id, expected));
    } catch {
      setExecutionsError("读取执行记录失败；详情已隐藏，请稍后刷新。");
      throw new Error("执行记录刷新失败（响应详情已隐藏）。");
    } finally {
      setExecutionsLoading(false);
    }
  }

  async function resolveUnknown(executionId: string) {
    if (!selected || !identityReady) throw new Error("任务身份不完整，已拒绝核销。");
    await resolveUnknownDesignExecution(selected.id, executionId, expected);
  }

  async function resolveRefund(executionId: string) {
    if (!selected || !identityReady) throw new Error("任务身份不完整，已拒绝核销。");
    await resolveDesignExecutionRefund(selected.id, executionId, expected);
  }

  async function poll() {
    if (!selected || !identityReady) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await pollDesignJob(selected.id, expected);
      replace(result.job);
      setNotice(`远端状态：${result.remoteStatus}${result.autoRetried ? "；服务端已自动重试" : ""}`);
    } catch (cause) { setError(errorText(cause, "设计任务状态同步失败")); }
    finally { setBusy(false); }
  }

  return (
    <section className={styles.page} aria-label="同步设计任务状态">
      <DesignPageHeader eyebrow="设计平台 · 状态同步" title="同步远端状态" detail="本页只查询并更新这一条任务的远端状态，不提交任务。" />
      {loadError || error ? <DesignNotice tone="danger">{error || loadError}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      {loading ? <DesignEmpty title="正在读取设计任务" detail={`任务 ${jobId}`} busy /> : selected ? (
        <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>{selected.requestId}</h2><p>最近更新 {formatDesignDate(selected.updatedAt)}</p></div><span className={styles.statusPill}>{selected.status}</span></div>
          {!identityReady ? <DesignNotice tone="danger">任务身份不完整，已阻止远端状态同步。</DesignNotice> : null}
          <div className={styles.formActions}><button type="button" className={styles.primaryButton} data-action-id="design-job-status-poll" disabled={busy || !identityReady} onClick={() => void poll()}><RefreshCw size={16} aria-hidden="true" />{busy ? "同步中" : "同步这一条任务"}</button></div>
          <DesignExecutionReconciliationPanel
            executions={executions}
            loading={executionsLoading}
            error={executionsError}
            canManageExecutions={canManageExecutions}
            onRefresh={refreshExecutions}
            onResolveUnknown={resolveUnknown}
            onResolveRefund={resolveRefund}
          />
          <Link className={styles.backLink} href={`/design/jobs/${encodeURIComponent(selected.id)}`} data-action-id="design-job-status-back">返回任务详情</Link>
        </article>
      ) : loaded ? <DesignEmpty title="没有找到设计任务" detail="读取成功；请返回任务列表重新选择。" /> : <DesignEmpty title="设计任务状态未确认" detail="任务尚未成功读取，已阻止远端状态同步。" />}
    </section>
  );
}
