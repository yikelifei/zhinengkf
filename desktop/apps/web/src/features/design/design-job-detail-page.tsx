"use client";

import { CheckCircle2, ClipboardCheck, FileText, Play, RefreshCw, ScanSearch } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { identityExpectation, type IdentityFilters } from "../../lib/api";
import { repairLocalDesignImage, selectDesignImage } from "./api";
import { DesignCommerceJourney } from "./design-commerce-journey";
import { designCommerceState, designIdentityHref, designQuotesHref, designReviewHref } from "./design-commerce-state";
import styles from "./design-pages.module.css";
import { DesignEmpty, DesignNotice, DesignPageHeader, errorText, formatDesignDate } from "./design-ui";
import { designImagePreviewSrc } from "./model";
import { useDesignJobs } from "./use-design-job";

export function DesignJobDetailPage({ jobId, initialIdentityFilters = {} }: { jobId: string; initialIdentityFilters?: IdentityFilters }) {
  const { selected, loading, loaded, error, refresh, replace } = useDesignJobs(jobId, initialIdentityFilters);
  const [repairingImageId, setRepairingImageId] = useState("");
  const [repairNotice, setRepairNotice] = useState<{ tone: "success" | "danger"; message: string } | null>(null);
  const [selectingImageId, setSelectingImageId] = useState("");
  const [selectionNotice, setSelectionNotice] = useState<{ tone: "success" | "warning" | "danger"; message: string; quoteId?: string | null } | null>(null);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = Boolean(expected.expectedWechatAccountId && expected.expectedConversationId && expected.expectedCustomerId);
  const dataFresh = !error;
  const commerceState = selected ? designCommerceState(selected) : null;

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

  async function selectCustomerImage(imageKey: string) {
    if (!selected || !identityReady || selectingImageId) return;
    setSelectingImageId(imageKey);
    setSelectionNotice(null);
    try {
      const result = await selectDesignImage(selected.id, { referencedImageId: imageKey }, expected);
      await refresh();
      if (!result.matched) {
        setSelectionNotice({ tone: "warning", message: result.reason || "没有识别到明确候选图，请进入人工审核确认。" });
      } else if (result.quote?.id) {
        setSelectionNotice({ tone: "success", message: "已标记客户选图并自动生成报价草稿。", quoteId: result.quote.id });
      } else if (result.reviewRequired) {
        setSelectionNotice({ tone: "warning", message: "已标记客户选图；该任务需要人工审核后再进入报价。" });
      } else {
        setSelectionNotice({ tone: "success", message: "已标记客户选中的候选图。" });
      }
    } catch (cause) {
      setSelectionNotice({ tone: "danger", message: errorText(cause, "客户选图标记失败") });
    } finally {
      setSelectingImageId("");
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
      {selectionNotice ? (
        <DesignNotice tone={selectionNotice.tone}>
          {selectionNotice.message}
          {selectionNotice.quoteId ? (
            <> <Link href={selected ? designIdentityHref(`/sales/quotes/${encodeURIComponent(selectionNotice.quoteId)}`, selected) : `/sales/quotes/${encodeURIComponent(selectionNotice.quoteId)}`} data-action-id="design-job-open-selection-quote">打开报价草稿</Link></>
          ) : null}
        </DesignNotice>
      ) : null}
      {loading && !loaded ? <DesignEmpty title="正在读取设计任务" detail={`任务 ${jobId}`} busy /> : selected ? (
        <>
        <DesignCommerceJourney
          active={commerceState?.step || "design"}
          recommendation={commerceState?.recommendation || "先核对设计任务状态。"}
          blockedReason={!identityReady ? "任务缺少企业微信账号、客户或会话身份" : commerceState?.blockedReason}
        />
        <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>{selected.requestId}</h2><p>{selected.customer?.name || "客户未知"} · {formatDesignDate(selected.updatedAt)}</p></div><span className={styles.statusPill}>{commerceState?.statusLabel}</span></div>
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
                const imageActionKey = safeActionId(`${imageKey || "image"}-${index + 1}`);
                const localFileUnavailable = image.localFile && image.localFile.state !== "ready";
                const repairing = repairingImageId === imageKey;
                const selecting = selectingImageId === imageKey;
                return (
                  <figure className={styles.imageTile} key={imageKey || index}>
                    {src && !localFileUnavailable ? <img src={src} alt={`设计候选图 ${index + 1}`} /> : <div className={styles.imageUnavailable}>{image.localFile?.message || "本地预览不可用"}</div>}
                    <figcaption>{image.imageId || image.id || `候选图 ${index + 1}`}</figcaption>
                    {image.selected ? <span className={styles.imageSelectionBadge}>客户已选</span> : null}
                    <button
                      className={`${styles.imageRepairButton} ${styles.imageSelectButton}`}
                      type="button"
                      data-action-id={`design-image-select-customer-choice-${imageActionKey}`}
                       disabled={!identityReady || !dataFresh || Boolean(selectingImageId) || Boolean(image.selected)}
                      onClick={() => void selectCustomerImage(imageKey)}
                    >
                      <CheckCircle2 size={14} aria-hidden="true" />
                      {selecting ? "标记中" : image.selected ? "已标记客户选中" : "标记客户选中"}
                    </button>
                    {localFileUnavailable ? (
                      <button
                        className={styles.imageRepairButton}
                        type="button"
                        data-action-id={`design-image-repair-local-file-${imageActionKey}`}
                        disabled={!identityReady || !dataFresh || !image.localFile?.canRepair || Boolean(repairingImageId)}
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
            {!dataFresh ? <div className={styles.actionChoice} aria-disabled="true" data-action-id="design-job-next-action-stale"><RefreshCw size={20} aria-hidden="true" /><strong>请先刷新任务</strong><span>任务刷新失败，已暂停提交、审核和报价入口。</span></div> : <>
              {commerceState?.canSubmit ? <Link className={styles.actionChoice} href={designIdentityHref(`/design/jobs/${encodeURIComponent(selected.id)}/submit`, selected)} data-action-id="design-job-open-submit"><Play size={20} aria-hidden="true" /><strong>预检并提交</strong><span>当前是草稿；完成预检和二次确认后才调用设计平台。</span></Link> : null}
              {commerceState?.canPoll ? <Link className={styles.actionChoice} href={designIdentityHref(`/design/jobs/${encodeURIComponent(selected.id)}/status`, selected)} data-action-id="design-job-open-status"><ScanSearch size={20} aria-hidden="true" /><strong>同步远端状态</strong><span>任务正在平台侧处理，只查询这一条任务的真实状态。</span></Link> : null}
              {commerceState?.canReview ? <Link className={styles.actionChoice} href={designReviewHref(selected)} data-action-id="design-job-open-review"><ClipboardCheck size={20} aria-hidden="true" /><strong>进入人工审核</strong><span>核对图稿、风险和客户身份，再决定改图、通过或发送。</span></Link> : null}
              {commerceState?.canQuote && !commerceState.quoteAlreadyCreated ? <Link className={styles.actionChoice} href={designIdentityHref(`/design/jobs/${encodeURIComponent(selected.id)}/quote`, selected)} data-action-id="design-job-open-quote"><FileText size={20} aria-hidden="true" /><strong>生成报价草稿</strong><span>图稿已通过且客户选图明确，可以创建销售报价。</span></Link> : null}
              {commerceState?.quoteAlreadyCreated ? <Link className={styles.actionChoice} href={designQuotesHref(selected)} data-action-id="design-job-open-created-quote"><FileText size={20} aria-hidden="true" /><strong>打开客户报价</strong><span>报价已经创建，继续核对发送、付款和订单状态。</span></Link> : null}
            </>}
          </div>
          <Link className={styles.backLink} href={designIdentityHref("/design/jobs", selected)} data-action-id="design-job-back-list">返回当前客户任务</Link>
        </article>
        </>
      ) : loaded ? <DesignEmpty title="没有找到设计任务" detail="读取成功；请返回任务列表重新选择。" /> : <DesignEmpty title="设计任务状态未确认" detail="任务详情尚未成功读取，不能据此认定任务不存在。" />}
    </section>
  );
}

function safeActionId(value: string) {
  return String(value || "image").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "image";
}
