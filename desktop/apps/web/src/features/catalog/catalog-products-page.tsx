"use client";

import { Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Sku } from "../../lib/api";
import styles from "./catalog-pages.module.css";
import { CatalogEmpty, CatalogHeader, CatalogNotice, CatalogProductImage, catalogSkuImageRefs, catalogSkuImageSummary, money } from "./catalog-ui";
import { useCatalogProducts } from "./use-catalog-records";

type CategoryGroup = {
  category: string;
  records: Sku[];
  imageReadyCount: number;
  missingImageCount: number;
  invalidImageCount: number;
};

export function CatalogProductsPage() {
  const { records, loading, loaded, stale, error, refresh } = useCatalogProducts();
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("zh-CN");
    return term
      ? records.filter((sku) =>
        `${sku.skuCode} ${sku.name} ${sku.category || ""} ${catalogSkuImageRefs(sku).join(" ")}`
          .toLocaleLowerCase("zh-CN")
          .includes(term),
      )
      : records;
  }, [records, search]);
  const grouped = useMemo(() => groupSkusByCategory(filtered), [filtered]);

  return (
    <section className={styles.page} aria-label="商品列表">
      <CatalogHeader
        eyebrow="商品中心"
        title="商品库"
        detail="按分类查看商品图片、价格、库存和状态；新增与编辑在独立商品编辑页完成。"
        actions={<><Link className={styles.buttonLink} href="/catalog/editor" data-action-id="catalog-products-new"><Plus size={16} aria-hidden="true" />新建商品</Link><button type="button" data-action-id="catalog-products-refresh" aria-label="刷新商品列表" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新列表</button></>}
      />
      {error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}
      <article className={styles.card} aria-label="商品查询结果">
        <div className={styles.cardHeader}>
          <div><h2>分类商品图片</h2><p>{loaded ? `${filtered.length} / ${records.length} 个 SKU${stale ? " / 上次可信快照" : ""}` : "读取未确认"}</p></div>
        </div>
        <label className={styles.searchField}><span>搜索 SKU、名称、分类或图片路径</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        {loading ? <CatalogEmpty title="正在读取商品" detail="已知内置降级商品会被拒绝展示。" busy /> : loaded && grouped.length ? (
          <div className={styles.categoryGrid}>
            {grouped.map((group) => (
              <section className={styles.categorySection} key={group.category} aria-label={`分类 ${group.category}`}>
                <div className={styles.categoryHeader}>
                  <h3>{group.category}</h3>
                  <span>{group.records.length} 个商品 / {group.imageReadyCount} 个有图 / {group.missingImageCount} 缺图 / {group.invalidImageCount} 不可预览</span>
                </div>
                <ul className={styles.productImageGrid}>
                  {group.records.map((sku) => {
                    const imageSummary = catalogSkuImageSummary(sku);
                    return (
                      <li key={sku.id}>
                        <Link className={styles.productTile} href={`/catalog/products/${encodeURIComponent(sku.skuCode)}`} data-action-id={`catalog-products-open-${sku.skuCode}`} aria-label={`查看商品 ${sku.skuCode}`}>
                          <CatalogProductImage sku={sku} label={sku.name} />
                          <span className={styles.productTileBody}>
                            <strong>{sku.name}</strong>
                            <small>{sku.skuCode} / {sku.type}</small>
                            <span className={styles.productTileMeta}>
                              <em>{money(sku.salePrice)}</em>
                              <small>库存 {sku.stock}</small>
                              <small>{sku.isActive === false ? "停用" : "启用"}</small>
                              <small data-image-status={imageSummary.status}>{imageSummary.label}</small>
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : loaded ? <CatalogEmpty title={search.trim() ? "没有匹配商品" : "读取成功，当前没有商品"} detail={search.trim() ? "清除搜索词后重试。" : "商品接口已返回可信空结果。"} /> : <CatalogEmpty title="商品列表状态未确认" detail="商品列表尚未成功读取，不能据此认定没有商品。" />}
      </article>
    </section>
  );
}

export function groupSkusByCategory(records: Sku[]): CategoryGroup[] {
  const groups = new Map<string, Sku[]>();
  for (const sku of records) {
    const category = sku.category?.trim() || "未分类";
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
    }));
}
