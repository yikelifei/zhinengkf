import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { appConfig } from "../shared/app-config";
import { AutomationQueueRuntime, automationQueueReadiness } from "./automation-queue.runtime";
import { AutomationService } from "./automation.service";

@Injectable()
export class AutomationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private startupTimer: NodeJS.Timeout | null = null;
  private readonly queueRuntime: AutomationQueueRuntime;

  constructor(private readonly automation: AutomationService) {
    this.queueRuntime = new AutomationQueueRuntime(
      {
        enabled: appConfig.lowValueAutomationEnabled,
        mode: appConfig.lowValueAutomationMode,
        intervalMs: appConfig.lowValueAutomationIntervalMs,
        redisUrl: appConfig.lowValueAutomationRedisUrl,
      },
      () => this.automation.runOnce("interval"),
    );
  }

  async onModuleInit() {
    if (!appConfig.lowValueAutomationEnabled) return;
    if (appConfig.lowValueAutomationMode === "durable") {
      await this.queueRuntime.start();
      return;
    }
    if (appConfig.lowValueAutomationMode === "invalid") {
      throw new Error("automation scheduler mode is invalid");
    }
    this.automation.start();
    if (appConfig.lowValueAutomationRunOnStart) {
      this.startupTimer = setTimeout(() => {
        void this.automation.runOnce("startup");
      }, 1500);
      this.startupTimer.unref?.();
    }
  }

  async onModuleDestroy() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    this.automation.stop();
    await this.queueRuntime.stop();
  }

  async start() {
    if (!appConfig.lowValueAutomationEnabled) return this.status();
    if (appConfig.lowValueAutomationMode === "durable") return this.queueRuntime.start();
    return this.automation.start();
  }

  async stop() {
    if (appConfig.lowValueAutomationMode === "durable") {
      return this.queueRuntime.stop({ removeSchedule: true });
    }
    return this.automation.stop();
  }

  async status() {
    return {
      ...this.automation.status(),
      mode: appConfig.lowValueAutomationMode,
      recentRunsSource:
        appConfig.lowValueAutomationMode === "durable"
          ? "local_compatibility_only"
          : "local_interval_runtime",
      durableEvidenceSource:
        appConfig.lowValueAutomationMode === "durable" ? "bullmq_redis" : "not_applicable",
      evidenceSource:
        appConfig.lowValueAutomationMode === "durable" ? "bullmq_redis" : "local_store_interval",
      manualRunEvidence: "direct_execution_not_bullmq_job",
      scheduler:
        appConfig.lowValueAutomationMode === "durable"
          ? await this.queueRuntime.status()
          : {
              mode: appConfig.lowValueAutomationMode,
              evidenceSource: "local_store_interval",
              active: this.automation.status().active,
              configured: false,
              connected: false,
              scheduled: Boolean(this.automation.status().active),
              workerReady: false,
              durableEvidence: { available: false },
            },
    };
  }

  async readiness() {
    const base = await this.automation.readiness();
    const queueCheck = automationQueueReadiness({
      enabled: appConfig.lowValueAutomationEnabled,
      mode: appConfig.lowValueAutomationMode,
      intervalMs: appConfig.lowValueAutomationIntervalMs,
      redisUrl: appConfig.lowValueAutomationRedisUrl,
    });
    const schedulerStatus =
      appConfig.lowValueAutomationMode === "durable" ? await this.queueRuntime.status() : null;
    const runtimeReady =
      queueCheck.ready &&
      (appConfig.lowValueAutomationMode !== "durable" ||
        Boolean(schedulerStatus?.connected && schedulerStatus?.workerReady && schedulerStatus?.scheduled));
    const schedulerCheck = {
      key: "automation_scheduler",
      label: "自动化持久调度",
      ok: runtimeReady,
      severity: runtimeReady ? (appConfig.lowValueAutomationMode === "interval" ? "warning" : "info") : "error",
      detail: !queueCheck.ready
        ? queueCheck.detail
        : appConfig.lowValueAutomationMode === "durable"
          ? runtimeReady
            ? "BullMQ 调度、Worker 和 Redis 连接证据可用；全局并发固定为 1。"
            : "durable 调度尚未建立完整的 Redis、Worker 和 schedule 证据。"
          : "interval 模式仅适用于单进程本地运行，生产环境应使用 durable。",
      action: runtimeReady
        ? undefined
        : "配置 LOW_VALUE_AUTOMATION_MODE=durable 与 LOW_VALUE_AUTOMATION_REDIS_URL，并确认 Redis/Worker 可连接。",
    } as const;
    const checks = [...base.checks, schedulerCheck];
    const blockers = checks.filter((check) => !check.ok && check.severity === "error");
    const warnings = checks.filter((check) => check.severity === "warning");
    const ready = blockers.length === 0;
    return {
      ...base,
      ready,
      tone: ready ? (warnings.length ? "warning" : "ok") : "error",
      summary: ready
        ? warnings.length
          ? "可以运行，但建议先处理提醒项。"
          : "可以开启低价值自动处理。"
        : "暂不建议开启低价值自动处理。",
      checks,
      blockers,
      warnings,
      scheduler: schedulerStatus,
    };
  }
}
