"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("conversation operations client uses strict identity and PATCH without sending a message", () => {
  const api = read("apps/web/src/lib/api.ts");
  const start = api.indexOf("export async function updateConversationOperations");
  const end = api.indexOf("export async function getConversationTimeline", start);
  const section = api.slice(start, end);

  assert.ok(start >= 0, "conversation operations update client should exist");
  assert.match(section, /patchJson\(`\/conversation-ops\/conversations\/\$\{encodeURIComponent\(identity\.conversationId\)\}`/);
  assert.match(section, /identityExpectation\(identity\)/);
  assert.match(section, /operator/);
  assert.match(section, /reason/);
  assert.doesNotMatch(section, /manual-replies|send-tasks|execute|process-safe-queue/);
});

test("conversation operations panel exposes assignment, lifecycle, priority and both SLA deadlines", () => {
  const component = read("apps/web/src/components/conversation-operations-panel.tsx");

  assert.match(component, /接待客服/);
  assert.match(component, /分配给我/);
  assert.match(component, /优先级/);
  assert.match(component, /处理状态/);
  assert.match(component, /首次回复截止/);
  assert.match(component, /会话处理截止/);
  assert.match(component, /type="datetime-local"/);
  assert.match(component, /await onSave\(patch\)/);
  assert.match(component, /configurationIssues/);
  assert.doesNotMatch(component, /fetch\(|queueManualConversationReply|executeSendTask|processSafeSendQueue/);
});

test("the assignment route owns the editor and delegates writes to the conversation controller", () => {
  const page = read("apps/web/src/features/conversations/conversation-assignment-page.tsx");
  const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");

  assert.match(page, /<ConversationOperationsPanel/);
  assert.match(page, /operations=\{controller\.activeOperations\}/);
  assert.match(page, /onSave=\{controller\.saveOperations\}/);
  assert.match(page, /本页只修改负责人、优先级、生命周期和服务时限/);
  assert.match(controller, /api\.updateConversationOperations\(/);
  assert.match(controller, /conversationIdentity\(conversation\)/);
  assert.match(controller, /独立会话模块更新分配、状态与 SLA/);
  assert.doesNotMatch(page, /queueManualConversationReply|executeSendTask|processSafeSendQueue/);
});

test("conversation operations layout collapses around 1000px and covers a 390px viewport", () => {
  const css = read("apps/web/src/components/conversation-operations-panel.module.css");
  const mobileStart = css.indexOf("@media (max-width: 1000px)");
  const mobile = css.slice(mobileStart);

  assert.ok(mobileStart >= 0, "responsive breakpoint should cover 390px");
  assert.match(mobile, /\.assignmentRow,\s*\n\s*\.fieldGrid,\s*\n\s*\.slaFacts\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(mobile, /\.assignButton\s*\{\s*width:\s*100%/);
});
