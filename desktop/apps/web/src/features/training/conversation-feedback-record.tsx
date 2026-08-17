"use client";

import { useState } from "react";
import type { ConversationLearningDashboard } from "../../lib/api";
import styles from "../governance-pages.module.css";

type ConversationLearningItem = ConversationLearningDashboard["conversations"][number];

export function ConversationFeedbackRecord({
  item,
  busy,
  onConfirm,
}: {
  item: ConversationLearningItem;
  busy: boolean;
  onConfirm: (item: ConversationLearningItem, outcome: "won" | "lost" | "ongoing", reasonCode: string, note: string) => Promise<void>;
}) {
  const [reasonCode, setReasonCode] = useState(item.feedback.primaryReason.code || "unknown_insufficient_evidence");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"won" | "lost" | "ongoing" | null>(null);
  const [localError, setLocalError] = useState("");
  const evidence = item.feedback.primaryReason.evidence?.[0]?.excerpt || "暂无可引用的客户原话";
  const requestOutcome = (outcome: "won" | "lost" | "ongoing") => {
    if (!note.trim()) {
      setLocalError("请填写客户原话、订单事实或人工判断依据，再确认成交结果。");
      return;
    }
    setLocalError("");
    setPending(outcome);
  };
  const confirmOutcome = async () => {
    if (!pending) return;
    await onConfirm(item, pending, pending === "won" ? "converted" : reasonCode, note.trim());
    setPending(null);
    setNote("");
  };
  return (
    <article className={styles.record}>
      <div className={styles.recordHeader}>
        <div>
          <h3>{item.conversation.title || item.conversation.id}</h3>
          <p>{item.feedback.whyNotConverted}</p>
        </div>
        <span className={`${styles.badge} ${item.feedback.outcome === "won" ? styles.toneOk : item.feedback.outcome === "lost" ? styles.toneWarning : ""}`}>
          {item.feedback.outcome === "won" ? "已成交" : item.feedback.outcome === "lost" ? "未成交" : item.feedback.state === "stalled" ? "停滞待跟进" : "进行中"}
        </span>
      </div>
      <div className={styles.recordMeta}>
        <span>证据：{evidence}</span>
        <span>消息 {item.feedback.metrics.messageCount}</span>
        <span>报价 {item.feedback.metrics.quoteCount}</span>
        <span>订单 {item.feedback.metrics.orderCount}</span>
        <span>观察 {item.learningObservationCount}</span>
      </div>
      <p className={styles.helpText}>建议：{item.feedback.recommendedActions?.[0] || "请人工补充成交结果与原因。"}</p>
      <div className={styles.formGrid}>
        <label className={styles.field}><span>反馈原因</span><select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}><option value="price_budget_gap">价格超出预算</option><option value="platform_price_comparison">平台比价</option><option value="quantity_or_moq_mismatch">数量或起订量不匹配</option><option value="product_style_mismatch">产品或风格不匹配</option><option value="sample_quality_or_followup">样品体验或跟进受阻</option><option value="delivery_timeline_mismatch">交期不匹配</option><option value="decision_delayed">客户尚未决策</option><option value="explicit_cancel">客户明确取消</option><option value="unknown_insufficient_evidence">证据不足/其他</option><option value="converted">已成交</option></select></label>
        <label className={styles.field}><span>人工备注</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="填写客户原话或判断依据" /></label>
      </div>
      {localError ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{localError}</div> : null}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.button} data-action-id="training-outcome-request-won" disabled={busy} onClick={() => requestOutcome("won")}>标为成交</button>
        <button type="button" className={styles.button} data-action-id="training-outcome-request-lost" disabled={busy} onClick={() => requestOutcome("lost")}>标为未成交</button>
        <button type="button" className={styles.button} data-action-id="training-outcome-request-ongoing" disabled={busy} onClick={() => requestOutcome("ongoing")}>继续跟进</button>
      </div>
      {pending ? (
        <section className={styles.confirmation} aria-label="确认会话结果反馈">
          <strong>确认记录为{pending === "won" ? "已成交" : pending === "lost" ? "未成交" : "继续跟进"}？</strong>
          <p>依据：{note.trim()}。提交后将更新会话学习结果，但不会自动启用为知识或 Skill。</p>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.primaryButton} data-action-id="training-outcome-confirm" disabled={busy} onClick={() => void confirmOutcome()}>确认提交</button>
            <button type="button" className={styles.button} data-action-id="training-outcome-cancel" disabled={busy} onClick={() => setPending(null)}>取消</button>
          </div>
        </section>
      ) : null}
    </article>
  );
}
