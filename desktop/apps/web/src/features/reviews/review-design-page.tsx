"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { getReviewDesignJob, identityExpectation, isTrustedDesktopSessionError, reviewDesignJob, type DesignJob } from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import { DesignCommerceJourney } from "../design/design-commerce-journey";
import { designJobStatusLabel } from "../design/design-commerce-state";
import styles from "../governance-pages.module.css";
import {
  formatReviewDate,
  trustedReviewer,
  useReviewRecord,
  useTrustedOperator,
  type ReviewMutationPageProps,
} from "./review-page-shared";
import { ReviewHandoffPanel, reviewDesignHandoff, reviewIdentityHref, type ReviewHandoff } from "./review-handoff";
import { ReviewDesignGallery } from "./review-design-gallery";

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
  const { record: activeJob, loaded, busy, error, sessionBlocked, setError, refresh } = useReviewRecord(getReviewDesignJob, reviewId, identityFilters);
  const [actionBusy, setActionBusy] = useState(false);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [actionSessionBlocked, setActionSessionBlocked] = useState(false);
  const [handoff, setHandoff] = useState<ReviewHandoff | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingDesignReview | null>(null);
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);
  const trustedOperator = useTrustedOperator(reviewer);
  const operator = trustedReviewer(reviewer, trustedOperator.status);
  const reviewSessionBlocked = sessionBlocked || trustedOperator.sessionBlocked || actionSessionBlocked;

  const requestReview = (job: DesignJob, decision: DesignDecision) => {
    setError("");
    setActionSessionBlocked(false);
    setNotice("");
    setHandoff(null);
    if (!operator) {
      setError("当前页面未绑定可信操作人，设计审核写操作已禁用。");
      return;
    }
    if (!note.trim()) {
      setError("请填写审核说明后再进入确认步骤。");
      return;
    }
    const blockedReason = designReviewDecisionBlockedReason(job, decision);
    if (blockedReason) {
      setError(blockedReason);
      return;
    }
    setPendingConfirmation({ jobId: job.id, decision });
  };

  const confirmReview = useCallback(async () => {
    if (!pendingConfirmation || !activeJob || !operator) return;
    if (activeJob.id !== pendingConfirmation.jobId) {
      setError("地址中的设计任务已变化，请刷新后重新确认。");
      setPendingConfirmation(null);
      return;
    }
    setActionBusy(true);
    setError("");
    setActionSessionBlocked(false);
    setNotice("");
    setHandoff(null);
    const operationPayload = {
      id: activeJob.id,
      decision: pendingConfirmation.decision,
      reviewer: operator,
      note: note.trim(),
      identity: identityExpectation(activeJob),
    };
    const operation = reserveClientOperation("review-action", operationPayload, pendingOperationRef.current);
    pendingOperationRef.current = operation;
    try {
      const response = await reviewDesignJob(activeJob.id, {
        operationKey: operation.key,
        decision: pendingConfirmation.decision,
        reviewer: operator,
        note: note.trim(),
        ...identityExpectation(activeJob),
      });
      pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
      setHandoff(reviewDesignHandoff(response, activeJob));
      setNotice(`设计任务 ${activeJob.requestId || activeJob.id} 已提交“${designDecisionLabel(pendingConfirmation.decision)}”审核。`);
      setPendingConfirmation(null);
      setNote("");
      await refresh();
    } catch (caught) {
      setActionSessionBlocked(isTrustedDesktopSessionError(caught));
      setError(caught instanceof Error ? caught.message : "设计审核失败，服务端未确认结果。");
    } finally {
      setActionBusy(false);
    }
  }, [activeJob, note, operator, pendingConfirmation, refresh, setError]);

  const disabled = busy || actionBusy || trustedOperator.busy;

  return (
    <section className={styles.page} aria-labelledby="review-design-title" aria-busy={disabled}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Reviews</span>
          <h1 id="review-design-title">设计审核</h1>
          <p className={styles.description}>本页按地址中的任务 ID 读取单条设计审核对象，不依赖审核队列截断列表。</p>
        </div>
        <Link className={styles.button} href={reviewIdentityHref("/reviews/design", identityFilters)}>返回设计队列</Link>
      </header>

      {reviewSessionBlocked ? (
        <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
          <strong>需要可信桌面会话</strong>
          <p>请从臻希智能客服桌面端窗口打开本页；如果已经在桌面端，请刷新页面或重启客服启动器。</p>
        </div>
      ) : null}
      {!operator && !reviewSessionBlocked ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">未连接可信操作人，本页保持只读。审核人必须由宿主身份系统传入。</div> : null}
      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}
      <ReviewHandoffPanel handoff={handoff} actionIdPrefix="review-design-handoff" />
      {activeJob ? (
        <DesignCommerceJourney
          active="review"
          title="图稿人工审核"
          recommendation="先核对候选图和客户身份；通过图稿不等于已经发送或已生成报价。"
          blockedReason={!operator ? "尚未绑定可信操作人" : designReviewDecisionBlockedReason(activeJob, "approve_images") || undefined}
        />
      ) : null}

      <section className={styles.panel} aria-labelledby="design-review-note-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="design-review-note-title">本次审核说明</h2>
            <p>当前操作人：{operator || "未绑定"}</p>
          </div>
        </header>
        <div className={styles.panelBody}>
          <label className={styles.field}>
            <span>审核说明</span>
            <textarea className={styles.textarea} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录通过、修改或驳回依据" disabled={!operator || disabled} />
          </label>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="design-review-record-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="design-review-record-title">当前设计任务</h2>
            <p>任务 ID：{reviewId}</p>
          </div>
        </header>
        <div className={styles.panelBody}>
          {activeJob ? (
            <article className={styles.record}>
              <div className={styles.recordHeader}>
                <div>
                  <h3>{activeJob.customer?.name || activeJob.requestId || activeJob.id}</h3>
                  <p>{activeJob.scene || "未标注场景"} · {activeJob.conversation?.title || "未标注会话"}</p>
                </div>
                <span className={`${styles.badge} ${activeJob.errorMessage ? styles.toneError : activeJob.readiness?.ok === false ? styles.toneWarning : styles.toneMuted}`}>{designJobStatusLabel(activeJob.status)}</span>
              </div>
              <dl className={styles.definitionList}>
                <div><dt>结果图</dt><dd>{activeJob.outputCount}</dd></div>
                <div><dt>修改次数</dt><dd>{activeJob.revisionCount ?? 0}</dd></div>
                <div><dt>更新时间</dt><dd>{formatReviewDate(activeJob.updatedAt)}</dd></div>
              </dl>
                {activeJob.errorMessage ? <div className={`${styles.notice} ${styles.noticeError}`}>{activeJob.errorMessage}</div> : null}
                {activeJob.readiness?.missing?.length ? <p className={styles.helpText}>缺少：{activeJob.readiness.missing.join("、")}</p> : null}
                <ReviewDesignGallery job={activeJob} />
                <p className={styles.helpText}>候选图：{activeJob.images?.length || 0} 张；可本地发送：{activeJob.images?.filter((image) => Boolean(image.localPath)).length || 0} 张。</p>
                <div className={styles.buttonRow}>
                  {decisions.map((decision) => {
                    const decisionBlocked = designReviewDecisionBlockedReason(activeJob, decision.id);
                    return <button
                      type="button"
                    className={decision.danger ? styles.dangerButton : decision.id.startsWith("approve") ? styles.primaryButton : styles.button}
                    data-action-id={`review-design-${decision.id}-${activeJob.id}`}
                    aria-label={`对设计任务 ${activeJob.requestId || activeJob.id} ${decision.label}`}
                    onClick={() => requestReview(activeJob, decision.id)}
                      disabled={!operator || disabled || !note.trim() || Boolean(decisionBlocked)}
                      title={decisionBlocked || undefined}
                      key={decision.id}
                    >
                      {decision.label}
                    </button>;
                  })}
              </div>
            </article>
          ) : <div className={styles.empty}>{loaded ? "读取成功，未找到该设计审核任务，请返回队列重新选择。" : busy ? "正在读取设计审核任务。" : "设计审核任务尚未成功读取，已阻止审核操作。"}</div>}
        </div>
      </section>

      {pendingConfirmation ? (
        <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="design-review-confirm-title">
          <strong id="design-review-confirm-title">确认设计审核决策</strong>
          <p>操作人“{operator}”将对任务 {pendingConfirmation.jobId} 执行“{designDecisionLabel(pendingConfirmation.decision)}”。批准发送可能创建发送任务，请再次核对身份与说明。</p>
          <p>说明：{note.trim()}</p>
          <div className={styles.buttonRow}>
            <button type="button" className={pendingConfirmation.decision === "reject" ? styles.dangerButton : styles.primaryButton} data-action-id="review-design-confirm" aria-label="确认设计审核决策" onClick={() => void confirmReview()} disabled={disabled}>确认提交</button>
            <button type="button" className={styles.button} data-action-id="review-design-cancel" aria-label="取消设计审核决策" onClick={() => setPendingConfirmation(null)} disabled={disabled}>取消</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function designDecisionLabel(decision: DesignDecision) {
  return decisions.find((item) => item.id === decision)?.label || decision;
}

export function designReviewDecisionBlockedReason(job: DesignJob, decision: DesignDecision) {
  const status = String(job.status || "").toLowerCase();
  if (!["completed", "manual_review", "failed", "timeout", "outcome_unknown", "customer_selected"].includes(status)) {
    return `当前任务状态“${designJobStatusLabel(job.status)}”不在人工审核阶段。`;
  }
  const identity = identityExpectation(job);
  if (!identity.expectedWechatAccountId || !identity.expectedConversationId || !identity.expectedCustomerId) {
    return "任务缺少企业微信账号、会话或客户身份，不能提交审核决策。";
  }
  if (decision === "approve_images" && !job.images?.length) return "当前没有候选图，不能通过图稿。";
  if (decision === "approve_send") {
    if ((job.images?.length || 0) < 4) return "候选图不足 4 张，不能批准发送。";
    if (job.images?.some((image) => !image.localPath)) return "候选图尚未全部保存到本地，不能批准发送。";
  }
  return "";
}
