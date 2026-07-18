"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const componentRoot = path.join(root, "apps/web/src/components/conversation-workbench");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const lineCount = (source) => source.split(/\r?\n/).length;

const files = {
  detail: read("apps/web/src/features/conversations/conversation-detail-page.tsx"),
  controller: read("apps/web/src/features/conversations/use-conversations-controller.ts"),
  model: read("apps/web/src/features/conversations/model.ts"),
  thread: read("apps/web/src/components/conversation-workbench/conversation-thread-pane.tsx"),
  primitives: read("apps/web/src/components/conversation-workbench/workbench-primitives.tsx"),
  types: read("apps/web/src/components/conversation-workbench/types.ts"),
  css: read("apps/web/src/components/conversation-workbench/conversation-thread-pane.module.css"),
  primitiveCss: read("apps/web/src/components/conversation-workbench/conversation-thread-primitives.module.css"),
};

function productionSource() {
  const sourceRoot = path.join(root, "apps/web/src");
  const sources = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/\.(?:ts|tsx|css)$/.test(entry.name)) sources.push(fs.readFileSync(target, "utf8"));
    }
  };
  visit(sourceRoot);
  return sources.join("\n");
}

test("retired three-pane conversation aggregator has no production entry", () => {
  for (const retired of [
    "conversation-workbench.tsx",
    "conversation-inbox-pane.tsx",
    "conversation-context-pane.tsx",
    "conversation-workbench.module.css",
    "index.ts",
  ]) {
    assert.equal(fs.existsSync(path.join(componentRoot, retired)), false, `${retired} must stay retired`);
  }

  const source = productionSource();
  assert.doesNotMatch(source, /\bConversationWorkbench\b|\bConversationInboxPane\b|\bConversationContextPane\b/);
  assert.doesNotMatch(source, /conversation-workbench\.module\.css/);
  assert.doesNotMatch(source, /from\s+["'][^"']*components\/conversation-workbench["']/);
  assert.doesNotMatch(files.controller, /from\s+["']\.\.\/\.\.\/components\/conversation-workbench["']/);
  assert.doesNotMatch(files.model, /from\s+["']\.\.\/\.\.\/components\/conversation-workbench["']/);
});

test("conversation detail route imports only the focused thread pane", () => {
  assert.match(files.detail, /from "\.\.\/\.\.\/components\/conversation-workbench\/conversation-thread-pane"/);
  assert.match(files.detail, /<ConversationThreadPane/);
  assert.match(files.detail, /showBackButton=\{false\}/);
  assert.match(files.detail, /showContextButton=\{false\}/);
  assert.match(files.detail, /showTransferButton=\{false\}/);
  assert.match(files.detail, /href=\{?"\/conversations"/);
  assert.match(files.detail, /\/context/);
  assert.match(files.detail, /\/assignment/);
  assert.doesNotMatch(files.detail, /ConversationOperationsPanel|ConversationContextPane|ConversationInboxPane/);
});

test("thread behavior remains controlled and side-effect free", () => {
  for (const callback of [
    "onRefresh",
    "onUseSuggestion",
    "onRegenerateSuggestion",
    "onReplyChange",
    "onSendReply",
  ]) {
    assert.match(files.types, new RegExp(`${callback}:`), `${callback} must remain in the action contract`);
    assert.match(files.thread, new RegExp(`actions\\.${callback}`), `${callback} must remain wired`);
  }

  assert.match(files.thread, /onSubmit=\{submitReply\}/);
  assert.match(files.thread, /event\.preventDefault\(\)/);
  assert.match(files.thread, /composer\.value\.trim\(\)/);
  assert.match(files.thread, /actions\.onSendReply\(\)/);
  assert.match(files.thread, /thread\.messages\.map/);
  assert.match(files.thread, /thread\.incidents\.map/);
  assert.match(files.thread, /role="status" aria-label="当前回复辅助视图"/);
  assert.doesNotMatch(`${files.types}\n${files.thread}`, /onSuggestionTabChange|suggestion\.tabs\.map/);
  assert.match(files.thread, /thread\.safetyChecks\.map/);
  assert.doesNotMatch(`${files.thread}\n${files.primitives}`, /\bfetch\s*\(|\baxios\b|localStorage|sessionStorage/);
  assert.doesNotMatch(`${files.thread}\n${files.primitives}`, /\buseState\s*\(|\buseEffect\s*\(|queueManualConversationReply|executeSendTask|processSafeSendQueue/);
});

test("every thread action control has an explicit handler", () => {
  const buttons = files.thread.match(/<button\b[\s\S]*?>/g) || [];
  assert.ok(buttons.length > 0);
  for (const button of buttons) {
    assert.ok(
      /\bonClick=/.test(button) || /\btype="submit"/.test(button),
      `button is missing an explicit callback: ${button.slice(0, 120)}`,
    );
  }
  assert.match(files.thread, /notice\.dismissible && actions\.onDismissNotice/);
  assert.match(files.thread, /actions\.onComposerTool \? thread\.composer\.tools\.map/);
  assert.match(files.thread, /incident\.policyActionLabel && actions\.onOpenIncidentPolicy/);
  assert.match(files.thread, /incident\.retryActionLabel && actions\.onRetryIncident/);
});

test("thread React and CSS stay within focused module size boundaries", () => {
  assert.ok(lineCount(files.thread) <= 340, "thread component must remain at or below 340 lines");
  assert.ok(lineCount(files.primitives) <= 90, "thread primitives must remain at or below 90 lines");
  assert.ok(lineCount(files.types) <= 300, "conversation view contracts must remain at or below 300 lines");
  assert.ok(lineCount(files.css) <= 800, "thread layout CSS must remain at or below 800 lines");
  assert.ok(lineCount(files.primitiveCss) <= 100, "primitive CSS must remain at or below 100 lines");
  assert.match(files.thread, /conversation-thread-pane\.module\.css/);
  assert.match(files.primitives, /conversation-thread-primitives\.module\.css/);
});

test("focused thread styles use workbench tokens and keep a 390px viewport usable", () => {
  assert.match(files.css, /--cw-brand:\s*var\(--wk-color-brand\)/);
  assert.match(files.css, /--cw-surface:\s*var\(--wk-color-surface\)/);
  assert.match(files.css, /--cw-border:\s*var\(--wk-color-border\)/);
  assert.match(files.css, /grid-template-areas:[\s\S]*"header"[\s\S]*"timeline"[\s\S]*"composer"/);
  assert.match(files.css, /min-width:\s*0/);
  assert.match(files.css, /overflow:\s*hidden/);
  assert.doesNotMatch(files.css, /overflow-x:\s*(?:auto|scroll)|(?:linear|radial|conic)-gradient\s*\(/);

  const phoneStart = files.css.indexOf("@media (max-width: 760px)");
  const compactStart = files.css.indexOf("@media (max-width: 420px)");
  assert.ok(phoneStart >= 0 && compactStart > phoneStart, "760px and 420px responsive contracts must exist");
  assert.match(files.css.slice(phoneStart, compactStart), /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(files.css.slice(compactStart), /min-height:\s*44px/);
  assert.match(files.css.slice(compactStart), /max-width:\s*86%/);
});
