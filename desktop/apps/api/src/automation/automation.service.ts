import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { CatalogService } from "../catalog/catalog.service";
import { DesignJobsService } from "../design-jobs/design-jobs.service";
import { DesignPlatformClient } from "../integrations/design-platform/design-platform.client";
import { LocalStoreService } from "../local-store/local-store.service";
import { OrdersService } from "../orders/orders.service";
import { appConfig } from "../shared/app-config";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";

type AutomationRun = {
  trigger: "startup" | "interval" | "manual";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  skipped?: boolean;
  reason?: string;
  steps: Array<{ step: string; status: "completed" | "failed"; durationMs: number; errorMessage?: string }>;
  errors: Array<{ step: string; errorMessage: string }>;
  results: Record<string, unknown>;
};

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private startedAt: string | null = null;
  private nextRunAt: string | null = null;
  private runningStartedAt: string | null = null;
  private lastRun: AutomationRun | null = null;
  private recentRuns: AutomationRun[] = [];
  private runCount = 0;

  constructor(
    private readonly designJobs: DesignJobsService,
    private readonly orders: OrdersService,
    private readonly wechatDispatch: WechatDispatchService,
    private readonly store?: LocalStoreService,
    private readonly catalog?: CatalogService,
    private readonly designPlatform?: DesignPlatformClient,
  ) {
    this.recentRuns = this.store?.listAutomationRuns(10) || [];
    this.lastRun = this.recentRuns[0] || null;
    this.runCount = this.recentRuns.filter((run) => !run.skipped).length;
  }

  onModuleInit() {
    if (!appConfig.lowValueAutomationEnabled) return;
    this.start();
    if (appConfig.lowValueAutomationRunOnStart) {
      setTimeout(() => {
        void this.runOnce("startup");
      }, 1500);
    }
  }

  onModuleDestroy() {
    this.stop();
  }

  start() {
    if (this.timer) return this.status();
    this.startedAt = new Date().toISOString();
    const intervalMs = Math.max(3000, appConfig.lowValueAutomationIntervalMs);
    this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    this.timer = setInterval(() => {
      this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      void this.runOnce("interval");
    }, intervalMs);
    this.timer.unref?.();
    return this.status();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.nextRunAt = null;
    return this.status();
  }

  status() {
    return {
      enabled: appConfig.lowValueAutomationEnabled,
      running: this.running,
      active: Boolean(this.timer),
      startedAt: this.startedAt,
      runningStartedAt: this.runningStartedAt,
      nextRunAt: this.nextRunAt,
      intervalMs: Math.max(3000, appConfig.lowValueAutomationIntervalMs),
      processSendQueue: appConfig.lowValueAutomationProcessSendQueue,
      sendQueueLimit: appConfig.lowValueAutomationSendQueueLimit,
      pollLimit: appConfig.lowValueAutomationPollLimit,
      runCount: this.runCount,
      lastRun: this.lastRun,
      recentRuns: this.recentRuns,
    };
  }

  async readiness() {
    const checkedAt = new Date().toISOString();
    const checks: Array<{
      key: string;
      label: string;
      ok: boolean;
      severity: "info" | "warning" | "error";
      detail: string;
      action?: string;
    }> = [];

    checks.push({
      key: "automation_enabled",
      label: "低价值自动化开关",
      ok: appConfig.lowValueAutomationEnabled,
      severity: appConfig.lowValueAutomationEnabled ? "info" : "error",
      detail: appConfig.lowValueAutomationEnabled ? "后台自动化已允许运行。" : "配置未启用低价值自动化。",
      action: appConfig.lowValueAutomationEnabled ? undefined : "开启 LOW_VALUE_AUTOMATION_ENABLED 后再启动后台。",
    });

    const catalogAudit = this.catalog ? await this.safeCatalogAudit() : null;
    const catalogStructureIssueCount = Number(catalogAudit?.catalogStructureIssueCount || 0);
    const blockingRepairCount = Number(catalogAudit?.blockingRepairCount || 0);
    checks.push({
      key: "sku_catalog",
      label: "商品库可自动搭配",
      ok: Boolean(catalogAudit) && catalogStructureIssueCount === 0 && blockingRepairCount === 0,
      severity: !catalogAudit || catalogStructureIssueCount || blockingRepairCount ? "error" : "info",
      detail: catalogAudit
        ? `可用商品 ${catalogAudit.readyCount || 0}/${catalogAudit.total || 0}，影响自动化 ${blockingRepairCount} 项。`
        : "无法完成商品库体检。",
      action: !catalogAudit
        ? "先检查商品库服务。"
        : catalogStructureIssueCount || blockingRepairCount
          ? "先补齐商品类型、图片、价格、库存、礼盒/内搭结构。"
          : undefined,
    });

    const designPlatformHealth = await this.safeDesignPlatformHealth();
    checks.push({
      key: "design_platform",
      label: "设计平台在线",
      ok: designPlatformHealth.ok,
      severity: designPlatformHealth.ok ? "info" : "warning",
      detail: designPlatformHealth.ok ? "设计平台健康检查通过。" : designPlatformHealth.errorMessage || "设计平台暂不可用。",
      action: designPlatformHealth.ok ? undefined : "出图会转人工或等待重试，先启动设计平台再跑自动化。",
    });

    const designJobs = await this.safeListDesignJobs();
    const sendTasks = this.store?.listSendTasks?.() || [];
    const conversations = this.store?.listConversations?.() || [];
    const quoteDrafts = this.store?.listQuoteDrafts?.() || [];
    const orderDrafts = this.store?.listOrderDrafts?.() || [];
    const lowValueDrafts = designJobs.filter((job: any) => job.status === "draft" && !job.isHighValue);
    const quickConfirmJobs = designJobs.filter((job: any) => job.status === "quick_confirm" && !job.isHighValue);
    const pendingSendTasks = sendTasks.filter((task: any) => ["queued", "sending", "pending_ack"].includes(String(task.status || "")));
    const manualLockedConversations = conversations.filter((conversation: any) => conversation.manualLocked || conversation.status === "manual_locked");
    const lowValueQuotesReady = quoteDrafts.filter((quote: any) => !quote.isHighValue && ["draft", "auto_sent", "accepted"].includes(String(quote.status || "")));
    const lowValueOrdersReady = orderDrafts.filter((order: any) => !order.isHighValue && ["confirmed", "paid", "processing", "fulfilled"].includes(String(order.status || "")));

    checks.push({
      key: "manual_locks",
      label: "人工接管隔离",
      ok: true,
      severity: manualLockedConversations.length ? "warning" : "info",
      detail: manualLockedConversations.length
        ? `${manualLockedConversations.length} 个会话人工接管中，自动化会跳过它们。`
        : "当前没有人工接管会话。",
      action: manualLockedConversations.length ? "人工处理完成后再解除对应会话锁。" : undefined,
    });

    checks.push({
      key: "send_queue",
      label: "安全发送队列",
      ok: pendingSendTasks.length <= Math.max(1, appConfig.lowValueAutomationSendQueueLimit * 3),
      severity: pendingSendTasks.length > Math.max(1, appConfig.lowValueAutomationSendQueueLimit * 3) ? "warning" : "info",
      detail: `待处理发送任务 ${pendingSendTasks.length} 个，每轮最多处理 ${appConfig.lowValueAutomationSendQueueLimit} 个。`,
      action: pendingSendTasks.length > Math.max(1, appConfig.lowValueAutomationSendQueueLimit * 3)
        ? "先确认微信窗口和回执扫描，避免队列越堆越多。"
        : undefined,
    });

    const blockers = checks.filter((check) => !check.ok && check.severity === "error");
    const warnings = checks.filter((check) => check.severity === "warning");
    const ready = blockers.length === 0;

    return {
      checkedAt,
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
      metrics: {
        lowValueDrafts: lowValueDrafts.length,
        quickConfirmJobs: quickConfirmJobs.length,
        pendingSendTasks: pendingSendTasks.length,
        manualLockedConversations: manualLockedConversations.length,
        lowValueQuotesReady: lowValueQuotesReady.length,
        lowValueOrdersReady: lowValueOrdersReady.length,
        catalogReadyCount: Number(catalogAudit?.readyCount || 0),
        catalogBlockingRepairCount: blockingRepairCount,
      },
    };
  }

  async runOnce(trigger: AutomationRun["trigger"] = "manual") {
    if (this.running) {
      const skipped: AutomationRun = {
        trigger,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        skipped: true,
        reason: "automation_already_running",
        steps: [],
        errors: [],
        results: {},
      };
      this.lastRun = skipped;
      this.recordRun(skipped);
      return skipped;
    }

    this.running = true;
    const startedAt = new Date();
    this.runningStartedAt = startedAt.toISOString();
    const run: AutomationRun = {
      trigger,
      startedAt: startedAt.toISOString(),
      steps: [],
      errors: [],
      results: {},
    };

    try {
      await this.captureStep(run, "pollActiveResults", () =>
        this.designJobs.pollActiveResults(appConfig.lowValueAutomationPollLimit),
      );
      await this.captureStep(run, "lowValueAutomation", () => this.designJobs.runLowValueAutomation());
      await this.captureStep(run, "scanTimeouts", () => this.designJobs.scanTimeouts());
      await this.captureStep(run, "scanSendOperations", () => this.wechatDispatch.scanSendOperations());
      if (appConfig.lowValueAutomationProcessSendQueue) {
        await this.captureStep(run, "processLowValueSendQueue", () =>
          this.wechatDispatch.processSafeSendQueue({
            limit: appConfig.lowValueAutomationSendQueueLimit,
            automationOnly: true,
          }),
        );
      }
      await this.captureStep(run, "scanLowValueOrderDrafts", () => this.orders.scanLowValueAutoOrderDrafts());
      await this.captureStep(run, "scanLowValueOrderConfirmations", () =>
        this.wechatDispatch.scanLowValueOrderConfirmations(),
      );
      await this.captureStep(run, "scanLowValueOrderFollowups", () =>
        this.wechatDispatch.scanLowValueOrderFollowups(),
      );
    } finally {
      run.completedAt = new Date().toISOString();
      run.durationMs = Date.now() - startedAt.getTime();
      this.runCount += 1;
      this.lastRun = run;
      this.recordRun(run);
      this.running = false;
      this.runningStartedAt = null;
    }
    return run;
  }

  private recordRun(run: AutomationRun) {
    this.recentRuns = [run, ...this.recentRuns].slice(0, 10);
    try {
      this.store?.saveAutomationRun(run, 10);
    } catch (error) {
      run.errors.push({
        step: "persistAutomationRun",
        errorMessage: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  private async captureStep(run: AutomationRun, step: string, action: () => Promise<unknown>) {
    const startedAt = Date.now();
    try {
      run.results[step] = await action();
      run.steps.push({
        step,
        status: "completed",
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      run.errors.push({
        step,
        errorMessage,
      });
      run.steps.push({
        step,
        status: "failed",
        durationMs: Date.now() - startedAt,
        errorMessage,
      });
    }
  }

  private async safeCatalogAudit() {
    try {
      return await this.catalog?.auditSkus();
    } catch {
      return null;
    }
  }

  private async safeDesignPlatformHealth() {
    if (!this.designPlatform) return { ok: false, errorMessage: "设计平台客户端未配置。" };
    try {
      await this.designPlatform.health();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        errorMessage: error instanceof Error ? error.message : "设计平台健康检查失败。",
      };
    }
  }

  private async safeListDesignJobs() {
    try {
      return await this.designJobs.list();
    } catch {
      return [];
    }
  }
}
