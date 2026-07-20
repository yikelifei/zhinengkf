"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertCleanRepository,
  normalizeRepositoryRevision,
  resolveRepositoryRevision,
  resolveRepositoryState,
} = require("../tools/repository-provenance");

test("repository provenance accepts only complete Git object hashes", () => {
  assert.equal(normalizeRepositoryRevision("A".repeat(40)), "a".repeat(40));
  assert.equal(normalizeRepositoryRevision("b".repeat(64)), "b".repeat(64));
  assert.throws(() => normalizeRepositoryRevision("abc123"), /revision unavailable/);
  assert.throws(() => normalizeRepositoryRevision("g".repeat(40)), /revision unavailable/);
});

test("repository provenance requires a readable clean worktree for packaging", () => {
  const calls = [];
  const clean = resolveRepositoryState({
    repositoryRoot: "C:/fixture",
    runCommand: (command, args) => {
      calls.push([command, args]);
      if (args[0] === "rev-parse") return { status: 0, stdout: `${"d".repeat(40)}\n` };
      return { status: 0, stdout: "" };
    },
  });
  assert.deepEqual(clean, { revision: "d".repeat(40), clean: true });
  assert.deepEqual(calls[1][1], ["status", "--porcelain=v1", "--untracked-files=all"]);

  assert.throws(() => assertCleanRepository({
    repositoryRoot: "C:/fixture",
    runCommand: (_command, args) => args[0] === "rev-parse"
      ? { status: 0, stdout: `${"e".repeat(40)}\n` }
      : { status: 0, stdout: " M desktop/apps/web/src/lib/api.ts\n" },
  }), /must be clean/);
  assert.throws(() => resolveRepositoryState({
    repositoryRoot: "C:/fixture-without-git",
    runCommand: () => ({ status: 128, stdout: "", stderr: "not a git repository" }),
  }), /revision unavailable/);
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
