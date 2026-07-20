"use client";

import { FileSearch, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SkuImportResult } from "../../lib/api";
import { bulkUpsertSkus, previewSkuImportFile, previewSkuImportText } from "./api";
import styles from "./catalog-pages.module.css";
import { CatalogConfirmation, CatalogEmpty, CatalogHeader, CatalogNotice, catalogError } from "./catalog-ui";

export function CatalogImportPage() {
  const [mode, setMode] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SkuImportResult | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "save">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const previewSequence = useRef(0);

  useEffect(() => () => { previewSequence.current += 1; }, []);

  function invalidatePreview() {
    previewSequence.current += 1;
    setPreview(null);
    setPendingConfirmation(false);
    setBusy("");
  }

  async function previewImport() {
    if (mode === "text" && !text.trim()) { setError("请先粘贴 CSV 或表格文本。"); return; }
    if (mode === "file" && !file) { setError("请先选择 CSV 或 XLSX 文件。"); return; }
    const sequence = ++previewSequence.current;
    const requestMode = mode;
    const requestText = text;
    const requestFile = file;
    setBusy("preview"); setError(""); setNotice(""); setPreview(null); setPendingConfirmation(false);
    try {
      let result: SkuImportResult;
      if (requestMode === "text") {
        result = await previewSkuImportText(requestText);
      } else {
        const encoded = await fileBase64(requestFile!);
        if (sequence !== previewSequence.current) return;
        result = await previewSkuImportFile(requestFile!.name, encoded);
      }
      if (sequence !== previewSequence.current) return;
      setPreview(result);
      if (!result.ok) setError("预览存在阻断错误，不能写入商品目录。");
      else setNotice(`预览完成：可导入 ${result.rows.length} 行，跳过 ${result.skippedCount} 行。`);
    }
    catch (cause) { if (sequence === previewSequence.current) setError(catalogError(cause, "导入预览失败")); }
    finally { if (sequence === previewSequence.current) setBusy(""); }
  }
  async function saveImport() {
    if (!preview?.ok || !preview.rows.length) return;
    setPendingConfirmation(false); setBusy("save"); setError(""); setNotice("");
    try { const result = await bulkUpsertSkus(preview.rows); setNotice(`已写入 ${result.count} 个商品。请到商品审计页复核完整性。`); setPreview(null); }
    catch (cause) { setError(catalogError(cause, "批量写入失败")); }
    finally { setBusy(""); }
  }

  return <section className={styles.page} aria-label="商品导入">
    <CatalogHeader eyebrow="商品中心" title="商品导入" detail="只负责预览文本或文件，并在人工确认后批量写入。" />
    {error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}{notice ? <CatalogNotice tone="success">{notice}</CatalogNotice> : null}
    <div className={styles.twoColumn}><section className={styles.card} aria-label="导入来源"><div className={styles.segmented} role="group" aria-label="商品导入来源"><button type="button" className={mode === "text" ? styles.active : ""} data-action-id="catalog-import-mode-text" aria-label="使用文本导入" aria-pressed={mode === "text"} disabled={Boolean(busy)} onClick={() => { setMode("text"); invalidatePreview(); }}>粘贴文本</button><button type="button" className={mode === "file" ? styles.active : ""} data-action-id="catalog-import-mode-file" aria-label="使用文件导入" aria-pressed={mode === "file"} disabled={Boolean(busy)} onClick={() => { setMode("file"); invalidatePreview(); }}>上传文件</button></div>{mode === "text" ? <label className={styles.textField}><span>CSV / 表格文本</span><textarea rows={14} value={text} disabled={Boolean(busy)} onChange={(event) => { setText(event.target.value); invalidatePreview(); }} placeholder="skuCode,name,type,salePrice,costPrice,stock" /></label> : <label className={styles.fileField}><span>CSV 或 XLSX 文件</span><input type="file" accept=".csv,.xlsx,.xls,text/csv" disabled={Boolean(busy)} onChange={(event) => { setFile(event.target.files?.[0] || null); invalidatePreview(); }} /></label>}<div className={styles.formActions}><button type="button" data-action-id="catalog-import-preview" aria-label="预览商品导入" disabled={Boolean(busy)} onClick={() => void previewImport()}><FileSearch size={16} aria-hidden="true" />{busy === "preview" ? "预览中" : "只预览"}</button></div></section>
    <section className={styles.card} aria-label="导入预览">{preview ? <><div className={styles.cardHeader}><div><h2>预览结果</h2><p>可写入 {preview.rows.length} 行 · 错误 {preview.errors.length}</p></div></div>{preview.errors.length ? <ul className={styles.issueList}>{preview.errors.map((item, index) => <li key={`${item.line}-${index}`}><strong>第 {item.line} 行</strong><span>{item.message}</span></li>)}</ul> : null}<ul className={styles.previewList}>{preview.rows.slice(0, 12).map((row) => <li key={row.skuCode}><strong>{row.skuCode}</strong><span>{row.name} · {row.type}</span></li>)}</ul>{preview.rows.length > 12 ? <p className={styles.muted}>仅显示前 12 行，确认时会写入全部 {preview.rows.length} 行。</p> : null}<div className={styles.formActions}><button type="button" className={styles.primaryButton} data-action-id="catalog-import-save-request" aria-label="准备写入预览商品" disabled={Boolean(busy) || !preview.ok || !preview.rows.length} onClick={() => setPendingConfirmation(true)}><Save size={16} aria-hidden="true" />确认前检查</button></div></> : <CatalogEmpty title="尚未生成导入预览" detail="预览不会写入商品目录；只有二次确认后才会批量保存。" />}</section></div>
    {pendingConfirmation && preview ? <CatalogConfirmation title="确认批量写入预览中的商品？" detail={`将新增或更新 ${preview.rows.length} 个 SKU。现有批量接口不接受操作员身份字段，服务端审计取决于既有实现。`} confirmLabel="确认批量写入" confirmActionId="catalog-import-save-confirm" cancelActionId="catalog-import-save-cancel" busy={busy === "save"} onCancel={() => setPendingConfirmation(false)} onConfirm={() => void saveImport()} /> : null}
  </section>;
}

function fileBase64(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("文件读取失败")); reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;]+;base64,/, "")); reader.readAsDataURL(file); }); }
