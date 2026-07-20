"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const POLICY_SCHEMA_VERSION = "smart_kefu_windows_release_signing_policy_v1";
const TEMP_PREFIX = "smart-kefu-windows-evidence-";
const root = path.resolve(__dirname, "..");
const DEFAULT_POLICY_FILE = path.join(root, "config", "windows-release-signing-policy.json");

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

function hashFile(file) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function createTreeManifest(directory) {
  const safeRoot = assertSafeRoot(directory);
  const entries = [];
  const visit = (current, relative) => {
    const children = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"));
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
        entries.push({ path: `${childRelative}/`, type: "directory" });
        visit(childPath, childRelative);
      } else if (child.isFile() && stat.isFile()) {
        if (stat.nlink !== 1n) throw new Error(`tree contains a hard-linked file: ${childRelative}`);
        entries.push({ path: childRelative, type: "file", bytes: Number(stat.size), sha256: hashFile(childPath) });
      } else {
        throw new Error(`tree contains an unsupported filesystem node: ${childRelative}`);
      }
    }
  };
  visit(safeRoot.requested, "");
  const json = JSON.stringify(entries);
  return { entries, sha256: crypto.createHash("sha256").update(json).digest("hex") };
}

function manifestsEqual(left, right) {
  return Boolean(left && right && left.sha256 === right.sha256 && JSON.stringify(left.entries) === JSON.stringify(right.entries));
}

function copySafeTree(source, destination) {
  const sourceRoot = assertSafeRoot(source);
  if (fs.existsSync(destination)) throw new Error("snapshot destination already exists");
  fs.mkdirSync(destination, { recursive: false, mode: 0o700 });
  const visit = (sourceDirectory, destinationDirectory, relative) => {
    const children = fs.readdirSync(sourceDirectory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"));
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
        fs.mkdirSync(destinationPath, { mode: 0o700 });
        visit(sourcePath, destinationPath, childRelative);
      } else if (child.isFile() && stat.isFile()) {
        if (stat.nlink !== 1n) throw new Error(`snapshot source contains a hard-linked file: ${childRelative}`);
        fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(destinationPath, 0o400);
      } else {
        throw new Error(`snapshot source contains an unsupported filesystem node: ${childRelative}`);
      }
    }
  };
  visit(sourceRoot.requested, destination, "");
}

function createPrivateSnapshot(sourceDirectory) {
  const sourceBefore = createTreeManifest(sourceDirectory);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const snapshotDirectory = path.join(tempRoot, "package");
  try {
    copySafeTree(sourceDirectory, snapshotDirectory);
    const sourceAfter = createTreeManifest(sourceDirectory);
    const snapshot = createTreeManifest(snapshotDirectory);
    if (!manifestsEqual(sourceBefore, sourceAfter) || !manifestsEqual(sourceBefore, snapshot)) {
      throw new Error("package tree changed while the private snapshot was created");
    }
    return { tempRoot, snapshotDirectory, sourceManifest: sourceBefore, snapshotManifest: snapshot };
  } catch (error) {
    cleanupPrivateTemp(tempRoot);
    throw error;
  }
}

function cleanupPrivateTemp(tempRoot) {
  const requested = path.resolve(tempRoot);
  const tempParent = path.resolve(os.tmpdir());
  if (path.dirname(requested) !== tempParent || !path.basename(requested).startsWith(TEMP_PREFIX)) {
    throw new Error("refusing to clean an unexpected evidence temp path");
  }
  if (!fs.existsSync(requested)) return;
  const stat = fs.lstatSync(requested);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("refusing to clean a replaced evidence temp path");
  fs.rmSync(requested, { recursive: true, force: true });
}

function loadReleasePolicy(policyFile = DEFAULT_POLICY_FILE) {
  const parsed = JSON.parse(fs.readFileSync(policyFile, "utf8"));
  const configured = parsed?.schemaVersion === POLICY_SCHEMA_VERSION
    && parsed?.identityStatus === "CONFIGURED"
    && Array.isArray(parsed.allowedPublisherSubjects) && parsed.allowedPublisherSubjects.length > 0
    && Array.isArray(parsed.allowedCertificateThumbprints) && parsed.allowedCertificateThumbprints.length > 0;
  return { ...parsed, configured };
}

function absoluteWindowsPowerShell() {
  if (process.platform !== "win32") return "";
  const systemRoot = path.resolve(String(process.env.SystemRoot || process.env.windir || "C:\\Windows"));
  const executable = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return fs.existsSync(executable) ? executable : "";
}

function selectEvidenceProcessEnvironment(overrides = {}, privateRoot = "") {
  const systemRoot = path.resolve(String(process.env.SystemRoot || process.env.windir || "C:\\Windows"));
  const selected = {};
  for (const key of [
    "ComSpec", "PATHEXT", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "OS", "SystemDrive",
    "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "NUMBER_OF_PROCESSORS",
  ]) {
    if (process.env[key] !== undefined) selected[key] = process.env[key];
  }
  selected.SystemRoot = systemRoot;
  selected.WINDIR = systemRoot;
  selected.Path = [
    path.join(systemRoot, "System32"),
    systemRoot,
    path.join(systemRoot, "System32", "Wbem"),
  ].join(path.delimiter);
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
  try {
    const candidate = require("7zip-bin").path7za;
    return candidate && fs.existsSync(candidate) ? path.resolve(candidate) : "";
  } catch {
    return "";
  }
}

function runSevenZip(executable, args, cwd) {
  return spawnSync(executable, args, { cwd, encoding: "utf8", windowsHide: true, shell: false, timeout: 120_000 });
}

function findNamedFile(directory, expectedName) {
  const matches = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const stat = fs.lstatSync(target);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) throw new Error("extractor output contains a reparse point");
      if (entry.isDirectory() && stat.isDirectory()) visit(target);
      else if (entry.isFile() && stat.isFile() && entry.name.toLowerCase() === expectedName.toLowerCase()) matches.push(target);
      else if (!entry.isFile()) throw new Error("extractor output contains an unsupported node");
    }
  };
  visit(directory);
  return matches;
}

function verifyNativeInstallerBinding({ installer, unpackedDirectory, tempRoot }) {
  const sevenZip = findSevenZipExecutable();
  if (!sevenZip) return { status: "BLOCKED", summary: "7zip-bin extractor is unavailable; signed NSIS payload binding is not proven", mode: "native" };
  const outer = path.join(tempRoot, "installer-outer");
  const payload = path.join(tempRoot, "installer-payload");
  fs.mkdirSync(outer, { mode: 0o700 });
  fs.mkdirSync(payload, { mode: 0o700 });
  const outerResult = runSevenZip(sevenZip, ["x", "-y", `-o${outer}`, installer], tempRoot);
  if (outerResult.error) return { status: "BLOCKED", summary: "NSIS extractor could not run on this host", mode: "native" };
  if (outerResult.status !== 0) return { status: "FAIL", summary: "installer is not a readable electron-builder NSIS artifact", mode: "native" };
  let archives;
  try {
    archives = findNamedFile(outer, "app-64.7z");
  } catch (error) {
    return { status: "FAIL", summary: error.message, mode: "native" };
  }
  if (archives.length !== 1) return { status: "FAIL", summary: "electron-builder NSIS app-64.7z payload is missing or ambiguous", mode: "native" };
  const payloadResult = runSevenZip(sevenZip, ["x", "-y", `-o${payload}`, archives[0]], tempRoot);
  if (payloadResult.error) return { status: "BLOCKED", summary: "NSIS payload extractor could not run on this host", mode: "native" };
  if (payloadResult.status !== 0) return { status: "FAIL", summary: "electron-builder NSIS payload could not be extracted", mode: "native" };
  try {
    const expected = createTreeManifest(unpackedDirectory);
    const actual = createTreeManifest(payload);
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
  const runtimeDirectory = path.join(tempRoot, "native-packaged-smoke-runtime");
  const execution = spawnSync(process.execPath, [script], {
    cwd: root,
    env: selectEvidenceProcessEnvironment({
      PACKAGED_SMOKE_OUTPUT_DIR: outputDirectory,
      PACKAGED_SMOKE_REPORT_FILE: reportFile,
      PACKAGED_SMOKE_RUNTIME_DIR: runtimeDirectory,
      PACKAGED_API_SMOKE_PORT: "32191",
      PACKAGED_WEB_SMOKE_PORT: "32190",
    }, path.join(tempRoot, "native-smoke-environment")),
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 120_000,
  });
  if (execution.error?.code === "ETIMEDOUT") return { status: "BLOCKED", summary: "native packaged smoke timed out on this host", mode: "native" };
  if (execution.error) return { status: "BLOCKED", summary: "native packaged smoke could not start on this host", mode: "native" };
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  } catch {
    report = null;
  }
  if (execution.status !== 0 || report?.status !== "PASS") {
    const detail = String(report?.error || execution.stderr || execution.stdout || "packaged runtime smoke failed");
    const blocked = /EADDRINUSE|timed out/i.test(detail);
    return { status: blocked ? "BLOCKED" : "FAIL", summary: blocked ? "native packaged smoke could not obtain its isolated ports" : "packaged runtime smoke failed", mode: "native" };
  }
  return { status: "PASS", summary: "packaged runtime was re-executed from the private snapshot", mode: "native", generatedAt: report.generatedAt };
}

module.exports = {
  DEFAULT_POLICY_FILE,
  POLICY_SCHEMA_VERSION,
  absoluteWindowsPowerShell,
  assertSafePath,
  assertSafeRoot,
  cleanupPrivateTemp,
  createPrivateSnapshot,
  createTreeManifest,
  evaluateArtifactPolicy,
  hashFile,
  inspectNativeAuthenticode,
  inspectPeArchitecture,
  loadReleasePolicy,
  manifestsEqual,
  pathInside,
  runNativePackagedSmoke,
  selectEvidenceProcessEnvironment,
  verifyNativeInstallerBinding,
};
