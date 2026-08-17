"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  PACKAGE_PROVENANCE_SCHEMA_VERSION,
  assertCleanRepository,
} = require("./repository-provenance");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "release", "windows");
const packageProvenanceFile = path.join(root, ".package-provenance.json");
const args = new Set(process.argv.slice(2));
const directoryOnly = args.has("--dir");
const signed = args.has("--signed");

main();

function main() {
  if (process.platform !== "win32") fail("Windows packages must be built on Windows.");
  if (signed && !hasSigningIdentity()) {
    fail("Signed packaging requires CSC_LINK or WIN_CSC_SUBJECT_NAME; refusing to create an unsigned release artifact.");
  }
  const initialRepositoryState = requireCleanRepository();

  cleanOutputDirectory();
  runNpm(["run", "prisma:generate"]);
  runNpm(["run", "build:api"]);
  runNpm(["run", "build:web"], {
    WEB_PORT: process.env.PACKAGE_BUILD_WEB_PORT || "31901",
    ALLOW_WEB_BUILD_WITH_FRESH_HEARTBEAT: "1",
    FORCE_WEB_CLEAN_BUILD: "1",
  });
  runNode(["tools/prepare-packaged-runtime-dependencies.js"]);
  assertBuildInputs();
  const packageRepositoryState = requireCleanRepository();
  if (packageRepositoryState.revision !== initialRepositoryState.revision) {
    fail("Repository HEAD changed while preparing the package; restart from a stable clean revision.");
  }
  writePackageProvenance(packageRepositoryState);
  process.once("exit", removePackageProvenance);

  try {
    const builderArgs = ["exec", "--", "electron-builder", "--win"];
    if (!directoryOnly) builderArgs.push("nsis");
    builderArgs.push("--x64", "--publish", "never");
    if (directoryOnly) builderArgs.push("--dir");
    if (process.env.WIN_CSC_SUBJECT_NAME) {
      builderArgs.push(`--config.win.certificateSubjectName=${process.env.WIN_CSC_SUBJECT_NAME}`);
    }
    runNpm(builderArgs, {
      ELECTRON_BUILDER_CACHE: path.join(root, ".package-cache", "electron-builder"),
      ...(signed ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: "false" }),
    });

    runNode(["tools/smoke-packaged-api.js"]);
    runNode([
      "tools/verify-windows-package.js",
      ...(signed ? ["--require-signed"] : ["--expect-unsigned"]),
      ...(directoryOnly ? ["--dir-only"] : []),
    ]);
  } finally {
    removePackageProvenance();
  }
}

function requireCleanRepository() {
  try {
    return assertCleanRepository({ repositoryRoot: path.resolve(root, "..") });
  } catch {
    fail("Windows packaging requires a clean Git worktree and a readable complete HEAD revision.");
  }
}

function writePackageProvenance(repositoryState) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const manifest = {
    schemaVersion: PACKAGE_PROVENANCE_SCHEMA_VERSION,
    repositoryRevision: repositoryState.revision,
    repositoryClean: repositoryState.clean === true,
    packageVersion: packageJson.version,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(packageProvenanceFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function removePackageProvenance() {
  fs.rmSync(packageProvenanceFile, { force: true });
}

function hasSigningIdentity() {
  return Boolean(String(process.env.CSC_LINK || "").trim() || String(process.env.WIN_CSC_SUBJECT_NAME || "").trim());
}

function cleanOutputDirectory() {
  const resolved = path.resolve(outputDir);
  if (path.dirname(resolved) !== path.resolve(root, "release")) fail(`Refusing to clean unexpected output: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function assertBuildInputs() {
  const required = [
    path.join(root, "dist", "apps", "api", "main.js"),
    path.join(root, "apps", "web", ".next", "standalone", "apps", "web", "server.js"),
    path.join(root, ".package-runtime", "node_modules", "tslib", "tslib.js"),
    path.join(root, ".package-runtime", "node_modules", "next", "dist", "server", "next.js"),
    path.join(root, "node_modules", ".prisma", "client", "default.js"),
    path.join(root, "packages", "rules", "index.js"),
    path.join(root, "node_modules", "sharp", "dist", "index.cjs"),
    path.join(root, "node_modules", "@img", "sharp-win32-x64", "lib", "sharp-win32-x64-0.35.3.node"),
    path.resolve(root, "..", "config", "settings.yaml"),
    path.join(root, "tools", "wechat-window-observer.js"),
  ];
  const missing = required.filter((item) => !fs.existsSync(item));
  if (missing.length) fail(`Packaging inputs are missing:\n${missing.join("\n")}`);
}

function runNpm(commandArgs, extraEnv = {}) {
  if (process.platform === "win32") {
    const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (!fs.existsSync(npmCli)) fail(`npm CLI was not found: ${npmCli}`);
    run(process.execPath, [npmCli, ...commandArgs], extraEnv);
    return;
  }
  run("npm", commandArgs, extraEnv);
}

function runNode(commandArgs) {
  run(process.execPath, commandArgs);
}

function run(command, commandArgs, extraEnv = {}) {
  console.log(`[package] ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status || 1);
}

function fail(message) {
  console.error(`[package] ${message}`);
  process.exit(1);
}
