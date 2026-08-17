"use client";

import { AlertTriangle, CircleAlert, CircleCheck, MessageSquareText, Radio, RefreshCw, Search, Settings2, UserRoundCheck, UserRoundPlus, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationThreadPane } from "../../components/conversation-workbench/conversation-thread-pane";
import { WorkbenchAvatar, WorkbenchToneTag } from "../../components/conversation-workbench/workbench-primitives";
import {
  getWechatWorkCallbackEventStatus,
  type WechatWorkCallbackEventStatus,
} from "../../lib/api";
import { conversationsFeatureApi, type ConversationsFeatureApi } from "../conversations/api";
import { ConversationPageState } from "../conversations/conversation-page-state";
import { hasCompleteConversationIdentity } from "../conversations/model";
import { useConversationsController } from "../conversations/use-conversations-controller";
import styles from "./wechat-work-workspace-page.module.css";

type WechatWorkWorkspacePageProps = {
  api?: ConversationsFeatureApi;
  getEventStatus?: () => Promise<WechatWorkCallbackEventStatus>;
};

export function WechatWorkWorkspacePage({
  api,
  getEventStatus = getWechatWorkCallbackEventStatus,
}: WechatWorkWorkspacePageProps = {}) {
  const controller = useConversationsController(api || conversationsFeatureApi, null, "detail");
  const [eventStatus, setEventStatus] = useState<WechatWorkCallbackEventStatus | null>(null);
  const [eventStatusError, setEventStatusError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const enterpriseFilterApplied = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const refreshEventStatus = useCallback(async () => {
    try {
      setEventStatus(await getEventStatus());
      setEventStatusError("");
    } catch (error) {
      setEventStatusError(errorMessage(error, "企业微信回调状态读取失败"));
    }
  }, [getEventStatus]);

  useEffect(() => {
    if (enterpriseFilterApplied.current) return;
    enterpriseFilterApplied.current = true;
    controller.actions.onChannelChange("work_wechat");
  }, [controller.actions]);

  useEffect(() => {
    if (controller.selectedConversation || !controller.inbox.conversations.length) return;
    controller.actions.onSelectConversation(controller.inbox.conversations[0].id);
  }, [controller.actions, controller.inbox.conversations, controller.selectedConversation]);

  useEffect(() => {
    void refreshEventStatus();
    const timer = window.setInterval(() => void refreshEventStatus(), 2_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshEventStatus();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshEventStatus]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (event.key === "Escape" && document.activeElement === searchInputRef.current && controller.inbox.search) {
        event.preventDefault();
        controller.actions.onSearchChange("");
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [controller.actions, controller.inbox.search]);

  const refreshWorkspace = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([controller.refreshWorkspace(), refreshEventStatus()]);
    } finally {
      setRefreshing(false);
    }
  };

  if (controller.accessPhase === "loading") {
    return <ConversationPageState title="正在连接企业微信会话" detail="权限确认后读取已由官方回调同步的真实客户消息。" />;
  }
  if (controller.accessPhase === "error") {
    return <ConversationPageState title="企业微信工作台暂不可用" detail={controller.accessError} tone="danger" actionLabel="重新连接" onAction={() => void refreshWorkspace()} />;
  }
  if (controller.accessPhase === "denied") {
    return <ConversationPageState title="当前操作员不能查看企业微信会话" detail={controller.permissionDetail || "未授予 view_console。"} tone="warning" />;
  }

  const inbox = controller.inbox;
  const statusPresentation = presentEventStatus(eventStatus, eventStatusError);
  const selectedConversation = controller.selectedConversation;
  const selectedIdentityReady = Boolean(selectedConversation && hasCompleteConversationIdentity(selectedConversation));

  return (
    <section className={styles.page} aria-labelledby="wechat-work-workspace-title">
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 id="wechat-work-workspace-title">企业微信</h1>
          <span className={styles.connectionStatus} data-tone={statusPresentation.tone} title={statusPresentation.detail}>
            {statusPresentation.tone === "ready"
              ? <CircleCheck size={14} aria-hidden="true" />
              : <CircleAlert size={14} aria-hidden="true" />}
            {statusPresentation.label}
          </span>
        </div>
        <div className={styles.headerActions}>
          {controller.selectedConversation ? (
            <Link href={`/conversations/${encodeURIComponent(controller.selectedConversation.id)}`}>
              <MessageSquareText size={15} aria-hidden="true" />完整处理页
            </Link>
          ) : null}
          <Link href="/integrations/wechat-work/settings">
            <Settings2 size={15} aria-hidden="true" />通道配置
          </Link>
          <button type="button" data-action-id="wechat-work.workspace.refresh" aria-label="刷新企业微信会话工作台" onClick={() => void refreshWorkspace()} disabled={refreshing || inbox.loading}>
            <RefreshCw size={15} aria-hidden="true" />{refreshing ? "刷新中" : "刷新"}
          </button>
        </div>
      </header>

      <div
        className={styles.syncBar}
        data-tone={statusPresentation.tone}
        role={statusPresentation.tone === "danger" ? "alert" : "status"}
        title={statusPresentation.detail}
      >
        <span><Radio size={13} aria-hidden="true" />官方回调 + sync_msg</span>
        <span>回复：kf/send_msg 安全队列</span>
        <span>2 秒同步</span>
        <span>最近事件：{formatTimestamp(eventStatus?.lastEventAt)}</span>
      </div>
      <div className={styles.workspaceGuidance}>
        {selectedConversation ? (
          <div className={styles.serviceBar} data-locked={selectedConversation.manualLocked ? "true" : "false"}>
            <div className={styles.serviceIdentity}>
              <strong>{selectedConversation.customer?.name || selectedConversation.title || "未命名客户"}</strong>
              <span>{selectedIdentityReady ? "客服账号、会话、客户身份已绑定" : "身份不完整，回复和接管已禁用"}</span>
              <small>当前是微信客服咨询身份；长期客户关系仍需客户确认添加企业微信专员。</small>
            </div>
            <div className={styles.serviceState}>
              <span data-tone={selectedConversation.manualLocked ? "warning" : "ready"}>
                {selectedConversation.manualLocked ? "人工接管中 · 自动处理暂停" : "自动处理可用 · 尚未人工接管"}
              </span>
              <div className={styles.serviceActions}>
                <Link href={`/conversations/${encodeURIComponent(selectedConversation.id)}`}>
                  <UserRoundPlus size={14} aria-hidden="true" />客户资料与长期服务
                </Link>
                <button
                  type="button"
                  data-action-id="wechat-work.workspace.manual-takeover"
                  aria-label={selectedConversation.manualLocked ? "解除当前会话人工接管" : "人工接管当前会话"}
                  data-disabled-reason={!selectedIdentityReady ? "当前会话身份不完整" : !controller.canReply ? "当前操作员没有回复权限" : undefined}
                  onClick={controller.requestManualLockChange}
                  disabled={!selectedIdentityReady || !controller.canReply || controller.manualLockBusy}
                >
                  <UserRoundCheck size={14} aria-hidden="true" />
                  {controller.manualLockBusy ? "处理中" : selectedConversation.manualLocked ? "解除人工接管" : "人工接管"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.serviceBarEmpty}>选择一条客户会话后，可在这里核对身份并决定是否人工接管。</div>
        )}
        {controller.readNotice ? <div className={styles.readNotice} role="alert">{controller.readNotice}</div> : null}
        {controller.actionError ? <div className={styles.actionNotice} data-tone="danger" role="alert">{controller.actionError}</div> : null}
        {controller.actionNotice ? <div className={styles.actionNotice} data-tone="ready" role="status">{controller.actionNotice}</div> : null}
        {controller.manualLockTarget !== null ? (
          <div className={styles.manualConfirmation} role="region" aria-live="polite" aria-labelledby="workspace-manual-lock-title">
            <div>
              <strong id="workspace-manual-lock-title"><AlertTriangle size={15} aria-hidden="true" />确认变更人工接管</strong>
              <span>{controller.manualLockTarget
                ? "接管后自动处理暂停，人工回复仍通过企业微信安全发送队列。"
                : "解除后服务端可能恢复自动处理，本操作不会重发历史消息。"}</span>
            </div>
            <div className={styles.serviceActions}>
              <button type="button" data-action-id="wechat-work.workspace.manual-takeover-cancel" aria-label="取消人工接管状态变更" onClick={controller.cancelManualLockChange}><X size={14} aria-hidden="true" />取消</button>
              <button className={styles.confirmButton} type="button" data-action-id="wechat-work.workspace.manual-takeover-confirm" aria-label="确认人工接管状态变更" onClick={() => void controller.confirmManualLockChange()}>
                <UserRoundCheck size={14} aria-hidden="true" />确认变更
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.workspace}>
        <aside className={styles.inbox} aria-label="企业微信客户会话列表">
          <div className={styles.inboxHeader}>
            <div><strong>消息</strong><span>{inbox.loading && !inbox.total ? "正在同步会话…" : `${inbox.total} 个会话`}</span></div>
            <span>{inbox.loading && !inbox.total ? "请稍候" : inbox.pendingCount ? `${inbox.pendingCount} 个未读` : "全部已读"}</span>
          </div>

          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <span className={styles.srOnly}>搜索企业微信会话</span>
            <input
              ref={searchInputRef}
              type="search"
              value={inbox.search}
              placeholder="搜索客户、账号或消息"
              aria-keyshortcuts="Control+F Meta+F"
              onChange={(event) => controller.actions.onSearchChange(event.target.value)}
            />
            <kbd>Ctrl F</kbd>
          </label>

          <div className={styles.scopeTabs} role="group" aria-label="会话范围">
            {inbox.scopeOptions.map((option) => (
                <button
                  type="button"
                  data-action-id={`wechat-work.workspace.scope-${option.value}.select`}
                  aria-label={`查看${option.label}会话`}
                  key={option.value}
                data-active={inbox.scope === option.value ? "true" : "false"}
                onClick={() => controller.actions.onScopeChange(option.value)}
              >
                {option.label}<span>{option.count ?? 0}</span>
              </button>
            ))}
          </div>

          {inbox.error ? <div className={styles.listState} data-tone="danger" role="alert">{inbox.error}</div> : null}
          {inbox.loading && !inbox.conversations.length ? (
            <div className={styles.listState} role="status"><strong>正在同步企业微信会话</strong><span>会话列表会先加载，AI 和其他运营状态不会阻塞这里。</span></div>
          ) : null}
          {!inbox.loading && !inbox.error && !inbox.conversations.length ? (
            <div className={styles.listState} role="status">
              <strong>{inbox.emptyTitle}</strong><span>{inbox.emptyDetail}</span>
              {!inbox.search && inbox.scope === "all" ? (
                <Link className={styles.emptyAction} href="/integrations/wechat-work/customers">
                  <UserRoundPlus size={14} aria-hidden="true" />创建客户入口并验证首条来信
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className={styles.conversationList} aria-busy={inbox.loading || undefined}>
            {inbox.conversations.map((conversation) => (
                <button
                  type="button"
                  data-action-id={`wechat-work.workspace.conversation-${conversation.id}.select`}
                  aria-label={`打开与${conversation.title}的会话`}
                  className={styles.conversationRow}
                data-selected={inbox.selectedConversationId === conversation.id ? "true" : "false"}
                aria-current={inbox.selectedConversationId === conversation.id ? "true" : undefined}
                onClick={() => controller.actions.onSelectConversation(conversation.id)}
                key={conversation.id}
              >
                <WorkbenchAvatar avatar={conversation.avatar} size="medium" />
                <span className={styles.conversationCopy}>
                  <span className={styles.conversationTitle}>
                    <strong>{conversation.title}</strong><time>{conversation.updatedAtLabel}</time>
                  </span>
                  <span className={styles.preview} data-draft={conversation.draftPreview ? "true" : undefined}>
                    {conversation.draftPreview ? `草稿：${conversation.draftPreview}` : conversation.preview}
                  </span>
                  <span className={styles.conversationMeta}>
                    {conversation.stateLabel ? <WorkbenchToneTag tone={conversation.stateTone || "neutral"}>{conversation.stateLabel}</WorkbenchToneTag> : null}
                    {conversation.unreadCount ? <b aria-label={`${conversation.unreadCount} 条未读消息`}>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</b> : null}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {inbox.pageCount > 1 ? (
            <div className={styles.pagination}>
              <button type="button" data-action-id="wechat-work.workspace.pagination.previous" aria-label="查看上一页会话" disabled={inbox.page <= 1} onClick={() => controller.actions.onPageChange(inbox.page - 1)}>上一页</button>
              <span>{inbox.page} / {inbox.pageCount}</span>
              <button type="button" data-action-id="wechat-work.workspace.pagination.next" aria-label="查看下一页会话" disabled={inbox.page >= inbox.pageCount} onClick={() => controller.actions.onPageChange(inbox.page + 1)}>下一页</button>
            </div>
          ) : null}
        </aside>

        <div className={styles.threadHost}>
          {inbox.loading && !inbox.conversations.length ? (
            <ConversationPageState title="正在读取真实客户消息" detail="会话到达后会自动选择最新客户；无需离开页面重复刷新。" />
          ) : (
            <ConversationThreadPane
              thread={controller.thread}
              actions={controller.actions}
              showBackButton={false}
              showContextButton={false}
              showTransferButton={false}
              variant="wecom"
            />
          )}
        </div>
      </div>
    </section>
  );
}

function presentEventStatus(status: WechatWorkCallbackEventStatus | null, error: string) {
  if (error) return { tone: "danger", label: "回调状态不可用", detail: error } as const;
  if (!status) return { tone: "warning", label: "正在读取回调状态", detail: "正在确认桌面端与企业微信回调桥的连接状态。" } as const;
  if (status.connected && status.lastEventAt) {
    return { tone: "ready", label: "官方消息链路已收到事件", detail: "回调事件已到达桌面服务；页面会持续读取已入库的增量消息。" } as const;
  }
  if (status.connected) {
    return { tone: "warning", label: "回调桥已连接，等待消息", detail: "连接已建立，但本次运行尚未收到真实企业微信事件。" } as const;
  }
  if (status.configured) {
    const retry = status.reconnects ? `，已重连 ${status.reconnects} 次` : "";
    return { tone: "danger", label: "回调桥未连接", detail: `桌面回调桥当前断开${retry}${status.lastError ? `：${status.lastError}` : ""}。` } as const;
  }
  return { tone: "danger", label: "回调桥未配置", detail: "当前只能读取已经入库的消息；需要完成企业微信公网回调和桌面事件桥配置才能自动接收新消息。" } as const;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "尚未收到";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间无效";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function errorMessage(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  return detail ? `${fallback}：${detail}` : fallback;
}
