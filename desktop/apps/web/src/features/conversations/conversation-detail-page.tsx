"use client";

import Link from "next/link";
import { ConversationThreadPane } from "../../components/conversation-workbench/conversation-thread-pane";
import { conversationsFeatureApi, type ConversationsFeatureApi } from "./api";
import { ConversationPageState } from "./conversation-page-state";
import { CustomerUpgradeActionCard } from "./customer-upgrade-action";
import styles from "./conversation-pages.module.css";
import { useConversationsController } from "./use-conversations-controller";
import type { IdentityFilters } from "../../lib/api";
import { conversationListHref, conversationRouteHref, type ConversationListNavigationState } from "./conversation-navigation";

export function ConversationDetailPage({ api, conversationId, identityFilters, navigation }: { api?: ConversationsFeatureApi; conversationId: string; identityFilters?: IdentityFilters; navigation?: ConversationListNavigationState }) {
  const resolvedApi = api || conversationsFeatureApi;
  const controller = useConversationsController(resolvedApi, conversationId, "detail", { expectedIdentity: identityFilters });
  if (controller.accessPhase === "loading") {
    return <ConversationPageState title="正在读取会话" detail="权限确认后加载这条会话的真实消息。" />;
  }
  if (controller.accessPhase === "error") {
    return <ConversationPageState title="无法读取会话" detail={controller.accessError} tone="danger" actionLabel="重新检查" onAction={() => void controller.refreshWorkspace()} />;
  }
  if (controller.accessPhase === "denied") {
    return <ConversationPageState title="当前操作员不能查看会话" detail={controller.permissionDetail || "未授予 view_console。"} tone="warning" />;
  }
  if (!controller.selectedConversation && controller.listReadState !== "ready") {
    return <ConversationPageState title={controller.inbox.error ? "无法安全打开会话" : "正在读取会话"} detail={controller.inbox.error || "正在核对会话及其绑定的企业微信账号和客户身份。"} tone={controller.inbox.error ? "danger" : "neutral"} actionLabel={controller.inbox.error ? "重新读取" : undefined} onAction={controller.inbox.error ? () => void controller.refreshWorkspace() : undefined} />;
  }
  if (!controller.selectedConversation) {
    return <ConversationPageState title="未找到会话" detail={controller.selectionError || "该会话不存在，或已不在当前账号和客户身份范围内。"} tone="warning" actionLabel="返回筛选结果" actionHref={conversationListHref(navigation)} />;
  }

  const conversation = controller.selectedConversation;
  return (
    <section className={`${styles.page} ${styles.detailPage}`} aria-labelledby="conversation-detail-title" aria-busy={controller.listLoading || undefined}>
      <header className={styles.header}>
        <div>
          <h1 id="conversation-detail-title">{conversation.title}</h1>
          <p>智能客服默认自动回复；人工需要补充时直接输入并发送。</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.linkButton} data-action-id="conversations.detail.back-filtered-list" href={conversationListHref(navigation)}>返回筛选结果</Link>
          <Link className={styles.linkButton} data-action-id="conversations.detail.open-context" href={conversationRouteHref("/conversations/" + encodeURIComponent(conversation.id) + "/context", conversation, navigation)}>客户资料</Link>
          <Link className={styles.linkButton} data-action-id="conversations.detail.open-assignment" href={conversationRouteHref("/conversations/" + encodeURIComponent(conversation.id) + "/assignment", conversation, navigation)}>分配与 SLA</Link>
        </div>
      </header>

      {!controller.canReply ? <div className={styles.notice + " " + styles.noticeWarning} role="note">当前身份没有回复权限，本页保持只读。</div> : null}
      {controller.inbox.error ? <div className={styles.notice + " " + styles.noticeWarning} role="alert">会话索引刷新失败，当前仍显示上次成功绑定的客户；{controller.inbox.error}</div> : null}
      {controller.readNotice ? <div className={styles.notice + " " + styles.noticeWarning} role="alert">{controller.readNotice}</div> : null}
      {controller.actionError ? <div className={styles.notice + " " + styles.noticeError} role="alert">{controller.actionError}</div> : null}
      {controller.actionNotice ? <div className={styles.notice + " " + styles.noticeSuccess} role="status">{controller.actionNotice}</div> : null}

      <CustomerUpgradeActionCard
        api={resolvedApi}
        conversation={conversation}
        allowed={Boolean(
          controller.accessStatus?.enforcementReady
          && controller.accessStatus.capabilities.includes("approve_send"),
        )}
        canManageChannels={Boolean(
          controller.accessStatus?.enforcementReady
          && controller.accessStatus.capabilities.includes("manage_channels"),
        )}
      />

      <div className={styles.threadHost}>
        <ConversationThreadPane
          thread={controller.thread}
          actions={controller.actions}
          showBackButton={false}
          showContextButton={false}
          showTransferButton={false}
          variant="wecom"
        />
      </div>
    </section>
  );
}
