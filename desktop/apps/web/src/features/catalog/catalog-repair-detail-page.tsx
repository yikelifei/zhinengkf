"use client";

import { Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { batchUpdateSkus } from "./api";
import styles from "./catalog-pages.module.css";
import { CatalogConfirmation, CatalogEmpty, CatalogHeader, CatalogNotice, catalogError } from "./catalog-ui";
import { useCatalogRepairQueue } from "./use-catalog-records";

export function CatalogRepairDetailPage({ skuCode }: { skuCode: string }) {
  const { selected, loading, error: loadError } = useCatalogRepairQueue(skuCode);
  const [stock, setStock] = useState("");
  const [supplier, setSupplier] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function patchValues() {
    const patch: { stock?: number; supplier?: string; leadTimeDays?: number } = {};
    if (stock.trim()) patch.stock = Number(stock);
    if (supplier.trim()) patch.supplier = supplier.trim();
    if (leadTimeDays.trim()) patch.leadTimeDays = Number(leadTimeDays);
    return patch;
  }

  function validate() {
    const patch = patchValues();
    if (!Object.keys(patch).length) return "至少填写一个要修复的字段。";
    if ((patch.stock !== undefined && (!Number.isFinite(patch.stock) || patch.stock < 0)) || (patch.leadTimeDays !== undefined && (!Number.isFinite(patch.leadTimeDays) || patch.leadTimeDays < 0))) return "库存和交期必须是非负数字。";
    return "";
  }

  async function repair() {
    if (!selected) return;
    const validation = validate();
    if (validation) { setConfirming(false); setError(validation); return; }
    setConfirming(false); setBusy(true); setError(""); setNotice("");
    try {
      const result = await batchUpdateSkus({ skuCodes: [selected.skuCode], patch: patchValues() });
      setNotice(`已更新 ${result.count} 个商品；跳过 ${result.skipped.length} 个。`);
    } catch (cause) { setError(catalogError(cause, "商品修复失败")); }
    finally { setBusy(false); }
  }

  return (
    <section className={styles.page} aria-label="修复单个商品">
      <CatalogHeader eyebrow="商品中心 · 修复" title="修复单个 SKU" detail="本页只修改当前 SKU 的库存、供应商或交期；不会批量选择其他商品。" />
      {loadError || error ? <CatalogNotice tone="danger">{error || loadError}</CatalogNotice> : null}
      {notice ? <CatalogNotice tone="success">{notice}</CatalogNotice> : null}
      {loading ? <CatalogEmpty title="正在读取修复任务" detail={`SKU ${skuCode}`} busy /> : selected ? (
        <form className={styles.card} onSubmit={(event) => { event.preventDefault(); const validation = validate(); if (validation) { setError(validation); return; } setConfirming(true); }}>
          <div className={styles.cardHeader}><div><h2>{selected.skuCode}</h2><p>{selected.recommendedAction}</p></div><span className={styles.statusPill}>{selected.blocking ? "阻断" : selected.severity}</span></div>
          <ul className={styles.issueList}>{selected.missingFields.map((field) => <li key={field.field}><strong>{field.label}</strong><span>{field.action}</span></li>)}</ul>
          <div className={styles.formGrid}>
            <label><span>库存</span><input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} placeholder="不修改则留空" /></label>
            <label><span>供应商</span><input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="不修改则留空" /></label>
            <label><span>交期（天）</span><input type="number" min="0" value={leadTimeDays} onChange={(event) => setLeadTimeDays(event.target.value)} placeholder="不修改则留空" /></label>
          </div>
          <div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="catalog-repair-detail-save-request" disabled={busy}><Wrench size={16} aria-hidden="true" />准备提交修复</button></div>
          <Link className={styles.backLink} href="/catalog/repair" data-action-id="catalog-repair-detail-back">返回修复队列</Link>
        </form>
      ) : <CatalogEmpty title="修复任务不存在" detail="它可能已完成或已从队列移除；请返回队列刷新。" />}
      {confirming && selected ? <CatalogConfirmation title="确认修复这个 SKU？" detail={`将通过现有批量更新接口只修改 ${selected.skuCode}。该接口没有操作员或 expected identity 字段。`} confirmLabel="确认修复" confirmActionId="catalog-repair-detail-save-confirm" cancelActionId="catalog-repair-detail-save-cancel" busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void repair()} /> : null}
    </section>
  );
}
