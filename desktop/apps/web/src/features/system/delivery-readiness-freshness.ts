export function deliveryEvidenceFreshnessLabel(freshness: { maxAgeHours: number; staleSourceIds: string[] }) {
  return `${freshness.staleSourceIds.length} 份过期 / ${freshness.maxAgeHours} 小时有效`;
}

export function formatDeliveryEvidenceTime(value: string) {
  if (!value) return "未记录生成时间";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
