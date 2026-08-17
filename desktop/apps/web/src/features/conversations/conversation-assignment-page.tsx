"use client";

import Link from "next/link";
import { ConversationOperationsPanel } from "../../components/conversation-operations-panel";
import type { ConversationsFeatureApi } from "./api";
import { ConversationPageState } from "./conversation-page-state";
import styles from "./conversation-pages.module.css";
import { useConversationsController } from "./use-conversations-controller";
import type { IdentityFilters } from "../../lib/api";
import { conversationListHref, conversationRouteHref, type ConversationListNavigationState } from "./conversation-navigation";

export function ConversationAssignmentPage({ api, conversationId, identityFilters, navigation }: { api?: ConversationsFeatureApi; conversationId: string; identityFilters?: IdentityFilters; navigation?: ConversationListNavigationState }) {
  const controller = useConversationsController(api, conversationId, "assignment", { expectedIdentity: identityFilters });
  if (controller.accessPhase === "loading") {
    return <ConversationPageState title="正在读取分配信息" detail="权限确认后加载负责人、状态与 SLA。" />;
  }
  if (controller.accessPhase === "error") {
    return <ConversationPageState title="无法读取分配信息" detail={controller.accessError} tone="danger" actionLabel="重新检查" onAction={() => void controller.refreshWorkspace()} />;
  }
  if (controller.accessPhase === "denied") {
    return <ConversationPageState title="当前操作员不能查看会话" detail={controller.permissionDetail || "未授予 view_console。"} tone="warning" />;
  }
  if (!controller.selectedConversation && controller.listReadState !== "ready") {
    return <ConversationPageState title={controller.inbox.error ? "无法安全读取分配信息" : "正在读取分配信息"} detail={controller.inbox.error || "正在核对会话及其绑定身份。"} tone={controller.inbox.error ? "danger" : "neutral"} actionLabel={controller.inbox.error ? "重新读取" : undefined} onAction={controller.inbox.error ? () => void controller.refreshWorkspace() : undefined} />;
  }
  if (!controller.selectedConversation) {
    return <ConversationPageState title="未找到会话" detail={controller.selectionError || "该会话不存在，或已不在当前账号和客户身份范围内。"} tone="warning" actionLabel="返回筛选结果" actionHref={conversationListHref(navigation)} />;
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
          <Link className={styles.linkButton} data-action-id="conversations.assignment.back-detail" href={conversationRouteHref("/conversations/" + encodeURIComponent(conversation.id), conversation, navigation)}>返回会话</Link>
          <Link className={styles.linkButton} data-action-id="conversations.assignment.back-filtered-list" href={conversationListHref(navigation)}>返回筛选结果</Link>
        </div>
      </header>

      {!controller.canManageAssignments ? <div className={styles.notice + " " + styles.noticeWarning} role="alert">当前身份没有管理分配权限，本页保持只读。</div> : null}
      {controller.operationsNotice ? <div className={styles.notice + " " + styles.noticeSuccess} role="status">{controller.operationsNotice}</div> : null}
      <ConversationOperationsPanel
        conversationTitle={conversation.title}
        operations={controller.activeOperations}
        currentOperator={controller.currentOperator}
        readState={controller.operationsReadState}
        busy={controller.operationsBusy || controller.operationsReadState !== "ready" || !controller.canManageAssignments}
        error={controller.operationsError || undefined}
        onRetry={() => void controller.refreshWorkspace()}
        onSave={controller.saveOperations}
      />
    </section>
  );
}
