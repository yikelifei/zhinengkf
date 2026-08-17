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
  shell: read("apps/web/src/app/modular-workbench-shell.tsx"),
  shellCss: read("apps/web/src/app/modular-workbench-shell.module.css"),
  controller: read("apps/web/src/features/conversations/use-conversations-controller.ts"),
  model: read("apps/web/src/features/conversations/model.ts"),
  thread: read("apps/web/src/components/conversation-workbench/conversation-thread-pane.tsx"),
  composer: read("apps/web/src/components/conversation-workbench/conversation-assistant-composer.tsx"),
  incident: read("apps/web/src/components/conversation-workbench/conversation-thread-incident.tsx"),
  workflow: read("apps/web/src/components/conversation-workbench/conversation-workflow-rail.tsx"),
  primitives: read("apps/web/src/components/conversation-workbench/workbench-primitives.tsx"),
  types: read("apps/web/src/components/conversation-workbench/types.ts"),
  css: read("apps/web/src/components/conversation-workbench/conversation-thread-pane.module.css"),
  workflowCss: read("apps/web/src/components/conversation-workbench/conversation-workflow-rail.module.css"),
  pageCss: read("apps/web/src/features/conversations/conversation-pages.module.css"),
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

function jsxControls(source, tagName) {
  const controls = [];
  for (const start of source.matchAll(new RegExp(`<${tagName}\\b`, "g"))) {
    let quote = "";
    let braceDepth = 0;
    for (let index = start.index; index < source.length; index += 1) {
      const character = source[index];
      const previous = source[index - 1];
      if (quote) {
        if (character === quote && previous !== "\\") quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if (character === "{") {
        braceDepth += 1;
        continue;
      }
      if (character === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }
      if (character === ">" && braceDepth === 0) {
        controls.push(source.slice(start.index, index + 1));
        break;
      }
    }
  }
  return controls;
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
  assert.match(files.detail, /conversationListHref\(navigation\)/);
  assert.doesNotMatch(files.detail, /conversationRouteHref\("\/conversations", conversation, navigation\)/);
  assert.match(files.detail, /\/context/);
  assert.match(files.detail, /\/assignment/);
  assert.doesNotMatch(files.detail, /ConversationOperationsPanel|ConversationContextPane|ConversationInboxPane/);
});

test("thread behavior remains controlled and free of business side effects", () => {
  const controlledUi = `${files.thread}\n${files.composer}`;
  for (const callback of [
    "onRefresh",
    "onUseSuggestion",
    "onRegenerateSuggestion",
    "onReplyChange",
    "onSendReply",
  ]) {
    assert.match(files.types, new RegExp(`${callback}:`), `${callback} must remain in the action contract`);
    assert.match(controlledUi, new RegExp(`actions\\.${callback}`), `${callback} must remain wired`);
  }

  assert.match(files.composer, /onSubmit=\{submitReply\}/);
  assert.match(files.composer, /event\.preventDefault\(\)/);
  assert.match(files.composer, /composer\.value\.trim\(\)/);
  assert.match(files.composer, /actions\.onSendReply\(\)/);
  assert.match(files.thread, /thread\.messages\.map/);
  assert.match(files.thread, /thread\.incidents\.map/);
  assert.match(files.composer, /role="status" aria-label="当前回复辅助视图"/);
  assert.doesNotMatch(`${files.types}\n${controlledUi}`, /onSuggestionTabChange|suggestion\.tabs\.map/);
  assert.match(files.composer, /thread\.safetyChecks\.map/);
  assert.match(files.thread, /ConversationWorkflowRail/);
  assert.match(files.thread, /thread\.workflowActions\?\.length/);
  assert.match(files.workflow, /actions\.map/);
  assert.match(files.model, /label: "AI 搭品"[\s\S]*conversationIdentityHref\("\/catalog\/bundles", conversation\)/);
  assert.match(files.model, /知识命中/);
  assert.match(files.model, /未命中已审核知识条目/);
  assert.match(files.model, /知识 \$\{knowledgeMatches\.length\} · Skill \$\{appliedSkills\.length\}/);
  assert.match(files.controller, /generated\.knowledgeMatches/);
  assert.match(files.controller, /generated\.appliedSkills/);
  assert.doesNotMatch(`${controlledUi}\n${files.incident}\n${files.workflow}\n${files.primitives}`, /\bfetch\s*\(|\baxios\b|localStorage|sessionStorage/);
  assert.doesNotMatch(`${controlledUi}\n${files.incident}\n${files.workflow}\n${files.primitives}`, /queueManualConversationReply|executeSendTask|processSafeSendQueue/);
});

test("every thread action control has an explicit handler", () => {
  const controlledThreadSource = `${files.thread}\n${files.composer}\n${files.incident}`;
  const buttons = jsxControls(controlledThreadSource, "button");
  assert.ok(buttons.length > 0);
  for (const button of buttons) {
    assert.ok(
      /\bonClick=/.test(button) || /\btype="submit"/.test(button),
      `button is missing an explicit callback: ${button.slice(0, 120)}`,
    );
  }
  assert.match(files.thread, /notice\.dismissible && actions\.onDismissNotice/);
  assert.match(files.composer, /actions\.onComposerTool \? composer\.tools\.map/);
  assert.match(files.incident, /incident\.policyActionLabel && actions\.onOpenIncidentPolicy/);
  assert.match(files.incident, /incident\.retryActionLabel && actions\.onRetryIncident/);
});

test("thread React and CSS stay within focused module size boundaries", () => {
  assert.ok(lineCount(files.thread) <= 340, "thread component must remain at or below 340 lines");
  assert.ok(lineCount(files.composer) <= 300, "assistant composer must remain at or below 300 lines");
  assert.ok(lineCount(files.incident) <= 80, "incident card must remain a small controlled component");
  assert.ok(lineCount(files.workflow) <= 80, "workflow rail must remain a small controlled component");
  assert.ok(lineCount(files.primitives) <= 90, "thread primitives must remain at or below 90 lines");
  assert.ok(lineCount(files.types) <= 305, "conversation view contracts must remain at or below 305 lines");
  assert.ok(lineCount(files.css) <= 1020, "thread layout CSS must remain at or below 1020 lines");
  assert.ok(lineCount(files.workflowCss) <= 120, "workflow rail CSS must remain focused");
  assert.ok(lineCount(files.primitiveCss) <= 100, "primitive CSS must remain at or below 100 lines");
  assert.match(files.thread, /conversation-thread-pane\.module\.css/);
  assert.match(files.workflow, /conversation-workflow-rail\.module\.css/);
  assert.match(files.primitives, /conversation-thread-primitives\.module\.css/);
});

test("focused thread styles use workbench tokens and keep a 390px viewport usable", () => {
  assert.match(files.css, /--cw-brand:\s*var\(--wk-color-brand\)/);
  assert.match(files.css, /--cw-surface:\s*var\(--wk-color-surface\)/);
  assert.match(files.css, /--cw-border:\s*var\(--wk-color-border\)/);
  assert.match(files.css, /grid-template-areas:[\s\S]*"header"[\s\S]*"workflow"[\s\S]*"timeline"[\s\S]*"composer"/);
  assert.match(files.workflowCss, /grid-area:\s*workflow/);
  assert.match(files.workflowCss, /grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(files.css, /min-width:\s*0/);
  assert.match(files.css, /overflow:\s*hidden/);
  assert.doesNotMatch(files.css, /overflow-x:\s*(?:auto|scroll)|(?:linear|radial|conic)-gradient\s*\(/);

  const phoneStart = files.css.indexOf("@media (max-width: 760px)");
  const compactStart = files.css.indexOf("@media (max-width: 420px)");
  assert.ok(phoneStart >= 0 && compactStart > phoneStart, "760px and 420px responsive contracts must exist");
  assert.match(files.css.slice(phoneStart, compactStart), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(files.workflowCss.slice(files.workflowCss.indexOf("@media (max-width: 760px)")), /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(files.workflowCss, /@media \(min-width: 640px\) and \(max-width: 760px\)[\s\S]*?repeat\(auto-fit,\s*minmax\(92px,\s*1fr\)\)/);
  assert.match(files.css.slice(compactStart), /min-height:\s*44px/);
  assert.match(files.css.slice(compactStart), /max-width:\s*86%/);
});

test("conversation detail owns the viewport and keeps the composer reachable", () => {
  assert.match(files.shell, /const hasModuleNavigation = siblingRoutes\.length > 1/);
  assert.match(files.shell, /data-has-module-navigation=\{hasModuleNavigation \? "true" : "false"\}/);
  assert.match(files.shellCss, /\.routeContent\s*\{[\s\S]*?height:\s*100%[\s\S]*?min-height:\s*0/);
  assert.match(files.shellCss, /\.routeContent\[data-has-module-navigation="false"\]\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(files.detail, /styles\.detailPage/);
  assert.match(files.pageCss, /\.detailPage\s*\{[\s\S]*?height:\s*100%[\s\S]*?min-height:\s*0[\s\S]*?overflow:\s*hidden/);
  assert.match(files.pageCss, /\.detailPage \.threadHost\s*\{[\s\S]*?min-height:\s*0[\s\S]*?flex:\s*1 1 auto/);
  assert.match(files.css, /\.timeline\s*\{[\s\S]*?min-height:\s*0[\s\S]*?overflow-y:\s*auto/);
  assert.match(files.css, /\.assistantComposer\s*\{[\s\S]*?grid-area:\s*composer/);
});
