"use strict";

const TEN_THOUSAND_UNITS = new Set(["万", "w", "W"]);

function parseChineseNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)(\s*)(万|w|W)?/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return TEN_THOUSAND_UNITS.has(match[3]) ? amount * 10000 : amount;
}

function parseQuantity(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  const matches = [...text.matchAll(/(\d{1,7})\s*(份|盒|套|个|件|pcs?|PCS)?/g)];
  if (!matches.length) return null;
  const values = matches.map((item) => Number(item[1])).filter((item) => Number.isFinite(item));
  return values.length ? Math.max(...values) : null;
}

function parseBudget(input) {
  const text = typeof input === "string" ? input : JSON.stringify(input || {});
  const normalized = text.replace(/\s+/g, "");
  const totalMatch = normalized.match(/(?:总预算|一共|总共|整体预算|预算总共|总价|总金额)(\d+(?:\.\d+)?)(万|w|W|元)?/);
  const perBoxMatch = normalized.match(/(?:每份|每盒|一份|一盒|单份|单盒|每个|单价)(\d+(?:\.\d+)?)(万|w|W|元)?/);
  const quantity = parseQuantity(normalized.match(/(\d{1,7})(份|盒|套|个|件)/)?.[0] || normalized);

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

module.exports = {
  parseBudget,
  parseQuantity,
  parseChineseNumber,
  hasBudgetCue,
  isHighValueBudget,
  roundMoney,
};
