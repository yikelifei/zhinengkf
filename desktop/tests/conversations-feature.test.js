"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("conversations feature is an isolated controller over the existing API contract", () => {
  const api = read("apps/web/src/features/conversations/api.ts");
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");

  for (const apiName of [
    "getOperatorAccessStatus",
    "getWechatConversations",
    "getConversationOperationsQueue",
    "getConversationTimeline",
    "markConversationMessagesRead",
    "queueManualConversationReply",
    "setConversationManualLock",
    "updateConversationOperations",
    "evaluateRoute",
  ]) {
    assert.match(api, new RegExp(`\\b${apiName}\\b`));
  }
  assert.doesNotMatch(`${api}\n${controller}`, /\bfetch\s*\(|\baxios\b|getRouteEvaluations|\bload\s*\(/);
  assert.match(controller, /status\.enforcementReady/);
  assert.match(controller, /capabilities\.includes\(capability\)/);
  assert.match(controller, /Promise\.allSettled\(/);
  assert.match(controller, /回复任务已经成功入队，请勿重复发送/);
  assert.match(controller, /expectedWechatAccountId/);
  assert.match(controller, /expectedConversationId/);
  assert.match(controller, /expectedCustomerId/);
});

test("conversation list, reply, context, and assignment are independent page blocks", () => {
  const list = read("apps/web/src/features/conversations/conversation-list-page.tsx");
  const detail = read("apps/web/src/features/conversations/conversation-detail-page.tsx");
  const context = read("apps/web/src/features/conversations/conversation-context-page.tsx");
  const assignment = read("apps/web/src/features/conversations/conversation-assignment-page.tsx");
  const index = read("apps/web/src/features/conversations/index.ts");

  for (const page of ["ConversationListPage", "ConversationDetailPage", "ConversationContextPage", "ConversationAssignmentPage"]) {
    assert.match(index, new RegExp(`\\b${page}\\b`));
  }
  assert.match(list, /href=\{"\/conversations\/" \+ encodeURIComponent\(conversation\.id\)\}/);
  assert.doesNotMatch(list, /ConversationThreadPane|ConversationOperationsPanel/);
  assert.match(detail, /<ConversationThreadPane/);
  assert.match(detail, /\/context/);
  assert.match(detail, /\/assignment/);
  assert.doesNotMatch(detail, /ConversationOperationsPanel|ConversationContextPane/);
  assert.match(context, /客户与会话资料/);
  assert.doesNotMatch(context, /onSave=|queueManualConversationReply/);
  assert.match(assignment, /<ConversationOperationsPanel/);
  assert.doesNotMatch(assignment, /ConversationThreadPane/);
  assert.match(detail, /role="region"/);
  assert.match(detail, /aria-live="polite"/);
  assert.doesNotMatch(`${list}\n${detail}\n${context}\n${assignment}`, /aria-modal="true"|role="alertdialog"|(?:演示|demo|mock|示例客户)/i);
});

test("conversations model filters, paginates and maps live records without demo data", () => {
  require("ts-node").register({
    transpileOnly: true,
    compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
  });
  const model = require("../apps/web/src/features/conversations/model");
  const rows = [
    {
      id: "c-1",
      title: "客户一",
      channel: "personal_wechat",
      customerId: "customer-1",
      wechatAccountId: "account-1",
      manualLocked: true,
      unreadCount: 2,
      lastMessagePreview: "请帮我看一下",
      lastMessageAt: "2026-07-17T03:00:00.000Z",
    },
    {
      id: "c-2",
      title: "客户二",
      channel: "work_wechat",
      customerId: "customer-2",
      wechatAccountId: "account-2",
      unreadCount: 0,
      lastMessageAt: "2026-07-16T03:00:00.000Z",
    },
  ];

  const visible = model.filterAndSortConversations(rows, new Map(), {
    search: "客户一",
    scope: "manual",
    channel: "all",
    status: "all",
    sort: "latest",
  });
  assert.deepEqual(visible.map((row) => row.id), ["c-1"]);
  assert.deepEqual(model.conversationIdentity(rows[0]), {
    wechatAccountId: "account-1",
    conversationId: "c-1",
    customerId: "customer-1",
  });
});

test("conversation page CSS keeps focused routes usable at 390px", () => {
  const css = read("apps/web/src/features/conversations/conversation-pages.module.css");
  assert.match(css, /min-width:\s*0/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /var\(--wk-color-brand\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|overflow-x:\s*(?:auto|scroll)/i);
});
