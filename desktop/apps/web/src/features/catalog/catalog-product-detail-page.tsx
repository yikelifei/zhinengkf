"use client";

import { Edit3, RefreshCw } from "lucide-react";
import Link from "next/link";
import styles from "./catalog-pages.module.css";
import { CatalogEmpty, CatalogHeader, CatalogNotice, CatalogProductImage, catalogSkuImageRefs, money } from "./catalog-ui";
import { useCatalogProducts } from "./use-catalog-records";

export function CatalogProductDetailPage({ skuCode }: { skuCode: string }) {
  const { selected, loading, loaded, stale, error, refresh } = useCatalogProducts(skuCode);
  const imageRefs = catalogSkuImageRefs(selected);
  return (
    <section className={styles.page} aria-label="商品详情">
      <CatalogHeader
        eyebrow="商品中心 / 商品详情"
        title="核对商品资料"
        detail="只读展示一个 SKU 的商品图片、价格、库存和搭配素材；修改资料进入独立编辑页。"
        actions={<button type="button" data-action-id="catalog-product-detail-refresh" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新详情</button>}
      />
      {error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}
      {stale ? <CatalogNotice tone="warning">当前展示上一次可信商品快照；刷新成功前已暂停编辑入口。</CatalogNotice> : null}
      {loading ? <CatalogEmpty title="正在读取商品" detail={`SKU ${skuCode}`} busy /> : selected ? (
        <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>{selected.name}</h2><p>{selected.skuCode} / {selected.category || "未分类"}</p></div><span className={styles.statusPill}>{selected.isActive === false ? "停用" : "启用"}</span></div>
          <div className={styles.productDetailLayout}>
            <section className={styles.productGallery} aria-label="商品图片">
              <CatalogProductImage sku={selected} label={`${selected.name} 主图`} variant="hero" />
              {imageRefs.length > 1 ? (
                <ul className={styles.productAngleGrid}>
                  {imageRefs.slice(1).map((reference, index) => (
                    <li key={`${reference}-${index}`}><CatalogProductImage reference={reference} label={`角度图 ${index + 1}`} variant="mini" /></li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>未设置多角度图；出图、审核和搭配判断会缺少侧面参考。</p>
              )}
            </section>
            <dl className={styles.factGrid}>
              <div><dt>类型</dt><dd>{selected.type}</dd></div>
              <div><dt>售价</dt><dd>{money(selected.salePrice)}</dd></div>
              <div><dt>成本</dt><dd>{money(selected.costPrice)}</dd></div>
              <div><dt>库存</dt><dd>{selected.stock}</dd></div>
              <div><dt>供应商</dt><dd>{selected.supplier || "未填写"}</dd></div>
              <div><dt>交期</dt><dd>{selected.leadTimeDays === undefined ? "未填写" : `${selected.leadTimeDays} 天`}</dd></div>
              <div><dt>材质</dt><dd>{selected.material || "未填写"}</dd></div>
              <div><dt>场景标签</dt><dd>{selected.sceneTags?.join("、") || "未填写"}</dd></div>
            </dl>
          </div>
          {!stale ? <div className={styles.formActions}><Link className={styles.primaryLink} href={`/catalog/editor?sku=${encodeURIComponent(selected.skuCode)}`} data-action-id="catalog-product-open-editor"><Edit3 size={16} aria-hidden="true" />编辑这个商品</Link></div> : null}
          <Link className={styles.backLink} href="/catalog/products" data-action-id="catalog-product-back-list">返回商品列表</Link>
        </article>
      ) : loaded ? <CatalogEmpty title="没有找到商品" detail="读取成功；请返回商品列表重新选择。" /> : <CatalogEmpty title="商品状态未确认" detail="商品详情尚未成功读取，不能据此认定商品不存在。" />}
    </section>
  );
}
