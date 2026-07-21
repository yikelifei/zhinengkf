"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  DEFAULT_EXTRACTION_LIMITS,
  absoluteWindowsPowerShell,
  classifyNativeSmokeFailure,
  cleanupPrivateTemp,
  createPrivateTemp,
  createPrivateSnapshot,
  createTreeManifest,
  evaluateArtifactPolicy,
  findSevenZipExecutable,
  inspectArchiveBudget,
  inspectNativeAuthenticode,
  loadReleasePolicy,
  manifestsEqual,
  selectEvidenceProcessEnvironment,
  runVerifiedArchiveExtraction,
  validateSevenZipListing,
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

test("failed private temp marker creation reports its write truth and leaves no owned directory", (t) => {
  const originalWrite = fs.writeFileSync;
  const originalMkdtemp = fs.mkdtempSync;
  let mintedDirectory = "";
  fs.mkdtempSync = (...args) => {
    mintedDirectory = originalMkdtemp(...args);
    return mintedDirectory;
  };
  fs.writeFileSync = (file, ...args) => {
    if (path.basename(String(file)) === ".smart-kefu-private-temp.json") throw new Error("synthetic marker write failure");
    return originalWrite(file, ...args);
  };
  let failure;
  try {
    createPrivateTemp();
  } catch (error) {
    failure = error;
  } finally {
    fs.writeFileSync = originalWrite;
    fs.mkdtempSync = originalMkdtemp;
  }
  t.after(() => { if (mintedDirectory) fs.rmSync(mintedDirectory, { recursive: true, force: true }); });
  assert.equal(failure?.temporaryFilesWritten, true);
  assert.match(path.basename(mintedDirectory), /^smart-kefu-windows-evidence-/);
  assert.equal(fs.existsSync(mintedDirectory), false);
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

test("7-Zip technical listings reject bombs, unsafe paths and every extraction budget before extraction", () => {
  const listing = (entries) => entries.map((entry) => [
    `Path = ${entry.path}`,
    ...(entry.directory ? ["Folder = +"] : [`Size = ${entry.size}`, "Packed Size = 1", "Folder = -"]),
  ].join("\n")).join("\n\n");
  const good = listing([
    { path: "$PLUGINSDIR", directory: true },
    { path: "$PLUGINSDIR/app-64.7z", size: 100 },
  ]);
  const accepted = validateSevenZipListing(good, {
    archiveBytes: 80,
    limits: { maxCompressionRatio: 10 },
  });
  assert.equal(accepted.totals.files, 1);
  assert.equal(accepted.totals.totalBytes, 100);
  assert.equal(accepted.entries[1].path, "$PLUGINSDIR/app-64.7z");

  assert.throws(() => validateSevenZipListing(good, {
    archiveBytes: 80,
    limits: { maxFileBytes: 99 },
  }), /maximum size/);
  assert.throws(() => validateSevenZipListing(listing([
    { path: "one.bin", size: 60 },
    { path: "two.bin", size: 60 },
  ]), {
    archiveBytes: 80,
    limits: { maxTotalBytes: 100 },
  }), /maximum total bytes/);
  assert.throws(() => validateSevenZipListing(listing([{ path: "a/b/c.bin", size: 1 }]), {
    archiveBytes: 1,
    limits: { maxDepth: 2 },
  }), /maximum path depth/);
  assert.throws(() => validateSevenZipListing(listing([
    { path: "one.bin", size: 1 },
    { path: "two.bin", size: 1 },
  ]), {
    archiveBytes: 1,
    limits: { maxEntries: 1 },
  }), /maximum entry count/);
  assert.throws(() => validateSevenZipListing(listing([{ path: "bomb.bin", size: 201 }]), {
    archiveBytes: 1,
    limits: { maxCompressionRatio: 200 },
  }), /maximum compression ratio/);
  assert.throws(() => validateSevenZipListing(listing([{ path: "../escape.bin", size: 1 }]), {
    archiveBytes: 1,
  }), /unsafe entry path/);
  assert.throws(() => validateSevenZipListing(listing([{ path: "safe.bin:alternate-stream", size: 1 }]), {
    archiveBytes: 1,
  }), /Windows-unsafe entry path/);

  const realSevenZipSymlinkListing = [
    "Path = link",
    "Folder = -",
    "Size = 14",
    "Packed Size = 14",
    "Attributes =  lrwxrwxrwx",
    "",
    "Path = link\\escaped.txt",
    "Folder = -",
    "Size = 7",
    "Packed Size = 7",
    "Attributes =  01800000",
  ].join("\n");
  assert.throws(() => validateSevenZipListing(realSevenZipSymlinkListing, {
    archiveBytes: 235,
  }), /linked or reparse entry/);
  assert.throws(() => validateSevenZipListing([
    "Path = hard-link.bin", "Folder = -", "Size = 1", "Hard Link = original.bin",
  ].join("\n"), { archiveBytes: 1 }), /linked or reparse entry/);
  assert.throws(() => validateSevenZipListing([
    "Path = reparse", "Folder = +", "Reparse Point = +",
  ].join("\n"), { archiveBytes: 1 }), /linked or reparse entry/);
  assert.throws(() => validateSevenZipListing(listing([
    { path: "file-parent", size: 1 },
    { path: "file-parent/child.bin", size: 1 },
  ]), { archiveBytes: 1 }), /file is an ancestor/);

  const source = fs.readFileSync(path.resolve(__dirname, "../tools/windows-evidence-chain.js"), "utf8");
  const preflight = source.indexOf("inspectArchiveBudget(sevenZip, installer");
  const extraction = source.indexOf("const outerResult = runVerifiedArchiveExtraction");
  assert.ok(preflight >= 0 && extraction > preflight, "installer archive list preflight must precede extraction");
  assert.match(source, /assertArchiveIdentity\(archive, budget\.archiveIdentity\)[\s\S]*?return runSevenZip/);
  assert.match(source, /findNamedFile\(outer, "app-64\.7z", extractionLimits\)/);
  assert.equal(DEFAULT_EXTRACTION_LIMITS.maxTotalBytes, 2 * 1024 * 1024 * 1024);
});

test("archive replacement after list preflight fails before the pinned extractor can write", (t) => {
  const sevenZip = findSevenZipExecutable();
  if (sevenZip.status !== "PASS") return t.skip("host does not have the pinned electron-builder extractor cache");
  const directory = temporaryDirectory(t);
  const archive = path.join(directory, "installer.exe");
  const replacement = path.join(directory, "replacement.7z");
  const createArchive = (sourceDirectory, target, bytes) => {
    fs.mkdirSync(sourceDirectory);
    fs.writeFileSync(path.join(sourceDirectory, "app-64.7z"), Buffer.alloc(bytes, 0x41));
    const result = spawnSync(sevenZip.executable, ["a", "-t7z", target, "app-64.7z"], {
      cwd: sourceDirectory,
      env: selectEvidenceProcessEnvironment(),
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      timeout: 30_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  createArchive(path.join(directory, "safe-source"), archive, 1);
  createArchive(path.join(directory, "replacement-source"), replacement, 4096);
  const budget = inspectArchiveBudget(sevenZip, archive, directory, { maxCompressionRatio: 1000 });
  assert.equal(budget.status, "PASS", budget.summary);
  const listedIdentity = budget.archiveIdentity;
  fs.rmSync(archive);
  fs.renameSync(replacement, archive);
  const outputDirectory = path.join(directory, "output");
  fs.mkdirSync(outputDirectory);
  const extraction = runVerifiedArchiveExtraction({
    resolution: sevenZip,
    archive,
    budget,
    outputDirectory,
    entryPath: "app-64.7z",
    cwd: directory,
  });
  assert.equal(extraction.status, null);
  assert.match(extraction.error?.message || "", /identity or SHA-256 changed after technical listing/);
  assert.notEqual(fs.statSync(archive, { bigint: true }).ino.toString(), listedIdentity.ino);
  assert.deepEqual(fs.readdirSync(outputDirectory), []);
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
