"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  STATUS,
  checkDependencyLock,
  checkMigrationInventory,
  compareVersions,
  computeOverallStatus,
  createReport,
  isLinkedWorktreeLayout,
  parseGateOptions,
  parseVersion,
  resolveCommandFailureStatus,
  renderMarkdownReport,
  scanSecretEntries,
} = require("../tools/production-release-gate");
const { classifyPortOwners } = require("../tools/build-web");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-release-gate-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("version comparison accepts supported Node and Python versions", () => {
  assert.deepEqual(parseVersion("Python 3.14.4"), [3, 14, 4]);
  assert.equal(compareVersions("20.0.0", "20.0.0"), 0);
  assert.equal(compareVersions("24.18.0", "20.0.0"), 1);
  assert.equal(compareVersions("3.9.18", "3.10.0"), -1);
});

test("overall status uses FAIL before BLOCKED before PASS", () => {
  assert.equal(computeOverallStatus([{ status: STATUS.PASS }]), STATUS.PASS);
  assert.equal(computeOverallStatus([{ status: STATUS.PASS }, { status: STATUS.BLOCKED }]), STATUS.BLOCKED);
  assert.equal(
    computeOverallStatus([{ status: STATUS.BLOCKED }, { status: STATUS.FAIL }, { status: STATUS.PASS }]),
    STATUS.FAIL,
  );
});

test("isolated release gate defaults to distinct valid ports and allows explicit overrides", () => {
  assert.deepEqual(parseGateOptions([]), { mode: "default", ports: null, ownerCheckWebPort: null });
  assert.deepEqual(parseGateOptions(["--isolated-worktree"], {}), {
    mode: "isolated-worktree",
    ports: { web: 31911, api: 32911, mock: 37911 },
    ownerCheckWebPort: 3100,
  });
  assert.deepEqual(
    parseGateOptions(["--isolated-worktree"], {
      RELEASE_GATE_ISOLATED_WEB_PORT: "41911",
      RELEASE_GATE_ISOLATED_API_PORT: "42911",
      RELEASE_GATE_ISOLATED_MOCK_PORT: "47911",
      WEB_PORT: "41000",
    }),
    {
      mode: "isolated-worktree",
      ports: { web: 41911, api: 42911, mock: 47911 },
      ownerCheckWebPort: 41000,
    },
  );
  assert.throws(
    () => parseGateOptions(["--isolated-worktree"], { RELEASE_GATE_ISOLATED_WEB_PORT: "0" }),
    /valid TCP port/i,
  );
  assert.throws(
    () =>
      parseGateOptions(["--isolated-worktree"], {
        RELEASE_GATE_ISOLATED_WEB_PORT: "31911",
        RELEASE_GATE_ISOLATED_API_PORT: "31911",
      }),
    /distinct/i,
  );
  assert.throws(() => parseGateOptions(["--unknown"]), /unsupported argument/i);
});

test("isolated release gate accepts only linked worktree git layouts", () => {
  assert.equal(isLinkedWorktreeLayout("D:/repo/.git/worktrees/wave9", "D:/repo/.git"), true);
  assert.equal(isLinkedWorktreeLayout("D:/repo/.git", "D:/repo/.git"), false);
  assert.equal(isLinkedWorktreeLayout("", "D:/repo/.git"), false);
  assert.equal(isLinkedWorktreeLayout("D:/other/git-dir", "D:/repo/.git"), false);
});

test("web build foreign-owner override fails closed for same-root and unknown owners", () => {
  const currentRoot = "D:/repo/.runtime/wave9/desktop";
  assert.deepEqual(
    classifyPortOwners([], new Map(), currentRoot),
    { status: "free", ownerPids: [], foreignPids: [], sameRootPids: [], unknownPids: [] },
  );
  assert.deepEqual(
    classifyPortOwners(
      ["101"],
      new Map([["101", 'node "D:/repo/desktop/.runtime-stable/web-standalone-server.js"']]),
      currentRoot,
    ),
    { status: "foreign", ownerPids: ["101"], foreignPids: ["101"], sameRootPids: [], unknownPids: [] },
  );
  assert.deepEqual(
    classifyPortOwners(
      ["202"],
      new Map([["202", 'node "D:/repo/.runtime/wave9/desktop/.runtime/web-standalone-server.js"']]),
      currentRoot,
    ),
    { status: "same-root", ownerPids: ["202"], foreignPids: [], sameRootPids: ["202"], unknownPids: [] },
  );
  assert.deepEqual(
    classifyPortOwners(["303"], new Map([["303", ""]]), currentRoot),
    { status: "unknown", ownerPids: ["303"], foreignPids: [], sameRootPids: [], unknownPids: ["303"] },
  );
});

test("isolated owner safety exit is BLOCKED while compile failures remain FAIL", () => {
  const isolatedMapping = { 2: STATUS.BLOCKED };
  assert.equal(resolveCommandFailureStatus(2, STATUS.FAIL, isolatedMapping), STATUS.BLOCKED);
  assert.equal(resolveCommandFailureStatus(1, STATUS.FAIL, isolatedMapping), STATUS.FAIL);
  assert.equal(resolveCommandFailureStatus(null, STATUS.FAIL, isolatedMapping), STATUS.FAIL);
});

test("release report discloses default or isolated-worktree execution mode and ports", () => {
  const defaultReport = createReport([{ status: STATUS.PASS }], { mode: "default", ports: null });
  assert.equal(defaultReport.mode, "default");
  assert.equal(defaultReport.ports, null);

  const isolatedReport = createReport([{ status: STATUS.BLOCKED }], {
    mode: "isolated-worktree",
    ports: { web: 31911, api: 32911, mock: 37911 },
    ownerCheckWebPort: 41000,
  });
  assert.equal(isolatedReport.mode, "isolated-worktree");
  assert.deepEqual(isolatedReport.ports, { web: 31911, api: 32911, mock: 37911 });
  assert.match(renderMarkdownReport(isolatedReport), /运行模式：`isolated-worktree`/);
  assert.match(renderMarkdownReport(isolatedReport), /Web=31911, API=32911, Mock=37911/);
  assert.match(renderMarkdownReport(isolatedReport), /owner 安全检查端口：41000/);
});

test("dependency lock check detects drift and accepts synchronized manifests", (t) => {
  const root = temporaryDirectory(t);
  const packageFile = path.join(root, "package.json");
  const lockFile = path.join(root, "package-lock.json");
  const requirementsFile = path.join(root, "requirements.txt");
  const devRequirementsFile = path.join(root, "requirements-dev.txt");
  const manifest = {
    name: "fixture",
    version: "1.0.0",
    engines: { node: ">=20.0.0" },
    dependencies: { alpha: "1.0.0" },
    devDependencies: { beta: "2.0.0" },
  };
  fs.writeFileSync(packageFile, JSON.stringify(manifest), "utf8");
  fs.writeFileSync(
    lockFile,
    JSON.stringify({ lockfileVersion: 3, packages: { "": { ...manifest, devDependencies: { beta: "2.1.0" } } } }),
    "utf8",
  );
  fs.writeFileSync(requirementsFile, "requests>=2.31.0\n", "utf8");
  fs.writeFileSync(devRequirementsFile, "-r requirements.txt\npytest>=8.0.0\n", "utf8");

  const options = { packageFile, lockFile, requirementsFile, devRequirementsFile };
  assert.equal(checkDependencyLock(options).status, STATUS.FAIL);
  fs.writeFileSync(lockFile, JSON.stringify({ lockfileVersion: 3, packages: { "": manifest } }), "utf8");
  assert.equal(checkDependencyLock(options).status, STATUS.PASS);
});

test("migration inventory rejects missing SQL and accepts ordered non-empty files", (t) => {
  const root = temporaryDirectory(t);
  const migration = path.join(root, "20260701000000_init");
  fs.mkdirSync(migration, { recursive: true });
  assert.equal(checkMigrationInventory({ migrationsRoot: root }).status, STATUS.FAIL);
  fs.writeFileSync(path.join(migration, "migration.sql"), 'CREATE TABLE "Fixture" ("id" TEXT NOT NULL);\n', "utf8");
  assert.equal(checkMigrationInventory({ migrationsRoot: root }).status, STATUS.PASS);
});

test("secret scan catches high-confidence credentials without echoing their value", () => {
  const token = ["sk", "proj", "A".repeat(32)].join("-");
  const findings = scanSecretEntries([
    {
      relativePath: "desktop/.env.example",
      content: "OPENAI_API_KEY=replace-with-your-key\nCUSTOM_API_KEY=sk-your-custom-api-key-here\n",
    },
    { relativePath: "desktop/src/config.js", content: `const api_key = "${token}";\n` },
    { relativePath: "docs/example.md", content: 'client_secret = "replace-with-production-secret"\n' },
  ]);
  assert.equal(findings.length, 2);
  assert.equal(findings.every((finding) => !JSON.stringify(finding).includes(token)), true);
  assert.deepEqual(
    findings.map((finding) => finding.rule).sort(),
    ["hardcoded-sensitive-assignment", "openai-token"],
  );
});

test("secret scan blocks committed secret files and private keys", () => {
  const privateKeyHeader = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
  const findings = scanSecretEntries([
    { relativePath: ".env", content: "SAFE=false\n" },
    { relativePath: "certs/release.pem", content: privateKeyHeader },
  ]);
  assert.deepEqual(
    findings.map((finding) => finding.rule),
    ["forbidden-secret-file", "forbidden-secret-file"],
  );
});

test("markdown report renders PASS BLOCKED FAIL semantics", () => {
  const markdown = renderMarkdownReport({
    status: STATUS.BLOCKED,
    generatedAt: "2026-07-13T00:00:00.000Z",
    results: [
      { status: STATUS.PASS, title: "build", summary: "ok" },
      { status: STATUS.BLOCKED, title: "database", summary: "external" },
      { status: STATUS.FAIL, title: "security", summary: "failed", details: ["fixture.js:1"] },
    ],
  });
  assert.match(markdown, /总状态：\*\*BLOCKED\*\*/);
  assert.match(markdown, /`PASS`/);
  assert.match(markdown, /`BLOCKED`/);
  assert.match(markdown, /`FAIL`/);
  assert.match(markdown, /fixture\.js:1/);
});

test("Python task runner prefers project virtual environments in linked worktrees", () => {
  const runner = fs.readFileSync(path.resolve(__dirname, "..", "..", "tools", "_run_python_task.bat"), "utf8");
  const localVenv = runner.indexOf('if exist ".venv\\Scripts\\python.exe"');
  const bundledRuntime = runner.indexOf("codex-primary-runtime");

  assert.notEqual(localVenv, -1);
  assert.notEqual(bundledRuntime, -1);
  assert.ok(localVenv < bundledRuntime);
  assert.match(runner, /git rev-parse --git-common-dir/);
  assert.match(runner, /LINKED_REPO_PYTHON=.*\\.venv\\Scripts\\python\.exe/);
  assert.match(runner, /SMART_KEFU_TASK_TEMP=.*\\desktop\\.runtime\\python-temp/);
});
