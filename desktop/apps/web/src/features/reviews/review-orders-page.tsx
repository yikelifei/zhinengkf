"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { identityExpectation, reviewOrder, type OrderDraft } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { formatReviewDate, formatReviewMoney, trustedReviewer, useReviewCenter, type ReviewMutationPageProps } from "./review-page-shared";

type OrderDecision = "approve_confirmation" | "approve_followup" | "request_followup" | "reject_order";
type FollowupType = "production" | "delivery";

type PendingOrderReview = {
  orderId: string;
  decision: OrderDecision;
  followupType?: FollowupType;
};

const decisions: Array<{ id: OrderDecision; label: string; danger?: boolean }> = [
  { id: "approve_confirmation", label: "批准确认消息" },
  { id: "approve_followup", label: "批准跟进" },
  { id: "request_followup", label: "要求人工跟进" },
  { id: "reject_order", label: "驳回订单", danger: true },
];

export function ReviewOrdersPage({ identityFilters, reviewer, reviewId }: ReviewMutationPageProps & { reviewId: string }) {
  const { center, busy, error, setError, refresh } = useReviewCenter(identityFilters);
  const [actionBusy, setActionBusy] = useState(false);
  const [note, setNote] = useState("");
  const [followupType, setFollowupType] = useState<FollowupType | "">("");
  const [notice, setNotice] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingOrderReview | null>(null);
  const operator = trustedReviewer(reviewer);
  const activeOrder = center?.orderDrafts.find((order) => order.id === reviewId) || null;

  const requestReview = (order: OrderDraft, decision: OrderDecision) => {
    setError("");
    setNotice("");
    if (!operator) {
      setError("当前页面未绑定可信操作人，订单审核写操作已禁用。");
      return;
    }
    if (!note.trim()) {
      setError("请填写审核说明后再进入确认步骤。");
      return;
    }
    if (decision === "approve_followup" && !followupType) {
      setError("批准跟进前必须明确选择生产跟进或交付跟进。");
      return;
    }
    setPendingConfirmation({
      orderId: order.id,
      decision,
      followupType: decision === "approve_followup" ? followupType || undefined : undefined,
    });
  };

  const confirmReview = useCallback(async () => {
    if (!pendingConfirmation || !center || !operator) return;
    const order = center.orderDrafts.find((item) => item.id === pendingConfirmation.orderId);
    if (!order) {
      setError("订单已经不在当前审核队列，请刷新后重新确认。");
      setPendingConfirmation(null);
      return;
    }
    if (pendingConfirmation.decision === "approve_followup" && !pendingConfirmation.followupType) {
      setError("跟进类型缺失，订单审核已阻止。");
      setPendingConfirmation(null);
      return;
    }
    setActionBusy(true);
    setError("");
    setNotice("");
    try {
      await reviewOrder(order.id, {
        decision: pendingConfirmation.decision,
        reviewer: operator,
        note: note.trim(),
        followupType: pendingConfirmation.followupType,
        ...identityExpectation(order),
      });
      setNotice(`订单 ${order.id} 已提交“${orderDecisionLabel(pendingConfirmation.decision)}”审核。`);
      setPendingConfirmation(null);
      setNote("");
      setFollowupType("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "订单审核失败，服务端未确认结果。");
    } finally {
      setActionBusy(false);
    }
  }, [center, note, operator, pendingConfirmation, refresh, setError]);

  const disabled = busy || actionBusy;

  return (
    <section className={styles.page} aria-labelledby="review-orders-title" aria-busy={disabled}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Reviews</span>
          <h1 id="review-orders-title">订单审核</h1>
          <p className={styles.description}>本页只处理一项订单审核决策；可能产生发送任务的操作必须二次确认。</p>
        </div>
        <Link className={styles.button} href="/reviews/orders">返回订单队列</Link>
      </header>

      {!operator ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert">未连接可信操作人，本页保持只读。审核人必须由宿主身份系统传入。</div> : null}
      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">{notice}</div> : null}

      <section className={styles.panel} aria-labelledby="order-review-note-title">
        <header className={styles.panelHeader}><div><h2 id="order-review-note-title">本次审核说明</h2><p>当前操作人：{operator || "未绑定"}</p></div></header>
        <div className={styles.panelBody}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>跟进类型</span>
              <select className={styles.select} value={followupType} onChange={(event) => setFollowupType(event.target.value as FollowupType | "")} disabled={!operator || disabled}>
                <option value="">批准跟进时必须选择</option>
                <option value="production">生产跟进</option>
                <option value="delivery">交付跟进</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.wideField}`}>
              <span>审核说明</span>
              <textarea className={styles.textarea} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录订单确认或跟进判断依据" disabled={!operator || disabled} />
            </label>
          </div>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="order-review-list-title">
        <header className={styles.panelHeader}><div><h2 id="order-review-list-title">当前订单</h2><p>订单 ID：{reviewId}</p></div></header>
        <div className={styles.panelBody}>
          {activeOrder ? (
            <div className={styles.recordList}>
              {[activeOrder].map((order) => (
                <article className={styles.record} key={order.id}>
                  <div className={styles.recordHeader}><div><h3>{order.customer?.name || order.id}</h3><p>{order.customerNotes || "未填写客户备注。"}</p></div><span className={styles.badge}>{order.status}</span></div>
                  <dl className={styles.definitionList}>
                    <div><dt>订单总额</dt><dd>{formatReviewMoney(order.totalPrice)}</dd></div>
                    <div><dt>利润</dt><dd>{formatReviewMoney(order.profit)}</dd></div>
                    <div><dt>数量</dt><dd>{order.quantity}</dd></div>
                    <div><dt>支付状态</dt><dd>{order.paymentStatus}</dd></div>
                    <div><dt>微信账号</dt><dd>{order.wechatAccountId}</dd></div>
                    <div><dt>更新时间</dt><dd>{formatReviewDate(order.updatedAt)}</dd></div>
                  </dl>
                  <div className={styles.buttonRow}>
                    {decisions.map((decision) => (
                      <button
                        type="button"
                        className={decision.danger ? styles.dangerButton : decision.id.startsWith("approve") ? styles.primaryButton : styles.button}
                        data-action-id={`review-order-${decision.id}-${order.id}`}
                        aria-label={`对订单${order.id}${decision.label}`}
                        onClick={() => requestReview(order, decision.id)}
                        disabled={!operator || disabled || !note.trim() || (decision.id === "approve_followup" && !followupType)}
                        key={decision.id}
                      >
                        {decision.label}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : <div className={styles.empty}>未找到该订单审核对象，请返回队列重新选择。</div>}
        </div>
      </section>

      {pendingConfirmation ? (
          <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="order-review-confirm-title">
          <strong id="order-review-confirm-title">确认订单审核决策</strong>
          <p>操作人“{operator}”将对订单 {pendingConfirmation.orderId} 执行“{orderDecisionLabel(pendingConfirmation.decision)}”{pendingConfirmation.followupType ? `，跟进类型为${followupTypeLabel(pendingConfirmation.followupType)}` : ""}。</p>
          <p>说明：{note.trim()}</p>
          <div className={styles.buttonRow}>
            <button type="button" className={pendingConfirmation.decision === "reject_order" ? styles.dangerButton : styles.primaryButton} data-action-id="review-order-confirm" aria-label="确认订单审核决策" onClick={() => void confirmReview()} disabled={disabled}>确认提交</button>
            <button type="button" className={styles.button} data-action-id="review-order-cancel" aria-label="取消订单审核决策" onClick={() => setPendingConfirmation(null)} disabled={disabled}>取消</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function orderDecisionLabel(decision: OrderDecision) {
  return decisions.find((item) => item.id === decision)?.label || decision;
}

function followupTypeLabel(value: FollowupType) {
  return value === "production" ? "生产跟进" : "交付跟进";
}
