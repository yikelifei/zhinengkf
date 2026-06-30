"use strict";

const BRIDGE_ACK_VERSION = "wechat_bridge_ack_v1";

function validateSendGuard({
  task,
  account,
  conversation,
  customer,
  recentMessage,
  activeWindow,
  accountQueueTaskIds = [],
  maxWindowSnapshotAgeSeconds,
  now = new Date(),
}) {
  const checks = [];
  const windowState = activeWindow || {};
  const queueHeadId = accountQueueTaskIds[0];

  checks.push(check("wechatAccount", "微信账号正确", task?.wechatAccountId, windowState.wechatAccountId || windowState.accountId));
  checks.push(
    check(
      "activeChatTitle",
      "当前聊天对象正确",
      conversation?.title || conversation?.externalChatId,
      windowState.chatTitle || windowState.externalChatId,
      (expected, actual) => Boolean(expected && actual && String(expected).trim() === String(actual).trim()),
    ),
  );
  checks.push({
    key: "recentMessageOrCustomerId",
    label: "最近消息或客户ID匹配",
    expected: conversation?.customerId || customer?.id || "",
    actual: windowState.recentCustomerId || recentMessage?.customerId || "",
    passed: Boolean(
      (conversation?.customerId && windowState.recentCustomerId === conversation.customerId) ||
        (recentMessage?.conversationId && recentMessage.conversationId === conversation?.id),
    ),
  });
  checks.push({
    key: "singleAccountQueueHead",
    label: "单账号队列串行",
    expected: task?.id || "",
    actual: queueHeadId || "",
    passed: !queueHeadId || queueHeadId === task?.id,
  });
  checks.push({
    key: "conversationManualUnlocked",
    label: "会话未被人工接管",
    expected: "未锁定",
    actual: conversation?.manualLocked ? "已人工接管" : "未锁定",
    passed: conversation?.manualLocked !== true,
  });

  const maxAgeSeconds = Number(maxWindowSnapshotAgeSeconds);
  if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
    const freshness = windowSnapshotFreshness(windowState, now);
    checks.push({
      key: "windowSnapshotFresh",
      label: "窗口快照足够新",
      expected: `<= ${maxAgeSeconds}s`,
      actual: freshness.valid ? `${freshness.ageSeconds}s` : "missing timestamp",
      passed: freshness.valid && freshness.ageSeconds <= maxAgeSeconds,
    });
  }

  const failed = checks.filter((item) => !item.passed);
  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "passed" : "blocked",
    checks,
    failedKeys: failed.map((item) => item.key),
    reason: failed.length ? failed.map((item) => item.label).join("、") : "所有发送校验通过",
  };
}

function windowSnapshotFreshness(windowState, now = new Date()) {
  const capturedAt = windowState?.capturedAt || windowState?.createdAt;
  const time = new Date(String(capturedAt || ""));
  const nowTime = now instanceof Date ? now.getTime() : new Date(String(now || "")).getTime();
  if (Number.isNaN(time.getTime()) || Number.isNaN(nowTime)) {
    return { valid: false, ageSeconds: null };
  }
  return {
    valid: true,
    ageSeconds: Math.max(0, Math.round((nowTime - time.getTime()) / 1000)),
  };
}

function validateSendTaskBinding({ task, conversation, designJob, quoteDraft }) {
  const checks = [];
  const payload = task && typeof task.payload === "object" && task.payload ? task.payload : {};

  checks.push({
    key: "conversationExists",
    label: "会话存在",
    expected: task?.conversationId || "",
    actual: conversation?.id || "",
    passed: Boolean(task?.conversationId && conversation?.id === task.conversationId),
  });

  checks.push({
    key: "wechatAccountOwnsConversation",
    label: "微信账号绑定会话",
    expected: conversation?.wechatAccountId || "",
    actual: task?.wechatAccountId || "",
    passed: Boolean(conversation?.wechatAccountId && task?.wechatAccountId === conversation.wechatAccountId),
  });
  checks.push({
    key: "conversationManualUnlocked",
    label: "会话未被人工接管",
    expected: "未锁定",
    actual: conversation?.manualLocked ? "已人工接管" : "未锁定",
    passed: conversation?.manualLocked !== true,
  });

  if (payload.wechatAccountId) {
    checks.push({
      key: "payloadWechatAccountMatchesTask",
      label: "发送内容微信账号匹配任务",
      expected: task?.wechatAccountId || "",
      actual: payload.wechatAccountId || "",
      passed: Boolean(task?.wechatAccountId && payload.wechatAccountId === task.wechatAccountId),
    });
  }
  if (payload.conversationId) {
    checks.push({
      key: "payloadConversationMatchesTask",
      label: "发送内容会话匹配任务",
      expected: task?.conversationId || "",
      actual: payload.conversationId || "",
      passed: Boolean(task?.conversationId && payload.conversationId === task.conversationId),
    });
  }
  if (payload.customerId) {
    checks.push({
      key: "payloadCustomerMatchesConversation",
      label: "发送内容客户匹配会话",
      expected: conversation?.customerId || "",
      actual: payload.customerId || "",
      passed: Boolean(conversation?.customerId && payload.customerId === conversation.customerId),
    });
  }
  if (payload.designJobId) {
    checks.push({
      key: "payloadDesignJobMatchesTask",
      label: "发送内容设计任务匹配任务",
      expected: task?.designJobId || "",
      actual: payload.designJobId || "",
      passed: Boolean(task?.designJobId && payload.designJobId === task.designJobId),
    });
  }
  if (payload.quoteDraftId) {
    checks.push({
      key: "payloadQuoteDraftMatchesTask",
      label: "发送内容报价匹配任务",
      expected: task?.quoteDraftId || "",
      actual: payload.quoteDraftId || "",
      passed: Boolean(task?.quoteDraftId && payload.quoteDraftId === task.quoteDraftId),
    });
  }

  if (task?.designJobId || designJob) {
    checks.push({
      key: "designJobExists",
      label: "设计任务存在",
      expected: task?.designJobId || "",
      actual: designJob?.id || "",
      passed: Boolean(designJob && (!task?.designJobId || designJob.id === task.designJobId)),
    });
    checks.push({
      key: "designJobConversationMatches",
      label: "设计任务会话匹配",
      expected: conversation?.id || "",
      actual: designJob?.conversationId || "",
      passed: Boolean(designJob?.conversationId && conversation?.id && designJob.conversationId === conversation.id),
    });
    checks.push({
      key: "designJobCustomerMatches",
      label: "设计任务客户匹配",
      expected: conversation?.customerId || "",
      actual: designJob?.customerId || "",
      passed: Boolean(designJob?.customerId && conversation?.customerId && designJob.customerId === conversation.customerId),
    });
    checks.push({
      key: "designJobAccountMatches",
      label: "设计任务账号匹配",
      expected: task?.wechatAccountId || "",
      actual: designJob?.wechatAccountId || "",
      passed: !designJob?.wechatAccountId || designJob.wechatAccountId === task?.wechatAccountId,
    });
  }

  if (task?.quoteDraftId || quoteDraft) {
    checks.push({
      key: "quoteDraftExists",
      label: "报价草稿存在",
      expected: task?.quoteDraftId || "",
      actual: quoteDraft?.id || "",
      passed: Boolean(quoteDraft && (!task?.quoteDraftId || quoteDraft.id === task.quoteDraftId)),
    });
    checks.push({
      key: "quoteCustomerMatches",
      label: "报价客户匹配",
      expected: conversation?.customerId || "",
      actual: quoteDraft?.customerId || "",
      passed: Boolean(quoteDraft?.customerId && conversation?.customerId && quoteDraft.customerId === conversation.customerId),
    });
    if (quoteDraft?.designJobId && designJob) {
      checks.push({
        key: "quoteDesignJobMatches",
        label: "报价设计任务匹配",
        expected: designJob.id || "",
        actual: quoteDraft.designJobId || "",
        passed: quoteDraft.designJobId === designJob.id,
      });
    }
    if (task?.designJobId && quoteDraft?.designJobId) {
      checks.push({
        key: "taskQuoteDesignJobMatches",
        label: "发送任务报价设计任务匹配",
        expected: task.designJobId || "",
        actual: quoteDraft.designJobId || "",
        passed: task.designJobId === quoteDraft.designJobId,
      });
    }
  }

  const failed = checks.filter((item) => !item.passed);
  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "passed" : "blocked",
    checks,
    failedKeys: failed.map((item) => item.key),
    reason: failed.length ? failed.map((item) => item.label).join("、") : "发送任务绑定关系正确",
  };
}

function validateBridgeAckBinding({ task, attempt, payload = {} }) {
  const checks = [];
  const isSentAck = payload.status === "sent";
  const ackOutboxFileName = bridgeOutboxFileName(
    payload.outboxFileName ||
      payload.outboxFile ||
      payload.metadata?.outboxFileName ||
      payload.metadata?.outboxFile,
  );
  const expectedOutboxFileName = bridgeOutboxFileName(
    attempt?.metadata?.outboxFileName ||
      attempt?.metadata?.outboxFile ||
      attempt?.metadata?.adapter?.outboxFile,
  );

  checks.push({
    key: "taskExists",
    label: "send task exists",
    expected: "present",
    actual: task?.id || "",
    passed: Boolean(task?.id),
  });
  checks.push({
    key: "taskIsSending",
    label: "send task is waiting for bridge ack",
    expected: "sending",
    actual: task?.status || "",
    passed: task?.status === "sending",
  });
  checks.push({
    key: "attemptExists",
    label: "bridge attempt exists",
    expected: "present",
    actual: attempt?.id || "",
    passed: Boolean(attempt?.id),
  });
  checks.push({
    key: "attemptTaskMatches",
    label: "bridge attempt belongs to send task",
    expected: task?.id || "",
    actual: attempt?.sendTaskId || "",
    passed: Boolean(task?.id && attempt?.sendTaskId === task.id),
  });
  checks.push({
    key: "attemptAdapterMatches",
    label: "bridge attempt adapter matches",
    expected: "windows_bridge",
    actual: attempt?.adapter || "",
    passed: attempt?.adapter === "windows_bridge",
  });
  checks.push({
    key: "attemptIsStarted",
    label: "bridge attempt is pending",
    expected: "started",
    actual: attempt?.status || "",
    passed: attempt?.status === "started",
  });

  if (isSentAck) {
    checks.push({
      key: "ackProtocolVersion",
      label: "sent bridge ack protocol version matches",
      expected: BRIDGE_ACK_VERSION,
      actual: payload.version || payload.protocolVersion || "",
      passed: payload.version === BRIDGE_ACK_VERSION || payload.protocolVersion === BRIDGE_ACK_VERSION,
    });
    checks.push({
      key: "ackAccountPresent",
      label: "sent bridge ack includes wechat account",
      expected: "present",
      actual: payload.wechatAccountId || "",
      passed: Boolean(payload.wechatAccountId),
    });
    checks.push({
      key: "ackConversationPresent",
      label: "sent bridge ack includes conversation",
      expected: "present",
      actual: payload.conversationId || "",
      passed: Boolean(payload.conversationId),
    });
    checks.push({
      key: "attemptOutboxFilePresent",
      label: "bridge attempt has outbox file",
      expected: "present",
      actual: expectedOutboxFileName,
      passed: Boolean(expectedOutboxFileName),
    });
    checks.push({
      key: "ackOutboxFilePresent",
      label: "sent bridge ack includes outbox file",
      expected: "present",
      actual: ackOutboxFileName,
      passed: Boolean(ackOutboxFileName),
    });
  }

  if (expectedOutboxFileName && (payload.status === "sent" || ackOutboxFileName)) {
    checks.push({
      key: "ackOutboxFileMatches",
      label: "bridge ack outbox file matches attempt",
      expected: expectedOutboxFileName,
      actual: ackOutboxFileName,
      passed: ackOutboxFileName === expectedOutboxFileName,
    });
  }

  if (payload.wechatAccountId) {
    checks.push({
      key: "ackAccountMatches",
      label: "bridge ack wechat account matches send task",
      expected: task?.wechatAccountId || "",
      actual: payload.wechatAccountId || "",
      passed: Boolean(task?.wechatAccountId && payload.wechatAccountId === task.wechatAccountId),
    });
  }

  if (payload.conversationId) {
    checks.push({
      key: "ackConversationMatches",
      label: "bridge ack conversation matches send task",
      expected: task?.conversationId || "",
      actual: payload.conversationId || "",
      passed: Boolean(task?.conversationId && payload.conversationId === task.conversationId),
    });
  }

  const failed = checks.filter((item) => !item.passed);
  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "passed" : "blocked",
    checks,
    failedKeys: failed.map((item) => item.key),
    reason: failed.length ? failed.map((item) => item.label).join("; ") : "bridge ack binding is valid",
  };
}

function bridgeOutboxFileName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.split(/[\\/]/).filter(Boolean).pop() || "";
}

function evaluateSendTaskRequeue({ task } = {}) {
  if (!task?.id) {
    return {
      ok: false,
      action: "reject_requeue",
      reason: "invalid_task",
      failedKeys: ["taskExists"],
    };
  }
  if (task.status === "sent") {
    return {
      ok: false,
      action: "reject_requeue",
      reason: "sent_task",
      failedKeys: ["taskNotSent"],
    };
  }
  if (task.status === "cancelled" && (task.guardSnapshot?.cancelledAt || task.guardSnapshot?.cancelReason)) {
    return {
      ok: false,
      action: "reject_requeue",
      reason: "audited_cancelled_task",
      failedKeys: ["taskNotAuditedCancelled"],
      message: "已人工取消并记录审计的发送任务不能重新排队，请重新创建发送任务。",
    };
  }
  if (task.status === "sending") {
    return {
      ok: false,
      action: "reject_requeue",
      reason: "bridge_ack_pending",
      failedKeys: ["bridgeAckPending"],
      message: "发送任务正在等待 Windows 桥接回执，不能直接重新排队。请先取消任务或等待失败回执。",
    };
  }
  if (task.conversation?.manualLocked || task.manualLocked) {
    return {
      ok: false,
      action: "reject_requeue",
      reason: "conversation_manual_locked",
      failedKeys: ["conversationManualUnlocked"],
      message: "会话已人工接管，解除锁定后才能重新排队发送任务。",
    };
  }
  return {
    ok: true,
    action: "requeue",
    reason: "manual_requeue_allowed",
    failedKeys: [],
  };
}

function buildSendQueueSkipAdvice({ reason, task, queueHeadTask } = {}) {
  const taskId = task?.id || "";
  const queueHeadId = queueHeadTask?.id || "";
  if (reason === "not_account_queue_head") {
    return {
      reason,
      severity: "warning",
      blockingTaskId: queueHeadId || null,
      message: queueHeadId
        ? `同一微信账号前面还有待处理任务 ${queueHeadId}，当前任务 ${taskId} 不能插队。`
        : `同一微信账号前面还有待处理任务，当前任务 ${taskId} 不能插队。`,
      recommendedAction: queueHeadId
        ? "先处理、取消或重新排队前序发送任务，再让低价值自动化继续发送。"
        : "先刷新队列并确认该微信账号的队首任务状态。",
    };
  }
  if (reason === "same_account_already_processed_this_cycle") {
    return {
      reason,
      severity: "info",
      blockingTaskId: null,
      message: "同一轮自动化里，每个微信账号只处理一个发送任务，避免焦点和窗口状态混乱。",
      recommendedAction: "等待下一轮自动化继续处理，或人工点击安全发送队列处理。",
    };
  }
  if (reason === "task_no_longer_queued") {
    return {
      reason,
      severity: "info",
      blockingTaskId: null,
      message: `发送任务 ${taskId} 已不在待发队列，可能已被处理或取消。`,
      recommendedAction: "刷新队列状态即可。",
    };
  }
  if (reason === "conversation_manual_locked") {
    return {
      reason,
      severity: "warning",
      blockingTaskId: null,
      message: `发送任务 ${taskId} 所属会话已人工接管，自动发送已暂停。`,
      recommendedAction: "由人工继续处理该客户；如需恢复自动发送，先解除接管，再手动重新排队。",
    };
  }
  return {
    reason: reason || "unknown",
    severity: "info",
    blockingTaskId: null,
    message: "该发送任务本轮未处理。",
    recommendedAction: "查看发送任务详情和最近一次安全校验结果。",
  };
}

function check(key, label, expected, actual, comparator = defaultComparator) {
  return {
    key,
    label,
    expected: expected || "",
    actual: actual || "",
    passed: comparator(expected, actual),
  };
}

function defaultComparator(expected, actual) {
  return Boolean(expected && actual && String(expected) === String(actual));
}

module.exports = {
  buildSendQueueSkipAdvice,
  evaluateSendTaskRequeue,
  validateBridgeAckBinding,
  validateSendGuard,
  validateSendTaskBinding,
};
