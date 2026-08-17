import type { BundleRecommendation, Conversation, IdentityFilters, Sku } from "../../lib/api";
import { safeRenderableImageSrc } from "../../lib/renderable-image-src";

export type DesignJobCreateFormState = {
  conversationId: string;
  scene: string;
  customerText: string;
  quantity: string;
  perUnitAmount: string;
  totalAmount: string;
  outputCount: string;
  customerAssetId: string;
  customerAssetUrl: string;
  customerAssetName: string;
  productAssetId: string;
  skuCode: string;
  productName: string;
  productImageUrl: string;
  productSalePrice: string;
  productCostPrice: string;
};

export const CUSTOMER_DESIGN_CANDIDATE_COUNT = 4;

export const DEFAULT_DESIGN_JOB_FORM: DesignJobCreateFormState = {
  conversationId: "",
  scene: "员工福利礼盒",
  customerText: "",
  quantity: "50",
  perUnitAmount: "180",
  totalAmount: "9000",
  outputCount: String(CUSTOMER_DESIGN_CANDIDATE_COUNT),
  customerAssetId: "",
  customerAssetUrl: "",
  customerAssetName: "客户参考图",
  productAssetId: "",
  skuCode: "",
  productName: "",
  productImageUrl: "",
  productSalePrice: "",
  productCostPrice: "",
};

export function initialConversation(rows: Conversation[], filters: IdentityFilters) {
  return rows.find((conversation) =>
    (!filters.wechatAccountId || conversation.wechatAccountId === filters.wechatAccountId)
    && (!filters.conversationId || conversation.id === filters.conversationId)
    && (!filters.customerId || conversation.customerId === filters.customerId),
  );
}

export function positiveNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function mimeFromUrl(value: string) {
  const path = value.toLowerCase().split(/[?#]/, 1)[0] || "";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

type BundleItem = Record<string, unknown> & { type?: string; skuCode?: string };

export type DesignJobCatalogSelection = {
  form: Partial<DesignJobCreateFormState>;
  recommendation: BundleRecommendation | null;
};

export type DesignJobCreateReadinessCheck = {
  code: string;
  label: string;
  detail: string;
  ok: boolean;
};

export type DesignJobCreateReadiness = {
  ok: boolean;
  checks: DesignJobCreateReadinessCheck[];
  issues: DesignJobCreateReadinessCheck[];
};

export function designJobCreateReadiness(
  form: DesignJobCreateFormState,
  recommendation: BundleRecommendation | null,
  identityReady: boolean,
): DesignJobCreateReadiness {
  const customerReferenceReady = customerReferenceReadyForCreate(form);
  const productImageReady = isUsableDesignImageReference(form.productImageUrl);
  const bundleImages = recommendation?.items?.length
    ? recommendation.items.map((item) => ({ item, image: firstSkuImage(item), ready: isUsableDesignImageReference(firstSkuImage(item)) }))
    : [];
  const bundleImagesReady = !bundleImages.length || bundleImages.every((item) => item.ready);
  const quantity = positiveNumber(form.quantity);
  const perUnitAmount = positiveNumber(form.perUnitAmount);
  const totalAmount = positiveNumber(form.totalAmount);
  const expectedTotalAmount = quantity * perUnitAmount;
  const budgetReady = Number.isInteger(quantity)
    && quantity > 0
    && perUnitAmount > 0
    && totalAmount > 0
    && Math.abs(totalAmount - expectedTotalAmount) <= 0.01;
  const outputCount = Number(form.outputCount);
  const outputCountReady = Number.isInteger(outputCount) && outputCount === CUSTOMER_DESIGN_CANDIDATE_COUNT;
  const checks: DesignJobCreateReadinessCheck[] = [
    {
      code: "identity",
      label: "客户身份",
      detail: identityReady ? "已绑定企业微信账号、会话和客户。" : "请选择包含企业微信账号、会话和客户身份的记录。",
      ok: identityReady,
    },
    {
      code: "brief",
      label: "设计需求",
      detail: form.scene.trim() && form.customerText.trim() ? "场景和客户需求已填写。" : "请补齐场景和客户需求，避免生成任务缺上下文。",
      ok: Boolean(form.scene.trim() && form.customerText.trim()),
    },
    {
      code: "customer_reference_image",
      label: "客户参考图",
      detail: customerReferenceReady ? "客户参考图可被设计平台读取。" : "请选择素材库中已入库的客户图片，或填写可下载的 https/data:image 图片；不要手动粘贴裸 /local-assets 路径。",
      ok: customerReferenceReady,
    },
    {
      code: "product_image",
      label: "商品主图",
      detail: productImageReady ? "商品主图已从商品库或素材库带入。" : "请从商品库选择带图商品，或先补齐商品主图。",
      ok: productImageReady,
    },
    {
      code: "bundle_images",
      label: "搭配图片",
      detail: bundleImages.length
        ? bundleImagesReady
          ? `搭配组合 ${bundleImages.length} 个商品都有可读取图片。`
          : `搭配组合还有 ${bundleImages.filter((item) => !item.ready).length} 个商品缺图。`
        : "未套用搭配组合时，按商品主图创建任务。",
      ok: bundleImagesReady,
    },
    {
      code: "budget",
      label: "报价预算",
      detail: budgetReady ? "数量、单份预算和总预算一致。" : quantity > 0 && perUnitAmount > 0 && totalAmount > 0
        ? `数量 × 单份预算应为 ${expectedTotalAmount.toFixed(2)} 元，请统一总预算。`
        : "请补齐数量、单份预算和总预算。",
      ok: budgetReady,
    },
    {
      code: "output_count",
      label: "出图数量",
      detail: outputCountReady ? "每轮固定生成 4 张候选稿供顾客挑选。" : "客服设计 SOP 要求每轮固定生成 4 张候选稿。",
      ok: outputCountReady,
    },
  ];
  const issues = checks.filter((check) => !check.ok);
  return { ok: issues.length === 0, checks, issues };
}

export function isUsableDesignImageReference(value: string) {
  const image = value.trim();
  if (!image) return false;
  if (safeRenderableImageSrc(image)) return true;
  if (isLoopbackDesignReferenceUrl(image)) return true;
  return /[\\/]storage[\\/]assets[\\/]/i.test(image);
}

export function isLoopbackDesignReferenceUrl(value: string) {
  const image = value.trim();
  return image.startsWith("/local-assets/") || image.startsWith("/generated/");
}

export function firstSkuImage(value: Partial<Sku> | BundleItem) {
  const record = value as Record<string, unknown>;
  for (const key of [
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
    "skuImage",
    "skuImageUrl",
    "skuImagePath",
    "primaryImage",
  ]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const key of ["images", "imageUrls", "imagePaths", "angleImages", "multiAngleImages", "gallery"]) {
    const candidate = firstImageFromArray(record[key]);
    if (candidate) return candidate;
  }
  return "";
}

export function customerReferenceReadyForCreate(form: DesignJobCreateFormState) {
  const source = form.customerAssetUrl.trim();
  if (form.customerAssetId.trim()) return isUsableDesignImageReference(source);
  return isUploadableCustomerReferenceSource(source);
}

export function isUploadableCustomerReferenceSource(value: string) {
  const image = value.trim();
  return /^data:image\//i.test(image) || /^https:\/\/[^\s]+$/i.test(image);
}

function firstImageFromArray(value: unknown): string {
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object") {
      const nested = firstSkuImage(item as BundleItem);
      if (nested) return nested;
    }
  }
  return "";
}

export function catalogSelectionFromSku(sku: Sku): DesignJobCatalogSelection {
  return {
    recommendation: null,
    form: {
      skuCode: sku.skuCode,
      productName: sku.name,
      productImageUrl: firstSkuImage(sku),
      productSalePrice: numberText(sku.salePrice),
      productCostPrice: numberText(sku.costPrice),
    },
  };
}

export function catalogSelectionFromRecommendation(recommendation: BundleRecommendation): DesignJobCatalogSelection {
  const item = recommendation.items.find((candidate) => candidate.type !== "gift_box" && firstSkuImage(candidate))
    || recommendation.items.find((candidate) => firstSkuImage(candidate))
    || recommendation.items.find((candidate) => candidate.type !== "gift_box")
    || recommendation.items[0]
    || {};
  return {
    recommendation,
    form: {
      skuCode: String(item.skuCode || ""),
      productName: String(item.name || item.skuCode || ""),
      productImageUrl: firstSkuImage(item),
      productSalePrice: numberText(item.salePrice),
      productCostPrice: numberText(item.costPrice),
    },
  };
}

export function designJobBundleFromForm(form: DesignJobCreateFormState, recommendation: BundleRecommendation | null) {
  if (recommendation?.items?.length) {
    return {
      giftBox: recommendation.items.find((item) => item.type === "gift_box") || null,
      items: recommendation.items,
      totals: recommendation.totals,
      fulfillment: recommendation.fulfillment || null,
      automation: recommendation.automation || null,
      warnings: recommendation.warnings,
    };
  }
  const image = form.productImageUrl.trim();
  return {
    items: [{
      skuCode: form.skuCode.trim() || "operator-item",
      name: form.productName.trim(),
      type: "item",
      salePrice: positiveNumber(form.productSalePrice) || positiveNumber(form.perUnitAmount),
      costPrice: positiveNumber(form.productCostPrice),
      imageUrl: image,
      mainImagePath: image,
    }],
  };
}

function numberText(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : "";
}
