"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildConversationManualLockTransition, evaluateHighValueHandoff } = require("../packages/rules");

test("routes high-value draft to manual review", () => {
  const decision = evaluateHighValueHandoff({
    id: "design_1",
    status: "draft",
    isHighValue: true,
  });

  assert.equal(decision.ok, true);
  assert.equal(decision.action, "manual_review");
  assert.equal(decision.reason, "high_value_customer");
});

test("skips non-high-value task", () => {
  const decision = evaluateHighValueHandoff({
    id: "design_1",
    status: "draft",
    isHighValue: false,
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "not_high_value");
});

test("skips task already in manual review", () => {
  const decision = evaluateHighValueHandoff({
    id: "design_1",
    status: "manual_review",
    isHighValue: true,
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "already_manual_review");
});

test("locks a conversation for manual handling with audit status", () => {
  const transition = buildConversationManualLockTransition({
    locked: true,
    wasLocked: false,
    reason: "high_value_customer",
  });

  assert.equal(transition.locked, true);
  assert.equal(transition.decision, "manual_lock");
  assert.equal(transition.beforeStatus, "auto_allowed");
  assert.equal(transition.afterStatus, "manual_locked");
  assert.equal(transition.metadata.reason, "high_value_customer");
});

test("releases a manually locked conversation with audit status", () => {
  const transition = buildConversationManualLockTransition({
    locked: false,
    wasLocked: true,
  });

  assert.equal(transition.locked, false);
  assert.equal(transition.decision, "manual_release");
  assert.equal(transition.beforeStatus, "manual_locked");
  assert.equal(transition.afterStatus, "auto_allowed");
  assert.equal(transition.metadata.reason, "manual_release");
});
