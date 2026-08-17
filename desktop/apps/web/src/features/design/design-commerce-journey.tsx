import { Check, CircleDot, LockKeyhole } from "lucide-react";
import styles from "./design-commerce-journey.module.css";

export type DesignCommerceStep = "bundle" | "design" | "review" | "quote" | "order";

const STEPS: Array<{ id: DesignCommerceStep; label: string; detail: string }> = [
  { id: "bundle", label: "AI 搭品", detail: "确定商品、预算与客户" },
  { id: "design", label: "设计任务", detail: "生成并核对候选图" },
  { id: "review", label: "人工审核", detail: "确认图稿与风险" },
  { id: "quote", label: "报价", detail: "客户确认价格与选图" },
  { id: "order", label: "订单", detail: "付款后进入履约" },
];

export function DesignCommerceJourney({
  active,
  title = "从搭品到订单",
  recommendation,
  blockedReason,
}: {
  active: DesignCommerceStep;
  title?: string;
  recommendation: string;
  blockedReason?: string;
}) {
  const activeIndex = STEPS.findIndex((step) => step.id === active);
  return (
    <section className={styles.journey} aria-label="搭品到订单业务进度">
      <div className={styles.heading}>
        <div>
          <span>业务进度</span>
          <h2>{title}</h2>
        </div>
        <p data-journey-recommendation>{recommendation}</p>
      </div>
      <ol className={styles.steps}>
        {STEPS.map((step, index) => {
          const state = index < activeIndex ? "completed" : index === activeIndex ? "active" : "pending";
          return (
            <li data-state={state} key={step.id}>
              <span className={styles.icon} aria-hidden="true">
                {state === "completed" ? <Check size={16} /> : state === "active" ? <CircleDot size={16} /> : <LockKeyhole size={15} />}
              </span>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
            </li>
          );
        })}
      </ol>
      {blockedReason ? <p className={styles.blocked} role="status">当前阻断：{blockedReason}</p> : null}
    </section>
  );
}
