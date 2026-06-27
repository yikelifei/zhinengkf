"use strict";

function recommendBundle({ skus = [], budget, scene = "", maxItems = 8 }) {
  const perUnitBudget = Number(budget?.perUnitAmount || budget?.amount || 0);
  if (!perUnitBudget) {
    return {
      status: "need_budget",
      items: [],
      warnings: ["缺少单份预算，不能可靠搭配礼盒。"],
      totals: emptyTotals(),
    };
  }

  const available = skus.filter((sku) => Number(sku.salePrice || 0) > 0);
  const giftBoxes = available.filter((sku) => sku.type === "gift_box");
  const products = available.filter((sku) => sku.type !== "gift_box");
  const selectedGiftBox = pickBest(giftBoxes, scene, perUnitBudget) || null;
  const remainingBudget = perUnitBudget - Number(selectedGiftBox?.salePrice || 0);
  const selectedItems = pickItems(products, scene, remainingBudget, maxItems);
  const items = [selectedGiftBox, ...selectedItems].filter(Boolean);
  const replacedItems = items.map((item) => withReplacementIfNeeded(item, available));
  const totals = calculateTotals(replacedItems);

  const warnings = [];
  if (!selectedGiftBox) warnings.push("没有找到可用礼盒 SKU。");
  if (remainingBudget <= 0) warnings.push("礼盒价格已经超过单份预算。");
  if (totals.salePrice > perUnitBudget) warnings.push("推荐组合超过单份预算，需要人工确认。");
  if (replacedItems.some((item) => item.replacedBy)) warnings.push("部分商品库存不足，已推荐替代品。");

  return {
    status: warnings.length ? "needs_review" : "ready",
    items: replacedItems,
    totals,
    warnings,
  };
}

function pickBest(skus, scene, budget) {
  const scored = skus
    .filter((sku) => Number(sku.salePrice || 0) <= budget)
    .map((sku) => ({ sku, score: scoreSku(sku, scene) }))
    .sort((a, b) => b.score - a.score || Number(a.sku.salePrice || 0) - Number(b.sku.salePrice || 0));
  return scored[0]?.sku || null;
}

function pickItems(skus, scene, budget, maxItems) {
  let remaining = budget;
  const selected = [];
  const candidates = skus
    .map((sku) => ({ original: sku, effective: withReplacementIfNeeded(sku, skus) }))
    .sort((a, b) => scoreSku(b.original, scene) - scoreSku(a.original, scene));
  for (const candidate of candidates) {
    const price = Number(candidate.effective.salePrice || 0);
    if (price <= 0 || price > remaining || selected.length >= maxItems) continue;
    selected.push(candidate.effective);
    remaining -= price;
  }
  return selected;
}

function withReplacementIfNeeded(sku, allSkus) {
  if (Number(sku.stock || 0) > 0) return sku;
  const replacementCodes = Array.isArray(sku.replacementSkuCodes) ? sku.replacementSkuCodes : [];
  const replacement = allSkus.find(
    (item) => replacementCodes.includes(item.skuCode) && Number(item.stock || 0) > 0,
  );
  if (!replacement) return { ...sku, stockWarning: true };
  return {
    ...replacement,
    replacedBy: replacement.skuCode,
    replacedOriginalSkuCode: sku.skuCode,
    replacementReason: "原商品库存不足",
  };
}

function scoreSku(sku, scene) {
  const tags = new Set([...(sku.sceneTags || []), ...(sku.category ? [sku.category] : [])]);
  let score = Number(sku.priority || 0);
  if (scene) {
    for (const tag of tags) {
      if (scene.includes(tag) || tag.includes(scene)) score += 10;
    }
  }
  if (Number(sku.stock || 0) > 0) score += 3;
  return score;
}

function calculateTotals(items) {
  const totals = items.reduce(
    (acc, item) => {
      acc.cost += Number(item.costPrice || 0);
      acc.salePrice += Number(item.salePrice || 0);
      return acc;
    },
    { cost: 0, salePrice: 0 },
  );
  totals.profit = round(totals.salePrice - totals.cost);
  totals.profitRate = totals.salePrice > 0 ? round(totals.profit / totals.salePrice) : 0;
  totals.cost = round(totals.cost);
  totals.salePrice = round(totals.salePrice);
  return totals;
}

function emptyTotals() {
  return { cost: 0, salePrice: 0, profit: 0, profitRate: 0 };
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

module.exports = {
  recommendBundle,
  calculateTotals,
};
