"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSendQueueSkipAdvice,
  buildDemoWechatWindowSnapshot,
  diagnoseWechatWindowSnapshot,
  evaluateSendTaskRequeue,
  validateBridgeAckBinding,
  validateSendGuard,
  validateSendTaskBinding,
} = require("../packages/rules");

const task = { id: "send-1", wechatAccountId: "wechat-1", conversationId: "conv-1" };
const account = { id: "wechat-1", displayName: "微信客服1号" };
const conversation = { id: "conv-1", title: "王总-端午礼盒", customerId: "customer-1" };
const customer = { id: "customer-1", name: "王总" };

const boundConversation = { ...conversation, wechatAccountId: "wechat-1" };
const boundDesignJob = {
  id: "design-1",
  conversationId: "conv-1",
  customerId: "customer-1",
  wechatAccountId: "wechat-1",
};
const boundQuote = {
  id: "quote-1",
  designJobId: "design-1",
  customerId: "customer-1",
};
const bridgeAttempt = {
  id: "attempt-1",
  sendTaskId: "send-1",
  adapter: "windows_bridge",
  status: "started",
};
const bridgeAttemptWithOutbox = {
  ...bridgeAttempt,
  metadata: {
    outboxFile: "C:\\runtime\\wechat-outbox\\123-send-1.json",
  },
};

test("passes send guard when account, chat, customer and queue head all match", () => {
  const result = validateSendGuard({
    task,
    account,
    conversation,
    customer,
    activeWindow: {
      wechatAccountId: "wechat-1",
      chatTitle: "王总-端午礼盒",
      recentCustomerId: "customer-1",
    },
    accountQueueTaskIds: ["send-1"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "passed");
});

test("blocks send guard when active chat is another customer", () => {
  const result = validateSendGuard({
    task,
    account,
    conversation,
    customer,
    activeWindow: {
      wechatAccountId: "wechat-1",
      chatTitle: "李经理-企业伴手礼",
      recentCustomerId: "customer-1",
    },
    accountQueueTaskIds: ["send-1"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("activeChatTitle"), true);
});

test("blocks send guard when task is not first in account queue", () => {
  const result = validateSendGuard({
    task,
    account,
    conversation,
    customer,
    activeWindow: {
      wechatAccountId: "wechat-1",
      chatTitle: "王总-端午礼盒",
      recentCustomerId: "customer-1",
    },
    accountQueueTaskIds: ["send-0", "send-1"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("singleAccountQueueHead"), true);
});

test("blocks send guard when conversation is manually locked", () => {
  const result = validateSendGuard({
    task,
    account,
    conversation: { ...conversation, manualLocked: true },
    customer,
    activeWindow: {
      wechatAccountId: "wechat-1",
      chatTitle: "王总-端午礼盒",
      recentCustomerId: "customer-1",
    },
    accountQueueTaskIds: ["send-1"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("conversationManualUnlocked"), true);
  assert.match(result.reason, /人工接管/);
});

test("passes send guard when current window snapshot is fresh", () => {
  const result = validateSendGuard({
    task,
    account,
    conversation,
    customer,
    activeWindow: {
      wechatAccountId: "wechat-1",
      chatTitle: conversation.title,
      recentCustomerId: "customer-1",
      capturedAt: "2026-06-26T10:00:00.000Z",
    },
    accountQueueTaskIds: ["send-1"],
    maxWindowSnapshotAgeSeconds: 30,
    now: new Date("2026-06-26T10:00:20.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.failedKeys.includes("windowSnapshotFresh"), false);
});

test("blocks send guard when current window snapshot is stale", () => {
  const result = validateSendGuard({
    task,
    account,
    conversation,
    customer,
    activeWindow: {
      wechatAccountId: "wechat-1",
      chatTitle: conversation.title,
      recentCustomerId: "customer-1",
      capturedAt: "2026-06-26T10:00:00.000Z",
    },
    accountQueueTaskIds: ["send-1"],
    maxWindowSnapshotAgeSeconds: 30,
    now: new Date("2026-06-26T10:00:45.000Z"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("windowSnapshotFresh"), true);
});

test("explains send queue skips with actionable advice", () => {
  const headBlocked = buildSendQueueSkipAdvice({
    reason: "not_account_queue_head",
    task: { id: "send-low-value", wechatAccountId: "wechat-1" },
    queueHeadTask: { id: "send-old", wechatAccountId: "wechat-1" },
  });
  assert.equal(headBlocked.severity, "warning");
  assert.equal(headBlocked.blockingTaskId, "send-old");
  assert.match(headBlocked.recommendedAction, /前序发送任务/);

  const sameCycle = buildSendQueueSkipAdvice({
    reason: "same_account_already_processed_this_cycle",
    task: { id: "send-next", wechatAccountId: "wechat-1" },
  });
  assert.equal(sameCycle.severity, "info");
  assert.equal(sameCycle.blockingTaskId, null);

  const manualLocked = buildSendQueueSkipAdvice({
    reason: "conversation_manual_locked",
    task: { id: "send-locked", wechatAccountId: "wechat-1" },
  });
  assert.equal(manualLocked.severity, "warning");
  assert.match(manualLocked.message, /人工接管/);
  assert.match(manualLocked.recommendedAction, /解除接管/);
});

test("rejects requeue while conversation is manually locked", () => {
  const result = evaluateSendTaskRequeue({
    task: {
      ...task,
      status: "blocked",
      conversation: { ...conversation, manualLocked: true },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "conversation_manual_locked");
  assert.equal(result.failedKeys.includes("conversationManualUnlocked"), true);
});

test("rejects requeue while bridge ack is pending", () => {
  const result = evaluateSendTaskRequeue({
    task: {
      ...task,
      status: "sending",
      conversation,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "bridge_ack_pending");
  assert.equal(result.failedKeys.includes("bridgeAckPending"), true);
});

test("rejects requeue after audited manual cancellation", () => {
  const result = evaluateSendTaskRequeue({
    task: {
      ...task,
      status: "cancelled",
      conversation,
      guardSnapshot: {
        cancelledAt: "2026-06-30T08:00:00.000Z",
        cancelReason: "manual_takeover_cancel_send_task",
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "audited_cancelled_task");
  assert.deepEqual(result.failedKeys, ["taskNotAuditedCancelled"]);
});

test("allows requeue after dry run audit", () => {
  const result = evaluateSendTaskRequeue({
    task: {
      ...task,
      status: "dry_run",
      conversation,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "requeue");
});

test("allows requeue after manual lock is released", () => {
  const result = evaluateSendTaskRequeue({
    task: {
      ...task,
      status: "blocked",
      conversation: { ...conversation, manualLocked: false },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "requeue");
});

test("passes send task binding when account, conversation, design job and quote match", () => {
  const result = validateSendTaskBinding({
    task: { id: "send-1", wechatAccountId: "wechat-1", conversationId: "conv-1", designJobId: "design-1", quoteDraftId: "quote-1" },
    conversation: boundConversation,
    designJob: boundDesignJob,
    quoteDraft: boundQuote,
  });

  assert.equal(result.ok, true);
});

test("blocks send task binding when account does not own conversation", () => {
  const result = validateSendTaskBinding({
    task: { id: "send-1", wechatAccountId: "wechat-2", conversationId: "conv-1" },
    conversation: boundConversation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("wechatAccountOwnsConversation"), true);
});

test("blocks send task binding when payload identity points elsewhere", () => {
  const result = validateSendTaskBinding({
    task: {
      id: "send-1",
      wechatAccountId: "wechat-1",
      conversationId: "conv-1",
      designJobId: "design-1",
      quoteDraftId: "quote-1",
      payload: {
        wechatAccountId: "wechat-2",
        conversationId: "conv-2",
        customerId: "customer-2",
        designJobId: "design-2",
        quoteDraftId: "quote-2",
      },
    },
    conversation: boundConversation,
    designJob: boundDesignJob,
    quoteDraft: boundQuote,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("payloadWechatAccountMatchesTask"), true);
  assert.equal(result.failedKeys.includes("payloadConversationMatchesTask"), true);
  assert.equal(result.failedKeys.includes("payloadCustomerMatchesConversation"), true);
  assert.equal(result.failedKeys.includes("payloadDesignJobMatchesTask"), true);
  assert.equal(result.failedKeys.includes("payloadQuoteDraftMatchesTask"), true);
});

test("blocks send task binding when conversation is manually locked", () => {
  const result = validateSendTaskBinding({
    task: { id: "send-1", wechatAccountId: "wechat-1", conversationId: "conv-1" },
    conversation: { ...boundConversation, manualLocked: true },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("conversationManualUnlocked"), true);
});

test("blocks send task binding when design job belongs to another conversation", () => {
  const result = validateSendTaskBinding({
    task: { id: "send-1", wechatAccountId: "wechat-1", conversationId: "conv-1", designJobId: "design-1" },
    conversation: boundConversation,
    designJob: { ...boundDesignJob, conversationId: "conv-2" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("designJobConversationMatches"), true);
});

test("blocks send task binding when quote belongs to another customer", () => {
  const result = validateSendTaskBinding({
    task: { id: "send-1", wechatAccountId: "wechat-1", conversationId: "conv-1", designJobId: "design-1", quoteDraftId: "quote-1" },
    conversation: boundConversation,
    designJob: boundDesignJob,
    quoteDraft: { ...boundQuote, customerId: "customer-2" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("quoteCustomerMatches"), true);
});

test("blocks send task binding when quoted design job differs from hydrated design job", () => {
  const result = validateSendTaskBinding({
    task: { id: "send-1", wechatAccountId: "wechat-1", conversationId: "conv-1", designJobId: "design-1", quoteDraftId: "quote-1" },
    conversation: boundConversation,
    designJob: boundDesignJob,
    quoteDraft: { ...boundQuote, designJobId: "design-2" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("quoteDesignJobMatches"), true);
  assert.equal(result.failedKeys.includes("taskQuoteDesignJobMatches"), true);
});

test("passes bridge ack binding when task, attempt, account and conversation match", () => {
  const result = validateBridgeAckBinding({
    task: { ...task, status: "sending" },
    attempt: bridgeAttempt,
    payload: { wechatAccountId: "wechat-1", conversationId: "conv-1" },
  });

  assert.equal(result.ok, true);
});

test("passes bridge ack binding when outbox file matches pending attempt", () => {
  const result = validateBridgeAckBinding({
    task: { ...task, status: "sending" },
    attempt: bridgeAttemptWithOutbox,
    payload: {
      status: "sent",
      version: "wechat_bridge_ack_v1",
      wechatAccountId: "wechat-1",
      conversationId: "conv-1",
      outboxFileName: "123-send-1.json",
    },
  });

  assert.equal(result.ok, true);
});

test("blocks bridge ack binding when outbox file does not match pending attempt", () => {
  const result = validateBridgeAckBinding({
    task: { ...task, status: "sending" },
    attempt: bridgeAttemptWithOutbox,
    payload: {
      status: "sent",
      version: "wechat_bridge_ack_v1",
      wechatAccountId: "wechat-1",
      conversationId: "conv-1",
      outboxFileName: "another-send.json",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("ackOutboxFileMatches"), true);
});

test("blocks sent bridge ack when required ack identity is missing", () => {
  const result = validateBridgeAckBinding({
    task: { ...task, status: "sending" },
    attempt: bridgeAttemptWithOutbox,
    payload: {
      status: "sent",
      version: "wechat_bridge_ack_v1",
      outboxFileName: "123-send-1.json",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("ackAccountPresent"), true);
  assert.equal(result.failedKeys.includes("ackConversationPresent"), true);
});

test("blocks sent bridge ack when outbox binding is missing", () => {
  const result = validateBridgeAckBinding({
    task: { ...task, status: "sending" },
    attempt: bridgeAttempt,
    payload: {
      status: "sent",
      version: "wechat_bridge_ack_v1",
      wechatAccountId: "wechat-1",
      conversationId: "conv-1",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("attemptOutboxFilePresent"), true);
  assert.equal(result.failedKeys.includes("ackOutboxFilePresent"), true);
});

test("blocks sent bridge ack when protocol version is missing", () => {
  const result = validateBridgeAckBinding({
    task: { ...task, status: "sending" },
    attempt: bridgeAttemptWithOutbox,
    payload: {
      status: "sent",
      wechatAccountId: "wechat-1",
      conversationId: "conv-1",
      outboxFileName: "123-send-1.json",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("ackProtocolVersion"), true);
});

test("allows failed bridge ack without outbox file for internal timeout handling", () => {
  const result = validateBridgeAckBinding({
    task: { ...task, status: "sending" },
    attempt: bridgeAttemptWithOutbox,
    payload: {
      status: "failed",
      errorMessage: "bridge ack timeout",
    },
  });

  assert.equal(result.ok, true);
});

test("blocks bridge ack binding when ack account belongs to another wechat", () => {
  const result = validateBridgeAckBinding({
    task: { ...task, status: "sending" },
    attempt: bridgeAttempt,
    payload: { wechatAccountId: "wechat-2", conversationId: "conv-1" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("ackAccountMatches"), true);
});

test("blocks bridge ack binding when attempt belongs to another send task", () => {
  const result = validateBridgeAckBinding({
    task: { ...task, status: "sending" },
    attempt: { ...bridgeAttempt, sendTaskId: "send-2" },
    payload: { wechatAccountId: "wechat-1", conversationId: "conv-1" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("attemptTaskMatches"), true);
});

test("diagnoses a ready wechat window snapshot", () => {
  const snapshot = buildDemoWechatWindowSnapshot({
    mode: "correct",
    account,
    conversation: boundConversation,
  });
  const result = diagnoseWechatWindowSnapshot({ snapshot, account, conversations: [boundConversation] });

  assert.equal(result.ok, true);
  assert.equal(result.activeConversationId, "conv-1");
  assert.equal(result.riskLevel, "low");
});

test("diagnoses window snapshot without matching conversations across accounts", () => {
  const snapshot = buildDemoWechatWindowSnapshot({
    mode: "correct",
    account,
    conversation: { ...boundConversation, wechatAccountId: "wechat-2" },
  });
  const result = diagnoseWechatWindowSnapshot({
    snapshot: { ...snapshot, wechatAccountId: "wechat-1" },
    account,
    conversations: [{ ...boundConversation, wechatAccountId: "wechat-2" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.activeConversationId, null);
  assert.equal(result.failedKeys.includes("activeConversationKnown"), true);
});

test("diagnoses an offline wechat window snapshot as not ready", () => {
  const snapshot = buildDemoWechatWindowSnapshot({
    mode: "offline",
    account,
    conversation,
  });
  const result = diagnoseWechatWindowSnapshot({ snapshot, account, conversations: [conversation] });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("windowOnline"), true);
});
