import type { ReactNode } from "react";
import type { SendTask } from "../../lib/api";
import { sendStatusLabel, taskCustomerLabel, taskMessagePreview } from "./send-policy";
import styles from "./send-pages.module.css";

export function SendTaskCard({ task, hint, actions }: { task: SendTask; hint?: string; actions?: ReactNode }) {
  const statusTone = ["blocked", "failed", "uncertain"].includes(task.status)
    ? styles.statusDanger
    : task.status === "sent"
      ? styles.statusSuccess
      : task.status === "cancelled"
        ? styles.statusMuted
        : "";
  return (
    <article className={styles.taskCard} aria-labelledby={`send-task-${task.id}-title`}>
      <header className={styles.taskHeader}>
        <div><h2 id={`send-task-${task.id}-title`}>{task.conversation?.title || task.conversationId || "未绑定会话"}</h2><p>任务 ID：{task.id}</p></div>
        <span className={`${styles.statusBadge} ${statusTone}`}>{sendStatusLabel(task.status)}</span>
      </header>
      <dl className={styles.identityGrid} aria-label="发送任务身份绑定">
        <div><dt>微信账号</dt><dd>{task.wechatAccount?.displayName || task.wechatAccountId || "缺失"}</dd></div>
        <div><dt>会话</dt><dd>{task.conversationId || "缺失"}</dd></div>
        <div><dt>客户</dt><dd>{taskCustomerLabel(task)}</dd></div>
        <div><dt>创建时间</dt><dd>{formatTime(task.createdAt)}</dd></div>
      </dl>
      <div className={styles.messagePreview}>{taskMessagePreview(task)}</div>
      {task.guardSnapshot?.checks?.length ? (
        <div className={styles.guardGrid} aria-label="最近发送安全校验">
          {task.guardSnapshot.checks.map((check) => (
            <div className={styles.guardItem} key={check.key}>
              <span>{check.label || check.key}</span>
              <strong className={check.passed ? styles.passedText : styles.failedText}>{check.passed ? "通过" : "未通过"}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {hint ? <div className={styles.taskHint} role="status">{hint}</div> : null}
      {task.errorMessage ? <p className={styles.dangerText}>{task.errorMessage}</p> : null}
      {actions ? <div className={styles.taskActions}>{actions}</div> : null}
    </article>
  );
}

export function SendConfirmation({
  actionIdPrefix,
  title,
  detail,
  task,
  confirmLabel,
  busy,
  danger = false,
  onConfirm,
  onCancel,
}: {
  actionIdPrefix: string;
  title: string;
  detail: string;
  task?: SendTask | null;
  confirmLabel: string;
  busy: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <section className={styles.confirmation} aria-labelledby={`${actionIdPrefix}-title`}>
      <header className={styles.confirmationHeader}>
        <div><h2 id={`${actionIdPrefix}-title`}>{title}</h2><p>{detail}</p></div>
      </header>
      {task ? (
        <div className={styles.confirmationIdentity} aria-label="待确认发送身份">
          <div><span>微信账号</span><strong>{task.wechatAccount?.displayName || task.wechatAccountId || "缺失"}</strong></div>
          <div><span>会话</span><strong>{task.conversation?.title || task.conversationId || "缺失"}</strong></div>
          <div><span>客户</span><strong>{taskCustomerLabel(task)}</strong></div>
        </div>
      ) : null}
      {task ? <div className={styles.messagePreview}>{taskMessagePreview(task)}</div> : null}
      <div className={styles.buttonRow}>
        <button
          type="button"
          data-action-id={`${actionIdPrefix}.cancel`}
          aria-label={`取消${confirmLabel}`}
          onClick={onCancel}
          disabled={busy}
        >取消</button>
        <button
          type="button"
          className={danger ? styles.dangerButton : styles.primaryButton}
          data-action-id={`${actionIdPrefix}.confirm`}
          aria-label={`确认${confirmLabel}`}
          onClick={onConfirm}
          disabled={busy}
        >{busy ? "处理中" : confirmLabel}</button>
      </div>
    </section>
  );
}

function formatTime(value?: string | null) {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
