"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
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
  __createTestEvidenceBundleValidator,
} = require("../tools/external-evidence-bundle");

const REVISION = "a".repeat(40);
const OTHER_REVISION = "b".repeat(40);
const NOW = "2026-07-20T12:00:00.000Z";
const STAGING_RESULT_IDS = [
  "config.doctor", "config.environment", "config.database", "config.automation_queue", "config.api_access",
  "config.wechat_work", "config.design_platform", "config.model_chain",
  "evidence.database_migrations", "evidence.api_health", "evidence.wechat_work", "evidence.design_platform",
  "evidence.automation_queue",
];
const RECOVERY_PREFIX_RESULTS = [
  "safety.source", "safety.target", "safety.distinct", "safety.isolated_target", "safety.confirmation",
  "tools.inventory", "tools.versions",
];
const WINDOWS_CHECKS = [
  "repository worktree clean",
  "unpacked application", "Windows executable entry", "Windows executable PE format", "application asar", "packaged API entry",
  "packaged API storage code", "packaged Web entry", "packaged rules entry", "packaged window observer",
  "packaged placeholder-only AI settings", "packaged Prisma client", "packaged generated Prisma client",
  "packaged Sharp runtime", "packaged Sharp Windows native addon", "NSIS installer", "NSIS installer PE format", "packaged API smoke",
  "asar entry /apps/electron/main.js", "asar entry /apps/electron/preload.js",
  "asar entry /apps/electron/packaged-runtime.js", "asar entry /apps/electron/desktop-session-refresh.js",
  "asar entry /package.json", "asar entry /.package-provenance.json",
  "asar sensitive top-level paths", "packaged metadata", "packaged repository provenance", "resource sensitive-file scan", "Authenticode signing",
];
let cachedAsarFixture = null;
const TEST_POLICY = Object.freeze({
  schemaVersion: "smart_kefu_windows_release_signing_policy_v1",
  identityStatus: "CONFIGURED",
  allowedPublisherSubjects: ["CN=Smart Kefu Test Publisher"],
  allowedCertificateThumbprints: ["A".repeat(40)],
  productName: "Smart Kefu",
  executableOriginalFilename: "Smart Kefu.exe",
  installerOriginalFilename: "SmartKefu-Setup-{version}-x64.exe",
  architecture: "x64",
  installerFormat: "electron-builder-nsis",
  versionMatch: "semver-prefix",
  configured: true,
});

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-evidence-bundle-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function reports(root) {
  const { installer, executable } = createWindowsPackageFixture(root);
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

async function validate(root, overrides = {}) {
  const verifySignature = overrides.verifySignature || ((file, label) => ({
    status: "Valid",
    subject: "CN=Smart Kefu Test Publisher",
    thumbprint: "A".repeat(40),
    productName: "Smart Kefu",
    originalFilename: label === "installer" ? "SmartKefu-Setup-0.1.0-x64.exe" : "Smart Kefu.exe",
    productVersion: "0.1.0",
    fileVersion: "0.1.0",
    mode: "test-only",
  }));
  const validator = __createTestEvidenceBundleValidator({
    verifySignature,
    runPackagedSmoke: overrides.runPackagedSmoke || (() => ({ status: "PASS", summary: "test smoke passed", mode: "test-only" })),
    verifyInstallerBinding: overrides.verifyInstallerBinding || (() => ({ status: "PASS", summary: "test installer binding passed", mode: "test-only" })),
    releasePolicy: overrides.releasePolicy || TEST_POLICY,
  });
  const bundleOptions = { ...overrides };
  delete bundleOptions.verifySignature;
  delete bundleOptions.runPackagedSmoke;
  delete bundleOptions.verifyInstallerBinding;
  delete bundleOptions.releasePolicy;
  return validator({
    evidenceRoot: root,
    stagingReport: "staging.json",
    recoveryReport: "recovery.json",
    windowsReport: "windows.json",
    currentRevision: REVISION,
    now: NOW,
    ...bundleOptions,
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

function writePeArtifact(root, relative, marker = 0) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = Buffer.alloc(256);
  content.write("MZ", 0, "ascii");
  content.writeUInt32LE(128, 0x3c);
  content.write("PE\0\0", 128, "binary");
  content.writeUInt16LE(0x8664, 132);
  content.writeUInt16LE(0xf0, 148);
  content.writeUInt16LE(0x20b, 152);
  content[200] = marker;
  fs.writeFileSync(file, content);
  const bytes = fs.statSync(file).size;
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  return { file, bytes, sha256 };
}

function createWindowsPackageFixture(root) {
  const installer = writePeArtifact(root, "SmartKefu-Setup-0.1.0-x64.exe", 1);
  const executable = writePeArtifact(root, "win-unpacked/Smart Kefu.exe", 2);
  const resources = path.join(root, "win-unpacked", "resources");
  const requiredResources = [
    "services/api/main.js",
    "services/api/storage/storage.service.js",
    "services/web/apps/web/server.js",
    "services/runtime-root/packages/rules/index.js",
    "services/runtime-root/tools/wechat-window-observer.js",
    "services/runtime-root/config/settings.yaml",
    "services/runtime-root/node_modules/@prisma/client/default.js",
    "services/runtime-root/node_modules/.prisma/client/default.js",
    "services/runtime-root/node_modules/sharp/dist/index.cjs",
    "services/runtime-root/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.3.node",
  ];
  for (const relative of requiredResources) writeArtifact(resources, relative, "fixture\n");
  writeArtifact(root, "verification/packaged-api-smoke.json", `${JSON.stringify({ status: "PASS" })}\n`);

  const asarSource = path.join(root, "asar-source");
  writeArtifact(asarSource, "apps/electron/main.js", "module.exports = {};\n");
  writeArtifact(asarSource, "apps/electron/preload.js", "module.exports = {};\n");
  writeArtifact(asarSource, "apps/electron/packaged-runtime.js", "module.exports = {};\n");
  writeArtifact(asarSource, "apps/electron/desktop-session-refresh.js", "module.exports = {};\n");
  writeArtifact(asarSource, "package.json", `${JSON.stringify({ version: "0.1.0", main: "apps/electron/main.js" })}\n`);
  writeArtifact(asarSource, ".package-provenance.json", `${JSON.stringify({
    schemaVersion: "smart_kefu_package_provenance_v1",
    repositoryRevision: REVISION,
    repositoryClean: true,
    packageVersion: "0.1.0",
    generatedAt: new Date().toISOString(),
  })}\n`);
  const asarPath = path.join(resources, "app.asar");
  fs.mkdirSync(resources, { recursive: true });
  if (cachedAsarFixture) {
    fs.writeFileSync(asarPath, cachedAsarFixture);
  } else {
    const createAsar = spawnSync(
      process.execPath,
      ["-e", "require('@electron/asar').createPackage(process.argv[1], process.argv[2]).catch((error) => { console.error(error); process.exit(1); })", asarSource, asarPath],
      { cwd: path.resolve(__dirname, ".."), encoding: "utf8", windowsHide: true, shell: false },
    );
    assert.equal(createAsar.status, 0, createAsar.stderr || createAsar.stdout);
    cachedAsarFixture = fs.readFileSync(asarPath);
  }
  return { installer, executable };
}

test("matching fresh PASS evidence is accepted but SmartScreen stays explicitly BLOCKED", async (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  const report = await validate(root);
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
  const windows = report.results.find((item) => item.id === "evidence.windows_package");
  assert.equal(windows.evidence.packageContentReverified, true);
  assert.equal(windows.evidence.distinctRegularArtifacts, true);
  assert.equal(windows.evidence.packageVerificationStatus, STATUS.PASS);
  assert.equal(report.verificationMode, "test-only");
  assert.equal(windows.evidence.nativeEvidenceEligible, false);
  assert.match(renderMarkdown(report), /SmartScreen/);
  assert.deepEqual(report.safety, {
    evidenceInputFilesModified: false,
    temporaryFilesWritten: true,
    localToolExecutionAttempted: true,
    packagedRuntimeExecutionAttempted: true,
    localhostHttpAttempted: true,
    packagingAttempted: false,
    databaseCommandAttempted: false,
    recoveryAttempted: false,
    realMessageSendAttempted: false,
    externalMutationIsolation: "minimal environment and temporary roots; not an OS sandbox",
    secretsIncluded: false,
  });
});

test("runtime smoke is never called before content, publisher policy and installer binding trust", async (t) => {
  const scenarios = [
    {
      name: "signature",
      overrides: { verifySignature: () => ({ status: "NotSigned" }) },
      expectedBindingCalls: 0,
    },
    {
      name: "policy",
      overrides: { releasePolicy: { ...TEST_POLICY, identityStatus: "UNCONFIGURED", configured: false } },
      expectedBindingCalls: 0,
    },
    {
      name: "binding",
      overrides: { verifyInstallerBinding: () => ({ status: "FAIL", summary: "binding mismatch", mode: "test-only" }) },
      expectedBindingCalls: 1,
    },
  ];
  for (const scenario of scenarios) {
    const root = temporaryDirectory(t);
    writeReports(root);
    let bindingCalls = 0;
    let smokeCalls = 0;
    const report = await validate(root, {
      ...scenario.overrides,
      verifyInstallerBinding: scenario.overrides.verifyInstallerBinding
        ? (...args) => { bindingCalls += 1; return scenario.overrides.verifyInstallerBinding(...args); }
        : () => { bindingCalls += 1; return { status: "PASS", mode: "test-only" }; },
      runPackagedSmoke: () => { smokeCalls += 1; return { status: "PASS", mode: "test-only" }; },
    });
    assert.notEqual(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.PASS, scenario.name);
    assert.equal(bindingCalls, scenario.expectedBindingCalls, scenario.name);
    assert.equal(smokeCalls, 0, scenario.name);
  }
});

test("trusted Windows checks run in content-signature-binding-smoke order", async (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  const calls = [];
  const report = await validate(root, {
    verifySignature: (file, label) => {
      calls.push(`signature:${label}`);
      return {
        status: "Valid", subject: "CN=Smart Kefu Test Publisher", thumbprint: "A".repeat(40),
        productName: "Smart Kefu", originalFilename: label === "installer" ? "SmartKefu-Setup-0.1.0-x64.exe" : "Smart Kefu.exe",
        productVersion: "0.1.0",
      };
    },
    verifyInstallerBinding: () => { calls.push("binding"); return { status: "PASS", mode: "test-only" }; },
    runPackagedSmoke: () => { calls.push("smoke"); return { status: "PASS", mode: "test-only" }; },
  });
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.PASS);
  assert.deepEqual(calls, ["signature:installer", "signature:executable", "binding", "smoke"]);
});

test("content failure prevents signature, installer parsing and runtime execution", async (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  fs.rmSync(path.join(root, "win-unpacked", "resources", "services", "api", "main.js"));
  let signatureCalls = 0;
  let bindingCalls = 0;
  let smokeCalls = 0;
  const report = await validate(root, {
    verifySignature: () => { signatureCalls += 1; return { status: "Valid" }; },
    verifyInstallerBinding: () => { bindingCalls += 1; return { status: "PASS", mode: "test-only" }; },
    runPackagedSmoke: () => { smokeCalls += 1; return { status: "PASS", mode: "test-only" }; },
  });
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
  assert.equal(signatureCalls, 0);
  assert.equal(bindingCalls, 0);
  assert.equal(smokeCalls, 0);
});

test("thrown chain hooks preserve completed snapshot, signature, tool and runtime attempt truth", async (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  const bindingFailure = await validate(root, {
    verifyInstallerBinding: () => { throw new Error("synthetic binding crash"); },
  });
  const bindingWindows = bindingFailure.results.find((item) => item.id === "evidence.windows_package");
  assert.equal(bindingWindows.status, STATUS.FAIL);
  assert.equal(bindingWindows.evidence.temporaryFilesWritten, true);
  assert.equal(bindingWindows.evidence.privateSnapshotCreated, true);
  assert.equal(bindingWindows.evidence.signatureInspectionAttempted, true);
  assert.equal(bindingWindows.evidence.installerBindingAttempted, true);
  assert.equal(bindingWindows.evidence.runtimeSmokeExecuted, false);
  assert.equal(bindingFailure.safety.temporaryFilesWritten, true);
  assert.equal(bindingFailure.safety.localToolExecutionAttempted, true);
  assert.equal(bindingFailure.safety.packagedRuntimeExecutionAttempted, false);

  const runtimeFailure = await validate(root, {
    runPackagedSmoke: () => { throw new Error("synthetic runtime crash"); },
  });
  const runtimeWindows = runtimeFailure.results.find((item) => item.id === "evidence.windows_package");
  assert.equal(runtimeWindows.status, STATUS.FAIL);
  assert.equal(runtimeWindows.evidence.temporaryFilesWritten, true);
  assert.equal(runtimeWindows.evidence.privateSnapshotCreated, true);
  assert.equal(runtimeWindows.evidence.signatureInspectionAttempted, true);
  assert.equal(runtimeWindows.evidence.installerBindingAttempted, true);
  assert.equal(runtimeWindows.evidence.runtimeSmokeExecuted, true);
  assert.equal(runtimeFailure.safety.temporaryFilesWritten, true);
  assert.equal(runtimeFailure.safety.localToolExecutionAttempted, true);
  assert.equal(runtimeFailure.safety.packagedRuntimeExecutionAttempted, true);
  assert.equal(runtimeFailure.safety.localhostHttpAttempted, true);
});

test("old revision, expired evidence and v1 schema remain BLOCKED", async (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  values.staging.repositoryRevision = OTHER_REVISION;
  values.recovery.generatedAt = "2026-05-01T00:00:00.000Z";
  values.windows.schemaVersion = "smart_kefu_windows_package_verification_v1";
  writeReports(root, values);
  const report = await validate(root);
  assert.equal(report.status, STATUS.BLOCKED);
  assert.match(report.results.find((item) => item.id === "evidence.staging").summary, /revision/i);
  assert.match(report.results.find((item) => item.id === "evidence.database_recovery").summary, /expired/i);
  assert.match(report.results.find((item) => item.id === "evidence.windows_package").summary, /schema/i);
});

test("unsigned package verification never satisfies signed release evidence", async (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  values.windows.status = "BLOCKED";
  values.windows.verificationProfile = "unsigned-test";
  values.windows.signatures = [{ status: "NotSigned" }, { status: "NotSigned" }];
  values.windows.checks.find((item) => item.name === "Authenticode signing").status = "BLOCKED";
  writeReports(root, values);
  const report = await validate(root);
  const windows = report.results.find((item) => item.id === "evidence.windows_package");
  assert.equal(windows.status, STATUS.BLOCKED);
  assert.match(windows.summary, /unsigned|signed release/i);
});

test("forged PASS with missing safety fields fails closed", async (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  delete values.recovery.safety.backupArtifactRetained;
  writeReports(root, values);
  const report = await validate(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "evidence.database_recovery").status, STATUS.FAIL);
});

test("forged PASS cannot omit fixed staging results or Windows checks", async (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  values.staging.results = values.staging.results.filter((item) => item.id !== "config.api_access");
  values.windows.checks = values.windows.checks.filter((item) => item.name !== "NSIS installer");
  writeReports(root, values);
  const report = await validate(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "evidence.staging").status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("signed package evidence requires clean repository provenance", async (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  values.windows.repositoryClean = false;
  writeReports(root, values);
  const report = await validate(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("signed release evidence binds each valid signature to an exact artifact", async (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  values.windows.signatures = [
    { file: values.windows.executable.file, status: "Valid" },
    { file: values.windows.executable.file, status: "Valid" },
  ];
  writeReports(root, values);
  const report = await validate(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("forged PASS checks and injected Valid signature cannot turn one arbitrary exe into two artifacts", async (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  const arbitrary = writePeArtifact(root, "arbitrary.exe");
  values.windows.installer = arbitrary;
  values.windows.executable = arbitrary;
  values.windows.signatures = [
    { file: arbitrary.file, status: "Valid" },
    { file: arbitrary.file, status: "Valid" },
  ];
  values.windows.checks = WINDOWS_CHECKS.map((name) => ({ name, status: "PASS" }));
  writeReports(root, values);
  const report = await validate(root, { verifySignature: () => ({ status: "Valid" }) });
  const windows = report.results.find((item) => item.id === "evidence.windows_package");
  assert.equal(windows.status, STATUS.FAIL);
  assert.equal(windows.evidence.signedArtifactContractValid, false);
  assert.match(windows.summary, /distinct|signature/i);
});

test("Windows evidence rejects hard-linked artifact aliases", async (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  const installerPath = values.windows.installer.file;
  fs.rmSync(installerPath);
  try {
    fs.linkSync(values.windows.executable.file, installerPath);
  } catch (error) {
    if (["EPERM", "ENOTSUP"].includes(error?.code)) return t.skip("hard links are unavailable on this host");
    throw error;
  }
  const bytes = fs.statSync(installerPath).size;
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(installerPath)).digest("hex");
  values.windows.installer = { file: installerPath, bytes, sha256 };
  values.windows.signatures[1].file = installerPath;
  writeReports(root, values);
  const report = await validate(root);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("Windows evidence reopens artifacts and rejects missing or changed bytes", async (t) => {
  const root = temporaryDirectory(t);
  const changed = reports(root);
  fs.appendFileSync(changed.windows.installer.file, "tampered\n", "utf8");
  writeReports(root, changed);
  let report = await validate(root);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);

  const missing = reports(root);
  missing.windows.installer.file = path.join(root, "missing-installer.exe");
  missing.windows.signatures[1].file = missing.windows.installer.file;
  writeReports(root, missing);
  report = await validate(root);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("Windows evidence re-verifies Authenticode and blocks when the host cannot verify it", async (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  const invalid = await validate(root, { verifySignature: () => ({ status: "NotSigned" }) });
  assert.equal(invalid.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);

  const unavailable = await validate(root, { verifySignature: () => ({ status: "Unavailable", unavailable: true }) });
  assert.equal(unavailable.results.find((item) => item.id === "evidence.windows_package").status, STATUS.BLOCKED);
});

test("a different valid publisher cannot satisfy the checked-in release policy", async (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  const report = await validate(root, {
    verifySignature: () => ({
      status: "Valid",
      subject: "CN=Microsoft Windows, O=Microsoft Corporation",
      thumbprint: "B".repeat(40),
      productName: "Microsoft Windows",
      originalFilename: "notepad.exe",
      productVersion: "10.0.0.0",
    }),
  });
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("stored smoke PASS cannot replace snapshot runtime execution", async (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  const report = await validate(root, {
    runPackagedSmoke: () => ({ status: "BLOCKED", summary: "native runner unavailable", mode: "test-only" }),
  });
  const windows = report.results.find((item) => item.id === "evidence.windows_package");
  assert.equal(windows.status, STATUS.BLOCKED);
  assert.equal(windows.evidence.packageContentReverified, false);
});

test("installer payload mismatch fails even when report checks and signatures say PASS", async (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  const report = await validate(root, {
    verifyInstallerBinding: () => ({ status: "FAIL", summary: "payload manifest mismatch", mode: "test-only" }),
  });
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("snapshot manifest detects package mutation during verification", async (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  const report = await validate(root, {
    runPackagedSmoke: ({ outputDirectory }) => {
      const target = path.join(outputDirectory, "win-unpacked", "resources", "services", "api", "main.js");
      fs.chmodSync(target, 0o600);
      fs.appendFileSync(target, "mutated during verification\n", "utf8");
      return { status: "PASS", summary: "test hook returned PASS", mode: "test-only" };
    },
  });
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("package snapshot rejects directory junctions instead of skipping them", async (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-junction-target-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const junction = path.join(root, "win-unpacked", "resources", "linked-services");
  try {
    fs.symlinkSync(target, junction, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "ENOTSUP", "EACCES"].includes(error?.code)) return t.skip("junctions are unavailable on this host");
    throw error;
  }
  const report = await validate(root);
  assert.equal(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.FAIL);
});

test("secret-bearing input fails without copying the secret into the bundle", async (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  const secret = "redis://operator:super-secret@redis.internal:6379/0";
  values.staging.redisUrl = secret;
  writeReports(root, values);
  const report = await validate(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("missing files and paths outside the explicit evidence root are FAIL", async (t) => {
  const root = temporaryDirectory(t);
  writeReports(root);
  fs.rmSync(path.join(root, "recovery.json"));
  assert.equal((await validate(root)).status, STATUS.FAIL);
  const outside = path.join(path.dirname(root), "outside-evidence.json");
  fs.writeFileSync(outside, "{}\n", "utf8");
  t.after(() => fs.rmSync(outside, { force: true }));
  assert.equal((await validate(root, { stagingReport: outside })).status, STATUS.FAIL);
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

test("production validator ignores injected verifier and runner options", async (t) => {
  const root = temporaryDirectory(t);
  const values = reports(root);
  values.windows.schemaVersion = "smart_kefu_windows_package_verification_v1";
  writeReports(root, values);
  let called = false;
  const report = await validateEvidenceBundle({
    evidenceRoot: root,
    stagingReport: "staging.json",
    recoveryReport: "recovery.json",
    windowsReport: "windows.json",
    currentRevision: REVISION,
    now: NOW,
    verifySignature: () => { called = true; return { status: "Valid" }; },
    runPackagedSmoke: () => { called = true; return { status: "PASS" }; },
    verifyInstallerBinding: () => { called = true; return { status: "PASS" }; },
  });
  assert.equal(called, false);
  assert.equal(report.verificationMode, "native");
  assert.notEqual(report.results.find((item) => item.id === "evidence.windows_package").status, STATUS.PASS);
});

test("source contract is local read-only and package script is explicit", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "tools", "external-evidence-bundle.js"), "utf8");
  const chain = fs.readFileSync(path.resolve(__dirname, "..", "tools", "windows-evidence-chain.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
  assert.match(packageJson.scripts["external:evidence:bundle"], /external-evidence-bundle\.js$/);
  assert.match(chain, /Get-AuthenticodeSignature/);
  assert.match(chain, /System32[\s\S]*WindowsPowerShell[\s\S]*powershell\.exe/);
  assert.match(chain, /createPrivateSnapshot/);
  assert.match(chain, /verifyNativeInstallerBinding/);
  assert.match(source, /sha256File\(file\)/);
  assert.match(source, /stat\.size !== BigInt\(reported\.bytes\)/);
  assert.match(source, /stat\.nlink !== 1n/);
  assert.match(source, /inspectDistinctArtifacts/);
  assert.match(source, /verifyWindowsPackage\(\{/);
  assert.match(source, /liveChecksFail/);
  assert.doesNotMatch(source, /options\.verifySignature/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /writeFile|appendFile|rmSync|unlink/);
  assert.doesNotMatch(source, /prisma|pg_dump|pg_restore|electron-builder|send_msg|method:\s*["']POST/);
});
