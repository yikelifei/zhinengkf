"use client";

import { ClipboardCheck, FileSpreadsheet, PackageSearch, RefreshCw, Tags, Wrench } from "lucide-react";
import Link from "next/link";
import type { SkuCatalogAudit } from "../../lib/api";
import styles from "./catalog-pages.module.css";
import { CatalogEmpty, CatalogHeader, CatalogNotice } from "./catalog-ui";
import { catalogAuditPrimaryAction } from "./catalog-journey-state";
import { useCatalogRepairQueue } from "./use-catalog-records";

export function CatalogAuditPage() {
  const { audit, loading, loaded, stale, error, refresh } = useCatalogRepairQueue();

  return (
    <section className={styles.page} aria-label="商品目录审计">
      <CatalogHeader
        eyebrow="商品中心"
        title="商品审计"
        detail="只读展示目录完整性、图片、库存、利润与组合就绪风险。"
        actions={<button type="button" data-action-id="catalog-audit-refresh" aria-label="刷新商品审计" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新审计</button>}
      />
      {error ? <CatalogNotice tone="danger">{error}</CatalogNotice> : null}
      {stale ? <CatalogNotice tone="warning">当前显示上一次可信审计，仅供核对；刷新成功前不要据此进入新的搭品或报价。</CatalogNotice> : null}
      {loading ? <CatalogEmpty title="正在执行商品审计" detail="读取实时目录检查结果。" busy /> : audit ? <>
        <section className={styles.metricGrid} aria-label="商品审计指标">
          <article><span>商品总数</span><strong>{audit.total}</strong></article>
          <article><span>结构可用</span><strong>{audit.readyCount}</strong></article>
          <article><span>客户回复可用</span><strong>{audit.dataReadiness?.customerReplyEligibleCount ?? "未验收"}</strong></article>
          <article><span>阻断错误</span><strong>{audit.errorCount}</strong></article>
          <article><span>图片问题</span><strong>{audit.imageIssueCount ?? audit.missingImageCount}</strong></article>
          <article><span>低库存</span><strong>{audit.lowStockCount}</strong></article>
          <article><span>负利润</span><strong>{audit.negativeMarginCount}</strong></article>
        </section>
        <CatalogOperationsReadiness audit={audit} stale={stale} />
        {audit.dataReadiness ? <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>真实数据验收</h2><p>{audit.dataReadiness.summary}</p></div><span className={styles.statusPill}>{audit.dataReadiness.level}</span></div>
          <dl className={styles.factGrid}>
            <div><dt>人工导入/维护</dt><dd>{audit.dataReadiness.operatorProvidedCount}</dd></div>
            <div><dt>演示图片 SKU</dt><dd>{audit.dataReadiness.demoImageCount}</dd></div>
            <div><dt>客户回复可用</dt><dd>{audit.dataReadiness.customerReplyEligibleCount}</dd></div>
            <div><dt>未完成验收</dt><dd>{audit.dataReadiness.unverifiedCount}</dd></div>
          </dl>
          {audit.dataReadiness.blockers.length ? <ul className={styles.issueList}>{audit.dataReadiness.blockers.map((item) => <li key={item}><strong>真实数据缺口</strong><span>{item}</span></li>)}</ul> : null}
          <div className={styles.formActions}><Link href="/catalog/import" data-action-id="catalog-audit-import-real-data"><FileSpreadsheet size={16} aria-hidden="true" />导入真实商品</Link></div>
        </article> : null}
        {audit.commercialReadiness ? <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>商业就绪度</h2><p>{audit.commercialReadiness.summary}</p></div><span className={styles.statusPill}>{audit.commercialReadiness.score} · {audit.commercialReadiness.level}</span></div>
          <dl className={styles.factGrid}>
            <div><dt>自动组合</dt><dd>{audit.commercialReadiness.canAutoBundle ? "允许" : "阻止"}</dd></div>
            <div><dt>提交设计</dt><dd>{audit.commercialReadiness.canSubmitDesign ? "允许" : "阻止"}</dd></div>
            <div><dt>自动报价</dt><dd>{audit.commercialReadiness.canAutoQuote ? "允许" : "阻止"}</dd></div>
            <div><dt>修复项</dt><dd>{audit.repairQueueCount || 0}</dd></div>
          </dl>
          {audit.commercialReadiness.blockers.length ? <ul className={styles.issueList}>{audit.commercialReadiness.blockers.map((item) => <li key={item}><strong>阻断</strong><span>{item}</span></li>)}</ul> : null}
        </article> : null}
        <article className={styles.card}>
          <div className={styles.cardHeader}><div><h2>问题明细</h2><p>{audit.issues.length} 项</p></div></div>
          {audit.issues.length ? <ul className={styles.issueList}>{audit.issues.slice(0, 80).map((issue, index) => <li key={`${issue.skuCode}-${issue.code}-${index}`}><strong>{issue.skuCode} · {issue.severity}</strong><span>{issue.message}</span></li>)}</ul> : <CatalogEmpty title="读取成功，没有目录问题" detail="当前审计未返回问题。" />}
        </article>
      </> : loaded ? <CatalogEmpty title="读取成功，但没有审计结果" detail="服务端已完成响应，但未返回审计对象。" /> : <CatalogEmpty title="商品审计状态未确认" detail="商品审计尚未成功读取，不能据此认定没有目录问题。" />}
    </section>
  );
}

export function buildCatalogOperationReadiness(audit: SkuCatalogAudit) {
  const repairCount = audit.repairQueueCount ?? audit.issues.length;
  const blockingRepairCount = audit.blockingRepairCount ?? audit.errorCount;
  const commercial = audit.commercialReadiness;
  const dataReady = audit.dataReadiness?.customerReplyReady !== false;
  const budgetBands = audit.budgetBandCoverage?.filter((band) => band.available).length ?? 0;
  const sceneCount = audit.availableSceneTagCount ?? audit.topSceneTags?.length ?? 0;

  return [
    {
      key: "view",
      label: "查看",
      href: "/catalog/products",
      value: `${audit.total} 个 SKU`,
      detail: audit.total > 0 ? `当前 ${audit.readyCount} 个结构可用，${audit.dataReadiness?.customerReplyEligibleCount ?? audit.readyCount} 个通过客户回复数据验收。` : "商品库为空，报价和设计不能进入自动化。",
      status: audit.total > 0 ? (dataReady ? "ready" : "review") : "blocked",
      icon: "tags",
    },
    {
      key: "import",
      label: "导入",
      href: "/catalog/import",
      value: "预览后写入",
      detail: "导入只在预览审计通过并二次确认后写入，不把示例空数组当真实商品。",
      status: "review",
      icon: "file",
    },
    {
      key: "audit",
      label: "审计",
      href: "/catalog/audit",
      value: `${audit.issueCount} 项问题`,
      detail: audit.issueCount ? `阻断 ${audit.errorCount} 项，需先处理影响报价或出图的问题。` : "当前审计没有返回目录问题。",
      status: audit.errorCount ? "blocked" : audit.warningCount ? "review" : "ready",
      icon: "check",
    },
    {
      key: "repair",
      label: "修复",
      href: "/catalog/repair",
      value: `${repairCount} 个任务`,
      detail: repairCount ? `其中 ${blockingRepairCount} 个会阻断组合、设计或报价。` : "修复队列为空，暂无需要人工补字段的 SKU。",
      status: blockingRepairCount ? "blocked" : repairCount ? "review" : "ready",
      icon: "wrench",
    },
    {
      key: "bundle",
      label: "搭配推荐",
      href: "/catalog/bundles",
      value: `${budgetBands} 个预算带`,
      detail: commercial?.canAutoBundle ? `已覆盖 ${sceneCount} 个场景标签，可进入组合试算。` : "可用礼盒、内搭、库存或预算带不足，组合推荐会阻断。",
      status: commercial?.canAutoBundle ? (dataReady ? "ready" : "review") : "blocked",
      icon: "package",
    },
    {
      key: "quote",
      label: "报价前置",
      href: "/sales/quotes",
      value: commercial?.level ?? "unknown",
      detail: commercial?.canAutoQuote && commercial.canSubmitDesign && dataReady
        ? "目录满足自动报价前置条件；真实下单、付款和发货仍在销售/订单模块确认。"
        : commercial?.canAutoQuote && commercial.canSubmitDesign
          ? "目录结构可运行，但真实商品来源或图片尚未验收，只允许员工测试。"
          : "成本、售价、库存、图片或规格未满足报价前置条件。",
      status: commercial?.canAutoQuote && commercial.canSubmitDesign && dataReady ? "ready" : "blocked",
      icon: "check",
    },
  ] as const;
}

function CatalogOperationsReadiness({ audit, stale = false }: { audit: SkuCatalogAudit; stale?: boolean }) {
  const items = buildCatalogOperationReadiness(audit);
  const primaryAction = catalogAuditPrimaryAction(audit);
  return (
    <section className={styles.operationPanel} aria-labelledby="catalog-operations-title">
      <div className={styles.cardHeader}>
        <div>
          <h2 id="catalog-operations-title">运营验收闭环</h2>
          <p>按真实审计结果串起商品查看、导入、修复、推荐和报价前置，不声明已付款、已发货或已完成订单。</p>
        </div>
      </div>
      {stale ? <CatalogNotice tone="warning">推荐下一步已暂停。请先使用页首“刷新审计”，确认商品真值后再继续。</CatalogNotice> : <>
      <article className={styles.card} aria-label="商品链路唯一推荐下一步">
        <div className={styles.cardHeader}>
          <div><h3>推荐下一步</h3><p>{primaryAction.detail}</p></div>
        </div>
        <div className={styles.formActions}>
          <Link className={styles.primaryLink} href={primaryAction.href} data-action-id={`catalog-audit-primary-${primaryAction.key}`}>{primaryAction.label}</Link>
        </div>
      </article>
      <div className={styles.operationGrid}>
        {items.map((item) => (
          <Link className={styles.operationCard} href={item.href} key={item.key} data-action-id={`catalog-audit-open-${item.key}`}>
            <span className={`${styles.operationIcon} ${styles[`operation-${item.status}`]}`}>{operationIcon(item.icon)}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
            <em className={styles[`operation-${item.status}`]}>{item.value}</em>
          </Link>
        ))}
      </div>
      </>}
    </section>
  );
}

function operationIcon(icon: string) {
  if (icon === "file") return <FileSpreadsheet size={18} aria-hidden="true" />;
  if (icon === "wrench") return <Wrench size={18} aria-hidden="true" />;
  if (icon === "package") return <PackageSearch size={18} aria-hidden="true" />;
  if (icon === "check") return <ClipboardCheck size={18} aria-hidden="true" />;
  return <Tags size={18} aria-hidden="true" />;
}
