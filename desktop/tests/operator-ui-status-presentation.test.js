"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const {
  groupNotificationsForDisplay,
  notificationBodyForOperator,
} = require("../apps/web/src/features/notifications/notification-presentation");
const {
  automationOverviewPresentation,
} = require("../apps/web/src/features/overview/automation-status-presentation");
const {
  aiProviderPresentation,
} = require("../apps/web/src/features/system/ai-provider-presentation");

function notification(id, overrides = {}) {
  return {
    id,
    title: "低价值任务自动处理失败",
    body: "Invalid `prisma.designJob.update()` invocation\nUnknown argument `sendTaskId`.\n    at /opt/smart-kefu/releases/old/apps/api/src/design-jobs/design-jobs.service.ts:2812:13",
    level: "error",
    target: { designJobId: `job-${id}` },
    createdAt: `2026-08-06T09:1${id}:00.000Z`,
    readAt: null,
    ...overrides,
  };
}

test("notification presentation collapses the known repeated backend error and hides stack paths", () => {
  const groups = groupNotificationsForDisplay([
    notification("1"),
    notification("2", { readAt: "2026-08-07T00:00:00.000Z" }),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrenceCount, 2);
  assert.equal(groups[0].unreadCount, 1);
  assert.equal(groups[0].hasMixedTargets, true);
  assert.match(notificationBodyForOperator(groups[0].notification.body), /旧版本任务状态写入失败/);
  assert.doesNotMatch(notificationBodyForOperator(groups[0].notification.body), /\/opt\/|service\.ts|PrismaClient/);
});

test("unrelated notifications with different responsibility targets stay separate", () => {
  const groups = groupNotificationsForDisplay([
    notification("1", { title: "客户需人工复核", body: "请复核当前客户资料。" }),
    notification("2", { title: "客户需人工复核", body: "请复核当前客户资料。" }),
  ]);
  assert.equal(groups.length, 2);
});

test("enabled durable automation is not described as stopped when the in-process loop is inactive", () => {
  const presentation = automationOverviewPresentation(
    {
      enabled: true,
      running: false,
      active: false,
      mode: "durable",
      scheduler: { connected: true, workerReady: true, scheduled: true },
    },
    { ready: true, summary: "持久调度检查通过。" },
  );
  assert.equal(presentation.label, "持久调度运行中");
  assert.equal(presentation.tone, "ready");
  assert.match(presentation.detail, /BullMQ 持久调度器周期触发/);

  const intervalInactive = automationOverviewPresentation(
    { enabled: true, running: false, active: false, mode: "interval" },
    { ready: true, summary: "单机模式检查通过。" },
  );
  assert.equal(intervalInactive.label, "单机周期调度未运行");
  assert.equal(intervalInactive.tone, "warning");

  const disabled = automationOverviewPresentation(
    { enabled: false, running: false, active: false },
    { ready: true, summary: "检查通过。" },
  );
  assert.equal(disabled.label, "周期自动化已停用");
  assert.equal(disabled.tone, "muted");
});

test("disabled AI providers are informational instead of actionable failures", () => {
  const disabled = aiProviderPresentation({
    enabled: false,
    configured: false,
    issues: ["provider_disabled", "api_key_unset", "model_unset"],
    error: "stale probe error",
  });
  assert.deepEqual(disabled, {
    label: "已停用",
    tone: "muted",
    actionableIssues: [],
    showRuntimeError: false,
  });

  const enabled = aiProviderPresentation({
    enabled: true,
    configured: false,
    issues: ["api_key_unset"],
    error: "probe failed",
  });
  assert.equal(enabled.label, "配置缺失");
  assert.deepEqual(enabled.actionableIssues, ["api_key_unset"]);
  assert.equal(enabled.showRuntimeError, true);
});
