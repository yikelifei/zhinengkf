"use strict";

const ACTIONABLE_HIGH_VALUE_STATUSES = new Set([
  "draft",
  "completed",
  "quick_confirm",
  "customer_selected",
  "failed",
  "timeout",
]);

function evaluateHighValueHandoff(job = {}) {
  if (!job || !job.id) return skip("invalid_job");
  if (!job.isHighValue) return skip("not_high_value");
  if (job.status === "manual_review") return skip("already_manual_review");
  if (!ACTIONABLE_HIGH_VALUE_STATUSES.has(job.status)) return skip("status_not_actionable");

  return {
    ok: true,
    action: "manual_review",
    reason: "high_value_customer",
  };
}

function buildConversationManualLockTransition(options = {}) {
  const locked = options.locked !== false;
  const wasLocked = Boolean(options.wasLocked);
  const decision = locked ? "manual_lock" : "manual_release";

  return {
    locked,
    decision,
    beforeStatus: wasLocked ? "manual_locked" : "auto_allowed",
    afterStatus: locked ? "manual_locked" : "auto_allowed",
    metadata: {
      reason: options.reason || decision,
      source: options.source || "conversation_manual_lock",
    },
  };
}

function skip(reason) {
  return {
    ok: false,
    action: "skip",
    reason,
  };
}

module.exports = {
  buildConversationManualLockTransition,
  evaluateHighValueHandoff,
};
