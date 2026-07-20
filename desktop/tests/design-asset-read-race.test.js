"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { createDesignAssetOperationGuard, createDesignAssetReadGuard, runGuardedDesignAssetMutation, runGuardedDesignAssetRead } = require("../apps/web/src/features/design/design-asset-read-guard");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function identity(suffix) {
  return {
    ownerId: `owner-${suffix}`,
    wechatAccountId: `wechat-${suffix}`,
    conversationId: `conversation-${suffix}`,
    customerId: `customer-${suffix}`,
  };
}

function nextTask() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createReadHarness(initialIdentity) {
  const guard = createDesignAssetReadGuard(initialIdentity);
  const state = { assets: [], loaded: false, busy: false, error: "" };

  return {
    state,
    setIdentity(nextIdentity) {
      guard.setIdentity(nextIdentity);
      state.assets = [];
      state.loaded = false;
      state.busy = false;
    },
    async read(requestIdentity, loader) {
      await runGuardedDesignAssetRead({
        guard,
        identity: requestIdentity,
        load: loader,
        onStart: () => { state.busy = true; state.error = ""; state.assets = []; state.loaded = false; },
        onSuccess: (assets) => { state.assets = assets; state.loaded = true; },
        onError: (error) => { state.assets = []; state.loaded = false; state.error = error.message; },
        onFinally: () => { state.busy = false; },
      });
    },
  };
}

function createOperationHarness(initialIdentity) {
  const guard = createDesignAssetOperationGuard(initialIdentity);
  const state = { assets: [], loaded: false, busy: "", error: "", notice: "" };
  const events = [];

  return {
    guard,
    state,
    events,
    setIdentity(nextIdentity) {
      guard.setIdentity(nextIdentity);
      state.assets = [];
      state.loaded = false;
      state.busy = "";
      state.error = "";
      state.notice = "";
    },
    async read(requestIdentity, loader) {
      await runGuardedDesignAssetRead({
        guard,
        identity: requestIdentity,
        load: loader,
        onStart: () => { events.push("read:start"); state.busy = "refresh"; state.error = ""; state.notice = ""; state.assets = []; state.loaded = false; },
        onSuccess: (assets) => { events.push("read:success"); state.assets = assets; state.loaded = true; },
        onError: (error) => { events.push("read:error"); state.assets = []; state.loaded = false; state.error = error.message; },
        onFinally: () => { events.push("read:finally"); state.busy = ""; },
      });
    },
    async upload(requestIdentity, { prepare, mutate, refresh }) {
      await runGuardedDesignAssetMutation({
        guard,
        identity: requestIdentity,
        prepare,
        mutate,
        refresh,
        onStart: () => { events.push("upload:start"); state.busy = "upload"; state.error = ""; state.notice = ""; },
        onMutationSuccess: () => { events.push("upload:mutated"); state.busy = "refresh"; },
        onRefreshSuccess: (assets) => { events.push("upload:refresh-success"); state.assets = assets; state.loaded = true; },
        onRefreshError: (error) => { events.push("upload:refresh-error"); state.assets = []; state.loaded = false; state.error = error.message; },
        onSuccess: (created) => { events.push("upload:success"); state.notice = `${created.fileName} uploaded`; },
        onError: (error) => { events.push("upload:error"); state.error = error.message; },
        onFinally: () => { events.push("upload:finally"); state.busy = ""; },
      });
    },
  };
}

test("late identity A asset response cannot overwrite a completed empty identity B read", async () => {
  const identityA = identity("a");
  const identityB = identity("b");
  const requestA = deferred();
  const requestB = deferred();
  const harness = createReadHarness(identityA);
  const readA = harness.read(identityA, () => requestA.promise);

  harness.setIdentity(identityB);
  const readB = harness.read(identityB, () => requestB.promise);
  requestB.resolve([]);
  await readB;
  assert.deepEqual(harness.state, { assets: [], loaded: true, busy: false, error: "" });

  requestA.resolve([{ id: "asset-from-a" }]);
  await readA;
  assert.deepEqual(harness.state, { assets: [], loaded: true, busy: false, error: "" });
});

test("late identity A failure cannot replace identity B error or clear its loading state", async () => {
  const identityA = identity("a");
  const identityB = identity("b");
  const requestA = deferred();
  const requestB = deferred();
  const harness = createReadHarness(identityA);
  const readA = harness.read(identityA, () => requestA.promise);

  harness.setIdentity(identityB);
  const readB = harness.read(identityB, () => requestB.promise);
  requestA.reject(new Error("identity A failed"));
  await readA;
  assert.equal(harness.state.busy, true);
  assert.equal(harness.state.error, "");

  requestB.reject(new Error("identity B failed"));
  await readB;
  assert.deepEqual(harness.state, { assets: [], loaded: false, busy: false, error: "identity B failed" });
});

test("a stale closure cannot start an old-identity read or invalidate the active new-identity read", async () => {
  const identityA = identity("a");
  const identityB = identity("b");
  const requestB = deferred();
  let staleLoaderCalls = 0;
  const harness = createReadHarness(identityA);

  harness.setIdentity(identityB);
  const readB = harness.read(identityB, () => requestB.promise);
  await harness.read(identityA, async () => {
    staleLoaderCalls += 1;
    return [{ id: "asset-from-a" }];
  });
  assert.equal(staleLoaderCalls, 0);

  requestB.resolve([]);
  await readB;
  assert.deepEqual(harness.state, { assets: [], loaded: true, busy: false, error: "" });
});

test("late identity A upload refresh cannot overwrite identity B or clear B loading", async () => {
  const identityA = identity("a");
  const identityB = identity("b");
  const uploadA = deferred();
  const refreshA = deferred();
  const readB = deferred();
  const harness = createOperationHarness(identityA);

  const operationA = harness.upload(identityA, {
    prepare: async () => "base64-a",
    mutate: () => uploadA.promise,
    refresh: () => refreshA.promise,
  });
  await nextTask();
  uploadA.resolve({ fileName: "a.png" });
  await nextTask();
  assert.equal(harness.state.busy, "refresh");

  harness.setIdentity(identityB);
  const operationB = harness.read(identityB, () => readB.promise);
  assert.equal(harness.state.busy, "refresh");
  refreshA.resolve([{ id: "asset-from-a" }]);
  await operationA;

  assert.deepEqual(harness.state, { assets: [], loaded: false, busy: "refresh", error: "", notice: "" });
  assert.doesNotMatch(harness.events.join(" "), /upload:refresh-success|upload:success|upload:finally/);

  readB.resolve([{ id: "asset-from-b" }]);
  await operationB;
  assert.deepEqual(harness.state, { assets: [{ id: "asset-from-b" }], loaded: true, busy: "", error: "", notice: "" });
});

test("late identity A upload failure cannot replace identity B state or clear B loading", async () => {
  const identityA = identity("a");
  const identityB = identity("b");
  const uploadA = deferred();
  const readB = deferred();
  const harness = createOperationHarness(identityA);

  const operationA = harness.upload(identityA, {
    prepare: async () => "base64-a",
    mutate: () => uploadA.promise,
    refresh: async () => [],
  });
  await nextTask();
  harness.setIdentity(identityB);
  const operationB = harness.read(identityB, () => readB.promise);
  uploadA.reject(new Error("identity A upload failed"));
  await operationA;

  assert.deepEqual(harness.state, { assets: [], loaded: false, busy: "refresh", error: "", notice: "" });
  assert.doesNotMatch(harness.events.join(" "), /upload:error|upload:finally/);

  readB.resolve([]);
  await operationB;
  assert.deepEqual(harness.state, { assets: [], loaded: true, busy: "", error: "", notice: "" });
});

test("identity invalidation during upload preparation prevents the stale mutation from starting", async () => {
  const identityA = identity("a");
  const identityB = identity("b");
  const preparationA = deferred();
  const harness = createOperationHarness(identityA);
  let mutationCalls = 0;

  const operationA = harness.upload(identityA, {
    prepare: () => preparationA.promise,
    mutate: async () => { mutationCalls += 1; return { fileName: "a.png" }; },
    refresh: async () => [],
  });
  harness.setIdentity(identityB);
  preparationA.resolve("base64-a");
  await operationA;

  assert.equal(mutationCalls, 0);
  assert.deepEqual(harness.state, { assets: [], loaded: false, busy: "", error: "", notice: "" });
});

test("normalized-equal identity invalidation fences the first of two upload mutations", async () => {
  const identityA = identity("a");
  const preparationA = deferred();
  const harness = createOperationHarness(identityA);
  let firstMutationCalls = 0;
  let secondMutationCalls = 0;

  const firstOperation = harness.upload(identityA, {
    prepare: () => preparationA.promise,
    mutate: async () => { firstMutationCalls += 1; return { fileName: "stale.png" }; },
    refresh: async () => [{ id: "stale-asset" }],
  });

  harness.guard.invalidate({
    ownerId: ` ${identityA.ownerId} `,
    wechatAccountId: identityA.wechatAccountId,
    conversationId: identityA.conversationId,
    customerId: identityA.customerId,
  });
  const secondOperation = harness.upload(identityA, {
    prepare: async () => "base64-current",
    mutate: async () => { secondMutationCalls += 1; return { fileName: "current.png" }; },
    refresh: async () => [{ id: "current-asset" }],
  });

  preparationA.resolve("base64-stale");
  await Promise.all([firstOperation, secondOperation]);

  assert.equal(firstMutationCalls, 0);
  assert.equal(secondMutationCalls, 1);
  assert.deepEqual(harness.state.assets, [{ id: "current-asset" }]);
  assert.equal(harness.state.notice, "current.png uploaded");
  assert.doesNotMatch(harness.events.join(" "), /stale\.png/);
});

test("dispose blocks every in-flight upload continuation and activate supports StrictMode effect replay", async () => {
  const identityA = identity("a");
  const uploadA = deferred();
  const harness = createOperationHarness(identityA);

  const operationA = harness.upload(identityA, {
    prepare: async () => "base64-a",
    mutate: () => uploadA.promise,
    refresh: async () => [],
  });
  await nextTask();
  harness.guard.dispose();
  uploadA.reject(new Error("unmounted upload failed"));
  await operationA;
  assert.deepEqual(harness.events, ["upload:start"]);

  harness.guard.activate();
  await harness.read(identityA, async () => []);
  assert.deepEqual(harness.events, ["upload:start", "read:start", "read:success", "read:finally"]);
});

test("design assets page wires identity changes, upload refresh, and unmount into the shared operation guard", () => {
  const page = fs.readFileSync(path.resolve(__dirname, "../apps/web/src/features/design/design-assets-page.tsx"), "utf8");

  assert.match(page, /runGuardedDesignAssetMutation\(\{/);
  assert.match(page, /assetOperationGuard\.activate\(\)/);
  assert.match(page, /return \(\) => assetOperationGuard\.dispose\(\)/);
  assert.match(page, /assetOperationGuard\.invalidate\(identity\)/);
  assert.match(page, /function invalidateAssetOperations/);
  assert.match(page, /disabled=\{Boolean\(busy\)\}/);
  assert.doesNotMatch(page, /await refreshAssets\(\)/);
});
