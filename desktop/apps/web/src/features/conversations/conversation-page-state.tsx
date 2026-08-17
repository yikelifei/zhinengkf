import Link from "next/link";
import styles from "./conversation-pages.module.css";

export function ConversationPageState({
  title,
  detail,
  tone = "neutral",
  actionLabel,
  onAction,
  actionHref,
}: {
  title: string;
  detail: string;
  tone?: "neutral" | "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
}) {
  const toneClass = tone === "danger" ? styles.noticeError : tone === "warning" ? styles.noticeWarning : "";
  return (
    <section className={styles.page} aria-label={title}>
      <div className={styles.state + " " + toneClass} role={tone === "danger" ? "alert" : "status"}>
        <h1>{title}</h1>
        <p>{detail}</p>
        {actionLabel && onAction ? <button className={styles.button} type="button" data-action-id="conversations-state-retry" aria-label={actionLabel} onClick={onAction}>{actionLabel}</button> : null}
        {actionLabel && actionHref ? <Link className={styles.button} data-action-id="conversations.state.back-filtered-list" aria-label={actionLabel} href={actionHref}>{actionLabel}</Link> : null}
      </div>
    </section>
  );
}
