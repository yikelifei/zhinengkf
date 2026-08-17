"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", esModuleInterop: true },
});

const {
  resolveTrainingHistoryRead,
  scopedTrainingHistoryKnown,
  scopedTrainingHistoryValue,
  unknownTrainingHistoryRead,
} = require("../apps/web/src/features/training/training-import-history-read-state");

test("training history treats a fulfilled empty response as trusted empty", () => {
  const state = resolveTrainingHistoryRead(unknownTrainingHistoryRead([]), "customer-a", { status: "fulfilled", value: [] }, []);
  assert.equal(state.status, "ready");
  assert.equal(scopedTrainingHistoryKnown(state, "customer-a"), true);
  assert.deepEqual(scopedTrainingHistoryValue(state, "customer-a", []), []);
});

test("training history preserves same-scope trusted content as stale after refresh failure", () => {
  const ready = resolveTrainingHistoryRead(unknownTrainingHistoryRead([]), "customer-a", { status: "fulfilled", value: ["batch-a"] }, []);
  const stale = resolveTrainingHistoryRead(ready, "customer-a", { status: "rejected", reason: new Error("offline") }, []);
  assert.equal(stale.status, "stale");
  assert.deepEqual(scopedTrainingHistoryValue(stale, "customer-a", []), ["batch-a"]);
});

test("training history never exposes another identity scope after a failed read", () => {
  const ready = resolveTrainingHistoryRead(unknownTrainingHistoryRead([]), "customer-a", { status: "fulfilled", value: ["batch-a"] }, []);
  const unknown = resolveTrainingHistoryRead(ready, "customer-b", { status: "rejected", reason: new Error("offline") }, []);
  assert.equal(unknown.status, "unknown");
  assert.equal(scopedTrainingHistoryKnown(unknown, "customer-b"), false);
  assert.deepEqual(scopedTrainingHistoryValue(ready, "customer-b", []), []);
});
