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
    "getAiProviderStatus",
    "getConversationTimeline",
    "markConversationMessagesRead",
    "queueManualConversationReply",
    "generateConversationReplySuggestion",
    "refreshWechatWorkCustomerProfile",
    "getWechatWorkUpgradeServiceConfig",
    "upgradeWechatWorkCustomerService",
    "setConversationManualLock",
    "updateConversationOperations",
  ]) {
    assert.match(api, new RegExp(`\\b${apiName}\\b`));
  }
  assert.doesNotMatch(`${api}\n${controller}`, /\bfetch\s*\(|\baxios\b|\bload\s*\(/);
  assert.match(controller, /api\.generateConversationReplySuggestion\(identity\)/);
  assert.match(controller, /api\.refreshWechatWorkCustomerProfile\(identity\)/);
  assert.match(controller, /status\.enforcementReady/);
  assert.match(controller, /capabilities\.includes\(capability\)/);
  assert.match(controller, /Promise\.allSettled\(/);
  assert.match(controller, /回复已进入发送队列，可继续处理其他消息/);
  assert.match(controller, /expectedWechatAccountId/);
  assert.match(controller, /expectedConversationId/);
  assert.match(controller, /expectedCustomerId/);
  assert.match(controller, /api\.getAiProviderStatus\(false\)/);
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
  assert.match(list, /conversationRouteHref\("\/conversations\/" \+ encodeURIComponent\(conversation\.id\), conversation, currentNavigation\)/);
  assert.doesNotMatch(list, /ConversationThreadPane|ConversationOperationsPanel/);
  assert.match(detail, /<ConversationThreadPane/);
  assert.match(detail, /<CustomerUpgradeActionCard/);
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
  assert.equal(model.normalizeChannel(rows[0]), "personal_wechat");
  assert.equal(model.channelLabel(rows[0]), "personal_wechat");
  assert.equal(model.normalizeChannel(rows[1]), "work_wechat");
  assert.equal(model.channelLabel(rows[1]), "企业微信");
});

test("conversation workflow links keep identity when opening design, sales and training modules", () => {
  const model = read("apps/web/src/features/conversations/model.ts");
  const helper = read("apps/web/src/app/identity-search-params.ts");
  const designRoute = read("apps/web/src/app/design/jobs/new/page.tsx");
  const designCreate = read("apps/web/src/features/design/design-job-create-page.tsx");
  const designCreateModel = read("apps/web/src/features/design/design-job-create-model.ts");
  const quotesRoute = read("apps/web/src/app/sales/quotes/page.tsx");
  const ordersRoute = read("apps/web/src/app/sales/orders/page.tsx");
  const salesHooks = read("apps/web/src/features/sales/use-sales-records.ts");
  const reviewInboxRoute = read("apps/web/src/app/reviews/inbox/page.tsx");
  const reviewDesignRoute = read("apps/web/src/app/reviews/design/page.tsx");
  const reviewDesignDetailRoute = read("apps/web/src/app/reviews/design/[id]/page.tsx");
  const reviewQuotesRoute = read("apps/web/src/app/reviews/quotes/page.tsx");
  const reviewQuotesDetailRoute = read("apps/web/src/app/reviews/quotes/[id]/page.tsx");
  const reviewOrdersRoute = read("apps/web/src/app/reviews/orders/page.tsx");
  const reviewOrdersDetailRoute = read("apps/web/src/app/reviews/orders/[id]/page.tsx");
  const sendQueueRoute = read("apps/web/src/app/send/queue/page.tsx");
  const trainingImportRoute = read("apps/web/src/app/training/import/page.tsx");
  const trainingOverviewRoute = read("apps/web/src/app/training/overview/page.tsx");

  for (const target of ["/design/jobs/new", "/sales/quotes", "/sales/orders", "/reviews/inbox", "/send/queue", "/training/import"]) {
    assert.match(model, new RegExp(`conversationIdentityHref\\("${target.replace(/\//g, "\\/")}", conversation\\)`));
  }
  for (const key of ["wechatAccountId", "conversationId", "customerId"]) {
    assert.match(model, new RegExp(`params\\.set\\("${key}"`));
    assert.match(helper, new RegExp(`firstParam\\(params\\.${key}\\)`));
  }

  assert.match(designRoute, /identityFiltersFromSearchParams\(searchParams\)/);
  assert.match(designRoute, /initialIdentityFilters=\{identityFilters\}/);
  assert.match(designCreate, /rows\.filter\(\(conversation\) => identityMatchesConversation\(conversation, initialIdentityFilters\)\)/);
  assert.match(designCreate, /initialConversation\(scopedRows, initialIdentityFilters\)/);
  assert.match(designCreateModel, /conversation\.id === filters\.conversationId/);

  assert.match(quotesRoute, /identityFiltersFromSearchParams\(searchParams\)/);
  assert.match(quotesRoute, /<SalesQuotesPage identityFilters=\{identityFilters\}/);
  assert.match(ordersRoute, /<SalesOrdersPage identityFilters=\{identityFilters\}/);
  assert.match(salesHooks, /getQuotes\(filters\)/);
  assert.match(salesHooks, /getOrderDrafts\(filters\)/);

  assert.match(reviewInboxRoute, /identityFiltersFromSearchParams\(searchParams\)/);
  assert.match(reviewInboxRoute, /<ReviewInboxPage identityFilters=\{identityFilters\}/);
  assert.match(reviewDesignRoute, /<ReviewDesignQueuePage identityFilters=\{identityFilters\}/);
  assert.match(reviewQuotesRoute, /<ReviewQuotesQueuePage identityFilters=\{identityFilters\}/);
  assert.match(reviewOrdersRoute, /<ReviewOrdersQueuePage identityFilters=\{identityFilters\}/);
  assert.match(reviewDesignDetailRoute, /identityFiltersFromSearchParams\(searchParams\)/);
  assert.match(reviewDesignDetailRoute, /<ReviewDesignPage key=\{id\} reviewId=\{id\} identityFilters=\{identityFilters\}/);
  assert.match(reviewQuotesDetailRoute, /<ReviewQuotesPage key=\{id\} reviewId=\{id\} identityFilters=\{identityFilters\}/);
  assert.match(reviewOrdersDetailRoute, /<ReviewOrdersPage key=\{id\} reviewId=\{id\} identityFilters=\{identityFilters\}/);
  assert.match(sendQueueRoute, /identityFiltersFromSearchParams\(searchParams\)/);
  assert.match(sendQueueRoute, /<SendQueuePage filters=\{filters\}/);

  assert.match(trainingImportRoute, /<TrainingImportPage identityFilters=\{identityFilters\}/);
  assert.match(trainingOverviewRoute, /<TrainingOverviewPage identityFilters=\{identityFilters\}/);
});

test("conversation user-facing copy is Enterprise WeChat only", () => {
  const model = read("apps/web/src/features/conversations/model.ts");
  const detail = read("apps/web/src/features/conversations/conversation-detail-page.tsx");
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");
  const thread = read("apps/web/src/components/conversation-workbench/conversation-thread-pane.tsx");
  const composer = read("apps/web/src/components/conversation-workbench/conversation-assistant-composer.tsx");
  const visibleSource = `${model}\n${detail}\n${controller}\n${thread}\n${composer}`;

  assert.match(model, /企业微信回复会先进入后端安全发送队列/);
  assert.match(model, /sendLabel:\s*"发送到企业微信"/);
  assert.match(model, /function aiSuggestionReadiness/);
  assert.match(model, /模型配置可用/);
  assert.match(model, /模型未接通/);
  assert.match(model, /AI 状态读取失败/);
  assert.match(detail, /进入企业微信安全发送队列/);
  assert.match(controller, /企业微信官方客服通道/);
  assert.match(composer, /aria-label="核对目标会话并发送人工回复到企业微信"/);
  assert.doesNotMatch(visibleSource, /个人微信回复|发送到微信|微信客户端|核对微信账号、聊天对象|直接发送|个人微信"/);
});

test("conversation page CSS keeps focused routes usable at 390px", () => {
  const css = read("apps/web/src/features/conversations/conversation-pages.module.css");
  assert.match(css, /min-width:\s*0/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /var\(--wk-color-brand\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|overflow-x:\s*(?:auto|scroll)/i);
});
