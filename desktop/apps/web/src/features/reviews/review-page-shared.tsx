"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getReviewCenter, type IdentityFilters, type ReviewCenter } from "../../lib/api";

export type ReviewMutationPageProps = {
  identityFilters?: IdentityFilters;
  reviewer?: string;
};

export function useReviewCenter(identityFilters?: IdentityFilters) {
  const [center, setCenter] = useState<ReviewCenter | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshSequence = useRef(0);
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    try {
      const nextCenter = await getReviewCenter(stableIdentityFilters);
      if (sequence !== refreshSequence.current) return;
      setCenter(nextCenter);
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setCenter(null);
      setError(caught instanceof Error ? caught.message : "审核中心读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  return { center, busy, error, setError, refresh };
}

export function formatReviewDate(value?: string | null) {
  if (!value) return "暂无";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function formatReviewMoney(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未知";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(value);
}

export function trustedReviewer(reviewer?: string) {
  return reviewer?.trim() || "";
}
