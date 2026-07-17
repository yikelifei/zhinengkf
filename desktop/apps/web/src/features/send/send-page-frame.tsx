import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, LoaderCircle } from "lucide-react";
import styles from "./send-pages.module.css";

export function SendPageFrame({
  id,
  title,
  description,
  icon,
  actions,
  busy = false,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <section className={styles.page} id={id} aria-labelledby={titleId} aria-busy={busy}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.headingIcon} aria-hidden="true">{icon}</span>
          <div><h1 id={titleId}>{title}</h1><p>{description}</p></div>
        </div>
        {actions ? <div className={styles.headerActions}>{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function SendNotice({ tone, title, children }: { tone: "info" | "warning" | "error" | "success"; title: string; children?: ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  const toneClass = { info: styles.noticeInfo, warning: styles.noticeWarning, error: styles.noticeError, success: styles.noticeSuccess }[tone];
  return (
    <div className={`${styles.notice} ${toneClass}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <div><strong>{title}</strong>{children ? <p>{children}</p> : null}</div>
    </div>
  );
}

export function SendLoading({ label }: { label: string }) {
  return <div className={styles.loadingState} role="status"><div><LoaderCircle size={21} aria-hidden="true" /><strong>{label}</strong></div></div>;
}

export function SendEmpty({ title, detail }: { title: string; detail: string }) {
  return <div className={styles.emptyState} role="status"><div><strong>{title}</strong><span>{detail}</span></div></div>;
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
