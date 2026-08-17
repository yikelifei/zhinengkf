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
  const candidates = refs.map(catalogProductImageCandidate);
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

export function catalogProductImageSrc(reference?: string) {
  return catalogProductImageCandidate(reference).src;
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
  const candidates = (reference?.trim() ? [reference.trim()] : catalogSkuImageRefs(sku)).map(catalogProductImageCandidate);
  const selectedCandidate = candidates.find((candidate) => candidate.src) || candidates[0] || catalogProductImageCandidate("");
  const src = selectedCandidate.src;
  const raw = selectedCandidate.raw;
  const caption = label || String(sku?.name || sku?.skuCode || raw || "商品图片");
  const failed = imageState === "failed";
  const loaded = imageState === "loaded";
  const runtimeState = failed ? "failed" : src ? (loaded ? "ready" : "loading") : selectedCandidate.status;
  const variantClass = variant === "hero" ? styles.productImageHero : variant === "mini" ? styles.productImageMini : styles.productImageTile;

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
          loading={variant === "mini" ? "lazy" : "eager"}
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

function catalogProductImageCandidate(reference?: string): CatalogImageCandidate {
  const raw = String(reference || "").trim();
  if (!raw) return { raw: "", src: "", status: "missing", reason: "missing" };
  const local = localAssetUrl(raw);
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
