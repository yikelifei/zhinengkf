"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("settings navigation mounts the isolated large-model center", () => {
  const page = read("apps/web/src/app/page.tsx");
  const navigation = read("apps/web/src/components/workbench-shell/navigation.ts");
  const types = read("apps/web/src/components/workbench-shell/types.ts");
  assert.match(page, /id: "ai-model-settings", label: "大模型"/);
  assert.match(page, /<AiModelSettings onStatusMessage=\{setMessage\} \/>/);
  assert.match(navigation, /id: "ai-model-settings", label: "大模型中心"/);
  assert.match(types, /\| "ai-model-settings"/);
});

test("model settings exposes provider, secret, test, primary and ordered fallback controls", () => {
  const component = read("apps/web/src/components/ai-model-settings.tsx");
  assert.match(component, /大模型中心/);
  assert.match(component, /API Key/);
  assert.match(component, /type=\{showSecret \? "text" : "password"\}/);
  assert.match(component, /留空表示保持不变/);
  assert.match(component, /clearApiKey/);
  assert.match(component, /保存并测试/);
  assert.match(component, /主模型/);
  assert.match(component, /备用顺序/);
  assert.match(component, /moveFallback/);
  assert.match(component, /自动回退规则回复/);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
});

test("web API never requests a model secret and only submits one when the operator typed it", () => {
  const api = read("apps/web/src/lib/api.ts");
  const component = read("apps/web/src/components/ai-model-settings.tsx");
  assert.match(api, /getAiProviderSettings/);
  assert.match(api, /updateAiProviderSettings/);
  assert.match(api, /testAiProvider/);
  assert.doesNotMatch(api, /AiProviderSettingsProvider[\s\S]{0,700}apiKey:/);
  assert.match(component, /provider\.apiKey\.trim\(\) \? \{ apiKey: provider\.apiKey\.trim\(\) \} : \{\}/);
});

test("large-model settings is a direct workspace section and adapts to a 390px viewport", () => {
  const css = read("apps/web/src/app/globals.css");
  const visibility = css.indexOf('.workspace[data-active-section="ai-model-settings"] > .ai-model-settings');
  const mobile = css.indexOf("@media (max-width: 720px)", visibility);
  assert.ok(visibility >= 0, "workspace visibility selector should exist");
  assert.ok(mobile >= 0, "mobile breakpoint should cover 390px");
  assert.match(css.slice(mobile), /\.ai-model-layout\s*\{\s*display: flex;\s*flex-direction: column/);
  assert.match(css.slice(mobile), /grid-auto-flow: column/);
});
