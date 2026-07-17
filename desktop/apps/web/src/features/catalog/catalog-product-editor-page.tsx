"use client";

import { Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SkuPayload } from "../../lib/api";
import { upsertSku } from "./api";
import styles from "./catalog-pages.module.css";
import { CatalogConfirmation, CatalogEmpty, CatalogHeader, CatalogNotice, catalogError } from "./catalog-ui";
import { useCatalogProducts } from "./use-catalog-records";

const EMPTY_DRAFT: SkuPayload = { skuCode: "", name: "", type: "item", category: "", salePrice: 0, costPrice: 0, stock: 0, sceneTags: [], material: "", supplier: "", leadTimeDays: 0, mainImagePath: "", angleImages: [], matchingRules: {}, replacementSkuCodes: [], isActive: true };

export function CatalogProductEditorPage({ skuCode = "" }: { skuCode?: string }) {
  const { selected, loading, error: loadError, replace } = useCatalogProducts(skuCode);
  const [draft, setDraft] = useState<SkuPayload>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!skuCode) { setDraft(EMPTY_DRAFT); return; }
    if (selected) {
      const { id: _id, ...payload } = selected;
      setDraft({ ...EMPTY_DRAFT, ...payload, sceneTags: payload.sceneTags || [], angleImages: payload.angleImages || [], matchingRules: payload.matchingRules || {}, replacementSkuCodes: payload.replacementSkuCodes || [], isActive: payload.isActive !== false });
    }
  }, [selected, skuCode]);

  function update<K extends keyof SkuPayload>(key: K, value: SkuPayload[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function validate() {
    if (!draft.skuCode.trim() || !draft.name.trim()) return "SKU 编码和商品名称不能为空。";
    if (draft.salePrice < 0 || draft.costPrice < 0 || draft.stock < 0) return "价格和库存不能为负数。";
    return "";
  }

  async function save() {
    const validation = validate();
    if (validation) { setConfirming(false); setError(validation); return; }
    setConfirming(false); setBusy(true); setError(""); setNotice("");
    try {
      const saved = await upsertSku({ ...draft, skuCode: draft.skuCode.trim(), name: draft.name.trim(), category: draft.category?.trim(), supplier: draft.supplier?.trim(), material: draft.material?.trim() });
      replace(saved); setDraft((current) => ({ ...current, ...saved })); setNotice(`商品 ${saved.skuCode} 已保存。`);
    } catch (cause) { setError(catalogError(cause, "商品保存失败")); }
    finally { setBusy(false); }
  }

  if (skuCode && loading) return <section className={styles.page}><CatalogHeader eyebrow="商品中心 · 编辑" title="商品编辑" detail="正在读取要编辑的商品。" /><CatalogEmpty title="正在读取商品" detail={`SKU ${skuCode}`} busy /></section>;

  return (
    <section className={styles.page} aria-label={skuCode ? "编辑商品" : "新建商品"}>
      <CatalogHeader eyebrow="商品中心 · 编辑" title={skuCode ? "编辑商品" : "新建商品"} detail="本页只新增或保存一个 SKU，不执行导入、修复或审计。" />
      {loadError || error ? <CatalogNotice tone="danger">{error || loadError}</CatalogNotice> : null}
      {notice ? <CatalogNotice tone="success">{notice}</CatalogNotice> : null}
      {skuCode && !selected ? <CatalogEmpty title="没有找到商品" detail="返回商品列表重新选择。" /> : (
        <form className={styles.card} onSubmit={(event) => { event.preventDefault(); const validation = validate(); if (validation) { setError(validation); return; } setConfirming(true); }}>
          <div className={styles.cardHeader}><div><h2>{skuCode ? `编辑 ${skuCode}` : "填写新商品资料"}</h2><p>保存会写入商品目录；现有接口不接受操作员身份字段。</p></div></div>
          <div className={styles.formGrid}>
            <label><span>SKU 编码</span><input value={draft.skuCode} onChange={(event) => update("skuCode", event.target.value)} /></label>
            <label><span>商品名称</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
            <label><span>类型</span><select value={draft.type} onChange={(event) => update("type", event.target.value as SkuPayload["type"])}><option value="gift_box">礼盒</option><option value="item">内搭商品</option><option value="accessory">配件</option></select></label>
            <label><span>分类</span><input value={draft.category || ""} onChange={(event) => update("category", event.target.value)} /></label>
            <label><span>售价</span><input type="number" min="0" step="0.01" value={draft.salePrice} onChange={(event) => update("salePrice", Number(event.target.value))} /></label>
            <label><span>成本</span><input type="number" min="0" step="0.01" value={draft.costPrice} onChange={(event) => update("costPrice", Number(event.target.value))} /></label>
            <label><span>库存</span><input type="number" min="0" step="1" value={draft.stock} onChange={(event) => update("stock", Number(event.target.value))} /></label>
            <label><span>供应商</span><input value={draft.supplier || ""} onChange={(event) => update("supplier", event.target.value)} /></label>
            <label><span>交期（天）</span><input type="number" min="0" step="1" value={draft.leadTimeDays || 0} onChange={(event) => update("leadTimeDays", Number(event.target.value))} /></label>
            <label><span>材质</span><input value={draft.material || ""} onChange={(event) => update("material", event.target.value)} /></label>
            <label className={styles.fullField}><span>场景标签（逗号分隔）</span><input value={(draft.sceneTags || []).join(",")} onChange={(event) => update("sceneTags", event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))} /></label>
            <label className={styles.checkboxField}><input type="checkbox" checked={draft.isActive !== false} onChange={(event) => update("isActive", event.target.checked)} /><span>商品启用</span></label>
          </div>
          <div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="catalog-product-editor-save-request" disabled={busy}><Save size={16} aria-hidden="true" />准备保存商品</button></div>
          <Link className={styles.backLink} href={skuCode ? `/catalog/products/${encodeURIComponent(skuCode)}` : "/catalog/products"} data-action-id="catalog-product-editor-back">{skuCode ? "返回商品详情" : "返回商品列表"}</Link>
        </form>
      )}
      {confirming ? <CatalogConfirmation title="确认写入商品目录？" detail={`SKU ${draft.skuCode} 将被新增或更新。现有接口没有 expected identity 参数。`} confirmLabel="确认保存" confirmActionId="catalog-product-editor-save-confirm" cancelActionId="catalog-product-editor-save-cancel" busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void save()} /> : null}
    </section>
  );
}
