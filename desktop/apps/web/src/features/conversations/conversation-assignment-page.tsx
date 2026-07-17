"use client";

import Link from "next/link";
import { ConversationOperationsPanel } from "../../components/conversation-operations-panel";
import type { ConversationsFeatureApi } from "./api";
import { ConversationPageState } from "./conversation-page-state";
import styles from "./conversation-pages.module.css";
import { useConversationsController } from "./use-conversations-controller";

export function ConversationAssignmentPage({ api, conversationId }: { api?: ConversationsFeatureApi; conversationId: string }) {
  const controller = useConversationsController(api, conversationId, "assignment");
  if (controller.accessPhase === "loading") {
    return <ConversationPageState title="正在读取分配信息" detail="权限确认后加载负责人、状态与 SLA。" />;
  }
  if (controller.accessPhase === "error") {
    return <ConversationPageState title="无法读取分配信息" detail={controller.accessError} tone="danger" actionLabel="重新检查" onAction={() => void controller.refreshWorkspace()} />;
  }
  if (controller.accessPhase === "denied") {
    return <ConversationPageState title="当前操作员不能查看会话" detail={controller.permissionDetail || "未授予 view_console。"} tone="warning" />;
  }
  if (!controller.selectedConversation) {
    return <ConversationPageState title="未找到会话" detail={controller.inbox.error || "请返回会话列表重新选择。"} tone="warning" />;
  }

  const conversation = controller.selectedConversation;
  return (
    <section className={styles.page} aria-labelledby="conversation-assignment-title" aria-busy={controller.operationsBusy || undefined}>
      <header className={styles.header}>
        <div>
          <h1 id="conversation-assignment-title">分配与 SLA</h1>
          <p>{conversation.title} · 本页只修改负责人、优先级、生命周期和服务时限。</p>
        </div>
        <div className={styles.detailLinks}>
          <Link className={styles.linkButton} href={"/conversations/" + encodeURIComponent(conversation.id)}>返回会话</Link>
          <Link className={styles.linkButton} href="/conversations">返回列表</Link>
        </div>
      </header>

      {!controller.canManageAssignments ? <div className={styles.notice + " " + styles.noticeWarning} role="alert">当前身份没有管理分配权限，本页保持只读。</div> : null}
      <ConversationOperationsPanel
        conversationTitle={conversation.title}
        operations={controller.activeOperations}
        currentOperator={controller.currentOperator}
        busy={controller.operationsBusy || !controller.canManageAssignments}
        error={controller.operationsError || undefined}
        onSave={controller.saveOperations}
      />
    </section>
  );
}
