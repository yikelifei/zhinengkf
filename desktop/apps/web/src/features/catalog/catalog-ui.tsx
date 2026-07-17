import { AlertTriangle, CheckCircle2, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./catalog-pages.module.css";

export function CatalogHeader({ eyebrow, title, detail, actions }: { eyebrow: string; title: string; detail: string; actions?: ReactNode }) {
  return <header className={styles.pageHeader}><div><span>{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>{actions ? <div className={styles.headerActions}>{actions}</div> : null}</header>;
}
export function CatalogNotice({ tone, children }: { tone: "success" | "warning" | "danger"; children: ReactNode }) {
  return <div className={`${styles.notice} ${styles[`notice-${tone}`]}`} role={tone === "danger" ? "alert" : "status"}>{tone === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}<span>{children}</span></div>;
}
export function CatalogEmpty({ title, detail, busy = false }: { title: string; detail: string; busy?: boolean }) {
  return <div className={styles.empty} role="status" aria-busy={busy || undefined}><RefreshCw size={22} aria-hidden="true" /><strong>{title}</strong><p>{detail}</p></div>;
}
export function CatalogConfirmation({ title, detail, confirmLabel, confirmActionId, cancelActionId, busy = false, onConfirm, onCancel }: { title: string; detail: string; confirmLabel: string; confirmActionId: string; cancelActionId: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <div className={styles.confirmation} role="alertdialog" aria-modal="true" aria-labelledby={`${confirmActionId}-title`} aria-describedby={`${confirmActionId}-detail`}><AlertTriangle size={20} aria-hidden="true" /><div><strong id={`${confirmActionId}-title`}>{title}</strong><p id={`${confirmActionId}-detail`}>{detail}</p></div><div className={styles.confirmationActions}><button type="button" data-action-id={cancelActionId} aria-label="取消当前操作" disabled={busy} onClick={onCancel}><X size={15} aria-hidden="true" />取消</button><button type="button" className={styles.primaryButton} data-action-id={confirmActionId} aria-label={confirmLabel} disabled={busy} onClick={onConfirm}>{busy ? "处理中" : confirmLabel}</button></div></div>;
}
export function catalogError(error: unknown, fallback: string) { const detail = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : ""; return detail ? `${fallback}：${detail}` : fallback; }
export function money(value: number) { return Number.isFinite(value) ? `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : "—"; }
