import { AlertTriangle, CheckCircle2, ImageIcon, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { localAssetUrl } from "../../lib/api";
import { safeRenderableImageSrc } from "../../lib/renderable-image-src";
import styles from "./catalog-pages.module.css";

type CatalogImageRecord = Record<string, unknown> & {
  angleImages?: unknown;
  name?: unknown;
  skuCode?: unknown;
};

type CatalogImageCandidate = {
  raw: string;
  src: string;
  status: "ready" | "missing" | "invalid";
  reason: "ready" | "missing" | "unsupported_type" | "unsafe_or_unimported";
};

type CatalogProductImageOptions = {
  thumbnail?: boolean;
  width?: number;
  height?: number;
};

export type CatalogSkuImageSummary = {
  refs: string[];
  renderableRefs: string[];
  readyCount: number;
  invalidCount: number;
  missingCount: number;
  status: "ready" | "missing" | "invalid";
  label: string;
};

export function CatalogHeader({ eyebrow, title, detail, actions }: { eyebrow: string; title: string; detail: string; actions?: ReactNode }) {
  return <header className={styles.pageHeader}><div><span>{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>{actions ? <div className={styles.headerActions}>{actions}</div> : null}</header>;
}

export function CatalogNotice({ tone, children }: { tone: "success" | "warning" | "danger"; children: ReactNode }) {
  return <div className={`${styles.notice} ${styles[`notice-${tone}`]}`} role={tone === "danger" ? "alert" : "status"}>{tone === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}<span>{children}</span></div>;
}

export function CatalogEmpty({ title, detail, busy = false }: { title: string; detail: string; busy?: boolean }) {
  return <div className={styles.empty} role="status" aria-busy={busy || undefined}><RefreshCw size={22} aria-hidden="true" /><strong>{title}</strong><p>{detail}</p></div>;
}

export function CatalogConfirmation({ title, detail, confirmLabel, confirmActionId, cancelActionId, busy = false, onConfirm, onCancel }: { title: string; detail: string; confirmLabel: string; confirmActionId: string; cancelActionId: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <div className={styles.confirmation} role="region" aria-live="polite" aria-labelledby={`${confirmActionId}-title`} aria-describedby={`${confirmActionId}-detail`}><AlertTriangle size={20} aria-hidden="true" /><div><strong id={`${confirmActionId}-title`}>{title}</strong><p id={`${confirmActionId}-detail`}>{detail}</p></div><div className={styles.confirmationActions}><button type="button" data-action-id={cancelActionId} aria-label="取消当前操作" disabled={busy} onClick={onCancel}><X size={15} aria-hidden="true" />取消</button><button type="button" className={styles.primaryButton} data-action-id={confirmActionId} aria-label={confirmLabel} disabled={busy} onClick={onConfirm}>{busy ? "处理中" : confirmLabel}</button></div></div>;
}

export function catalogError(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  return detail ? `${fallback}: ${detail}` : fallback;
}

export function money(value: number) {
  return Number.isFinite(value) ? `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : "-";
}

export function formatSkuDimensions(value?: unknown) {
  if (!value) return "未填写";
  if (typeof value === "string") return value.trim() || "未填写";
  if (typeof value !== "object" || Array.isArray(value)) return "未填写";
  const record = value as Record<string, unknown>;
  const length = dimensionValue(record, ["lengthCm", "length", "l", "长"]);
  const width = dimensionValue(record, ["widthCm", "width", "w", "宽"]);
  const height = dimensionValue(record, ["heightCm", "height", "h", "高"]);
  if (length && width && height) return `${length} x ${width} x ${height} cm`;
  const parts = [
    length ? `长 ${length} cm` : "",
    width ? `宽 ${width} cm` : "",
    height ? `高 ${height} cm` : "",
    dimensionValue(record, ["diameterCm", "diameter", "直径"]) ? `直径 ${dimensionValue(record, ["diameterCm", "diameter", "直径"])} cm` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "未填写";
}

export function formatSkuWeight(value?: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "未填写";
  return `${numeric.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} g`;
}

export type CatalogImportFacts = {
  rawPrice?: string;
  rawNote?: string;
  originalDimensions?: string;
  imageId?: string;
  sourceMedia?: string;
  sourceSheet?: string;
  sourceCell?: string;
  imageStatus?: string;
  supplyStatus?: string;
  priceStatus?: string;
  initialReviewStatus?: string;
  issues?: string[];
};

export function catalogImportFacts(matchingRules?: Record<string, unknown> | null): CatalogImportFacts | null {
  const candidate = matchingRules?.catalogImport;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  const facts: CatalogImportFacts = {
    rawPrice: textValue(record.rawPrice),
    rawNote: textValue(record.rawNote),
    originalDimensions: textValue(record.originalDimensions),
    imageId: textValue(record.imageId),
    sourceMedia: textValue(record.sourceMedia),
    sourceSheet: textValue(record.sourceSheet),
    sourceCell: textValue(record.sourceCell),
    imageStatus: textValue(record.imageStatus),
    supplyStatus: textValue(record.supplyStatus),
    priceStatus: textValue(record.priceStatus),
    initialReviewStatus: textValue(record.initialReviewStatus),
    issues: Array.isArray(record.issues)
      ? record.issues.map(textValue).filter((item): item is string => Boolean(item))
      : textValue(record.issues)?.split(/[;；]/).map((item) => item.trim()).filter(Boolean),
  };
  return Object.values(facts).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)) ? facts : null;
}

export function catalogImportLocation(facts?: CatalogImportFacts | null) {
  const sheet = facts?.sourceSheet?.trim();
  const cell = facts?.sourceCell?.trim();
  if (sheet && cell) return `${sheet} / ${cell}`;
  return sheet || cell || "未记录";
}

export function catalogSkuImageRefs(value?: CatalogImageRecord | null) {
  const record = value || {};
  const refs: string[] = [];
  for (const key of ["mainImagePath", "imageUrl", "localPath", "downloadUrl", "url"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) refs.push(candidate.trim());
  }
  const angleImages = Array.isArray(record.angleImages) ? record.angleImages : [];
  for (const candidate of angleImages) {
    if (typeof candidate === "string" && candidate.trim()) refs.push(candidate.trim());
  }
  return [...new Set(refs)];
}

export function catalogSkuRenderableImageRefs(value?: CatalogImageRecord | null) {
  return catalogSkuImageRefs(value).filter((reference) => Boolean(catalogProductImageSrc(reference)));
}

export function catalogSkuImageSummary(value?: CatalogImageRecord | null): CatalogSkuImageSummary {
  const refs = catalogSkuImageRefs(value);
  const candidates = refs.map((reference) => catalogProductImageCandidate(reference));
  const renderableRefs = candidates.filter((candidate) => candidate.src).map((candidate) => candidate.raw);
  const readyCount = renderableRefs.length;
  const invalidCount = candidates.filter((candidate) => candidate.status === "invalid").length;
  const missingCount = refs.length ? 0 : 1;
  const status = readyCount ? "ready" : refs.length ? "invalid" : "missing";
  return {
    refs,
    renderableRefs,
    readyCount,
    invalidCount,
    missingCount,
    status,
    label: catalogSkuImageStatusLabel({ readyCount, invalidCount, missingCount, refs }),
  };
}

export function catalogProductImageSrc(reference?: string, options: CatalogProductImageOptions = {}) {
  return catalogProductImageCandidate(reference, options).src;
}

export function CatalogProductImage({
  sku,
  reference,
  label,
  variant = "tile",
}: {
  sku?: CatalogImageRecord | null;
  reference?: string;
  label?: string;
  variant?: "tile" | "hero" | "mini";
}) {
  const [imageState, setImageState] = useState<"idle" | "loading" | "loaded" | "failed">("idle");
  const imageOptions = imageOptionsForVariant(variant);
  const candidates = (reference?.trim() ? [reference.trim()] : catalogSkuImageRefs(sku)).map((item) => catalogProductImageCandidate(item, imageOptions));
  const selectedCandidate = candidates.find((candidate) => candidate.src) || candidates[0] || catalogProductImageCandidate("");
  const src = selectedCandidate.src;
  const raw = selectedCandidate.raw;
  const caption = label || String(sku?.name || sku?.skuCode || raw || "商品图片");
  const failed = imageState === "failed";
  const loaded = imageState === "loaded";
  const runtimeState = failed ? "failed" : src ? (loaded ? "ready" : "loading") : selectedCandidate.status;
  const variantClass = variant === "hero" ? styles.productImageHero : variant === "mini" ? styles.productImageMini : styles.productImageTile;
  const intrinsicSize = intrinsicImageSize(variant);

  useEffect(() => {
    setImageState(src ? "loading" : "idle");
  }, [src]);

  useEffect(() => {
    if (!src || imageState !== "loading" || src.startsWith("/api/assets/local-file")) return undefined;
    const timer = window.setTimeout(() => {
      setImageState((current) => current === "loading" ? "failed" : current);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [src, imageState]);

  return (
    <figure className={`${styles.productImage} ${variantClass}`} data-image-state={runtimeState}>
      {src && !failed ? (
        <img
          className={loaded ? undefined : styles.productImageLoading}
          src={src}
          alt={caption}
          loading={variant === "hero" ? "eager" : "lazy"}
          decoding="async"
          width={intrinsicSize.width}
          height={intrinsicSize.height}
          onLoad={() => setImageState("loaded")}
          onError={() => setImageState("failed")}
        />
      ) : (
        <div className={styles.productImagePlaceholder}>
          <ImageIcon size={variant === "mini" ? 16 : 22} aria-hidden="true" />
          <span>{catalogProductImageStateText(selectedCandidate, failed)}</span>
        </div>
      )}
      <figcaption title={raw || caption}>{caption}</figcaption>
    </figure>
  );
}

function catalogProductImageCandidate(reference?: string, options: CatalogProductImageOptions = {}): CatalogImageCandidate {
  const raw = String(reference || "").trim();
  if (!raw) return { raw: "", src: "", status: "missing", reason: "missing" };
  const local = localAssetUrl(raw, {}, options);
  const src = safeRenderableImageSrc(local || raw);
  if (src) return { raw, src, status: "ready", reason: "ready" };
  const unsupported = /\.[a-z0-9]+(?:[?#].*)?$/i.test(raw) && !/\.(?:png|jpe?g|webp|gif|bmp|svg|avif)(?:[?#].*)?$/i.test(raw);
  return {
    raw,
    src: "",
    status: "invalid",
    reason: unsupported ? "unsupported_type" : "unsafe_or_unimported",
  };
}

function catalogSkuImageStatusLabel(summary: Pick<CatalogSkuImageSummary, "readyCount" | "invalidCount" | "missingCount" | "refs">) {
  if (summary.readyCount > 0) return `${summary.readyCount} 张可预览图`;
  if (!summary.refs.length || summary.missingCount > 0) return "未设置商品图";
  if (summary.invalidCount > 0) return "图片路径不可预览";
  return "图片状态未确认";
}

function catalogProductImageStateText(candidate: CatalogImageCandidate, failed: boolean) {
  if (failed) return "图片加载失败或文件缺失";
  if (candidate.reason === "missing") return "未设置商品图";
  if (candidate.reason === "unsupported_type") return "图片格式不支持";
  if (candidate.reason === "unsafe_or_unimported") return "图片需要导入本地资产库后预览";
  return "图片正在读取";
}

function imageOptionsForVariant(variant: "tile" | "hero" | "mini"): CatalogProductImageOptions {
  if (variant === "hero") return {};
  if (variant === "mini") return { thumbnail: true, width: 128, height: 128 };
  return { thumbnail: true, width: 360, height: 270 };
}

function intrinsicImageSize(variant: "tile" | "hero" | "mini") {
  if (variant === "hero") return { width: 640, height: 512 };
  if (variant === "mini") return { width: 128, height: 128 };
  return { width: 360, height: 270 };
}

function dimensionValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) continue;
      const numeric = Number(text);
      if (Number.isFinite(numeric) && numeric <= 0) continue;
      return text;
    }
  }
  return "";
}

function textValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
