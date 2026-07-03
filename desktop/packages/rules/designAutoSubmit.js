"use strict";

const { inspectBundleAutomationReadiness, inspectRealDesignReferences, validateDesignRequest } = require("./designWorkflow");
const { isHighValueBudget } = require("./budget");

function evaluateDesignAutoSubmit(job = {}, options = {}) {
  if (!job || !job.id) return skip("invalid_job", ["job"]);
  if (job.status !== "draft") return skip("status_not_draft", ["status"]);
  const highValueAmount = Number(options.highValueAmountCny || 10000);
  if (job.isHighValue || isHighValueBudget(job.budget, highValueAmount) || job.manualQcRequired === "force") {
    return skip("manual_review_required", ["manualReview"]);
  }
  if (job.conversation?.manualLocked || job.manualLocked) return skip("conversation_manual_locked", ["manualLocked"]);

  const assets = Array.isArray(job.assets) ? job.assets : [];
  const check = validateDesignRequest({
    budget: job.budget || {},
    bundle: job.bundle || {},
    designType: job.designType || "bundle_render",
    customerText: job.customerText || "",
    scene: job.scene || "",
    assets,
  });
  if (!check.ok) return skip("missing_required_fields", check.missing || []);

  const automation = inspectBundleAutomationReadiness(job.bundle || {});
  if (!automation.ok) return skip(automation.reason, automation.blockers || []);

  const requiresRealImages = job.requirements?.useRealSkuImages !== false;
  if (requiresRealImages) {
    const refs = inspectRealDesignReferences({
      assets,
      bundle: job.bundle || {},
      requireCustomerAssets: true,
      requireCompleteBundle: true,
    });
    if (!refs.ok) return skip(refs.reason, refs.missing || []);
  }

  return {
    ok: true,
    action: "submit",
    reason: "ready_for_design_platform",
    missing: [],
  };
}

function skip(reason, missing = []) {
  return {
    ok: false,
    action: "skip",
    reason,
    missing,
  };
}

module.exports = {
  evaluateDesignAutoSubmit,
};
