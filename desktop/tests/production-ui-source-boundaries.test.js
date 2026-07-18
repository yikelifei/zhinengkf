"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const webRoot = path.resolve(__dirname, "../apps/web/src");
const appRoot = path.join(webRoot, "app");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

function relative(file) {
  return path.relative(webRoot, file).replaceAll(path.sep, "/");
}

function lineCount(source) {
  return source.split(/\r?\n/).length;
}

function containsFiles(target) {
  if (!fs.existsSync(target)) return false;
  if (fs.statSync(target).isFile()) return true;
  return walk(target).length > 0;
}

const removedProductionPaths = [
  "app/globals.css",
  "app/legacy-workbench.tsx",
  "components/integration-center/integration-center-header.tsx",
  "components/integration-center/integration-center-header.module.css",
  "components/message-safety-governance",
  "components/personal-wechat-control-center",
  "components/personal-wechat-instances-panel.tsx",
  "components/personal-wechat-instances-panel.module.css",
  "components/personal-wechat-workspace",
];

const bannedLegacyReferences = [
  /legacy-workbench/i,
  /PersonalWechatWorkspace/,
  /personal-wechat-workspace/,
  /PersonalWechatControlCenter/,
  /personal-wechat-control-center/,
  /MessageSafetyGovernance/,
  /message-safety-governance/,
  /PersonalWechatInstancesPanel/,
  /personal-wechat-instances-panel/,
  /IntegrationCenterHeader/,
  /integration-center-header/,
];

test("retired aggregate workbench files stay outside the production source tree", () => {
  for (const removedPath of removedProductionPaths) {
    assert.equal(
      containsFiles(path.join(webRoot, removedPath)),
      false,
      `${removedPath} must not return to production source`,
    );
  }

  assert.equal(
    fs.existsSync(path.join(webRoot, "components/voice-assist-center/voice-assist-center.tsx")),
    true,
    "voice assist remains a reusable feature for its independent route",
  );
});

test("production modules cannot import or name retired aggregate workbench modules", () => {
  const productionFiles = walk(webRoot).filter((file) => /\.(?:ts|tsx|css)$/.test(file));

  for (const file of productionFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of bannedLegacyReferences) {
      assert.doesNotMatch(source, pattern, `${relative(file)} references retired aggregate code`);
    }
  }

  const layout = fs.readFileSync(path.join(appRoot, "layout.tsx"), "utf8");
  assert.match(layout, /styles\/workbench-tokens\.css/);
  assert.match(layout, /styles\/base\.css/);
  assert.doesNotMatch(layout, /globals\.css/);
});

test("route entries and React feature modules stay below giant-file limits", () => {
  const routeEntries = walk(appRoot).filter((file) => file.endsWith(".tsx"));
  const reactModules = walk(webRoot).filter((file) => file.endsWith(".tsx"));

  for (const file of routeEntries) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(lineCount(source) <= 200, `${relative(file)} exceeds the 200-line route-entry limit`);
    assert.ok(Buffer.byteLength(source) <= 16 * 1024, `${relative(file)} exceeds the 16 KiB route-entry limit`);
  }

  for (const file of reactModules) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(lineCount(source) <= 400, `${relative(file)} exceeds the 400-line React module limit`);
    assert.ok(Buffer.byteLength(source) <= 24 * 1024, `${relative(file)} exceeds the 24 KiB React module limit`);
  }
});

test("production styles cannot grow back into a monolithic global stylesheet", () => {
  const stylesheets = walk(webRoot).filter((file) => file.endsWith(".css"));

  for (const file of stylesheets) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(lineCount(source) <= 2000, `${relative(file)} exceeds the 2000-line stylesheet limit`);
    assert.ok(Buffer.byteLength(source) <= 64 * 1024, `${relative(file)} exceeds the 64 KiB stylesheet limit`);
  }
});
