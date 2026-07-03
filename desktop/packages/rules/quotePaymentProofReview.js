"use strict";

const readablePaymentProofWords = [
  "付款凭证",
  "支付凭证",
  "转账",
  "打款",
  "付款截图",
  "收款截图",
  "收款账户",
  "收款状态",
  "人工核验金额",
];

const legacyMojibakePaymentProofWords = [
  "浠樻鍑瘉",
  "鏀粯鍑瘉",
  "杞处",
  "鎵撴",
  "浠樻鎴浘",
  "鏀舵鎴浘",
  "鏀舵璐︽埛",
  "鏀舵鐘舵€亅浜哄伐鏍搁獙閲戦",
];

function quoteNeedsPaymentProofReview(quote = {}) {
  if (!quote || quote.status !== "manual_review") return false;
  if (["deposit_paid", "paid"].includes(String(quote.paymentStatus || ""))) return false;
  const notes = String(quote.customerNotes || "");
  return (
    [...readablePaymentProofWords, ...legacyMojibakePaymentProofWords].some((word) => notes.includes(word)) ||
    /deposit|payment|paid/i.test(notes)
  );
}

module.exports = {
  quoteNeedsPaymentProofReview,
};
