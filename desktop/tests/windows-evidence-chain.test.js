"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  absoluteWindowsPowerShell,
  classifyNativeSmokeFailure,
  cleanupPrivateTemp,
  createPrivateTemp,
  createPrivateSnapshot,
  createTreeManifest,
  evaluateArtifactPolicy,
  findSevenZipExecutable,
  inspectNativeAuthenticode,
  loadReleasePolicy,
  manifestsEqual,
  selectEvidenceProcessEnvironment,
} = require("../tools/windows-evidence-chain");
const { createSmokeWorkspace } = require("../tools/smoke-packaged-api");

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
  cleanupPrivateTemp(snapshot.cleanupHandle);
  assert.equal(fs.existsSync(snapshot.tempRoot), false);
});

test("private temp cleanup rejects a replaced directory and preserves its sentinel", (t) => {
  const handle = createPrivateTemp();
  fs.rmSync(handle.tempRoot, { recursive: true, force: true });
  fs.mkdirSync(handle.tempRoot);
  const sentinel = path.join(handle.tempRoot, "user-sentinel.txt");
  fs.writeFileSync(sentinel, "preserve\n");
  t.after(() => fs.rmSync(handle.tempRoot, { recursive: true, force: true }));
  assert.throws(() => cleanupPrivateTemp(handle), /replaced evidence temp path/);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve\n");
});

test("packaged smoke ignores caller runtime deletion targets and cleans only its minted workspace", (t) => {
  const callerDirectory = temporaryDirectory(t);
  const sentinel = path.join(callerDirectory, "caller-sentinel.txt");
  fs.writeFileSync(sentinel, "preserve\n");
  const previous = process.env.PACKAGED_SMOKE_RUNTIME_DIR;
  process.env.PACKAGED_SMOKE_RUNTIME_DIR = callerDirectory;
  try {
    const workspace = createSmokeWorkspace();
    assert.notEqual(path.resolve(workspace.tempRoot), path.resolve(callerDirectory));
    cleanupPrivateTemp(workspace);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve\n");
  } finally {
    if (previous === undefined) delete process.env.PACKAGED_SMOKE_RUNTIME_DIR;
    else process.env.PACKAGED_SMOKE_RUNTIME_DIR = previous;
  }
});

test("package tree budgets fail quickly on oversized files and excessive depth", (t) => {
  const directory = temporaryDirectory(t);
  fs.writeFileSync(path.join(directory, "large.bin"), "12345");
  assert.throws(() => createTreeManifest(directory, { limits: { maxFileBytes: 4 } }), /maximum size/);
  fs.rmSync(path.join(directory, "large.bin"));
  let current = directory;
  for (let index = 0; index < 4; index += 1) {
    current = path.join(current, `nested-${index}`);
    fs.mkdirSync(current);
  }
  assert.throws(() => createTreeManifest(directory, { limits: { maxDepth: 2 } }), /maximum depth/);
});

test("runtime hangs are FAIL while explicit port occupation is BLOCKED", () => {
  assert.equal(classifyNativeSmokeFailure({ error: { code: "ETIMEDOUT" } }, null).status, "FAIL");
  assert.equal(classifyNativeSmokeFailure({ status: 1, stderr: "timed out waiting for API" }, null).status, "FAIL");
  assert.equal(classifyNativeSmokeFailure({ status: 1, stderr: "listen EADDRINUSE" }, null).status, "BLOCKED");
  assert.equal(classifyNativeSmokeFailure({ error: { code: "ENOENT" } }, null).status, "BLOCKED");
});

test("SystemRoot and windir overrides cannot redirect native Authenticode tooling", () => {
  if (process.platform !== "win32") return;
  const previousRoot = process.env.SystemRoot;
  const previousWinDir = process.env.windir;
  process.env.SystemRoot = "D:\\attacker-windows";
  process.env.windir = "D:\\attacker-windows";
  try {
    const executable = absoluteWindowsPowerShell();
    assert.ok(executable);
    assert.match(executable.toLowerCase(), /^c:\\windows\\system32\\windowspowershell\\v1\.0\\powershell\.exe$/);
    assert.doesNotMatch(executable.toLowerCase(), /attacker-windows/);
  } finally {
    if (previousRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = previousRoot;
    if (previousWinDir === undefined) delete process.env.windir; else process.env.windir = previousWinDir;
  }
});

test("pinned extractor rejects hash replacement and ignores NODE_PATH module injection", (t) => {
  const directory = temporaryDirectory(t);
  const cache = path.join(directory, "cache");
  const executable = path.join(cache, "7zip@1.0.0", "candidate", "bin", "7za.exe");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "not-the-pinned-extractor\n");
  const previous = {
    cache: process.env.ELECTRON_BUILDER_CACHE,
    local: process.env.LOCALAPPDATA,
    nodePath: process.env.NODE_PATH,
  };
  process.env.ELECTRON_BUILDER_CACHE = cache;
  process.env.LOCALAPPDATA = path.join(directory, "empty-local");
  process.env.NODE_PATH = path.join(directory, "fake-modules");
  try {
    const resolution = findSevenZipExecutable();
    assert.equal(resolution.status, "FAIL");
    assert.match(resolution.summary, /replaced|unpinned/i);
  } finally {
    if (previous.cache === undefined) delete process.env.ELECTRON_BUILDER_CACHE; else process.env.ELECTRON_BUILDER_CACHE = previous.cache;
    if (previous.local === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previous.local;
    if (previous.nodePath === undefined) delete process.env.NODE_PATH; else process.env.NODE_PATH = previous.nodePath;
  }
});

test("pinned extractor rejects hard-linked and reparse-point cache entries", (t) => {
  const pinned = findSevenZipExecutable();
  if (pinned.status !== "PASS") return t.skip("host does not have the pinned electron-builder extractor cache");
  const directory = temporaryDirectory(t);
  const previousCache = process.env.ELECTRON_BUILDER_CACHE;
  const previousLocal = process.env.LOCALAPPDATA;
  try {
    const hardlinkCache = path.join(directory, "hardlink-cache");
    const hardlinkExecutable = path.join(hardlinkCache, "7zip@1.0.0", "candidate", "bin", "7za.exe");
    fs.mkdirSync(path.dirname(hardlinkExecutable), { recursive: true });
    fs.copyFileSync(pinned.executable, hardlinkExecutable);
    fs.linkSync(hardlinkExecutable, path.join(path.dirname(hardlinkExecutable), "alias.exe"));
    process.env.ELECTRON_BUILDER_CACHE = hardlinkCache;
    process.env.LOCALAPPDATA = path.join(directory, "empty-local-hardlink");
    assert.equal(findSevenZipExecutable().status, "FAIL");

    const junctionCache = path.join(directory, "junction-cache");
    const junctionTarget = path.join(directory, "junction-target");
    fs.mkdirSync(junctionCache);
    fs.mkdirSync(junctionTarget);
    try {
      fs.symlinkSync(junctionTarget, path.join(junctionCache, "7zip@1.0.0"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "ENOTSUP", "EACCES"].includes(error?.code)) return t.skip("junctions are unavailable on this host");
      throw error;
    }
    process.env.ELECTRON_BUILDER_CACHE = junctionCache;
    process.env.LOCALAPPDATA = path.join(directory, "empty-local-junction");
    assert.equal(findSevenZipExecutable().status, "FAIL");
  } finally {
    if (previousCache === undefined) delete process.env.ELECTRON_BUILDER_CACHE; else process.env.ELECTRON_BUILDER_CACHE = previousCache;
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previousLocal;
  }
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
