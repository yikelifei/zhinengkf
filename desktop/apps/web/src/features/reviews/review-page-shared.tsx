"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getReviewCenter,
  isTrustedDesktopSessionError,
  type IdentityFilters,
  type ReviewCenter,
} from "../../lib/api";
import {
  resolveTrustedOperator,
  resolveTrustedOperatorLabel,
  useTrustedOperator,
} from "../governance/trusted-operator";

export type ReviewMutationPageProps = {
  identityFilters?: IdentityFilters;
  reviewer?: string;
};

function stableReviewIdentityFilters(identityFilters?: IdentityFilters): IdentityFilters {
  return {
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  };
}

export function useReviewCenter(identityFilters?: IdentityFilters) {
  const [center, setCenter] = useState<ReviewCenter | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionBlocked, setSessionBlocked] = useState(false);
  const refreshSequence = useRef(0);
  const stableIdentityFilters = useMemo(
    () => stableReviewIdentityFilters(identityFilters),
    [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId],
  );

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    setSessionBlocked(false);
    setLoaded(false);
    try {
      const nextCenter = await getReviewCenter(stableIdentityFilters);
      if (sequence !== refreshSequence.current) return;
      setCenter(nextCenter);
      setLoaded(true);
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setCenter(null);
      setError(caught instanceof Error ? caught.message : "审核中心读取失败。");
      setSessionBlocked(isTrustedDesktopSessionError(caught));
      setLoaded(true);
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

  return { center, loaded, busy, error, sessionBlocked, setError, refresh };
}

export function useReviewRecord<T>(
  loadRecord: (id: string, filters: IdentityFilters) => Promise<T>,
  reviewId: string,
  identityFilters?: IdentityFilters,
) {
  const [record, setRecord] = useState<T | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionBlocked, setSessionBlocked] = useState(false);
  const refreshSequence = useRef(0);
  const stableIdentityFilters = useMemo(
    () => stableReviewIdentityFilters(identityFilters),
    [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId],
  );

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    setSessionBlocked(false);
    setLoaded(false);
    try {
      const nextRecord = await loadRecord(reviewId, stableIdentityFilters);
      if (sequence !== refreshSequence.current) return;
      setRecord(nextRecord);
      setLoaded(true);
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setRecord(null);
      setError(caught instanceof Error ? caught.message : "审核对象读取失败。");
      setSessionBlocked(isTrustedDesktopSessionError(caught));
      setLoaded(false);
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [loadRecord, reviewId, stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  return { record, loaded, busy, error, sessionBlocked, setError, refresh };
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

export const trustedReviewer = resolveTrustedOperator;
export const trustedReviewerLabel = resolveTrustedOperatorLabel;
export { useTrustedOperator };
