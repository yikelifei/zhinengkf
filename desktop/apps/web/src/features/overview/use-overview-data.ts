"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAutomationReadiness,
  getAutomationStatus,
  getConversationOperationsQueue,
  getDeliveryReadiness,
  getNotifications,
  getReviewCenter,
  getWechatChannelStatus,
  getWechatWorkProductionPreflight,
  type AutomationReadiness,
  type AutomationStatus,
  type ConversationOperationsQueue,
  type DeliveryReadiness,
  type IdentityFilters,
  type NotificationItem,
  type ReviewCenter,
  type WechatChannelStatus,
  type WechatWorkProductionReadiness,
} from "../../lib/api";

const OVERVIEW_READ_TIMEOUT_MS = 20_000;
type ScopedOverviewValue<T> = { scopeKey: string; value: T } | null;

export function useOverviewData(identityFilters?: IdentityFilters) {
  const [channelStatusRead, setChannelStatusRead] = useState<ScopedOverviewValue<WechatChannelStatus | null>>(null);
  const [operations, setOperations] = useState<ConversationOperationsQueue | null>(null);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus | null>(null);
  const [automationReadiness, setAutomationReadiness] = useState<AutomationReadiness | null>(null);
  const [reviewCenterRead, setReviewCenterRead] = useState<ScopedOverviewValue<ReviewCenter>>(null);
  const [wechatWorkReadiness, setWechatWorkReadiness] = useState<WechatWorkProductionReadiness | null>(null);
  const [deliveryReadiness, setDeliveryReadiness] = useState<DeliveryReadiness | null>(null);
  const [notificationsRead, setNotificationsRead] = useState<ScopedOverviewValue<NotificationItem[]>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshSequence = useRef(0);
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);
  const identityScopeKey = useMemo(() => JSON.stringify([
    stableIdentityFilters.wechatAccountId || "",
    stableIdentityFilters.conversationId || "",
    stableIdentityFilters.customerId || "",
  ]), [stableIdentityFilters]);
  const channelStatus = scopedValue(channelStatusRead, identityScopeKey);
  const reviewCenter = scopedValue(reviewCenterRead, identityScopeKey);
  const notifications = scopedValue(notificationsRead, identityScopeKey) ?? [];
  const notificationsLoaded = notificationsRead?.scopeKey === identityScopeKey;

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const requestScopeKey = identityScopeKey;
    setBusy(true);
    setError("");
    const reads = [
      progressiveOverviewRead(getWechatChannelStatus(stableIdentityFilters), sequence, refreshSequence, (value) => {
        setChannelStatusRead({ scopeKey: requestScopeKey, value });
      }),
      progressiveOverviewRead(getConversationOperationsQueue(), sequence, refreshSequence, setOperations),
      progressiveOverviewRead(getAutomationStatus(), sequence, refreshSequence, setAutomationStatus),
      progressiveOverviewRead(getAutomationReadiness(), sequence, refreshSequence, setAutomationReadiness),
      progressiveOverviewRead(getReviewCenter(stableIdentityFilters), sequence, refreshSequence, (value) => {
        setReviewCenterRead({ scopeKey: requestScopeKey, value });
      }),
      progressiveOverviewRead(getWechatWorkProductionPreflight(), sequence, refreshSequence, setWechatWorkReadiness),
      progressiveOverviewRead(getDeliveryReadiness(), sequence, refreshSequence, setDeliveryReadiness),
      progressiveOverviewRead(getNotifications(false, stableIdentityFilters), sequence, refreshSequence, (value) => {
        setNotificationsRead({ scopeKey: requestScopeKey, value });
      }),
    ];
    const results = await Promise.allSettled(reads);
    if (sequence !== refreshSequence.current) return;
    const failedReads = results.filter((result) => result.status === "rejected").length;
    if (failedReads) {
      setError(`总览有 ${failedReads} 项服务读取超时或失败；已成功读取的内容仍可继续使用，未读到的状态保持未确认。`);
    }
    setBusy(false);
  }, [identityScopeKey, stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  return {
    channelStatus,
    operations,
    automationStatus,
    automationReadiness,
    reviewCenter,
    wechatWorkReadiness,
    deliveryReadiness,
    notifications,
    notificationsLoaded,
    busy,
    error,
    refresh,
  };
}

function scopedValue<T>(read: ScopedOverviewValue<T>, scopeKey: string): T | null {
  return read?.scopeKey === scopeKey ? read.value : null;
}

function progressiveOverviewRead<T>(
  promise: Promise<T>,
  sequence: number,
  sequenceRef: { current: number },
  apply: (value: T) => void,
) {
  return withOverviewTimeout(promise).then((value) => {
    if (sequence === sequenceRef.current) apply(value);
    return value;
  });
}

function withOverviewTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("overview read timed out")), OVERVIEW_READ_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
