"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { AutomationService } = require("../apps/api/src/automation/automation.service");

function createService(overrides = {}) {
  const designJobs = {
    pollActiveResults: async () => ({ scanned: 0 }),
    runLowValueAutomation: async () => ({ autoSubmit: { submitted: [] } }),
    scanTimeouts: async () => ({ scanned: 0 }),
    ...(overrides.designJobs || {}),
  };
  const orders = {
    scanLowValueAutoOrderDrafts: async () => ({ scanned: 0 }),
    ...(overrides.orders || {}),
  };
  const wechatDispatch = {
    scanSendOperations: async () => ({ scanned: 0 }),
    processSafeSendQueue: async () => ({ processed: [] }),
    scanLowValueOrderConfirmations: async () => ({ scanned: 0 }),
    scanLowValueOrderFollowups: async () => ({ scanned: 0 }),
    ...(overrides.wechatDispatch || {}),
  };
  const catalog = {
    auditSkus: async () => ({
      total: 2,
      readyCount: 2,
      catalogStructureIssueCount: 0,
      blockingRepairCount: 0,
    }),
    ...(overrides.catalog || {}),
  };
  const designPlatform = {
    health: async () => ({ ok: true }),
    ...(overrides.designPlatform || {}),
  };
  return new AutomationService(designJobs, orders, wechatDispatch, overrides.store, catalog, designPlatform);
}

test("automation status exposes next scheduled run while active", () => {
  const service = createService();
  const before = Date.now();

  const started = service.start();

  assert.equal(started.active, true);
  assert.equal(started.running, false);
  assert.ok(started.startedAt);
  assert.ok(started.nextRunAt);
  assert.equal(started.runningStartedAt, null);
  assert.ok(Date.parse(started.nextRunAt) >= before);

  const stopped = service.stop();
  assert.equal(stopped.active, false);
  assert.equal(stopped.nextRunAt, null);
});

test("automation run records last run and clears running marker", async () => {
  const service = createService();

  const run = await service.runOnce("manual");
  const status = service.status();

  assert.equal(run.trigger, "manual");
  assert.ok(run.completedAt);
  assert.equal(status.running, false);
  assert.equal(status.runningStartedAt, null);
  assert.equal(status.runCount, 1);
  assert.equal(status.lastRun, run);
  assert.equal(status.recentRuns.length, 1);
  assert.equal(status.recentRuns[0], run);
  assert.ok(run.steps.length >= 7);
  assert.equal(run.steps[0].step, "pollActiveResults");
  assert.equal(run.steps[0].status, "completed");
  assert.equal(typeof run.steps[0].durationMs, "number");
});

test("automation status keeps recent runs newest first with a cap", async () => {
  const service = createService();

  for (let index = 0; index < 12; index += 1) {
    await service.runOnce("manual");
  }

  const status = service.status();
  assert.equal(status.runCount, 12);
  assert.equal(status.recentRuns.length, 10);
  assert.equal(status.recentRuns[0], status.lastRun);
  assert.ok(Date.parse(status.recentRuns[0].startedAt) >= Date.parse(status.recentRuns[9].startedAt));
});

test("automation status restores persisted recent runs from store", async () => {
  const persistedRun = {
    trigger: "interval",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    steps: [],
    errors: [],
    results: {},
  };
  const skippedRun = {
    trigger: "manual",
    startedAt: "2026-01-01T00:00:02.000Z",
    completedAt: "2026-01-01T00:00:02.000Z",
    skipped: true,
    reason: "automation_already_running",
    steps: [],
    errors: [],
    results: {},
  };
  const saved = [];
  const service = createService({
    store: {
      listAutomationRuns: () => [skippedRun, persistedRun],
      saveAutomationRun: (run) => {
        saved.push(run);
        return run;
      },
    },
  });

  const initialStatus = service.status();
  assert.equal(initialStatus.lastRun, skippedRun);
  assert.deepEqual(initialStatus.recentRuns, [skippedRun, persistedRun]);
  assert.equal(initialStatus.runCount, 1);

  const run = await service.runOnce("manual");
  const nextStatus = service.status();
  assert.equal(saved[0], run);
  assert.equal(nextStatus.recentRuns[0], run);
  assert.equal(nextStatus.recentRuns[1], skippedRun);
  assert.equal(nextStatus.recentRuns[2], persistedRun);
  assert.equal(nextStatus.runCount, 2);
});

test("automation status persists skipped run when another run is active", async () => {
  let releaseRunningStep;
  const saved = [];
  const service = createService({
    catalog: {
      auditSkus: () =>
        new Promise((resolve) => {
          releaseRunningStep = () =>
            resolve({
              total: 2,
              readyCount: 2,
              catalogStructureIssueCount: 0,
              blockingRepairCount: 0,
            });
        }),
    },
    store: {
      listAutomationRuns: () => [],
      saveAutomationRun: (run) => {
        saved.push(run);
        return run;
      },
    },
  });

  const running = service.runOnce("manual");
  const skipped = await service.runOnce("interval");
  releaseRunningStep();
  await running;

  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, "automation_already_running");
  assert.equal(saved.some((run) => run === skipped), true);
});

test("automation run clears running marker when history persistence fails", async () => {
  const service = createService({
    store: {
      listAutomationRuns: () => [],
      saveAutomationRun: () => {
        throw new Error("disk full");
      },
    },
  });

  const run = await service.runOnce("manual");
  const status = service.status();

  assert.equal(status.running, false);
  assert.equal(status.runningStartedAt, null);
  assert.equal(status.lastRun, run);
  assert.equal(run.errors.some((error) => error.step === "persistAutomationRun"), true);
});

test("automation run is skipped before side effects when readiness has blockers", async () => {
  let lowValueRan = false;
  const service = createService({
    designJobs: {
      runLowValueAutomation: async () => {
        lowValueRan = true;
        return { autoSubmit: { submitted: [] } };
      },
    },
    catalog: {
      auditSkus: async () => ({
        total: 1,
        readyCount: 0,
        catalogStructureIssueCount: 1,
        blockingRepairCount: 2,
      }),
    },
  });

  const run = await service.runOnce("manual");
  const status = service.status();

  assert.equal(run.skipped, true);
  assert.equal(run.reason, "automation_readiness_blocked");
  assert.equal(run.steps.length, 0);
  assert.equal(lowValueRan, false);
  assert.equal(run.results.readiness.ready, false);
  assert.equal(run.results.readiness.blockers.some((item) => item.key === "sku_catalog"), true);
  assert.equal(status.runCount, 0);
  assert.equal(status.lastRun, run);
});

test("automation step timing records failures without stopping later steps", async () => {
  const service = createService({
    designJobs: {
      scanTimeouts: async () => {
        throw new Error("timeout scan failed");
      },
    },
  });

  const run = await service.runOnce("manual");

  const failedStep = run.steps.find((step) => step.step === "scanTimeouts");
  const laterStep = run.steps.find((step) => step.step === "scanSendOperations");
  assert.equal(failedStep.status, "failed");
  assert.equal(failedStep.errorMessage, "timeout scan failed");
  assert.equal(typeof failedStep.durationMs, "number");
  assert.equal(laterStep.status, "completed");
  assert.equal(run.errors[0].step, "scanTimeouts");
});

test("automation readiness allows running with manual lock warnings", async () => {
  const service = createService({
    designJobs: {
      list: async () => [
        { id: "job_1", status: "draft", isHighValue: false },
        { id: "job_2", status: "quick_confirm", isHighValue: false },
      ],
    },
    store: {
      listAutomationRuns: () => [],
      listSendTasks: () => [{ id: "send_1", status: "queued" }],
      listConversations: () => [{ id: "conversation_1", manualLocked: true }],
      listQuoteDrafts: () => [{ id: "quote_1", status: "accepted", isHighValue: false }],
      listOrderDrafts: () => [{ id: "order_1", status: "paid", isHighValue: false }],
    },
  });

  const readiness = await service.readiness();

  assert.equal(readiness.ready, true);
  assert.equal(readiness.tone, "warning");
  assert.equal(readiness.metrics.lowValueDrafts, 1);
  assert.equal(readiness.metrics.quickConfirmJobs, 1);
  assert.equal(readiness.metrics.pendingSendTasks, 1);
  assert.equal(readiness.metrics.manualLockedConversations, 1);
  assert.equal(readiness.warnings.some((item) => item.key === "manual_locks"), true);
});

test("automation readiness blocks when sku catalog cannot support automation", async () => {
  const service = createService({
    catalog: {
      auditSkus: async () => ({
        total: 1,
        readyCount: 0,
        catalogStructureIssueCount: 1,
        blockingRepairCount: 3,
      }),
    },
  });

  const readiness = await service.readiness();

  assert.equal(readiness.ready, false);
  assert.equal(readiness.tone, "error");
  assert.equal(readiness.blockers.some((item) => item.key === "sku_catalog"), true);
  assert.equal(readiness.metrics.catalogBlockingRepairCount, 3);
});

test("automation readiness warns when design platform health check fails", async () => {
  const service = createService({
    designPlatform: {
      health: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    },
  });

  const readiness = await service.readiness();

  assert.equal(readiness.ready, true);
  assert.equal(readiness.tone, "warning");
  assert.equal(readiness.warnings.some((item) => item.key === "design_platform"), true);
});
