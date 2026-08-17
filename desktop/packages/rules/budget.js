"use strict";

const NUMBER_UNIT_MULTIPLIERS = new Map([
  ["千", 1000],
  ["k", 1000],
  ["K", 1000],
  ["万", 10000],
  ["w", 10000],
  ["W", 10000],
]);

function parseChineseNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)(\s*)(千|k|K|万|w|W)?/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return amount * (NUMBER_UNIT_MULTIPLIERS.get(match[3]) || 1);
}

function parseQuantity(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(千|k|万|w)?\s*(份|盒|套|个|件|pcs?)/gi)];
  if (!matches.length) return null;
  const values = matches
    .map((item) => {
      const base = Number(item[1]);
      if (!Number.isFinite(base)) return null;
      const multiplier = NUMBER_UNIT_MULTIPLIERS.get(item[2]) || 1;
      const quantity = base * multiplier;
      return Number.isInteger(quantity) && quantity > 0 && quantity <= 10000000 ? quantity : null;
    })
    .filter((item) => Number.isFinite(item));
  return values.length ? Math.max(...values) : null;
}

function mergeBudgetContext(current, previous) {
  const currentBudget = current && typeof current === "object" ? current : {};
  const previousBudget = previous && typeof previous === "object" ? previous : {};
  const currentQuantity = positiveNumber(currentBudget.quantity);
  const previousQuantity = positiveNumber(previousBudget.quantity);
  const quantity = currentQuantity || previousQuantity;
  const explicitTotal = positiveNumber(currentBudget.totalAmount);
  const explicitPerUnit = positiveNumber(currentBudget.perUnitAmount);
  const previousTotal = positiveNumber(previousBudget.totalAmount);
  const previousPerUnit = positiveNumber(previousBudget.perUnitAmount);

  if (!quantity && !explicitTotal && !explicitPerUnit && !previousTotal && !previousPerUnit) {
    return current || previous || null;
  }

  let totalAmount = null;
  let perUnitAmount = null;
  let mode = String(currentBudget.mode || "unknown");
  if (explicitTotal) {
    totalAmount = explicitTotal;
    perUnitAmount = quantity ? roundMoney(explicitTotal / quantity) : explicitPerUnit;
    mode = "total";
  } else if (explicitPerUnit) {
    perUnitAmount = explicitPerUnit;
    totalAmount = quantity ? roundMoney(explicitPerUnit * quantity) : null;
    mode = "per_box";
  } else if (previousPerUnit) {
    perUnitAmount = previousPerUnit;
    totalAmount = quantity ? roundMoney(previousPerUnit * quantity) : previousTotal;
    mode = String(previousBudget.mode || "per_box");
  } else {
    totalAmount = previousTotal;
    perUnitAmount = totalAmount && quantity ? roundMoney(totalAmount / quantity) : null;
    mode = String(previousBudget.mode || "total");
  }

  return {
    mode,
    totalAmount,
    quantity,
    perUnitAmount,
    confidence: explicitTotal || explicitPerUnit
      ? String(currentBudget.confidence || "medium")
      : String(previousBudget.confidence || currentBudget.confidence || "low"),
  };
}

function parseBudget(input) {
  const text = typeof input === "string" ? input : JSON.stringify(input || {});
  const normalized = text.replace(/\s+/g, "");
  const totalMatch = normalized.match(/(?:总预算|一共|总共|整体预算|预算总共|总价|总金额)(\d+(?:\.\d+)?)(千|k|K|万|w|W|元)?/);
  const perBoxMatch = normalized.match(/(?:每份|每盒|一份|一盒|单份|单盒|每个|单价)(\d+(?:\.\d+)?)(千|k|K|万|w|W|元)?/);
  const quantity = parseQuantity(normalized);

  if (totalMatch) {
    const amount = parseChineseNumber(totalMatch[1] + (totalMatch[2] || ""));
    return {
      mode: "total",
      totalAmount: amount,
      quantity,
      perUnitAmount: amount && quantity ? roundMoney(amount / quantity) : null,
      confidence: amount ? "high" : "low",
    };
  }

  if (perBoxMatch) {
    const perUnitAmount = parseChineseNumber(perBoxMatch[1] + (perBoxMatch[2] || ""));
    return {
      mode: "per_box",
      totalAmount: perUnitAmount && quantity ? roundMoney(perUnitAmount * quantity) : null,
      quantity,
      perUnitAmount,
      confidence: perUnitAmount ? "high" : "low",
    };
  }

  if (!hasBudgetCue(normalized)) {
    return { mode: "unknown", totalAmount: null, quantity, perUnitAmount: null, confidence: "low" };
  }

  const amount = parseChineseNumber(stripNonBudgetIdentifiers(normalized));
  if (!amount) {
    return { mode: "unknown", totalAmount: null, quantity, perUnitAmount: null, confidence: "low" };
  }

  if (quantity && amount >= 1000) {
    return {
      mode: "total",
      totalAmount: amount,
      quantity,
      perUnitAmount: roundMoney(amount / quantity),
      confidence: "medium",
    };
  }

  return {
    mode: "per_box",
    totalAmount: quantity ? roundMoney(amount * quantity) : null,
    quantity,
    perUnitAmount: amount,
    confidence: "medium",
  };
}

function hasBudgetCue(text) {
  return /预算|价|金额|钱|元|块|报价|成本|单价|每份|每盒|每个|总共|一共|整体|budget|price|cny|rmb|¥|￥/i.test(text);
}

function stripNonBudgetIdentifiers(text) {
  return String(text || "")
    .replace(/[A-Za-z]{1,8}\d{2,20}/g, "")
    .replace(/\d+(?:\.\d+)?\s*(?:千|k|万|w)?\s*(?:份|盒|套|个|件|pcs?)/gi, "")
    .replace(/\d+(?:\.\d+)?\s*(?:cm|厘米|kg|公斤|斤|码|号)/gi, "");
}

function isHighValueBudget(budget, threshold = 10000) {
  const total = Number(budget?.totalAmount || 0);
  const perUnit = Number(budget?.perUnitAmount || 0);
  return total >= threshold || perUnit >= threshold;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

module.exports = {
  parseBudget,
  parseQuantity,
  mergeBudgetContext,
  parseChineseNumber,
  hasBudgetCue,
  isHighValueBudget,
  roundMoney,
};
