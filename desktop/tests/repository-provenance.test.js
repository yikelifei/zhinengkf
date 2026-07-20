"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeRepositoryRevision,
  resolveRepositoryRevision,
} = require("../tools/repository-provenance");

test("repository provenance accepts only complete Git object hashes", () => {
  assert.equal(normalizeRepositoryRevision("A".repeat(40)), "a".repeat(40));
  assert.equal(normalizeRepositoryRevision("b".repeat(64)), "b".repeat(64));
  assert.throws(() => normalizeRepositoryRevision("abc123"), /revision unavailable/);
  assert.throws(() => normalizeRepositoryRevision("g".repeat(40)), /revision unavailable/);
});

test("repository provenance uses a read-only git command and fails closed", () => {
  const calls = [];
  const revision = resolveRepositoryRevision({
    repositoryRoot: "C:/fixture",
    runCommand: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: `${"c".repeat(40)}\n`, stderr: "" };
    },
  });
  assert.equal(revision, "c".repeat(40));
  assert.deepEqual(calls[0].args, ["rev-parse", "HEAD"]);
  assert.equal(calls[0].options.shell, false);
  assert.throws(() => resolveRepositoryRevision({
    repositoryRoot: "C:/fixture",
    runCommand: () => ({ status: 1, stdout: "", stderr: "secret error must not be echoed" }),
  }), /revision unavailable/);
});
