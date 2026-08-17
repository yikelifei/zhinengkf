"use client";

import { PackageSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BundleRecommendation, IdentityFilters, Sku } from "../../lib/api";
import { recommendBundle } from "./api";
import { CatalogBundleDesignHandoff } from "./catalog-bundle-design-handoff";
import { CatalogBundleImageSelector } from "./catalog-bundle-image-selector";
import { validateCatalogBundleBudget } from "./catalog-journey-state";
import styles from "./catalog-pages.module.css";
import { CatalogEmpty, CatalogHeader, CatalogNotice, CatalogProductImage, catalogError, catalogSkuImageSummary, money } from "./catalog-ui";
import { useCatalogProducts } from "./use-catalog-records";

export type BundleDraft = {
  scene: string;
  quantity: string;
  perUnitAmount: string;
  totalAmount: string;
  maxItems: string;
  selectedSkuCodes: string[];
};

type BundleResultState =
  | { status: "idle" }
  | { status: "loading"; intentKey: string }
  | { status: "success"; intentKey: string; result: BundleRecommendation }
  | { status: "error"; intentKey: string; message: string; attempted: boolean };

const IDLE_BUNDLE_RESULT: BundleResultState = { status: "idle" };

export function CatalogBundlesPage({ initialIdentityFilters = {} }: { initialIdentityFilters?: IdentityFilters } = {}) {
  const [scene, setScene] = useState("");
  const [quantity, setQuantity] = useState("50");
  const [perUnitAmount, setPerUnitAmount] = useState("200");
  const [totalAmount, setTotalAmount] = useState("10000");
  const [maxItems, setMaxItems] = useState("6");
  const [selectedSkuCodes, setSelectedSkuCodes] = useState<string[]>([]);
  const [resultState, setResultState] = useState<BundleResultState>(IDLE_BUNDLE_RESULT);
  const { records: catalogRecords, loading: catalogLoading, loaded: catalogLoaded, error: catalogLoadError, refresh: refreshCatalog } = useCatalogProducts();
  const requestSequence = useRef(0);
  const currentIntentKey = bundleIntentFingerprint({ scene, quantity, perUnitAmount, totalAmount, maxItems, selectedSkuCodes });
  const currentIntentKeyRef = useRef(currentIntentKey);
  currentIntentKeyRef.current = currentIntentKey;
  const visibleResultState = resultState.status === "idle" || resultState.intentKey === currentIntentKey ? resultState : IDLE_BUNDLE_RESULT;
  const skuByCode = useMemo(() => new Map(catalogRecords.map((sku) => [sku.skuCode, sku])), [catalogRecords]);
  const busy = visibleResultState.status === "loading";
  const visibleError = visibleResultState.status === "error" ? visibleResultState.message : "";

  useEffect(() => () => { requestSequence.current += 1; }, []);

  function changeDraft(setter: (value: string) => void, value: string) {
    requestSequence.current += 1;
    setter(value);
    setResultState(IDLE_BUNDLE_RESULT);
  }

  function toggleSelectedSku(skuCode: string) {
    requestSequence.current += 1;
    setSelectedSkuCodes((current) => current.includes(skuCode)
      ? current.filter((code) => code !== skuCode)
      : [...current, skuCode]);
    setResultState(IDLE_BUNDLE_RESULT);
  }

  async function calculate() {
    const intentKey = currentIntentKey;
    const validation = validateCatalogBundleBudget({ scene, quantity, perUnitAmount, totalAmount, maxItems });
    if (!validation.ok) {
      setResultState({
        status: "error",
        intentKey,
        message: validation.message,
        attempted: false,
      });
      return;
    }

    const sequence = ++requestSequence.current;
    const request = {
      scene: scene.trim(),
      budget: {
        mode: "per_box" as const,
        quantity: validation.quantity,
        perUnitAmount: validation.perUnitAmount,
        totalAmount: validation.totalAmount,
      },
      maxItems: validation.maxItems,
      selectedSkuCodes,
      requireImages: true,
    };
    setResultState({ status: "loading", intentKey });
    try {
      const result = await recommendBundle(request);
      if (sequence !== requestSequence.current || currentIntentKeyRef.current !== intentKey) return;
      setResultState({ status: "success", intentKey, result });
    } catch (cause) {
      if (sequence !== requestSequence.current || currentIntentKeyRef.current !== intentKey) return;
      setResultState({
        status: "error",
        intentKey,
        message: catalogError(cause, "组合推荐失败"),
        attempted: true,
      });
    }
  }

  return (
    <section className={styles.page} aria-label="礼盒组合推荐">
      <CatalogHeader eyebrow="商品中心" title="组合推荐" detail="根据场景、数量、预算和商品库 SKU 计算搭配；结果和人工草案都必须回显商品图片，便于审核真实搭配。" />
      {visibleError ? <CatalogNotice tone="danger">{visibleError}</CatalogNotice> : null}
      {catalogLoadError ? <CatalogNotice tone="warning">商品库图片候选读取失败：{catalogLoadError}</CatalogNotice> : null}
      <div className={styles.twoColumn}>
        <section className={styles.card}>
          <div className={styles.cardHeader}><div><h2>推荐条件</h2><p>推荐 API 只用于当前计算，不自动创建任务、报价或订单。</p></div></div>
          <div className={styles.formGrid}>
            <label><span>场景</span><input value={scene} disabled={busy} onChange={(event) => changeDraft(setScene, event.target.value)} placeholder="员工福利 / 客户拜访" /></label>
            <label><span>数量</span><input type="number" min="1" value={quantity} disabled={busy} onChange={(event) => changeDraft(setQuantity, event.target.value)} /></label>
            <label><span>单份预算</span><input type="number" min="0.01" step="0.01" value={perUnitAmount} disabled={busy} onChange={(event) => changeDraft(setPerUnitAmount, event.target.value)} /></label>
            <label><span>总预算（数量 × 单份预算）</span><input type="number" min="0.01" step="0.01" value={totalAmount} disabled={busy} onChange={(event) => changeDraft(setTotalAmount, event.target.value)} /></label>
            <label><span>最多商品数</span><input type="number" min="1" max="20" value={maxItems} disabled={busy} onChange={(event) => changeDraft(setMaxItems, event.target.value)} /></label>
          </div>
          <div className={styles.formActions}><button type="button" className={styles.primaryButton} data-action-id="catalog-bundles-recommend" aria-label="计算礼盒组合推荐" disabled={busy} onClick={() => void calculate()}><PackageSearch size={16} aria-hidden="true" />{busy ? "计算中" : "计算推荐"}</button></div>
        </section>
        <section className={styles.card} aria-label="礼盒组合结果" aria-busy={busy || undefined}>
          {visibleResultState.status === "success" ? <BundleResult result={visibleResultState.result} skuByCode={skuByCode} />
            : visibleResultState.status === "loading" ? <CatalogEmpty title="正在计算组合" detail="结果只绑定到当前场景、数量和预算。" busy />
              : visibleResultState.status === "error" ? <CatalogEmpty title={visibleResultState.attempted ? "组合推荐失败" : "推荐条件未通过"} detail={visibleResultState.attempted ? "本次请求未得到可用组合；请检查错误后重试。" : "修正条件后重新计算。"} />
                : <CatalogEmpty title="尚未计算组合" detail="计算结果不会自动创建任务、报价或订单。" />}
        </section>
      </div>
      <CatalogBundleImageSelector
        records={catalogRecords}
        loading={catalogLoading}
        loaded={catalogLoaded}
        selectedSkuCodes={selectedSkuCodes}
        onToggleSku={toggleSelectedSku}
        onRefresh={refreshCatalog}
      />
      <CatalogBundleDesignHandoff
        intentKey={currentIntentKey}
        draft={{ scene, quantity, perUnitAmount, totalAmount, maxItems, selectedSkuCodes }}
        result={visibleResultState.status === "success" ? visibleResultState.result : null}
        initialIdentityFilters={initialIdentityFilters}
      />
    </section>
  );
}

function BundleResult({ result, skuByCode }: { result: BundleRecommendation; skuByCode: Map<string, Sku> }) {
  return (
    <>
      <div className={styles.cardHeader}><div><h2>推荐结果</h2><p>{result.status} / {result.items.length} 个商品</p></div></div>
      <dl className={styles.factGrid}>
        <div><dt>组合售价</dt><dd>{money(result.totals.salePrice)}</dd></div>
        <div><dt>组合成本</dt><dd>{money(result.totals.cost)}</dd></div>
        <div><dt>利润</dt><dd>{money(result.totals.profit)}</dd></div>
        <div><dt>利润率</dt><dd>{(result.totals.profitRate * 100).toFixed(1)}%</dd></div>
      </dl>
      <ul className={styles.bundleImageList}>
        {result.items.map((item, index) => {
          const skuCode = String(item.skuCode || "");
          const catalogSku = skuCode ? skuByCode.get(skuCode) : null;
          const imageSource = catalogSku || item;
          const imageSummary = catalogSkuImageSummary(imageSource);
          return (
            <li key={`${skuCode || "item"}-${index}`}>
              <CatalogProductImage sku={imageSource} label={String(item.name || catalogSku?.name || item.type || `商品 ${index + 1}`)} />
              <div className={styles.bundleItemBody}>
                <strong>{skuCode || String(item.type || `商品 ${index + 1}`)}</strong>
                <span>{String(item.name || catalogSku?.name || item.type || "未命名商品")}</span>
                <small data-image-status={imageSummary.status}>{formatBundleItemType(String(item.type || catalogSku?.type || ""))} / {money(Number(item.salePrice ?? catalogSku?.salePrice ?? 0))} / {imageSummary.label}</small>
              </div>
            </li>
          );
        })}
      </ul>
      {result.warnings.length ? <CatalogNotice tone="warning">{result.warnings.join("；")}</CatalogNotice> : null}
      {result.automation && !result.automation.ready ? <CatalogNotice tone="warning">自动化未就绪：{result.automation.blockers.join("；")}</CatalogNotice> : null}
    </>
  );
}

function formatBundleItemType(type: string) {
  if (type === "gift_box") return "礼盒";
  if (type === "item") return "内搭商品";
  if (type === "accessory") return "配件";
  return type || "商品";
}

export function bundleIntentFingerprint(draft: BundleDraft) {
  return JSON.stringify([
    draft.scene.trim(),
    draft.quantity.trim(),
    draft.perUnitAmount.trim(),
    draft.totalAmount.trim(),
    draft.maxItems.trim(),
    [...draft.selectedSkuCodes].sort(),
  ]);
}
