"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("frontend history and manual reply clients carry strict identity and only enqueue", () => {
  const api = read("apps/web/src/lib/api.ts");
  const history = api.slice(api.indexOf("export async function getConversationTimeline"), api.indexOf("export async function setConversationManualLock"));
  assert.match(history, /wechatAccountId:\s*identity\.wechatAccountId/);
  assert.match(history, /customerId:\s*identity\.customerId/);
  assert.match(history, /identity\.conversationId/);
  assert.match(history, /identityExpectation\(identity\)/);
  assert.match(history, /manual-replies/);
  assert.doesNotMatch(history, /inbound\/messages|execute|mark-sent|bridge-ack|wechat-work\/kf\/send-text/);
});

test("WeChat account and conversation clients surface API failures instead of returning false empty lists", () => {
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

test("manual reply keeps the authoritative queued result when follow-up refreshes fail", () => {
  const page = read("apps/web/src/app/page.tsx");
  const start = page.indexOf("async function enqueueManualConversationReply");
  const end = page.indexOf("async function refreshConversationMessages", start);
  const section = page.slice(start, end);
  const queuedIndex = section.indexOf("await queueManualConversationReply");
  const successIndex = section.indexOf("setMessage(queuedSummary)");
  const refreshIndex = section.indexOf("await Promise.allSettled");

  assert.ok(queuedIndex >= 0, "manual reply should enqueue through the safe queue");
  assert.ok(successIndex > queuedIndex, "the UI should acknowledge the queue result after enqueue succeeds");
  assert.ok(refreshIndex > successIndex, "refreshes should happen only after the queued result is acknowledged");
  assert.match(section, /timelineResult\.status === "fulfilled"/);
  assert.match(section, /workspaceResult\.status === "rejected"/);
  assert.match(section, /回复任务已经成功入队，请勿重复发送/);
  assert.doesNotMatch(section, /await Promise\.all\(/);
});

test("AI reply assistant uses the latest inbound message and never sends automatically", () => {
  const page = read("apps/web/src/app/page.tsx");
  const latestStart = page.indexOf("const latestInboundConversationText = useMemo");
  const latestEnd = page.indexOf("useEffect(() =>", latestStart);
  const latest = page.slice(latestStart, latestEnd);
  assert.match(latest, /item\.direction === "inbound"/);
  assert.match(latest, /conversationTimeline\.length - 1/);

  const generateStart = page.indexOf("async function generateManualReplySuggestion");
  const insertStart = page.indexOf("function insertManualReplySuggestion", generateStart);
  const enqueueStart = page.indexOf("async function enqueueManualConversationReply", insertStart);
  const generate = page.slice(generateStart, insertStart);
  const insert = page.slice(insertStart, enqueueStart);
  assert.match(generate, /evaluateRoute\(sourceText/);
  assert.match(generate, /wechatAccountId: conversation\.wechatAccountId/);
  assert.match(generate, /conversationId: conversation\.id/);
  assert.match(generate, /customerId: conversation\.customerId/);
  assert.doesNotMatch(generate, /queueManualConversationReply|executeSendTask|processSafeSendQueue|setManualReplyText/);
  assert.match(insert, /setManualReplyText\(nextText\)/);
  assert.match(insert, /请人工核对后再点击发送/);
  assert.doesNotMatch(insert, /queueManualConversationReply|executeSendTask|processSafeSendQueue/);

  const assistantStart = page.indexOf("const conversationWorkbenchThread");
  const assistant = page.slice(assistantStart, page.indexOf("const conversationWorkbenchContext", assistantStart));
  assert.match(assistant, /title:\s*"AI 建议回复"/);
  assert.match(assistant, /manualReplySuggestion\?\.suggestedReply/);
  assert.match(assistant, /manualReplySuggestionSourceText/);
  assert.match(assistant, /safetyChecks:/);
  assert.match(page, /onUseSuggestion:\s*insertManualReplySuggestion/);
  assert.match(page, /onRegenerateSuggestion:\s*\(\) => void generateManualReplySuggestion\(\)/);
});

test("message center renders a three-pane WeChat workbench with real timeline and safe composer", () => {
  const page = read("apps/web/src/app/page.tsx");
  const component = read("apps/web/src/components/conversation-workbench/conversation-workbench.tsx");
  const section = page.slice(page.indexOf("const conversationWorkbenchInbox"), page.indexOf("function renderTopStatusPills"));
  assert.match(page, /<ConversationWorkbench/);
  assert.match(component, /<ConversationInboxPane/);
  assert.match(component, /<ConversationThreadPane/);
  assert.match(component, /<ConversationContextPane/);
  assert.match(section, /企业微信/);
  assert.match(section, /个人微信/);
  assert.match(section, /conversationTimelineLoading/);
  assert.match(section, /conversationTimelineError/);
  assert.match(section, /messages:\s*conversationTimeline\.map/);
  assert.match(section, /attachments:\s*item\.attachments\.map/);
  assert.match(section, /unreadCount:\s*Number\(conversation\.unreadCount/);
  assert.match(section, /customer:/);
  assert.match(page, /onSendReply:\s*\(\) => void enqueueManualConversationReply\(\)/);
  assert.match(section, /安全队列/);
  assert.match(page, /activePane=\{conversationMobilePane\}/);
  assert.match(section, /maxLength:\s*MANUAL_REPLY_MAX_LENGTH/);
  assert.match(section, /feedback:\s*manualReplyFeedback/);
});

test("message center prioritizes Enterprise WeChat before unread count and recency", () => {
  const page = read("apps/web/src/app/page.tsx");
  const start = page.indexOf("const filteredConversations = useMemo");
  const section = page.slice(start, page.indexOf("const totalConversationUnread", start));
  assert.match(section, /isWorkWechatConversation/);
  assert.match(section, /channelPriority/);
  assert.match(section, /unreadPriority/);
  assert.match(section, /lastMessageAt/);
});

test("legacy WeChat conversations are not mislabeled as Personal WeChat", () => {
  const page = read("apps/web/src/app/page.tsx");
  assert.match(page, /function isPersonalWechatConversation/);
  assert.match(page, /wechat:\s*"微信"/);
  assert.match(page, /function conversationChannelDisplayLabel/);
  assert.match(page, /channelTone:\s*isPersonal \? "success" as const : "brand" as const/);
  assert.match(page, /conversationChannel === "personal_wechat" && !isPersonalWechatConversation\(conversation\)/);
});

test("conversation history loading cancels stale requests and marks selected conversation read", () => {
  const page = read("apps/web/src/app/page.tsx");
  const switchStart = page.indexOf("async function changeActiveConversation");
  const switchHandler = page.slice(switchStart, page.indexOf("async function focusConversation", switchStart));
  assert.match(switchHandler, /conversationId === activeConversationId/);
  assert.match(switchHandler, /await refreshConversationMessages\(\)/);
  const start = page.indexOf("let cancelled = false;", page.indexOf("const activeConversation = useMemo"));
  const effect = page.slice(start, page.indexOf("useEffect(() =>", start + 1));
  assert.match(effect, /getConversationTimeline\(identity\)/);
  assert.match(effect, /if \(cancelled\) return/);
  assert.match(effect, /markConversationMessagesRead\(identity\)/);
  assert.match(effect, /conversation\.id === activeConversation\.id/);
});

test("final responsive overrides keep the chat workbench contained on desktop and mobile", () => {
  const css = read("apps/web/src/components/conversation-workbench/conversation-workbench.module.css");
  const integrationCss = read("apps/web/src/app/globals.css");
  assert.match(css, /grid-template-columns:\s*minmax\(272px, 336px\) minmax\(520px, 1fr\) minmax\(282px, 320px\)/);
  assert.match(css, /height:\s*100%/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /data-active-pane="inbox"/);
  assert.match(css, /data-active-pane="thread"/);
  assert.match(css, /data-active-pane="context"/);
  assert.match(integrationCss, /Modular message center: reserve one real mobile viewport/);
  assert.match(integrationCss, /workspace\[data-active-section="conversation-center"\][\s\S]*height:\s*calc\(100dvh - 112px\) !important/);
  assert.match(integrationCss, /#conversation-center[\s\S]*height:\s*100% !important/);
  assert.match(integrationCss, /#conversation-center[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) !important/);
  assert.match(integrationCss, /section\[aria-label="会话管理工作台"\]/);
});
