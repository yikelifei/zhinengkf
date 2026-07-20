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

export function useNotificationsController(identityFilters?: IdentityFilters) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
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
    try {
      const next = await getNotifications(unreadOnly, filters);
      if (sequence !== refreshSequence.current) return;
      setNotifications(next);
    } catch (caught) {
      if (sequence === refreshSequence.current) {
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
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await markNotificationRead(notification.id, notificationIdentityExpectation(notification));
      setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice("已标记“" + notification.title + "”为已读。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "通知状态更新失败，服务端未确认结果。");
    } finally {
      setBusy(false);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await markAllNotificationsRead(filters);
      setNotice("服务端已标记 " + result.count + " 条通知为已读。");
      setNotifications(await getNotifications(unreadOnly, filters));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量标记失败，服务端未确认结果。");
      return false;
    } finally {
      setBusy(false);
    }
  }, [filters, unreadOnly]);

  return {
    notifications,
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
