"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationOperationsPatch as OperationsPanelPatch } from "../../components/conversation-operations-panel";
import type {
  ConversationWorkbenchActions,
  ConversationWorkbenchContext,
  ConversationWorkbenchInbox,
  ConversationWorkbenchPane,
  ConversationWorkbenchThread,
} from "../../components/conversation-workbench";
import type {
  Conversation,
  ConversationOperations,
  ConversationTimelineItem,
  OperatorAccessStatus,
  OperatorCapability,
} from "../../lib/api";
import { conversationsFeatureApi, type ConversationsFeatureApi } from "./api";
import {
  channelLabel,
  conversationIdentity,
  DEFAULT_CONVERSATION_FILTERS,
  filterAndSortConversations,
  normalizeChannel,
  toWorkbenchContext,
  toWorkbenchConversation,
  toWorkbenchThread,
  type ConversationListFilters,
  type ConversationSuggestionState,
} from "./model";

type AccessPhase = "loading" | "ready" | "denied" | "error";
export type ConversationsControllerMode = "list" | "detail" | "context" | "assignment";

export function isCapabilityAllowed(status: OperatorAccessStatus, capability: OperatorCapability) {
  return status.enforcementReady && status.capabilities.includes(capability);
}

export function useConversationsController(
  api: ConversationsFeatureApi = conversationsFeatureApi,
  initialConversationId: string | null = null,
  mode: ConversationsControllerMode = initialConversationId ? "detail" : "list",
) {
  const [accessPhase, setAccessPhase] = useState<AccessPhase>("loading");
  const [accessStatus, setAccessStatus] = useState<OperatorAccessStatus | null>(null);
  const [accessError, setAccessError] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [operations, setOperations] = useState<ConversationOperations[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [operationsLoadError, setOperationsLoadError] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId);
  const [timeline, setTimeline] = useState<ConversationTimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [readNotice, setReadNotice] = useState("");
  const [activePane, setActivePane] = useState<ConversationWorkbenchPane>("inbox");
  const [inboxCollapsed, setInboxCollapsed] = useState(false);
  const [filters, setFilters] = useState<ConversationListFilters>(DEFAULT_CONVERSATION_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyFeedback, setReplyFeedback] = useState("");
  const [suggestion, setSuggestion] = useState<ConversationSuggestionState>({
    text: "",
    sourceText: "",
    loading: false,
    error: "",
  });
  const [operationsBusy, setOperationsBusy] = useState(false);
  const [operationsActionError, setOperationsActionError] = useState("");
  const [manualLockTarget, setManualLockTarget] = useState<boolean | null>(null);
  const [manualLockBusy, setManualLockBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const refreshSequence = useRef(0);
  const timelineSequence = useRef(0);
  const selectedConversationIdRef = useRef<string | null>(null);
  selectedConversationIdRef.current = selectedConversationId;

  const refreshWorkspace = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setAccessPhase("loading");
    setAccessError("");
    setListError("");
    setOperationsLoadError("");
    try {
      const status = await api.getOperatorAccessStatus();
      if (sequence !== refreshSequence.current) return;
      setAccessStatus(status);
      if (!isCapabilityAllowed(status, "view_console")) {
        setAccessPhase("denied");
        setConversations([]);
        setOperations([]);
        setSelectedConversationId(null);
        return;
      }
      setAccessPhase("ready");
      setListLoading(true);
      const needsOperations = mode === "context" || mode === "assignment";
      const [conversationResult, operationsResult] = await Promise.allSettled([
        api.getWechatConversations(),
        needsOperations ? api.getConversationOperationsQueue() : Promise.resolve({ records: [] }),
      ]);
      if (sequence !== refreshSequence.current) return;
      if (conversationResult.status === "fulfilled") {
        setConversations(conversationResult.value);
        const initialConversationExists = Boolean(
          initialConversationId
          && conversationResult.value.some((conversation) => conversation.id === initialConversationId),
        );
        setSelectedConversationId((current) => {
          if (current && conversationResult.value.some((conversation) => conversation.id === current)) return current;
          return initialConversationExists ? initialConversationId : null;
        });
        if (initialConversationId && !initialConversationExists) {
          setListError(`未找到会话 ${initialConversationId}，请返回会话列表重新选择。`);
        }
      } else {
        setListError(errorMessage(conversationResult.reason, "会话列表读取失败"));
      }
      if (operationsResult.status === "fulfilled") {
        setOperations(operationsResult.value.records);
      } else if (needsOperations) {
        setOperationsLoadError(errorMessage(operationsResult.reason, "会话分配与 SLA 读取失败"));
      }
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      setAccessStatus(null);
      setAccessPhase("error");
      setAccessError(errorMessage(error, "无法确认当前操作员权限"));
    } finally {
      if (sequence === refreshSequence.current) setListLoading(false);
    }
  }, [api, initialConversationId, mode]);

  useEffect(() => {
    void refreshWorkspace();
    return () => {
      refreshSequence.current += 1;
      timelineSequence.current += 1;
    };
  }, [refreshWorkspace]);

  const operationsById = useMemo(
    () => new Map(operations.map((record) => [record.id, record])),
    [operations],
  );
  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) || null,
    [conversations, selectedConversationId],
  );
  const selectedIdentityKey = selectedConversation
    ? `${selectedConversation.id}\u0000${selectedConversation.wechatAccountId}\u0000${selectedConversation.customerId}`
    : "";
  const activeOperations = selectedConversation ? operationsById.get(selectedConversation.id) || null : null;
  const canReply = Boolean(accessStatus && isCapabilityAllowed(accessStatus, "reply_conversations"));
  const canManageAssignments = Boolean(accessStatus && isCapabilityAllowed(accessStatus, "manage_assignments"));
  const currentOperator = accessStatus?.principal?.displayName || "";

  useEffect(() => {
    setReplyText("");
    setReplyFeedback("");
    setSuggestion({ text: "", sourceText: "", loading: false, error: "" });
    setActionNotice("");
    setActionError("");
    setManualLockTarget(null);
    setReadNotice("");
    if (mode !== "detail" || !selectedConversation || accessPhase !== "ready") {
      setTimeline([]);
      setTimelineError("");
      setTimelineLoading(false);
      return;
    }
    const sequence = ++timelineSequence.current;
    const identity = conversationIdentity(selectedConversation);
    setTimelineLoading(true);
    setTimelineError("");
    const readRequest = Number(selectedConversation.unreadCount || 0)
      ? api.markConversationMessagesRead(identity)
      : Promise.resolve(null);
    void Promise.allSettled([
      api.getConversationTimeline(identity),
      readRequest,
    ]).then(([timelineResult, readResult]) => {
      if (sequence !== timelineSequence.current) return;
      if (timelineResult.status === "fulfilled") {
        setTimeline(timelineResult.value);
      } else {
        setTimeline([]);
        setTimelineError(errorMessage(timelineResult.reason, "会话时间线读取失败"));
      }
      if (readResult.status === "fulfilled" && readResult.value) {
        setConversations((current) => current.map((conversation) =>
          conversation.id === selectedConversation.id ? { ...conversation, unreadCount: 0 } : conversation,
        ));
      } else if (readResult.status === "rejected") {
        setReadNotice(errorMessage(readResult.reason, "消息已显示，但已读状态更新失败"));
      }
      setTimelineLoading(false);
    });
  }, [accessPhase, api, mode, selectedIdentityKey]);

  const refreshTimeline = useCallback(async () => {
    if (mode !== "detail" || !selectedConversation) return;
    const sequence = ++timelineSequence.current;
    setTimelineLoading(true);
    setTimelineError("");
    try {
      const records = await api.getConversationTimeline(conversationIdentity(selectedConversation));
      if (sequence === timelineSequence.current) setTimeline(records);
    } catch (error) {
      if (sequence === timelineSequence.current) setTimelineError(errorMessage(error, "会话时间线刷新失败"));
    } finally {
      if (sequence === timelineSequence.current) setTimelineLoading(false);
    }
  }, [api, mode, selectedConversation]);

  const updateFilters = useCallback((patch: Partial<ConversationListFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }, []);

  const visibleConversations = useMemo(
    () => filterAndSortConversations(conversations, operationsById, filters),
    [conversations, filters, operationsById],
  );
  const pageCount = Math.max(1, Math.ceil(visibleConversations.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedConversations = visibleConversations.slice((safePage - 1) * pageSize, safePage * pageSize);
  const channelOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const conversation of conversations) values.set(normalizeChannel(conversation), channelLabel(conversation));
    return [
      { value: "all", label: "全部渠道" },
      ...[...values].map(([value, label]) => ({ value, label })),
    ];
  }, [conversations]);

  const inbox = useMemo<ConversationWorkbenchInbox>(() => ({
    title: "会话处理",
    total: visibleConversations.length,
    pendingCount: conversations.filter((conversation) => Number(conversation.unreadCount || 0) > 0).length,
    search: filters.search,
    searchPlaceholder: "搜索客户、账号或消息",
    scope: filters.scope,
    scopeOptions: [
      { value: "all", label: "全部", count: conversations.length },
      { value: "unread", label: "未读", count: conversations.filter((item) => Number(item.unreadCount || 0) > 0).length },
      { value: "manual", label: "人工接管", count: conversations.filter((item) => item.manualLocked).length },
    ],
    channel: filters.channel,
    channelOptions,
    status: filters.status,
    statusOptions: [
      { value: "all", label: "全部状态" },
      { value: "unassigned", label: "待分配" },
      { value: "overdue", label: "SLA 超时" },
      { value: "open", label: "处理中" },
      { value: "pending", label: "等待客户" },
      { value: "resolved", label: "已解决" },
      { value: "closed", label: "已关闭" },
    ],
    sort: filters.sort,
    sortOptions: [
      { value: "priority", label: "优先处理" },
      { value: "latest", label: "最新消息" },
      { value: "oldest", label: "最早消息" },
    ],
    conversations: pagedConversations.map((conversation) =>
      toWorkbenchConversation(conversation, operationsById.get(conversation.id)),
    ),
    selectedConversationId,
    page: safePage,
    pageCount,
    pageSize,
    pageSizeOptions: [10, 20, 50],
    loading: listLoading,
    error: listError || undefined,
    emptyTitle: conversations.length ? "没有符合条件的会话" : "还没有微信会话",
    emptyDetail: conversations.length ? "调整筛选条件后重试。" : "收到真实客户消息后，会话才会显示在这里。",
  }), [
    channelOptions,
    conversations,
    filters,
    listError,
    listLoading,
    operationsById,
    pageCount,
    pageSize,
    pagedConversations,
    safePage,
    selectedConversationId,
    visibleConversations.length,
  ]);

  const thread = useMemo<ConversationWorkbenchThread | null>(() => selectedConversation
    ? toWorkbenchThread({
        conversation: selectedConversation,
        timeline,
        timelineLoading,
        timelineError,
        replyText,
        replyBusy,
        replyFeedback,
        canReply,
        suggestion,
      })
    : null, [canReply, replyBusy, replyFeedback, replyText, selectedConversation, suggestion, timeline, timelineError, timelineLoading]);

  const context = useMemo<ConversationWorkbenchContext | null>(() =>
    mode === "detail" || mode === "list" || !selectedConversation
      ? null
      : toWorkbenchContext(selectedConversation, activeOperations || undefined),
  [activeOperations, mode, selectedConversation]);

  const selectConversation = useCallback((conversationId: string) => {
    setSelectedConversationId(conversationId);
    setActivePane("thread");
  }, []);

  const sendReply = useCallback(async () => {
    const conversation = selectedConversation;
    const text = replyText.trim();
    if (!conversation) {
      setReplyFeedback("请先选择客户会话。");
      return;
    }
    if (!canReply || !currentOperator) {
      setReplyFeedback("当前操作员没有回复会话权限，不能提交人工回复。");
      return;
    }
    if (!text) {
      setReplyFeedback("请输入人工回复内容。");
      return;
    }
    if (text.length > 2000) {
      setReplyFeedback("人工回复不能超过 2000 个字符。");
      return;
    }
    setReplyBusy(true);
    setReplyFeedback("");
    const identity = conversationIdentity(conversation);
    try {
      const queued = await api.queueManualConversationReply(identity, text, currentOperator);
      const queuedSummary = `回复任务 ${queued.task.id} 已成功入队。`;
      setReplyText("");
      setReplyFeedback(queuedSummary);
      const [timelineResult] = await Promise.allSettled([api.getConversationTimeline(identity)]);
      if (timelineResult.status === "fulfilled") {
        if (selectedConversationIdRef.current === conversation.id) setTimeline(timelineResult.value);
      } else {
        setReplyFeedback(
          `${queuedSummary} 时间线刷新失败：${errorMessage(timelineResult.reason, "未知错误")}。回复任务已经成功入队，请勿重复发送。`,
        );
      }
    } catch (error) {
      setReplyFeedback(errorMessage(error, "人工回复入队失败"));
    } finally {
      setReplyBusy(false);
    }
  }, [api, canReply, currentOperator, replyText, selectedConversation]);

  const generateSuggestion = useCallback(async () => {
    const conversation = selectedConversation;
    if (!conversation) return;
    const latestInbound = [...timeline].reverse().find((item) => item.direction === "inbound" && item.text?.trim());
    if (!latestInbound?.text) {
      setSuggestion({ text: "", sourceText: "", loading: false, error: "当前时间线没有可用于生成建议的客户文字消息。" });
      return;
    }
    setSuggestion({ text: "", sourceText: latestInbound.text, loading: true, error: "" });
    try {
      const route = await api.evaluateRoute(latestInbound.text, {
        wechatAccountId: conversation.wechatAccountId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
      });
      setSuggestion({
        text: route.suggestedReply || "",
        sourceText: latestInbound.text,
        loading: false,
        error: route.suggestedReply ? "" : "路由服务没有返回建议回复，未填入任何虚构内容。",
      });
    } catch (error) {
      setSuggestion({ text: "", sourceText: latestInbound.text, loading: false, error: errorMessage(error, "建议回复生成失败") });
    }
  }, [api, selectedConversation, timeline]);

  const useSuggestion = useCallback(() => {
    if (!suggestion.text) return;
    setReplyText(suggestion.text.slice(0, 2000));
    setReplyFeedback("建议已填入回复框，请人工核对后再入队。");
  }, [suggestion.text]);

  const openAssignment = useCallback(() => {
    setActivePane("context");
    setActionError("");
    setActionNotice("请在“会话分配与 SLA”中修改接待客服；转接不会自动发送消息。");
  }, []);

  const requestManualLockChange = useCallback(() => {
    if (!selectedConversation) return;
    if (!canReply || !currentOperator) {
      setActionError("当前操作员没有回复会话权限，不能变更人工接管状态。");
      return;
    }
    setActionError("");
    setManualLockTarget(!Boolean(selectedConversation.manualLocked));
  }, [canReply, currentOperator, selectedConversation]);

  const confirmManualLockChange = useCallback(async () => {
    const conversation = selectedConversation;
    const target = manualLockTarget;
    if (!conversation || target === null || !canReply || !currentOperator) return;
    setManualLockTarget(null);
    setManualLockBusy(true);
    setActionError("");
    setActionNotice("");
    try {
      const result = await api.setConversationManualLock(conversation.id, {
        locked: target,
        reviewer: currentOperator,
        reason: target ? "manual_takeover_from_conversations_feature" : "manual_resolution_from_conversations_feature",
        note: target ? "操作员从独立会话模块确认人工接管。" : "操作员从独立会话模块确认解除人工接管。",
        expectedWechatAccountId: conversation.wechatAccountId,
        expectedConversationId: conversation.id,
        expectedCustomerId: conversation.customerId,
      });
      setConversations((current) => current.map((item) => item.id === conversation.id ? result.conversation : item));
      setActionNotice(target ? "已开启人工接管，自动处理应保持暂停。" : "已解除人工接管，后续自动处理仍以服务端策略为准。");
    } catch (error) {
      setActionError(errorMessage(error, target ? "开启人工接管失败" : "解除人工接管失败"));
    } finally {
      setManualLockBusy(false);
    }
  }, [api, canReply, currentOperator, manualLockTarget, selectedConversation]);

  const saveOperations = useCallback(async (patch: OperationsPanelPatch) => {
    const conversation = selectedConversation;
    if (!conversation) return;
    if (mode !== "assignment") {
      setOperationsActionError("当前页面不负责修改会话分配。");
      return;
    }
    if (!canManageAssignments || !currentOperator) {
      setOperationsActionError("当前操作员没有管理会话分配的权限。");
      return;
    }
    setOperationsBusy(true);
    setOperationsActionError("");
    try {
      const result = await api.updateConversationOperations(
        conversationIdentity(conversation),
        patch,
        currentOperator,
        "独立会话模块更新分配、状态与 SLA",
      );
      setOperations((current) => {
        const exists = current.some((record) => record.id === result.conversation.id);
        return exists
          ? current.map((record) => record.id === result.conversation.id ? result.conversation : record)
          : [...current, result.conversation];
      });
    } catch (error) {
      setOperationsActionError(errorMessage(error, "会话运营字段保存失败"));
    } finally {
      setOperationsBusy(false);
    }
  }, [api, canManageAssignments, currentOperator, mode, selectedConversation]);

  const actions = useMemo<ConversationWorkbenchActions>(() => ({
    onPaneChange: setActivePane,
    onToggleInbox: () => setInboxCollapsed((collapsed) => !collapsed),
    onSearchChange: (value) => updateFilters({ search: value }),
    onScopeChange: (value) => updateFilters({ scope: value as ConversationListFilters["scope"] }),
    onChannelChange: (value) => updateFilters({ channel: value }),
    onStatusChange: (value) => updateFilters({ status: value as ConversationListFilters["status"] }),
    onSortChange: (value) => updateFilters({ sort: value as ConversationListFilters["sort"] }),
    onSelectConversation: selectConversation,
    onPageChange: setPage,
    onPageSizeChange: (size) => {
      setPageSize(size);
      setPage(1);
    },
    onRefresh: () => {
      if (selectedConversation) void refreshTimeline();
      else void refreshWorkspace();
    },
    onTransfer: openAssignment,
    onSuggestionTabChange: () => undefined,
    onUseSuggestion: useSuggestion,
    onRegenerateSuggestion: () => void generateSuggestion(),
    onReplyChange: setReplyText,
    onSendReply: () => void sendReply(),
    onEditAssignment: openAssignment,
  }), [
    generateSuggestion,
    openAssignment,
    refreshTimeline,
    refreshWorkspace,
    selectConversation,
    selectedConversation,
    sendReply,
    updateFilters,
    useSuggestion,
  ]);

  const permissionDetail = accessStatus
    ? [accessStatus.notice, ...accessStatus.blockers.map((blocker) => blocker.message), ...accessStatus.requiredNextSteps]
        .filter(Boolean)
        .join("；")
    : "";

  return {
    accessPhase,
    accessStatus,
    accessError,
    permissionDetail,
    canReply,
    canManageAssignments,
    currentOperator,
    inbox,
    thread,
    context,
    activeOperations,
    operationsBusy,
    operationsError: operationsActionError || operationsLoadError || (!canManageAssignments ? "当前操作员没有管理会话分配的权限。" : ""),
    activePane,
    inboxCollapsed,
    actions,
    selectedConversation,
    readNotice,
    actionNotice,
    actionError,
    manualLockTarget,
    manualLockBusy,
    listLoading,
    refreshWorkspace,
    requestManualLockChange,
    cancelManualLockChange: () => setManualLockTarget(null),
    confirmManualLockChange,
    saveOperations,
  };
}

function errorMessage(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  return detail ? `${fallback}：${detail}` : fallback;
}
