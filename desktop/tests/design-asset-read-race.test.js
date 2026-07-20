"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { createDesignAssetReadGuard, runGuardedDesignAssetRead } = require("../apps/web/src/features/design/design-asset-read-guard");

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
