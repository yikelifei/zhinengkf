"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", moduleResolution: "Node" },
});

const { resolveSalesSelection } = require("../apps/web/src/features/sales/sales-selection");

const rows = [{ id: "quote-a" }, { id: "quote-b" }];

test("a valid route entity id selects exactly that sales record", () => {
  assert.equal(resolveSalesSelection(rows, "quote-a", "quote-b"), "quote-b");
});

test("an unknown route entity id fails closed instead of selecting the first record", () => {
  assert.equal(resolveSalesSelection(rows, "quote-a", "missing-record"), "");
});

test("list pages may preserve a valid selection or default to the first record", () => {
  assert.equal(resolveSalesSelection(rows, "quote-b", ""), "quote-b");
  assert.equal(resolveSalesSelection(rows, "missing-record", ""), "quote-a");
  assert.equal(resolveSalesSelection([], "missing-record", ""), "");
});
