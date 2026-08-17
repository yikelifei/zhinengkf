"use client";

import { CheckCircle2, PackageCheck, PackageSearch, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { localAssetUrl, type BundleRecommendation, type Sku } from "../../lib/api";
import { getSkus, recommendBundle } from "./api";
import {
  catalogSelectionFromRecommendation,
  catalogSelectionFromSku,
  firstSkuImage,
  type DesignJobCatalogSelection,
} from "./design-job-create-model";
import styles from "./design-pages.module.css";
import { DesignEmpty, DesignNotice, errorText } from "./design-ui";
import { validateCatalogBundleBudget } from "../catalog/catalog-journey-state";

type DesignJobCreateCatalogPickerProps = {
  scene: string;
  quantity: string;
  perUnitAmount: string;
  totalAmount: string;
  busy: boolean;
  onApply: (selection: DesignJobCatalogSelection) => void;
};

export function DesignJobCreateCatalogPicker({
  scene,
  quantity,
  perUnitAmount,
  totalAmount,
  busy,
  onApply,
}: DesignJobCreateCatalogPickerProps) {
  const [records, setRecords] = useState<Sku[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [error, setError] = useState("");
  const [recommendation, setRecommendation] = useState<BundleRecommendation | null>(null);
  const [catalogStale, setCatalogStale] = useState(false);
  const [selectedSkuCodes, setSelectedSkuCodes] = useState<string[]>([]);
  const requestRef = useRef(0);
  const recommendationRequestRef = useRef(0);
  const selectedSkuCodeSet = useMemo(() => new Set(selectedSkuCodes), [selectedSkuCodes]);
  const selectedSkus = useMemo(
    () => selectedSkuCodes
      .map((code) => records.find((sku) => sku.skuCode === code))
      .filter((sku): sku is Sku => Boolean(sku)),
    [records, selectedSkuCodes],
  );
  const recommendationIntent = JSON.stringify([scene.trim(), quantity, perUnitAmount, totalAmount, [...selectedSkuCodes].sort()]);
  const recommendationIntentRef = useRef(recommendationIntent);
  recommendationIntentRef.current = recommendationIntent;
  const activeRecords = useMemo(() => records.filter((sku) => sku.isActive !== false), [records]);
  const imageReadyRecords = useMemo(() => activeRecords.filter((sku) => firstSkuImage(sku)), [activeRecords]);
  const visibleRecords = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("zh-CN");
    const filtered = term
      ? activeRecords.filter((sku) =>
        `${sku.skuCode} ${sku.name} ${sku.category || ""} ${firstSkuImage(sku)}`.toLocaleLowerCase("zh-CN").includes(term),
      )
      : activeRecords;
    return [...filtered]
      .sort((left, right) => Number(Boolean(firstSkuImage(right))) - Number(Boolean(firstSkuImage(left))) || left.name.localeCompare(right.name, "zh-CN"))
      .slice(0, 12);
  }, [activeRecords, query]);

  async function refreshCatalog() {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const skus = await getSkus(false);
      if (requestRef.current !== requestId) return;
      setRecords(skus);
      setSelectedSkuCodes((current) => current.filter((code) => skus.some((sku) => sku.skuCode === code && sku.isActive !== false && firstSkuImage(sku))));
      setLoaded(true);
      setCatalogStale(false);
    } catch (cause) {
      if (requestRef.current !== requestId) return;
      setCatalogStale(records.length > 0);
      setLoaded(records.length > 0);
      setError(`${errorText(cause, "商品库读取失败")}${records.length ? "；已保留上一次可信商品，重新推荐前请刷新确认。" : ""}`);
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }

  useEffect(() => {
    void refreshCatalog();
    return () => { requestRef.current += 1; };
  }, []);

  useEffect(() => {
    recommendationRequestRef.current += 1;
    setRecommendation(null);
    setRecommending(false);
  }, [scene, quantity, perUnitAmount, totalAmount]);

  function toggleSkuSelection(sku: Sku) {
    if (!firstSkuImage(sku)) return;
    recommendationRequestRef.current += 1;
    setRecommendation(null);
    setSelectedSkuCodes((current) => current.includes(sku.skuCode)
      ? current.filter((code) => code !== sku.skuCode)
      : [...current, sku.skuCode]);
  }

  async function applyRecommendation() {
    const validation = validateCatalogBundleBudget({ scene, quantity, perUnitAmount, totalAmount, maxItems: "6" });
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    const intent = recommendationIntent;
    const requestId = ++recommendationRequestRef.current;
    const budget = {
      mode: "per_box" as const,
      quantity: validation.quantity,
      perUnitAmount: validation.perUnitAmount,
      totalAmount: validation.totalAmount,
    };
    setRecommending(true);
    setError("");
    try {
      const result = await recommendBundle({
        scene: scene.trim(),
        budget,
        maxItems: 6,
        selectedSkuCodes,
        requireImages: true,
      });
      if (requestId !== recommendationRequestRef.current || intent !== recommendationIntentRef.current) return;
      setRecommendation(result);
      if (result.items.length) onApply(catalogSelectionFromRecommendation(result));
    } catch (cause) {
      if (requestId === recommendationRequestRef.current && intent === recommendationIntentRef.current) setError(errorText(cause, "组合推荐失败"));
    } finally {
      if (requestId === recommendationRequestRef.current) setRecommending(false);
    }
  }

  return (
    <section className={styles.catalogPicker} aria-label="商品库选择" data-image-ready-count={imageReadyRecords.length} data-selected-sku-count={selectedSkus.length}>
      {error ? <DesignNotice tone="warning">{error}</DesignNotice> : null}
      <div className={styles.assetPickerHeader}>
        <div>
          <h3>商品库</h3>
          <p>{loading ? "正在读取商品库" : loaded ? `${records.filter((sku) => sku.isActive !== false).length} 个启用 SKU${catalogStale ? " / 上次可信快照" : ""}` : "切换前先刷新商品库"}</p>
        </div>
        <span className={styles.assetPickerActions}>
          <button type="button" data-action-id="design-job-create-refresh-catalog" disabled={loading || busy} onClick={() => void refreshCatalog()}>
            <RefreshCw size={16} aria-hidden="true" />
            刷新商品
          </button>
          <button type="button" data-action-id="design-job-create-recommend-bundle" disabled={recommending || loading || busy || catalogStale} title={catalogStale ? "商品库刷新失败，请刷新成功后再重新推荐。" : undefined} onClick={() => void applyRecommendation()}>
            <Sparkles size={16} aria-hidden="true" />
            {recommending ? "推荐中" : "推荐组合"}
          </button>
        </span>
      </div>
      <label className={styles.searchField}>
        <span>搜索 SKU 或名称</span>
        <input type="search" value={query} disabled={busy || loading} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <CatalogSelectionBoard records={selectedSkus} busy={busy || recommending} onRemove={toggleSkuSelection} />
      {loaded && visibleRecords.length ? (
        <ul className={styles.assetPickerList}>
          {visibleRecords.map((sku) => {
            const image = firstSkuImage(sku);
            const selected = selectedSkuCodeSet.has(sku.skuCode);
            return (
              <li key={sku.id} data-selected={selected || undefined}>
                <div className={styles.catalogSkuOption}>
                  <DesignReferenceImage reference={image} label={sku.name} />
                  <span><strong>{sku.name}</strong><span>{sku.skuCode} / {sku.type} / {image ? "有商品图" : "缺商品图"}</span></span>
                </div>
                <button
                  type="button"
                  data-action-id={`design-job-create-toggle-catalog-sku-${safeActionId(sku.skuCode)}`}
                  aria-pressed={selected}
                  disabled={busy || !image}
                  onClick={() => toggleSkuSelection(sku)}
                >
                  {selected ? <CheckCircle2 size={15} aria-hidden="true" /> : <PackageSearch size={15} aria-hidden="true" />}
                  {selected ? "已选" : "加入搭配"}
                </button>
                <button type="button" data-action-id="design-job-create-use-catalog-sku" disabled={busy || !image} onClick={() => onApply(catalogSelectionFromSku(sku))}>
                  <PackageCheck size={15} aria-hidden="true" />
                  套用
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <DesignEmpty title={loaded ? "没有匹配商品" : "商品库状态未确认"} detail={loaded ? "可以调整搜索词，或先到商品中心补商品资料。" : "刷新成功前不要把商品库当成空数据。"} busy={loading} />
      )}
      {recommendation ? (
        <div className={styles.endpoint}>
          <strong>已套用推荐组合</strong>
          <span>{recommendation.status} / {recommendation.items.length} 个商品 / 售价 {money(recommendation.totals.salePrice)}</span>
          {recommendation.warnings.length ? <span>{recommendation.warnings.join("；")}</span> : null}
          <div className={styles.bundlePreviewGrid} aria-label="推荐组合商品图片">
            {recommendation.items.slice(0, 6).map((item, index) => (
              <DesignReferenceImage
                key={`${item.skuCode || item.type || index}`}
                reference={firstSkuImage(item)}
                label={String(item.name || item.skuCode || item.type || `商品 ${index + 1}`)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CatalogSelectionBoard({
  records,
  busy,
  onRemove,
}: {
  records: Sku[];
  busy: boolean;
  onRemove: (sku: Sku) => void;
}) {
  if (!records.length) {
    return (
      <div className={styles.catalogSelectionBoard} aria-label="已选商品图片搭配">
        <PackageSearch size={16} aria-hidden="true" />
        <span>尚未选择要参与搭配的商品图片</span>
      </div>
    );
  }
  return (
    <div className={styles.catalogSelectionBoard} aria-label="已选商品图片搭配">
      <strong>已选搭配 {records.length} 个 SKU</strong>
      <ul className={styles.catalogSelectionList}>
        {records.map((sku) => (
          <li key={sku.skuCode}>
            <DesignReferenceImage reference={firstSkuImage(sku)} label={sku.name} />
            <span><strong>{sku.skuCode}</strong><small>{sku.name}</small></span>
            <button type="button" data-action-id={`design-job-create-remove-selected-sku-${safeActionId(sku.skuCode)}`} aria-label={`移除搭配商品 ${sku.skuCode}`} disabled={busy} onClick={() => onRemove(sku)}>
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function money(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `¥${numeric.toFixed(2)}` : "-";
}

function DesignReferenceImage({ reference, label }: { reference: string; label: string }) {
  const src = designReferenceImageSrc(reference);
  return (
    <figure className={styles.catalogPreviewImage} data-image-state={src ? "ready" : reference ? "unavailable" : "missing"}>
      {src ? <img src={src} alt={label} loading="lazy" /> : <span>{reference ? "需导入素材库" : "缺图"}</span>}
      <figcaption title={reference || label}>{label}</figcaption>
    </figure>
  );
}

function designReferenceImageSrc(reference: string) {
  const value = String(reference || "").trim();
  if (!value) return "";
  const local = localAssetUrl(value);
  if (local) return local;
  if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/")) return value;
  return "";
}

function safeActionId(value: string) {
  return String(value || "sku").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "sku";
}
