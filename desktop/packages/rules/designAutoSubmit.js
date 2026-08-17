"use strict";

const {
  CUSTOMER_DESIGN_CANDIDATE_COUNT,
  inspectBundleAutomationReadiness,
  inspectDesignOutputCount,
  inspectRealDesignReferences,
  validateDesignRequest,
} = require("./designWorkflow");
const { isHighValueBudget } = require("./budget");

function evaluateDesignAutoSubmit(job = {}, options = {}) {
  if (!job || !job.id) return skip("invalid_job", ["job"]);
  if (job.status !== "draft") return skip("status_not_draft", ["status"]);
  const designType = String(job.designType || "");
  if (designType.startsWith("zhenxi_copy_")) {
    return skip("handled_by_zhenxi_copy_automation", ["zhenxiCopy"]);
  }
  if (designType === "zhenxi_image" && options.zhenxiGenerationEnabled !== true) {
    return skip("zhenxi_generation_not_ready", ["zhenxiGeneration"]);
  }
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
    requirements: job.requirements || {},
  });
  if (!check.ok) return skip("missing_required_fields", check.missing || []);

  const outputCount = inspectDesignOutputCount(job.outputCount, {
    fallback: options.defaultOutputCount || CUSTOMER_DESIGN_CANDIDATE_COUNT,
  });
  if (!outputCount.ok) return skip(outputCount.reason, ["outputCount"]);

  if (designType !== "zhenxi_image") {
    const automation = inspectBundleAutomationReadiness(job.bundle || {});
    if (!automation.ok) return skip(automation.reason, automation.blockers || []);
  }

  const requiresRealImages = job.requirements?.useRealSkuImages !== false;
  if (requiresRealImages) {
    const zhenxi = job.requirements?.zhenxi && typeof job.requirements.zhenxi === "object"
      ? job.requirements.zhenxi
      : {};
    const isZhenxiImage = designType === "zhenxi_image";
    const hasBundleItems = Array.isArray(job.bundle?.items) && job.bundle.items.length > 0;
    const refs = inspectRealDesignReferences({
      assets,
      bundle: job.bundle || {},
      requireCustomerAssets: !isZhenxiImage,
      requireCompleteBundle: !isZhenxiImage || hasBundleItems,
    });
    if (!refs.ok) return skip(refs.reason, refs.missing || []);
    if (
      isZhenxiImage
      && String(zhenxi.visualContentMode || "") === "real_product"
      && refs.usableAssetCount + refs.usableBundleImageCount === 0
    ) return skip("missing_usable_real_images", ["product_assets_or_selection"]);
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
