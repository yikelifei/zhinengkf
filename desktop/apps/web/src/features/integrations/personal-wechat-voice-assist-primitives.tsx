"use client";

import type { ReactNode } from "react";
import styles from "./integration-pages.module.css";

export function VoiceActionButton({
  actionId,
  label,
  reasonId,
  disabledReason,
  onAction,
  primary = false,
  children,
}: {
  actionId: string;
  label: string;
  reasonId: string;
  disabledReason?: string;
  onAction?: () => void;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-action-id={actionId}
      data-disabled-reason={disabledReason ?? "无"}
      aria-label={label}
      aria-describedby={reasonId}
      title={disabledReason ?? `${label}已就绪`}
      className={primary ? styles.primaryButton : undefined}
      onClick={onAction}
      disabled={Boolean(disabledReason)}
    >
      {children}
    </button>
  );
}

export function VoiceStageHeading({
  icon,
  step,
  title,
  status,
  ready,
}: {
  icon: ReactNode;
  step: string;
  title: string;
  status: string;
  ready: boolean;
}) {
  return (
    <div className={styles.cardHeader}>
      <div>
        <span aria-hidden="true">{icon}</span>
        <strong>{step}. {title}</strong>
      </div>
      <span className={`${styles.statusBadge} ${ready ? styles.statusReady : ""}`}>{status}</span>
    </div>
  );
}
