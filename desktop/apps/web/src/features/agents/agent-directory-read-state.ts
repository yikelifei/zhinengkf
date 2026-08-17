import type { IdentityFilters } from "../../lib/api";

export type AgentDirectoryReadState = "loading" | "ready" | "stale" | "unknown";

export function agentDirectoryScopeKey(filters?: IdentityFilters) {
  return JSON.stringify([
    String(filters?.wechatAccountId || "").trim(),
    String(filters?.conversationId || "").trim(),
    String(filters?.customerId || "").trim(),
  ]);
}

export function agentDirectoryReadState({
  busy,
  currentScopeKey,
  loadedScopeKey,
  staleScopeKey,
}: {
  busy: boolean;
  currentScopeKey: string;
  loadedScopeKey: string;
  staleScopeKey: string;
}): AgentDirectoryReadState {
  if (loadedScopeKey === currentScopeKey) {
    return staleScopeKey === currentScopeKey ? "stale" : "ready";
  }
  return busy ? "loading" : "unknown";
}
