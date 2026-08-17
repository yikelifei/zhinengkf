"use client";

import { Image as ImageIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  identityExpectation,
  localAssetUrl,
  localDesignImageUrl,
  type DesignJob,
  type OrderDraft,
  type QuoteDraft,
} from "../../lib/api";
import { safeRenderableImageSrc } from "../../lib/renderable-image-src";
import styles from "./sales-pages.module.css";

type SalesDesignRecord = QuoteDraft | OrderDraft;
type DesignImage = NonNullable<DesignJob["images"]>[number];

export function SalesDesignVisualSummary({ record }: { record: SalesDesignRecord }) {
  const designJob = salesDesignJob(record);
  const selectedImage = salesSelectedImage(record, designJob);
  const selectedImageUrl = selectedImageSrc(record, designJob, selectedImage);
  const bundleItems = salesBundleItems(record);

  return (
    <section className={styles.visualSummary} aria-label="设计效果与搭配商品">
      <div className={styles.visualSummaryHeader}>
        <div>
          <strong>设计效果与搭配商品</strong>
          <span>{designJob?.requestId || record.designJobId || "未绑定设计任务"}</span>
        </div>
        <span>{bundleItems.length ? `${bundleItems.length} 个搭配商品` : "暂无搭配明细"}</span>
      </div>
      <div className={styles.visualSummaryGrid}>
        <VisualFigure className={styles.selectedDesignImage} src={selectedImageUrl} alt="客户选中的设计效果图" missingLabel="缺少选图">
          <figcaption>{selectedImageLabel(selectedImage, record.selectedImageId)}</figcaption>
        </VisualFigure>
        <div className={styles.bundleImageGrid} aria-label="搭配商品图片">
          {bundleItems.length ? bundleItems.slice(0, 8).map((item, index) => {
            const image = bundleItemImageSrc(item);
            return (
              <VisualFigure className={styles.bundleImageTile} src={image} alt={bundleItemLabel(item)} missingLabel="缺图" key={`${bundleItemLabel(item)}-${index}`}>
                <figcaption>
                  <strong>{bundleItemLabel(item)}</strong>
                  <span>{String(item.skuCode || item.type || "未绑定 SKU")}</span>
                </figcaption>
              </VisualFigure>
            );
          }) : <p className={styles.visualSummaryEmpty}>当前报价/订单没有搭配商品快照。</p>}
        </div>
      </div>
    </section>
  );
}

export function SalesRecordVisualStrip({ record }: { record: SalesDesignRecord }) {
  const designJob = salesDesignJob(record);
  const selectedImage = salesSelectedImage(record, designJob);
  const selectedImageUrl = selectedImageSrc(record, designJob, selectedImage);
  const bundleItems = salesBundleItems(record);
  const visibleItems = bundleItems.slice(0, 3);
  const missingCount = Number(!selectedImageUrl) + visibleItems.filter((item) => !bundleItemImageSrc(item)).length;

  return (
    <span className={styles.recordVisualStrip} aria-label="销售记录图片概览">
      <VisualSpan className={styles.recordDesignThumb} src={selectedImageUrl} alt="选中设计图缩略图" missingLabel="选图" />
      <span className={styles.recordBundleThumbs} aria-label="搭配商品缩略图">
        {visibleItems.length ? visibleItems.map((item, index) => {
          const image = bundleItemImageSrc(item);
          return (
            <VisualSpan className={styles.recordBundleThumb} src={image} alt={bundleItemLabel(item)} missingLabel="商品" key={`${bundleItemLabel(item)}-${index}`} />
          );
        }) : <span className={styles.recordBundleEmpty}>无搭配</span>}
      </span>
      <span className={styles.recordVisualStatus}>{missingCount ? `缺图 ${missingCount}` : "图片齐全"}</span>
    </span>
  );
}

function VisualFigure({
  className,
  src,
  alt,
  missingLabel,
  children,
}: {
  className: string;
  src: string;
  alt: string;
  missingLabel: string;
  children: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const ready = Boolean(src && !failed);
  return (
    <figure className={className} data-image-state={ready ? "ready" : "missing"}>
      {ready ? <img src={src} alt={alt} onError={() => setFailed(true)} /> : <MissingImage label={missingLabel} />}
      {children}
    </figure>
  );
}

function VisualSpan({
  className,
  src,
  alt,
  missingLabel,
}: {
  className: string;
  src: string;
  alt: string;
  missingLabel: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const ready = Boolean(src && !failed);
  return (
    <span className={className} data-image-state={ready ? "ready" : "missing"}>
      {ready ? <img src={src} alt={alt} onError={() => setFailed(true)} /> : <MissingImage label={missingLabel} />}
    </span>
  );
}

function MissingImage({ label }: { label: string }) {
  return (
    <span className={styles.visualMissingImage}>
      <ImageIcon size={18} aria-hidden="true" />
      {label}
    </span>
  );
}

function salesDesignJob(record: SalesDesignRecord): DesignJob | null {
  return record.designJob || orderQuoteDraft(record)?.designJob || null;
}

function salesSelectedImage(record: SalesDesignRecord, designJob: DesignJob | null): DesignImage | null {
  if (isOrderRecord(record) && record.selectedImageSnapshot && typeof record.selectedImageSnapshot === "object") {
    return record.selectedImageSnapshot as DesignImage;
  }
  const direct = record.selectedImage || orderQuoteDraft(record)?.selectedImage || null;
  if (direct) return direct;
  const snapshot = record.selectedImageSnapshot || null;
  if (snapshot && typeof snapshot === "object") return snapshot as DesignImage;
  const selectedImageId = String(record.selectedImageId || orderQuoteDraft(record)?.selectedImageId || "").trim();
  if (!selectedImageId || !designJob?.images?.length) return null;
  return designJob.images.find((image) => image.id === selectedImageId || image.imageId === selectedImageId) || null;
}

function selectedImageSrc(record: SalesDesignRecord, designJob: DesignJob | null, image: DesignImage | null) {
  if (!image) return "";
  if (designImageLocalFileUnavailable(image)) return "";
  const jobId = designJob?.id || record.designJobId || image.designJobId || "";
  if (jobId) {
    const expected = designJob ? identityExpectation(designJob) : identityExpectation(record);
    const local = localDesignImageUrl(jobId, image, expected);
    if (local) return local;
  }
  return safeRenderableImageSrc(image.downloadUrl);
}

function designImageLocalFileUnavailable(image: DesignImage) {
  const localFile = (image as DesignImage & { localFile?: { state?: string } }).localFile;
  return Boolean(localFile && localFile.state !== "ready");
}

function selectedImageLabel(image: DesignImage | null, fallback?: string | null) {
  if (!image) return fallback ? `选图 ${fallback}` : "尚未绑定客户选图";
  if (image.position) return `客户选中第 ${image.position} 张`;
  return image.imageId || image.id || fallback || "客户选图";
}

function salesBundleItems(record: SalesDesignRecord): Array<Record<string, unknown> & { skuCode?: string; type?: string }> {
  const liveBundle = record.designJob?.bundle || orderQuoteDraft(record)?.designJob?.bundle || null;
  const snapshotBundle = record.bundleSnapshot && typeof record.bundleSnapshot === "object" ? record.bundleSnapshot : null;
  const bundle = snapshotBundle || liveBundle;
  const items = Array.isArray(bundle?.items) ? bundle.items as Array<Record<string, unknown> & { skuCode?: string; type?: string }> : [];
  if (items.length) return items;
  return bundle?.giftBox && typeof bundle.giftBox === "object" ? [bundle.giftBox as Record<string, unknown>] : [];
}

function orderQuoteDraft(record: SalesDesignRecord): QuoteDraft | null {
  return "quoteDraft" in record ? record.quoteDraft || null : null;
}

function isOrderRecord(record: SalesDesignRecord): record is OrderDraft {
  return "quoteDraftId" in record;
}

function bundleItemImageSrc(item: Record<string, unknown>) {
  const reference = firstBundleImage(item);
  if (!reference) return "";
  const local = localAssetUrl(reference);
  if (local) return local;
  return safeRenderableImageSrc(reference);
}

function firstBundleImage(item: Record<string, unknown>): string {
  for (const key of ["localPath", "downloadUrl", "url", "publicUrl", "mainImagePath", "mainImageUrl", "imageUrl", "imagePath", "productImage", "skuImage", "skuImageUrl", "primaryImage"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const key of ["imageRefs", "images", "imageUrls", "imagePaths", "angleImages", "multiAngleImages", "gallery"]) {
    const nested = firstImageFromArray(item[key]);
    if (nested) return nested;
  }
  return "";
}

function firstImageFromArray(value: unknown): string {
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object") {
      const nested = firstBundleImage(item as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  return "";
}

function bundleItemLabel(item: Record<string, unknown>) {
  return String(item.name || item.title || item.skuCode || item.type || "商品");
}
