"use client";

import { FilePlus2, RefreshCw, Search, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createOrderDraftFromQuote,
  getQuotes,
  identityExpectation,
  queueQuoteSend,
  type QuoteDraft,
} from "../../lib/api";
import {
  hasCompleteIdentity,
  identityLabel,
  money,
  SalesConfirmation,
  SalesEmpty,
  SalesHeader,
  SalesNotice,
  salesError,
} from "./sales-ui";
import styles from "./sales-pages.module.css";
import { resolveSalesSelection } from "./sales-selection";

type QuoteConfirmation = {
  kind: "queue-send" | "create-order";
  quote: QuoteDraft;
};

function replaceQuote(rows: QuoteDraft[], next: QuoteDraft) {
  return rows.map((row) => (row.id === next.id ? next : row));
}

export type SalesQuotesPageProps = {
  initialQuoteId?: string;
};

export function SalesQuotesPage({ initialQuoteId = "" }: SalesQuotesPageProps) {
  const [quotes, setQuotes] = useState<QuoteDraft[]>([]);
  const [selectedId, setSelectedId] = useState(initialQuoteId);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [uncertainEmpty, setUncertainEmpty] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<QuoteConfirmation | null>(null);

  const refreshQuotes = useCallback(async () => {
    setInitializing(true);
    setError("");
    try {
      const rows = await getQuotes();
      setQuotes(rows);
      setUncertainEmpty(rows.length === 0);
      const initialQuoteExists = Boolean(initialQuoteId && rows.some((row) => row.id === initialQuoteId));
      setSelectedId((current) => resolveSalesSelection(rows, current, initialQuoteId));
      if (initialQuoteId && !initialQuoteExists) {
        setError(`未找到报价 ${initialQuoteId}，请返回报价列表重新选择。`);
      }
    } catch (cause) {
      setQuotes([]);
      setSelectedId("");
      setUncertainEmpty(false);
      setError(salesError(cause, "报价读取失败"));
    } finally {
      setInitializing(false);
    }
  }, [initialQuoteId]);

  useEffect(() => {
    void refreshQuotes();
  }, [refreshQuotes]);

  const visibleQuotes = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return quotes;
    return quotes.filter((quote) => [
      quote.id,
      quote.customerId,
      quote.customer?.name,
      quote.status,
      quote.paymentStatus,
      quote.owner,
    ].some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(keyword)));
  }, [query, quotes]);

  const selectedQuote = quotes.find((quote) => quote.id === selectedId) || null;
  const selectedIdentity = selectedQuote ? identityExpectation(selectedQuote) : {};
  const identityReady = hasCompleteIdentity(selectedIdentity);

  async function executeConfirmedAction() {
    const pending = pendingConfirmation;
    if (!pending) return;
    const expected = identityExpectation(pending.quote);
    if (!hasCompleteIdentity(expected)) {
      setError("已拒绝操作：报价缺少微信账号、会话或客户身份，不能安全写入或发送。");
      setPendingConfirmation(null);
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (pending.kind === "queue-send") {
        const result = await queueQuoteSend(pending.quote.id, expected);
        setQuotes((rows) => replaceQuote(rows, result.quote));
        setNotice(`报价 ${pending.quote.id} 已进入微信安全发送队列；队列成功不等于客户已收到。`);
      } else {
        const order = await createOrderDraftFromQuote(pending.quote.id, expected);
        setNotice(`已由报价 ${pending.quote.id} 创建订单草稿 ${order.id}，尚未向客户发送。`);
      }
      setPendingConfirmation(null);
    } catch (cause) {
      setError(salesError(cause, pending.kind === "queue-send" ? "报价入队失败" : "订单草稿创建失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page} aria-label="报价发送">
      <SalesHeader
        eyebrow="销售 · 报价"
        title="报价发送"
        detail="只负责核对报价身份、创建订单草稿和把报价加入发送队列。报价内容编辑应由独立流程承接。"
        actions={(
          <button
            type="button"
            data-action-id="sales-quotes-refresh"
            aria-label="刷新报价列表"
            disabled={initializing || busy}
            onClick={() => void refreshQuotes()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新
          </button>
        )}
      />

      {error ? <SalesNotice tone="danger">{error}</SalesNotice> : null}
      {notice ? <SalesNotice tone="success">{notice}</SalesNotice> : null}
      {uncertainEmpty ? (
        <SalesNotice tone="warning">
          当前客户端把“接口失败”和“真实空列表”都返回为空数组，因此无法确认是否真的没有报价；请先检查服务状态再重试。
        </SalesNotice>
      ) : null}
      {pendingConfirmation ? (
        <SalesConfirmation
          title={pendingConfirmation.kind === "queue-send" ? "确认把报价加入发送队列？" : "确认创建订单草稿？"}
          detail={pendingConfirmation.kind === "queue-send"
            ? `${identityLabel(identityExpectation(pendingConfirmation.quote))}。系统会创建真实微信发送任务，但不会把“已入队”显示成“已送达”。`
            : `${identityLabel(identityExpectation(pendingConfirmation.quote))}。该操作会创建真实订单草稿，不会发送客户消息。`}
          confirmLabel={pendingConfirmation.kind === "queue-send" ? "确认入队" : "确认创建"}
          confirmActionId={`sales-quotes-confirm-${pendingConfirmation.kind}`}
          cancelActionId="sales-quotes-cancel-confirmation"
          busy={busy}
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={() => void executeConfirmedAction()}
        />
      ) : null}

      <div className={styles.masterDetail}>
        <article className={styles.card} aria-label="报价列表">
          <div className={styles.cardHeader}>
            <div>
              <h2>选择报价</h2>
              <p>按客户、状态或报价编号查找。</p>
            </div>
            <span className={styles.countPill}>{visibleQuotes.length}</span>
          </div>
          <label className={styles.searchField}>
            <span><Search size={14} aria-hidden="true" />搜索报价</span>
            <input
              value={query}
              aria-label="搜索报价"
              placeholder="客户、状态或编号"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {initializing ? (
            <SalesEmpty title="正在读取报价" detail="正在连接销售服务。" busy />
          ) : visibleQuotes.length ? (
            <ul className={styles.selectionList}>
              {visibleQuotes.map((quote) => (
                <li key={quote.id}>
                  <button
                    type="button"
                    className={quote.id === selectedId ? styles.selected : undefined}
                    data-action-id={`sales-quotes-select-${quote.id}`}
                    aria-label={`查看报价 ${quote.id}`}
                    aria-pressed={quote.id === selectedId}
                    onClick={() => setSelectedId(quote.id)}
                  >
                    <span>
                      <strong>{quote.customer?.name || quote.customerId}</strong>
                      <small>{quote.id}</small>
                      <em>{quote.status} · {quote.paymentStatus}</em>
                    </span>
                    <span className={styles.rowMeta}>{money(quote.totalPrice)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <SalesEmpty
              title={query.trim() ? "没有匹配报价" : "没有可确认的报价"}
              detail={query.trim() ? "清除搜索词后重试。" : "空结果可能是服务失败，请根据上方状态提示处理。"}
            />
          )}
        </article>

        <article className={styles.card} aria-label="报价操作">
          {selectedQuote ? (
            <>
              <div className={styles.cardHeader}>
                <div>
                  <h2>{selectedQuote.customer?.name || selectedQuote.customerId}</h2>
                  <p>报价 {selectedQuote.id}</p>
                </div>
                <span className={styles.statusPill}>{selectedQuote.status}</span>
              </div>
              {!identityReady ? (
                <SalesNotice tone="danger">
                  身份不完整：{identityLabel(selectedIdentity)}。已禁用所有写入与发送操作。
                </SalesNotice>
              ) : (
                <SalesNotice tone="success">身份已绑定：{identityLabel(selectedIdentity)}。</SalesNotice>
              )}
              <dl className={styles.factGrid}>
                <div><dt>数量</dt><dd>{selectedQuote.quantity}</dd></div>
                <div><dt>单价</dt><dd>{money(selectedQuote.unitPrice)}</dd></div>
                <div><dt>总价</dt><dd>{money(selectedQuote.totalPrice)}</dd></div>
                <div><dt>利润</dt><dd>{money(selectedQuote.profit)}</dd></div>
                <div><dt>付款状态</dt><dd>{selectedQuote.paymentStatus}</dd></div>
                <div><dt>负责人</dt><dd>{selectedQuote.owner || "未分配"}</dd></div>
              </dl>
              {selectedQuote.customerNotes ? (
                <div className={styles.notesBlock}>
                  <strong>客户备注</strong>
                  <p>{selectedQuote.customerNotes}</p>
                </div>
              ) : null}
              <div className={styles.formActions}>
                <button
                  type="button"
                  data-action-id="sales-quotes-create-order"
                  aria-label="由当前报价创建订单草稿"
                  disabled={busy || !identityReady}
                  onClick={() => setPendingConfirmation({ kind: "create-order", quote: selectedQuote })}
                >
                  <FilePlus2 size={16} aria-hidden="true" />
                  创建订单草稿
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  data-action-id="sales-quotes-queue-send"
                  aria-label="把当前报价加入微信发送队列"
                  disabled={busy || !identityReady}
                  onClick={() => setPendingConfirmation({ kind: "queue-send", quote: selectedQuote })}
                >
                  <Send size={16} aria-hidden="true" />
                  加入发送队列
                </button>
              </div>
            </>
          ) : (
            <SalesEmpty title="先选择一条报价" detail="这里仅呈现当前报价的身份、金额和两个明确的后续动作。" />
          )}
        </article>
      </div>
    </section>
  );
}
