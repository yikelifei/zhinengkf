"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", moduleResolution: "Node", jsx: "react-jsx", esModuleInterop: true },
});

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const navigation = require("../apps/web/src/features/conversations/conversation-navigation");
const notificationNavigation = require("../apps/web/src/features/notifications/notification-navigation");
const conversationModel = require("../apps/web/src/features/conversations/model");

test("conversation navigation restores bounded list state and preserves the complete customer identity", () => {
  const state = navigation.conversationNavigationFromSearchParams({
    q: "  客户一  ",
    scope: "unread",
    channel: "work_wechat",
    status: "overdue",
    sort: "oldest",
    page: "7",
  });
  assert.deepEqual(state, {
    search: "客户一",
    scope: "unread",
    channel: "work_wechat",
    status: "overdue",
    sort: "oldest",
    page: 7,
  });
  const conversation = { id: "conversation-1", wechatAccountId: "account-1", customerId: "customer-1" };
  const href = navigation.conversationRouteHref("/conversations/conversation-1", conversation, state);
  const query = new URL(href, "https://local.invalid").searchParams;
  assert.equal(query.get("wechatAccountId"), "account-1");
  assert.equal(query.get("conversationId"), "conversation-1");
  assert.equal(query.get("customerId"), "customer-1");
  assert.equal(query.get("q"), "客户一");
  assert.equal(query.get("page"), "7");
  assert.equal(
    navigation.conversationListHref(state),
    "/conversations?q=%E5%AE%A2%E6%88%B7%E4%B8%80&scope=unread&channel=work_wechat&status=overdue&sort=oldest&page=7",
  );
  assert.equal(navigation.conversationMatchesIdentityFilters(conversation, conversation), true);
  assert.equal(navigation.conversationMatchesIdentityFilters(conversation, { ...conversation, customerId: "other" }), false);
  assert.deepEqual(
    navigation.conversationNavigationFromSearchParams({ scope: "invented", status: "invented", sort: "invented", page: "-2" }),
    { search: undefined, scope: undefined, channel: undefined, status: undefined, sort: undefined, page: undefined },
  );
});

test("conversation routes validate identity and carry list state through detail, context, and assignment", () => {
  const routePaths = [
    "apps/web/src/app/conversations/[id]/page.tsx",
    "apps/web/src/app/conversations/[id]/context/page.tsx",
    "apps/web/src/app/conversations/[id]/assignment/page.tsx",
  ];
  for (const routePath of routePaths) {
    const source = read(routePath);
    assert.match(source, /identityFiltersFromSearchParams\(Promise\.resolve\(rawSearchParams\)\)/);
    assert.match(source, /conversationNavigationFromSearchParams\(rawSearchParams\)/);
    assert.match(source, /identityFilters=\{identityFilters\}/);
    assert.match(source, /navigation=\{navigation\}/);
  }
  const listRoute = read("apps/web/src/app/conversations/page.tsx");
  assert.match(listRoute, /initialNavigation=\{navigation\}/);

  for (const pagePath of [
    "apps/web/src/features/conversations/conversation-detail-page.tsx",
    "apps/web/src/features/conversations/conversation-context-page.tsx",
    "apps/web/src/features/conversations/conversation-assignment-page.tsx",
  ]) {
    const source = read(pagePath);
    assert.match(source, /expectedIdentity: identityFilters/);
    assert.match(source, /conversationRouteHref\(/);
    assert.match(source, /conversationListHref\(navigation\)/);
    assert.match(source, /selectionError/);
  }
});

test("conversation and SLA reads distinguish unknown, refreshing, stale, and selection mismatch states", () => {
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");
  const context = read("apps/web/src/features/conversations/conversation-context-page.tsx");
  const assignment = read("apps/web/src/features/conversations/conversation-assignment-page.tsx");
  const panel = read("apps/web/src/components/conversation-operations-panel.tsx");

  assert.match(controller, /setSelectionError\(initialConversation/);
  assert.doesNotMatch(controller, /setListError\(initialConversation/);
  assert.match(controller, /listLoaded \? "stale" : "unknown"/);
  assert.match(controller, /operationsLoaded \? "refreshing" : "loading"/);
  assert.match(controller, /operationsReadState !== "ready"/);
  assert.match(controller, /已由服务端确认保存/);
  assert.match(context, /operationsReadState === "refreshing"/);
  assert.match(context, /以上为上次成功结果/);
  assert.match(context, /conversations-context-retry-operations/);
  assert.match(assignment, /operationsReadState !== "ready"/);
  assert.match(panel, /disabled=\{readState === "refreshing"\}/);
  assert.match(panel, /conversations-assignment-refresh-stale/);
  assert.match(panel, /当前显示上次成功读取的分配与 SLA/);
});

test("notifications return to the identity-bound disposition page without creating a send side effect", () => {
  const route = read("apps/web/src/app/notifications/page.tsx");
  const page = read("apps/web/src/features/notifications/notifications-page.tsx");
  const helper = read("apps/web/src/features/notifications/notification-navigation.ts");
  assert.match(route, /identityFiltersFromSearchParams\(searchParams\)/);
  assert.match(route, /NotificationsPage identityFilters=\{identityFilters\}/);
  assert.match(page, /notificationTargetHref\(notification, identityFilters\)/);
  assert.match(helper, /回到会话处置/);
  assert.match(helper, /去会话列表核对身份/);
  assert.doesNotMatch(page, /queueManualConversationReply|processSafeSendQueue|executeSendTask/);

  const fullNotification = {
    id: "notice-1",
    level: "warning",
    title: "SLA 即将超时",
    body: "请尽快处理",
    createdAt: "2026-08-17T00:00:00.000Z",
    target: { wechatAccountId: "account-1", conversationId: "conversation-1", customerId: "customer-1" },
  };
  const direct = notificationNavigation.notificationTargetHref(fullNotification);
  assert.equal(direct.label, "回到会话处置");
  const directUrl = new URL(direct.href, "https://local.invalid");
  assert.equal(directUrl.pathname, "/conversations/conversation-1");
  assert.equal(directUrl.searchParams.get("wechatAccountId"), "account-1");
  assert.equal(directUrl.searchParams.get("conversationId"), "conversation-1");
  assert.equal(directUrl.searchParams.get("customerId"), "customer-1");

  const legacyNotification = { ...fullNotification, id: "notice-legacy", target: { conversationId: "conversation-1" } };
  const scopedDirect = notificationNavigation.notificationTargetHref(legacyNotification, {
    wechatAccountId: "account-1",
    conversationId: "conversation-1",
    customerId: "customer-1",
  });
  assert.equal(scopedDirect.label, "回到会话处置");
  assert.match(scopedDirect.href, /wechatAccountId=account-1/);
  assert.match(scopedDirect.href, /customerId=customer-1/);

  const safeFallback = notificationNavigation.notificationTargetHref(legacyNotification);
  assert.deepEqual(safeFallback, {
    href: "/conversations?q=conversation-1",
    label: "去会话列表核对身份",
  });
  const recovered = conversationModel.filterAndSortConversations([{
    id: "conversation-1",
    wechatAccountId: "account-1",
    customerId: "customer-1",
    title: "客户一",
  }], new Map(), { ...conversationModel.DEFAULT_CONVERSATION_FILTERS, search: "conversation-1" });
  assert.deepEqual(recovered.map((item) => item.id), ["conversation-1"]);
});

test("returning to the filtered list removes stale entity identity from the URL", () => {
  const detail = read("apps/web/src/features/conversations/conversation-detail-page.tsx");
  const assignment = read("apps/web/src/features/conversations/conversation-assignment-page.tsx");
  for (const source of [detail, assignment]) {
    assert.match(source, /href=\{conversationListHref\(navigation\)\}>返回筛选结果/);
    assert.doesNotMatch(source, /conversationRouteHref\("\/conversations", conversation, navigation\)/);
  }
  const listHref = navigation.conversationListHref({ search: "客户一", status: "overdue", page: 3 });
  const url = new URL(listHref, "https://local.invalid");
  assert.equal(url.pathname, "/conversations");
  assert.equal(url.searchParams.get("q"), "客户一");
  assert.equal(url.searchParams.get("status"), "overdue");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.has("conversationId"), false);
  assert.equal(url.searchParams.has("customerId"), false);
  assert.equal(url.searchParams.has("wechatAccountId"), false);
});

test("new conversation actions are unique, semantic, and usable at 390px", () => {
  const upgrade = read("apps/web/src/features/conversations/customer-upgrade-action.tsx");
  const panel = read("apps/web/src/components/conversation-operations-panel.tsx");
  const detail = read("apps/web/src/features/conversations/conversation-detail-page.tsx");
  const context = read("apps/web/src/features/conversations/conversation-context-page.tsx");
  const assignment = read("apps/web/src/features/conversations/conversation-assignment-page.tsx");
  const pageState = read("apps/web/src/features/conversations/conversation-page-state.tsx");
  const notifications = read("apps/web/src/features/notifications/notifications-page.tsx");
  const list = read("apps/web/src/features/conversations/conversation-list-page.tsx");
  const operationsCss = read("apps/web/src/components/conversation-operations-panel.module.css");
  const pageCss = read("apps/web/src/features/conversations/conversation-pages.module.css");
  const sources = `${upgrade}\n${panel}\n${detail}\n${context}\n${assignment}\n${pageState}\n${notifications}`;
  const ids = [...sources.matchAll(/data-action-id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate action ids: ${ids.filter((id, index) => ids.indexOf(id) !== index).join(", ")}`);
  for (const id of [
    "conversations.customer-upgrade.open",
    "conversations.customer-upgrade.close",
    "conversations.customer-upgrade.cancel",
    "conversations.customer-upgrade.confirm",
  ]) assert.ok(ids.includes(id), `missing ${id}`);
  for (const id of [
    "conversations.detail.back-filtered-list",
    "conversations.detail.open-context",
    "conversations.detail.open-assignment",
    "conversations.context.back-detail",
    "conversations.context.open-assignment",
    "conversations.assignment.back-detail",
    "conversations.assignment.back-filtered-list",
    "conversations.state.back-filtered-list",
  ]) assert.ok(ids.includes(id), `missing ${id}`);
  assert.match(notifications, /data-action-id=\{"notification-open-target-" \+ notification\.id\}/);
  assert.match(notifications, /data-action-id=\{"notification-mark-read-" \+ notification\.id\}/);
  assert.match(list, /data-action-id=\{"conversations\.list-" \+ conversation\.id \+ "\.open"\}/);
  assert.match(operationsCss, /min-height:\s*44px/);
  assert.match(operationsCss, /@media \(max-width: 520px\)[\s\S]*flex-direction: column-reverse/);
  assert.match(pageCss, /@media \(max-width: 760px\)[\s\S]*\.inlineReadWarning[\s\S]*flex-direction: column/);
});
