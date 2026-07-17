"use client";

import { FilePlus2, RefreshCw, Send } from "lucide-react";
import Link from "next/link";
import { identityExpectation } from "../../lib/api";
import {
  hasCompleteIdentity,
  identityLabel,
  money,
  SalesEmpty,
  SalesHeader,
  SalesNotice,
} from "./sales-ui";
import styles from "./sales-pages.module.css";
import { useSalesQuotes } from "./use-sales-records";

export function SalesQuoteDetailPage({ quoteId }: { quoteId: string }) {
  const { selected, loading, error, ambiguousEmpty, refresh } = useSalesQuotes(quoteId);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = hasCompleteIdentity(expected);

  return (
    <section className={styles.page} aria-label="报价详情">
      <SalesHeader
        eyebrow="销售 · 报价详情"
        title="核对报价"
        detail="本页只读展示一条报价；真实写入和发送必须进入对应的独立操作页。"
        actions={(
          <button type="button" data-action-id="sales-quote-detail-refresh" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={16} aria-hidden="true" />刷新详情
          </button>
        )}
      />
      {error ? <SalesNotice tone="danger">{error}</SalesNotice> : null}
      {ambiguousEmpty ? <SalesNotice tone="warning">空结果无法证明报价不存在；请检查服务状态后重试。</SalesNotice> : null}
      {loading ? <SalesEmpty title="正在读取报价" detail={`报价 ${quoteId}`} busy /> : selected ? (
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div><h2>{selected.customer?.name || selected.customerId}</h2><p>报价 {selected.id}</p></div>
            <span className={styles.statusPill}>{selected.status}</span>
          </div>
          {identityReady ? (
            <SalesNotice tone="success">身份已绑定：{identityLabel(expected)}。</SalesNotice>
          ) : (
            <SalesNotice tone="danger">身份不完整：{identityLabel(expected)}。所有操作页都会保持禁用。</SalesNotice>
          )}
          <dl className={styles.factGrid}>
            <div><dt>数量</dt><dd>{selected.quantity}</dd></div>
            <div><dt>单价</dt><dd>{money(selected.unitPrice)}</dd></div>
            <div><dt>总价</dt><dd>{money(selected.totalPrice)}</dd></div>
            <div><dt>利润</dt><dd>{money(selected.profit)}</dd></div>
            <div><dt>付款状态</dt><dd>{selected.paymentStatus}</dd></div>
            <div><dt>负责人</dt><dd>{selected.owner || "未分配"}</dd></div>
          </dl>
          {selected.customerNotes ? <div className={styles.notesBlock}><strong>客户备注</strong><p>{selected.customerNotes}</p></div> : null}
          <div className={styles.actionChoiceGrid} aria-label="报价后续操作">
            <Link className={styles.actionChoice} href={`/sales/quotes/${encodeURIComponent(selected.id)}/create-order`} data-action-id="sales-quote-open-create-order">
              <FilePlus2 size={20} aria-hidden="true" /><strong>创建订单草稿</strong><span>只创建订单，不发送客户消息。</span>
            </Link>
            <Link className={styles.actionChoice} href={`/sales/quotes/${encodeURIComponent(selected.id)}/send`} data-action-id="sales-quote-open-send">
              <Send size={20} aria-hidden="true" /><strong>发送报价</strong><span>核对身份后加入微信安全发送队列。</span>
            </Link>
          </div>
          <Link className={styles.backLink} href="/sales/quotes" data-action-id="sales-quote-back-list">返回报价列表</Link>
        </article>
      ) : <SalesEmpty title="没有找到报价" detail="返回列表重新选择，避免对错误记录执行操作。" />}
    </section>
  );
}
