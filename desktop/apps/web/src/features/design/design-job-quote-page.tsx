"use client";

import { FileText, Image as ImageIcon, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { identityExpectation, localAssetUrl, type DesignJob, type IdentityFilters, type QuoteDraft } from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import { safeRenderableImageSrc } from "../../lib/renderable-image-src";
import { createQuote } from "./api";
import { DesignCommerceJourney } from "./design-commerce-journey";
import { designCommerceState, designIdentityHref, designReviewHref } from "./design-commerce-state";
import { firstSkuImage } from "./design-job-create-model";
import styles from "./design-pages.module.css";
import { DesignEmpty, DesignNotice, DesignPageHeader, errorText, formatDesignDate } from "./design-ui";
import { designImagePreviewSrc } from "./model";
import { useDesignJobs } from "./use-design-job";

export function DesignJobQuotePage({ jobId, initialIdentityFilters = {} }: { jobId: string; initialIdentityFilters?: IdentityFilters }) {
  const { selected, loading, loaded, error: loadError, refresh, replace } = useDesignJobs(jobId, initialIdentityFilters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [quote, setQuote] = useState<QuoteDraft | null>(null);
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);

  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = Boolean(expected.expectedWechatAccountId && expected.expectedConversationId && expected.expectedCustomerId);
  const selectedImage = selected?.images?.find((image) => image.selected) || null;
  const imageCount = selected?.images?.length || 0;
  const bundleItems = Array.isArray(selected?.bundle?.items) ? selected.bundle.items : [];
  const bundleItemCount = bundleItems.length;
  const automationReady = selected?.bundle?.automation?.ready !== false;
  const commerceState = selected ? designCommerceState(selected) : null;
  const readyForQuote = Boolean(selected && !loadError && identityReady && selectedImage && bundleItemCount > 0 && commerceState?.canQuote);

  async function createQuoteDraft() {
    if (!selected || !readyForQuote) return;
    setBusy(true);
    setError("");
    setNotice("");
    setQuote(null);
    const operation = reserveClientOperation("quote-create", {
      designJobId: selected.id,
      requestId: selected.requestId,
      selectedImageId: selectedImage?.id || selectedImage?.imageId || null,
      budget: selected.budget,
      bundleItemCount,
      expected,
    }, pendingOperationRef.current);
    pendingOperationRef.current = operation;
    try {
      const nextQuote = await createQuote(selected.id, expected);
      pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
      setQuote(nextQuote);
      replace({ ...selected, status: "quote_created" });
      setNotice(`报价草稿 ${nextQuote.id} 已生成或已存在；本页没有发送客户消息。`);
    } catch (cause) {
      setError(errorText(cause, "报价草稿创建失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page} aria-label="生成报价草稿">
      <DesignPageHeader
        eyebrow="设计平台 · 报价衔接"
        title="生成报价草稿"
        detail="本页只把一条设计任务推进为销售报价草稿，不发送客户消息。"
        actions={<button type="button" data-action-id="design-job-quote-refresh" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新任务</button>}
      />
      {loadError || error ? <DesignNotice tone="danger">{error || loadError}</DesignNotice> : null}
      {notice ? <DesignNotice tone="success">{notice}</DesignNotice> : null}
      {loading && !loaded ? <DesignEmpty title="正在读取设计任务" detail={`任务 ${jobId}`} busy /> : selected ? (
        <>
        <DesignCommerceJourney
          active="quote"
          recommendation={readyForQuote ? "客户选图、商品明细和身份已就绪，可以生成报价草稿。" : "先处理下方阻断项；本页不会用不完整数据尝试生成报价。"}
          blockedReason={loadError ? "任务刷新失败，写操作暂时停用" : !identityReady ? "客户身份不完整" : !selectedImage ? "尚未标记客户选图" : !bundleItemCount ? "缺少商品搭配明细" : !commerceState?.canQuote ? `设计任务仍处于“${commerceState?.statusLabel || selected.status}”` : undefined}
        />
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div><h2>{selected.requestId}</h2><p>{selected.customer?.name || "客户未知"} · {formatDesignDate(selected.updatedAt)}</p></div>
            <span className={styles.statusPill}>{commerceState?.statusLabel}</span>
          </div>
          <dl className={styles.factGrid}>
            <div><dt>客户身份</dt><dd>{identityReady ? "完整" : "缺失"}</dd></div>
            <div><dt>候选图片</dt><dd>{imageCount}</dd></div>
            <div><dt>客户选图</dt><dd>{selectedImage?.imageId || selectedImage?.id || "未标记"}</dd></div>
            <div><dt>商品明细</dt><dd>{bundleItemCount}</dd></div>
            <div><dt>数量</dt><dd>{selected.budget?.quantity ?? "未填写"}</dd></div>
            <div><dt>预算</dt><dd>{selected.budget?.totalAmount ?? selected.budget?.perUnitAmount ?? "未填写"}</dd></div>
          </dl>
          <DesignQuoteImagePreview job={selected} selectedImage={selectedImage} bundleItems={bundleItems} />
          {!identityReady ? <DesignNotice tone="danger">任务缺少企业微信账号、会话或客户身份，已阻止生成报价。</DesignNotice> : null}
          {!imageCount ? <DesignNotice tone="danger">任务尚无候选图，不能生成可交付报价。</DesignNotice> : null}
          {!selectedImage && imageCount ? <DesignNotice tone="danger">尚未标记客户选中的候选图，已阻止生成报价；请返回任务详情标记客户确认的图片。</DesignNotice> : null}
          {!bundleItemCount ? <DesignNotice tone="danger">任务没有商品搭配明细，报价金额无法形成，已阻止生成报价。</DesignNotice> : null}
          {!commerceState?.canQuote ? <DesignNotice tone="warning">当前设计任务还没有通过“图稿确认 → 客户选图”门槛，请先完成人工审核。</DesignNotice> : null}
          {!automationReady ? <DesignNotice tone="warning">商品自动化资格未通过，报价生成后会进入人工复核。</DesignNotice> : null}
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="design-job-create-quote-request"
              disabled={busy || !readyForQuote}
              onClick={() => void createQuoteDraft()}
            >
              <FileText size={16} aria-hidden="true" />
              {busy ? "生成中" : "确认生成报价"}
            </button>
          </div>
          {!readyForQuote ? (
            <div className={styles.formActions}>
              <Link className={styles.backLink} href={designIdentityHref(`/design/jobs/${encodeURIComponent(selected.id)}`, selected)} data-action-id="design-job-quote-back-select-image">返回任务核对选图</Link>
              {commerceState?.canReview ? <Link className={styles.backLink} href={designReviewHref(selected)} data-action-id="design-job-quote-open-review">进入人工审核</Link> : null}
            </div>
          ) : null}
          {quote ? (
            <section className={styles.handoffPanel} aria-label="报价后续动作">
              <div className={styles.cardHeader}>
                <div><h3>报价交接</h3><p>报价 {quote.id}</p></div>
                <span className={styles.statusPill}>{quote.status}</span>
              </div>
              <dl className={styles.factGrid}>
                <div><dt>总价</dt><dd>{quote.totalPrice}</dd></div>
                <div><dt>付款状态</dt><dd>{quote.paymentStatus}</dd></div>
                <div><dt>选图</dt><dd>{quote.selectedImageId || "待复核"}</dd></div>
                <div><dt>发送任务</dt><dd>{quote.sendTaskId || "未入队"}</dd></div>
              </dl>
              <div className={styles.actionChoiceGrid}>
                <Link className={styles.actionChoice} href={designIdentityHref(`/sales/quotes/${encodeURIComponent(quote.id)}`, selected)} data-action-id="design-job-quote-open-created">
                  <FileText size={20} aria-hidden="true" /><strong>下一步：核对报价</strong><span>由报价详情根据审核、发送和客户确认状态给出唯一下一步。</span>
                </Link>
              </div>
            </section>
          ) : null}
          <Link className={styles.backLink} href={designIdentityHref(`/design/jobs/${encodeURIComponent(selected.id)}`, selected)} data-action-id="design-job-quote-back">返回任务详情</Link>
        </article>
        </>
      ) : loaded ? <DesignEmpty title="没有找到设计任务" detail="读取成功；请返回任务列表重新选择。" /> : <DesignEmpty title="设计任务状态未确认" detail="任务尚未成功读取，已阻止生成报价。" />}
    </section>
  );
}

function DesignQuoteImagePreview({
  job,
  selectedImage,
  bundleItems,
}: {
  job: DesignJob;
  selectedImage: NonNullable<DesignJob["images"]>[number] | null;
  bundleItems: Array<Record<string, unknown>>;
}) {
  const previewImage = selectedImage || job.images?.[0] || null;
  const designSrc = previewImage ? designImagePreviewSrc(job, previewImage) : "";
  const [designFailed, setDesignFailed] = useState(false);
  useEffect(() => setDesignFailed(false), [designSrc]);
  const designReady = Boolean(designSrc && !designFailed);
  return (
    <section className={styles.quoteImagePreviewPanel} aria-label="报价图片预览">
      <figure className={styles.quoteSelectedPreview} data-image-state={designReady ? "ready" : "missing"}>
        {designReady ? <img src={designSrc} alt="报价使用的设计效果图" onError={() => setDesignFailed(true)} /> : <QuoteImageMissing label="缺少设计图" />}
        <figcaption>
          <strong>{selectedImage ? "客户选图" : "候选图预览"}</strong>
          <span>{previewImage?.imageId || previewImage?.id || "未绑定图片"}</span>
        </figcaption>
      </figure>
      <div className={styles.quoteBundlePreviewGrid} aria-label="报价搭配商品图片">
        {bundleItems.length ? bundleItems.slice(0, 8).map((item, index) => {
          const src = quoteBundleItemImageSrc(item);
          return (
            <QuoteBundlePreviewTile item={item} src={src} key={`${quoteBundleItemLabel(item)}-${index}`} />
          );
        }) : <p className={styles.quoteBundlePreviewEmpty}>当前任务没有商品搭配图片。</p>}
      </div>
    </section>
  );
}

function QuoteBundlePreviewTile({ item, src }: { item: Record<string, unknown>; src: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const ready = Boolean(src && !failed);
  return (
    <figure className={styles.quoteBundlePreviewTile} data-image-state={ready ? "ready" : "missing"}>
      {ready ? <img src={src} alt={quoteBundleItemLabel(item)} onError={() => setFailed(true)} /> : <QuoteImageMissing label="缺商品图" />}
      <figcaption>
        <strong>{quoteBundleItemLabel(item)}</strong>
        <span>{String(item.skuCode || item.type || "未绑定 SKU")}</span>
      </figcaption>
    </figure>
  );
}

function QuoteImageMissing({ label }: { label: string }) {
  return (
    <span className={styles.quoteImageMissing}>
      <ImageIcon size={18} aria-hidden="true" />
      {label}
    </span>
  );
}

function quoteBundleItemImageSrc(item: Record<string, unknown>) {
  const reference = firstSkuImage(item);
  if (!reference) return "";
  const local = localAssetUrl(reference);
  if (local) return local;
  return safeRenderableImageSrc(reference);
}

function quoteBundleItemLabel(item: Record<string, unknown>) {
  return String(item.name || item.title || item.skuCode || item.type || "商品");
}
