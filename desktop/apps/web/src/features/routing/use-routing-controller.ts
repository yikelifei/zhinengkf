"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Conversation,
  InboundProcessResult,
  OperatorAccessStatus,
  OperatorCapability,
  RouteEvaluation,
} from "../../lib/api";
import { routingFeatureApi, type RoutingFeatureApi } from "./api";

type AccessPhase = "loading" | "ready" | "denied" | "error";
type RoutingBusy = "" | "evaluate" | "process";
export type RoutingResultKind = "evaluated" | "processed" | null;

function capabilityAllowed(status: OperatorAccessStatus, capability: OperatorCapability) {
  return status.enforcementReady && status.capabilities.includes(capability);
}

export function useRoutingController(api: RoutingFeatureApi = routingFeatureApi) {
  const [accessPhase, setAccessPhase] = useState<AccessPhase>("loading");
  const [accessStatus, setAccessStatus] = useState<OperatorAccessStatus | null>(null);
  const [accessError, setAccessError] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsError, setConversationsError] = useState("");
  const [selectedConversationId, setSelectedConversationIdState] = useState("");
  const [messageText, setMessageTextState] = useState("");
  const [busy, setBusy] = useState<RoutingBusy>("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [route, setRoute] = useState<RouteEvaluation | null>(null);
  const [processResult, setProcessResult] = useState<InboundProcessResult | null>(null);
  const [resultKind, setResultKind] = useState<RoutingResultKind>(null);
  const [processConfirmationOpen, setProcessConfirmationOpen] = useState(false);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setAccessPhase("loading");
    setAccessError("");
    setConversationsError("");
    try {
      const status = await api.getOperatorAccessStatus();
      if (sequence !== refreshSequence.current) return;
      setAccessStatus(status);
      if (!capabilityAllowed(status, "view_console")) {
        setAccessPhase("denied");
        setConversations([]);
        setSelectedConversationIdState("");
        return;
      }
      setAccessPhase("ready");
      try {
        const records = await api.getWechatConversations();
        if (sequence !== refreshSequence.current) return;
        setConversations(records);
        setSelectedConversationIdState((current) =>
          current && records.some((conversation) => conversation.id === current) ? current : "",
        );
      } catch (error) {
        if (sequence === refreshSequence.current) setConversationsError(errorMessage(error, "会话列表读取失败"));
      }
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      setAccessStatus(null);
      setAccessPhase("error");
      setAccessError(errorMessage(error, "无法确认当前操作员权限"));
    }
  }, [api]);

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
  const canProcess = Boolean(accessStatus && capabilityAllowed(accessStatus, "reply_conversations"));

  const clearResult = useCallback(() => {
    setRoute(null);
    setProcessResult(null);
    setResultKind(null);
    setActionNotice("");
    setActionError("");
    setProcessConfirmationOpen(false);
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
  }, [messageText, selectedConversation]);

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
      setActionError("当前操作员没有 reply_conversations 权限，不能处理客户消息。");
      return;
    }
    setActionError("");
    setProcessConfirmationOpen(true);
  }, [busy, canProcess, validateInput]);

  const confirmProcessing = useCallback(async () => {
    const input = validateInput();
    if (!input || busy || !canProcess) return;
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
      });
      setRoute(result.route);
      setProcessResult(result);
      setResultKind("processed");
      setActionNotice(`客户消息已处理，服务端计划为 ${result.plan.type}。`);
    } catch (error) {
      setRoute(null);
      setProcessResult(null);
      setResultKind(null);
      setActionError(errorMessage(error, "客户消息处理失败"));
    } finally {
      setBusy("");
    }
  }, [api, busy, canProcess, validateInput]);

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
    selectedConversation,
    selectedConversationId,
    setSelectedConversationId,
    messageText,
    setMessageText,
    busy,
    canProcess,
    actionError,
    actionNotice,
    route,
    processResult,
    resultKind,
    processConfirmationOpen,
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
