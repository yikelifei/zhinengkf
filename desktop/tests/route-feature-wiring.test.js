"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", moduleResolution: "Node" },
});

const root = path.resolve(__dirname, "..");
const appRoot = path.join(root, "apps/web/src/app");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const routes = require("../apps/web/src/app/route-manifest");

const redirectedRouteIds = new Set([
  "wechatWorkFlow",
  "wechatWorkSettings",
  "catalogEditor",
  "catalogPreview",
  "salesOverview",
  "settingsAccounts",
]);

const featureByRouteId = {
  overview: "OverviewRouteFeature",
  conversations: "ConversationsFeaturePage",
  conversationDetail: "ConversationsFeaturePage",
  routing: "RoutingFeaturePage",
  sendQueue: "SendQueuePage",
  sendBlocked: "SendBlockedPage",
  sendDiagnostics: "SendDiagnosticsPage",
  integrationChannels: "ChannelsStatusPage",
  wechatWorkChannels: "WechatWorkPreflightPage",
  personalWechatInstances: "PersonalWechatInstancesPage",
  personalWechatControl: "PersonalWechatControlPage",
  personalWechatInbound: "WindowInboundOperationsPage",
  personalWechatSafety: "PersonalWechatSafetyPage",
  designSettings: "DesignSettingsPage",
  designActivation: "DesignActivationPage",
  designAccount: "DesignAccountPage",
  designAssets: "DesignAssetsPage",
  designJobs: "DesignJobsPage",
  designJobDetail: "DesignJobsPage",
  reviewInbox: "ReviewInboxPage",
  reviewDesign: "ReviewDesignPage",
  reviewQuotes: "ReviewQuotesPage",
  reviewOrders: "ReviewOrdersPage",
  reviewLogs: "ReviewLogsPage",
  catalogProducts: "CatalogProductsPage",
  catalogRepair: "CatalogRepairPage",
  catalogImport: "CatalogImportPage",
  catalogAudit: "CatalogAuditPage",
  catalogBundles: "CatalogBundlesPage",
  salesActions: "SalesActionsPage",
  salesQuotes: "SalesQuotesPage",
  salesQuoteDetail: "SalesQuotesPage",
  salesOrders: "SalesOrdersPage",
  salesOrderDetail: "SalesOrdersPage",
  notifications: "NotificationsPage",
  automationRuns: "AutomationRunsPage",
  automationControl: "AutomationControlPage",
  automationHistory: "AutomationHistoryPage",
  automationIssues: "AutomationIssuesPage",
  agents: "AgentsPage",
  agentDetail: "AgentDetailPage",
  trainingImport: "TrainingImportPage",
  trainingImportHistory: "TrainingImportHistoryPage",
  trainingReview: "TrainingReviewQueuePage",
  trainingReviewBatch: "TrainingReviewPage",
  trainingReviewDetail: "TrainingReviewDetailPage",
  trainingSkills: "TrainingSkillsPage",
  settingsAccess: "AccessPage",
};

function pageSource(route) {
  return fs.readFileSync(path.join(appRoot, ...route.href.slice(1).split("/"), "page.tsx"), "utf8");
}

function collectFiles(directory, extension, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(absolute, extension, files);
    else if (entry.name.endsWith(extension)) files.push(absolute);
  }
  return files;
}

test("every production route directly composes exactly one owning feature", () => {
  const directRoutes = routes.WORKBENCH_ROUTE_LIST.filter((route) => !redirectedRouteIds.has(route.id));
  assert.deepEqual(
    directRoutes.map((route) => route.id).sort(),
    Object.keys(featureByRouteId).sort(),
    "the semantic route-to-feature map must stay exhaustive",
  );

  for (const route of directRoutes) {
    const source = pageSource(route);
    const component = featureByRouteId[route.id];
    assert.match(source, new RegExp(`routeId="${route.id}"`), `${route.id} must own its shell route`);
    assert.match(source, new RegExp(`<${component}(?:\\s|\\/|>)`), `${route.id} must render ${component}`);
    const featureImports = source.match(/from\s+"[^"]+(?:features\/|overview-route-feature)/g) || [];
    assert.equal(featureImports.length, 1, `${route.id} must import one feature, not a registry`);
    assert.doesNotMatch(source, /route-page|LegacyWorkbench|legacy-workbench/);
  }
});

test("the shared route shell contains layout only and no domain registry", () => {
  const shell = read("apps/web/src/app/feature-route-shell.tsx");
  assert.match(shell, /ModularWorkbenchShell/);
  assert.match(shell, /getWorkbenchRoute\(routeId\)/);
  assert.doesNotMatch(shell, /src\/features|\.\.\/features|renderRouteFeature|switch\s*\(/);
  assert.equal(fs.existsSync(path.join(appRoot, "route-page.tsx")), false);

  const appSources = collectFiles(appRoot, ".tsx")
    .filter((file) => !file.endsWith(`${path.sep}legacy-workbench.tsx`));
  const legacyConsumers = appSources.filter((file) => fs.readFileSync(file, "utf8").includes("legacy-workbench"));
  assert.deepEqual(legacyConsumers, [], "modular routes must not download or render the archived workbench");
});

test("entity and query selections reach the owning feature instead of only changing the URL", () => {
  assert.match(read("apps/web/src/app/conversations/[id]/page.tsx"), /ConversationsFeaturePage key=\{id\} initialConversationId=\{id\}/);
  assert.match(read("apps/web/src/app/design/jobs/[id]/page.tsx"), /DesignJobsPage key=\{id\} initialJobId=\{id\}/);
  assert.match(read("apps/web/src/app/sales/quotes/[id]/page.tsx"), /SalesQuotesPage key=\{id\} initialQuoteId=\{id\}/);
  assert.match(read("apps/web/src/app/sales/orders/[id]/page.tsx"), /SalesOrdersPage key=\{id\} initialOrderId=\{id\}/);
  assert.match(read("apps/web/src/app/agents/[id]/page.tsx"), /AgentDetailPage key=\{id\} agentId=\{id\}/);
  assert.match(read("apps/web/src/app/training/review/[id]/page.tsx"), /TrainingReviewDetailPage key=\{id\} sampleId=\{id\}/);
  assert.match(read("apps/web/src/app/send/queue/page.tsx"), /SendQueuePage key=\{initialTaskId \|\| "index"\} initialTaskId=\{initialTaskId\}/);
  assert.match(read("apps/web/src/app/send/blocked/page.tsx"), /SendBlockedPage key=\{initialTaskId \|\| "index"\} initialTaskId=\{initialTaskId\}/);
  assert.match(read("apps/web/src/app/integrations/personal-wechat/instances/page.tsx"), /initialAccountId=\{initialAccountId\}/);
});

test("overview actions are connected to real routes by a small client adapter", () => {
  const overviewAdapter = read("apps/web/src/app/overview-route-feature.tsx");
  for (const destination of [
    "/conversations",
    "/integrations/channels",
    "/automation/runs",
    "/reviews/inbox",
    "/notifications",
  ]) assert.ok(overviewAdapter.includes(destination), `missing overview destination: ${destination}`);
  assert.match(overviewAdapter, /router\.push/);
  assert.match(overviewAdapter, /encodeURIComponent\(context\.conversationId\)/);
});

test("new routes use bounded base styles, honest inline confirmations, and mobile touch targets", () => {
  const layout = read("apps/web/src/app/layout.tsx");
  const baseCss = read("apps/web/src/styles/base.css");
  const shellCss = read("apps/web/src/app/modular-workbench-shell.module.css");
  const workbenchCss = read("apps/web/src/components/workbench-shell/workbench-shell.module.css");
  const topbar = read("apps/web/src/components/workbench-shell/app-topbar.tsx");

  assert.match(layout, /styles\/base\.css/);
  assert.doesNotMatch(layout, /globals\.css|maximumScale/);
  assert.equal((baseCss.match(/!important/g) || []).length, 6);
  assert.match(baseCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*scroll-behavior: auto !important/);
  assert.match(baseCss, /@media \(max-width: 760px\)[\s\S]*min-height: 44px !important;[\s\S]*min-width: 44px !important;/);
  assert.ok(baseCss.length < 12000, "base styles must stay a small reset and token layer");
  assert.doesNotMatch(topbar, /<h1/);
  assert.match(topbar, /className=\{styles\.topbarTitle\}/);
  assert.match(shellCss, /@media \(max-width: 760px\)[\s\S]*min-height: 44px/);
  assert.match(workbenchCss, /\.mobileDrawer > header button \{[\s\S]*width: 44px;[\s\S]*height: 44px;/);

  const featureSources = collectFiles(path.join(root, "apps/web/src/features"), ".tsx")
    .map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(featureSources, /aria-modal="true"|role="alertdialog"/);
  assert.match(featureSources, /role="region"[\s\S]*aria-live="polite"/);
});

test("compatibility aliases are hidden from module navigation", () => {
  for (const routeId of redirectedRouteIds) {
    assert.equal(routes.WORKBENCH_ROUTES[routeId].showInModuleNav, false, `${routeId} must stay hidden`);
  }
});
