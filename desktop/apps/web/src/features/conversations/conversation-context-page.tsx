"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ConversationsFeatureApi } from "./api";
import { ConversationPageState } from "./conversation-page-state";
import styles from "./conversation-pages.module.css";
import { useConversationsController } from "./use-conversations-controller";
import type { IdentityFilters } from "../../lib/api";
import { conversationListHref, conversationRouteHref, type ConversationListNavigationState } from "./conversation-navigation";

export function ConversationContextPage({ api, conversationId, identityFilters, navigation }: { api?: ConversationsFeatureApi; conversationId: string; identityFilters?: IdentityFilters; navigation?: ConversationListNavigationState }) {
  const controller = useConversationsController(api, conversationId, "context", { expectedIdentity: identityFilters });
  if (controller.accessPhase === "loading") {
    return <ConversationPageState title="正在读取客户资料" detail="权限确认后加载当前会话绑定的真实上下文。" />;
  }
  if (controller.accessPhase === "error") {
    return <ConversationPageState title="无法读取客户资料" detail={controller.accessError} tone="danger" actionLabel="重新检查" onAction={() => void controller.refreshWorkspace()} />;
  }
  if (controller.accessPhase === "denied") {
    return <ConversationPageState title="当前操作员不能查看会话" detail={controller.permissionDetail || "未授予 view_console。"} tone="warning" />;
  }
  if ((!controller.selectedConversation || !controller.context) && controller.listReadState !== "ready") {
    return <ConversationPageState title={controller.inbox.error ? "无法安全读取客户资料" : "正在读取客户资料"} detail={controller.inbox.error || "正在核对会话及其绑定身份。"} tone={controller.inbox.error ? "danger" : "neutral"} actionLabel={controller.inbox.error ? "重新读取" : undefined} onAction={controller.inbox.error ? () => void controller.refreshWorkspace() : undefined} />;
  }
  if (!controller.selectedConversation || !controller.context) {
    return <ConversationPageState title="未找到会话资料" detail={controller.selectionError || "该会话不存在，或已不在当前账号和客户身份范围内。"} tone="warning" actionLabel="返回筛选结果" actionHref={conversationListHref(navigation)} />;
  }

  const conversation = controller.selectedConversation;
  const context = controller.context;
  return (
    <section className={styles.page} aria-labelledby="conversation-context-title">
      <header className={styles.header}>
        <div>
          <h1 id="conversation-context-title">客户与会话资料</h1>
          <p>{conversation.title} · 本页只读展示客户、任务、服务状态和发送身份。</p>
        </div>
        <div className={styles.detailLinks}>
          <Link className={styles.linkButton} data-action-id="conversations.context.back-detail" href={conversationRouteHref("/conversations/" + encodeURIComponent(conversation.id), conversation, navigation)}>返回会话</Link>
          <Link className={styles.primaryButton} data-action-id="conversations.context.open-assignment" href={conversationRouteHref("/conversations/" + encodeURIComponent(conversation.id) + "/assignment", conversation, navigation)}>修改分配与 SLA</Link>
        </div>
      </header>

      <div className={styles.contextGrid}>
        <ContextSection title="客户身份">
          <dl className={styles.definitionList}>
            <Fact label="客户" value={context.customer.name} />
            <Fact label="微信标识" value={context.customer.wechatId || "未提供"} />
            <Fact label="地区" value={context.customer.region || "未提供"} />
            <Fact label="来源" value={context.customer.source || "未提供"} />
            <Fact label="标签" value={context.tags.length ? context.tags.join("、") : "暂无"} />
          </dl>
        </ContextSection>
        <ContextSection title="当前任务">
          {context.task ? (
            <dl className={styles.definitionList}>
              <Fact label="任务" value={context.task.title} />
              <Fact label="状态" value={context.task.stateLabel} />
              <Fact label="编号" value={context.task.taskNumber || context.task.id} />
              <Fact label="交付时间" value={context.task.dueAtLabel || "未提供"} />
            </dl>
          ) : <p>当前会话没有关联设计任务。</p>}
        </ContextSection>
        <ContextSection title="接待与 SLA">
          {controller.operationsReadState === "ready" || controller.operationsReadState === "refreshing" || controller.operationsReadState === "stale" ? <><dl className={styles.definitionList}>
            <Fact label="接待客服" value={context.assignment.assignee} />
            <Fact label="分配状态" value={context.assignment.statusLabel} />
            <Fact label="优先级" value={context.sla.priorityLabel || "未设置"} />
            <Fact label="服务状态" value={context.sla.stateLabel} />
            <Fact label="处理截止" value={context.sla.deadlineLabel || "未设置"} />
          </dl>{controller.operationsReadState === "refreshing" ? <div className={styles.inlineReadWarning} role="status">正在刷新分配与 SLA，以上为上次成功结果；刷新完成前不可修改。</div> : null}{controller.operationsReadState === "stale" ? <div className={styles.inlineReadWarning} role="alert"><span>最新分配与 SLA 刷新失败，以上为上次成功结果；修改前请重新读取。{controller.operationsReadError}</span><button className={styles.button} type="button" data-action-id="conversations-context-refresh-operations" onClick={() => void controller.refreshWorkspace()}>重新读取</button></div> : null}</> : <div className={styles.inlineReadWarning} role={controller.operationsReadState === "unknown" ? "alert" : "status"}>{controller.operationsReadState === "loading" ? "正在读取分配与 SLA。" : `分配与 SLA 尚未成功读取，不能据此认定为未分配或未设置。${controller.operationsReadError}`}{controller.operationsReadState === "unknown" ? <button className={styles.button} type="button" data-action-id="conversations-context-retry-operations" onClick={() => void controller.refreshWorkspace()}>重新读取</button> : null}</div>}
        </ContextSection>
        <ContextSection title="发送身份">
          <dl className={styles.definitionList}>
            <Fact label="接入账号" value={context.safetyIdentity.accountLabel} />
            <Fact label="会话类型" value={context.safetyIdentity.channelLabel} />
            <Fact label="当前窗口" value={context.safetyIdentity.windowLabel || "未提供"} />
            <Fact label="桥接状态" value={context.safetyIdentity.bridgeLabel || "未提供"} />
          </dl>
        </ContextSection>
      </div>
    </section>
  );
}

function ContextSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.contextSection}><h2>{title}</h2>{children}</section>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
