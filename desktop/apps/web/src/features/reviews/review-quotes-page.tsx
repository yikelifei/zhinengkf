"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { getReviewQuote, identityExpectation, isTrustedDesktopSessionError, reviewQuote, type QuoteDraft } from "../../lib/api";
import { completeClientOperation, reserveClientOperation, type PendingClientOperation } from "../../lib/client-operation-key";
import styles from "../governance-pages.module.css";
import {
  formatReviewDate,
  formatReviewMoney,
  trustedReviewer,
  useReviewRecord,
  useTrustedOperator,
  type ReviewMutationPageProps,
} from "./review-page-shared";
import { ReviewHandoffPanel, reviewIdentityHref, reviewQuoteHandoff, type ReviewHandoff } from "./review-handoff";

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

export function ReviewQuotesPage({ identityFilters, reviewer, reviewId }: ReviewMutationPageProps & { reviewId: string }) {
  const { record: activeQuote, loaded, busy, error, sessionBlocked, setError, refresh } = useReviewRecord(getReviewQuote, reviewId, identityFilters);
  const [actionBusy, setActionBusy] = useState(false);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [actionSessionBlocked, setActionSessionBlocked] = useState(false);
  const [handoff, setHandoff] = useState<ReviewHandoff | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingQuoteReview | null>(null);
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);
  const trustedOperator = useTrustedOperator(reviewer);
  const operator = trustedReviewer(reviewer, trustedOperator.status);
  const reviewSessionBlocked = sessionBlocked || trustedOperator.sessionBlocked || actionSessionBlocked;

  const requestReview = (quote: QuoteDraft, decision: QuoteDecision) => {
    setError("");
    setActionSessionBlocked(false);
    setNotice("");
    setHandoff(null);
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
    if (!pendingConfirmation || !activeQuote || !operator) return;
    if (activeQuote.id !== pendingConfirmation.quoteId) {
      setError("地址中的报价已变化，请刷新后重新确认。");
      setPendingConfirmation(null);
      return;
    }
    setActionBusy(true);
    setError("");
    setActionSessionBlocked(false);
    setNotice("");
    setHandoff(null);
    const operationPayload = {
      id: activeQuote.id,
      decision: pendingConfirmation.decision,
      reviewer: operator,
      note: note.trim(),
      identity: identityExpectation(activeQuote),
    };
    const operation = reserveClientOperation("review-action", operationPayload, pendingOperationRef.current);
    pendingOperationRef.current = operation;
    try {
      const response = await reviewQuote(activeQuote.id, {
        operationKey: operation.key,
        decision: pendingConfirmation.decision,
        reviewer: operator,
        note: note.trim(),
        ...identityExpectation(activeQuote),
      });
      pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
      setHandoff(reviewQuoteHandoff(response, activeQuote));
      setNotice(`报价 ${activeQuote.id} 已提交“${quoteDecisionLabel(pendingConfirmation.decision)}”审核。`);
      setPendingConfirmation(null);
      setNote("");
      await refresh();
    } catch (caught) {
      setActionSessionBlocked(isTrustedDesktopSessionError(caught));
      setError(caught instanceof Error ? caught.message : "报价审核失败，服务端未确认结果。");
    } finally {
      setActionBusy(false);
    }
  }, [activeQuote, note, operator, pendingConfirmation, refresh, setError]);

  const disabled = busy || actionBusy || trustedOperator.busy;

  return (
    <section className={styles.page} aria-labelledby="review-quotes-title" aria-busy={disabled}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Reviews</span>
          <h1 id="review-quotes-title">报价审核</h1>
          <p className={styles.description}>本页按地址中的报价 ID 读取单条审核对象，不依赖审核队列截断列表。</p>
        </div>
        <Link className={styles.button} href={reviewIdentityHref("/reviews/quotes", identityFilters)}>返回报价队列</Link>
      </header>

      {reviewSessionBlocked ? (
        <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
          <strong>需要可信桌面会话</strong>
          <p>请从臻希智能客服桌面端窗口打开本页；如果已经在桌面端，请刷新页面或重启客服启动器。</p>
        </div>
      ) : null}
      {!operator && !reviewSessionBlocked ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">未连接可信操作人，本页保持只读。审核人必须由宿主身份系统传入。</div> : null}
      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}
      <ReviewHandoffPanel handoff={handoff} actionIdPrefix="review-quote-handoff" />

      <section className={styles.panel} aria-labelledby="quote-review-note-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="quote-review-note-title">本次审核说明</h2>
            <p>当前操作人：{operator || "未绑定"}</p>
          </div>
        </header>
        <div className={styles.panelBody}>
          <label className={styles.field}>
            <span>审核说明</span>
            <textarea className={styles.textarea} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录金额、利润与跟进判断依据" disabled={!operator || disabled} />
          </label>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="quote-review-record-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="quote-review-record-title">当前报价</h2>
            <p>报价 ID：{reviewId}</p>
          </div>
        </header>
        <div className={styles.panelBody}>
          {activeQuote ? (
            <article className={styles.record}>
              <div className={styles.recordHeader}>
                <div>
                  <h3>{activeQuote.customer?.name || activeQuote.id}</h3>
                  <p>{activeQuote.customerNotes || "未填写客户备注。"}</p>
                </div>
                <span className={styles.badge}>{activeQuote.status}</span>
              </div>
              <dl className={styles.definitionList}>
                <div><dt>报价总额</dt><dd>{formatReviewMoney(activeQuote.totalPrice)}</dd></div>
                <div><dt>利润</dt><dd>{formatReviewMoney(activeQuote.profit)}</dd></div>
                <div><dt>利润率</dt><dd>{formatPercent(activeQuote.profitRate)}</dd></div>
                <div><dt>数量</dt><dd>{activeQuote.quantity}</dd></div>
                <div><dt>支付状态</dt><dd>{activeQuote.paymentStatus}</dd></div>
                <div><dt>更新时间</dt><dd>{formatReviewDate(activeQuote.updatedAt)}</dd></div>
              </dl>
              <div className={styles.buttonRow}>
                {decisions.map((decision) => (
                  <button
                    type="button"
                    className={decision.danger ? styles.dangerButton : decision.id === "approve_quote" ? styles.primaryButton : styles.button}
                    data-action-id={`review-quote-${decision.id}-${activeQuote.id}`}
                    aria-label={`对报价 ${activeQuote.id} ${decision.label}`}
                    onClick={() => requestReview(activeQuote, decision.id)}
                    disabled={!operator || disabled || !note.trim()}
                    key={decision.id}
                  >
                    {decision.label}
                  </button>
                ))}
              </div>
            </article>
          ) : <div className={styles.empty}>{loaded ? "读取成功，未找到该报价审核对象，请返回队列重新选择。" : busy ? "正在读取报价审核对象。" : "报价审核对象尚未成功读取，已阻止审核操作。"}</div>}
        </div>
      </section>

      {pendingConfirmation ? (
        <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="quote-review-confirm-title">
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
