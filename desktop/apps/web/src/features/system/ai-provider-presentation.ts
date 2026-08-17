import type { AiProviderStatus } from "../../lib/api";

type Provider = AiProviderStatus["providers"][number];

export type AiProviderPresentation = {
  label: "已停用" | "配置完整" | "配置缺失";
  tone: "muted" | "ok" | "error";
  actionableIssues: string[];
  showRuntimeError: boolean;
};

export function aiProviderPresentation(provider: Provider): AiProviderPresentation {
  if (!provider.enabled) {
    return {
      label: "已停用",
      tone: "muted",
      actionableIssues: [],
      showRuntimeError: false,
    };
  }
  return {
    label: provider.configured ? "配置完整" : "配置缺失",
    tone: provider.configured ? "ok" : "error",
    actionableIssues: provider.issues.filter((issue) => issue !== "provider_disabled"),
    showRuntimeError: Boolean(provider.error),
  };
}
