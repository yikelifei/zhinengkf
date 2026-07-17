"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import styles from "./catalog-pages.module.css";
import { CatalogEmpty, CatalogHeader, CatalogNotice } from "./catalog-ui";
import { useCatalogRepairQueue } from "./use-catalog-records";

export function CatalogRepairPage() {
  const { audit, loading, error, refresh } = useCatalogRepairQueue();
  return (
    <section className={styles.page} aria-label="商品修复队列">
      <CatalogHeader
        eyebrow="商品中心"
        title="商品修复队列"
        detail="本页只列出审计生成的修复任务；一次修复一个 SKU，并在独立页面确认。"
        actions={<button type="button" data-action-id="catalog-repair-refresh" aria-label="刷新商品修复队列" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新队列</button>}
      />
      {error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}
      <article className={styles.card} aria-label="待修复商品">
        <div className={styles.cardHeader}><div><h2>待修复</h2><p>{audit?.repairQueueCount || 0} 项 · 阻断 {audit?.blockingRepairCount || 0}</p></div></div>
        {loading ? <CatalogEmpty title="正在读取修复队列" detail="队列来自实时商品审计。" busy /> : audit?.repairQueue?.length ? (
          <ul className={styles.selectionList}>
            {audit.repairQueue.map((item) => <li key={item.skuCode}><Link href={`/catalog/repair/${encodeURIComponent(item.skuCode)}`} data-action-id={`catalog-repair-open-${item.skuCode}`} aria-label={`修复商品 ${item.skuCode}`}><span><strong>{item.name}</strong><small>{item.skuCode} · {item.issueCount} 个问题</small></span><em className={item.blocking ? styles.blocking : ""}>{item.blocking ? "阻断" : item.severity}</em></Link></li>)}
          </ul>
        ) : <CatalogEmpty title="当前没有修复任务" detail="修复队列为空；请到商品审计页查看整体状态。" />}
      </article>
    </section>
  );
}
