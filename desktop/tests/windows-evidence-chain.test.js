"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  cleanupPrivateTemp,
  createPrivateSnapshot,
  createTreeManifest,
  evaluateArtifactPolicy,
  inspectNativeAuthenticode,
  loadReleasePolicy,
  manifestsEqual,
  selectEvidenceProcessEnvironment,
} = require("../tools/windows-evidence-chain");

const TEST_POLICY = {
  configured: true,
  allowedPublisherSubjects: ["CN=Smart Kefu Test Publisher"],
  allowedCertificateThumbprints: ["A".repeat(40)],
  productName: "Smart Kefu",
  executableOriginalFilename: "Smart Kefu.exe",
  installerOriginalFilename: "SmartKefu-Setup-{version}-x64.exe",
  architecture: "x64",
  versionMatch: "semver-prefix",
};

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-chain-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("private snapshot records the complete stable tree and cleans only its exact temp", (t) => {
  const source = temporaryDirectory(t);
  fs.mkdirSync(path.join(source, "nested"));
  fs.writeFileSync(path.join(source, "nested", "artifact.bin"), "artifact\n");
  const snapshot = createPrivateSnapshot(source);
  assert.ok(manifestsEqual(snapshot.sourceManifest, snapshot.snapshotManifest));
  assert.ok(manifestsEqual(snapshot.snapshotManifest, createTreeManifest(snapshot.snapshotDirectory)));
  cleanupPrivateTemp(snapshot.tempRoot);
  assert.equal(fs.existsSync(snapshot.tempRoot), false);
});

test("evidence process environment excludes inherited business credentials", () => {
  const previous = process.env.WECHAT_WORK_SECRET;
  process.env.WECHAT_WORK_SECRET = "must-not-leak";
  try {
    const selected = selectEvidenceProcessEnvironment({ EXPLICIT_SAFE_VALUE: "safe" });
    assert.equal(selected.WECHAT_WORK_SECRET, undefined);
    assert.equal(selected.EXPLICIT_SAFE_VALUE, "safe");
    assert.equal(selected.NODE_OPTIONS, undefined);
    assert.equal(selected.NODE_PATH, undefined);
  } finally {
    if (previous === undefined) delete process.env.WECHAT_WORK_SECRET;
    else process.env.WECHAT_WORK_SECRET = previous;
  }
});

test("checked-in signing identity is explicitly unconfigured and therefore fail-closed", () => {
  const policy = loadReleasePolicy();
  assert.equal(policy.identityStatus, "UNCONFIGURED");
  assert.equal(policy.configured, false);
});

test("a real Microsoft-signed PE cannot satisfy Smart Kefu publisher policy", (t) => {
  if (process.platform !== "win32") return t.skip("native Authenticode is Windows-only");
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const executable = path.join(systemRoot, "System32", "notepad.exe");
  if (!fs.existsSync(executable)) return t.skip("notepad.exe is unavailable");
  const signature = inspectNativeAuthenticode(executable);
  if (signature.status !== "Valid") return t.skip("host cannot validate the system PE signature");
  const result = evaluateArtifactPolicy({
    label: "executable",
    file: executable,
    version: "0.1.0",
    policy: TEST_POLICY,
    signature,
  });
  assert.equal(result.status, "FAIL");
});
