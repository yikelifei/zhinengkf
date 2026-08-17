"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveRepositoryState } = require("./repository-provenance");

const SCHEMA_VERSION = "smart_kefu_windows_package_preflight_v1";
const STATUS = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", FAIL: "FAIL" });
const STATUS_RANK = Object.freeze({ PASS: 0, BLOCKED: 1, FAIL: 2 });
const EXIT_CODE = Object.freeze({ PASS: 0, BLOCKED: 2, FAIL: 1 });
const WINDOWS_VERIFICATION_SCHEMA = "smart_kefu_windows_package_verification_v3";

const desktopRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(desktopRoot, "..");
const defaultReportRoot = path.join(desktopRoot, ".runtime", "windows-package-verification");

function result(id, title, status, summary, evidence = {}) {
  if (!(status in STATUS_RANK)) throw new Error(`unsupported Windows package preflight status: ${status}`);
  return { id, title, status, summary, evidence };
}

function overallStatus(results) {
  return results.reduce(
    (current, item) => (STATUS_RANK[item.status] > STATUS_RANK[current] ? item.status : current),
    STATUS.PASS,
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function exists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function relativeToDesktop(filePath, root) {
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.replace(/\\/g, "/")
    : String(filePath).replace(/\\/g, "/");
}

function summarize(results) {
  return {
    pass: results.filter((item) => item.status === STATUS.PASS).length,
    blocked: results.filter((item) => item.status === STATUS.BLOCKED).length,
    fail: results.filter((item) => item.status === STATUS.FAIL).length,
  };
}

function inspectPackageScripts(packageJson) {
  const scripts = packageJson?.scripts || {};
  const required = {
    "package:win:dir": "build-windows-package.js --dir",
    "package:win:test": "build-windows-package.js",
    "package:win:signed": "build-windows-package.js --signed",
    "package:win:verify": "verify-windows-package.js --expect-unsigned",
  };
  const missing = Object.entries(required)
    .filter(([name, fragment]) => !String(scripts[name] || "").includes(fragment))
    .map(([name]) => name);
  return missing.length
    ? result("package.scripts", "Windows package scripts", STATUS.FAIL, `Missing or drifted scripts: ${missing.join(", ")}.`, { missing })
    : result("package.scripts", "Windows package scripts", STATUS.PASS, "Windows build, signed build and verification scripts are present.", { checked: Object.keys(required) });
}

function inspectPinnedDependencies(packageJson) {
  const devDependencies = packageJson?.devDependencies || {};
  const expected = { "electron-builder": "26.15.3", electron: "42.5.0" };
  const drifted = Object.entries(expected)
    .filter(([name, version]) => devDependencies[name] !== version)
    .map(([name]) => `${name}@${devDependencies[name] || "missing"}`);
  return drifted.length
    ? result("package.dependencies", "Windows packaging dependency pins", STATUS.FAIL, `Packaging dependencies drifted: ${drifted.join(", ")}.`, { expected })
    : result("package.dependencies", "Windows packaging dependency pins", STATUS.PASS, "electron-builder and Electron versions are pinned.", { expected });
}

function inspectElectronBuilderConfig(root) {
  const filePath = path.join(root, "electron-builder.yml");
  if (!exists(filePath)) return result("config.electron_builder", "electron-builder whitelist", STATUS.FAIL, "electron-builder.yml is missing.");
  const text = fs.readFileSync(filePath, "utf8");
  const required = [
    "asar: true",
    "apps/electron/packaged-runtime.js",
    ".package-provenance.json",
    "!.env",
    "!.runtime/**",
    "!storage/**",
    "!logs/**",
    "dist/apps/api",
    "apps/web/.next/standalone",
    "node_modules/.prisma/client",
    ".package-runtime/node_modules",
    "services/runtime-root/node_modules",
    "target: nsis",
  ];
  const missing = required.filter((fragment) => !text.includes(fragment));
  return missing.length
    ? result("config.electron_builder", "electron-builder whitelist", STATUS.FAIL, `Packaging whitelist is missing: ${missing.join(", ")}.`, { missing })
    : result("config.electron_builder", "electron-builder whitelist", STATUS.PASS, "Packaging whitelist and secret exclusions are present.", { path: "electron-builder.yml" });
}

function inspectSigningPolicy(root) {
  const filePath = path.join(root, "config", "windows-release-signing-policy.json");
  const policy = readJson(filePath);
  if (!policy) return result("config.signing_policy", "Windows signing policy", STATUS.FAIL, "Signing policy JSON is missing or unreadable.");
  if (policy.schemaVersion !== "smart_kefu_windows_release_signing_policy_v1") {
    return result("config.signing_policy", "Windows signing policy", STATUS.FAIL, "Signing policy schema is not current.");
  }
  if (policy.identityStatus !== "CONFIGURED") {
    return result("config.signing_policy", "Windows signing policy", STATUS.BLOCKED, "Company signing identity is intentionally unconfigured in this workspace.", { identityStatus: policy.identityStatus });
  }
  const subjects = Array.isArray(policy.allowedPublisherSubjects) ? policy.allowedPublisherSubjects : [];
  const thumbprints = Array.isArray(policy.allowedCertificateThumbprints) ? policy.allowedCertificateThumbprints : [];
  if (!subjects.length || !thumbprints.length) {
    return result("config.signing_policy", "Windows signing policy", STATUS.FAIL, "Configured signing policy must include publisher subject and thumbprint allowlists.");
  }
  return result("config.signing_policy", "Windows signing policy", STATUS.PASS, "Signing policy is configured with publisher and thumbprint allowlists.", { identityStatus: policy.identityStatus });
}

function inspectRepositoryState(repositoryState) {
  return repositoryState.clean === true
    ? result("repository.clean", "Release worktree cleanliness", STATUS.PASS, "Repository is clean for a reproducible package.", { revision: repositoryState.revision, clean: true })
    : result("repository.clean", "Release worktree cleanliness", STATUS.BLOCKED, "Windows packaging must run from a clean frozen release worktree.", { revision: repositoryState.revision, clean: false });
}

function inspectLocalArtifacts(root, packageJson) {
  const outputDir = path.join(root, "release", "windows");
  const version = String(packageJson?.version || "");
  const unpacked = path.join(outputDir, "win-unpacked", "Smart Kefu.exe");
  const installer = path.join(outputDir, `SmartKefu-Setup-${version}-x64.exe`);
  const unpackedPresent = exists(unpacked);
  const installerPresent = exists(installer);
  if (!unpackedPresent && !installerPresent) {
    return result("artifacts.local", "Local Windows package artifacts", STATUS.BLOCKED, "No local Windows package artifacts are present; build only after the release worktree is clean.", { outputDir: relativeToDesktop(outputDir, root) });
  }
  return result("artifacts.local", "Local Windows package artifacts", STATUS.BLOCKED, "Local artifacts exist but are not signed-release evidence until verification passes.", { unpackedPresent, installerPresent });
}

function inspectVerificationReport(root, repositoryState) {
  const reportPath = path.join(root, "release", "windows", "verification", "latest.json");
  const report = readJson(reportPath);
  if (!report) {
    return result("verification.signed_release", "Signed package verification report", STATUS.BLOCKED, "No signed Windows package verification report is present.", { expectedPath: relativeToDesktop(reportPath, root) });
  }
  if (report.schemaVersion !== WINDOWS_VERIFICATION_SCHEMA) {
    return result("verification.signed_release", "Signed package verification report", STATUS.FAIL, "Windows package verification report schema is not current.", { expectedSchema: WINDOWS_VERIFICATION_SCHEMA });
  }
  if (report.status === STATUS.FAIL && report.verificationProfile === "signed-release") {
    return result("verification.signed_release", "Signed package verification report", STATUS.FAIL, "Existing signed-release Windows package verification report is FAIL.", { verificationProfile: report.verificationProfile || "" });
  }
  const signedPass = report.status === STATUS.PASS
    && report.verificationProfile === "signed-release"
    && report.repositoryClean === true
    && report.repositoryRevision === repositoryState.revision;
  return signedPass
    ? result("verification.signed_release", "Signed package verification report", STATUS.PASS, "Current signed-release verification report is present.", { verificationProfile: report.verificationProfile })
    : result("verification.signed_release", "Signed package verification report", STATUS.BLOCKED, "Existing report is not current signed-release PASS evidence.", { status: report.status, verificationProfile: report.verificationProfile || "", repositoryClean: report.repositoryClean === true });
}

function inspectManualTargetEvidence() {
  return result(
    "manual.target_windows",
    "Target Windows install and SmartScreen evidence",
    STATUS.BLOCKED,
    "SmartScreen reputation, target-machine install/uninstall and manual launch evidence must be collected outside this local preflight.",
    { automatedByPreflight: false },
  );
}

function collectWindowsPackagePreflight(options = {}) {
  const root = path.resolve(options.desktopRoot || desktopRoot);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const runId = options.runId || `windows-package-preflight-${generatedAt.replace(/[-:.]/g, "").replace("Z", "Z")}-${process.pid}`;
  const repositoryState = options.repositoryState || resolveRepositoryState({
    repositoryRoot: options.repositoryRoot || path.resolve(root, ".."),
    ...(options.runGitCommand ? { runCommand: options.runGitCommand } : {}),
  });
  const packageJson = readJson(path.join(root, "package.json"));
  const results = [
    packageJson
      ? result("package.manifest", "package.json", STATUS.PASS, "package.json is readable.", { version: String(packageJson.version || "") })
      : result("package.manifest", "package.json", STATUS.FAIL, "package.json is missing or unreadable."),
  ];
  results.push(inspectPackageScripts(packageJson));
  results.push(inspectPinnedDependencies(packageJson));
  results.push(inspectElectronBuilderConfig(root));
  results.push(inspectSigningPolicy(root));
  results.push(inspectRepositoryState(repositoryState));
  results.push(inspectLocalArtifacts(root, packageJson));
  results.push(inspectVerificationReport(root, repositoryState));
  results.push(inspectManualTargetEvidence());
  const summary = summarize(results);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    runId,
    status: overallStatus(results),
    mode: "offline-preflight",
    repositoryRevision: String(repositoryState.revision || ""),
    repositoryClean: repositoryState.clean === true,
    summary: { ...summary, total: results.length },
    safety: {
      networkAttempted: false,
      packagingAttempted: false,
      signingAttempted: false,
      installerExecuted: false,
      databaseCommandAttempted: false,
      realMessageSendAttempted: false,
      paymentMutationAttempted: false,
      secretsIncluded: false,
    },
    results,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Windows package preflight",
    "",
    `- Status: **${report.status}**`,
    `- Mode: \`${report.mode}\``,
    `- Generated: ${report.generatedAt}`,
    `- Repository: \`${report.repositoryRevision}\` clean=${report.repositoryClean}`,
    `- Summary: PASS ${report.summary.pass} / BLOCKED ${report.summary.blocked} / FAIL ${report.summary.fail}`,
    "- Safety: no packaging, no signing, no installer execution, no network, no database command and no real message send.",
    "",
    "| Status | Check | Summary |",
    "| --- | --- | --- |",
    ...report.results.map((item) => `| ${item.status} | ${String(item.title).replace(/\|/g, "\\|")} | ${String(item.summary).replace(/\|/g, "\\|")} |`),
    "",
    "This preflight is not signed-release evidence. External release validation still requires smart_kefu_windows_package_verification_v3 with verificationProfile=signed-release and PASS status.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function writeReports(report, root = defaultReportRoot) {
  const runDirectory = path.join(root, "runs", report.runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  const latestJson = path.join(root, "latest.json");
  const latestMarkdown = path.join(root, "latest.md");
  fs.writeFileSync(path.join(runDirectory, "report.json"), json, "utf8");
  fs.writeFileSync(path.join(runDirectory, "report.md"), markdown, "utf8");
  fs.writeFileSync(latestJson, json, "utf8");
  fs.writeFileSync(latestMarkdown, markdown, "utf8");
  return { runDirectory, latestJson, latestMarkdown };
}

function parseArgs(argv) {
  const options = { help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node tools/windows-package-preflight.js

Writes .runtime/windows-package-verification/latest.{json,md}. This is an
offline preflight only; it does not build, sign, verify, execute or publish a
Windows package.`);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return printHelp();
  const report = collectWindowsPackagePreflight();
  const artifacts = writeReports(report);
  console.log(`[windows-package-preflight] status=${report.status} pass=${report.summary.pass} blocked=${report.summary.blocked} fail=${report.summary.fail}`);
  console.log(`[windows-package-preflight] report=${artifacts.latestMarkdown}`);
  process.exitCode = EXIT_CODE[report.status];
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[windows-package-preflight] FAIL: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = EXIT_CODE.FAIL;
  }
}

module.exports = {
  EXIT_CODE,
  SCHEMA_VERSION,
  STATUS,
  collectWindowsPackagePreflight,
  parseArgs,
  renderMarkdown,
  writeReports,
};
