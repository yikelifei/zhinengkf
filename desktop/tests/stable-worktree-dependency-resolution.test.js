"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { resolveWorktreeNodeModules } = require("../tools/resolve-worktree-node-modules");

test("a nested worktree resolves dependencies from the owning repository desktop", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stable-worktree-deps-"));
  try {
    const dependencyRoot = path.join(tempRoot, "desktop", "node_modules");
    const worktreeDesktop = path.join(tempRoot, ".runtime", "ui", "branch", "desktop");
    fs.mkdirSync(path.join(dependencyRoot, "next"), { recursive: true });
    fs.mkdirSync(path.join(dependencyRoot, "@nestjs", "core"), { recursive: true });
    fs.mkdirSync(worktreeDesktop, { recursive: true });
    fs.writeFileSync(path.join(dependencyRoot, "next", "package.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(dependencyRoot, "@nestjs", "core", "package.json"), "{}\n", "utf8");

    assert.equal(resolveWorktreeNodeModules(worktreeDesktop), dependencyRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("an incomplete node_modules directory is not accepted", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stable-worktree-deps-"));
  try {
    fs.mkdirSync(path.join(tempRoot, "node_modules", "next"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "node_modules", "next", "package.json"), "{}\n", "utf8");
    assert.equal(resolveWorktreeNodeModules(tempRoot), "");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
