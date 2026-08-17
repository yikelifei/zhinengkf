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
  "catalogPreview",
  "salesOverview",
  "settingsAccounts",
]);

const featureByRouteId = {
  overview: "OverviewRouteFeature",
  conversations: "ConversationListPage",
  conversationDetail: "ConversationDetailPage",
  conversationContext: "ConversationContextPage",
  conversationAssignment: "ConversationAssignmentPage",
  routing: "RoutingFeaturePage",
  routingProcess: "RoutingFeaturePage",
  sendQueue: "SendQueuePage",
  sendQueueTask: "SendQueuePage",
  sendBlocked: "SendBlockedPage",
  sendBlockedTask: "SendBlockedPage",
  sendDiagnostics: "SendDiagnosticsPage",
  sendDiagnosticOperations: "SendDiagnosticsOperationsPage",
  integrationChannels: "ChannelsStatusPage",
  wechatWorkChannels: "WechatWorkPreflightPage",
  wechatWorkCustomers: "WechatWorkCustomerEntryPage",
  wechatWorkFlow: "WechatWorkFlowPage",
  wechatWorkSettings: "WechatWorkConfigurationPage",
  wechatWorkWorkspace: "WechatWorkWorkspacePage",
  designSettings: "DesignSettingsPage",
  designZhenxiAi: "DesignZhenxiWorkspacePage",
  designActivation: "DesignActivationPage",
  designAccount: "DesignAccountPage",
  designAssets: "DesignAssetsPage",
  designJobs: "DesignJobsPage",
  designJobCreate: "DesignJobCreatePage",
  designJobDetail: "DesignJobDetailPage",
  designJobQuote: "DesignJobQuotePage",
  designJobSubmit: "DesignJobSubmitPage",
  designJobStatus: "DesignJobStatusPage",
  reviewInbox: "ReviewInboxPage",
  reviewDesign: "ReviewDesignQueuePage",
  reviewDesignDecision: "ReviewDesignPage",
  reviewQuotes: "ReviewQuotesQueuePage",
  reviewQuoteDecision: "ReviewQuotesPage",
  reviewOrders: "ReviewOrdersQueuePage",
  reviewOrderDecision: "ReviewOrdersPage",
  reviewLogs: "ReviewLogsPage",
  catalogProducts: "CatalogProductsPage",
  catalogProductDetail: "CatalogProductDetailPage",
  catalogRepair: "CatalogRepairPage",
  catalogRepairDetail: "CatalogRepairDetailPage",
  catalogEditor: "CatalogProductEditorPage",
  catalogImport: "CatalogImportPage",
  catalogAudit: "CatalogAuditPage",
  catalogBundles: "CatalogBundlesPage",
  salesActions: "SalesActionsPage",
  salesQuotes: "SalesQuotesPage",
  salesQuoteDetail: "SalesQuoteDetailPage",
  salesQuoteSend: "SalesQuoteActionPage",
  salesQuoteVerifyPayment: "SalesQuotePaymentPage",
  salesQuoteCreateOrder: "SalesQuoteActionPage",
  salesOrders: "SalesOrdersPage",
  salesOrderDetail: "SalesOrderDetailPage",
  salesOrderEdit: "SalesOrderEditPage",
  salesOrderAfterSales: "SalesOrderAfterSalesPage",
  salesOrderConfirmation: "SalesOrderMessagePage",
  salesOrderProduction: "SalesOrderMessagePage",
  salesOrderDelivery: "SalesOrderMessagePage",
  notifications: "NotificationsPage",
  automationRuns: "AutomationRunsPage",
  automationControl: "AutomationControlPage",
  automationHistory: "AutomationHistoryPage",
  automationIssues: "AutomationIssuesPage",
  agents: "AgentsPage",
  agentDetail: "AgentDetailPage",
  trainingOverview: "TrainingOverviewPage",
  trainingKnowledge: "TrainingKnowledgePage",
  trainingImport: "TrainingImportPage",
  trainingImportHistory: "TrainingImportHistoryPage",
  trainingReview: "TrainingReviewQueuePage",
  trainingReviewBatch: "TrainingReviewPage",
  trainingReviewDetail: "TrainingReviewDetailPage",
  trainingSkills: "TrainingSkillsPage",
  settingsAiModels: "AiModelsPage",
  settingsDeliveryReadiness: "DeliveryReadinessPage",
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
  assert.match(read("apps/web/src/app/conversations/[id]/page.tsx"), /ConversationDetailPage key=\{id\} conversationId=\{id\}/);
  assert.match(read("apps/web/src/app/conversations/[id]/context/page.tsx"), /ConversationContextPage key=\{id\} conversationId=\{id\}/);
  assert.match(read("apps/web/src/app/conversations/[id]/assignment/page.tsx"), /ConversationAssignmentPage key=\{id\} conversationId=\{id\}/);
  assert.match(read("apps/web/src/app/design/jobs/[id]/page.tsx"), /DesignJobDetailPage key=\{id\} jobId=\{id\}/);
  assert.match(read("apps/web/src/app/sales/quotes/[id]/page.tsx"), /SalesQuoteDetailPage key=\{id\} quoteId=\{id\}/);
  assert.match(read("apps/web/src/app/sales/orders/[id]/page.tsx"), /SalesOrderDetailPage key=\{id\} orderId=\{id\}/);
  assert.match(read("apps/web/src/app/catalog/products/[skuCode]/page.tsx"), /CatalogProductDetailPage key=\{skuCode\} skuCode=\{skuCode\}/);
  assert.match(read("apps/web/src/app/catalog/repair/[skuCode]/page.tsx"), /CatalogRepairDetailPage key=\{skuCode\} skuCode=\{skuCode\}/);
  assert.match(read("apps/web/src/app/agents/[id]/page.tsx"), /AgentDetailPage key=\{id\} agentId=\{id\}/);
  assert.match(read("apps/web/src/app/training/review/[id]/page.tsx"), /TrainingReviewDetailPage key=\{id\} sampleId=\{id\}/);
  assert.match(read("apps/web/src/app/send/queue/[id]/page.tsx"), /SendQueuePage key=\{id\} initialTaskId=\{id\}/);
  assert.match(read("apps/web/src/app/send/blocked/[id]/page.tsx"), /SendBlockedPage key=\{id\} initialTaskId=\{id\}/);
  assert.match(read("apps/web/src/app/reviews/design/[id]/page.tsx"), /ReviewDesignPage key=\{id\} reviewId=\{id\} identityFilters=\{identityFilters\}/);
  assert.match(read("apps/web/src/app/reviews/quotes/[id]/page.tsx"), /ReviewQuotesPage key=\{id\} reviewId=\{id\} identityFilters=\{identityFilters\}/);
  assert.match(read("apps/web/src/app/reviews/orders/[id]/page.tsx"), /ReviewOrdersPage key=\{id\} reviewId=\{id\} identityFilters=\{identityFilters\}/);
  assert.match(read("apps/web/src/app/catalog/bundles/page.tsx"), /CatalogBundlesPage initialIdentityFilters=\{identityFilters\}/);
  assert.match(read("apps/web/src/app/design/assets/page.tsx"), /DesignAssetsPage initialIdentityFilters=\{identityFilters\}/);
  assert.equal(
    fs.existsSync(path.join(appRoot, "integrations/personal-wechat/instances/configure/page.tsx")),
    false,
  );
});

test("overview actions are connected to real routes by a small client adapter", () => {
  const overviewAdapter = read("apps/web/src/app/overview-route-feature.tsx");
  for (const destination of [
    "/conversations",
    "/integrations/channels",
    "/integrations/wechat-work",
    "/automation/runs",
    "/reviews/inbox",
    "/notifications",
    "/settings/delivery-readiness",
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
  assert.equal(routes.WORKBENCH_ROUTES.salesActions.showInModuleNav, false, "salesActions is a direct workflow chooser, not a module tab");
});
