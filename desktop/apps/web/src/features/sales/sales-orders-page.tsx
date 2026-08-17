"use client";

import { RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { IdentityFilters } from "../../lib/api";
import { SalesRecordVisualStrip } from "./sales-design-visual-summary";
import { orderJourneyRecommendation, orderStatusLabel } from "./sales-commerce-state";
import { fulfillmentStatusLabel, money, SalesEmpty, SalesHeader, SalesNotice } from "./sales-ui";
import styles from "./sales-pages.module.css";
import { useSalesOrders } from "./use-sales-records";

export function SalesOrdersPage({ identityFilters = {} }: { identityFilters?: IdentityFilters }) {
  const { records, loading, loaded, error, refresh } = useSalesOrders("", identityFilters);
  const [query, setQuery] = useState("");
  const visibleOrders = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return records;
    return records.filter((order) => [
      order.id,
      order.customerId,
      order.customer?.name,
      order.status,
      order.paymentStatus,
      order.productionStatus,
      fulfillmentStatusLabel(order.productionStatus),
      order.carrier,
      order.trackingNo,
      order.owner,
    ].some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(keyword)));
  }, [query, records]);

  return (
    <section className={styles.page} aria-label="订单列表">
      <SalesHeader
        eyebrow="销售 · 订单"
        title="订单列表"
        detail="本页只负责查找和打开订单；编辑字段与客户跟进在订单详情后的独立页面处理。"
        actions={(
          <button
            type="button"
            data-action-id="sales-orders-refresh"
            aria-label="刷新订单列表"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新列表
          </button>
        )}
      />
      {error ? <SalesNotice tone="danger">{error}</SalesNotice> : null}
      <article className={styles.card} aria-label="订单查询结果">
        <div className={styles.cardHeader}>
          <div><h2>全部订单</h2><p>选择一条记录进入只读详情。</p></div>
          <span className={styles.countPill}>{loaded ? visibleOrders.length : "—"}</span>
        </div>
        <label className={styles.searchField}>
          <span><Search size={14} aria-hidden="true" />搜索订单</span>
          <input
            type="search"
            value={query}
            aria-label="搜索订单"
            placeholder="客户、状态或订单编号"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {loading && !loaded ? (
          <SalesEmpty title="正在读取订单" detail="正在连接销售服务。" busy />
        ) : visibleOrders.length ? (
          <ul className={styles.selectionList}>
            {visibleOrders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/sales/orders/${encodeURIComponent(order.id)}`}
                  data-action-id={`sales-orders-open-${order.id}`}
                  aria-label={`查看订单 ${order.id}`}
                >
                  <span>
                    <strong>{order.customer?.name || order.customerId}</strong>
                    <small>{order.id}</small>
                    <SalesRecordVisualStrip record={order} />
                    <em>{orderStatusLabel(order.status)} · {order.paymentStatus} · {fulfillmentStatusLabel(order.productionStatus)}</em>
                    <small>下一步：{orderJourneyRecommendation(order)}</small>
                  </span>
                  <span className={styles.rowMeta}>{money(order.totalPrice)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <SalesEmpty
            title={!loaded ? "订单状态未确认" : query.trim() ? "没有匹配订单" : "当前没有订单"}
            detail={!loaded ? "订单列表尚未成功读取，请刷新后再试。" : query.trim() ? "读取成功，请清除或更换搜索词。" : "读取成功，当前没有订单记录。"}
          />
        )}
      </article>
    </section>
  );
}
