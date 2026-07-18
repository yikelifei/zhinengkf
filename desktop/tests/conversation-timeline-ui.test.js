"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("frontend history and manual reply clients carry strict identity and only enqueue", () => {
  const api = read("apps/web/src/lib/api.ts");
  const history = api.slice(
    api.indexOf("export async function getConversationTimeline"),
    api.indexOf("export async function setConversationManualLock"),
  );
  assert.match(history, /wechatAccountId:\s*identity\.wechatAccountId/);
  assert.match(history, /customerId:\s*identity\.customerId/);
  assert.match(history, /identity\.conversationId/);
  assert.match(history, /identityExpectation\(identity\)/);
  assert.match(history, /manual-replies/);
  assert.doesNotMatch(history, /inbound\/messages|execute|mark-sent|bridge-ack|wechat-work\/kf\/send-text/);
});

test("WeChat account and conversation clients surface API failures instead of false empty lists", () => {
  const api = read("apps/web/src/lib/api.ts");
  const accountsStart = api.indexOf("export async function getWechatAccounts");
  const conversationsStart = api.indexOf("export async function getWechatConversations", accountsStart);
  const timelineStart = api.indexOf("export async function getConversationTimeline", conversationsStart);
  const accounts = api.slice(accountsStart, conversationsStart);
  const conversations = api.slice(conversationsStart, timelineStart);

  for (const section of [accounts, conversations]) {
    assert.match(section, /if \(!response\.ok\)/);
    assert.match(section, /await response\.text\(\)/);
    assert.match(section, /throw new Error/);
    assert.doesNotMatch(section, /catch\s*\{/);
    assert.doesNotMatch(section, /return \[\]/);
  }
});

test("manual reply acknowledges the queued result before a fallible timeline refresh", () => {
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");
  const start = controller.indexOf("const sendReply = useCallback");
  const end = controller.indexOf("const generateSuggestion = useCallback", start);
  const section = controller.slice(start, end);
  const queuedIndex = section.indexOf("await api.queueManualConversationReply");
  const successIndex = section.indexOf("setReplyFeedback(queuedSummary)");
  const refreshIndex = section.indexOf("await Promise.allSettled");

  assert.ok(queuedIndex >= 0, "manual reply should enqueue through the safe queue");
  assert.ok(successIndex > queuedIndex, "the queued result should be acknowledged after enqueue succeeds");
  assert.ok(refreshIndex > successIndex, "timeline refresh should happen after the queue acknowledgement");
  assert.match(section, /回复任务已经成功入队，请勿重复发送/);
  assert.doesNotMatch(section, /await Promise\.all\(/);
});

test("AI reply assistance reads the latest inbound text and never sends automatically", () => {
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");
  const start = controller.indexOf("const generateSuggestion = useCallback");
  const end = controller.indexOf("const useSuggestion = useCallback", start);
  const section = controller.slice(start, end);

  assert.match(section, /\[\.\.\.timeline\]\.reverse\(\)\.find\(\(item\) => item\.direction === "inbound"/);
  assert.match(section, /api\.evaluateRoute\(latestInbound\.text/);
  assert.match(section, /route\.suggestedReply \|\| ""/);
  assert.doesNotMatch(section, /queueManualConversationReply|executeSendTask|processSafeSendQueue/);
});

test("the detail route owns message reading and guards read mutations by detail mode", () => {
  const page = read("apps/web/src/features/conversations/conversation-detail-page.tsx");
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");

  assert.match(page, /本页只负责阅读消息、生成辅助建议并提交人工回复/);
  assert.match(page, /<ConversationThreadPane/);
  assert.match(controller, /mode !== "detail" \|\| !selectedConversation \|\| accessPhase !== "ready"/);
  assert.match(controller, /api\.markConversationMessagesRead\(identity\)/);
  assert.match(controller, /sequence !== timelineSequence\.current/);
});
