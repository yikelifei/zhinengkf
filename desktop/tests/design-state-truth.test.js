"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", jsx: "react-jsx", esModuleInterop: true },
});

const { DesignExecutionReconciliationPanel } = require("../apps/web/src/components/design-execution-reconciliation-panel");
const { createDesignRequestGuard, runGuardedDesignRequest } = require("../apps/web/src/features/design/design-request-guard");
const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("late design scope A response cannot overwrite scope B or clear B loading", async () => {
  const guard = createDesignRequestGuard("A");
  const requestA = deferred();
  const requestB = deferred();
  const state = { value: "", busy: false, error: "" };
  const run = (scopeKey, request) => runGuardedDesignRequest({
    guard,
    scopeKey,
    load: () => request.promise,
    onStart: () => { state.busy = true; state.error = ""; },
    onSuccess: (value) => { state.value = value; },
    onError: (error) => { state.error = error.message; },
    onFinally: () => { state.busy = false; },
  });

  const stale = run("A", requestA);
  guard.setScope("B");
  const current = run("B", requestB);
  requestA.resolve("stale A");
  assert.equal(await stale, false);
  assert.deepEqual(state, { value: "", busy: true, error: "" });

  requestB.resolve("current B");
  assert.equal(await current, true);
  assert.deepEqual(state, { value: "current B", busy: false, error: "" });
});

test("disposed design request cannot commit success failure or finally callbacks", async () => {
  const guard = createDesignRequestGuard("settings");
  const request = deferred();
  const events = [];
  const pending = runGuardedDesignRequest({
    guard,
    scopeKey: "settings",
    load: () => request.promise,
    onStart: () => events.push("start"),
    onSuccess: () => events.push("success"),
    onError: () => events.push("error"),
    onFinally: () => events.push("finally"),
  });
  guard.dispose();
  request.reject(new Error("unmounted"));
  assert.equal(await pending, false);
  assert.deepEqual(events, ["start"]);
});

test("execution panel distinguishes failed reads and unknown access from confirmed empty and denied", () => {
  const callbacks = {
    onRefresh: async () => {},
    onResolveUnknown: async () => {},
    onResolveRefund: async () => {},
  };
  const unknown = renderToStaticMarkup(React.createElement(DesignExecutionReconciliationPanel, {
    ...callbacks,
    executions: [],
    loading: false,
    loaded: false,
    error: "读取执行记录失败",
    accessLoaded: false,
    accessError: "权限读取失败",
    canManageExecutions: false,
  }));
  assert.match(unknown, /不能据此认定没有执行记录/);
  assert.match(unknown, /执行管理权限尚未成功读取/);
  assert.doesNotMatch(unknown, /读取成功，当前任务没有持久化执行记录/);
  assert.doesNotMatch(unknown, /当前会话没有 manage_design_executions 能力/);

  const confirmed = renderToStaticMarkup(React.createElement(DesignExecutionReconciliationPanel, {
    ...callbacks,
    executions: [],
    loading: false,
    loaded: true,
    accessLoaded: true,
    canManageExecutions: false,
  }));
  assert.match(confirmed, /读取成功，当前任务没有持久化执行记录/);
  assert.match(confirmed, /当前会话没有 manage_design_executions 能力/);
});

test("design settings and executions wire slice truth sequence cleanup and identity resets", () => {
  const settings = read("apps/web/src/features/design/design-settings-page.tsx");
  for (const marker of ["configLoaded", "healthLoaded", "readinessLoaded", "configError", "healthError", "readinessError"]) {
    assert.match(settings, new RegExp(`\\b${marker}\\b`));
  }
  assert.match(settings, /runGuardedDesignRequest\(\{/);
  assert.match(settings, /return \(\) => requestGuard\.invalidate\(SETTINGS_SCOPE_KEY\)/);
  assert.match(settings, /setConfig\(null\); setConfigLoaded\(false\)/);
  assert.match(settings, /setAdapter\(""\); setBaseUrl\(""\)/);
  assert.match(settings, /setHealth\(null\); setHealthLoaded\(false\)/);
  assert.match(settings, /setReadiness\(null\); setReadinessLoaded\(false\)/);
  assert.match(settings, /!readinessLoaded \|\| !readiness\?\.ok/);

  const status = read("apps/web/src/features/design/design-job-status-page.tsx");
  assert.match(status, /executionGuard\.setScope\(scopeKey\)/);
  assert.match(status, /executionGuard\.invalidate\(scopeKey\)/);
  assert.match(status, /runGuardedDesignRequest\(\{/);
  assert.match(status, /loaded=\{visibleExecutionsLoaded\}/);
  assert.match(status, /accessLoaded=\{visibleAccessLoaded\}/);
  assert.match(status, /key=\{scopeKey\}/);
  assert.match(status, /onRefresh=\{manualRefreshExecutions\}/);
});

test("design account activation and settings freeze request inputs and use single-submit locks", () => {
  const files = [
    "apps/web/src/features/design/design-account-page.tsx",
    "apps/web/src/features/design/design-activation-page.tsx",
    "apps/web/src/features/design/design-settings-page.tsx",
  ];
  for (const relativePath of files) {
    const source = read(relativePath);
    assert.match(source, /LockRef = useRef\(false\)/);
    assert.match(source, /LockRef\.current \|\| busy/);
    assert.match(source, /disabled=\{(?:controlsDisabled|busy)\}/);
  }
  const account = read(files[0]);
  assert.match(account, /const intent = \{ email: email\.trim\(\), password, deviceId: deviceId\.trim\(\) \}/);
  const activation = read(files[1]);
  assert.match(activation, /const targetDeviceLabel = deviceLabel\.trim\(\) \|\| "智能客服工作台"/);
  const settings = read(files[2]);
  assert.match(settings, /const intent = \{/);
  assert.match(settings, /load: \(\) => updateDesignPlatformConfig\(intent\)/);
});
