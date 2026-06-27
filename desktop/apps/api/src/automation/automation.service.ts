import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DesignJobsService } from "../design-jobs/design-jobs.service";
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
  errors: Array<{ step: string; errorMessage: string }>;
  results: Record<string, unknown>;
};

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private startedAt: string | null = null;
  private lastRun: AutomationRun | null = null;
  private runCount = 0;

  constructor(
    private readonly designJobs: DesignJobsService,
    private readonly orders: OrdersService,
    private readonly wechatDispatch: WechatDispatchService,
  ) {}

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
    this.timer = setInterval(() => {
      void this.runOnce("interval");
    }, intervalMs);
    this.timer.unref?.();
    return this.status();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.status();
  }

  status() {
    return {
      enabled: appConfig.lowValueAutomationEnabled,
      running: this.running,
      active: Boolean(this.timer),
      startedAt: this.startedAt,
      intervalMs: Math.max(3000, appConfig.lowValueAutomationIntervalMs),
      processSendQueue: appConfig.lowValueAutomationProcessSendQueue,
      sendQueueLimit: appConfig.lowValueAutomationSendQueueLimit,
      pollLimit: appConfig.lowValueAutomationPollLimit,
      runCount: this.runCount,
      lastRun: this.lastRun,
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
        errors: [],
        results: {},
      };
      this.lastRun = skipped;
      return skipped;
    }

    this.running = true;
    const startedAt = new Date();
    const run: AutomationRun = {
      trigger,
      startedAt: startedAt.toISOString(),
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
      this.running = false;
    }
    return run;
  }

  private async captureStep(run: AutomationRun, step: string, action: () => Promise<unknown>) {
    try {
      run.results[step] = await action();
    } catch (error) {
      run.errors.push({
        step,
        errorMessage: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
}
