"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import type { DesignJobCreateReadiness } from "./design-job-create-model";
import styles from "./design-pages.module.css";

export function DesignJobCreateReadinessPanel({ readiness }: { readiness: DesignJobCreateReadiness }) {
  return (
    <section className={styles.endpoint} aria-label="创建前完整性校验">
      <strong>创建前完整性校验</strong>
      <span>{readiness.ok ? "客户图、商品图、搭配图和预算已满足创建条件。" : "先补齐红色项目，再创建任务；缺图不要等提交臻希 AI 时才失败。"}</span>
      <ul className={styles.checkList}>
        {readiness.checks.map((check) => (
          <li className={check.ok ? styles.ok : styles.bad} key={check.code} data-readiness-code={check.code}>
            <div>
              <strong>{check.label}</strong>
              <span>{check.detail}</span>
            </div>
            {check.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
          </li>
        ))}
      </ul>
    </section>
  );
}
