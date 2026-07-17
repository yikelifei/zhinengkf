"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const checker = require("../tools/check-modular-ui-bundles");

function writeRoute(buildDir, route, clientModules) {
  const routeDirectory = path.join(buildDir, "server", "app", ...route.split("/").filter(Boolean));
  fs.mkdirSync(routeDirectory, { recursive: true });
  const payload = { moduleLoading: { prefix: "/_next/" }, clientModules };
  fs.writeFileSync(
    path.join(routeDirectory, "page_client-reference-manifest.js"),
    `globalThis.__RSC_MANIFEST={};globalThis.__RSC_MANIFEST[${JSON.stringify(`${route}/page`)}]=${JSON.stringify(payload)};`,
    "utf8",
  );
}

function withBuild(run) {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "modular-bundles-"));
  fs.mkdirSync(path.join(buildDir, "static", "chunks"), { recursive: true });
  try {
    run(buildDir);
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
}

test("bundle checker accepts a route that references only its owning feature", () => withBuild((buildDir) => {
  fs.writeFileSync(path.join(buildDir, "static", "chunks", "overview.js"), "ok", "utf8");
  writeRoute(buildDir, "/overview", {
    "D:\\repo\\desktop\\apps\\web\\src\\features\\overview\\overview-page.tsx": {
      chunks: ["1", "static/chunks/overview.js"],
    },
  });
  const report = checker.inspectModularBundles(buildDir);
  assert.equal(report.ok, true);
  assert.deepEqual(report.routes[0].featureDomains, ["overview"]);
}));

test("bundle checker rejects cross-domain, legacy, and oversized client references", () => withBuild((buildDir) => {
  fs.writeFileSync(
    path.join(buildDir, "static", "chunks", "all-features.js"),
    Buffer.alloc(checker.MAX_REFERENCED_CHUNK_BYTES + 1),
  );
  writeRoute(buildDir, "/overview", {
    "D:\\repo\\desktop\\apps\\web\\src\\features\\overview\\overview-page.tsx": {
      chunks: ["1", "static/chunks/all-features.js"],
    },
    "D:\\repo\\desktop\\apps\\web\\src\\features\\sales\\sales-quotes-page.tsx": {
      chunks: ["1", "static/chunks/all-features.js"],
    },
    "D:\\repo\\desktop\\apps\\web\\src\\app\\legacy-workbench.tsx": {
      chunks: ["1", "static/chunks/all-features.js"],
    },
  });
  const report = checker.inspectModularBundles(buildDir);
  assert.equal(report.ok, false);
  assert.ok(report.violations.some((violation) => violation.reason.includes("unexpected feature domains: sales")));
  assert.ok(report.violations.some((violation) => violation.reason.includes("legacy workbench")));
  assert.ok(report.violations.some((violation) => violation.reason.includes("exceeds")));
}));

test("route-to-feature ownership handles nested settings and domain routes", () => {
  assert.equal(checker.allowedFeatureDomainForRoute("/settings/access"), "access");
  assert.equal(checker.allowedFeatureDomainForRoute("/integrations/personal-wechat/control"), "integrations");
  assert.equal(checker.allowedFeatureDomainForRoute("/sales/orders/[id]"), "sales");
  assert.equal(checker.allowedFeatureDomainForRoute("/"), null);
});
