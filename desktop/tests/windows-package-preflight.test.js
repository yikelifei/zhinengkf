"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SCHEMA_VERSION,
  STATUS,
  collectWindowsPackagePreflight,
  parseArgs,
  renderMarkdown,
  writeReports,
} = require("../tools/windows-package-preflight");

const REVISION = "b".repeat(40);

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-win-preflight-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeFixture(root, options = {}) {
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    version: "0.1.0",
    scripts: {
      "package:win:dir": "node tools/build-windows-package.js --dir",
      "package:win:test": "node tools/build-windows-package.js",
      "package:win:signed": "node tools/build-windows-package.js --signed",
      "package:win:verify": "node tools/verify-windows-package.js --expect-unsigned",
    },
    devDependencies: {
      "electron-builder": "26.15.3",
      electron: "42.5.0",
    },
  }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(root, "electron-builder.yml"), [
    "asar: true",
    "files:",
    "  - apps/electron/packaged-runtime.js",
    "  - .package-provenance.json",
    "  - '!.env'",
    "  - '!.runtime/**'",
    "  - '!storage/**'",
    "  - '!logs/**'",
    "extraResources:",
    "  - from: dist/apps/api",
    "  - from: apps/web/.next/standalone",
    "  - from: node_modules/.prisma/client",
    "    to: services/runtime-root/node_modules/.prisma/client",
    "  - from: .package-runtime/node_modules",
    "    to: services/runtime-root/node_modules",
    "win:",
    "  target:",
    "    - target: nsis",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(root, "config", "windows-release-signing-policy.json"), `${JSON.stringify({
    schemaVersion: "smart_kefu_windows_release_signing_policy_v1",
    identityStatus: options.signingConfigured ? "CONFIGURED" : "UNCONFIGURED",
    allowedPublisherSubjects: options.signingConfigured ? ["CN=Smart Kefu"] : [],
    allowedCertificateThumbprints: options.signingConfigured ? ["A".repeat(40)] : [],
  }, null, 2)}\n`, "utf8");
}

test("Windows package preflight blocks dirty local workspaces without building or signing", (t) => {
  const root = temporaryDirectory(t);
  writeFixture(root);
  const report = collectWindowsPackagePreflight({
    desktopRoot: root,
    generatedAt: "2026-07-26T06:00:00.000Z",
    runId: "dirty-fixture",
    repositoryState: { revision: REVISION, clean: false },
  });
  assert.equal(report.schemaVersion, SCHEMA_VERSION);
  assert.equal(report.status, STATUS.BLOCKED);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.results.find((item) => item.id === "repository.clean").status, STATUS.BLOCKED);
  assert.equal(report.results.find((item) => item.id === "config.signing_policy").status, STATUS.BLOCKED);
  assert.equal(report.safety.packagingAttempted, false);
  assert.equal(report.safety.signingAttempted, false);
  assert.equal(report.safety.installerExecuted, false);
});

test("signed-release report can satisfy automated evidence but target Windows evidence remains blocked", (t) => {
  const root = temporaryDirectory(t);
  writeFixture(root, { signingConfigured: true });
  const verificationRoot = path.join(root, "release", "windows", "verification");
  fs.mkdirSync(verificationRoot, { recursive: true });
  fs.writeFileSync(path.join(verificationRoot, "latest.json"), `${JSON.stringify({
    schemaVersion: "smart_kefu_windows_package_verification_v3",
    repositoryRevision: REVISION,
    repositoryClean: true,
    generatedAt: "2026-07-26T06:00:00.000Z",
    status: STATUS.PASS,
    verificationProfile: "signed-release",
  }, null, 2)}\n`, "utf8");
  const report = collectWindowsPackagePreflight({
    desktopRoot: root,
    generatedAt: "2026-07-26T06:00:00.000Z",
    runId: "signed-fixture",
    repositoryState: { revision: REVISION, clean: true },
  });
  assert.equal(report.results.find((item) => item.id === "verification.signed_release").status, STATUS.PASS);
  assert.equal(report.results.find((item) => item.id === "manual.target_windows").status, STATUS.BLOCKED);
  assert.equal(report.status, STATUS.BLOCKED);
});

test("unsigned-test verification failures are blocked evidence gaps, not signed-release failures", (t) => {
  const root = temporaryDirectory(t);
  writeFixture(root);
  const verificationRoot = path.join(root, "release", "windows", "verification");
  fs.mkdirSync(verificationRoot, { recursive: true });
  fs.writeFileSync(path.join(verificationRoot, "latest.json"), `${JSON.stringify({
    schemaVersion: "smart_kefu_windows_package_verification_v3",
    repositoryRevision: REVISION,
    repositoryClean: false,
    generatedAt: "2026-07-26T06:00:00.000Z",
    status: STATUS.FAIL,
    verificationProfile: "unsigned-test",
  }, null, 2)}\n`, "utf8");
  const report = collectWindowsPackagePreflight({
    desktopRoot: root,
    generatedAt: "2026-07-26T06:00:00.000Z",
    runId: "unsigned-failed-fixture",
    repositoryState: { revision: REVISION, clean: false },
  });
  assert.equal(report.results.find((item) => item.id === "verification.signed_release").status, STATUS.BLOCKED);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.status, STATUS.BLOCKED);
});

test("preflight fails closed when packaging scripts drift", (t) => {
  const root = temporaryDirectory(t);
  writeFixture(root);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  delete packageJson.scripts["package:win:signed"];
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  const report = collectWindowsPackagePreflight({
    desktopRoot: root,
    repositoryState: { revision: REVISION, clean: true },
  });
  assert.equal(report.status, STATUS.FAIL);
  assert.match(report.results.find((item) => item.id === "package.scripts").summary, /package:win:signed/);
});

test("preflight reports are written under runtime and CLI remains read-only", (t) => {
  const root = temporaryDirectory(t);
  writeFixture(root);
  const report = collectWindowsPackagePreflight({
    desktopRoot: root,
    generatedAt: "2026-07-26T06:00:00.000Z",
    runId: "write-fixture",
    repositoryState: { revision: REVISION, clean: false },
  });
  const artifacts = writeReports(report, path.join(root, ".runtime", "windows-package-verification"));
  assert.equal(fs.existsSync(artifacts.latestJson), true);
  assert.equal(fs.existsSync(artifacts.latestMarkdown), true);
  assert.match(renderMarkdown(report), /not signed-release evidence/);
  assert.deepEqual(parseArgs([]), { help: false });
  assert.deepEqual(parseArgs(["--help"]), { help: true });
  assert.throws(() => parseArgs(["--execute"]), /unknown argument/);

  const source = fs.readFileSync(path.resolve(__dirname, "..", "tools", "windows-package-preflight.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
  assert.equal(packageJson.scripts["delivery:windows-package-preflight"], "node tools/windows-package-preflight.js");
  assert.doesNotMatch(source, /node:child_process|spawnSync|execFile|execSync|fetch\s*\(/);
  assert.doesNotMatch(source, /Get-AuthenticodeSignature/);
  assert.match(source, /packagingAttempted:\s*false/);
  assert.match(source, /installerExecuted:\s*false/);
});
