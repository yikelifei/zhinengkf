"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const STATUS = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", FAIL: "FAIL" });
const STATUS_RANK = Object.freeze({ PASS: 0, BLOCKED: 1, FAIL: 2 });
const EXIT_CODE = Object.freeze({ PASS: 0, BLOCKED: 2, FAIL: 1 });
const MIN_NODE_VERSION = "20.0.0";
const MIN_PYTHON_VERSION = "3.10.0";
const SAFE_DATABASE_URL = "postgresql://release_gate:release_gate@127.0.0.1:1/release_gate?schema=public";

const desktopRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(desktopRoot, "..");
const reportRoot = path.join(desktopRoot, ".runtime", "production-release-gate");
const logRoot = path.join(reportRoot, "logs");

const externalBlockers = Object.freeze([
  {
    id: "external.secrets",
    title: "生产密钥与托管配置",
    summary: "未读取或验证真实 AI、渠道、数据库、Redis 等密钥；需在目标环境通过密钥管理服务注入并人工确认。",
  },
  {
    id: "external.database",
    title: "生产数据库迁移证据",
    summary: "本地只做 schema、客户端生成和离线 SQL 检查；现有数据库基线及 prisma migrate deploy 必须在隔离的预发布数据库实跑。",
  },
  {
    id: "external.integrations",
    title: "真实渠道与设计平台联调",
    summary: "真实微信/企业微信授权、公开 HTTPS 回调、AI 供应商和设计平台可用性需要在受控预发布环境验收。",
  },
]);

function parseVersion(value) {
  const match = String(value || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

function compareVersions(left, right) {
  const a = Array.isArray(left) ? left : parseVersion(left);
  const b = Array.isArray(right) ? right : parseVersion(right);
  if (!a || !b) throw new Error(`Invalid version comparison: ${left} / ${right}`);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function result(id, title, status, summary, extra = {}) {
  if (!(status in STATUS_RANK)) throw new Error(`Unsupported gate status: ${status}`);
  return { id, title, status, summary, ...extra };
}

function computeOverallStatus(results) {
  return results.reduce(
    (current, item) => (STATUS_RANK[item.status] > STATUS_RANK[current] ? item.status : current),
    STATUS.PASS,
  );
}

function stableObject(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)));
}

function checkDependencyLock(options = {}) {
  const packageFile = options.packageFile || path.join(desktopRoot, "package.json");
  const lockFile = options.lockFile || path.join(desktopRoot, "package-lock.json");
  const requirementsFile = options.requirementsFile || path.join(repositoryRoot, "requirements.txt");
  const devRequirementsFile = options.devRequirementsFile || path.join(repositoryRoot, "requirements-dev.txt");
  const problems = [];
  let packageJson;
  let packageLock;

  try {
    packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  } catch (error) {
    problems.push(`package.json 无法读取：${error.message}`);
  }
  try {
    packageLock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  } catch (error) {
    problems.push(`package-lock.json 无法读取：${error.message}`);
  }

  if (packageJson && packageLock) {
    const lockRoot = packageLock.packages?.[""];
    if (packageLock.lockfileVersion !== 3) problems.push("package-lock.json 必须使用 lockfileVersion 3");
    if (!lockRoot) {
      problems.push("package-lock.json 缺少 packages[\"\"] 根记录");
    } else {
      for (const field of ["dependencies", "devDependencies", "engines"]) {
        if (JSON.stringify(stableObject(packageJson[field])) !== JSON.stringify(stableObject(lockRoot[field]))) {
          problems.push(`package.json 与 package-lock.json 的 ${field} 不一致`);
        }
      }
      if (packageJson.name !== lockRoot.name || packageJson.version !== lockRoot.version) {
        problems.push("package name/version 与锁文件根记录不一致");
      }
    }
  }

  if (!fs.existsSync(requirementsFile)) problems.push("缺少 requirements.txt");
  if (!fs.existsSync(devRequirementsFile)) {
    problems.push("缺少 requirements-dev.txt");
  } else {
    const devRequirements = fs.readFileSync(devRequirementsFile, "utf8");
    if (!/^\s*-r\s+requirements\.txt\s*$/m.test(devRequirements)) {
      problems.push("requirements-dev.txt 未复用 requirements.txt");
    }
  }

  return problems.length
    ? result("dependencies.lock", "依赖清单与 Node 锁文件", STATUS.FAIL, problems.join("；"), { details: problems })
    : result(
        "dependencies.lock",
        "依赖清单与 Node 锁文件",
        STATUS.PASS,
        "package-lock v3 与 package.json 同步，Python 开发依赖复用生产清单。",
      );
}

function checkMigrationInventory(options = {}) {
  const migrationsRoot = options.migrationsRoot || path.join(desktopRoot, "prisma", "migrations");
  const problems = [];
  let entries = [];
  try {
    entries = fs.readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch (error) {
    problems.push(`迁移目录无法读取：${error.message}`);
  }

  if (!entries.length) problems.push("没有 Prisma 迁移目录");
  const names = entries.map((entry) => entry.name).sort();
  for (const name of names) {
    if (!/^\d{14}_[a-z0-9_]+$/.test(name)) problems.push(`迁移目录命名不规范：${name}`);
    const sqlFile = path.join(migrationsRoot, name, "migration.sql");
    if (!fs.existsSync(sqlFile)) {
      problems.push(`迁移缺少 migration.sql：${name}`);
      continue;
    }
    const sql = fs.readFileSync(sqlFile, "utf8").trim();
    if (!sql) problems.push(`迁移 SQL 为空：${name}`);
    if (/\bDROP\s+DATABASE\b/i.test(sql)) problems.push(`迁移包含禁止操作 DROP DATABASE：${name}`);
  }

  return problems.length
    ? result("prisma.inventory", "Prisma 迁移文件", STATUS.FAIL, problems.join("；"), { details: problems })
    : result(
        "prisma.inventory",
        "Prisma 迁移文件",
        STATUS.PASS,
        `发现 ${names.length} 个有序且非空的迁移；数据库基线与 deploy 实跑另列外部阻塞项。`,
      );
}

function checkDesktopAndDocs(options = {}) {
  const root = options.repositoryRoot || repositoryRoot;
  const desktop = options.desktopRoot || desktopRoot;
  const packageJson = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8"));
  const expectedFiles = [
    path.join(desktop, packageJson.main || ""),
    path.join(desktop, "apps", "electron", "preload.js"),
    path.join(root, "run_desktop.bat"),
    path.join(root, "production-release-gate.cmd"),
    path.join(root, "docs", "PRODUCTION_RELEASE_CHECKLIST.md"),
    path.join(root, "README.md"),
    path.join(root, "tools", "README.md"),
  ];
  const missing = expectedFiles.filter((file) => !fs.existsSync(file)).map((file) => path.relative(root, file));
  if (missing.length) {
    return result("desktop.contract", "桌面入口与发布文档", STATUS.FAIL, `缺少：${missing.join("、")}`, {
      details: missing,
    });
  }
  const checklist = fs.readFileSync(path.join(root, "docs", "PRODUCTION_RELEASE_CHECKLIST.md"), "utf8");
  const requiredText = ["production-release-gate.cmd", "PASS", "BLOCKED", "FAIL", "prisma migrate deploy"];
  const absentText = requiredText.filter((text) => !checklist.includes(text));
  if (absentText.length) {
    return result(
      "desktop.contract",
      "桌面入口与发布文档",
      STATUS.FAIL,
      `发布清单缺少必要说明：${absentText.join("、")}`,
      { details: absentText },
    );
  }
  return result(
    "desktop.contract",
    "桌面入口与发布文档",
    STATUS.PASS,
    `Electron main=${packageJson.main}，Windows 启动入口和生产发布清单均存在。`,
  );
}

const secretRules = Object.freeze([
  { name: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { name: "openai-token", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g },
  { name: "stripe-live-key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
]);

function looksLikePlaceholder(value) {
  return /(?:example|placeholder|replace|changeme|your[_-]|dummy|mock|test[_-]|not[_-]?set|dev[_-]?only|process\.env|\$\{|env\()/i.test(
    String(value || ""),
  );
}

function scanTextForSecrets(relativePath, content) {
  const findings = [];
  for (const rule of secretRules) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(content))) {
      if (rule.name !== "private-key" && looksLikePlaceholder(match[0])) continue;
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      findings.push({ file: relativePath, line, rule: rule.name });
    }
  }

  const assignment = /\b(api[_-]?key|client[_-]?secret|access[_-]?token|password|private[_-]?key)\b\s*[:=]\s*["']([^"'\r\n]{16,})["']/gi;
  let match;
  while ((match = assignment.exec(content))) {
    if (looksLikePlaceholder(match[2])) continue;
    const line = content.slice(0, match.index).split(/\r?\n/).length;
    findings.push({ file: relativePath, line, rule: "hardcoded-sensitive-assignment" });
  }
  return findings;
}

function scanSecretEntries(entries) {
  const findings = [];
  for (const entry of entries) {
    const relativePath = String(entry.relativePath || "").replace(/\\/g, "/");
    const baseName = path.posix.basename(relativePath).toLowerCase();
    const extension = path.posix.extname(relativePath).toLowerCase();
    if (baseName === ".env" || baseName === "id_rsa" || [".pem", ".p12", ".pfx", ".jks"].includes(extension)) {
      findings.push({ file: relativePath, line: 1, rule: "forbidden-secret-file" });
      continue;
    }
    findings.push(...scanTextForSecrets(relativePath, String(entry.content || "")));
  }
  return findings;
}

function listGitCandidateFiles(root = repositoryRoot) {
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 1024 * 1024 * 20,
    windowsHide: true,
  });
  if (listed.status !== 0) throw new Error("git ls-files 执行失败，无法确定敏感信息扫描范围");
  return listed.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function scanRepositorySecrets(root = repositoryRoot) {
  const entries = [];
  for (const relativePath of listGitCandidateFiles(root)) {
    const absolutePath = path.join(root, relativePath);
    let stat;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.includes(0)) continue;
    entries.push({ relativePath, content: buffer.toString("utf8") });
  }
  return scanSecretEntries(entries);
}

function secretScanResult(root = repositoryRoot) {
  try {
    const findings = scanRepositorySecrets(root);
    if (!findings.length) {
      return result(
        "security.secrets",
        "敏感信息扫描",
        STATUS.PASS,
        "已扫描 Git 候选文件；未发现私钥、禁止提交的密钥文件或高置信度真实令牌。",
      );
    }
    const locations = findings.map((item) => `${item.file}:${item.line} (${item.rule})`);
    return result(
      "security.secrets",
      "敏感信息扫描",
      STATUS.FAIL,
      `发现 ${findings.length} 个高置信度敏感项；报告只记录位置，不记录密钥值。`,
      { details: locations },
    );
  } catch (error) {
    return result("security.secrets", "敏感信息扫描", STATUS.FAIL, error.message);
  }
}

function commandLabel(command, args) {
  return [command, ...args].map((item) => (String(item).includes(" ") ? `"${item}"` : item)).join(" ");
}

function npmCommand(args) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && fs.existsSync(npmCli)) return { command: process.execPath, args: [npmCli, ...args] };
  if (process.platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", ["npm.cmd", ...args].join(" ")] };
  }
  return { command: "npm", args };
}

function batchCommand(batchFile, args = []) {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/c", "call", batchFile, ...args],
    };
  }
  if (path.basename(batchFile).toLowerCase() === "_run_python_task.bat") {
    return { command: "python", args };
  }
  return { command: "python", args: [path.join(repositoryRoot, "scripts", "run_tests.py"), ...args] };
}

function runLoggedCommand({ id, title, command, args = [], cwd = desktopRoot, env = {}, failureStatus = STATUS.FAIL }) {
  const startedAt = Date.now();
  process.stdout.write(`[gate] ${title}...\n`);
  const executed = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      USE_LOCAL_STORE: "true",
      ...env,
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 200,
    windowsHide: true,
    shell: false,
  });
  const durationMs = Date.now() - startedAt;
  fs.mkdirSync(logRoot, { recursive: true });
  const logFile = path.join(logRoot, `${id.replace(/[^a-z0-9_.-]/gi, "-")}.log`);
  const output = [
    `$ ${commandLabel(command, args)}`,
    `cwd=${cwd}`,
    `exitCode=${executed.status}`,
    `signal=${executed.signal || ""}`,
    "",
    executed.stdout || "",
    executed.stderr || "",
    executed.error ? `\nspawnError=${executed.error.message}\n` : "",
  ].join("\n");
  fs.writeFileSync(logFile, output, "utf8");

  if (executed.status === 0) {
    process.stdout.write(`[PASS] ${title} (${Math.ceil(durationMs / 1000)}s)\n`);
    return result(id, title, STATUS.PASS, `命令通过，耗时 ${Math.ceil(durationMs / 1000)} 秒。`, {
      durationMs,
      log: path.relative(desktopRoot, logFile).replace(/\\/g, "/"),
      output: `${executed.stdout || ""}\n${executed.stderr || ""}`,
    });
  }

  process.stdout.write(`[${failureStatus}] ${title} (${Math.ceil(durationMs / 1000)}s)\n`);
  return result(id, title, failureStatus, `命令退出码 ${executed.status ?? "未启动"}，详见隔离日志。`, {
    durationMs,
    log: path.relative(desktopRoot, logFile).replace(/\\/g, "/"),
    output: `${executed.stdout || ""}\n${executed.stderr || ""}`,
  });
}

function sanitizeResults(results) {
  return results.map(({ output: _output, ...item }) => item);
}

function renderMarkdownReport(report) {
  const lines = [
    "# 生产发布门禁报告",
    "",
    `- 总状态：**${report.status}**`,
    `- 生成时间：${report.generatedAt}`,
    `- 工作目录：\`desktop\``,
    "- 说明：该门禁不读取真实密钥、不打包、不上传，也不会自动停止占用端口的进程。",
    "",
    "## 检查结果",
    "",
    "| 状态 | 检查项 | 结果 | 证据 |",
    "| --- | --- | --- | --- |",
  ];
  for (const item of report.results) {
    const summary = String(item.summary || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    const evidence = item.log ? `\`${item.log}\`` : "内置静态检查";
    lines.push(`| ${item.status} | ${item.title} | ${summary} | ${evidence} |`);
  }

  const details = report.results.filter((item) => item.details?.length);
  if (details.length) {
    lines.push("", "## 详细问题", "");
    for (const item of details) {
      lines.push(`### ${item.status} - ${item.title}`, "");
      for (const detail of item.details) lines.push(`- ${detail}`);
      lines.push("");
    }
  }

  lines.push(
    "",
    "## 状态口径",
    "",
    "- `PASS`：本机可重复执行的检查已通过。",
    "- `BLOCKED`：代码检查未必失败，但缺少真实外部环境、授权、数据库证据或空闲端口，禁止发布。",
    "- `FAIL`：仓库、构建、测试、安全或本地工具链检查失败，禁止发布。",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function writeReport(results) {
  const cleanResults = sanitizeResults(results);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: computeOverallStatus(cleanResults),
    results: cleanResults,
  };
  fs.mkdirSync(reportRoot, { recursive: true });
  fs.writeFileSync(path.join(reportRoot, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(reportRoot, "latest.md"), renderMarkdownReport(report), "utf8");
  return report;
}

function checkNodeRuntime() {
  return compareVersions(process.versions.node, MIN_NODE_VERSION) >= 0
    ? result("runtime.node", "Node.js 版本", STATUS.PASS, `Node.js ${process.versions.node}，满足 >=${MIN_NODE_VERSION}。`)
    : result("runtime.node", "Node.js 版本", STATUS.FAIL, `Node.js ${process.versions.node}，需要 >=${MIN_NODE_VERSION}。`);
}

function checkNpmRuntime() {
  const npm = npmCommand(["--version"]);
  const checked = runLoggedCommand({
    id: "runtime.npm",
    title: "npm 版本",
    command: npm.command,
    args: npm.args,
    cwd: desktopRoot,
  });
  if (checked.status !== STATUS.PASS) return checked;
  const parsed = parseVersion(checked.output);
  if (!parsed) return result("runtime.npm", "npm 版本", STATUS.FAIL, "无法解析 npm 版本。", { log: checked.log });
  const rendered = parsed.join(".");
  return compareVersions(parsed, "10.0.0") >= 0
    ? result("runtime.npm", "npm 版本", STATUS.PASS, `npm ${rendered}，满足 >=10.0.0。`, {
        durationMs: checked.durationMs,
        log: checked.log,
      })
    : result("runtime.npm", "npm 版本", STATUS.FAIL, `npm ${rendered}，需要 >=10.0.0。`, {
        durationMs: checked.durationMs,
        log: checked.log,
      });
}

function checkPythonRuntime() {
  const python = batchCommand(path.join(repositoryRoot, "tools", "_run_python_task.bat"), ["-V"]);
  const checked = runLoggedCommand({
    id: "runtime.python",
    title: "Python 版本",
    command: python.command,
    args: python.args,
    cwd: repositoryRoot,
  });
  if (checked.status !== STATUS.PASS) return checked;
  const parsed = parseVersion(checked.output);
  if (!parsed) return result("runtime.python", "Python 版本", STATUS.FAIL, "无法解析 Python 版本。", { log: checked.log });
  const rendered = parsed.join(".");
  return compareVersions(parsed, MIN_PYTHON_VERSION) >= 0
    ? result("runtime.python", "Python 版本", STATUS.PASS, `Python ${rendered}，满足 >=${MIN_PYTHON_VERSION}。`, {
        durationMs: checked.durationMs,
        log: checked.log,
      })
    : result("runtime.python", "Python 版本", STATUS.FAIL, `Python ${rendered}，需要 >=${MIN_PYTHON_VERSION}。`, {
        durationMs: checked.durationMs,
        log: checked.log,
      });
}

function runNpmCheck(id, title, args, options = {}) {
  const npm = npmCommand(args);
  return runLoggedCommand({ id, title, command: npm.command, args: npm.args, cwd: desktopRoot, ...options });
}

function main() {
  fs.mkdirSync(logRoot, { recursive: true });
  const results = [];
  results.push(checkNodeRuntime());
  results.push(checkNpmRuntime());
  results.push(checkPythonRuntime());
  results.push(checkDependencyLock());
  results.push(checkMigrationInventory());
  results.push(checkDesktopAndDocs());
  results.push(secretScanResult());

  const portCheck = runNpmCheck("ports.preflight", "端口冲突预检", ["run", "ports:preflight:mock:free"], {
    failureStatus: STATUS.BLOCKED,
  });
  results.push(portCheck);

  const safePrismaEnv = { DATABASE_URL: SAFE_DATABASE_URL };
  results.push(runNpmCheck("prisma.validate", "Prisma schema 校验", ["run", "prisma:validate"], { env: safePrismaEnv }));
  results.push(runNpmCheck("prisma.generate", "Prisma Client 生成", ["run", "prisma:generate"], { env: safePrismaEnv }));
  results.push(
    runNpmCheck("prisma.migration-sql", "Prisma 离线迁移 SQL 生成", ["run", "prisma:migrate:check"], {
      env: safePrismaEnv,
    }),
  );

  results.push(
    runLoggedCommand({
      id: "security.tests",
      title: "关键安全测试",
      command: process.execPath,
      args: [
        "--test",
        "tests/identity-binding.test.js",
        "tests/send-guard.test.js",
        "tests/wechat-direct-send-safety.test.js",
        "tests/startup-defaults.test.js",
      ],
      cwd: desktopRoot,
    }),
  );

  const pythonTests = batchCommand(path.join(repositoryRoot, "tools", "quality", "run_tests.bat"));
  results.push(
    runLoggedCommand({
      id: "tests.python",
      title: "Python 完整测试",
      command: pythonTests.command,
      args: pythonTests.args,
      cwd: repositoryRoot,
    }),
  );
  results.push(runNpmCheck("tests.node", "Node 完整测试", ["test"]));
  results.push(runNpmCheck("build.api", "API 生产构建", ["run", "build:api"]));

  if (portCheck.status === STATUS.PASS) {
    results.push(runNpmCheck("build.web", "Web 生产构建", ["run", "build:web"]));
  } else {
    results.push(
      result("build.web", "Web 生产构建", STATUS.BLOCKED, "端口预检未通过，为避免破坏正在运行的桌面服务，本次未执行 Web 构建。"),
    );
  }

  results.push(
    runLoggedCommand({
      id: "desktop.syntax",
      title: "Electron 桌面入口语法",
      command: process.execPath,
      args: ["--check", "apps/electron/main.js"],
      cwd: desktopRoot,
    }),
  );

  for (const blocker of externalBlockers) {
    results.push(result(blocker.id, blocker.title, STATUS.BLOCKED, blocker.summary));
  }

  const report = writeReport(results);
  process.stdout.write(`\n[gate] overall=${report.status}\n`);
  process.stdout.write(`[gate] report=${path.join(reportRoot, "latest.md")}\n`);
  process.exitCode = EXIT_CODE[report.status];
}

if (require.main === module) main();

module.exports = {
  EXIT_CODE,
  MIN_NODE_VERSION,
  MIN_PYTHON_VERSION,
  STATUS,
  checkDependencyLock,
  checkDesktopAndDocs,
  checkMigrationInventory,
  compareVersions,
  computeOverallStatus,
  parseVersion,
  renderMarkdownReport,
  scanSecretEntries,
  scanTextForSecrets,
};
