import type { BundleRecommendation, IdentityFilters, SkuCatalogAudit } from "../../lib/api";

export type CatalogBundleBudgetDraft = {
  scene: string;
  quantity: string;
  perUnitAmount: string;
  totalAmount: string;
  maxItems: string;
};

export type CatalogBundleBudgetValidation = {
  ok: boolean;
  message: string;
  quantity: number;
  perUnitAmount: number;
  totalAmount: number;
  maxItems: number;
  expectedTotalAmount: number;
};

export function validateCatalogBundleBudget(draft: CatalogBundleBudgetDraft): CatalogBundleBudgetValidation {
  const quantity = Number(draft.quantity);
  const perUnitAmount = Number(draft.perUnitAmount);
  const totalAmount = Number(draft.totalAmount);
  const maxItems = Number(draft.maxItems);
  const expectedTotalAmount = quantity * perUnitAmount;
  if (!draft.scene.trim()) return invalid("请先填写客户送礼场景。", { quantity, perUnitAmount, totalAmount, maxItems, expectedTotalAmount });
  if (!Number.isInteger(quantity) || quantity <= 0) return invalid("数量必须是大于 0 的整数。", { quantity, perUnitAmount, totalAmount, maxItems, expectedTotalAmount });
  if (!Number.isFinite(perUnitAmount) || perUnitAmount <= 0) return invalid("单份预算必须大于 0。", { quantity, perUnitAmount, totalAmount, maxItems, expectedTotalAmount });
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) return invalid("总预算必须大于 0。", { quantity, perUnitAmount, totalAmount, maxItems, expectedTotalAmount });
  if (!Number.isInteger(maxItems) || maxItems <= 0 || maxItems > 20) return invalid("最多商品数必须是 1 到 20 的整数。", { quantity, perUnitAmount, totalAmount, maxItems, expectedTotalAmount });
  if (Math.abs(totalAmount - expectedTotalAmount) > 0.01) {
    return invalid(`当前数量与单份预算对应的总预算应为 ${expectedTotalAmount.toFixed(2)} 元，请统一后再计算。`, { quantity, perUnitAmount, totalAmount, maxItems, expectedTotalAmount });
  }
  return { ok: true, message: "", quantity, perUnitAmount, totalAmount, maxItems, expectedTotalAmount };
}

function invalid(message: string, values: Omit<CatalogBundleBudgetValidation, "ok" | "message">): CatalogBundleBudgetValidation {
  return { ok: false, message, ...values };
}

export function bundleRecommendationHandoffReadiness(result: BundleRecommendation | null) {
  const items = result?.items || [];
  if (!items.length) return { ok: false, reason: "请先完成一次有效的组合推荐。" };
  if (!items.some((item) => item.type === "gift_box")) return { ok: false, reason: "组合缺少礼盒，不能交给设计任务。" };
  if (!items.some((item) => item.type !== "gift_box")) return { ok: false, reason: "组合缺少内搭商品，不能交给设计任务。" };
  const missingImage = items.find((item) => !bundleItemImage(item));
  if (missingImage) return { ok: false, reason: `商品 ${String(missingImage.skuCode || missingImage.name || "未命名商品")} 缺少可读取图片。` };
  return { ok: true, reason: "" };
}

function bundleItemImage(item: Record<string, unknown>) {
  for (const key of ["mainImagePath", "mainImageUrl", "imageUrl", "imagePath", "localPath", "url", "downloadUrl"]) {
    if (typeof item[key] === "string" && String(item[key]).trim()) return String(item[key]).trim();
  }
  for (const key of ["angleImages", "images", "imageUrls", "gallery"]) {
    const value = item[key];
    if (Array.isArray(value) && value.some((entry) => typeof entry === "string" && entry.trim())) return String(value[0]);
  }
  return "";
}

export function catalogAuditPrimaryAction(audit: SkuCatalogAudit) {
  const repairCount = audit.repairQueueCount ?? audit.issues.length;
  const dataReady = audit.dataReadiness?.customerReplyReady !== false;
  if (audit.total <= 0) return { key: "import", href: "/catalog/import", label: "导入真实商品", detail: "商品库为空，先导入待审核草稿。" };
  if (repairCount > 0) return { key: "repair", href: "/catalog/repair", label: `处理 ${repairCount} 个修复任务`, detail: "先处理会阻断搭配、出图或报价的商品问题。" };
  if (!dataReady) return { key: "import", href: "/catalog/import", label: "补齐真实商品资料", detail: "现有商品尚未通过客户回复数据验收。" };
  if (audit.commercialReadiness?.canAutoBundle) return { key: "bundle", href: "/catalog/bundles", label: "开始搭品与预算核算", detail: "商品审计已通过，进入组合方案。" };
  return { key: "products", href: "/catalog/products", label: "检查商品资料", detail: "商品尚不满足自动搭配条件，请检查图片、价格、库存和规格。" };
}

export function hasIdentityScope(filters: IdentityFilters) {
  return Boolean(filters.wechatAccountId || filters.conversationId || filters.customerId);
}

export function identityMatchesConversation(
  conversation: { id: string; customerId: string; wechatAccountId: string },
  filters: IdentityFilters,
) {
  return (!filters.wechatAccountId || conversation.wechatAccountId === filters.wechatAccountId)
    && (!filters.conversationId || conversation.id === filters.conversationId)
    && (!filters.customerId || conversation.customerId === filters.customerId);
}
