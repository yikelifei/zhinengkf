"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Conversation,
  InboundProcessResult,
  OperatorAccessStatus,
  OperatorCapability,
  RouteEvaluation,
} from "../../lib/api";
import { createClientOperationKey } from "../../lib/client-operation-key";
import { routingFeatureApi, type RoutingFeatureApi } from "./api";

type AccessPhase = "loading" | "ready" | "denied" | "error";
type RoutingBusy = "" | "evaluate" | "process";
export type RoutingResultKind = "evaluated" | "processed" | null;

function capabilityAllowed(status: OperatorAccessStatus, capability: OperatorCapability) {
  return status.enforcementReady && status.capabilities.includes(capability);
}

export function useRoutingController(api: RoutingFeatureApi = routingFeatureApi, initialConversationId = "") {
  const [accessPhase, setAccessPhase] = useState<AccessPhase>("loading");
  const [accessStatus, setAccessStatus] = useState<OperatorAccessStatus | null>(null);
  const [accessError, setAccessError] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsError, setConversationsError] = useState("");
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [selectedConversationId, setSelectedConversationIdState] = useState("");
  const [messageText, setMessageTextState] = useState("");
  const [busy, setBusy] = useState<RoutingBusy>("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [route, setRoute] = useState<RouteEvaluation | null>(null);
  const [processResult, setProcessResult] = useState<InboundProcessResult | null>(null);
  const [resultKind, setResultKind] = useState<RoutingResultKind>(null);
  const [processConfirmationOpen, setProcessConfirmationOpen] = useState(false);
  const [processExternalId, setProcessExternalId] = useState("");
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setAccessPhase("loading");
    setAccessError("");
    setConversationsError("");
    setConversationsLoaded(false);
    setConversations([]);
    setSelectedConversationIdState("");
    setProcessConfirmationOpen(false);
    setProcessExternalId("");
    try {
      const status = await api.getOperatorAccessStatus();
      if (sequence !== refreshSequence.current) return;
      setAccessStatus(status);
      if (!capabilityAllowed(status, "view_console")) {
        setAccessPhase("denied");
        return;
      }
      setAccessPhase("ready");
      try {
        const records = await api.getWechatConversations();
        if (sequence !== refreshSequence.current) return;
        setConversations(records);
        setConversationsLoaded(true);
        setSelectedConversationIdState(records.some((conversation) => conversation.id === initialConversationId) ? initialConversationId : "");
      } catch (error) {
        if (sequence === refreshSequence.current) setConversationsError(errorMessage(error, "会话列表读取失败"));
      }
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      setAccessStatus(null);
      setAccessPhase("error");
      setAccessError(errorMessage(error, "无法确认当前操作员权限"));
    }
  }, [api, initialConversationId]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) || null,
    [conversations, selectedConversationId],
  );
  const canProcess = Boolean(
    conversationsLoaded
      && accessStatus
      && capabilityAllowed(accessStatus, "reply_conversations")
      && capabilityAllowed(accessStatus, "approve_send"),
  );
  const canEvaluate = conversationsLoaded;

  const clearResult = useCallback(() => {
    setRoute(null);
    setProcessResult(null);
    setResultKind(null);
    setActionNotice("");
    setActionError("");
    setProcessConfirmationOpen(false);
    setProcessExternalId("");
  }, []);

  const setSelectedConversationId = useCallback((conversationId: string) => {
    setSelectedConversationIdState(conversationId);
    clearResult();
  }, [clearResult]);

  const setMessageText = useCallback((text: string) => {
    setMessageTextState(text);
    clearResult();
  }, [clearResult]);

  const validateInput = useCallback(() => {
    if (!conversationsLoaded) {
      setActionError("会话列表尚未成功读取；为避免使用过期身份，路由评估与消息处理均已阻止。");
      return null;
    }
    if (!selectedConversation) {
      setActionError("请先明确选择要判断的客户会话；系统不会默认使用第一个客户。");
      return null;
    }
    const text = messageText.trim();
    if (!text) {
      setActionError("请先输入要判断的客户消息。");
      return null;
    }
    return { conversation: selectedConversation, text };
  }, [conversationsLoaded, messageText, selectedConversation]);

  const evaluateOnly = useCallback(async () => {
    const input = validateInput();
    if (!input || busy) return;
    const { conversation, text } = input;
    setBusy("evaluate");
    setActionError("");
    setActionNotice("");
    setProcessResult(null);
    try {
      const evaluation = await api.evaluateRoute(text, {
        conversationId: conversation.id,
        wechatAccountId: conversation.wechatAccountId,
        customerId: conversation.customerId,
      });
      setRoute(evaluation);
      setResultKind("evaluated");
      setActionNotice("仅评估完成：未写入客户消息，也未执行后续业务流程。");
    } catch (error) {
      setRoute(null);
      setResultKind(null);
      setActionError(errorMessage(error, "路由评估失败"));
    } finally {
      setBusy("");
    }
  }, [api, busy, validateInput]);

  const requestProcessing = useCallback(() => {
    const input = validateInput();
    if (!input || busy) return;
    if (!canProcess) {
      setActionError("当前操作员必须同时具备 reply_conversations 与 approve_send 权限，才能写入并处理客户消息。");
      return;
    }
    setActionError("");
    setProcessExternalId((current) => current || createClientOperationKey("routing-inbound"));
    setProcessConfirmationOpen(true);
  }, [busy, canProcess, validateInput]);

  const confirmProcessing = useCallback(async () => {
    const input = validateInput();
    if (!input || busy || !canProcess || !processExternalId) return;
    const { conversation, text } = input;
    setProcessConfirmationOpen(false);
    setBusy("process");
    setActionError("");
    setActionNotice("");
    try {
      const result = await api.processInboundMessage({
        conversationId: conversation.id,
        wechatAccountId: conversation.wechatAccountId,
        customerId: conversation.customerId,
        text,
        externalId: processExternalId,
      });
      setRoute(result.route);
      setProcessResult(result);
      setResultKind("processed");
      setActionNotice(`服务端已保存该客户消息并返回 ${result.plan.type} 计划；后续任务与发送结果仍以对应责任页的服务端记录为准。`);
      setProcessExternalId("");
    } catch (error) {
      setRoute(null);
      setProcessResult(null);
      setResultKind(null);
      setActionError(errorMessage(error, "客户消息处理结果未确认；再次确认会复用同一操作标识，请勿改文案后盲目重试"));
    } finally {
      setBusy("");
    }
  }, [api, busy, canProcess, processExternalId, validateInput]);

  const permissionDetail = accessStatus
    ? [accessStatus.notice, ...accessStatus.blockers.map((blocker) => blocker.message), ...accessStatus.requiredNextSteps]
        .filter(Boolean)
        .join("；")
    : "";

  return {
    accessPhase,
    accessError,
    permissionDetail,
    conversations,
    conversationsError,
    conversationsLoaded,
    selectedConversation,
    selectedConversationId,
    setSelectedConversationId,
    messageText,
    setMessageText,
    busy,
    canProcess,
    canEvaluate,
    actionError,
    actionNotice,
    route,
    processResult,
    resultKind,
    processConfirmationOpen,
    processExternalId,
    setProcessConfirmationOpen,
    refresh,
    evaluateOnly,
    requestProcessing,
    confirmProcessing,
  };
}

function errorMessage(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  return detail ? `${fallback}：${detail}` : fallback;
}
