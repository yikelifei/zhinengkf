import { ArrowRight, CircleAlert, CircleCheck, CircleDot, Clock3, Route } from "lucide-react";
import Link from "next/link";
import styles from "./customer-service-journey.module.css";

export type CustomerServiceJourneyTone = "ready" | "warning" | "danger" | "muted";

export type CustomerServiceJourneyStep = {
  id: string;
  label: string;
  detail: string;
  statusLabel: string;
  tone: CustomerServiceJourneyTone;
  href: string;
  actionLabel: string;
};

type CustomerServiceJourneyProps = {
  title?: string;
  description?: string;
  steps: CustomerServiceJourneyStep[];
  recommended?: {
    label: string;
    detail: string;
    href: string;
    actionLabel: string;
    tone: CustomerServiceJourneyTone;
  };
  busy?: boolean;
};

const statusIcons = {
  ready: CircleCheck,
  warning: Clock3,
  danger: CircleAlert,
  muted: CircleDot,
} as const;

export function CustomerServiceJourney({
  title = "从客户咨询到成交的使用链路",
  description = "按顺序完成每一步；处理客户时优先从会话内进入，客户、账号和会话身份会随业务动作继续传递。",
  steps,
  recommended,
  busy = false,
}: CustomerServiceJourneyProps) {
  return (
    <section className={styles.journey} aria-labelledby="customer-service-journey-title" aria-busy={busy}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}><Route size={14} aria-hidden="true" />业务主链路</span>
          <h2 id="customer-service-journey-title">{title}</h2>
          <p>{description}</p>
        </div>
        {recommended ? (
          <div className={styles.recommended} data-tone={recommended.tone}>
            <span>当前建议</span>
            <strong>{recommended.label}</strong>
            <small>{recommended.detail}</small>
            <Link href={recommended.href} data-action-id="journey.recommended.open">
              {recommended.actionLabel}<ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </header>

      <ol className={styles.steps} aria-label="智能客服业务步骤">
        {steps.map((step, index) => {
          const StatusIcon = statusIcons[step.tone];
          return (
            <li key={step.id} data-tone={step.tone}>
              <div className={styles.stepTop}>
                <span className={styles.order}>{index + 1}</span>
                <span className={styles.status}><StatusIcon size={13} aria-hidden="true" />{step.statusLabel}</span>
              </div>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
              <Link href={step.href} data-action-id={`journey.${step.id}.open`}>
                {step.actionLabel}<ArrowRight size={13} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
