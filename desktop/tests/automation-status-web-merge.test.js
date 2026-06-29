"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { mergeAutomationStatusRun } = require("../apps/web/src/lib/api");
const webPage = fs.readFileSync(path.join(__dirname, "../apps/web/src/app/page.tsx"), "utf8");

function baseStatus(overrides = {}) {
  return {
    enabled: true,
    running: true,
    active: true,
    startedAt: "2026-01-01T00:00:00.000Z",
    runningStartedAt: "2026-01-01T00:01:00.000Z",
    nextRunAt: "2026-01-01T00:02:00.000Z",
    intervalMs: 30000,
    processSendQueue: true,
    sendQueueLimit: 5,
    pollLimit: 10,
    runCount: 3,
    lastRun: null,
    recentRuns: [],
    ...overrides,
  };
}

function automationRun(overrides = {}) {
  return {
    trigger: "manual",
    startedAt: "2026-01-01T00:01:00.000Z",
    completedAt: "2026-01-01T00:01:01.000Z",
    durationMs: 1000,
    steps: [],
    errors: [],
    results: {},
    ...overrides,
  };
}

test("web automation status merge records completed run and increments count", () => {
  const run = automationRun();
  const status = mergeAutomationStatusRun(baseStatus(), run, { incrementRunCount: true });

  assert.equal(status.running, false);
  assert.equal(status.runningStartedAt, null);
  assert.equal(status.lastRun, run);
  assert.equal(status.recentRuns[0], run);
  assert.equal(status.runCount, 4);
});

test("web automation status merge does not increment count for skipped run", () => {
  const run = automationRun({
    completedAt: "2026-01-01T00:01:00.000Z",
    skipped: true,
    reason: "automation_already_running",
  });
  const status = mergeAutomationStatusRun(baseStatus(), run, { incrementRunCount: false });

  assert.equal(status.lastRun, run);
  assert.equal(status.recentRuns[0], run);
  assert.equal(status.runCount, 3);
});

test("web automation status merge de-duplicates recent runs and keeps newest first", () => {
  const oldRun = automationRun({ startedAt: "2026-01-01T00:00:30.000Z", completedAt: "2026-01-01T00:00:31.000Z" });
  const run = automationRun();
  const duplicateWithFreshPayload = { ...run, durationMs: 1500 };
  const status = mergeAutomationStatusRun(
    baseStatus({ recentRuns: [oldRun, run] }),
    duplicateWithFreshPayload,
    { incrementRunCount: true },
  );

  assert.equal(status.recentRuns.length, 2);
  assert.equal(status.recentRuns[0], duplicateWithFreshPayload);
  assert.equal(status.recentRuns[1], oldRun);
});

test("web automation readiness checks route to existing repair centers", () => {
  assert.match(webPage, /function handleAutomationReadinessCheck/);
  assert.match(webPage, /check\.key === "sku_catalog"[\s\S]*const firstBlockingRepair = skuRepairQueue\.find[\s\S]*repairSku\(firstBlockingRepair\)[\s\S]*setSkuIssueFilter\(check\.ok \? "ready" : "problem"\)[\s\S]*scrollToWorkspaceSection\("sku-library"\)/);
  assert.match(webPage, /check\.key === "design_platform"[\s\S]*scrollToWorkspaceSection\("design-platform-config"\)/);
  assert.match(webPage, /check\.key === "manual_locks"[\s\S]*const firstLockedConversation = prioritizedManualLockedConversations\[0\][\s\S]*setActiveConversationId\(firstLockedConversation\.id\)[\s\S]*scrollToWorkspaceSection\("review-center"\)/);
  assert.match(webPage, /check\.key === "send_queue"[\s\S]*const firstPendingTask = sendTasks\.find[\s\S]*setActiveConversationId\(firstPendingTask\.conversationId\)[\s\S]*scrollToWorkspaceSection\("send-center"\)/);
  assert.match(webPage, /id="design-platform-config"/);
});
