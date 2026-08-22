"use client";

import { useCallback, useMemo, useState } from "react";
import {
  OperationsOverview,
  type OverviewAction,
  type OverviewChannel,
  type OverviewConversation,
  type OverviewLaunchItem,
  type OverviewMetric,
  type OverviewTone,
} from "../../components/operations-overview";
import {
  CustomerServiceJourney,
} from "../../components/customer-service-journey";
import type { IdentityFilters } from "../../lib/api";
import styles from "../governance-pages.module.css";
import { automationOverviewPresentation } from "./automation-status-presentation";
import {
  buildJourneySteps,
  channelStatusLabel,
  conversationStateLabel,
  conversationTone,
  deliveryStatusLabel,
  deliveryTone,
  formatDateTime,
  launchOwnerLabel,
  launchPhaseGroupLabel,
  launchPhaseLabel,
  readinessStatusLabel,
  readinessTone,
  recommendedJourneyAction,
} from "./overview-presentation";
import { useOverviewData } from "./use-overview-data";

export type OverviewDestination =
  | "conversations"
  | "channels"
  | "launch"
  | "automation"
  | "reviews"
  | "notifications"
  | "delivery"
  | "sendQueue"
  | "sendBlocked"
  | "wechatSettings"
  | "wechatFlow";

export type OverviewPageProps = {
  identityFilters?: IdentityFilters;
  onNavigate?: (destination: OverviewDestination, context?: { conversationId?: string }) => void;
};

export function OverviewPage({ identityFilters, onNavigate }: OverviewPageProps) {
  const {
    channelStatus,
    operations,
    automationStatus,
    automationReadiness,
    reviewCenter,
    wechatWorkReadiness,
    deliveryReadiness,
    notifications,
    notificationsLoaded,
    agentTasks,
    agentTasksLoaded,
    busy,
    error,
    refresh,
  } = useOverviewData(identityFilters);
  const [notice, setNotice] = useState("");

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
    metrics: `${channel.checks.filter((check) => check.passed).length}/${channel.checks.length} 检查 · ${channel.metrics.queuedSendTasks || 0} 排队 · ${channel.metrics.sendAttentionTasks || 0} 异常`,
  })) ?? [], [channelStatus]);

  const actions = useMemo<OverviewAction[]>(() => {
    const items: OverviewAction[] = [];
    if (deliveryReadiness && deliveryReadiness.status !== "ready") {
      const internalBlockers = deliveryReadiness.blockers.filter((blocker) => !blocker.external).length;
      const externalBlockers = deliveryReadiness.blockers.length - internalBlockers;
      items.push({
        id: "delivery-readiness",
        label: deliveryReadiness.status === "failed" ? "交付验收存在失败项" : "交付验收未闭环",
        detail: deliveryReadiness.nextAction
          || `${internalBlockers} 个内部阻塞，${externalBlockers} 个外部阻塞。`,
        count: Math.max(deliveryReadiness.blockers.length, 1),
        tone: deliveryReadiness.status === "failed" || internalBlockers > 0 ? "danger" : "warning",
        onClick: () => navigate("delivery"),
      });
    }
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
    const queuedSendCount = Number(channelStatus?.summary.queuedSendTasks || 0)
      + Number(channelStatus?.summary.knownInFlightSendTasks || 0);
    if (queuedSendCount) {
      items.push({
        id: "send-queue",
        label: "消息发送队列待处理",
        detail: `${channelStatus?.summary.queuedSendTasks || 0} 项排队，${channelStatus?.summary.knownInFlightSendTasks || 0} 项等待正常回执。`,
        count: queuedSendCount,
        tone: "warning",
        onClick: () => navigate("sendQueue"),
      });
    }
    const sendAttentionCount = Number(channelStatus?.summary.sendAttentionTasks || 0);
    if (sendAttentionCount) {
      items.push({
        id: "send-blocked",
        label: "消息拦截、失败或投递不确定",
        detail: `${channelStatus?.summary.blockedSendTasks || 0} 项拦截，${channelStatus?.summary.failedSendTasks || 0} 项失败，${channelStatus?.summary.unknownDeliveryTasks || 0} 项投递结果待人工确认。`,
        count: sendAttentionCount,
        tone: "danger",
        onClick: () => navigate("sendBlocked"),
      });
    }
    const launchPlan = wechatWorkReadiness?.launchPlan;
    const pendingLaunchItems = launchPlan
      ? [...launchPlan.duringIcp, ...launchPlan.afterIcp].filter((item) => item.status !== "ready").length
      : 0;
    if (wechatWorkReadiness && !wechatWorkReadiness.productionReady) {
      items.push({
        id: "launch-plan",
        label: "企业微信上线计划待推进",
        detail: launchPlan?.recommendedNextAction || "进入企业微信预检页核对本机配置、备案和外部验收条件。",
        count: Math.max(pendingLaunchItems, 1),
        tone: wechatWorkReadiness.status === "blocked" ? "danger" : "warning",
        onClick: () => navigate("launch"),
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
  }, [channelStatus, deliveryReadiness, navigate, notifications, operations, reviewCenter, wechatWorkReadiness]);

  const metrics = useMemo<OverviewMetric[]>(() => [
    {
      id: "delivery",
      label: "交付验收",
      value: deliveryReadiness ? deliveryStatusLabel(deliveryReadiness.status) : "—",
      detail: deliveryReadiness
        ? `BLOCKED ${deliveryReadiness.projectAudit.counts.blocked}，FAIL ${deliveryReadiness.projectAudit.counts.fail}`
        : "交付验收状态未确认",
      tone: deliveryReadiness ? deliveryTone(deliveryReadiness) : "danger",
    },
    {
      id: "conversations",
      label: "会话总数",
      value: operations ? String(operations.summary.total) : "—",
      detail: operations ? `${operations.summary.assigned} 个已分配` : "会话服务状态未知",
      tone: operations ? "ready" : "danger",
    },
    {
      id: "send",
      label: "消息待处理",
      value: channelStatus ? String(channelStatus.summary.sendAttentionTasks || 0) : "—",
      detail: channelStatus
        ? `${channelStatus.summary.queuedSendTasks || 0} 项排队，${channelStatus.summary.unknownDeliveryTasks || 0} 项投递不确定`
        : "发送队列状态未知",
      tone: !channelStatus
        ? "danger"
        : channelStatus.summary.sendAttentionTasks
          ? "danger"
          : channelStatus.summary.queuedSendTasks || channelStatus.summary.knownInFlightSendTasks
            ? "warning"
            : "ready",
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
      value: notificationsLoaded ? String(notifications.filter((item) => !item.readAt).length) : "—",
      detail: notificationsLoaded ? "来自当前身份范围" : "通知读取未确认",
      tone: notificationsLoaded ? notifications.some((item) => !item.readAt) ? "warning" : "ready" : "danger",
    },
    {
      id: "agent-tasks",
      label: "Agent 任务",
      value: agentTasksLoaded ? String(agentTasks.filter((task) => task.status === "awaiting_approval").length) : "—",
      detail: agentTasksLoaded
        ? `${agentTasks.filter((task) => task.status === "executing").length} 项执行中，${agentTasks.filter((task) => ["failed", "unknown_outcome"].includes(task.status)).length} 项异常`
        : "Agent 任务状态未确认",
      tone: !agentTasksLoaded
        ? "danger"
        : agentTasks.some((task) => ["failed", "unknown_outcome"].includes(task.status))
          ? "danger"
          : agentTasks.some((task) => task.status === "awaiting_approval")
            ? "warning"
            : "ready",
    },
  ], [agentTasks, agentTasksLoaded, channelStatus, deliveryReadiness, notifications, notificationsLoaded, operations, reviewCenter]);

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

  const automationPresentation = automationOverviewPresentation(automationStatus, automationReadiness);
  const launchPlan = wechatWorkReadiness?.launchPlan;
  const launchItems = useMemo<OverviewLaunchItem[]>(() => {
    if (!launchPlan) return [];
    return [...launchPlan.duringIcp, ...launchPlan.afterIcp]
      .filter((item) => item.status !== "ready" || launchPlan.currentPhase !== "production_ready")
      .slice(0, 6)
      .map((item) => ({
        id: item.key,
        title: item.title,
        detail: item.detail,
        statusLabel: readinessStatusLabel(item.status),
        tone: readinessTone(item.status),
        phaseLabel: launchPhaseGroupLabel(item.phase),
        ownerLabel: launchOwnerLabel(item.owner),
        action: item.action,
        onClick: () => navigate(launchItemDestination(item.key)),
      }));
  }, [launchPlan, navigate]);
  const launchTone: OverviewTone = !wechatWorkReadiness
    ? "danger"
    : wechatWorkReadiness.productionReady
      ? "ready"
      : wechatWorkReadiness.status === "blocked" ? "danger" : "warning";
  const journeyReviewCount = reviewCenter
    ? reviewCenter.designJobs.length + reviewCenter.quoteDrafts.length + reviewCenter.orderDrafts.length
    : null;
  const journeySteps = useMemo(() => buildJourneySteps({ channelStatus, operations, reviewCenter }), [channelStatus, operations, reviewCenter]);
  const journeyRecommended = recommendedJourneyAction({
    busy,
    channelStatus,
    operations,
    reviewCount: journeyReviewCount,
  });

  return (
    <section className={styles.page} aria-labelledby="operations-overview-title">
      {error ? <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{error}</div> : null}
      {notice ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">{notice}</div> : null}
      <CustomerServiceJourney steps={journeySteps} recommended={journeyRecommended} busy={busy} />
      <OperationsOverview
        updatedAt={channelStatus?.updatedAt || automationReadiness?.checkedAt || deliveryReadiness?.generatedAt}
        channels={channels}
        channelsLoaded={channelStatus !== null}
        actions={actions}
        actionsLoaded={channelStatus !== null && operations !== null && reviewCenter !== null && wechatWorkReadiness !== null && deliveryReadiness !== null && notificationsLoaded}
        metrics={metrics}
        conversations={conversations}
        conversationsLoaded={operations !== null}
        launchLoaded={wechatWorkReadiness !== null}
        launchPhaseLabel={launchPlan ? launchPhaseLabel(launchPlan.currentPhase) : "企业微信上线阶段未确认"}
        launchRecommendedAction={launchPlan?.recommendedNextAction || "刷新总览或进入企业微信预检页确认当前上线条件。"}
        launchTone={launchTone}
        launchItems={launchItems}
        automationLabel={automationPresentation.label}
        automationDetail={automationPresentation.detail}
        automationTone={automationPresentation.tone}
        onRefresh={() => void refresh()}
        onOpenConversations={() => navigate("conversations")}
        onOpenChannels={() => navigate("channels")}
        onOpenLaunchPlan={() => navigate("launch")}
        onRunAutomation={() => navigate("automation")}
        busy={busy}
      />
    </section>
  );
}

function launchItemDestination(key: string): OverviewDestination {
  if (key === "server_contract_ready") return "delivery";
  if (key === "live_receive_send_acceptance") return "wechatFlow";
  if (key === "operator_preflight_ready") return "launch";
  return "wechatSettings";
}
