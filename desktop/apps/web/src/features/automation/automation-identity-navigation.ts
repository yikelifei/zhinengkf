import type { AutomationRun, IdentityFilters } from "../../lib/api";

export function automationIdentityHref(pathname: string, identityFilters?: IdentityFilters) {
  const params = new URLSearchParams();
  if (identityFilters?.wechatAccountId) params.set("wechatAccountId", identityFilters.wechatAccountId);
  if (identityFilters?.conversationId) params.set("conversationId", identityFilters.conversationId);
  if (identityFilters?.customerId) params.set("customerId", identityFilters.customerId);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function automationRunIssueHref(pathname: string, run: AutomationRun) {
  const identities = run.identityAudit?.identities || [];
  return identities.length === 1 ? automationIdentityHref(pathname, identities[0]) : pathname;
}
