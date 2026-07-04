"use strict";

const CHINESE_NUMBERS = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function letterSelectionIndex(value) {
  const text = String(value || "");
  const match =
    text.match(/^(?:选|要|用|按|pick|choose)([a-z])$/i) ||
    text.match(/^(?:第)?([a-z])(?:款|版|套|方案|号|號)$/i) ||
    text.match(/^(?:方案|款式|效果图|效果圖|候选图|候選圖|图|圖)([a-z])$/i);
  if (!match) return 0;
  return match[1].toLowerCase().charCodeAt(0) - 96;
}

function matchTextSelection(text, candidates = []) {
  const normalized = String(text || "").replace(/\s+/g, "");
  const letterIndex = letterSelectionIndex(normalized);
  const explicitNumericUnit = normalized.match(/^(?:第)?(\d{1,2})(?:张|張|个|個|号|號|款|版|套)$/);
  const explicitChineseUnit = normalized.match(/^(?:第)?([一二两三四五六七八九十])(?:张|張|个|個|号|號|款|版|套)$/);
  const numeric = normalized.match(/(?:第)?(\d{1,2})(?:张|个|号|款|版)/);
  const chinese = normalized.match(/(?:第)?([一二两三四五六七八九十])(?:张|个|号|款|版)/);
  const fallbackNumeric = normalized.match(/(?:选|要|用|看|#|no\.?|NO\.?)?(\d{1,2})/);
  const index = letterIndex ||
    (explicitNumericUnit
      ? Number(explicitNumericUnit[1])
      : CHINESE_NUMBERS[explicitChineseUnit?.[1]] ||
        (numeric ? Number(numeric[1]) : CHINESE_NUMBERS[chinese?.[1]] || Number(fallbackNumeric?.[1] || 0)));
  if (!index || index < 1) {
    return { matched: false, confidence: "low", reason: "没有识别到明确编号" };
  }
  const candidate = candidates[index - 1];
  if (!candidate) {
    return { matched: false, confidence: "low", index, reason: "编号超过候选图数量" };
  }
  return {
    matched: true,
    confidence: "high",
    index,
    imageId: candidate.imageId || candidate.id,
    candidate,
  };
}

function matchCustomerSelection(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const referencedImageId = input.referencedImageId || input.quotedImageId || input.attachmentImageId;
  if (referencedImageId) {
    const candidate = candidates.find((item) =>
      [item.id, item.imageId, item.remoteImageId, item.sourceImageId].filter(Boolean).map(String).includes(String(referencedImageId)),
    );
    if (candidate) {
      return {
        matched: true,
        confidence: "high",
        source: "reference",
        imageId: candidate.imageId || candidate.id,
        candidate,
      };
    }
    return {
      matched: false,
      confidence: "low",
      source: "reference",
      reason: "引用图片不属于当前候选图",
    };
  }

  const fingerprint = normalizeFingerprint(input.screenshotFingerprint || input.attachmentFingerprint);
  if (fingerprint) {
    const result = matchImageFingerprint(fingerprint, candidates);
    if (result.matched) return result;
    return {
      matched: false,
      confidence: "low",
      source: "fingerprint",
      reason: result.reason || "截图没有匹配到候选图",
      nearest: result.nearest,
    };
  }

  return {
    ...matchTextSelection(input.text, latestCandidateRound(candidates)),
    source: "text",
  };
}

function candidateRevisionRound(candidate = {}) {
  const imageId = String(candidate.imageId || candidate.id || "");
  const imageIdMatch = /^r(\d+)-/.exec(imageId);
  if (imageIdMatch) return Number(imageIdMatch[1]) || 0;
  const position = Number(candidate.position || 0);
  if (Number.isFinite(position) && position >= 100) return Math.floor(position / 100);
  return Number(candidate.revisionNumber || candidate.round || 0) || 0;
}

function latestCandidateRound(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  const latestRound = list.reduce((max, candidate) => Math.max(max, candidateRevisionRound(candidate)), 0);
  return list.filter((candidate) => candidateRevisionRound(candidate) === latestRound);
}

function hasSelectionIntent(input = {}) {
  const value = typeof input === "string" ? { text: input } : input || {};
  const text = String(value.text || "").replace(/\s+/g, "");
  if (value.referencedImageId || value.quotedImageId || value.attachmentImageId) return true;
  if (normalizeFingerprint(value.screenshotFingerprint || value.attachmentFingerprint)) return true;
  if (letterSelectionIndex(text)) return true;
  if (/(?:^|[^\d])(?:no\.?|#)\d{1,2}(?:$|[^\d])/i.test(text)) return true;
  if (/^(?:第)?\d{1,2}(?:号|號|张|張|个|個|款|版|套)$/.test(text)) return true;
  if (/^(?:第)?[一二两三四五六七八九十](?:号|號|张|張|个|個|款|版|套)$/.test(text)) return true;
  if (/(?:编号|編號|方案|款式|效果图|效果圖|候选图|候選圖|图|圖|款|版)\d{1,2}/.test(text)) return true;
  return /(?:选|要第|第[一二两三四五六七八九十\d]{1,2}[张个号款版]|这张|这个|就它|就这|用这个|按这个|喜欢这个|要这个|pick|choose|thisone)/i.test(text);
}

function planCustomerImageSelection(input = {}) {
  if (!hasSelectionIntent(input)) {
    return {
      ok: false,
      action: "skip",
      reason: "no_selection_intent",
      reviewRequired: false,
    };
  }

  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  if (!candidates.length) {
    return {
      ok: false,
      action: "manual_selection_review",
      reason: "missing_candidate_images",
      reviewRequired: true,
    };
  }

  const result = matchCustomerSelection(input);
  if (!result.matched || needsManualSelectionReview(result)) {
    return {
      ok: false,
      action: "manual_selection_review",
      reason: result.reason || "selection_uncertain",
      reviewRequired: true,
      result,
    };
  }

  return {
    ok: true,
    action: "select_design_image",
    reason: "customer_selected_design_image",
    reviewRequired: false,
    result,
  };
}

function matchImageFingerprint(fingerprint, candidates = [], minimumScore = 0.92) {
  const target = normalizeFingerprint(fingerprint);
  if (!target) return { matched: false, confidence: "low", source: "fingerprint", reason: "缺少图片指纹" };

  let nearest = null;
  for (const candidate of candidates) {
    const candidateFingerprint = normalizeFingerprint(candidate.fingerprint || candidate.imageFingerprint);
    if (!candidateFingerprint) continue;
    const score = fingerprintSimilarity(target, candidateFingerprint);
    const record = {
      score,
      imageId: candidate.imageId || candidate.id,
      candidate,
    };
    if (!nearest || score > nearest.score) nearest = record;
  }

  if (!nearest) return { matched: false, confidence: "low", source: "fingerprint", reason: "候选图没有可匹配指纹" };
  if (nearest.score < minimumScore) {
    return {
      matched: false,
      confidence: nearest.score >= 0.75 ? "medium" : "low",
      source: "fingerprint",
      reason: "截图相似度不足，需要人工确认",
      nearest,
    };
  }
  return {
    matched: true,
    confidence: nearest.score >= 0.98 ? "high" : "medium",
    source: "fingerprint",
    imageId: nearest.imageId,
    candidate: nearest.candidate,
    score: nearest.score,
  };
}

function normalizeFingerprint(value) {
  return String(value || "").toLowerCase().replace(/[^a-f0-9]/g, "");
}

function fingerprintSimilarity(left, right) {
  if (!left || !right) return 0;
  const length = Math.max(left.length, right.length);
  if (!length) return 0;
  let same = 0;
  const min = Math.min(left.length, right.length);
  for (let index = 0; index < min; index += 1) {
    if (left[index] === right[index]) same += 1;
  }
  return same / length;
}

function needsManualSelectionReview(result) {
  return !result?.matched || result.confidence !== "high";
}

module.exports = {
  matchTextSelection,
  matchCustomerSelection,
  hasSelectionIntent,
  planCustomerImageSelection,
  matchImageFingerprint,
  needsManualSelectionReview,
  candidateRevisionRound,
  latestCandidateRound,
};
