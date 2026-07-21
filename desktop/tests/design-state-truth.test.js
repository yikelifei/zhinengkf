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

const {
  DesignExecutionReconciliationPanel,
  getDesignExecutionResolutionBlockedReason,
} = require("../apps/web/src/components/design-execution-reconciliation-panel");
const { createDesignRequestGuard, runGuardedDesignRequest } = require("../apps/web/src/features/design/design-request-guard");
const { DesignSettingsPage } = require("../apps/web/src/features/design/design-settings-page");
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

function renderDirectWithHooks(render, stateValues, refValues) {
  const originals = {
    useCallback: React.useCallback,
    useEffect: React.useEffect,
    useRef: React.useRef,
    useState: React.useState,
  };
  let stateIndex = 0;
  let refIndex = 0;
  React.useState = () => [stateValues[stateIndex++], () => {}];
  React.useRef = (initialValue) => refValues[refIndex++] || { current: initialValue };
  React.useEffect = () => {};
  React.useCallback = (callback) => callback;
  try {
    return renderToStaticMarkup(render());
  } finally {
    Object.assign(React, originals);
  }
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

test("execution confirmation becomes disabled with an explicit reason when access truth changes", () => {
  const pending = { executionId: "execution-1", resolution: "confirmed_not_generated_refunded" };
  const currentExecution = {
    id: "execution-1",
    availableResolution: "confirmed_not_generated_refunded",
  };
  const guardInput = {
    pending,
    executions: [currentExecution],
    loading: false,
    accessLoaded: true,
    canManageExecutions: true,
  };
  assert.equal(getDesignExecutionResolutionBlockedReason(guardInput), "");
  assert.match(getDesignExecutionResolutionBlockedReason({ ...guardInput, loading: true }), /正在刷新/);
  assert.match(getDesignExecutionResolutionBlockedReason({ ...guardInput, accessLoaded: false }), /权限尚未确认/);
  assert.match(getDesignExecutionResolutionBlockedReason({ ...guardInput, canManageExecutions: false }), /没有执行管理权限/);
  assert.match(getDesignExecutionResolutionBlockedReason({ ...guardInput, executions: [] }), /执行记录或可用核销动作已经变化/);
  assert.match(getDesignExecutionResolutionBlockedReason({
    ...guardInput,
    executions: [{ ...currentExecution, availableResolution: "confirmed_refunded" }],
  }), /执行记录或可用核销动作已经变化/);

  const markup = renderDirectWithHooks(
    () => DesignExecutionReconciliationPanel({
      executions: [{
        id: "execution-1",
        attemptNo: 1,
        status: "outcome_unknown",
        acceptanceStatus: "pending",
        refundStatus: "unknown",
        imageCount: 0,
        updatedAt: "2026-07-21T00:00:00.000Z",
        resolvedAt: null,
        availableResolution: "confirmed_not_generated_refunded",
        errorCategory: null,
        responseHttpStatus: null,
      }],
      loading: true,
      loaded: false,
      accessLoaded: false,
      accessError: "权限读取失败",
      canManageExecutions: false,
      onRefresh: async () => {},
      onResolveUnknown: async () => {},
      onResolveRefund: async () => {},
    }),
    [pending, "", "", ""],
    [{ current: false }],
  );
  assert.match(markup, /执行记录正在刷新，请返回检查最新状态后重新确认/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>确认已失效<\/button>/);
});

test("design settings renders only the snapshotted intent and disables confirmation for every busy state", () => {
  const intent = {
    adapter: "adapter-snapshot",
    baseUrl: "https://snapshot.example.test",
    accessToken: "secret",
  };
  const markup = renderDirectWithHooks(
    () => DesignSettingsPage(),
    [
      null, false, "",
      null, false, "",
      null, false, "",
      "edited-adapter", "https://edited.example.test", "secret", "", "",
      "refresh", "", "", { generation: 7, intent }, null,
    ],
    [{ current: null }, { current: false }, { current: 7 }],
  );
  assert.match(markup, /adapter-snapshot/);
  assert.match(markup, /https:\/\/snapshot\.example\.test/);
  assert.doesNotMatch(markup, /edited-adapter/);
  assert.match(markup, /<button[^>]*data-action-id="design-settings-save-confirm"[^>]*disabled=""/);
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
  assert.match(settings, /confirmationGenerationRef\.current \+= 1/);
  assert.match(settings, /const intent = confirmation\.intent/);
  assert.match(settings, /busy=\{Boolean\(busy\)\}/);

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
  assert.match(settings, /settingsSaveIntent\(adapter, baseUrl, accessToken, cookie, deviceId\)/);
  assert.match(settings, /setPendingConfirmation\(\{ generation, intent \}\)/);
  assert.match(settings, /load: \(\) => updateDesignPlatformConfig\(intent\)/);
});
