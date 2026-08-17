"use client";

import type { IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";

export function stableTrainingIdentityFilters(identityFilters?: IdentityFilters): IdentityFilters {
  return {
    agentId: identityFilters?.agentId || undefined,
    wechatAccountId: identityFilters?.wechatAccountId || undefined,
    conversationId: identityFilters?.conversationId || undefined,
    customerId: identityFilters?.customerId || undefined,
  };
}

export function trainingHref(pathname: string, identityFilters?: IdentityFilters) {
  const params = new URLSearchParams();
  const stable = stableTrainingIdentityFilters(identityFilters);
  if (stable.agentId) params.set("agentId", stable.agentId);
  if (stable.wechatAccountId) params.set("wechatAccountId", stable.wechatAccountId);
  if (stable.conversationId) params.set("conversationId", stable.conversationId);
  if (stable.customerId) params.set("customerId", stable.customerId);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function hasTrainingIdentityScope(identityFilters?: IdentityFilters) {
  return Boolean(identityFilters?.agentId || identityFilters?.wechatAccountId || identityFilters?.conversationId || identityFilters?.customerId);
}

export function TrainingIdentityScopeNotice({ identityFilters }: { identityFilters?: IdentityFilters }) {
  if (!hasTrainingIdentityScope(identityFilters)) return null;
  return (
    <div className={`${styles.notice} ${styles.noticeInfo}`} role="status" data-action-id="training-identity-scope">
      <strong>当前训练范围</strong>
      <p>{trainingIdentityScopeLabel(identityFilters)}。本页读取、复核和应用建议都会保留这个 Agent/客户/会话范围。</p>
    </div>
  );
}

export function trainingIdentityScopeLabel(identityFilters?: IdentityFilters) {
  const stable = stableTrainingIdentityFilters(identityFilters);
  return [
    stable.agentId ? `Agent ${stable.agentId}` : "",
    stable.wechatAccountId ? `企业微信账号 ${stable.wechatAccountId}` : "",
    stable.conversationId ? `会话 ${stable.conversationId}` : "",
    stable.customerId ? `客户 ${stable.customerId}` : "",
  ].filter(Boolean).join(" / ") || "全局训练范围";
}
