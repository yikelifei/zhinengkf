"use client";

import Link from "next/link";
import { AlertTriangle, UserRoundCheck, X } from "lucide-react";
import { ConversationThreadPane } from "../../components/conversation-workbench/conversation-thread-pane";
import type { ConversationsFeatureApi } from "./api";
import { ConversationPageState } from "./conversation-page-state";
import styles from "./conversation-pages.module.css";
import { useConversationsController } from "./use-conversations-controller";

export function ConversationDetailPage({ api, conversationId }: { api?: ConversationsFeatureApi; conversationId: string }) {
  const controller = useConversationsController(api, conversationId, "detail");
  if (controller.accessPhase === "loading") {
    return <ConversationPageState title="正在读取会话" detail="权限确认后加载这条会话的真实消息。" />;
  }
  if (controller.accessPhase === "error") {
    return <ConversationPageState title="无法读取会话" detail={controller.accessError} tone="danger" actionLabel="重新检查" onAction={() => void controller.refreshWorkspace()} />;
  }
  if (controller.accessPhase === "denied") {
    return <ConversationPageState title="当前操作员不能查看会话" detail={controller.permissionDetail || "未授予 view_console。"} tone="warning" />;
  }
  if (!controller.selectedConversation) {
    return <ConversationPageState title="未找到会话" detail={controller.inbox.error || "请返回会话列表重新选择。"} tone="warning" />;
  }

  const conversation = controller.selectedConversation;
  return (
    <section className={styles.page} aria-labelledby="conversation-detail-title" aria-busy={controller.listLoading || controller.manualLockBusy || undefined}>
      <header className={styles.header}>
        <div>
          <h1 id="conversation-detail-title">{conversation.title}</h1>
          <p>本页只负责阅读消息、生成辅助建议并提交人工回复。</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.linkButton} href="/conversations">返回列表</Link>
          <Link className={styles.linkButton} href={"/conversations/" + encodeURIComponent(conversation.id) + "/context"}>客户资料</Link>
          <Link className={styles.linkButton} href={"/conversations/" + encodeURIComponent(conversation.id) + "/assignment"}>分配与 SLA</Link>
          <button
            className={conversation.manualLocked ? styles.warningButton + " " + styles.button : styles.primaryButton}
            type="button"
            data-action-id="conversations-manual-takeover"
            aria-label={conversation.manualLocked ? "解除当前会话人工接管" : "人工接管当前会话"}
            onClick={controller.requestManualLockChange}
            disabled={!controller.canReply || controller.manualLockBusy}
          >
            <UserRoundCheck size={16} aria-hidden="true" />
            {conversation.manualLocked ? "解除人工接管" : "人工接管"}
          </button>
        </div>
      </header>

      {!controller.canReply ? <div className={styles.notice + " " + styles.noticeWarning} role="note">当前身份没有回复权限，本页保持只读。</div> : null}
      {controller.readNotice ? <div className={styles.notice + " " + styles.noticeWarning} role="alert">{controller.readNotice}</div> : null}
      {controller.actionError ? <div className={styles.notice + " " + styles.noticeError} role="alert">{controller.actionError}</div> : null}
      {controller.actionNotice ? <div className={styles.notice + " " + styles.noticeSuccess} role="status">{controller.actionNotice}</div> : null}

      {controller.manualLockTarget !== null ? (
        <section className={styles.confirmation} role="region" aria-live="polite" aria-labelledby="manual-lock-title">
          <strong id="manual-lock-title"><AlertTriangle size={17} aria-hidden="true" /> 确认变更人工接管状态</strong>
          <p>{controller.manualLockTarget
            ? "接管后自动处理应保持暂停；人工回复仍只进入安全发送队列。"
            : "解除后服务端可能恢复自动处理；本操作不会重发历史消息。"}</p>
          <div className={styles.confirmationActions}>
            <button className={styles.button} type="button" data-action-id="conversations-manual-lock-cancel" aria-label="取消变更人工接管" onClick={controller.cancelManualLockChange}><X size={15} aria-hidden="true" />取消</button>
            <button className={styles.primaryButton} type="button" data-action-id="conversations-manual-lock-confirm" aria-label="确认变更人工接管" onClick={() => void controller.confirmManualLockChange()}>
              <UserRoundCheck size={15} aria-hidden="true" />确认变更
            </button>
          </div>
        </section>
      ) : null}

      <div className={styles.threadHost}>
        <ConversationThreadPane
          thread={controller.thread}
          actions={controller.actions}
          showBackButton={false}
          showContextButton={false}
          showTransferButton={false}
        />
      </div>
    </section>
  );
}
