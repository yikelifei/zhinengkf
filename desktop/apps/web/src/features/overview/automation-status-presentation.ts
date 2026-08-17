import type { AutomationReadiness, AutomationStatus } from "../../lib/api";

export type AutomationOverviewPresentation = {
  label: string;
  detail: string;
  tone: "ready" | "warning" | "danger" | "muted";
};

export function automationOverviewPresentation(
  status: AutomationStatus | null,
  readiness: AutomationReadiness | null,
): AutomationOverviewPresentation {
  if (!status) {
    return {
      label: "自动化状态未知",
      detail: readiness?.summary || "请先进入自动化运行页核对就绪检查。",
      tone: "danger",
    };
  }
  if (!status.enabled) {
    return {
      label: "周期自动化已停用",
      detail: readiness?.summary || "自动化开关当前处于停用状态。",
      tone: "muted",
    };
  }
  if (!readiness?.ready) {
    return {
      label: status.running ? "自动化任务执行中" : "自动化已启用，等待就绪",
      detail: readiness?.summary || "自动化已启用，但就绪状态尚未确认。",
      tone: "danger",
    };
  }
  if (status.running) {
    return {
      label: "自动化任务执行中",
      detail: readiness.summary,
      tone: "ready",
    };
  }
  if (status.mode === "durable") {
    return {
      label: "持久调度运行中",
      detail: `${readiness.summary} 当前由 BullMQ 持久调度器周期触发，进程内循环无需保持激活。`,
      tone: "ready",
    };
  }
  if (status.mode === "interval" && status.active) {
    return {
      label: "周期自动化运行中",
      detail: readiness.summary,
      tone: "ready",
    };
  }
  if (status.mode === "interval") {
    return {
      label: "单机周期调度未运行",
      detail: `${readiness.summary} 当前是 interval 单进程模式，但进程内循环未激活。`,
      tone: "warning",
    };
  }
  return {
    label: status.active ? "周期自动化运行中" : "自动化已启用，运行方式待确认",
    detail: status.active
      ? readiness.summary
      : `${readiness.summary} 服务端未返回调度模式，不能仅凭进程内 active 状态判断已停止。`,
    tone: status.active ? "ready" : "warning",
  };
}
