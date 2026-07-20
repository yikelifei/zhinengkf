"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { identityExpectation, reviewDesignJob, type DesignJob } from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import styles from "../governance-pages.module.css";
import { formatReviewDate, trustedReviewer, useReviewCenter, type ReviewMutationPageProps } from "./review-page-shared";

type DesignDecision = "approve_images" | "approve_send" | "request_revision" | "reject";

type PendingDesignReview = {
  jobId: string;
  decision: DesignDecision;
};

const decisions: Array<{ id: DesignDecision; label: string; danger?: boolean }> = [
  { id: "approve_images", label: "通过图稿" },
  { id: "approve_send", label: "批准发送" },
  { id: "request_revision", label: "要求修改" },
  { id: "reject", label: "驳回", danger: true },
];

export function ReviewDesignPage({ identityFilters, reviewer, reviewId }: ReviewMutationPageProps & { reviewId: string }) {
  const { center, loaded, busy, error, setError, refresh } = useReviewCenter(identityFilters);
  const [actionBusy, setActionBusy] = useState(false);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingDesignReview | null>(null);
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);
  const operator = trustedReviewer(reviewer);
  const activeJob = center?.designJobs.find((job) => job.id === reviewId) || null;

  const requestReview = (job: DesignJob, decision: DesignDecision) => {
    setError("");
    setNotice("");
    if (!operator) {
      setError("当前页面未绑定可信操作人，设计审核写操作已禁用。");
      return;
    }
    if (!note.trim()) {
      setError("请填写审核说明后再进入确认步骤。");
      return;
    }
    setPendingConfirmation({ jobId: job.id, decision });
  };

  const confirmReview = useCallback(async () => {
    if (!pendingConfirmation || !center || !operator) return;
    const job = center.designJobs.find((item) => item.id === pendingConfirmation.jobId);
    if (!job) {
      setError("设计任务已经不在当前审核队列，请刷新后重新确认。");
      setPendingConfirmation(null);
      return;
    }
    setActionBusy(true);
    setError("");
    setNotice("");
    const operationPayload = {
      id: job.id,
      decision: pendingConfirmation.decision,
      reviewer: operator,
      note: note.trim(),
      identity: identityExpectation(job),
    };
    const operation = reserveClientOperation("review-action", operationPayload, pendingOperationRef.current);
    pendingOperationRef.current = operation;
    try {
      await reviewDesignJob(job.id, {
        operationKey: operation.key,
        decision: pendingConfirmation.decision,
        reviewer: operator,
        note: note.trim(),
        ...identityExpectation(job),
      });
      pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
      setNotice(`设计任务 ${job.requestId} 已提交“${designDecisionLabel(pendingConfirmation.decision)}”审核。`);
      setPendingConfirmation(null);
      setNote("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "设计审核失败，服务端未确认结果。");
    } finally {
      setActionBusy(false);
    }
  }, [center, note, operator, pendingConfirmation, refresh, setError]);

  const disabled = busy || actionBusy;

  return (
    <section className={styles.page} aria-labelledby="review-design-title" aria-busy={disabled}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Reviews</span>
          <h1 id="review-design-title">设计审核</h1>
          <p className={styles.description}>本页只处理一项设计审核决策；每次写操作绑定任务身份并二次确认。</p>
        </div>
        <Link className={styles.button} href="/reviews/design">返回设计队列</Link>
      </header>

      {!operator ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">未连接可信操作人，本页保持只读。审核人必须由宿主身份系统传入。</div> : null}
      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}

      <section className={styles.panel} aria-labelledby="design-review-note-title">
        <header className={styles.panelHeader}><div><h2 id="design-review-note-title">本次审核说明</h2><p>当前操作人：{operator || "未绑定"}</p></div></header>
        <div className={styles.panelBody}>
          <label className={styles.field}>
            <span>审核说明</span>
            <textarea className={styles.textarea} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录通过、修改或驳回依据" disabled={!operator || disabled} />
          </label>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="design-review-list-title">
        <header className={styles.panelHeader}><div><h2 id="design-review-list-title">当前设计任务</h2><p>任务 ID：{reviewId}</p></div></header>
        <div className={styles.panelBody}>
          {activeJob ? (
            <div className={styles.recordList}>
              {[activeJob].map((job) => (
                <article className={styles.record} key={job.id}>
                  <div className={styles.recordHeader}>
                    <div><h3>{job.customer?.name || job.requestId}</h3><p>{job.scene || "未标注场景"} · {job.conversation?.title || "未标注会话"}</p></div>
                    <span className={`${styles.badge} ${job.errorMessage ? styles.toneError : job.readiness?.ok === false ? styles.toneWarning : styles.toneMuted}`}>{job.status}</span>
                  </div>
                  <dl className={styles.definitionList}>
                    <div><dt>结果图</dt><dd>{job.outputCount}</dd></div>
                    <div><dt>修改次数</dt><dd>{job.revisionCount ?? 0}</dd></div>
                    <div><dt>更新时间</dt><dd>{formatReviewDate(job.updatedAt)}</dd></div>
                  </dl>
                  {job.errorMessage ? <div className={`${styles.notice} ${styles.noticeError}`}>{job.errorMessage}</div> : null}
                  {job.readiness?.missing?.length ? <p className={styles.helpText}>缺少：{job.readiness.missing.join("、")}</p> : null}
                  <div className={styles.buttonRow}>
                    {decisions.map((decision) => (
                      <button
                        type="button"
                        className={decision.danger ? styles.dangerButton : decision.id.startsWith("approve") ? styles.primaryButton : styles.button}
                        data-action-id={`review-design-${decision.id}-${job.id}`}
                        aria-label={`对设计任务${job.requestId}${decision.label}`}
                        onClick={() => requestReview(job, decision.id)}
                        disabled={!operator || disabled || !note.trim()}
                        key={decision.id}
                      >
                        {decision.label}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : <div className={styles.empty}>{loaded
            ? "读取成功，未找到该设计审核任务，请返回队列重新选择。"
            : "设计审核队列尚未成功读取，不能确认该任务不存在。"}</div>}
        </div>
      </section>

      {pendingConfirmation ? (
          <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="design-review-confirm-title">
          <strong id="design-review-confirm-title">确认设计审核决策</strong>
          <p>操作人“{operator}”将对任务 {pendingConfirmation.jobId} 执行“{designDecisionLabel(pendingConfirmation.decision)}”。批准发送可能创建发送任务，请再次核对身份与说明。</p>
          <p>说明：{note.trim()}</p>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={pendingConfirmation.decision === "reject" ? styles.dangerButton : styles.primaryButton}
              data-action-id="review-design-confirm"
              aria-label="确认设计审核决策"
              onClick={() => void confirmReview()}
              disabled={disabled}
            >
              确认提交
            </button>
            <button
              type="button"
              className={styles.button}
              data-action-id="review-design-cancel"
              aria-label="取消设计审核决策"
              onClick={() => setPendingConfirmation(null)}
              disabled={disabled}
            >
              取消
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function designDecisionLabel(decision: DesignDecision) {
  return decisions.find((item) => item.id === decision)?.label || decision;
}
