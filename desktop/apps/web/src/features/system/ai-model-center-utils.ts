import type {
  AiProviderBalanceResult,
  AiProviderStatus,
} from "../../lib/api";

export type AiProvider = AiProviderStatus["providers"][number];
export type ProviderFilter = "all" | "enabled" | "disabled";
export type ModelWorkspace = "providers" | "routing" | "server";

export function providerLabel(name: string, status?: AiProviderStatus | null) {
  return status?.providers.find((provider) => provider.name === name)?.label || name;
}

export function providerAvatar(provider: AiProvider) {
  return provider.label.trim().slice(0, 2).toUpperCase() || "AI";
}

export function providerStatusText(provider: AiProvider) {
  if (!provider.enabled) return "已停用";
  if (!provider.configured) return "待配置";
  if (provider.available === false) return "连接异常";
  if (provider.performance.circuitState === "open") return "已避让";
  return provider.available === true ? "连接正常" : "已启用";
}

export function providerStatusTone(provider: AiProvider) {
  if (!provider.enabled) return "muted" as const;
  if (!provider.configured || provider.available === false || provider.performance.circuitState === "open") {
    return "error" as const;
  }
  return provider.available === true ? "ok" as const : "warning" as const;
}

export function providerSort(providers: AiProvider[]) {
  return [...providers].sort((left, right) => {
    const score = (provider: AiProvider) =>
      Number(provider.isPrimary) * 8 + Number(provider.enabled) * 4 + Number(provider.apiKeyConfigured) * 2 + Number(provider.configured);
    return score(right) - score(left) || left.label.localeCompare(right.label, "zh-CN");
  });
}

export function credentialSourceLabel(provider: AiProvider) {
  if (provider.credentialSource === "zhenxi_ai_shared") {
    return provider.sharedSourceConfigured ? "复用臻希AI密钥" : "臻希AI共享配置缺失";
  }
  if (provider.credentialSource === "invalid") return "配置无效";
  return provider.apiKeyConfigured ? "服务器密钥已保存" : "尚未填写密钥";
}

export function balanceSummary(balance?: AiProviderBalanceResult) {
  if (!balance) return "尚未查询";
  if (balance.status === "unsupported") return "需前往官方控制台查看";
  return balance.display || balance.error || "查询未返回结果";
}

export function modelType(model: string) {
  const value = model.toLowerCase();
  if (/vision|vl|image/.test(value)) return "视觉";
  if (/embed/.test(value)) return "向量";
  if (/audio|whisper|speech/.test(value)) return "音频";
  return "对话";
}
