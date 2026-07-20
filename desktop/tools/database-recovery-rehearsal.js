"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { resolveRepositoryRevision } = require("./repository-provenance");

const STATUS = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", FAIL: "FAIL" });
const STATUS_RANK = Object.freeze({ PASS: 0, BLOCKED: 1, FAIL: 2 });
const EXIT_CODE = Object.freeze({ PASS: 0, BLOCKED: 2, FAIL: 1 });
const SCHEMA_VERSION = "smart_kefu_database_recovery_rehearsal_v2";
const CONFIRMATION_PREFIX = "RESTORE ISOLATED REHEARSAL DATABASE:";
const SAFE_TARGET_PATTERN = /(?:^|[_-])(?:rehearsal|restore[_-]?drill|recovery[_-]?drill|sandbox)(?:\d+)?(?:$|[_-])/i;
const PRODUCTION_PATTERN = /(?:^|[.\-_])(?:prod(?:uction)?|live)(?:\d+)?(?:$|[.\-_])/i;
const COUNT_SQL = [
  "SELECT",
  "  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')::text",
  "  || ',' ||",
  "  (SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text;",
].join(" ");

const desktopRoot = path.resolve(__dirname, "..");
const defaultReportRoot = path.join(desktopRoot, ".runtime", "database-recovery-rehearsal");

function overallStatus(results) {
  return results.reduce(
    (current, item) => STATUS_RANK[item.status] > STATUS_RANK[current] ? item.status : current,
    STATUS.PASS,
  );
}

function result(id, title, status, summary, evidence = {}) {
  return { id, title, status, summary, evidence };
}

function configured(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/(?:replace|placeholder|changeme|example|dummy|your[-_])/i.test(text);
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function hostClass(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackHost(host)) return "loopback";
  if (host.endsWith(".local") || !host.includes(".")) return "private";
  if (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return "private";
  return "public";
}

function parseDatabaseUrl(value, role) {
  const text = String(value || "").trim();
  if (!configured(text)) {
    return { ok: false, status: STATUS.BLOCKED, summary: `${role} PostgreSQL 连接未配置。` };
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, status: STATUS.FAIL, summary: `${role}连接不是有效 URL。` };
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return { ok: false, status: STATUS.FAIL, summary: `${role}连接必须使用 PostgreSQL。` };
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  const username = decodeURIComponent(parsed.username || "");
  const password = decodeURIComponent(parsed.password || "");
  if (!parsed.hostname || !database || !username || !password) {
    return { ok: false, status: STATUS.BLOCKED, summary: `${role}连接缺少主机、数据库、应用用户或密码。` };
  }
  const admin = /^(?:postgres|admin|root)$/i.test(username);
  const weakPassword = /^(?:postgres|admin|root|password|123456|12345678)$/i.test(password);
  if (isLoopbackHost(parsed.hostname) && admin && weakPassword) {
    return { ok: false, status: STATUS.FAIL, summary: `${role}连接使用 localhost 默认管理员弱口令。` };
  }
  const sslmode = String(parsed.searchParams.get("sslmode") || "").toLowerCase();
  if (!isLoopbackHost(parsed.hostname) && !["require", "verify-ca", "verify-full"].includes(sslmode)) {
    return { ok: false, status: STATUS.BLOCKED, summary: `${role}远程连接缺少 sslmode=require 或更强配置。` };
  }
  const port = parsed.port || "5432";
  return {
    ok: true,
    status: STATUS.PASS,
    summary: `${role}连接结构通过安全检查。`,
    secretUrl: text,
    connection: {
      host: parsed.hostname,
      port,
      database,
      username,
      password,
      sslmode,
    },
    identity: `${parsed.hostname.toLowerCase()}:${port}/${database.toLowerCase()}`,
    evidence: { hostClass: hostClass(parsed.hostname), tlsModeConfigured: Boolean(sslmode) },
  };
}

function confirmationPhrase(databaseName) {
  return `${CONFIRMATION_PREFIX} ${databaseName}`;
}

function inspectSafety(env, confirmation, execute) {
  const source = parseDatabaseUrl(env.DATABASE_RECOVERY_SOURCE_URL || env.DATABASE_URL, "源");
  const target = parseDatabaseUrl(env.DATABASE_RECOVERY_REHEARSAL_URL, "演练目标");
  const results = [
    result("safety.source", "源数据库安全边界", source.status, source.summary, source.evidence || {}),
    result("safety.target", "演练目标安全边界", target.status, target.summary, target.evidence || {}),
  ];
  if (!source.ok || !target.ok) return { source, target, results, ready: false };

  if (source.identity === target.identity) {
    results.push(result("safety.distinct", "源与目标隔离", STATUS.FAIL, "源数据库与恢复目标相同，已拒绝执行。"));
  } else {
    results.push(result("safety.distinct", "源与目标隔离", STATUS.PASS, "源数据库与演练目标身份不同。", { identitiesDifferent: true }));
  }

  const targetLabel = `${target.connection.host}/${target.connection.database}`;
  const isolated = SAFE_TARGET_PATTERN.test(target.connection.database) && !PRODUCTION_PATTERN.test(targetLabel);
  results.push(
    isolated
      ? result("safety.isolated_target", "隔离演练库命名", STATUS.PASS, "目标名称明确标识为隔离恢复演练库。", { isolatedRehearsalTarget: true })
      : result("safety.isolated_target", "隔离演练库命名", STATUS.FAIL, "目标必须包含 rehearsal、restore-drill、recovery-drill 或 sandbox，且不得包含 prod、production、live。"),
  );

  const expected = confirmationPhrase(target.connection.database);
  if (!execute) {
    results.push(result("safety.confirmation", "破坏性操作确认", STATUS.BLOCKED, "计划模式不执行恢复；执行时必须提供绑定目标库名的确认短语。", { confirmationRequired: true }));
  } else if (confirmation !== expected) {
    results.push(result("safety.confirmation", "破坏性操作确认", STATUS.FAIL, "确认短语缺失或与隔离演练目标不匹配。", { confirmationRequired: true }));
  } else {
    results.push(result("safety.confirmation", "破坏性操作确认", STATUS.PASS, "确认短语已绑定隔离演练目标。", { confirmationMatched: true }));
  }
  return { source, target, results, ready: results.every((item) => item.status === STATUS.PASS) };
}

function executableCandidates(name, env) {
  const extensions = process.platform === "win32" ? String(env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  const names = path.extname(name) ? [name] : extensions.map((extension) => `${name}${extension.toLowerCase()}`);
  return String(env.PATH || "").split(path.delimiter).filter(Boolean).flatMap((directory) => names.map((candidate) => path.join(directory, candidate)));
}

function findExecutable(name, env = process.env) {
  return executableCandidates(name, env).find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || "";
}

function resolveTools(options = {}) {
  const root = options.desktopRoot || desktopRoot;
  const env = options.env || process.env;
  const explicit = options.tools || {};
  const prisma = explicit.prisma || path.join(root, "node_modules", "prisma", "build", "index.js");
  return {
    pgDump: explicit.pgDump || env.PG_DUMP_BIN || findExecutable("pg_dump", env),
    pgRestore: explicit.pgRestore || env.PG_RESTORE_BIN || findExecutable("pg_restore", env),
    psql: explicit.psql || env.PSQL_BIN || findExecutable("psql", env),
    node: explicit.node || process.execPath,
    prisma,
  };
}

function toolInventory(tools) {
  return ["pgDump", "pgRestore", "psql", "node", "prisma"].map((name) => {
    const toolPath = tools[name];
    let exists = false;
    try { exists = Boolean(toolPath) && fs.statSync(toolPath).isFile(); } catch { exists = false; }
    return { name, exists };
  });
}

function safeSpawn(spec) {
  return spawnSync(spec.file, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: spec.timeoutMs || 120_000,
  });
}

function postgresEnvironment(baseEnv, connection) {
  const env = {
    ...baseEnv,
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGDATABASE: connection.database,
    PGUSER: connection.username,
    PGPASSWORD: connection.password,
  };
  if (connection.sslmode) env.PGSSLMODE = connection.sslmode;
  return env;
}

function commandSucceeded(output) {
  return output && output.status === 0 && !output.error;
}

function safeVersion(output) {
  if (!commandSucceeded(output)) return "";
  const line = String(output.stdout || output.stderr || "").split(/\r?\n/).map((item) => item.trim()).find(Boolean) || "";
  return line.replace(/(?:postgres(?:ql)?:\/\/|password=)\S+/gi, "[redacted]").slice(0, 160);
}

function parseCounts(output) {
  if (!commandSucceeded(output)) return null;
  const match = String(output.stdout || "").match(/(?:^|\n)\s*(\d+)\s*,\s*(\d+)\s*(?:\r?\n|$)/);
  if (!match) return null;
  return { publicTables: Number(match[1]), appliedMigrations: Number(match[2]) };
}

function runSpec(runCommand, stage, file, args, cwd, env) {
  return runCommand({ stage, file, args, cwd, env, timeoutMs: 120_000 });
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function summarize(results) {
  return {
    pass: results.filter((item) => item.status === STATUS.PASS).length,
    blocked: results.filter((item) => item.status === STATUS.BLOCKED).length,
    fail: results.filter((item) => item.status === STATUS.FAIL).length,
  };
}

function baseReport(options, results, toolEvidence) {
  const status = overallStatus(results);
  return {
    schemaVersion: SCHEMA_VERSION,
    repositoryRevision: options.repositoryRevision,
    generatedAt: options.generatedAt || new Date().toISOString(),
    runId: options.runId,
    mode: options.execute ? "execute" : "plan",
    status,
    summary: summarize(results),
    safety: {
      sourceUrlRecorded: false,
      targetUrlRecorded: false,
      passwordRecorded: false,
      dataContentRecorded: false,
      backupArtifactRetained: false,
      restoreTargetMustBeIsolated: true,
    },
    tools: toolEvidence,
    results,
  };
}

async function collectDatabaseRecoveryRehearsal(options = {}) {
  const root = options.desktopRoot || desktopRoot;
  const env = options.env || process.env;
  const repositoryRevision = resolveRepositoryRevision({
    repositoryRoot: options.repositoryRoot || path.resolve(desktopRoot, ".."),
    ...(options.repositoryRevision !== undefined ? { repositoryRevision: options.repositoryRevision } : {}),
    ...(options.runGitCommand ? { runCommand: options.runGitCommand } : {}),
  });
  const execute = options.execute === true;
  const runId = options.runId || new Date().toISOString().replace(/[:.]/g, "-");
  const reportRoot = options.reportRoot || path.join(root, ".runtime", "database-recovery-rehearsal");
  const runDirectory = options.runDirectory || path.join(reportRoot, runId);
  const backupFile = path.join(runDirectory, "rehearsal.dump");
  const runCommand = options.runCommand || safeSpawn;
  const tools = resolveTools({ desktopRoot: root, env, tools: options.tools });
  const inventory = toolInventory(tools);
  const safety = inspectSafety(env, options.confirmation || "", execute);
  const results = [...safety.results];
  const missing = inventory.filter((item) => !item.exists).map((item) => item.name);
  results.push(
    missing.length
      ? result("tools.inventory", "恢复工具链", STATUS.BLOCKED, "缺少已安装的 PostgreSQL 或仓库锁定 Prisma 工具。", { required: inventory, missing })
      : result("tools.inventory", "恢复工具链", STATUS.PASS, "pg_dump、pg_restore、psql 与仓库锁定 Prisma 均可用。", { required: inventory, missing: [] }),
  );
  if (!execute) {
    results.push(result("rehearsal.execution", "备份恢复演练", STATUS.BLOCKED, "当前为离线计划模式；未执行任何外部命令或数据库连接。", { commandsExecuted: 0 }));
    return baseReport({ ...options, execute, runId, repositoryRevision }, results, inventory);
  }
  if (!safety.ready || missing.length) {
    results.push(result("rehearsal.execution", "备份恢复演练", overallStatus(results) === STATUS.FAIL ? STATUS.FAIL : STATUS.BLOCKED, "安全前置条件或工具链未满足，未执行数据库命令。", { commandsExecuted: 0 }));
    return baseReport({ ...options, execute, runId, repositoryRevision }, results, inventory);
  }

  fs.mkdirSync(runDirectory, { recursive: true });
  let commandsExecuted = 0;
  try {
    const versions = {};
    const versionSpecs = [
      ["pg_dump", tools.pgDump, ["--version"]],
      ["pg_restore", tools.pgRestore, ["--version"]],
      ["psql", tools.psql, ["--version"]],
      ["prisma", tools.node, [tools.prisma, "--version"]],
    ];
    for (const [name, file, args] of versionSpecs) {
      const output = runSpec(runCommand, `version.${name}`, file, args, root, env);
      commandsExecuted += 1;
      const version = safeVersion(output);
      if (!version) {
        results.push(result("tools.versions", "命令版本证据", STATUS.FAIL, `${name} 版本命令执行失败。`, { failedTool: name }));
        return baseReport({ ...options, execute, runId, repositoryRevision }, results, { required: inventory, versions });
      }
      versions[name] = version;
    }
    results.push(result("tools.versions", "命令版本证据", STATUS.PASS, "已记录 PostgreSQL 与 Prisma 命令版本。", versions));

    const sourceEnv = postgresEnvironment(env, safety.source.connection);
    const targetEnv = postgresEnvironment(env, safety.target.connection);
    const dump = runSpec(runCommand, "backup", tools.pgDump, ["--format=custom", "--no-owner", "--no-privileges", "--file", backupFile], root, sourceEnv);
    commandsExecuted += 1;
    if (!commandSucceeded(dump) || !fs.existsSync(backupFile) || fs.statSync(backupFile).size === 0) {
      results.push(result("rehearsal.backup", "临时备份", STATUS.FAIL, "pg_dump 执行失败或未生成备份文件。", { commandExitCode: dump?.status ?? null }));
      return baseReport({ ...options, execute, runId, repositoryRevision }, results, { required: inventory, versions });
    }
    const backup = { sha256: sha256File(backupFile), bytes: fs.statSync(backupFile).size, format: "custom" };
    results.push(result("rehearsal.backup", "临时备份", STATUS.PASS, "备份已生成并完成 SHA-256 校验。", backup));

    const restore = runSpec(runCommand, "restore", tools.pgRestore, ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", backupFile], root, targetEnv);
    commandsExecuted += 1;
    if (!commandSucceeded(restore)) {
      results.push(result("rehearsal.restore", "隔离恢复", STATUS.FAIL, "pg_restore 在隔离演练库执行失败。", { commandExitCode: restore?.status ?? null }));
      return baseReport({ ...options, execute, runId, repositoryRevision }, results, { required: inventory, versions });
    }
    results.push(result("rehearsal.restore", "隔离恢复", STATUS.PASS, "备份已恢复到确认过的隔离演练库。", { cleanRestore: true, ownerAndPrivilegesRestored: false }));

    const migrationArgs = [tools.prisma, "migrate", "status", "--schema", path.join(root, "prisma", "schema.prisma")];
    const sourceMigration = runSpec(runCommand, "migration.source", tools.node, migrationArgs, root, { ...env, DATABASE_URL: safety.source.secretUrl });
    const targetMigration = runSpec(runCommand, "migration.target", tools.node, migrationArgs, root, { ...env, DATABASE_URL: safety.target.secretUrl });
    commandsExecuted += 2;
    if (!commandSucceeded(sourceMigration) || !commandSucceeded(targetMigration)) {
      results.push(result("evidence.migrations", "Prisma 迁移状态", STATUS.FAIL, "源库或恢复库的 Prisma migrate status 失败。", { sourceUpToDate: commandSucceeded(sourceMigration), targetUpToDate: commandSucceeded(targetMigration) }));
      return baseReport({ ...options, execute, runId, repositoryRevision }, results, { required: inventory, versions });
    }
    results.push(result("evidence.migrations", "Prisma 迁移状态", STATUS.PASS, "源库与恢复库的 Prisma 迁移状态命令均通过。", { sourceUpToDate: true, targetUpToDate: true }));

    const countArgs = ["--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", COUNT_SQL];
    const sourceCountsOutput = runSpec(runCommand, "consistency.source", tools.psql, countArgs, root, sourceEnv);
    const targetCountsOutput = runSpec(runCommand, "consistency.target", tools.psql, countArgs, root, targetEnv);
    commandsExecuted += 2;
    const sourceCounts = parseCounts(sourceCountsOutput);
    const targetCounts = parseCounts(targetCountsOutput);
    if (!sourceCounts || !targetCounts) {
      results.push(result("evidence.consistency", "最小一致性证据", STATUS.FAIL, "无法取得脱敏的表数量和迁移数量证据。", { sourceCollected: Boolean(sourceCounts), targetCollected: Boolean(targetCounts) }));
    } else {
      const consistent = sourceCounts.publicTables === targetCounts.publicTables && sourceCounts.appliedMigrations === targetCounts.appliedMigrations;
      results.push(result(
        "evidence.consistency",
        "最小一致性证据",
        consistent ? STATUS.PASS : STATUS.FAIL,
        consistent ? "源库与恢复库的公共表数量和已应用迁移数量一致。" : "源库与恢复库的最小结构证据不一致。",
        { source: sourceCounts, target: targetCounts, consistent },
      ));
    }
    results.push(result("rehearsal.execution", "备份恢复演练", overallStatus(results), "演练命令链已结束，临时备份将在报告返回前删除。", { commandsExecuted }));
    return baseReport({ ...options, execute, runId, repositoryRevision }, results, { required: inventory, versions });
  } finally {
    try { if (fs.existsSync(backupFile)) fs.rmSync(backupFile, { force: true }); } catch { /* report already states retention policy */ }
  }
}

function renderMarkdown(report) {
  const lines = [
    "# PostgreSQL 备份与恢复演练证据",
    "",
    `- 状态：\`${report.status}\``,
    `- 模式：\`${report.mode}\``,
    `- 生成时间：\`${report.generatedAt}\``,
    `- 仓库修订：\`${report.repositoryRevision}\``,
    `- 结果：PASS ${report.summary.pass} / BLOCKED ${report.summary.blocked} / FAIL ${report.summary.fail}`,
    "- 脱敏：未记录连接 URL、用户名、密码或业务数据内容；临时备份未保留。",
    "",
    "## 检查结果",
    "",
  ];
  for (const item of report.results) {
    lines.push(`### ${item.title} — \`${item.status}\``, "", item.summary, "");
    if (Object.keys(item.evidence || {}).length) lines.push("```json", JSON.stringify(item.evidence, null, 2), "```", "");
  }
  lines.push("## 判定", "", report.status === STATUS.PASS ? "演练证据闭环通过，可提交发布评审。" : "存在未通过或被阻塞项目，禁止把本报告当作生产发布批准。", "");
  return lines.join("\n");
}

function writeReports(report, root = defaultReportRoot) {
  const runDirectory = path.join(root, report.runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = `${renderMarkdown(report)}\n`;
  fs.writeFileSync(path.join(runDirectory, "report.json"), json, "utf8");
  fs.writeFileSync(path.join(runDirectory, "report.zh-CN.md"), markdown, "utf8");
  fs.writeFileSync(path.join(root, "latest.json"), json, "utf8");
  fs.writeFileSync(path.join(root, "latest.md"), markdown, "utf8");
  return { runDirectory, latestJson: path.join(root, "latest.json"), latestMarkdown: path.join(root, "latest.md") };
}

function parseArgs(argv) {
  const options = { execute: false, confirmation: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute") options.execute = true;
    else if (arg === "--confirm") {
      options.confirmation = String(argv[++index] || "");
      if (!options.confirmation) throw new Error("--confirm requires the exact confirmation phrase");
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node tools/database-recovery-rehearsal.js [options]

Environment:
  DATABASE_RECOVERY_SOURCE_URL       source PostgreSQL URL (or DATABASE_URL)
  DATABASE_RECOVERY_REHEARSAL_URL    isolated rehearsal PostgreSQL URL

Options:
  --execute                          run the guarded backup/restore rehearsal
  --confirm "${CONFIRMATION_PREFIX} <database>"
                                     bind approval to the rehearsal database name
  --help                             show this help

Without --execute this tool only produces an offline plan and runs no commands.`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return printHelp();
  const report = await collectDatabaseRecoveryRehearsal(options);
  const artifacts = writeReports(report);
  console.log(`[database-recovery] status=${report.status} mode=${report.mode}`);
  console.log(`[database-recovery] report=${artifacts.latestMarkdown}`);
  process.exitCode = EXIT_CODE[report.status];
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[database-recovery] FAIL: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = EXIT_CODE.FAIL;
  });
}

module.exports = {
  CONFIRMATION_PREFIX,
  EXIT_CODE,
  SCHEMA_VERSION,
  STATUS,
  collectDatabaseRecoveryRehearsal,
  confirmationPhrase,
  inspectSafety,
  overallStatus,
  parseArgs,
  parseDatabaseUrl,
  renderMarkdown,
  writeReports,
};
