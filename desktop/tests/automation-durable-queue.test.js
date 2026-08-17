"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const {
  AUTOMATION_JOB_NAME,
  AUTOMATION_SCHEDULER_ID,
  AutomationQueueRuntime,
  automationQueueReadiness,
} = require("../apps/api/src/automation/automation-queue.runtime");

function createFakeFactory(overrides = {}) {
  const calls = {
    createQueue: 0,
    createWorker: 0,
    queueClose: 0,
    workerClose: 0,
    removeScheduler: 0,
    setGlobalConcurrency: [],
    upserts: [],
  };
  const queueListeners = {};
  const workerListeners = {};
  const queue = {
    waitUntilReady: async () => undefined,
    setGlobalConcurrency: async (value) => calls.setGlobalConcurrency.push(value),
    upsertJobScheduler: async (...args) => calls.upserts.push(args),
    removeJobScheduler: async (id) => {
      assert.equal(id, AUTOMATION_SCHEDULER_ID);
      calls.removeScheduler += 1;
      return true;
    },
    getGlobalConcurrency: async () => 1,
    getJobScheduler: async () => ({ id: AUTOMATION_SCHEDULER_ID, next: Date.now() + 1000 }),
    getWorkersCount: async () => 1,
    getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 1, completed: 3, failed: 1 }),
    getCompleted: async () => [
      {
        id: "completed-1",
        name: AUTOMATION_JOB_NAME,
        timestamp: 100,
        finishedOn: 200,
        returnvalue: {
          trigger: "interval",
          startedAt: "2026-07-19T00:00:00.000Z",
          completedAt: "2026-07-19T00:00:01.000Z",
          durationMs: 1000,
          errors: [],
          secret: "must-not-surface",
        },
      },
    ],
    getFailed: async () => [
      {
        id: "failed-1",
        name: AUTOMATION_JOB_NAME,
        failedReason: "redis://user:password@secret-host/0",
      },
    ],
    on: (event, listener) => {
      queueListeners[event] = listener;
    },
    close: async () => {
      calls.queueClose += 1;
    },
    ...(overrides.queue || {}),
  };
  const worker = {
    waitUntilReady: async () => undefined,
    on: (event, listener) => {
      workerListeners[event] = listener;
    },
    close: async () => {
      calls.workerClose += 1;
    },
    ...(overrides.worker || {}),
  };
  const factory = {
    createQueue: () => {
      calls.createQueue += 1;
      return queue;
    },
    createWorker: (_url, processor) => {
      calls.createWorker += 1;
      calls.processor = processor;
      return worker;
    },
  };
  return { calls, queue, queueListeners, worker, workerListeners, factory };
}

function durableConfig(overrides = {}) {
  return {
    enabled: true,
    mode: "durable",
    intervalMs: 15000,
    redisUrl: "redis://automation-user:super-secret@redis.internal:6379/0",
    ...overrides,
  };
}

test("local interval mode needs no Redis connection", () => {
  const check = automationQueueReadiness(durableConfig({ mode: "interval", redisUrl: "" }));
  assert.equal(check.ready, true);
  assert.match(check.detail, /单进程本地/);
});

test("production defaults to durable and missing Redis stays fail-closed", () => {
  const script = [
    'require("ts-node").register({transpileOnly:true,compilerOptions:{module:"CommonJS"}});',
    'const {appConfig}=require("./apps/api/src/shared/app-config");',
    'const {automationQueueReadiness}=require("./apps/api/src/automation/automation-queue.runtime");',
    'const check=automationQueueReadiness({enabled:true,mode:appConfig.lowValueAutomationMode,intervalMs:15000,redisUrl:appConfig.lowValueAutomationRedisUrl});',
    'process.stdout.write(JSON.stringify({mode:appConfig.lowValueAutomationMode,configured:Boolean(appConfig.lowValueAutomationRedisUrl),ready:check.ready,detail:check.detail}));',
  ].join("");
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DESKTOP_ENV_FILE: path.join(__dirname, "missing-production.env"),
      LOW_VALUE_AUTOMATION_REDIS_URL: "",
      LOW_VALUE_AUTOMATION_MODE: "",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload, {
    mode: "durable",
    configured: false,
    ready: false,
    detail: "durable 模式缺少 LOW_VALUE_AUTOMATION_REDIS_URL。",
  });
});

test("production rejects an explicit interval mode instead of starting a local timer", () => {
  const script = [
    'require("ts-node").register({transpileOnly:true,compilerOptions:{module:"CommonJS"}});',
    'const {appConfig}=require("./apps/api/src/shared/app-config");',
    'process.stdout.write(JSON.stringify({mode:appConfig.lowValueAutomationMode}));',
  ].join("");
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DESKTOP_ENV_FILE: path.join(__dirname, "missing-production.env"),
      LOW_VALUE_AUTOMATION_MODE: "interval",
      LOW_VALUE_AUTOMATION_REDIS_URL: "redis://ignored:secret@redis.internal:6379/0",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { mode: "invalid" });
  assert.equal(result.stdout.includes("secret"), false);
});

test("packaged desktop runtime can use local interval automation without weakening server production defaults", () => {
  const script = [
    'require("ts-node").register({transpileOnly:true,compilerOptions:{module:"CommonJS"}});',
    'const {appConfig}=require("./apps/api/src/shared/app-config");',
    'process.stdout.write(JSON.stringify({mode:appConfig.lowValueAutomationMode}));',
  ].join("");
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      SMART_KEFU_RUNTIME_TARGET: "desktop",
      DESKTOP_ENV_FILE: path.join(__dirname, "missing-production.env"),
      LOW_VALUE_AUTOMATION_MODE: "",
      LOW_VALUE_AUTOMATION_REDIS_URL: "",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { mode: "interval" });
});

test("durable start upserts one scheduler, sets global concurrency one, and never configures job retry", async () => {
  const fake = createFakeFactory();
  const runtime = new AutomationQueueRuntime(durableConfig(), async () => ({ trigger: "interval", errors: [] }), fake.factory);

  await runtime.start();
  await runtime.start();

  assert.equal(fake.calls.createQueue, 1);
  assert.equal(fake.calls.createWorker, 1);
  assert.deepEqual(fake.calls.setGlobalConcurrency, [1]);
  assert.equal(fake.calls.upserts.length, 1);
  const [schedulerId, repeat, template] = fake.calls.upserts[0];
  assert.equal(schedulerId, AUTOMATION_SCHEDULER_ID);
  assert.deepEqual(repeat, { every: 15000 });
  assert.equal(template.name, AUTOMATION_JOB_NAME);
  assert.equal(template.opts.attempts, 1);
  assert.equal(JSON.stringify(template.opts).includes("backoff"), false);

  await runtime.stop();
});

test("durable worker calls runOnce once and unknown delivery result is not replayed", async () => {
  const fake = createFakeFactory();
  let runs = 0;
  const runtime = new AutomationQueueRuntime(
    durableConfig(),
    async () => {
      runs += 1;
      return {
        trigger: "interval",
        startedAt: "2026-07-19T00:00:00.000Z",
        completedAt: "2026-07-19T00:00:01.000Z",
        errors: [{ step: "processLowValueSendQueue", errorMessage: "delivery unknown" }],
      };
    },
    fake.factory,
  );
  await runtime.start();
  const result = await fake.calls.processor({ name: AUTOMATION_JOB_NAME, id: "job-1" });
  assert.equal(runs, 1);
  assert.equal(result.errorCount, 1);
  assert.equal(JSON.stringify(result).includes("delivery unknown"), false);
  await runtime.stop();
});

test("status uses BullMQ persistent evidence and redacts Redis URL and failure reason", async () => {
  const fake = createFakeFactory();
  const secretUrl = durableConfig().redisUrl;
  const runtime = new AutomationQueueRuntime(durableConfig(), async () => ({}), fake.factory);
  await runtime.start();
  const status = await runtime.status();
  const serialized = JSON.stringify(status);

  assert.equal(status.durableEvidence.available, true);
  assert.equal(status.evidenceSource, "bullmq_redis");
  assert.equal(status.durableEvidence.globalConcurrency, 1);
  assert.equal(status.durableEvidence.workerCount, 1);
  assert.equal(status.durableEvidence.counts.completed, 3);
  assert.equal(status.durableEvidence.latestCompleted.result.errorCount, 0);
  assert.equal(status.durableEvidence.latestFailed.failed, true);
  assert.equal(status.configured, true);
  assert.equal(serialized.includes(secretUrl), false);
  assert.equal(serialized.includes("super-secret"), false);
  assert.equal(serialized.includes("secret-host"), false);
  assert.equal(serialized.includes("must-not-surface"), false);
  await runtime.stop();
});

test("worker error is bounded evidence and graceful shutdown closes worker before queue", async () => {
  const order = [];
  const fake = createFakeFactory({
    worker: { close: async () => order.push("worker") },
    queue: { close: async () => order.push("queue") },
  });
  const runtime = new AutomationQueueRuntime(durableConfig(), async () => ({}), fake.factory);
  await runtime.start();
  fake.workerListeners.error(new Error("redis://user:password@secret-host/0"));
  const errored = await runtime.status();
  assert.equal(errored.workerReady, false);
  assert.ok(errored.lastWorkerErrorAt);
  assert.equal(JSON.stringify(errored).includes("password"), false);

  await runtime.stop();
  assert.deepEqual(order, ["worker", "queue"]);
});

test("operator stop removes the global schedule while shutdown only closes resources", async () => {
  const fake = createFakeFactory();
  const runtime = new AutomationQueueRuntime(durableConfig(), async () => ({}), fake.factory);
  await runtime.start();
  await runtime.stop({ removeSchedule: true });
  assert.equal(fake.calls.removeScheduler, 1);
  assert.equal(fake.calls.workerClose, 1);
  assert.equal(fake.calls.queueClose, 1);
});

test("partial startup failure closes every resource without exposing connection details", async () => {
  const fake = createFakeFactory({
    worker: {
      waitUntilReady: async () => {
        throw new Error("redis://user:password@secret-host/0 refused");
      },
    },
  });
  const runtime = new AutomationQueueRuntime(durableConfig(), async () => ({}), fake.factory);
  await assert.rejects(() => runtime.start(), /automation durable scheduler startup failed/);
  assert.equal(fake.calls.workerClose, 1);
  assert.equal(fake.calls.queueClose, 1);
  const status = await runtime.status();
  assert.equal(status.active, false);
  assert.equal(status.connected, false);
  assert.equal(JSON.stringify(status).includes("password"), false);
});

test("source locks BullMQ Worker to one local consumer and zero stalled recovery", () => {
  const source = require("node:fs").readFileSync(
    path.resolve(__dirname, "../apps/api/src/automation/automation-queue.runtime.ts"),
    "utf8",
  );
  assert.match(source, /concurrency:\s*1/);
  assert.match(source, /maxStalledCount:\s*0/);
  assert.match(source, /attempts:\s*1/);
  assert.doesNotMatch(source, /backoff\s*:/);

  const schedulerSource = require("node:fs").readFileSync(
    path.resolve(__dirname, "../apps/api/src/automation/automation-scheduler.service.ts"),
    "utf8",
  );
  assert.match(schedulerSource, /evidenceSource:[\s\S]*?"bullmq_redis"/);
  assert.match(schedulerSource, /recentRunsSource:[\s\S]*?"local_compatibility_only"/);
  assert.match(schedulerSource, /manualRunEvidence:\s*"direct_execution_not_bullmq_job"/);
});
