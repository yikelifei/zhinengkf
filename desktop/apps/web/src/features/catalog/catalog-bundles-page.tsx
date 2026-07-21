"use client";

import { PackageSearch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BundleRecommendation } from "../../lib/api";
import { recommendBundle } from "./api";
import styles from "./catalog-pages.module.css";
import { CatalogEmpty, CatalogHeader, CatalogNotice, catalogError, money } from "./catalog-ui";

type BundleDraft = {
  scene: string;
  quantity: string;
  perUnitAmount: string;
  totalAmount: string;
  maxItems: string;
};

type BundleResultState =
  | { status: "idle" }
  | { status: "loading"; intentKey: string }
  | { status: "success"; intentKey: string; result: BundleRecommendation }
  | { status: "error"; intentKey: string; message: string; attempted: boolean };

const IDLE_BUNDLE_RESULT: BundleResultState = { status: "idle" };

export function CatalogBundlesPage() {
  const [scene, setScene] = useState("");
  const [quantity, setQuantity] = useState("50");
  const [perUnitAmount, setPerUnitAmount] = useState("200");
  const [totalAmount, setTotalAmount] = useState("10000");
  const [maxItems, setMaxItems] = useState("6");
  const [resultState, setResultState] = useState<BundleResultState>(IDLE_BUNDLE_RESULT);
  const requestSequence = useRef(0);
  const currentIntentKey = bundleIntentFingerprint({ scene, quantity, perUnitAmount, totalAmount, maxItems });
  const currentIntentKeyRef = useRef(currentIntentKey);
  currentIntentKeyRef.current = currentIntentKey;
  const visibleResultState = resultState.status === "idle" || resultState.intentKey === currentIntentKey
    ? resultState
    : IDLE_BUNDLE_RESULT;
  const busy = visibleResultState.status === "loading";
  const visibleError = visibleResultState.status === "error" ? visibleResultState.message : "";

  useEffect(() => () => { requestSequence.current += 1; }, []);

  function changeDraft(setter: (value: string) => void, value: string) {
    requestSequence.current += 1;
    setter(value);
    setResultState(IDLE_BUNDLE_RESULT);
  }

  async function calculate() {
    const intentKey = currentIntentKey;
    const qty = Number(quantity);
    const unit = Number(perUnitAmount);
    const total = Number(totalAmount);
    const limit = Number(maxItems);
    if (
      !scene.trim()
      || !Number.isFinite(qty) || qty <= 0
      || !Number.isFinite(unit) || unit <= 0
      || !Number.isFinite(total) || total <= 0
      || !Number.isFinite(limit) || limit <= 0
    ) {
      setResultState({
        status: "error",
        intentKey,
        message: "请填写场景，并使用大于 0 的数量、预算和商品数。",
        attempted: false,
      });
      return;
    }

    const sequence = ++requestSequence.current;
    const request = {
      scene: scene.trim(),
      budget: {
        mode: "per_box" as const,
        quantity: qty,
        perUnitAmount: unit,
        totalAmount: total,
      },
      maxItems: limit,
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
      <CatalogHeader eyebrow="商品中心" title="组合推荐" detail="只根据场景、数量与预算计算一次商品组合，不创建设计任务或报价。" />
      {visibleError ? <CatalogNotice tone="danger">{visibleError}</CatalogNotice> : null}
      <div className={styles.twoColumn}>
        <section className={styles.card}>
          <div className={styles.cardHeader}><div><h2>推荐条件</h2><p>所有输入都只用于当前计算。</p></div></div>
          <div className={styles.formGrid}>
            <label><span>场景</span><input value={scene} disabled={busy} onChange={(event) => changeDraft(setScene, event.target.value)} placeholder="员工福利 / 客户拜访" /></label>
            <label><span>数量</span><input type="number" min="1" value={quantity} disabled={busy} onChange={(event) => changeDraft(setQuantity, event.target.value)} /></label>
            <label><span>单份预算</span><input type="number" min="0.01" step="0.01" value={perUnitAmount} disabled={busy} onChange={(event) => changeDraft(setPerUnitAmount, event.target.value)} /></label>
            <label><span>总预算</span><input type="number" min="0.01" step="0.01" value={totalAmount} disabled={busy} onChange={(event) => changeDraft(setTotalAmount, event.target.value)} /></label>
            <label><span>最多商品数</span><input type="number" min="1" max="20" value={maxItems} disabled={busy} onChange={(event) => changeDraft(setMaxItems, event.target.value)} /></label>
          </div>
          <div className={styles.formActions}><button type="button" className={styles.primaryButton} data-action-id="catalog-bundles-recommend" aria-label="计算礼盒组合推荐" disabled={busy} onClick={() => void calculate()}><PackageSearch size={16} aria-hidden="true" />{busy ? "计算中" : "计算推荐"}</button></div>
        </section>
        <section className={styles.card} aria-label="礼盒组合结果" aria-busy={busy || undefined}>
          {visibleResultState.status === "success" ? <BundleResult result={visibleResultState.result} />
            : visibleResultState.status === "loading" ? <CatalogEmpty title="正在计算组合" detail="结果只会绑定到当前场景、数量和预算。" busy />
              : visibleResultState.status === "error" ? <CatalogEmpty title={visibleResultState.attempted ? "组合推荐失败" : "推荐条件未通过"} detail={visibleResultState.attempted ? "本次请求未得到可用组合；请检查错误后重试。" : "修正条件后重新计算。"} />
                : <CatalogEmpty title="尚未计算组合" detail="计算结果不会自动创建任务、报价或订单。" />}
        </section>
      </div>
    </section>
  );
}

function BundleResult({ result }: { result: BundleRecommendation }) {
  return (
    <>
      <div className={styles.cardHeader}><div><h2>推荐结果</h2><p>{result.status} · {result.items.length} 个商品</p></div></div>
      <dl className={styles.factGrid}>
        <div><dt>组合售价</dt><dd>{money(result.totals.salePrice)}</dd></div>
        <div><dt>组合成本</dt><dd>{money(result.totals.cost)}</dd></div>
        <div><dt>利润</dt><dd>{money(result.totals.profit)}</dd></div>
        <div><dt>利润率</dt><dd>{(result.totals.profitRate * 100).toFixed(1)}%</dd></div>
      </dl>
      <ul className={styles.previewList}>{result.items.map((item, index) => <li key={`${String(item.skuCode || "item")}-${index}`}><strong>{String(item.skuCode || item.type || `商品 ${index + 1}`)}</strong><span>{String(item.name || item.type || "未命名商品")}</span></li>)}</ul>
      {result.warnings.length ? <CatalogNotice tone="warning">{result.warnings.join("；")}</CatalogNotice> : null}
      {result.automation && !result.automation.ready ? <CatalogNotice tone="warning">自动化未就绪：{result.automation.blockers.join("；")}</CatalogNotice> : null}
    </>
  );
}

export function bundleIntentFingerprint(draft: BundleDraft) {
  return JSON.stringify([
    draft.scene.trim(),
    draft.quantity.trim(),
    draft.perUnitAmount.trim(),
    draft.totalAmount.trim(),
    draft.maxItems.trim(),
  ]);
}
