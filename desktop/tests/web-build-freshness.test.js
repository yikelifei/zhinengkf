"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");

function write(root, relative, content = "fixture\n") {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}

function createCompletedNextFixture(root, buildId) {
  const required = [
    "BUILD_ID",
    "build-manifest.json",
    "prerender-manifest.json",
    "required-server-files.json",
    "routes-manifest.json",
    "server/app-paths-manifest.json",
    "server/pages-manifest.json",
    `static/${buildId}/_buildManifest.js`,
    `static/${buildId}/_ssgManifest.js`,
  ];
  for (const relative of required) {
    write(root, `apps/web/.next/${relative}`, relative === "BUILD_ID" ? `${buildId}\n` : "{}\n");
  }
  return path.join(root, "apps", "web", ".next", "BUILD_ID");
}

test("stale completed .next without standalone cannot hide a nonzero Next build", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-build-freshness-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  write(root, "package.json", "{}\n");
  const sourcePath = write(root, "apps/web/src/app/page.tsx", "export default function Page() { return null; }\n");
  write(root, "tools/build-web.js", fs.readFileSync(path.join(desktopRoot, "tools", "build-web.js"), "utf8"));
  write(root, "tools/sync-web-standalone-assets.js", "process.exit(0);\n");
  write(root, "node_modules/next/dist/bin/next", "process.exit(17);\n");

  const buildIdPath = createCompletedNextFixture(root, "old-build");
  const oldTime = new Date(Date.now() - 120_000);
  const newTime = new Date(Date.now() - 1_000);
  fs.utimesSync(buildIdPath, oldTime, oldTime);
  fs.utimesSync(sourcePath, newTime, newTime);

  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [path.join(root, "tools", "build-web.js")], {
    cwd: root,
    env: {
      ...process.env,
      WEB_PORT: "0",
      DESKTOP_RUNTIME_DIR: path.join(root, ".runtime-test"),
      ALLOW_WEB_BUILD_WITH_FRESH_HEARTBEAT: "1",
    },
    encoding: "utf8",
    timeout: 45_000,
  });

  assert.equal(result.signal, null, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, 17, `${result.stdout}\n${result.stderr}`);
  assert.ok(Date.now() - startedAt < 45_000, "failed Next commands must not wait for standalone output");
  assert.equal(
    fs.existsSync(path.join(root, "apps", "web", ".next", "standalone", "apps", "web", "server.js")),
    false,
    "a stale build must not receive a generated standalone wrapper",
  );
});

test("fresh completed .next without standalone is rebuilt and never receives a source-bound wrapper", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-build-standalone-truth-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const packagePath = write(root, "package.json", "{}\n");
  const sourcePath = write(root, "apps/web/src/app/page.tsx", "export default function Page() { return null; }\n");
  const buildScript = fs.readFileSync(path.join(desktopRoot, "tools", "build-web.js"), "utf8");
  write(root, "tools/build-web.js", buildScript);
  write(root, "tools/sync-web-standalone-assets.js", "process.exit(0);\n");
  write(root, "node_modules/next/dist/bin/next", "process.exit(23);\n");

  const buildIdPath = createCompletedNextFixture(root, "fresh-build-without-standalone");
  const sourceTime = new Date(Date.now() - 120_000);
  const buildTime = new Date(Date.now() - 1_000);
  fs.utimesSync(packagePath, sourceTime, sourceTime);
  fs.utimesSync(sourcePath, sourceTime, sourceTime);
  fs.utimesSync(buildIdPath, buildTime, buildTime);

  const result = spawnSync(process.execPath, [path.join(root, "tools", "build-web.js")], {
    cwd: root,
    env: {
      ...process.env,
      WEB_PORT: "0",
      DESKTOP_RUNTIME_DIR: path.join(root, ".runtime-test"),
      ALLOW_WEB_BUILD_WITH_FRESH_HEARTBEAT: "1",
    },
    encoding: "utf8",
    timeout: 45_000,
  });

  assert.equal(result.signal, null, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, 23, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /has no standalone server; forcing a clean rebuild/);
  assert.equal(
    fs.existsSync(path.join(root, "apps", "web", ".next", "standalone", "apps", "web", "server.js")),
    false,
  );
  assert.doesNotMatch(buildScript, /writeStableStandaloneServer|requiredServerFiles = require\(path\.join\(root/);
});
