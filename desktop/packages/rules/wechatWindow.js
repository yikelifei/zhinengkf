"use strict";

function normalizeWechatWindowSnapshot(input = {}) {
  const processId = Number(input.processId || 0);
  const capturedAt = input.capturedAt || input.createdAt || new Date().toISOString();
  const isOnline = input.isOnline !== false && input.status !== "offline";
  const chatTitle = firstText(input.chatTitle, input.activeChatTitle, input.title);

  return {
    source: firstText(input.source, "manual"),
    isOnline,
    wechatAccountId: firstText(input.wechatAccountId, input.accountId),
    accountDisplayName: firstText(input.accountDisplayName, input.displayName),
    windowHandle: firstText(input.windowHandle, input.hwnd),
    processId: Number.isFinite(processId) && processId > 0 ? processId : null,
    chatTitle,
    activeChatTitle: chatTitle,
    externalChatId: firstText(input.externalChatId, input.chatId),
    recentCustomerId: firstText(input.recentCustomerId, input.customerId),
    recentMessageText: firstText(input.recentMessageText, input.lastMessageText),
    confidence: clampConfidence(input.confidence),
    capturedAt,
    raw: input.raw || null,
  };
}

function diagnoseWechatWindowSnapshot({ snapshot, account, conversations = [] }) {
  const normalized = normalizeWechatWindowSnapshot(snapshot);
  const conversation = findActiveConversation(normalized, conversations);
  const checks = [
    {
      key: "windowOnline",
      label: "微信窗口在线",
      expected: "online",
      actual: normalized.isOnline ? "online" : "offline",
      passed: normalized.isOnline,
    },
    {
      key: "accountBound",
      label: "窗口账号已绑定",
      expected: account?.id || account?.displayName || "",
      actual: normalized.wechatAccountId || normalized.accountDisplayName || "",
      passed: accountMatches(normalized, account),
    },
    {
      key: "activeConversationKnown",
      label: "当前聊天对象可识别",
      expected: "known conversation",
      actual: normalized.chatTitle || normalized.externalChatId || normalized.recentCustomerId || "",
      passed: Boolean(conversation),
    },
  ];
  const failed = checks.filter((item) => !item.passed);

  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "ready" : "needs_attention",
    riskLevel: failed.length === 0 ? "low" : failed.some((item) => item.key === "accountBound") ? "high" : "medium",
    checks,
    failedKeys: failed.map((item) => item.key),
    activeConversationId: conversation?.id || null,
    activeCustomerId: conversation?.customerId || normalized.recentCustomerId || null,
    reason: failed.length ? failed.map((item) => item.label).join("、") : "窗口快照可用于发送前校验",
    snapshot: normalized,
  };
}

function buildDemoWechatWindowSnapshot({ mode = "correct", account, conversation, otherConversation } = {}) {
  if (mode === "offline") {
    return normalizeWechatWindowSnapshot({
      source: "demo",
      isOnline: false,
      wechatAccountId: account?.id || "",
      accountDisplayName: account?.displayName || "",
      chatTitle: "",
      recentCustomerId: "",
      confidence: 0.2,
    });
  }

  const activeConversation = mode === "wrong_chat" ? otherConversation || {} : conversation || {};
  return normalizeWechatWindowSnapshot({
    source: "demo",
    isOnline: true,
    wechatAccountId: account?.id || activeConversation.wechatAccountId || "",
    accountDisplayName: account?.displayName || "",
    windowHandle: `demo-${account?.id || "wechat"}`,
    chatTitle: activeConversation.title || "",
    externalChatId: activeConversation.externalChatId || "",
    recentCustomerId: activeConversation.customerId || "",
    recentMessageText: mode === "wrong_chat" ? "当前窗口停留在其他客户" : "当前窗口与待发送客户匹配",
    confidence: mode === "wrong_chat" ? 0.65 : 0.96,
  });
}

function findActiveConversation(snapshot, conversations = []) {
  return (
    conversations.find((conversation) => {
      if (snapshot.externalChatId && conversation.externalChatId === snapshot.externalChatId) return true;
      if (snapshot.chatTitle && String(conversation.title || "").trim() === snapshot.chatTitle) return true;
      if (snapshot.recentCustomerId && conversation.customerId === snapshot.recentCustomerId) return true;
      return false;
    }) || null
  );
}

function accountMatches(snapshot, account) {
  if (!account) return Boolean(snapshot.wechatAccountId || snapshot.accountDisplayName);
  if (snapshot.wechatAccountId && snapshot.wechatAccountId === account.id) return true;
  if (snapshot.accountDisplayName && snapshot.accountDisplayName === account.displayName) return true;
  return false;
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0, Math.min(number, 1));
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

module.exports = {
  buildDemoWechatWindowSnapshot,
  diagnoseWechatWindowSnapshot,
  normalizeWechatWindowSnapshot,
};
