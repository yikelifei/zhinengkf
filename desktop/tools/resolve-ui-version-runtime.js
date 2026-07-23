"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const profile = String(process.argv[2] || "").trim().toLowerCase();

if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(profile)) {
  console.error("A safe UI version profile is required");
  process.exit(2);
}

const result = spawnSync(
  "git",
  ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  { cwd: desktopRoot, encoding: "utf8", windowsHide: true },
);

if (result.status !== 0 || !String(result.stdout || "").trim()) {
  console.error("Unable to resolve the shared repository directory");
  process.exit(1);
}

const rawCommonDir = String(result.stdout).trim();
const commonDir = path.isAbsolute(rawCommonDir)
  ? path.resolve(rawCommonDir)
  : path.resolve(desktopRoot, rawCommonDir);
const repositoryRoot = path.dirname(commonDir);

process.stdout.write(path.join(repositoryRoot, ".runtime", "ui-versions", `runtime-${profile}`));
