"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SCHEMA_VERSION,
  STATUS,
  collectDatabaseRecoveryRehearsal,
  confirmationPhrase,
  inspectSafety,
  parseArgs,
  parseDatabaseUrl,
  renderMarkdown,
  writeReports,
} = require("../tools/database-recovery-rehearsal");

const TEST_REVISION = "a".repeat(40);

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-db-recovery-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fixture(t) {
  const root = temporaryDirectory(t);
  const bin = path.join(root, "bin");
  const prisma = path.join(root, "node_modules", "prisma", "build", "index.js");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.dirname(prisma), { recursive: true });
  const tools = {
    pgDump: path.join(bin, "pg_dump.exe"),
    pgRestore: path.join(bin, "pg_restore.exe"),
    psql: path.join(bin, "psql.exe"),
    node: path.join(bin, "node.exe"),
    prisma,
  };
  for (const filePath of Object.values(tools)) fs.writeFileSync(filePath, "fixture\n", "utf8");
  fs.mkdirSync(path.join(root, "prisma"), { recursive: true });
  fs.writeFileSync(path.join(root, "prisma", "schema.prisma"), "datasource db { provider = \"postgresql\" url = env(\"DATABASE_URL\") }\n", "utf8");
  return { root, tools };
}

function safeEnvironment() {
  return {
    DATABASE_RECOVERY_SOURCE_URL: "postgresql://smart_app:source-secret@127.0.0.1:5432/smart_kefu_staging",
    DATABASE_RECOVERY_REHEARSAL_URL: "postgresql://recovery_app:target-secret@127.0.0.1:5432/smart_kefu_rehearsal",
  };
}

function successfulRunner(calls, options = {}) {
  return (spec) => {
    calls.push(spec);
    if (spec.stage.startsWith("version.")) {
      const name = spec.stage.slice("version.".length);
      return { status: 0, stdout: `${name} fixture 16.4\n`, stderr: "" };
    }
    if (spec.stage === "backup") {
      const backupFile = spec.args.at(-1);
      fs.writeFileSync(backupFile, "fake custom-format backup bytes\n", "utf8");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (spec.stage === "restore") return { status: options.restoreStatus ?? 0, stdout: "", stderr: options.restoreError || "" };
    if (spec.stage.startsWith("migration.")) return { status: options.migrationStatus ?? 0, stdout: "Database schema is up to date!\n", stderr: "" };
    if (spec.stage === "consistency.source") return { status: 0, stdout: "28,6\n", stderr: "" };
    if (spec.stage === "consistency.target") return { status: 0, stdout: options.targetCounts || "28,6\n", stderr: "" };
    throw new Error(`unexpected stage: ${spec.stage}`);
  };
}

test("database URL policy rejects defaults and unsafe recovery targets", () => {
  assert.equal(parseDatabaseUrl("", "源").status, STATUS.BLOCKED);
  assert.equal(parseDatabaseUrl("postgresql://postgres:postgres@localhost:5432/app", "源").status, STATUS.FAIL);
  assert.equal(parseDatabaseUrl("mysql://app:strong@localhost/app", "源").status, STATUS.FAIL);
  assert.equal(parseDatabaseUrl("postgresql://app:strong@db.acme.cn/app", "源").status, STATUS.BLOCKED);
  assert.equal(parseDatabaseUrl("postgresql://app:strong@db.acme.cn/app?sslmode=verify-full", "源").status, STATUS.PASS);

  const same = inspectSafety({
    DATABASE_RECOVERY_SOURCE_URL: "postgresql://app:source@127.0.0.1:5432/smart_kefu_rehearsal",
    DATABASE_RECOVERY_REHEARSAL_URL: "postgresql://other:target@127.0.0.1:5432/smart_kefu_rehearsal",
  }, confirmationPhrase("smart_kefu_rehearsal"), true);
  assert.equal(same.results.find((item) => item.id === "safety.distinct").status, STATUS.FAIL);

  const production = inspectSafety({
    DATABASE_RECOVERY_SOURCE_URL: safeEnvironment().DATABASE_RECOVERY_SOURCE_URL,
    DATABASE_RECOVERY_REHEARSAL_URL: "postgresql://app:strong@db-prod01.internal:5432/smart_kefu_rehearsal?sslmode=require",
  }, confirmationPhrase("smart_kefu_rehearsal"), true);
  assert.equal(production.results.find((item) => item.id === "safety.isolated_target").status, STATUS.FAIL);
});

test("default plan mode is offline and runs no commands", async (t) => {
  const { root, tools } = fixture(t);
  let commandCount = 0;
  const report = await collectDatabaseRecoveryRehearsal({
    desktopRoot: root,
    reportRoot: path.join(root, "reports"),
    runId: "plan-fixture",
    env: safeEnvironment(),
    tools,
    runCommand: () => { commandCount += 1; throw new Error("must not run"); },
  });
  assert.equal(commandCount, 0);
  assert.equal(report.mode, "plan");
  assert.equal(report.status, STATUS.BLOCKED);
  assert.equal(report.results.find((item) => item.id === "rehearsal.execution").evidence.commandsExecuted, 0);
});

test("execute blocks without installed tools and does not touch a database", async (t) => {
  const root = temporaryDirectory(t);
  let commandCount = 0;
  const report = await collectDatabaseRecoveryRehearsal({
    desktopRoot: root,
    reportRoot: path.join(root, "reports"),
    runId: "missing-tools",
    execute: true,
    confirmation: confirmationPhrase("smart_kefu_rehearsal"),
    env: safeEnvironment(),
    tools: { pgDump: "missing", pgRestore: "missing", psql: "missing", node: "missing", prisma: "missing" },
    runCommand: () => { commandCount += 1; throw new Error("must not run"); },
  });
  assert.equal(commandCount, 0);
  assert.equal(report.status, STATUS.BLOCKED);
  assert.equal(report.results.find((item) => item.id === "tools.inventory").status, STATUS.BLOCKED);
});

test("execute requires a confirmation phrase bound to the target name", async (t) => {
  const { root, tools } = fixture(t);
  let commandCount = 0;
  const report = await collectDatabaseRecoveryRehearsal({
    desktopRoot: root,
    runId: "wrong-confirmation",
    execute: true,
    confirmation: "RESTORE ISOLATED REHEARSAL DATABASE: some_other_database",
    env: safeEnvironment(),
    tools,
    runCommand: () => { commandCount += 1; throw new Error("must not run"); },
  });
  assert.equal(commandCount, 0);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "safety.confirmation").status, STATUS.FAIL);
});

test("successful rehearsal records only redacted versions, hash, migration and counts", async (t) => {
  const { root, tools } = fixture(t);
  const calls = [];
  const runDirectory = path.join(root, "reports", "passing-rehearsal");
  const env = safeEnvironment();
  const report = await collectDatabaseRecoveryRehearsal({
    desktopRoot: root,
    reportRoot: path.join(root, "reports"),
    runDirectory,
    runId: "passing-rehearsal",
    generatedAt: "2026-07-19T00:00:00.000Z",
    repositoryRevision: TEST_REVISION,
    execute: true,
    confirmation: confirmationPhrase("smart_kefu_rehearsal"),
    env,
    tools,
    runCommand: successfulRunner(calls),
  });
  assert.equal(report.status, STATUS.PASS);
  assert.equal(SCHEMA_VERSION, "smart_kefu_database_recovery_rehearsal_v2");
  assert.equal(report.repositoryRevision, TEST_REVISION);
  assert.match(renderMarkdown(report), new RegExp(TEST_REVISION));
  assert.equal(calls.length, 10);
  assert.deepEqual(calls.map((item) => item.stage), [
    "version.pg_dump", "version.pg_restore", "version.psql", "version.prisma",
    "backup", "restore", "migration.source", "migration.target", "consistency.source", "consistency.target",
  ].filter(() => true));
  assert.equal(fs.existsSync(path.join(runDirectory, "rehearsal.dump")), false);
  assert.match(report.results.find((item) => item.id === "rehearsal.backup").evidence.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.results.find((item) => item.id === "evidence.consistency").evidence.source, { publicTables: 28, appliedMigrations: 6 });
  const serialized = JSON.stringify(report);
  for (const secret of [env.DATABASE_RECOVERY_SOURCE_URL, env.DATABASE_RECOVERY_REHEARSAL_URL, "smart_app", "recovery_app", "source-secret", "target-secret"]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(calls.some((item) => item.args.some((arg) => String(arg).includes("postgresql://"))), false);
  assert.equal(calls.find((item) => item.stage === "restore").args.at(-1), path.join(runDirectory, "rehearsal.dump"));
});

test("restore command failures are FAIL and temporary backup is removed", async (t) => {
  const { root, tools } = fixture(t);
  const calls = [];
  const runDirectory = path.join(root, "reports", "failed-restore");
  const report = await collectDatabaseRecoveryRehearsal({
    desktopRoot: root,
    runDirectory,
    runId: "failed-restore",
    execute: true,
    confirmation: confirmationPhrase("smart_kefu_rehearsal"),
    env: safeEnvironment(),
    tools,
    runCommand: successfulRunner(calls, { restoreStatus: 1, restoreError: "target-secret should never enter report" }),
  });
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "rehearsal.restore").status, STATUS.FAIL);
  assert.equal(JSON.stringify(report).includes("target-secret"), false);
  assert.equal(fs.existsSync(path.join(runDirectory, "rehearsal.dump")), false);
});

test("a mismatch in minimal structure evidence fails closed", async (t) => {
  const { root, tools } = fixture(t);
  const calls = [];
  const report = await collectDatabaseRecoveryRehearsal({
    desktopRoot: root,
    runId: "mismatch",
    execute: true,
    confirmation: confirmationPhrase("smart_kefu_rehearsal"),
    env: safeEnvironment(),
    tools,
    runCommand: successfulRunner(calls, { targetCounts: "27,6\n" }),
  });
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "evidence.consistency").evidence.consistent, false);
});

test("reports are Chinese JSON/Markdown and contain no retained data artifact", async (t) => {
  const { root, tools } = fixture(t);
  const report = await collectDatabaseRecoveryRehearsal({
    desktopRoot: root,
    runId: "report-fixture",
    env: safeEnvironment(),
    tools,
  });
  const outputRoot = path.join(root, "written-reports");
  const artifacts = writeReports(report, outputRoot);
  assert.equal(fs.existsSync(path.join(artifacts.runDirectory, "report.json")), true);
  assert.match(fs.readFileSync(artifacts.latestMarkdown, "utf8"), /PostgreSQL 备份与恢复演练证据/);
  assert.match(renderMarkdown(report), /未记录连接 URL/);
  assert.equal(fs.existsSync(path.join(artifacts.runDirectory, "rehearsal.dump")), false);
});

test("CLI defaults to plan and rejects unrecognized mutation flags", () => {
  assert.deepEqual(parseArgs([]), { execute: false, confirmation: "", help: false });
  assert.deepEqual(parseArgs(["--execute", "--confirm", confirmationPhrase("smart_kefu_rehearsal")]), {
    execute: true,
    confirmation: confirmationPhrase("smart_kefu_rehearsal"),
    help: false,
  });
  assert.throws(() => parseArgs(["--confirm"]), /requires the exact confirmation phrase/);
  assert.throws(() => parseArgs(["--drop-production"]), /unknown argument/);
});

test("package scripts keep plan as the default and documentation exposes the guarded execute path", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
  const runbook = fs.readFileSync(path.resolve(__dirname, "..", "docs", "DATABASE_RECOVERY_REHEARSAL.md"), "utf8");
  const checklist = fs.readFileSync(path.resolve(__dirname, "..", "..", "docs", "PRODUCTION_RELEASE_CHECKLIST.md"), "utf8");
  assert.match(packageJson.scripts["database:recovery:plan"], /database-recovery-rehearsal\.js$/);
  assert.doesNotMatch(packageJson.scripts["database:recovery:plan"], /--execute/);
  assert.match(packageJson.scripts["database:recovery:execute"], /--execute$/);
  assert.match(runbook, /RESTORE ISOLATED REHEARSAL DATABASE/);
  assert.match(checklist, /database:recovery:execute/);
});
