"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import {
  cancelSendTask,
  getSendTasks,
  identityExpectation,
  requeueSendTask,
  resolveSendTaskDelivery,
  type IdentityFilters,
  type SendTask,
} from "../../lib/api";
import {
  completeClientOperation,
  reserveClientOperation,
  type PendingClientOperation,
} from "../../lib/client-operation-key";
import { SendEmpty, SendLoading, SendNotice, SendPageFrame, errorMessage } from "./send-page-frame";
import {
  canCancelSendTask,
  canRequeueSendTask,
  canResolveUnknownDelivery,
  isBlockedSendTask,
  operationBlockReason,
} from "./send-policy";
import { SendConfirmation, SendTaskCard } from "./send-task-card";
import { SendTaskListItem } from "./send-task-list-item";
import styles from "./send-pages.module.css";

type BlockedConfirmation = {
  kind: "requeue" | "cancel" | "confirmed_sent" | "confirmed_not_sent";
  taskId: string;
} | null;

export type SendBlockedPageProps = {
  filters?: IdentityFilters;
  initialTaskId?: string;
};

export function SendBlockedPage({ filters = {}, initialTaskId = "" }: SendBlockedPageProps) {
  const [tasks, setTasks] = useState<SendTask[]>([]);
  const [busy, setBusy] = useState(true);
  const [operationId, setOperationId] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<BlockedConfirmation>(null);
  const requestSequence = useRef(0);
  const pendingResolutionOperation = useRef<PendingClientOperation | null>(null);
  const accountFilter = filters.wechatAccountId;
  const conversationFilter = filters.conversationId;
  const customerFilter = filters.customerId;

  const refreshBlocked = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError("");
    try {
      const next = await getSendTasks({
        wechatAccountId: accountFilter,
        conversationId: conversationFilter,
        customerId: customerFilter,
      });
      if (sequence === requestSequence.current) {
        setTasks(next);
        if (initialTaskId && !next.some((task) => task.id === initialTaskId && isBlockedSendTask(task))) {
          setError(`未找到被阻断任务 ${initialTaskId}，请返回列表重新选择。`);
        }
      }
    } catch (refreshError) {
      if (sequence === requestSequence.current) setError(errorMessage(refreshError, "拦截任务读取失败"));
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, [accountFilter, conversationFilter, customerFilter, initialTaskId]);

  useEffect(() => {
    void refreshBlocked();
    return () => { requestSequence.current += 1; };
  }, [refreshBlocked]);

  async function confirmBlockedAction() {
    if (!pendingConfirmation) return;
    const task = tasks.find((item) => item.id === pendingConfirmation.taskId);
    if (!task) {
      setPendingConfirmation(null);
      setError("发送任务已不存在，请刷新拦截列表。");
      return;
    }
    const actionAllowed = pendingConfirmation.kind === "requeue"
      ? canRequeueSendTask(task)
      : pendingConfirmation.kind === "cancel"
        ? canCancelSendTask(task)
        : canResolveUnknownDelivery(task);
    if (!actionAllowed) {
      setPendingConfirmation(null);
      setError(operationBlockReason(task));
      return;
    }
    const kind = pendingConfirmation.kind;
    setPendingConfirmation(null);
    setOperationId(task.id);
    setError("");
    setFeedback("");
    try {
      if (kind === "requeue") {
        await requeueSendTask(task.id, {
          ...identityExpectation(task),
          reason: "manual_operator_requeue_from_modular_blocked_page",
        });
        setFeedback("任务已重新排队；发送前仍会重新校验当前真实窗口。 ");
      } else if (kind === "cancel") {
        await cancelSendTask(task.id, {
          ...identityExpectation(task),
          reason: "manual_operator_cancel_from_modular_blocked_page",
        });
        setFeedback("任务已取消并由服务端留痕，不会自动恢复或重新排队。");
      } else {
        const expected = identityExpectation(task);
        const reservation = reserveClientOperation(
          "send-resolution",
          { taskId: task.id, resolution: kind, ...expected },
          pendingResolutionOperation.current,
        );
        pendingResolutionOperation.current = reservation;
        await resolveSendTaskDelivery(task.id, {
          ...expected,
          resolution: kind,
          operationKey: reservation.key,
          reason: kind === "confirmed_sent"
            ? "manual_operator_confirmed_customer_received_message"
            : "manual_operator_confirmed_message_was_not_sent",
        });
        pendingResolutionOperation.current = completeClientOperation(
          pendingResolutionOperation.current,
          reservation.key,
        );
        setFeedback(kind === "confirmed_sent"
          ? "已人工确认发送成功，关联业务状态已按确定结果收敛。"
          : "已人工确认未发送；任务保持失败，只有再次明确操作才会重新排队。");
      }
      await refreshBlocked();
    } catch (operationError) {
      setError(errorMessage(operationError, kind === "requeue"
        ? "任务重新排队失败"
        : kind === "cancel"
          ? "任务取消失败"
          : "人工确认投递结果失败"));
    } finally {
      setOperationId("");
    }
  }

  const blockedTasks = initialTaskId
    ? tasks.filter((task) => task.id === initialTaskId && isBlockedSendTask(task))
    : tasks.filter(isBlockedSendTask);
  const confirmationTask = pendingConfirmation
    ? tasks.find((task) => task.id === pendingConfirmation.taskId) || null
    : null;
  const operationBusy = Boolean(operationId);

  return (
    <SendPageFrame
      id="send-blocked-page"
      title="拦截与失败任务"
      description="只处理服务端已阻断或失败的任务；人工接管、路由阻断和未知投递不允许绕过。"
      icon={<ShieldAlert size={20} />}
      busy={busy || operationBusy}
      actions={(
        <>
          {initialTaskId ? <Link className={styles.secondaryLink} href="/send/blocked">返回列表</Link> : null}
          <button
            type="button"
            data-action-id="send.blocked.refresh"
            aria-label="刷新拦截与失败任务"
            onClick={() => void refreshBlocked()}
            disabled={busy || operationBusy}
          >
            <RefreshCw size={15} aria-hidden="true" /> 刷新
          </button>
        </>
      )}
    >
      {error ? <SendNotice tone="error" title="拦截任务操作未完成">{error}</SendNotice> : null}
      {feedback ? <SendNotice tone="success" title="任务状态已更新">{feedback}</SendNotice> : null}
      <SendNotice tone="warning" title="未知投递保持隔离">
        投递状态不确定的任务禁止重排和取消；只有完成账号、会话、客户三元身份核对后，才能人工确认已发送或未发送。
      </SendNotice>
      {pendingConfirmation && confirmationTask ? (
        <SendConfirmation
          actionIdPrefix={`send.blocked.${pendingConfirmation.kind}.${confirmationTask.id}`}
          title={pendingConfirmation.kind === "requeue"
            ? "确认重新排队"
            : pendingConfirmation.kind === "cancel"
              ? "确认取消发送任务"
              : pendingConfirmation.kind === "confirmed_sent"
                ? "确认客户已收到消息"
                : "确认消息没有发出"}
          detail={pendingConfirmation.kind === "requeue"
            ? "重新排队不会沿用旧窗口结果；服务端仍会重新校验账号、会话、客户和队列头。"
            : pendingConfirmation.kind === "cancel"
              ? "取消后任务不会自动恢复；如业务仍需发送，必须从对应业务流程重新生成。"
              : pendingConfirmation.kind === "confirmed_sent"
                ? "仅在已从客户会话或官方记录确认消息送达时使用；关联报价或订单会按发送成功收敛。"
                : "仅在已确认消息没有发出时使用；任务会变为失败，但不会自动重新排队。"}
          task={confirmationTask}
          confirmLabel={pendingConfirmation.kind === "requeue"
            ? "确认重新排队"
            : pendingConfirmation.kind === "cancel"
              ? "确认取消任务"
              : pendingConfirmation.kind === "confirmed_sent"
                ? "确认已发送"
                : "确认未发送"}
          danger={["cancel", "confirmed_not_sent"].includes(pendingConfirmation.kind)}
          busy={operationBusy}
          onConfirm={() => void confirmBlockedAction()}
          onCancel={() => setPendingConfirmation(null)}
        />
      ) : null}
      <section className={styles.panel} aria-labelledby="blocked-send-task-list-title">
        <header className={styles.panelHeader}>
          <div><h2 id="blocked-send-task-list-title">{initialTaskId ? "当前拦截任务" : "需要人工判断的任务"}</h2><p>{initialTaskId ? "只判断这一项任务应重新排队还是取消。" : "列表只负责选择；不会解除人工接管或修改路由策略。"}</p></div>
        </header>
        {busy && !tasks.length ? <SendLoading label="正在读取拦截任务" /> : null}
        {!busy && !blockedTasks.length ? <SendEmpty title="没有需要处理的拦截任务" detail="当前没有服务端阻断、失败或投递不确定任务。" /> : null}
        {blockedTasks.length ? (
          <div className={styles.taskList}>
            {blockedTasks.map((task) => {
              if (!initialTaskId) {
                return <SendTaskListItem key={task.id} task={task} href={"/send/blocked/" + encodeURIComponent(task.id)} />;
              }
              const canRequeue = canRequeueSendTask(task);
              const canCancel = canCancelSendTask(task);
              const canResolve = canResolveUnknownDelivery(task);
              const hint = canResolve
                ? "投递结果未知：请先核对官方记录或客户会话，再选择唯一的人工处置结果。"
                : canRequeue || canCancel
                  ? "选择操作后还需核对身份与消息内容并二次确认。"
                  : operationBlockReason(task);
              return (
                <SendTaskCard
                  task={task}
                  key={task.id}
                  hint={hint}
                  actions={(
                    <>
                      {canRequeue ? (
                        <button
                          type="button"
                          data-action-id={`send.blocked.request-requeue.${task.id}`}
                          aria-label={`请求重新排队发送任务 ${task.id}`}
                          onClick={() => setPendingConfirmation({ kind: "requeue", taskId: task.id })}
                          disabled={busy || operationBusy}
                        >
                          <RefreshCw size={15} aria-hidden="true" /> 重新排队
                        </button>
                      ) : null}
                      {canCancel ? (
                        <button
                          type="button"
                          className={styles.dangerButton}
                          data-action-id={`send.blocked.request-cancel.${task.id}`}
                          aria-label={`请求取消发送任务 ${task.id}`}
                          onClick={() => setPendingConfirmation({ kind: "cancel", taskId: task.id })}
                          disabled={busy || operationBusy}
                        >
                          <Ban size={15} aria-hidden="true" /> 取消任务
                        </button>
                      ) : null}
                      {canResolve ? (
                        <>
                          <button
                            type="button"
                            className={styles.primaryButton}
                            data-action-id={`send.blocked.request-confirmed-sent.${task.id}`}
                            aria-label={`确认发送任务 ${task.id} 已发送`}
                            onClick={() => setPendingConfirmation({ kind: "confirmed_sent", taskId: task.id })}
                            disabled={busy || operationBusy}
                          >
                            <CheckCircle2 size={15} aria-hidden="true" /> 确认已发送
                          </button>
                          <button
                            type="button"
                            className={styles.dangerButton}
                            data-action-id={`send.blocked.request-confirmed-not-sent.${task.id}`}
                            aria-label={`确认发送任务 ${task.id} 未发送`}
                            onClick={() => setPendingConfirmation({ kind: "confirmed_not_sent", taskId: task.id })}
                            disabled={busy || operationBusy}
                          >
                            <XCircle size={15} aria-hidden="true" /> 确认未发送
                          </button>
                        </>
                      ) : null}
                    </>
                  )}
                />
              );
            })}
          </div>
        ) : null}
      </section>
    </SendPageFrame>
  );
}
