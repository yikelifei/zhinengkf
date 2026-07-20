"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getNotifications,
  identityExpectation,
  markAllNotificationsRead,
  markNotificationRead,
  type IdentityExpectation,
  type IdentityFilters,
  type NotificationItem,
} from "../../lib/api";
import { notificationScopeKey, runLatestNotificationOperation } from "./notification-operation-guard";

export function useNotificationsController(identityFilters?: IdentityFilters) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [errorScopeKey, setErrorScopeKey] = useState("");
  const [noticeScopeKey, setNoticeScopeKey] = useState("");
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const refreshSequence = useRef(0);
  const filters = useMemo<IdentityFilters>(() => ({
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);
  const scopeKey = useMemo(() => notificationScopeKey(unreadOnly, filters), [filters, unreadOnly]);
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const scopeLoaded = loaded && loadedScopeKey === scopeKey;
  const scopedNotifications = scopeLoaded ? notifications : [];

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const requestScopeKey = scopeKey;
    setBusy(true);
    setError("");
    setNotice("");
    setLoaded(false);
    setNotifications([]);
    try {
      const next = await getNotifications(unreadOnly, filters);
      if (sequence !== refreshSequence.current || scopeKeyRef.current !== requestScopeKey) return;
      setNotifications(next);
      setLoadedScopeKey(requestScopeKey);
      setLoaded(true);
    } catch (caught) {
      if (sequence === refreshSequence.current && scopeKeyRef.current === requestScopeKey) {
        setNotifications([]);
        setLoadedScopeKey("");
        setErrorScopeKey(requestScopeKey);
        setError(caught instanceof Error ? caught.message : "通知读取失败。");
      }
    } finally {
      if (sequence === refreshSequence.current && scopeKeyRef.current === requestScopeKey) setBusy(false);
    }
  }, [filters, scopeKey, unreadOnly]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  const unreadCount = useMemo(() => scopedNotifications.filter((item) => !item.readAt).length, [scopedNotifications]);

  const markOneRead = useCallback(async (notification: NotificationItem) => {
    if (notification.readAt) return;
    const operationScopeKey = scopeKey;
    await runLatestNotificationOperation({
      begin: () => ++refreshSequence.current,
      isCurrent: (sequence) => sequence === refreshSequence.current && scopeKeyRef.current === operationScopeKey,
      operation: () => markNotificationRead(notification.id, notificationIdentityExpectation(notification)),
      onStart: () => { setBusy(true); setError(""); setNotice(""); },
      onSuccess: (updated) => {
        setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
        setNoticeScopeKey(operationScopeKey);
        setNotice("已标记“" + notification.title + "”为已读。");
      },
      onError: (caught) => {
        setErrorScopeKey(operationScopeKey);
        setError(caught instanceof Error ? caught.message : "通知状态更新失败，服务端未确认结果。");
      },
      onFinally: () => setBusy(false),
    });
  }, [scopeKey]);

  const markAllRead = useCallback(async (expectedScopeKey = scopeKey) => {
    if (expectedScopeKey !== scopeKey || scopeKeyRef.current !== expectedScopeKey) return false;
    const operationScopeKey = scopeKey;
    return runLatestNotificationOperation({
      begin: () => ++refreshSequence.current,
      isCurrent: (sequence) => sequence === refreshSequence.current && scopeKeyRef.current === operationScopeKey,
      operation: async () => {
        const result = await markAllNotificationsRead(filters);
        return { result, notifications: await getNotifications(unreadOnly, filters) };
      },
      onStart: () => { setBusy(true); setError(""); setNotice(""); },
      onSuccess: ({ result, notifications: next }) => {
        setNoticeScopeKey(operationScopeKey);
        setNotice("服务端已标记 " + result.count + " 条通知为已读。");
        setNotifications(next);
        setLoadedScopeKey(operationScopeKey);
        setLoaded(true);
      },
      onError: (caught) => {
        setNotifications([]);
        setLoaded(false);
        setErrorScopeKey(operationScopeKey);
        setError(caught instanceof Error ? caught.message : "批量标记失败，服务端未确认结果。");
      },
      onFinally: () => setBusy(false),
    });
  }, [filters, scopeKey, unreadOnly]);

  return {
    notifications: scopedNotifications,
    loaded: scopeLoaded,
    scopeKey,
    unreadOnly,
    setUnreadOnly,
    unreadCount,
    busy,
    error: errorScopeKey === scopeKey ? error : "",
    notice: noticeScopeKey === scopeKey ? notice : "",
    refresh,
    markOneRead,
    markAllRead,
  };
}

function notificationIdentityExpectation(notification: NotificationItem): IdentityExpectation {
  const target = notification.target;
  return identityExpectation({
    target: {
      wechatAccountId: stringValue(target?.wechatAccountId),
      conversationId: stringValue(target?.conversationId),
      customerId: stringValue(target?.customerId),
    },
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
