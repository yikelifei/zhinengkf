"use client";

import { ClipboardCheck, CreditCard, FilePlus2, RefreshCw, Send } from "lucide-react";
import Link from "next/link";
import { identityExpectation, type IdentityFilters, type PaymentEvent } from "../../lib/api";
import { DesignCommerceJourney } from "../design/design-commerce-journey";
import { quoteIdentityHref, quoteNextAction, quoteOrderReadiness, quoteStatusLabel } from "./sales-commerce-state";
import {
  hasCompleteIdentity,
  identityLabel,
  money,
  SalesEmpty,
  SalesHeader,
  SalesNotice,
  textOrDash,
} from "./sales-ui";
import { SalesDesignVisualSummary } from "./sales-design-visual-summary";
import styles from "./sales-pages.module.css";
import { useSalesQuotes } from "./use-sales-records";

export function SalesQuoteDetailPage({ quoteId, initialIdentityFilters = {} }: { quoteId: string; initialIdentityFilters?: IdentityFilters }) {
  const { selected, loading, loaded, error, refresh } = useSalesQuotes(quoteId, initialIdentityFilters);
  const expected = selected ? identityExpectation(selected) : {};
  const identityReady = hasCompleteIdentity(expected);
  const orderReadiness = selected ? quoteOrderReadiness(selected) : null;
  const nextAction = selected ? quoteNextAction(selected) : null;
  const dataFresh = !error;

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
      {loading && !loaded ? <SalesEmpty title="正在读取报价" detail={`报价 ${quoteId}`} busy /> : selected ? (
        <>
        <DesignCommerceJourney
          active="quote"
          title="报价到订单"
          recommendation={nextAction?.recommendation || "先核对报价状态。"}
          blockedReason={nextAction?.blockedReason}
        />
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div><h2>{selected.customer?.name || selected.customerId}</h2><p>报价 {selected.id}</p></div>
            <span className={styles.statusPill}>{quoteStatusLabel(selected.status)}</span>
          </div>
          {identityReady ? (
            <SalesNotice tone="success">身份已绑定：{identityLabel(expected)}。</SalesNotice>
          ) : (
            <SalesNotice tone="danger">身份不完整：{identityLabel(expected)}。所有操作页都会保持禁用。</SalesNotice>
          )}
          <SalesDesignVisualSummary record={selected} />
          <dl className={styles.factGrid}>
            <div><dt>数量</dt><dd>{selected.quantity}</dd></div>
            <div><dt>单价</dt><dd>{money(selected.unitPrice)}</dd></div>
            <div><dt>总价</dt><dd>{money(selected.totalPrice)}</dd></div>
            <div><dt>利润</dt><dd>{money(selected.profit)}</dd></div>
            <div><dt>付款状态</dt><dd>{selected.paymentStatus}</dd></div>
            <div><dt>负责人</dt><dd>{selected.owner || "未分配"}</dd></div>
          </dl>
          <QuotePaymentLedger events={selected.paymentEvents || []} />
          {selected.customerNotes ? <div className={styles.notesBlock}><strong>客户备注</strong><p>{selected.customerNotes}</p></div> : null}
          <div className={styles.actionChoiceGrid} aria-label="报价后续操作">
            {!dataFresh ? <div className={styles.actionChoice} aria-disabled="true" data-action-id="sales-quote-next-action-stale"><RefreshCw size={20} aria-hidden="true" /><strong>请先刷新报价</strong><span>报价刷新失败，已暂停审核、发送、付款和创建订单入口。</span></div> : <>
            {nextAction?.action === "review" ? <Link className={styles.actionChoice} href={quoteIdentityHref(`/reviews/quotes/${encodeURIComponent(selected.id)}`, selected)} data-action-id="sales-quote-open-review">
              <ClipboardCheck size={20} aria-hidden="true" /><strong>进入报价审核</strong><span>核对金额、利润、选图和客户身份后再决定发送。</span>
            </Link> : null}
            {nextAction?.action === "order" && orderReadiness?.ok ? <Link className={styles.actionChoice} href={quoteIdentityHref(`/sales/quotes/${encodeURIComponent(selected.id)}/create-order`, selected)} data-action-id="sales-quote-open-create-order">
              <FilePlus2 size={20} aria-hidden="true" /><strong>创建订单草稿</strong><span>只创建订单，不发送客户消息。</span>
            </Link> : null}
            {nextAction?.action === "blocked" ? <div className={styles.actionChoice} aria-disabled="true" data-action-id="sales-quote-next-action-blocked">
              <FilePlus2 size={20} aria-hidden="true" /><strong>当前无法推进</strong><span>{nextAction.blockedReason}</span>
            </div> : null}
            {nextAction?.action === "payment" ? <Link className={styles.actionChoice} href={quoteIdentityHref(`/sales/quotes/${encodeURIComponent(selected.id)}/verify-payment`, selected)} data-action-id="sales-quote-open-verify-payment">
              <CreditCard size={20} aria-hidden="true" /><strong>核验付款</strong><span>记录定金或全款，并按规则推进订单。</span>
            </Link> : null}
            {nextAction?.action === "send" ? <Link className={styles.actionChoice} href={quoteIdentityHref(`/sales/quotes/${encodeURIComponent(selected.id)}/send`, selected)} data-action-id="sales-quote-open-send">
              <Send size={20} aria-hidden="true" /><strong>发送报价</strong><span>核对身份后加入微信安全发送队列。</span>
            </Link> : null}
            {nextAction?.action === "wait_delivery" ? <div className={styles.actionChoice} aria-disabled="true" data-action-id="sales-quote-wait-delivery"><Send size={20} aria-hidden="true" /><strong>等待送达与客户确认</strong><span>已存在发送任务，当前不重复入队。</span></div> : null}
            {nextAction?.action === "restart" && selected.designJob?.conversationId ? <Link className={styles.actionChoice} href={quoteIdentityHref(`/conversations/${encodeURIComponent(selected.designJob.conversationId)}`, selected)} data-action-id="sales-quote-return-conversation"><FilePlus2 size={20} aria-hidden="true" /><strong>回到客户会话</strong><span>报价已终止，重新确认客户需求。</span></Link> : null}
            </>}
          </div>
          <Link className={styles.backLink} href={quoteIdentityHref("/sales/quotes", selected)} data-action-id="sales-quote-back-list">返回当前客户报价</Link>
        </article>
        </>
      ) : <SalesEmpty title={loaded ? "没有找到报价" : "报价状态未确认"} detail={loaded ? "读取成功，请返回列表重新选择。" : "报价列表尚未成功读取，已阻止后续操作。"} />}
    </section>
  );
}

function QuotePaymentLedger({ events }: { events: PaymentEvent[] }) {
  return (
    <section className={styles.auditSection} aria-labelledby="sales-quote-payment-ledger-title">
      <div className={styles.auditHeader}>
        <div>
          <h3 id="sales-quote-payment-ledger-title">付款事件流水</h3>
          <p>来自服务端付款核验记录，报价页只读展示，便于财务和运营追溯。</p>
        </div>
        <span className={styles.statusPill}>{events.length} 条</span>
      </div>
      {events.length ? (
        <div className={styles.auditList} aria-label="报价付款事件流水">
          {events.map((event) => <QuotePaymentEventRow event={event} key={event.id} />)}
        </div>
      ) : (
        <p className={styles.auditEmpty}>还没有付款核验事件；请从本页进入付款核验后再查看流水。</p>
      )}
    </section>
  );
}

function QuotePaymentEventRow({ event }: { event: PaymentEvent }) {
  return (
    <div className={styles.auditRow} data-payment-event-id={event.id}>
      <strong>{paymentStatusLabel(event.paymentStatus)} / {paymentAmount(event.amountCny)}</strong>
      <span className={styles.paymentLedgerFields}>
        <span data-payment-field="method">方式：{textOrDash(event.method)}</span>
        <span data-payment-field="proof">凭证：{textOrDash(event.proofReference)}</span>
        <span data-payment-field="reviewer">核验人：{textOrDash(event.reviewer)}</span>
        <span data-payment-field="createdAt">核验时间：{textOrDash(event.createdAt)}</span>
      </span>
    </div>
  );
}

function paymentStatusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    unpaid: "未付款",
    deposit_paid: "已付定金",
    paid: "已付全款",
  };
  return labels[String(value || "")] || textOrDash(value);
}

function paymentAmount(value?: number | string | null) {
  const amount = typeof value === "string" ? Number(value) : value;
  return typeof amount === "number" && Number.isFinite(amount) ? money(amount) : "金额未记录";
}
