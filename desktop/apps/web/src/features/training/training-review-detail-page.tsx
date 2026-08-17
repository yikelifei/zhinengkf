"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTrainingSample, identityExpectation, reviewTrainingSample, type IdentityFilters, type TrainingSample } from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import styles from "../governance-pages.module.css";
import { useTrustedOperator } from "../governance/trusted-operator";
import { TrainingIdentityScopeNotice, trainingHref } from "./training-identity-navigation";
import { formatTrainingScore, isReadyEligible, sampleBlocked, sampleNeedsReview, sampleStatusLabel, type SampleReviewStatus } from "./training-review-model";

export function TrainingReviewDetailPage({ sampleId, identityFilters, reviewer }: { sampleId: string; identityFilters?: IdentityFilters; reviewer?: string }) {
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    agentId: identityFilters?.agentId,
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.agentId, identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);
  const [sample, setSample] = useState<TrainingSample | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<SampleReviewStatus | null>(null);
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);
  const refreshSequence = useRef(0);
  const trustedOperator = useTrustedOperator(reviewer);
  const operator = trustedOperator.reviewer;

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoading(true);
    setLoaded(false);
    setLoadError("");
    try {
      const record = await getTrainingSample(sampleId, stableIdentityFilters);
      if (sequence !== refreshSequence.current) return;
      setSample(record);
      setLoaded(true);
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setSample(null);
      setLoadError(caught instanceof Error ? caught.message : "样本读取失败。");
      setLoaded(true);
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [sampleId, stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  const missing = loaded && !loading && !loadError && !sample;
  const blocked = sample ? sampleBlocked(sample) : false;
  const needsReview = sample ? sampleNeedsReview(sample) : false;

  const requestReview = (status: SampleReviewStatus) => {
    setError("");
    setNotice("");
    if (!sample) return setError("样本不存在，操作已阻止。");
    if (!operator || !note.trim()) return setError("可信复核人未绑定或复核说明为空，操作未进入确认步骤。");
    if (status === "ready" && !isReadyEligible(sample)) return setError("该样本未满足安全条件，不能标记为可用。");
    setPending(status);
  };

  const confirmReview = useCallback(async () => {
    if (!pending || !sample) return;
    if (pending === "ready" && !isReadyEligible(sample)) {
      setError("确认前安全条件不满足，已阻止标记为可用。");
      setPending(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const requestPayload = { status: pending, reviewer: operator, note: note.trim(), ...identityExpectation(sample) };
      const operation = reserveClientOperation("review-action", { id: sample.id, ...requestPayload }, pendingOperationRef.current);
      pendingOperationRef.current = operation;
      await reviewTrainingSample(sample.id, { ...requestPayload, operationKey: operation.key });
      pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
      setNotice(`已提交“${sampleStatusLabel(pending)}”复核结果。`);
      setPending(null);
      setNote("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "样本复核失败，服务端未确认结果。");
    } finally {
      setBusy(false);
    }
  }, [note, operator, pending, refresh, sample]);

  return (
    <section className={styles.page} aria-labelledby="training-review-detail-title" aria-busy={loading || busy || trustedOperator.busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <h1 id="training-review-detail-title">单条样本复核</h1>
          <p className={styles.description}>只判断地址指定的一条样本，不会回退展示其他训练记录。</p>
        </div>
        <Link className={styles.button} href={trainingHref("/training/review", stableIdentityFilters)}>返回队列</Link>
      </header>

      {loadError ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{loadError}</div> : null}
      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}
      {!operator ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">未连接可信复核人，本页保持只读。</div> : null}
      {missing ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">地址中的样本不存在，未展示其他样本。</div> : null}
      <TrainingIdentityScopeNotice identityFilters={stableIdentityFilters} />

      {sample ? (
        <>
          <article className={styles.record}>
            <div className={styles.recordHeader}>
              <div>
                <h2>{sample.scene || "未识别场景"}</h2>
                <p>{sample.agentKey || sample.agentId || "未绑定 Agent"}</p>
              </div>
              <span className={`${styles.badge} ${blocked ? styles.toneError : needsReview ? styles.toneWarning : styles.toneOk}`}>
                {blocked ? "已阻断" : needsReview ? "需复核" : "质量安全"}
              </span>
            </div>
            <div className={styles.grid}>
              <div>
                <strong>客户问题</strong>
                <p>{sample.customerText || "内容为空"}</p>
              </div>
              <div>
                <strong>理想回复</strong>
                <p>{sample.idealReply || "内容为空"}</p>
              </div>
            </div>
            <div className={styles.recordMeta}>
              <span>评分 {formatTrainingScore(sample.score)}</span>
              <span>状态 {sampleStatusLabel((sample.status || "review") as SampleReviewStatus)}</span>
              <span>{sample.quality?.label || "质量未知"}</span>
              <span>{sample.sceneCheck?.status || "场景检查未知"}</span>
            </div>
            <p className={styles.helpText}>{sample.quality?.reason || sample.sceneCheck?.reason || "服务端未提供质量判断依据。"}</p>
          </article>

          <label className={styles.field}>
            <span>复核说明</span>
            <textarea
              className={styles.textarea}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="说明判断依据与后续处理"
            />
          </label>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.primaryButton} data-action-id="training.sample.ready.request" onClick={() => requestReview("ready")} disabled={busy || !operator || !note.trim() || !isReadyEligible(sample)}>标记可用</button>
            <button type="button" className={styles.button} data-action-id="training.sample.review.request" onClick={() => requestReview("review")} disabled={busy || !operator || !note.trim()}>保持复核</button>
            <button type="button" className={styles.dangerButton} data-action-id="training.sample.reject.request" onClick={() => requestReview("rejected")} disabled={busy || !operator || !note.trim()}>驳回样本</button>
          </div>
        </>
      ) : null}

      {pending ? (
        <section className={styles.confirmation} role="region" aria-live="polite">
          <strong>确认提交“{sampleStatusLabel(pending)}”</strong>
          <p>复核人：{operator}。说明：{note.trim()}</p>
          <div className={styles.buttonRow}>
            <button type="button" className={pending === "rejected" ? styles.dangerButton : styles.primaryButton} data-action-id="training.sample.review.confirm" onClick={() => void confirmReview()} disabled={busy}>确认提交</button>
            <button type="button" className={styles.button} data-action-id="training.sample.review.cancel" onClick={() => setPending(null)} disabled={busy}>取消</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
