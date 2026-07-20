"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SCHEMA_VERSION,
  STATUS,
  parseArgs,
  renderMarkdown,
  validateEvidenceBundle,
} = require("../tools/external-evidence-bundle");

const REVISION = "a".repeat(40);
const OTHER_REVISION = "b".repeat(40);
const NOW = "2026-07-20T12:00:00.000Z";
const STAGING_RESULT_IDS = [
  "config.doctor", "config.environment", "config.database", "config.automation_queue", "config.api_access",
  "config.wechat_work", "config.design_platform", "config.personal_wechat", "config.model_chain",
  "evidence.database_migrations", "evidence.api_health", "evidence.wechat_work", "evidence.design_platform",
  "evidence.personal_wechat", "evidence.automation_queue",
];
const RECOVERY_PREFIX_RESULTS = [
  "safety.source", "safety.target", "safety.distinct", "safety.isolated_target", "safety.confirmation",
  "tools.inventory", "tools.versions",
];
const WINDOWS_CHECKS = [
  "repository worktree clean",
  "unpacked application", "Windows executable entry", "application asar", "packaged API entry",
  "packaged API storage code", "packaged Web entry", "packaged rules entry", "packaged window observer",
  "packaged placeholder-only AI settings", "packaged Prisma client", "packaged generated Prisma client",
  "packaged Sharp runtime", "packaged Sharp Windows native addon", "NSIS installer", "packaged API smoke",
  "asar entry /apps/electron/main.js", "asar entry /apps/electron/preload.js",
  "asar entry /apps/electron/packaged-runtime.js", "asar entry /package.json", "asar entry /.package-provenance.json",
  "asar sensitive top-level paths", "packaged metadata", "packaged repository provenance", "resource sensitive-file scan", "Authenticode signing",
];

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-evidence-bundle-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function reports(root) {
  const installer = writeArtifact(root, "SmartKefu-Setup-0.1.0-x64.exe", "signed installer fixture\n");
  const executable = writeArtifact(root, "win-unpacked/Smart Kefu.exe", "signed executable fixture\n");
  return {
    staging: {
      schemaVersion: "smart_kefu_staging_readiness_v2",
      repositoryRevision: REVISION,
      generatedAt: "2026-07-20T11:00:00.000Z",
      status: "PASS",
      mode: "read-only-execute",
      safety: {
        allowedNetworkMethods: ["GET"],
        databaseWriteAttempted: false,
        realMessageSendAttempted: false,
        designJobSubmitted: false,
        paymentMutationAttempted: false,
        externalMutationCount: 0,
        secretsIncluded: false,
      },
      results: STAGING_RESULT_IDS.map((id) => ({ id, status: "PASS" })),
    },
    recovery: {
      schemaVersion: "smart_kefu_database_recovery_rehearsal_v2",
      repositoryRevision: REVISION,
      generatedAt: "2026-07-19T12:00:00.000Z",
      status: "PASS",
      mode: "execute",
      safety: {
        sourceUrlRecorded: false,
        targetUrlRecorded: false,
        passwordRecorded: false,
        dataContentRecorded: false,
        backupArtifactRetained: false,
        restoreTargetMustBeIsolated: true,
      },
      results: [
        ...RECOVERY_PREFIX_RESULTS.map((id) => ({ id, status: "PASS" })),
        { id: "rehearsal.backup", status: "PASS", evidence: { sha256: "c".repeat(64), bytes: 1024 } },
        { id: "rehearsal.restore", status: "PASS" },
        { id: "evidence.migrations", status: "PASS", evidence: { sourceUpToDate: true, targetUpToDate: true } },
        { id: "evidence.consistency", status: "PASS", evidence: { consistent: true } },
        { id: "rehearsal.execution", status: "PASS", evidence: { commandsExecuted: 10 } },
      ],
    },
    windows: {
      schemaVersion: "smart_kefu_windows_package_verification_v3",
      repositoryRevision: REVISION,
      repositoryClean: true,
      generatedAt: "2026-07-20T10:00:00.000Z",
      status: "PASS",
      verificationProfile: "signed-release",
      version: "0.1.0",
      installer,
      executable,
      signatures: [
        { file: executable.file, status: "Valid" },
        { file: installer.file, status: "Valid" },
      ],
      checks: WINDOWS_CHECKS.map((name) => ({ name, status: "PASS" })),
    },
  };
}

function writeReports(root, values = reports(root)) {
  const paths = {
    staging: path.join(root, "staging.json"),
    recovery: path.join(root, "recovery.json"),
    windows: path.join(root, "windows.json"),
  };
  for (const [name, filePath] of Object.entries(paths)) {
    fs.writeFileSync(filePath, `${JSON.stringify(values[name], null, 2)}\n`, "utf8");
  }
  return paths;
}

function validate(root, overrides = {}) {
  return validateEvidenceBundle({
    evidenceRoot: root,
    stagingReport: "staging.json",
    recoveryReport: "recovery.json",
    windowsReport: "windows.json",
    currentRevision: REVISION,
    now: NOW,
    verifySignature: () => ({ status: "Valid" }),
    ...overrides,
  });
}

function writeArtifact(root, relative, content) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  const bytes = fs.statSync(file).size;
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return { file, bytes, sha256 };
}

test("matching fresh PASS evidence is accepted but SmartScreen stays explicitly BLOCKED", (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  const report = validate(root);
  assert.equal(report.schemaVersion, SCHEMA_VERSION);
  assert.equal(report.repositoryRevision, REVISION);
  assert.equal(report.status, STATUS.BLOCKED);
  assert.deepEqual(
    report.results.filter((item) => item.id.startsWith("evidence.")).map((item) => [item.id, item.status]),
    [
      ["evidence.staging", STATUS.PASS],
      ["evidence.database_recovery", STATUS.PASS],
      ["evidence.windows_package", STATUS.PASS],
    ],
  );
  assert.equal(report.results.find((item) => item.id === "manual.windows_smartscreen").status, STATUS.BLOCKED);
  assert.match(renderMarkdown(report), /SmartScreen/);
  assert.deepEqual(report.safety, {
    localFilesReadOnly: true,
    networkAttempted: false,
    packagingAttempted: false,
    databaseCommandAttempted: false,
    recoveryAttempted: false,
    realMessageSendAttempted: false,
    externalMutationCount: 0,
    secretsIncluded: false,
  });
});

test("old revision, expired evidence and v1 schema remain BLOCKED", (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  values.staging.repositoryRevision = OTHER_REVISION;
  values.recovery.generatedAt = "2026-05-01T00:00:00.000Z";
  values.windows.schemaVersion = "smart_kefu_windows_package_verification_v1";
  writeReports(root, values);
  const report = validate(root);
  assert.equal(report.status, STATUS.BLOCKED);
  assert.match(report.results.find((item) => item.id === "evidence.staging").summary, /revision/i);
  assert.match(report.results.find((item) => item.id === "evidence.database_recovery").summary, /expired/i);
  assert.match(report.results.find((item) => item.id === "evidence.windows_package").summary, /schema/i);
});

test("unsigned package verification never satisfies signed release evidence", (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  values.windows.status = "BLOCKED";
  values.windows.verificationProfile = "unsigned-test";
  values.windows.signatures = [{ status: "NotSigned" }, { status: "NotSigned" }];
  values.windows.checks.find((item) => item.name === "Authenticode signing").status = "BLOCKED";
  writeReports(root, values);
  const report = validate(root);
  const windows = report.results.find((item) => item.id === "evidence.windows_package");
  assert.equal(windows.status, STATUS.BLOCKED);
  assert.match(windows.summary, /unsigned|signed release/i);
});

test("forged PASS with missing safety fields fails closed", (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  delete values.recovery.safety.backupArtifactRetained;
  writeReports(root, values);
  const report = validate(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "evidence.database_recovery").status, STATUS.FAIL);
});

test("forged PASS cannot omit fixed staging results or Windows checks", (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  values.staging.results = values.staging.results.filter((item) => item.id !== "config.api_access");
  values.windows.checks = values.windows.checks.filter((item) => item.name !== "NSIS installer");
  writeReports(root, values);
  const report = validate(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "evidence.staging").status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("signed package evidence requires clean repository provenance", (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  values.windows.repositoryClean = false;
  writeReports(root, values);
  const report = validate(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("signed release evidence binds each valid signature to an exact artifact", (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  values.windows.signatures = [
    { file: values.windows.executable.file, status: "Valid" },
    { file: values.windows.executable.file, status: "Valid" },
  ];
  writeReports(root, values);
  const report = validate(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("Windows evidence reopens artifacts and rejects missing or changed bytes", (t) => {
  const root = temporaryDirectory(t);
  const changed = reports(root);
  fs.appendFileSync(changed.windows.installer.file, "tampered\n", "utf8");
  writeReports(root, changed);
  let report = validate(root);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);

  const missing = reports(root);
  missing.windows.installer.file = path.join(root, "missing-installer.exe");
  missing.windows.signatures[1].file = missing.windows.installer.file;
  writeReports(root, missing);
  report = validate(root);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("Windows evidence re-verifies Authenticode and blocks when the host cannot verify it", (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  const invalid = validate(root, { verifySignature: () => ({ status: "NotSigned" }) });
  assert.equal(invalid.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);

  const unavailable = validate(root, { verifySignature: () => ({ status: "Unavailable", unavailable: true }) });
  assert.equal(unavailable.results.find((item) => item.id === "evidence.windows_package").status, STATUS.BLOCKED);
});

test("secret-bearing input fails without copying the secret into the bundle", (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  const secret = "redis://operator:super-secret@redis.internal:6379/0";
  values.staging.redisUrl = secret;
  writeReports(root, values);
  const report = validate(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("missing files and paths outside the explicit evidence root are FAIL", (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  fs.rmSync(path.join(root, "recovery.json"));
  assert.equal(validate(root).status, STATUS.FAIL);
  const outside = path.join(path.dirname(root), "outside-evidence.json");
  fs.writeFileSync(outside, "{}\n", "utf8");
  t.after(() => fs.rmSync(outside, { force: true }));
  assert.equal(validate(root, { stagingReport: outside }).status, STATUS.FAIL);
});

test("CLI requires an explicit root and all three report paths", () => {
  const args = [
    "--evidence-root", "C:/evidence",
    "--staging-report", "staging.json",
    "--recovery-report", "recovery.json",
    "--windows-report", "windows.json",
  ];
  assert.deepEqual(parseArgs(args), {
    evidenceRoot: "C:/evidence",
    stagingReport: "staging.json",
    recoveryReport: "recovery.json",
    windowsReport: "windows.json",
    help: false,
  });
  assert.throws(() => parseArgs([]), /required/);
  assert.throws(() => parseArgs(["--evidence-root", "C:/evidence"]), /required/);
  assert.throws(() => parseArgs([...args, "--execute"]), /unknown argument/);
});

test("source contract is local read-only and package script is explicit", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "tools", "external-evidence-bundle.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
  assert.match(packageJson.scripts["external:evidence:bundle"], /external-evidence-bundle\.js$/);
  assert.match(source, /Get-AuthenticodeSignature/);
  assert.match(source, /sha256File\(file\)/);
  assert.match(source, /stat\.size !== reported\.bytes/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /writeFile|appendFile|rmSync|unlink/);
  assert.doesNotMatch(source, /prisma|pg_dump|pg_restore|electron-builder|send_msg|method:\s*["']POST/);
});
