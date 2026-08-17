"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const POLICY_SCHEMA_VERSION = "smart_kefu_windows_release_signing_policy_v1";
const TEMP_PREFIX = "smart-kefu-windows-evidence-";
const SMOKE_TEMP_PREFIX = "smart-kefu-packaged-smoke-";
const TEMP_MARKER_FILE = ".smart-kefu-private-temp.json";
const EXTRACTOR_POLICY_SCHEMA_VERSION = "smart_kefu_windows_extractor_policy_v1";
const DEFAULT_TREE_LIMITS = Object.freeze({
  maxDepth: 48,
  maxEntries: 120_000,
  maxFiles: 100_000,
  maxFileBytes: 2 * 1024 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
});
const DEFAULT_EXTRACTION_LIMITS = Object.freeze({
  maxDepth: 48,
  maxEntries: 50_000,
  maxFiles: 45_000,
  maxFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
  minFreeBytes: 512 * 1024 * 1024,
});
const MAX_ARCHIVE_LIST_OUTPUT_BYTES = 32 * 1024 * 1024;
const root = path.resolve(__dirname, "..");
const DEFAULT_POLICY_FILE = path.join(root, "config", "windows-release-signing-policy.json");
const DEFAULT_EXTRACTOR_POLICY_FILE = path.join(root, "config", "windows-release-extractor-policy.json");

function canonicalPath(value) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathInside(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertSafeRoot(rootPath) {
  const requested = path.resolve(rootPath);
  const stat = fs.lstatSync(requested, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("evidence root must be a regular directory without reparse points");
  const real = fs.realpathSync.native(requested);
  if (comparablePath(real) !== comparablePath(requested)) throw new Error("evidence root resolves through a reparse point");
  return { requested, canonical: canonicalPath(requested) };
}

function assertSafePath(rootPath, targetPath, expectedType = "file") {
  const safeRoot = typeof rootPath === "object" && rootPath.requested ? rootPath : assertSafeRoot(rootPath);
  const requested = path.resolve(targetPath);
  if (!pathInside(safeRoot.requested, requested)) throw new Error("path escapes evidence root");
  const relative = path.relative(safeRoot.requested, requested);
  const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
  let current = safeRoot.requested;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stat = fs.lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error("path contains a symbolic link or junction");
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) throw new Error("path contains a non-directory component");
    if (final) {
      if (expectedType === "file" && !stat.isFile()) throw new Error("path is not a regular file");
      if (expectedType === "directory" && !stat.isDirectory()) throw new Error("path is not a regular directory");
      if (!stat.isFile() && !stat.isDirectory()) throw new Error("path contains an unsupported filesystem node");
      if (stat.isFile() && stat.nlink !== 1n) throw new Error("hard-linked evidence files are not allowed");
    }
    const real = fs.realpathSync.native(current);
    if (comparablePath(real) !== comparablePath(current)) throw new Error("path resolves through a reparse point");
    if (!pathInside(safeRoot.canonical, canonicalPath(current))) throw new Error("resolved path escapes evidence root");
  }
  if (!segments.length && expectedType === "file") throw new Error("evidence root cannot be used as a file");
  return requested;
}

function hashOpenFile(descriptor) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  for (;;) {
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
    if (!bytesRead) break;
    hash.update(buffer.subarray(0, bytesRead));
  }
  return hash.digest("hex");
}

function hashFile(file) {
  const descriptor = fs.openSync(file, "r");
  try {
    return hashOpenFile(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function archiveStatIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
}

function archiveStatIdentityEqual(left, right) {
  return Boolean(left && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs);
}

function captureArchiveIdentity(file) {
  const requested = path.resolve(file);
  const pathStat = fs.lstatSync(requested, { bigint: true });
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1n) {
    throw new Error("archive is not a unique regular file");
  }
  const canonical = fs.realpathSync.native(requested);
  if (comparablePath(canonical) !== comparablePath(requested)) {
    throw new Error("archive resolves through a reparse point");
  }
  const descriptor = fs.openSync(canonical, "r");
  try {
    const openedBefore = fs.fstatSync(descriptor, { bigint: true });
    const pathIdentity = archiveStatIdentity(pathStat);
    const openedIdentity = archiveStatIdentity(openedBefore);
    if (!openedBefore.isFile() || openedBefore.nlink !== 1n || !archiveStatIdentityEqual(pathIdentity, openedIdentity)) {
      throw new Error("archive identity changed while it was opened");
    }
    const sha256 = hashOpenFile(descriptor);
    const openedAfter = fs.fstatSync(descriptor, { bigint: true });
    const afterIdentity = archiveStatIdentity(openedAfter);
    if (!archiveStatIdentityEqual(openedIdentity, afterIdentity)) {
      throw new Error("archive identity changed while it was hashed");
    }
    const pathAfter = fs.lstatSync(requested, { bigint: true });
    const canonicalAfter = fs.realpathSync.native(requested);
    if (!pathAfter.isFile()
      || pathAfter.isSymbolicLink()
      || pathAfter.nlink !== 1n
      || comparablePath(canonicalAfter) !== comparablePath(requested)
      || !archiveStatIdentityEqual(afterIdentity, archiveStatIdentity(pathAfter))) {
      throw new Error("archive path changed while it was hashed");
    }
    return { canonical: comparablePath(canonical), ...afterIdentity, sha256 };
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertArchiveIdentity(file, expected) {
  const actual = captureArchiveIdentity(file);
  if (!expected
    || actual.canonical !== expected.canonical
    || !archiveStatIdentityEqual(actual, expected)
    || actual.sha256 !== expected.sha256) {
    throw new Error("archive identity or SHA-256 changed after technical listing");
  }
  return actual;
}

function createVerifiedArchiveSnapshot(file, directory, expectedIdentity) {
  const safeRoot = assertSafeRoot(directory);
  const snapshotRoot = path.join(
    safeRoot.requested,
    `.archive-snapshot-${process.pid}-${crypto.randomBytes(24).toString("hex")}`,
  );
  fs.mkdirSync(snapshotRoot, { mode: 0o700 });
  assertSafePath(safeRoot, snapshotRoot, "directory");
  const extension = path.extname(file) || ".archive";
  const snapshotFile = path.join(snapshotRoot, `verified-input${extension}`);
  const expectedBytes = Number(BigInt(expectedIdentity?.size || "0"));
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new Error("archive snapshot requires a bounded source size");
  }

  const sourceDescriptor = fs.openSync(path.resolve(file), "r");
  let snapshotDescriptor;
  try {
    const sourceBefore = fs.fstatSync(sourceDescriptor, { bigint: true });
    if (!sourceBefore.isFile()
      || sourceBefore.nlink !== 1n
      || !archiveStatIdentityEqual(archiveStatIdentity(sourceBefore), expectedIdentity)) {
      throw new Error("archive identity changed before its private snapshot was opened");
    }
    snapshotDescriptor = fs.openSync(snapshotFile, "wx", 0o600);
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let copiedBytes = 0;
    for (;;) {
      const bytesRead = fs.readSync(sourceDescriptor, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        written += fs.writeSync(snapshotDescriptor, buffer, written, bytesRead - written, null);
      }
      copiedBytes += bytesRead;
      if (copiedBytes > expectedBytes) throw new Error("archive grew while its private snapshot was copied");
    }
    fs.fsyncSync(snapshotDescriptor);
    const sourceAfter = fs.fstatSync(sourceDescriptor, { bigint: true });
    if (copiedBytes !== expectedBytes
      || !archiveStatIdentityEqual(archiveStatIdentity(sourceBefore), archiveStatIdentity(sourceAfter))
      || hash.digest("hex") !== expectedIdentity.sha256) {
      throw new Error("archive changed while its private snapshot was copied");
    }
  } finally {
    if (snapshotDescriptor !== undefined) fs.closeSync(snapshotDescriptor);
    fs.closeSync(sourceDescriptor);
  }

  assertArchiveIdentity(file, expectedIdentity);
  fs.chmodSync(snapshotFile, 0o400);
  const snapshotIdentity = captureArchiveIdentity(snapshotFile);
  if (snapshotIdentity.sha256 !== expectedIdentity.sha256 || snapshotIdentity.size !== expectedIdentity.size) {
    throw new Error("private archive snapshot does not match the verified source bytes");
  }
  return {
    path: assertSafePath(safeRoot, snapshotFile, "file"),
    root: snapshotRoot,
    identity: snapshotIdentity,
  };
}

function normalizeTreeOptions(options = {}) {
  const limits = { ...DEFAULT_TREE_LIMITS, ...(options.limits || {}) };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid package tree budget: ${name}`);
  }
  const normalizeName = (value) => process.platform === "win32" ? String(value).toLowerCase() : String(value);
  const includeTopLevel = Array.isArray(options.includeTopLevel)
    ? new Set(options.includeTopLevel.map(normalizeName))
    : null;
  return { limits, includeTopLevel };
}

function selectedChildren(directory, includeTopLevel, atRoot) {
  const children = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  return atRoot && includeTopLevel
    ? children.filter((child) => includeTopLevel.has(process.platform === "win32" ? child.name.toLowerCase() : child.name))
    : children;
}

function createTreeManifest(directory, options = {}) {
  const safeRoot = assertSafeRoot(directory);
  const { limits, includeTopLevel } = normalizeTreeOptions(options);
  const entries = [];
  const totals = { files: 0, directories: 0, totalBytes: 0, maxDepth: 0 };
  const visit = (current, relative, depth) => {
    if (depth > limits.maxDepth) throw new Error("package tree exceeds maximum depth");
    totals.maxDepth = Math.max(totals.maxDepth, depth);
    const children = selectedChildren(current, includeTopLevel, depth === 0);
    for (const child of children) {
      const childPath = path.join(current, child.name);
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      const stat = fs.lstatSync(childPath, { bigint: true });
      if (child.isSymbolicLink() || stat.isSymbolicLink()) throw new Error(`tree contains a symbolic link or junction: ${childRelative}`);
      const real = fs.realpathSync.native(childPath);
      if (comparablePath(real) !== comparablePath(childPath) || !pathInside(safeRoot.canonical, canonicalPath(childPath))) {
        throw new Error(`tree contains a reparse point: ${childRelative}`);
      }
      if (child.isDirectory() && stat.isDirectory()) {
        totals.directories += 1;
        if (totals.files + totals.directories > limits.maxEntries) throw new Error("package tree exceeds maximum entry count");
        entries.push({ path: `${childRelative}/`, type: "directory" });
        visit(childPath, childRelative, depth + 1);
      } else if (child.isFile() && stat.isFile()) {
        if (stat.nlink !== 1n) throw new Error(`tree contains a hard-linked file: ${childRelative}`);
        const bytes = Number(stat.size);
        totals.files += 1;
        totals.totalBytes += bytes;
        if (totals.files + totals.directories > limits.maxEntries || totals.files > limits.maxFiles) {
          throw new Error("package tree exceeds maximum file count");
        }
        if (bytes > limits.maxFileBytes) throw new Error(`package file exceeds maximum size: ${childRelative}`);
        if (totals.totalBytes > limits.maxTotalBytes) throw new Error("package tree exceeds maximum total bytes");
        entries.push({ path: childRelative, type: "file", bytes, sha256: hashFile(childPath) });
      } else {
        throw new Error(`tree contains an unsupported filesystem node: ${childRelative}`);
      }
    }
  };
  visit(safeRoot.requested, "", 0);
  const json = JSON.stringify(entries);
  return { entries, sha256: crypto.createHash("sha256").update(json).digest("hex"), totals };
}

function manifestsEqual(left, right) {
  return Boolean(left && right && left.sha256 === right.sha256 && JSON.stringify(left.entries) === JSON.stringify(right.entries));
}

function copySafeTree(source, destination, options = {}) {
  const sourceRoot = assertSafeRoot(source);
  const { limits, includeTopLevel } = normalizeTreeOptions(options);
  const totals = { files: 0, directories: 0, totalBytes: 0 };
  if (fs.existsSync(destination)) throw new Error("snapshot destination already exists");
  fs.mkdirSync(destination, { recursive: false, mode: 0o700 });
  const visit = (sourceDirectory, destinationDirectory, relative, depth) => {
    if (depth > limits.maxDepth) throw new Error("snapshot source exceeds maximum depth");
    const children = selectedChildren(sourceDirectory, includeTopLevel, depth === 0);
    for (const child of children) {
      const sourcePath = path.join(sourceDirectory, child.name);
      const destinationPath = path.join(destinationDirectory, child.name);
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      const stat = fs.lstatSync(sourcePath, { bigint: true });
      if (child.isSymbolicLink() || stat.isSymbolicLink()) throw new Error(`snapshot source contains a symbolic link or junction: ${childRelative}`);
      const real = fs.realpathSync.native(sourcePath);
      if (comparablePath(real) !== comparablePath(sourcePath) || !pathInside(sourceRoot.canonical, canonicalPath(sourcePath))) {
        throw new Error(`snapshot source contains a reparse point: ${childRelative}`);
      }
      if (child.isDirectory() && stat.isDirectory()) {
        totals.directories += 1;
        if (totals.files + totals.directories > limits.maxEntries) throw new Error("snapshot source exceeds maximum entry count");
        fs.mkdirSync(destinationPath, { mode: 0o700 });
        visit(sourcePath, destinationPath, childRelative, depth + 1);
      } else if (child.isFile() && stat.isFile()) {
        if (stat.nlink !== 1n) throw new Error(`snapshot source contains a hard-linked file: ${childRelative}`);
        const bytes = Number(stat.size);
        totals.files += 1;
        totals.totalBytes += bytes;
        if (totals.files + totals.directories > limits.maxEntries || totals.files > limits.maxFiles) {
          throw new Error("snapshot source exceeds maximum file count");
        }
        if (bytes > limits.maxFileBytes) throw new Error(`snapshot source file exceeds maximum size: ${childRelative}`);
        if (totals.totalBytes > limits.maxTotalBytes) throw new Error("snapshot source exceeds maximum total bytes");
        fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(destinationPath, 0o400);
      } else {
        throw new Error(`snapshot source contains an unsupported filesystem node: ${childRelative}`);
      }
    }
  };
  visit(sourceRoot.requested, destination, "", 0);
}

function privateTempIdentity(directory) {
  const stat = fs.lstatSync(directory, { bigint: true });
  return { dev: String(stat.dev), ino: String(stat.ino) };
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino);
}

function createPrivateTemp(prefix = TEMP_PREFIX) {
  if (![TEMP_PREFIX, SMOKE_TEMP_PREFIX].includes(prefix)) throw new Error("unsupported private temp prefix");
  const nonce = crypto.randomBytes(32).toString("hex");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const identity = privateTempIdentity(tempRoot);
  const markerFile = path.join(tempRoot, TEMP_MARKER_FILE);
  try {
    fs.writeFileSync(markerFile, `${JSON.stringify({ nonce, prefix })}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { tempRoot, nonce, prefix, identity };
  } catch (error) {
    let failure = error;
    const quarantine = path.join(os.tmpdir(), `${prefix}failed-create-${crypto.randomBytes(16).toString("hex")}`);
    try {
      if (!sameIdentity(privateTempIdentity(tempRoot), identity)) throw new Error("private temp identity changed during failed creation cleanup");
      fs.renameSync(tempRoot, quarantine);
      if (!sameIdentity(privateTempIdentity(quarantine), identity)) throw new Error("private temp identity changed after failed creation quarantine");
      fs.rmSync(quarantine, { recursive: true, force: true });
    } catch (cleanupError) {
      failure = cleanupError;
    }
    if (failure && typeof failure === "object") failure.temporaryFilesWritten = true;
    throw failure;
  }
}

function createPrivateSnapshot(sourceDirectory, options = {}) {
  const treeOptions = { includeTopLevel: options.includeTopLevel, limits: options.limits };
  const sourceBefore = createTreeManifest(sourceDirectory, treeOptions);
  const cleanupHandle = createPrivateTemp(TEMP_PREFIX);
  const tempRoot = cleanupHandle.tempRoot;
  const snapshotDirectory = path.join(tempRoot, "package");
  try {
    copySafeTree(sourceDirectory, snapshotDirectory, treeOptions);
    const sourceAfter = createTreeManifest(sourceDirectory, treeOptions);
    const snapshot = createTreeManifest(snapshotDirectory, { limits: options.limits });
    if (!manifestsEqual(sourceBefore, sourceAfter) || !manifestsEqual(sourceBefore, snapshot)) {
      throw new Error("package tree changed while the private snapshot was created");
    }
    return { tempRoot, snapshotDirectory, sourceManifest: sourceBefore, snapshotManifest: snapshot, cleanupHandle, treeOptions };
  } catch (error) {
    let failure = error;
    try {
      cleanupPrivateTemp(cleanupHandle);
    } catch (cleanupError) {
      failure = cleanupError;
    }
    if (failure && typeof failure === "object") failure.temporaryFilesWritten = true;
    throw failure;
  }
}

function cleanupPrivateTemp(handle) {
  if (!handle || typeof handle !== "object" || !handle.tempRoot || !handle.nonce || !handle.identity || !handle.prefix) {
    throw new Error("private temp cleanup requires its creation handle");
  }
  const requested = path.resolve(handle.tempRoot);
  const tempParent = path.resolve(os.tmpdir());
  if (path.dirname(requested) !== tempParent || ![TEMP_PREFIX, SMOKE_TEMP_PREFIX].includes(handle.prefix)
    || !path.basename(requested).startsWith(handle.prefix)) {
    throw new Error("refusing to clean an unexpected evidence temp path");
  }
  if (!fs.existsSync(requested)) return;
  const stat = fs.lstatSync(requested);
  if (stat.isSymbolicLink() || !stat.isDirectory() || !sameIdentity(privateTempIdentity(requested), handle.identity)) {
    throw new Error("refusing to clean a replaced evidence temp path");
  }
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(path.join(requested, TEMP_MARKER_FILE), "utf8"));
  } catch {
    marker = null;
  }
  if (marker?.nonce !== handle.nonce || marker?.prefix !== handle.prefix) throw new Error("private temp ownership marker is invalid");
  const quarantine = path.join(tempParent, `${handle.prefix}cleanup-${crypto.randomBytes(16).toString("hex")}`);
  fs.renameSync(requested, quarantine);
  if (!sameIdentity(privateTempIdentity(quarantine), handle.identity)) throw new Error("private temp identity changed during cleanup");
  fs.rmSync(quarantine, { recursive: true, force: true });
}

function loadReleasePolicy(policyFile = DEFAULT_POLICY_FILE) {
  const parsed = JSON.parse(fs.readFileSync(policyFile, "utf8"));
  const configured = parsed?.schemaVersion === POLICY_SCHEMA_VERSION
    && parsed?.identityStatus === "CONFIGURED"
    && Array.isArray(parsed.allowedPublisherSubjects) && parsed.allowedPublisherSubjects.length > 0
    && Array.isArray(parsed.allowedCertificateThumbprints) && parsed.allowedCertificateThumbprints.length > 0;
  return { ...parsed, configured };
}

function loadExtractorPolicy(policyFile = DEFAULT_EXTRACTOR_POLICY_FILE) {
  const parsed = JSON.parse(fs.readFileSync(policyFile, "utf8"));
  const valid = parsed?.schemaVersion === EXTRACTOR_POLICY_SCHEMA_VERSION
    && parsed?.cacheVersion === "7zip@1.0.0"
    && parsed?.executableName === "7za.exe"
    && /^[a-f0-9]{64}$/.test(String(parsed?.sha256 || ""));
  if (!valid) throw new Error("checked-in Windows extractor policy is invalid");
  return parsed;
}

function trustedWindowsRoot() {
  if (process.platform !== "win32") return "";
  const expected = path.win32.resolve("C:\\Windows");
  try {
    const stat = fs.lstatSync(expected);
    const real = fs.realpathSync.native(expected);
    if (stat.isSymbolicLink() || !stat.isDirectory() || comparablePath(real) !== comparablePath(expected)) return "";
    return real;
  } catch {
    return "";
  }
}

function trustedWindowsSystemTool(...segments) {
  const systemRoot = trustedWindowsRoot();
  if (!systemRoot) return "";
  const executable = path.join(systemRoot, "System32", ...segments);
  try {
    const stat = fs.lstatSync(executable);
    const real = fs.realpathSync.native(executable);
    if (stat.isSymbolicLink() || !stat.isFile() || comparablePath(real) !== comparablePath(executable)) return "";
    return real;
  } catch {
    return "";
  }
}

function processExists(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function waitForProcessExit(pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (!processExists(pid)) return resolve();
      if (Date.now() >= deadline) return reject(new Error(`process tree did not exit: ${pid}`));
      setTimeout(inspect, 50);
    };
    inspect();
  });
}

async function terminateProcessTree(child) {
  const pid = Number(child?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !processExists(pid)) return;
  try { child.kill(); } catch {}
  try {
    await waitForProcessExit(pid, process.platform === "win32" ? 3000 : 1000);
    return;
  } catch {}
  if (process.platform === "win32") {
    const taskkill = trustedWindowsSystemTool("taskkill.exe");
    if (!taskkill) throw new Error("trusted Windows taskkill is unavailable");
    const result = spawnSync(taskkill, ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      timeout: 30_000,
    });
    if (result.error?.code === "ETIMEDOUT") throw new Error(`timed out terminating process tree: ${pid}`);
    if (result.error || result.status !== 0) {
      try {
        await waitForProcessExit(pid, 15000);
        return;
      } catch {}
      if (processExists(pid)) {
        const detail = String(result.error?.message || result.stderr || result.stdout || "").trim();
        throw new Error(`failed to terminate process tree: ${pid}${detail ? `: ${detail}` : ""}`);
      }
      return;
    }
  } else {
    try { child.kill("SIGKILL"); } catch {}
  }
  await waitForProcessExit(pid);
}

function absoluteWindowsPowerShell() {
  return trustedWindowsSystemTool("WindowsPowerShell", "v1.0", "powershell.exe");
}

function selectEvidenceProcessEnvironment(overrides = {}, privateRoot = "") {
  const systemRoot = trustedWindowsRoot();
  if (process.platform === "win32" && !systemRoot) throw new Error("trusted Windows system directory is unavailable");
  const selected = {};
  for (const key of [
    "ComSpec", "PATHEXT", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "OS", "SystemDrive",
    "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "NUMBER_OF_PROCESSORS",
  ]) {
    if (process.env[key] !== undefined) selected[key] = process.env[key];
  }
  if (systemRoot) {
    selected.SystemRoot = systemRoot;
    selected.WINDIR = systemRoot;
    selected.Path = [
      path.join(systemRoot, "System32"),
      systemRoot,
      path.join(systemRoot, "System32", "Wbem"),
    ].join(path.delimiter);
  } else {
    selected.Path = "";
  }
  if (privateRoot) {
    const privatePath = path.resolve(privateRoot);
    selected.TEMP = path.join(privatePath, "temp");
    selected.TMP = selected.TEMP;
    selected.USERPROFILE = path.join(privatePath, "profile");
    selected.APPDATA = path.join(privatePath, "appdata", "roaming");
    selected.LOCALAPPDATA = path.join(privatePath, "appdata", "local");
    selected.PROGRAMDATA = path.join(privatePath, "programdata");
    for (const directory of [selected.TEMP, selected.USERPROFILE, selected.APPDATA, selected.LOCALAPPDATA, selected.PROGRAMDATA]) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
  }
  return { ...selected, ...overrides };
}

function inspectNativeAuthenticode(file) {
  const powershell = absoluteWindowsPowerShell();
  if (!powershell) return { status: "Unavailable", unavailable: true, mode: "native" };
  const escaped = file.replace(/'/g, "''");
  const script = [
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escaped}'`,
    `$version = (Get-Item -LiteralPath '${escaped}').VersionInfo`,
    "$certificate = $signature.SignerCertificate",
    "[pscustomobject]@{",
    "  status = $signature.Status.ToString()",
    "  subject = if ($certificate) { $certificate.Subject } else { '' }",
    "  thumbprint = if ($certificate) { $certificate.Thumbprint } else { '' }",
    "  productName = $version.ProductName",
    "  originalFilename = $version.OriginalFilename",
    "  productVersion = $version.ProductVersion",
    "  fileVersion = $version.FileVersion",
    "} | ConvertTo-Json -Compress",
  ].join("\n");
  const execution = spawnSync(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true, shell: false, timeout: 30_000 },
  );
  if (execution.error || execution.status !== 0) return { status: "Unavailable", unavailable: true, mode: "native" };
  try {
    return { ...JSON.parse(String(execution.stdout || "")), mode: "native" };
  } catch {
    return { status: "Unavailable", unavailable: true, mode: "native" };
  }
}

function inspectPeArchitecture(file) {
  const descriptor = fs.openSync(file, "r");
  try {
    const dosHeader = Buffer.alloc(64);
    if (fs.readSync(descriptor, dosHeader, 0, dosHeader.length, 0) !== dosHeader.length
      || dosHeader[0] !== 0x4d || dosHeader[1] !== 0x5a) return { valid: false, architecture: "unknown" };
    const peOffset = dosHeader.readUInt32LE(0x3c);
    const header = Buffer.alloc(26);
    if (peOffset < dosHeader.length || fs.readSync(descriptor, header, 0, header.length, peOffset) !== header.length
      || !header.subarray(0, 4).equals(Buffer.from([0x50, 0x45, 0x00, 0x00]))) {
      return { valid: false, architecture: "unknown" };
    }
    const machine = header.readUInt16LE(4);
    const optionalMagic = header.readUInt16LE(24);
    const architecture = machine === 0x8664 && optionalMagic === 0x20b ? "x64" : machine === 0x14c ? "x86" : "unknown";
    return { valid: architecture !== "unknown", architecture, machine, optionalMagic };
  } finally {
    fs.closeSync(descriptor);
  }
}

function expectedOriginalFilename(policy, label, version) {
  const template = label === "installer" ? policy.installerOriginalFilename : policy.executableOriginalFilename;
  return String(template || "").replaceAll("{version}", version);
}

function versionMatches(actual, expected, mode) {
  const value = String(actual || "").trim();
  if (mode === "semver-prefix") return value === expected || value.startsWith(`${expected}.`) || value.startsWith(`${expected}-`);
  return value === expected;
}

function evaluateArtifactPolicy({ label, file, version, policy, signature }) {
  if (signature?.unavailable || signature?.status === "Unavailable" || signature?.status === "Unknown") {
    return { status: "BLOCKED", summary: `${label} Authenticode metadata is unavailable` };
  }
  if (signature?.status !== "Valid") return { status: "FAIL", summary: `${label} Authenticode status is not Valid` };
  if (!policy.configured) return { status: "BLOCKED", summary: "checked-in release signer identity is UNCONFIGURED" };
  const subjectValid = policy.allowedPublisherSubjects.includes(String(signature.subject || ""));
  const thumbprint = String(signature.thumbprint || "").replace(/\s+/g, "").toUpperCase();
  const thumbprintValid = policy.allowedCertificateThumbprints.map((item) => String(item).replace(/\s+/g, "").toUpperCase()).includes(thumbprint);
  const pe = inspectPeArchitecture(file);
  const metadataValid = signature.productName === policy.productName
    && signature.originalFilename === expectedOriginalFilename(policy, label, version)
    && versionMatches(signature.productVersion || signature.fileVersion, version, policy.versionMatch)
    && pe.valid && pe.architecture === policy.architecture;
  if (!subjectValid || !thumbprintValid || !metadataValid) {
    return { status: "FAIL", summary: `${label} signer, product metadata, version or architecture does not match checked-in release policy`, pe };
  }
  return { status: "PASS", summary: `${label} matches the checked-in publisher, certificate, product and x64 policy`, pe };
}

function findSevenZipExecutable() {
  const policy = loadExtractorPolicy();
  const cacheRoots = [];
  if (String(process.env.ELECTRON_BUILDER_CACHE || "").trim()) cacheRoots.push(path.resolve(process.env.ELECTRON_BUILDER_CACHE));
  if (String(process.env.LOCALAPPDATA || "").trim()) {
    cacheRoots.push(path.resolve(process.env.LOCALAPPDATA, "electron-builder", "Cache"));
  }
  const uniqueRoots = [...new Set(cacheRoots.map((item) => comparablePath(item)))];
  const candidates = [];
  let unsafeCandidate = false;
  for (const comparableRoot of uniqueRoots) {
    const cacheRoot = cacheRoots.find((item) => comparablePath(item) === comparableRoot);
    const versionRoot = path.join(cacheRoot, policy.cacheVersion);
    if (!fs.existsSync(versionRoot)) continue;
    let safeVersionRoot;
    try {
      safeVersionRoot = assertSafeRoot(versionRoot);
    } catch {
      unsafeCandidate = true;
      continue;
    }
    for (const entry of fs.readdirSync(safeVersionRoot.requested, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        unsafeCandidate = true;
        continue;
      }
      if (!entry.isDirectory()) continue;
      const candidate = path.join(safeVersionRoot.requested, entry.name, "bin", policy.executableName);
      if (!fs.existsSync(candidate)) continue;
      try {
        assertSafePath(safeVersionRoot, candidate, "file");
        const stat = fs.lstatSync(candidate, { bigint: true });
        if (stat.nlink !== 1n || hashFile(candidate) !== policy.sha256) throw new Error("extractor identity mismatch");
        candidates.push(fs.realpathSync.native(candidate));
      } catch {
        unsafeCandidate = true;
      }
    }
  }
  const uniqueCandidates = [...new Set(candidates.map((item) => comparablePath(item)))];
  if (unsafeCandidate) return { status: "FAIL", summary: "electron-builder 7-Zip cache contains a replaced, linked or unpinned extractor" };
  if (uniqueCandidates.length !== 1) {
    return uniqueCandidates.length > 1
      ? { status: "FAIL", summary: "electron-builder 7-Zip cache contains ambiguous pinned extractors" }
      : { status: "BLOCKED", summary: "pinned electron-builder 7-Zip 1.0.0 extractor is unavailable" };
  }
  return { status: "PASS", executable: candidates.find((item) => comparablePath(item) === uniqueCandidates[0]), policy };
}

function runSevenZip(resolution, args, cwd, options = {}) {
  const executable = resolution?.executable;
  try {
    const stat = fs.lstatSync(executable, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || hashFile(executable) !== resolution.policy.sha256) {
      return { status: null, error: new Error("pinned extractor identity changed before execution") };
    }
  } catch (error) {
    return { status: null, error };
  }
  return spawnSync(executable, args, {
    cwd,
    env: selectEvidenceProcessEnvironment(),
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: options.timeoutMs || 120_000,
    maxBuffer: options.maxBuffer || 1024 * 1024,
  });
}

function normalizeExtractionLimits(overrides = {}) {
  const limits = { ...DEFAULT_EXTRACTION_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid extraction budget: ${name}`);
  }
  return limits;
}

function parseSevenZipTechnicalListing(output) {
  const records = [];
  let current = {};
  const flush = () => {
    if (Object.keys(current).length) records.push(current);
    current = {};
  };
  for (const line of String(output || "").split(/\r?\n/)) {
    if (!line.trim() || /^-+$/.test(line.trim())) {
      flush();
      continue;
    }
    const separator = line.indexOf(" = ");
    if (separator <= 0) continue;
    current[line.slice(0, separator)] = line.slice(separator + 3);
  }
  flush();
  return records.filter((record) => record.Path && !record.Type && record["Physical Size"] === undefined);
}

function archiveEntryPath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error("archive contains an absolute or empty entry path");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("archive contains an unsafe entry path");
  }
  if (segments.some((segment) => /[\u0000-\u001f:*?"<>|]/.test(segment)
    || /[. ]$/.test(segment)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment))) {
    throw new Error("archive contains a Windows-unsafe entry path");
  }
  return { normalized, segments };
}

function archiveInteger(value, label) {
  if (!/^\d+$/.test(String(value ?? ""))) throw new Error(`archive ${label} is missing or invalid`);
  const parsed = BigInt(String(value));
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`archive ${label} exceeds the numeric safety limit`);
  return Number(parsed);
}

function validateSevenZipListing(output, options = {}) {
  const limits = normalizeExtractionLimits(options.limits);
  const archiveBytes = archiveInteger(options.archiveBytes, "physical size");
  const records = parseSevenZipTechnicalListing(output);
  if (!records.length) throw new Error("archive technical listing is empty");
  const entries = [];
  const names = new Set();
  const entryKinds = new Map();
  const totals = { files: 0, directories: 0, totalBytes: 0, maxDepth: 0 };
  for (const record of records) {
    const entryPath = archiveEntryPath(record.Path);
    const key = process.platform === "win32" ? entryPath.normalized.toLowerCase() : entryPath.normalized;
    if (names.has(key)) throw new Error("archive contains duplicate entry paths");
    names.add(key);
    const attributes = String(record.Attributes || "");
    const unixMode = /(?:^|\s)([bcdlps-][rwxStTs-]{9})(?:\s|$)/.exec(attributes)?.[1] || "";
    const linked = unixMode && !["-", "d"].includes(unixMode[0].toLowerCase())
      || ["Symbolic Link", "Hard Link", "Reparse", "Reparse Point", "Alternate Stream"]
        .some((field) => String(record[field] || "").trim() && String(record[field]).trim() !== "-");
    if (linked) throw new Error(`archive contains a linked or reparse entry: ${entryPath.normalized}`);
    const folder = String(record.Folder || "");
    if (folder && !["+", "-"].includes(folder)) {
      throw new Error(`archive entry type is missing or ambiguous: ${entryPath.normalized}`);
    }
    const attributeDirectory = /^D/i.test(attributes.trim()) || unixMode[0]?.toLowerCase() === "d";
    const directory = folder === "+" || (!folder && attributeDirectory);
    if (!folder && !directory && record.Size === undefined) {
      throw new Error(`archive entry type is missing or ambiguous: ${entryPath.normalized}`);
    }
    if (unixMode && (unixMode[0].toLowerCase() === "d") !== directory) {
      throw new Error(`archive entry type conflicts with its attributes: ${entryPath.normalized}`);
    }
    const bytes = directory ? 0 : archiveInteger(record.Size, "entry size");
    totals.maxDepth = Math.max(totals.maxDepth, entryPath.segments.length);
    if (totals.maxDepth > limits.maxDepth) throw new Error("archive exceeds maximum path depth");
    if (directory) totals.directories += 1;
    else {
      totals.files += 1;
      totals.totalBytes += bytes;
      if (bytes > limits.maxFileBytes) throw new Error(`archive file exceeds maximum size: ${entryPath.normalized}`);
      if (totals.files > limits.maxFiles) throw new Error("archive exceeds maximum file count");
      if (totals.totalBytes > limits.maxTotalBytes) throw new Error("archive exceeds maximum total bytes");
    }
    if (totals.files + totals.directories > limits.maxEntries) throw new Error("archive exceeds maximum entry count");
    entries.push({ path: entryPath.normalized, directory, bytes });
    entryKinds.set(key, { directory, segments: entryPath.segments });
  }
  for (const [entryKey, entry] of entryKinds) {
    for (let depth = 1; depth < entry.segments.length; depth += 1) {
      const prefix = entry.segments.slice(0, depth).join("/");
      const parentKey = process.platform === "win32" ? prefix.toLowerCase() : prefix;
      const parent = entryKinds.get(parentKey);
      if (parent && !parent.directory) {
        throw new Error(`archive file is an ancestor of another entry: ${entryKey}`);
      }
    }
  }
  if (!totals.files) throw new Error("archive does not contain any files");
  if (totals.totalBytes > archiveBytes * limits.maxCompressionRatio) {
    throw new Error("archive exceeds maximum compression ratio");
  }
  return { entries, totals, archiveBytes, limits };
}

function checkExtractionCapacity(directory, requiredBytes, limits) {
  try {
    const stat = fs.statfsSync(directory, { bigint: true });
    const available = stat.bavail * stat.bsize;
    const required = BigInt(requiredBytes) + BigInt(limits.minFreeBytes);
    return available >= required
      ? { status: "PASS" }
      : { status: "BLOCKED", summary: "insufficient free disk space for bounded archive extraction" };
  } catch {
    return { status: "BLOCKED", summary: "free disk space could not be established before archive extraction" };
  }
}

function inspectArchiveBudget(resolution, archive, cwd, overrides = {}) {
  const limits = normalizeExtractionLimits(overrides);
  let archiveSnapshot;
  let archiveIdentity;
  let archiveBytes;
  try {
    archiveIdentity = captureArchiveIdentity(archive);
    archiveBytes = Number(BigInt(archiveIdentity.size));
    if (archiveBytes <= 0 || archiveBytes > limits.maxFileBytes) throw new Error("archive input exceeds the file budget");
    const snapshotCapacity = checkExtractionCapacity(cwd, archiveBytes, limits);
    if (snapshotCapacity.status !== "PASS") return snapshotCapacity;
    archiveSnapshot = createVerifiedArchiveSnapshot(archive, cwd, archiveIdentity);
  } catch (error) {
    return { status: "FAIL", summary: `archive input validation failed: ${error.message}` };
  }
  const listing = runSevenZip(resolution, ["l", "-slt", "-ba", archiveSnapshot.path], cwd, {
    timeoutMs: 30_000,
    maxBuffer: MAX_ARCHIVE_LIST_OUTPUT_BYTES,
  });
  if (listing.error?.code === "ETIMEDOUT") return { status: "FAIL", summary: "archive technical listing timed out" };
  if (listing.error?.code === "ENOBUFS") return { status: "FAIL", summary: "archive technical listing exceeded its output budget" };
  if (listing.error || listing.status !== 0) return { status: "FAIL", summary: "archive technical listing could not be verified" };
  try {
    archiveIdentity = assertArchiveIdentity(archiveSnapshot.path, archiveSnapshot.identity);
    const inspected = validateSevenZipListing(listing.stdout, { archiveBytes, limits });
    const capacity = checkExtractionCapacity(cwd, inspected.totals.totalBytes, inspected.limits);
    return capacity.status === "PASS" ? {
      status: "PASS",
      ...inspected,
      archiveIdentity,
      archivePath: archiveSnapshot.path,
      archiveSnapshotRoot: archiveSnapshot.root,
      sourceArchivePath: comparablePath(archive),
    } : capacity;
  } catch (error) {
    return { status: "FAIL", summary: `archive budget validation failed: ${error.message}` };
  }
}

function runVerifiedArchiveExtraction({ resolution, archive, budget, outputDirectory, entryPath = "", cwd }) {
  let verifiedArchive;
  try {
    if (budget?.status !== "PASS"
      || !budget.archiveIdentity
      || !budget.archivePath
      || !budget.archiveSnapshotRoot
      || budget.sourceArchivePath !== comparablePath(archive)) {
      throw new Error("archive extraction requires a successful technical-listing preflight");
    }
    const safeSnapshotRoot = assertSafeRoot(budget.archiveSnapshotRoot);
    verifiedArchive = assertSafePath(safeSnapshotRoot, budget.archivePath, "file");
    assertArchiveIdentity(verifiedArchive, budget.archiveIdentity);
  } catch (error) {
    return { status: null, error };
  }
  return runSevenZip(
    resolution,
    ["x", "-y", "-bb0", "-bd", `-o${outputDirectory}`, verifiedArchive, ...(entryPath ? [entryPath] : [])],
    cwd,
  );
}

function findNamedFile(directory, expectedName, limits = DEFAULT_EXTRACTION_LIMITS) {
  const safeRoot = assertSafeRoot(directory);
  const manifest = createTreeManifest(safeRoot.requested, { limits });
  return manifest.entries
    .filter((entry) => entry.type === "file" && path.posix.basename(entry.path).toLowerCase() === expectedName.toLowerCase())
    .map((entry) => assertSafePath(safeRoot, path.join(safeRoot.requested, ...entry.path.split("/")), "file"));
}

function verifyNativeInstallerBinding({ installer, unpackedDirectory, tempRoot }) {
  const sevenZip = findSevenZipExecutable();
  if (sevenZip.status !== "PASS") return { ...sevenZip, mode: "native" };
  const extractionLimits = normalizeExtractionLimits();
  const outer = path.join(tempRoot, "installer-outer");
  const payload = path.join(tempRoot, "installer-payload");
  fs.mkdirSync(outer, { mode: 0o700 });
  fs.mkdirSync(payload, { mode: 0o700 });
  const outerBudget = inspectArchiveBudget(sevenZip, installer, tempRoot, extractionLimits);
  if (outerBudget.status !== "PASS") return { ...outerBudget, mode: "native" };
  const archiveEntries = outerBudget.entries.filter(
    (entry) => !entry.directory && path.posix.basename(entry.path).toLowerCase() === "app-64.7z",
  );
  if (archiveEntries.length !== 1) return { status: "FAIL", summary: "electron-builder NSIS app-64.7z payload is missing or ambiguous", mode: "native" };
  const outerResult = runVerifiedArchiveExtraction({
    resolution: sevenZip,
    archive: installer,
    budget: outerBudget,
    outputDirectory: outer,
    entryPath: archiveEntries[0].path,
    cwd: tempRoot,
  });
  if (outerResult.error?.code === "ETIMEDOUT") return { status: "FAIL", summary: "signed NSIS installer extraction timed out", mode: "native" };
  if (outerResult.error) return { status: "FAIL", summary: "pinned NSIS extractor could not run safely", mode: "native" };
  if (outerResult.status !== 0) return { status: "FAIL", summary: "installer is not a readable electron-builder NSIS artifact", mode: "native" };
  let archives;
  try {
    archives = findNamedFile(outer, "app-64.7z", extractionLimits);
  } catch (error) {
    return { status: "FAIL", summary: error.message, mode: "native" };
  }
  if (archives.length !== 1) return { status: "FAIL", summary: "electron-builder NSIS app-64.7z payload is missing or ambiguous", mode: "native" };
  const payloadBudget = inspectArchiveBudget(sevenZip, archives[0], tempRoot, extractionLimits);
  if (payloadBudget.status !== "PASS") return { ...payloadBudget, mode: "native" };
  const payloadResult = runVerifiedArchiveExtraction({
    resolution: sevenZip,
    archive: archives[0],
    budget: payloadBudget,
    outputDirectory: payload,
    cwd: tempRoot,
  });
  if (payloadResult.error?.code === "ETIMEDOUT") return { status: "FAIL", summary: "signed NSIS payload extraction timed out", mode: "native" };
  if (payloadResult.error) return { status: "FAIL", summary: "pinned NSIS payload extractor could not run safely", mode: "native" };
  if (payloadResult.status !== 0) return { status: "FAIL", summary: "electron-builder NSIS payload could not be extracted", mode: "native" };
  try {
    const actual = createTreeManifest(payload, { limits: extractionLimits });
    const expected = createTreeManifest(unpackedDirectory, { limits: extractionLimits });
    if (!manifestsEqual(expected, actual)) return { status: "FAIL", summary: "signed installer payload does not match the inspected win-unpacked tree", mode: "native" };
    return { status: "PASS", summary: "signed NSIS payload exactly matches the inspected win-unpacked tree", mode: "native", manifestSha256: actual.sha256 };
  } catch (error) {
    return { status: "FAIL", summary: `NSIS payload manifest validation failed: ${error.message}`, mode: "native" };
  }
}

function runNativePackagedSmoke({ outputDirectory, tempRoot }) {
  if (process.platform !== "win32") return { status: "BLOCKED", summary: "native packaged smoke requires Windows", mode: "native" };
  const script = path.join(root, "tools", "smoke-packaged-api.js");
  const reportFile = path.join(tempRoot, "native-packaged-smoke.json");
  const execution = spawnSync(process.execPath, [script], {
    cwd: root,
    env: selectEvidenceProcessEnvironment({
      PACKAGED_SMOKE_OUTPUT_DIR: outputDirectory,
      PACKAGED_SMOKE_REPORT_FILE: reportFile,
      PACKAGED_API_SMOKE_PORT: "32191",
      PACKAGED_WEB_SMOKE_PORT: "32190",
    }, path.join(tempRoot, "native-smoke-environment")),
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 180_000,
  });
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  } catch {
    report = null;
  }
  const failure = classifyNativeSmokeFailure(execution, report);
  if (failure) return failure;
  return { status: "PASS", summary: "packaged runtime was re-executed from the private snapshot", mode: "native", generatedAt: report.generatedAt };
}

function classifyNativeSmokeFailure(execution, report) {
  if (execution?.error?.code === "ETIMEDOUT") {
    return { status: "FAIL", summary: "packaged runtime smoke orchestrator timed out", mode: "native" };
  }
  if (execution?.error) {
    return { status: "BLOCKED", summary: "native packaged smoke could not start on this host", mode: "native" };
  }
  if (execution?.status === 0 && report?.status === "PASS") return null;
  const detail = String(report?.error || execution?.stderr || execution?.stdout || "packaged runtime smoke failed");
  const blocked = /EADDRINUSE/i.test(detail);
  return {
    status: blocked ? "BLOCKED" : "FAIL",
    summary: blocked ? "native packaged smoke could not obtain its isolated ports" : "packaged runtime smoke failed",
    mode: "native",
  };
}

module.exports = {
  DEFAULT_EXTRACTION_LIMITS,
  DEFAULT_POLICY_FILE,
  POLICY_SCHEMA_VERSION,
  absoluteWindowsPowerShell,
  assertArchiveIdentity,
  assertSafePath,
  assertSafeRoot,
  classifyNativeSmokeFailure,
  cleanupPrivateTemp,
  createPrivateTemp,
  createPrivateSnapshot,
  createTreeManifest,
  evaluateArtifactPolicy,
  findSevenZipExecutable,
  inspectArchiveBudget,
  hashFile,
  inspectNativeAuthenticode,
  inspectPeArchitecture,
  loadReleasePolicy,
  loadExtractorPolicy,
  manifestsEqual,
  pathInside,
  validateSevenZipListing,
  runNativePackagedSmoke,
  runVerifiedArchiveExtraction,
  selectEvidenceProcessEnvironment,
  terminateProcessTree,
  verifyNativeInstallerBinding,
};
