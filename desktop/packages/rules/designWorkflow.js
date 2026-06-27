"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DESIGN_STATUSES = Object.freeze({
  DRAFT: "draft",
  SUBMITTED: "submitted",
  GENERATING: "generating",
  COMPLETED: "completed",
  QUICK_CONFIRM: "quick_confirm",
  MANUAL_REVIEW: "manual_review",
  SENT: "sent",
  CUSTOMER_SELECTED: "customer_selected",
  QUOTE_CREATED: "quote_created",
  FAILED: "failed",
  TIMEOUT: "timeout",
  CANCELLED: "cancelled",
});

function validateDesignRequest(request) {
  const missing = [];
  if (!request?.budget?.perUnitAmount && !request?.budget?.totalAmount) missing.push("budget");
  if (!request?.bundle?.items?.length) missing.push("bundle");
  if (!request?.designType) missing.push("designType");
  if (!request?.customerText && !request?.scene) missing.push("customerText");
  if (!request?.assets?.length) missing.push("assets");
  return {
    ok: missing.length === 0,
    missing,
  };
}

function nextStatusAfterDesignCompleted({ isHighValue, manualQcRequired = true }) {
  if (isHighValue) return DESIGN_STATUSES.MANUAL_REVIEW;
  if (manualQcRequired) return DESIGN_STATUSES.QUICK_CONFIRM;
  return DESIGN_STATUSES.SENT;
}

function buildWaitingMessage({ customerName = "", scene = "", outputCount = 6 }) {
  const name = customerName ? `${customerName}，` : "";
  const sceneText = scene ? `按您这个${scene}用途` : "按您刚才的需求";
  return `${name}我先${sceneText}把礼盒搭配效果图做几版出来，预计会有${outputCount}张，出来后我发您挑。`;
}

function shouldTimeout(createdAt, now = new Date(), timeoutMinutes = 20) {
  const started = new Date(createdAt).getTime();
  if (!Number.isFinite(started)) return false;
  return now.getTime() - started >= timeoutMinutes * 60 * 1000;
}

const preflightImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const preflightImageMimeTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

function inspectAssetReferences(assets = []) {
  return (Array.isArray(assets) ? assets : []).map((asset, index) => {
    const ref = firstImageReference(asset);
    const source = `asset:${asset?.fileName || asset?.id || asset?.assetId || index + 1}`;
    if (!ref) {
      return {
        source,
        index,
        id: asset?.id || asset?.assetId || asset?.fileName || null,
        ok: false,
        ref: null,
        reason: "missing_asset_image_reference",
      };
    }
    return {
      ...inspectImageReference(source, ref, asset?.mimeType),
      index,
      id: asset?.id || asset?.assetId || asset?.fileName || null,
    };
  });
}

function inspectBundleReferences(bundle = {}) {
  const items = [];
  if (bundle?.giftBox) items.push({ ...bundle.giftBox, role: "gift_box" });
  if (Array.isArray(bundle?.items)) items.push(...bundle.items);
  return items.map((item, index) => {
    const ref = firstImageReference(item);
    const source = `bundle:${item?.skuCode || item?.name || index + 1}`;
    if (!ref) {
      return {
        source,
        index,
        skuCode: item?.skuCode || null,
        name: item?.name || null,
        ok: false,
        ref: null,
        reason: "missing_sku_image_reference",
      };
    }
    return {
      ...inspectImageReference(source, ref, item?.mimeType),
      index,
      skuCode: item?.skuCode || null,
      name: item?.name || null,
    };
  });
}

function inspectRealDesignReferences({ assets = [], bundle = {}, requireCustomerAssets = true, requireCompleteBundle = true } = {}) {
  const assetRefs = inspectAssetReferences(assets);
  const bundleRefs = inspectBundleReferences(bundle);
  const usableAssetRefs = assetRefs.filter((item) => item.ok);
  const usableBundleRefs = bundleRefs.filter((item) => item.ok);
  const unusableAssetRefs = assetRefs.filter((item) => !item.ok);
  const unusableBundleRefs = bundleRefs.filter((item) => !item.ok);
  const missing = [];

  if (requireCustomerAssets && !usableAssetRefs.length) missing.push("customer_assets");
  if (requireCompleteBundle) {
    if (!bundleRefs.length) missing.push("bundle_images");
    if (unusableBundleRefs.length) missing.push("complete_sku_images");
  }

  return {
    ok: missing.length === 0,
    missing,
    reason: missing.length ? "missing_usable_real_images" : "real_images_ready",
    assetRefs,
    bundleRefs,
    usableAssetCount: usableAssetRefs.length,
    usableBundleImageCount: usableBundleRefs.length,
    unusableAssetCount: unusableAssetRefs.length,
    unusableBundleImageCount: unusableBundleRefs.length,
  };
}

function firstImageReference(value = {}) {
  const directKeys = [
    "localPath",
    "downloadUrl",
    "url",
    "publicUrl",
    "path",
    "filePath",
    "mainImage",
    "mainImageUrl",
    "mainImagePath",
    "imageUrl",
    "imagePath",
    "productImage",
    "skuImageUrl",
    "skuImagePath",
    "skuImage",
    "primaryImage",
  ];
  for (const key of directKeys) {
    const ref = value?.[key];
    if (typeof ref === "string" && ref.trim()) return ref.trim();
  }

  const arrayKeys = ["images", "imageUrls", "imagePaths", "angleImages", "multiAngleImages", "gallery"];
  for (const key of arrayKeys) {
    const list = Array.isArray(value?.[key]) ? value[key] : [];
    for (const entry of list) {
      if (typeof entry === "string" && entry.trim()) return entry.trim();
      const nested = firstImageReference(entry);
      if (nested) return nested;
    }
  }
  return "";
}

function inspectImageReference(source, ref, mimeType) {
  if (isPreflightAcceptedRemoteRef(ref)) {
    return { source, ref, ok: true, reason: "accepted_remote_reference" };
  }
  if (!path.isAbsolute(ref)) {
    return { source, ref, ok: false, reason: "unsupported_image_reference" };
  }

  const extension = path.extname(ref).toLowerCase();
  const mime = String(mimeType || "").toLowerCase();
  const supported = preflightImageExtensions.has(extension) || preflightImageMimeTypes.has(mime);
  if (!supported) {
    return { source, ref, ok: false, reason: `unsupported_image_type:${extension || mime || "unknown"}` };
  }
  if (!fs.existsSync(ref)) return { source, ref, ok: false, reason: "local_file_not_found" };
  return { source, ref, ok: true, reason: "local_image_ready" };
}

function isPreflightAcceptedRemoteRef(value) {
  if (typeof value !== "string") return false;
  if (value.startsWith("/local-assets/") || value.startsWith("/generated/")) return true;
  return /^https:\/\/[^\s]+$/i.test(value);
}

function decideRevisionPolicy({
  instruction = "",
  revisionCount = 0,
  isHighValue = false,
  maxLowValueFreeRevisions = 2,
  maxHighValueFreeRevisions = 5,
} = {}) {
  const normalizedInstruction = String(instruction || "").trim();
  const revisionNumber = Math.max(0, Number(revisionCount || 0)) + 1;

  if (!normalizedInstruction) {
    return {
      ok: false,
      action: "collect_info",
      revisionNumber,
      submitAllowed: false,
      chargeRequired: false,
      manualReviewRequired: false,
      reason: "缺少明确改图要求",
    };
  }

  if (isHighValue) {
    return {
      ok: true,
      action: revisionNumber > maxHighValueFreeRevisions ? "manual_review_charge" : "manual_review",
      revisionNumber,
      submitAllowed: false,
      chargeRequired: revisionNumber > maxHighValueFreeRevisions,
      manualReviewRequired: true,
      reason:
        revisionNumber > maxHighValueFreeRevisions
          ? "高价值客户修改轮次较多，需要人工确认是否收费"
          : "高价值客户改图需要人工先审核",
    };
  }

  if (revisionNumber > maxLowValueFreeRevisions) {
    return {
      ok: true,
      action: "charge_or_manual_review",
      revisionNumber,
      submitAllowed: false,
      chargeRequired: true,
      manualReviewRequired: true,
      reason: `低预算客户免费改图已超过 ${maxLowValueFreeRevisions} 次`,
    };
  }

  return {
    ok: true,
    action: "auto_revision",
    revisionNumber,
    submitAllowed: true,
    chargeRequired: false,
    manualReviewRequired: false,
    reason: `低预算客户第 ${revisionNumber} 次免费改图，可自动提交`,
  };
}

function evaluateDesignPlatformActivationStatus(status = {}) {
  const required = status?.required !== false;
  const active = status?.active === true;
  const reason = String(status?.reason || "");
  const suffix = status?.deviceIdSuffix ? `设备尾号 ${status.deviceIdSuffix}` : "";

  if (!required) {
    return {
      ok: true,
      reason: "not_required",
      detail: "设计平台当前不要求设备激活。",
    };
  }

  if (active || reason === "admin") {
    return {
      ok: true,
      reason: reason || "active",
      detail: ["设计平台设备已激活，可以正式出图。", suffix].filter(Boolean).join(" "),
    };
  }

  const details = {
    missing_device:
      "设计平台没有收到设备 ID，无法确认正式出图激活状态。请先在设计平台登录并激活，或配置 DESIGN_PLATFORM_DEVICE_ID。",
    not_activated: "设计平台当前设备还没有激活，正式出图会被拒绝。请在设计平台完成激活。",
    expired: "设计平台设备激活已过期，请在设计平台重新激活。",
    different_device: "设计平台激活记录属于其他设备，请用当前电脑重新激活或切换到已激活设备。",
    device_bound: "设计平台设备绑定不匹配，请检查当前电脑和账号的激活绑定。",
  };

  return {
    ok: false,
    reason: reason || "inactive",
    detail: details[reason] || "设计平台未处于可正式出图状态，请先检查登录、设备激活和账号权限。",
  };
}

module.exports = {
  DESIGN_STATUSES,
  validateDesignRequest,
  nextStatusAfterDesignCompleted,
  buildWaitingMessage,
  shouldTimeout,
  inspectAssetReferences,
  inspectBundleReferences,
  inspectRealDesignReferences,
  decideRevisionPolicy,
  evaluateDesignPlatformActivationStatus,
};
