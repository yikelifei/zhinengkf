import type { CustomerServiceJourneyStep } from "../../components/customer-service-journey";
import type { OverviewTone } from "../../components/operations-overview";
import type {
  ConversationOperationsQueue,
  DeliveryReadiness,
  ReviewCenter,
  WechatChannelStatus,
} from "../../lib/api";

export function channelStatusLabel(status: string) {
  if (status === "ready") return "已就绪";
  if (status === "needs_runtime") return "缺少运行端";
  if (status === "needs_send_adapter") return "缺少发送适配器";
  if (status === "needs_config") return "缺少配置";
  return status || "未知";
}

export function conversationStateLabel(conversation: ConversationOperationsQueue["records"][number]) {
  if (conversation.isOverdue) return "SLA 超时";
  if (conversation.manualLocked) return "人工接管";
  if (conversation.assignmentState === "unassigned") return "待分配";
  if (Number(conversation.unreadCount || 0) > 0) return "有新消息";
  return conversation.assignee || "AI 托管";
}

export function conversationTone(conversation: ConversationOperationsQueue["records"][number]): OverviewTone {
  if (conversation.isOverdue) return "danger";
  if (conversation.manualLocked || conversation.assignmentState === "unassigned" || Number(conversation.unreadCount || 0) > 0) return "warning";
  return "ready";
}

export function formatDateTime(value?: string | null) {
  if (!value) return "暂无";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function deliveryStatusLabel(status: DeliveryReadiness["status"]) {
  return ({
    ready: "可交付",
    blocked: "外部阻塞",
    failed: "存在失败",
    unknown: "证据不足",
  } as Record<DeliveryReadiness["status"], string>)[status];
}

export function deliveryTone(readiness: DeliveryReadiness): OverviewTone {
  if (readiness.status === "ready") return "ready";
  if (readiness.status === "failed" || readiness.blockers.some((blocker) => !blocker.external)) return "danger";
  return "warning";
}

export function readinessStatusLabel(status: string) {
  return ({ ready: "已就绪", blocked: "被阻塞", missing: "待配置" } as Record<string, string>)[status] || status;
}

export function readinessTone(status: string): OverviewTone {
  if (status === "ready") return "ready";
  if (status === "blocked") return "danger";
  return "warning";
}

export function launchPhaseLabel(phase: string) {
  return ({
    local_configuring: "本机配置中",
    icp_waiting: "备案等待中",
    external_acceptance: "外部验收中",
    production_ready: "生产可用",
  } as Record<string, string>)[phase] || phase;
}

export function launchPhaseGroupLabel(phase: string) {
  return ({ during_icp: "备案期间", after_icp: "备案通过后" } as Record<string, string>)[phase] || phase;
}

export function launchOwnerLabel(owner: string) {
  return ({ developer: "开发", operator: "运营", wechat_admin: "企微管理员" } as Record<string, string>)[owner] || owner;
}

export function buildJourneySteps(input: {
  channelStatus: WechatChannelStatus | null;
  operations: ConversationOperationsQueue | null;
  reviewCenter: ReviewCenter | null;
}): CustomerServiceJourneyStep[] {
  const reviewCount = input.reviewCenter
    ? input.reviewCenter.designJobs.length + input.reviewCenter.quoteDrafts.length + input.reviewCenter.orderDrafts.length
    : null;
  return [
    {
      id: "customer-entry",
      label: "接入客户",
      detail: "配置企业微信客服入口，把链接或二维码交给真实测试客户。",
      statusLabel: input.channelStatus ? input.channelStatus.summary.ready > 0 ? "通道已接通" : "需要配置" : "正在确认",
      tone: input.channelStatus ? input.channelStatus.summary.ready > 0 ? "ready" : "danger" : "muted",
      href: "/integrations/wechat-work/customers",
      actionLabel: "客户入口",
    },
    {
      id: "conversation",
      label: "接待与理解",
      detail: "在企业微信工作台读消息、看真实身份并生成有依据的回复建议。",
      statusLabel: input.operations ? input.operations.summary.total ? `${input.operations.summary.total} 个会话` : "等待首条咨询" : "正在同步",
      tone: input.operations ? input.operations.summary.total ? "ready" : "warning" : "muted",
      href: "/integrations/wechat-work/workspace",
      actionLabel: "处理会话",
    },
    {
      id: "solution",
      label: "商品与方案",
      detail: "从客户需求进入 AI 搭品，再发起绑定当前客户的设计任务。",
      statusLabel: "按客户需求推进",
      tone: "muted",
      href: "/catalog/bundles",
      actionLabel: "开始搭品",
    },
    {
      id: "review",
      label: "人工审核",
      detail: "高价值设计、报价和订单必须人工核对后才能继续。",
      statusLabel: reviewCount === null ? "正在读取" : reviewCount ? `${reviewCount} 项待审核` : "当前无待办",
      tone: reviewCount === null ? "muted" : reviewCount ? "warning" : "ready",
      href: "/reviews/inbox",
      actionLabel: "处理审核",
    },
    {
      id: "sales",
      label: "报价与订单",
      detail: "从核准方案生成报价，核验付款后再建单并跟进履约。",
      statusLabel: "人工确认成交",
      tone: "muted",
      href: "/sales/quotes",
      actionLabel: "销售管理",
    },
    {
      id: "delivery",
      label: "发送与复盘",
      detail: "查看安全发送回执；服务完成后把有效对话沉淀到知识库。",
      statusLabel: input.channelStatus ? input.channelStatus.summary.pendingSendTasks ? `${input.channelStatus.summary.pendingSendTasks} 个待发送` : "发送队列已清" : "正在读取",
      tone: input.channelStatus ? input.channelStatus.summary.pendingSendTasks ? "warning" : "ready" : "muted",
      href: "/send/queue",
      actionLabel: "查看发送",
    },
  ];
}

export function recommendedJourneyAction(input: {
  busy: boolean;
  channelStatus: WechatChannelStatus | null;
  operations: ConversationOperationsQueue | null;
  reviewCount: number | null;
}) {
  if (!input.channelStatus) {
    return {
      label: input.busy ? "正在确认企业微信接入" : "先完成企业微信接入",
      detail: "接入未确认前，不应把页面存在当成客户链路可用。",
      href: "/integrations/wechat-work/customers",
      actionLabel: "检查客户入口",
      tone: input.busy ? "muted" as const : "danger" as const,
    };
  }
  if (!input.channelStatus.summary.ready) {
    return {
      label: "先修复企业微信通道",
      detail: "完成客服账号、回调和官方发送通道后，再邀请客户测试。",
      href: "/integrations/wechat-work/settings",
      actionLabel: "去配置",
      tone: "danger" as const,
    };
  }
  if (!input.operations) {
    return {
      label: "企业微信已接通，正在同步会话",
      detail: "会话列表会独立加载，不再被其他状态检查阻塞。",
      href: "/integrations/wechat-work/workspace",
      actionLabel: "打开工作台",
      tone: "muted" as const,
    };
  }
  if (!input.operations.summary.total) {
    return {
      label: "完成首条真实客户咨询",
      detail: "让测试客户扫码并发送第一句话，确认消息进入工作台。",
      href: "/integrations/wechat-work/customers",
      actionLabel: "生成客户入口",
      tone: "warning" as const,
    };
  }
  if (input.reviewCount) {
    return {
      label: `处理 ${input.reviewCount} 项人工审核`,
      detail: "设计、报价或订单存在待确认事项，审核后才能继续发送或成交。",
      href: "/reviews/inbox",
      actionLabel: "立即审核",
      tone: "warning" as const,
    };
  }
  if (input.channelStatus.summary.pendingSendTasks) {
    return {
      label: `确认 ${input.channelStatus.summary.pendingSendTasks} 个待发送任务`,
      detail: "核对目标客户、内容和官方回执，避免只停留在队列已创建。",
      href: "/send/queue",
      actionLabel: "查看发送队列",
      tone: "warning" as const,
    };
  }
  return {
    label: "进入企业微信处理客户",
    detail: "接入与待办已确认，继续从真实会话推进商品、设计和成交。",
    href: "/integrations/wechat-work/workspace",
    actionLabel: "开始接待",
    tone: "ready" as const,
  };
}
