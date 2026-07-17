"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, RefreshCw, ShieldAlert } from "lucide-react";
import {
  cancelSendTask,
  getSendTasks,
  identityExpectation,
  requeueSendTask,
  type IdentityFilters,
  type SendTask,
} from "../../lib/api";
import { SendEmpty, SendLoading, SendNotice, SendPageFrame, errorMessage } from "./send-page-frame";
import {
  canCancelSendTask,
  canRequeueSendTask,
  isBlockedSendTask,
  operationBlockReason,
} from "./send-policy";
import { SendConfirmation, SendTaskCard } from "./send-task-card";
import styles from "./send-pages.module.css";

type BlockedConfirmation = { kind: "requeue" | "cancel"; taskId: string } | null;

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
        if (initialTaskId && !next.some((task) => task.id === initialTaskId)) {
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
    const actionAllowed = pendingConfirmation.kind === "requeue" ? canRequeueSendTask(task) : canCancelSendTask(task);
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
      } else {
        await cancelSendTask(task.id, {
          ...identityExpectation(task),
          reason: "manual_operator_cancel_from_modular_blocked_page",
        });
        setFeedback("任务已取消并由服务端留痕，不会自动恢复或重新排队。");
      }
      await refreshBlocked();
    } catch (operationError) {
      setError(errorMessage(operationError, kind === "requeue" ? "任务重新排队失败" : "任务取消失败"));
    } finally {
      setOperationId("");
    }
  }

  const blockedTasks = prioritizeTask(tasks.filter(isBlockedSendTask), initialTaskId);
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
        <button
          type="button"
          data-action-id="send.blocked.refresh"
          aria-label="刷新拦截与失败任务"
          onClick={() => void refreshBlocked()}
          disabled={busy || operationBusy}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新列表
        </button>
      )}
    >
      {error ? <SendNotice tone="error" title="拦截任务操作未完成">{error}</SendNotice> : null}
      {feedback ? <SendNotice tone="success" title="任务状态已更新">{feedback}</SendNotice> : null}
      <SendNotice tone="warning" title="未知投递保持隔离">
        发送中或投递状态不确定的任务不提供重排和取消按钮；必须先从诊断页核对桥接回执，避免重复发给客户。
      </SendNotice>
      {pendingConfirmation && confirmationTask ? (
        <SendConfirmation
          actionIdPrefix={`send.blocked.${pendingConfirmation.kind}.${confirmationTask.id}`}
          title={pendingConfirmation.kind === "requeue" ? "确认重新排队" : "确认取消发送任务"}
          detail={pendingConfirmation.kind === "requeue"
            ? "重新排队不会沿用旧窗口结果；服务端仍会重新校验账号、会话、客户和队列头。"
            : "取消后任务不会自动恢复；如业务仍需发送，必须从对应业务流程重新生成。"}
          task={confirmationTask}
          confirmLabel={pendingConfirmation.kind === "requeue" ? "确认重新排队" : "确认取消任务"}
          danger={pendingConfirmation.kind === "cancel"}
          busy={operationBusy}
          onConfirm={() => void confirmBlockedAction()}
          onCancel={() => setPendingConfirmation(null)}
        />
      ) : null}
      <section className={styles.panel} aria-labelledby="blocked-send-task-list-title">
        <header className={styles.panelHeader}>
          <div><h2 id="blocked-send-task-list-title">需要人工判断的任务</h2><p>页面不提供解除会话人工接管或修改路由策略的捷径。</p></div>
        </header>
        {busy && !tasks.length ? <SendLoading label="正在读取拦截任务" /> : null}
        {!busy && !blockedTasks.length ? <SendEmpty title="没有需要处理的拦截任务" detail="当前没有服务端阻断、失败或投递不确定任务。" /> : null}
        {blockedTasks.length ? (
          <div className={styles.taskList}>
            {blockedTasks.map((task) => {
              const canRequeue = canRequeueSendTask(task);
              const canCancel = canCancelSendTask(task);
              const hint = canRequeue || canCancel
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

function prioritizeTask(tasks: SendTask[], taskId: string) {
  if (!taskId) return tasks;
  return [...tasks].sort((left, right) => Number(right.id === taskId) - Number(left.id === taskId));
}
