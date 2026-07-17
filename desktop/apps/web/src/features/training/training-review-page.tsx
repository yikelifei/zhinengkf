"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  batchReviewTrainingSamples,
  getTrainingSamples,
  identityExpectation,
  reviewTrainingSample,
  type IdentityFilters,
  type TrainingSample,
  type TrainingSampleQualityApiFilter,
} from "../../lib/api";
import styles from "../governance-pages.module.css";

type SampleReviewStatus = "ready" | "review" | "rejected";

type PendingSampleReview = {
  mode: "single" | "batch";
  ids: string[];
  status: SampleReviewStatus;
};

export type TrainingReviewPageProps = {
  identityFilters?: IdentityFilters;
  reviewer?: string;
};

export function TrainingReviewPage({ identityFilters, reviewer }: TrainingReviewPageProps) {
  const [samples, setSamples] = useState<TrainingSample[]>([]);
  const [qualityFilter, setQualityFilter] = useState<TrainingSampleQualityApiFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingSampleReview | null>(null);
  const refreshSequence = useRef(0);
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);
  const operator = reviewer?.trim() || "";

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    try {
      const nextSamples = await getTrainingSamples({ ...stableIdentityFilters, quality: qualityFilter, limit: 200 });
      if (sequence !== refreshSequence.current) return;
      setSamples(nextSamples);
      setSelectedIds(new Set());
      setPendingConfirmation(null);
      if (!nextSamples.length) {
        setError("训练样本接口返回空结果；当前客户端无法区分真实空列表与读取失败，未将其视为无需复核。");
      }
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      setError(caught instanceof Error ? caught.message : "训练样本读取失败。");
    } finally {
      if (sequence === refreshSequence.current) setBusy(false);
    }
  }, [qualityFilter, stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  const selectedSamples = useMemo(
    () => samples.filter((sample) => selectedIds.has(sample.id)),
    [samples, selectedIds],
  );

  const toggleSelection = (sampleId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(sampleId);
      else next.delete(sampleId);
      return next;
    });
  };

  const requestReview = (targets: TrainingSample[], status: SampleReviewStatus, mode: PendingSampleReview["mode"]) => {
    setError("");
    setNotice("");
    if (!targets.length) {
      setError("请先选择需要复核的样本。");
      return;
    }
    if (!operator || !note.trim()) {
      setError("可信复核人未绑定或复核说明为空，操作未进入确认步骤。");
      return;
    }
    if (status === "ready" && targets.some((sample) => !isReadyEligible(sample))) {
      setError("所选样本包含 needsReview、blocked 或其他未明确安全的数据，不能标记为可用。");
      return;
    }
    setPendingConfirmation({ mode, ids: targets.map((sample) => sample.id), status });
  };

  const confirmReview = useCallback(async () => {
    if (!pendingConfirmation) return;
    const targets = samples.filter((sample) => pendingConfirmation.ids.includes(sample.id));
    if (targets.length !== pendingConfirmation.ids.length) {
      setError("样本列表已经变化，请刷新后重新选择。");
      setPendingConfirmation(null);
      return;
    }
    if (pendingConfirmation.status === "ready" && targets.some((sample) => !isReadyEligible(sample))) {
      setError("确认前安全条件发生变化，已阻止标记为可用。");
      setPendingConfirmation(null);
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (pendingConfirmation.mode === "single") {
        const sample = targets[0];
        await reviewTrainingSample(sample.id, {
          status: pendingConfirmation.status,
          reviewer: operator,
          note: note.trim(),
          ...identityExpectation(sample),
        });
      } else {
        const expectedBySampleId = Object.fromEntries(
          targets.map((sample) => [sample.id, identityExpectation(sample)]),
        );
        await batchReviewTrainingSamples({
          sampleIds: targets.map((sample) => sample.id),
          status: pendingConfirmation.status,
          reviewer: operator,
          note: note.trim(),
          expectedBySampleId,
        });
      }
      setNotice(`已提交 ${targets.length} 条样本的“${statusLabel(pendingConfirmation.status)}”复核结果。`);
      setPendingConfirmation(null);
      setNote("");
      setSelectedIds(new Set());
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "样本复核失败，服务端未确认结果。");
    } finally {
      setBusy(false);
    }
  }, [note, operator, pendingConfirmation, refresh, samples]);

  return (
    <section className={styles.page} aria-labelledby="training-review-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Training</span>
          <h1 id="training-review-title">训练样本复核</h1>
          <p className={styles.description}>逐条核对客户问题、理想回复、场景与质量风险，再通过显式确认写入复核结果。</p>
        </div>
        <button
          type="button"
          className={styles.button}
          data-action-id="training-review-refresh"
          aria-label="刷新训练样本"
          onClick={() => void refresh()}
          disabled={busy}
        >
          刷新样本
        </button>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}
      {!operator ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">未连接可信复核人，本页保持只读。复核人必须由宿主身份系统传入。</div> : null}

      <section className={styles.panel} aria-labelledby="training-review-controls-title">
        <header className={styles.panelHeader}><div><h2 id="training-review-controls-title">复核信息</h2><p>批量操作仅作用于人工勾选的记录。</p></div></header>
        <div className={styles.panelBody}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>质量筛选</span>
              <select className={styles.select} value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value as TrainingSampleQualityApiFilter)}>
                <option value="all">全部质量</option>
                <option value="safe">安全</option>
                <option value="review">待复核</option>
                <option value="risk">风险</option>
                <option value="blocked">已阻断</option>
                <option value="needs_attention">需要注意</option>
                <option value="scene_uncertain">场景不确定</option>
              </select>
            </label>
            <div className={styles.field}><span>复核人</span><div className={styles.input}>{operator || "未绑定可信身份"}</div></div>
            <label className={`${styles.field} ${styles.wideField}`}>
              <span>复核说明</span>
              <textarea className={styles.textarea} value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明判断依据与后续处理" />
            </label>
          </div>
          <div className={styles.actionBar}>
            <p className={styles.helpText}>已选择 {selectedSamples.length} 条；只有明确安全且可训练的样本可批量标记为可用。</p>
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.primaryButton}
                data-action-id="training-review-batch-ready-request"
                aria-label="请求将所选样本标记为可用"
                onClick={() => requestReview(selectedSamples, "ready", "batch")}
                disabled={busy || !operator || !note.trim() || !selectedSamples.length || selectedSamples.some((sample) => !isReadyEligible(sample))}
              >
                所选标记可用
              </button>
              <button
                type="button"
                className={styles.button}
                data-action-id="training-review-batch-review-request"
                aria-label="请求将所选样本保持待复核"
                onClick={() => requestReview(selectedSamples, "review", "batch")}
                disabled={busy || !operator || !note.trim() || !selectedSamples.length}
              >
                所选保持复核
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                data-action-id="training-review-batch-reject-request"
                aria-label="请求驳回所选训练样本"
                onClick={() => requestReview(selectedSamples, "rejected", "batch")}
                disabled={busy || !operator || !note.trim() || !selectedSamples.length}
              >
                驳回所选
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="training-sample-list-title">
        <header className={styles.panelHeader}><div><h2 id="training-sample-list-title">样本列表</h2><p>当前筛选返回 {samples.length} 条。</p></div></header>
        <div className={styles.panelBody}>
          {samples.length ? (
            <div className={styles.recordList}>
              {samples.map((sample) => {
                const needsReview = sampleNeedsReview(sample);
                const blocked = sampleBlocked(sample);
                return (
                  <article className={styles.record} key={sample.id}>
                    <div className={styles.recordHeader}>
                      <label className={styles.checkLabel}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(sample.id)}
                          onChange={(event) => toggleSelection(sample.id, event.target.checked)}
                          aria-label={`选择训练样本${sample.id}`}
                        />
                        <span><strong>{sample.scene || "未识别场景"}</strong><small> · {sample.agentKey}</small></span>
                      </label>
                      <span className={`${styles.badge} ${blocked ? styles.toneError : needsReview ? styles.toneWarning : styles.toneOk}`}>
                        {blocked ? "已阻断" : needsReview ? "需复核" : "质量安全"}
                      </span>
                    </div>
                    <div className={styles.grid}>
                      <div><strong>客户问题</strong><p>{sample.customerText || "内容为空"}</p></div>
                      <div><strong>理想回复</strong><p>{sample.idealReply || "内容为空"}</p></div>
                    </div>
                    <div className={styles.recordMeta}>
                      <span>评分 {formatScore(sample.score)}</span>
                      <span>状态 {sample.status}</span>
                      <span>{sample.quality?.label || "质量未知"}</span>
                      <span>{sample.sceneCheck?.status || "场景检查未知"}</span>
                    </div>
                    <p className={styles.helpText}>{sample.quality?.reason || sample.sceneCheck?.reason || "服务端未提供质量判断依据。"}</p>
                    <div className={styles.buttonRow}>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        data-action-id={`training-sample-ready-${sample.id}`}
                        aria-label={`请求将训练样本${sample.id}标记为可用`}
                        onClick={() => requestReview([sample], "ready", "single")}
                        disabled={busy || !operator || !note.trim() || !isReadyEligible(sample)}
                      >
                        标记可用
                      </button>
                      <button
                        type="button"
                        className={styles.button}
                        data-action-id={`training-sample-review-${sample.id}`}
                        aria-label={`请求将训练样本${sample.id}保持待复核`}
                        onClick={() => requestReview([sample], "review", "single")}
                        disabled={busy || !operator || !note.trim()}
                      >
                        保持复核
                      </button>
                      <button
                        type="button"
                        className={styles.dangerButton}
                        data-action-id={`training-sample-reject-${sample.id}`}
                        aria-label={`请求驳回训练样本${sample.id}`}
                        onClick={() => requestReview([sample], "rejected", "single")}
                        disabled={busy || !operator || !note.trim()}
                      >
                        驳回
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <div className={styles.empty}>当前筛选没有返回训练样本。</div>}
        </div>
      </section>

      {pendingConfirmation ? (
        <section className={styles.confirmation} role="alertdialog" aria-modal="true" aria-labelledby="training-review-confirm-title">
          <strong id="training-review-confirm-title">确认提交样本复核</strong>
          <p>将由“{operator}”把 {pendingConfirmation.ids.length} 条样本标记为“{statusLabel(pendingConfirmation.status)}”。服务端会按每条样本身份期望进行校验。</p>
          <p>说明：{note.trim()}</p>
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={pendingConfirmation.status === "rejected" ? styles.dangerButton : styles.primaryButton}
              data-action-id="training-review-confirm"
              aria-label="确认提交训练样本复核"
              onClick={() => void confirmReview()}
              disabled={busy}
            >
              确认提交
            </button>
            <button
              type="button"
              className={styles.button}
              data-action-id="training-review-cancel"
              aria-label="取消训练样本复核"
              onClick={() => setPendingConfirmation(null)}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function sampleNeedsReview(sample: TrainingSample) {
  const needsReview = sample.sceneCheck?.needsReview === true || sample.quality?.attention?.needsAttention === true;
  return needsReview || sample.quality?.level === "review" || sample.quality?.level === "risk" || !sample.quality;
}

function sampleBlocked(sample: TrainingSample) {
  return sample.quality?.level === "blocked" || sample.quality?.trainable === false;
}

function isReadyEligible(sample: TrainingSample) {
  return sample.quality?.level === "safe" && sample.quality.trainable === true && !sampleNeedsReview(sample) && !sampleBlocked(sample);
}

function statusLabel(status: SampleReviewStatus) {
  if (status === "ready") return "可用";
  if (status === "review") return "待复核";
  return "已驳回";
}

function formatScore(value: number) {
  if (!Number.isFinite(value)) return "未知";
  return value <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(1);
}
