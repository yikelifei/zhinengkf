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
  parseVersion,
  renderMarkdownReport,
  scanSecretEntries,
} = require("../tools/production-release-gate");

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
