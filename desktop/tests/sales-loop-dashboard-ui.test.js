"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("sales actions page drives quote-order-fulfillment closure through existing automation APIs", () => {
  const page = read("apps/web/src/features/sales/sales-actions-page.tsx");
  const api = read("apps/web/src/lib/api.ts");

  for (const apiName of [
    "getAutomationReadiness",
    "getAutomationStatus",
    "runAutomationOnce",
    "mergeAutomationStatusRun",
  ]) {
    assert.match(page, new RegExp(`\\b${apiName}\\b`));
  }
  for (const stageKey of ["quote", "order", "orderConfirmation", "orderFollowup", "safeSend"]) {
    assert.match(page, new RegExp(stageKey));
  }

  assert.match(page, /SALES_STAGE_KEYS/);
  assert.match(page, /stageSummary/);
  assert.match(page, /sales-loop-run-once/);
  assert.match(page, /sales-loop-refresh/);
  assert.match(page, /lowValueQuotesReady/);
  assert.match(page, /lowValueOrdersReady/);
  assert.match(page, /pendingSendTasks/);
  assert.match(page, /manualLockedConversations/);
  assert.match(api, /postJson<AutomationRun>\("\/automation\/run-once", filters\)/);
  assert.doesNotMatch(page, /\bfetch\s*\(|createDemo|mock|paymentStatus:\s*"paid"|status:\s*"fulfilled"|productionStatus:\s*"delivered"/i);
});

test("sales loop dashboard keeps mobile layout and button contracts explicit", () => {
  const page = read("apps/web/src/features/sales/sales-actions-page.tsx");
  const css = read("apps/web/src/features/sales/sales-pages.module.css");

  for (const button of page.matchAll(/<button\b[\s\S]*?>/g)) {
    assert.match(button[0], /data-action-id=/);
  }
  assert.match(css, /\.metricGrid/);
  assert.match(css, /\.stageGrid/);
  assert.match(css, /\.stageCard/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)|linear-gradient|radial-gradient/i);
});
