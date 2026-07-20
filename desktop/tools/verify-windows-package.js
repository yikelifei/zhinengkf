"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const {
  PACKAGE_PROVENANCE_SCHEMA_VERSION,
  resolveRepositoryState,
} = require("./repository-provenance");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "release", "windows");
const SCHEMA_VERSION = "smart_kefu_windows_package_verification_v3";

if (require.main === module) main();

function main() {
  const args = new Set(process.argv.slice(2));
  const result = verifyWindowsPackage({
    outputDir,
    expectUnsigned: args.has("--expect-unsigned"),
    requireSigned: args.has("--require-signed"),
    directoryOnly: args.has("--dir-only"),
  });
  writeReport(result, outputDir);
  for (const check of result.checks) console.log(`[${check.status}] ${check.name}: ${check.detail}`);
  console.log(`[${result.status}] package verification report: ${path.join(outputDir, "verification", "latest.md")}`);
  if (result.status === "FAIL") process.exit(1);
}

function verifyWindowsPackage(options) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const repositoryState = resolveRepositoryState({
    repositoryRoot: path.resolve(root, ".."),
    ...(options.repositoryRevision !== undefined ? { repositoryRevision: options.repositoryRevision } : {}),
    ...(options.repositoryClean !== undefined ? { repositoryClean: options.repositoryClean } : {}),
    ...(options.runGitCommand ? { runCommand: options.runGitCommand } : {}),
  });
  const repositoryRevision = repositoryState.revision;
  const unpackedDir = path.join(options.outputDir, "win-unpacked");
  const resourcesDir = path.join(unpackedDir, "resources");
  const asarPath = path.join(resourcesDir, "app.asar");
  const executable = path.join(unpackedDir, "Smart Kefu.exe");
  const installer = findInstaller(options.outputDir, packageJson.version);
  const checks = [];

  checks.push({
    name: "repository worktree clean",
    status: repositoryState.clean ? "PASS" : "FAIL",
    detail: repositoryState.clean ? "Git worktree was clean when package verification started." : "Git worktree is dirty; package provenance cannot be bound to HEAD.",
  });

  checkExists(checks, "unpacked application", unpackedDir);
  checkExists(checks, "Windows executable entry", executable);
  checkExists(checks, "application asar", asarPath);
  checkExists(checks, "packaged API entry", path.join(resourcesDir, "services", "api", "main.js"));
  checkExists(checks, "packaged API storage code", path.join(resourcesDir, "services", "api", "storage", "storage.service.js"));
  checkExists(checks, "packaged Web entry", path.join(resourcesDir, "services", "web", "apps", "web", "server.js"));
  checkExists(checks, "packaged rules entry", path.join(resourcesDir, "services", "runtime-root", "packages", "rules", "index.js"));
  checkExists(checks, "packaged window observer", path.join(resourcesDir, "services", "runtime-root", "tools", "wechat-window-observer.js"));
  checkExists(checks, "packaged placeholder-only AI settings", path.join(resourcesDir, "services", "runtime-root", "config", "settings.yaml"));
  checkExists(checks, "packaged Prisma client", path.join(resourcesDir, "services", "runtime-root", "node_modules", "@prisma", "client", "default.js"));
  checkExists(checks, "packaged generated Prisma client", path.join(resourcesDir, "services", "runtime-root", "node_modules", ".prisma", "client", "default.js"));
  checkExists(checks, "packaged Sharp runtime", path.join(resourcesDir, "services", "runtime-root", "node_modules", "sharp", "lib", "index.js"));
  checkExists(checks, "packaged Sharp Windows native addon", path.join(resourcesDir, "services", "runtime-root", "node_modules", "@img", "sharp-win32-x64", "lib", "sharp-win32-x64.node"));
  if (!options.directoryOnly) checkExists(checks, "NSIS installer", installer);

  const smokeReport = readJson(path.join(options.outputDir, "verification", "packaged-api-smoke.json"));
  checks.push({
    name: "packaged API smoke",
    status: smokeReport?.status === "PASS" ? "PASS" : "FAIL",
      detail: smokeReport?.status === "PASS" ? `API, overview, static asset, and Web-to-API proxy passed on isolated ports; rules and Prisma loaded from read-only runtime root` : smokeReport?.error || "missing smoke report",
  });

  if (fs.existsSync(asarPath)) {
    verifyAsar(checks, asarPath, packageJson.version, repositoryState);
  }
  if (fs.existsSync(resourcesDir)) verifySensitiveFiles(checks, resourcesDir);

  const signingTargets = [executable, ...(!options.directoryOnly && installer ? [installer] : [])].filter(Boolean);
  const signatures = signingTargets.filter((item) => fs.existsSync(item)).map(readSignature);
  const allSigned = signatures.length > 0 && signatures.every((item) => item.status === "Valid");
  if (options.requireSigned) {
    checks.push({
      name: "Authenticode signing",
      status: allSigned ? "PASS" : "FAIL",
      detail: allSigned ? "All executable artifacts have valid signatures." : formatSignatures(signatures),
    });
  } else if (options.expectUnsigned) {
    checks.push({
      name: "Authenticode signing",
      status: allSigned ? "PASS" : "BLOCKED",
      detail: allSigned ? "Artifacts are signed." : `Unsigned test artifact only; production release is blocked. ${formatSignatures(signatures)}`,
    });
  }

  const failed = checks.some((item) => item.status === "FAIL");
  return {
    schemaVersion: SCHEMA_VERSION,
    repositoryRevision,
    repositoryClean: repositoryState.clean,
    status: failed ? "FAIL" : checks.some((item) => item.status === "BLOCKED") ? "BLOCKED" : "PASS",
    generatedAt: new Date().toISOString(),
    version: packageJson.version,
    verificationProfile: options.requireSigned ? "signed-release" : options.expectUnsigned ? "unsigned-test" : "content-only",
    outputDir: options.outputDir,
    installer: installer && fs.existsSync(installer) ? artifactInfo(installer) : null,
    executable: fs.existsSync(executable) ? artifactInfo(executable) : null,
    signatures,
    checks,
  };
}

function verifyAsar(checks, asarPath, expectedVersion, repositoryState) {
  const entries = asar.listPackage(asarPath).map(normalizeArchivePath);
  for (const required of ["/apps/electron/main.js", "/apps/electron/preload.js", "/apps/electron/packaged-runtime.js", "/package.json", "/.package-provenance.json"]) {
    checks.push({
      name: `asar entry ${required}`,
      status: entries.includes(required) ? "PASS" : "FAIL",
      detail: entries.includes(required) ? "present" : "missing",
    });
  }
  const forbidden = entries.filter(isForbiddenArchivePath);
  checks.push({
    name: "asar sensitive top-level paths",
    status: forbidden.length ? "FAIL" : "PASS",
    detail: forbidden.length ? forbidden.join(", ") : "No .env, .runtime, storage, logs, or secret key files found.",
  });
  try {
    const archivedPackage = JSON.parse(asar.extractFile(asarPath, "package.json").toString("utf8"));
    const valid = archivedPackage.version === expectedVersion && archivedPackage.main === "apps/electron/main.js";
    checks.push({
      name: "packaged metadata",
      status: valid ? "PASS" : "FAIL",
      detail: `version=${archivedPackage.version}, main=${archivedPackage.main}`,
    });
  } catch (error) {
    checks.push({ name: "packaged metadata", status: "FAIL", detail: error.message });
  }
  try {
    const manifest = JSON.parse(asar.extractFile(asarPath, ".package-provenance.json").toString("utf8"));
    const provenance = validatePackageProvenance(manifest, {
      repositoryRevision: repositoryState.revision,
      repositoryClean: repositoryState.clean,
      packageVersion: expectedVersion,
    });
    checks.push({
      name: "packaged repository provenance",
      status: provenance.valid ? "PASS" : "FAIL",
      detail: provenance.detail,
    });
  } catch {
    checks.push({ name: "packaged repository provenance", status: "FAIL", detail: "Package provenance manifest is missing or invalid." });
  }
}

function validatePackageProvenance(manifest, expected) {
  const generatedAtMs = Date.parse(String(manifest?.generatedAt || ""));
  const valid = manifest?.schemaVersion === PACKAGE_PROVENANCE_SCHEMA_VERSION
    && manifest?.repositoryRevision === expected.repositoryRevision
    && manifest?.repositoryClean === true
    && expected.repositoryClean === true
    && manifest?.packageVersion === expected.packageVersion
    && Number.isFinite(generatedAtMs)
    && generatedAtMs <= Date.now() + 5 * 60 * 1000;
  return {
    valid,
    detail: valid
      ? `schema=${PACKAGE_PROVENANCE_SCHEMA_VERSION}, revision=${expected.repositoryRevision}, clean=true, version=${expected.packageVersion}`
      : "Package provenance does not match the verified clean HEAD and package version.",
  };
}

function verifySensitiveFiles(checks, resourcesDir) {
  const forbidden = [];
  walk(resourcesDir, (file) => {
    const relative = normalizeArchivePath(path.relative(resourcesDir, file));
    if (relative === "/app.asar") return;
    if (isForbiddenResourcePath(relative)) forbidden.push(relative);
  });
  checks.push({
    name: "resource sensitive-file scan",
    status: forbidden.length ? "FAIL" : "PASS",
    detail: forbidden.length ? forbidden.slice(0, 30).join(", ") : "No environment, key, runtime, customer storage, or log files found.",
  });
}

function isForbiddenArchivePath(value) {
  const normalized = normalizeArchivePath(value).toLowerCase();
  return (
    /^\/(?:\.env(?:\.|$)|\.runtime(?:\/|$)|storage(?:\/|$)|logs?(?:\/|$))/.test(normalized) ||
    /\.(?:pem|pfx|p12|key)$/.test(normalized)
  );
}

function isForbiddenResourcePath(value) {
  const normalized = normalizeArchivePath(value).toLowerCase();
  if (/(?:^|\/)node_modules\//.test(normalized)) return /\.(?:pem|pfx|p12|key)$/.test(normalized);
  return (
    /(?:^|\/)\.env(?:\.|$)/.test(normalized) ||
    /(?:^|\/)\.runtime(?:\/|$)/.test(normalized) ||
    /^\/(?:storage|logs?)(?:\/|$)/.test(normalized) ||
    /\.(?:pem|pfx|p12|key)$/.test(normalized)
  );
}

function findInstaller(directory, version) {
  if (!fs.existsSync(directory)) return null;
  return fs.readdirSync(directory)
    .filter((name) => name === `SmartKefu-Setup-${version}-x64.exe`)
    .map((name) => path.join(directory, name))[0] || null;
}

function checkExists(checks, name, target) {
  checks.push({ name, status: target && fs.existsSync(target) ? "PASS" : "FAIL", detail: target || "not found" });
}

function readSignature(file) {
  const escaped = file.replace(/'/g, "''");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status.ToString()`],
    { encoding: "utf8", windowsHide: true },
  );
  return { file, status: String(result.stdout || "Unknown").trim() || "Unknown" };
}

function formatSignatures(signatures) {
  return signatures.map((item) => `${path.basename(item.file)}=${item.status}`).join(", ") || "No executable signature evidence.";
}

function artifactInfo(file) {
  const stat = fs.statSync(file);
  return { file, bytes: stat.size, sha256: sha256(file) };
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function walk(directory, visit) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const current = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(current, visit);
    else if (entry.isFile()) visit(current);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function normalizeArchivePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function writeReport(result, directory) {
  const reportDir = path.join(directory, "verification");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const lines = [
    "# Windows package verification",
    "",
    `- Status: **${result.status}**`,
    `- Version: \`${result.version}\``,
    `- Generated: ${result.generatedAt}`,
    `- Repository revision: \`${result.repositoryRevision}\``,
    `- Repository clean: \`${result.repositoryClean}\``,
    `- Verification profile: \`${result.verificationProfile}\``,
    ...(result.installer ? [`- Installer: \`${result.installer.file}\``, `- Installer SHA-256: \`${result.installer.sha256}\``] : []),
    "",
    "| Check | Status | Evidence |",
    "| --- | --- | --- |",
    ...result.checks.map((item) => `| ${item.name} | ${item.status} | ${String(item.detail).replace(/\|/g, "\\|")} |`),
    "",
    result.status === "BLOCKED"
      ? "This artifact is for local testing only. Production distribution remains blocked until Authenticode signing is valid."
      : "",
  ];
  fs.writeFileSync(path.join(reportDir, "latest.md"), `${lines.join("\n")}\n`, "utf8");
}

module.exports = {
  SCHEMA_VERSION,
  isForbiddenArchivePath,
  isForbiddenResourcePath,
  normalizeArchivePath,
  validatePackageProvenance,
  verifyWindowsPackage,
};
