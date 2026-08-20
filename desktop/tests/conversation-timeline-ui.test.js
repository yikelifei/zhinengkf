"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("frontend history and manual reply clients carry strict identity", () => {
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
    assert.match(section, /throw await apiResponseError\(response\)/);
    assert.doesNotMatch(section, /catch\s*\{/);
    assert.doesNotMatch(section, /return \[\]/);
  }
});

test("manual reply queues first and then sends through Enterprise WeChat", () => {
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");
  const start = controller.indexOf("const sendReply = useCallback");
  const end = controller.indexOf("const generateSuggestion = useCallback", start);
  const section = controller.slice(start, end);
  const queuedIndex = section.indexOf("await api.queueManualConversationReply");
  const executeIndex = section.indexOf("await api.executeManualReplyNow(queued.task.id, identity)");
  const refreshIndex = section.indexOf("await Promise.allSettled");
  const releaseIndex = section.indexOf("setReplyBusy(false)");

  assert.ok(queuedIndex >= 0, "manual reply should enqueue through the safe queue");
  assert.ok(executeIndex > queuedIndex, "manual delivery should execute only after the durable task exists");
  assert.ok(releaseIndex > queuedIndex && releaseIndex < executeIndex, "composer should be released after durable queueing, before official delivery settles");
  assert.ok(refreshIndex > executeIndex, "timeline refresh should happen after the delivery attempt");
  assert.match(section, /企业微信发送未完成/);
  assert.doesNotMatch(section, /preparePersonalWechatConversation|captureWindowObserverOnce|personal_wechat/);
  assert.doesNotMatch(section, /await Promise\.all\(/);
});

test("manual reply exposes the exact queued task confirmation route", () => {
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");
  const model = read("apps/web/src/features/conversations/model.ts");
  const composer = read("apps/web/src/components/conversation-workbench/conversation-assistant-composer.tsx");

  assert.match(controller, /setQueuedReplyTaskId\(queued\.task\.id\)/);
  assert.match(model, /href:\s*`\/send\/queue\/\$\{encodeURIComponent\(input\.queuedReplyTaskId\)\}`/);
  assert.match(composer, /data-action-id="conversations\.reply\.open-send-confirmation"/);
  assert.match(composer, /查看发送任务/);
});

test("manual direct delivery stays on the guarded send adapter path", () => {
  const client = read("apps/web/src/lib/api.ts");
  const controller = read("apps/api/src/wechat/wechat.controller.ts");
  const service = read("apps/api/src/wechat/wechat-dispatch.service.ts");
  assert.match(client, /execute-manual-reply/);
  assert.match(controller, /executeManualReplyNow\(id, payload \|\| \{\}\)/);
  const manualControllerSection = controller.slice(
    controller.indexOf('@Post("send-tasks/:id/execute-manual-reply")'),
    controller.indexOf('@Post("send-tasks/:id/requeue")'),
  );
  assert.match(manualControllerSection, /@RequireOperatorCapability\("reply_conversations"\)/);
  assert.doesNotMatch(manualControllerSection, /@RequireOperatorCapability\("approve_send"\)/);
  assert.match(service, /if \(!isManualReplySendTask\(task\)\)/);
  assert.doesNotMatch(service, /the conversation must be under manual takeover before a direct manual reply/);
  assert.match(service, /item\.status === "sending" && item\.id !== task\.id/);
  assert.match(service, /adapter: "wechat_work_kf"/);
  const manualSection = service.slice(service.indexOf("  async executeManualReplyNow"), service.indexOf("  executeSend(", service.indexOf("  async executeManualReplyNow")));
  assert.doesNotMatch(manualSection, /validateSendTaskWithCurrentWindow/);
  assert.match(manualSection, /completeWechatWorkKfSend\(result\)/);
  assert.match(service, /allowManualPriority/);
  assert.doesNotMatch(client, /mark-sent/);
});

test("AI reply assistance reads the latest inbound text and never sends automatically", () => {
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");
  const start = controller.indexOf("const generateSuggestion = useCallback");
  const end = controller.indexOf("const useSuggestion = useCallback", start);
  const section = controller.slice(start, end);

  assert.match(section, /\[\.\.\.timeline\]\.reverse\(\)\.find\(\(item\) => item\.direction === "inbound"/);
  assert.match(section, /api\.generateConversationReplySuggestion\(conversationIdentity\(conversation\)\)/);
  assert.match(section, /generated\.suggestedReply/);
  assert.doesNotMatch(section, /queueManualConversationReply|executeSendTask|processSafeSendQueue/);
});

test("conversation timeline keeps live updates visible and uses real customer avatars", () => {
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");
  const model = read("apps/web/src/features/conversations/model.ts");
  const thread = read("apps/web/src/components/conversation-workbench/conversation-thread-pane.tsx");

  assert.match(controller, /setInterval\(\(\) => void refreshLiveData\(\), 2000\)/);
  assert.match(controller, /refreshWechatWorkCustomerProfile\(identity\)/);
  assert.match(model, /conversation\.customer\?\.avatarUrl/);
  assert.match(thread, /timeline\.scrollTop = timeline\.scrollHeight/);
  assert.match(thread, /stickToLatestRef/);
});

test("WeCom timeline renders each official message type without a generic attachment fallback", () => {
  const model = read("apps/web/src/features/conversations/model.ts");
  const thread = read("apps/web/src/components/conversation-workbench/conversation-thread-pane.tsx");
  const content = read("apps/web/src/components/conversation-workbench/conversation-timeline-content.tsx");
  const api = read("apps/web/src/lib/api.ts");

  assert.match(model, /localConversationAttachmentUrl/);
  assert.match(model, /content:\s*item\.messageType/);
  assert.match(api, /conversations\/\$\{encodeURIComponent\(values\[0\]\)\}\/messages/);
  assert.match(thread, /ConversationTimelineStructuredContent/);
  assert.match(content, /content\.type === "location"/);
  assert.match(content, /content\.type === "link"/);
  assert.match(content, /content\.type === "business_card"/);
  assert.match(content, /content\.type === "miniprogram"/);
  assert.match(content, /content\.type === "product"/);
  assert.match(content, /content\.type === "msgmenu"/);
  assert.match(content, /<audio controls/);
  assert.match(content, /<video className=\{styles\.videoAttachment\} controls/);
  assert.doesNotMatch(content, />附件<|附件 \$\{attachment\.name\}/);
});

test("conversation messages render without waiting for AI, read-state, or profile enrichment", () => {
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");
  const effectStart = controller.indexOf('    const timelineRequest = api.getConversationTimeline(identity);');
  const effectEnd = controller.indexOf("  const refreshTimeline = useCallback", effectStart);
  const section = controller.slice(effectStart, effectEnd);

  assert.ok(effectStart >= 0 && effectEnd > effectStart, "detail loading effect should be present");
  assert.match(section, /void timelineRequest\.then\(/);
  assert.match(section, /setTimeline\(records\);\s*setTimelineLoading\(false\)/);
  assert.match(section, /void readRequest\.then\(/);
  assert.match(section, /void suggestionRequest\.then\(/);
  assert.match(section, /void profileRequest\.then\(/);
  assert.doesNotMatch(section, /Promise\.allSettled/);

  const liveRefreshStart = controller.indexOf("    const refreshLiveData = async () =>");
  const liveRefreshEnd = controller.indexOf("  const updateFilters = useCallback", liveRefreshStart);
  const liveRefresh = controller.slice(liveRefreshStart, liveRefreshEnd);
  assert.match(liveRefresh, /\+\+liveTimelineSequence\.current/);
  assert.doesNotMatch(liveRefresh, /\+\+timelineSequence\.current/);
  assert.match(liveRefresh, /setTimelineLoading\(false\)/);
});

test("the detail route owns message reading and guards read mutations by detail mode", () => {
  const page = read("apps/web/src/features/conversations/conversation-detail-page.tsx");
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");

  assert.match(page, /人工需要补充时直接输入并发送/);
  assert.match(page, /<ConversationThreadPane/);
  assert.match(controller, /mode !== "detail" \|\| !selectedConversation \|\| accessPhase !== "ready"/);
  assert.match(controller, /api\.markConversationMessagesRead\(identity\)/);
  assert.match(controller, /sequence !== timelineSequence\.current/);
});
