"use client";

import { useCallback, useState } from "react";
import { identityExpectation, reviewQuote, type QuoteDraft } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { formatReviewDate, formatReviewMoney, trustedReviewer, useReviewCenter, type ReviewMutationPageProps } from "./review-page-shared";

type QuoteDecision = "approve_quote" | "request_followup" | "reject_quote";

type PendingQuoteReview = {
  quoteId: string;
  decision: QuoteDecision;
};

const decisions: Array<{ id: QuoteDecision; label: string; danger?: boolean }> = [
  { id: "approve_quote", label: "通过报价" },
  { id: "request_followup", label: "要求跟进" },
  { id: "reject_quote", label: "驳回报价", danger: true },
];

export function ReviewQuotesPage({ identityFilters, reviewer }: ReviewMutationPageProps) {
  const { center, busy, error, setError, refresh } = useReviewCenter(identityFilters);
  const [actionBusy, setActionBusy] = useState(false);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingQuoteReview | null>(null);
  const operator = trustedReviewer(reviewer);

  const requestReview = (quote: QuoteDraft, decision: QuoteDecision) => {
    setError("");
    setNotice("");
    if (!operator) {
      setError("当前页面未绑定可信操作人，报价审核写操作已禁用。");
      return;
    }
    if (!note.trim()) {
      setError("请填写审核说明后再进入确认步骤。");
      return;
    }
    setPendingConfirmation({ quoteId: quote.id, decision });
  };

  const confirmReview = useCallback(async () => {
    if (!pendingConfirmation || !center || !operator) return;
    const quote = center.quoteDrafts.find((item) => item.id === pendingConfirmation.quoteId);
    if (!quote) {
      setError("报价已经不在当前审核队列，请刷新后重新确认。");
      setPendingConfirmation(null);
      return;
    }
    setActionBusy(true);
    setError("");
    setNotice("");
    try {
      await reviewQuote(quote.id, {
        decision: pendingConfirmation.decision,
        reviewer: operator,
        note: note.trim(),
        ...identityExpectation(quote),
      });
      setNotice(`报价 ${quote.id} 已提交“${quoteDecisionLabel(pendingConfirmation.decision)}”审核。`);
      setPendingConfirmation(null);
      setNote("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "报价审核失败，服务端未确认结果。");
    } finally {
      setActionBusy(false);
    }
  }, [center, note, operator, pendingConfirmation, refresh, setError]);

  const disabled = busy || actionBusy;

  return (
    <section className={styles.page} aria-labelledby="review-quotes-title" aria-busy={disabled}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Reviews</span>
          <h1 id="review-quotes-title">报价审核</h1>
          <p className={styles.description}>只负责金额、利润与报价跟进决策；所有操作绑定报价身份并二次确认。</p>
        </div>
        <button type="button" className={styles.button} data-action-id="review-quotes-refresh" aria-label="刷新报价审核队列" onClick={() => void refresh()} disabled={disabled}>刷新队列</button>
      </header>

      {!operator ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">未连接可信操作人，本页保持只读。审核人必须由宿主身份系统传入。</div> : null}
      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}

      <section className={styles.panel} aria-labelledby="quote-review-note-title">
        <header className={styles.panelHeader}><div><h2 id="quote-review-note-title">本次审核说明</h2><p>当前操作人：{operator || "未绑定"}</p></div></header>
        <div className={styles.panelBody}><label className={styles.field}><span>审核说明</span><textarea className={styles.textarea} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录金额、利润与跟进判断依据" disabled={!operator || disabled} /></label></div>
      </section>

      <section className={styles.panel} aria-labelledby="quote-review-list-title">
        <header className={styles.panelHeader}><div><h2 id="quote-review-list-title">待审核报价</h2><p>当前返回 {center?.quoteDrafts.length ?? 0} 个报价。</p></div></header>
        <div className={styles.panelBody}>
          {center?.quoteDrafts.length ? (
            <div className={styles.recordList}>
              {center.quoteDrafts.map((quote) => (
                <article className={styles.record} key={quote.id}>
                  <div className={styles.recordHeader}><div><h3>{quote.customer?.name || quote.id}</h3><p>{quote.customerNotes || "未填写客户备注。"}</p></div><span className={styles.badge}>{quote.status}</span></div>
                  <dl className={styles.definitionList}>
                    <div><dt>报价总额</dt><dd>{formatReviewMoney(quote.totalPrice)}</dd></div>
                    <div><dt>利润</dt><dd>{formatReviewMoney(quote.profit)}</dd></div>
                    <div><dt>利润率</dt><dd>{formatPercent(quote.profitRate)}</dd></div>
                    <div><dt>数量</dt><dd>{quote.quantity}</dd></div>
                    <div><dt>支付状态</dt><dd>{quote.paymentStatus}</dd></div>
                    <div><dt>更新时间</dt><dd>{formatReviewDate(quote.updatedAt)}</dd></div>
                  </dl>
                  <div className={styles.buttonRow}>
                    {decisions.map((decision) => (
                      <button
                        type="button"
                        className={decision.danger ? styles.dangerButton : decision.id === "approve_quote" ? styles.primaryButton : styles.button}
                        data-action-id={`review-quote-${decision.id}-${quote.id}`}
                        aria-label={`对报价${quote.id}${decision.label}`}
                        onClick={() => requestReview(quote, decision.id)}
                        disabled={!operator || disabled || !note.trim()}
                        key={decision.id}
                      >
                        {decision.label}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : <div className={styles.empty}>当前没有报价审核待办。</div>}
        </div>
      </section>

      {pendingConfirmation ? (
        <section className={styles.confirmation} role="alertdialog" aria-modal="true" aria-labelledby="quote-review-confirm-title">
          <strong id="quote-review-confirm-title">确认报价审核决策</strong>
          <p>操作人“{operator}”将对报价 {pendingConfirmation.quoteId} 执行“{quoteDecisionLabel(pendingConfirmation.decision)}”。</p>
          <p>说明：{note.trim()}</p>
          <div className={styles.buttonRow}>
            <button type="button" className={pendingConfirmation.decision === "reject_quote" ? styles.dangerButton : styles.primaryButton} data-action-id="review-quote-confirm" aria-label="确认报价审核决策" onClick={() => void confirmReview()} disabled={disabled}>确认提交</button>
            <button type="button" className={styles.button} data-action-id="review-quote-cancel" aria-label="取消报价审核决策" onClick={() => setPendingConfirmation(null)} disabled={disabled}>取消</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function quoteDecisionLabel(decision: QuoteDecision) {
  return decisions.find((item) => item.id === decision)?.label || decision;
}

function formatPercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未知";
  return `${Math.round((value <= 1 ? value * 100 : value) * 10) / 10}%`;
}
