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
  "/routing",
  "/send/queue",
  "/send/blocked",
  "/send/diagnostics",
  "/integrations/channels",
  "/integrations/wechat-work",
  "/integrations/personal-wechat/instances",
  "/integrations/personal-wechat/control",
  "/integrations/personal-wechat/safety",
  "/design/settings",
  "/design/assets",
  "/design/jobs",
  "/design/jobs/[id]",
  "/catalog/products",
  "/catalog/repair",
  "/catalog/import",
  "/catalog/audit",
  "/catalog/bundles",
  "/sales/quotes",
  "/sales/quotes/[id]",
  "/sales/orders",
  "/sales/orders/[id]",
  "/automation/runs",
  "/automation/issues",
  "/notifications",
  "/agents",
  "/training/import",
  "/training/review",
  "/training/skills",
  "/reviews/inbox",
  "/reviews/design",
  "/reviews/quotes",
  "/reviews/orders",
  "/reviews/logs",
  "/settings/access",
];

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
  "quote-center",
  "notice-center",
  "agent-center",
  "training-center",
  "account-center",
];

test("typed route manifest covers every production URL and all 17 workbench sections", () => {
  const routeList = routes.WORKBENCH_ROUTE_LIST;
  const hrefs = routeList.map((route) => route.href);
  const sections = new Set(routeList.map((route) => route.sectionId));

  assert.ok(routeList.length >= 38, "the route seam must cover major module subviews");
  assert.equal(new Set(hrefs).size, hrefs.length, "route hrefs must be unique");
  for (const href of productionRoutes) assert.ok(hrefs.includes(href), `missing production route: ${href}`);
  for (const sectionId of sectionIds) assert.ok(sections.has(sectionId), `missing section: ${sectionId}`);
  for (const route of routeList) {
    assert.ok(route.title.trim(), `${route.id} must have a title`);
    assert.ok(route.responsibility.trim(), `${route.id} must define one responsibility`);
    assert.ok(route.primaryAction.trim(), `${route.id} must define one primary action`);
  }
});

test("pathname resolver handles exact routes, entity detail routes, trailing slashes, and unknown paths", () => {
  assert.equal(routes.getWorkbenchRouteFromPathname("/overview").id, "overview");
  assert.equal(routes.getWorkbenchRouteFromPathname("/overview/").id, "overview");
  assert.equal(routes.getWorkbenchRouteFromPathname("/conversations/demo-id?from=notification").id, "conversationDetail");
  assert.equal(routes.getWorkbenchRouteFromPathname("/design/jobs/job-42").id, "designJobDetail");
  assert.equal(routes.getWorkbenchRouteFromPathname("/sales/quotes/quote-42").id, "salesQuoteDetail");
  assert.equal(routes.getWorkbenchRouteFromPathname("/sales/orders/order-42").id, "salesOrderDetail");
  assert.equal(routes.getWorkbenchRouteFromPathname("/unknown/module"), null);
  assert.equal(routes.getWorkbenchRouteFromLegacyHash("#%E0%A4%A").id, "overview");
});

test("every manifest entry has a real thin App Router page", () => {
  for (const route of routes.WORKBENCH_ROUTE_LIST) {
    const routePath = route.href.slice(1).split("/").join(path.sep);
    const pagePath = path.join(appRoot, routePath, "page.tsx");
    assert.ok(fs.existsSync(pagePath), `missing Next page for ${route.href}`);
    const source = fs.readFileSync(pagePath, "utf8");
    assert.match(source, /Workbench(?:Detail)?RoutePage/);
    assert.ok(source.split(/\r?\n/).length <= 12, `${route.href} page must stay thin`);
  }
});

test("root only converts legacy hashes while module routes own browser navigation", () => {
  const rootPage = read("apps/web/src/app/page.tsx");
  const legacy = read("apps/web/src/app/legacy-workbench.tsx");
  const sidebar = read("apps/web/src/components/workbench-shell/app-sidebar.tsx");
  const navigation = read("apps/web/src/components/workbench-shell/navigation.ts");

  assert.ok(rootPage.length < 2500, "root redirect page must not regain workbench business logic");
  assert.match(rootPage, /getWorkbenchRouteFromLegacyHash\(window\.location\.hash\)/);
  assert.match(rootPage, /router\.replace\(nextTarget\)/);
  assert.doesNotMatch(legacy, /location\.hash|hashchange|history\.replaceState/);
  assert.match(legacy, /router\.(?:push|replace)\(/);
  assert.match(legacy, /activeWorkspaceSection === "personal-wechat-center"/);
  assert.match(sidebar, /import Link from "next\/link"/);
  assert.match(sidebar, /href=\{item\.href\}/);
  assert.match(navigation, /href: WORKBENCH_ROUTES\./);
});

test("legacy aliases redirect to the accepted production URLs", () => {
  assert.match(read("apps/web/src/app/reviews/handoff/page.tsx"), /redirect\("\/reviews\/inbox"\)/);
  assert.match(read("apps/web/src/app/automation/control/page.tsx"), /redirect\("\/automation\/runs"\)/);
  assert.match(read("apps/web/src/app/automation/history/page.tsx"), /redirect\("\/automation\/runs"\)/);
});

test("route boundary provides loading, empty, error, and not-found states", () => {
  assert.match(read("apps/web/src/app/loading.tsx"), /tone="loading"/);
  assert.match(read("apps/web/src/app/error.tsx"), /onClick=\{reset\}/);
  assert.match(read("apps/web/src/app/not-found.tsx"), /tone="not-found"/);
  assert.match(read("apps/web/src/app/route-state.tsx"), /WorkbenchEmptyState/);
});
