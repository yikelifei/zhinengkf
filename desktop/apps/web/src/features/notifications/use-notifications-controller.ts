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
import { runLatestNotificationOperation } from "./notification-operation-guard";

export function useNotificationsController(identityFilters?: IdentityFilters) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refreshSequence = useRef(0);
  const filters = useMemo<IdentityFilters>(() => ({
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    setLoaded(false);
    try {
      const next = await getNotifications(unreadOnly, filters);
      if (sequence !== refreshSequence.current) return;
      setNotifications(next);
      setLoaded(true);
    } catch (caught) {
      if (sequence === refreshSequence.current) {
        setNotifications([]);
        setError(caught instanceof Error ? caught.message : "通知读取失败。");
      }
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [filters, unreadOnly]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.readAt).length, [notifications]);

  const markOneRead = useCallback(async (notification: NotificationItem) => {
    if (notification.readAt) return;
    await runLatestNotificationOperation({
      begin: () => ++refreshSequence.current,
      isCurrent: (sequence) => sequence === refreshSequence.current,
      operation: () => markNotificationRead(notification.id, notificationIdentityExpectation(notification)),
      onStart: () => { setBusy(true); setError(""); setNotice(""); },
      onSuccess: (updated) => {
        setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
        setNotice("已标记“" + notification.title + "”为已读。");
      },
      onError: (caught) => setError(caught instanceof Error ? caught.message : "通知状态更新失败，服务端未确认结果。"),
      onFinally: () => setBusy(false),
    });
  }, []);

  const markAllRead = useCallback(async () => {
    return runLatestNotificationOperation({
      begin: () => ++refreshSequence.current,
      isCurrent: (sequence) => sequence === refreshSequence.current,
      operation: async () => {
        const result = await markAllNotificationsRead(filters);
        return { result, notifications: await getNotifications(unreadOnly, filters) };
      },
      onStart: () => { setBusy(true); setError(""); setNotice(""); },
      onSuccess: ({ result, notifications: next }) => {
        setNotice("服务端已标记 " + result.count + " 条通知为已读。");
        setNotifications(next);
        setLoaded(true);
      },
      onError: (caught) => {
        setNotifications([]);
        setLoaded(false);
        setError(caught instanceof Error ? caught.message : "批量标记失败，服务端未确认结果。");
      },
      onFinally: () => setBusy(false),
    });
  }, [filters, unreadOnly]);

  return {
    notifications,
    loaded,
    unreadOnly,
    setUnreadOnly,
    unreadCount,
    busy,
    error,
    notice,
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
