"use client";

import { Play, SearchCheck } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  completeClientOperation,
  identityExpectation,
  reserveClientOperation,
  type DesignJobPreflightResult,
  type PendingClientOperation,
} from "../../lib/api";
import { preflightDesignJob, submitDesignJob } from "./api";
import styles from "./design-pages.module.css";
import { DesignConfirmation, DesignEmpty, DesignNotice, DesignPageHeader, errorText } from "./design-ui";
import { useDesignJobs } from "./use-design-job";

export function DesignJobSubmitPage({ jobId }: { jobId: string }) {
  const { selected, loading, error: loadError, replace } = useDesignJobs(jobId);
  const [preflight, setPreflight] = useState<DesignJobPreflightResult | null>(null);
  const [busy, setBusy] = useState<"" | "preflight" | "submit">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const pendingSubmitOperation = useRef<PendingClientOperation | null>(null);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = Boolean(expected.expectedWechatAccountId && expected.expectedConversationId && expected.expectedCustomerId);

  async function inspect() {
    if (!selected || !identityReady) return;
    setBusy("preflight"); setError(""); setNotice(""); setPreflight(null);
    try {
      const result = await preflightDesignJob(selected.id, expected);
      setPreflight(result);
      if (result.ok) setNotice("预检通过，可以在二次确认后正式提交。此前的预检结果不会自动提交任务。");
      else setError("预检未通过，请先处理失败检查项。");
    } catch (cause) { setError(errorText(cause, "设计任务预检失败")); }
    finally { setBusy(""); }
  }

  async function submit() {
    if (!selected || !identityReady || !preflight?.ok || preflight.designJobId !== selected.id) return;
    setConfirming(false); setBusy("submit"); setError(""); setNotice("");
    const requestIntent = {
      designJobId: selected.id,
      requestId: selected.requestId,
      scene: selected.scene || null,
      outputCount: selected.outputCount,
      budget: selected.budget,
      bundle: selected.bundle || null,
      expected,
    };
    const operation = reserveClientOperation("design-submit", requestIntent, pendingSubmitOperation.current);
    pendingSubmitOperation.current = operation;
    try {
      const updated = await submitDesignJob(selected.id, operation.key, expected);
      pendingSubmitOperation.current = completeClientOperation(pendingSubmitOperation.current, operation.key);
      replace(updated); setPreflight(null); setNotice(`任务 ${updated.requestId} 已正式提交。`);
    } catch (cause) { setError(errorText(cause, "设计任务提交失败")); }
    finally { setBusy(""); }
  }

  return (
    <section className={styles.page} aria-label="提交设计任务">
      <DesignPageHeader eyebrow="设计平台 · 任务提交" title="预检并提交" detail="本页只完成一条设计任务的预检与正式提交，不同步其他任务状态。" />
      {loadError || error ? <DesignNotice tone="danger">{error || loadError}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      {loading ? <DesignEmpty title="正在读取设计任务" detail={`任务 ${jobId}`} busy /> : selected ? (
        <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>{selected.requestId}</h2><p>{selected.customer?.name || "客户未知"}</p></div><span className={styles.statusPill}>{selected.status}</span></div>
          {!identityReady ? <DesignNotice tone="danger">任务缺少账号、会话或客户身份，已阻止预检和提交。</DesignNotice> : null}
          <div className={styles.actionRow}>
            <button type="button" data-action-id="design-job-submit-preflight" disabled={Boolean(busy) || !identityReady} onClick={() => void inspect()}><SearchCheck size={16} aria-hidden="true" />{busy === "preflight" ? "预检中" : "执行预检"}</button>
            <button type="button" className={styles.primaryButton} data-action-id="design-job-submit-request" disabled={Boolean(busy) || !preflight?.ok || preflight.designJobId !== selected.id} onClick={() => setConfirming(true)}><Play size={16} aria-hidden="true" />准备正式提交</button>
          </div>
          {preflight ? <div className={styles.preflight}><strong>预检 {preflight.ok ? "通过" : "未通过"}</strong><ul>{preflight.checks.map((check) => <li className={check.ok ? styles.ok : styles.bad} key={check.key}><span>{check.label}</span><small>{check.detail || "无明细"}</small></li>)}</ul></div> : null}
          <Link className={styles.backLink} href={`/design/jobs/${encodeURIComponent(selected.id)}`} data-action-id="design-job-submit-back">返回任务详情</Link>
        </article>
      ) : <DesignEmpty title="没有找到设计任务" detail="返回任务列表重新选择。" />}
      {confirming && selected ? <DesignConfirmation title="确认正式提交这条设计任务？" detail={`任务 ${selected.requestId} 已通过预检。提交后会调用外部设计平台。`} confirmLabel="确认正式提交" confirmActionId="design-job-submit-confirm" cancelActionId="design-job-submit-cancel" busy={busy === "submit"} danger onCancel={() => setConfirming(false)} onConfirm={() => void submit()} /> : null}
    </section>
  );
}
