"use client";

import { Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./catalog-pages.module.css";
import { CatalogEmpty, CatalogHeader, CatalogNotice, money } from "./catalog-ui";
import { useCatalogProducts } from "./use-catalog-records";

export function CatalogProductsPage() {
  const { records, loading, error, refresh } = useCatalogProducts();
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("zh-CN");
    return term ? records.filter((sku) => `${sku.skuCode} ${sku.name} ${sku.category || ""}`.toLocaleLowerCase("zh-CN").includes(term)) : records;
  }, [records, search]);

  return (
    <section className={styles.page} aria-label="商品列表">
      <CatalogHeader
        eyebrow="商品中心"
        title="商品列表"
        detail="本页只负责查找和打开 SKU；新增与编辑在独立商品编辑页完成。"
        actions={<><Link className={styles.buttonLink} href="/catalog/editor" data-action-id="catalog-products-new"><Plus size={16} aria-hidden="true" />新建商品</Link><button type="button" data-action-id="catalog-products-refresh" aria-label="刷新商品列表" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新列表</button></>}
      />
      {error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}
      <article className={styles.card} aria-label="商品查询结果">
        <div className={styles.cardHeader}><div><h2>全部商品</h2><p>{filtered.length} / {records.length}</p></div></div>
        <label className={styles.searchField}><span>搜索 SKU 或名称</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        {loading ? <CatalogEmpty title="正在读取商品" detail="已知内置降级商品会被拒绝。" busy /> : filtered.length ? (
          <ul className={styles.selectionList}>
            {filtered.map((sku) => <li key={sku.id}><Link href={`/catalog/products/${encodeURIComponent(sku.skuCode)}`} data-action-id={`catalog-products-open-${sku.skuCode}`} aria-label={`查看商品 ${sku.skuCode}`}><span><strong>{sku.name}</strong><small>{sku.skuCode} · {sku.category || "未分类"}</small></span><span className={styles.rowMeta}><em>{money(sku.salePrice)}</em></span></Link></li>)}
          </ul>
        ) : <CatalogEmpty title={search.trim() ? "没有匹配商品" : "没有可信商品记录"} detail={search.trim() ? "清除搜索词后重试。" : "商品接口失败时不会展示内置降级商品。"} />}
      </article>
    </section>
  );
}
