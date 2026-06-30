"use strict";

function recommendBundle({ skus = [], budget, scene = "", maxItems = 8 }) {
  const perUnitBudget = Number(budget?.perUnitAmount || budget?.amount || 0);
  const requestedQuantity = positiveInteger(budget?.quantity, 1);
  if (!perUnitBudget) {
    return {
      status: "need_budget",
      items: [],
      warnings: ["缺少单份预算，不能可靠搭配礼盒。"],
      totals: emptyTotals(),
      fulfillment: emptyFulfillment(requestedQuantity),
    };
  }

  const activeSkus = skus.filter((sku) => Number(sku.salePrice || 0) > 0 && sku.isActive !== false);
  const giftBoxes = activeSkus.filter((sku) => sku.type === "gift_box");
  const products = activeSkus.filter((sku) => sku.type !== "gift_box");
  const selectedGiftBox = pickBest(giftBoxes, scene, perUnitBudget, activeSkus, requestedQuantity) || null;
  const remainingBudget = perUnitBudget - Number(selectedGiftBox?.salePrice || 0);
  const selectedItems = pickItems(products, scene, remainingBudget, maxItems, activeSkus, requestedQuantity);
  const items = [selectedGiftBox, ...selectedItems].filter(Boolean);
  const totals = calculateTotals(items);
  const fulfillment = calculateFulfillment(items, requestedQuantity);

  const warnings = [];
  if (!selectedGiftBox) warnings.push("没有找到可用礼盒 SKU。");
  if (remainingBudget <= 0) warnings.push("礼盒价格已经超过单份预算。");
  if (totals.salePrice > perUnitBudget) warnings.push("推荐组合超过单份预算，需要人工确认。");
  if (items.some((item) => item.replacedBy)) warnings.push("部分商品库存不足，已推荐替代品。");

  return {
    status: warnings.length ? "needs_review" : "ready",
    items,
    totals,
    fulfillment,
    warnings,
  };
}

function pickBest(skus, scene, budget, allSkus = skus, requestedQuantity = 1) {
  const scored = skus
    .map((sku) => ({ original: sku, effective: withReplacementIfNeeded(sku, allSkus, requestedQuantity) }))
    .filter((candidate) => isUsable(candidate.effective, requestedQuantity))
    .filter((candidate) => Number(candidate.effective.salePrice || 0) <= budget)
    .map((candidate) => ({
      sku: candidate.effective,
      score: Math.max(scoreSku(candidate.original, scene), scoreSku(candidate.effective, scene)),
    }))
    .sort((a, b) => b.score - a.score || Number(a.sku.salePrice || 0) - Number(b.sku.salePrice || 0));
  return scored[0]?.sku || null;
}

function pickItems(skus, scene, budget, maxItems, allSkus = skus, requestedQuantity = 1) {
  let remaining = budget;
  const selected = [];
  const selectedSkuCodes = new Set();
  const candidates = skus
    .map((sku) => ({ original: sku, effective: withReplacementIfNeeded(sku, allSkus, requestedQuantity) }))
    .filter((candidate) => isUsable(candidate.effective, requestedQuantity))
    .sort((a, b) => {
      const bScore = Math.max(scoreSku(b.original, scene), scoreSku(b.effective, scene));
      const aScore = Math.max(scoreSku(a.original, scene), scoreSku(a.effective, scene));
      return bScore - aScore || Number(a.effective.salePrice || 0) - Number(b.effective.salePrice || 0);
    });

  for (const candidate of candidates) {
    const price = Number(candidate.effective.salePrice || 0);
    const skuCode = candidate.effective.skuCode;
    if (price <= 0 || price > remaining || selected.length >= maxItems) continue;
    if (skuCode && selectedSkuCodes.has(skuCode)) continue;
    selected.push(candidate.effective);
    if (skuCode) selectedSkuCodes.add(skuCode);
    remaining -= price;
  }
  return selected;
}

function withReplacementIfNeeded(sku, allSkus, requestedQuantity = 1) {
  if (Number(sku.stock || 0) >= requestedQuantity) return sku;
  const replacementCodes = Array.isArray(sku.replacementSkuCodes) ? sku.replacementSkuCodes : [];
  const replacement = allSkus.find(
    (item) =>
      replacementCodes.includes(item.skuCode) &&
      Number(item.stock || 0) >= requestedQuantity &&
      Number(item.salePrice || 0) > 0 &&
      item.isActive !== false,
  );
  if (!replacement) return { ...sku, stockWarning: true };
  return {
    ...replacement,
    replacedBy: replacement.skuCode,
    replacedOriginalSkuCode: sku.skuCode,
    replacementReason: "原商品库存不足",
  };
}

function isUsable(sku, requestedQuantity = 1) {
  return Number(sku.salePrice || 0) > 0 && Number(sku.stock || 0) >= requestedQuantity && !sku.stockWarning;
}

function calculateFulfillment(items, requestedQuantity) {
  if (!items.length) return emptyFulfillment(requestedQuantity);
  const stocks = items.map((item) => ({ skuCode: item.skuCode, stock: Number(item.stock || 0) }));
  const bottleneck = stocks.reduce((lowest, item) => (item.stock < lowest.stock ? item : lowest), stocks[0]);
  const capacity = Math.max(0, bottleneck?.stock || 0);
  return {
    requestedQuantity,
    capacity,
    enough: capacity >= requestedQuantity,
    bottleneckSkuCode: bottleneck?.skuCode || null,
  };
}

function emptyFulfillment(requestedQuantity) {
  return {
    requestedQuantity,
    capacity: 0,
    enough: false,
    bottleneckSkuCode: null,
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

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

module.exports = {
  recommendBundle,
  calculateTotals,
};
