import type {
  ConversationWorkbenchContext,
  ConversationWorkbenchConversation,
  ConversationWorkbenchMessage,
  ConversationWorkbenchThread,
  ConversationWorkbenchTone,
} from "../../components/conversation-workbench/types";
import type {
  Conversation,
  ConversationIdentity,
  ConversationOperations,
  ConversationTimelineItem,
  AiProviderStatus,
  IdentityExpectation,
} from "../../lib/api";
import { identityExpectation, localAssetByIdUrl, localConversationAttachmentUrl } from "../../lib/api";

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
  knowledgeMatches?: Array<{ title: string; score?: number }>;
  appliedSkills?: string[];
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

export function hasCompleteConversationIdentity(
  conversation: Pick<Conversation, "id" | "wechatAccountId" | "customerId">,
) {
  return Boolean(
    String(conversation.id || "").trim()
    && String(conversation.wechatAccountId || "").trim()
    && String(conversation.customerId || "").trim(),
  );
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
      conversation.id,
      conversation.customerId,
      conversation.wechatAccountId,
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
    : unassigned
      ? "待分配"
      : operations?.assignee || lifecycleLabel(operations?.status) || "未配置";
  const stateTone: ConversationWorkbenchTone = overdue
    ? "danger"
    : unassigned
      ? "warning"
      : operations
        ? "success"
        : "neutral";
  return {
    id: conversation.id,
    wechatAccountId: conversation.wechatAccountId,
    customerId: conversation.customerId,
    title,
    subtitle: conversation.wechatAccount?.displayName || conversation.wechatAccountId,
    avatar: { imageUrl: conversation.customer?.avatarUrl || undefined, fallback: title.slice(0, 1) || "客", alt: `${title}头像` },
    channelLabel: channelLabel(conversation),
    channelTone: "brand",
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
  replyAttachments: Array<{ id: string; fileName: string; mimeType: string; sizeBytes?: number }>;
  attachmentBusy: boolean;
  replyFeedback: string;
  queuedReplyTaskId: string;
  canReply: boolean;
  suggestion: ConversationSuggestionState;
  aiProviderStatus?: AiProviderStatus | null;
  aiProviderError?: string;
}): ConversationWorkbenchThread {
  const { conversation, suggestion } = input;
  const identityComplete = hasCompleteConversationIdentity(conversation);
  const aiReadiness = aiSuggestionReadiness(input.aiProviderStatus, input.aiProviderError);
  const knowledgeMatches = suggestion.knowledgeMatches || [];
  const appliedSkills = suggestion.appliedSkills || [];
  const knowledgeEvidence = knowledgeMatches.length
    ? `知识命中：${knowledgeMatches.slice(0, 3).map((item) => item.title).join("、")}`
    : "未命中已审核知识条目";
  const skillEvidence = appliedSkills.length
    ? `Skill：${appliedSkills.slice(0, 3).join("、")}`
    : "未应用 Agent Skill";
  const title = conversation.customer?.name || conversation.title || "未命名客户";
  const attachmentIdentity = identityExpectation({
    wechatAccountId: conversation.wechatAccountId,
    conversationId: conversation.id,
    customerId: conversation.customerId,
  });
  const permissionNotice = input.canReply
    ? []
    : [{
        id: "reply-permission",
        tone: "danger" as const,
        text: identityComplete ? "当前操作员没有回复会话权限" : "当前会话身份不完整",
        detail: identityComplete
          ? "人工回复和接管操作保持禁用。"
          : "缺少账号、会话或客户身份，已禁用人工回复与接管；请先重新同步官方会话。",
      }];
  return {
    participant: {
      name: title,
      avatar: { imageUrl: conversation.customer?.avatarUrl || undefined, fallback: title.slice(0, 1) || "客", alt: `${title}头像` },
      accountLabel: conversation.wechatAccount?.displayName || conversation.wechatAccountId,
      channelLabel: channelLabel(conversation),
      channelTone: "brand",
      onlineLabel: conversation.wechatAccount ? (conversation.wechatAccount.isActive ? "在线" : "离线") : "状态待核验",
      online: Boolean(conversation.wechatAccount?.isActive),
    },
    serviceStatusLabel: "智能客服自动处理",
    serviceStatusTone: "success",
    manualTakeoverLabel: undefined,
    safetyNotice: "企业微信回复会先进入后端安全发送队列；最终发送结果以官方客服通道回执和服务端状态为准。",
    timelineLabel: "完整会话记录",
    messages: input.timeline.map((item) => toWorkbenchMessage(item, title, conversation.customer?.avatarUrl, attachmentIdentity)),
    incidents: [],
    notices: [
      ...permissionNotice,
    ],
    suggestion: {
      activeTab: "ai",
      tabs: [{ value: "ai", label: aiReadiness.tabLabel }],
      title: aiReadiness.title,
      verificationLabel: suggestion.text ? `知识 ${knowledgeMatches.length} · Skill ${appliedSkills.length}` : aiReadiness.idleLabel,
      text: suggestion.text || undefined,
      sourceDetail: suggestion.sourceText
        ? `${aiReadiness.detail}；${knowledgeEvidence}；${skillEvidence}；依据最近客户消息：${suggestion.sourceText.slice(0, 100)}`
        : `${aiReadiness.detail}；${knowledgeEvidence}；${skillEvidence}`,
      loading: suggestion.loading,
      error: suggestion.error || undefined,
      useActionLabel: "填入回复框",
      regenerateActionLabel: "生成建议",
    },
    safetyChecks: [
      {
        id: "identity",
        label: "客户与账号身份",
        statusLabel: identityComplete ? "已绑定" : "缺少身份",
        tone: identityComplete ? "success" : "danger",
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
    workflowActions: [
      { id: "bundles", label: "AI 搭品", detail: "按当前客户需求搭配", href: conversationIdentityHref("/catalog/bundles", conversation), icon: "bundle" },
      { id: "design", label: "新建设计", detail: "绑定当前会话", href: conversationIdentityHref("/design/jobs/new", conversation), icon: "design" },
      { id: "reviews", label: "人工审核", detail: "筛选当前客户待审", href: conversationIdentityHref("/reviews/inbox", conversation), icon: "review" },
      { id: "quotes", label: "查看报价", detail: "筛选当前客户", href: conversationIdentityHref("/sales/quotes", conversation), icon: "quote" },
      { id: "orders", label: "跟进订单", detail: "筛选当前客户", href: conversationIdentityHref("/sales/orders", conversation), icon: "order" },
      { id: "send", label: "发送队列", detail: "筛选当前会话任务", href: conversationIdentityHref("/send/queue", conversation), icon: "send" },
      { id: "training", label: "沉淀训练", detail: "导入当前会话", href: conversationIdentityHref("/training/import", conversation), icon: "training" },
    ],
    composer: {
      value: input.replyText,
      placeholder: input.attachmentBusy
        ? "附件正在安全上传…"
        : input.canReply ? "输入人工回复（通过企业微信安全队列发送）" : "当前没有回复会话权限",
      maxLength: 2000,
      disabled: !input.canReply || input.attachmentBusy,
      sending: input.replyBusy,
      sendLabel: "发送到企业微信",
      tools: [],
      attachments: input.replyAttachments.map((asset) => ({
        id: asset.id,
        name: asset.fileName,
        kind: asset.mimeType.startsWith("image/") ? "image" : "file",
        detail: formatAttachmentSize(asset.sizeBytes),
      })),
      attachmentBusy: input.attachmentBusy,
      feedback: input.replyFeedback || undefined,
      feedbackTone: feedbackTone(input.replyFeedback),
      queuedTask: input.queuedReplyTaskId
        ? {
            id: input.queuedReplyTaskId,
            href: `/send/queue/${encodeURIComponent(input.queuedReplyTaskId)}`,
            actionLabel: "查看发送结果",
          }
        : undefined,
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
  return {
    customer: {
      name: title,
      avatar: { imageUrl: conversation.customer?.avatarUrl || undefined, fallback: title.slice(0, 1) || "客", alt: `${title}头像` },
      wechatId: conversation.customer?.wechatId || conversation.customerId,
      source: conversation.customer?.source || channelLabel(conversation),
      relationLabel: "企业微信",
      relationTone: "brand",
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
  if (channel === "work_wechat") return "企业微信";
  return conversation.channel || "微信";
}

function formatAttachmentSize(sizeBytes?: number) {
  const bytes = Number(sizeBytes || 0);
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function normalizeChannel(conversation: Conversation) {
  if (["work_wechat", "wechat_work", "wecom", "wechat_kf"].includes(conversation.channel)) return "work_wechat";
  return conversation.channel || "wechat";
}

function conversationIdentityHref(path: string, conversation: Conversation) {
  const params = new URLSearchParams();
  params.set("wechatAccountId", conversation.wechatAccountId);
  params.set("conversationId", conversation.id);
  params.set("customerId", conversation.customerId);
  return `${path}?${params.toString()}`;
}

function aiSuggestionReadiness(status?: AiProviderStatus | null, error?: string) {
  if (error) {
    return {
      tabLabel: "规则建议",
      title: "模型状态未知，当前只作为规则建议",
      readyLabel: "模型状态读取失败",
      idleLabel: "模型状态读取失败",
      detail: `AI 状态读取失败：${error}`,
    };
  }
  const configured = status?.providers.filter((provider) => provider.configured) || [];
  if (status?.enabled && configured.length) {
    const primary = configured.find((provider) => provider.isPrimary) || configured[0];
    return {
      tabLabel: "AI/规则建议",
      title: "模型配置可用，发送前仍需人工确认",
      readyLabel: `${primary.name} ${primary.model || "模型"} 可用`,
      idleLabel: "模型配置可用",
      detail: `AI 引擎已配置 ${configured.length}/${status.providers.length} 个供应商；当前建议仍需人工核对`,
    };
  }
  const issue = status?.providers.flatMap((provider) => provider.issues).find(Boolean);
  return {
    tabLabel: "规则建议",
    title: "模型未接通，当前使用规则建议",
    readyLabel: "规则建议，模型未接通",
    idleLabel: "模型未接通",
    detail: issue ? `AI 供应商未就绪：${issue}` : "AI 供应商未配置；可在大模型中心完成配置",
  };
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

function toWorkbenchMessage(
  item: ConversationTimelineItem,
  customerName: string,
  customerAvatarUrl?: string | null,
  attachmentIdentity: IdentityExpectation = {},
): ConversationWorkbenchMessage {
  const failed = ["failed", "blocked", "uncertain"].includes(item.status);
  const delivered = item.status === "sent" || Boolean(item.readAt);
  return {
    id: item.id,
    direction: item.direction,
    senderName: item.direction === "inbound" ? customerName : "客服工作台",
    avatar: {
      imageUrl: item.direction === "inbound" ? customerAvatarUrl || undefined : undefined,
      fallback: item.direction === "inbound" ? customerName.slice(0, 1) || "客" : "服",
      alt: item.direction === "inbound" ? "客户头像" : "客服头像",
    },
    text: item.text,
    content: item.messageType && item.content && typeof item.content === "object"
      ? { type: item.messageType, ...item.content }
      : undefined,
    createdAtLabel: formatDateTime(item.createdAt),
    statusLabel: item.direction === "outbound" ? sendStatusLabel(item.status) : item.readAt ? "已读" : "未读",
    statusTone: failed ? "danger" : delivered ? "success" : "neutral",
    attachments: item.attachments.map((attachment) => {
      const assetUrl = localAssetByIdUrl(attachment.assetId, attachmentIdentity);
      const messageUrl = attachment.source === "wechat_work_kf"
        ? localConversationAttachmentUrl(item.conversationId, item.id, attachment.id, attachmentIdentity)
        : "";
      const href = assetUrl || messageUrl;
      return {
        id: attachment.id,
        name: attachment.name,
        kind: attachment.kind,
        detail: formatTimelineAttachmentDetail(attachment),
        sizeLabel: formatAttachmentSize(attachment.sizeBytes),
        href: href || undefined,
        previewUrl: attachment.kind === "image" && href ? href : undefined,
      };
    }),
  };
}

function formatTimelineAttachmentDetail(attachment: ConversationTimelineItem["attachments"][number]) {
  const statusLabels: Record<string, string> = {
    manual_review: "需要人工查看",
    failed: "读取失败",
    blocked: "已拦截",
    queued: "待发送",
    sending: "发送中",
  };
  return statusLabels[attachment.status] || attachment.mimeType || undefined;
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
