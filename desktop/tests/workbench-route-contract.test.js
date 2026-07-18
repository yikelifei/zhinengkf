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

const productionRoutes = [
  "/overview",
  "/conversations",
  "/conversations/[id]",
  "/conversations/[id]/context",
  "/conversations/[id]/assignment",
  "/routing",
  "/routing/process",
  "/send/queue",
  "/send/queue/[id]",
  "/send/blocked",
  "/send/blocked/[id]",
  "/send/diagnostics",
  "/send/diagnostics/operations",
  "/integrations/channels",
  "/integrations/wechat-work",
  "/integrations/wechat-work/flow",
  "/integrations/wechat-work/settings",
  "/integrations/personal-wechat/instances",
  "/integrations/personal-wechat/instances/configure",
  "/integrations/personal-wechat/control",
  "/integrations/personal-wechat/window-inbound",
  "/integrations/personal-wechat/inbound-drill",
  "/integrations/personal-wechat/safety",
  "/design/settings",
  "/design/assets",
  "/design/jobs",
  "/design/jobs/[id]",
  "/design/jobs/[id]/submit",
  "/design/jobs/[id]/status",
  "/catalog/products",
  "/catalog/products/[skuCode]",
  "/catalog/repair",
  "/catalog/repair/[skuCode]",
  "/catalog/editor",
  "/catalog/import",
  "/catalog/audit",
  "/catalog/bundles",
  "/sales/actions",
  "/sales/quotes",
  "/sales/quotes/[id]",
  "/sales/quotes/[id]/send",
  "/sales/quotes/[id]/create-order",
  "/sales/orders",
  "/sales/orders/[id]",
  "/sales/orders/[id]/edit",
  "/sales/orders/[id]/messages/confirmation",
  "/sales/orders/[id]/messages/production",
  "/sales/orders/[id]/messages/delivery",
  "/automation/runs",
  "/automation/control",
  "/automation/history",
  "/automation/issues",
  "/notifications",
  "/agents",
  "/training/import",
  "/training/review",
  "/training/skills",
  "/reviews/inbox",
  "/reviews/design",
  "/reviews/design/[id]",
  "/reviews/quotes",
  "/reviews/quotes/[id]",
  "/reviews/orders",
  "/reviews/orders/[id]",
  "/reviews/logs",
  "/settings/access",
];

const redirectedManifestRoutes = new Map([
  ["/catalog/preview", "/catalog/import"],
  ["/sales/overview", "/sales/quotes"],
  ["/settings/accounts", "/integrations/personal-wechat/instances"],
]);

const sectionIds = [
  "overview-center",
  "conversation-center",
  "routing-center",
  "send-center",
  "wechat-channel-center",
  "personal-wechat-center",
  "design-platform-config",
  "asset-center",
  "design-center",
  "review-center",
  "sku-library",
  "catalog-center",
  "sales-center",
  "automation-center",
  "notice-center",
  "agent-center",
  "training-center",
  "account-center",
];

test("typed route manifest covers every production URL and all 18 active workbench sections", () => {
  const routeList = routes.WORKBENCH_ROUTE_LIST;
  const hrefs = routeList.map((route) => route.href);
  const sections = new Set(routeList.map((route) => route.sectionId));

  assert.ok(routeList.length >= 39, "the route seam must cover major module subviews");
  assert.equal(new Set(hrefs).size, hrefs.length, "route hrefs must be unique");
  for (const href of productionRoutes) assert.ok(hrefs.includes(href), `missing production route: ${href}`);
  for (const sectionId of sectionIds) assert.ok(sections.has(sectionId), `missing section: ${sectionId}`);
  for (const route of routeList) {
    assert.ok(route.title.trim(), `${route.id} must have a title`);
    assert.ok(route.responsibility.trim(), `${route.id} must define one responsibility`);
    assert.ok(route.primaryAction.trim(), `${route.id} must define one primary action`);
  }
});

test("sales, automation, and notifications own separate navigation sections", () => {
  const salesRoutes = routes.WORKBENCH_ROUTE_LIST.filter((route) => route.href.startsWith("/sales/"));
  const automationRoutes = routes.WORKBENCH_ROUTE_LIST.filter((route) => route.href.startsWith("/automation/"));
  const moduleRouteIds = (sectionId) => routes.WORKBENCH_ROUTE_LIST
    .filter((route) => route.sectionId === sectionId && !route.href.includes("[") && route.showInModuleNav !== false)
    .map((route) => route.id);

  assert.ok(salesRoutes.length > 0);
  assert.ok(automationRoutes.length > 0);
  assert.ok(salesRoutes.every((route) => route.sectionId === "sales-center"));
  assert.ok(automationRoutes.every((route) => route.sectionId === "automation-center"));
  assert.equal(routes.WORKBENCH_ROUTES.notifications.sectionId, "notice-center");
  assert.equal(routes.WORKBENCH_ROUTES.salesActions.showInModuleNav, false);
  assert.deepEqual(moduleRouteIds("sales-center"), ["salesQuotes", "salesOrders"]);
  assert.deepEqual(moduleRouteIds("automation-center"), [
    "automationRuns",
    "automationControl",
    "automationHistory",
    "automationIssues",
  ]);
  assert.deepEqual(moduleRouteIds("notice-center"), ["notifications"]);
});

test("legacy quote and automation hashes keep resolving after section separation", () => {
  assert.equal(routes.getWorkbenchRouteFromLegacyHash("#quote-center").id, "salesOverview");
  assert.equal(routes.getWorkbenchRouteFromLegacyHash("#quote-center:quotes").id, "salesQuotes");
  assert.equal(routes.getWorkbenchRouteFromLegacyHash("#quote-center:actions").id, "salesActions");
  assert.equal(routes.getWorkbenchRouteFromLegacyHash("#notice-center").id, "notifications");
  assert.equal(routes.getWorkbenchRouteFromLegacyHash("#notice-center:automation").id, "automationRuns");
  assert.equal(routes.getWorkbenchRouteFromLegacyHash("#notice-center:automation:control").id, "automationControl");
});

test("pathname resolver handles exact routes, entity detail routes, trailing slashes, and unknown paths", () => {
  assert.equal(routes.getWorkbenchRouteFromPathname("/overview").id, "overview");
  assert.equal(routes.getWorkbenchRouteFromPathname("/overview/").id, "overview");
  assert.equal(routes.getWorkbenchRouteFromPathname("/conversations/demo-id?from=notification").id, "conversationDetail");
  assert.equal(routes.getWorkbenchRouteFromPathname("/conversations/demo-id/context").id, "conversationContext");
  assert.equal(routes.getWorkbenchRouteFromPathname("/conversations/demo-id/assignment").id, "conversationAssignment");
  assert.equal(routes.getWorkbenchRouteFromPathname("/send/queue/task-42").id, "sendQueueTask");
  assert.equal(routes.getWorkbenchRouteFromPathname("/reviews/design/job-42").id, "reviewDesignDecision");
  assert.equal(routes.getWorkbenchRouteFromPathname("/design/jobs/job-42").id, "designJobDetail");
  assert.equal(routes.getWorkbenchRouteFromPathname("/design/jobs/job-42/submit").id, "designJobSubmit");
  assert.equal(routes.getWorkbenchRouteFromPathname("/catalog/products/SKU-42").id, "catalogProductDetail");
  assert.equal(routes.getWorkbenchRouteFromPathname("/sales/quotes/quote-42").id, "salesQuoteDetail");
  assert.equal(routes.getWorkbenchRouteFromPathname("/sales/quotes/quote-42/send").id, "salesQuoteSend");
  assert.equal(routes.getWorkbenchRouteFromPathname("/sales/orders/order-42").id, "salesOrderDetail");
  assert.equal(routes.getWorkbenchRouteFromPathname("/sales/orders/order-42/messages/delivery").id, "salesOrderDelivery");
  assert.equal(routes.getWorkbenchRouteFromPathname("/unknown/module"), null);
  assert.equal(routes.getWorkbenchRouteFromLegacyHash("#%E0%A4%A").id, "overview");
});

test("every manifest entry has a real thin App Router page", () => {
  for (const route of routes.WORKBENCH_ROUTE_LIST) {
    const routePath = route.href.slice(1).split("/").join(path.sep);
    const pagePath = path.join(appRoot, routePath, "page.tsx");
    assert.ok(fs.existsSync(pagePath), `missing Next page for ${route.href}`);
    const source = fs.readFileSync(pagePath, "utf8");
    const redirectTarget = redirectedManifestRoutes.get(route.href);
    if (redirectTarget) {
      assert.match(source, new RegExp(`redirect\\("${redirectTarget.replaceAll("/", "\\/")}\"\\)`));
    } else {
      assert.match(source, /FeatureRouteShell/);
      assert.match(source, new RegExp(`routeId="${route.id}"`));
      const featureImports = source.match(/from\s+"[^"]+(?:features\/|overview-route-feature)/g) || [];
      assert.equal(featureImports.length, 1, `${route.href} must import exactly one owning feature`);
    }
    assert.ok(source.split(/\r?\n/).length <= 24, `${route.href} page must stay thin`);
  }
});

test("root only converts legacy hashes while module routes own browser navigation", () => {
  const rootPage = read("apps/web/src/app/page.tsx");
  const featureRouteShell = read("apps/web/src/app/feature-route-shell.tsx");
  const layout = read("apps/web/src/app/layout.tsx");
  const sidebar = read("apps/web/src/components/workbench-shell/app-sidebar.tsx");
  const navigation = read("apps/web/src/components/workbench-shell/navigation.ts");

  assert.ok(rootPage.length < 2500, "root redirect page must not regain workbench business logic");
  assert.match(rootPage, /getWorkbenchRouteFromLegacyHash\(window\.location\.hash\)/);
  assert.match(rootPage, /router\.replace\(nextTarget\)/);
  assert.match(featureRouteShell, /ModularWorkbenchShell/);
  assert.doesNotMatch(featureRouteShell, /features\/|LegacyWorkbench|legacy-workbench/);
  assert.equal(fs.existsSync(path.join(appRoot, "route-page.tsx")), false);
  assert.match(layout, /styles\/base\.css/);
  assert.doesNotMatch(layout, /globals\.css/);
  assert.match(sidebar, /import Link from "next\/link"/);
  assert.match(sidebar, /href=\{item\.href\}/);
  assert.match(navigation, /href: WORKBENCH_ROUTES\./);
});

test("legacy aliases redirect to the accepted production URLs", () => {
  assert.match(read("apps/web/src/app/reviews/handoff/page.tsx"), /redirect\("\/reviews\/inbox"\)/);
  for (const [sourceRoute, destination] of redirectedManifestRoutes) {
    const relativePage = `apps/web/src/app${sourceRoute}/page.tsx`;
    assert.match(read(relativePage), new RegExp(`redirect\\("${destination.replaceAll("/", "\\/")}\"\\)`));
  }
});

test("route boundary provides loading, empty, error, and not-found states", () => {
  assert.match(read("apps/web/src/app/loading.tsx"), /tone="loading"/);
  assert.match(read("apps/web/src/app/error.tsx"), /onClick=\{reset\}/);
  assert.match(read("apps/web/src/app/not-found.tsx"), /tone="not-found"/);
  assert.match(read("apps/web/src/app/route-state.tsx"), /WorkbenchEmptyState/);
});
