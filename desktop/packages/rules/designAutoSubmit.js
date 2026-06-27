"use strict";

const { inspectRealDesignReferences, validateDesignRequest } = require("./designWorkflow");

function evaluateDesignAutoSubmit(job = {}) {
  if (!job || !job.id) return skip("invalid_job", ["job"]);
  if (job.status !== "draft") return skip("status_not_draft", ["status"]);
  if (job.isHighValue || job.manualQcRequired === "force") return skip("manual_review_required", ["manualReview"]);
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
