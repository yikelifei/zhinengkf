"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

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

module.exports = {
  normalizeRepositoryRevision,
  resolveRepositoryRevision,
};
