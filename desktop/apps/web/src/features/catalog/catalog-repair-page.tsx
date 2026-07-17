"use client";

import { RefreshCw, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SkuCatalogAudit, SkuRepairQueueItem } from "../../lib/api";
import { batchUpdateSkus, getSkuCatalogAudit } from "./api";
import styles from "./catalog-pages.module.css";
import { CatalogConfirmation, CatalogEmpty, CatalogHeader, CatalogNotice, catalogError } from "./catalog-ui";

export function CatalogRepairPage() {
  const [audit, setAudit] = useState<SkuCatalogAudit | null>(null);
  const [selectedCode, setSelectedCode] = useState("");
  const [stock, setStock] = useState("");
  const [supplier, setSupplier] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [busy, setBusy] = useState<"" | "refresh" | "repair">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const selected = useMemo(() => audit?.repairQueue?.find((item) => item.skuCode === selectedCode) || null, [audit, selectedCode]);

  const refreshAudit = useCallback(async (preserveNotice = false) => {
    setBusy("refresh"); setError(""); if (!preserveNotice) setNotice("");
    try { const result = await getSkuCatalogAudit(); setAudit(result); setSelectedCode((current) => current && result.repairQueue?.some((item) => item.skuCode === current) ? current : ""); }
    catch (cause) { setError(catalogError(cause, "修复队列读取失败")); }
    finally { setBusy(""); }
  }, []);
  useEffect(() => { void refreshAudit(); }, [refreshAudit]);

  function selectItem(item: SkuRepairQueueItem) { setSelectedCode(item.skuCode); setStock(""); setSupplier(""); setLeadTimeDays(""); setError(""); setNotice(""); }
  async function repairSelected() {
    if (!selected) return;
    const patch: { stock?: number; supplier?: string; leadTimeDays?: number } = {};
    if (stock.trim()) patch.stock = Number(stock); if (supplier.trim()) patch.supplier = supplier.trim(); if (leadTimeDays.trim()) patch.leadTimeDays = Number(leadTimeDays);
    if (!Object.keys(patch).length) { setPendingConfirmation(false); setError("至少填写一个要修复的字段。"); return; }
    if ((patch.stock !== undefined && (!Number.isFinite(patch.stock) || patch.stock < 0)) || (patch.leadTimeDays !== undefined && (!Number.isFinite(patch.leadTimeDays) || patch.leadTimeDays < 0))) { setPendingConfirmation(false); setError("库存和交期必须是非负数字。"); return; }
    setPendingConfirmation(false); setBusy("repair"); setError(""); setNotice("");
    try { const result = await batchUpdateSkus({ skuCodes: [selected.skuCode], patch }); setNotice(`已更新 ${result.count} 个商品；跳过 ${result.skipped.length} 个。`); try { const next = await getSkuCatalogAudit(); setAudit(next); } catch (refreshError) { setError(catalogError(refreshError, "修复已完成，但队列刷新失败")); } }
    catch (cause) { setError(catalogError(cause, "商品修复失败")); }
    finally { setBusy(""); }
  }

  return <section className={styles.page} aria-label="商品修复队列">
    <CatalogHeader eyebrow="商品中心" title="商品修复" detail="只处理审计生成的阻断项和缺失字段。" actions={<button type="button" data-action-id="catalog-repair-refresh" aria-label="刷新商品修复队列" disabled={Boolean(busy)} onClick={() => void refreshAudit()}><RefreshCw size={16} aria-hidden="true" />刷新队列</button>} />
    {error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}{notice ? <CatalogNotice tone="success">{notice}</CatalogNotice> : null}
    <div className={styles.masterDetail}><section className={styles.card} aria-label="待修复商品"><div className={styles.cardHeader}><div><h2>待修复</h2><p>{audit?.repairQueueCount || 0} 项 · 阻断 {audit?.blockingRepairCount || 0}</p></div></div>{busy === "refresh" ? <CatalogEmpty title="正在读取修复队列" detail="队列来自实时商品审计。" busy /> : audit?.repairQueue?.length ? <ul className={styles.selectionList}>{audit.repairQueue.map((item) => <li key={item.skuCode}><button type="button" className={item.skuCode === selectedCode ? styles.selected : ""} data-action-id={`catalog-repair-select-${item.skuCode}`} aria-label={`选择修复 ${item.skuCode}`} aria-pressed={item.skuCode === selectedCode} onClick={() => selectItem(item)}><span><strong>{item.name}</strong><small>{item.skuCode} · {item.issueCount} 个问题</small></span><em className={item.blocking ? styles.blocking : ""}>{item.blocking ? "阻断" : item.severity}</em></button></li>)}</ul> : <CatalogEmpty title="当前没有修复任务" detail="修复队列为空；请到商品审计页查看整体状态。" />}</section>
    <section className={styles.card} aria-label="修复字段编辑">{selected ? <><div className={styles.cardHeader}><div><h2>{selected.skuCode}</h2><p>{selected.recommendedAction}</p></div></div><ul className={styles.issueList}>{selected.missingFields.map((field) => <li key={field.field}><strong>{field.label}</strong><span>{field.action}</span></li>)}</ul><div className={styles.formGrid}><label><span>库存</span><input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} placeholder="不修改则留空" /></label><label><span>供应商</span><input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="不修改则留空" /></label><label><span>交期（天）</span><input type="number" min="0" value={leadTimeDays} onChange={(event) => setLeadTimeDays(event.target.value)} placeholder="不修改则留空" /></label></div><div className={styles.formActions}><button type="button" className={styles.primaryButton} data-action-id="catalog-repair-save-request" aria-label="准备修复所选商品" disabled={Boolean(busy)} onClick={() => setPendingConfirmation(true)}><Wrench size={16} aria-hidden="true" />提交修复</button></div></> : <CatalogEmpty title="请选择待修复商品" detail="一次只修改一个 SKU，避免批量误操作。" />}</section></div>
    {pendingConfirmation && selected ? <CatalogConfirmation title="确认修复这个 SKU？" detail={`将通过批量更新接口只修改 ${selected.skuCode}。该接口没有操作员或 expected identity 字段；本页不会伪造身份绑定。`} confirmLabel="确认修复" confirmActionId="catalog-repair-save-confirm" cancelActionId="catalog-repair-save-cancel" busy={busy === "repair"} onCancel={() => setPendingConfirmation(false)} onConfirm={() => void repairSelected()} /> : null}
  </section>;
}
