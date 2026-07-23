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

test("workbench loads live queue data, surfaces SLA attention and mounts the editor in conversation context", () => {
  const page = read("apps/web/src/app/page.tsx");

  assert.match(page, /Promise\.allSettled\(/);
  assert.match(page, /getConversationOperationsQueue\(\)/);
  assert.match(page, /if \(conversationOperationsResult\.status === "fulfilled"\)/);
  assert.match(page, /setConversationOperationsQueue\(conversationOperationsResult\.value\)/);
  assert.match(page, /setConversationOperationsLoadState\("ready"\)/);
  assert.match(page, /current === "ready" \? "ready" : current === "stale" \? "stale" : "loading"/);
  assert.match(page, /setConversationOperationsUpdatedAt\(new Date\(\)\.toISOString\(\)\)/);
  assert.match(page, /conversationOperationsQueue\.summary\.overdue/);
  assert.match(page, /conversationOperationsQueue\.summary\.unassigned/);
  assert.match(page, /\.needsAttention \|\| 0/);
  assert.match(page, /count: conversationOperationsNeedsAttention/);
  assert.match(page, /conversationOperationsLoadState === "error"/);
  assert.match(page, /conversationOperationsLoadState !== "ready"/);
  assert.match(page, /conversationOperationsLoadState === "error"\s*\n\s*\? "SLA 状态不可用"/);
  assert.match(page, /conversationOperationsLoadState === "stale"\s*\n\s*\? "SLA 数据可能过期"/);
  assert.match(page, /freshnessLabel:\s*conversationOperationsFreshnessLabel/);
  assert.match(page, /operationsSlot:\s*\(/);
  assert.match(page, /id="conversation-operations-editor"/);
  assert.match(page, /<ConversationOperationsPanel/);
  assert.match(page, /operations=\{activeConversationOperations\}/);
  assert.match(page, /onSave=\{saveActiveConversationOperations\}/);
  assert.match(page, /updateConversationOperations\(identity, patch, CURRENT_OPERATOR\)/);
});

test("conversation operations layout collapses around 1000px and therefore covers a 390px viewport", () => {
  const css = read("apps/web/src/components/conversation-operations-panel.module.css");
  const globals = read("apps/web/src/app/globals.css");
  const mobileStart = css.indexOf("@media (max-width: 1000px)");
  const mobile = css.slice(mobileStart);

  assert.ok(mobileStart >= 0, "responsive breakpoint should cover 390px");
  assert.match(mobile, /\.assignmentRow,\s*\n\s*\.fieldGrid,\s*\n\s*\.slaFacts\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(mobile, /\.assignButton\s*\{\s*width:\s*100%/);
  assert.match(globals, /@media \(max-width: 1000px\) and \(min-width: 761px\)[\s\S]*\.conversation-operations-host[\s\S]*grid-column:\s*1 \/ -1/);
});

test("auto-selected conversations are only marked read after the message center is actually open", () => {
  const page = read("apps/web/src/app/page.tsx");
  const markRead = page.indexOf("markConversationMessagesRead(identity)");
  const guard = page.lastIndexOf('activeWorkspaceSection === "conversation-center"', markRead);

  assert.ok(markRead >= 0, "read mutation should still exist for an opened conversation");
  assert.ok(guard >= 0 && markRead - guard < 300, "the read mutation must be immediately guarded by visible message-center state");
  assert.match(page, /activeConversation\?\.customerId,\s*\n\s*activeWorkspaceSection,/);
});

test("segmented account and channel controls use button-group semantics instead of incomplete tabs", () => {
  const page = read("apps/web/src/app/page.tsx");
  const integrationHeader = read("apps/web/src/components/integration-center/integration-center-header.tsx");
  assert.match(integrationHeader, /role="group" aria-label="微信接入中心视图"/);
  assert.match(page, /role="group" aria-label="账号与权限视图"/);
  assert.doesNotMatch(page, /role="tablist" aria-label="(?:微信接入中心视图|账号与权限视图)"/);
});

test("global load settles each source independently instead of withholding every successful response", () => {
  const page = read("apps/web/src/app/page.tsx");
  const start = page.indexOf("async function load(");
  const end = page.indexOf("function activeIdentityFilters", start);
  const loadSection = page.slice(start, end);

  assert.match(loadSection, /Promise\.allSettled\(/);
  assert.match(loadSection, /if \(jobResult\.status === "fulfilled"\)/);
  assert.match(loadSection, /if \(conversationResult\.status === "fulfilled"\)/);
  assert.match(loadSection, /if \(conversationOperationsResult\.status === "fulfilled"\)/);
  assert.doesNotMatch(loadSection, /await Promise\.all\(/);
});
