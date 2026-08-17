import {
  getAssets,
  getSkus,
  createDesignJob,
  getDesignJobs,
  getDesignPlatformConfig,
  getDesignPlatformCandidates,
  getDesignPlatformHealth,
  getDesignPlatformReadiness,
  getDesignJobExecutions,
  getOperatorAccessStatus,
  loginDesignPlatform,
  pollDesignJob,
  preflightDesignJob,
  createQuote,
  redeemDesignPlatformActivation,
  repairLocalDesignImage,
  resolveDesignExecutionRefund,
  resolveUnknownDesignExecution,
  runDesignPlatformSmokeTest,
  selectDesignImage,
  submitDesignJob,
  recommendBundle,
  updateDesignPlatformConfig,
  uploadAsset,
  type IdentityFilters,
} from "../../lib/api";

export {
  getAssets,
  getSkus,
  createDesignJob,
  getDesignPlatformConfig,
  getDesignPlatformCandidates,
  getDesignPlatformHealth,
  getDesignPlatformReadiness,
  getDesignJobExecutions,
  getOperatorAccessStatus,
  loginDesignPlatform,
  pollDesignJob,
  preflightDesignJob,
  createQuote,
  redeemDesignPlatformActivation,
  repairLocalDesignImage,
  resolveDesignExecutionRefund,
  resolveUnknownDesignExecution,
  runDesignPlatformSmokeTest,
  selectDesignImage,
  submitDesignJob,
  recommendBundle,
  updateDesignPlatformConfig,
  uploadAsset,
};

export async function getVerifiedDesignJobs(filters: IdentityFilters = {}) {
  const records = await getDesignJobs(filters);
  const embeddedFallback = records.some((record) =>
    record.id.startsWith("demo-design-") && record.requestId.startsWith("demo-request-"),
  );
  if (embeddedFallback) {
    throw new Error("设计任务接口不可用，客户端返回了内置降级记录；本页已拒绝展示这些记录。");
  }
  return records;
}
