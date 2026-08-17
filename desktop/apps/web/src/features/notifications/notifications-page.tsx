"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { IdentityFilters, NotificationItem } from "../../lib/api";
import styles from "../governance-pages.module.css";
import {
  createNotificationConfirmationGuard,
  type NotificationConfirmationToken,
} from "./notification-operation-guard";
import {
  groupNotificationsForDisplay,
  notificationBodyForOperator,
  type NotificationDisplayGroup,
} from "./notification-presentation";
import { notificationTargetHref } from "./notification-navigation";
import { useNotificationsController } from "./use-notifications-controller";

export type NotificationsPageProps = { identityFilters?: IdentityFilters };

export function NotificationsPage({ identityFilters }: NotificationsPageProps) {
  const controller = useNotificationsController(identityFilters);
  const confirmationGuardRef = useRef<ReturnType<typeof createNotificationConfirmationGuard> | null>(null);
  if (!confirmationGuardRef.current) {
    confirmationGuardRef.current = createNotificationConfirmationGuard(controller.scopeKey);
  }
  const confirmationGuard = confirmationGuardRef.current;
  confirmationGuard.setScope(controller.scopeKey);
  const [confirmationToken, setConfirmationToken] = useState<NotificationConfirmationToken | null>(null);
  const confirmationOpen = Boolean(
    confirmationToken && confirmationGuard.isCurrent(confirmationToken, controller.scopeKey),
  );
  const displayGroups = useMemo(
    () => groupNotificationsForDisplay(controller.notifications),
    [controller.notifications],
  );

  async function confirmMarkAll() {
    if (!confirmationToken || !confirmationGuard.consume(confirmationToken, controller.scopeKey)) {
      setConfirmationToken(null);
      return;
    }
    setConfirmationToken(null);
    await controller.markAllRead(confirmationToken.scopeKey);
  }

  const statusClass = controller.readState === "unknown"
    ? styles.toneError
    : controller.readState === "loading"
      ? styles.toneMuted
    : controller.readState === "stale" || controller.unreadCount ? styles.toneWarning : styles.toneOk;

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
            <p>{controller.readState === "stale"
              ? "最新刷新失败，当前显示上次在同一身份范围内成功读取的可信结果；处理前请重新刷新。"
              : controller.loaded
              ? controller.notifications.length
                ? "当前返回 " + controller.notifications.length + " 条，其中 " + controller.unreadCount + " 条未读；合并显示 " + displayGroups.length + " 组。"
                : "读取成功，当前身份范围内没有通知。"
              : "当前读取结果未确认。"}</p>
          </div>
          <span className={styles.badge + " " + statusClass}>
            {controller.readState === "stale" ? "旧结果 / 待刷新" : controller.loaded ? controller.unreadCount ? controller.unreadCount + " 未读" : controller.notifications.length ? "已处理" : "暂无通知" : controller.readState === "loading" ? "读取中" : "未确认"}
          </span>
        </header>
        <div className={styles.panelBody}>
          <div className={styles.actionBar}>
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={controller.unreadOnly} disabled={controller.busy} onChange={(event) => controller.setUnreadOnly(event.target.checked)} />
              只看未读
            </label>
            <button className={styles.button} type="button" data-action-id="notifications-mark-all-request" aria-label="请求将当前身份范围内的通知全部标为已读" onClick={() => setConfirmationToken(confirmationGuard.begin(controller.scopeKey))} disabled={controller.busy || controller.unreadCount === 0}>
              全部标为已读
            </button>
          </div>

          {controller.loaded && controller.notifications.length ? (
            <div className={styles.recordList}>
              {displayGroups.map((group) => (
                <NotificationRow
                  group={group}
                  busy={controller.busy}
                  identityFilters={identityFilters}
                  onMarkRead={() => void controller.markGroupRead(group.notifications)}
                  key={group.notification.id}
                />
              ))}
            </div>
          ) : <div className={styles.empty}>{controller.loaded
            ? "读取成功，当前身份范围内没有通知。"
            : "通知列表尚未成功读取，不能据此认定没有未读通知。"}</div>}
        </div>
      </section>

      {confirmationOpen ? (
        <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="notifications-confirm-title">
          <strong id="notifications-confirm-title">确认全部标为已读</strong>
          <p>只作用于当前页面绑定的身份范围，共 {controller.unreadCount} 条未读通知；操作后重新读取服务端结果。</p>
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} type="button" data-action-id="notifications-mark-all-confirm" aria-label="确认全部标为已读" onClick={() => void confirmMarkAll()} disabled={controller.busy}>确认处理</button>
            <button className={styles.button} type="button" data-action-id="notifications-mark-all-cancel" aria-label="取消全部标为已读" onClick={() => setConfirmationToken(null)} disabled={controller.busy}>取消</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function NotificationRow({
  group,
  busy,
  identityFilters,
  onMarkRead,
}: {
  group: NotificationDisplayGroup;
  busy: boolean;
  identityFilters?: IdentityFilters;
  onMarkRead: () => void;
}) {
  const notification = group.notification;
  const target = group.hasMixedTargets ? null : notificationTargetHref(notification, identityFilters);
  return (
    <article className={styles.record}>
      <div className={styles.recordHeader}>
        <div>
          <h3>{notification.title}</h3>
          <p>{notificationBodyForOperator(notification.body)}</p>
        </div>
        <span className={styles.badge + " " + notificationTone(notification, group.unreadCount)}>{group.unreadCount === 0 ? "已读" : levelLabel(notification.level)}</span>
      </div>
      <div className={styles.statusLine}>
        <div className={styles.recordMeta}>
          <span>{formatDateTime(group.newestCreatedAt)}</span>
          {group.occurrenceCount > 1 ? <span>同类通知 {group.occurrenceCount} 次</span> : null}
          {group.hasMixedTargets ? <span>关联多个责任对象</span> : null}
          {group.occurrenceCount > 1 ? <span>最早 {formatDateTime(group.oldestCreatedAt)}</span> : <span>ID {notification.id}</span>}
        </div>
        {target ? <Link className={styles.quietButton} href={target.href} data-action-id={"notification-open-target-" + notification.id}>{target.label}</Link> : null}
        <button
          className={styles.quietButton}
          type="button"
          data-action-id={"notification-mark-read-" + notification.id}
          aria-label={"将通知" + notification.title + (group.occurrenceCount > 1 ? "及同类通知" : "") + "标记为已读"}
          onClick={onMarkRead}
          disabled={busy || group.unreadCount === 0}
        >
          {group.unreadCount === 0 ? "已读" : group.occurrenceCount > 1 ? "本组标为已读" : "标为已读"}
        </button>
      </div>
    </article>
  );
}

function notificationTone(notification: NotificationItem, unreadCount = notification.readAt ? 0 : 1) {
  if (unreadCount === 0) return styles.toneMuted;
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
