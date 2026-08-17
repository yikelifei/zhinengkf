"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { AutomationService } = require("../apps/api/src/automation/automation.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

function createService(overrides = {}) {
  const designJobs = {
    pollActiveResults: async () => ({ scanned: 0 }),
    runCustomerToolAutomation: async () => ({
      zhenxiCopy: { completed: [], skipped: [], failed: [], outcomeUnknown: [] },
      autoSubmit: { submitted: [], skipped: [], failed: [] },
      imageSend: { queued: [], skipped: [], failed: [] },
    }),
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
  return new AutomationService(
    designJobs,
    orders,
    wechatDispatch,
    overrides.store,
    catalog,
    designPlatform,
    overrides.wechatWork,
  );
}

function isProcessLowValueSendQueueEnabled() {
  const raw = process.env.LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE;
  if (raw === undefined || raw === "") return true;
  return !["0", "false", "no", "off"].includes(String(raw).toLowerCase());
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
  assert.equal(run.steps[0].step, "scanTimeouts");
  assert.equal(run.steps[0].status, "completed");
  assert.equal(typeof run.steps[0].durationMs, "number");
});

test("manual automation run forwards selected conversation identity to each side-effect step", async (t) => {
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "art_image_local";
  t.after(() => { appConfig.designPlatformAdapter = previousAdapter; });
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
      runLowValueAutomation: async (filter, options) => {
        calls.push(["runLowValueAutomation", filter, options]);
        return { autoSubmit: { submitted: [] } };
      },
      runCustomerToolAutomation: async (filter) => {
        calls.push(["runCustomerToolAutomation", filter]);
        return {
          zhenxiCopy: { completed: [], skipped: [], failed: [], outcomeUnknown: [] },
          autoSubmit: { submitted: [], skipped: [], failed: [] },
          imageSend: { queued: [], skipped: [], failed: [] },
        };
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
  const expectedCallOrder = [
    "scanTimeouts",
    "processSafeSendQueue",
    "runCustomerToolAutomation",
    ...(isProcessLowValueSendQueueEnabled() ? ["processSafeSendQueue"] : []),
    "pollActiveResults",
    "runLowValueAutomation",
    "scanLowValueAutoOrderDrafts",
    "scanLowValueOrderConfirmations",
    "scanLowValueOrderFollowups",
    "scanSendOperations",
  ];
  if (isProcessLowValueSendQueueEnabled()) expectedCallOrder.push("processSafeSendQueue");
  assert.deepEqual(
    calls.map(([step]) => step),
    expectedCallOrder,
  );
  assert.deepEqual(calls.find(([step]) => step === "runLowValueAutomation")[2], {
    includeCustomerTools: false,
  });
  if (isProcessLowValueSendQueueEnabled()) {
    assert.equal(calls[1][1].inboundReplyOnly, true);
    assert.equal(calls[1][1].automationOnly, true);
    assert.equal(calls[3][1].customerToolOnly, true);
    assert.equal(calls[3][1].automationOnly, true);
    assert.equal(calls.at(-1)[1].inboundReplyOnly, undefined);
  }
});

test("automation yields to HTTP and timer work between synchronous persistence-heavy steps", async () => {
  let timerObserved = false;
  const service = createService({
    designJobs: {
      scanTimeouts: async () => ({ scanned: 0 }),
      pollActiveResults: async () => {
        assert.equal(timerObserved, true);
        return { scanned: 0 };
      },
    },
  });
  setImmediate(() => {
    timerObserved = true;
  });

  await service.runOnce("manual");
  assert.equal(timerObserved, true);
});

test("interval automation keeps inbound replies frequent while throttling heavy full sweeps", async () => {
  let fullSweepCalls = 0;
  let inboundQueueCalls = 0;
  const service = createService({
    designJobs: {
      runLowValueAutomation: async () => {
        fullSweepCalls += 1;
        return { autoSubmit: { submitted: [] } };
      },
    },
    wechatDispatch: {
      processSafeSendQueue: async (params) => {
        if (params.inboundReplyOnly) inboundQueueCalls += 1;
        return { processed: [] };
      },
    },
  });

  const first = await service.runOnce("interval");
  const second = await service.runOnce("interval");

  assert.equal(first.results.cadence.fullSweep, true);
  assert.equal(second.results.cadence.fullSweep, false);
  assert.equal(second.results.cadence.reason, "interval_quick_lane");
  assert.equal(fullSweepCalls, 1);
  assert.equal(inboundQueueCalls, 2);
});

test("automation run polls official WeCom inbound sync before processing the send queue", async () => {
  const previousEnabled = appConfig.wechatWorkAutoSyncEnabled;
  const previousLimit = appConfig.wechatWorkAutoSyncLimit;
  const previousAccountsPerRun = appConfig.wechatWorkAutoSyncAccountsPerRun;
  const previousOpenKfid = appConfig.wechatWorkOpenKfid;
  const calls = [];
  appConfig.wechatWorkAutoSyncEnabled = true;
  appConfig.wechatWorkAutoSyncLimit = 37;
  appConfig.wechatWorkAutoSyncAccountsPerRun = 1;
  appConfig.wechatWorkOpenKfid = "wk_employee_test";
  try {
    const service = createService({
      wechatWork: {
        syncAllCustomerServiceAccounts: async (payload) => {
          calls.push(["syncWechatWorkInbound", payload]);
          return { ok: true, accountCount: 2, synchronizedAccountCount: 2, receivedCount: 1, processedCount: 1 };
        },
      },
      wechatDispatch: {
        processSafeSendQueue: async () => {
          calls.push(["processSafeSendQueue"]);
          return { processed: [] };
        },
      },
    });

    const run = await service.runOnce("interval");

    assert.deepEqual(calls[0], [
      "syncWechatWorkInbound",
      { limit: 37, maxAccounts: 1 },
    ]);
    assert.equal(run.results.syncWechatWorkInbound.processedCount, 1);
    if (isProcessLowValueSendQueueEnabled()) {
      assert.equal(calls.at(-1)[0], "processSafeSendQueue");
    }
  } finally {
    appConfig.wechatWorkAutoSyncEnabled = previousEnabled;
    appConfig.wechatWorkAutoSyncLimit = previousLimit;
    appConfig.wechatWorkAutoSyncAccountsPerRun = previousAccountsPerRun;
    appConfig.wechatWorkOpenKfid = previousOpenKfid;
  }
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
      scanSendOperations: async () => ({
        scanned: 1,
        autoRetriedLowValue: 1,
        tasks: {
          autoRetriedLowValue: [
            {
              id: "send_retry_1",
              wechatAccountId: "wechat_demo_1",
              conversationId: "conversation_demo_1",
              customerId: "customer_demo_1",
            },
          ],
        },
      }),
      processSafeSendQueue: async (params) => (params.inboundReplyOnly || params.customerToolOnly)
        ? { processed: [] }
        : {
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
          },
    },
  });

  const run = await service.runOnce("manual");

  assert.equal(run.identityAudit.status, "passed");
  assert.equal(run.identityAudit.identityCount, 1);
  assert.equal(run.identityAudit.identities[0].wechatAccountId, "wechat_demo_1");
  assert.equal(run.identityAudit.identities[0].conversationId, "conversation_demo_1");
  assert.equal(run.identityAudit.identities[0].customerId, "customer_demo_1");
  const expectedIdentitySteps = ["lowValueAutomation", "scanSendOperations"];
  if (isProcessLowValueSendQueueEnabled()) {
    expectedIdentitySteps.splice(1, 0, "processLowValueSendQueue");
  }
  assert.deepEqual(run.identityAudit.identities[0].steps, expectedIdentitySteps);
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

test("automation run summarizes low value stage progress and next action", async () => {
  const service = createService({
    designJobs: {
      scanTimeouts: async () => ({
        scanned: 3,
        candidates: 2,
        recovered: 1,
        timedOut: 1,
        pollErrors: [{ designJobId: "design_poll_error_1", errorMessage: "network timeout" }],
        recoveredJobs: [{ id: "design_recovered_1" }],
        jobs: [{ id: "design_timeout_1" }],
      }),
      runLowValueAutomation: async () => ({
        autoSubmit: {
          submitted: [{ designJobId: "design_submit_1", wechatAccountId: "wechat_1", conversationId: "conversation_1" }],
          skipped: [{ designJobId: "design_skip_1", reason: "missing_required_info" }],
          failed: [],
        },
        imageSend: {
          queued: [{ id: "send_image_1", wechatAccountId: "wechat_1", conversationId: "conversation_1" }],
          skipped: [],
          failed: [],
        },
        quoteSend: {
          queued: [{ id: "send_quote_1", wechatAccountId: "wechat_1", conversationId: "conversation_1" }],
          skipped: [],
          failed: [],
        },
        orderDraft: {
          created: [{ id: "order_1", wechatAccountId: "wechat_1", conversationId: "conversation_1" }],
          skipped: [],
          failed: [],
        },
        orderConfirmation: { queued: [{ orderDraftId: "order_confirmation_1" }], skipped: [], failed: [] },
        orderFollowup: { queued: [], skipped: [{ orderDraftId: "order_followup_skip_1", reason: "payment_not_ready" }], failed: [] },
      }),
    },
    wechatDispatch: {
      scanSendOperations: async () => ({
        scanned: 3,
        autoRetriedLowValue: 1,
        staleQueued: 1,
        bridgeTimedOut: 1,
        bridgeOutboxBroken: 0,
        bridgeDispatchExpired: 0,
        alerted: 0,
      }),
      processSafeSendQueue: async (params) => (params.inboundReplyOnly || params.customerToolOnly)
        ? { processed: [], blocked: [], failed: [] }
        : {
            processed: [{ taskId: "send_image_1", sendTask: { wechatAccountId: "wechat_1", conversationId: "conversation_1" } }],
            blocked: [{ taskId: "send_blocked_1", reason: "window_guard_failed" }],
            failed: [],
          },
    },
  });

  const run = await service.runOnce("manual");

  const lowValueSendQueueEnabled = isProcessLowValueSendQueueEnabled();
  assert.equal(run.stageSummary.progressed, lowValueSendQueueEnabled ? 9 : 8);
  assert.equal(run.stageSummary.blocked, lowValueSendQueueEnabled ? 4 : 3);
  assert.equal(run.stageSummary.failed, 2);
  assert.equal(run.stageSummary.nextAction, "先处理失败步骤，再重新跑一轮低价值自动化。");
  assert.deepEqual(
    run.stageSummary.stages.map((stage) => [stage.key, stage.completed, stage.blocked, stage.failed, stage.tone]),
    [
      ["design", 1, 1, 0, "warning"],
      ["imageSend", 1, 0, 0, "ok"],
      ["quote", 1, 0, 0, "ok"],
      ["order", 1, 0, 0, "ok"],
      ["orderConfirmation", 1, 0, 0, "ok"],
      ["orderFollowup", 0, 1, 0, "warning"],
      ["safeSend", lowValueSendQueueEnabled ? 2 : 1, lowValueSendQueueEnabled ? 2 : 1, 1, "error"],
      ["timeout", 2, 0, 1, "error"],
    ],
  );
});

test("automation run next action prioritizes manual send attention", async () => {
  const service = createService({
    designJobs: {
      runLowValueAutomation: async () => ({
        autoSubmit: { submitted: [], skipped: [], failed: [] },
        imageSend: { queued: [], skipped: [], failed: [] },
        quoteSend: { queued: [], skipped: [], failed: [] },
        orderDraft: { created: [], skipped: [], failed: [] },
        orderConfirmation: {
          queued: [],
          skipped: [
            {
              orderDraftId: "order_manual_attention_1",
              reason: "manual_send_attention_required",
              missing: ["confirmationSendTask"],
            },
          ],
          failed: [],
        },
        orderFollowup: { queued: [], skipped: [], failed: [] },
      }),
    },
  });

  const run = await service.runOnce("manual");

  assert.equal(run.stageSummary.failed, 0);
  assert.equal(run.stageSummary.blocked, 1);
  assert.equal(run.skipSummary.reasons[0].reason, "manual_send_attention_required");
  assert.equal(
    run.stageSummary.nextAction,
    "先打开订单和发送中心，核对失败/拦截原因；确认客户身份、企业微信发送任务和付款状态后，由人工重排或继续人工跟进。",
  );
  assert.doesNotMatch(run.stageSummary.nextAction, /微信窗口|个人微信|微信客户端/);
});

test("automation skipped run includes stage summary for blocked readiness", async () => {
  const service = createService({
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

  assert.equal(run.skipped, true);
  assert.equal(run.stageSummary.progressed, 0);
  assert.equal(run.stageSummary.blocked, 1);
  assert.equal(run.stageSummary.stages[0].key, "run");
  assert.equal(run.stageSummary.nextAction, "先处理开机检查阻塞项，再重新跑低价值自动化。");
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
    designJobs: {
      scanTimeouts: () =>
        new Promise((resolve) => {
          releaseRunningStep = () =>
            resolve({
              scanned: 0,
              timedOut: 0,
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

test("catalog readiness blockers still allow isolated inbound replies and customer tools", async (t) => {
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "art_image_local";
  t.after(() => { appConfig.designPlatformAdapter = previousAdapter; });
  let lowValueRan = false;
  let customerToolRan = false;
  let timeoutScanRan = false;
  const sendQueueCalls = [];
  const service = createService({
    designJobs: {
      scanTimeouts: async () => {
        timeoutScanRan = true;
        return { scanned: 1, timedOut: 1 };
      },
      runLowValueAutomation: async () => {
        lowValueRan = true;
        return { autoSubmit: { submitted: [] } };
      },
      runCustomerToolAutomation: async () => {
        customerToolRan = true;
        return {
          zhenxiCopy: { completed: [], skipped: [], failed: [], outcomeUnknown: [] },
          autoSubmit: { submitted: [], skipped: [], failed: [] },
          imageSend: { queued: [], skipped: [], failed: [] },
        };
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
    wechatDispatch: {
      processSafeSendQueue: async (params) => {
        sendQueueCalls.push(params);
        return { processed: [] };
      },
    },
  });

  const run = await service.runOnce("manual");
  const status = service.status();

  assert.equal(run.skipped, true);
  assert.equal(run.reason, "automation_readiness_blocked");
  assert.equal(run.skipSummary.total, 1);
  assert.equal(run.skipSummary.reasons[0].reason, "automation_readiness_blocked");
  assert.equal(run.steps.length, isProcessLowValueSendQueueEnabled() ? 4 : 3);
  assert.equal(run.steps[0].step, "scanTimeouts");
  assert.equal(run.steps[0].status, "completed");
  assert.equal(run.steps[1].step, "processInboundReplyQueue");
  assert.equal(run.steps[1].status, "completed");
  assert.equal(sendQueueCalls.length, isProcessLowValueSendQueueEnabled() ? 2 : 1);
  assert.equal(sendQueueCalls[0].automationOnly, true);
  assert.equal(sendQueueCalls[0].inboundReplyOnly, true);
  assert.equal(timeoutScanRan, true);
  assert.equal(customerToolRan, true);
  assert.equal(lowValueRan, false);
  assert.equal(run.results.scanTimeouts.timedOut, 1);
  assert.equal(run.results.readiness.ready, false);
  assert.equal(run.results.readiness.blockers.some((item) => item.key === "sku_catalog"), true);
  assert.equal(status.runCount, 0);
  assert.equal(status.lastRun, run);
});

test("customer tool lane fails closed while the design platform is unhealthy", async (t) => {
  const previousAdapter = appConfig.designPlatformAdapter;
  appConfig.designPlatformAdapter = "art_image_local";
  t.after(() => { appConfig.designPlatformAdapter = previousAdapter; });
  let customerToolRan = false;
  const service = createService({
    designJobs: {
      runCustomerToolAutomation: async () => {
        customerToolRan = true;
        return {};
      },
    },
    designPlatform: {
      health: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    },
  });

  const first = await service.runOnce("interval");
  const second = await service.runOnce("interval");

  assert.equal(customerToolRan, false);
  assert.equal(first.results.customerToolReadiness.ready, false);
  assert.equal(first.results.customerToolReadiness.designPlatformHealthy, false);
  assert.equal(first.results.customerToolReadiness.errorMessage, "connect ECONNREFUSED");
  assert.equal(second.results.cadence.reason, "interval_quick_lane");
  assert.equal(second.steps.some((step) => step.step === "customerToolAutomation"), false);
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
    ["低价值自动化开关", "商品库可自动搭配", "设计平台在线", "臻希 AI 客户设计", "人工接管隔离", "安全发送队列"],
  );
  assert.equal(readiness.checks.find((item) => item.key === "manual_locks").detail, "1 个会话人工接管中，自动化会跳过它们。");
  assert.equal(readiness.checks.find((item) => item.key === "manual_locks").action, "人工处理完成后再解除对应会话锁。");
  assert.equal(
    readiness.checks.find((item) => item.key === "send_queue").detail,
    `待处理发送任务 1 个，每轮最多处理 ${appConfig.lowValueAutomationSendQueueLimit} 个。`,
  );
  assert.equal(
    readiness.checks.find((item) => item.key === "send_queue").action,
    undefined,
  );
});

test("automation operator guidance stays Enterprise WeChat oriented", async () => {
  const service = createService({
    store: {
      listAutomationRuns: () => [],
      listSendTasks: () => Array.from({ length: 40 }, (_, index) => ({ id: `send_${index}`, status: "queued" })),
      listConversations: () => [],
      listQuoteDrafts: () => [],
      listOrderDrafts: () => [],
    },
  });

  const run = await service.runOnce("manual");
  const readiness = await service.readiness();
  const sourceText = [
    run.stageSummary.nextAction,
    ...run.stageSummary.stages.flatMap((stage) => [stage.detail, stage.action]),
    ...readiness.checks.flatMap((check) => [check.detail, check.action || ""]),
  ].join("\n");

  assert.match(sourceText, /企业微信发送/);
  assert.doesNotMatch(sourceText, /微信窗口|个人微信|微信客户端/);
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
