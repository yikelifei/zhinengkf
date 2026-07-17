"use client";

import { Edit3, Plus, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Sku, SkuPayload } from "../../lib/api";
import { getVerifiedSkus, upsertSku } from "./api";
import styles from "./catalog-pages.module.css";
import { CatalogConfirmation, CatalogEmpty, CatalogHeader, CatalogNotice, catalogError, money } from "./catalog-ui";

const emptyDraft: SkuPayload = { skuCode: "", name: "", type: "item", category: "", salePrice: 0, costPrice: 0, stock: 0, sceneTags: [], material: "", supplier: "", leadTimeDays: 0, mainImagePath: "", angleImages: [], matchingRules: {}, replacementSkuCodes: [], isActive: true };

export function CatalogProductsPage() {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [draft, setDraft] = useState<SkuPayload>(emptyDraft);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<"" | "refresh" | "save">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const filtered = useMemo(() => { const term = search.trim().toLocaleLowerCase("zh-CN"); return term ? skus.filter((sku) => `${sku.skuCode} ${sku.name} ${sku.category || ""}`.toLocaleLowerCase("zh-CN").includes(term)) : skus; }, [search, skus]);

  const refreshProducts = useCallback(async () => {
    setBusy("refresh"); setError(""); setNotice("");
    try { setSkus(await getVerifiedSkus(true)); }
    catch (cause) { setSkus([]); setError(catalogError(cause, "商品读取失败")); }
    finally { setBusy(""); }
  }, []);
  useEffect(() => { void refreshProducts(); }, [refreshProducts]);

  function editSku(sku: Sku) { const { id: _id, ...payload } = sku; setDraft({ ...emptyDraft, ...payload, sceneTags: payload.sceneTags || [], angleImages: payload.angleImages || [], matchingRules: payload.matchingRules || {}, replacementSkuCodes: payload.replacementSkuCodes || [], isActive: payload.isActive !== false }); setError(""); setNotice(""); }
  function update<K extends keyof SkuPayload>(key: K, value: SkuPayload[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  async function saveProduct() {
    setPendingConfirmation(false); setBusy("save"); setError(""); setNotice("");
    try { const saved = await upsertSku({ ...draft, skuCode: draft.skuCode.trim(), name: draft.name.trim(), category: draft.category?.trim(), supplier: draft.supplier?.trim(), material: draft.material?.trim() }); setSkus((current) => { const exists = current.some((sku) => sku.skuCode === saved.skuCode); return exists ? current.map((sku) => sku.skuCode === saved.skuCode ? saved : sku) : [saved, ...current]; }); editSku(saved); setNotice(`商品 ${saved.skuCode} 已保存。`); }
    catch (cause) { setError(catalogError(cause, "商品保存失败")); }
    finally { setBusy(""); }
  }

  return <section className={styles.page} aria-label="商品资料维护">
    <CatalogHeader eyebrow="商品中心" title="商品资料" detail="只负责新增、查找和编辑单个 SKU 的基础资料。" actions={<><button type="button" data-action-id="catalog-products-new" aria-label="新建商品" disabled={Boolean(busy)} onClick={() => setDraft(emptyDraft)}><Plus size={16} aria-hidden="true" />新建</button><button type="button" data-action-id="catalog-products-refresh" aria-label="刷新商品资料" disabled={Boolean(busy)} onClick={() => void refreshProducts()}><RefreshCw size={16} aria-hidden="true" />刷新</button></>} />
    {error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}{notice ? <CatalogNotice tone="success">{notice}</CatalogNotice> : null}
    <div className={styles.masterDetail}><section className={styles.card} aria-label="商品列表"><div className={styles.cardHeader}><div><h2>商品列表</h2><p>{filtered.length} / {skus.length}</p></div></div><label className={styles.searchField}><span>搜索 SKU 或名称</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>{busy === "refresh" ? <CatalogEmpty title="正在读取商品" detail="已知内置降级商品会被拒绝。" busy /> : filtered.length ? <ul className={styles.selectionList}>{filtered.map((sku) => <li key={sku.id}><button type="button" data-action-id={`catalog-products-edit-${sku.skuCode}`} aria-label={`编辑商品 ${sku.skuCode}`} onClick={() => editSku(sku)}><span><strong>{sku.name}</strong><small>{sku.skuCode} · {sku.category || "未分类"}</small></span><span className={styles.rowMeta}><em>{money(sku.salePrice)}</em><Edit3 size={14} aria-hidden="true" /></span></button></li>)}</ul> : <CatalogEmpty title="没有可信商品记录" detail="商品接口失败时不会展示内置降级商品。" />}</section>
    <form className={styles.card} onSubmit={(event) => { event.preventDefault(); if (!draft.skuCode.trim() || !draft.name.trim()) { setError("SKU 编码和商品名称不能为空。"); return; } if (draft.salePrice < 0 || draft.costPrice < 0 || draft.stock < 0) { setError("价格和库存不能为负数。"); return; } setPendingConfirmation(true); }}><div className={styles.cardHeader}><div><h2>商品编辑</h2><p>保存会写入商品目录；现有接口不接受操作员身份字段。</p></div></div><div className={styles.formGrid}><label><span>SKU 编码</span><input value={draft.skuCode} onChange={(event) => update("skuCode", event.target.value)} /></label><label><span>商品名称</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} /></label><label><span>类型</span><select value={draft.type} onChange={(event) => update("type", event.target.value as SkuPayload["type"])}><option value="gift_box">礼盒</option><option value="item">内搭商品</option><option value="accessory">配件</option></select></label><label><span>分类</span><input value={draft.category || ""} onChange={(event) => update("category", event.target.value)} /></label><label><span>售价</span><input type="number" min="0" step="0.01" value={draft.salePrice} onChange={(event) => update("salePrice", Number(event.target.value))} /></label><label><span>成本</span><input type="number" min="0" step="0.01" value={draft.costPrice} onChange={(event) => update("costPrice", Number(event.target.value))} /></label><label><span>库存</span><input type="number" min="0" step="1" value={draft.stock} onChange={(event) => update("stock", Number(event.target.value))} /></label><label><span>供应商</span><input value={draft.supplier || ""} onChange={(event) => update("supplier", event.target.value)} /></label><label><span>交期（天）</span><input type="number" min="0" step="1" value={draft.leadTimeDays || 0} onChange={(event) => update("leadTimeDays", Number(event.target.value))} /></label><label><span>材质</span><input value={draft.material || ""} onChange={(event) => update("material", event.target.value)} /></label><label className={styles.fullField}><span>场景标签（逗号分隔）</span><input value={(draft.sceneTags || []).join(",")} onChange={(event) => update("sceneTags", event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))} /></label><label className={styles.checkboxField}><input type="checkbox" checked={draft.isActive !== false} onChange={(event) => update("isActive", event.target.checked)} /><span>商品启用</span></label></div><div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="catalog-products-save-request" aria-label="准备保存商品" disabled={Boolean(busy)}><Save size={16} aria-hidden="true" />保存商品</button></div></form></div>
    {pendingConfirmation ? <CatalogConfirmation title="确认写入商品目录？" detail={`SKU ${draft.skuCode} 将被新增或更新。该接口没有 expected identity 参数，无法在前端补充客户身份绑定。`} confirmLabel="确认保存" confirmActionId="catalog-products-save-confirm" cancelActionId="catalog-products-save-cancel" busy={busy === "save"} onCancel={() => setPendingConfirmation(false)} onConfirm={() => void saveProduct()} /> : null}
  </section>;
}
