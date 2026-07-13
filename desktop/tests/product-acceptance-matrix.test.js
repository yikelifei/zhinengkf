"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const matrixPath = path.join(root, "config", "product-acceptance-matrix.json");
const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));

test("product acceptance matrix covers every requested capability and mode", () => {
  const capabilities = new Set(matrix.scenarios.map((scenario) => scenario.capability));
  for (const capability of matrix.requiredCapabilities) {
    assert.equal(capabilities.has(capability), true, `missing capability: ${capability}`);
  }
  assert.deepEqual(new Set(Object.keys(matrix.modeDefinitions)), new Set(["mock", "local-safe", "real-external"]));
  assert.equal(matrix.defaultMode, "local-safe");
});

test("safe modes cannot mutate external systems", () => {
  for (const scenario of matrix.scenarios.filter((item) => item.mode !== "real-external")) {
    assert.equal(scenario.mutatesExternal, false, `${scenario.id} must not mutate external systems`);
    assert.notEqual(scenario.sideEffectClass, "read-write-external");
  }
  assert.equal(matrix.safetyPolicy.realMessageSend, "forbidden");
  assert.equal(matrix.safetyPolicy.paymentMutation, "forbidden");
  assert.equal(matrix.safetyPolicy.forcedEnvironment.PERSONAL_WECHAT_SEND, "0");
  assert.equal(matrix.safetyPolicy.forcedEnvironment.PERSONAL_WECHAT_BRIDGE_AUTO_ENTER, "0");
  assert.equal(matrix.safetyPolicy.forbiddenHttpMutations.includes("/api/chat/send"), true);
});

test("real external scenarios are read-only and declare dependencies", () => {
  const external = matrix.scenarios.filter((scenario) => scenario.mode === "real-external");
  assert.ok(external.length >= 3);
  for (const scenario of external) {
    assert.equal(scenario.mutatesExternal, false);
    assert.equal(scenario.sideEffectClass, "read-only-external");
    assert.ok(Array.isArray(scenario.externalDependencies) && scenario.externalDependencies.length > 0);
  }
});

test("acceptance runner and 390 renderer are wired to package scripts", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const runner = fs.readFileSync(path.join(root, "tools", "run-product-acceptance.js"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "tools", "product-acceptance-layout-probe.js"), "utf8");

  assert.match(packageJson.scripts["acceptance:e2e"], /run-product-acceptance\.js/);
  assert.match(runner, /PERSONAL_WECHAT_SEND:\s*"0"/);
  assert.match(runner, /LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE:\s*"false"/);
  assert.match(runner, /await waitForChildExit\(service\.child/);
  assert.match(renderer, /width:\s*390/);
  assert.match(renderer, /capturePage/);
  assert.match(renderer, /app\.setPath\("userData"/);
  assert.match(renderer, /app\.disableHardwareAcceleration\(\)/);
  assert.match(renderer, /data-section-id=\"send-center\"/);
});

test("bridge worker restores customer identity from the sanitized API preview", () => {
  const worker = fs.readFileSync(path.join(root, "tools", "wechat-bridge-worker.js"), "utf8");
  assert.match(worker, /customerId:\s*entry\.customerId \|\| entry\.preview\?\.customerId \|\| ""/);
});
