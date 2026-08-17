"use client";

import { Edit3, Image as ImageIcon, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SkuCatalogIssue, SkuRepairQueueItem } from "../../lib/api";
import { batchUpdateSkus } from "./api";
import styles from "./catalog-pages.module.css";
import { CatalogConfirmation, CatalogEmpty, CatalogHeader, CatalogNotice, catalogError } from "./catalog-ui";
import { useCatalogRepairQueue } from "./use-catalog-records";

export function CatalogRepairDetailPage({ skuCode }: { skuCode: string }) {
  const { selected, loading, loaded, stale, error: loadError, refresh } = useCatalogRepairQueue(skuCode);
  const [stock, setStock] = useState("");
  const [supplier, setSupplier] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const repairSequence = useRef(0);
  const skuCodeRef = useRef(skuCode);
  skuCodeRef.current = skuCode;

  useEffect(() => () => { repairSequence.current += 1; }, [skuCode]);

  function patchValues() {
    const patch: { stock?: number; supplier?: string; leadTimeDays?: number } = {};
    if (stock.trim()) patch.stock = Number(stock);
    if (supplier.trim()) patch.supplier = supplier.trim();
    if (leadTimeDays.trim()) patch.leadTimeDays = Number(leadTimeDays);
    return patch;
  }

  function validate() {
    const patch = patchValues();
    if (!Object.keys(patch).length) return "至少填写一个要修复的库存、供应商或交期字段。图片问题请打开商品编辑页补图。";
    if ((patch.stock !== undefined && (!Number.isFinite(patch.stock) || patch.stock < 0)) || (patch.leadTimeDays !== undefined && (!Number.isFinite(patch.leadTimeDays) || patch.leadTimeDays < 0))) return "库存和交期必须是非负数字。";
    return "";
  }

  async function repair() {
    if (!selected) return;
    const validation = validate();
    if (validation) { setConfirming(false); setError(validation); return; }
    const sequence = ++repairSequence.current;
    const requestSkuCode = selected.skuCode;
    const patch = patchValues();
    setConfirming(false); setBusy(true); setError(""); setNotice("");
    try {
      const result = await batchUpdateSkus({ skuCodes: [requestSkuCode], patch });
      if (sequence !== repairSequence.current || skuCodeRef.current !== requestSkuCode) return;
      setNotice(`已更新 ${result.count} 个商品；跳过 ${result.skipped.length} 个。`);
      setStock(""); setSupplier(""); setLeadTimeDays("");
      await refresh();
    } catch (cause) { if (sequence === repairSequence.current && skuCodeRef.current === requestSkuCode) setError(catalogError(cause, "商品修复失败")); }
    finally { if (sequence === repairSequence.current && skuCodeRef.current === requestSkuCode) setBusy(false); }
  }

  return (
    <section className={styles.page} aria-label="修复单个商品">
      <CatalogHeader eyebrow="商品中心 / 修复" title="修复单个 SKU" detail="库存、供应商、交期可在本页提交；商品图片问题必须进入商品编辑页补真实本地图片。" />
      {loadError || error ? <CatalogNotice tone="danger">{error || loadError}</CatalogNotice> : null}
      {notice ? <CatalogNotice tone="success">{notice}</CatalogNotice> : null}
      {loading ? <CatalogEmpty title="正在读取修复任务" detail={`SKU ${skuCode}`} busy /> : stale ? <CatalogEmpty title="修复任务需要刷新确认" detail="当前只有上一次可信审计；刷新成功前已阻止提交修复。" /> : selected ? (
        <form className={styles.card} onSubmit={(event) => { event.preventDefault(); const validation = validate(); if (validation) { setError(validation); return; } setConfirming(true); }}>
          <div className={styles.cardHeader}><div><h2>{selected.skuCode}</h2><p>{selected.recommendedAction}</p></div><span className={styles.statusPill}>{selected.blocking ? "阻断" : selected.severity}</span></div>
          <CatalogRepairImagePanel item={selected} />
          <ul className={styles.issueList}>{selected.missingFields.map((field) => <li key={field.field}><strong>{field.label}</strong><span>{field.action}</span></li>)}</ul>
          <div className={styles.formGrid}>
            <label><span>库存</span><input type="number" min="0" value={stock} disabled={busy} onChange={(event) => setStock(event.target.value)} placeholder="不修改则留空" /></label>
            <label><span>供应商</span><input value={supplier} disabled={busy} onChange={(event) => setSupplier(event.target.value)} placeholder="不修改则留空" /></label>
            <label><span>交期（天）</span><input type="number" min="0" value={leadTimeDays} disabled={busy} onChange={(event) => setLeadTimeDays(event.target.value)} placeholder="不修改则留空" /></label>
          </div>
          <div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="catalog-repair-detail-save-request" disabled={busy}><Wrench size={16} aria-hidden="true" />准备提交修复</button></div>
          <Link className={styles.backLink} href="/catalog/repair" data-action-id="catalog-repair-detail-back">返回修复队列</Link>
        </form>
      ) : loaded ? <CatalogEmpty title="修复任务不存在" detail="读取成功；它可能已完成或已从队列移除。" /> : <CatalogEmpty title="修复任务状态未确认" detail="修复队列尚未成功读取，已阻止修复提交。" />}
      {notice ? <div className={styles.formActions}><Link className={styles.primaryLink} href="/catalog/repair" data-action-id="catalog-repair-detail-next">返回修复队列处理下一项</Link></div> : null}
      {confirming && selected ? <CatalogConfirmation title="确认修复这个 SKU？" detail={`将通过现有批量更新接口只修改 ${selected.skuCode} 的库存、供应商或交期。图片请在商品编辑页补齐。`} confirmLabel="确认修复" confirmActionId="catalog-repair-detail-save-confirm" cancelActionId="catalog-repair-detail-save-cancel" busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void repair()} /> : null}
    </section>
  );
}

export function CatalogRepairImagePanel({ item }: { item: SkuRepairQueueItem }) {
  const imageIssues = repairImageIssues(item);
  if (!imageIssues.length) return null;
  return (
    <section className={styles.imageRepairPanel} aria-label="商品图片修复入口">
      <div>
        <ImageIcon size={20} aria-hidden="true" />
        <div>
          <strong>商品图片需要补齐</strong>
          <p>主图和多角度图会影响商品搭配、臻希 AI 出图、报价和订单图片快照；请进入商品编辑页填写本地图片路径或图片 URL。</p>
        </div>
      </div>
      <ul className={styles.issueList}>
        {imageIssues.map((issue, index) => (
          <li key={`${issue.code}-${index}`}><strong>{imageIssueLabel(issue)}</strong><span>{issue.message}{issue.path ? `：${issue.path}` : ""}</span></li>
        ))}
      </ul>
      <Link className={styles.primaryLink} href={`/catalog/editor?sku=${encodeURIComponent(item.skuCode)}`} data-action-id="catalog-repair-open-image-editor"><Edit3 size={16} aria-hidden="true" />打开商品编辑补图</Link>
    </section>
  );
}

function repairImageIssues(item: SkuRepairQueueItem) {
  return (item.issues || []).filter((issue) =>
    issue.imageRole || issue.field === "mainImagePath" || issue.field === "angleImages",
  );
}

function imageIssueLabel(issue: SkuCatalogIssue) {
  if (issue.imageRole === "main" || issue.field === "mainImagePath") return "商品主图";
  if (issue.imageRole === "angle" || issue.field === "angleImages") return issue.imageIndex === null || issue.imageIndex === undefined ? "多角度图" : `多角度图 ${Number(issue.imageIndex) + 1}`;
  return issue.field || issue.code;
}
