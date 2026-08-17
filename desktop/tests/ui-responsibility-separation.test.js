"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("modular shell leaves the feature page as the single visible title owner", () => {
  const shell = read("apps/web/src/app/modular-workbench-shell.tsx");
  const shellTypes = read("apps/web/src/components/workbench-shell/types.ts");
  const shellView = read("apps/web/src/components/workbench-shell/workbench-shell.tsx");
  const css = read("apps/web/src/app/modular-workbench-shell.module.css");

  assert.doesNotMatch(shell, /topbar=|topbar:\s*\{/);
  assert.match(shellTypes, /topbar\?: AppTopbarProps/);
  assert.match(shellView, /topbar \? <AppTopbar/);
  assert.match(css, /\.moduleNavigation[\s\S]*flex-wrap: nowrap[\s\S]*overflow-x: auto/);
  assert.match(shell, /moduleNavigationRef/);
  assert.match(shell, /activeModuleLinkRef/);
  assert.match(shell, /navigation\.scrollWidth <= navigation\.clientWidth/);
  assert.match(shell, /navigation\.scrollTo\(\{ left: Math\.max\(0, centeredLeft\), behavior: "auto" \}\)/);
  assert.match(shell, /ref=\{active \? activeModuleLinkRef : undefined\}/);
});

test("overview has one page title and no duplicate quick-action surface", () => {
  const page = read("apps/web/src/features/overview/overview-page.tsx");
  const overview = read("apps/web/src/components/operations-overview.tsx");
  assert.doesNotMatch(page, /<h1|Overview<\/span>/);
  assert.equal((overview.match(/<h1\b/g) || []).length, 1);
  assert.doesNotMatch(overview, /快捷操作|footerActions|运行一轮/);
});

test("automation status, control, history, and issues are separate route features", () => {
  const status = read("apps/web/src/features/automation/automation-runs-page.tsx");
  const control = read("apps/web/src/features/automation/automation-control-page.tsx");
  const history = read("apps/web/src/features/automation/automation-history-page.tsx");
  assert.doesNotMatch(status, /startAutomation|stopAutomation|recentRuns\.map/);
  assert.doesNotMatch(control, /recentRuns\.map/);
  assert.doesNotMatch(history, /requestAction|startAutomation|stopAutomation/);
  assert.match(read("apps/web/src/app/automation/control/page.tsx"), /AutomationControlPage/);
  assert.match(read("apps/web/src/app/automation/history/page.tsx"), /AutomationHistoryPage/);
});

test("training import, history, queue, detail, and batch pages load only their own workflows", () => {
  const create = read("apps/web/src/features/training/training-import-page.tsx");
  const history = read("apps/web/src/features/training/training-import-history-page.tsx");
  const queue = read("apps/web/src/features/training/training-review-queue-page.tsx");
  const detail = read("apps/web/src/features/training/training-review-detail-page.tsx");
  const batch = read("apps/web/src/features/training/training-review-page.tsx");
  assert.doesNotMatch(create, /getChatImports|training-import-history-title/);
  assert.doesNotMatch(history, /importChatTranscript|textarea/);
  assert.doesNotMatch(queue, /reviewTrainingSample|batchReviewTrainingSamples/);
  assert.match(detail, /reviewTrainingSample/);
  assert.match(batch, /batchReviewTrainingSamples/);
  assert.doesNotMatch(batch, /training-sample-ready-/);
});

test("agent directory links to one-agent detail instead of expanding every skill list", () => {
  const list = read("apps/web/src/features/agents/agents-page.tsx");
  const detail = read("apps/web/src/features/agents/agent-detail-page.tsx");
  assert.match(list, /href=\{trainingHref\(`\/agents\/\$\{encodeURIComponent\(agent\.id\)\}`, identityFilters\)\}/);
  assert.doesNotMatch(list, /agent\.skills\.map/);
  assert.match(detail, /agent\.skills\.map/);
  assert.match(detail, /Agent Skill 指令/);
  assert.match(detail, /Skill 指令正文/);
  assert.match(detail, /skill\.description \|\| "服务端未提供 Skill 指令正文。"/);
  assert.match(detail, /!agent[\s\S]*未回退展示其他记录/);
  assert.match(detail, /trainingScope = agent \? \{ \.\.\.identityFilters, agentId: agent\.id \} : identityFilters/);
  assert.match(detail, /trainingHref\("\/training\/overview", trainingScope\)/);
  assert.match(detail, /trainingHref\("\/training\/import", trainingScope\)/);
  assert.match(detail, /trainingHref\("\/training\/review", trainingScope\)/);
  assert.match(detail, /trainingHref\("\/training\/skills", trainingScope\)/);
  assert.match(detail, /data-action-id="agent-detail-open-training-skills"/);
});

test("responsibility documents list the focused workflow URLs and no longer describe them as redirects", () => {
  const moduleMap = read("docs/UI_MODULE_MAP.md");
  const acceptance = read("docs/UI_ACCEPTANCE_MATRIX.md");
  const focusedRoutes = [
    "/integrations/wechat-work/flow",
    "/integrations/wechat-work/settings",
    "/design/jobs/[id]/submit",
    "/design/jobs/[id]/status",
    "/catalog/products/[skuCode]",
    "/catalog/repair/[skuCode]",
    "/sales/quotes/[id]/send",
    "/sales/quotes/[id]/create-order",
    "/sales/orders/[id]/edit",
    "/sales/orders/[id]/messages/confirmation",
    "/automation/control",
    "/automation/history",
    "/agents/[id]",
    "/training/import/history",
    "/training/review/[id]",
    "/training/review/batch",
  ];
  for (const route of focusedRoutes) {
    assert.ok(moduleMap.includes(`\`${route}\``), `module map missing ${route}`);
    assert.ok(acceptance.includes(`\`${route}\``), `acceptance matrix missing ${route}`);
  }
  assert.doesNotMatch(moduleMap, /`\/automation\/control` 和 `\/automation\/history` 永久转到/);
  assert.doesNotMatch(moduleMap, /`\/integrations\/wechat-work\/flow\|settings` 转到/);
  assert.doesNotMatch(moduleMap, /`\/catalog\/editor` 转到/);
});
