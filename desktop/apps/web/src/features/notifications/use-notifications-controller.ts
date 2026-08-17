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
import { notificationReadState, notificationScopeKey, runLatestNotificationOperation } from "./notification-operation-guard";

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
  const [staleScopeKey, setStaleScopeKey] = useState("");
  const loadedScopeKeyRef = useRef(loadedScopeKey);
  loadedScopeKeyRef.current = loadedScopeKey;
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
  const readState = notificationReadState({ busy, currentScopeKey: scopeKey, loadedScopeKey, staleScopeKey });
  const scopedNotifications = scopeLoaded ? notifications : [];

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const requestScopeKey = scopeKey;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await getNotifications(unreadOnly, filters);
      if (sequence !== refreshSequence.current || scopeKeyRef.current !== requestScopeKey) return;
      setNotifications(next);
      setLoadedScopeKey(requestScopeKey);
      setStaleScopeKey("");
      setLoaded(true);
    } catch (caught) {
      if (sequence === refreshSequence.current && scopeKeyRef.current === requestScopeKey) {
        setErrorScopeKey(requestScopeKey);
        const message = caught instanceof Error ? caught.message : "通知读取失败。";
        if (loadedScopeKeyRef.current === requestScopeKey) {
          setStaleScopeKey(requestScopeKey);
          setError(`通知刷新失败，已保留上次成功读取的内容。${message}`);
        } else {
          setError(message);
        }
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
        setNotifications((current) => reconcileMarkedNotification(current, updated, unreadOnly));
        setNoticeScopeKey(operationScopeKey);
        setNotice("已标记“" + notification.title + "”为已读。");
      },
      onError: (caught) => {
        setErrorScopeKey(operationScopeKey);
        setError(caught instanceof Error ? caught.message : "通知状态更新失败，服务端未确认结果。");
      },
      onFinally: () => setBusy(false),
    });
  }, [scopeKey, unreadOnly]);

  const markGroupRead = useCallback(async (group: readonly NotificationItem[]) => {
    const unread = group.filter((notification) => !notification.readAt);
    if (!unread.length) return;
    const operationScopeKey = scopeKey;
    await runLatestNotificationOperation({
      begin: () => ++refreshSequence.current,
      isCurrent: (sequence) => sequence === refreshSequence.current && scopeKeyRef.current === operationScopeKey,
      operation: async () => {
        const updated: NotificationItem[] = [];
        let failedCount = 0;
        for (let offset = 0; offset < unread.length; offset += 5) {
          const batch = unread.slice(offset, offset + 5);
          const results = await Promise.allSettled(batch.map((notification) => (
            markNotificationRead(notification.id, notificationIdentityExpectation(notification))
          )));
          for (const result of results) {
            if (result.status === "fulfilled") updated.push(result.value);
            else failedCount += 1;
          }
        }
        return { updated, failedCount };
      },
      onStart: () => { setBusy(true); setError(""); setNotice(""); },
      onSuccess: ({ updated, failedCount }) => {
        const updatedById = new Map(updated.map((notification) => [notification.id, notification]));
        setNotifications((current) => unreadOnly
          ? current.filter((notification) => !updatedById.has(notification.id))
          : current.map((notification) => updatedById.get(notification.id) || notification));
        setNoticeScopeKey(operationScopeKey);
        setNotice(`已将本组 ${updated.length} 条未读通知标记为已读。`);
        if (failedCount) {
          setErrorScopeKey(operationScopeKey);
          setError(`另有 ${failedCount} 条通知未被服务端确认，请刷新后重试。`);
        }
      },
      onError: (caught) => {
        setErrorScopeKey(operationScopeKey);
        setError(caught instanceof Error ? caught.message : "同类通知状态更新失败，服务端未确认完整结果。");
      },
      onFinally: () => setBusy(false),
    });
  }, [scopeKey, unreadOnly]);

  const markAllRead = useCallback(async (expectedScopeKey = scopeKey) => {
    if (expectedScopeKey !== scopeKey || scopeKeyRef.current !== expectedScopeKey) return false;
    const operationScopeKey = scopeKey;
    return runLatestNotificationOperation({
      begin: () => ++refreshSequence.current,
      isCurrent: (sequence) => sequence === refreshSequence.current && scopeKeyRef.current === operationScopeKey,
      operation: async () => {
        const result = await markAllNotificationsRead(filters);
        try {
          return { result, notifications: await getNotifications(unreadOnly, filters), refreshError: "" };
        } catch (caught) {
          return {
            result,
            notifications: null,
            refreshError: caught instanceof Error ? caught.message : "通知重新读取失败。",
          };
        }
      },
      onStart: () => { setBusy(true); setError(""); setNotice(""); },
      onSuccess: ({ result, notifications: next, refreshError }) => {
        setNoticeScopeKey(operationScopeKey);
        setNotice("服务端已标记 " + result.count + " 条通知为已读。");
        if (next) {
          setNotifications(next);
          setLoadedScopeKey(operationScopeKey);
          setStaleScopeKey("");
          setLoaded(true);
        } else {
          setStaleScopeKey(operationScopeKey);
          setErrorScopeKey(operationScopeKey);
          setError(`已读操作已由服务端确认，但最新列表重新读取失败；页面保留上次结果，请稍后刷新核对。${refreshError}`);
        }
      },
      onError: (caught) => {
        setErrorScopeKey(operationScopeKey);
        setError(caught instanceof Error ? caught.message : "批量标记失败，服务端未确认结果。");
      },
      onFinally: () => setBusy(false),
    });
  }, [filters, scopeKey, unreadOnly]);

  return {
    notifications: scopedNotifications,
    loaded: scopeLoaded,
    readState,
    scopeKey,
    unreadOnly,
    setUnreadOnly,
    unreadCount,
    busy,
    error: errorScopeKey === scopeKey ? error : "",
    notice: noticeScopeKey === scopeKey ? notice : "",
    refresh,
    markOneRead,
    markGroupRead,
    markAllRead,
  };
}

export function reconcileMarkedNotification(
  current: readonly NotificationItem[],
  updated: NotificationItem,
  unreadOnly: boolean,
) {
  return unreadOnly
    ? current.filter((item) => item.id !== updated.id)
    : current.map((item) => item.id === updated.id ? updated : item);
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
