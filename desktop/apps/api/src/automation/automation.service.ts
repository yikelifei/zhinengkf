import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { CatalogService } from "../catalog/catalog.service";
import { DesignJobsService } from "../design-jobs/design-jobs.service";
import { DesignPlatformClient } from "../integrations/design-platform/design-platform.client";
import { LocalStoreService } from "../local-store/local-store.service";
import { OrdersService } from "../orders/orders.service";
import { appConfig } from "../shared/app-config";
import { rules } from "../shared/rules";
import { WechatDispatchService } from "../wechat/wechat-dispatch.service";

const { isHighValueBudget } = rules;

type IdentityFields = {
  wechatAccountId?: string;
  conversationId?: string;
  customerId?: string;
};

type AutomationIdentityAudit = {
  status: "passed" | "warning";
  identityCount: number;
  identities: Array<IdentityFields & { key: string; count: number; steps: string[] }>;
  warnings: Array<{ step: string; path: string; reason: string; fields?: string[] }>;
};

type AutomationSkipSummary = {
  total: number;
  reasons: Array<{
    reason: string;
    count: number;
    steps: string[];
    sampleTargets: string[];
  }>;
};

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
  identityAudit?: AutomationIdentityAudit;
  skipSummary?: AutomationSkipSummary;
};

const AUTOMATION_IDENTITY_SOURCE_KEYS = new Set([
  "submitted",
  "queued",
  "created",
  "updated",
  "processed",
  "sent",
  "timedOut",
  "failed",
]);

function normalizeIdentityValue(value: unknown) {
  return String(value || "").trim();
}

function collectIdentityValues(record: any, field: keyof IdentityFields) {
  const values = new Set<string>();
  const candidates = [
    record?.[field],
    record?.identityBinding?.[field],
    record?.conversation?.[field],
    record?.designJob?.[field],
    record?.quoteDraft?.[field],
    record?.orderDraft?.[field],
    record?.sendTask?.[field],
    record?.target?.[field],
  ];
  for (const candidate of candidates) {
    const value = normalizeIdentityValue(candidate);
    if (value) values.add(value);
  }
  return [...values];
}

function extractAutomationIdentity(record: any): IdentityFields {
  const identity: IdentityFields = {};
  for (const field of ["wechatAccountId", "conversationId", "customerId"] as const) {
    const values = collectIdentityValues(record, field);
    if (values.length === 1) identity[field] = values[0];
  }
  return identity;
}

function automationIdentityKey(identity: IdentityFields) {
  return [
    identity.wechatAccountId || "*",
    identity.conversationId || "*",
    identity.customerId || "*",
  ].join("|");
}

function collectAutomationIdentityRecords(step: string, value: unknown, path: string, records: any[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAutomationIdentityRecords(step, item, `${path}[${index}]`, records));
    return;
  }
  const entry = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(entry)) {
    if (AUTOMATION_IDENTITY_SOURCE_KEYS.has(key) && Array.isArray(child)) {
      child.forEach((item, index) => {
        records.push({ step, path: `${path}.${key}[${index}]`, item });
      });
      continue;
    }
    if (child && typeof child === "object") {
      collectAutomationIdentityRecords(step, child, `${path}.${key}`, records);
    }
  }
}

function buildAutomationIdentityAudit(run: AutomationRun): AutomationIdentityAudit {
  const records: Array<{ step: string; path: string; item: any }> = [];
  for (const [step, result] of Object.entries(run.results || {})) {
    if (step === "readiness") continue;
    collectAutomationIdentityRecords(step, result, step, records);
  }

  const identityMap = new Map<string, IdentityFields & { key: string; count: number; steps: Set<string> }>();
  const warnings: AutomationIdentityAudit["warnings"] = [];
  for (const record of records) {
    const conflictFields = (["wechatAccountId", "conversationId", "customerId"] as const).filter(
      (field) => collectIdentityValues(record.item, field).length > 1,
    );
    if (conflictFields.length) {
      warnings.push({ step: record.step, path: record.path, reason: "identity_field_conflict", fields: conflictFields });
      continue;
    }
    const identity = extractAutomationIdentity(record.item);
    if (!identity.wechatAccountId && !identity.conversationId && !identity.customerId) {
      warnings.push({ step: record.step, path: record.path, reason: "missing_identity" });
      continue;
    }
    const key = automationIdentityKey(identity);
    const current = identityMap.get(key) || { ...identity, key, count: 0, steps: new Set<string>() };
    current.count += 1;
    current.steps.add(record.step);
    identityMap.set(key, current);
  }

  const identities = [...identityMap.values()]
    .map((item) => ({
      key: item.key,
      wechatAccountId: item.wechatAccountId,
      conversationId: item.conversationId,
      customerId: item.customerId,
      count: item.count,
      steps: [...item.steps].sort(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    status: warnings.length ? "warning" : "passed",
    identityCount: identities.length,
    identities,
    warnings,
  };
}

function firstStringValue(record: any, keys: string[]) {
  for (const key of keys) {
    const value = String(record?.[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function collectAutomationSkippedRecords(step: string, value: unknown, records: any[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectAutomationSkippedRecords(step, item, records));
    return;
  }
  const entry = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(entry)) {
    if (key === "skipped" && Array.isArray(child)) {
      child.forEach((item) => records.push({ step, item }));
      continue;
    }
    if (child && typeof child === "object") {
      collectAutomationSkippedRecords(step, child, records);
    }
  }
}

function buildAutomationSkipSummary(run: AutomationRun): AutomationSkipSummary {
  const records: Array<{ step: string; item: any }> = [];
  if (run.skipped && run.reason) {
    records.push({ step: "run", item: { reason: run.reason } });
  }
  for (const [step, result] of Object.entries(run.results || {})) {
    collectAutomationSkippedRecords(step, result, records);
  }

  const grouped = new Map<string, { reason: string; count: number; steps: Set<string>; sampleTargets: Set<string> }>();
  for (const record of records) {
    const reason = firstStringValue(record.item, ["reason", "skipReason", "code"]) || "unknown";
    const current =
      grouped.get(reason) || { reason, count: 0, steps: new Set<string>(), sampleTargets: new Set<string>() };
    current.count += 1;
    current.steps.add(record.step);
    const target = firstStringValue(record.item, [
      "designJobId",
      "quoteDraftId",
      "orderDraftId",
      "sendTaskId",
      "requestId",
      "conversationId",
      "customerId",
      "wechatAccountId",
    ]);
    if (target && current.sampleTargets.size < 3) current.sampleTargets.add(target);
    grouped.set(reason, current);
  }

  const reasons = [...grouped.values()]
    .map((item) => ({
      reason: item.reason,
      count: item.count,
      steps: [...item.steps].sort(),
      sampleTargets: [...item.sampleTargets],
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return {
    total: records.length,
    reasons,
  };
}

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
          ? "先补齐商品类型、图片、价格、库存、礼盒和内搭结构。"
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
    const isLowValueDesignJob = (job: any) => !job.isHighValue && !isHighValueBudget(job.budget, appConfig.highValueAmountCny);
    const isHighValueAmount = (total?: unknown, unit?: unknown) => {
      const totalAmount = Number(total || 0);
      const unitAmount = Number(unit || 0);
      return (
        (Number.isFinite(totalAmount) && totalAmount >= appConfig.highValueAmountCny) ||
        (Number.isFinite(unitAmount) && unitAmount >= appConfig.highValueAmountCny)
      );
    };
    const isLowValueQuote = (quote: any) =>
      !quote.isHighValue &&
      !quote.designJob?.isHighValue &&
      !isHighValueBudget(quote.designJob?.budget, appConfig.highValueAmountCny) &&
      !isHighValueAmount(quote.totalPrice, quote.unitPrice);
    const isLowValueOrder = (order: any) =>
      !order.isHighValue &&
      !order.designJob?.isHighValue &&
      !order.quoteDraft?.designJob?.isHighValue &&
      !isHighValueBudget(order.designJob?.budget || order.quoteDraft?.designJob?.budget, appConfig.highValueAmountCny) &&
      !isHighValueAmount(order.totalPrice ?? order.quoteDraft?.totalPrice, order.unitPrice ?? order.quoteDraft?.unitPrice);
    const lowValueDrafts = designJobs.filter((job: any) => job.status === "draft" && isLowValueDesignJob(job));
    const quickConfirmJobs = designJobs.filter((job: any) => job.status === "quick_confirm" && isLowValueDesignJob(job));
    const pendingSendTasks = sendTasks.filter((task: any) => ["queued", "sending", "pending_ack"].includes(String(task.status || "")));
    const manualLockedConversations = conversations.filter((conversation: any) => conversation.manualLocked || conversation.status === "manual_locked");
    const lowValueQuotesReady = quoteDrafts.filter((quote: any) => isLowValueQuote(quote) && ["draft", "auto_sent", "accepted"].includes(String(quote.status || "")));
    const lowValueOrdersReady = orderDrafts.filter((order: any) => isLowValueOrder(order) && ["confirmed", "paid", "processing", "fulfilled"].includes(String(order.status || "")));

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

  async runOnce(trigger: AutomationRun["trigger"] = "manual", filter: IdentityFields = {}) {
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
      skipped.skipSummary = buildAutomationSkipSummary(skipped);
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
      const readiness = await this.readiness();
      run.results.readiness = readiness;
      if (!readiness.ready) {
        run.skipped = true;
        run.reason = "automation_readiness_blocked";
        return run;
      }

      await this.captureStep(run, "pollActiveResults", () =>
        this.designJobs.pollActiveResults(appConfig.lowValueAutomationPollLimit, filter),
      );
      await this.captureStep(run, "lowValueAutomation", () => this.designJobs.runLowValueAutomation(filter));
      await this.captureStep(run, "scanTimeouts", () => this.designJobs.scanTimeouts(filter));
      await this.captureStep(run, "scanSendOperations", () => this.wechatDispatch.scanSendOperations(filter));
      if (appConfig.lowValueAutomationProcessSendQueue) {
        await this.captureStep(run, "processLowValueSendQueue", () =>
          this.wechatDispatch.processSafeSendQueue({
            limit: appConfig.lowValueAutomationSendQueueLimit,
            automationOnly: true,
            ...filter,
          }),
        );
      }
      await this.captureStep(run, "scanLowValueOrderDrafts", () => this.orders.scanLowValueAutoOrderDrafts(filter));
      await this.captureStep(run, "scanLowValueOrderConfirmations", () =>
        this.wechatDispatch.scanLowValueOrderConfirmations(filter),
      );
      await this.captureStep(run, "scanLowValueOrderFollowups", () =>
        this.wechatDispatch.scanLowValueOrderFollowups(filter),
      );
    } finally {
      run.completedAt = new Date().toISOString();
      run.durationMs = Date.now() - startedAt.getTime();
      run.identityAudit = buildAutomationIdentityAudit(run);
      run.skipSummary = buildAutomationSkipSummary(run);
      if (!run.skipped) this.runCount += 1;
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
