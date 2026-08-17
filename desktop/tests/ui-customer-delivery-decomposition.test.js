"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("conversation responsibilities use separate list, reply, context, and assignment routes", () => {
  const list = read("apps/web/src/features/conversations/conversation-list-page.tsx");
  const detail = read("apps/web/src/features/conversations/conversation-detail-page.tsx");
  const context = read("apps/web/src/features/conversations/conversation-context-page.tsx");
  const assignment = read("apps/web/src/features/conversations/conversation-assignment-page.tsx");
  assert.match(list, /next\/link/);
  assert.match(list, /encodeURIComponent\(conversation\.id\)/);
  assert.doesNotMatch(list, /ConversationThreadPane|ConversationOperationsPanel/);
  assert.match(detail, /ConversationThreadPane/);
  assert.doesNotMatch(detail, /ConversationOperationsPanel/);
  assert.match(context, /只读展示客户、任务、服务状态和发送身份/);
  assert.doesNotMatch(context, /onSave=|queueManualConversationReply/);
  assert.match(assignment, /ConversationOperationsPanel/);
  assert.doesNotMatch(assignment, /ConversationThreadPane/);
});

test("routing evaluation and side-effecting processing have different URLs and modes", () => {
  const evaluateRoute = read("apps/web/src/app/routing/page.tsx");
  const processRoute = read("apps/web/src/app/routing/process/page.tsx");
  const feature = read("apps/web/src/features/routing/routing-feature-page.tsx");
  assert.match(evaluateRoute, /routeId="routing"/);
  assert.doesNotMatch(evaluateRoute, /mode="process"/);
  assert.match(processRoute, /routeId="routingProcess"/);
  assert.match(processRoute, /mode="process"/);
  assert.match(feature, /routingIdentityHref\(mode === "evaluate" \? "\/routing\/process" : "\/routing", controller\.selectedConversation\)/);
  assert.match(feature, /conversationId: conversation\.id/);
  assert.match(processRoute, /initialConversationId=\{identityFilters\.conversationId\}/);
});

test("send lists navigate to one-task pages and diagnostics mutations are isolated", () => {
  const queue = read("apps/web/src/features/send/send-queue-page.tsx");
  const blocked = read("apps/web/src/features/send/send-blocked-page.tsx");
  const diagnostics = read("apps/web/src/features/send/send-diagnostics-page.tsx");
  const operations = read("apps/web/src/features/send/send-diagnostics-operations-page.tsx");
  assert.match(queue, /SendTaskListItem/);
  assert.match(queue, /scopedSendTaskHref\("\/send\/queue", task\)/);
  assert.match(blocked, /SendTaskListItem/);
  assert.match(blocked, /scopedSendTaskHref\("\/send\/blocked", task\)/);
  assert.doesNotMatch(diagnostics, /scanSendOperations|scanBridgeInbox/);
  assert.match(operations, /scanSendOperations/);
  assert.match(operations, /scanBridgeInbox/);
});

test("review queues only select records while decision pages bind exactly one route id", () => {
  const queues = read("apps/web/src/features/reviews/review-queue-pages.tsx");
  const design = read("apps/web/src/features/reviews/review-design-page.tsx");
  const quotes = read("apps/web/src/features/reviews/review-quotes-page.tsx");
  const orders = read("apps/web/src/features/reviews/review-orders-page.tsx");
  assert.match(queues, /打开审核决策/);
  assert.doesNotMatch(queues, /reviewDesignJob|reviewQuote\(|reviewOrder\(/);
  for (const source of [design, quotes, orders]) {
    assert.match(source, /reviewId: string/);
    assert.match(source, /useReviewRecord\(/);
    assert.doesNotMatch(source, /useReviewCenter\(/);
    assert.doesNotMatch(source, /find\(\([a-z]+(?:Job|Quote|Order)?\) => [a-z]+(?:Job|Quote|Order)?\.id === reviewId\)/);
  }
});

test("new focused customer-delivery page components stay bounded", () => {
  const pages = [
    "features/conversations/conversation-list-page.tsx",
    "features/conversations/conversation-detail-page.tsx",
    "features/conversations/conversation-context-page.tsx",
    "features/conversations/conversation-assignment-page.tsx",
    "features/notifications/notifications-page.tsx",
    "features/reviews/review-queue-pages.tsx",
    "features/send/send-diagnostics-operations-page.tsx",
  ];
  for (const relativePath of pages) {
    const source = read("apps/web/src/" + relativePath);
    assert.ok(source.split(/\r?\n/).length < 250, relativePath + " must remain below 250 lines");
  }
});
