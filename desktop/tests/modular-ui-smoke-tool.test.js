"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const toolPath = path.resolve(__dirname, "../tools/smoke-modular-ui.js");
const source = fs.readFileSync(toolPath, "utf8");
const smoke = require(toolPath);

test("CLI accepts a base URL, output directory, and optional route forms", () => {
  const parsed = smoke.parseArgs([
    "--base-url=http://127.0.0.1:3100",
    "--output-dir",
    ".runtime/ui-smoke",
    "--routes",
    "/overview,/conversations",
    "--route",
    "/routing",
    "/design/settings",
  ]);
  assert.equal(parsed.baseUrl, "http://127.0.0.1:3100");
  assert.equal(parsed.outputDir, ".runtime/ui-smoke");
  assert.deepEqual(parsed.routes, ["/overview", "/conversations", "/routing", "/design/settings"]);
});

test("default routes are the union of real static Next pages and the typed manifest", () => {
  const appRoot = path.resolve(__dirname, "../apps/web/src/app");
  const routes = smoke.discoverDefaultRoutes(appRoot);
  assert.ok(routes.includes("/"));
  assert.ok(routes.includes("/overview"));
  assert.ok(routes.includes("/conversations"));
  assert.ok(routes.includes("/design/settings"));
  assert.ok(routes.includes("/catalog/products"));
  assert.ok(routes.includes("/sales/quotes"));
  assert.ok(routes.includes("/reviews/logs"));
  assert.equal(routes.some((route) => route.includes("[id]")), false);
  assert.equal(new Set(routes).size, routes.length);
});

test("route inventory reports manifest holes without hiding page-only aliases", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "modular-ui-routes-"));
  try {
    fs.mkdirSync(path.join(fixture, "overview"), { recursive: true });
    fs.mkdirSync(path.join(fixture, "legacy-alias"), { recursive: true });
    fs.writeFileSync(
      path.join(fixture, "overview", "page.tsx"),
      "export default function Page() { return null; }\n",
    );
    fs.writeFileSync(
      path.join(fixture, "legacy-alias", "page.tsx"),
      "export default function Page() { return null; }\n",
    );
    fs.writeFileSync(path.join(fixture, "route-manifest.ts"), [
      'const routes = {',
      '  overview: { href: "/overview" },',
      '  missing: { href: "/reviews/logs" },',
      '  detail: { href: "/conversations/[id]" },',
      '};',
      "",
    ].join("\n"));
    const inventory = smoke.discoverRouteInventory(fixture);
    assert.deepEqual(inventory.routes, ["/legacy-alias", "/overview", "/reviews/logs"]);
    assert.deepEqual(inventory.manifestWithoutPage, ["/reviews/logs"]);
    assert.deepEqual(inventory.pageOnlyRoutes, ["/legacy-alias"]);
    assert.equal(smoke.summarizeRouteContract(inventory).ok, false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("route resolution is same-origin and report-safe", () => {
  const baseUrl = new URL("http://127.0.0.1:3100/");
  const route = smoke.resolveRoute(baseUrl, "/conversations?customerId=customer-secret#message");
  assert.equal(route.url, "http://127.0.0.1:3100/conversations?customerId=customer-secret");
  assert.equal(route.route, "/conversations?customerId=%3Credacted%3E");
  assert.throws(() => smoke.resolveRoute(baseUrl, "https://example.com/overview"), /Cross-origin/);
});

test("report redaction removes credentials, query values, tokens, and local paths", () => {
  const report = smoke.redactReport({
    url: "http://user:pass@127.0.0.1:3100/overview?token=top-secret#private",
    message: "Authorization=secret-value Bearer abc.def token=another C:\\Users\\operator\\private.txt user@example.com 13800138000 019f594c-a814-7523-92e4-e4725ef4f342",
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /top-secret|secret-value|abc\.def|another|operator|private\.txt|user@example|13800138000|019f594c|user|pass/);
  assert.match(serialized, /redacted/);

  const failure = smoke.buildRunnerFailureReport({
    baseUrl: new URL("http://127.0.0.1:3100/?token=secret"),
    routes: [{ url: "http://127.0.0.1:3100/overview", route: "/overview" }],
  }, new Error("Edge failed token=secret C:\\Users\\operator\\profile"));
  const failureReport = JSON.stringify(smoke.redactReport(failure));
  assert.doesNotMatch(failureReport, /secret|operator|profile/);
  assert.equal(failure.ok, false);
});

test("route summary enforces every release layout invariant", () => {
  const passing = smoke.summarizeInspection({
    route: "/overview",
    viewport: "desktop",
    httpStatus: 200,
    dom: {
      url: "http://127.0.0.1:3100/overview",
      title: "智能体客服",
      h1Count: 1,
      mainCount: 1,
      bodyTextLength: 120,
      mainTextLength: 80,
      viewportWidth: 1440,
      documentWidth: 1440,
      bodyWidth: 1440,
      horizontalOverflow: false,
      nextErrorOverlay: false,
      overlayMarkers: [],
    },
  });
  assert.equal(passing.ok, true);
  assert.deepEqual(Object.values(passing.checks), [true, true, true, true, true, true, true, true]);

  const failing = smoke.summarizeInspection({
    route: "/overview",
    viewport: "mobile",
    httpStatus: 500,
    dom: {
      title: "",
      h1Count: 2,
      mainCount: 0,
      bodyTextLength: 0,
      mainTextLength: 0,
      horizontalOverflow: true,
      nextErrorOverlay: true,
      overlayMarkers: ["nextjs-portal:error-text"],
    },
    runtimeExceptions: ["Runtime exception token=secret"],
  });
  assert.equal(failing.ok, false);
  assert.equal(Object.values(failing.checks).every((value) => value === false), true);
  assert.doesNotMatch(failing.runtimeExceptions[0], /secret$/);
});

test("Edge CDP contract covers both viewports, route health, screenshots, and history", () => {
  assert.deepEqual(smoke.VIEWPORTS, [
    { id: "desktop", width: 1440, height: 900, mobile: false },
    { id: "mobile", width: 390, height: 844, mobile: true },
  ]);
  for (const method of [
    "Network.responseReceived",
    "Runtime.exceptionThrown",
    "Emulation.setDeviceMetricsOverride",
    "Page.captureScreenshot",
    "Page.navigate",
  ]) {
    assert.match(source, new RegExp(method.replace(".", "\\.")));
  }
  assert.match(smoke.DOM_PROBE_SOURCE, /querySelectorAll\("h1"\)/);
  assert.match(smoke.DOM_PROBE_SOURCE, /querySelectorAll\("main"\)/);
  assert.match(smoke.DOM_PROBE_SOURCE, /horizontalOverflow/);
  assert.match(smoke.DOM_PROBE_SOURCE, /nextjs-portal/);
  assert.match(source, /history\.back\(\)/);
  assert.match(source, /history\.forward\(\)/);
  assert.doesNotThrow(() => new Function(`return ${smoke.DOM_PROBE_SOURCE}`));
  assert.doesNotThrow(() => new Function(`return ${smoke.SAFE_NAVIGATION_SOURCE}`));
});

test("the only automated click is a guarded navigation anchor", () => {
  assert.equal(smoke.SAFE_NAVIGATION_SELECTOR, "nav a[href], [role=\"navigation\"] a[href]");
  assert.match(smoke.SAFE_NAVIGATION_SOURCE, /closest\("nav, \[role=\\"navigation\\"\]"\)/);
  assert.match(smoke.SAFE_NAVIGATION_SOURCE, /target\.origin !== current\.origin/);
  assert.match(smoke.SAFE_NAVIGATION_SOURCE, /dangerous\.test/);
  assert.match(smoke.SAFE_NAVIGATION_SOURCE, /link\.click\(\)/);
  assert.doesNotMatch(smoke.SAFE_NAVIGATION_SOURCE, /button|form|submit\(\)/i);
  assert.doesNotMatch(source, /querySelector(?:All)?\([^\n]*button/i);
});

test("temporary Edge profiles are created outside the repo and removed in finally", () => {
  assert.match(source, /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\)/);
  assert.match(source, /finally\s*\{/);
  assert.match(source, /removeTemporaryProfile\(profileDir\)/);
  assert.match(source, /fs\.promises\.rm\(profileDir, \{ recursive: true, force: true/);
  assert.match(source, /writeJsonAtomic/);
  assert.equal(smoke.REPORT_FILE, "modular-ui-smoke-report.json");
  const runSmokeSource = source.slice(source.indexOf("async function runSmoke"), source.indexOf("async function exerciseRoutes"));
  assert.ok(runSmokeSource.indexOf("try {") < runSmokeSource.indexOf("findEdgePath()"));
});
