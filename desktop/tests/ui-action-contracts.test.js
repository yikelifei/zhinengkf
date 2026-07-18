"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const overview = read("apps/web/src/components/operations-overview.tsx");
const thread = read("apps/web/src/components/conversation-workbench/conversation-thread-pane.tsx");
const types = read("apps/web/src/components/conversation-workbench/types.ts");
const controller = read("apps/web/src/features/conversations/use-conversations-controller.ts");

function actionIds(source) {
  return [...source.matchAll(/data-action-id=(?:"([^"]+)"|\{`([^`]+)`\})/g)]
    .map((match) => match[1] || match[2]);
}

function controls(source) {
  return source.match(/<(?:button|textarea)\b[\s\S]*?>/g) || [];
}

test("production overview and conversation controls expose unique semantic action contracts", () => {
  const ids = [...actionIds(overview), ...actionIds(thread)];
  assert.ok(ids.length > 0, "the audited production controls should expose action ids");
  assert.equal(new Set(ids).size, ids.length, "action id expressions must be unique within the rendered workspace");

  for (const id of ids) {
    assert.match(id, /^(?:overview|conversations)\.[a-z0-9-${}.]+\.[a-z0-9-]+$/, `${id} must follow domain.entity.action`);
  }

  for (const [name, source] of [["overview", overview], ["conversation thread", thread]]) {
    for (const control of controls(source)) {
      assert.match(control, /data-action-id=/, `${name} has an interactive control without a stable action id: ${control.slice(0, 140)}`);
      assert.ok(
        /\bonClick=/.test(control) || /\bonChange=/.test(control) || /\btype="submit"/.test(control),
        `${name} action id does not correspond to a real controlled handler: ${control.slice(0, 140)}`,
      );
      if (/\bdisabled=/.test(control)) {
        assert.match(control, /data-disabled-reason=/, `${name} disabled control needs a readable reason contract`);
      }
    }
  }
});

test("stable ids distinguish overview entry points and caller-owned row actions", () => {
  for (const id of [
    "overview.workspace.refresh",
    "overview.channels.open-management",
    "overview.automation.open",
    "overview.conversations.open-list",
    "overview.channels.connect-empty",
  ]) {
    assert.ok(actionIds(overview).includes(id), `${id} must remain stable`);
  }

  assert.ok(actionIds(overview).includes("overview.pending-${action.id}.open"));
  assert.ok(actionIds(overview).includes("overview.conversation-${conversation.id}.open"));
  assert.match(overview, /key=\{action\.id\}[\s\S]*?data-action-id=\{`overview\.pending-\$\{action\.id\}\.open`\}/);
  assert.match(overview, /key=\{conversation\.id\}[\s\S]*?data-action-id=\{`overview\.conversation-\$\{conversation\.id\}\.open`\}/);
});

test("conversation actions stay capability-backed and the single suggestion title is not a fake button", () => {
  for (const id of [
    "conversations.inbox.open-empty",
    "conversations.inbox.open-mobile",
    "conversations.assignment.open-transfer",
    "conversations.thread.end",
    "conversations.thread.open-more",
    "conversations.context.open",
    "conversations.timeline.refresh",
    "conversations.suggestion.use",
    "conversations.suggestion.regenerate",
    "conversations.safety.refresh",
    "conversations.reply.edit",
    "conversations.reply.enqueue",
  ]) {
    assert.ok(actionIds(thread).includes(id), `${id} must remain stable`);
  }

  for (const id of [
    "conversations.notice-${notice.id}.dismiss",
    "conversations.composer-tool-${tool.id}.open",
    "conversations.incident-${incident.id}.open-policy",
    "conversations.incident-${incident.id}.retry",
  ]) {
    assert.ok(actionIds(thread).includes(id), `${id} must remain bound to its caller-owned record`);
  }

  const suggestionTitle = thread.match(/<div className=\{styles\.suggestionTabs\}[\s\S]*?<\/div>/)?.[0] || "";
  assert.match(suggestionTitle, /role="status"/);
  assert.match(suggestionTitle, /<span className=\{styles\.activeSuggestionTab\}>/);
  assert.doesNotMatch(suggestionTitle, /<button\b|onClick=|data-action-id=/);
  assert.doesNotMatch(thread, /onSuggestionTabChange/);
  assert.doesNotMatch(types, /onSuggestionTabChange/);
  assert.doesNotMatch(controller, /onSuggestionTabChange\s*:/);
});

test("manual reply submit means guarded queueing, never direct delivery", () => {
  const submitReply = thread.match(/function submitReply[\s\S]*?\n  }/)?.[0] || "";
  assert.match(submitReply, /event\.preventDefault\(\)/);
  assert.match(submitReply, /!composerDisabled && composer\.value\.trim\(\)/);
  assert.match(submitReply, /actions\.onSendReply\(\)/);
  assert.match(thread, /data-action-id="conversations\.reply\.enqueue"[\s\S]*?disabled=\{sendDisabled\}[\s\S]*?aria-label="将人工回复提交到安全发送队列"/);

  const sendReply = controller.match(/const sendReply = useCallback[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] || "";
  assert.match(sendReply, /api\.queueManualConversationReply\(identity, text, currentOperator\)/);
  assert.doesNotMatch(sendReply, /executeSendTask|processSafeSendQueue|personalWechatDirectSend/);
  assert.match(controller, /onSendReply:\s*\(\) => void sendReply\(\)/);
  assert.doesNotMatch(thread, /queueManualConversationReply|executeSendTask|processSafeSendQueue|\bfetch\s*\(/);
});
