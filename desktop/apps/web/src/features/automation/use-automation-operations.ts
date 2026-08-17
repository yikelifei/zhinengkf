"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export type PendingAutomationAction = "run" | "start" | "stop";

export const automationActionCopy: Record<PendingAutomationAction, { title: string; detail: string }> = {
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

type UseAutomationOperationsOptions = {
  identityFilters?: IdentityFilters;
  allowGlobalRun?: boolean;
  allowGlobalSchedulerControl?: boolean;
  mutationAuthorized?: boolean;
};

export function useAutomationOperations({
  identityFilters,
  allowGlobalRun = false,
  allowGlobalSchedulerControl = false,
  mutationAuthorized = false,
}: UseAutomationOperationsOptions = {}) {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [readiness, setReadiness] = useState<AutomationReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("success");
  const [readState, setReadState] = useState<"loading" | "ready" | "stale" | "unknown">("loading");
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAutomationAction | null>(null);
  const statusRef = useRef<AutomationStatus | null>(null);
  const readinessRef = useRef<AutomationReadiness | null>(null);
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
    const nextStatus = statusResult.status === "fulfilled" ? statusResult.value : statusRef.current;
    const nextReadiness = readinessResult.status === "fulfilled" ? readinessResult.value : readinessRef.current;
    if (statusResult.status === "fulfilled") statusRef.current = statusResult.value;
    if (readinessResult.status === "fulfilled") readinessRef.current = readinessResult.value;
    setStatus(nextStatus);
    setReadiness(nextReadiness);
    const fullyFresh = statusResult.status === "fulfilled" && readinessResult.status === "fulfilled";
    setReadState(fullyFresh ? "ready" : statusRef.current && readinessRef.current ? "stale" : "unknown");
    if (!fullyFresh) {
      setError(statusRef.current && readinessRef.current
        ? "自动化状态未完整刷新；当前仅保留上次成功读取的旧结果，写操作保持禁用。"
        : "自动化服务未返回完整状态。当前操作已保持禁用，请检查服务端后再刷新。");
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ready = readState === "ready" && readiness?.ready === true;
  const hasIdentityScope = Boolean(
    stableIdentityFilters.wechatAccountId || stableIdentityFilters.conversationId || stableIdentityFilters.customerId,
  );
  const runScopeAllowed = hasIdentityScope || allowGlobalRun;
  const schedulerControlAllowed = allowGlobalSchedulerControl;

  const confirmAction = useCallback(async () => {
    if (!pendingConfirmation) return;
    if (!mutationAuthorized) {
      setError("服务端尚未确认当前操作员具备 approve_send 权限，自动化写操作已阻止。");
      setPendingConfirmation(null);
      return;
    }
    if (pendingConfirmation === "run" && !runScopeAllowed) {
      setError("单次运行没有绑定身份范围，且宿主未明确允许全局运行，操作已阻止。");
      setPendingConfirmation(null);
      return;
    }
    if (pendingConfirmation === "start" && !schedulerControlAllowed) {
      setError("周期运行作用于全局任务；当前页面没有被宿主明确授权控制全局调度，操作已阻止。");
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
    setNoticeTone("success");
    try {
      if (pendingConfirmation !== "stop") {
        const latestReadiness = await getAutomationReadiness();
        readinessRef.current = latestReadiness;
        setReadiness(latestReadiness);
        if (latestReadiness?.ready !== true) {
          throw new Error("确认时的最新就绪检查未通过，自动化操作没有提交。");
        }
      }
      if (pendingConfirmation === "run") {
        const result = await runAutomationOnce(stableIdentityFilters);
        setStatus((current) => {
          const nextStatus = mergeAutomationStatusRun(current, result, { incrementRunCount: true });
          statusRef.current = nextStatus;
          return nextStatus;
        });
        if (result.errors.length) {
          setError(`本次运行已结束，但有 ${result.errors.length} 个步骤失败；请先进入问题页核对后再决定是否重试。`);
        } else {
          setNoticeTone(result.skipped ? "warning" : "success");
          setNotice(result.skipped ? `本次运行未推进：${result.reason || "服务端跳过"}` : "本次运行已结束，服务端未报告步骤失败。");
        }
      } else if (pendingConfirmation === "start") {
        const nextStatus = await startAutomation();
        statusRef.current = nextStatus;
        setStatus(nextStatus);
        if (nextStatus.active) setNotice("服务端已返回周期调度处于活动状态。");
        else setError("启动请求已返回，但服务端仍报告周期调度未活动；不能认定已经启动。");
      } else {
        const nextStatus = await stopAutomation();
        statusRef.current = nextStatus;
        setStatus(nextStatus);
        if (!nextStatus.active) setNotice("服务端已返回周期调度处于停止状态；正在执行或已经提交的工作不会被撤销。");
        else setError("停止请求已返回，但服务端仍报告周期调度处于活动状态；请刷新并进入问题页核对。");
      }
      setPendingConfirmation(null);
      try {
        const nextReadiness = await getAutomationReadiness();
        readinessRef.current = nextReadiness;
        setReadiness(nextReadiness);
        setReadState(statusRef.current && readinessRef.current ? "ready" : "unknown");
        if (!nextReadiness) setError("操作结果已由服务端返回，但最新就绪检查没有返回内容；请刷新确认。");
      } catch (readinessError) {
        setReadState(statusRef.current && readinessRef.current ? "stale" : "unknown");
        setError(`操作结果已由服务端返回，但最新就绪检查读取失败；不要把就绪状态当作已刷新。${readinessError instanceof Error ? readinessError.message : ""}`);
      }
    } catch (caught) {
      setReadState(statusRef.current && readinessRef.current ? "stale" : "unknown");
      setError(caught instanceof Error
        ? `${caught.message}。服务端结果未确认，请先刷新状态和运行历史，不要立即重复提交。`
        : "自动化操作结果未确认；请先刷新状态和运行历史，不要立即重复提交。");
    } finally {
      setBusy(false);
    }
  }, [mutationAuthorized, pendingConfirmation, readiness?.ready, runScopeAllowed, schedulerControlAllowed, stableIdentityFilters]);

  return {
    status,
    readiness,
    busy,
    error,
    notice,
    noticeTone,
    readState,
    ready,
    hasIdentityScope,
    runScopeAllowed,
    schedulerControlAllowed,
    mutationAuthorized,
    pendingConfirmation,
    recentRuns: status?.recentRuns ?? (status?.lastRun ? [status.lastRun] : []),
    stableIdentityFilters,
    refresh,
    requestAction: setPendingConfirmation,
    confirmAction,
  };
}

export function formatAutomationDateTime(value?: string | null) {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function formatAutomationInterval(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "未知";
  return value >= 60_000 ? `${Math.round(value / 60_000)} 分钟` : `${Math.round(value / 1_000)} 秒`;
}

export function formatAutomationTrigger(trigger: string) {
  if (trigger === "manual") return "人工触发";
  if (trigger === "interval") return "周期触发";
  return "服务启动触发";
}

export function formatAutomationIdentityScope(filters: IdentityFilters) {
  const parts = [
    filters.wechatAccountId ? `微信账号 ${filters.wechatAccountId}` : "",
    filters.conversationId ? `会话 ${filters.conversationId}` : "",
    filters.customerId ? `客户 ${filters.customerId}` : "",
  ].filter(Boolean);
  return parts.join(" / ") || "当前工作台全局范围";
}
