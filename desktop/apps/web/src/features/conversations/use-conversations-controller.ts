"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationOperationsPatch as OperationsPanelPatch } from "../../components/conversation-operations-panel";
import type {
  ConversationWorkbenchActions,
  ConversationWorkbenchContext,
  ConversationWorkbenchInbox,
  ConversationWorkbenchPane,
  ConversationWorkbenchThread,
} from "../../components/conversation-workbench/types";
import type {
  Conversation,
  ConversationIdentity,
  ConversationOperations,
  DesignAsset,
  SendTask,
  ConversationTimelineItem,
  AiProviderStatus,
  OperatorAccessStatus,
  OperatorCapability,
  IdentityFilters,
} from "../../lib/api";
import { conversationsFeatureApi, type ConversationsFeatureApi } from "./api";
import {
  completeClientOperation,
  reserveClientOperation,
  type PendingClientOperation,
} from "../../lib/client-operation-key";
import {
  channelLabel,
  conversationIdentity,
  DEFAULT_CONVERSATION_FILTERS,
  filterAndSortConversations,
  hasCompleteConversationIdentity,
  normalizeChannel,
  toWorkbenchContext,
  toWorkbenchConversation,
  toWorkbenchThread,
  type ConversationListFilters,
  type ConversationSuggestionState,
} from "./model";
import {
  conversationFiltersFromNavigation,
  conversationMatchesIdentityFilters,
  type ConversationListNavigationState,
} from "./conversation-navigation";

type AccessPhase = "loading" | "ready" | "denied" | "error";
export type ConversationsControllerMode = "list" | "detail" | "context" | "assignment";
export type ConversationReadState = "unknown" | "loading" | "ready" | "refreshing" | "stale";
export type ConversationsControllerOptions = {
  expectedIdentity?: IdentityFilters;
  initialListNavigation?: ConversationListNavigationState;
};

export function isCapabilityAllowed(status: OperatorAccessStatus, capability: OperatorCapability) {
  return status.enforcementReady && status.capabilities.includes(capability);
}

export function useConversationsController(
  api: ConversationsFeatureApi = conversationsFeatureApi,
  initialConversationId: string | null = null,
  mode: ConversationsControllerMode = initialConversationId ? "detail" : "list",
  options: ConversationsControllerOptions = {},
) {
  const expectedWechatAccountId = options.expectedIdentity?.wechatAccountId;
  const expectedConversationId = options.expectedIdentity?.conversationId;
  const expectedCustomerId = options.expectedIdentity?.customerId;
  const initialSearch = options.initialListNavigation?.search;
  const initialScope = options.initialListNavigation?.scope;
  const initialChannel = options.initialListNavigation?.channel;
  const initialStatus = options.initialListNavigation?.status;
  const initialSort = options.initialListNavigation?.sort;
  const initialPage = options.initialListNavigation?.page;
  const [accessPhase, setAccessPhase] = useState<AccessPhase>("loading");
  const [accessStatus, setAccessStatus] = useState<OperatorAccessStatus | null>(null);
  const [accessError, setAccessError] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [operations, setOperations] = useState<ConversationOperations[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);
  const [listError, setListError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsLoaded, setOperationsLoaded] = useState(false);
  const [operationsLoadError, setOperationsLoadError] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId);
  const [timeline, setTimeline] = useState<ConversationTimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [readNotice, setReadNotice] = useState("");
  const [activePane, setActivePane] = useState<ConversationWorkbenchPane>("inbox");
  const [inboxCollapsed, setInboxCollapsed] = useState(false);
  const [filters, setFilters] = useState<ConversationListFilters>(() => conversationFiltersFromNavigation(options.initialListNavigation));
  const [page, setPage] = useState(() => Math.max(1, Math.floor(initialPage || 1)));
  const [pageSize, setPageSize] = useState(20);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyFeedback, setReplyFeedback] = useState("");
  const [queuedReplyTaskId, setQueuedReplyTaskId] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<DesignAsset[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<ConversationSuggestionState>({
    text: "",
    sourceText: "",
    loading: false,
    error: "",
  });
  const [aiProviderStatus, setAiProviderStatus] = useState<AiProviderStatus | null>(null);
  const [aiProviderError, setAiProviderError] = useState("");
  const [operationsBusy, setOperationsBusy] = useState(false);
  const [operationsActionError, setOperationsActionError] = useState("");
  const [operationsActionNotice, setOperationsActionNotice] = useState("");
  const [manualLockTarget, setManualLockTarget] = useState<boolean | null>(null);
  const [manualLockBusy, setManualLockBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const refreshSequence = useRef(0);
  const timelineSequence = useRef(0);
  const liveTimelineSequence = useRef(0);
  const selectedConversationIdRef = useRef<string | null>(null);
  const pendingReplyOperationRef = useRef<PendingClientOperation | null>(null);
  const replyDraftsRef = useRef(new Map<string, string>());
  const [replyDraftVersion, setReplyDraftVersion] = useState(0);
  selectedConversationIdRef.current = selectedConversationId;

  const refreshWorkspace = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setAccessPhase((current) => current === "ready" ? current : "loading");
    setAccessError("");
    setListError("");
    setSelectionError("");
    setOperationsLoadError("");
    setOperationsActionNotice("");
    try {
      const status = await api.getOperatorAccessStatus();
      if (sequence !== refreshSequence.current) return;
      setAccessStatus(status);
      if (!isCapabilityAllowed(status, "view_console")) {
        setAccessPhase("denied");
        setConversations([]);
        setOperations([]);
        setListLoaded(false);
        setOperationsLoaded(false);
        setOperationsLoading(false);
        setSelectedConversationId(null);
        return;
      }
      setAccessPhase("ready");
      setListLoading(true);
      const needsOperations = mode === "context" || mode === "assignment";
      setOperationsLoading(needsOperations);
      const conversationRequest = withConversationReadTimeout(
        api.getWechatConversations(),
        20_000,
        "会话列表读取超时",
      ).then((records) => {
        if (sequence !== refreshSequence.current) return records;
        setConversations(records);
        setListLoaded(true);
        const expectedIdentity = {
          wechatAccountId: expectedWechatAccountId,
          conversationId: expectedConversationId,
          customerId: expectedCustomerId,
        };
        const initialConversation = initialConversationId
          ? records.find((conversation) => conversation.id === initialConversationId) || null
          : null;
        const initialConversationExists = Boolean(
          initialConversation && conversationMatchesIdentityFilters(initialConversation, expectedIdentity),
        );
        setSelectedConversationId((current) => {
          if (current && records.some((conversation) => (
            conversation.id === current && conversationMatchesIdentityFilters(conversation, expectedIdentity)
          ))) return current;
          return initialConversationExists ? initialConversationId : null;
        });
        if (initialConversationId && !initialConversationExists) {
          setSelectionError(initialConversation
            ? "页面绑定的企业微信账号、会话或客户身份与真实记录不一致，已阻止打开。"
            : `未找到会话 ${initialConversationId}，请返回会话列表重新选择。`);
        }
        return records;
      }, (error) => {
        if (sequence === refreshSequence.current) setListError(errorMessage(error, "会话列表读取失败"));
        throw error;
      }).finally(() => {
        if (sequence === refreshSequence.current) setListLoading(false);
      });
      const operationsRequest = needsOperations
        ? withConversationReadTimeout(
            api.getConversationOperationsQueue(),
            20_000,
            "会话分配与 SLA 读取超时",
          ).then((queue) => {
            if (sequence === refreshSequence.current) {
              setOperations(queue.records);
              setOperationsLoaded(true);
            }
            return queue;
          }, (error) => {
            if (sequence === refreshSequence.current) {
              setOperationsLoadError(errorMessage(error, "会话分配与 SLA 读取失败"));
            }
            throw error;
          }).finally(() => {
            if (sequence === refreshSequence.current) setOperationsLoading(false);
          })
        : Promise.resolve(null);
      const aiStatusRequest = withConversationReadTimeout(
        api.getAiProviderStatus(),
        12_000,
        "AI 渠道状态读取超时",
      ).then((aiStatus) => {
        if (sequence !== refreshSequence.current) return aiStatus;
        setAiProviderStatus(aiStatus);
        setAiProviderError("");
        return aiStatus;
      }, (error) => {
        if (sequence === refreshSequence.current) {
          setAiProviderError(errorMessage(error, "AI 渠道状态读取失败"));
        }
        throw error;
      });
      await Promise.allSettled([conversationRequest, operationsRequest, aiStatusRequest]);
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      setAccessStatus(null);
      setAccessPhase("error");
      setAccessError(errorMessage(error, "无法确认当前操作员权限"));
    } finally {
      if (sequence === refreshSequence.current) {
        setListLoading(false);
        setOperationsLoading(false);
      }
    }
  }, [
    api,
    expectedConversationId,
    expectedCustomerId,
    expectedWechatAccountId,
    initialConversationId,
    mode,
  ]);

  useEffect(() => {
    void refreshWorkspace();
    return () => {
      refreshSequence.current += 1;
      timelineSequence.current += 1;
    };
  }, [refreshWorkspace]);

  useEffect(() => {
    if (mode !== "list") return;
    setFilters(conversationFiltersFromNavigation({
      search: initialSearch,
      scope: initialScope,
      channel: initialChannel,
      status: initialStatus,
      sort: initialSort,
    }));
    setPage(Math.max(1, Math.floor(initialPage || 1)));
  }, [initialChannel, initialPage, initialScope, initialSearch, initialSort, initialStatus, mode]);

  const operationsById = useMemo(
    () => new Map(operations.map((record) => [record.id, record])),
    [operations],
  );
  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) || null,
    [conversations, selectedConversationId],
  );
  const selectedIdentityKey = selectedConversation ? conversationIdentityKey(selectedConversation) : "";
  const activeOperations = selectedConversation ? operationsById.get(selectedConversation.id) || null : null;
  const canReply = Boolean(accessStatus && isCapabilityAllowed(accessStatus, "reply_conversations"));
  const canManageAssignments = Boolean(accessStatus && isCapabilityAllowed(accessStatus, "manage_assignments"));
  const currentOperator = accessStatus?.principal?.displayName || "";

  useEffect(() => {
    setReplyText(replyDraftsRef.current.get(selectedIdentityKey) || "");
    setReplyAttachments([]);
    setAttachmentBusy(false);
    setReplyFeedback("");
    setSuggestion({ text: "", sourceText: "", loading: canReply, error: "" });
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
    const suggestionRequest = canReply
      ? api.generateConversationReplySuggestion(identity)
      : Promise.resolve(null);
    const needsProfileRefresh = selectedConversation.channel === "work_wechat" && (
      !String(selectedConversation.customer?.avatarUrl || "").trim()
      || /^企业微信客户(?:\s|$)/.test(String(selectedConversation.customer?.name || selectedConversation.title || "").trim())
    );
    const profileRequest = needsProfileRefresh
      ? api.refreshWechatWorkCustomerProfile(identity)
      : Promise.resolve(null);
    const timelineRequest = api.getConversationTimeline(identity);
    void timelineRequest.then(
      (records) => {
        if (sequence !== timelineSequence.current) return;
        setTimeline(records);
        setTimelineLoading(false);
      },
      (error) => {
        if (sequence !== timelineSequence.current) return;
        setTimeline([]);
        setTimelineError(errorMessage(error, "会话时间线读取失败"));
        setTimelineLoading(false);
      },
    );
    void readRequest.then((readResult) => {
      if (sequence !== timelineSequence.current) return;
      if (readResult) {
        setConversations((current) => current.map((conversation) =>
          conversation.id === selectedConversation.id ? { ...conversation, unreadCount: 0 } : conversation,
        ));
      }
    }, (error) => {
      if (sequence === timelineSequence.current) {
        setReadNotice(errorMessage(error, "消息已显示，但已读状态更新失败"));
      }
    });
    void suggestionRequest.then((generated) => {
      if (sequence !== timelineSequence.current || !generated) return;
      setSuggestion({
        text: generated.suggestedReply || "",
        sourceText: generated.sourceText,
        loading: false,
        error: generated.suggestedReply ? "" : "AI 服务没有返回建议回复，未填入任何虚构内容。",
        knowledgeMatches: generated.knowledgeMatches.map((match) => ({ title: match.title, score: match.score ?? match.qualityScore })),
        appliedSkills: generated.appliedSkills.map((skill) => skill.name),
      });
    }, (error) => {
      if (sequence === timelineSequence.current) {
        setSuggestion((current) => ({ ...current, loading: false, error: errorMessage(error, "AI 回复建议生成失败") }));
      }
    });
    void profileRequest.then((profile) => {
      if (sequence !== timelineSequence.current || !profile) return;
      setConversations((current) => current.map((item) => item.id === selectedConversation.id
        ? { ...item, ...profile.conversation, customer: profile.customer }
        : item));
    }, () => {
      // Profile enrichment is best-effort and must never block the conversation timeline.
    });
  }, [accessPhase, api, canReply, mode, selectedIdentityKey]);

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

  useEffect(() => {
    if (accessPhase !== "ready") return;

    const refreshLiveData = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const records = await api.getWechatConversations();
        setConversations(records);
      } catch {
        // Keep the last visible official conversation list during a transient refresh failure.
      }

      if (mode !== "detail" || !selectedConversation) return;
      const sequence = ++liveTimelineSequence.current;
      try {
        const records = await api.getConversationTimeline(conversationIdentity(selectedConversation));
        if (sequence === liveTimelineSequence.current && selectedConversationIdRef.current === selectedConversation.id) {
          setTimeline(records);
          setTimelineError("");
          setTimelineLoading(false);
        }
      } catch {
        // The explicit refresh action remains responsible for surfacing persistent errors.
      }
    };

    const timer = window.setInterval(() => void refreshLiveData(), 2000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshLiveData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      liveTimelineSequence.current += 1;
    };
  }, [accessPhase, api, mode, selectedIdentityKey]);

  const updateFilters = useCallback((patch: Partial<ConversationListFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }, []);

  const updateReplyText = useCallback((value: string) => {
    setReplyText(value);
    if (!selectedIdentityKey) return;
    if (value) replyDraftsRef.current.set(selectedIdentityKey, value);
    else replyDraftsRef.current.delete(selectedIdentityKey);
    setReplyDraftVersion((current) => current + 1);
  }, [selectedIdentityKey]);

  const visibleConversations = useMemo(
    () => filterAndSortConversations(conversations, operationsById, filters),
    [conversations, filters, operationsById],
  );
  const listReadState: ConversationReadState = listError
    ? listLoaded ? "stale" : "unknown"
    : listLoading
      ? listLoaded ? "refreshing" : "loading"
      : listLoaded ? "ready" : "unknown";
  const operationsReadState: ConversationReadState = operationsLoadError
    ? operationsLoaded ? "stale" : "unknown"
    : operationsLoading
      ? operationsLoaded ? "refreshing" : "loading"
      : operationsLoaded ? "ready" : "unknown";
  const scopeEligibleConversations = useMemo(
    () => filterAndSortConversations(conversations, operationsById, { ...filters, scope: "all" }),
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
    pendingCount: scopeEligibleConversations.filter((conversation) => Number(conversation.unreadCount || 0) > 0).length,
    search: filters.search,
    searchPlaceholder: "搜索客户、账号或消息",
    scope: filters.scope,
    scopeOptions: [
      { value: "all", label: "全部", count: scopeEligibleConversations.length },
      { value: "unread", label: "未读", count: scopeEligibleConversations.filter((item) => Number(item.unreadCount || 0) > 0).length },
      { value: "manual", label: "人工接管", count: scopeEligibleConversations.filter((item) => item.manualLocked).length },
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
    conversations: pagedConversations.map((conversation) => {
      const item = toWorkbenchConversation(conversation, operationsById.get(conversation.id));
      const draftPreview = replyDraftsRef.current.get(conversationIdentityKey(conversation))?.trim();
      return draftPreview ? { ...item, draftPreview } : item;
    }),
    selectedConversationId,
    page: safePage,
    pageCount,
    pageSize,
    pageSizeOptions: [10, 20, 50],
    loading: listLoading,
    error: listError || undefined,
    emptyTitle: conversations.length ? "没有符合条件的会话" : "还没有企业微信会话",
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
    replyDraftVersion,
    safePage,
    scopeEligibleConversations,
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
        replyAttachments,
        attachmentBusy,
        replyFeedback,
        queuedReplyTaskId,
        canReply: canReply && hasCompleteConversationIdentity(selectedConversation),
        suggestion,
        aiProviderStatus,
        aiProviderError,
      })
    : null, [aiProviderError, aiProviderStatus, attachmentBusy, canReply, queuedReplyTaskId, replyAttachments, replyBusy, replyFeedback, replyText, selectedConversation, suggestion, timeline, timelineError, timelineLoading]);

  const context = useMemo<ConversationWorkbenchContext | null>(() =>
    mode === "detail" || mode === "list" || !selectedConversation
      ? null
      : toWorkbenchContext(selectedConversation, activeOperations || undefined),
  [activeOperations, mode, selectedConversation]);

  const selectConversation = useCallback((conversationId: string) => {
    setSelectedConversationId(conversationId);
    setQueuedReplyTaskId("");
    setReplyFeedback("");
    setReplyAttachments([]);
    setActionNotice("");
    setActionError("");
    setManualLockTarget(null);
    setActivePane("thread");
  }, []);

  const attachReplyFiles = useCallback(async (files: File[]) => {
    const conversation = selectedConversation;
    if (!conversation || !canReply || !currentOperator) {
      setReplyFeedback("当前会话不可上传回复附件。");
      return;
    }
    if (!hasCompleteConversationIdentity(conversation)) {
      setReplyFeedback("当前会话身份不完整，不能上传回复附件；请先重新同步官方会话。");
      return;
    }
    const remaining = Math.max(0, 4 - replyAttachments.length);
    const selectedFiles = files.slice(0, remaining);
    if (!selectedFiles.length) {
      setReplyFeedback("每次回复最多添加 4 个附件。");
      return;
    }
    const identity = conversationIdentity(conversation);
    setAttachmentBusy(true);
    setReplyFeedback("正在安全上传附件…");
    const uploaded: DesignAsset[] = [];
    try {
      for (const file of selectedFiles) {
        const mimeType = supportedReplyAttachmentMime(file);
        if (!mimeType) throw new Error(`不支持附件格式：${file.name}；当前支持 JPG、PNG、PDF、TXT。`);
        if (file.size <= 5 || file.size > 20 * 1024 * 1024) throw new Error(`附件 ${file.name} 必须大于 5 字节且不超过 20 MB。`);
        uploaded.push(await api.uploadAsset({
          ownerType: "customer",
          ownerId: identity.customerId,
          role: "manual_reply_attachment",
          fileName: file.name,
          mimeType,
          source: "conversation_manual_reply",
          base64: await fileBase64(file),
          expectedWechatAccountId: identity.wechatAccountId,
          expectedConversationId: identity.conversationId,
          expectedCustomerId: identity.customerId,
        }));
      }
      if (selectedConversationIdRef.current === conversation.id) {
        setReplyAttachments((current) => [...current, ...uploaded].slice(0, 4));
        setReplyFeedback(`已添加 ${uploaded.length} 个附件，发送时仍会经过企业微信安全校验。`);
      }
    } catch (error) {
      if (selectedConversationIdRef.current === conversation.id) {
        if (uploaded.length) setReplyAttachments((current) => [...current, ...uploaded].slice(0, 4));
        setReplyFeedback(errorMessage(error, "附件上传失败"));
      }
    } finally {
      setAttachmentBusy(false);
    }
  }, [api, canReply, currentOperator, replyAttachments.length, selectedConversation]);

  const sendReply = useCallback(async () => {
    const conversation = selectedConversation;
    const text = replyText.trim();
    const assetIds = replyAttachments.map((asset) => asset.id);
    if (!conversation) {
      setReplyFeedback("请先选择客户会话。");
      return;
    }
    if (!canReply || !currentOperator) {
      setReplyFeedback("当前操作员没有回复会话权限，不能提交人工回复。");
      return;
    }
    if (!hasCompleteConversationIdentity(conversation)) {
      setReplyFeedback("当前会话缺少账号、会话或客户身份，人工回复没有入队。");
      return;
    }
    if (!text && !assetIds.length) {
      setReplyFeedback("请输入人工回复内容或添加附件。");
      return;
    }
    if (text.length > 2000) {
      setReplyFeedback("人工回复不能超过 2000 个字符。");
      return;
    }
    if (new TextEncoder().encode(text).length > 2048) {
      setReplyFeedback("人工回复不能超过企业微信限制的 2048 个 UTF-8 字节。");
      return;
    }
    setReplyBusy(true);
    setReplyFeedback("");
    setQueuedReplyTaskId("");
    const identity = conversationIdentity(conversation);
    const operation = reserveClientOperation(
      "manual-reply",
      { identity, text, assetIds, operator: currentOperator },
      pendingReplyOperationRef.current,
    );
    pendingReplyOperationRef.current = operation;
    try {
      const queued = await api.queueManualConversationReply(identity, text, operation.key, currentOperator, assetIds);
      pendingReplyOperationRef.current = completeClientOperation(pendingReplyOperationRef.current, operation.key);
      setReplyText("");
      replyDraftsRef.current.delete(selectedIdentityKey);
      setReplyDraftVersion((current) => current + 1);
      setReplyAttachments([]);
      setQueuedReplyTaskId(queued.task.id);
      setTimeline((current) => {
        const optimistic: ConversationTimelineItem = {
          id: `send-task:${queued.task.id}`,
          source: "send_task",
          sendTaskId: queued.task.id,
          conversationId: identity.conversationId,
          customerId: identity.customerId,
          wechatAccountId: identity.wechatAccountId,
          direction: "outbound",
          text,
          attachments: replyAttachments.map((asset) => ({
            id: asset.id,
            assetId: asset.id,
            kind: asset.mimeType.startsWith("image/") ? "image" : "file",
            name: asset.fileName,
            mimeType: asset.mimeType,
            status: "queued",
            localPath: asset.localPath,
            sizeBytes: asset.sizeBytes,
          })),
          status: queued.task.status || "queued",
          createdAt: queued.task.createdAt || new Date().toISOString(),
        };
        return [...current.filter((item) => item.id !== optimistic.id), optimistic]
          .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
      });
      setReplyFeedback(`回复已进入发送队列，可继续处理其他消息。任务 ${queued.task.id} 正在发送。`);
      setReplyBusy(false);
      void (async () => {
        let deliverySummary: string;
        try {
          const executed = await api.executeManualReplyNow(queued.task.id, identity);
          const settled = executed.task.status === "sending"
            ? await waitForManualReplySettlement(api, identity, queued.task.id)
            : executed.task;
          deliverySummary = manualReplyDeliverySummary(settled || executed.task);
        } catch (error) {
          deliverySummary = `${errorMessage(error, "企业微信发送未完成")}。任务 ${queued.task.id} 已保留，未确认成功前不会重复发送。`;
        }
        const timelineResult = await Promise.allSettled([api.getConversationTimeline(identity)]);
        if (selectedConversationIdRef.current !== conversation.id) return;
        setReplyFeedback(deliverySummary);
        if (timelineResult[0].status === "fulfilled") {
          setTimeline(timelineResult[0].value);
        } else {
          setReplyFeedback(
            `${deliverySummary} 时间线刷新失败：${errorMessage(timelineResult[0].reason, "未知错误")}。请勿重复发送。`,
          );
        }
      })();
    } catch (error) {
      setReplyFeedback(errorMessage(error, "人工回复入队失败"));
    } finally {
      setReplyBusy(false);
    }
  }, [api, canReply, currentOperator, replyAttachments, replyText, selectedConversation, selectedIdentityKey]);

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
      const generated = await api.generateConversationReplySuggestion(conversationIdentity(conversation));
      setSuggestion({
        text: generated.suggestedReply,
        sourceText: generated.sourceText,
        loading: false,
        error: generated.suggestedReply ? "" : "AI 服务没有返回建议回复，未填入任何虚构内容。",
        knowledgeMatches: generated.knowledgeMatches.map((match) => ({ title: match.title, score: match.score ?? match.qualityScore })),
        appliedSkills: generated.appliedSkills.map((skill) => skill.name),
      });
    } catch (error) {
      setSuggestion({ text: "", sourceText: latestInbound.text, loading: false, error: errorMessage(error, "建议回复生成失败") });
    }
  }, [api, selectedConversation, timeline]);

  const useSuggestion = useCallback(() => {
    if (!suggestion.text) return;
    updateReplyText(suggestion.text.slice(0, 2000));
    setReplyFeedback("建议已填入回复框，请人工核对后再入队。");
  }, [suggestion.text, updateReplyText]);

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
    if (!hasCompleteConversationIdentity(selectedConversation)) {
      setActionError("当前会话缺少账号、会话或客户身份，不能人工接管；请先重新同步官方会话。");
      return;
    }
    setActionError("");
    setManualLockTarget(!Boolean(selectedConversation.manualLocked));
  }, [canReply, currentOperator, selectedConversation]);

  const confirmManualLockChange = useCallback(async () => {
    const conversation = selectedConversation;
    const target = manualLockTarget;
    if (!conversation || target === null || !canReply || !currentOperator) return;
    if (!hasCompleteConversationIdentity(conversation)) {
      setManualLockTarget(null);
      setActionError("当前会话身份不完整，人工接管状态没有变更。");
      return;
    }
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
    if (operationsReadState !== "ready") {
      setOperationsActionError("分配与 SLA 状态尚未完成最新读取，已阻止保存；请刷新后重试。");
      return;
    }
    setOperationsBusy(true);
    setOperationsActionError("");
    setOperationsActionNotice("");
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
      setOperationsActionNotice("分配、优先级、处理状态与 SLA 已由服务端确认保存。");
    } catch (error) {
      setOperationsActionError(errorMessage(error, "会话运营字段保存失败"));
    } finally {
      setOperationsBusy(false);
    }
  }, [api, canManageAssignments, currentOperator, mode, operationsReadState, selectedConversation]);

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
    onUseSuggestion: useSuggestion,
    onRegenerateSuggestion: () => void generateSuggestion(),
    onReplyChange: updateReplyText,
    onAttachFiles: (files) => void attachReplyFiles(files),
    onRemoveAttachment: (assetId) => setReplyAttachments((current) => current.filter((asset) => asset.id !== assetId)),
    onSendReply: () => void sendReply(),
    onEditAssignment: openAssignment,
  }), [
    generateSuggestion,
    attachReplyFiles,
    openAssignment,
    refreshTimeline,
    refreshWorkspace,
    selectConversation,
    selectedConversation,
    sendReply,
    updateReplyText,
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
    listReadState,
    selectionError,
    operationsReadState,
    operationsReadError: operationsLoadError,
    operationsError: operationsActionError || operationsLoadError || (!canManageAssignments ? "当前操作员没有管理会话分配的权限。" : ""),
    operationsNotice: operationsActionNotice,
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

function conversationIdentityKey(conversation: Pick<Conversation, "id" | "wechatAccountId" | "customerId">) {
  return `${conversation.id}\u0000${conversation.wechatAccountId}\u0000${conversation.customerId}`;
}

async function waitForManualReplySettlement(
  api: ConversationsFeatureApi,
  identity: ConversationIdentity,
  taskId: string,
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const tasks = await api.getSendTasks(identity);
    const task = tasks.find((item) => item.id === taskId);
    if (task && ["sent", "failed", "blocked", "cancelled", "uncertain"].includes(task.status)) return task;
  }
  return null;
}

function manualReplyDeliverySummary(task: SendTask) {
  if (task.status === "sent") return `回复任务 ${task.id} 已通过企业微信官方客服通道发送。`;
  if (task.status === "sending") return `回复任务 ${task.id} 已提交企业微信官方客服通道，正在等待发送回执，请勿重复发送。`;
  if (["blocked", "failed", "cancelled", "uncertain"].includes(task.status)) {
    return `回复任务 ${task.id} 未发送：${task.errorMessage || task.guardSnapshot?.reason || task.status}。`;
  }
  return `回复任务 ${task.id} 当前状态：${task.status || "待处理"}。`;
}

function errorMessage(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  return detail ? `${fallback}：${detail}` : fallback;
}

function withConversationReadTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function supportedReplyAttachmentMime(file: File) {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  const byExtension: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
  };
  const expected = byExtension[extension];
  if (!expected) return "";
  const declared = String(file.type || "").toLowerCase();
  return !declared || declared === expected ? expected : "";
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`附件 ${file.name} 读取失败。`));
    reader.onload = () => {
      const value = String(reader.result || "");
      const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : "";
      if (!base64) reject(new Error(`附件 ${file.name} 没有可上传内容。`));
      else resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}
