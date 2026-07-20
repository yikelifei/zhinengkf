"use client";

import Link from "next/link";
import { useState } from "react";
import type { IdentityFilters, TrainingSampleQualityApiFilter } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { formatTrainingScore, sampleBlocked, sampleNeedsReview } from "./training-review-model";
import { useTrainingSamples } from "./use-training-samples";

export function TrainingReviewQueuePage({ identityFilters }: { identityFilters?: IdentityFilters }) {
  const [quality, setQuality] = useState<TrainingSampleQualityApiFilter>("all");
  const { samples, loaded, busy, error, refresh } = useTrainingSamples(identityFilters, quality);

  return (
    <section className={styles.page} aria-labelledby="training-review-queue-title" aria-busy={busy}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <h1 id="training-review-queue-title">样本复核队列</h1>
          <p className={styles.description}>队列只负责筛选和定位样本；判断与写入在单条详情或批量复核页面完成。</p>
        </div>
        <div className={styles.buttonRow}>
          <Link className={styles.button} href="/training/review/batch">批量复核</Link>
          <button type="button" className={styles.button} data-action-id="training-review-queue-refresh" onClick={() => void refresh()} disabled={busy}>刷新队列</button>
        </div>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}

      <label className={styles.field}>
        <span>质量筛选</span>
        <select className={styles.select} value={quality} onChange={(event) => setQuality(event.target.value as TrainingSampleQualityApiFilter)}>
          <option value="all">全部质量</option><option value="safe">安全</option><option value="review">待复核</option><option value="risk">风险</option><option value="blocked">已阻断</option><option value="needs_attention">需要注意</option><option value="scene_uncertain">场景不确定</option>
        </select>
      </label>

      {samples.length ? (
        <div className={styles.recordList} aria-label="训练样本队列">
          {samples.map((sample) => {
            const blocked = sampleBlocked(sample);
            const needsReview = sampleNeedsReview(sample);
            return (
              <Link className={`${styles.record} ${styles.recordLink}`} href={`/training/review/${encodeURIComponent(sample.id)}`} key={sample.id}>
                <div className={styles.recordHeader}>
                  <div><h2>{sample.scene || "未识别场景"}</h2><p>{sample.customerText || "客户问题为空"}</p></div>
                  <span className={`${styles.badge} ${blocked ? styles.toneError : needsReview ? styles.toneWarning : styles.toneOk}`}>{blocked ? "已阻断" : needsReview ? "需复核" : "质量安全"}</span>
                </div>
                <div className={styles.recordMeta}><span>评分 {formatTrainingScore(sample.score)}</span><span>{sample.agentKey}</span><span>{sample.quality?.label || "质量未知"}</span></div>
                <strong className={styles.openLabel}>打开单条复核</strong>
              </Link>
            );
          })}
        </div>
      ) : <div className={styles.empty}>{loaded
        ? "读取成功，当前筛选没有训练样本。"
        : "训练样本队列尚未成功读取，当前状态未确认。"}</div>}
    </section>
  );
}
