"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { getReviewOrder, identityExpectation, isTrustedDesktopSessionError, reviewOrder, type OrderDraft } from "../../lib/api";
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
import { ReviewHandoffPanel, reviewIdentityHref, reviewOrderHandoff, type ReviewHandoff } from "./review-handoff";

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
  const { record: activeOrder, loaded, busy, error, sessionBlocked, setError, refresh } = useReviewRecord(getReviewOrder, reviewId, identityFilters);
  const [actionBusy, setActionBusy] = useState(false);
  const [note, setNote] = useState("");
  const [followupType, setFollowupType] = useState<FollowupType | "">("");
  const [notice, setNotice] = useState("");
  const [actionSessionBlocked, setActionSessionBlocked] = useState(false);
  const [handoff, setHandoff] = useState<ReviewHandoff | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingOrderReview | null>(null);
  const pendingOperationRef = useRef<PendingClientOperation | null>(null);
  const trustedOperator = useTrustedOperator(reviewer);
  const operator = trustedReviewer(reviewer, trustedOperator.status);
  const reviewSessionBlocked = sessionBlocked || trustedOperator.sessionBlocked || actionSessionBlocked;

  const requestReview = (order: OrderDraft, decision: OrderDecision) => {
    setError("");
    setActionSessionBlocked(false);
    setNotice("");
    setHandoff(null);
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
    if (!pendingConfirmation || !activeOrder || !operator) return;
    if (activeOrder.id !== pendingConfirmation.orderId) {
      setError("地址中的订单已变化，请刷新后重新确认。");
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
    setActionSessionBlocked(false);
    setNotice("");
    setHandoff(null);
    const operationPayload = {
      id: activeOrder.id,
      decision: pendingConfirmation.decision,
      followupType: pendingConfirmation.followupType,
      reviewer: operator,
      note: note.trim(),
      identity: identityExpectation(activeOrder),
    };
    const operation = reserveClientOperation("review-action", operationPayload, pendingOperationRef.current);
    pendingOperationRef.current = operation;
    try {
      const response = await reviewOrder(activeOrder.id, {
        operationKey: operation.key,
        decision: pendingConfirmation.decision,
        reviewer: operator,
        note: note.trim(),
        followupType: pendingConfirmation.followupType,
        ...identityExpectation(activeOrder),
      });
      pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
      setHandoff(reviewOrderHandoff(response, activeOrder));
      setNotice(`订单 ${activeOrder.id} 已提交“${orderDecisionLabel(pendingConfirmation.decision)}”审核。`);
      setPendingConfirmation(null);
      setNote("");
      setFollowupType("");
      await refresh();
    } catch (caught) {
      setActionSessionBlocked(isTrustedDesktopSessionError(caught));
      setError(caught instanceof Error ? caught.message : "订单审核失败，服务端未确认结果。");
    } finally {
      setActionBusy(false);
    }
  }, [activeOrder, note, operator, pendingConfirmation, refresh, setError]);

  const disabled = busy || actionBusy || trustedOperator.busy;

  return (
    <section className={styles.page} aria-labelledby="review-orders-title" aria-busy={disabled}>
      <header className={styles.pageHeader}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Reviews</span>
          <h1 id="review-orders-title">订单审核</h1>
          <p className={styles.description}>本页按地址中的订单 ID 读取单条审核对象，不依赖审核队列截断列表。</p>
        </div>
        <Link className={styles.button} href={reviewIdentityHref("/reviews/orders", identityFilters)}>返回订单队列</Link>
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
      <ReviewHandoffPanel handoff={handoff} actionIdPrefix="review-order-handoff" />

      <section className={styles.panel} aria-labelledby="order-review-note-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="order-review-note-title">本次审核说明</h2>
            <p>当前操作人：{operator || "未绑定"}</p>
          </div>
        </header>
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

      <section className={styles.panel} aria-labelledby="order-review-record-title">
        <header className={styles.panelHeader}>
          <div>
            <h2 id="order-review-record-title">当前订单</h2>
            <p>订单 ID：{reviewId}</p>
          </div>
        </header>
        <div className={styles.panelBody}>
          {activeOrder ? (
            <article className={styles.record}>
              <div className={styles.recordHeader}>
                <div>
                  <h3>{activeOrder.customer?.name || activeOrder.id}</h3>
                  <p>{activeOrder.customerNotes || "未填写客户备注。"}</p>
                </div>
                <span className={styles.badge}>{activeOrder.status}</span>
              </div>
              <dl className={styles.definitionList}>
                <div><dt>订单总额</dt><dd>{formatReviewMoney(activeOrder.totalPrice)}</dd></div>
                <div><dt>利润</dt><dd>{formatReviewMoney(activeOrder.profit)}</dd></div>
                <div><dt>数量</dt><dd>{activeOrder.quantity}</dd></div>
                <div><dt>支付状态</dt><dd>{activeOrder.paymentStatus}</dd></div>
                <div><dt>微信账号</dt><dd>{activeOrder.wechatAccountId || "未绑定"}</dd></div>
                <div><dt>更新时间</dt><dd>{formatReviewDate(activeOrder.updatedAt)}</dd></div>
              </dl>
              <div className={styles.buttonRow}>
                {decisions.map((decision) => (
                  <button
                    type="button"
                    className={decision.danger ? styles.dangerButton : decision.id.startsWith("approve") ? styles.primaryButton : styles.button}
                    data-action-id={`review-order-${decision.id}-${activeOrder.id}`}
                    aria-label={`对订单 ${activeOrder.id} ${decision.label}`}
                    onClick={() => requestReview(activeOrder, decision.id)}
                    disabled={!operator || disabled || !note.trim() || (decision.id === "approve_followup" && !followupType)}
                    key={decision.id}
                  >
                    {decision.label}
                  </button>
                ))}
              </div>
            </article>
          ) : <div className={styles.empty}>{loaded ? "读取成功，未找到该订单审核对象，请返回队列重新选择。" : busy ? "正在读取订单审核对象。" : "订单审核对象尚未成功读取，已阻止审核操作。"}</div>}
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
