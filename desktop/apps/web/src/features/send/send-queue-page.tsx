"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Send, ShieldCheck } from "lucide-react";
import {
  cancelSendTask,
  executeSendTask,
  getSendAdapter,
  getSendTasks,
  identityExpectation,
  isTrustedDesktopSessionError,
  processSafeSendQueue,
  validateSendTaskCurrentWindow,
  type IdentityFilters,
  type SendAdapterInfo,
  type SendTask,
} from "../../lib/api";
import { SendEmpty, SendLoading, SendNotice, SendPageFrame, errorMessage } from "./send-page-frame";
import { canCancelSendTask, canExecuteSendTask, isQueueSendTask, operationBlockReason, scopedIdentityHref, scopedSendTaskHref } from "./send-policy";
import { SendConfirmation, SendTaskCard } from "./send-task-card";
import { SendTaskListItem } from "./send-task-list-item";
import styles from "./send-pages.module.css";

type QueueConfirmation =
  | { kind: "execute"; taskId: string }
  | { kind: "cancel"; taskId: string }
  | { kind: "process" }
  | null;

export type SendQueuePageProps = {
  filters?: IdentityFilters;
  initialTaskId?: string;
};

export function SendQueuePage({ filters = {}, initialTaskId = "" }: SendQueuePageProps) {
  const [tasks, setTasks] = useState<SendTask[]>([]);
  const [adapter, setAdapter] = useState<SendAdapterInfo | null>(null);
  const [busy, setBusy] = useState(true);
  const [operationId, setOperationId] = useState("");
  const [error, setError] = useState("");
  const [sessionBlocked, setSessionBlocked] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<QueueConfirmation>(null);
  const requestSequence = useRef(0);
  const accountFilter = filters.wechatAccountId;
  const conversationFilter = filters.conversationId;
  const customerFilter = filters.customerId;

  const refreshQueue = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError("");
    setSessionBlocked(false);
    const scopedFilters = { wechatAccountId: accountFilter, conversationId: conversationFilter, customerId: customerFilter };
    const results = await Promise.allSettled([getSendTasks(scopedFilters), getSendAdapter()] as const);
    if (sequence !== requestSequence.current) return;
    const errors: string[] = [];
    setSessionBlocked(results.some((result) => result.status === "rejected" && isTrustedDesktopSessionError(result.reason)));
    if (results[0].status === "fulfilled") {
      setTasks(results[0].value);
      if (initialTaskId && !results[0].value.some((task) => task.id === initialTaskId && isQueueSendTask(task))) {
        errors.push(`未找到待发送任务 ${initialTaskId}，请返回队列重新选择。`);
      }
    }
    else errors.push(errorMessage(results[0].reason, "发送队列读取失败"));
    if (results[1].status === "fulfilled") setAdapter(results[1].value);
    else errors.push(errorMessage(results[1].reason, "发送适配器读取失败"));
    setError([...new Set(errors)].join("；"));
    setBusy(false);
  }, [accountFilter, conversationFilter, customerFilter, initialTaskId]);

  useEffect(() => {
    void refreshQueue();
    return () => { requestSequence.current += 1; };
  }, [refreshQueue]);

  async function runTaskOperation(task: SendTask, label: string, action: () => Promise<unknown>) {
    if (operationId) return;
    setOperationId(task.id);
    setError("");
    setSessionBlocked(false);
    setFeedback("");
    try {
      await action();
      setFeedback(`${label}已完成；页面已重新读取服务端任务状态。`);
      await refreshQueue();
    } catch (operationError) {
      setSessionBlocked(isTrustedDesktopSessionError(operationError));
      setError(errorMessage(operationError, `${label}失败`));
    } finally {
      setOperationId("");
    }
  }

  async function validateCurrentWindow(task: SendTask) {
    await runTaskOperation(task, "当前窗口身份校验", () =>
      validateSendTaskCurrentWindow(task.id, identityExpectation(task)),
    );
  }

  async function confirmExecute() {
    if (pendingConfirmation?.kind !== "execute") return;
    const task = tasks.find((item) => item.id === pendingConfirmation.taskId);
    if (!task || !canExecuteSendTask(task, adapter)) {
      setPendingConfirmation(null);
      setError(task ? operationBlockReason(task, adapter) : "发送任务已不存在，请刷新队列。");
      return;
    }
    setPendingConfirmation(null);
    await runTaskOperation(task, "真实发送执行", () => executeSendTask(task.id, identityExpectation(task)));
  }

  async function confirmCancel() {
    if (pendingConfirmation?.kind !== "cancel") return;
    const task = tasks.find((item) => item.id === pendingConfirmation.taskId);
    if (!task || !canCancelSendTask(task)) {
      setPendingConfirmation(null);
      setError(task ? "当前任务状态不允许取消。" : "发送任务已不存在，请刷新队列。");
      return;
    }
    setPendingConfirmation(null);
    await runTaskOperation(task, "取消待发送任务", () =>
      cancelSendTask(task.id, {
        ...identityExpectation(task),
        reason: "客服在发送确认页取消待发送任务",
      }),
    );
  }

  async function confirmProcessQueue() {
    if (pendingConfirmation?.kind !== "process") return;
    if (!adapter?.realSend) {
      setPendingConfirmation(null);
      setError("真实发送适配器未就绪，不能处理安全发送队列。");
      return;
    }
    setPendingConfirmation(null);
    setOperationId("process-safe-queue");
    setError("");
    setSessionBlocked(false);
    setFeedback("");
    try {
      const result = await processSafeSendQueue({
        wechatAccountId: accountFilter,
        conversationId: conversationFilter,
        customerId: customerFilter,
      });
      setFeedback(`安全队列处理完成：已处理 ${result.processed.length}，已阻断 ${result.blocked.length}，已跳过 ${result.skipped.length}，失败 ${result.failed.length}。`);
      await refreshQueue();
    } catch (operationError) {
      setSessionBlocked(isTrustedDesktopSessionError(operationError));
      setError(errorMessage(operationError, "安全发送队列处理失败"));
    } finally {
      setOperationId("");
    }
  }

  const queueTasks = initialTaskId
    ? tasks.filter((task) => task.id === initialTaskId && isQueueSendTask(task))
    : tasks.filter(isQueueSendTask);
  const operationBusy = Boolean(operationId);
  const confirmationTask = pendingConfirmation?.kind === "execute"
    ? tasks.find((task) => task.id === pendingConfirmation.taskId) || null
    : null;
  const cancellationTask = pendingConfirmation?.kind === "cancel"
    ? tasks.find((task) => task.id === pendingConfirmation.taskId) || null
    : null;

  return (
    <SendPageFrame
      id="send-queue-page"
      title="安全发送队列"
      description="只负责当前窗口校验与已确认任务执行；缺少真实适配器或身份证据时保持阻断。"
      icon={<Send size={20} />}
      busy={busy || operationBusy}
      actions={(
        <>
          {initialTaskId ? <Link className={styles.secondaryLink} href={scopedIdentityHref("/send/queue", filters)}>返回队列</Link> : null}
          <button
            type="button"
            data-action-id="send.queue.refresh"
            aria-label="刷新安全发送队列"
            onClick={() => void refreshQueue()}
            disabled={busy || operationBusy}
          >
            <RefreshCw size={15} aria-hidden="true" /> 刷新
          </button>
        </>
      )}
    >
      {sessionBlocked ? (
        <SendNotice tone="warning" title="需要可信桌面会话">
          请从臻希智能客服桌面端窗口打开本页；如果已经在桌面端，请刷新页面或重启客服启动器后再操作。
        </SendNotice>
      ) : null}
      {error ? <SendNotice tone="error" title="发送队列操作未完成">{error}</SendNotice> : null}
      {feedback ? <SendNotice tone="success" title="发送队列已更新">{feedback}</SendNotice> : null}
      <div className={`${styles.adapterBanner} ${adapter?.realSend ? styles.adapterReady : ""}`} role="status">
        <strong>{adapter?.label || "发送适配器未连接"}</strong>
        <span>{adapter?.description || "当前不具备真实发送能力；页面不会提供演练发送作为替代。"}</span>
      </div>

      {pendingConfirmation?.kind === "process" ? (
        <SendConfirmation
          actionIdPrefix="send.queue.process-safe-queue"
          title="确认处理当前安全队列"
          detail="服务端会逐条重新校验账号、会话、客户、队列头和当前窗口；通过的任务可能立即进入真实发送。"
          confirmLabel="确认处理安全队列"
          busy={operationBusy}
          onConfirm={() => void confirmProcessQueue()}
          onCancel={() => setPendingConfirmation(null)}
        />
      ) : null}
      {pendingConfirmation?.kind === "execute" && confirmationTask ? (
        <SendConfirmation
          actionIdPrefix={`send.queue.execute.${confirmationTask.id}`}
          title="确认执行真实发送"
          detail="请再次核对下方微信账号、会话、客户和消息内容；服务端仍会在执行前重新校验当前窗口。"
          task={confirmationTask}
          confirmLabel="确认真实发送"
          busy={operationBusy}
          onConfirm={() => void confirmExecute()}
          onCancel={() => setPendingConfirmation(null)}
        />
      ) : null}
      {pendingConfirmation?.kind === "cancel" && cancellationTask ? (
        <SendConfirmation
          actionIdPrefix={`send.queue.cancel.${cancellationTask.id}`}
          title="确认取消待发送任务"
          detail="取消后该任务不会进入微信；操作会保留任务内容、原状态和取消原因供审计。"
          task={cancellationTask}
          confirmLabel="确认取消任务"
          busy={operationBusy}
          danger
          onConfirm={() => void confirmCancel()}
          onCancel={() => setPendingConfirmation(null)}
        />
      ) : null}

      <section className={styles.panel} aria-labelledby="send-queue-list-title">
        <header className={styles.panelHeader}>
          <div><h2 id="send-queue-list-title">{initialTaskId ? "当前发送任务" : "待处理任务"}</h2><p>{initialTaskId ? "只核对并处理这一项真实发送任务。" : "发送中任务只等待回执；逐项操作需要进入任务详情。"}</p></div>
          {!initialTaskId ? <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.primaryButton}
              data-action-id="send.queue.request-process-safe-queue"
              aria-label="请求处理当前安全发送队列"
              onClick={() => setPendingConfirmation({ kind: "process" })}
              disabled={busy || operationBusy || !adapter?.realSend || !queueTasks.some((task) => task.status === "queued")}
            >
              <ShieldCheck size={15} aria-hidden="true" /> 处理安全队列
            </button>
          </div> : null}
        </header>
        {busy && !tasks.length ? <SendLoading label="正在读取发送队列" /> : null}
        {!busy && !queueTasks.length ? <SendEmpty title="发送队列为空" detail="本页不创建演示任务；业务页面生成真实发送任务后会显示在这里。" /> : null}
        {queueTasks.length ? (
          <div className={styles.taskList}>
            {queueTasks.map((task) => {
              if (!initialTaskId) {
                return <SendTaskListItem key={task.id} task={task} href={scopedSendTaskHref("/send/queue", task)} />;
              }
              const accountQueueHead = tasks
                .filter((item) => item.status === "queued" && item.wechatAccountId === task.wechatAccountId)
                .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))[0] || null;
              const blockedByEarlierTask = Boolean(accountQueueHead && accountQueueHead.id !== task.id);
              const executable = canExecuteSendTask(task, adapter);
              const hint = blockedByEarlierTask
                ? `同一微信账号还有更早的待发送任务 ${accountQueueHead?.id}；请先返回队列处理或取消该任务。`
                : task.status === "sending"
                ? "任务正在等待企业微信发送回执，禁止重复执行。"
                : executable
                  ? "当前服务端校验已通过；点击执行后仍需二次确认。"
                  : operationBlockReason(task, adapter);
              return (
                <SendTaskCard
                  key={task.id}
                  task={task}
                  hint={hint}
                  actions={task.status === "queued" ? (
                    <>
                      <button
                        type="button"
                        data-action-id={`send.queue.validate-current.${task.id}`}
                        aria-label={`校验发送任务 ${task.id} 的当前真实窗口`}
                        onClick={() => void validateCurrentWindow(task)}
                        disabled={busy || operationBusy || blockedByEarlierTask}
                      >
                        <ShieldCheck size={15} aria-hidden="true" /> 当前窗口校验
                      </button>
                      <button
                        type="button"
                        data-action-id={`send.queue.request-cancel.${task.id}`}
                        aria-label={`请求取消待发送任务 ${task.id}`}
                        onClick={() => setPendingConfirmation({ kind: "cancel", taskId: task.id })}
                        disabled={busy || operationBusy || !canCancelSendTask(task)}
                      >
                        取消任务
                      </button>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        data-action-id={`send.queue.request-execute.${task.id}`}
                        aria-label={`请求执行真实发送任务 ${task.id}`}
                        onClick={() => setPendingConfirmation({ kind: "execute", taskId: task.id })}
                        disabled={busy || operationBusy || blockedByEarlierTask || !executable}
                      >
                        <Send size={15} aria-hidden="true" /> 执行真实发送
                      </button>
                    </>
                  ) : null}
                />
              );
            })}
          </div>
        ) : null}
      </section>
    </SendPageFrame>
  );
}
