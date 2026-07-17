"use client";

import { RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { money, SalesEmpty, SalesHeader, SalesNotice } from "./sales-ui";
import styles from "./sales-pages.module.css";
import { useSalesQuotes } from "./use-sales-records";

export function SalesQuotesPage() {
  const { records, loading, error, ambiguousEmpty, refresh } = useSalesQuotes();
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
      {ambiguousEmpty ? (
        <SalesNotice tone="warning">
          当前客户端把接口失败和真实空列表都返回为空数组；请先检查服务状态再判断是否没有报价。
        </SalesNotice>
      ) : null}
      <article className={styles.card} aria-label="报价查询结果">
        <div className={styles.cardHeader}>
          <div><h2>全部报价</h2><p>选择一条记录进入只读详情。</p></div>
          <span className={styles.countPill}>{visibleQuotes.length}</span>
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
        {loading ? (
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
                    <em>{quote.status} · {quote.paymentStatus}</em>
                  </span>
                  <span className={styles.rowMeta}>{money(quote.totalPrice)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <SalesEmpty
            title={query.trim() ? "没有匹配报价" : "没有可信报价结果"}
            detail={query.trim() ? "清除搜索词后重试。" : "空结果可能是服务失败，请结合上方状态判断。"}
          />
        )}
      </article>
    </section>
  );
}
