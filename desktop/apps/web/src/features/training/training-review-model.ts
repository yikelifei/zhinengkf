import type { TrainingSample } from "../../lib/api";

export type SampleReviewStatus = "ready" | "review" | "rejected";

export function sampleNeedsReview(sample: TrainingSample) {
  const needsReview = sample.sceneCheck?.needsReview === true || sample.quality?.attention?.needsAttention === true;
  return needsReview || sample.quality?.level === "review" || sample.quality?.level === "risk" || !sample.quality;
}

export function sampleBlocked(sample: TrainingSample) {
  return sample.quality?.level === "blocked" || sample.quality?.trainable === false;
}

export function isReadyEligible(sample: TrainingSample) {
  return sample.quality?.level === "safe" && sample.quality.trainable === true && !sampleNeedsReview(sample) && !sampleBlocked(sample);
}

export function sampleStatusLabel(status: SampleReviewStatus) {
  if (status === "ready") return "可用";
  if (status === "review") return "待复核";
  return "已驳回";
}

export function formatTrainingScore(value: number) {
  if (!Number.isFinite(value)) return "未知";
  return value <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(1);
}
