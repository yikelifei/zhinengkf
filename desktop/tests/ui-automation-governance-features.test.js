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
  assert.match(notifications, /notificationTargetHref/);
  assert.match(notifications, /sendTaskId/);
  assert.match(notifications, /\/send\/blocked\//);
  assert.match(notifications, /orderDraftId/);
  assert.match(notifications, /data-action-id=\{"notification-open-target-" \+ notification\.id\}/);
  assert.match(agents, /getAgents/);
  assert.match(overview, /OperationsOverview/);
  assert.doesNotMatch(`${notifications}\n${agents}\n${overview}`, /运行一轮.*onClick|createDemo/i);
});

test("training keeps import, sample review, and skill approval in separate pages", () => {
  const index = read("apps/web/src/features/training/index.ts");
  for (const page of ["TrainingOverviewPage", "TrainingImportPage", "TrainingReviewPage", "TrainingSkillsPage"]) {
    assert.match(index, new RegExp(`\\b${page}\\b`));
  }
  const source = combined("training");
  for (const api of [
    "importChatTranscript",
    "getTrainingOverview",
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
  assert.match(source, /训练覆盖|样本质量|技能建议|Agent Skill 覆盖度/);
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
  for (const api of ["getReviewCenter", "getReviewDesignJob", "getReviewQuote", "getReviewOrder", "reviewDesignJob", "reviewQuote", "reviewOrder"]) {
    assert.match(source, new RegExp(`\\b${api}\\b`));
  }
  assert.match(source, /identityExpectation/);
  assert.match(source, /ReviewHandoffPanel/);
  assert.match(source, /reviewDesignHandoff/);
  assert.match(source, /reviewQuoteHandoff/);
  assert.match(source, /reviewOrderHandoff/);
  assert.match(source, /reviewIdentityHref/);
  assert.match(source, /data-action-id=\{`\$\{actionIdPrefix\}-\$\{link\.action\}`\}/);
  assert.match(source, /\/send\/queue\/\$\{encodeURIComponent\(handoff\.sendTask\.id\)\}/);
  assert.match(source, /\/send\/blocked\/\$\{encodeURIComponent\(handoff\.sendTask\.id\)\}/);
  assert.match(source, /pendingConfirmation/);
  assert.match(source, /detailHref\(item\.id\)/);
  assert.match(source, /encodeURIComponent\(id\)/);
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

test("AI model center separates provider status from guarded key-only setup", () => {
  const source = [
    read("apps/web/src/features/system/ai-models-page.tsx"),
    read("apps/web/src/features/system/ai-provider-credential-setup.tsx"),
  ].join("\n");
  const api = read("apps/web/src/lib/api.ts");
  assert.match(source, /getAiProviderStatus/);
  assert.match(source, /data-action-id="ai-models-refresh"/);
  assert.match(source, /data-action-id="ai-models-probe"/);
  assert.match(source, /probe \? await probeAiProviderStatus\(\) : await getAiProviderStatus\(\)/);
  assert.match(source, /saveAiProviderCredential/);
  assert.match(source, /type="password"/);
  assert.match(source, /autoComplete="off"/);
  assert.match(source, /data-action-id=\{`ai-models-provider-\$\{provider\.name\}-save`\}/);
  assert.match(source, /data-action-id=\{`ai-models-provider-\$\{provider\.name\}-disable`\}/);
  assert.match(source, /已复用臻希AI模型/);
  assert.match(source, /臻希AI共享配置/);
  assert.match(source, /credentialSource/);
  assert.match(source, /复用臻希AI密钥/);
  assert.match(source, /aiProviderPresentation/);
  assert.match(source, /该供应商已停用，不参与当前主备路由/);
  assert.match(api, /\/ai\/providers\/status/);
  assert.match(api, /\/ai\/providers\/\$\{encodeURIComponent\(provider\)\}\/credential/);
  assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\b|postJson|patchJson|localStorage|sessionStorage/i);
  assert.doesNotMatch(source, /type="text"[\s\S]{0,120}API Key|setStatus\([^)]*apiKey|console\.(?:log|info|debug)/i);
});

test("delivery readiness page is a read-only presentation of generated evidence", () => {
  const page = read("apps/web/src/features/system/delivery-readiness-page.tsx");
  const hook = read("apps/web/src/features/system/use-delivery-readiness.ts");
  const source = `${page}\n${hook}`;
  const api = read("apps/web/src/lib/api.ts");
  assert.match(source, /getDeliveryReadiness/);
  assert.match(source, /data-action-id="delivery-readiness-refresh"/);
  assert.match(source, /完成度审计/);
  assert.match(source, /产品验收报告/);
  assert.match(hook, /trustedReadinessRef\.current \? "stale" : "unknown"/);
  assert.match(page, /旧报告 \/ 待刷新/);
  assert.match(api, /\/delivery\/readiness/);
  assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\b|postJson|patchJson|localStorage|sessionStorage/i);
  assert.doesNotMatch(source, /runProductAcceptance|projectCompletionAudit|exec|spawn|writeFile/i);
});

test("all governance feature pages are bounded, explicit, and responsive", () => {
  const domains = ["automation", "notifications", "agents", "overview", "training", "reviews", "access", "system"];
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
