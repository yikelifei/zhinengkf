"use client";

import { AlertTriangle, RefreshCw, ShieldAlert, UserRoundCheck, X } from "lucide-react";
import { ConversationOperationsPanel } from "../../components/conversation-operations-panel";
import { ConversationWorkbench } from "../../components/conversation-workbench";
import type { ConversationsFeatureApi } from "./api";
import styles from "./conversations-feature-page.module.css";
import { useConversationsController } from "./use-conversations-controller";

export type ConversationsFeaturePageProps = {
  api?: ConversationsFeatureApi;
  className?: string;
  initialConversationId?: string;
};

export function ConversationsFeaturePage({
  api,
  className = "",
  initialConversationId,
}: ConversationsFeaturePageProps) {
  const controller = useConversationsController(api, initialConversationId || null);

  if (controller.accessPhase === "loading") {
    return (
      <FeatureState
        className={className}
        title="正在确认会话访问权限"
        detail="权限确认完成后，才会读取客户会话与运营字段。"
        busy
      />
    );
  }

  if (controller.accessPhase === "error") {
    return (
      <FeatureState
        className={className}
        title="无法确认会话访问权限"
        detail={controller.accessError}
        tone="danger"
        actionLabel="重新检查"
        actionId="conversations-access-retry"
        onAction={() => void controller.refreshWorkspace()}
      />
    );
  }

  if (controller.accessPhase === "denied") {
    return (
      <FeatureState
        className={className}
        title="当前操作员不能查看会话"
        detail={controller.permissionDetail || "权限策略采用默认拒绝，未授予 view_console。"}
        tone="warning"
        actionLabel="重新检查权限"
        actionId="conversations-permission-retry"
        onAction={() => void controller.refreshWorkspace()}
      />
    );
  }

  const context = controller.context ? {
    ...controller.context,
    operationsSlot: (
      <div id="conversation-operations-editor" className={styles.operationsHost}>
        <ConversationOperationsPanel
          conversationTitle={controller.selectedConversation?.title}
          operations={controller.activeOperations}
          currentOperator={controller.currentOperator}
          busy={controller.operationsBusy || !controller.canManageAssignments}
          error={controller.operationsError || undefined}
          onSave={controller.saveOperations}
        />
      </div>
    ),
  } : null;

  return (
    <section
      className={`${styles.page} ${className}`.trim()}
      aria-label="会话处理"
      data-feature="conversations"
      aria-busy={controller.listLoading || undefined}
    >
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>客户沟通</span>
          <h1>会话处理</h1>
          <p>只负责读取会话、查看消息、人工回复、人工接管，以及分配和 SLA。</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.operatorBadge} title="当前可信操作员">
            {controller.currentOperator || "未识别操作员"}
          </span>
          {controller.selectedConversation ? (
            <button
              type="button"
              className={controller.selectedConversation.manualLocked ? styles.releaseButton : styles.takeoverButton}
              data-action-id="conversations-manual-takeover"
              aria-label={controller.selectedConversation.manualLocked ? "解除当前会话的人工接管" : "人工接管当前会话"}
              disabled={controller.manualLockBusy || !controller.canReply}
              onClick={controller.requestManualLockChange}
            >
              <UserRoundCheck size={16} aria-hidden="true" />
              {controller.selectedConversation.manualLocked ? "解除人工接管" : "人工接管"}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.refreshButton}
            data-action-id="conversations-refresh"
            aria-label="刷新会话与运营字段"
            disabled={controller.listLoading}
            onClick={() => void controller.refreshWorkspace()}
          >
            <RefreshCw size={16} aria-hidden="true" />刷新
          </button>
        </div>
      </header>

      {!controller.canReply || !controller.canManageAssignments ? (
        <div className={styles.permissionNotice} role="note">
          <ShieldAlert size={16} aria-hidden="true" />
          <span>
            <strong>当前为受限操作模式</strong>
            {!controller.canReply ? "人工回复和接管已禁用。" : ""}
            {!controller.canManageAssignments ? " 分配与 SLA 编辑已禁用。" : ""}
          </span>
        </div>
      ) : null}

      {controller.readNotice ? <div className={styles.warningNotice} role="alert">{controller.readNotice}</div> : null}
      {controller.actionError ? <div className={styles.errorNotice} role="alert">{controller.actionError}</div> : null}
      {controller.actionNotice ? <div className={styles.successNotice} role="status">{controller.actionNotice}</div> : null}

      {controller.manualLockTarget !== null ? (
        <div
          className={styles.confirmation}
          role="region"
          aria-live="polite"
          aria-labelledby="manual-lock-confirmation-title"
          aria-describedby="manual-lock-confirmation-detail"
        >
          <div className={styles.confirmationIcon}><AlertTriangle size={20} aria-hidden="true" /></div>
          <div>
            <strong id="manual-lock-confirmation-title">
              {controller.manualLockTarget ? "确认人工接管这条会话？" : "确认解除人工接管？"}
            </strong>
            <p id="manual-lock-confirmation-detail">
              {controller.manualLockTarget
                ? "接管后自动处理应保持暂停，人工回复仍只进入安全发送队列。"
                : "解除后服务端可能恢复自动处理；本操作不会自动重发任何历史消息。"}
            </p>
          </div>
          <div className={styles.confirmationActions}>
            <button
              type="button"
              data-action-id="conversations-manual-lock-cancel"
              aria-label="取消变更人工接管状态"
              onClick={controller.cancelManualLockChange}
            >
              <X size={15} aria-hidden="true" />取消
            </button>
            {controller.manualLockTarget ? (
              <button
                type="button"
                className={styles.confirmButton}
                data-action-id="conversations-manual-takeover-confirm"
                aria-label="确认人工接管"
                onClick={() => void controller.confirmManualLockChange()}
              >
                <UserRoundCheck size={15} aria-hidden="true" />确认接管
              </button>
            ) : (
              <button
                type="button"
                className={styles.confirmButton}
                data-action-id="conversations-manual-release-confirm"
                aria-label="确认解除人工接管"
                onClick={() => void controller.confirmManualLockChange()}
              >
                <UserRoundCheck size={15} aria-hidden="true" />确认解除
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className={styles.workbenchHost}>
        <ConversationWorkbench
          inbox={controller.inbox}
          thread={controller.thread}
          context={context}
          activePane={controller.activePane}
          inboxCollapsed={controller.inboxCollapsed}
          actions={controller.actions}
        />
      </div>
    </section>
  );
}

function FeatureState({
  className,
  title,
  detail,
  busy = false,
  tone = "neutral",
  actionLabel,
  actionId,
  onAction,
}: {
  className: string;
  title: string;
  detail: string;
  busy?: boolean;
  tone?: "neutral" | "warning" | "danger";
  actionLabel?: string;
  actionId?: string;
  onAction?: () => void;
}) {
  return (
    <section className={`${styles.page} ${className}`.trim()} aria-label="会话处理">
      <div className={`${styles.stateCard} ${styles[`state-${tone}`]}`} role={tone === "danger" ? "alert" : "status"} aria-busy={busy || undefined}>
        {tone === "danger" || tone === "warning" ? <ShieldAlert size={24} aria-hidden="true" /> : <RefreshCw size={24} aria-hidden="true" />}
        <h1>{title}</h1>
        <p>{detail}</p>
        {actionLabel && onAction ? (
          <button type="button" data-action-id={actionId} aria-label={actionLabel} onClick={onAction}>{actionLabel}</button>
        ) : null}
      </div>
    </section>
  );
}
