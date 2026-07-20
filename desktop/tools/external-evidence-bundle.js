"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { resolveRepositoryState, normalizeRepositoryRevision } = require("./repository-provenance");
const { verifyWindowsPackage } = require("./verify-windows-package");
const {
  assertSafePath,
  assertSafeRoot,
  cleanupPrivateTemp,
  createPrivateSnapshot,
  createTreeManifest,
  evaluateArtifactPolicy,
  inspectNativeAuthenticode,
  loadReleasePolicy,
  manifestsEqual,
  runNativePackagedSmoke,
  verifyNativeInstallerBinding,
} = require("./windows-evidence-chain");

const SCHEMA_VERSION = "smart_kefu_external_evidence_bundle_v1";
const STATUS = Object.freeze({ PASS: "PASS", BLOCKED: "BLOCKED", FAIL: "FAIL" });
const STATUS_RANK = Object.freeze({ PASS: 0, BLOCKED: 1, FAIL: 2 });
const EXIT_CODE = Object.freeze({ PASS: 0, BLOCKED: 2, FAIL: 1 });
const EXPECTED_SCHEMAS = Object.freeze({
  staging: "smart_kefu_staging_readiness_v2",
  recovery: "smart_kefu_database_recovery_rehearsal_v2",
  windows: "smart_kefu_windows_package_verification_v3",
});
const MAX_AGE_MS = Object.freeze({
  staging: 24 * 60 * 60 * 1000,
  recovery: 30 * 24 * 60 * 60 * 1000,
  windows: 7 * 24 * 60 * 60 * 1000,
});
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const STAGING_REQUIRED_RESULT_IDS = Object.freeze([
  "config.doctor", "config.environment", "config.database", "config.automation_queue", "config.api_access",
  "config.wechat_work", "config.design_platform", "config.personal_wechat", "config.model_chain",
  "evidence.database_migrations", "evidence.api_health", "evidence.wechat_work", "evidence.design_platform",
  "evidence.personal_wechat", "evidence.automation_queue",
]);
const RECOVERY_REQUIRED_RESULT_IDS = Object.freeze([
  "safety.source", "safety.target", "safety.distinct", "safety.isolated_target", "safety.confirmation",
  "tools.inventory", "tools.versions", "rehearsal.backup", "rehearsal.restore", "evidence.migrations",
  "evidence.consistency", "rehearsal.execution",
]);
const WINDOWS_REQUIRED_CHECKS = Object.freeze([
  "repository worktree clean",
  "unpacked application", "Windows executable entry", "Windows executable PE format", "application asar", "packaged API entry",
  "packaged API storage code", "packaged Web entry", "packaged rules entry", "packaged window observer",
  "packaged placeholder-only AI settings", "packaged Prisma client", "packaged generated Prisma client",
  "packaged Sharp runtime", "packaged Sharp Windows native addon", "NSIS installer", "NSIS installer PE format", "packaged API smoke",
  "asar entry /apps/electron/main.js", "asar entry /apps/electron/preload.js",
  "asar entry /apps/electron/packaged-runtime.js", "asar entry /package.json", "asar entry /.package-provenance.json",
  "asar sensitive top-level paths", "packaged metadata", "packaged repository provenance", "resource sensitive-file scan", "Authenticode signing",
]);

function result(id, title, status, summary, evidence = {}) {
  return { id, title, status, summary, evidence };
}

function computeStatus(results) {
  return results.reduce(
    (current, item) => STATUS_RANK[item.status] > STATUS_RANK[current] ? item.status : current,
    STATUS.PASS,
  );
}

function pathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveEvidencePath(evidenceRoot, requestedPath) {
  if (!String(requestedPath || "").trim()) throw new Error("evidence report path is required");
  const safeRoot = assertSafeRoot(evidenceRoot);
  const root = safeRoot.requested;
  const candidate = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(root, requestedPath);
  if (!pathInside(root, candidate)) throw new Error("evidence report path escapes evidence root");
  assertSafePath(safeRoot, candidate, "file");
  const resolved = fs.realpathSync.native(candidate);
  if (!pathInside(root, resolved)) throw new Error("evidence report path escapes evidence root");
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_REPORT_BYTES) throw new Error("evidence report file is invalid");
  return resolved;
}

function readEvidence(evidenceRoot, requestedPath) {
  try {
    const filePath = resolveEvidencePath(evidenceRoot, requestedPath);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("evidence report JSON object is required");
    return { report: parsed };
  } catch {
    return { error: true };
  }
}

function containsSensitiveValue(value, key = "") {
  if (/(?:password|secret|token|cookie|api[_-]?key|database[_-]?url|redis[_-]?url)/i.test(key)) {
    if (typeof value === "string" && value.trim()) return true;
  }
  if (typeof value === "string") {
    return /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/.test(value)
      || /\b(?:postgres(?:ql)?|redis(?:s)?|https?):\/\/[^\s/@:]+:[^\s/@]+@/i.test(value)
      || /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsSensitiveValue(item));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([childKey, childValue]) => containsSensitiveValue(childValue, childKey));
  }
  return false;
}

function inspectCommon(kind, loaded, currentRevision, nowMs) {
  const state = {
    report: loaded.report || null,
    failures: [],
    blockers: [],
    evidence: {
      schemaValid: false,
      revisionMatches: false,
      fresh: false,
      reportPass: false,
    },
  };
  if (loaded.error || !state.report) {
    state.failures.push("missing or unreadable evidence file");
    return state;
  }
  if (containsSensitiveValue(state.report)) {
    state.failures.push("evidence report contains a sensitive value");
    return state;
  }
  if (state.report.schemaVersion !== EXPECTED_SCHEMAS[kind]) {
    state.blockers.push("schema version is not current");
    return state;
  }
  state.evidence.schemaValid = true;
  let revision;
  try {
    revision = normalizeRepositoryRevision(state.report.repositoryRevision);
  } catch {
    state.failures.push("repository revision is missing or invalid");
    return state;
  }
  state.evidence.revisionMatches = revision === currentRevision;
  if (!state.evidence.revisionMatches) state.blockers.push("repository revision mismatch");

  const generatedAtMs = Date.parse(String(state.report.generatedAt || ""));
  if (!Number.isFinite(generatedAtMs)) {
    state.failures.push("generatedAt is missing or invalid");
    return state;
  }
  const ageMs = nowMs - generatedAtMs;
  if (ageMs < -MAX_FUTURE_SKEW_MS) state.blockers.push("generatedAt is unreasonably in the future");
  else if (ageMs > MAX_AGE_MS[kind]) state.blockers.push("evidence expired");
  else state.evidence.fresh = true;

  state.evidence.reportPass = state.report.status === STATUS.PASS;
  if (state.report.status === STATUS.FAIL) state.failures.push("evidence report status is FAIL");
  else if (state.report.status !== STATUS.PASS) state.blockers.push("evidence report status is not PASS");
  return state;
}

function exactBoolean(object, key, expected) {
  return object && object[key] === expected;
}

function finalizeEvidence(id, title, state, extraEvidence = {}, preferredSummary = "") {
  const status = state.failures.length ? STATUS.FAIL : state.blockers.length ? STATUS.BLOCKED : STATUS.PASS;
  const reason = state.failures[0] || state.blockers[0] || preferredSummary || "evidence is current and structurally valid";
  return result(id, title, status, reason, { ...state.evidence, ...extraEvidence });
}

function inspectStaging(loaded, currentRevision, nowMs) {
  const state = inspectCommon("staging", loaded, currentRevision, nowMs);
  if (!state.report || !state.evidence.schemaValid || state.failures.length || state.report.status !== STATUS.PASS) {
    return finalizeEvidence("evidence.staging", "预发布只读证据", state);
  }
  const safety = state.report.safety;
  const safe = state.report.mode === "read-only-execute"
    && Array.isArray(safety?.allowedNetworkMethods)
    && safety.allowedNetworkMethods.length === 1
    && safety.allowedNetworkMethods[0] === "GET"
    && exactBoolean(safety, "databaseWriteAttempted", false)
    && exactBoolean(safety, "realMessageSendAttempted", false)
    && exactBoolean(safety, "designJobSubmitted", false)
    && exactBoolean(safety, "paymentMutationAttempted", false)
    && safety.externalMutationCount === 0
    && exactBoolean(safety, "secretsIncluded", false)
    && allReportResultsPass(state.report, STAGING_REQUIRED_RESULT_IDS);
  if (!safe) state.failures.push("PASS staging report is missing its read-only safety contract");
  return finalizeEvidence("evidence.staging", "预发布只读证据", state, { readOnlySafetyValid: safe });
}

function reportResult(report, id) {
  return Array.isArray(report?.results) ? report.results.find((item) => item?.id === id) : null;
}

function allReportResultsPass(report, requiredIds) {
  return Array.isArray(report?.results)
    && report.results.length >= requiredIds.length
    && report.results.every((item) => item?.status === STATUS.PASS)
    && requiredIds.every((id) => reportResult(report, id)?.status === STATUS.PASS);
}

function inspectRecovery(loaded, currentRevision, nowMs) {
  const state = inspectCommon("recovery", loaded, currentRevision, nowMs);
  if (!state.report || !state.evidence.schemaValid || state.failures.length || state.report.status !== STATUS.PASS) {
    return finalizeEvidence("evidence.database_recovery", "数据库恢复演练证据", state);
  }
  const safety = state.report.safety;
  const backup = reportResult(state.report, "rehearsal.backup");
  const restore = reportResult(state.report, "rehearsal.restore");
  const migrations = reportResult(state.report, "evidence.migrations");
  const consistency = reportResult(state.report, "evidence.consistency");
  const execution = reportResult(state.report, "rehearsal.execution");
  const safe = state.report.mode === "execute"
    && exactBoolean(safety, "sourceUrlRecorded", false)
    && exactBoolean(safety, "targetUrlRecorded", false)
    && exactBoolean(safety, "passwordRecorded", false)
    && exactBoolean(safety, "dataContentRecorded", false)
    && exactBoolean(safety, "backupArtifactRetained", false)
    && exactBoolean(safety, "restoreTargetMustBeIsolated", true)
    && allReportResultsPass(state.report, RECOVERY_REQUIRED_RESULT_IDS)
    && backup?.status === STATUS.PASS
    && /^[a-f0-9]{64}$/.test(String(backup?.evidence?.sha256 || ""))
    && Number.isInteger(backup?.evidence?.bytes) && backup.evidence.bytes > 0
    && restore?.status === STATUS.PASS
    && migrations?.status === STATUS.PASS
    && migrations?.evidence?.sourceUpToDate === true
    && migrations?.evidence?.targetUpToDate === true
    && consistency?.status === STATUS.PASS
    && consistency?.evidence?.consistent === true
    && execution?.status === STATUS.PASS
    && Number.isInteger(execution?.evidence?.commandsExecuted)
    && execution.evidence.commandsExecuted > 0;
  if (!safe) state.failures.push("PASS recovery report is missing its isolation or consistency contract");
  return finalizeEvidence("evidence.database_recovery", "数据库恢复演练证据", state, { recoverySafetyValid: safe });
}

function validArtifact(value) {
  return value
    && typeof value.file === "string"
    && value.file.trim().length > 0
    && Number.isInteger(value.bytes)
    && value.bytes > 0
    && /^[a-f0-9]{64}$/.test(String(value.sha256 || ""));
}

async function inspectWindows(loaded, currentRevision, nowMs, evidenceRoot, hooks) {
  const state = inspectCommon("windows", loaded, currentRevision, nowMs);
  if (!state.report || !state.evidence.schemaValid || state.failures.length) {
    return finalizeEvidence("evidence.windows_package", "Windows 正式包证据", state);
  }
  if (hooks.mode === "native" && hooks.repositoryClean !== true) {
    state.failures.push("native Windows evidence verification requires a clean verifier repository");
    return finalizeEvidence("evidence.windows_package", "Windows 正式包证据", state, {
      signedReleaseProfile: false,
      nativeEvidenceEligible: false,
    });
  }
  const signedProfile = state.report.verificationProfile === "signed-release";
  if (!signedProfile || state.report.status !== STATUS.PASS) {
    state.blockers = ["unsigned verification is not signed release evidence", ...state.blockers.filter((item) => item !== "unsigned verification is not signed release evidence")];
    return finalizeEvidence("evidence.windows_package", "Windows 正式包证据", state, { signedReleaseProfile: false });
  }
  const checks = Array.isArray(state.report.checks) ? state.report.checks : [];
  const artifacts = [
    inspectLocalArtifact("installer", state.report.installer, state, evidenceRoot),
    inspectLocalArtifact("executable", state.report.executable, state, evidenceRoot),
  ];
  const installer = artifacts[0];
  const executable = artifacts[1];
  const distinctArtifacts = inspectDistinctArtifacts(installer, executable, state);
  const artifactFiles = artifacts.filter(Boolean).map((item) => item.file);
  const signatures = Array.isArray(state.report.signatures) ? state.report.signatures : [];
  const signatureFiles = new Set(signatures.map((item) => canonicalArtifactPath(item?.file)).filter(Boolean));
  const reportedSignaturesValid = artifactFiles.length === 2
    && signatures.length === artifactFiles.length
    && signatures.every((item) => item?.status === "Valid")
    && artifactFiles.every((file) => signatureFiles.has(file));
  const reportedChecksComplete = checks.length > 0
    && checks.every((item) => item?.status === STATUS.PASS)
    && WINDOWS_REQUIRED_CHECKS.every((name) => checks.some((item) => item?.name === name && item.status === STATUS.PASS));
  if (state.report.repositoryClean !== true) state.failures.push("signed package report is not bound to a clean repository");
  if (!reportedSignaturesValid) state.failures.push("signed package report signatures are not bound to both exact artifacts");
  if (!reportedChecksComplete) state.failures.push("signed package report is missing required PASS checks");
  const livePackageVerification = await inspectLiveWindowsPackage({
    installer,
    executable,
    report: state.report,
    currentRevision,
    state,
    evidenceRoot,
    hooks,
  });
  const valid = artifacts.every(Boolean)
    && distinctArtifacts
    && state.report.repositoryClean === true
    && reportedSignaturesValid
    && reportedChecksComplete
    && livePackageVerification.valid;
  if (!valid && !state.failures.length && !state.blockers.length) {
    state.failures.push("PASS signed package report is missing artifact, smoke, content or Authenticode evidence");
  }
  return finalizeEvidence("evidence.windows_package", "Windows 正式包证据", state, {
    signedReleaseProfile: true,
    signedArtifactContractValid: valid,
    artifactsRecomputed: artifacts.length === 2 && artifacts.every(Boolean),
    distinctRegularArtifacts: distinctArtifacts,
    packageContentReverified: livePackageVerification.valid,
    packageVerificationStatus: livePackageVerification.status,
    authenticodeReverified: livePackageVerification.authenticodeStatus === STATUS.PASS,
    signatureVerifierMode: hooks.mode,
    runtimeSmokeMode: livePackageVerification.runtimeSmokeMode,
    installerBindingMode: livePackageVerification.installerBindingMode,
    snapshotManifestSha256: livePackageVerification.snapshotManifestSha256 || "",
    temporaryFilesWritten: livePackageVerification.temporaryFilesWritten === true,
    privateSnapshotCreated: livePackageVerification.privateSnapshotCreated === true,
    signatureInspectionAttempted: livePackageVerification.signatureInspectionAttempted === true,
    installerBindingAttempted: livePackageVerification.installerBindingAttempted === true,
    runtimeSmokeExecuted: livePackageVerification.runtimeSmokeExecuted === true,
    testOnly: hooks.mode === "test-only",
    nativeEvidenceEligible: hooks.mode === "native",
  });
}

function inspectLocalArtifact(label, reported, state, evidenceRoot, options = {}) {
  const recordFailure = options.recordFailure !== false;
  const fail = (message) => {
    if (recordFailure) state.failures.push(message);
    return null;
  };
  if (!validArtifact(reported) || !path.isAbsolute(reported.file) || path.extname(reported.file).toLowerCase() !== ".exe") {
    return fail(`${label} artifact metadata is invalid`);
  }
  try {
    const safeRoot = assertSafeRoot(evidenceRoot);
    const root = safeRoot.canonical;
    const requested = path.resolve(reported.file);
    if (!pathInside(root, requested)) return fail(`${label} artifact escapes evidence root`);
    assertSafePath(safeRoot, requested, "file");
    const file = fs.realpathSync.native(requested);
    if (!pathInside(root, file)) return fail(`${label} artifact escapes evidence root`);
    const stat = fs.statSync(file, { bigint: true });
    if (!stat.isFile() || stat.size <= 0) return fail(`${label} artifact is missing or invalid`);
    if (stat.nlink !== 1n) return fail(`${label} artifact must not be a hard link`);
    const digest = sha256File(file);
    if (stat.size !== BigInt(reported.bytes) || digest !== String(reported.sha256).toLowerCase()) {
      return fail(`${label} artifact bytes or SHA-256 do not match the report`);
    }
    return {
      label,
      file: canonicalArtifactPath(file),
      bytes: Number(stat.size),
      sha256: digest,
      identity: `${stat.dev}:${stat.ino}`,
      reported,
    };
  } catch {
    return fail(`${label} artifact is missing or unreadable`);
  }
}

function inspectDistinctArtifacts(installer, executable, state) {
  if (!installer || !executable) return false;
  const distinct = installer.file !== executable.file
    && installer.identity !== executable.identity
    && installer.sha256 !== executable.sha256;
  if (!distinct) state.failures.push("installer and executable must be two distinct regular files");
  return distinct;
}

async function inspectLiveWindowsPackage({ installer, executable, report, currentRevision, state, evidenceRoot, hooks }) {
  const progress = {
    temporaryFilesWritten: false,
    privateSnapshotCreated: false,
    signatureInspectionAttempted: false,
    installerBindingAttempted: false,
    runtimeSmokeExecuted: false,
  };
  const unavailable = () => ({
    valid: false,
    status: "FAIL",
    authenticodeStatus: "FAIL",
    runtimeSmokeMode: hooks.mode,
    installerBindingMode: hooks.mode,
    ...progress,
  });
  if (!installer || !executable) return unavailable();
  const version = String(report.version || "").trim();
  const outputDir = path.dirname(installer.file);
  const expectedInstaller = canonicalArtifactPath(path.join(outputDir, `SmartKefu-Setup-${version}-x64.exe`));
  const expectedExecutable = canonicalArtifactPath(path.join(outputDir, "win-unpacked", "Smart Kefu.exe"));
  if (!version || installer.file !== expectedInstaller || executable.file !== expectedExecutable) {
    state.failures.push("Windows artifacts do not match the versioned installer and unpacked executable layout");
    return unavailable();
  }
  let snapshot;
  try {
    assertSafePath(assertSafeRoot(evidenceRoot), outputDir, "directory");
    snapshot = createPrivateSnapshot(outputDir, {
      includeTopLevel: [path.basename(installer.file), "win-unpacked"],
    });
  } catch (error) {
    progress.temporaryFilesWritten = error?.temporaryFilesWritten === true;
    state.failures.push("Windows package tree is unsafe or changed while its private snapshot was created");
    return unavailable();
  }
  progress.temporaryFilesWritten = true;
  progress.privateSnapshotCreated = true;
  try {
    const snapshotOutputDir = snapshot.snapshotDirectory;
    const snapshotInstaller = path.join(snapshotOutputDir, path.basename(installer.file));
    const snapshotExecutable = path.join(snapshotOutputDir, "win-unpacked", "Smart Kefu.exe");
    const verification = await verifyWindowsPackage({
      outputDir: snapshotOutputDir,
      expectUnsigned: false,
      requireSigned: false,
      directoryOnly: false,
      repositoryRevision: currentRevision,
      repositoryClean: true,
      trustStoredSmokeReport: false,
      runtimeSmokeResult: { status: STATUS.PASS, summary: "runtime smoke is deferred until trust prerequisites pass" },
      inspectSignatures: false,
    });
    const liveChecksFail = !Array.isArray(verification.checks)
      || verification.checks.length === 0
      || verification.checks.some((item) => item?.status === STATUS.FAIL);
    const liveChecksBlocked = Array.isArray(verification.checks)
      && verification.checks.some((item) => item?.status === STATUS.BLOCKED);
    if (liveChecksFail) state.failures.push("private snapshot package content, ASAR, resources or provenance verification failed");
    else if (liveChecksBlocked) state.blockers.push("private snapshot package verification is incomplete on this host");
    const artifactsMatch = canonicalArtifactPath(verification.installer?.file) === canonicalArtifactPath(snapshotInstaller)
      && canonicalArtifactPath(verification.executable?.file) === canonicalArtifactPath(snapshotExecutable)
      && verification.installer?.bytes === installer.bytes
    && verification.installer?.sha256 === installer.sha256
    && verification.executable?.bytes === executable.bytes
    && verification.executable?.sha256 === executable.sha256;
    if (!artifactsMatch) state.failures.push("private snapshot artifacts do not match the reported installer and executable bytes");

    const contentPrerequisitesPass = verification.status === STATUS.PASS
      && !liveChecksFail && !liveChecksBlocked
      && artifactsMatch;
    progress.signatureInspectionAttempted = contentPrerequisitesPass;
    let authenticodeStatus = STATUS.BLOCKED;
    if (progress.signatureInspectionAttempted) {
      const policy = hooks.releasePolicy || loadReleasePolicy();
      const signatureResults = [
        { label: "installer", file: snapshotInstaller },
        { label: "executable", file: snapshotExecutable },
      ].map((artifact) => {
        let signature;
        try {
          signature = hooks.verifySignature(artifact.file, artifact.label, version);
        } catch {
          signature = { status: "Unavailable", unavailable: true, mode: hooks.mode };
        }
        const policyResult = evaluateArtifactPolicy({ ...artifact, version, policy, signature });
        recordChainStatus(state, policyResult, `${artifact.label} release policy`);
        return policyResult;
      });
      authenticodeStatus = combineChainStatus(signatureResults);
    }

    let installerBinding;
    if (authenticodeStatus === STATUS.PASS) {
      progress.installerBindingAttempted = true;
      installerBinding = hooks.verifyInstallerBinding({
          installer: snapshotInstaller,
          unpackedDirectory: path.join(snapshotOutputDir, "win-unpacked"),
          tempRoot: snapshot.tempRoot,
        });
    } else {
      installerBinding = { status: STATUS.BLOCKED, summary: "installer payload parsing was skipped until publisher trust passes", mode: hooks.mode, skipped: true };
    }
    if (!installerBinding.skipped) recordChainStatus(state, installerBinding, "signed installer payload binding");

    const trustPrerequisitesPass = contentPrerequisitesPass
      && authenticodeStatus === STATUS.PASS
      && installerBinding.status === STATUS.PASS;
    let runtimeSmoke;
    if (trustPrerequisitesPass) {
      progress.runtimeSmokeExecuted = true;
      runtimeSmoke = hooks.runPackagedSmoke({ outputDirectory: snapshotOutputDir, tempRoot: snapshot.tempRoot });
    } else {
      runtimeSmoke = { status: STATUS.BLOCKED, summary: "runtime smoke was not executed before content, publisher and installer binding trust passed", mode: hooks.mode, skipped: true };
    }
    if (!runtimeSmoke.skipped) recordChainStatus(state, runtimeSmoke, "packaged runtime smoke");

    const snapshotAfter = createTreeManifest(snapshotOutputDir);
    const sourceAfter = createTreeManifest(outputDir, snapshot.treeOptions);
    const stable = manifestsEqual(snapshot.snapshotManifest, snapshotAfter)
      && manifestsEqual(snapshot.sourceManifest, sourceAfter);
    if (!stable) state.failures.push("package tree changed while the private snapshot was being verified");

    const valid = verification.status === STATUS.PASS
      && !liveChecksFail && !liveChecksBlocked
      && artifactsMatch
      && verification.repositoryRevision === currentRevision
      && verification.repositoryClean === true
      && verification.version === version
      && runtimeSmoke.status === STATUS.PASS
      && authenticodeStatus === STATUS.PASS
      && installerBinding.status === STATUS.PASS
      && stable;
    const status = valid ? STATUS.PASS
      : state.failures.length ? STATUS.FAIL : STATUS.BLOCKED;
    return {
      valid,
      status,
      authenticodeStatus,
      runtimeSmokeMode: runtimeSmoke.mode || hooks.mode,
      installerBindingMode: installerBinding.mode || hooks.mode,
      snapshotManifestSha256: snapshot.snapshotManifest.sha256,
      ...progress,
    };
  } catch (error) {
    state.failures.push(`live Windows package verification could not be completed: ${error.message}`);
    return unavailable();
  } finally {
    try {
      cleanupPrivateTemp(snapshot.cleanupHandle);
    } catch {
      state.failures.push("private Windows evidence snapshot could not be cleaned safely");
    }
  }
}

function recordChainStatus(state, item, label) {
  if (item?.status === STATUS.FAIL) state.failures.push(`${label}: ${item.summary || "verification failed"}`);
  else if (item?.status !== STATUS.PASS) state.blockers.push(`${label}: ${item?.summary || "verification is unavailable"}`);
}

function combineChainStatus(items) {
  if (items.some((item) => item?.status === STATUS.FAIL)) return STATUS.FAIL;
  if (items.some((item) => item?.status !== STATUS.PASS)) return STATUS.BLOCKED;
  return STATUS.PASS;
}

function canonicalArtifactPath(value) {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value)) return "";
  try {
    const resolved = fs.realpathSync(path.resolve(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  } catch {
    return "";
  }
}

function sha256File(file) {
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

function nativeHooks() {
  const repositoryState = resolveRepositoryState({ repositoryRoot: path.resolve(__dirname, "..", "..") });
  return {
    mode: "native",
    repositoryClean: repositoryState.clean,
    repositoryRevision: repositoryState.revision,
    verifySignature: inspectNativeAuthenticode,
    runPackagedSmoke: runNativePackagedSmoke,
    verifyInstallerBinding: verifyNativeInstallerBinding,
    releasePolicy: null,
  };
}

function validateEvidenceBundle(options = {}) {
  const hooks = nativeHooks();
  return validateEvidenceBundleInternal({ ...options, currentRevision: hooks.repositoryRevision }, hooks);
}

function createTestEvidenceBundleValidator(testHooks = {}) {
  const hooks = {
    mode: "test-only",
    verifySignature: testHooks.verifySignature || (() => ({ status: "Unavailable", unavailable: true, mode: "test-only" })),
    runPackagedSmoke: testHooks.runPackagedSmoke || (() => ({ status: "BLOCKED", summary: "test smoke hook is not configured", mode: "test-only" })),
    verifyInstallerBinding: testHooks.verifyInstallerBinding || (() => ({ status: "BLOCKED", summary: "test installer hook is not configured", mode: "test-only" })),
    releasePolicy: testHooks.releasePolicy || null,
    repositoryClean: true,
  };
  return (options = {}) => validateEvidenceBundleInternal(options, hooks);
}

async function validateEvidenceBundleInternal(options, hooks) {
  let currentRevision;
  try {
    currentRevision = normalizeRepositoryRevision(options.currentRevision);
  } catch {
    throw new Error("current repository revision unavailable");
  }
  const nowMs = Date.parse(String(options.now || new Date().toISOString()));
  if (!Number.isFinite(nowMs)) throw new Error("bundle validation time is invalid");
  const evidenceRoot = String(options.evidenceRoot || "").trim();
  const loaded = evidenceRoot
    ? {
        staging: readEvidence(evidenceRoot, options.stagingReport),
        recovery: readEvidence(evidenceRoot, options.recoveryReport),
        windows: readEvidence(evidenceRoot, options.windowsReport),
      }
    : { staging: { error: true }, recovery: { error: true }, windows: { error: true } };
  const windowsEvidence = await inspectWindows(loaded.windows, currentRevision, nowMs, evidenceRoot, hooks);
  const results = [
    inspectStaging(loaded.staging, currentRevision, nowMs),
    inspectRecovery(loaded.recovery, currentRevision, nowMs),
    windowsEvidence,
    result(
      "manual.windows_smartscreen",
      "Windows SmartScreen 与安装现场证据",
      STATUS.BLOCKED,
      "现有三类报告不包含 SmartScreen reputation、目标机安装/卸载或人工启动验收，必须继续人工补证。",
      { automatedByBundle: false, required: true },
    ),
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    repositoryRevision: currentRevision,
    generatedAt: new Date(nowMs).toISOString(),
    status: computeStatus(results),
    safety: {
      evidenceInputFilesModified: false,
      temporaryFilesWritten: windowsEvidence.evidence.temporaryFilesWritten === true,
      localToolExecutionAttempted: windowsEvidence.evidence.signatureInspectionAttempted === true
        || windowsEvidence.evidence.installerBindingAttempted === true,
      packagedRuntimeExecutionAttempted: windowsEvidence.evidence.runtimeSmokeExecuted === true,
      localhostHttpAttempted: windowsEvidence.evidence.runtimeSmokeExecuted === true,
      packagingAttempted: false,
      databaseCommandAttempted: false,
      recoveryAttempted: false,
      realMessageSendAttempted: false,
      externalMutationIsolation: windowsEvidence.evidence.runtimeSmokeExecuted === true
        ? "minimal environment and temporary roots; not an OS sandbox"
        : "packaged runtime was not executed",
      secretsIncluded: false,
    },
    verificationMode: hooks.mode,
    summary: {
      pass: results.filter((item) => item.status === STATUS.PASS).length,
      blocked: results.filter((item) => item.status === STATUS.BLOCKED).length,
      fail: results.filter((item) => item.status === STATUS.FAIL).length,
      total: results.length,
    },
    results,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# 外部证据包本地校验",
    "",
    `- 状态：**${report.status}**`,
    `- 仓库修订：\`${report.repositoryRevision}\``,
    `- 生成时间：${report.generatedAt}`,
    "- 安全边界：不修改输入证据、不联网访问外部服务、不打包、不执行数据库或恢复命令、不发送消息；Windows 现场复核会写入并清理私有临时目录、运行受信系统工具，并仅在内容/签名/安装器绑定通过后执行包内 runtime 与 localhost 探测。最小环境不是 OS 沙箱。",
    "",
    "| 状态 | 证据 | 结论 |",
    "| --- | --- | --- |",
  ];
  for (const item of report.results) lines.push(`| ${item.status} | ${item.title} | ${item.summary} |`);
  lines.push("", "`PASS` 输入证据仍不能替代 SmartScreen、目标机安装/卸载和人工启动验收。", "");
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = { evidenceRoot: "", stagingReport: "", recoveryReport: "", windowsReport: "", help: false };
  const mappings = {
    "--evidence-root": "evidenceRoot",
    "--staging-report": "stagingReport",
    "--recovery-report": "recoveryReport",
    "--windows-report": "windowsReport",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (mappings[arg]) {
      const value = String(argv[++index] || "").trim();
      if (!value) throw new Error(`${arg} is required`);
      options[mappings[arg]] = value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help) {
    const missing = Object.entries(mappings).filter(([, key]) => !options[key]).map(([flag]) => flag);
    if (missing.length) throw new Error(`required arguments missing: ${missing.join(", ")}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node tools/external-evidence-bundle.js --evidence-root <dir> --staging-report <json> --recovery-report <json> --windows-report <json>

Reads only the explicitly named local reports. The reports must remain inside
the evidence root. This command does not generate or refresh external evidence.`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return printHelp();
  const report = await validateEvidenceBundle(options);
  process.stdout.write(renderMarkdown(report));
  process.exitCode = EXIT_CODE[report.status];
}

if (require.main === module) {
  main().catch(() => {
    console.error("[external-evidence-bundle] FAIL: local evidence validation could not be completed");
    process.exitCode = EXIT_CODE.FAIL;
  });
}

module.exports = {
  EXIT_CODE,
  SCHEMA_VERSION,
  STATUS,
  parseArgs,
  renderMarkdown,
  sha256File,
  validateEvidenceBundle,
};
if (process.env.NODE_TEST_CONTEXT) {
  module.exports.__createTestEvidenceBundleValidator = createTestEvidenceBundleValidator;
}
