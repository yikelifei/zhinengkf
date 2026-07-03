"use strict";

function recommendBundle({ skus = [], budget, scene = "", maxItems = 8, minimumMarginRate = 0.15, deliveryLeadTimeWarningDays = 30 }) {
  const perUnitBudget = Number(budget?.perUnitAmount || budget?.amount || 0);
  const requestedQuantity = positiveInteger(budget?.quantity, 1);
  const automationOptions = {
    minimumMarginRate: normalizeMinimumMarginRate(minimumMarginRate),
    deliveryLeadTimeWarningDays: normalizeLeadTimeWarningDays(deliveryLeadTimeWarningDays),
  };
  if (!perUnitBudget) {
    return {
      status: "need_budget",
      items: [],
      warnings: ["缺少单份预算，不能可靠搭配礼盒。"],
      totals: emptyTotals(),
      fulfillment: emptyFulfillment(requestedQuantity),
      automation: {
        ready: false,
        blockers: ["missing_budget"],
      },
    };
  }

  const activeSkus = skus.filter((sku) => Number(sku.salePrice || 0) > 0 && sku.isActive !== false);
  const giftBoxes = activeSkus.filter((sku) => sku.type === "gift_box");
  const products = activeSkus.filter((sku) => sku.type !== "gift_box");
  const selectedGiftBox = pickBest(giftBoxes, scene, perUnitBudget, activeSkus, requestedQuantity, automationOptions) || null;
  const remainingBudget = perUnitBudget - Number(selectedGiftBox?.salePrice || 0);
  const selectedItems = pickItems(products, scene, remainingBudget, maxItems, activeSkus, requestedQuantity, selectedGiftBox, automationOptions);
  const items = [selectedGiftBox, ...selectedItems].filter(Boolean);
  const totals = calculateTotals(items);
  const fulfillment = calculateFulfillment(items, requestedQuantity);
  const automation = inspectBundleAutomationReadiness(items, totals, automationOptions);

  const warnings = [];
  if (!selectedGiftBox) warnings.push("没有找到可用礼盒 SKU。");
  if (remainingBudget <= 0) warnings.push("礼盒价格已经超过单份预算。");
  if (totals.salePrice > perUnitBudget) warnings.push("推荐组合超过单份预算，需要人工确认。");
  if (items.some((item) => item.replacedBy)) warnings.push("部分商品库存不足，已推荐替代品。");

  for (const blocker of automation.blockers) {
    warnings.push(automationBlockerWarning(blocker));
  }

  return {
    status: warnings.length ? "needs_review" : "ready",
    items,
    totals,
    fulfillment,
    automation,
    warnings,
  };
}

function pickBest(skus, scene, budget, allSkus = skus, requestedQuantity = 1, automationOptions = {}) {
  const scored = skus
    .map((sku) => ({ original: sku, effective: withReplacementIfNeeded(sku, allSkus, requestedQuantity) }))
    .filter((candidate) => isUsable(candidate.effective, requestedQuantity))
    .filter((candidate) => Number(candidate.effective.salePrice || 0) <= budget)
    .map((candidate) => ({
      sku: candidate.effective,
      score: Math.max(scoreSku(candidate.original, scene), scoreSku(candidate.effective, scene)) +
        automationCandidateScore(candidate.effective, null, automationOptions),
    }))
    .sort((a, b) => b.score - a.score || Number(a.sku.salePrice || 0) - Number(b.sku.salePrice || 0));
  return scored[0]?.sku || null;
}

function pickItems(skus, scene, budget, maxItems, allSkus = skus, requestedQuantity = 1, giftBox = null, automationOptions = {}) {
  let remaining = budget;
  const selected = [];
  const selectedSkuCodes = new Set(giftBox?.skuCode ? [giftBox.skuCode] : []);
  const candidates = skus
    .map((sku) => ({ original: sku, effective: withReplacementIfNeeded(sku, allSkus, requestedQuantity) }))
    .filter((candidate) => isUsable(candidate.effective, requestedQuantity))
    .sort((a, b) => {
      const bScore = Math.max(scoreSku(b.original, scene), scoreSku(b.effective, scene)) +
        automationCandidateScore(b.effective, giftBox, automationOptions) +
        matchingRuleCandidateScore(b.effective, [giftBox].filter(Boolean)) +
        matchingRuleInventoryScore(b.effective, allSkus, requestedQuantity);
      const aScore = Math.max(scoreSku(a.original, scene), scoreSku(a.effective, scene)) +
        automationCandidateScore(a.effective, giftBox, automationOptions) +
        matchingRuleCandidateScore(a.effective, [giftBox].filter(Boolean)) +
        matchingRuleInventoryScore(a.effective, allSkus, requestedQuantity);
      return bScore - aScore || Number(a.effective.salePrice || 0) - Number(b.effective.salePrice || 0);
    });

  for (const candidate of candidates) {
    const price = Number(candidate.effective.salePrice || 0);
    const skuCode = candidate.effective.skuCode;
    if (price <= 0 || price > remaining || selected.length >= maxItems) continue;
    if (skuCode && selectedSkuCodes.has(skuCode)) continue;
    const currentItems = [giftBox, ...selected].filter(Boolean);
    if (conflictsWithSelection(candidate.effective, currentItems)) continue;
    const required = resolveRequiredCompanions(candidate.effective, allSkus, requestedQuantity, currentItems, remaining - price);
    if (!required.ok || selected.length + 1 + required.items.length > maxItems) continue;
    selected.push(candidate.effective);
    if (skuCode) selectedSkuCodes.add(skuCode);
    remaining -= price;
    for (const requiredItem of required.items) {
      if (requiredItem.skuCode && selectedSkuCodes.has(requiredItem.skuCode)) continue;
      selected.push(requiredItem);
      if (requiredItem.skuCode) selectedSkuCodes.add(requiredItem.skuCode);
      remaining -= Number(requiredItem.salePrice || 0);
    }
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

function matchingRuleCandidateScore(sku, selectedItems = []) {
  let score = 0;
  for (const selected of selectedItems) {
    if (!selected) continue;
    if (matchingRuleCodes(sku, "preferWith").includes(selected.skuCode)) score += 20;
    if (matchingRuleCodes(selected, "preferWith").includes(sku.skuCode)) score += 20;
    if (matchingRuleCodes(sku, "mustWith").includes(selected.skuCode)) score += 10;
    if (matchingRuleCodes(selected, "mustWith").includes(sku.skuCode)) score += 10;
  }
  return score;
}

function matchingRuleInventoryScore(sku, allSkus, requestedQuantity) {
  const mustWithCodes = matchingRuleCodes(sku, "mustWith");
  if (!mustWithCodes.length) return 0;
  const availableCount = mustWithCodes.filter((skuCode) => findEffectiveSkuByCode(skuCode, allSkus, requestedQuantity)).length;
  return availableCount === mustWithCodes.length ? 35 + availableCount * 5 : -40;
}

function resolveRequiredCompanions(sku, allSkus, requestedQuantity, selectedItems, remainingBudget) {
  const selectedCodes = new Set(selectedItems.map((item) => item?.skuCode).filter(Boolean));
  const items = [];
  let remaining = remainingBudget;
  for (const skuCode of matchingRuleCodes(sku, "mustWith")) {
    if (selectedCodes.has(skuCode)) continue;
    const required = findEffectiveSkuByCode(skuCode, allSkus, requestedQuantity);
    if (!required || conflictsWithSelection(required, [...selectedItems, sku, ...items])) {
      return { ok: false, items: [] };
    }
    const price = Number(required.salePrice || 0);
    if (price <= 0 || price > remaining) return { ok: false, items: [] };
    items.push(required);
    selectedCodes.add(required.skuCode);
    remaining -= price;
  }
  return { ok: true, items };
}

function findEffectiveSkuByCode(skuCode, allSkus, requestedQuantity) {
  const sku = allSkus.find((item) => item.skuCode === skuCode && item.isActive !== false);
  if (!sku) return null;
  const effective = withReplacementIfNeeded(sku, allSkus, requestedQuantity);
  return isUsable(effective, requestedQuantity) ? effective : null;
}

function conflictsWithSelection(sku, selectedItems = []) {
  for (const selected of selectedItems) {
    if (!selected) continue;
    if (conflictRuleCodes(sku).includes(selected.skuCode)) return true;
    if (conflictRuleCodes(selected).includes(sku.skuCode)) return true;
  }
  return false;
}

function conflictRuleCodes(sku) {
  return [
    ...matchingRuleCodes(sku, "cannotWith"),
    ...matchingRuleCodes(sku, "excludeWith"),
    ...matchingRuleCodes(sku, "avoidWith"),
  ];
}

function matchingRuleCodes(sku, key) {
  const rules = sku?.matchingRules;
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return [];
  const value = rules[key];
  if (Array.isArray(value)) return value.map(cleanSkuCode).filter(Boolean);
  if (typeof value === "string") return value.split(/[、，,;；|]+/).map(cleanSkuCode).filter(Boolean);
  return [];
}

function cleanSkuCode(value) {
  return String(value || "").trim();
}

function automationCandidateScore(sku, giftBox = null, options = {}) {
  const blockers = skuAutomationBlockers(sku, giftBox, options);
  return blockers.length ? -blockers.length * 30 : 100;
}

function inspectBundleAutomationReadiness(items = [], totals = emptyTotals(), options = {}) {
  const blockers = new Set();
  for (const item of items) {
    const giftBox = item.type === "gift_box" ? null : items.find((candidate) => candidate.type === "gift_box") || null;
    for (const blocker of skuAutomationBlockers(item, giftBox, options)) blockers.add(blocker);
  }
  if (Number(totals.profitRate || 0) < normalizeMinimumMarginRate(options.minimumMarginRate)) blockers.add("low_margin");
  return {
    ready: blockers.size === 0 && items.length > 0,
    blockers: [...blockers].sort(),
  };
}

function skuAutomationBlockers(sku, giftBox = null, options = {}) {
  const blockers = [];
  if (skuMarginRate(sku) < normalizeMinimumMarginRate(options.minimumMarginRate)) blockers.push("low_margin");
  const leadTimeDays = Number(sku.leadTimeDays || 0);
  if (leadTimeDays > normalizeLeadTimeWarningDays(options.deliveryLeadTimeWarningDays)) blockers.push("delivery_risk");
  const specReady = dimensionsReady(sku.dimensions) && Number(sku.weightGram || 0) > 0;
  if (!specReady) blockers.push("spec_incomplete");
  if (giftBox && dimensionsReady(giftBox.dimensions) && dimensionsReady(sku.dimensions) && !skuDimensionsFitInside(giftBox.dimensions, sku.dimensions)) {
    blockers.push("size_mismatch");
  } else if (giftBox && (!dimensionsReady(giftBox.dimensions) || !dimensionsReady(sku.dimensions))) {
    blockers.push("size_unknown");
  }
  return [...new Set(blockers)];
}

function automationBlockerWarning(blocker) {
  const labels = {
    low_margin: "推荐组合毛利偏低，需要人工确认售价或替换商品。",
    delivery_risk: "推荐组合存在交期风险，需要人工确认交付时间。",
    spec_incomplete: "推荐组合存在尺寸或重量资料缺失，出图和报价前需要补齐。",
    size_mismatch: "推荐组合存在尺寸不匹配，内搭可能放不进礼盒。",
    size_unknown: "推荐组合尺寸无法确认，建议人工核对礼盒和内搭规格。",
  };
  return labels[blocker] || `推荐组合存在 ${blocker} 风险，需要人工确认。`;
}

function skuMarginRate(sku) {
  const salePrice = Number(sku.salePrice || 0);
  const costPrice = Number(sku.costPrice || 0);
  if (salePrice <= 0) return 0;
  return (salePrice - costPrice) / salePrice;
}

function dimensionsReady(dimensions = {}) {
  return ["lengthCm", "widthCm", "heightCm"].every((key) => Number(dimensions[key] || 0) > 0);
}

function skuDimensionsFitInside(containerDimensions = {}, itemDimensions = {}) {
  const container = sortedPositiveDimensions(containerDimensions);
  const item = sortedPositiveDimensions(itemDimensions);
  if (container.length !== 3 || item.length !== 3) return false;
  return item.every((value, index) => value <= container[index]);
}

function sortedPositiveDimensions(dimensions = {}) {
  const values = ["lengthCm", "widthCm", "heightCm"]
    .map((key) => Number(dimensions[key] || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length === 3 ? values.sort((a, b) => a - b) : [];
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

function normalizeMinimumMarginRate(value) {
  const rate = Number(value ?? 0.15);
  return Number.isFinite(rate) && rate >= 0 ? rate : 0.15;
}

function normalizeLeadTimeWarningDays(value) {
  const days = Number(value || 30);
  return Number.isFinite(days) && days > 0 ? days : 30;
}

module.exports = {
  recommendBundle,
  calculateTotals,
};
