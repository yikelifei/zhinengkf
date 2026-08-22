"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const { loadCompanyProfile } = require("../packages/runtime/company-profile");
const {
  PACKAGE_PROVENANCE_SCHEMA_VERSION,
  resolveRepositoryState,
} = require("./repository-provenance");
const {
  assertSafePath,
  assertSafeRoot,
  evaluateArtifactPolicy,
  inspectNativeAuthenticode,
  inspectPeArchitecture,
  loadReleasePolicy,
} = require("./windows-evidence-chain");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "release", "windows");
const SCHEMA_VERSION = "smart_kefu_windows_package_verification_v3";

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const result = await verifyWindowsPackage({
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

async function verifyWindowsPackage(options) {
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
  let safeOutputRoot = null;
  try {
    safeOutputRoot = assertSafeRoot(options.outputDir);
  } catch (error) {
    checks.push({ name: "package tree path safety", status: "FAIL", detail: error.message });
  }

  checks.push({
    name: "repository worktree clean",
    status: repositoryState.clean ? "PASS" : "FAIL",
    detail: repositoryState.clean ? "Git worktree was clean when package verification started." : "Git worktree is dirty; package provenance cannot be bound to HEAD.",
  });

  checkExists(checks, "unpacked application", unpackedDir, safeOutputRoot, "directory");
  checkExists(checks, "Windows executable entry", executable, safeOutputRoot);
  checkPortableExecutable(checks, "Windows executable PE format", executable);
  checkExists(checks, "application asar", asarPath, safeOutputRoot);
  checkExists(checks, "packaged API entry", path.join(resourcesDir, "services", "api", "main.js"), safeOutputRoot);
  checkExists(checks, "packaged API storage code", path.join(resourcesDir, "services", "api", "storage", "storage.service.js"), safeOutputRoot);
  checkExists(checks, "packaged Web entry", path.join(resourcesDir, "services", "web", "apps", "web", "server.js"), safeOutputRoot);
  checkExists(checks, "packaged rules entry", path.join(resourcesDir, "services", "runtime-root", "packages", "rules", "index.js"), safeOutputRoot);
  checkExists(checks, "packaged window observer", path.join(resourcesDir, "services", "runtime-root", "tools", "wechat-window-observer.js"), safeOutputRoot);
  checkExists(checks, "packaged placeholder-only AI settings", path.join(resourcesDir, "services", "runtime-root", "config", "settings.yaml"), safeOutputRoot);
  const companyProfilePath = path.join(resourcesDir, "company", "company-profile.json");
  checkExists(checks, "embedded company profile", companyProfilePath, safeOutputRoot);
  try {
    const companyProfile = loadCompanyProfile({ filePath: companyProfilePath });
    const validCompanyBinding = companyProfile.organization.displayName === "臻希礼业"
      && companyProfile.workspace.ownership === "company"
      && companyProfile.workspace.edition === "single_company_internal"
      && companyProfile.wechatWork.accountDisplayName === "禮想礼品";
    checks.push({
      name: "single-company package binding",
      status: validCompanyBinding ? "PASS" : "FAIL",
      detail: validCompanyBinding
        ? "Installer is bound to the 臻希礼业 company workspace and the 禮想礼品 customer-service account."
        : "Embedded company profile does not match the approved single-company workspace.",
    });
  } catch (error) {
    checks.push({ name: "single-company package binding", status: "FAIL", detail: error.message });
  }
  checkExists(checks, "packaged Prisma client", path.join(resourcesDir, "services", "runtime-root", "node_modules", "@prisma", "client", "default.js"), safeOutputRoot);
  checkExists(checks, "packaged generated Prisma client", path.join(resourcesDir, "services", "runtime-root", "node_modules", ".prisma", "client", "default.js"), safeOutputRoot);
  verifyPackagedPrismaTempEngines(checks, resourcesDir);
  checkExists(checks, "packaged Sharp runtime", path.join(resourcesDir, "services", "runtime-root", "node_modules", "sharp", "dist", "index.cjs"), safeOutputRoot);
  checkExists(checks, "packaged Sharp Windows native addon", path.join(resourcesDir, "services", "runtime-root", "node_modules", "@img", "sharp-win32-x64", "lib", "sharp-win32-x64-0.35.3.node"), safeOutputRoot);
  if (!options.directoryOnly) {
    checkExists(checks, "NSIS installer", installer, safeOutputRoot);
    checkPortableExecutable(checks, "NSIS installer PE format", installer, ["x86", "x64"]);
  }

  const smokeReport = options.runtimeSmokeResult || (options.trustStoredSmokeReport === false
    ? { status: "BLOCKED", summary: "stored smoke JSON is not trusted by external evidence validation" }
    : readJson(path.join(options.outputDir, "verification", "packaged-api-smoke.json")));
  checks.push({
    name: "packaged API smoke",
    status: smokeReport?.status === "PASS" ? "PASS" : smokeReport?.status === "BLOCKED" ? "BLOCKED" : "FAIL",
      detail: smokeReport?.status === "PASS" ? `API, overview, static asset, and Web-to-API proxy passed on isolated ports; rules and Prisma loaded from read-only runtime root` : smokeReport?.summary || smokeReport?.error || "missing smoke report",
  });

  const desktopLaunchSmoke = options.desktopLaunchSmokeResult || (options.trustStoredSmokeReport === false
    ? { status: "BLOCKED", summary: "stored desktop launch smoke JSON is not trusted by external evidence validation" }
    : readJson(path.join(options.outputDir, "verification", "packaged-desktop-launch-smoke.json")));
  checks.push({
    name: "packaged desktop launch with default ports unavailable",
    status: desktopLaunchSmoke?.status === "PASS" ? "PASS" : desktopLaunchSmoke?.status === "BLOCKED" ? "BLOCKED" : "FAIL",
    detail: desktopLaunchSmoke?.status === "PASS"
      ? `Smart Kefu.exe stayed alive and selected API=${desktopLaunchSmoke.ports?.api}, Web=${desktopLaunchSmoke.ports?.web} while 3100/3200 were unavailable.`
      : desktopLaunchSmoke?.summary || desktopLaunchSmoke?.error || "missing desktop launch smoke report",
  });

  if (fs.existsSync(asarPath)) {
    verifyAsar(checks, asarPath, packageJson.version, repositoryState);
  }
  if (fs.existsSync(resourcesDir)) verifySensitiveFiles(checks, resourcesDir);

  const signingTargets = [executable, ...(!options.directoryOnly && installer ? [installer] : [])].filter(Boolean);
  const signatures = options.inspectSignatures === false
    ? []
    : signingTargets.filter((item) => fs.existsSync(item)).map(readSignature);
  const allSigned = signatures.length > 0 && signatures.every((item) => item.status === "Valid");
  if (options.requireSigned) {
    const policy = loadReleasePolicy();
    const policyResults = signingTargets.map((file) => evaluateArtifactPolicy({
      label: file === executable ? "executable" : "installer",
      file,
      version: packageJson.version,
      policy,
      signature: signatures.find((item) => item.file === file),
    }));
    const policyStatus = policyResults.some((item) => item.status === "FAIL")
      ? "FAIL" : policyResults.some((item) => item.status === "BLOCKED") ? "BLOCKED" : "PASS";
    checks.push({
      name: "Authenticode signing",
      status: !allSigned ? "FAIL" : policyStatus,
      detail: !allSigned ? formatSignatures(signatures) : policyResults.map((item) => item.summary).join("; "),
    });
  } else if (options.expectUnsigned) {
    checks.push({
      name: "Authenticode signing",
      status: allSigned ? "PASS" : "BLOCKED",
      detail: allSigned ? "Artifacts are signed." : `Unsigned test artifact only; production release is blocked. ${formatSignatures(signatures)}`,
    });
  }

  const failed = checks.some((item) => item.status === "FAIL");
  const [installerArtifact, executableArtifact] = await Promise.all([
    installer && fs.existsSync(installer) ? artifactInfo(installer) : null,
    fs.existsSync(executable) ? artifactInfo(executable) : null,
  ]);
  return {
    schemaVersion: SCHEMA_VERSION,
    repositoryRevision,
    repositoryClean: repositoryState.clean,
    status: failed ? "FAIL" : checks.some((item) => item.status === "BLOCKED") ? "BLOCKED" : "PASS",
    generatedAt: new Date().toISOString(),
    version: packageJson.version,
    verificationProfile: options.requireSigned ? "signed-release" : options.expectUnsigned ? "unsigned-test" : "content-only",
    outputDir: options.outputDir,
    installer: installerArtifact,
    executable: executableArtifact,
    signatures,
    checks,
  };
}

function verifyAsar(checks, asarPath, expectedVersion, repositoryState) {
  const entries = asar.listPackage(asarPath).map(normalizeArchivePath);
  for (const required of [
    "/apps/electron/main.js",
    "/apps/electron/preload.js",
    "/apps/electron/packaged-runtime.js",
    "/apps/electron/desktop-session-refresh.js",
    "/package.json",
    "/.package-provenance.json",
  ]) {
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

function verifyPackagedPrismaTempEngines(checks, resourcesDir) {
  const prismaClientDir = path.join(resourcesDir, "services", "runtime-root", "node_modules", ".prisma", "client");
  if (!fs.existsSync(prismaClientDir)) {
    checks.push({
      name: "packaged Prisma temp engines",
      status: "FAIL",
      detail: "Packaged generated Prisma client directory is missing.",
    });
    return;
  }

  const stale = [];
  walk(prismaClientDir, (file) => {
    if (isPrismaTempEngineFile(file)) stale.push(normalizeArchivePath(path.relative(resourcesDir, file)));
  });
  checks.push({
    name: "packaged Prisma temp engines",
    status: stale.length ? "FAIL" : "PASS",
    detail: stale.length
      ? `Stale Prisma temporary engine file(s) were packaged: ${stale.slice(0, 20).join(", ")}`
      : "No stale Prisma temporary engine files found.",
  });
}

function isPrismaTempEngineFile(value) {
  return /^(?:query_engine|libquery_engine).*\.tmp\d+$/i.test(path.basename(String(value || "")));
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

function checkExists(checks, name, target, safeRoot = null, expectedType = "file") {
  try {
    if (!target || !fs.existsSync(target)) throw new Error("not found");
    if (safeRoot) assertSafePath(safeRoot, target, expectedType);
    checks.push({ name, status: "PASS", detail: target });
  } catch (error) {
    checks.push({ name, status: "FAIL", detail: `${target || "not found"}: ${error.message}` });
  }
}

function checkPortableExecutable(checks, name, target, allowedArchitectures = ["x64"]) {
  let result = { valid: false, architecture: "unknown" };
  try {
    result = inspectPeArchitecture(target);
  } catch {
    result = { valid: false, architecture: "unknown" };
  }
  checks.push({
    name,
    status: result.valid && allowedArchitectures.includes(result.architecture) ? "PASS" : "FAIL",
    detail: result.valid ? `${path.basename(target)} is a ${result.architecture} PE executable.` : "missing or invalid Windows PE executable",
  });
}

function readSignature(file) {
  return { file, ...inspectNativeAuthenticode(file) };
}

function formatSignatures(signatures) {
  return signatures.map((item) => `${path.basename(item.file)}=${item.status}`).join(", ") || "No executable signature evidence.";
}

async function artifactInfo(file) {
  const before = fs.statSync(file, { bigint: true });
  const digest = await sha256FileStream(file);
  const after = fs.statSync(file, { bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
    throw new Error(`artifact changed while it was hashed: ${file}`);
  }
  return { file, bytes: Number(after.size), sha256: digest };
}

function sha256FileStream(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

function walk(directory, visit) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const current = path.join(directory, entry.name);
    const stat = fs.lstatSync(current);
    if (entry.isSymbolicLink() || stat.isSymbolicLink()) throw new Error(`resource tree contains a symbolic link or junction: ${current}`);
    if (entry.isDirectory() && stat.isDirectory()) walk(current, visit);
    else if (entry.isFile() && stat.isFile()) visit(current);
    else throw new Error(`resource tree contains an unsupported filesystem node: ${current}`);
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
  checkPortableExecutable,
  isForbiddenArchivePath,
  isForbiddenResourcePath,
  isPrismaTempEngineFile,
  normalizeArchivePath,
  sha256FileStream,
  validatePackageProvenance,
  verifyWindowsPackage,
};
