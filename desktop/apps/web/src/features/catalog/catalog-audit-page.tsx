"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SkuCatalogAudit } from "../../lib/api";
import { getSkuCatalogAudit } from "./api";
import styles from "./catalog-pages.module.css";
import { CatalogEmpty, CatalogHeader, CatalogNotice, catalogError } from "./catalog-ui";

export function CatalogAuditPage() {
  const [audit, setAudit] = useState<SkuCatalogAudit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshAudit = useCallback(async () => { setBusy(true); setError(""); try { setAudit(await getSkuCatalogAudit()); } catch (cause) { setAudit(null); setError(catalogError(cause, "商品审计失败")); } finally { setBusy(false); } }, []);
  useEffect(() => { void refreshAudit(); }, [refreshAudit]);
  return <section className={styles.page} aria-label="商品目录审计"><CatalogHeader eyebrow="商品中心" title="商品审计" detail="只读展示目录完整性、图片、库存、利润与组合就绪风险。" actions={<button type="button" data-action-id="catalog-audit-refresh" aria-label="刷新商品审计" disabled={busy} onClick={() => void refreshAudit()}><RefreshCw size={16} aria-hidden="true" />刷新审计</button>} />{error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}{busy ? <CatalogEmpty title="正在执行商品审计" detail="读取实时目录检查结果。" busy /> : audit ? <><section className={styles.metricGrid} aria-label="商品审计指标"><article><span>商品总数</span><strong>{audit.total}</strong></article><article><span>可用商品</span><strong>{audit.readyCount}</strong></article><article><span>阻断错误</span><strong>{audit.errorCount}</strong></article><article><span>图片问题</span><strong>{audit.imageIssueCount ?? audit.missingImageCount}</strong></article><article><span>低库存</span><strong>{audit.lowStockCount}</strong></article><article><span>负利润</span><strong>{audit.negativeMarginCount}</strong></article></section>{audit.commercialReadiness ? <article className={styles.card}><div className={styles.cardHeader}><div><h2>商业就绪度</h2><p>{audit.commercialReadiness.summary}</p></div><span className={styles.statusPill}>{audit.commercialReadiness.score} · {audit.commercialReadiness.level}</span></div><dl className={styles.factGrid}><div><dt>自动组合</dt><dd>{audit.commercialReadiness.canAutoBundle ? "允许" : "阻止"}</dd></div><div><dt>提交设计</dt><dd>{audit.commercialReadiness.canSubmitDesign ? "允许" : "阻止"}</dd></div><div><dt>自动报价</dt><dd>{audit.commercialReadiness.canAutoQuote ? "允许" : "阻止"}</dd></div><div><dt>修复项</dt><dd>{audit.repairQueueCount || 0}</dd></div></dl>{audit.commercialReadiness.blockers.length ? <ul className={styles.issueList}>{audit.commercialReadiness.blockers.map((item) => <li key={item}><strong>阻断</strong><span>{item}</span></li>)}</ul> : null}</article> : null}<article className={styles.card}><div className={styles.cardHeader}><div><h2>问题明细</h2><p>{audit.issues.length} 项</p></div></div>{audit.issues.length ? <ul className={styles.issueList}>{audit.issues.slice(0, 80).map((issue, index) => <li key={`${issue.skuCode}-${issue.code}-${index}`}><strong>{issue.skuCode} · {issue.severity}</strong><span>{issue.message}</span></li>)}</ul> : <CatalogEmpty title="没有目录问题" detail="当前审计未返回问题。" />}</article></> : <CatalogEmpty title="没有审计结果" detail="刷新后查看实时目录状态。" />}</section>;
}
