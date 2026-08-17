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

function parsePorcelainStatusEntries(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim() || "unknown";
      const rawPath = line.length > 3 ? line.slice(3).trim() : "";
      const normalizedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop().trim() : rawPath;
      return {
        status,
        path: normalizedPath.replace(/\\/g, "/"),
      };
    })
    .filter((entry) => entry.path);
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
    const state = { revision, clean: options.repositoryClean === true };
    if (options.includeStatusEntries) state.statusEntries = parsePorcelainStatusEntries(options.repositoryStatus || "");
    return state;
  }
  const result = runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 10_000,
  });
  if (result?.error || Number(result?.status) !== 0) throw new Error("repository cleanliness unavailable");
  const statusOutput = String(result.stdout || "");
  const state = { revision, clean: statusOutput.trim() === "" };
  if (options.includeStatusEntries) state.statusEntries = parsePorcelainStatusEntries(statusOutput);
  return state;
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
  parsePorcelainStatusEntries,
  resolveRepositoryRevision,
  resolveRepositoryState,
};
