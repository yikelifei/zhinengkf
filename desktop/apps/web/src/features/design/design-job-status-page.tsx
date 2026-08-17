"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DesignExecutionReconciliationPanel } from "../../components/design-execution-reconciliation-panel";
import { identityExpectation, type DesignPlatformExecutionView, type IdentityFilters } from "../../lib/api";
import {
  getDesignJobExecutions,
  getOperatorAccessStatus,
  pollDesignJob,
  resolveDesignExecutionRefund,
  resolveUnknownDesignExecution,
} from "./api";
import { createDesignRequestGuard, runGuardedDesignRequest } from "./design-request-guard";
import { designIdentityHref } from "./design-commerce-state";
import styles from "./design-pages.module.css";
import { DesignEmpty, DesignNotice, DesignPageHeader, errorText, formatDesignDate } from "./design-ui";
import { useDesignJobs } from "./use-design-job";

export function DesignJobStatusPage({ jobId, initialIdentityFilters = {} }: { jobId: string; initialIdentityFilters?: IdentityFilters }) {
  const { selected, loading, loaded, error: loadError, replace } = useDesignJobs(jobId, initialIdentityFilters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [executions, setExecutions] = useState<DesignPlatformExecutionView[]>([]);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [executionsLoaded, setExecutionsLoaded] = useState(false);
  const [executionsError, setExecutionsError] = useState("");
  const [accessLoaded, setAccessLoaded] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [canManageExecutions, setCanManageExecutions] = useState(false);
  const [executionsScopeKey, setExecutionsScopeKey] = useState("");

  const expected = selected ? identityExpectation(selected) : {};
  const selectedId = selected?.id || "";
  const expectedWechatAccountId = expected.expectedWechatAccountId || "";
  const expectedConversationId = expected.expectedConversationId || "";
  const expectedCustomerId = expected.expectedCustomerId || "";
  const identityReady = Boolean(expectedWechatAccountId && expectedConversationId && expectedCustomerId);
  const scopeKey = designExecutionScopeKey(selectedId, expectedWechatAccountId, expectedConversationId, expectedCustomerId);

  const executionGuardRef = useRef<ReturnType<typeof createDesignRequestGuard> | null>(null);
  const pollGuardRef = useRef<ReturnType<typeof createDesignRequestGuard> | null>(null);
  if (!executionGuardRef.current) executionGuardRef.current = createDesignRequestGuard(scopeKey);
  if (!pollGuardRef.current) pollGuardRef.current = createDesignRequestGuard(scopeKey);
  const executionGuard = executionGuardRef.current;
  const pollGuard = pollGuardRef.current;

  useEffect(() => {
    executionGuard.activate();
    pollGuard.activate();
    return () => {
      executionGuard.dispose();
      pollGuard.dispose();
    };
  }, [executionGuard, pollGuard]);

  const refreshExecutions = useCallback(async (rejectOnExecutionFailure = false) => {
    if (!selectedId || !identityReady) return;
    let executionReadFailed = false;
    const committed = await runGuardedDesignRequest({
      guard: executionGuard,
      scopeKey,
      load: () => Promise.allSettled([
        getDesignJobExecutions(selectedId, {
          expectedWechatAccountId,
          expectedConversationId,
          expectedCustomerId,
        }),
        getOperatorAccessStatus(),
      ]),
      onStart: () => {
        setExecutionsScopeKey(scopeKey);
        setExecutions([]); setExecutionsLoading(true); setExecutionsLoaded(false); setExecutionsError("");
        setCanManageExecutions(false); setAccessLoaded(false); setAccessError("");
      },
      onSuccess: ([executionResult, accessResult]) => {
        if (executionResult.status === "fulfilled") {
          setExecutions(executionResult.value); setExecutionsLoaded(true); setExecutionsError("");
        } else {
          executionReadFailed = true;
          setExecutions([]); setExecutionsLoaded(false);
          setExecutionsError("读取执行记录失败；详情已隐藏，请稍后刷新。");
        }
        if (accessResult.status === "fulfilled") {
          setAccessLoaded(true); setAccessError("");
          setCanManageExecutions(
            accessResult.value.enforcementReady
            && accessResult.value.capabilities.includes("manage_design_executions"),
          );
        } else {
          setCanManageExecutions(false); setAccessLoaded(false);
          setAccessError("执行管理权限尚未成功读取，核销操作保持禁用。");
        }
      },
      onError: () => {
        executionReadFailed = true;
        setExecutions([]); setExecutionsLoaded(false);
        setExecutionsError("读取执行记录失败；详情已隐藏，请稍后刷新。");
        setCanManageExecutions(false); setAccessLoaded(false);
        setAccessError("执行管理权限尚未成功读取，核销操作保持禁用。");
      },
      onFinally: () => setExecutionsLoading(false),
    });
    if (committed && rejectOnExecutionFailure && executionReadFailed) {
      throw new Error("执行记录刷新失败（响应详情已隐藏）。");
    }
  }, [
    executionGuard,
    expectedConversationId,
    expectedCustomerId,
    expectedWechatAccountId,
    identityReady,
    scopeKey,
    selectedId,
  ]);

  const manualRefreshExecutions = useCallback(
    () => refreshExecutions(true),
    [refreshExecutions],
  );

  useEffect(() => {
    executionGuard.setScope(scopeKey);
    pollGuard.setScope(scopeKey);
    setExecutionsScopeKey(scopeKey);
    setExecutions([]); setExecutionsLoading(false); setExecutionsLoaded(false); setExecutionsError("");
    setCanManageExecutions(false); setAccessLoaded(false); setAccessError("");
    setError(""); setNotice(""); setBusy(false);
    if (selectedId && identityReady) void refreshExecutions(false);
    return () => {
      executionGuard.invalidate(scopeKey);
      pollGuard.invalidate(scopeKey);
    };
  }, [executionGuard, identityReady, pollGuard, refreshExecutions, scopeKey, selectedId]);

  async function resolveUnknown(executionId: string) {
    if (!selectedId || !identityReady) throw new Error("任务身份不完整，已拒绝核销。");
    await resolveUnknownDesignExecution(selectedId, executionId, {
      expectedWechatAccountId,
      expectedConversationId,
      expectedCustomerId,
    });
  }

  async function resolveRefund(executionId: string) {
    if (!selectedId || !identityReady) throw new Error("任务身份不完整，已拒绝核销。");
    await resolveDesignExecutionRefund(selectedId, executionId, {
      expectedWechatAccountId,
      expectedConversationId,
      expectedCustomerId,
    });
  }

  async function poll() {
    if (!selectedId || !identityReady) return;
    await runGuardedDesignRequest({
      guard: pollGuard,
      scopeKey,
      load: () => pollDesignJob(selectedId, {
        expectedWechatAccountId,
        expectedConversationId,
        expectedCustomerId,
      }),
      onStart: () => { setBusy(true); setError(""); setNotice(""); },
      onSuccess: (result) => {
        replace(result.job);
        setNotice(`远端状态：${result.remoteStatus}${result.autoRetried ? "；服务端已自动重试" : ""}`);
      },
      onError: (cause) => setError(errorText(cause, "设计任务状态同步失败")),
      onFinally: () => setBusy(false),
    });
  }

  const executionStateCurrent = executionsScopeKey === scopeKey;
  const visibleExecutions = executionStateCurrent ? executions : [];
  const visibleExecutionsLoading = executionStateCurrent ? executionsLoading : identityReady;
  const visibleExecutionsLoaded = executionStateCurrent && executionsLoaded;
  const visibleExecutionsError = executionStateCurrent ? executionsError : "";
  const visibleAccessLoaded = executionStateCurrent && accessLoaded;
  const visibleAccessError = executionStateCurrent ? accessError : "";
  const visibleCanManage = executionStateCurrent && canManageExecutions;

  return (
    <section className={styles.page} aria-label="同步设计任务状态">
      <DesignPageHeader eyebrow="设计平台 · 状态同步" title="同步远端状态" detail="本页只查询并更新这一条任务的远端状态，不提交任务。" />
      {loadError || error ? <DesignNotice tone="danger">{error || loadError}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      {loading && !loaded ? <DesignEmpty title="正在读取设计任务" detail={`任务 ${jobId}`} busy /> : selected ? (
        <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>{selected.requestId}</h2><p>最近更新 {formatDesignDate(selected.updatedAt)}</p></div><span className={styles.statusPill}>{selected.status}</span></div>
          {!identityReady ? <DesignNotice tone="danger">任务身份不完整，已阻止远端状态同步。</DesignNotice> : null}
          <div className={styles.formActions}><button type="button" className={styles.primaryButton} data-action-id="design-job-status-poll" disabled={busy || Boolean(loadError) || !identityReady} onClick={() => void poll()}><RefreshCw size={16} aria-hidden="true" />{busy ? "同步中" : "同步这一条任务"}</button></div>
          <DesignExecutionReconciliationPanel
            key={scopeKey}
            executions={visibleExecutions}
            loading={visibleExecutionsLoading}
            loaded={visibleExecutionsLoaded}
            error={visibleExecutionsError}
            accessLoaded={visibleAccessLoaded}
            accessError={visibleAccessError}
            canManageExecutions={visibleCanManage}
            onRefresh={manualRefreshExecutions}
            onResolveUnknown={resolveUnknown}
            onResolveRefund={resolveRefund}
          />
          <Link className={styles.backLink} href={designIdentityHref(`/design/jobs/${encodeURIComponent(selected.id)}`, selected)} data-action-id="design-job-status-back">返回任务详情</Link>
        </article>
      ) : loaded ? <DesignEmpty title="没有找到设计任务" detail="读取成功；请返回任务列表重新选择。" /> : <DesignEmpty title="设计任务状态未确认" detail="任务尚未成功读取，已阻止远端状态同步。" />}
    </section>
  );
}

function designExecutionScopeKey(
  designJobId: string,
  wechatAccountId: string,
  conversationId: string,
  customerId: string,
) {
  return JSON.stringify([
    designJobId.trim(),
    wechatAccountId.trim(),
    conversationId.trim(),
    customerId.trim(),
  ]);
}
