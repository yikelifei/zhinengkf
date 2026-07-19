import { Queue, Worker } from "bullmq";

export const AUTOMATION_QUEUE_NAME = "low-value-automation";
export const AUTOMATION_SCHEDULER_ID = "low-value-automation-schedule-v1";
export const AUTOMATION_JOB_NAME = "run-low-value-automation";

export type AutomationSchedulerMode = "interval" | "durable" | "invalid";

export type AutomationQueueConfig = {
  enabled: boolean;
  mode: AutomationSchedulerMode;
  intervalMs: number;
  redisUrl: string;
};

type QueueJobLike = {
  id?: string;
  name?: string;
  timestamp?: number;
  finishedOn?: number;
  failedReason?: string;
  returnvalue?: unknown;
};

export type AutomationQueueLike = {
  waitUntilReady?: () => Promise<unknown>;
  upsertJobScheduler: (
    schedulerId: string,
    repeat: { every: number },
    template: { name: string; data: Record<string, never>; opts: Record<string, unknown> },
  ) => Promise<unknown>;
  removeJobScheduler: (schedulerId: string) => Promise<boolean>;
  setGlobalConcurrency: (concurrency: number) => Promise<unknown>;
  getGlobalConcurrency?: () => Promise<number | null>;
  getJobScheduler?: (schedulerId: string) => Promise<unknown>;
  getJobCounts?: (...types: string[]) => Promise<Record<string, number>>;
  getWorkersCount?: () => Promise<number>;
  getCompleted?: (start: number, end: number) => Promise<QueueJobLike[]>;
  getFailed?: (start: number, end: number) => Promise<QueueJobLike[]>;
  on?: (event: "error", listener: (error: Error) => void) => unknown;
  close: () => Promise<void>;
};

export type AutomationWorkerLike = {
  waitUntilReady?: () => Promise<unknown>;
  on: (event: "error" | "failed", listener: (...args: any[]) => void) => unknown;
  close: () => Promise<void>;
};

export type AutomationQueueFactory = {
  createQueue: (redisUrl: string) => AutomationQueueLike;
  createWorker: (
    redisUrl: string,
    processor: (job: { id?: string; name?: string }) => Promise<unknown>,
  ) => AutomationWorkerLike;
};

export type DurableAutomationRun = () => Promise<unknown>;

function safeJobEvidence(job?: QueueJobLike) {
  if (!job) return null;
  return {
    id: job.id || null,
    name: job.name || null,
    timestamp: Number.isFinite(job.timestamp) ? job.timestamp : null,
    finishedOn: Number.isFinite(job.finishedOn) ? job.finishedOn : null,
    failed: Boolean(job.failedReason),
    result: job.failedReason ? null : sanitizeRunResult(job.returnvalue),
  };
}

function safeSchedulerEvidence(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const scheduler = value as Record<string, unknown>;
  const next = Number(scheduler.next);
  return {
    present: true,
    next: Number.isFinite(next) ? next : null,
  };
}

function sanitizeRunResult(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  return {
    trigger: typeof source.trigger === "string" ? source.trigger : "interval",
    startedAt: typeof source.startedAt === "string" ? source.startedAt : null,
    completedAt: typeof source.completedAt === "string" ? source.completedAt : null,
    durationMs: Number.isFinite(source.durationMs) ? source.durationMs : null,
    skipped: Boolean(source.skipped),
    reason: typeof source.reason === "string" ? source.reason : null,
    errorCount: Array.isArray(source.errors) ? source.errors.length : Number(source.errorCount || 0),
  };
}

export function automationQueueReadiness(config: AutomationQueueConfig) {
  if (!config.enabled) {
    return {
      ready: true,
      status: "disabled" as const,
      detail: "低价值自动化未启用，未创建调度器。",
    };
  }
  if (config.mode === "invalid") {
    return {
      ready: false,
      status: "blocked" as const,
      detail: "LOW_VALUE_AUTOMATION_MODE 仅允许 interval 或 durable。",
    };
  }
  if (config.mode === "durable" && !config.redisUrl.trim()) {
    return {
      ready: false,
      status: "blocked" as const,
      detail: "durable 模式缺少 LOW_VALUE_AUTOMATION_REDIS_URL。",
    };
  }
  return {
    ready: true,
    status: "ready" as const,
    detail:
      config.mode === "durable"
        ? "durable 模式已配置 Redis（凭据不回显）。"
        : "interval 模式仅适用于单进程本地运行。",
  };
}

export class AutomationQueueRuntime {
  private queue: AutomationQueueLike | null = null;
  private worker: AutomationWorkerLike | null = null;
  private active = false;
  private connected = false;
  private scheduled = false;
  private workerReady = false;
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private lastWorkerErrorAt: string | null = null;
  private lastWorkerFailureAt: string | null = null;

  constructor(
    private readonly config: AutomationQueueConfig,
    private readonly runOnce: DurableAutomationRun,
    private readonly factory: AutomationQueueFactory = createBullMqFactory(),
  ) {}

  async start() {
    const readiness = automationQueueReadiness(this.config);
    if (!readiness.ready) throw new Error("automation durable scheduler configuration blocked");
    if (!this.config.enabled || this.config.mode !== "durable") return this.status();
    if (this.active) return this.status();

    try {
      const queue = this.factory.createQueue(this.config.redisUrl);
      this.queue = queue;
      queue.on?.("error", () => {
        this.connected = false;
        this.lastWorkerErrorAt = new Date().toISOString();
      });
      await queue.waitUntilReady?.();
      this.connected = true;
      await queue.setGlobalConcurrency(1);
      await queue.upsertJobScheduler(
        AUTOMATION_SCHEDULER_ID,
        { every: Math.max(3000, this.config.intervalMs) },
        {
          name: AUTOMATION_JOB_NAME,
          data: {},
          opts: {
            attempts: 1,
            removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100 },
            removeOnFail: { age: 30 * 24 * 60 * 60, count: 100 },
          },
        },
      );
      this.scheduled = true;

      const worker = this.factory.createWorker(this.config.redisUrl, async (job) => {
        if (job.name && job.name !== AUTOMATION_JOB_NAME) {
          throw new Error("unexpected automation queue job");
        }
        return sanitizeRunResult(await this.runOnce());
      });
      this.worker = worker;
      worker.on("error", () => {
        this.workerReady = false;
        this.lastWorkerErrorAt = new Date().toISOString();
      });
      worker.on("failed", () => {
        this.lastWorkerFailureAt = new Date().toISOString();
      });
      await worker.waitUntilReady?.();
      this.workerReady = true;
      this.active = true;
      this.startedAt = new Date().toISOString();
      this.stoppedAt = null;
      return this.status();
    } catch {
      await this.closeResources();
      throw new Error("automation durable scheduler startup failed");
    }
  }

  async stop(options: { removeSchedule?: boolean } = {}) {
    if (options.removeSchedule && this.queue) {
      await this.queue.removeJobScheduler(AUTOMATION_SCHEDULER_ID);
      this.scheduled = false;
    }
    await this.closeResources();
    this.stoppedAt = new Date().toISOString();
    return this.status();
  }

  async status() {
    const durableEvidence = await this.readDurableEvidence();
    return {
      mode: this.config.mode,
      evidenceSource: "bullmq_redis" as const,
      enabled: this.config.enabled,
      active: this.active,
      configured: Boolean(this.config.redisUrl.trim()),
      connected: this.connected,
      scheduled: this.scheduled,
      workerReady: this.workerReady,
      localConcurrency: 1,
      globalConcurrency: durableEvidence.globalConcurrency,
      intervalMs: Math.max(3000, this.config.intervalMs),
      queueName: AUTOMATION_QUEUE_NAME,
      schedulerId: AUTOMATION_SCHEDULER_ID,
      attempts: 1,
      maxStalledCount: 0,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      lastWorkerErrorAt: this.lastWorkerErrorAt,
      lastWorkerFailureAt: this.lastWorkerFailureAt,
      durableEvidence,
    };
  }

  private async readDurableEvidence() {
    if (!this.queue || !this.connected) {
      return {
        available: false,
        scheduler: null,
        globalConcurrency: null,
        workerCount: 0,
        counts: {},
        latestCompleted: null,
        latestFailed: null,
      };
    }
    try {
      const [scheduler, globalConcurrency, workerCount, counts, completed, failed] = await Promise.all([
        this.queue.getJobScheduler?.(AUTOMATION_SCHEDULER_ID) ?? null,
        this.queue.getGlobalConcurrency?.() ?? null,
        this.queue.getWorkersCount?.() ?? 0,
        this.queue.getJobCounts?.("waiting", "active", "delayed", "completed", "failed") ?? {},
        this.queue.getCompleted?.(0, 0) ?? [],
        this.queue.getFailed?.(0, 0) ?? [],
      ]);
      return {
        available: true,
        scheduler: safeSchedulerEvidence(scheduler),
        globalConcurrency,
        workerCount,
        counts,
        latestCompleted: safeJobEvidence(completed[0]),
        latestFailed: safeJobEvidence(failed[0]),
      };
    } catch {
      this.connected = false;
      this.lastWorkerErrorAt = new Date().toISOString();
      return {
        available: false,
        scheduler: null,
        globalConcurrency: null,
        workerCount: 0,
        counts: {},
        latestCompleted: null,
        latestFailed: null,
      };
    }
  }

  private async closeResources() {
    const worker = this.worker;
    const queue = this.queue;
    this.worker = null;
    this.queue = null;
    this.active = false;
    this.connected = false;
    this.workerReady = false;
    await worker?.close().catch(() => undefined);
    await queue?.close().catch(() => undefined);
  }
}

export function createBullMqFactory(): AutomationQueueFactory {
  return {
    createQueue(redisUrl) {
      const connection = redisConnectionOptions(redisUrl, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      });
      return new Queue(AUTOMATION_QUEUE_NAME, { connection: connection as any }) as unknown as AutomationQueueLike;
    },
    createWorker(redisUrl, processor) {
      const connection = redisConnectionOptions(redisUrl, {
        maxRetriesPerRequest: null,
      });
      return new Worker(AUTOMATION_QUEUE_NAME, processor, {
        connection: connection as any,
        concurrency: 1,
        maxStalledCount: 0,
        lockDuration: 5 * 60 * 1000,
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 100 },
      }) as unknown as AutomationWorkerLike;
    },
  };
}

function redisConnectionOptions(
  redisUrl: string,
  extra: { enableOfflineQueue?: boolean; maxRetriesPerRequest: number | null },
) {
  const parsed = new URL(redisUrl);
  if (!(["redis:", "rediss:"] as string[]).includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("automation Redis URL is invalid");
  }
  const databaseText = parsed.pathname.replace(/^\//, "");
  const database = databaseText ? Number(databaseText) : 0;
  if (!Number.isInteger(database) || database < 0) throw new Error("automation Redis database is invalid");
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: database,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    ...extra,
  };
}
