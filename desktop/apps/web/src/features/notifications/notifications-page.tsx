"use client";

import { useState } from "react";
import type { IdentityFilters, NotificationItem } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { useNotificationsController } from "./use-notifications-controller";

export type NotificationsPageProps = { identityFilters?: IdentityFilters };

export function NotificationsPage({ identityFilters }: NotificationsPageProps) {
  const controller = useNotificationsController(identityFilters);
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  async function confirmMarkAll() {
    if (await controller.markAllRead()) setConfirmationOpen(false);
  }

  const statusClass = controller.notifications.length
    ? controller.unreadCount ? styles.toneWarning : styles.toneOk
    : styles.toneError;

  return (
    <section className={styles.page} aria-labelledby="notifications-title" aria-busy={controller.busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Notifications</span>
          <h1 id="notifications-title">通知中心</h1>
          <p className={styles.description}>只负责阅读通知和管理已读状态；业务处理需要进入通知指向的责任页。</p>
        </div>
        <button className={styles.button} type="button" data-action-id="notifications-refresh" aria-label="刷新通知列表" onClick={() => void controller.refresh()} disabled={controller.busy}>刷新通知</button>
      </header>

      {controller.error ? <div className={styles.notice + " " + styles.noticeError} role="alert">{controller.error}</div> : null}
      {controller.notice ? <div className={styles.notice + " " + styles.noticeSuccess} role="status">{controller.notice}</div> : null}

      <section className={styles.panel} aria-labelledby="notification-list-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="notification-list-title">通知列表</h2>
            <p>{controller.notifications.length
              ? "当前返回 " + controller.notifications.length + " 条，其中 " + controller.unreadCount + " 条未读。"
              : "当前读取结果未确认。"}</p>
          </div>
          <span className={styles.badge + " " + statusClass}>
            {controller.notifications.length ? controller.unreadCount ? controller.unreadCount + " 未读" : "已处理" : "未确认"}
          </span>
        </header>
        <div className={styles.panelBody}>
          <div className={styles.actionBar}>
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={controller.unreadOnly} onChange={(event) => controller.setUnreadOnly(event.target.checked)} />
              只看未读
            </label>
            <button className={styles.button} type="button" data-action-id="notifications-mark-all-request" aria-label="请求将当前身份范围内的通知全部标为已读" onClick={() => setConfirmationOpen(true)} disabled={controller.busy || controller.unreadCount === 0}>
              全部标为已读
            </button>
          </div>

          {controller.notifications.length ? (
            <div className={styles.recordList}>
              {controller.notifications.map((notification) => (
                <NotificationRow
                  notification={notification}
                  busy={controller.busy}
                  onMarkRead={() => void controller.markOneRead(notification)}
                  key={notification.id}
                />
              ))}
            </div>
          ) : <div className={styles.empty}>未取得可确认的通知记录，不能据此认定没有未读通知。</div>}
        </div>
      </section>

      {confirmationOpen ? (
        <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="notifications-confirm-title">
          <strong id="notifications-confirm-title">确认全部标为已读</strong>
          <p>只作用于当前页面绑定的身份范围，共 {controller.unreadCount} 条未读通知；操作后重新读取服务端结果。</p>
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} type="button" data-action-id="notifications-mark-all-confirm" aria-label="确认全部标为已读" onClick={() => void confirmMarkAll()} disabled={controller.busy}>确认处理</button>
            <button className={styles.button} type="button" data-action-id="notifications-mark-all-cancel" aria-label="取消全部标为已读" onClick={() => setConfirmationOpen(false)} disabled={controller.busy}>取消</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function NotificationRow({
  notification,
  busy,
  onMarkRead,
}: {
  notification: NotificationItem;
  busy: boolean;
  onMarkRead: () => void;
}) {
  return (
    <article className={styles.record}>
      <div className={styles.recordHeader}>
        <div><h3>{notification.title}</h3><p>{notification.body || "服务端未提供补充说明。"}</p></div>
        <span className={styles.badge + " " + notificationTone(notification)}>{notification.readAt ? "已读" : levelLabel(notification.level)}</span>
      </div>
      <div className={styles.statusLine}>
        <div className={styles.recordMeta}><span>{formatDateTime(notification.createdAt)}</span><span>ID {notification.id}</span></div>
        <button
          className={styles.quietButton}
          type="button"
          data-action-id={"notification-mark-read-" + notification.id}
          aria-label={"将通知" + notification.title + "标记为已读"}
          onClick={onMarkRead}
          disabled={busy || Boolean(notification.readAt)}
        >
          {notification.readAt ? "已读" : "标为已读"}
        </button>
      </div>
    </article>
  );
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
