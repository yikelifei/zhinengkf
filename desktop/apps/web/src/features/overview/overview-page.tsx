"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OperationsOverview,
  type OverviewAction,
  type OverviewChannel,
  type OverviewConversation,
  type OverviewMetric,
  type OverviewTone,
} from "../../components/operations-overview";
import {
  getAutomationReadiness,
  getAutomationStatus,
  getConversationOperationsQueue,
  getNotifications,
  getReviewCenter,
  getWechatChannelStatus,
  type AutomationReadiness,
  type AutomationStatus,
  type ConversationOperationsQueue,
  type IdentityFilters,
  type NotificationItem,
  type ReviewCenter,
  type WechatChannelStatus,
} from "../../lib/api";
import styles from "../governance-pages.module.css";

export type OverviewDestination = "conversations" | "channels" | "automation" | "reviews" | "notifications";

export type OverviewPageProps = {
  identityFilters?: IdentityFilters;
  onNavigate?: (destination: OverviewDestination, context?: { conversationId?: string }) => void;
};

export function OverviewPage({ identityFilters, onNavigate }: OverviewPageProps) {
  const [channelStatus, setChannelStatus] = useState<WechatChannelStatus | null>(null);
  const [operations, setOperations] = useState<ConversationOperationsQueue | null>(null);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus | null>(null);
  const [automationReadiness, setAutomationReadiness] = useState<AutomationReadiness | null>(null);
  const [reviewCenter, setReviewCenter] = useState<ReviewCenter | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refreshSequence = useRef(0);
  const stableIdentityFilters = useMemo<IdentityFilters>(() => ({
    wechatAccountId: identityFilters?.wechatAccountId,
    conversationId: identityFilters?.conversationId,
    customerId: identityFilters?.customerId,
  }), [identityFilters?.conversationId, identityFilters?.customerId, identityFilters?.wechatAccountId]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setBusy(true);
    setError("");
    const results = await Promise.allSettled([
      getWechatChannelStatus(stableIdentityFilters),
      getConversationOperationsQueue(),
      getAutomationStatus(),
      getAutomationReadiness(),
      getReviewCenter(stableIdentityFilters),
      getNotifications(false, stableIdentityFilters),
    ] as const);

    const nextChannelStatus = results[0].status === "fulfilled" ? results[0].value : null;
    const nextOperations = results[1].status === "fulfilled" ? results[1].value : null;
    const nextAutomationStatus = results[2].status === "fulfilled" ? results[2].value : null;
    const nextAutomationReadiness = results[3].status === "fulfilled" ? results[3].value : null;
    const nextReviewCenter = results[4].status === "fulfilled" ? results[4].value : null;
    const nextNotifications = results[5].status === "fulfilled" ? results[5].value : [];

    if (sequence !== refreshSequence.current) return;

    const reviewReadIsAmbiguous = Boolean(nextReviewCenter) &&
      nextReviewCenter!.designJobs.length === 0 &&
      nextReviewCenter!.quoteDrafts.length === 0 &&
      nextReviewCenter!.orderDrafts.length === 0 &&
      nextReviewCenter!.logs.length === 0;
    setChannelStatus(nextChannelStatus);
    setOperations(nextOperations);
    setAutomationStatus(nextAutomationStatus);
    setAutomationReadiness(nextAutomationReadiness);
    setReviewCenter(reviewReadIsAmbiguous ? null : nextReviewCenter);
    setNotifications(nextNotifications);
    if (!nextChannelStatus || !nextOperations || !nextAutomationStatus || !nextAutomationReadiness) {
      setError("总览未取得全部关键服务状态。缺失数据保持未知，不会显示为正常。");
    } else if (reviewReadIsAmbiguous || nextNotifications.length === 0) {
      setError("审核或通知接口返回空结果；当前客户端无法区分真实空队列与读取失败，总览未将其视为全部正常。");
    }
    if (sequence === refreshSequence.current) setBusy(false);
  }, [stableIdentityFilters]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  const navigate = useCallback((destination: OverviewDestination, context?: { conversationId?: string }) => {
    if (onNavigate) {
      onNavigate(destination, context);
      return;
    }
    setNotice("当前宿主尚未接入页面导航；数据没有被修改。请由路由层绑定 onNavigate 后再操作。");
  }, [onNavigate]);

  const channels = useMemo<OverviewChannel[]>(() => channelStatus?.channels.map((channel) => ({
    id: channel.key,
    label: channel.label,
    detail: channel.description,
    statusLabel: channelStatusLabel(channel.status),
    tone: channel.ready ? "ready" : channel.status === "needs_config" ? "danger" : "warning",
    metrics: `${channel.checks.filter((check) => check.passed).length}/${channel.checks.length} 项检查通过`,
  })) ?? [], [channelStatus]);

  const actions = useMemo<OverviewAction[]>(() => {
    const items: OverviewAction[] = [];
    const channelIssues = channelStatus ? channelStatus.summary.total - channelStatus.summary.ready : 0;
    if (channelIssues) {
      items.push({
        id: "channel-issues",
        label: "渠道需要处理",
        detail: "进入渠道页核对运行端、发送适配器和必要配置。",
        count: channelIssues,
        tone: "danger",
        onClick: () => navigate("channels"),
      });
    }
    const operationIssues = operations ? operations.summary.overdue + operations.summary.unassigned : 0;
    if (operationIssues) {
      items.push({
        id: "conversation-issues",
        label: "会话分配与 SLA 需要处理",
        detail: `${operations?.summary.overdue || 0} 个超时，${operations?.summary.unassigned || 0} 个未分配。`,
        count: operationIssues,
        tone: operations?.summary.overdue ? "danger" : "warning",
        onClick: () => navigate("conversations"),
      });
    }
    const reviewCount = reviewCenter
      ? reviewCenter.designJobs.length + reviewCenter.quoteDrafts.length + reviewCenter.orderDrafts.length
      : 0;
    if (reviewCount) {
      items.push({
        id: "review-items",
        label: "人工审核待处理",
        detail: "设计、报价与订单审核已拆到各自页面。",
        count: reviewCount,
        tone: "warning",
        onClick: () => navigate("reviews"),
      });
    }
    const unreadCount = notifications.filter((item) => !item.readAt).length;
    if (unreadCount) {
      items.push({
        id: "unread-notifications",
        label: "未读通知",
        detail: "进入通知中心逐条确认系统提醒。",
        count: unreadCount,
        tone: "warning",
        onClick: () => navigate("notifications"),
      });
    }
    return items;
  }, [channelStatus, navigate, notifications, operations, reviewCenter]);

  const metrics = useMemo<OverviewMetric[]>(() => [
    {
      id: "conversations",
      label: "会话总数",
      value: operations ? String(operations.summary.total) : "—",
      detail: operations ? `${operations.summary.assigned} 个已分配` : "会话服务状态未知",
      tone: operations ? "ready" : "danger",
    },
    {
      id: "overdue",
      label: "SLA 超时",
      value: operations ? String(operations.summary.overdue) : "—",
      detail: operations ? `${operations.summary.noSla} 个未设时限` : "无法确认 SLA",
      tone: !operations ? "danger" : operations.summary.overdue ? "danger" : operations.summary.unassigned ? "warning" : "ready",
    },
    {
      id: "reviews",
      label: "待审核",
      value: reviewCenter ? String(reviewCenter.designJobs.length + reviewCenter.quoteDrafts.length + reviewCenter.orderDrafts.length) : "—",
      detail: reviewCenter ? "设计、报价与订单合计" : "审核服务状态未知",
      tone: reviewCenter ? "warning" : "danger",
    },
    {
      id: "notifications",
      label: "未读通知",
      value: notifications.length ? String(notifications.filter((item) => !item.readAt).length) : "—",
      detail: notifications.length ? "来自当前身份范围" : "通知读取未确认",
      tone: notifications.length ? notifications.some((item) => !item.readAt) ? "warning" : "ready" : "danger",
    },
  ], [notifications, operations, reviewCenter]);

  const conversations = useMemo<OverviewConversation[]>(() => (operations?.records ?? [])
    .slice()
    .sort((left, right) => new Date(right.lastMessageAt || 0).getTime() - new Date(left.lastMessageAt || 0).getTime())
    .slice(0, 6)
    .map((conversation) => ({
      id: conversation.id,
      customer: conversation.customer?.name || conversation.title,
      channel: conversation.channel,
      account: conversation.wechatAccount?.displayName || conversation.wechatAccountId,
      state: conversationStateLabel(conversation),
      stateTone: conversationTone(conversation),
      preview: conversation.lastMessagePreview || "",
      updatedAt: formatDateTime(conversation.lastMessageAt),
      unreadCount: Number(conversation.unreadCount || 0),
      onOpen: () => navigate("conversations", { conversationId: conversation.id }),
    })), [navigate, operations]);

  const automationTone: OverviewTone = !automationReadiness
    ? "danger"
    : automationReadiness.ready
      ? automationStatus?.active ? "ready" : "muted"
      : "danger";

  return (
    <section className={styles.page} aria-labelledby="overview-page-title">
      <div className={styles.heading}>
        <span className={styles.eyebrow}>Overview</span>
        <h1 id="overview-page-title">运营总览</h1>
        <p className={styles.description}>总览只汇总真实状态并导航到责任页面，不在这里直接执行审核、发送或自动化写操作。</p>
      </div>
      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">{notice}</div> : null}
      <OperationsOverview
        updatedAt={channelStatus?.updatedAt || automationReadiness?.checkedAt}
        channels={channels}
        actions={actions}
        metrics={metrics}
        conversations={conversations}
        automationLabel={automationStatus?.active ? "周期自动化运行中" : automationStatus ? "周期自动化已停止" : "自动化状态未知"}
        automationDetail={automationReadiness?.summary || "请先进入自动化运行页核对就绪检查。"}
        automationTone={automationTone}
        onRefresh={() => void refresh()}
        onOpenConversations={() => navigate("conversations")}
        onOpenChannels={() => navigate("channels")}
        onRunAutomation={() => navigate("automation")}
        busy={busy}
      />
    </section>
  );
}

function channelStatusLabel(status: string) {
  if (status === "ready") return "已就绪";
  if (status === "needs_runtime") return "缺少运行端";
  if (status === "needs_send_adapter") return "缺少发送适配器";
  if (status === "needs_config") return "缺少配置";
  return status || "未知";
}

function conversationStateLabel(conversation: ConversationOperationsQueue["records"][number]) {
  if (conversation.isOverdue) return "SLA 超时";
  if (conversation.manualLocked) return "人工接管";
  if (conversation.assignmentState === "unassigned") return "待分配";
  if (Number(conversation.unreadCount || 0) > 0) return "有新消息";
  return conversation.assignee || "AI 托管";
}

function conversationTone(conversation: ConversationOperationsQueue["records"][number]): OverviewTone {
  if (conversation.isOverdue) return "danger";
  if (conversation.manualLocked || conversation.assignmentState === "unassigned" || Number(conversation.unreadCount || 0) > 0) return "warning";
  return "ready";
}

function formatDateTime(value?: string | null) {
  if (!value) return "暂无";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
