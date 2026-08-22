"use client";

import { RefreshCw, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SkuPayload } from "../../lib/api";
import { uploadAsset } from "../../lib/api";
import { upsertSku } from "./api";
import styles from "./catalog-pages.module.css";
import { CatalogProductImagePreview } from "./catalog-product-image-preview";
import { CatalogConfirmation, CatalogEmpty, CatalogHeader, CatalogNotice, catalogError } from "./catalog-ui";
import { useCatalogProducts } from "./use-catalog-records";

const EMPTY_DRAFT: SkuPayload = { skuCode: "", name: "", type: "item", category: "", salePrice: 0, costPrice: 0, stock: 0, sceneTags: [], dimensions: {}, weightGram: 0, material: "", supplier: "", leadTimeDays: 0, mainImagePath: "", angleImages: [], matchingRules: {}, replacementSkuCodes: [], isActive: false };

export function CatalogProductEditorPage({ skuCode = "" }: { skuCode?: string }) {
  const { selected, loading, loaded, stale, error: loadError, refresh, replace } = useCatalogProducts(skuCode);
  const [draft, setDraft] = useState<SkuPayload>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [mainImageFile, setMainImageFile] = useState<File | null>(null);
  const [angleImageFiles, setAngleImageFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saveSequence = useRef(0);
  const editorIdentity = skuCode || "new-sku";
  const editorIdentityRef = useRef(editorIdentity);
  editorIdentityRef.current = editorIdentity;

  useEffect(() => {
    if (!skuCode) {
      setDraft(EMPTY_DRAFT);
    } else if (selected) {
      const { id: _id, ...payload } = selected;
      setDraft({ ...EMPTY_DRAFT, ...payload, sceneTags: payload.sceneTags || [], angleImages: payload.angleImages || [], matchingRules: payload.matchingRules || {}, replacementSkuCodes: payload.replacementSkuCodes || [], isActive: payload.isActive !== false });
    }
    setMainImageFile(null);
    setAngleImageFiles([]);
    return () => { saveSequence.current += 1; };
  }, [selected, skuCode]);

  function update<K extends keyof SkuPayload>(key: K, value: SkuPayload[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateDimension(key: "lengthCm" | "widthCm" | "heightCm", value: string) {
    setDraft((current) => {
      const dimensions = { ...(current.dimensions || {}) };
      const text = value.trim();
      if (!text) delete dimensions[key];
      else dimensions[key] = Number(text);
      return { ...current, dimensions };
    });
  }

  function validate() {
    if (!draft.skuCode.trim() || !draft.name.trim()) return "SKU 编码和商品名称不能为空。";
    if (draft.salePrice < 0 || draft.costPrice < 0 || draft.stock < 0 || Number(draft.weightGram || 0) < 0) return "售价、成本、库存和重量不能为负数。";
    if (draft.isActive !== false && !(draft.salePrice > 0)) return "启用商品必须填写大于 0 的售价；未定价商品请先保存为停用草稿。";
    for (const value of Object.values(draft.dimensions || {})) {
      if (Number(value || 0) < 0) return "商品尺寸不能为负数。";
    }
    return "";
  }

  const imageReady = Boolean(mainImageFile || angleImageFiles.length || draft.mainImagePath?.trim() || draft.angleImages?.some((item) => item.trim()));

  async function save() {
    if (!loaded || stale) { setConfirming(false); setError("商品库状态尚未确认，请刷新成功后再保存。"); return; }
    const validation = validate();
    if (validation) { setConfirming(false); setError(validation); return; }
    const sequence = ++saveSequence.current;
    const requestIdentity = editorIdentity;
    const requestDraft = {
      ...draft,
      sceneTags: [...(draft.sceneTags || [])],
      angleImages: [...(draft.angleImages || [])],
      replacementSkuCodes: [...(draft.replacementSkuCodes || [])],
      dimensions: { ...(draft.dimensions || {}) },
      matchingRules: { ...(draft.matchingRules || {}) },
    };
    let catalogRecordSaved = false;
    setConfirming(false); setBusy(true); setError(""); setNotice("");
    try {
      let saved = await upsertSku({
        ...requestDraft,
        skuCode: requestDraft.skuCode.trim(),
        name: requestDraft.name.trim(),
        category: requestDraft.category?.trim(),
        supplier: requestDraft.supplier?.trim(),
        material: requestDraft.material?.trim(),
        mainImagePath: requestDraft.mainImagePath?.trim(),
        angleImages: (requestDraft.angleImages || []).map((item) => item.trim()).filter(Boolean),
      });
      catalogRecordSaved = true;
      if (mainImageFile || angleImageFiles.length) {
        const skuCodeValue = requestDraft.skuCode.trim();
        const [mainAsset, angleAssets] = await Promise.all([
          mainImageFile ? uploadSkuImage(mainImageFile, skuCodeValue, "main") : Promise.resolve(null),
          Promise.all(angleImageFiles.map((file, index) => uploadSkuImage(file, skuCodeValue, `angle-${index + 1}`))),
        ]);
        const { id: _savedId, ...savedPayload } = saved;
        saved = await upsertSku({
          ...savedPayload,
          mainImagePath: mainAsset?.localPath || saved.mainImagePath || "",
          angleImages: [
            ...(Array.isArray(saved.angleImages) ? saved.angleImages : []),
            ...angleAssets.map((asset) => asset.localPath),
          ],
        });
      }
      if (sequence !== saveSequence.current || editorIdentityRef.current !== requestIdentity) return;
      replace(saved);
      setDraft((current) => ({ ...current, ...saved }));
      setMainImageFile(null);
      setAngleImageFiles([]);
      setNotice(`商品 ${saved.skuCode} 已保存${mainImageFile || angleImageFiles.length ? "，图片已归档到商品资产" : ""}。`);
    } catch (cause) {
      if (sequence === saveSequence.current && editorIdentityRef.current === requestIdentity) {
        setError(catalogError(cause, catalogRecordSaved ? "商品文字已保存，但图片上传或回写失败；请保留当前页面并重试图片" : "商品保存失败"));
      }
    }
    finally { if (sequence === saveSequence.current && editorIdentityRef.current === requestIdentity) setBusy(false); }
  }

  if (loading) return <section className={styles.page}><CatalogHeader eyebrow="商品中心 · 编辑" title="商品编辑" detail="正在读取商品库真值。" /><CatalogEmpty title="正在读取商品" detail={skuCode ? `SKU ${skuCode}` : "新建前正在检查 SKU 冲突"} busy /></section>;

  return (
    <section className={styles.page} aria-label={skuCode ? "编辑商品" : "新建商品"}>
      <CatalogHeader eyebrow="商品中心 · 编辑" title={skuCode ? "编辑商品" : "新建商品"} detail="本页只新增或保存一个 SKU，不执行导入、修复或审计。" actions={<button type="button" data-action-id="catalog-product-editor-refresh" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新商品真值</button>} />
      {loadError || error ? <CatalogNotice tone="danger">{error || loadError}</CatalogNotice> : null}
      {notice ? <CatalogNotice tone="success">{notice}</CatalogNotice> : null}
      {!imageReady ? <CatalogNotice tone="warning">商品缺少主图或三视图；设计任务只能套用带真实商品图的 SKU。</CatalogNotice> : null}
      {!loaded ? <CatalogEmpty title="商品状态未确认" detail="商品库尚未成功读取，已阻止新增或编辑保存。" /> : stale ? <CatalogEmpty title="商品真值需要刷新" detail="当前只有上一次可信快照；刷新成功前已阻止保存。" /> : skuCode && !selected ? <CatalogEmpty title="没有找到商品" detail="读取成功；请返回商品列表重新选择。" /> : (
        <form className={styles.card} onSubmit={(event) => { event.preventDefault(); const validation = validate(); if (validation) { setError(validation); return; } setConfirming(true); }}>
          <div className={styles.cardHeader}><div><h2>{skuCode ? `编辑 ${skuCode}` : "填写新商品资料"}</h2><p>保存会写入商品目录；现有接口不接受操作员身份字段。</p></div></div>
          <div className={styles.formGrid}>
            <label className={styles.fullField}><span>上传主图 / 正面图</span><input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" disabled={busy} data-action-id="catalog-product-editor-main-image-file" onChange={(event) => { const file = event.target.files?.[0] || null; const validation = validateImageFile(file); if (validation) { setError(validation); event.target.value = ""; return; } setError(""); setMainImageFile(file); }} />{mainImageFile ? <small>待上传：{mainImageFile.name}</small> : <small>支持 PNG、JPG、WEBP，单张不超过 10 MB。</small>}</label>
            <label className={styles.fullField}><span>上传侧面 / 背面图</span><input type="file" multiple accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" disabled={busy} data-action-id="catalog-product-editor-angle-image-files" onChange={(event) => { const files = Array.from(event.target.files || []); const validation = files.map(validateImageFile).find(Boolean) || ""; if (validation) { setError(validation); event.target.value = ""; return; } setError(""); setAngleImageFiles(files); }} />{angleImageFiles.length ? <small>待上传 {angleImageFiles.length} 张：{angleImageFiles.map((file) => file.name).join("、")}</small> : <small>AI 搭品至少需要主图、侧面、背面 3 张真实商品图。</small>}</label>
          </div>
          <CatalogProductImagePreview draft={draft} />
          <div className={styles.formGrid}>
            <label><span>SKU 编码</span><input value={draft.skuCode} disabled={busy} onChange={(event) => update("skuCode", event.target.value)} /></label>
            <label><span>商品名称</span><input value={draft.name} disabled={busy} onChange={(event) => update("name", event.target.value)} /></label>
            <label><span>类型</span><select value={draft.type} disabled={busy} onChange={(event) => update("type", event.target.value as SkuPayload["type"])}><option value="gift_box">礼盒</option><option value="item">内搭商品</option><option value="accessory">配件</option></select></label>
            <label><span>分类</span><input value={draft.category || ""} disabled={busy} onChange={(event) => update("category", event.target.value)} /></label>
            <label><span>售价</span><input type="number" min="0" step="0.01" value={draft.salePrice} disabled={busy} onChange={(event) => update("salePrice", Number(event.target.value))} /></label>
            <label><span>成本</span><input type="number" min="0" step="0.01" value={draft.costPrice} disabled={busy} onChange={(event) => update("costPrice", Number(event.target.value))} /></label>
            <label><span>库存</span><input type="number" min="0" step="1" value={draft.stock} disabled={busy} onChange={(event) => update("stock", Number(event.target.value))} /></label>
            <label><span>长（cm）</span><input type="number" min="0" step="0.1" value={dimensionInputValue(draft.dimensions, "lengthCm")} disabled={busy} onChange={(event) => updateDimension("lengthCm", event.target.value)} /></label>
            <label><span>宽（cm）</span><input type="number" min="0" step="0.1" value={dimensionInputValue(draft.dimensions, "widthCm")} disabled={busy} onChange={(event) => updateDimension("widthCm", event.target.value)} /></label>
            <label><span>高（cm）</span><input type="number" min="0" step="0.1" value={dimensionInputValue(draft.dimensions, "heightCm")} disabled={busy} onChange={(event) => updateDimension("heightCm", event.target.value)} /></label>
            <label><span>重量（g）</span><input type="number" min="0" step="1" value={draft.weightGram || ""} disabled={busy} onChange={(event) => update("weightGram", event.target.value.trim() ? Number(event.target.value) : undefined)} /></label>
            <label><span>供应商</span><input value={draft.supplier || ""} disabled={busy} onChange={(event) => update("supplier", event.target.value)} /></label>
            <label><span>交期（天）</span><input type="number" min="0" step="1" value={draft.leadTimeDays || 0} disabled={busy} onChange={(event) => update("leadTimeDays", Number(event.target.value))} /></label>
            <label><span>材质</span><input value={draft.material || ""} disabled={busy} onChange={(event) => update("material", event.target.value)} /></label>
            <label className={styles.fullField}><span>商品主图路径或 URL</span><input value={draft.mainImagePath || ""} disabled={busy} onChange={(event) => update("mainImagePath", event.target.value)} /></label>
            <label className={styles.fullField}><span>侧面 / 背面图路径或 URL（每行一个）</span><textarea rows={3} value={(draft.angleImages || []).join("\n")} disabled={busy} onChange={(event) => update("angleImages", parseImageList(event.target.value))} /></label>
            <label className={styles.fullField}><span>场景标签（逗号分隔）</span><input value={(draft.sceneTags || []).join(",")} disabled={busy} onChange={(event) => update("sceneTags", event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))} /></label>
            <label className={styles.checkboxField}><input type="checkbox" checked={draft.isActive !== false} disabled={busy} onChange={(event) => update("isActive", event.target.checked)} /><span>商品启用</span></label>
          </div>
          <div className={styles.formActions}><button type="submit" className={styles.primaryButton} data-action-id="catalog-product-editor-save-request" disabled={busy}><Save size={16} aria-hidden="true" />准备保存商品</button></div>
          <Link className={styles.backLink} href={skuCode ? `/catalog/products/${encodeURIComponent(skuCode)}` : "/catalog/products"} data-action-id="catalog-product-editor-back">{skuCode ? "返回商品详情" : "返回商品列表"}</Link>
        </form>
      )}
      {confirming ? <CatalogConfirmation title="确认写入商品目录？" detail={`SKU ${draft.skuCode} 将被新增或更新。现有接口没有 expected identity 参数。`} confirmLabel="确认保存" confirmActionId="catalog-product-editor-save-confirm" cancelActionId="catalog-product-editor-save-cancel" busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void save()} /> : null}
    </section>
  );
}

function parseImageList(value: string) {
  return value.split(/\r?\n|[,，]/).map((item) => item.trim()).filter(Boolean);
}

function dimensionInputValue(dimensions: SkuPayload["dimensions"], key: "lengthCm" | "widthCm" | "heightCm") {
  const value = dimensions?.[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

const MAX_CATALOG_IMAGE_BYTES = 10 * 1024 * 1024;
const CATALOG_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function validateImageFile(file: File | null) {
  if (!file) return "";
  if (!CATALOG_IMAGE_MIME_TYPES.has(file.type)) return `图片 ${file.name} 不是支持的 PNG、JPG 或 WEBP。`;
  if (file.size <= 0 || file.size > MAX_CATALOG_IMAGE_BYTES) return `图片 ${file.name} 必须大于 0 且不超过 10 MB。`;
  return "";
}

async function uploadSkuImage(file: File, skuCode: string, slot: string) {
  return uploadAsset({
    ownerType: "sku",
    ownerId: skuCode,
    role: "sku_image",
    fileName: file.name,
    mimeType: file.type,
    source: `catalog_editor_${slot}`,
    base64: await fileToBase64(file),
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`图片 ${file.name} 读取失败。`));
    reader.onload = () => {
      const value = String(reader.result || "");
      const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : "";
      if (!base64) reject(new Error(`图片 ${file.name} 没有可上传内容。`));
      else resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}
