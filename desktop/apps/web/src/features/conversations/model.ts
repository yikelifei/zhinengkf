import type {
  ConversationWorkbenchContext,
  ConversationWorkbenchConversation,
  ConversationWorkbenchMessage,
  ConversationWorkbenchThread,
  ConversationWorkbenchTone,
} from "../../components/conversation-workbench";
import type {
  Conversation,
  ConversationIdentity,
  ConversationOperations,
  ConversationTimelineItem,
} from "../../lib/api";

export type ConversationListFilters = {
  search: string;
  scope: "all" | "unread" | "manual";
  channel: string;
  status: "all" | "unassigned" | "overdue" | ConversationOperations["status"];
  sort: "priority" | "latest" | "oldest";
};

export type ConversationSuggestionState = {
  text: string;
  sourceText: string;
  loading: boolean;
  error: string;
};

export const DEFAULT_CONVERSATION_FILTERS: ConversationListFilters = {
  search: "",
  scope: "all",
  channel: "all",
  status: "all",
  sort: "priority",
};

const priorityWeight: Record<ConversationOperations["priority"], number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

export function conversationIdentity(conversation: Conversation): ConversationIdentity {
  return {
    wechatAccountId: conversation.wechatAccountId,
    conversationId: conversation.id,
    customerId: conversation.customerId,
  };
}

export function filterAndSortConversations(
  conversations: Conversation[],
  operationsById: Map<string, ConversationOperations>,
  filters: ConversationListFilters,
) {
  const search = filters.search.trim().toLocaleLowerCase("zh-CN");
  const visible = conversations.filter((conversation) => {
    const operations = operationsById.get(conversation.id);
    const searchable = [
      conversation.title,
      conversation.customer?.name,
      conversation.customer?.wechatId,
      conversation.customer?.phone,
      conversation.wechatAccount?.displayName,
      conversation.lastMessagePreview,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    if (search && !searchable.includes(search)) return false;
    if (filters.scope === "unread" && !Number(conversation.unreadCount || 0)) return false;
    if (filters.scope === "manual" && !conversation.manualLocked) return false;
    if (filters.channel !== "all" && normalizeChannel(conversation) !== filters.channel) return false;
    if (filters.status === "unassigned" && operations?.assignmentState !== "unassigned") return false;
    if (filters.status === "overdue" && !operations?.isOverdue) return false;
    if (["open", "pending", "resolved", "closed"].includes(filters.status) && operations?.status !== filters.status) {
      return false;
    }
    return true;
  });

  return [...visible].sort((left, right) => {
    const leftTime = dateValue(left.lastMessageAt);
    const rightTime = dateValue(right.lastMessageAt);
    if (filters.sort === "latest") return rightTime - leftTime;
    if (filters.sort === "oldest") return leftTime - rightTime;
    const attentionGap = attentionScore(right, operationsById.get(right.id)) - attentionScore(left, operationsById.get(left.id));
    return attentionGap || rightTime - leftTime;
  });
}

export function toWorkbenchConversation(
  conversation: Conversation,
  operations?: ConversationOperations,
): ConversationWorkbenchConversation {
  const title = conversation.customer?.name || conversation.title || "未命名客户";
  const overdue = Boolean(operations?.isOverdue);
  const unassigned = operations?.assignmentState === "unassigned";
  const stateLabel = overdue
    ? "SLA 超时"
    : conversation.manualLocked
      ? "人工接管"
      : unassigned
        ? "待分配"
        : operations?.assignee || lifecycleLabel(operations?.status) || "未配置";
  const stateTone: ConversationWorkbenchTone = overdue
    ? "danger"
    : conversation.manualLocked || unassigned
      ? "warning"
      : operations
        ? "success"
        : "neutral";
  return {
    id: conversation.id,
    title,
    subtitle: conversation.wechatAccount?.displayName || conversation.wechatAccountId,
    avatar: { fallback: title.slice(0, 1) || "客", alt: `${title}头像` },
    channelLabel: channelLabel(conversation),
    channelTone: normalizeChannel(conversation) === "personal_wechat" ? "success" : "brand",
    preview: conversation.lastMessagePreview || "暂无消息摘要",
    updatedAtLabel: conversation.lastMessageAt ? formatDateTime(conversation.lastMessageAt) : "",
    unreadCount: Number(conversation.unreadCount || 0),
    stateLabel,
    stateTone,
  };
}

export function toWorkbenchThread(input: {
  conversation: Conversation;
  timeline: ConversationTimelineItem[];
  timelineLoading: boolean;
  timelineError: string;
  replyText: string;
  replyBusy: boolean;
  replyFeedback: string;
  canReply: boolean;
  suggestion: ConversationSuggestionState;
}): ConversationWorkbenchThread {
  const { conversation, suggestion } = input;
  const title = conversation.customer?.name || conversation.title || "未命名客户";
  const personal = normalizeChannel(conversation) === "personal_wechat";
  const permissionNotice = input.canReply
    ? []
    : [{ id: "reply-permission", tone: "danger" as const, text: "当前操作员没有回复会话权限", detail: "人工回复和接管操作保持禁用。" }];
  return {
    participant: {
      name: title,
      avatar: { fallback: title.slice(0, 1) || "客", alt: `${title}头像` },
      accountLabel: conversation.wechatAccount?.displayName || conversation.wechatAccountId,
      channelLabel: channelLabel(conversation),
      channelTone: personal ? "success" : "brand",
      onlineLabel: conversation.wechatAccount ? (conversation.wechatAccount.isActive ? "在线" : "离线") : "状态待核验",
      online: Boolean(conversation.wechatAccount?.isActive),
    },
    serviceStatusLabel: conversation.manualLocked ? "人工服务中" : "自动处理可用",
    serviceStatusTone: conversation.manualLocked ? "warning" : "success",
    manualTakeoverLabel: conversation.manualLocked ? "已人工接管" : undefined,
    safetyNotice: personal
      ? "个人微信回复只会进入安全发送队列；账号与聊天窗口由发送端再次核验。"
      : "企业微信回复只会进入后端发送队列；最终发送结果以服务端状态为准。",
    timelineLabel: "完整会话记录",
    messages: input.timeline.map((item) => toWorkbenchMessage(item, title)),
    incidents: [],
    notices: [
      ...(conversation.manualLocked
        ? [{ id: "manual-lock", tone: "warning" as const, text: "当前会话已由人工接管", detail: "自动处理暂停；人工回复仍需通过安全队列。" }]
        : []),
      ...permissionNotice,
    ],
    suggestion: {
      activeTab: "ai",
      tabs: [{ value: "ai", label: "AI 回复建议" }],
      title: "仅生成建议，不自动发送",
      verificationLabel: suggestion.text ? "待人工确认" : "按需生成",
      text: suggestion.text || undefined,
      sourceDetail: suggestion.sourceText ? `依据最近客户消息：${suggestion.sourceText.slice(0, 100)}` : undefined,
      loading: suggestion.loading,
      error: suggestion.error || undefined,
      useActionLabel: "填入回复框",
      regenerateActionLabel: "生成建议",
    },
    safetyChecks: [
      {
        id: "identity",
        label: "客户与账号身份",
        statusLabel: conversation.customerId && conversation.wechatAccountId ? "已绑定" : "缺少身份",
        tone: conversation.customerId && conversation.wechatAccountId ? "success" : "danger",
      },
      {
        id: "delivery",
        label: "最终发送校验",
        statusLabel: "发送时复核",
        tone: "warning",
      },
      {
        id: "content",
        label: "回复内容",
        statusLabel: input.replyText.trim() ? "已填写" : "待填写",
        tone: input.replyText.trim() ? "success" : "warning",
      },
    ],
    composer: {
      value: input.replyText,
      placeholder: input.canReply ? "输入人工回复（提交后进入安全发送队列）" : "当前没有回复会话权限",
      maxLength: 2000,
      disabled: !input.canReply,
      sending: input.replyBusy,
      sendLabel: "入队发送",
      tools: [],
      feedback: input.replyFeedback || undefined,
      feedbackTone: feedbackTone(input.replyFeedback),
    },
    loading: input.timelineLoading,
    error: input.timelineError || undefined,
    emptyTitle: "还没有消息",
    emptyDetail: "客户发送消息或客服回复后，会显示在这里。",
  };
}

export function toWorkbenchContext(
  conversation: Conversation,
  operations: ConversationOperations | undefined,
): ConversationWorkbenchContext {
  const title = conversation.customer?.name || conversation.title || "未命名客户";
  const personal = normalizeChannel(conversation) === "personal_wechat";
  return {
    customer: {
      name: title,
      avatar: { fallback: title.slice(0, 1) || "客", alt: `${title}头像` },
      wechatId: conversation.customer?.wechatId || conversation.customerId,
      source: conversation.customer?.source || channelLabel(conversation),
      relationLabel: personal ? "个人微信" : "企业微信",
      relationTone: personal ? "success" : "brand",
    },
    tags: conversation.customer?.tags || [],
    notes: conversation.customer?.notes || undefined,
    noteDateLabel: conversation.customer?.updatedAt ? formatDateTime(conversation.customer.updatedAt) : undefined,
    task: null,
    assignment: {
      assignee: operations?.assignee || "未分配",
      statusLabel: operations?.assignmentState === "assigned" ? "服务中" : "待分配",
      statusTone: operations?.assignmentState === "assigned" ? "success" : "warning",
    },
    sla: {
      stateLabel: operations?.isOverdue ? "SLA 超时" : operations?.slaState === "on_track" ? "SLA 正常" : "未设 SLA",
      stateTone: operations?.isOverdue ? "danger" : operations?.slaState === "on_track" ? "success" : "warning",
      priorityLabel: operations ? priorityLabel(operations.priority) : "未配置",
      lifecycleLabel: operations ? lifecycleLabel(operations.status) : "未配置",
      firstResponseLabel: operations?.firstResponseAt
        ? formatDateTime(operations.firstResponseAt)
        : operations?.firstResponseDueAt
          ? `截止 ${formatDateTime(operations.firstResponseDueAt)}`
          : "未设置",
      deadlineLabel: operations?.slaDueAt ? formatDateTime(operations.slaDueAt) : "未设置",
      freshnessLabel: operations ? "已载入" : "状态不可用",
      freshnessTone: operations ? "success" : "warning",
    },
    safetyIdentity: {
      accountLabel: conversation.wechatAccount?.displayName || conversation.wechatAccountId,
      accountStateLabel: conversation.wechatAccount ? (conversation.wechatAccount.isActive ? "在线" : "离线") : undefined,
      channelLabel: channelLabel(conversation),
      windowLabel: "发送时由后端复核",
      recentMessageLabel: conversation.lastMessagePreview || "暂无消息摘要",
      bridgeLabel: "实时状态由发送端判定",
      bridgeTone: "warning",
    },
    quickActions: [],
  };
}

export function channelLabel(conversation: Conversation) {
  const channel = normalizeChannel(conversation);
  if (channel === "personal_wechat") return "个人微信";
  if (channel === "work_wechat") return "企业微信";
  return conversation.channel || "微信";
}

export function normalizeChannel(conversation: Conversation) {
  if (conversation.channel === "personal_wechat" || conversation.customer?.source === "personal_wechat") {
    return "personal_wechat";
  }
  if (["work_wechat", "wechat_work", "wecom", "wechat_kf"].includes(conversation.channel)) return "work_wechat";
  return conversation.channel || "wechat";
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toWorkbenchMessage(item: ConversationTimelineItem, customerName: string): ConversationWorkbenchMessage {
  const failed = ["failed", "blocked", "uncertain"].includes(item.status);
  const delivered = item.status === "sent" || Boolean(item.readAt);
  return {
    id: item.id,
    direction: item.direction,
    senderName: item.direction === "inbound" ? customerName : "客服工作台",
    avatar: {
      fallback: item.direction === "inbound" ? customerName.slice(0, 1) || "客" : "服",
      alt: item.direction === "inbound" ? "客户头像" : "客服头像",
    },
    text: item.text,
    createdAtLabel: formatDateTime(item.createdAt),
    statusLabel: item.direction === "outbound" ? sendStatusLabel(item.status) : item.readAt ? "已读" : "未读",
    statusTone: failed ? "danger" : delivered ? "success" : "neutral",
    attachments: item.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      kind: attachment.kind,
      detail: attachment.mimeType || attachment.status,
    })),
  };
}

function attentionScore(conversation: Conversation, operations?: ConversationOperations) {
  return (
    (operations?.isOverdue ? 100 : 0) +
    (operations ? priorityWeight[operations.priority] * 10 : 0) +
    Math.min(Number(conversation.unreadCount || 0), 9) +
    (operations?.assignmentState === "unassigned" ? 5 : 0)
  );
}

function dateValue(value?: string) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function priorityLabel(priority: ConversationOperations["priority"]) {
  return ({ low: "低", normal: "普通", high: "高", urgent: "紧急" } as const)[priority];
}

function lifecycleLabel(status?: ConversationOperations["status"]) {
  if (!status) return "";
  return ({ open: "处理中", pending: "等待客户", resolved: "已解决", closed: "已关闭" } as const)[status];
}

function sendStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: "待校验",
    blocked: "已拦截",
    sending: "发送中",
    dry_run: "仅审计",
    sent: "已发送",
    failed: "失败",
    cancelled: "已取消",
    uncertain: "状态不确定",
  };
  return labels[status] || status;
}

function feedbackTone(feedback: string): ConversationWorkbenchTone {
  if (!feedback) return "neutral";
  if (feedback.includes("失败") || feedback.includes("不可")) return "danger";
  if (feedback.includes("请勿重复") || feedback.includes("刷新失败")) return "warning";
  return "success";
}
