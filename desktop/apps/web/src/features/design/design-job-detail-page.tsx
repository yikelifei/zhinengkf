"use client";

import { Play, RefreshCw, ScanSearch } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { identityExpectation } from "../../lib/api";
import { repairLocalDesignImage } from "./api";
import styles from "./design-pages.module.css";
import { DesignEmpty, DesignNotice, DesignPageHeader, errorText, formatDesignDate } from "./design-ui";
import { designImagePreviewSrc } from "./model";
import { useDesignJobs } from "./use-design-job";

export function DesignJobDetailPage({ jobId }: { jobId: string }) {
  const { selected, loading, loaded, error, refresh, replace } = useDesignJobs(jobId);
  const [repairingImageId, setRepairingImageId] = useState("");
  const [repairNotice, setRepairNotice] = useState<{ tone: "success" | "danger"; message: string } | null>(null);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = Boolean(expected.expectedWechatAccountId && expected.expectedConversationId && expected.expectedCustomerId);

  async function repairImage(imageKey: string) {
    if (!selected || !identityReady || repairingImageId) return;
    setRepairingImageId(imageKey);
    setRepairNotice(null);
    try {
      const result = await repairLocalDesignImage(selected.id, imageKey, expected);
      replace(result.job);
      setRepairNotice({
        tone: "success",
        message: result.repaired ? "历史图片已重新下载到当前存储目录。" : "图片本地文件当前可用，无需修复。",
      });
    } catch (cause) {
      setRepairNotice({ tone: "danger", message: errorText(cause, "历史图片恢复失败") });
    } finally {
      setRepairingImageId("");
    }
  }

  return (
    <section className={styles.page} aria-label="设计任务详情">
      <DesignPageHeader
        eyebrow="设计平台 · 任务详情"
        title="核对设计任务"
        detail="本页只读展示任务、预算和候选图，不提交任务也不触发远端轮询。"
        actions={<button type="button" data-action-id="design-job-detail-refresh" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新详情</button>}
      />
      {error ? <DesignNotice tone="danger">{error}</DesignNotice> : null}
      {repairNotice ? <DesignNotice tone={repairNotice.tone}>{repairNotice.message}</DesignNotice> : null}
      {loading ? <DesignEmpty title="正在读取设计任务" detail={`任务 ${jobId}`} busy /> : selected ? (
        <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>{selected.requestId}</h2><p>{selected.customer?.name || "客户未知"} · {formatDesignDate(selected.updatedAt)}</p></div><span className={styles.statusPill}>{selected.status}</span></div>
          {!identityReady ? <DesignNotice tone="danger">任务缺少账号、会话或客户身份，操作页会保持禁用。</DesignNotice> : null}
          <dl className={styles.factGrid}>
            <div><dt>场景</dt><dd>{selected.scene || "未填写"}</dd></div>
            <div><dt>输出数量</dt><dd>{selected.outputCount}</dd></div>
            <div><dt>总预算</dt><dd>{selected.budget.totalAmount ?? "—"}</dd></div>
            <div><dt>候选图片</dt><dd>{selected.images?.length || 0}</dd></div>
          </dl>
          {selected.images?.length ? (
            <div className={styles.imageGallery} aria-label="设计候选图">
              {selected.images.map((image, index) => {
                const src = designImagePreviewSrc(selected, image);
                const imageKey = image.id || image.imageId;
                const localFileUnavailable = image.localFile && image.localFile.state !== "ready";
                const repairing = repairingImageId === imageKey;
                return (
                  <figure className={styles.imageTile} key={imageKey || index}>
                    {src && !localFileUnavailable ? <img src={src} alt={`设计候选图 ${index + 1}`} /> : <div className={styles.imageUnavailable}>{image.localFile?.message || "本地预览不可用"}</div>}
                    <figcaption>{image.imageId || image.id || `候选图 ${index + 1}`}</figcaption>
                    {localFileUnavailable ? (
                      <button
                        className={styles.imageRepairButton}
                        type="button"
                        data-action-id="design-image-repair-local-file"
                        disabled={!identityReady || !image.localFile?.canRepair || Boolean(repairingImageId)}
                        onClick={() => void repairImage(imageKey)}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                        {repairing ? "正在恢复" : "恢复本地预览"}
                      </button>
                    ) : null}
                  </figure>
                );
              })}
            </div>
          ) : <p className={styles.muted}>当前任务尚无候选图。</p>}
          <div className={styles.actionChoiceGrid} aria-label="设计任务后续操作">
            <Link className={styles.actionChoice} href={`/design/jobs/${encodeURIComponent(selected.id)}/submit`} data-action-id="design-job-open-submit"><Play size={20} aria-hidden="true" /><strong>预检并提交</strong><span>完成预检后再正式提交这一条任务。</span></Link>
            <Link className={styles.actionChoice} href={`/design/jobs/${encodeURIComponent(selected.id)}/status`} data-action-id="design-job-open-status"><ScanSearch size={20} aria-hidden="true" /><strong>同步远端状态</strong><span>只查询并更新这一条任务的远端状态。</span></Link>
          </div>
          <Link className={styles.backLink} href="/design/jobs" data-action-id="design-job-back-list">返回任务列表</Link>
        </article>
      ) : loaded ? <DesignEmpty title="没有找到设计任务" detail="读取成功；请返回任务列表重新选择。" /> : <DesignEmpty title="设计任务状态未确认" detail="任务详情尚未成功读取，不能据此认定任务不存在。" />}
    </section>
  );
}
