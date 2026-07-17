"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const componentRoot = "apps/web/src/components/conversation-workbench";
const read = (file) => fs.readFileSync(path.join(root, componentRoot, file), "utf8");

const files = {
  root: read("conversation-workbench.tsx"),
  inbox: read("conversation-inbox-pane.tsx"),
  thread: read("conversation-thread-pane.tsx"),
  context: read("conversation-context-pane.tsx"),
  types: read("types.ts"),
  css: read("conversation-workbench.module.css"),
};

test("conversation workbench is a controlled three-pane presentation module", () => {
  assert.match(files.root, /<ConversationInboxPane inbox=\{inbox\} actions=\{actions\} \/>/);
  assert.match(files.root, /<ConversationThreadPane thread=\{thread\} actions=\{actions\} \/>/);
  assert.match(files.root, /<ConversationContextPane context=\{context\} actions=\{actions\} \/>/);
  assert.match(files.root, /data-active-pane=\{activePane\}/);
  assert.match(files.root, /data-inbox-collapsed=\{inboxCollapsed \? "true" : "false"\}/);
  assert.match(files.types, /export type ConversationWorkbenchProps/);
  assert.match(files.types, /actions: ConversationWorkbenchActions/);
  assert.doesNotMatch(files.thread, /<main\b/);
});

test("workbench interaction surface is callback-only and has no hidden data or send side effects", () => {
  const source = [files.root, files.inbox, files.thread, files.context, files.types].join("\n");

  for (const callback of [
    "onSelectConversation",
    "onSearchChange",
    "onPageChange",
    "onRefresh",
    "onTransfer",
    "onSuggestionTabChange",
    "onUseSuggestion",
    "onRegenerateSuggestion",
    "onReplyChange",
    "onSendReply",
    "onEditAssignment",
  ]) {
    assert.match(files.types, new RegExp(`${callback}:`), `${callback} should be part of the public action contract`);
    assert.match(source, new RegExp(`actions\\.${callback}`), `${callback} should be wired to the UI`);
  }

  assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\b|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /\buseState\s*\(|\buseEffect\s*\(|\buseTransition\s*\(/);
  assert.doesNotMatch(source, /queueManualConversationReply|executeSendTask|processSafeSendQueue/);
});

test("unsupported business actions are optional and hidden when no capability callback is supplied", () => {
  for (const callback of [
    "onEndConversation",
    "onMore",
    "onOpenIncidentPolicy",
    "onRetryIncident",
    "onDismissNotice",
    "onComposerTool",
    "onEditCustomer",
    "onAddTag",
    "onEditNotes",
    "onOpenTask",
    "onToggleSafety",
    "onQuickAction",
    "onOpenFilter",
  ]) {
    assert.match(files.types, new RegExp(`${callback}\\?:`), `${callback} should be capability-gated`);
  }

  assert.match(files.thread, /\{actions\.onEndConversation \? \(/);
  assert.match(files.thread, /\{actions\.onMore \? \(/);
  assert.match(files.thread, /notice\.dismissible && actions\.onDismissNotice/);
  assert.match(files.thread, /actions\.onComposerTool \? thread\.composer\.tools\.map/);
  assert.match(files.thread, /incident\.policyActionLabel && actions\.onOpenIncidentPolicy/);
  assert.match(files.thread, /incident\.retryActionLabel && actions\.onRetryIncident/);
  assert.match(files.context, /onAction=\{actions\.onEditCustomer\}/);
  assert.match(files.context, /onAction=\{actions\.onAddTag\}/);
  assert.match(files.context, /onAction=\{actions\.onEditNotes\}/);
  assert.match(files.context, /actions\.onEndConversation \? <button/);
  assert.match(files.context, /context\.quickActions\.length && actions\.onQuickAction/);
  assert.match(files.context, /\{actionLabel && onAction \? \(/);
});

test("every native action control exposes an explicit controlled handler", () => {
  const interactiveSources = [files.inbox, files.thread, files.context];

  for (const source of interactiveSources) {
    const buttons = source.match(/<button\b[\s\S]*?>/g) || [];
    assert.ok(buttons.length > 0, "each pane should contain real button controls");
    for (const button of buttons) {
      assert.ok(
        /\bonClick=/.test(button) || /\btype="submit"/.test(button),
        `button is missing an explicit callback: ${button.slice(0, 120)}`,
      );
    }

    for (const select of source.match(/<select\b[\s\S]*?>/g) || []) {
      assert.match(select, /\bonChange=/, "selects must remain controlled by the parent");
    }
  }

  assert.match(files.thread, /onSubmit=\{submitReply\}/);
  assert.match(files.thread, /event\.preventDefault\(\)/);
  assert.match(files.thread, /composer\.value\.trim\(\)/);
  assert.match(files.thread, /actions\.onSendReply\(\)/);
});

test("workbench exposes mature inbox, incident, AI suggestion and customer context contracts", () => {
  for (const model of [
    "ConversationWorkbenchInbox",
    "ConversationWorkbenchMessage",
    "ConversationWorkbenchIncident",
    "ConversationWorkbenchSuggestion",
    "ConversationWorkbenchSafetyCheck",
    "ConversationWorkbenchCustomer",
    "ConversationWorkbenchTask",
    "ConversationWorkbenchAssignment",
    "ConversationWorkbenchSla",
    "ConversationWorkbenchSafetyIdentity",
  ]) {
    assert.match(files.types, new RegExp(`export type ${model}`));
  }

  assert.match(files.inbox, /inbox\.channelOptions/);
  assert.match(files.inbox, /inbox\.statusOptions/);
  assert.match(files.thread, /thread\.incidents\.map/);
  assert.match(files.thread, /thread\.suggestion\.tabs\.map/);
  assert.match(files.thread, /thread\.safetyChecks\.map/);
  assert.match(files.context, /context\.tags\.map/);
  assert.match(files.context, /context\.assignment/);
  assert.match(files.context, /context\.sla/);
  assert.match(files.context, /context\.safetyIdentity/);
  assert.match(files.types, /operationsSlot\?: ReactNode/);
  assert.match(files.context, /context\.operationsSlot \? <div className=\{styles\.operationsSlot\}/);

  const slaSection = files.context.indexOf('aria-labelledby="sla-heading"');
  const slot = files.context.indexOf("context.operationsSlot", slaSection);
  const safetySection = files.context.indexOf('aria-labelledby="safety-identity-heading"', slot);
  assert.ok(slaSection >= 0 && slot > slaSection && safetySection > slot, "the real operations editor slot should follow the SLA summary");
});

test("Tencent-style visual contract stays compact, white, bordered and gradient-free", () => {
  assert.match(files.css, /--cw-brand:\s*var\(--wk-color-brand\)/);
  assert.match(files.css, /--cw-surface:\s*var\(--wk-color-surface\)/);
  assert.match(files.css, /--cw-border:\s*var\(--wk-color-border\)/);
  assert.match(files.css, /font-size:\s*13px/);
  assert.match(files.css, /grid-template-columns:\s*minmax\(272px, 336px\) minmax\(520px, 1fr\) minmax\(282px, 320px\)/);
  assert.match(files.css, /Outer workspace rail plus these three panes form the four-column desktop reference/);
  assert.doesNotMatch(files.css, /(?:linear|radial|conic)-gradient\s*\(/);
});

test("responsive contract supports intermediate collapse and a controlled 390px single pane", () => {
  const tabletStart = files.css.indexOf("@media (max-width: 1180px)");
  const phoneStart = files.css.indexOf("@media (max-width: 760px)");
  const compactStart = files.css.indexOf("@media (max-width: 420px)");

  assert.ok(tabletStart >= 0, "tablet breakpoint should exist");
  assert.ok(phoneStart > tabletStart, "phone breakpoint should follow tablet rules");
  assert.ok(compactStart > phoneStart, "420px refinement must cover a 390px viewport");

  const phone = files.css.slice(phoneStart, compactStart);
  assert.match(phone, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(phone, /data-active-pane="inbox"/);
  assert.match(phone, /data-active-pane="thread"/);
  assert.match(phone, /data-active-pane="context"/);
  assert.match(phone, /display:\s*none/);
  assert.match(phone, /display:\s*inline-grid/);
});
