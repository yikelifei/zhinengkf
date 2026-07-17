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
};

export function useAutomationOperations({
  identityFilters,
  allowGlobalRun = false,
}: UseAutomationOperationsOptions = {}) {
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

  const ready = readiness?.ready === true;
  const hasIdentityScope = Boolean(
    stableIdentityFilters.wechatAccountId || stableIdentityFilters.conversationId || stableIdentityFilters.customerId,
  );
  const runScopeAllowed = hasIdentityScope || allowGlobalRun;

  const confirmAction = useCallback(async () => {
    if (!pendingConfirmation) return;
    if (pendingConfirmation === "run" && !runScopeAllowed) {
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
  }, [pendingConfirmation, readiness?.ready, runScopeAllowed, stableIdentityFilters]);

  return {
    status,
    readiness,
    busy,
    error,
    notice,
    ready,
    hasIdentityScope,
    runScopeAllowed,
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
