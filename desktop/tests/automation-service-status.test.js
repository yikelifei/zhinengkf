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

test("manual automation run forwards selected conversation identity to each side-effect step", async () => {
  const calls = [];
  const selectedIdentity = {
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  };
  const service = createService({
    designJobs: {
      pollActiveResults: async (limit, filter) => {
        calls.push(["pollActiveResults", filter]);
        return { scanned: 0 };
      },
      runLowValueAutomation: async (filter) => {
        calls.push(["runLowValueAutomation", filter]);
        return { autoSubmit: { submitted: [] } };
      },
      scanTimeouts: async (filter) => {
        calls.push(["scanTimeouts", filter]);
        return { scanned: 0 };
      },
    },
    orders: {
      scanLowValueAutoOrderDrafts: async (filter) => {
        calls.push(["scanLowValueAutoOrderDrafts", filter]);
        return { scanned: 0 };
      },
    },
    wechatDispatch: {
      scanSendOperations: async (filter) => {
        calls.push(["scanSendOperations", filter]);
        return { scanned: 0 };
      },
      processSafeSendQueue: async (params) => {
        calls.push(["processSafeSendQueue", params]);
        return { processed: [] };
      },
      scanLowValueOrderConfirmations: async (filter) => {
        calls.push(["scanLowValueOrderConfirmations", filter]);
        return { scanned: 0 };
      },
      scanLowValueOrderFollowups: async (filter) => {
        calls.push(["scanLowValueOrderFollowups", filter]);
        return { scanned: 0 };
      },
    },
  });

  await service.runOnce("manual", selectedIdentity);

  for (const [step, payload] of calls) {
    assert.equal(payload.wechatAccountId, selectedIdentity.wechatAccountId, `${step} should receive wechat account`);
    assert.equal(payload.conversationId, selectedIdentity.conversationId, `${step} should receive conversation`);
    assert.equal(payload.customerId, selectedIdentity.customerId, `${step} should receive customer`);
  }
  assert.deepEqual(
    calls.map(([step]) => step),
    [
      "pollActiveResults",
      "runLowValueAutomation",
      "scanTimeouts",
      "scanSendOperations",
      "processSafeSendQueue",
      "scanLowValueAutoOrderDrafts",
      "scanLowValueOrderConfirmations",
      "scanLowValueOrderFollowups",
    ],
  );
});

test("automation run records identity audit for low value side effects", async () => {
  const service = createService({
    designJobs: {
      runLowValueAutomation: async () => ({
        imageSend: {
          queued: [
            {
              sendTaskId: "send_1",
              wechatAccountId: "wechat_demo_1",
              conversationId: "conversation_demo_1",
              customerId: "customer_demo_1",
            },
          ],
        },
      }),
    },
    wechatDispatch: {
      processSafeSendQueue: async () => ({
        processed: [
          {
            taskId: "send_1",
            sendTask: {
              wechatAccountId: "wechat_demo_1",
              conversationId: "conversation_demo_1",
              customerId: "customer_demo_1",
            },
          },
        ],
      }),
    },
  });

  const run = await service.runOnce("manual");

  assert.equal(run.identityAudit.status, "passed");
  assert.equal(run.identityAudit.identityCount, 1);
  assert.equal(run.identityAudit.identities[0].wechatAccountId, "wechat_demo_1");
  assert.equal(run.identityAudit.identities[0].conversationId, "conversation_demo_1");
  assert.equal(run.identityAudit.identities[0].customerId, "customer_demo_1");
  assert.deepEqual(run.identityAudit.identities[0].steps, ["lowValueAutomation", "processLowValueSendQueue"]);
  assert.deepEqual(run.identityAudit.warnings, []);
});

test("automation run identity audit warns on conflicting target identity", async () => {
  const service = createService({
    designJobs: {
      runLowValueAutomation: async () => ({
        imageSend: {
          queued: [
            {
              sendTaskId: "send_1",
              wechatAccountId: "wechat_demo_1",
              conversationId: "conversation_demo_1",
              customerId: "customer_demo_1",
              designJob: {
                wechatAccountId: "wechat_demo_2",
                conversationId: "conversation_demo_1",
                customerId: "customer_demo_1",
              },
            },
          ],
        },
      }),
    },
  });

  const run = await service.runOnce("manual");

  assert.equal(run.identityAudit.status, "warning");
  assert.equal(run.identityAudit.identityCount, 0);
  assert.equal(run.identityAudit.warnings[0].reason, "identity_field_conflict");
  assert.equal(run.identityAudit.warnings[0].step, "lowValueAutomation");
  assert.deepEqual(run.identityAudit.warnings[0].fields, ["wechatAccountId"]);
});

test("automation identity audit ignores skipped no-side-effect items", async () => {
  const service = createService({
    designJobs: {
      runLowValueAutomation: async () => ({
        autoSubmit: {
          skipped: [
            {
              designJobId: "design_legacy_1",
              requestId: "request_legacy_1",
              reason: "missing_required_info",
            },
          ],
        },
        imageSend: {
          skipped: [
            {
              designJobId: "design_legacy_2",
              requestId: "request_legacy_2",
              reason: "manual_lock",
            },
          ],
        },
      }),
    },
    orders: {
      scanLowValueAutoOrderDrafts: async () => ({
        scanned: 1,
        skipped: [
          {
            quoteDraftId: "quote_legacy_1",
            designJobId: "design_legacy_3",
            reason: "missing_selected_image",
          },
        ],
      }),
    },
  });

  const run = await service.runOnce("manual");

  assert.equal(run.identityAudit.status, "passed");
  assert.equal(run.identityAudit.identityCount, 0);
  assert.deepEqual(run.identityAudit.warnings, []);
});

test("automation run summarizes skipped reasons for operator triage", async () => {
  const service = createService({
    designJobs: {
      runLowValueAutomation: async () => ({
        autoSubmit: {
          skipped: [
            {
              designJobId: "design_skip_1",
              requestId: "request_skip_1",
              reason: "status_not_draft",
            },
            {
              designJobId: "design_skip_2",
              requestId: "request_skip_2",
              reason: "status_not_draft",
            },
          ],
        },
        imageSend: {
          skipped: [
            {
              designJobId: "design_skip_3",
              conversationId: "conversation_manual_1",
              reason: "conversation_manual_locked",
            },
          ],
        },
      }),
    },
    orders: {
      scanLowValueAutoOrderDrafts: async () => ({
        scanned: 1,
        skipped: [
          {
            quoteDraftId: "quote_skip_1",
            designJobId: "design_skip_4",
            reason: "missing_selected_image",
          },
        ],
      }),
    },
  });

  const run = await service.runOnce("manual");

  assert.equal(run.skipSummary.total, 4);
  assert.equal(run.skipSummary.reasons[0].reason, "status_not_draft");
  assert.equal(run.skipSummary.reasons[0].count, 2);
  assert.deepEqual(run.skipSummary.reasons[0].steps, ["lowValueAutomation"]);
  assert.deepEqual(run.skipSummary.reasons[0].sampleTargets, ["design_skip_1", "design_skip_2"]);
  assert.equal(
    run.skipSummary.reasons.some(
      (item) => item.reason === "conversation_manual_locked" && item.steps.includes("lowValueAutomation"),
    ),
    true,
  );
  assert.equal(
    run.skipSummary.reasons.some(
      (item) => item.reason === "missing_selected_image" && item.steps.includes("scanLowValueOrderDrafts"),
    ),
    true,
  );
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
  assert.equal(skipped.skipSummary.total, 1);
  assert.deepEqual(skipped.skipSummary.reasons[0], {
    reason: "automation_already_running",
    count: 1,
    steps: ["run"],
    sampleTargets: [],
  });
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
  assert.equal(run.skipSummary.total, 1);
  assert.equal(run.skipSummary.reasons[0].reason, "automation_readiness_blocked");
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
  assert.equal(readiness.summary, "可以运行，但建议先处理提醒项。");
  assert.deepEqual(
    readiness.checks.map((item) => item.label),
    ["低价值自动化开关", "商品库可自动搭配", "设计平台在线", "人工接管隔离", "安全发送队列"],
  );
  assert.equal(readiness.checks.find((item) => item.key === "manual_locks").detail, "1 个会话人工接管中，自动化会跳过它们。");
  assert.equal(readiness.checks.find((item) => item.key === "manual_locks").action, "人工处理完成后再解除对应会话锁。");
  assert.equal(readiness.checks.find((item) => item.key === "send_queue").detail, "待处理发送任务 1 个，每轮最多处理 10 个。");
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
