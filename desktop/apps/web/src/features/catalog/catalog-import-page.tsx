"use client";

import { Download, FileSearch, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SkuImportResult } from "../../lib/api";
import { bulkUpsertSkus, downloadSkuImportTemplate, previewSkuImportFile, previewSkuImportText } from "./api";
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
  const [savedCount, setSavedCount] = useState(0);
  const previewSequence = useRef(0);

  useEffect(() => () => { previewSequence.current += 1; }, []);

  function invalidatePreview() {
    previewSequence.current += 1;
    setPreview(null);
    setPendingConfirmation(false);
    setBusy("");
    setSavedCount(0);
  }

  async function previewImport() {
    if (mode === "text" && !text.trim()) { setError("请先粘贴 CSV 或表格文本。"); return; }
    if (mode === "file" && !file) { setError("请先选择 CSV 或 XLSX 文件。"); return; }
    const sequence = ++previewSequence.current;
    setBusy("preview"); setError(""); setNotice(""); setPreview(null); setPendingConfirmation(false);
    try {
      const result = mode === "text"
        ? await previewSkuImportText(text)
        : await previewSkuImportFile(file!.name, await fileBase64(file!));
      if (sequence !== previewSequence.current) return;
      setPreview(result);
      if (!result.ok) setError("预览存在阻断错误，不能写入商品目录。");
      else setNotice(`预览完成：可导入 ${result.rows.length} 行，跳过 ${result.skippedCount} 行。`);
    } catch (cause) {
      if (sequence === previewSequence.current) setError(catalogError(cause, "导入预览失败"));
    } finally {
      if (sequence === previewSequence.current) setBusy("");
    }
  }

  async function saveImport() {
    if (!preview?.ok || !preview.rows.length) return;
    setPendingConfirmation(false); setBusy("save"); setError(""); setNotice("");
    try {
      const result = await bulkUpsertSkus(preview.rows);
      setNotice(`已写入 ${result.count} 个待审商品。下一步请运行商品审计，未通过审计前不要进入搭品或报价。`);
      setSavedCount(result.count);
      setPreview(null);
    } catch (cause) {
      setError(catalogError(cause, "批量写入失败"));
    } finally {
      setBusy("");
    }
  }

  async function downloadTemplate() {
    setBusy("preview"); setError(""); setNotice("");
    try {
      const template = await downloadSkuImportTemplate("xlsx");
      const bytes = Uint8Array.from(atob(template.dataBase64), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: template.mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = template.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("商品导入模板已下载。请填写真实 SKU、价格、库存、供应商、交期和图片后再上传预览。");
    } catch (cause) {
      setError(catalogError(cause, "商品导入模板下载失败"));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.page} aria-label="商品导入">
      <CatalogHeader
        eyebrow="商品中心"
        title="商品导入"
        detail="只负责预览真实 SKU 文本或文件，并在人工确认后批量写入；不会伪造付款、发货或真实供应商上线状态。"
      />
      {error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}
      {notice ? <CatalogNotice tone="success">{notice}</CatalogNotice> : null}
      {savedCount > 0 ? (
        <div className={styles.formActions} aria-label="商品导入推荐下一步">
          <Link className={styles.primaryLink} href="/catalog/audit" data-action-id="catalog-import-open-audit">运行商品审计</Link>
        </div>
      ) : null}

      <div className={styles.twoColumn}>
        <section className={styles.card} aria-label="导入来源">
          <div className={styles.segmented} role="group" aria-label="商品导入来源">
            <button type="button" className={mode === "text" ? styles.active : ""} data-action-id="catalog-import-mode-text" aria-pressed={mode === "text"} disabled={Boolean(busy)} onClick={() => { setMode("text"); invalidatePreview(); }}>粘贴文本</button>
            <button type="button" className={mode === "file" ? styles.active : ""} data-action-id="catalog-import-mode-file" aria-pressed={mode === "file"} disabled={Boolean(busy)} onClick={() => { setMode("file"); invalidatePreview(); }}>上传文件</button>
          </div>
          {mode === "text" ? (
            <label className={styles.textField}>
              <span>CSV / 表格文本</span>
              <textarea rows={14} value={text} disabled={Boolean(busy)} onChange={(event) => { setText(event.target.value); invalidatePreview(); }} placeholder="skuCode,name,type,salePrice,costPrice,stock,supplier,leadTimeDays,mainImagePath,sceneTags" />
            </label>
          ) : (
            <label className={styles.fileField}>
              <span>CSV 或 XLSX 文件</span>
              <input type="file" accept=".csv,.xlsx,.xls,text/csv" disabled={Boolean(busy)} onChange={(event) => { setFile(event.target.files?.[0] || null); invalidatePreview(); }} />
            </label>
          )}
          <div className={styles.formActions}>
            <button type="button" data-action-id="catalog-import-download-template" disabled={Boolean(busy)} onClick={() => void downloadTemplate()}>
              <Download size={16} aria-hidden="true" />下载 XLSX 模板
            </button>
            <button type="button" data-action-id="catalog-import-preview" disabled={Boolean(busy)} onClick={() => void previewImport()}>
              <FileSearch size={16} aria-hidden="true" />{busy === "preview" ? "预览中" : "只预览"}
            </button>
          </div>
        </section>

        <section className={styles.card} aria-label="导入预览">
          {preview ? (
            <>
              <div className={styles.cardHeader}>
                <div><h2>预览结果</h2><p>可写入 {preview.rows.length} 行，错误 {preview.errors.length}</p></div>
              </div>
              <SkuImportAcceptance result={preview} />
              {preview.errors.length ? <ul className={styles.issueList}>{preview.errors.map((item, index) => <li key={`${item.line}-${index}`}><strong>第 {item.line} 行</strong><span>{item.message}</span></li>)}</ul> : null}
              <ul className={styles.previewList}>{preview.rows.slice(0, 12).map((row) => <li key={row.skuCode}><strong>{row.skuCode}</strong><span>{row.name} / {row.type}</span></li>)}</ul>
              {preview.rows.length > 12 ? <p className={styles.muted}>仅显示前 12 行，确认时会写入全部 {preview.rows.length} 行。</p> : null}
              <div className={styles.formActions}>
                <button type="button" className={styles.primaryButton} data-action-id="catalog-import-save-request" disabled={Boolean(busy) || !preview.ok || !preview.rows.length} onClick={() => setPendingConfirmation(true)}>
                  <Save size={16} aria-hidden="true" />确认前检查
                </button>
              </div>
            </>
          ) : <CatalogEmpty title="尚未生成导入预览" detail="预览不会写入商品目录；只有二次确认后才会批量保存。" />}
        </section>
      </div>

      {pendingConfirmation && preview ? (
        <CatalogConfirmation
          title="确认批量写入预览中的商品？"
          detail={`将新增或更新 ${preview.rows.length} 个 SKU。写入后仍需在商品审计页检查真实图片、供应商、交期、预算带和可售组合边界。`}
          confirmLabel="确认批量写入"
          confirmActionId="catalog-import-save-confirm"
          cancelActionId="catalog-import-save-cancel"
          busy={busy === "save"}
          onCancel={() => setPendingConfirmation(false)}
          onConfirm={() => void saveImport()}
        />
      ) : null}
    </section>
  );
}

export function buildSkuImportOperationalAcceptance(result: SkuImportResult) {
  const audit = result.audit;
  const commercialReadiness = audit?.commercialReadiness;
  const requiredMissing = result.missingRequiredFields?.length || 0;
  const mappedRequired = (result.fieldMapping || []).filter((field) => field.required && field.matched).length;
  const totalRows = audit?.total ?? result.rows.length;
  const missingImageCount = audit?.missingImageCount ?? 0;
  const invalidImageCount = audit?.invalidImageCount ?? 0;
  const imageReadyCount = Math.max(0, totalRows - missingImageCount - invalidImageCount);
  const blockers = [
    ...(result.errors.length ? ["存在无法解析或无法写入的行"] : []),
    ...(requiredMissing ? ["缺少 SKU 编号、名称或售价等必填列"] : []),
    ...(audit?.errorCount ? ["审计返回阻断错误，不能进入报价或出图前置"] : []),
  ];
  const warnings = [
    ...(audit?.missingImageCount ? ["缺真实主图或多角度图"] : []),
    ...(audit?.lowStockCount ? ["存在低库存 SKU"] : []),
    ...(audit?.leadTimeIssueCount ? ["供应商或交期字段不足"] : []),
    ...(audit?.budgetCoverageIssueCount ? ["预算带覆盖不足"] : []),
    ...(audit?.catalogCoverageIssueCount ? ["商品类型、场景标签或可售组合边界不足"] : []),
  ];
  return {
    rows: result.rows.length,
    mappedRequired,
    requiredMissing,
    blocked: blockers.length > 0,
    blockers,
    warnings,
    readyCount: audit?.readyCount ?? 0,
    issueCount: audit?.issueCount ?? result.errors.length,
    imageReadyCount,
    imageIssueCount: audit?.imageIssueCount ?? (missingImageCount + invalidImageCount),
    imageCoverageLabel: `${imageReadyCount} / ${totalRows}`,
    categoryCoverageLabel: `${audit?.availableCategoryCount ?? 0} 分类 / ${audit?.availableSceneTagCount ?? 0} 场景`,
    bundleReadinessLabel: commercialReadiness?.canAutoBundle ? "可图片搭配" : "待补礼盒或内搭",
    designReadinessLabel: commercialReadiness?.canSubmitDesign ? "可进入设计任务" : "待补图片/规格/组合",
    quoteReadinessLabel: commercialReadiness?.canAutoQuote ? "可自动报价" : "需人工报价复核",
    readinessScore: commercialReadiness?.score ?? null,
    readinessLevel: commercialReadiness?.level ?? "blocked",
    readinessSummary: commercialReadiness?.summary || "预览尚未形成商业化就绪结论；请先补齐 SKU、图片和搭配规则。",
    nextActions: (commercialReadiness?.nextActions || []).slice(0, 4),
  };
}

function SkuImportAcceptance({ result }: { result: SkuImportResult }) {
  const acceptance = buildSkuImportOperationalAcceptance(result);
  return (
    <>
      <dl className={styles.factGrid} aria-label="真实商品导入验收">
        <div><dt>可导入行</dt><dd>{acceptance.rows}</dd></div>
        <div><dt>必填映射</dt><dd>{acceptance.mappedRequired} / {acceptance.mappedRequired + acceptance.requiredMissing}</dd></div>
        <div><dt>审计可用</dt><dd>{acceptance.readyCount}</dd></div>
        <div data-acceptance-id="catalog-import-image-coverage"><dt>真实图片覆盖</dt><dd>{acceptance.imageCoverageLabel}</dd></div>
        <div data-acceptance-id="catalog-import-category-coverage"><dt>分类与场景</dt><dd>{acceptance.categoryCoverageLabel}</dd></div>
        <div data-acceptance-id="catalog-import-bundle-readiness"><dt>图片搭配</dt><dd>{acceptance.bundleReadinessLabel}</dd></div>
        <div data-acceptance-id="catalog-import-design-readiness"><dt>设计出图前置</dt><dd>{acceptance.designReadinessLabel}</dd></div>
        <div data-acceptance-id="catalog-import-quote-readiness"><dt>报价闭环</dt><dd>{acceptance.quoteReadinessLabel}</dd></div>
        <div data-acceptance-id="catalog-import-commercial-score"><dt>商业化评分</dt><dd>{acceptance.readinessScore === null ? "未计算" : `${acceptance.readinessScore} / 100`}</dd></div>
        <div><dt>状态</dt><dd>{acceptance.blocked ? "阻断" : acceptance.warnings.length ? "待补齐" : "可写入"}</dd></div>
        {acceptance.blockers.concat(acceptance.warnings).slice(0, 6).map((item) => <div key={item}><dt>待处理</dt><dd>{item}</dd></div>)}
      </dl>
      <p className={styles.muted} data-acceptance-id="catalog-import-readiness-summary">{acceptance.readinessSummary}</p>
      {acceptance.nextActions.length ? (
        <ul className={styles.issueList} data-acceptance-id="catalog-import-next-actions">
          {acceptance.nextActions.map((item) => <li key={item}><strong>下一步</strong><span>{item}</span></li>)}
        </ul>
      ) : null}
    </>
  );
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}
