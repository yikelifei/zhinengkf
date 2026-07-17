import type { ReactNode } from "react";
import styles from "./route-state.module.css";

export type WorkbenchRouteStateProps = {
  eyebrow?: string;
  title: string;
  description: string;
  tone?: "loading" | "empty" | "error" | "not-found";
  action?: ReactNode;
};

export function WorkbenchRouteState({
  eyebrow = "智能体客服工作台",
  title,
  description,
  tone = "empty",
  action,
}: WorkbenchRouteStateProps) {
  return (
    <main className={styles.viewport} data-tone={tone}>
      <section className={styles.card} role={tone === "error" ? "alert" : "status"} aria-live="polite">
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {tone === "loading" ? <span className={styles.progress} aria-hidden="true" /> : null}
        {action ? <div className={styles.action}>{action}</div> : null}
      </section>
    </main>
  );
}

export function WorkbenchEmptyState({ title, description, action }: Pick<WorkbenchRouteStateProps, "title" | "description" | "action">) {
  return <WorkbenchRouteState title={title} description={description} action={action} tone="empty" />;
}
