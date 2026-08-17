"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { parsePorcelainStatusEntries } = require("./repository-provenance");

const STATUS = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", FAIL: "FAIL" });
const STATUS_RANK = Object.freeze({ PASS: 0, BLOCKED: 1, FAIL: 2 });
const EXIT_CODE = Object.freeze({ PASS: 0, BLOCKED: 2, FAIL: 1 });
const MIN_NODE_VERSION = "20.0.0";
const MIN_PYTHON_VERSION = "3.10.0";
const SAFE_DATABASE_URL = "postgresql://release_gate:release_gate@127.0.0.1:1/release_gate?schema=public";
const DEFAULT_ISOLATED_PORTS = Object.freeze({ web: 31911, api: 32911, mock: 37911 });
const DEFAULT_GATE_DESIGN_PLATFORM_BASE_URL = "http://127.0.0.1:3700";
const NODE_TEST_SHARD_SIZE = 12;
const NODE_TEST_SHARD_TIMEOUT_MS = 120_000;
const HEAVY_NODE_TEST_SHARD_TIMEOUT_MS = 600_000;
const HEAVY_NODE_TEST_FILES = Object.freeze(["tests/project-completion-audit.test.js"]);
const PRISMA_GENERATE_FILE_LOCK_PATTERN = /EPERM:\s*operation not permitted,\s*rename[\s\S]*query_engine-windows\.dll\.node/i;
const WEB_BUILD_BLOCKED_PATTERN =
  /\[blocked\]\s*(?:Web port \d+ is currently used by PID|Stable desktop (?:startup|heartbeat) is fresh|Web build is already running)/i;

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
    id: "external.automation_queue",
    title: "生产 BullMQ 持久调度证据",
    summary: "需在隔离预发布环境确认 durable 模式、Redis 权限/持久化、唯一 scheduler、全局并发 1、Worker 在线和故障恢复；报告不得回显 Redis URL 或密码。",
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

function parseTcpPort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a valid TCP port between 1 and 65535`);
  }
  return port;
}

function parseGateOptions(argv = [], env = process.env) {
  let isolatedWorktree = false;
  for (const argument of argv) {
    if (argument === "--isolated-worktree") isolatedWorktree = true;
    else throw new Error(`unsupported argument: ${argument}`);
  }
  if (!isolatedWorktree) return { mode: "default", ports: null, ownerCheckWebPort: null };

  const ports = {
    web: parseTcpPort(env.RELEASE_GATE_ISOLATED_WEB_PORT || DEFAULT_ISOLATED_PORTS.web, "isolated Web port"),
    api: parseTcpPort(env.RELEASE_GATE_ISOLATED_API_PORT || DEFAULT_ISOLATED_PORTS.api, "isolated API port"),
    mock: parseTcpPort(env.RELEASE_GATE_ISOLATED_MOCK_PORT || DEFAULT_ISOLATED_PORTS.mock, "isolated mock port"),
  };
  if (new Set(Object.values(ports)).size !== 3) throw new Error("isolated Web, API and mock ports must be distinct");
  const ownerCheckWebPort = parseTcpPort(env.WEB_PORT || 3100, "current Web owner-check port");
  return { mode: "isolated-worktree", ports, ownerCheckWebPort };
}

function normalizeGitPath(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

function isLinkedWorktreeLayout(gitDir, commonDir) {
  const normalizedGitDir = normalizeGitPath(gitDir);
  const normalizedCommonDir = normalizeGitPath(commonDir);
  if (!normalizedGitDir || !normalizedCommonDir || normalizedGitDir === normalizedCommonDir) return false;
  return normalizedGitDir.startsWith(`${normalizedCommonDir}/worktrees/`);
}

function checkLinkedWorktree(root = repositoryRoot) {
  const checked = spawnSync("git", ["rev-parse", "--git-dir", "--git-common-dir"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  const [gitDir = "", commonDir = ""] = String(checked.stdout || "").trim().split(/\r?\n/);
  if (checked.status === 0 && isLinkedWorktreeLayout(gitDir, commonDir)) {
    return result(
      "mode.linked-worktree",
      "隔离门禁 linked worktree 边界",
      STATUS.PASS,
      "Git git-dir 位于 common-dir/worktrees 下，允许使用隔离端口收集当前 worktree 的构建证据。",
    );
  }
  const reason = checked.status === 0
    ? "当前目录不是 linked worktree；隔离门禁拒绝在主工作树运行。"
    : "无法读取 Git worktree 布局；隔离门禁失败关闭。";
  return result("mode.linked-worktree", "隔离门禁 linked worktree 边界", STATUS.FAIL, reason);
}

function checkReleaseCandidateWorkspace(options = {}) {
  const root = options.repositoryRoot || repositoryRoot;
  const runCommand = options.runCommand || spawnSync;
  const checked = runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 10_000,
  });
  if (checked?.error || Number(checked?.status) !== 0) {
    return result(
      "release.workspace_clean",
      "发布候选工作区冻结",
      STATUS.FAIL,
      "无法读取 git status，生产发布门禁失败关闭。",
    );
  }
  const entries = parsePorcelainStatusEntries(checked.stdout);
  if (!entries.length) {
    return result(
      "release.workspace_clean",
      "发布候选工作区冻结",
      STATUS.PASS,
      "工作区干净，没有未提交或未跟踪的发布候选改动。",
    );
  }
  const untracked = entries.filter((entry) => entry.status === "??").length;
  const modified = entries.length - untracked;
  return result(
    "release.workspace_clean",
    "发布候选工作区冻结",
    STATUS.BLOCKED,
    `当前工作区仍有 ${entries.length} 个候选改动，必须先冻结发布分支或干净工作区；modified=${modified} untracked=${untracked}。`,
    {
      counts: { statusEntries: entries.length, modified, untracked },
      details: entries.slice(0, 20).map((entry) => `${entry.status} ${entry.path}`),
    },
  );
}

function isolatedPortEnv(ports) {
  return {
    WEB_PORT: String(ports.web),
    API_PORT: String(ports.api),
    MOCK_DESIGN_PLATFORM_PORT: String(ports.mock),
    DESIGN_PLATFORM_ADAPTER: "mock",
    DESIGN_PLATFORM_BASE_URL: `http://127.0.0.1:${ports.mock}`,
  };
}

function localDesignPlatformEnv(execution = {}) {
  const baseUrl = execution.ports
    ? `http://127.0.0.1:${execution.ports.mock}`
    : DEFAULT_GATE_DESIGN_PLATFORM_BASE_URL;
  return { DESIGN_PLATFORM_BASE_URL: baseUrl };
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
    path.join(desktop, "apps", "api", "src", "automation", "automation-queue.runtime.ts"),
    path.join(desktop, "docs", "AUTOMATION_DURABLE_SCHEDULER.md"),
  ];
  const missing = expectedFiles.filter((file) => !fs.existsSync(file)).map((file) => path.relative(root, file));
  if (missing.length) {
    return result("desktop.contract", "桌面入口与发布文档", STATUS.FAIL, `缺少：${missing.join("、")}`, {
      details: missing,
    });
  }
  const checklist = fs.readFileSync(path.join(root, "docs", "PRODUCTION_RELEASE_CHECKLIST.md"), "utf8");
  const requiredText = [
    "production-release-gate.cmd",
    "PASS",
    "BLOCKED",
    "FAIL",
    "prisma migrate deploy",
    "LOW_VALUE_AUTOMATION_MODE=durable",
  ];
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

function runLoggedCommand({
  id,
  title,
  command,
  args = [],
  cwd = desktopRoot,
  env = {},
  failureStatus = STATUS.FAIL,
  failureStatusByExitCode = {},
  failureStatusByOutput = [],
  timeoutMs = 0,
}) {
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
    ...(timeoutMs ? { timeout: timeoutMs } : {}),
    windowsHide: true,
    shell: false,
  });
  const durationMs = Date.now() - startedAt;
  fs.mkdirSync(logRoot, { recursive: true });
  const logFile = path.join(logRoot, `${id.replace(/[^a-z0-9_.-]/gi, "-")}.log`);
  const output = [
    `$ ${commandLabel(command, args)}`,
    `cwd=${cwd}`,
    ...(timeoutMs ? [`timeoutMs=${timeoutMs}`] : []),
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

  const matchedFailureOutput = matchCommandFailureOutput(output, failureStatusByOutput);
  const resolvedFailureStatus = resolveCommandFailureStatus(
    executed.status,
    failureStatus,
    failureStatusByExitCode,
    output,
    failureStatusByOutput,
  );
  process.stdout.write(`[${resolvedFailureStatus}] ${title} (${Math.ceil(durationMs / 1000)}s)\n`);
  const failureSummary = executed.error?.code === "ETIMEDOUT"
    ? `Command timed out after ${timeoutMs} ms; see isolated log.`
    : matchedFailureOutput?.summary
      ? matchedFailureOutput.summary
    : `命令退出码 ${executed.status ?? "未启动"}，详见隔离日志。`;
  return result(id, title, resolvedFailureStatus, failureSummary, {
    durationMs,
    log: path.relative(desktopRoot, logFile).replace(/\\/g, "/"),
    output: `${executed.stdout || ""}\n${executed.stderr || ""}`,
  });
}

function sanitizeResults(results) {
  return results.map(({ output: _output, ...item }) => item);
}

function appendIncompleteMarker(results, execution = {}) {
  if (execution.completed !== false) return results;
  const currentStage = String(execution.currentStage || "").trim();
  const summary = currentStage
    ? `发布门禁已写入阶段性证据，当前阶段：${currentStage}；后续阶段尚未完成，不得发布。`
    : "发布门禁只写入了阶段性证据，后续阶段尚未完成，不得发布。";
  return [
    ...results,
    result("gate.incomplete", "生产发布门禁未完成", STATUS.BLOCKED, summary),
  ];
}

function renderMarkdownReport(report) {
  const ports = report.ports
    ? `Web=${report.ports.web}, API=${report.ports.api}, Mock=${report.ports.mock}`
    : "默认端口";
  const lines = [
    "# 生产发布门禁报告",
    "",
    `- 总状态：**${report.status}**`,
    `- 生成时间：${report.generatedAt}`,
    `- 工作目录：\`desktop\``,
    `- 运行模式：\`${report.mode || "default"}\``,
    `- 完成状态：${report.completed === false ? "阶段性报告，未完成" : "完整报告"}`,
    ...(report.currentStage ? [`- 当前阶段：${report.currentStage}`] : []),
    `- 端口范围：${ports}`,
    ...(report.ownerCheckWebPort ? [`- owner 安全检查端口：${report.ownerCheckWebPort}`] : []),
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

function createReport(results, execution = {}) {
  const cleanResults = sanitizeResults(appendIncompleteMarker(results, execution));
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    mode: execution.mode || "default",
    ports: execution.ports || null,
    ownerCheckWebPort: execution.ownerCheckWebPort || null,
    completed: execution.completed !== false,
    currentStage: execution.currentStage || "",
    status: computeOverallStatus(cleanResults),
    results: cleanResults,
  };
}

function matchCommandFailureOutput(output, statusByOutput = []) {
  const text = String(output || "");
  return statusByOutput.find((rule) => {
    if (!rule?.pattern) return false;
    if (rule.pattern instanceof RegExp) {
      rule.pattern.lastIndex = 0;
      return rule.pattern.test(text);
    }
    return text.includes(String(rule.pattern));
  }) || null;
}

function resolveCommandFailureStatus(exitCode, fallbackStatus, statusByExitCode = {}, output = "", statusByOutput = []) {
  const matched = matchCommandFailureOutput(output, statusByOutput);
  if (matched?.status) return matched.status;
  return statusByExitCode[exitCode] || fallbackStatus;
}

function writeReport(results, execution = {}, progress = {}) {
  const report = createReport(results, { ...execution, ...progress });
  fs.mkdirSync(reportRoot, { recursive: true });
  fs.writeFileSync(path.join(reportRoot, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(reportRoot, "latest.md"), renderMarkdownReport(report), "utf8");
  return report;
}

function writeProgressReport(results, execution, currentStage) {
  return writeReport(results, execution, { completed: false, currentStage });
}

function recordGateResult(results, execution, item, currentStage = item.id) {
  results.push(item);
  writeProgressReport(results, execution, currentStage);
  return item;
}

function runGateStep(results, execution, currentStage, action) {
  writeProgressReport(results, execution, `running ${currentStage}`);
  const item = action();
  return recordGateResult(results, execution, item, currentStage);
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

function listNodeTestFiles(testDir = path.join(desktopRoot, "tests")) {
  return fs.readdirSync(testDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
    .map((entry) => `tests/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

function createNodeTestShards(files, shardSize = NODE_TEST_SHARD_SIZE, options = {}) {
  if (!Number.isInteger(shardSize) || shardSize < 1) throw new Error("Node test shard size must be a positive integer");
  const heavyFiles = new Set(options.heavyFiles || []);
  const shards = [];
  let current = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (heavyFiles.has(file)) {
      if (current.length) {
        shards.push(current);
        current = [];
      }
      shards.push([file]);
      continue;
    }
    current.push(file);
    if (current.length >= shardSize) {
      shards.push(current);
      current = [];
    }
  }
  if (current.length) shards.push(current);
  return shards;
}

function summarizeNodeShardResults(shardResults, totalFiles) {
  if (!totalFiles) {
    return result("tests.node", "Node full test summary", STATUS.FAIL, "No Node test files were discovered.");
  }
  const status = computeOverallStatus(shardResults);
  const failed = shardResults.filter((item) => item.status === STATUS.FAIL);
  const blocked = shardResults.filter((item) => item.status === STATUS.BLOCKED);
  const passed = shardResults.filter((item) => item.status === STATUS.PASS);
  const problemDetails = [...failed, ...blocked].map((item) => `${item.id} ${item.status}${item.log ? ` (${item.log})` : ""}`);
  return result(
    "tests.node",
    "Node full test summary",
    status,
    `Node test shards passed=${passed.length} failed=${failed.length} blocked=${blocked.length} files=${totalFiles}.`,
    problemDetails.length ? { details: problemDetails } : {},
  );
}

function runNodeTestShards(results, execution, options = {}) {
  const files = options.files || listNodeTestFiles();
  const shards = createNodeTestShards(files, options.shardSize || NODE_TEST_SHARD_SIZE, {
    heavyFiles: options.heavyFiles || HEAVY_NODE_TEST_FILES,
  });
  const timeoutMs = options.timeoutMs || Number(process.env.RELEASE_GATE_NODE_SHARD_TIMEOUT_MS || NODE_TEST_SHARD_TIMEOUT_MS);
  const heavyTimeoutMs = options.heavyTimeoutMs || Number(process.env.RELEASE_GATE_HEAVY_NODE_SHARD_TIMEOUT_MS || HEAVY_NODE_TEST_SHARD_TIMEOUT_MS);
  const heavyFiles = new Set(options.heavyFiles || HEAVY_NODE_TEST_FILES);
  const shardResults = [];
  shards.forEach((shardFiles, index) => {
    const shardNo = String(index + 1).padStart(2, "0");
    const id = `tests.node.${shardNo}`;
    const title = `Node tests shard ${index + 1}/${shards.length}`;
    const item = runGateStep(results, execution, id, () =>
      runLoggedCommand({
        id,
        title,
        command: process.execPath,
        args: ["--test", "--test-concurrency=1", ...shardFiles],
        cwd: desktopRoot,
        env: localDesignPlatformEnv(execution),
        timeoutMs: shardFiles.some((file) => heavyFiles.has(file)) ? heavyTimeoutMs : timeoutMs,
      }));
    shardResults.push(item);
  });
  return recordGateResult(results, execution, summarizeNodeShardResults(shardResults, files.length), "tests.node");
}

function main(argv = process.argv.slice(2), env = process.env) {
  const execution = parseGateOptions(argv, env);
  let linkedWorktreeCheck = null;
  if (execution.mode === "isolated-worktree") {
    linkedWorktreeCheck = checkLinkedWorktree();
    if (linkedWorktreeCheck.status !== STATUS.PASS) {
      const report = writeReport([linkedWorktreeCheck], execution);
      process.stdout.write(`\n[gate] overall=${report.status}\n`);
      process.stdout.write(`[gate] report=${path.join(reportRoot, "latest.md")}\n`);
      process.exitCode = EXIT_CODE[report.status];
      return;
    }
  }
  fs.mkdirSync(logRoot, { recursive: true });
  const results = linkedWorktreeCheck ? [linkedWorktreeCheck] : [];
  writeProgressReport(results, execution, "starting");
  recordGateResult(results, execution, checkReleaseCandidateWorkspace());
  recordGateResult(results, execution, checkNodeRuntime());
  recordGateResult(results, execution, checkNpmRuntime());
  recordGateResult(results, execution, checkPythonRuntime());
  recordGateResult(results, execution, checkDependencyLock());
  recordGateResult(results, execution, checkMigrationInventory());
  recordGateResult(results, execution, checkDesktopAndDocs());
  recordGateResult(results, execution, secretScanResult());

  const portCheck = runGateStep(results, execution, "ports.preflight", () =>
    runNpmCheck("ports.preflight", "端口冲突预检", ["run", "ports:preflight:mock:free"], {
      env: execution.ports ? isolatedPortEnv(execution.ports) : {},
      failureStatus: STATUS.BLOCKED,
    }));

  const safePrismaEnv = { DATABASE_URL: SAFE_DATABASE_URL };
  runGateStep(results, execution, "prisma.validate", () =>
    runNpmCheck("prisma.validate", "Prisma schema 校验", ["run", "prisma:validate"], { env: safePrismaEnv }));
  runGateStep(results, execution, "prisma.generate", () =>
    runNpmCheck("prisma.generate", "Prisma Client 生成", ["run", "prisma:generate"], {
      env: safePrismaEnv,
      failureStatusByOutput: [{
        pattern: PRISMA_GENERATE_FILE_LOCK_PATTERN,
        status: STATUS.BLOCKED,
        summary: "Prisma Client 文件被正在运行的本地服务锁定；停止本地服务后重跑 release gate。",
      }],
    }));
  runGateStep(results, execution, "prisma.migration-sql", () =>
    runNpmCheck("prisma.migration-sql", "Prisma 离线迁移 SQL 生成", ["run", "prisma:migrate:check"], {
      env: safePrismaEnv,
    }));

  runGateStep(results, execution, "security.tests", () =>
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
      env: localDesignPlatformEnv(execution),
    }));

  const pythonTests = batchCommand(path.join(repositoryRoot, "tools", "quality", "run_tests.bat"));
  runGateStep(results, execution, "tests.python", () =>
    runLoggedCommand({
      id: "tests.python",
      title: "Python 完整测试",
      command: pythonTests.command,
      args: pythonTests.args,
      cwd: repositoryRoot,
    }));
  runNodeTestShards(results, execution);
  runGateStep(results, execution, "build.api", () => runNpmCheck("build.api", "API 生产构建", ["run", "build:api"]));

  if (portCheck.status === STATUS.PASS) {
    if (execution.mode === "isolated-worktree") {
      runGateStep(results, execution, "build.web", () =>
        runNpmCheck("build.web", "Web 生产构建", ["run", "build:web", "--", "--allow-foreign-port-owner"], {
          env: { WEB_PORT: String(execution.ownerCheckWebPort), ALLOW_WEB_BUILD_WITH_FRESH_HEARTBEAT: "0" },
          failureStatusByExitCode: { 2: STATUS.BLOCKED },
          failureStatusByOutput: [{
            pattern: WEB_BUILD_BLOCKED_PATTERN,
            status: STATUS.BLOCKED,
            summary: "Web build was blocked by an active desktop runtime; stop local services and rerun release gate.",
          }],
        }));
    } else {
      runGateStep(results, execution, "build.web", () => runNpmCheck("build.web", "Web 生产构建", ["run", "build:web"], {
        failureStatusByOutput: [{
          pattern: WEB_BUILD_BLOCKED_PATTERN,
          status: STATUS.BLOCKED,
          summary: "Web build was blocked by an active desktop runtime; stop local services and rerun release gate.",
        }],
      }));
    }
  } else {
    recordGateResult(
      results,
      execution,
      result("build.web", "Web 生产构建", STATUS.BLOCKED, "端口预检未通过，为避免破坏正在运行的桌面服务，本次未执行 Web 构建。"),
      "build.web",
    );
  }

  runGateStep(results, execution, "desktop.syntax", () =>
    runLoggedCommand({
      id: "desktop.syntax",
      title: "Electron 桌面入口语法",
      command: process.execPath,
      args: ["--check", "apps/electron/main.js"],
      cwd: desktopRoot,
    }));

  for (const blocker of externalBlockers) {
    recordGateResult(results, execution, result(blocker.id, blocker.title, STATUS.BLOCKED, blocker.summary), blocker.id);
  }

  const report = writeReport(results, execution);
  process.stdout.write(`\n[gate] overall=${report.status}\n`);
  process.stdout.write(`[gate] report=${path.join(reportRoot, "latest.md")}\n`);
  process.exitCode = EXIT_CODE[report.status];
}

if (require.main === module) main();

module.exports = {
  EXIT_CODE,
  DEFAULT_GATE_DESIGN_PLATFORM_BASE_URL,
  HEAVY_NODE_TEST_SHARD_TIMEOUT_MS,
  HEAVY_NODE_TEST_FILES,
  MIN_NODE_VERSION,
  MIN_PYTHON_VERSION,
  STATUS,
  WEB_BUILD_BLOCKED_PATTERN,
  checkDependencyLock,
  checkDesktopAndDocs,
  checkMigrationInventory,
  checkReleaseCandidateWorkspace,
  compareVersions,
  computeOverallStatus,
  createReport,
  createNodeTestShards,
  isLinkedWorktreeLayout,
  localDesignPlatformEnv,
  listNodeTestFiles,
  parseGateOptions,
  parseVersion,
  renderMarkdownReport,
  resolveCommandFailureStatus,
  summarizeNodeShardResults,
  scanSecretEntries,
  scanTextForSecrets,
};
