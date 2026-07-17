import {
  getAssets,
  getDesignJobs,
  getDesignPlatformConfig,
  getDesignPlatformHealth,
  getDesignPlatformReadiness,
  loginDesignPlatform,
  pollDesignJob,
  preflightDesignJob,
  redeemDesignPlatformActivation,
  runDesignPlatformSmokeTest,
  submitDesignJob,
  updateDesignPlatformConfig,
  uploadAsset,
} from "../../lib/api";

export {
  getAssets,
  getDesignPlatformConfig,
  getDesignPlatformHealth,
  getDesignPlatformReadiness,
  loginDesignPlatform,
  pollDesignJob,
  preflightDesignJob,
  redeemDesignPlatformActivation,
  runDesignPlatformSmokeTest,
  submitDesignJob,
  updateDesignPlatformConfig,
  uploadAsset,
};

export async function getVerifiedDesignJobs() {
  const records = await getDesignJobs();
  const embeddedFallback = records.some((record) =>
    record.id.startsWith("demo-design-") && record.requestId.startsWith("demo-request-"),
  );
  if (embeddedFallback) {
    throw new Error("设计任务接口不可用，客户端返回了内置降级记录；本页已拒绝展示这些记录。");
  }
  return records;
}
