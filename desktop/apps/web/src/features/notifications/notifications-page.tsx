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
import styles from "../governance-pages.module.css";

export type NotificationsPageProps = {
  identityFilters?: IdentityFilters;
};

export function NotificationsPage({ identityFilters }: NotificationsPageProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
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
      const nextNotifications = await getNotifications(unreadOnly, stableIdentityFilters);
      if (sequence !== refreshSequence.current) return;
      setNotifications(nextNotifications);
      if (!nextNotifications.length) {
        setError("通知接口返回空结果；当前客户端无法区分真实空列表与读取失败，因此未将其视为已全部处理。");
      }
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setError(caught instanceof Error ? caught.message : "通知读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [stableIdentityFilters, unreadOnly]);

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
      setNotice(`已标记“${notification.title}”为已读。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "通知状态更新失败，服务端未确认结果。");
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmMarkAll = useCallback(async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await markAllNotificationsRead(stableIdentityFilters);
      setPendingConfirmation(false);
      setNotice(`服务端已标记 ${result.count} 条通知为已读。`);
      setNotifications(await getNotifications(unreadOnly, stableIdentityFilters));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量标记失败，服务端未确认结果。");
    } finally {
      setBusy(false);
    }
  }, [stableIdentityFilters, unreadOnly]);

  return (
    <section className={styles.page} aria-labelledby="notifications-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Notifications</span>
          <h1 id="notifications-title">通知中心</h1>
          <p className={styles.description}>独立查看系统通知，并明确处理单条或当前身份范围内的全部未读状态。</p>
        </div>
        <button
          type="button"
          className={styles.button}
          data-action-id="notifications-refresh"
          aria-label="刷新通知列表"
          onClick={() => void refresh()}
          disabled={busy}
        >
          刷新通知
        </button>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}

      <section className={styles.panel} aria-labelledby="notification-list-title">
        <header className={styles.panelHeader}>
          <div><h2 id="notification-list-title">通知列表</h2><p>{notifications.length ? `当前返回 ${notifications.length} 条，其中 ${unreadCount} 条未读。` : "当前读取结果未确认。"}</p></div>
          <span className={`${styles.badge} ${notifications.length ? unreadCount ? styles.toneWarning : styles.toneOk : styles.toneError}`}>{notifications.length ? unreadCount ? `${unreadCount} 未读` : "已处理" : "未确认"}</span>
        </header>
        <div className={styles.panelBody}>
          <div className={styles.actionBar}>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) => setUnreadOnly(event.target.checked)}
              />
              只看未读
            </label>
            <button
              type="button"
              className={styles.button}
              data-action-id="notifications-mark-all-request"
              aria-label="请求将当前身份范围内的通知全部标为已读"
              onClick={() => setPendingConfirmation(true)}
              disabled={busy || unreadCount === 0}
            >
              全部标为已读
            </button>
          </div>

          {notifications.length ? (
            <div className={styles.recordList}>
              {notifications.map((notification) => (
                <article className={styles.record} key={notification.id}>
                  <div className={styles.recordHeader}>
                    <div><h3>{notification.title}</h3><p>{notification.body || "服务端未提供补充说明。"}</p></div>
                    <span className={`${styles.badge} ${notificationTone(notification)}`}>{notification.readAt ? "已读" : levelLabel(notification.level)}</span>
                  </div>
                  <div className={styles.statusLine}>
                    <div className={styles.recordMeta}><span>{formatDateTime(notification.createdAt)}</span><span>ID {notification.id}</span></div>
                    <button
                      type="button"
                      className={styles.quietButton}
                      data-action-id={`notification-mark-read-${notification.id}`}
                      aria-label={`将通知${notification.title}标记为已读`}
                      onClick={() => void markOneRead(notification)}
                      disabled={busy || Boolean(notification.readAt)}
                    >
                      {notification.readAt ? "已读" : "标为已读"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className={styles.empty}>未取得可确认的通知记录，不能据此认定没有未读通知。</div>}
        </div>
      </section>

      {pendingConfirmation ? (
          <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="notifications-confirm-title">
          <strong id="notifications-confirm-title">确认全部标为已读</strong>
          <p>此操作只作用于当前页面绑定的身份范围，共 {unreadCount} 条未读通知。操作后需重新读取服务端结果。</p>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="notifications-mark-all-confirm"
              aria-label="确认全部标为已读"
              onClick={() => void confirmMarkAll()}
              disabled={busy}
            >
              确认处理
            </button>
            <button
              type="button"
              className={styles.button}
              data-action-id="notifications-mark-all-cancel"
              aria-label="取消全部标为已读"
              onClick={() => setPendingConfirmation(false)}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
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

function notificationTone(notification: NotificationItem) {
  if (notification.readAt) return styles.toneMuted;
  if (notification.level === "error") return styles.toneError;
  if (notification.level === "warning") return styles.toneWarning;
  return styles.toneOk;
}

function levelLabel(level: string) {
  if (level === "error") return "错误";
  if (level === "warning") return "警告";
  return "信息";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
