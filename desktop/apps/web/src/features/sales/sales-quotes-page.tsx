"use client";

import { RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { IdentityFilters } from "../../lib/api";
import { SalesRecordVisualStrip } from "./sales-design-visual-summary";
import { quoteJourneyRecommendation, quoteStatusLabel } from "./sales-commerce-state";
import { money, SalesEmpty, SalesHeader, SalesNotice } from "./sales-ui";
import styles from "./sales-pages.module.css";
import { useSalesQuotes } from "./use-sales-records";

export function SalesQuotesPage({ identityFilters = {} }: { identityFilters?: IdentityFilters }) {
  const { records, loading, loaded, error, refresh } = useSalesQuotes("", identityFilters);
  const [query, setQuery] = useState("");
  const visibleQuotes = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return records;
    return records.filter((quote) => [
      quote.id,
      quote.customerId,
      quote.customer?.name,
      quote.status,
      quote.paymentStatus,
      quote.owner,
    ].some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(keyword)));
  }, [query, records]);

  return (
    <section className={styles.page} aria-label="报价列表">
      <SalesHeader
        eyebrow="销售 · 报价"
        title="报价列表"
        detail="本页只负责查找和打开报价；发送与创建订单草稿在独立操作页完成。"
        actions={(
          <button
            type="button"
            data-action-id="sales-quotes-refresh"
            aria-label="刷新报价列表"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新列表
          </button>
        )}
      />
      {error ? <SalesNotice tone="danger">{error}</SalesNotice> : null}
      <article className={styles.card} aria-label="报价查询结果">
        <div className={styles.cardHeader}>
          <div><h2>全部报价</h2><p>选择一条记录进入只读详情。</p></div>
          <span className={styles.countPill}>{loaded ? visibleQuotes.length : "—"}</span>
        </div>
        <label className={styles.searchField}>
          <span><Search size={14} aria-hidden="true" />搜索报价</span>
          <input
            type="search"
            value={query}
            aria-label="搜索报价"
            placeholder="客户、状态或报价编号"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {loading && !loaded ? (
          <SalesEmpty title="正在读取报价" detail="正在连接销售服务。" busy />
        ) : visibleQuotes.length ? (
          <ul className={styles.selectionList}>
            {visibleQuotes.map((quote) => (
              <li key={quote.id}>
                <Link
                  href={`/sales/quotes/${encodeURIComponent(quote.id)}`}
                  data-action-id={`sales-quotes-open-${quote.id}`}
                  aria-label={`查看报价 ${quote.id}`}
                >
                  <span>
                    <strong>{quote.customer?.name || quote.customerId}</strong>
                    <small>{quote.id}</small>
                    <SalesRecordVisualStrip record={quote} />
                    <em>{quoteStatusLabel(quote.status)} · {quote.paymentStatus}</em>
                    <small>下一步：{quoteJourneyRecommendation(quote)}</small>
                  </span>
                  <span className={styles.rowMeta}>{money(quote.totalPrice)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <SalesEmpty
            title={!loaded ? "报价状态未确认" : query.trim() ? "没有匹配报价" : "当前没有报价"}
            detail={!loaded ? "报价列表尚未成功读取，请刷新后再试。" : query.trim() ? "读取成功，请清除或更换搜索词。" : "读取成功，当前没有报价记录。"}
          />
        )}
      </article>
    </section>
  );
}
