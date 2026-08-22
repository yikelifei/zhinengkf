"use client";

import { Edit3, Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Sku } from "../../lib/api";
import styles from "./catalog-pages.module.css";
import { deleteSku } from "./api";
import { CatalogConfirmation, CatalogEmpty, CatalogHeader, CatalogNotice, CatalogProductImage, catalogImportFacts, catalogSkuImageRefs, catalogSkuImageSummary, catalogSkuRenderableImageRefs, formatSkuDimensions, money } from "./catalog-ui";
import { useCatalogProducts } from "./use-catalog-records";

type CategoryGroup = {
  category: string;
  records: Sku[];
  imageReadyCount: number;
  missingImageCount: number;
  invalidImageCount: number;
  missingPriceCount: number;
  missingDimensionCount: number;
  threeViewReadyCount: number;
  duplicateImageCount: number;
};

type CategoryCount = {
  category: string;
  count: number;
};

type SourceScope = "all" | "source" | "manual";
type QualityFilter = "all" | "ready" | "missingPrice" | "missingDimensions" | "missingMainImage" | "missingThreeView" | "duplicateImage" | "inactive" | "unavailable";

const INITIAL_VISIBLE_COUNT = 72;
const VISIBLE_INCREMENT = 72;

export function CatalogProductsPage() {
  const { records, loading, loaded, stale, error, refresh, remove } = useCatalogProducts();
  const [search, setSearch] = useState("");
  const [sourceScope, setSourceScope] = useState<SourceScope>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_COUNT);
  const [deleteTarget, setDeleteTarget] = useState<Sku | null>(null);
  const [deletingSkuCode, setDeletingSkuCode] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const duplicateSkuCodes = useMemo(() => duplicateImageSkuCodes(records), [records]);
  const stats = useMemo(() => catalogStats(records, duplicateSkuCodes), [records, duplicateSkuCodes]);
  const categories = useMemo(() => [...new Set(records.map((sku) => sku.category?.trim()).filter(Boolean) as string[])].sort((left, right) => left.localeCompare(right, "zh-CN")), [records]);
  const categoryScopedRecords = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("zh-CN");
    const scoped = records
      .filter((sku) => sourceScope === "source" ? catalogSkuIsFromSource(sku) : sourceScope === "manual" ? !catalogSkuIsFromSource(sku) : true)
      .filter((sku) => typeFilter === "all" || sku.type === typeFilter)
      .filter((sku) => matchesQualityFilter(sku, qualityFilter, duplicateSkuCodes));
    return term
      ? scoped.filter((sku) =>
        skuSearchText(sku).includes(term),
      )
      : scoped;
  }, [records, search, sourceScope, typeFilter, qualityFilter, duplicateSkuCodes]);
  const categoryCounts = useMemo(() => catalogCategoryCounts(categoryScopedRecords), [categoryScopedRecords]);
  const filtered = useMemo(() => (
    categoryFilter === "all"
      ? categoryScopedRecords
      : categoryScopedRecords.filter((sku) => catalogCategoryName(sku) === categoryFilter)
  ), [categoryScopedRecords, categoryFilter]);
  const visibleRecords = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);
  const grouped = useMemo(() => groupSkusByCategory(visibleRecords, duplicateSkuCodes), [visibleRecords, duplicateSkuCodes]);

  useEffect(() => {
    setVisibleLimit(INITIAL_VISIBLE_COUNT);
  }, [search, sourceScope, categoryFilter, typeFilter, qualityFilter]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    const skuCode = deleteTarget.skuCode;
    setDeletingSkuCode(skuCode);
    setActionError("");
    setNotice("");
    try {
      const result = await deleteSku(skuCode);
      remove(skuCode);
      setDeleteTarget(null);
      setNotice(`已删除 ${result.deletedSku.skuCode}，同步移除 ${result.removedAssetCount} 条商品资产登记。`);
    } catch (cause) {
      setActionError(cause instanceof Error ? `删除失败：${cause.message}` : "删除失败");
    } finally {
      setDeletingSkuCode("");
    }
  }

  function selectCategory(category: string) {
    setCategoryFilter(category);
    window.requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  return (
    <section className={styles.page} aria-label="商品列表">
      <CatalogHeader
        eyebrow="商品中心"
        title="商品库"
        detail="按真实源表、资料完整度和图片状态管理商品；AI 搭品至少需要主图、侧面、背面三视图。"
        actions={<><Link className={styles.buttonLink} href="/catalog/editor" data-action-id="catalog-products-new"><Plus size={16} aria-hidden="true" />新建商品</Link><button type="button" data-action-id="catalog-products-refresh" aria-label="刷新商品列表" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新列表</button></>}
      />
      {error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}
      {actionError ? <CatalogNotice tone="danger">{actionError}</CatalogNotice> : null}
      {notice ? <CatalogNotice tone="success">{notice}</CatalogNotice> : null}
      <article className={styles.card} aria-label="商品查询结果">
        <div className={styles.cardHeader}>
          <div><h2>商品数据看板</h2><p>{loaded ? `${filtered.length} / ${records.length} 个 SKU · 当前渲染 ${visibleRecords.length} 个${stale ? " / 上次可信快照" : ""}` : "读取未确认"}</p></div>
        </div>
        <div className={styles.catalogMetricStrip} aria-label="商品完整性概览">
          <article><span>源表商品</span><strong>{stats.sourceCount}</strong></article>
          <article><span>有售价</span><strong>{stats.saleReadyCount}</strong></article>
          <article><span>有尺寸</span><strong>{stats.dimensionReadyCount}</strong></article>
          <article><span>有主图</span><strong>{stats.mainImageReadyCount}</strong></article>
          <article><span>三视图完整</span><strong>{stats.threeViewReadyCount}</strong></article>
          <article><span>重复源图</span><strong>{stats.duplicateImageCount}</strong></article>
        </div>
        <div className={styles.catalogFilterGrid} aria-label="商品筛选">
          <label className={styles.searchField}><span>搜索 SKU、名称、分类、源表位置或图片路径</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label><span>来源</span><select value={sourceScope} onChange={(event) => setSourceScope(event.target.value as SourceScope)}><option value="all">全部来源</option><option value="source">只看源表商品</option><option value="manual">只看手动新增</option></select></label>
          <label><span>分类</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">全部分类</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label><span>类型</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">全部类型</option><option value="item">内搭商品</option><option value="gift_box">礼盒</option><option value="accessory">配件</option></select></label>
          <label><span>资料状态</span><select value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value as QualityFilter)}>
            <option value="all">全部状态</option>
            <option value="ready">可进入搭品</option>
            <option value="missingPrice">缺售价</option>
            <option value="missingDimensions">缺尺寸</option>
            <option value="missingMainImage">缺主图</option>
            <option value="missingThreeView">缺三视图</option>
            <option value="duplicateImage">一图多用</option>
            <option value="inactive">停用草稿</option>
            <option value="unavailable">源表停供/缺货</option>
          </select></label>
        </div>
        {loaded && categoryCounts.length ? (
          <div className={styles.catalogCategoryQuickNav} aria-label="按分类快速定位">
            <button type="button" data-action-id="catalog-category-jump-all" data-selected={categoryFilter === "all"} onClick={() => selectCategory("all")}>
              <span>全部分类</span>
              <small>{categoryScopedRecords.length}</small>
            </button>
            {categoryCounts.map((item, index) => (
              <button type="button" key={item.category} data-action-id={`catalog-category-jump-${index}`} data-selected={categoryFilter === item.category} onClick={() => selectCategory(item.category)}>
                <span>{item.category}</span>
                <small>{item.count}</small>
              </button>
            ))}
          </div>
        ) : null}
        {loading ? <CatalogEmpty title="正在读取商品" detail="已知内置降级商品会被拒绝展示。" busy /> : loaded && grouped.length ? (
          <div className={styles.categoryGrid} ref={resultsRef}>
            {grouped.map((group) => (
              <section className={styles.categorySection} key={group.category} aria-label={`分类 ${group.category}`}>
                <div className={styles.categoryHeader}>
                  <h3>{group.category}</h3>
                  <span>{group.records.length} 个商品 / {group.imageReadyCount} 有主图 / {group.threeViewReadyCount} 三视图 / {group.missingPriceCount} 缺价 / {group.missingDimensionCount} 缺尺寸 / {group.duplicateImageCount} 重复图</span>
                </div>
                <ul className={styles.productImageGrid}>
                  {group.records.map((sku) => {
                    const imageSummary = catalogSkuImageSummary(sku);
                    const importFacts = catalogImportFacts(sku.matchingRules);
                    const threeViewReady = catalogSkuThreeViewReady(sku);
                    const duplicateImage = duplicateSkuCodes.has(sku.skuCode);
                    return (
                      <li key={sku.id}>
                        <article className={styles.productTile}>
                          <Link className={styles.productTileLink} href={`/catalog/products/${encodeURIComponent(sku.skuCode)}`} data-action-id={`catalog-products-open-${sku.skuCode}`} aria-label={`查看商品 ${sku.skuCode}`}>
                            <CatalogProductImage sku={sku} label={sku.name} />
                          </Link>
                          <div className={styles.productTileBody}>
                            <strong>{sku.name}</strong>
                            <small>{sku.skuCode} / {sku.type}</small>
                            <span className={styles.productTileMeta}>
                              <em>售价 {money(sku.salePrice)}</em>
                              <small>成本 {money(sku.costPrice)}</small>
                              {importFacts?.rawPrice ? <small>原始价 {importFacts.rawPrice}</small> : null}
                              <small>尺寸 {formatSkuDimensions(sku.dimensions)}</small>
                              <small>库存 {sku.stock}</small>
                              <small>{sku.isActive === false ? "停用" : "启用"}</small>
                              <small data-image-status={imageSummary.status}>{imageSummary.label}</small>
                              <small data-image-status={threeViewReady ? "ready" : "missing"}>{threeViewReady ? "三视图完整" : "缺三视图"}</small>
                              {duplicateImage ? <small data-image-status="invalid">一图多用</small> : null}
                              {importFacts?.supplyStatus === "缺货/停供" ? <small data-image-status="invalid">源表停供</small> : null}
                            </span>
                          </div>
                          <div className={styles.tileActions}>
                            <Link href={`/catalog/editor?sku=${encodeURIComponent(sku.skuCode)}`} data-action-id={`catalog-products-edit-${sku.skuCode}`} aria-label={`编辑商品 ${sku.skuCode}`}><Edit3 size={15} aria-hidden="true" />编辑</Link>
                            <button type="button" className={styles.dangerButton} data-action-id={`catalog-products-delete-${sku.skuCode}`} aria-label={`删除商品 ${sku.skuCode}`} disabled={Boolean(deletingSkuCode)} onClick={() => setDeleteTarget(sku)}><Trash2 size={15} aria-hidden="true" />删除</button>
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {visibleRecords.length < filtered.length ? (
              <div className={styles.loadMoreBar}>
                <button type="button" data-action-id="catalog-products-load-more" onClick={() => setVisibleLimit((current) => current + VISIBLE_INCREMENT)}>继续加载 {Math.min(VISIBLE_INCREMENT, filtered.length - visibleRecords.length)} 个</button>
              </div>
            ) : null}
          </div>
        ) : loaded ? <CatalogEmpty title={search.trim() ? "没有匹配商品" : "读取成功，当前没有商品"} detail={search.trim() ? "清除搜索词后重试。" : "商品接口已返回可信空结果。"} /> : <CatalogEmpty title="商品列表状态未确认" detail="商品列表尚未成功读取，不能据此认定没有商品。" />}
      </article>
      {deleteTarget ? <CatalogConfirmation title="确认删除商品？" detail={`将从商品库删除 ${deleteTarget.skuCode} / ${deleteTarget.name}。本操作会移除商品记录和资产登记，图片文件不会被物理删除。`} confirmLabel="确认删除" confirmActionId="catalog-products-delete-confirm" cancelActionId="catalog-products-delete-cancel" busy={deletingSkuCode === deleteTarget.skuCode} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} /> : null}
    </section>
  );
}

export function groupSkusByCategory(records: Sku[], duplicateSkuCodes = new Set<string>()): CategoryGroup[] {
  const groups = new Map<string, Sku[]>();
  for (const sku of records) {
    const category = catalogCategoryName(sku);
    groups.set(category, [...(groups.get(category) || []), sku]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .map(([category, rows]) => ({
      category,
      records: [...rows].sort((left, right) => left.name.localeCompare(right.name, "zh-CN") || left.skuCode.localeCompare(right.skuCode, "zh-CN")),
      imageReadyCount: rows.filter((sku) => catalogSkuImageSummary(sku).readyCount > 0).length,
      missingImageCount: rows.filter((sku) => catalogSkuImageSummary(sku).status === "missing").length,
      invalidImageCount: rows.filter((sku) => catalogSkuImageSummary(sku).status === "invalid").length,
      missingPriceCount: rows.filter((sku) => !catalogSkuHasSalePrice(sku)).length,
      missingDimensionCount: rows.filter((sku) => !catalogSkuHasDimensions(sku)).length,
      threeViewReadyCount: rows.filter(catalogSkuThreeViewReady).length,
      duplicateImageCount: rows.filter((sku) => duplicateSkuCodes.has(sku.skuCode)).length,
    }));
}

function catalogCategoryCounts(records: Sku[]): CategoryCount[] {
  const groups = new Map<string, Sku[]>();
  for (const sku of records) {
    const category = catalogCategoryName(sku);
    groups.set(category, [...(groups.get(category) || []), sku]);
  }
  return [...groups.entries()]
    .sort(([leftCategory, leftRows], [rightCategory, rightRows]) => rightRows.length - leftRows.length || leftCategory.localeCompare(rightCategory, "zh-CN"))
    .map(([category, rows]) => ({
      category,
      count: rows.length,
    }));
}

function catalogCategoryName(sku: Sku) {
  return sku.category?.trim() || "未分类";
}

function skuSearchText(sku: Sku) {
  const facts = catalogImportFacts(sku.matchingRules);
  return `${sku.skuCode} ${sku.name} ${sku.category || ""} ${sku.type} ${money(sku.salePrice)} ${formatSkuDimensions(sku.dimensions)} ${facts?.rawPrice || ""} ${facts?.sourceSheet || ""} ${facts?.sourceCell || ""} ${facts?.sourceMedia || ""} ${catalogSkuImageRefs(sku).join(" ")}`
    .toLocaleLowerCase("zh-CN");
}

function catalogSkuReady(sku: Sku) {
  return sku.isActive !== false && catalogSkuHasSalePrice(sku) && catalogSkuHasDimensions(sku) && catalogSkuImageSummary(sku).status === "ready" && catalogSkuThreeViewReady(sku);
}

function catalogSkuHasSalePrice(sku: Sku) {
  return Number(sku.salePrice || 0) > 0;
}

function catalogSkuHasDimensions(sku: Sku) {
  return formatSkuDimensions(sku.dimensions) !== "未填写";
}

function catalogSkuThreeViewReady(sku: Sku) {
  return catalogSkuRenderableImageRefs(sku).length >= 3;
}

function catalogSkuIsFromSource(sku: Sku) {
  return sku.skuCode.startsWith("SRC-") || Boolean(catalogImportFacts(sku.matchingRules));
}

function matchesQualityFilter(sku: Sku, filter: QualityFilter, duplicateSkuCodes: Set<string>) {
  if (filter === "all") return true;
  if (filter === "ready") return catalogSkuReady(sku);
  if (filter === "missingPrice") return !catalogSkuHasSalePrice(sku);
  if (filter === "missingDimensions") return !catalogSkuHasDimensions(sku);
  if (filter === "missingMainImage") return catalogSkuImageSummary(sku).status !== "ready";
  if (filter === "missingThreeView") return !catalogSkuThreeViewReady(sku);
  if (filter === "duplicateImage") return duplicateSkuCodes.has(sku.skuCode);
  if (filter === "inactive") return sku.isActive === false;
  if (filter === "unavailable") return catalogImportFacts(sku.matchingRules)?.supplyStatus === "缺货/停供";
  return true;
}

function catalogStats(records: Sku[], duplicateSkuCodes: Set<string>) {
  return {
    sourceCount: records.filter(catalogSkuIsFromSource).length,
    saleReadyCount: records.filter(catalogSkuHasSalePrice).length,
    dimensionReadyCount: records.filter(catalogSkuHasDimensions).length,
    mainImageReadyCount: records.filter((sku) => catalogSkuImageSummary(sku).status === "ready").length,
    threeViewReadyCount: records.filter(catalogSkuThreeViewReady).length,
    duplicateImageCount: records.filter((sku) => duplicateSkuCodes.has(sku.skuCode)).length,
  };
}

function duplicateImageSkuCodes(records: Sku[]) {
  const groups = new Map<string, Sku[]>();
  for (const sku of records) {
    const facts = catalogImportFacts(sku.matchingRules);
    const key = facts?.sourceMedia?.trim()
      ? `source:${facts.sourceMedia.trim().toLocaleLowerCase("zh-CN")}`
      : catalogSkuImageRefs(sku)[0]
        ? `main:${catalogSkuImageRefs(sku)[0].trim().toLocaleLowerCase("zh-CN")}`
        : "";
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(sku);
    groups.set(key, group);
  }
  return new Set([...groups.values()].filter((group) => group.length > 1).flatMap((group) => group.map((sku) => sku.skuCode)));
}
