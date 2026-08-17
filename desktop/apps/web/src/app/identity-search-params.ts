import type { IdentityFilters } from "../lib/api";

export type IdentitySearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function identityFiltersFromSearchParams(
  searchParams?: IdentitySearchParams,
): Promise<IdentityFilters> {
  const params = searchParams ? await searchParams : {};
  return {
    agentId: firstParam(params.agentId),
    wechatAccountId: firstParam(params.wechatAccountId),
    conversationId: firstParam(params.conversationId),
    customerId: firstParam(params.customerId),
    assetId: firstParam(params.assetId),
    assetRole: firstParam(params.assetRole),
  };
}

function firstParam(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = String(first || "").trim();
  return trimmed || undefined;
}
