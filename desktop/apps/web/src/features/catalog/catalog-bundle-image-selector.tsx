"use client";

import { CheckCircle2, ImagePlus, RefreshCw, X } from "lucide-react";
import { useMemo } from "react";
import type { Sku } from "../../lib/api";
import styles from "./catalog-pages.module.css";
import { CatalogEmpty, CatalogProductImage, catalogSkuImageSummary, catalogSkuRenderableImageRefs, money } from "./catalog-ui";

type CandidateCategoryGroup = {
  category: string;
  records: Sku[];
};

export function CatalogBundleImageSelector({
  records,
  loading,
  loaded,
  selectedSkuCodes,
  onToggleSku,
  onRefresh,
}: {
  records: Sku[];
  loading: boolean;
  loaded: boolean;
  selectedSkuCodes: string[];
  onToggleSku: (skuCode: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const selectedSet = useMemo(() => new Set(selectedSkuCodes), [selectedSkuCodes]);
  const groups = useMemo(() => bundleCatalogCandidateGroups(records), [records]);
  const selectedSkus = useMemo(
    () => selectedSkuCodes
      .map((code) => records.find((sku) => sku.skuCode === code))
      .filter((sku): sku is Sku => Boolean(sku)),
    [records, selectedSkuCodes],
  );
  const imageReadyCount = groups.reduce((sum, group) => sum + group.records.length, 0);
  const blockedImageCount = records.filter((sku) => sku.isActive !== false && catalogSkuRenderableImageRefs(sku).length === 0).length;

  return (
    <section className={styles.card} aria-label="商品图片搭配选品">
      <div className={styles.cardHeader}>
        <div>
          <h2>商品图片候选池</h2>
          <p>{loaded ? `${imageReadyCount} 个可视 SKU / 已选 ${selectedSkus.length} 个 SKU / ${blockedImageCount} 个缺图或不可预览未进入候选` : "读取未确认"}</p>
        </div>
        <button type="button" data-action-id="catalog-bundles-refresh-candidates" aria-label="刷新搭配商品图片候选" disabled={loading} onClick={() => void onRefresh()}>
          <RefreshCw size={16} aria-hidden="true" />刷新候选
        </button>
      </div>
      <BundleSelectionSummary records={selectedSkus} onToggleSku={onToggleSku} />
      {loading ? <CatalogEmpty title="正在读取商品图片候选" detail="候选池来自商品库主图和多角度图字段。" busy /> : loaded && groups.length ? (
        <div className={styles.categoryGrid}>
          {groups.map((group) => (
            <section className={styles.categorySection} key={group.category} aria-label={`搭配候选分类 ${group.category}`}>
              <div className={styles.categoryHeader}><h3>{group.category}</h3><span>{group.records.length} 个可视 SKU</span></div>
              <ul className={styles.candidateImageGrid}>
                {group.records.map((sku) => {
                  const selected = selectedSet.has(sku.skuCode);
                  return (
                    <li key={sku.id}>
                      <button type="button" className={styles.candidateImageButton} data-selected={selected || undefined} data-action-id={`catalog-bundles-toggle-image-${safeActionId(sku.skuCode)}`} aria-pressed={selected} onClick={() => onToggleSku(sku.skuCode)}>
                        <CatalogProductImage sku={sku} label={sku.name} variant="mini" />
                        <span className={styles.candidateImageBody}>
                          <strong>{sku.skuCode}</strong>
                          <span>{sku.type} / {money(sku.salePrice)} / 库存 {sku.stock}</span>
                          <em>{selected ? "已加入搭配" : `点击图片加入搭配，${catalogSkuImageSummary(sku).label}`}</em>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : loaded ? <CatalogEmpty title="商品库缺少可用图片" detail="请先在商品编辑页补主图或多角度图，否则搭配只能得到文字 SKU，不能用于真实出图审核。" /> : <CatalogEmpty title="候选池状态未确认" detail="商品库尚未成功读取，不能据此认定没有可搭配商品图。" />}
    </section>
  );
}

function BundleSelectionSummary({ records, onToggleSku }: { records: Sku[]; onToggleSku: (skuCode: string) => void }) {
  const total = records.reduce((sum, sku) => sum + Number(sku.salePrice || 0), 0);
  const hasGiftBox = records.some((sku) => sku.type === "gift_box");
  const hasItem = records.some((sku) => sku.type === "item" || sku.type === "accessory");
  if (!records.length) return <CatalogEmpty title="尚未选择搭配商品" detail="从下方商品图片候选池点击图片，先形成一个可人工核对的搭配草案。" />;
  return (
    <div className={styles.bundleSelectionBoard} aria-label="已选图片搭配">
      <div className={styles.bundleSelectionHeader}><strong>已选搭配草案</strong><span>{records.length} 个 SKU / 合计 {money(total)}</span></div>
      <ul className={styles.bundleSelectionList}>
        {records.map((sku) => (
          <li key={sku.skuCode}>
            <CatalogProductImage sku={sku} label={sku.name} variant="mini" />
            <div><strong>{sku.skuCode}</strong><span>{sku.name}</span><small>{sku.category || "未分类"} / {sku.type}</small></div>
            <button type="button" data-action-id={`catalog-bundles-remove-image-${safeActionId(sku.skuCode)}`} aria-label={`移除搭配商品 ${sku.skuCode}`} onClick={() => onToggleSku(sku.skuCode)}><X size={15} aria-hidden="true" /></button>
          </li>
        ))}
      </ul>
      <p className={styles.bundleSelectionHint} data-readiness={hasGiftBox && hasItem ? "ready" : "blocked"}>
        {hasGiftBox && hasItem ? <CheckCircle2 size={15} aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}
        {hasGiftBox && hasItem ? "搭配草案已包含礼盒和内搭商品，可用于设计任务前的人工确认。" : "请至少选择 1 个礼盒和 1 个内搭商品，避免后续设计任务只有文字报价。"}
      </p>
    </div>
  );
}

export function bundleCatalogCandidateGroups(records: Sku[]): CandidateCategoryGroup[] {
  const groups = new Map<string, Sku[]>();
  for (const sku of records) {
    if (sku.isActive === false || catalogSkuRenderableImageRefs(sku).length === 0) continue;
    const category = sku.category?.trim() || "未分类";
    groups.set(category, [...(groups.get(category) || []), sku]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .map(([category, rows]) => ({
      category,
      records: [...rows].sort((left, right) => Number(right.stock || 0) - Number(left.stock || 0) || left.name.localeCompare(right.name, "zh-CN")),
    }));
}

function safeActionId(value: string) {
  return String(value || "sku").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "sku";
}
