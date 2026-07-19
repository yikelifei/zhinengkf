"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  READ_ONLY_ROUTES,
  STATUS,
  collectStagingReadiness,
  inspectDatabaseUrl,
  inspectUrl,
  parseArgs,
  renderMarkdown,
  writeReports,
} = require("../tools/staging-readiness-evidence");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-staging-evidence-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function doctorReport(overrides = {}) {
  return {
    schemaVersion: "smart_kefu_config_readiness_v1",
    overall: "ready",
    components: [
      { id: "api", status: "ready", missing: [] },
      { id: "web", status: "ready", missing: [] },
      { id: "database", status: "ready", missing: [], details: { mode: "prisma-postgresql" } },
      { id: "design_platform", status: "ready", missing: [], details: { adapter: "art_image_local" } },
      { id: "model_chain", status: "ready", missing: [], details: { attemptOrder: ["primary"] } },
    ],
    ...overrides,
  };
}

function validEnvironment(accountsConfigFile) {
  const aesKey = Buffer.alloc(32, 7).toString("base64").slice(0, 43);
  return {
    NODE_ENV: "staging",
    USE_LOCAL_STORE: "false",
    DATABASE_URL: "postgresql://smart_kefu_app:strong-local-test@127.0.0.1:5432/smart_kefu_staging",
    INTERNAL_API_TOKEN: "internal-test-token-that-never-enters-the-report",
    CUSTOMER_SERVICE_PUBLIC_BASE_URL: "https://service.acme.cn",
    WECHAT_WORK_API_BASE_URL: "https://qyapi.weixin.qq.com",
    WECHAT_WORK_CORP_ID: "corp-acme-001",
    WECHAT_WORK_SECRET: "wechat-secret-that-never-enters-the-report",
    WECHAT_WORK_TOKEN: "wechat-token-that-never-enters-the-report",
    WECHAT_WORK_ENCODING_AES_KEY: aesKey,
    WECHAT_SEND_ADAPTER: "wechat_work_kf",
    DESIGN_PLATFORM_ADAPTER: "art_image_local",
    DESIGN_PLATFORM_BASE_URL: "http://127.0.0.1:3000",
    DESIGN_PLATFORM_ACCESS_TOKEN: "design-token-that-never-enters-the-report",
    DESIGN_PLATFORM_DEVICE_ID: "staging-device-001",
    PERSONAL_WECHAT_DRIVER: "windows_uia",
    PERSONAL_WECHAT_RPA_ENDPOINT: "http://127.0.0.1:3211",
    PERSONAL_WECHAT_ACCOUNTS_CONFIG_FILE: accountsConfigFile,
    PERSONAL_WECHAT_SEND: "0",
  };
}

function installPrismaCliFixture(desktopRoot) {
  const cli = path.join(desktopRoot, "node_modules", "prisma", "build", "index.js");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "// fixture\n", "utf8");
}

function successfulResponse(route) {
  if (route === "/health") return { ok: true, service: "smart-kefu-desktop-api", dataMode: "prisma" };
  if (route === "/wechat-work/status") {
    return { ready: true, persistence: { mode: "prisma", mappedAccounts: 2, auditRecords: 8 } };
  }
  if (route.startsWith("/wechat-work/kf/audit")) {
    return [
      { action: "callback_accepted", status: "accepted" },
      { action: "inbound_processed", status: "accepted" },
      { action: "send_queued", status: "accepted" },
    ];
  }
  if (route === "/integrations/design-platform/readiness") {
    return { adapter: "art_image_local", canSubmitFormalGeneration: true, checks: [{ key: "health", ok: true, severity: "error" }] };
  }
  if (route === "/wechat/channels/status") {
    return { channels: [{ key: "personal_wechat", ready: false, metrics: { accounts: 1 } }] };
  }
  if (route === "/wechat/bridge/status") {
    return { worker: { ok: true }, outbox: { ignoredCount: 0 }, dispatch: { staleCount: 0 }, locks: { staleCount: 0 } };
  }
  throw new Error(`unexpected route: ${route}`);
}

test("URL and database policy reject obvious unsafe staging values", () => {
  assert.equal(inspectUrl("https://service.acme.cn", { publicHttps: true }).safe, true);
  assert.equal(inspectUrl("http://127.0.0.1:3000", { httpsUnlessLoopback: true }).safe, true);
  assert.equal(inspectUrl("http://service.acme.cn", { publicHttps: true }).reason, "public_https_required");
  assert.equal(inspectUrl("https://internal-host", { publicHttps: true }).reason, "public_https_required");
  assert.equal(inspectUrl("https://[fd00::1]", { publicHttps: true }).reason, "public_https_required");
  assert.equal(inspectUrl("https://rpa.acme.cn", { loopbackOnly: true }).reason, "loopback_required");
  assert.equal(inspectDatabaseUrl("postgresql://postgres:postgres@db.acme.cn/app?sslmode=require").status, STATUS.FAIL);
  assert.equal(inspectDatabaseUrl("postgresql://app:strong@db.acme.cn/app").status, STATUS.BLOCKED);
  assert.equal(inspectDatabaseUrl("postgresql://app:strong@db.acme.cn/app?sslmode=verify-full").status, STATUS.PASS);
});

test("offline inventory never runs staging commands or network probes", async (t) => {
  const root = temporaryDirectory(t);
  const accounts = path.join(root, "accounts.json");
  fs.writeFileSync(accounts, '{"version":"fixture"}\n', "utf8");
  let commandCount = 0;
  let fetchCount = 0;
  const report = await collectStagingReadiness({
    env: validEnvironment(accounts),
    doctorReport: doctorReport(),
    execute: false,
    runCommand: () => { commandCount += 1; throw new Error("must not execute"); },
    fetchJson: async () => { fetchCount += 1; throw new Error("must not fetch"); },
    desktopRoot: root,
    generatedAt: "2026-07-19T00:00:00.000Z",
    runId: "offline-fixture",
  });
  assert.equal(commandCount, 0);
  assert.equal(fetchCount, 0);
  assert.equal(report.status, STATUS.BLOCKED);
  assert.equal(report.safety.allowedNetworkMethods.length, 0);
  assert.equal(report.results.filter((item) => item.id.startsWith("evidence.")).every((item) => item.status === STATUS.BLOCKED), true);
});

test("explicit execute collects only existing read-only interfaces and can pass", async (t) => {
  const root = temporaryDirectory(t);
  installPrismaCliFixture(root);
  const accounts = path.join(root, "accounts.json");
  fs.writeFileSync(accounts, '{"version":"fixture"}\n', "utf8");
  const commands = [];
  const fetched = [];
  const report = await collectStagingReadiness({
    env: validEnvironment(accounts),
    doctorReport: doctorReport(),
    execute: true,
    apiBase: "http://127.0.0.1:3200/api",
    runCommand: (spec) => { commands.push(spec); return { status: 0, stdout: "Database schema is up to date!\n", stderr: "" }; },
    fetchJson: async (_url, options) => { fetched.push(options); return successfulResponse(options.route); },
    desktopRoot: root,
    generatedAt: "2026-07-19T00:00:00.000Z",
    runId: "execute-fixture",
  });
  assert.equal(report.status, STATUS.PASS);
  assert.equal(commands.length, 1);
  assert.match(commands[0].args.join(" "), /prisma.*migrate status/);
  assert.deepEqual(fetched.map((entry) => entry.route), [...READ_ONLY_ROUTES]);
  assert.equal(report.safety.externalMutationCount, 0);
  assert.equal(report.safety.realMessageSendAttempted, false);
  assert.equal(report.safety.databaseWriteAttempted, false);
});

test("execute blocks when migration or channel audit evidence is missing", async (t) => {
  const root = temporaryDirectory(t);
  installPrismaCliFixture(root);
  const accounts = path.join(root, "accounts.json");
  fs.writeFileSync(accounts, '{}\n', "utf8");
  const report = await collectStagingReadiness({
    env: validEnvironment(accounts),
    doctorReport: doctorReport(),
    execute: true,
    runCommand: () => ({ status: 1, stdout: "", stderr: "database unavailable" }),
    fetchJson: async (_url, options) => options.route.startsWith("/wechat-work/kf/audit") ? [] : successfulResponse(options.route),
    desktopRoot: root,
    runId: "blocked-fixture",
    generatedAt: "2026-07-19T00:00:00.000Z",
  });
  assert.equal(report.status, STATUS.BLOCKED);
  assert.equal(report.results.find((item) => item.id === "evidence.database_migrations").status, STATUS.BLOCKED);
  assert.equal(report.results.find((item) => item.id === "evidence.wechat_work").status, STATUS.BLOCKED);
});

test("execute fails closed when the locked local Prisma CLI is unavailable", async (t) => {
  const root = temporaryDirectory(t);
  const accounts = path.join(root, "accounts.json");
  fs.writeFileSync(accounts, '{}\n', "utf8");
  let commandCount = 0;
  const report = await collectStagingReadiness({
    env: validEnvironment(accounts),
    doctorReport: doctorReport(),
    execute: true,
    runCommand: () => { commandCount += 1; return { status: 0 }; },
    fetchJson: async (_url, options) => successfulResponse(options.route),
    desktopRoot: root,
    runId: "missing-prisma-fixture",
    generatedAt: "2026-07-19T00:00:00.000Z",
  });
  assert.equal(commandCount, 0);
  assert.equal(report.status, STATUS.FAIL);
  assert.match(report.results.find((item) => item.id === "evidence.database_migrations").summary, /Prisma CLI 缺失/);
});

test("unsafe configuration is FAIL and secret values never enter reports", async (t) => {
  const root = temporaryDirectory(t);
  const accounts = path.join(root, "accounts.json");
  fs.writeFileSync(accounts, '{}\n', "utf8");
  const env = {
    ...validEnvironment(accounts),
    NODE_ENV: "development",
    USE_LOCAL_STORE: "true",
    DATABASE_URL: "postgresql://postgres:postgres@db.acme.cn/app?sslmode=require",
    CUSTOMER_SERVICE_PUBLIC_BASE_URL: "http://127.0.0.1:3200",
    DESIGN_PLATFORM_BASE_URL: "http://design.acme.cn",
    PERSONAL_WECHAT_RPA_ENDPOINT: "https://rpa.acme.cn",
  };
  const report = await collectStagingReadiness({ env, doctorReport: doctorReport(), execute: false, desktopRoot: root, runId: "unsafe-fixture", generatedAt: "2026-07-19T00:00:00.000Z" });
  const serialized = JSON.stringify(report);
  assert.equal(report.status, STATUS.FAIL);
  for (const secret of [env.DATABASE_URL, env.INTERNAL_API_TOKEN, env.WECHAT_WORK_SECRET, env.DESIGN_PLATFORM_ACCESS_TOKEN]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("reports are written as redacted JSON and Chinese Markdown under a run directory", async (t) => {
  const root = temporaryDirectory(t);
  const accounts = path.join(root, "accounts.json");
  fs.writeFileSync(accounts, '{}\n', "utf8");
  const report = await collectStagingReadiness({ env: validEnvironment(accounts), doctorReport: doctorReport(), execute: false, desktopRoot: root, runId: "report-fixture", generatedAt: "2026-07-19T00:00:00.000Z" });
  const artifacts = writeReports(report, path.join(root, ".runtime", "staging-readiness-evidence"));
  assert.equal(fs.existsSync(path.join(artifacts.runDirectory, "report.json")), true);
  assert.equal(fs.existsSync(path.join(artifacts.runDirectory, "report.zh-CN.md")), true);
  assert.match(fs.readFileSync(artifacts.latestMarkdown, "utf8"), /预发布就绪与证据报告/);
  assert.match(renderMarkdown(report), /`PASS`/);
});

test("CLI requires an explicit execute flag and rejects unknown options", () => {
  assert.deepEqual(parseArgs([]), { execute: false, apiBase: "", help: false });
  assert.deepEqual(parseArgs(["--execute", "--api-base", "https://staging.acme.cn/api"]), { execute: true, apiBase: "https://staging.acme.cn/api", help: false });
  assert.throws(() => parseArgs(["--api-base"]), /requires a URL/);
  assert.throws(() => parseArgs(["--send"]), /unknown argument/);
});

test("source contract contains no mutating staging route or migration deploy command", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "tools", "staging-readiness-evidence.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
  assert.match(packageJson.scripts["staging:readiness"], /staging-readiness-evidence\.js/);
  assert.deepEqual(READ_ONLY_ROUTES.every((route) => !/send-text|sync|callback$/i.test(route)), true);
  assert.doesNotMatch(source, /npm\W+exec/);
  assert.doesNotMatch(source, /prisma\W+migrate\W+deploy/);
  assert.doesNotMatch(source, /method:\s*["']POST["']/);
  assert.match(source, /realMessageSendAttempted:\s*false/);
  assert.match(source, /externalMutationCount:\s*0/);
});
