"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const PACKAGE_PROVENANCE_SCHEMA_VERSION = "smart_kefu_package_provenance_v1";

function normalizeRepositoryRevision(value) {
  const revision = String(value || "").trim().toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)) {
    throw new Error("repository revision unavailable");
  }
  return revision;
}

function defaultRunCommand(command, args, options) {
  return spawnSync(command, args, options);
}

function resolveRepositoryRevision(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "repositoryRevision")) {
    return normalizeRepositoryRevision(options.repositoryRevision);
  }
  const root = path.resolve(options.repositoryRoot || path.resolve(__dirname, "..", ".."));
  const runCommand = options.runCommand || defaultRunCommand;
  const result = runCommand("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 10_000,
  });
  if (result?.error || Number(result?.status) !== 0) throw new Error("repository revision unavailable");
  return normalizeRepositoryRevision(result.stdout);
}

function resolveRepositoryState(options = {}) {
  const root = path.resolve(options.repositoryRoot || path.resolve(__dirname, "..", ".."));
  const runCommand = options.runCommand || defaultRunCommand;
  const revision = resolveRepositoryRevision({
    repositoryRoot: root,
    ...(Object.prototype.hasOwnProperty.call(options, "repositoryRevision")
      ? { repositoryRevision: options.repositoryRevision }
      : { runCommand }),
  });
  if (Object.prototype.hasOwnProperty.call(options, "repositoryClean")) {
    return { revision, clean: options.repositoryClean === true };
  }
  const result = runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 10_000,
  });
  if (result?.error || Number(result?.status) !== 0) throw new Error("repository cleanliness unavailable");
  return { revision, clean: String(result.stdout || "").trim() === "" };
}

function assertCleanRepository(options = {}) {
  const state = resolveRepositoryState(options);
  if (!state.clean) throw new Error("repository worktree must be clean before packaging");
  return state;
}

module.exports = {
  PACKAGE_PROVENANCE_SCHEMA_VERSION,
  assertCleanRepository,
  normalizeRepositoryRevision,
  resolveRepositoryRevision,
  resolveRepositoryState,
};
