import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, LoaderCircle } from "lucide-react";
import styles from "./integration-pages.module.css";

type FeaturePageProps = {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
  children: ReactNode;
};

export function FeaturePage({ id, title, description, icon, actions, busy = false, children }: FeaturePageProps) {
  const titleId = `${id}-title`;
  return (
    <section className={styles.page} id={id} aria-labelledby={titleId} aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.headingIcon} aria-hidden="true">{icon}</span>
          <div>
            <h1 id={titleId}>{title}</h1>
            <p>{description}</p>
          </div>
        </div>
        {actions ? <div className={styles.pageActions}>{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function FeatureNotice({
  tone,
  title,
  children,
}: {
  tone: "info" | "warning" | "error" | "success";
  title: string;
  children?: ReactNode;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  const toneClass = {
    info: styles.noticeInfo,
    warning: styles.noticeWarning,
    error: styles.noticeError,
    success: styles.noticeSuccess,
  }[tone];
  return (
    <div className={`${styles.notice} ${toneClass}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {children ? <p>{children}</p> : null}
      </div>
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className={styles.loadingState} role="status">
      <div><LoaderCircle size={22} aria-hidden="true" /><strong>{label}</strong></div>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className={styles.emptyState} role="status">
      <div><strong>{title}</strong><span>{detail}</span></div>
    </div>
  );
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
