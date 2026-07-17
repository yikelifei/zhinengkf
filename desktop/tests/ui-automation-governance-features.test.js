"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function combined(domain) {
  const directory = path.join(root, `apps/web/src/features/${domain}`);
  return fs.readdirSync(directory)
    .filter((name) => /\.(?:ts|tsx)$/.test(name))
    .map((name) => read(`apps/web/src/features/${domain}/${name}`))
    .join("\n");
}

test("automation separates run control from issue handling", () => {
  const index = read("apps/web/src/features/automation/index.ts");
  assert.match(index, /AutomationRunsPage/);
  assert.match(index, /AutomationIssuesPage/);
  const source = combined("automation");
  for (const api of [
    "getAutomationStatus",
    "getAutomationReadiness",
    "runAutomationOnce",
    "startAutomation",
    "stopAutomation",
  ]) {
    assert.match(source, new RegExp(`\\b${api}\\b`));
  }
  assert.doesNotMatch(source, /createFailureDemo|createTimeoutDemo|return\s+\[\]/i);
});

test("notifications, agents, and overview are independent route-ready pages", () => {
  const notifications = combined("notifications");
  const agents = combined("agents");
  const overview = read("apps/web/src/features/overview/overview-page.tsx");
  assert.match(notifications, /getNotifications/);
  assert.match(notifications, /markNotificationRead/);
  assert.match(notifications, /markAllNotificationsRead/);
  assert.match(agents, /getAgents/);
  assert.match(overview, /OperationsOverview/);
  assert.doesNotMatch(`${notifications}\n${agents}\n${overview}`, /运行一轮.*onClick|createDemo/i);
});

test("training keeps import, sample review, and skill approval in separate pages", () => {
  const index = read("apps/web/src/features/training/index.ts");
  for (const page of ["TrainingImportPage", "TrainingReviewPage", "TrainingSkillsPage"]) {
    assert.match(index, new RegExp(`\\b${page}\\b`));
  }
  const source = combined("training");
  for (const api of [
    "importChatTranscript",
    "getChatImports",
    "getTrainingSamples",
    "reviewTrainingSample",
    "batchReviewTrainingSamples",
    "getSkillSuggestions",
    "applySkillSuggestions",
  ]) {
    assert.match(source, new RegExp(`\\b${api}\\b`));
  }
  assert.match(source, /needsReview|blocked|mixed/);
  assert.doesNotMatch(source, /mock|示例样本|自动确认全部/i);
});

test("reviews expose one page for each approval responsibility", () => {
  const index = read("apps/web/src/features/reviews/index.ts");
  for (const page of [
    "ReviewInboxPage",
    "ReviewDesignQueuePage",
    "ReviewDesignPage",
    "ReviewQuotesQueuePage",
    "ReviewQuotesPage",
    "ReviewOrdersQueuePage",
    "ReviewOrdersPage",
    "ReviewLogsPage",
  ]) {
    assert.match(index, new RegExp(`\\b${page}\\b`));
  }
  const source = combined("reviews");
  for (const api of ["getReviewCenter", "reviewDesignJob", "reviewQuote", "reviewOrder"]) {
    assert.match(source, new RegExp(`\\b${api}\\b`));
  }
  assert.match(source, /identityExpectation/);
  assert.match(source, /pendingConfirmation/);
  assert.match(source, /encodeURIComponent\(item\.id\)/);
  assert.match(source, /打开审核决策/);
  assert.doesNotMatch(source, /createFailureDemo|createTimeoutDemo|createDemo/i);
});

test("access page is a read-only presentation of server-enforced policy", () => {
  const source = read("apps/web/src/features/access/access-page.tsx");
  assert.match(source, /getOperatorAccessStatus/);
  assert.match(source, /getOperatorAccessPolicy/);
  assert.match(source, /OperatorAccessPanel/);
  assert.match(source, /前端展示不授予任何后端权限/);
  assert.doesNotMatch(source, /grant|elevate|localStorage|sessionStorage/i);
});

test("all governance feature pages are bounded, explicit, and responsive", () => {
  const domains = ["automation", "notifications", "agents", "overview", "training", "reviews", "access"];
  for (const domain of domains) {
    const directory = path.join(root, `apps/web/src/features/${domain}`);
    for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith("-page.tsx"))) {
      const source = read(`apps/web/src/features/${domain}/${name}`);
      assert.ok(source.split(/\r?\n/).length < 850, `${domain}/${name} is becoming another giant page`);
      for (const button of source.matchAll(/<button\b[\s\S]*?>/g)) {
        assert.match(button[0], /data-action-id=/, `${domain}/${name} button needs data-action-id`);
      }
      assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\b|function\s+load\s*\(/);
    }
  }

  const css = read("apps/web/src/features/governance-pages.module.css");
  assert.match(css, /@media\s*\(max-width:\s*(?:520|640|760)px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)|linear-gradient|radial-gradient/i);
});
