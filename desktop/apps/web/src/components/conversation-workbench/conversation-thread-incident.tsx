import { AlertTriangle } from "lucide-react";
import styles from "./conversation-thread-pane.module.css";
import type { ConversationWorkbenchActions, ConversationWorkbenchIncident } from "./types";

export function IncidentCard({ incident, actions }: { incident: ConversationWorkbenchIncident; actions: ConversationWorkbenchActions }) {
  return (
    <article className={`${styles.incidentCard} ${styles[`incident-${incident.tone}`]}`}>
      <AlertTriangle size={17} aria-hidden="true" />
      <div>
        <div className={styles.incidentHeader}>
          <strong>{incident.title}</strong>{incident.occurredAtLabel ? <time>{incident.occurredAtLabel}</time> : null}
        </div>
        <p>{incident.detail}</p>
        {incident.reason ? <small>原因：{incident.reason}</small> : null}
      </div>
      <div className={styles.incidentActions}>
        {incident.policyActionLabel && actions.onOpenIncidentPolicy ? <button type="button" data-action-id={`conversations.incident-${incident.id}.open-policy`} onClick={() => actions.onOpenIncidentPolicy?.(incident.id)} aria-label={`查看异常处理策略：${incident.title}`}>{incident.policyActionLabel}</button> : null}
        {incident.retryActionLabel && actions.onRetryIncident ? <button type="button" data-action-id={`conversations.incident-${incident.id}.retry`} data-disabled-reason={incident.retryDisabled ? "当前异常不允许重试" : undefined} onClick={() => actions.onRetryIncident?.(incident.id)} disabled={incident.retryDisabled} aria-label={`重试异常处理：${incident.title}`}>{incident.retryActionLabel}</button> : null}
      </div>
    </article>
  );
}
