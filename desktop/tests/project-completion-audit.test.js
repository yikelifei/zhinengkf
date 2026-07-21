"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  STATUS,
  EXIT_CODE,
  REQUIRED_ARTIFACTS,
  absoluteFrom,
  aggregateStatus,
  buildAudit,
  loadTypeScriptCompilerFromDependencyRoot,
  maskTypeScriptCommentsAndStrings,
  toMarkdown,
  writeReport,
} = require("../tools/project-completion-audit");

function write(root, relative, content = "fixture evidence\n", append = false) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (append) fs.appendFileSync(target, content, "utf8");
  else fs.writeFileSync(target, content, "utf8");
  return target;
}

test("TypeScript audit masking preserves layout and hides escaped strings, templates and comments", () => {
  const source = [
    'const doubleQuoted = "fake \\" if (effectKey) return unsafe";',
    'const evenEscapes = "two slashes \\\\"; const visibleAfterEven = true;',
    "const singleQuoted = 'fake \\' Object.assign(principal, payload)';",
    'const templated = `raw fakeToken ${unsafeCall("masked arg")} ${`nested raw ${nestedCall()}`}`;',
    "const matcher = /fakeRequiredToken[/*]/giu;",
    "const braceMatcher = /[{}]/;",
    "const ratio = total / divisor / 2;",
    "if (ready) /controlRegex/.test(value);",
    "if (ready) {} /blockRegex/.test(value);",
    "const nonNullRatio = value! / divisor;",
    "obj.if(value) / divisor; visibleHelper() / other;",
    "obj.return / divisor;",
    "function helper() {} /functionRegex/.test(value);",
    "class AuditClass {} /classRegex/.test(value);",
    "/* if (released || !fs.existsSync(ownerPath)) return unsafe; */",
    "// fakeLf\nconst afterLf = true;",
    "// fakeCr\rconst afterCr = true;",
    "// fakeLs\u2028const afterLs = true;",
    "// fakePs\u2029const afterPs = true;",
    "const realGate = effectKey;",
  ].join("\n");
  const masked = maskTypeScriptCommentsAndStrings(source);
  const lineOffsets = (value) => {
    const offsets = [];
    for (let index = 0; index < value.length; index += 1) {
      if (["\r", "\n", "\u2028", "\u2029"].includes(value[index])) offsets.push(index);
    }
    return offsets;
  };

  assert.equal(masked.length, source.length);
  assert.deepEqual(lineOffsets(masked), lineOffsets(source));
  assert.match(masked, /const doubleQuoted = "\s*";/);
  assert.match(masked, /const evenEscapes = "\s*"; const visibleAfterEven = true;/);
  assert.match(masked, /const singleQuoted = '\s*';/);
  assert.match(masked, /const templated = `\s*\$\{unsafeCall\("\s*"\)\}\s*\$\{`\s*\$\{nestedCall\(\)\}`\}`;/);
  assert.match(masked, /const matcher = \/\s*\/\s*;/);
  assert.match(masked, /const braceMatcher = \/\s*\//);
  assert.match(masked, /const ratio = total \/ divisor \/ 2;/);
  assert.match(masked, /if \(ready\) \/\s*\/\.test\(value\);/);
  assert.match(masked, /if \(ready\) \{\} \/\s*\/\.test\(value\);/);
  assert.match(masked, /const nonNullRatio = value! \/ divisor;/);
  assert.match(masked, /obj\.if\(value\) \/ divisor; visibleHelper\(\) \/ other;/);
  assert.match(masked, /obj\.return \/ divisor;/);
  assert.match(masked, /function helper\(\) \{\} \/\s*\/\.test\(value\);/);
  assert.match(masked, /class AuditClass \{\} \/\s*\/\.test\(value\);/);
  assert.doesNotMatch(masked, /fakeToken|fakeRequiredToken|Object\.assign|return unsafe|released \|\|/);
  assert.match(masked, /const realGate = effectKey;/);
});

test("TypeScript audit masking rejects unterminated strings, templates, regexes and block comments", () => {
  for (const source of [
    'const value = "unterminated',
    "const value = 'unterminated",
    "const value = `unterminated",
    "const value = `unterminated ${call()",
    "const value = /unterminated",
    "const value = /[unterminated/",
    "/* unterminated",
  ]) {
    assert.throws(() => maskTypeScriptCommentsAndStrings(source), SyntaxError, source);
  }
  assert.doesNotThrow(() => maskTypeScriptCommentsAndStrings("// line comment at eof"));
});

test("TypeScript audit loader fails closed on missing, escaped or incomplete compiler packages", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "completion-audit-typescript-loader-"));
  const packageRoot = path.join(root, "typescript");
  const packageFile = write(root, "typescript/package.json", "{}\n");
  const entryFile = write(root, "typescript/lib/typescript.js", "module.exports = {};\n");
  const compilerApi = {
    createSourceFile() {},
    forEachChild() {},
    getLeadingCommentRanges() {},
    getTrailingCommentRanges() {},
    canHaveDecorators() {},
    getDecorators() {},
    getModifiers() {},
    ScriptTarget: {},
    ScriptKind: {},
    SyntaxKind: {},
  };
  const loadWithApi = (dependencyRoot, options = {}) => loadTypeScriptCompilerFromDependencyRoot(
    dependencyRoot,
    { requireModule: () => compilerApi, ...options },
  );

  assert.throws(() => loadTypeScriptCompilerFromDependencyRoot(""), /dependencies are unavailable/);
  assert.throws(() => loadTypeScriptCompilerFromDependencyRoot(path.join(root, "missing")), /root is unavailable/);
  const missingPackageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "completion-audit-typescript-missing-"));
  assert.throws(() => loadWithApi(missingPackageRoot), /package is incomplete/);
  fs.mkdirSync(path.join(missingPackageRoot, "typescript"), { recursive: true });
  fs.writeFileSync(path.join(missingPackageRoot, "typescript", "package.json"), "{}\n", "utf8");
  assert.throws(() => loadWithApi(missingPackageRoot), /package is incomplete/);
  assert.doesNotThrow(() => loadWithApi(root));
  assert.throws(
    () => loadTypeScriptCompilerFromDependencyRoot(root, { requireModule: () => ({}) }),
    /API is unavailable/,
  );

  const actualRealpathSync = fs.realpathSync;
  const realpathWith = (escapedPath, escapedTarget) => (value) => (
    path.resolve(value) === path.resolve(escapedPath) ? escapedTarget : actualRealpathSync(value)
  );
  assert.throws(
    () => loadWithApi(root, {
      realpathSync: realpathWith(packageRoot, path.join(path.dirname(root), "escaped-typescript")),
    }),
    /package escapes its dependency root/,
  );
  assert.throws(
    () => loadWithApi(root, {
      realpathSync: realpathWith(packageFile, path.join(path.dirname(root), "escaped-package.json")),
    }),
    /manifest escapes its package root/,
  );
  assert.throws(
    () => loadWithApi(root, {
      realpathSync: realpathWith(entryFile, path.join(path.dirname(root), "escaped-typescript.js")),
    }),
    /entry escapes its package root/,
  );
});

function createPassingFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "completion-audit-fixture-"));
  for (const artifact of REQUIRED_ARTIFACTS) write(root, artifact.file);
  write(root, ".gitignore", "desktop/.runtime/\n");
  write(root, "desktop/package.json", JSON.stringify({ dependencies: { sharp: "0.34.5" }, scripts: {
    "test": "node --test --test-concurrency=1 tests/*.test.js",
    "release:gate": "x", "staging:readiness": "x", "database:recovery:plan": "x",
    "database:recovery:execute": "x", "package:win:test": "x", "package:win:signed": "x",
    "ci:release-quality": "x", "project:completion:audit": "x",
    "prisma:agents:init": "node tools/initialize-prisma-agents.js",
  }}));
  write(root, "desktop/electron-builder.yml", "asar: true\nextraResources:\n  - from: x\nwin:\n  target: nsis\n");
  write(root, ".github/workflows/windows-quality.yml", `permissions:
  contents: read
jobs:
  unsigned-package:
    steps:
      - persist-credentials: false
      - uses: actions/upload-artifact@v4
      - run: npm.cmd run package:win:test
      - name: windows-unsigned-package-verification
        path: desktop/release/windows/verification/packaged-api-smoke.json
`);
  write(root, "desktop/packages/rules/skuImport.js", `
const SKU_IMPORT_LIMITS = {
  maxZipEntries: 256, maxZipEntryUncompressedBytes: 1, maxZipTotalUncompressedBytes: 1,
  maxSharedStrings: 1, maxWorksheetRows: 1, maxWorksheetCells: 1,
  maxXmlTagBytes: 1, maxTextRunsPerCell: 1, maxCellTextBytes: 1, maxFinalTextBytes: 1,
};
const XML_SCANNER_CONTRACT = Object.freeze({
  strategy: "forward-only-index-scanner",
  materializesMatchArrays: false,
  rejectsElementNPlusOneBeforeBodyScan: true,
});
function isCanonicalBase64() {}
function scanXmlElements(xml, tagName, options) { let count = 0; const start = findNextXmlStartTag(xml, tagName, 0, xml.length); count += 1; if (count > options.limit) throw new Error(); const openEnd = findXmlTagEnd(xml, start, xml.length); "SKU_IMPORT_XML_MALFORMED"; "SKU_IMPORT_XML_TAG_LIMIT"; "SKU_IMPORT_TEXT_RUN_LIMIT"; "SKU_IMPORT_CELL_TEXT_LIMIT"; }
function findNextXmlStartTag(xml, tagName, start, end) { const needle = tagName; let cursor = start; const found = xml.indexOf(needle, cursor); cursor = found + needle.length; }
function findXmlTagEnd() {}
function parseSkuImportFile() { "SKU_IMPORT_ZIP_BOUNDS"; "SKU_IMPORT_ZIP64_UNSUPPORTED"; "SKU_IMPORT_ZIP_MULTIDISK"; "SKU_IMPORT_ZIP_ENCRYPTED"; "SKU_IMPORT_ZIP_DESCRIPTOR"; "SKU_IMPORT_ZIP_LOCAL_OVERLAP"; "SKU_IMPORT_ZIP_CRC"; maxOutputLength: SKU_IMPORT_LIMITS.maxZipEntryUncompressedBytes; }
function buildSkuImportTemplateXlsx() {}
module.exports={ parseSkuImportFile, buildSkuImportTemplateXlsx, };
`);
  write(root, "desktop/packages/rules/index.js", "module.exports={...require('./skuImport')};\n");
  write(root, "desktop/apps/api/src/wechat/wechat-persistence.ts", 'if (this.isLocal) {}\nwechatWorkBinding; wechatWorkAuditLog; wechatSendTask;\n{ action: "inbound_processed", status: "processed" };\n{ action: "inbound_failed", status: "permanent_manual_review" };\nwechatWorkSyncCursor.updateMany();\ncompleteAttemptAndTask(); linkedTransition; tx.wechatSendTask.updateMany(); tx.wechatSendAttempt.update(); if (linked.count !== 1) throw new Error(); updateSendTaskWithLinkedTransition();\nupsertCanonicalWechatWorkBinding(); deterministicOperationId("wwacct", key); deterministicOperationId("wwcust", key); singleWechatWorkHistoryId(); for (let attempt = 0; attempt < 4; attempt += 1) {} wechat work canonical binding conflict; tx.wechatWorkBinding.updateMany(); lastInboundAt: { lt: lastInboundAt }; normalizeWechatWorkInboundAt();\n');
  write(root, "desktop/packages/runtime/service-environment.js", `
const RUNTIME_KEYS = ["NODE_ENV"];
const API_KEYS = [...RUNTIME_KEYS, "DATABASE_URL", "LOW_VALUE_AUTOMATION_REDIS_URL", "WECHAT_WORK_SECRET", "DESIGN_PLATFORM_ACCESS_TOKEN", "PERSONAL_WECHAT_RPA_TOKEN"];
const OBSERVER_KEYS = [...RUNTIME_KEYS, "WECHAT_WINDOW_OBSERVER_PROOF_FILE"];
const BRIDGE_KEYS = [...RUNTIME_KEYS, "WECHAT_BRIDGE_SERVICE_TOKEN_FILE"];
const PERSONAL_BRIDGE_KEYS = [...BRIDGE_KEYS, "PERSONAL_WECHAT_RPA_CONFIG_FILE"];
const SERVICE_KEYS = Object.freeze({
  api: API_KEYS,
  web: [...RUNTIME_KEYS, "INTERNAL_API_TOKEN", "DESKTOP_WEB_SESSION_PROOF"],
  "design-platform-mock": [...RUNTIME_KEYS],
  "wechat-window-observer": OBSERVER_KEYS,
  "wechat-bridge-worker": BRIDGE_KEYS,
  "personal-wechat-bridge": PERSONAL_BRIDGE_KEYS,
});
const WRAPPER_KEYS = new Set(["NODE_ENV", "DESIGN_PLATFORM_RUNTIME_CONFIG"].map((key) => key.toUpperCase()));
function selectKeys() {}
function selectServiceEnvironment(serviceName, baseEnv, overrides) { const keys = SERVICE_KEYS[serviceName]; return selectKeys({ ...baseEnv, ...overrides }, keys); }
function selectWrapperEnvironment(serviceName, env) { const normalized = "NODE_ENV"; if (WRAPPER_KEYS.has(normalized)) return env; }
function renderWindowsWrapperEnvironment(serviceName, env) { return selectWrapperEnvironment(serviceName, env); }
`);
  write(root, "desktop/apps/electron/packaged-runtime.js", `
function buildApiServiceEnvironment({ baseEnv, token }) { return selectServiceEnvironment("api", baseEnv, { INTERNAL_API_TOKEN: token }); }
function buildWebServiceEnvironment({ baseEnv, token, webSessionProof }) { return selectServiceEnvironment("web", baseEnv, { INTERNAL_API_TOKEN: token, DESKTOP_WEB_SESSION_PROOF: webSessionProof }); }
function waitForHttp(url, child, timeout, validateResponse) { if (response.statusCode === 200 && validateResponse(response)) return response; }
function validateApiHealthResponse(response) { const payload = {}; return payload?.ok === true && payload?.service === "smart-kefu-desktop-api"; }
function desktopReadinessChallengeHeaders() { return {}; }
function validateApiReadinessResponse(response, token, challenge) { const payload = {}; return verifyApiReadinessProof(token, challenge, payload?.[API_READINESS_PROOF_FIELD]); }
function validateWebApiReadinessResponse(response, token, challenge) { return verifyWebReadinessProof(token, challenge, "api-proof", "web-proof"); }
function validateWebOverviewResponse(response) { const contentType = "text/html"; return contentType.includes("text/html") && "overview-center"; }
class Manager { start() { const apiEnv = buildApiServiceEnvironment({}); const api = this.spawnService("api", entry, apiEnv); waitForHttp(API_URL, api, 45_000, (response) => validateApiReadinessResponse(response, this.token, this.webSessionProof), { headers: desktopReadinessChallengeHeaders(this.webSessionProof) }); const web = this.spawnService("web", entry, buildWebServiceEnvironment({})); waitForHttp(WEB_URL, web, 45_000, validateWebOverviewResponse); waitForHttp(PROXY_HEALTH_URL, web, 45_000, (response) => validateWebApiReadinessResponse(response, this.token, this.webSessionProof)); } }
`);
  write(root, "desktop/tools/smoke-packaged-api.js", `
if (apiHealth.statusCode !== 200) throw new Error("API not ready");
if (overview.statusCode !== 200) throw new Error("Web not ready");
if (proxyHealthBody?.code !== "desktop_session_proof_missing") throw new Error("missing proof accepted");
const cookie = desktopSessionCookieHeader(desktopWebSessionProof);
waitForUrl(API_URL, (response) => validateApiReadinessResponse(response, token, desktopWebSessionProof));
if (authenticatedProxyHealth.statusCode !== 200 || !validateWebApiReadinessResponse(authenticatedProxyHealth, token, desktopWebSessionProof)) throw new Error("proxy failed");
const mode = "launch_bound_web_api_hmac";
`);
  write(root, "desktop/packages/runtime/packaged-readiness-proof.js", `
const crypto = require("node:crypto");
const API_DOMAIN = "smart-kefu-api-readiness-v1";
const WEB_DOMAIN = "smart-kefu-web-readiness-v1";
function createProof(token, message) { return crypto.createHmac("sha256", Buffer.from(token, "hex")).update(message).digest("hex"); }
function verifyApiReadinessProof() { return safeEqual(); }
function verifyWebReadinessProof() { return safeEqual(); }
function safeEqual(expected, actual) { return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex")); }
`);
  write(root, "desktop/tools/build-windows-package.js", `
const initialRepositoryState = requireCleanRepository();
runNpm(["run", "build:web"], { FORCE_WEB_CLEAN_BUILD: "1" });
assertBuildInputs();
const packageRepositoryState = requireCleanRepository();
if (packageRepositoryState.revision !== initialRepositoryState.revision) throw new Error();
writePackageProvenance(packageRepositoryState);
`);
  write(root, "desktop/tools/external-evidence-bundle.js", `
const stat = fs.statSync(file, { bigint: true }); if (stat.nlink !== 1n) throw new Error();
if (stat.size !== BigInt(reported.bytes)) throw new Error();
const digest = sha256File(file);
const distinct = inspectDistinctArtifacts(installer, executable, state); if (installer.sha256 !== executable.sha256) {}
const snapshot = createPrivateSnapshot(outputDir, { includeTopLevel: ["win-unpacked"] });
const verification = await verifyWindowsPackage({ outputDir, runtimeSmokeResult: { status: STATUS.PASS, summary: "runtime smoke is deferred" } });
hooks.verifyInstallerBinding({ installer, unpackedDirectory, tempRoot });
const trustPrerequisitesPass = true; hooks.runPackagedSmoke({ outputDirectory: snapshotOutputDir });
progress.signatureInspectionAttempted = contentPrerequisitesPass; progress.installerBindingAttempted = true; progress.runtimeSmokeExecuted = true;
const writeTruth = { temporaryFilesWritten: livePackageVerification.temporaryFilesWritten };
const snapshotAfter = createTreeManifest(snapshotOutputDir);
const sourceAfter = createTreeManifest(outputDir, snapshot.treeOptions);
const stable = manifestsEqual(snapshot.snapshotManifest, snapshotAfter) && manifestsEqual(snapshot.sourceManifest, sourceAfter);
cleanupPrivateTemp(snapshot.cleanupHandle);
const bound = verification.repositoryRevision === currentRevision && verification.version === version;
const evidence = { nativeEvidenceEligible: hooks.mode === "native" };
`);
  write(root, "desktop/tools/windows-evidence-chain.js", `
const stat = fs.lstatSync(file, { bigint: true }); if (stat.isSymbolicLink() || stat.nlink !== 1n) throw new Error();
const treeOptions = {}; const manifest = createTreeManifest(sourceDirectory, treeOptions); if (!manifest) throw new Error("package tree changed while the private snapshot was created");
throw new Error("package tree exceeds maximum total bytes"); throw new Error("private temp cleanup requires its creation handle");
const configured = identityStatus === "CONFIGURED" && allowedPublisherSubjects.length && allowedCertificateThumbprints.length;
const powershell = trustedWindowsSystemTool("WindowsPowerShell", "v1.0", "powershell.exe");
const script = "Get-AuthenticodeSignature";
const extractor = "windows-release-extractor-policy.json"; if (hashFile(candidate) !== policy.sha256) throw new Error(); const archive = "app-64.7z";
  validateSevenZipListing(); const maxCompressionRatio = 200; inspectArchiveBudget(sevenZip, installer); createVerifiedArchiveSnapshot(); archiveSnapshot.path; verifiedArchive = assertSafePath(safeSnapshotRoot, budget.archivePath, "file"); runVerifiedArchiveExtraction(); findNamedFile(outer, "app-64.7z", extractionLimits);
  throw new Error("archive identity or SHA-256 changed after technical listing"); throw new Error("archive contains a linked or reparse entry"); throw new Error("archive file is an ancestor of another entry");
throw new Error("signed installer payload does not match");
const env = selectEvidenceProcessEnvironment({ PACKAGED_SMOKE_OUTPUT_DIR: outputDirectory });
terminateProcessTree(child); throw new Error("packaged runtime smoke orchestrator timed out");
`);
  write(root, "desktop/tools/verify-windows-package.js", `
async function verifyWindowsPackage() { return artifactInfo(file); }
async function artifactInfo(file) { return await sha256FileStream(file); }
function sha256FileStream(file) { return fs.createReadStream(file); }
`);
  write(root, "desktop/apps/api/src/shared/runtime-child-environment.ts", `
const OBSERVER_ENV_KEYS = ["NODE_ENV", "WECHAT_WINDOW_OBSERVER_PROOF_FILE", "WECHAT_WINDOW_SNAPSHOT_INBOX_DIR"];
function buildWindowObserverChildEnvironment(baseEnv, overrides) { const allowed = new Set(OBSERVER_ENV_KEYS); return Object.entries({ ...baseEnv, ...overrides }).filter(([key]) => allowed.has(key.toUpperCase())); }
`);
  write(root, "desktop/tools/private-runtime-file.js", `
function assertPrivateRegularFileOrMissing(filePath) { const stat = fs.lstatSync(filePath); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(); }
function readPrivateJsonFile(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function atomicWritePrivateJson(filePath, value) { const temporaryPath = filePath + ".tmp"; const fd = fs.openSync(temporaryPath, "wx", 0o600); fs.fsyncSync(fd); assertPrivateRegularFileOrMissing(filePath); fs.renameSync(temporaryPath, filePath); }
`);
  write(root, "desktop/apps/api/src/wechat/wechat-persistence.ts", 'if (this.isLocal) {}\nwechatWorkBinding; wechatWorkAuditLog; wechatSendTask;\n{ action: "inbound_processed", status: "processed" };\n{ action: "inbound_failed", status: "permanent_manual_review" };\nwechatWorkSyncCursor.updateMany();\ncompleteAttemptAndTask(); linkedTransition; tx.wechatSendTask.updateMany(); tx.wechatSendAttempt.update(); if (linked.count !== 1) throw new Error(); updateSendTaskWithLinkedTransition();\nupsertCanonicalWechatWorkBinding(); deterministicOperationId("wwacct", key); deterministicOperationId("wwcust", key); singleWechatWorkHistoryId(); for (let attempt = 0; attempt < 4; attempt += 1) {} wechat work canonical binding conflict;\nasync createSendTask(payload: any) { const operationKey = normalizeOperationKey(payload.operationKey); const taskId = deterministicOperationId("send", operationKey); createSendTaskOperationFingerprint(); this.assertSendTaskReplay(existing, payload, operationKey); if (isUniqueConstraintError(error)) this.assertSendTaskReplay(winner, payload, operationKey); }\n');
  write(root, "desktop/apps/api/src/wechat/wechat-persistence.ts", 'tx.wechatWorkBinding.updateMany(); lastInboundAt: { lt: lastInboundAt }; normalizeWechatWorkInboundAt();\n', true);
  write(root, "desktop/apps/api/src/wechat/wechat-persistence.ts", "renewInboundOperationLease(); leaseExpiresAt: { gt: new Date() }; assertInboundOperationReplay();\n", true);
  write(root, "desktop/apps/api/src/wechat-work/wechat-work.service.ts", "activeCursorSyncs; getWechatWorkSyncCursor(); expectedCursor: cursor; permanent_manual_review; cursorScopeMismatch;\n");
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", 'handlePrismaInboundImageSelection(); wechatAccountId: identity.wechatAccountId; conversationId: identity.conversationId; customerId: identity.customerId; latestCandidateRound(); shouldLetQuoteAcceptanceHandleSelectionText(); high_value_customer_selected_image; designSelectionRevisionSignature();\nawait this.executeQueuedSend(freshTask.id); pendingAttempt.adapter !== "windows_bridge"; await this.resolveBridgeAckAttempt(task, payload); validatePrismaLinkedSendState(); deliveryState: "unknown"; acceptedMessageIds: apiMsgIds; bridgeAckTokenHash: hashBridgeAckToken(payload); Files remain in place until the task + attempt transition is durably committed;\nprotectLocalInflightSendFromCancellation(); protectPrismaInflightSendFromCancellation(); protectInFlightSendTasksForManualLock(); deliveryUnknownReason: "manual_cancel_requested_inflight"; manualReviewRequired: true; automaticRetryBlocked: true; resolveUnknownSendDelivery(); "confirmed_sent"; "confirmed_not_sent"; requireExactSendTaskIdentity(); assertExactOperationReplay(); settleWechatWorkAsyncFailure(); deterministicOperationId("wechat_work_audit", operationKey, "manual-send-delivery-resolution"); deliveryResolutionPriority: "manual_audited_terminal"; previousManualDeliveryResolution; manualDeliveryResolution: null; protectedUnknownInFlightSendTaskIds; cancelledInFlightSendTaskIds: [];\n');
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", 'validateSendTask(id: string, expected: ExpectedIdentityPayload = {}) { return this.validateSendTaskWithCurrentWindow(id, expected); }\nconst activeWindow = await this.persistence.getLatestWindowSnapshot(task.wechatAccountId);\nobserverProofToken: currentWechatWindowObserverProofToken();\ncreateWechatWindowObserverAttestation();\n', true);
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", 'claimQueuedSendTaskAndCreateAttempt(); error instanceof WechatBridgeOutboxError && error.deliveryState === "failed"; failureStage = error instanceof WechatBridgeOutboxError; deliveryUnknownReason = knownNotSent ? null : "adapter_execution_exception"; automaticRetryBlocked: !knownNotSent; expectedAttemptStatus: "started";\n', true);
  write(root, "desktop/apps/api/src/wechat/wechat-send-adapter.service.ts", 'class WechatBridgeOutboxError extends Error {}\nstage: "outbox_mkdir"; deliveryState: published ? "unknown" : "failed"; attemptId: context.attemptId;\n');
  write(root, "desktop/apps/api/src/wechat/wechat.controller.ts", `
@Get("accounts")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
listAccounts() {}
@Get("conversations")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
listConversations() {}
@Get("conversations/:id/messages")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
listConversationTimeline() {}
@Post("conversations/:id/read")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
markConversationMessagesRead() {}
@Get("send-tasks")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
listSendTasks() {}
@Get("send-attempts")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
listSendAttempts() {}
@Get("send-adapter")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
getSendAdapter() {}
@Get("channels/status")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
getChannelStatus() {}
@Get("bridge/outbox")
@RequireOperatorCapability("view_console")
@UseGuards(WechatBridgeAccessGuard)
listBridgeOutbox() {}
@Get("bridge/dispatch")
@RequireOperatorCapability("view_console")
@UseGuards(WechatBridgeAccessGuard)
listBridgeDispatch() {}
@Get("bridge/status")
@RequireOperatorCapability("view_console")
@UseGuards(WechatBridgeAccessGuard)
getBridgeStatus() {}
@Post("bridge/inbox/scan")
@RequireOperatorCapability("view_console")
@UseGuards(WechatBridgeAccessGuard)
scanBridgeInbox() {}
@Get("window-snapshots")
@RequireOperatorCapability("view_console")
@UseGuards(WechatWindowObserverAccessGuard)
listWindowSnapshots() {}
@Get("window-observer/status")
@RequireOperatorCapability("view_console")
@UseGuards(WechatWindowObserverAccessGuard)
getWindowObserverStatus() {}
@Post("window-snapshots/inbox/scan")
@RequireOperatorCapability("view_console")
@UseGuards(WechatWindowObserverAccessGuard)
scanWindowSnapshotInbox() {}
@Post("inbound/messages")
@RequireOperatorCapability("approve_send")
@UseGuards(OperatorAccessGuard)
processInboundMessage(@Body() payload, @TrustedOperator() _principal) {}
  @Post("send-tasks/:id/bridge-ack")
  acknowledgeBridgeSend() {}
  @Post("send-tasks/:id/resolve-delivery")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  @TrustedOperator() principal
  resolveSendDelivery() { return this.wechat.resolveUnknownSendDelivery(id, payload, principal.id); }
validateSendTask(
  @Param("id") id: string,
  @Body() payload: ExpectedIdentityPayload,
) {}
`);
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", 'queueOrderConfirmationWithProvenance(orderDraftId, manualOrderQueueRequest(payload), null) { normalizeOperationKey(payload.operationKey, "operationKey"); }\nqueueLowValueOrderConfirmation();\nqueueOrderFollowupWithProvenance(orderDraftId, manualOrderQueueRequest(payload), null) { normalizeOperationKey(payload.operationKey, "operationKey"); }\nqueueLowValueOrderFollowup();\nbuildLowValueOrderAutomation();\norderDraftId: String(order.id);\nquoteDraftId: String(order.quoteDraftId || "");\nqueuedBy: "low_value_automation";\nfunction manualOrderQueueRequest(value) { return { operationKey: stringOrUndefined(value.operationKey) }; }\nenqueueManualReply(payload) { normalizeOperationKey(payload.operationKey, "operationKey"); }\ncreateDemoSendTask(payload: { operationKey: string }) { normalizeOperationKey(payload?.operationKey, "operationKey"); return this.createLocalSendTask({ operationKey, customerId: conversation.customerId }); }\ncreatePrismaDemoSendTask(payload) { return this.persistence.createSendTask({ operationKey: payload.operationKey, customerId: conversation.customerId }); }\n', true);
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", 'buildOrderSendContext();\norderContext: params.orderContext;\nthis.orderSendContext(task);\n', true);
  write(root, "desktop/apps/api/src/wechat/wechat.controller.ts", 'queueOrderConfirmation(id, { expectedWechatAccountId: payload?.expectedWechatAccountId, expectedConversationId: payload?.expectedConversationId, expectedCustomerId: payload?.expectedCustomerId, owner: principal.id, operationKey: payload?.operationKey });\nqueueOrderFollowup(id, { expectedWechatAccountId: payload?.expectedWechatAccountId, expectedConversationId: payload?.expectedConversationId, expectedCustomerId: payload?.expectedCustomerId, type: payload?.type, owner: principal.id, operationKey: payload?.operationKey });\nsetConversationManualLock(id, { expectedWechatAccountId: payload?.expectedWechatAccountId, expectedConversationId: payload?.expectedConversationId, expectedCustomerId: payload?.expectedCustomerId, locked: payload?.locked, reviewer: principal.id, reason: payload?.reason, note: payload?.note });\n@Post("send-tasks/demo")\ncreateDemoSendTask(payload: { operationKey: string }) { return this.wechat.createDemoSendTask(payload); }\n', true);
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", 'withInboundEffectLease(); hydrateCompletedInboundReplay(); inboundSelectionRecovery(); "high_value_image_selection"; "low_value_image_selection"; "selection_committed"; "high-value inbound selection recovery lost its durable design job binding"; "low-value inbound selection recovery lost its durable quote binding"; commitInboundHighValueSelection();\n', true);
  write(root, "desktop/packages/rules/wechatWindowEvidence.js", 'WECHAT_WINDOW_OBSERVER_ATTESTATION_VERSION; createWechatWindowObserverAttestation(); createHmac("sha256", token); timingSafeEqual(supplied, expected); canonicalObserverAttestation(); canonicalJsonObject();\n');
  write(root, "desktop/apps/api/src/orders/orders.service.ts", 'updatePrismaOrderAndQuoteWithSendInvalidation();\nreturn prisma.$transaction(async (tx: any) => {\ntx.quoteDraft.update();\nstatus: { in: ["queued", "blocked", "failed"] };\ntx.wechatSendTask.updateMany();\ninvalidationStateChanged || cancelledSendTasks.length > 0;\ndecision: "invalidate_pending_order_send_tasks";\nreviewer: "system_order_invalidation";\n});\nasync update(id, patch) { assertGenericOrderUpdatePatch(patch || {}); }\nasync recordVerifiedPayment() { return ["deposit_paid", "paid"]; }\nfunction guard(patch) { if (Object.prototype.hasOwnProperty.call(patch, "paymentStatus")) throw new Error("订单付款状态只能通过报价付款凭证核验入口更新"); }\n');
  write(root, "desktop/README.md", "npm run project:completion:audit\ndhash64:v1\nlegacyIdentityHash\n稳定 SHA-256 身份哈希\n");
  write(root, "docs/PRODUCTION_RELEASE_CHECKLIST.md", "npm run project:completion:audit\nnpm run package:win:signed\nnpm run database:recovery:execute\n真实签名证据保持 BLOCKED\n");
  write(root, "desktop/apps/api/src/automation/automation-queue.runtime.ts", 'import { Queue, Worker } from "bullmq";\nnew Queue("x", { connection: {} }); new Worker("x", async()=>{}, { connection: {} });\n');
  write(root, "desktop/apps/api/src/automation/automation-scheduler.service.ts", 'lowValueAutomationMode === "durable"; bullmq_redis; readiness();\n');
  write(root, "desktop/apps/api/src/prisma/prisma-operations.service.ts", 'listAgents(); listAgentSkills(); createRouteEvaluation(); correctRouteEvaluation(); reviewTrainingSample(); applyAgentSkillSuggestions(); listConversations(); listConversationAudit(); updateConversationOperations(); routingCorrectionRequestKey(); before.correction?.requestKey === requestKey; trainingSample.findFirst(); knowledgeEntry.findFirst(); correctionRequestKey: requestKey; TransactionIsolationLevel.Serializable; NotFoundException; BadRequestException; deterministicOperationId("import", operationKey); deterministicOperationId("sample", operationKey, pairIndex); deterministicOperationId("knowledge", operationKey, pairIndex); isUniqueConstraintError(error); replayChatImport();\nasync createChatImport(payload: any, parsed: any) { const existing = await tx.chatImport.findUnique({ where: { id: importId } }); if (existing) { assertStoredOperationIdentityReplay(); return this.replayChatImport(existing, operation); } const identity = await this.resolveIdentity(tx, payload, "chat import"); }\n');
  write(root, "desktop/apps/api/src/shared/operation-idempotency.ts", "const OPERATION_KEY_MIN_LENGTH = 16; const OPERATION_KEY_MAX_LENGTH = 128; createOperationFingerprint(); deterministicOperationId(); assertStoredOperationIdentityReplay(); OPERATION_KEY_REUSED; sanitizeInboundOperationAttachments(); sanitizeInboundOperationAssetIds(); sanitizeInboundBusinessIdentifier();\n");
  write(root, "desktop/tools/initialize-prisma-agents.js", 'const execute=process.argv.includes("--execute");\nconst requiredConfirmation="INITIALIZE_PRISMA_AGENTS";\nif (!execute) { console.log({status:"PLAN", writesExecuted:false}); process.exit(0); }\nif (confirmation !== requiredConfirmation) throw new Error("refusing");\ninitializePrismaAgentData().catch(() => { process.stderr.write("failed; inspect protected deployment logs"); });\n');
  write(root, "desktop/apps/api/src/agents/agents.service.ts", "PrismaOperationsService; appConfig.useLocalStore; this.requirePrisma().listAgents(); this.requirePrisma().listAgentSkills();\n");
  write(root, "desktop/apps/api/src/routing/routing.service.ts", "PrismaOperationsService; if (!appConfig.useLocalStore) this.evaluatePrisma(); correctRouteEvaluation(); notifyCorrectionBestEffort(); notification delivery is non-authoritative; NotFoundException;\n");
  write(root, "desktop/apps/api/src/quotes/quotes.service.ts", 'async update(id, patch) { assertGenericQuoteUpdatePatch(patch || {}); }\nfunction guard(patch) { if (Object.prototype.hasOwnProperty.call(patch, "paymentStatus")) throw new Error("报价付款状态只能通过付款凭证核验入口更新"); }\nupdateQuoteDraft(id, { ...payload, ...quotePatch }, true); orders.recordVerifiedPayment();\n');
  write(root, "desktop/apps/api/src/quotes/quotes.service.ts", 'queueSendWithProvenance(id, manualQuoteQueueRequest(options), false);\nqueueSendWithProvenance(id, manualQuoteQueueRequest(options), true);\nsource: "low_value_quote_send"; quoteDraftId: quote.id; queuedBy: "low_value_automation"; automation: trustedAutomation;\nfunction manualQuoteQueueRequest() {}\n', true);
  write(root, "desktop/apps/api/src/local-store/local-store.service.ts", 'routingCorrectionRequestKey(); before.correction?.requestKey === requestKey; correctionRequestKey: requestKey; throw new NotFoundException(`route evaluation not found: ${id}`); throw new BadRequestException(`agent not found: ${key}`);\ncreateChatImport(payload: any, parsed: any) { const existing = data.chatImports.find((item) => item.id === importId); if (existing) { assertStoredOperationIdentityReplay(); return { ...existing, samples: existingSamples }; } const identity = this.validateOptionalConversationBinding(data, payload, "chat import"); }\nfunction localDesignCallbackClaimIsFresh() {}\nclaimDesignJobCallback() { return localDesignCallbackClaimIsFresh(job.callbackClaimedAt) ? "in_progress" : "outcome_unknown"; }\nsettleDesignJobCallbackFailure() {}\nbeginDesignJobCallbackRetry() {}\nmarkDesignJobCallbackOutcomeUnknown() {}\ncommitDesignJobCallbackCompletion() { return { callbackStatus: "settled" }; }\nmonotonicWechatWorkInboundAt(); normalizeWechatWorkInboundAt(); currentValue >= incoming;\n');
  write(root, "desktop/apps/api/src/quotes/quotes.service.ts", 'queueSendWithProvenance(id, manualQuoteQueueRequest(options), false) { normalizeOperationKey(options.operationKey, "operationKey"); this.wechatDispatch.enqueueQuoteMessage({ operationKey }); }\nqueueSendWithProvenance(id, manualQuoteQueueRequest(options), true);\nverifyPaymentProofAndQueueConfirmation(payload) { normalizeOperationKey(payload.operationKey, "operationKey"); this.wechatDispatch.queueOrderConfirmation(id, { operationKey }); }\nsource: "low_value_quote_send"; quoteDraftId: quote.id; queuedBy: "low_value_automation"; automation: trustedAutomation;\nfunction manualQuoteQueueRequest() {}\n', true);
  write(root, "desktop/apps/api/src/local-store/local-store.service.ts", 'routingCorrectionRequestKey(); before.correction?.requestKey === requestKey; correctionRequestKey: requestKey; throw new NotFoundException(`route evaluation not found: ${id}`); throw new BadRequestException(`agent not found: ${key}`);\ncreateChatImport(payload: any, parsed: any) { const existing = data.chatImports.find((item) => item.id === importId); if (existing) { assertStoredOperationIdentityReplay(); return { ...existing, samples: existingSamples }; } const identity = this.validateOptionalConversationBinding(data, payload, "chat import"); }\ncreateSendTask(payload: any) { const operationKey = normalizeOperationKey(payload.operationKey); const taskId = deterministicOperationId("send", operationKey); createSendTaskOperationFingerprint(); assertExactOperationReplay(); assertStoredOperationIdentityReplay(); }\nfunction localDesignCallbackClaimIsFresh() {}\nclaimDesignJobCallback() { return localDesignCallbackClaimIsFresh(job.callbackClaimedAt) ? "in_progress" : "outcome_unknown"; }\nsettleDesignJobCallbackFailure() {}\nbeginDesignJobCallbackRetry() {}\nmarkDesignJobCallbackOutcomeUnknown() {}\ncommitDesignJobCallbackCompletion() { return { callbackStatus: "settled" }; }\n');
  write(root, "desktop/apps/api/src/local-store/local-store.service.ts", "renewInboundMessageOperationLease(); commitInboundHighValueSelection(); recoveryEffect;\n", true);
  write(root, "desktop/apps/api/src/reviews/reviews.service.ts", 'quickConfirmAndQueueSend(id, { operationKey: payload.operationKey });\nthis.quotes.queueSend(id, { operationKey: payload.operationKey });\nthis.wechat.queueOrderConfirmation(id, { operationKey: payload.operationKey });\nthis.wechat.queueOrderFollowup(id, { operationKey: payload.operationKey });\n');
  write(root, "desktop/apps/api/src/local-store/local-store.service.ts", 'monotonicWechatWorkInboundAt(); normalizeWechatWorkInboundAt(); currentValue >= incoming;\n', true);
  write(root, "desktop/apps/api/src/local-store/local-store.service.ts", 'claimQueuedSendTaskAndCreateAttempt() { data.sendTasks[taskIndex] = nextTask; data.sendAttempts.push(attempt); expectedAttemptStatus; }\ncompleteSendAttemptAndTask() {}\n', true);
  write(root, "desktop/apps/web/src/features/sales/sales-order-edit-page.tsx", '付款状态（只读）; 负责人（可信会话记录）; 需从报价页核验付款凭证;\n');
  write(root, "desktop/apps/api/src/training/training.service.ts", "PrismaOperationsService; listSamplesPrisma(); getOverviewPrisma(); reviewSamplePrisma(); listSkillSuggestionsPrisma(); applySkillSuggestionsPrisma();\n");
  write(root, "desktop/apps/api/src/conversation-ops/conversation-operations.service.ts", "PrismaOperationsService; if (!appConfig.useLocalStore) return this.listQueuePrisma(); if (!appConfig.useLocalStore) return this.listAuditPrisma(); if (!appConfig.useLocalStore) return this.updateConversationPrisma(); this.requirePrisma().updateConversationOperations();\n");
  write(root, "desktop/apps/api/src/conversation-ops/conversation-operations.controller.ts", `
@Controller("conversation-ops")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class ConversationOperationsController {
  @Get("queue")
  listQueue() {}

  @Patch("conversations/:id")
  @RequireOperatorCapability("manage_assignments")
  updateConversation() {}
}
`);
  write(root, "desktop/apps/api/src/automation/automation.service.ts", "listAutomationRuns(); saveAutomationRun();\n");
  write(root, "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.service.ts", "REGISTRY_VERSION; readRegistryState(); writeRegistryDocument(); PersonalWechatRpaPersistence; this.persistence.listBindings(); this.persistence.listAudit(); this.persistence.upsertBinding(); this.persistence.recordAudit(); assertProductionIdentity();\n");
  write(root, "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.persistence.ts", "prisma.$transaction(); hydrateBinding(); sanitizeError();\n");
  write(root, "desktop/prisma/schema.prisma", "enum ConversationChannel { personal_wechat work_wechat }\nmodel PersonalWechatRpaBinding {}\nmodel PersonalWechatRpaAuditLog {}\nmodel WechatWorkSyncCursor {}\nmodel SkuChangeLog { changedFields Json before Json? }\nmodel DesignAsset { normalizedLocalPath String? @unique }\npersonalWechatOwnerWxId String? @unique\npersonalWechatRpaBindingKey String? @unique\n");
  write(root, "desktop/apps/api/src/catalog/catalog.service.ts", 'this.prisma.$transaction(); tx.skuChangeLog.create(); changedFields; reason: context.reason; reason: "no_change"; skuChangeLog.findMany();\n');
  write(root, "desktop/apps/api/src/assets/assets.service.ts", 'normalizedLocalPath; await fs.realpath(input); local asset path must be absolute; this.prisma.conversation.findFirst(); normalizedLocalPath: normalized; ambiguous persisted identities; no unambiguous persisted identity;\n');
  write(root, "desktop/apps/api/src/storage/storage.service.ts", 'MAX_IMAGE_FINGERPRINT_BYTES; assertAssetSize(decodeBase64(params.base64)); Buffer.byteLength(params.text, "utf8"); normalizeAssetUrl(params.url); timeout: appConfig.designPlatformTimeoutMs; maxContentLength: MAX_IMAGE_FINGERPRINT_BYTES; maxBodyLength: MAX_IMAGE_FINGERPRINT_BYTES; isCanonicalBase64Text; asset URL must use http(s); inspectSafeAssetContent(); downloadBoundedBytes(); assertCanonicalStoragePath();\n');
  write(root, "desktop/apps/api/src/storage/safe-download.ts", 'resolvePublicDownloadTarget(); if (url.username || url.password) throw new Error(); lookup(hostname, { all: true, verbatim: true }); resolved.some((item) => !isPublicAddress(item.address)); createPinnedLookup(); maxRedirects: 0; proxy: false; 169.254.0.0; 2001:db8::;\n');
  write(root, "desktop/apps/api/src/storage/asset-content-security.ts", 'sharp(buffer); %PDF-; ACTIVE_PDF_PATTERN; new TextDecoder("utf-8", { fatal: true }); ACTIVE_TEXT_PATTERN; asset fileName extension does not match file content; asset mimeType does not match file content; kind: "pdf", mimeType: "application/pdf", extension: ".pdf", inlineSafe: false;\n');
  write(root, "desktop/apps/api/src/storage/local-file-response.ts", 'X-Content-Type-Options; nosniff; Content-Security-Policy; sandbox; Content-Disposition; "attachment";\n');
  write(root, "desktop/docs/DESIGN_PLATFORM_CONTRACT.md", "DNS rebinding; Content-Disposition; realpath; 不再作为“部署侧未决”项冒充已完成;\n");
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.service.ts", 'buildLegacyImageIdentityHash(); legacyIdentityHash; normalizeOperationKey(payload?.operationKey); findUnique({ where: { requestId } }); isUniqueConstraintError(error); activeCreateEffectPromises; requirements.createEffects; effectKey: `${effectRoot}:handoff-review`; completedAt: new Date().toISOString(); deterministicOperationId("review", effectKey);\nasync create(payload: CreateDesignJobPayload) { const existing = findUnique({ where: { requestId } }); if (existing) return this.completeDesignJobCreateEffects(existing, operation, readiness); const identity = await this.validateCreateIdentity(payload); }\n');
  write(root, "desktop/apps/api/src/shared/image-fingerprint.ts", 'import sharp from "sharp";\nconst IMAGE_FINGERPRINT_ALGORITHM = "dhash64:v1";\nsharp().rotate().flatten({}).greyscale().resize(9, 8);\n');
  write(root, "desktop/apps/api/src/wechat-work/wechat-work-api.client.ts", 'fetch(`/cgi-bin/media/get?media_id=${encodeURIComponent(mediaId)}`); errcode === 40007; errcode === 41006; errcode === 45009; retry_exhausted;\n');
  write(root, "desktop/apps/api/src/wechat-work/wechat-work-inbound-media.ts", 'MAX_WECHAT_WORK_INBOUND_IMAGE_BYTES; LOCAL_STORAGE_ROOT; fs.link(temporaryPath, finalPath); inspectExistingImage();\n');
  write(root, "desktop/packages/rules/selectionMatcher.js", 'hammingDistance(); nearest.distance > 1; gap < 2; "候选图存在缺失或旧版指纹";\n');
  write(root, "desktop/tests/wechat-prisma-send-parity.test.js", "Prisma send safety parity tests\n");
  write(root, "desktop/prisma/migrations/20260719233000_design_platform_execution_durability/migration.sql", "CREATE TABLE \"DesignPlatformExecution\" ();\n");
  write(root, "desktop/tests/design-platform-execution-durability.test.js", "durable design execution behavior tests\n");
  write(root, "desktop/apps/api/src/design-jobs/design-platform-execution.service.ts", `
class DesignPlatformExecutionService {
  async begin() {}
  async claimDispatch() {}
  async markGenerating() {}
  async listPublicForDesignJob(designJobId: string) { return rows.map(toPublicExecutionView); }
  async resolveUnknown() { return row; }
  async resolveUnknownPublic(executionId, resolution, reviewer) {
    return toPublicExecutionView(await this.resolveUnknown(executionId, resolution, reviewer));
  }
  async resolveUnsafeRefund() {
    const resumableCompleted = isResumableCompletedExecution(execution);
    if (!isUnsafeRefundResolutionEligible(execution)) throw new Error("unsafe refund only");
    return {
      ...(resumableCompleted ? { acceptanceStatus: "pending" } : {}),
      resolvedAt: resumableCompleted ? null : new Date(),
    };
  }
  async resolveUnsafeRefundPublic(executionId, resolution, reviewer) {
    return toPublicExecutionView(await this.resolveUnsafeRefund(executionId, resolution, reviewer));
  }
  recoverStaleExecutions() {}
  commitAcceptedResult() { designImageCandidate.upsert(); throw new Error("design platform acceptance CAS failed"); }
  marker() { return { status: "outcome_unknown" }; }
}
function toPublicExecutionView(execution) {
  const availableResolution = execution.status === "outcome_unknown"
    ? "confirmed_not_generated_refunded"
    : isUnsafeRefundResolutionEligible(execution)
      ? "confirmed_refunded"
      : null;
  return {
    id: execution.id, attemptNo: execution.attemptNo, status: execution.status,
    acceptanceStatus: execution.acceptanceStatus, refundStatus: execution.refundStatus,
    imageCount: execution.imageCount, errorCategory: execution.errorCategory,
    responseHttpStatus: execution.responseHttpStatus, createdAt: execution.createdAt,
    updatedAt: execution.updatedAt, completedAt: execution.completedAt,
    resolvedAt: execution.resolvedAt, availableResolution,
  };
}
function isUnsafeRefundResolutionEligible(execution) {
  return Boolean(
    execution
    && (execution.status === "explicit_failed" || isResumableCompletedExecution(execution))
    && ["failed", "unknown"].includes(execution.refundStatus),
  );
}
function isResumableCompletedExecution(execution) {
  return execution?.status === "completed" && execution?.acceptanceStatus === "manual_review";
}
"explicit confirmed_not_generated_refunded resolution and reviewer are required";
"design platform execution outcome requires explicit manual resolution before retry";
`);
  write(root, "desktop/apps/api/src/integrations/design-platform/design-platform.client.ts", 'requestId: externalJobId; MALFORMED_SUCCESS_RESPONSE; ECONNABORTED; ECONNRESET; Number(error.response?.status || 0) >= 500; art_image_local results must be read from durable execution; maxRedirects: 0; config.maxRedirects = 0; assertTrustedDesignPlatformTarget(config.baseURL, config.url); config.adapter = this.guardedAdapter; config.transformRequest = copyTransform(trustedTransformRequest); delete config.transport; config.proxy = false; AxiosHeaders.from(config.headers); headers.delete("Authorization"); createForTesting(transport: AxiosAdapter); response.status >= 300 && response.status < 400; DESIGN_PLATFORM_REDIRECT_BLOCKED;\n');
  write(root, "desktop/apps/web/src/lib/desktop-session-proof.ts", 'DESKTOP_SESSION_COOKIE; timingSafeEqual(); requiresDesktopSessionProof(); return true; headers.delete("cookie"); headers.set(internalApiTokenHeader, internalApiToken);\n');
  write(root, "desktop/apps/api/src/shared/app-config.ts", 'DESIGN_PLATFORM_ALLOWED_ORIGINS; designPlatformAccessTokenOrigin; designPlatformCookieOrigin; designPlatformApiKeyOrigin; designPlatformDeviceIdOrigin; hasIndependentDesignPlatformCallbackApiKey(); timingSafeEqual();\n');
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.service.ts", `
buildLegacyImageIdentityHash(); legacyIdentityHash; design_platform_callback_auth;
hasIndependentDesignPlatformCallbackApiKey(); severity: "error"; assertDesignPlatformPreflight();
normalizeOperationKey(payload?.operationKey); findUnique({ where: { requestId } }); isUniqueConstraintError(error); activeCreateEffectPromises; requirements.createEffects; effectKey: \`\${effectRoot}:handoff-review\`; completedAt: new Date().toISOString(); deterministicOperationId("review", effectKey);
async create(payload: CreateDesignJobPayload) { const existing = findUnique({ where: { requestId } }); if (existing) return this.completeDesignJobCreateEffects(existing, operation, readiness); const identity = await this.validateCreateIdentity(payload); }
const DESIGN_CALLBACK_CLAIM_LEASE_MS = 1;
function designSubmitOperation() {}
normalizeOperationKey(payload.operationKey, "design revision operationKey");
function claimDesignCallback() { this.localStore.claimDesignJobCallback(); prisma.designJob.updateMany(); return "in_progress"; callbackStatus: "processing"; }
function markDesignCallbackOutcomeUnknown() { return { callbackStatus: "outcome_unknown" }; }
function commitDesignCallbackCompletion() { return prisma.$transaction(() => {}); }
class DesignJobsService {
  async listExecutions(id, expected) {
    if (!expected.expectedWechatAccountId || !expected.expectedConversationId || !expected.expectedCustomerId) throw new Error("complete identity required");
    const job = await this.getById(id);
    assertExpectedIdentity(job, expected);
    return this.designPlatformExecutions.listPublicForDesignJob(id);
  }
  async resolveUnknownExecution() {
    return this.designPlatformExecutions.resolveUnknownPublic(execution.id, payload.resolution, reviewer);
  }
  async resolveExecutionRefund() {
    return this.designPlatformExecutions.resolveUnsafeRefundPublic(execution.id, payload.resolution, reviewer);
  }
}
`);
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.controller.ts", `
@Controller("design-jobs")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class DesignJobsController {
  localImageFile(reply, file) { applySafeLocalFileHeaders(reply, file); }
  @Get(":id/executions")
  listExecutions(
    @Param("id") id,
    @Query("expectedWechatAccountId") expectedWechatAccountId,
    @Query("expectedConversationId") expectedConversationId,
    @Query("expectedCustomerId") expectedCustomerId,
  ) { return this.designJobs.listExecutions(id, { expectedWechatAccountId, expectedConversationId, expectedCustomerId }); }

  @Post(":id/executions/:executionId/resolve-unknown")
  @RequireOperatorCapability("manage_design_executions")
  resolveUnknownExecution(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trustedBody } = body;
    return this.designJobs.resolveUnknownExecution(id, executionId, trustedBody, principal.id);
  }

  @Post(":id/executions/:executionId/resolve-refund")
  @RequireOperatorCapability("manage_design_executions")
  resolveExecutionRefund(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trustedBody } = body;
    return this.designJobs.resolveExecutionRefund(id, executionId, trustedBody, principal.id);
  }

  @Post(":id/quick-confirm-send")
  @RequireOperatorCapability("approve_send")
  quickConfirmSend() {}
}
`);
  write(root, "desktop/apps/api/src/design-jobs/design-jobs.types.ts", `
export type ResolveUnknownDesignExecutionPayload = {
  resolution: "confirmed_not_generated_refunded";
};
export type ResolveDesignExecutionRefundPayload = {
  resolution: "confirmed_refunded";
};
export type DesignExecutionAvailableResolution =
  | "confirmed_not_generated_refunded"
  | "confirmed_refunded"
  | null;
export type DesignPlatformExecutionView = {
  id: string;
  attemptNo: number;
  status: string;
  acceptanceStatus: string;
  refundStatus: string;
  imageCount: number;
  errorCategory: string | null;
  responseHttpStatus: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  resolvedAt: string | null;
  availableResolution: DesignExecutionAvailableResolution;
};
`);
  write(root, "desktop/apps/web/src/components/design-execution-reconciliation-panel.tsx", `
export const DESIGN_EXECUTION_RESOLUTIONS = {
  unknown: "confirmed_not_generated_refunded",
  refund: "confirmed_refunded",
} as const;

export function getDesignExecutionResolutionBlockedReason({ pending, executions, loading, accessLoaded, canManageExecutions }) {
  if (!pending) return "";
  if (loading) return "loading";
  if (!accessLoaded) return "access unknown";
  if (!canManageExecutions) return "access downgraded";
  const currentExecution = executions.find((execution) => execution.id === pending.executionId);
  if (!currentExecution || currentExecution.availableResolution !== pending.resolution) {
    return "intent changed";
  }
  return "";
}

export function DesignExecutionReconciliationPanel() {
  const pendingBlockedReason = getDesignExecutionResolutionBlockedReason({
    pending,
    executions,
    loading,
    accessLoaded,
    canManageExecutions,
  });
  async function confirmResolution() {
    if (!pending || submitLock.current || submittingId || pendingBlockedReason) return;
    submitLock.current = true;
    if (pending.resolution === DESIGN_EXECUTION_RESOLUTIONS.unknown) {
      await onResolveUnknown(pending.executionId);
    } else if (pending.resolution === DESIGN_EXECUTION_RESOLUTIONS.refund) {
      await onResolveRefund(pending.executionId);
    } else {
      throw new Error("unsupported resolution");
    }
    await onRefresh();
  }
  const action = resolutionAction(execution.availableResolution);
  return <div role="alertdialog">
    <button disabled={loading || !accessLoaded || !canManageExecutions || Boolean(submittingId)} />
    {pendingBlockedReason ? <p role="alert">{pendingBlockedReason}</p> : null}
    <button disabled={Boolean(submittingId) || Boolean(pendingBlockedReason)} />
  </div>;
}
function resolutionAction(resolution) {
  if (resolution === DESIGN_EXECUTION_RESOLUTIONS.unknown) return { resolution };
  if (resolution === DESIGN_EXECUTION_RESOLUTIONS.refund) return { resolution };
  return null;
}
resolutionAction(execution.availableResolution);
`);
  write(root, "desktop/apps/web/src/lib/api.ts", `
function postJsonWithNetworkRetry(path, body) { const serializedBody = JSON.stringify(body); }
function createClientOperationKey() {}
const requestPayload: { operationKey: string } = {};
export async function getDesignJobs() { const response = await fetch("/design-jobs"); if (!response.ok) throw new Error(\`api \${response.status}\`); return response.json(); }
export async function getSkus() { const response = await fetch("/catalog/skus"); if (!response.ok) throw new Error(\`api \${response.status}\`); return response.json(); }
export async function getAssets() { const response = await fetch("/assets"); if (!response.ok) throw new Error(\`api \${response.status}\`); return response.json(); }
export async function createDemoDesignJob(identity, assetIds, operationKey: string) {}
export async function createDemoSendTask(conversationId, operationKey: string, wechatAccountId, expected, text) {
  return postJsonWithNetworkRetry<SendTask>("/wechat/send-tasks/demo", {
    operationKey, conversationId, wechatAccountId, text,
  });
}
function queueManualConversationReply(identity, text, operationKey) {}
function queueQuoteSend(id, operationKey) {}
function verifyQuotePaymentProofAndQueueConfirmation(id, status, operationKey) {}
function queueOrderConfirmation(id, operationKey) {}
function queueOrderFollowup(id, type, operationKey) {}
function reviewDesignJob(id, payload: { operationKey: string }) {}
function reviewQuote(id, payload: { operationKey: string }) {}
function reviewOrder(id, payload: { operationKey: string }) {}
function designExecutionExpectedIdentityQuery(expected) {
  const params = new URLSearchParams();
  params.set("expectedWechatAccountId", expected.expectedWechatAccountId);
  params.set("expectedConversationId", expected.expectedConversationId);
  params.set("expectedCustomerId", expected.expectedCustomerId);
  return params;
}
export async function getDesignJobExecutions(id, expected) {
  return fetch(\`/design-jobs/\${encodeURIComponent(id)}/executions?\${designExecutionExpectedIdentityQuery(expected)}\`);
}
export async function resolveUnknownDesignExecution(designJobId, executionId, expected) {
  return postDesignExecutionResolution(\`/design-jobs/\${encodeURIComponent(designJobId)}/executions/\${encodeURIComponent(executionId)}/resolve-unknown\`,
    { ...expected, resolution: "confirmed_not_generated_refunded" });
}
export async function resolveDesignExecutionRefund(designJobId, executionId, expected) {
  return postDesignExecutionResolution(\`/design-jobs/\${encodeURIComponent(designJobId)}/executions/\${encodeURIComponent(executionId)}/resolve-refund\`,
    { ...expected, resolution: "confirmed_refunded" });
}
async function postDesignExecutionResolution(path, body) {
  return fetch(path, { method: "POST", body: JSON.stringify(body) });
}
`);
  write(root, "desktop/tools/build-web.js", `
function main() {
  if (standaloneServerExists() && productionBuildReady() && !webBuildIsStale()) reuseExistingBuild();
  if (!standaloneServerExists() && productionBuildReady() && !webBuildIsStale()) {
    console.log("Completed Next output has no standalone server; forcing a clean rebuild");
    resetNextBuildState({ force: true });
  }
}
function runNextBuild() {
  if (result.status === 0) waitForBuildOutputReady(60);
  if (result.status === 0 && !hasNextBuildErrorOutput(result) && !webBuildIsStale() && standaloneServerExists()) return;
  if (retry.status === 0) waitForBuildOutputReady(60);
  if (retry.status === 0 && !hasNextBuildErrorOutput(retry) && !webBuildIsStale() && standaloneServerExists()) return;
  if (retry.status === 0 && !hasNextBuildErrorOutput(retry) && productionBuildReady() && !webBuildIsStale()) {
    console.error("refusing to synthesize a source-bound server wrapper");
  }
}
`);
  write(root, "desktop/apps/web/src/lib/client-operation-key.ts", `
function reserveClientOperation(scope, payload, pending) {
  const payloadSignature = stableClientPayload(payload);
  if (pending?.scope === scope && pending.payloadSignature === payloadSignature) return pending;
}
function completeClientOperation(pending, completedKey) { return pending?.key === completedKey ? null : pending; }
function stableClientPayload(value) { return Object.keys(value).sort(); }
`);
  write(root, "desktop/apps/web/src/features/training/training-import-page.tsx", `
const pendingImportOperation = useRef<PendingClientOperation | null>(null);
const operation = reserveClientOperation("training-import", requestPayload, pendingImportOperation.current);
await importChatTranscript({ operationKey: operation.key });
pendingImportOperation.current = completeClientOperation(pendingImportOperation.current, operation.key);
`);
  write(root, "desktop/apps/web/src/features/conversations/use-conversations-controller.ts", `
const operation = reserveClientOperation("manual-reply", payload, pendingReplyOperationRef.current);
pendingReplyOperationRef.current = operation;
await queueManualConversationReply(identity, text, operation.key);
pendingReplyOperationRef.current = completeClientOperation(pendingReplyOperationRef.current, operation.key);
`);
  write(root, "desktop/apps/web/src/features/sales/sales-quote-action-page.tsx", `
const operation = reserveClientOperation("quote-send", payload, pendingOperationRef.current);
pendingOperationRef.current = operation;
await queueQuoteSend(id, operation.key);
pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
`);
  write(root, "desktop/apps/web/src/features/sales/sales-order-message-page.tsx", `
const operation = reserveClientOperation("order-send", payload, pendingOperationRef.current);
pendingOperationRef.current = operation;
await queueOrderConfirmation(id, operation.key);
pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
`);
  write(root, "desktop/apps/web/src/features/reviews/review-design-page.tsx", `
const operation = reserveClientOperation("review-action", payload, pendingOperationRef.current);
pendingOperationRef.current = operation;
await reviewDesignJob(id, { operationKey: operation.key });
pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
`);
  write(root, "desktop/apps/web/src/features/reviews/review-quotes-page.tsx", `
const operation = reserveClientOperation("review-action", payload, pendingOperationRef.current);
pendingOperationRef.current = operation;
await reviewQuote(id, { operationKey: operation.key });
pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
`);
  write(root, "desktop/apps/web/src/features/reviews/review-orders-page.tsx", `
const operation = reserveClientOperation("review-action", payload, pendingOperationRef.current);
pendingOperationRef.current = operation;
await reviewOrder(id, { operationKey: operation.key });
pendingOperationRef.current = completeClientOperation(pendingOperationRef.current, operation.key);
`);
  write(root, "desktop/apps/api/src/wechat-work/wechat-work.controller.ts", `
@Controller("wechat-work")
export class WechatWorkController {
  @Get("status")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  status() {}
  @Get("preflight")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  preflight() {}
  @Get("callback") verifyCallback() {}
  @Post("callback") handleCallback() {}
  @Post("kf/sync")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  sync() {}
  @Post("kf/send-text")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  sendText() {}
  @Post("kf/send-images")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  sendImages() {}
  @Post("kf/send-tasks/:id/dispatch")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  dispatch() {}
  @Get("kf/audit")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  audit() {}
}
`);
  write(root, "desktop/apps/api/src/personal-wechat-rpa/personal-wechat-rpa.controller.ts", `
@Controller("personal-wechat-rpa")
export class PersonalWechatRpaController {
  @Get("instances")
  @RequireOperatorCapability("view_console")
  @UseGuards(OperatorAccessGuard)
  listInstances() {}
  @Post("instances/validate")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  validateInstance() {}
  @Post("instances")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  upsertInstance() {}
  @Post("instances/:wechatAccountId/disable")
  @RequireOperatorCapability("manage_channels")
  @UseGuards(OperatorAccessGuard)
  disableInstance() {}
}
`);
  write(root, "desktop/apps/api/src/reviews/reviews.controller.ts", `
@Controller("reviews")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class ReviewsController {
  @Get() list() {}
  @Post("design-jobs/:id")
  @RequireOperatorCapability("approve_send")
  reviewDesign(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
  @Post("quotes/:id")
  @RequireOperatorCapability("approve_send")
  reviewQuote(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
  @Post("orders/:id")
  @RequireOperatorCapability("approve_send")
  reviewOrder(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
}
`);
  write(root, "desktop/apps/api/src/quotes/quotes.controller.ts", `
@Controller("quotes")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class QuotesController {
  @Post(":id/update")
  @RequireOperatorCapability("manage_design_executions")
  update(@Body() body, @TrustedOperator() principal) {
    const { owner: _untrustedOwner, ...trusted } = body;
    return service({ ...trusted, owner: principal.id });
  }
  @Post(":id/revise-selection")
  @RequireOperatorCapability("manage_design_executions")
  revise(@Body() body, @TrustedOperator() principal) {
    const { owner: _untrustedOwner, ...trusted } = body;
    return service({ ...trusted, owner: principal.id });
  }
  @Post(":id/queue-send")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  queueSend(id, @Body() payload, @TrustedOperator() principal) {
    return this.quotes.queueSend(id, {
      expectedWechatAccountId: payload?.expectedWechatAccountId,
      expectedConversationId: payload?.expectedConversationId,
      expectedCustomerId: payload?.expectedCustomerId,
      note: payload?.note,
      owner: principal.id,
      releaseManualLock: true,
      releaseReason: "manual_quote_send",
      operationKey: payload?.operationKey,
    });
  }
  @Post(":id/verify-payment-proof")
  @RequireOperatorCapability("approve_send")
  @UseGuards(OperatorAccessGuard)
  verify(@Body() body, @TrustedOperator() principal) {
    const { owner: _untrustedOwner, ...trusted } = body;
    return service({ ...trusted, owner: principal.id });
  }
}
`);
  write(root, "desktop/apps/api/src/assets/assets.controller.ts", `
@Controller("assets")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AssetsController {
  localFile(reply, file) { applySafeLocalFileHeaders(reply, file); }
  @Post("upload")
  @RequireOperatorCapability("manage_design_executions")
  upload() {}
  @Post("demo-customer-logo")
  @RequireOperatorCapability("manage_design_executions")
  demo() {}
}
`);
  write(root, "desktop/apps/api/src/agents/agents.controller.ts", `
@Controller("agents")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AgentsController { @Get() list() {} }
`);
  write(root, "desktop/apps/api/src/ai/ai-provider.controller.ts", `
@Controller("ai/providers")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AiProviderController { @Get("status") status() {} }
`);
  write(root, "desktop/apps/api/src/catalog/catalog.controller.ts", `
@Controller("catalog")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class CatalogController {
  @Post("skus/demo-images") @RequireOperatorCapability("manage_design_executions") demo() {}
  @Post("skus") @RequireOperatorCapability("manage_design_executions") upsert() {}
  @Post("skus/batch-update") @RequireOperatorCapability("manage_design_executions") batch() {}
  @Post("skus/:skuCode/deactivate") @RequireOperatorCapability("manage_design_executions") deactivate() {}
  @Post("skus/:skuCode/restore") @RequireOperatorCapability("manage_design_executions") restore() {}
  @Post("skus/bulk") @RequireOperatorCapability("manage_design_executions") bulk() {}
  @Post("skus/import-text") @RequireOperatorCapability("manage_design_executions") importText() {}
  @Post("skus/import-file") @RequireOperatorCapability("manage_design_executions") importFile() {}
}
`);
  write(root, "desktop/apps/api/src/notifications/notifications.controller.ts", `
@Controller("notifications")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class NotificationsController {
  @Post("demo")
  @RequireOperatorCapability("manage_training")
  demo() {}
}
`);
  write(root, "desktop/apps/api/src/orders/orders.controller.ts", `
import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { ExpectedIdentityPayload } from "../shared/identity-expectation";
import { OperatorAccessGuard, RequireOperatorCapability, TrustedOperator } from "../operator-access/operator-access.guard";
import { TrustedOperatorPrincipal } from "../operator-access/operator-access.types";

@Controller("orders")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Get() list() {}
  @Get(":id/confirmation-preview") confirmationPreview() {}
  @Post("from-quote/:quoteId")
  @RequireOperatorCapability("manage_design_executions")
  createFromQuote(@Param("quoteId") quoteId: string, @Body() payload: ExpectedIdentityPayload = {}) {}
  @Post(":id/update")
  @RequireOperatorCapability("manage_design_executions")
  update(
    @Param("id") id: string,
    @Body() payload: { status?: string; customerNotes?: string; owner?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    return this.orders.update(id, {
      status: payload?.status,
      customerNotes: payload?.customerNotes,
      expectedWechatAccountId: payload?.expectedWechatAccountId,
      expectedConversationId: payload?.expectedConversationId,
      expectedCustomerId: payload?.expectedCustomerId,
      owner: principal.id,
    });
  }
  @Post(":id/revise-selection")
  @RequireOperatorCapability("manage_design_executions")
  reviseSelection(
    @Param("id") id: string,
    @Body() body: { selectedImageId?: string; owner?: string; note?: string } & ExpectedIdentityPayload,
    @TrustedOperator() principal: TrustedOperatorPrincipal,
  ) {
    const { owner: _untrustedOwner, ...trusted } = body;
    return service({ ...trusted, owner: principal.id });
  }
}
`);
  write(root, "desktop/apps/api/src/routing/routing.controller.ts", `
@Controller("routing")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class RoutingController {
  @Post("evaluate")
  @RequireOperatorCapability("manage_training")
  evaluate() {}
  @Post("evaluations/:id/correct")
  @RequireOperatorCapability("manage_training")
  correct(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
}
`);
  write(root, "desktop/apps/api/src/automation/automation.controller.ts", `
@Controller("automation")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class AutomationController {
  @Get("status") status() {}
  @Post("run-once")
  @RequireOperatorCapability("approve_send")
  runOnce() {}
  @Post("start")
  @RequireOperatorCapability("approve_send")
  start() {}
  @Post("stop")
  @RequireOperatorCapability("approve_send")
  stop() {}
}
`);
  write(root, "desktop/apps/api/src/training/training.controller.ts", `
@Controller("training")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class TrainingController {
  @Get("samples") list() {}
  @Post("chat-imports")
  @RequireOperatorCapability("manage_training")
  importChat() {}
  @Post("samples/:id/review")
  @RequireOperatorCapability("manage_training")
  review(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
  @Post("samples/batch-review")
  @RequireOperatorCapability("manage_training")
  batch(@Body() body, @TrustedOperator() principal) {
    const { reviewer: _untrustedReviewer, ...trusted } = body;
    return service({ ...trusted, reviewer: principal.id });
  }
  @Post("skill-suggestions/apply")
  @RequireOperatorCapability("manage_training")
  apply() {}
}
`);
  write(root, "desktop/prisma/schema.prisma", "enum ConversationChannel { personal_wechat work_wechat }\nmodel PersonalWechatRpaBinding {}\nmodel PersonalWechatRpaAuditLog {}\nmodel WechatWorkSyncCursor {}\nmodel SkuChangeLog { changedFields Json before Json? }\nmodel DesignAsset { normalizedLocalPath String? @unique }\nmodel DesignPlatformExecution { operationKey String @unique requestId String @unique scopeKey String processRunId String acceptanceStatus DesignPlatformAcceptanceStatus refundStatus DesignPlatformRefundStatus }\nmodel DesignJob { submitOperationKey String? @unique callbackOperationKey String? @unique callbackRequestFingerprint String? callbackStatus String? callbackClaimedAt DateTime? }\nmodel DesignRevision { operationKey String? @unique externalRequestId String? @unique designJobId String revisionNumber Int @@unique([designJobId, revisionNumber]) }\nenum DesignPlatformExecutionStatus { outcome_unknown explicit_failed cancel_requested }\npersonalWechatOwnerWxId String? @unique\npersonalWechatRpaBindingKey String? @unique\n");
  write(root, "desktop/prisma/migrations/20260720113000_design_external_operation_idempotency/migration.sql", 'ALTER TABLE "DesignJob" ADD COLUMN "callbackStatus" TEXT, ADD COLUMN "callbackClaimedAt" TIMESTAMP(3);\nCREATE UNIQUE INDEX "DesignJob_submitOperationKey_key" ON "DesignJob"("submitOperationKey");\nCREATE UNIQUE INDEX "DesignJob_callbackOperationKey_key" ON "DesignJob"("callbackOperationKey");\nCREATE UNIQUE INDEX "DesignRevision_operationKey_key" ON "DesignRevision"("operationKey");\nCREATE UNIQUE INDEX "DesignRevision_externalRequestId_key" ON "DesignRevision"("externalRequestId");\nCREATE UNIQUE INDEX "DesignRevision_designJobId_revisionNumber_key" ON "DesignRevision"("designJobId", "revisionNumber");\n');
  write(root, "core/channel_registry.py", 'SUPPORTED_CHANNELS = {"x": ChannelSpec(status="planned")}\nif channel_id != "wechat":\n print("adapter is planned but not implemented; skipped.")\nreturn DisabledChannelAdapter(spec, reason="adapter not implemented")\n');
  write(root, "docs/PROJECT_LANDING_ROADMAP.md", "抖音、小红书、拼多多、淘宝、快手目前是规划渠道，不能假装已接通。\n");
  appendInboundAuditSemanticFixture(root);
  return root;
}

function appendInboundAuditSemanticFixture(root) {
  write(root, "desktop/apps/api/src/wechat/wechat-dispatch.service.ts", `
private async handleInboundImageSelection(params: {
  operationId: string;
  claimToken: string;
  operationResult?: unknown;
  conversation: any;
}) {
  const recovery = inboundSelectionRecovery(params.operationResult);
  this.jobMatchesConversationIdentity(recoveryJob, params.conversation);
  recoveredQuote.designJobId !== recoveryJob.id;
  recoveredQuote.selectedImageId !== recovery.selectedImageId;
  const highRecovery = { kind: "high_value_image_selection", phase: "selection_committed" };
  this.localStore.commitInboundHighValueSelection({
    operationId: params.operationId,
    claimToken: params.claimToken,
    leaseExpiresAt: this.nextInboundLeaseExpiry(),
    recoveryEffect: highRecovery,
  });
  const lowRecovery = { kind: "low_value_image_selection", phase: "selection_committed" };
  this.localStore.commitInboundLowValueSelection({
    operationId: params.operationId,
    claimToken: params.claimToken,
    leaseExpiresAt: this.nextInboundLeaseExpiry(),
    recoveryEffect: lowRecovery,
  });
}

private async handleInboundQuoteAcceptance(params: {
  operationId: string;
  claimToken: string;
  operationResult?: unknown;
  conversation: any;
}) {
  const recovery = inboundQuoteAcceptanceRecovery(params.operationResult);
  this.jobMatchesConversationIdentity(quote.designJob, params.conversation);
  orderDraft.quoteDraftId !== quote.id;
  String(orderDraft.wechatAccountId || "") !== String(params.conversation.wechatAccountId || "");
  String(orderDraft.conversationId || "") !== String(params.conversation.id || "");
  String(orderDraft.customerId || "") !== String(params.conversation.customerId || "");
  this.localStore.commitInboundQuoteAcceptance({
    operationId: params.operationId,
    claimToken: params.claimToken,
    leaseExpiresAt: this.nextInboundLeaseExpiry(),
    recoveryEffect: { kind: "low_value_quote_acceptance", phase: "quote_and_order_committed" },
  });
  this.localStore.commitInboundQuoteAcceptance({
    operationId: params.operationId,
    claimToken: params.claimToken,
    leaseExpiresAt: this.nextInboundLeaseExpiry(),
    recoveryEffect: { kind: "low_value_quote_acceptance", phase: "quote_and_order_committed" },
  });
}

function inboundSelectionRecovery(value: unknown) {
  ["high_value_image_selection", "low_value_image_selection"].includes(effect.kind);
  effect.phase !== "selection_committed";
  if (!designJobId || !selectedImageId) return null;
  if (effect.kind === "low_value_image_selection" && !quoteDraftId) return null;
}

function inboundQuoteAcceptanceRecovery(value: unknown) {
  effect.kind !== "low_value_quote_acceptance" || effect.phase !== "quote_and_order_committed";
  if (!quoteDraftId || !orderDraftId || !acceptancePlan?.action || !acceptancePlan?.reason) return null;
  ["accept_quote_and_create_order", "update_existing_order_payment"].includes(acceptancePlan.action);
}

private async hydrateCompletedInboundReplay(operation: any, recovered = false) {
  const durable = isPlainObject(operation?.result) ? operation.result : {};
  const designJobId = String(durable.designJobId || "").trim();
  const manualLockRef = isPlainObject(durable.manualLock) ? durable.manualLock : null;
  const manualConversationId = String(manualLockRef?.conversationId || "").trim();
  const manualReviewLogId = String(manualLockRef?.reviewLogId || "").trim();
  const [designJob, manualConversation, manualReviewLog] = await Promise.all([
    designJobId ? this.persistence.getDesignJob(designJobId) : null,
    manualConversationId ? this.persistence.getConversation(manualConversationId) : null,
    manualReviewLogId ? this.persistence.getReviewLog(manualReviewLogId) : null,
  ]);
  if (manualLockRef && (!manualConversationId || !manualReviewLogId)) throw new Error();
  return { selection: hydrateDurableSelection(durable.selection, designJob) };
}

function hydrateDurableSelection(value: unknown, designJob: any) {
  const result = isPlainObject(value.result) ? value.result : {};
  const candidateId = String(result.candidateId || result.imageId || "").trim();
  const candidates = Array.isArray(designJob?.images) ? designJob.images : [];
  const candidate = candidates.find((item: any) => String(item?.id || "") === candidateId || String(item?.imageId || "") === candidateId);
  if (candidateId && (!designJob || !candidate)) {
    throw new BadRequestException("completed inbound operation is missing its durable selection design job or candidate");
  }
  return { result: { candidate } };
}
`, true);

  write(root, "desktop/apps/api/src/local-store/local-store.service.ts", `
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { deterministicOperationId } from "../shared/operation-idempotency";
import { assertNotificationEffectReplay } from "../shared/notification-idempotency";

class LocalStoreFixture {
commitInboundLowValueSelection(payload: {
  operationId: string;
  claimToken: string;
  leaseExpiresAt: string;
  recoveryEffect: Record<string, unknown>;
}) {
  return this.withStoreLock(() => {
  operation.status !== "processing";
  operation.claimToken !== payload.claimToken;
  Date.parse(String(operation.leaseExpiresAt || "")) <= Date.now();
  String(job.wechatAccountId || "") !== String(operation.wechatAccountId || "");
  String(job.conversationId || "") !== String(operation.conversationId || "");
  String(job.customerId || "") !== String(operation.customerId || "");
  image.designJobId === payload.designJobId;
  existingQuote?.sendTaskId || existingQuote?.status === "sent";
  quote.identityBinding = this.validateStoredQuoteDraftIdentity(data, quote);
  quote.identityBinding = this.validateQuoteDraftIdentity(data, quote);
  const recoveryEffect = { ...payload.recoveryEffect, quoteDraftId: quote.id };
  result: { ...(operation.result || {}), recoveryEffect };
  this.write(data);
  });
}

commitInboundQuoteAcceptance(payload: {
  operationId: string;
  claimToken: string;
  leaseExpiresAt: string;
  recoveryEffect: Record<string, unknown>;
}) {
  return this.withStoreLock(() => {
  operation.status !== "processing";
  operation.claimToken !== payload.claimToken;
  Date.parse(String(operation.leaseExpiresAt || "")) <= Date.now();
  String(designJob.wechatAccountId || "") !== String(operation.wechatAccountId || "");
  String(designJob.conversationId || "") !== String(operation.conversationId || "");
  String(currentQuote.customerId || "") !== String(operation.customerId || "");
  currentOrder.quoteDraftId !== quote.id;
  quote.identityBinding = this.validateStoredQuoteDraftIdentity(data, quote);
  order.identityBinding = this.validateStoredOrderDraftBinding(data, order);
  quoteDraftId: quote.id;
  orderDraftId: order.id;
  result: { ...(operation.result || {}), recoveryEffect };
  this.write(data);
  });
}

createNotification(level: string, title: string, body?: string, target?: any) {
  const data = this.read();
  const effectKey = String(target?.effectKey || "").trim();
  const identity = this.resolveTargetIdentity(data, target || {}, "notification target");
  const normalizedTarget = {
    ...(target || {}),
    ...identity.identityFields,
    identityBinding: identity.binding,
  };
  if (effectKey) {
    const existing = data.notifications.find((notification) => String(notification?.target?.effectKey || "") === effectKey);
    if (existing) return assertNotificationEffectReplay(existing, { level, title, body, target: normalizedTarget });
  }
  return { id: effectKey ? deterministicOperationId("notice", effectKey) : id("notice") };
}

private withStoreLock<T>(operation: () => T): T {
  if (this.storeLockDepth > 0) return operation();
  const lock = acquireLocalStoreLock(this.filePath);
  this.storeLockOwnershipCheck = lock.assertOwned;
  try { return operation(); } finally {
    this.storeLockDepth -= 1;
    lock.release();
  }
}

}

export function acquireLocalStoreLock(filePath: string) {
  const lockPath = \`\${filePath}.lock\`;
  const ownerToken = randomUUID();
  const ownerFileName = \`owner-\${ownerToken}.json\`;
  const pendingPath = \`\${lockPath}.pending-\${process.pid}-\${ownerToken}\`;
  fs.renameSync(pendingPath, lockPath);
  localStoreLockIsStale(lockPath);
  return ownedLocalStoreLockHandle(lockPath, ownerFileName);
}

function ownedLocalStoreLockHandle(lockPath: string, ownerFileName: string) {
  let released = false;
  const ownerPath = path.join(lockPath, ownerFileName);
  return {
    assertOwned: () => {
      if (released || !fs.existsSync(ownerPath)) {
        throw new LocalStoreConcurrentWriteError("local store transaction lock ownership was lost");
      }
    },
    release: () => {
      if (released) return;
      released = true;
      try {
        fs.unlinkSync(ownerPath);
      } catch (error: any) {
        if (error?.code === "ENOENT") return;
        throw error;
      }
      try {
        fs.rmdirSync(lockPath);
      } catch (error: any) {
        if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error?.code || ""))) return;
        throw error;
      }
    },
  };
}
`, true);

  write(root, "desktop/apps/api/src/notifications/notifications.service.ts", `
import { assertNotificationEffectReplay } from "../shared/notification-idempotency";
import { deterministicOperationId, isUniqueConstraintError } from "../shared/operation-idempotency";

class NotificationsFixture {
create(level: string, title: string, body?: string, target?: Record<string, unknown>) {
  if (appConfig.useLocalStore) return this.localStore.createNotification(level, title, body, target);
  const effectKey = String(target?.effectKey || "").trim();
  if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);
  return this.prisma.notification.create({ data: { level, title, body, target } });
}

private async createPrismaNotificationOnce(
  effectKey: string,
  level: string,
  title: string,
  body?: string,
  target?: Record<string, unknown>,
) {
  const notification = this.prisma.notification as any;
  const id = deterministicOperationId("notice", effectKey);
  const existing = await notification.findUnique({ where: { id } });
  if (existing) return assertNotificationEffectReplay(existing, { level, title, body, target });
  try {
    return await notification.create({ data: { id, level, title, body, target } });
  } catch (error) {
    if (!isUniqueConstraintError(error) || typeof notification.findUnique !== "function") throw error;
    const winner = await notification.findUnique({ where: { id } });
    if (!winner) throw error;
    return assertNotificationEffectReplay(winner, { level, title, body, target });
  }
}
}
`);

  write(root, "desktop/apps/api/src/shared/notification-idempotency.ts", `
import { createOperationFingerprint } from "./operation-idempotency";

export function assertNotificationEffectReplay(
  existing: any,
  expected: { level: string; title: string; body?: string; target?: Record<string, unknown> },
) {
  const actualFingerprint = notificationEffectFingerprint({
    level: existing?.level,
    title: existing?.title,
    body: existing?.body,
    target: existing?.target,
  });
  const expectedFingerprint = notificationEffectFingerprint(expected);
  if (actualFingerprint !== expectedFingerprint) {
    throw new BadRequestException("notification effectKey replay changed identity or business payload");
  }
  return existing;
}

function notificationEffectFingerprint(value: {
  level?: unknown;
  title?: unknown;
  body?: unknown;
  target?: unknown;
}) {
  return createOperationFingerprint("notification-effect", {}, {
    level: String(value.level || ""),
    title: String(value.title || ""),
    body: value.body === undefined || value.body === null ? null : String(value.body),
    target: notificationBusinessTarget(value.target),
  });
}

function notificationBusinessTarget(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const { identityBinding: _derivedIdentityBinding, ...businessTarget } = value as Record<string, unknown>;
  return businessTarget;
}
`);
}

function createRealInboundFixture() {
  const root = createPassingFixture();
  const repositoryRoot = path.resolve(__dirname, "..", "..");
  for (const relative of [
    "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
    "desktop/apps/api/src/local-store/local-store.service.ts",
    "desktop/apps/api/src/notifications/notifications.service.ts",
    "desktop/apps/api/src/shared/notification-idempotency.ts",
  ]) {
    const target = path.join(root, ...relative.split("/"));
    fs.copyFileSync(path.join(repositoryRoot, ...relative.split("/")), target);
  }
  return root;
}

test("completion audit fixture reaches local PASS without network, commands or secret reads", () => {
  const root = createPassingFixture();
  write(root, ".env", "INTERNAL_API_TOKEN=never-include-this-secret\n");
  const report = buildAudit(root, { includeExternal: false });
  assert.equal(report.schemaVersion, "smart_kefu_project_completion_audit_v3");
  assert.equal(report.status, STATUS.PASS, JSON.stringify(report.results.filter((item) => item.status === STATUS.FAIL)));
  assert.deepEqual(report.safety, {
    networkCalls: false,
    commandsExecuted: false,
    externalWrites: false,
    secretFilesRead: false,
    realMessageSendAttempted: false,
    databaseConnectionAttempted: false,
    reportContainsSecrets: false,
  });
  assert.ok(report.results.every((item) => item.status === STATUS.PASS));
  assert.equal(JSON.stringify(report).includes("never-include-this-secret"), false);
  assert.equal(JSON.stringify(report).includes(path.resolve(root)), false);
  const source = fs.readFileSync(path.resolve(__dirname, "../tools/project-completion-audit.js"), "utf8");
  assert.doesNotMatch(source, /node:child_process|\bspawnSync\b|\bexecFileSync\b|\bfetch\s*\(|require\(["']node:https?["']\)|process\.env/);
});

test("completion audit checks real inbound recovery function boundaries, helpers, identity and lease CAS", () => {
  const baselineRoot = createRealInboundFixture();
  const baseline = buildAudit(baselineRoot, { includeExternal: false });
  assert.equal(baseline.results.find((item) => item.id === "contract.inbound_effect_recovery").status, STATUS.PASS);

  const dispatchFile = "desktop/apps/api/src/wechat/wechat-dispatch.service.ts";
  const localStoreFile = "desktop/apps/api/src/local-store/local-store.service.ts";
  const notificationsFile = "desktop/apps/api/src/notifications/notifications.service.ts";
  const notificationIdempotencyFile = "desktop/apps/api/src/shared/notification-idempotency.ts";
  const mutations = [
    {
      name: "low-value atomic helper call renamed",
      file: dispatchFile,
      from: "this.localStore.commitInboundLowValueSelection({",
      to: "this.localStore.nonAtomicLowValueSelection({",
    },
    {
      name: "quote acceptance atomic helper calls renamed",
      file: dispatchFile,
      from: "this.localStore.commitInboundQuoteAcceptance({",
      to: "this.localStore.nonAtomicQuoteAcceptance({",
      all: true,
    },
    {
      name: "low-value selection recovery marker renamed",
      file: dispatchFile,
      anchor: "private async handleInboundImageSelection",
      from: 'kind: "low_value_image_selection"',
      to: 'kind: "unsafe_low_value_selection"',
    },
    {
      name: "quote acceptance recovery marker removed from one branch",
      file: dispatchFile,
      anchor: "private async handleInboundQuoteAcceptance",
      from: 'phase: "quote_and_order_committed"',
      to: 'phase: "quote_started"',
    },
    {
      name: "selection recovery parser phase weakened",
      file: dispatchFile,
      anchor: "function inboundSelectionRecovery",
      from: 'effect.phase !== "selection_committed"',
      to: "false",
    },
    {
      name: "quote recovery parser identity weakened",
      file: dispatchFile,
      anchor: "function inboundQuoteAcceptanceRecovery",
      from: "!quoteDraftId || !orderDraftId",
      to: "!quoteDraftId",
    },
    {
      name: "completed manual-lock review hydration removed",
      file: dispatchFile,
      anchor: "private async hydrateCompletedInboundReplay",
      from: "if (manualLockRef && (!manualConversationId || !manualReviewLogId))",
      to: "if (manualLockRef && !manualConversationId)",
    },
    {
      name: "completed selection candidate hydration weakened",
      file: dispatchFile,
      anchor: "function hydrateDurableSelection",
      from: "if (candidateId && (!designJob || !candidate))",
      to: "if (candidateId && !designJob)",
    },
    {
      name: "local notification effect replay gate disabled",
      file: localStoreFile,
      anchor: "createNotification(level:",
      from: "if (effectKey) {",
      to: "if (false && effectKey) {",
    },
    {
      name: "local notification effect replay identity removed",
      file: localStoreFile,
      anchor: "createNotification(level:",
      from: "if (existing) return assertNotificationEffectReplay(existing, { level, title, body, target: normalizedTarget });",
      to: "if (existing) return existing;",
    },
    {
      name: "local notification replay helper cannot shadow its trusted import",
      file: localStoreFile,
      from: 'import { assertNotificationEffectReplay } from "../shared/notification-idempotency";',
      to: "function assertNotificationEffectReplay(existing: any) { return existing; }",
    },
    {
      name: "Prisma notification effect replay dispatch disabled",
      file: notificationsFile,
      anchor: "create(level:",
      from: "if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);",
      to: "if (false && effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);",
    },
    {
      name: "Prisma notification replay helper cannot shadow its trusted import",
      file: notificationsFile,
      from: 'import { assertNotificationEffectReplay } from "../shared/notification-idempotency";',
      to: "function assertNotificationEffectReplay(existing: any) { return existing; }",
    },
    {
      name: "notification fingerprint helper cannot shadow its trusted import",
      file: notificationIdempotencyFile,
      from: 'import { createOperationFingerprint } from "./operation-idempotency";',
      to: "function createOperationFingerprint() { return 1; }",
    },
    {
      name: "Prisma existing notification effect replay identity removed",
      file: notificationsFile,
      anchor: "private async createPrismaNotificationOnce",
      from: "if (existing) return assertNotificationEffectReplay(existing, { level, title, body, target });",
      to: "if (existing) return existing;",
    },
    {
      name: "Prisma unique-winner notification effect replay identity removed",
      file: notificationsFile,
      anchor: "private async createPrismaNotificationOnce",
      from: "return assertNotificationEffectReplay(winner, { level, title, body, target });",
      to: "return winner;",
    },
    {
      name: "notification effect fingerprint strips direct business identity",
      file: notificationIdempotencyFile,
      anchor: "function notificationBusinessTarget",
      from: "const { identityBinding: _derivedIdentityBinding, ...businessTarget } = value as Record<string, unknown>;",
      to: "const { identityBinding: _derivedIdentityBinding, wechatAccountId: _account, ...businessTarget } = value as Record<string, unknown>;",
    },
    {
      name: "low-value helper definition renamed",
      file: localStoreFile,
      from: "commitInboundLowValueSelection(payload:",
      to: "nonAtomicLowValueSelection(payload:",
    },
    {
      name: "low-value helper claim CAS removed",
      file: localStoreFile,
      anchor: "commitInboundLowValueSelection(payload:",
      from: "operation.claimToken !== payload.claimToken",
      to: "false",
    },
    {
      name: "low-value helper lock wrapper removed",
      file: localStoreFile,
      anchor: "commitInboundLowValueSelection(payload:",
      from: "return this.withStoreLock(() => {",
      to: "return (() => {",
    },
    {
      name: "low-value helper identity removed",
      file: localStoreFile,
      anchor: "commitInboundLowValueSelection(payload:",
      from: 'String(job.wechatAccountId || "") !== String(operation.wechatAccountId || "")',
      to: "false",
    },
    {
      name: "quote helper definition renamed",
      file: localStoreFile,
      from: "commitInboundQuoteAcceptance(payload:",
      to: "nonAtomicQuoteAcceptance(payload:",
    },
    {
      name: "quote helper lease CAS removed",
      file: localStoreFile,
      anchor: "commitInboundQuoteAcceptance(payload:",
      from: 'Date.parse(String(operation.leaseExpiresAt || "")) <= Date.now()',
      to: "false",
    },
    {
      name: "quote helper lock wrapper removed",
      file: localStoreFile,
      anchor: "commitInboundQuoteAcceptance(payload:",
      from: "return this.withStoreLock(() => {",
      to: "return (() => {",
    },
    {
      name: "quote helper identity removed",
      file: localStoreFile,
      anchor: "commitInboundQuoteAcceptance(payload:",
      from: 'String(currentQuote.customerId || "") !== String(operation.customerId || "")',
      to: "false",
    },
    {
      name: "cross-process lock owner fence disabled",
      file: localStoreFile,
      anchor: "function ownedLocalStoreLockHandle",
      from: "if (released || !fs.existsSync(ownerPath)) {",
      to: "if (false && (released || !fs.existsSync(ownerPath))) {",
    },
    {
      name: "local replay gate keeps its safe shape after an early-return bypass",
      file: localStoreFile,
      anchor: "createNotification(level:",
      from: "if (effectKey) {",
      to: 'if (target?.skipReplayCheck) return { id: id("notice") };\n    if (effectKey) {',
    },
    {
      name: "local replay gate rejects a side effect before identity validation",
      file: localStoreFile,
      anchor: "createNotification(level:",
      from: 'const effectKey = String(target?.effectKey || "").trim();',
      to: 'data.notifications.push({} as any);\n    const effectKey = String(target?.effectKey || "").trim();',
    },
    {
      name: "Prisma dispatch keeps its safe gate after a direct-create bypass",
      file: notificationsFile,
      anchor: "create(level:",
      from: "if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);",
      to: "if (target?.skipReplayCheck) return this.prisma.notification.create({ data: { level, title, body, target: (target || {}) as any } });\n    if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);",
    },
    {
      name: "Prisma dispatch keeps its safe helper after a wrong-key helper",
      file: notificationsFile,
      anchor: "create(level:",
      from: "if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);",
      to: 'if (effectKey) return this.createPrismaNotificationOnce("", level, title, body, target);\n    if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);',
    },
    {
      name: "Prisma template interpolation cannot hide a second helper call",
      file: notificationsFile,
      anchor: "create(level:",
      from: "if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);",
      to: 'const duplicate = `${this.createPrismaNotificationOnce("", level, title, body, target)}`;\n    if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);',
    },
    {
      name: "property keyword division cannot hide a second Prisma helper call",
      file: notificationsFile,
      anchor: "create(level:",
      from: "if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);",
      to: 'obj.if(value) / divisor;\n    this.createPrismaNotificationOnce("", level, title, body, target) / other;\n    if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);',
    },
    {
      name: "lock owner fence keeps its safe shape after an early return",
      file: localStoreFile,
      anchor: "function ownedLocalStoreLockHandle",
      from: "if (released || !fs.existsSync(ownerPath)) {",
      to: "if (!fs.existsSync(lockPath)) return;\n      if (released || !fs.existsSync(ownerPath)) {",
    },
    {
      name: "local false replay gate cannot borrow safe text from a block comment",
      file: localStoreFile,
      anchor: "createNotification(level:",
      from: "if (effectKey) {",
      to: '/* if (effectKey) { data.notifications.find((notification) => String(notification?.target?.effectKey || "") === effectKey) } */\n    if (false && effectKey) {',
    },
    {
      name: "Prisma false dispatch gate cannot borrow safe text from a string",
      file: notificationsFile,
      anchor: "create(level:",
      from: "if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);",
      to: '"if (effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target)";\n    if (false && effectKey) return this.createPrismaNotificationOnce(effectKey, level, title, body, target);',
    },
    {
      name: "local false replay gate cannot borrow safe text from a regex literal",
      file: localStoreFile,
      anchor: "createNotification(level:",
      from: "if (effectKey) {",
      to: '/if (effectKey) { data.notifications.find((notification) => String(notification?.target?.effectKey || "") === effectKey)/;\n    if (false && effectKey) {',
    },
    ...[
      ["CR", "\r"],
      ["Unicode line separator", "\u2028"],
      ["Unicode paragraph separator", "\u2029"],
    ].map(([terminatorName, terminator]) => ({
      name: `local false replay gate cannot borrow safe text from a line comment ending with ${terminatorName}`,
      file: localStoreFile,
      anchor: "createNotification(level:",
      from: "if (effectKey) {",
      to: `// if (effectKey) { data.notifications.find((notification) => String(notification?.target?.effectKey || "") === effectKey)${terminator}    if (false && effectKey) {`,
    })),
    {
      name: "regex closing brace cannot truncate the masked local function block",
      file: localStoreFile,
      anchor: "createNotification(level:",
      from: "if (effectKey) {",
      to: "const closingBracePattern = /}/;\n    if (false && effectKey) {",
    },
    {
      name: "lock false owner fence cannot borrow safe text from a block comment",
      file: localStoreFile,
      anchor: "function ownedLocalStoreLockHandle",
      from: "if (released || !fs.existsSync(ownerPath)) {",
      to: '/* if (released || !fs.existsSync(ownerPath)) throw new LocalStoreConcurrentWriteError("local store transaction lock ownership was lost") */\n      if (false && (released || !fs.existsSync(ownerPath))) {',
    },
    {
      name: "local replay assertion call must remain unique",
      file: localStoreFile,
      anchor: "createNotification(level:",
      from: "if (existing) return assertNotificationEffectReplay(existing, { level, title, body, target: normalizedTarget });",
      to: "if (existing) return assertNotificationEffectReplay(existing, { level, title, body, target: normalizedTarget });\n      if (existing) return assertNotificationEffectReplay(existing, { level, title, body, target: normalizedTarget });",
    },
    {
      name: "lock release cannot duplicate owner-file unlink",
      file: localStoreFile,
      anchor: "function ownedLocalStoreLockHandle",
      from: "fs.unlinkSync(ownerPath);",
      to: "fs.unlinkSync(ownerPath);\n        fs.unlinkSync(ownerPath);",
    },
    {
      name: "lock handle cannot start in the released state",
      file: localStoreFile,
      anchor: "function ownedLocalStoreLockHandle",
      from: "let released = false;",
      to: "let released = true;",
    },
    {
      name: "lock release cannot hide owner-file unlink behind a false branch",
      file: localStoreFile,
      anchor: "function ownedLocalStoreLockHandle",
      from: "fs.unlinkSync(ownerPath);",
      to: "if (false) fs.unlinkSync(ownerPath);",
    },
    {
      name: "lock handle cannot spread an unsafe override after safe properties",
      file: localStoreFile,
      anchor: "function ownedLocalStoreLockHandle",
      mutate(section) {
        return section.replace(
          /    },\r?\n  };\r?\n}\r?\n\r?\nfunction localStoreLockIsStale/,
          "    },\n    ...unsafeHandle,\n  };\n}\n\nfunction localStoreLockIsStale",
        );
      },
    },
    {
      name: "lock release cannot rebuild the lock directory after cleanup",
      file: localStoreFile,
      anchor: "function ownedLocalStoreLockHandle",
      from: "fs.rmdirSync(lockPath);",
      to: "fs.rmdirSync(lockPath);\n        fs.mkdirSync(lockPath);",
    },
    {
      name: "lock release cannot throw before unlinking its owner file",
      file: localStoreFile,
      anchor: "function ownedLocalStoreLockHandle",
      from: "fs.unlinkSync(ownerPath);",
      to: 'if (true) throw new Error("skip release");\n        fs.unlinkSync(ownerPath);',
    },
    {
      name: "lock release cannot reorder owner-file unlink after lock-directory removal",
      file: localStoreFile,
      anchor: "function ownedLocalStoreLockHandle",
      mutate(section) {
        return section
          .replace("fs.unlinkSync(ownerPath);", "SWAP_LOCK_OWNER_REMOVAL();")
          .replace("fs.rmdirSync(lockPath);", "fs.unlinkSync(ownerPath);")
          .replace("SWAP_LOCK_OWNER_REMOVAL();", "fs.rmdirSync(lockPath);");
      },
    },
    {
      name: "lock release cannot move directory removal outside the release block",
      file: localStoreFile,
      anchor: "function ownedLocalStoreLockHandle",
      mutate(section) {
        return section
          .replace("fs.rmdirSync(lockPath);", "void lockPath;")
          .replace(
            "  };\n}\n\nfunction localStoreLockIsStale",
            "  };\n  fs.rmdirSync(lockPath);\n}\n\nfunction localStoreLockIsStale",
          );
      },
    },
    {
      name: "cross-process lock acquisition removed",
      file: localStoreFile,
      anchor: "private withStoreLock<T>",
      from: "const lock = acquireLocalStoreLock(this.filePath)",
      to: "const lock = acquireInProcessLock(this.filePath)",
    },
  ];

  for (const mutation of mutations) {
    const root = createRealInboundFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    const start = mutation.anchor ? source.indexOf(mutation.anchor) : 0;
    assert.ok(start >= 0, mutation.name);
    let mutated;
    if (mutation.mutate) {
      const section = source.slice(start);
      const mutatedSection = mutation.mutate(section);
      assert.notEqual(mutatedSection, section, mutation.name);
      mutated = `${source.slice(0, start)}${mutatedSection}`;
    } else {
      const occurrence = source.indexOf(mutation.from, start);
      assert.ok(occurrence >= 0, mutation.name);
      mutated = mutation.all
        ? source.split(mutation.from).join(mutation.to)
        : `${source.slice(0, occurrence)}${mutation.to}${source.slice(occurrence + mutation.from.length)}`;
    }
    fs.writeFileSync(target, mutated, "utf8");
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === "contract.inbound_effect_recovery");
    assert.equal(contract.status, STATUS.FAIL, mutation.name);
    assert.ok(contract.evidence.missing.length + contract.evidence.forbidden.length > 0, mutation.name);
  }
});

test("completion audit rejects removed archive-bomb preflight and whole-file Windows hashing", () => {
  const budgetRoot = createPassingFixture();
  const chainFile = path.join(budgetRoot, "desktop", "tools", "windows-evidence-chain.js");
  const chainSource = fs.readFileSync(chainFile, "utf8");
  fs.writeFileSync(chainFile, chainSource.replace("maxCompressionRatio", "removedCompressionRatioBudget"), "utf8");
  const budgetReport = buildAudit(budgetRoot, { includeExternal: false });
  assert.equal(budgetReport.results.find((item) => item.id === "contract.windows_evidence_chain").status, STATUS.FAIL);

  const snapshotRoot = createPassingFixture();
  const snapshotChainFile = path.join(snapshotRoot, "desktop", "tools", "windows-evidence-chain.js");
  const snapshotSource = fs.readFileSync(snapshotChainFile, "utf8");
  fs.writeFileSync(snapshotChainFile, snapshotSource.replace("createVerifiedArchiveSnapshot", "reuseCallerArchivePath"), "utf8");
  const snapshotReport = buildAudit(snapshotRoot, { includeExternal: false });
  assert.equal(snapshotReport.results.find((item) => item.id === "contract.windows_evidence_chain").status, STATUS.FAIL);

  const hashRoot = createPassingFixture();
  write(hashRoot, "desktop/tools/verify-windows-package.js", "\nhash.update(fs.readFileSync(file));\n", true);
  const hashReport = buildAudit(hashRoot, { includeExternal: false });
  assert.equal(hashReport.results.find((item) => item.id === "contract.windows_streaming_artifact_hash").status, STATUS.FAIL);
});

test("completion audit mutation checks reject fake Web API success and stale build reuse", () => {
  const mutations = [
    {
      id: "contract.web_api_failure_truth",
      file: "desktop/apps/web/src/lib/api.ts",
      from: "export async function getDesignJobs()",
      to: "const sampleDesignJobs = []; return sampleDesignJobs; export async function getDesignJobs()",
    },
    {
      id: "contract.web_build_freshness",
      file: "desktop/tools/build-web.js",
      from: "if (!standaloneServerExists() && productionBuildReady() && !webBuildIsStale())",
      to: "if (!standaloneServerExists() && productionBuildReady())",
    },
    {
      id: "contract.web_build_freshness",
      file: "desktop/tools/build-web.js",
      from: "if (retry.status === 0 && !hasNextBuildErrorOutput(retry) && productionBuildReady() && !webBuildIsStale())",
      to: "if (productionBuildReady() && !hasNextBuildErrorOutput(retry))",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.id);
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === mutation.id).status, STATUS.FAIL, mutation.id);
  }
});

test("completion audit rejects removal of Enterprise WeChat inbound timestamp monotonicity", () => {
  const mutations = [
    {
      id: "contract.wechat_work_canonical_binding",
      file: "desktop/apps/api/src/wechat/wechat-persistence.ts",
      from: "tx.wechatWorkBinding.updateMany()",
      to: "tx.wechatWorkBinding.update()",
    },
    {
      id: "contract.wechat_work_canonical_binding",
      file: "desktop/apps/api/src/wechat/wechat-persistence.ts",
      from: "lastInboundAt: { lt: lastInboundAt }",
      to: "lastInboundAt",
    },
    {
      id: "contract.local_wechat_work_binding_timestamp_monotonic",
      file: "desktop/apps/api/src/local-store/local-store.service.ts",
      from: "monotonicWechatWorkInboundAt()",
      to: "overwriteWechatWorkInboundAt()",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.id);
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === mutation.id).status, STATUS.FAIL, mutation.id);
  }
});

test("completion audit requires LocalStore send claim recovery and rejects failure-provenance drift", () => {
  const missingTestRoot = createPassingFixture();
  fs.rmSync(path.join(missingTestRoot, "desktop", "tests", "wechat-local-send-claim-recovery.test.js"));
  const missingReport = buildAudit(missingTestRoot, { includeExternal: false });
  assert.equal(
    missingReport.results.find((item) => item.id === "safety.local_wechat_send_claim_recovery_tests").status,
    STATUS.FAIL,
  );

  const mutations = [
    {
      id: "contract.local_wechat_send_claim_atomicity",
      file: "desktop/apps/api/src/local-store/local-store.service.ts",
      from: "claimQueuedSendTaskAndCreateAttempt()",
      to: "updateTaskThenCreateAttempt()",
    },
    {
      id: "contract.local_wechat_adapter_failure_fail_closed",
      file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
      from: 'error instanceof WechatBridgeOutboxError && error.deliveryState === "failed"',
      to: '/not sent/.test(errorMessage)',
    },
    {
      id: "contract.local_wechat_outbox_failure_provenance",
      file: "desktop/apps/api/src/wechat/wechat-send-adapter.service.ts",
      from: 'deliveryState: published ? "unknown" : "failed"',
      to: 'deliveryState: "failed"',
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.id);
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === mutation.id).status, STATUS.FAIL, mutation.id);
  }
});

test("completion audit requires runtime secret isolation artifacts and rejects credential drift", () => {
  const contractIds = [
    "contract.runtime_service_secret_allowlists",
    "contract.runtime_wrapper_secret_boundary",
    "contract.runtime_packaged_service_environment",
    "contract.runtime_observer_child_environment",
    "contract.private_runtime_json_safety",
  ];
  const baseline = buildAudit(createPassingFixture(), { includeExternal: false });
  for (const id of contractIds) {
    assert.equal(baseline.results.find((item) => item.id === id).status, STATUS.PASS, id);
  }

  const missingTestRoot = createPassingFixture();
  fs.rmSync(path.join(missingTestRoot, "desktop", "tests", "runtime-secret-isolation.test.js"));
  const missingTestReport = buildAudit(missingTestRoot, { includeExternal: false });
  assert.equal(
    missingTestReport.results.find((item) => item.id === "security.runtime_secret_isolation_tests").status,
    STATUS.FAIL,
  );

  const mutations = [
    {
      id: "contract.runtime_service_secret_allowlists",
      file: "desktop/packages/runtime/service-environment.js",
      from: 'web: [...RUNTIME_KEYS, "INTERNAL_API_TOKEN", "DESKTOP_WEB_SESSION_PROOF"]',
      to: 'web: [...RUNTIME_KEYS, "INTERNAL_API_TOKEN", "DESKTOP_WEB_SESSION_PROOF", "DATABASE_URL"]',
    },
    {
      id: "contract.runtime_wrapper_secret_boundary",
      file: "desktop/packages/runtime/service-environment.js",
      from: '["NODE_ENV", "DESIGN_PLATFORM_RUNTIME_CONFIG"]',
      to: '["NODE_ENV", "DESIGN_PLATFORM_RUNTIME_CONFIG", "WECHAT_WORK_SECRET"]',
    },
    {
      id: "contract.runtime_packaged_service_environment",
      file: "desktop/apps/electron/packaged-runtime.js",
      from: 'return selectServiceEnvironment("web", baseEnv',
      to: 'return selectServiceEnvironment("api", baseEnv',
    },
    {
      id: "contract.runtime_observer_child_environment",
      file: "desktop/apps/api/src/shared/runtime-child-environment.ts",
      from: '["NODE_ENV", "WECHAT_WINDOW_OBSERVER_PROOF_FILE"',
      to: '["NODE_ENV", "DATABASE_URL", "WECHAT_WINDOW_OBSERVER_PROOF_FILE"',
    },
    {
      id: "contract.private_runtime_json_safety",
      file: "desktop/tools/private-runtime-file.js",
      from: "if (stat.isSymbolicLink() || !stat.isFile()) throw new Error();",
      to: "if (!stat.isFile()) throw new Error();",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.id);
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === mutation.id).status, STATUS.FAIL, mutation.id);
  }
});

test("idempotency audit rejects mutable-identity-first replay and browser operation-key drift", () => {
  const mutations = [
    {
      id: "contract.design_job_create_idempotency",
      file: "desktop/apps/api/src/design-jobs/design-jobs.service.ts",
      from: "const existing = findUnique({ where: { requestId } }); if (existing) return this.completeDesignJobCreateEffects(existing, operation, readiness); const identity = await this.validateCreateIdentity(payload);",
      to: "const identity = await this.validateCreateIdentity(payload); const existing = findUnique({ where: { requestId } }); if (existing) return existing;",
    },
    {
      id: "contract.local_chat_import_existing_first",
      file: "desktop/apps/api/src/local-store/local-store.service.ts",
      from: "const existing = data.chatImports.find((item) => item.id === importId); if (existing) { assertStoredOperationIdentityReplay(); return { ...existing, samples: existingSamples }; } const identity = this.validateOptionalConversationBinding(data, payload, \"chat import\");",
      to: "const identity = this.validateOptionalConversationBinding(data, payload, \"chat import\"); const existing = data.chatImports.find((item) => item.id === importId); if (existing) return existing;",
    },
    {
      id: "contract.training_import_idempotency",
      file: "desktop/apps/api/src/prisma/prisma-operations.service.ts",
      from: "const existing = await tx.chatImport.findUnique({ where: { id: importId } }); if (existing) { assertStoredOperationIdentityReplay(); return this.replayChatImport(existing, operation); } const identity = await this.resolveIdentity(tx, payload, \"chat import\");",
      to: "const identity = await this.resolveIdentity(tx, payload, \"chat import\"); const existing = await tx.chatImport.findUnique({ where: { id: importId } }); if (existing) return existing;",
    },
    {
      id: "contract.web_create_operation_retry",
      file: "desktop/apps/web/src/lib/api.ts",
      from: "operationKey: string",
      to: 'operationKey = createClientOperationKey("design-job")',
    },
    {
      id: "contract.training_import_operation_lifecycle",
      file: "desktop/apps/web/src/features/training/training-import-page.tsx",
      from: "await importChatTranscript({ operationKey: operation.key });\npendingImportOperation.current = completeClientOperation(pendingImportOperation.current, operation.key);",
      to: "pendingImportOperation.current = completeClientOperation(pendingImportOperation.current, operation.key);\nawait importChatTranscript({ operationKey: operation.key });",
    },
    {
      id: "contract.send_demo_controller_operation",
      file: "desktop/apps/api/src/wechat/wechat.controller.ts",
      from: "payload: { operationKey: string }",
      to: "payload: { operationKey?: string }",
    },
    {
      id: "contract.send_demo_service_operation",
      file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
      from: 'normalizeOperationKey(payload?.operationKey, "operationKey")',
      to: "payload.operationKey",
    },
    {
      id: "contract.send_demo_web_operation",
      file: "desktop/apps/web/src/lib/api.ts",
      from: 'postJsonWithNetworkRetry<SendTask>("/wechat/send-tasks/demo"',
      to: 'postJson<SendTask>("/wechat/send-tasks/demo"',
    },
    {
      id: "contract.local_send_operation_replay",
      file: "desktop/apps/api/src/local-store/local-store.service.ts",
      from: 'deterministicOperationId("send", operationKey)',
      to: 'randomOperationId("send")',
    },
    {
      id: "contract.prisma_send_operation_replay",
      file: "desktop/apps/api/src/wechat/wechat-persistence.ts",
      from: "if (isUniqueConstraintError(error)) this.assertSendTaskReplay(winner, payload, operationKey);",
      to: "throw error;",
    },
    {
      id: "contract.wechat_send_operation_passthrough",
      file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
      from: "operationKey: stringOrUndefined(value.operationKey)",
      to: "operationKey: undefined",
    },
    {
      id: "contract.quote_send_operation_passthrough",
      file: "desktop/apps/api/src/quotes/quotes.service.ts",
      from: 'normalizeOperationKey(options.operationKey, "operationKey")',
      to: 'normalizeOperationKey(undefined, "operationKey")',
    },
    {
      id: "contract.review_send_operation_passthrough",
      file: "desktop/apps/api/src/reviews/reviews.service.ts",
      from: "this.wechat.queueOrderFollowup(id, { operationKey: payload.operationKey });",
      to: "this.wechat.queueOrderFollowup(id, {});",
    },
    ...[
      ["contract.browser_manual_reply_sticky_operation", "desktop/apps/web/src/features/conversations/use-conversations-controller.ts"],
      ["contract.browser_quote_send_sticky_operation", "desktop/apps/web/src/features/sales/sales-quote-action-page.tsx"],
      ["contract.browser_order_send_sticky_operation", "desktop/apps/web/src/features/sales/sales-order-message-page.tsx"],
      ["contract.browser_review_design_sticky_operation", "desktop/apps/web/src/features/reviews/review-design-page.tsx"],
      ["contract.browser_review_quote_sticky_operation", "desktop/apps/web/src/features/reviews/review-quotes-page.tsx"],
      ["contract.browser_review_order_sticky_operation", "desktop/apps/web/src/features/reviews/review-orders-page.tsx"],
    ].map(([id, file]) => ({
      id,
      file,
      from: "completeClientOperation",
      to: "keepClientOperation",
    })),
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.match(source, new RegExp(mutation.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === mutation.id).status, STATUS.FAIL, mutation.id);
  }
});

test("completion audit requires design external operation and callback claim CAS safety", () => {
  const contractIds = [
    "contract.design_external_operation_idempotency",
    "contract.local_design_callback_cas",
    "contract.prisma_design_external_operation_schema",
    "contract.prisma_design_external_operation_migration",
  ];
  const baseline = buildAudit(createPassingFixture(), { includeExternal: false });
  for (const id of contractIds) {
    assert.equal(baseline.results.find((item) => item.id === id).status, STATUS.PASS, id);
  }

  const mutations = [
    {
      id: "contract.design_external_operation_idempotency",
      file: "desktop/apps/api/src/design-jobs/design-jobs.service.ts",
      from: 'return "in_progress"',
      to: 'return "outcome_unknown"',
    },
    {
      id: "contract.local_design_callback_cas",
      file: "desktop/apps/api/src/local-store/local-store.service.ts",
      from: 'localDesignCallbackClaimIsFresh(job.callbackClaimedAt) ? "in_progress" : "outcome_unknown"',
      to: '"outcome_unknown"',
    },
    {
      id: "contract.prisma_design_external_operation_schema",
      file: "desktop/prisma/schema.prisma",
      from: "callbackOperationKey String? @unique",
      to: "callbackOperationKey String?",
    },
    {
      id: "contract.prisma_design_external_operation_migration",
      file: "desktop/prisma/migrations/20260720113000_design_external_operation_idempotency/migration.sql",
      from: 'CREATE UNIQUE INDEX "DesignJob_callbackOperationKey_key"',
      to: 'CREATE INDEX "DesignJob_callbackOperationKey_key"',
    },
  ];
  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.id);
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === mutation.id).status, STATUS.FAIL, mutation.id);
  }
});

test("completion audit protects in-flight unknown resolution priority and approval boundary", () => {
  const baselineRoot = createPassingFixture();
  const baseline = buildAudit(baselineRoot, { includeExternal: false });
  assert.equal(
    baseline.results.find((item) => item.id === "contract.wechat_inflight_send_resolution").status,
    STATUS.PASS,
  );
  assert.equal(
    baseline.results.find((item) => item.id === "contract.wechat_manual_delivery_resolution_guard").status,
    STATUS.PASS,
  );

  const priorityRoot = createPassingFixture();
  const servicePath = path.join(priorityRoot, "desktop", "apps", "api", "src", "wechat", "wechat-dispatch.service.ts");
  fs.writeFileSync(
    servicePath,
    fs.readFileSync(servicePath, "utf8").replace(
      'deliveryResolutionPriority: "manual_audited_terminal"',
      'deliveryResolutionPriority: "provider_event_can_override"',
    ),
    "utf8",
  );
  const priorityReport = buildAudit(priorityRoot, { includeExternal: false });
  assert.equal(
    priorityReport.results.find((item) => item.id === "contract.wechat_inflight_send_resolution").status,
    STATUS.FAIL,
  );

  const guardRoot = createPassingFixture();
  const controllerPath = path.join(guardRoot, "desktop", "apps", "api", "src", "wechat", "wechat.controller.ts");
  fs.writeFileSync(
    controllerPath,
    fs.readFileSync(controllerPath, "utf8").replace(
      '@Post("send-tasks/:id/resolve-delivery")\n  @RequireOperatorCapability("approve_send")',
      '@Post("send-tasks/:id/resolve-delivery")\n  @RequireOperatorCapability("view_console")',
    ),
    "utf8",
  );
  const guardReport = buildAudit(guardRoot, { includeExternal: false });
  assert.equal(
    guardReport.results.find((item) => item.id === "contract.wechat_manual_delivery_resolution_guard").status,
    STATUS.FAIL,
  );
});

test("asset ingestion audit contract fails when bounded input markers drift", () => {
  const baselineRoot = createPassingFixture();
  const baseline = buildAudit(baselineRoot, { includeExternal: false });
  assert.equal(baseline.results.find((item) => item.id === "contract.asset_ingestion_limits").status, STATUS.PASS);

  const mutations = [
    { name: "shared byte limit", from: "MAX_IMAGE_FINGERPRINT_BYTES", to: "LEGACY_IMAGE_LIMIT", all: true },
    {
      name: "base64 decoded byte assertion",
      from: "assertAssetSize(decodeBase64(params.base64))",
      to: "decodeBase64(params.base64)",
    },
    { name: "UTF-8 text byte count", from: 'Buffer.byteLength(params.text, "utf8")', to: "params.text.length" },
    { name: "URL protocol normalization", from: "normalizeAssetUrl(params.url)", to: "params.url" },
    {
      name: "download timeout",
      from: "timeout: appConfig.designPlatformTimeoutMs",
      to: "timeout: 0",
    },
    {
      name: "download content length",
      from: "maxContentLength: MAX_IMAGE_FINGERPRINT_BYTES",
      to: "maxContentLength: Infinity",
    },
    {
      name: "download body length",
      from: "maxBodyLength: MAX_IMAGE_FINGERPRINT_BYTES",
      to: "maxBodyLength: Infinity",
    },
    { name: "canonical base64 validation", from: "isCanonicalBase64Text", to: "isBase64Text" },
    { name: "HTTP(S) URL restriction", from: "asset URL must use http(s)", to: "asset URL is invalid" },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, "desktop", "apps", "api", "src", "storage", "storage.service.ts");
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.name);
    const mutated = mutation.all ? source.split(mutation.from).join(mutation.to) : source.replace(mutation.from, mutation.to);
    fs.writeFileSync(target, mutated, "utf8");

    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === "contract.asset_ingestion_limits");
    assert.equal(contract.status, STATUS.FAIL, mutation.name);
    assert.ok(contract.evidence.missing.length > 0, mutation.name);
  }
});

test("asset SSRF, content truth and both local-file response contracts fail closed on drift", () => {
  const baselineRoot = createPassingFixture();
  const expectedContracts = [
    "contract.asset_public_network",
    "contract.asset_content_truth",
    "contract.asset_local_file_headers",
    "contract.assets_controller_safe_file_response",
    "contract.design_controller_safe_file_response",
    "contract.asset_security_documentation",
  ];
  const baseline = buildAudit(baselineRoot, { includeExternal: false });
  for (const id of expectedContracts) {
    assert.equal(baseline.results.find((item) => item.id === id).status, STATUS.PASS, id);
  }

  const mutations = [
    {
      id: "contract.asset_public_network",
      file: "desktop/apps/api/src/storage/safe-download.ts",
      from: "proxy: false",
      to: "proxy: true",
    },
    {
      id: "contract.asset_content_truth",
      file: "desktop/apps/api/src/storage/asset-content-security.ts",
      from: 'kind: "pdf", mimeType: "application/pdf", extension: ".pdf", inlineSafe: false',
      to: 'kind: "pdf", mimeType: "application/pdf", extension: ".pdf", inlineSafe: true',
    },
    {
      id: "contract.asset_local_file_headers",
      file: "desktop/apps/api/src/storage/local-file-response.ts",
      from: "nosniff",
      to: "sniff",
    },
    {
      id: "contract.assets_controller_safe_file_response",
      file: "desktop/apps/api/src/assets/assets.controller.ts",
      from: "applySafeLocalFileHeaders(reply, file)",
      to: 'reply.header("Content-Type", file.mimeType)',
    },
    {
      id: "contract.design_controller_safe_file_response",
      file: "desktop/apps/api/src/design-jobs/design-jobs.controller.ts",
      from: "applySafeLocalFileHeaders(reply, file)",
      to: 'reply.header("Content-Type", file.mimeType)',
    },
    {
      id: "contract.asset_security_documentation",
      file: "desktop/docs/DESIGN_PLATFORM_CONTRACT.md",
      from: "不再作为“部署侧未决”项冒充已完成",
      to: "私网地址、DNS 重绑定仍需要部署负责人",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.id);
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === mutation.id);
    assert.equal(contract.status, STATUS.FAIL, mutation.id);
    assert.ok(contract.evidence.missing.length > 0, mutation.id);
  }
});

test("completion audit fails when high-risk route guards, trusted actors or public callback boundaries drift", () => {
  const baselineRoot = createPassingFixture();
  const projectRoot = path.resolve(__dirname, "..", "..");
  for (const relative of [
    "desktop/apps/api/src/orders/orders.controller.ts",
    "desktop/apps/api/src/reviews/reviews.controller.ts",
    "desktop/apps/api/src/wechat-work/wechat-work.controller.ts",
  ]) {
    write(baselineRoot, relative, fs.readFileSync(path.join(projectRoot, ...relative.split("/")), "utf8"));
  }
  const baseline = buildAudit(baselineRoot, { includeExternal: false });
  assert.equal(baseline.results.find((item) => item.id === "contract.high_risk_operator_routes").status, STATUS.PASS);

  for (const decoy of [
    'private readonly stringRouteDecoy = "@Post(\\\":id/unsafe-update\\\")";',
    "// @Post(\":id/unsafe-update\")",
    "/* @Post(\":id/unsafe-update\") */",
    "private readonly templateRouteDecoy = `@Post(\":id/unsafe-update\")`;",
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "completion-audit-route-decoy-"));
    fs.cpSync(baselineRoot, root, { recursive: true });
    const target = path.join(root, "desktop", "apps", "api", "src", "orders", "orders.controller.ts");
    const source = fs.readFileSync(target, "utf8");
    fs.writeFileSync(target, source.replace('  @Post(":id/revise-selection")', `  ${decoy}\n  @Post(":id/revise-selection")`), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === "contract.high_risk_operator_routes").status, STATUS.PASS, decoy);
  }

  for (const samePathDecoy of [
    'private readonly samePathStringDecoy = "@Post(\\\":id/update\\\")";',
    "// @Post(\":id/update\")",
    "/* @Post(\":id/update\") */",
    "private readonly samePathTemplateDecoy = `@Post(\":id/update\")`;",
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "completion-audit-same-route-decoy-"));
    fs.cpSync(baselineRoot, root, { recursive: true });
    const target = path.join(root, "desktop", "apps", "api", "src", "orders", "orders.controller.ts");
    const source = fs.readFileSync(target, "utf8");
    fs.writeFileSync(target, source.replace('  @Post(":id/update")', `  ${samePathDecoy}\n  @Post(":id/update")`), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === "contract.high_risk_operator_routes").status, STATUS.PASS, samePathDecoy);
  }

  const mutations = [
    {
      name: "ordinary extra update field",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          "customerNotes: payload?.customerNotes,",
          "customerNotes: payload?.customerNotes,\n      paymentStatus: payload?.paymentStatus,",
        );
      },
    },
    {
      name: "direct principal mutation",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          "return this.orders.update(id, {",
          "Object.assign(principal, { id: payload?.owner });\n    return this.orders.update(id, {",
        );
      },
    },
    {
      name: "computed owner override",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          "owner: principal.id,",
          'owner: principal.id,\n      ["owner"]: payload?.owner,',
        );
      },
    },
    {
      name: "shorthand extra update field",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          "customerNotes: payload?.customerNotes,",
          "customerNotes: payload?.customerNotes,\n      paymentStatus,",
        );
      },
    },
    {
      name: "aliased principal Object.assign mutation",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          "return this.orders.update(id, {",
          "const actor = principal;\n    Object.assign(actor, { id: payload?.owner });\n    return this.orders.update(id, {",
        );
      },
    },
    {
      name: "aliased principal id assignment",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          "return this.orders.update(id, {",
          "const actor = principal;\n    actor.id = payload?.owner;\n    return this.orders.update(id, {",
        );
      },
    },
    {
      name: "notification effect key projection",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          "customerNotes: payload?.customerNotes,",
          "customerNotes: payload?.customerNotes,\n      notificationEffectKey: payload?.notificationEffectKey,",
        );
      },
    },
    {
      name: "spread update projection",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          "return this.orders.update(id, {",
          "return this.orders.update(id, { ...payload,",
        );
      },
    },
    {
      name: "orders controller path changed",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace('@Controller("orders")', '@Controller("unsafe-orders")');
      },
    },
    {
      name: "TrustedOperator cannot shadow its operator-access import",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          "  TrustedOperator,\r\n} from \"../operator-access/operator-access.guard\";",
          "} from \"../operator-access/operator-access.guard\";\r\nconst TrustedOperator = Body;",
        );
      },
    },
    {
      name: "RequireOperatorCapability cannot become a local no-op decorator",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          "  RequireOperatorCapability,\r\n",
          "",
        ).replace(
          '@Controller("orders")',
          'const RequireOperatorCapability = (..._args: any[]) => () => undefined;\r\n\r\n@Controller("orders")',
        );
      },
    },
    {
      name: "orders controller gains a duplicate decorator",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace('@Controller("orders")', '@Controller("orders")\n@Controller("orders")');
      },
    },
    {
      name: "orders update route is attached to a renamed method",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(/\r?\n  update\(\r?\n/, "\n  unsafeUpdate(\n");
      },
    },
    {
      name: "orders update id parameter decorator argument changed",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          /@Param\("id"\) id: string,\r?\n    @Body\(\) payload: \{ status\?/,
          '@Param("other") id: string,\n    @Body() payload: { status?',
        );
      },
    },
    {
      name: "orders update body decorator gains an argument",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace("@Body() payload: { status?", '@Body("payload") payload: { status?');
      },
    },
    {
      name: "orders update id parameter becomes optional",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          /@Param\("id"\) id: string,\r?\n    @Body\(\) payload: \{ status\?/,
          '@Param("id") id?: string,\n    @Body() payload: { status?',
        );
      },
    },
    {
      name: "orders update payload type is widened",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          "@Body() payload: { status?: string; customerNotes?: string; owner?: string } & ExpectedIdentityPayload,",
          "@Body() payload: any,",
        );
      },
    },
    {
      name: "orders controller gains an extra undecorated method",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          '  @Post(":id/revise-selection")',
          '  unsafeHelper() {}\n\n  @Post(":id/revise-selection")',
        );
      },
    },
    {
      name: "orders controller gains an extra GET method",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          '  @Post(":id/revise-selection")',
          '  @Get("unsafe")\n  unsafeGet() {}\n\n  @Post(":id/revise-selection")',
        );
      },
    },
    {
      name: "computed require Post alias adds an unsafe route",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source
          .replace('@Controller("orders")', 'const UnsafePost = require("@nestjs/common")["Post"];\n\n@Controller("orders")')
          .replace(
            '  @Post(":id/revise-selection")',
            '  @UnsafePost(":id/unsafe-update")\n  unsafeComputedRoute() {}\n\n  @Post(":id/revise-selection")',
          );
      },
    },
    ...[
      {
        name: "duplicate orders update route",
        decorator: '@Post(":id/update")',
      },
      {
        name: "new unsafe literal orders update route",
        decorator: '@Post(":id/unsafe-update")',
      },
      {
        name: "new unsafe template-literal orders update route",
        decorator: '@Post(`:id/unsafe-update`)',
      },
      {
        name: "new unsafe constant orders update route",
        decorator: "@Post(UNSAFE_ORDER_UPDATE_PATH)",
      },
      {
        name: "new unsafe concatenated orders update route",
        decorator: '@Post(":id/" + "unsafe-update")',
      },
      {
        name: "new unsafe no-argument orders update route",
        decorator: "@Post()",
      },
      {
        name: "new unsafe array orders update route",
        decorator: '@Post([":id/unsafe-update"])',
      },
      {
        name: "new unsafe comment-gap orders update route",
        decorator: '@Post /* route gap */ (":id/unsafe-update")',
      },
    ].map(({ name, decorator }) => ({
      name,
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source.replace(
          '  @Post(":id/revise-selection")',
          `  ${decorator}\n  unsafeUpdate(@Param("id") id: string, @Body() payload: any) {\n    return this.orders.update(id, payload);\n  }\n\n  @Post(":id/revise-selection")`,
        );
      },
    })),
    {
      name: "aliased Post import and decorator",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source
          .replace("Param, Post, Query", "Param, Post, Post as UnsafePost, Query")
          .replace(
            '  @Post(":id/revise-selection")',
            '  @UnsafePost(":id/unsafe-update")\n  unsafeAlias() {}\n\n  @Post(":id/revise-selection")',
          );
      },
    },
    {
      name: "namespace Post import and decorator",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source
          .replace(
            'import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";',
            'import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";\nimport * as UnsafeNest from "@nestjs/common";',
          )
          .replace(
            '  @Post(":id/revise-selection")',
            '  @UnsafeNest.Post(":id/unsafe-update")\n  unsafeNamespace() {}\n\n  @Post(":id/revise-selection")',
          );
      },
    },
    {
      name: "Post decorator factory alias",
      file: "desktop/apps/api/src/orders/orders.controller.ts",
      mutate(source) {
        return source
          .replace('@Controller("orders")', 'const UnsafePost = Post;\n\n@Controller("orders")')
          .replace(
            '  @Post(":id/revise-selection")',
            '  @UnsafePost(":id/unsafe-update")\n  unsafeFactoryAlias() {}\n\n  @Post(":id/revise-selection")',
          );
      },
    },
    {
      file: "desktop/apps/api/src/wechat-work/wechat-work.controller.ts",
      mutate(source) {
        return source.replace(
          /(@Post\("kf\/sync"\)[\s\S]*?@RequireOperatorCapability\("manage_channels"\))\r?\n\s*@UseGuards\(OperatorAccessGuard\)/,
          "$1",
        );
      },
    },
    {
      file: "desktop/apps/api/src/reviews/reviews.controller.ts",
      mutate(source) {
        return source.replace("reviewer: principal.id", 'reviewer: "browser_operator"');
      },
    },
    {
      file: "desktop/apps/api/src/wechat-work/wechat-work.controller.ts",
      mutate(source) {
        return source.replace(
          '@Post("callback")',
          '@Post("callback")\n  @RequireOperatorCapability("approve_send")\n  @UseGuards(OperatorAccessGuard)',
        );
      },
    },
  ];
  for (const mutation of mutations) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "completion-audit-integrated-mutation-"));
    fs.cpSync(baselineRoot, root, { recursive: true });
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    const mutated = mutation.mutate(source);
    assert.notEqual(mutated, source, mutation.name || mutation.file);
    fs.writeFileSync(target, mutated, "utf8");
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === "contract.high_risk_operator_routes");
    assert.equal(contract.status, STATUS.FAIL, mutation.name || mutation.file);
    assert.ok(contract.evidence.missing.length + contract.evidence.forbidden.length > 0);
    assert.ok(contract.evidence.issues.some((issue) => issue.path === mutation.file), mutation.name || mutation.file);
  }
});

test("completion audit detects payment and routing correction boundary drift", () => {
  const mutations = [
    {
      id: "contract.payment_update_boundaries",
      file: "desktop/apps/api/src/quotes/quotes.service.ts",
      from: "报价付款状态只能通过付款凭证核验入口更新",
      to: "付款状态可直接更新",
    },
    {
      id: "contract.order_payment_update_boundaries",
      file: "desktop/apps/api/src/orders/orders.service.ts",
      from: "async recordVerifiedPayment",
      to: "async updatePayment",
    },
    {
      id: "contract.routing_correction_idempotency",
      file: "desktop/apps/api/src/prisma/prisma-operations.service.ts",
      from: "before.correction?.requestKey === requestKey",
      to: "false",
    },
    {
      id: "contract.routing_correction_local_parity",
      file: "desktop/apps/api/src/local-store/local-store.service.ts",
      from: "throw new BadRequestException",
      to: "throw new Error",
    },
    {
      id: "contract.payment_update_web_surface",
      file: "desktop/apps/web/src/features/sales/sales-order-edit-page.tsx",
      from: "付款状态（只读）",
      to: "付款状态",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.id);
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === mutation.id).status, STATUS.FAIL, mutation.id);
  }
});

test("external signing, staging, channel, recovery and hardware evidence aggregate to BLOCKED", () => {
  const report = buildAudit(createPassingFixture());
  assert.equal(report.status, STATUS.BLOCKED);
  assert.equal(report.counts.FAIL, 0);
  assert.equal(report.counts.BLOCKED, 5);
  assert.equal(EXIT_CODE[STATUS.BLOCKED], 2);
});

test("missing repository artifact and production placeholder aggregate to FAIL with relative location", () => {
  const root = createPassingFixture();
  fs.rmSync(path.join(root, "desktop", "tools", "build-windows-package.js"));
  write(root, "desktop/apps/api/src/example.service.ts", 'throw new Error("prisma mode is not implemented yet");\n');
  const report = buildAudit(root);
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(EXIT_CODE[STATUS.FAIL], 1);
  const placeholders = report.results.find((item) => item.id === "source.production_placeholders");
  assert.deepEqual(placeholders.evidence.findings, [{
    component: "desktop/apps/api/src/example.service.ts",
    line: 1,
    marker: "prisma mode is not implemented yet",
  }]);
});

test("production placeholder inventory covers the Web app and shared production packages", () => {
  const root = createPassingFixture();
  write(root, "desktop/apps/web/src/example-placeholder.tsx", "// TODO replace this production screen\n");
  write(root, "desktop/packages/runtime/example-placeholder.js", 'throw new Error("not implemented");\n');

  const report = buildAudit(root, { includeExternal: false });
  const placeholders = report.results.find((item) => item.id === "source.production_placeholders");
  assert.equal(placeholders.status, STATUS.FAIL);
  assert.deepEqual(placeholders.evidence.sourceRoots, [
    "desktop/apps/api/src",
    "desktop/apps/web/src",
    "desktop/apps/electron",
    "desktop/packages",
    "core",
  ]);
  assert.deepEqual(placeholders.evidence.findings, [
    { component: "desktop/apps/web/src/example-placeholder.tsx", line: 1, marker: "todo" },
    { component: "desktop/packages/runtime/example-placeholder.js", line: 1, marker: "not implemented" },
  ]);
});

test("missing desktop session security artifact prevents a completion PASS", () => {
  const root = createPassingFixture();
  fs.rmSync(path.join(root, "desktop", "tests", "internal-api-security.test.js"));
  const report = buildAudit(root, { includeExternal: false });
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "security.desktop_session_proof").status, STATUS.FAIL);
});

test("missing wechat window observer evidence security artifact prevents a completion PASS", () => {
  const root = createPassingFixture();
  fs.rmSync(path.join(root, "desktop", "tests", "wechat-window-evidence-security.test.js"));
  const report = buildAudit(root, { includeExternal: false });
  assert.equal(report.status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "security.wechat_window_observer_evidence").status, STATUS.FAIL);
});

test("completion audit rejects browser window self-report and observer attestation drift", () => {
  const mutations = [
    {
      id: "contract.wechat_window_validation_source",
      file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
      from: "return this.validateSendTaskWithCurrentWindow(id, expected)",
      to: "return this.validateSendTask(id, expected.activeWindow)",
    },
    {
      id: "contract.wechat_window_validation_controller",
      file: "desktop/apps/api/src/wechat/wechat.controller.ts",
      from: "@Body() payload: ExpectedIdentityPayload",
      to: "@Body() payload: ExpectedIdentityPayload & { activeWindow?: object }",
    },
    {
      id: "contract.wechat_window_persisted_attestation",
      file: "desktop/packages/rules/wechatWindowEvidence.js",
      from: "timingSafeEqual(supplied, expected)",
      to: "supplied.length === expected.length",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const target = path.join(root, ...mutation.file.split("/"));
    const source = fs.readFileSync(target, "utf8");
    assert.ok(source.includes(mutation.from), mutation.id);
    fs.writeFileSync(target, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    assert.equal(report.results.find((item) => item.id === mutation.id).status, STATUS.FAIL, mutation.id);
  }
});

test("completion audit rejects forged HTTP and spread automation provenance", () => {
  const contractIds = [
    "contract.manual_order_queue_controller_allowlist",
    "contract.manual_quote_queue_controller_allowlist",
    "contract.trusted_order_automation_provenance",
    "contract.trusted_quote_automation_provenance",
  ];
  const baseline = buildAudit(createPassingFixture(), { includeExternal: false });
  for (const id of contractIds) {
    assert.equal(baseline.results.find((item) => item.id === id).status, STATUS.PASS, id);
  }

  const mutations = [
    {
      id: "contract.manual_order_queue_controller_allowlist",
      file: "desktop/apps/api/src/wechat/wechat.controller.ts",
      content: "\nqueueOrderConfirmation(id, { ...(payload || {}), automation: payload.automation });\n",
    },
    {
      id: "contract.manual_order_queue_controller_allowlist",
      file: "desktop/apps/api/src/wechat/wechat.controller.ts",
      content: "\nsetConversationManualLock(id, { ...(payload || {}), effectKey: payload.effectKey });\n",
    },
    {
      id: "contract.manual_quote_queue_controller_allowlist",
      file: "desktop/apps/api/src/quotes/quotes.controller.ts",
      content: "\nqueueSend(id, { ...trustedPayload, automation: payload.automation });\n",
    },
    {
      id: "contract.trusted_order_automation_provenance",
      file: "desktop/apps/api/src/wechat/wechat-dispatch.service.ts",
      content: "\nconst forgedAutomation = { ...(payload.automation || {}) };\n",
    },
    {
      id: "contract.trusted_quote_automation_provenance",
      file: "desktop/apps/api/src/quotes/quotes.service.ts",
      content: "\nautomation: options.automation;\n",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    write(root, mutation.file, mutation.content, true);
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === mutation.id);
    assert.equal(contract.status, STATUS.FAIL, mutation.id);
    assert.ok(contract.evidence.forbidden.length > 0, mutation.id);
  }
});

test("design reconciliation UI is a required artifact with a fail-closed action contract", () => {
  const root = createPassingFixture();
  const componentPath = path.join(root, "desktop", "apps", "web", "src", "components", "design-execution-reconciliation-panel.tsx");
  fs.rmSync(componentPath);
  let report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "ui.design_execution_reconciliation").status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "contract.design_execution_reconciliation_ui").status, STATUS.FAIL);

  const mutations = [
    {
      name: "fixed resolution cannot drift",
      from: 'unknown: "confirmed_not_generated_refunded"',
      to: 'unknown: "server_resolution"',
    },
    {
      name: "loading must invalidate pending confirmation",
      from: 'if (loading) return "loading";',
      to: 'if (loading) return "";',
    },
    {
      name: "loading reason must remain visible",
      from: 'if (loading) return "loading";',
      to: 'if (loading) return " ";',
    },
    {
      name: "unknown access must invalidate pending confirmation",
      from: 'if (!accessLoaded) return "access unknown";',
      to: 'if (!accessLoaded) return "";',
    },
    {
      name: "access downgrade must invalidate pending confirmation",
      from: 'if (!canManageExecutions) return "access downgraded";',
      to: 'if (!canManageExecutions) return "";',
    },
    {
      name: "current execution intent and resolution must still match",
      from: 'if (!currentExecution || currentExecution.availableResolution !== pending.resolution) {\n    return "intent changed";\n  }',
      to: 'if (!currentExecution || currentExecution.availableResolution !== pending.resolution) {\n    return "";\n  }',
    },
  ];

  for (const mutation of mutations) {
    const mutatedRoot = createPassingFixture();
    const mutatedComponentPath = path.join(mutatedRoot, "desktop", "apps", "web", "src", "components", "design-execution-reconciliation-panel.tsx");
    const component = fs.readFileSync(mutatedComponentPath, "utf8");
    assert.ok(component.includes(mutation.from), mutation.name);
    fs.writeFileSync(mutatedComponentPath, component.replace(mutation.from, mutation.to), "utf8");
    report = buildAudit(mutatedRoot, { includeExternal: false });
    const uiContract = report.results.find((item) => item.id === "contract.design_execution_reconciliation_ui");
    assert.equal(uiContract.status, STATUS.FAIL, mutation.name);
    assert.ok(uiContract.evidence.missing.length > 0, mutation.name);
  }
});

test("design reconciliation UI cannot put reviewer in a browser-owned request body", () => {
  const repositoryRoot = path.resolve(__dirname, "..", "..");
  const integrationReport = buildAudit(repositoryRoot, { includeExternal: false });
  const integrationContract = integrationReport.results.find((item) => item.id === "contract.design_execution_reconciliation_ui");
  assert.equal(integrationContract.status, STATUS.PASS, JSON.stringify(integrationContract.evidence));

  const mutations = [
    {
      name: "unknown resolution request",
      changes: [{
        from: '{ ...expected, resolution: "confirmed_not_generated_refunded" }',
        to: '{ ...expected, resolution: "confirmed_not_generated_refunded", reviewer: "browser_operator" }',
      }],
    },
    {
      name: "refund resolution request",
      changes: [{
        from: '{ ...expected, resolution: "confirmed_refunded" }',
        to: '{ ...expected, resolution: "confirmed_refunded", reviewer: "browser_operator" }',
      }],
    },
    {
      name: "shared request serializer",
      changes: [{
        from: 'body: JSON.stringify(body)',
        to: 'body: JSON.stringify({ ...body, reviewer: "browser_operator" })',
      }],
    },
    {
      name: "unknown resolution reviewer through an extra spread",
      changes: [
        {
          from: 'export async function resolveUnknownDesignExecution(',
          to: 'const browserOwnedResolutionFields = { reviewer: "browser_operator" };\nexport async function resolveUnknownDesignExecution(',
        },
        {
          from: '{ ...expected, resolution: "confirmed_not_generated_refunded" }',
          to: '{ ...expected, ...browserOwnedResolutionFields, resolution: "confirmed_not_generated_refunded" }',
        },
      ],
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const apiPath = path.join(root, "desktop", "apps", "web", "src", "lib", "api.ts");
    let api = fs.readFileSync(apiPath, "utf8");
    for (const change of mutation.changes) {
      assert.ok(api.includes(change.from), mutation.name);
      api = api.replace(change.from, change.to);
    }
    fs.writeFileSync(apiPath, api, "utf8");
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === "contract.design_execution_reconciliation_ui");
    assert.equal(contract.status, STATUS.FAIL, mutation.name);
    assert.ok(contract.evidence.forbidden.length > 0, mutation.name);
  }
});

test("design execution public view rejects unexpected DTO fields and unsafe projection fields", () => {
  const root = createPassingFixture();
  const typesPath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-jobs.types.ts");
  const executionPath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-platform-execution.service.ts");
  fs.writeFileSync(
    typesPath,
    fs.readFileSync(typesPath, "utf8").replace("  attemptNo: number;", "  attemptNo: number;\n  requestId: string;"),
    "utf8",
  );
  fs.writeFileSync(
    executionPath,
    fs.readFileSync(executionPath, "utf8").replace("    id: execution.id,", "    id: execution.id, operationKey: execution.operationKey,"),
    "utf8",
  );
  const report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.design_execution_public_view");
  assert.equal(contract.status, STATUS.FAIL);
  assert.deepEqual(contract.evidence.unexpectedFields, ["requestId"]);
  assert.ok(contract.evidence.forbidden.length > 0);
});

test("refund reconciliation eligibility stays exact for resumable partial success and unsafe refund states", () => {
  const baselineRoot = createPassingFixture();
  const baseline = buildAudit(baselineRoot, { includeExternal: false });
  assert.equal(baseline.results.find((item) => item.id === "contract.design_execution_public_view").status, STATUS.PASS);

  const mutations = [
    {
      name: "completed manual_review with failed refund remains eligible",
      from: '["failed", "unknown"].includes(execution.refundStatus)',
      to: '["unknown"].includes(execution.refundStatus)',
    },
    {
      name: "completed manual_review with unknown refund remains eligible",
      from: '["failed", "unknown"].includes(execution.refundStatus)',
      to: '["failed"].includes(execution.refundStatus)',
    },
    {
      name: "completed accepted remains ineligible",
      from: 'execution?.acceptanceStatus === "manual_review"',
      to: 'execution?.acceptanceStatus === "accepted"',
    },
    {
      name: "safe refunded state remains ineligible",
      from: '["failed", "unknown"].includes(execution.refundStatus)',
      to: '["failed", "unknown", "refunded"].includes(execution.refundStatus)',
    },
    {
      name: "refund write path reuses the same eligibility helper",
      from: "if (!isUnsafeRefundResolutionEligible(execution))",
      to: "if (!execution)",
    },
    {
      name: "resumable partial success returns to pending local acceptance",
      from: 'resumableCompleted ? { acceptanceStatus: "pending" } : {}',
      to: 'resumableCompleted ? { acceptanceStatus: "accepted" } : {}',
    },
    {
      name: "resumable partial success clears resolvedAt for local acceptance",
      from: "resolvedAt: resumableCompleted ? null : new Date()",
      to: "resolvedAt: new Date()",
    },
  ];

  for (const mutation of mutations) {
    const root = createPassingFixture();
    const executionPath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-platform-execution.service.ts");
    const source = fs.readFileSync(executionPath, "utf8");
    assert.match(source, new RegExp(mutation.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), mutation.name);
    fs.writeFileSync(executionPath, source.replace(mutation.from, mutation.to), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === "contract.design_execution_public_view");
    assert.equal(contract.status, STATUS.FAIL, mutation.name);
    assert.ok(contract.evidence.missingContracts.length > 0, mutation.name);
  }
});

test("design execution GET client must use exact expected identity query keys", () => {
  const root = createPassingFixture();
  const apiPath = path.join(root, "desktop", "apps", "web", "src", "lib", "api.ts");
  const unsafe = fs.readFileSync(apiPath, "utf8")
    .replaceAll("expectedWechatAccountId", "wechatAccountId")
    .replaceAll("expectedConversationId", "conversationId")
    .replaceAll("expectedCustomerId", "customerId");
  fs.writeFileSync(apiPath, unsafe, "utf8");
  const report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.design_execution_list_identity");
  assert.equal(contract.status, STATUS.FAIL);
  assert.ok(contract.evidence.missing.every((item) => item.startsWith("client-")));
  assert.equal(report.results.find((item) => item.id === "contract.design_execution_public_view").status, STATUS.PASS);

  const callerRoot = createPassingFixture();
  const callerApiPath = path.join(callerRoot, "desktop", "apps", "web", "src", "lib", "api.ts");
  fs.writeFileSync(
    callerApiPath,
    fs.readFileSync(callerApiPath, "utf8").replace(
      "designExecutionExpectedIdentityQuery(expected)",
      "expectedIdentityQuery(expected)",
    ),
    "utf8",
  );
  const callerReport = buildAudit(callerRoot, { includeExternal: false });
  const callerContract = callerReport.results.find((item) => item.id === "contract.design_execution_list_identity");
  assert.equal(callerContract.status, STATUS.FAIL);
  assert.ok(callerContract.evidence.missing.some((item) => item.startsWith("client-")));
});

test("design execution list service requires all three expected identity values before optional matching", () => {
  const root = createPassingFixture();
  const servicePath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-jobs.service.ts");
  const source = fs.readFileSync(servicePath, "utf8").replace(
    '    if (!expected.expectedWechatAccountId || !expected.expectedConversationId || !expected.expectedCustomerId) throw new Error("complete identity required");\n',
    "",
  );
  fs.writeFileSync(servicePath, source, "utf8");
  const report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.design_execution_list_identity");
  assert.equal(contract.status, STATUS.FAIL);
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("service-")));
});

test("design execution resolution writes must return the public mapper", () => {
  const root = createPassingFixture();
  const servicePath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-jobs.service.ts");
  const unsafe = fs.readFileSync(servicePath, "utf8")
    .replace("this.designPlatformExecutions.resolveUnknownPublic", "this.designPlatformExecutions.resolveUnknown")
    .replace("this.designPlatformExecutions.resolveUnsafeRefundPublic", "this.designPlatformExecutions.resolveUnsafeRefund");
  fs.writeFileSync(servicePath, unsafe, "utf8");
  const report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.design_execution_resolution_boundaries");
  assert.equal(contract.status, STATUS.FAIL);
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("unknown-service-response-")));
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("refund-service-response-")));
  assert.equal(report.results.find((item) => item.id === "contract.design_execution_public_view").status, STATUS.PASS);
});

test("design execution resolution routes keep manage/approve boundaries and strict payload literals", () => {
  const root = createPassingFixture();
  const controllerPath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-jobs.controller.ts");
  const typesPath = path.join(root, "desktop", "apps", "api", "src", "design-jobs", "design-jobs.types.ts");
  const controller = fs.readFileSync(controllerPath, "utf8")
    .replaceAll('@RequireOperatorCapability("manage_design_executions")', '@RequireOperatorCapability("view_console")')
    .replace('@RequireOperatorCapability("approve_send")', '@RequireOperatorCapability("manage_design_executions")');
  fs.writeFileSync(controllerPath, controller, "utf8");
  fs.writeFileSync(
    typesPath,
    fs.readFileSync(typesPath, "utf8").replace('resolution: "confirmed_refunded";', 'resolution: "refund_confirmed";'),
    "utf8",
  );
  const report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.design_execution_resolution_boundaries");
  assert.equal(contract.status, STATUS.FAIL);
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("unknown-route-")));
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("refund-route-")));
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("approve-route-")));
  assert.ok(contract.evidence.missing.some((item) => item.startsWith("types-")));
});

test("design execution secret boundary is scoped to the execution model", () => {
  const root = createPassingFixture();
  const schemaPath = path.join(root, "desktop", "prisma", "schema.prisma");
  fs.appendFileSync(schemaPath, "\nmodel LegacyDesignRequest { customerText String? }\n", "utf8");

  let report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.design_platform_execution_models").status, STATUS.PASS);

  const schema = fs.readFileSync(schemaPath, "utf8").replace(
    "scopeKey String processRunId String",
    "scopeKey String customerText String processRunId String",
  );
  fs.writeFileSync(schemaPath, schema, "utf8");
  report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.design_platform_execution_models").status, STATUS.FAIL);
});

test("planned channel placeholders are allowed only with planned status, fail-closed adapter and roadmap reason", () => {
  const root = createPassingFixture();
  let report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "planned_scope.optional_channels").status, STATUS.PASS);
  assert.equal(report.results.find((item) => item.id === "source.production_placeholders").status, STATUS.PASS);

  write(root, "docs/PROJECT_LANDING_ROADMAP.md", "规划渠道已经接通。\n");
  report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "planned_scope.optional_channels").status, STATUS.FAIL);
  assert.equal(report.results.find((item) => item.id === "source.production_placeholders").status, STATUS.FAIL);
});

test("Prisma Agent initializer must keep zero-write plan, explicit confirmation and redacted catch", () => {
  const root = createPassingFixture();
  let report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.prisma_agent_initializer_safety").status, STATUS.PASS);

  write(root, "desktop/tools/initialize-prisma-agents.js", 'const execute=process.argv.includes("--execute");\ninitializePrismaAgentData().catch((error) => process.stderr.write(error.message));\n');
  report = buildAudit(root, { includeExternal: false });
  const initializer = report.results.find((item) => item.id === "contract.prisma_agent_initializer_safety");
  assert.equal(initializer.status, STATUS.FAIL);
  assert.ok(initializer.evidence.missing.length > 0);
  assert.ok(initializer.evidence.forbidden.length > 0);
});

test("Prisma order invalidation requires one transaction, guarded task statuses and a fixed audit actor", () => {
  const root = createPassingFixture();
  let report = buildAudit(root, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.prisma_order_send_invalidation").status, STATUS.PASS);

  write(root, "desktop/apps/api/src/orders/orders.service.ts", 'updatePrismaOrderAndQuoteWithSendInvalidation();\ntx.wechatSendTask.updateMany();\nreviewer: data.owner;\n');
  report = buildAudit(root, { includeExternal: false });
  const contract = report.results.find((item) => item.id === "contract.prisma_order_send_invalidation");
  assert.equal(contract.status, STATUS.FAIL);
  assert.ok(contract.evidence.missing.length >= 5);
});

test("report output is confined to the ignored runtime path and remains sanitized Chinese Markdown plus JSON", () => {
  const root = createPassingFixture();
  const report = buildAudit(root);
  const files = writeReport(root, report);
  const expected = path.join(root, "desktop", ".runtime", "project-completion-audit");
  assert.equal(path.dirname(files.jsonPath), expected);
  assert.equal(path.dirname(files.markdownPath), expected);
  assert.match(fs.readFileSync(files.markdownPath, "utf8"), /项目完成度真值审计/);
  assert.equal(fs.readFileSync(files.jsonPath, "utf8").includes(root), false);
  assert.equal(report.scope.reportPath, "desktop/.runtime/project-completion-audit/latest.{json,md}");
});

test("resolved production LocalStore gaps render resolved classification and current truth", () => {
  const report = buildAudit(createPassingFixture(), { includeExternal: false });
  const markdown = toMarkdown(report);
  for (const id of ["local_store.conversation_operations", "local_store.personal_wechat_business_records"]) {
    const item = report.results.find((entry) => entry.id === id);
    assert.equal(item.status, STATUS.PASS);
    assert.equal(item.evidence.active, false);
    assert.equal(item.evidence.classification, "resolved_production_route");
    assert.equal(item.evidence.priorClassification, "production_gap");
    assert.match(item.evidence.reason, /历史缺口已关闭/);
  }
  assert.match(markdown, /LocalStore 企业微信入站时间戳单调推进/);
  assert.doesNotMatch(markdown, /Prisma Conversation 尚无完整运营字段/);
  assert.doesNotMatch(markdown, /浼佷笟|寰俊|鍏ョ珯/);
});

test("root path escape is rejected and status aggregation keeps FAIL above BLOCKED", () => {
  const root = createPassingFixture();
  assert.throws(() => absoluteFrom(root, "../outside"), /path escapes audit root/);
  assert.equal(aggregateStatus([{ status: STATUS.PASS }, { status: STATUS.BLOCKED }]), STATUS.BLOCKED);
  assert.equal(aggregateStatus([{ status: STATUS.BLOCKED }, { status: STATUS.FAIL }]), STATUS.FAIL);
  assert.match(toMarkdown(buildAudit(root)), /无网络、无命令执行、无数据库连接、无真实发送/);
});

test("documentation keeps Excel, Prisma, packaging, CI, recovery and image hash claims evidence-bound", () => {
  const repositoryRoot = path.resolve(__dirname, "..", "..");
  const read = (relative) => fs.readFileSync(path.join(repositoryRoot, ...relative.split("/")), "utf8");
  const readme = read("desktop/README.md");
  const status = read("desktop/docs/IMPLEMENTATION_STATUS.md");
  const auditGuide = read("desktop/docs/PROJECT_COMPLETION_AUDIT.md");
  const designGuide = read("desktop/docs/design-platform-art-image-local.md");
  const designContract = read("desktop/docs/DESIGN_PLATFORM_CONTRACT.md");
  const releaseChecklist = read("docs/PRODUCTION_RELEASE_CHECKLIST.md");
  assert.match(readme, /\.xlsx.*\.csv.*\.tsv.*\.txt/s);
  assert.match(status, /WechatPersistence.*USE_LOCAL_STORE=false.*Prisma/s);
  assert.match(status, /electron-builder\/NSIS/);
  assert.match(status, /GitHub Actions/);
  assert.match(status, /恢复演练工具/);
  assert.match(status, /dhash64:v1/);
  assert.match(status, /legacyIdentityHash/);
  assert.match(status, /不承诺任意裁剪/);
  assert.match(status, /PersonalWechatRpaPersistence.*USE_LOCAL_STORE=false.*Prisma/s);
  assert.doesNotMatch(status, /个人微信 RPA 账号绑定与业务审计固定走 LocalStore/);
  assert.match(auditGuide, /dhash64:v1.*legacyIdentityHash.*不承诺任意裁剪/s);
  assert.match(designGuide, /DesignExecutionReconciliationPanel.*availableResolution.*不接受 reviewer/s);
  assert.match(designGuide, /completed \+ acceptanceStatus=manual_review.*acceptanceStatus=pending.*不会再次调用生成接口/s);
  assert.match(designGuide, /completed \+ accepted.*refunded\/not_required\/credit_bypass.*不会开放该核销动作/s);
  assert.doesNotMatch(designGuide, /客服 UI 入口仍列入下一轮/);
  assert.match(designContract, /DNS rebinding.*Content-Disposition.*realpath.*不再作为“部署侧未决”项冒充已完成/s);
  assert.doesNotMatch(designContract, /私网地址、DNS 重绑定.*仍需要部署负责人/);
  assert.doesNotMatch(readme, /Excel 文件解析导入。\s*$/m);
  assert.match(releaseChecklist, /目标 Windows.*安装器 SHA-256.*安装.*卸载/s);
  assert.match(releaseChecklist, /SmartScreen.*证据.*发布继续保持 `BLOCKED`/s);
});

test("completion audit requires zero redirects and bounded SKU workbook parsing", () => {
  const baselineRoot = createPassingFixture();
  let report = buildAudit(baselineRoot, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.design_platform_zero_redirect").status, STATUS.PASS);
  assert.equal(report.results.find((item) => item.id === "contract.excel_import_limits").status, STATUS.PASS);

  const redirectRoot = createPassingFixture();
  const clientPath = path.join(redirectRoot, "desktop", "apps", "api", "src", "integrations", "design-platform", "design-platform.client.ts");
  fs.writeFileSync(
    clientPath,
    fs.readFileSync(clientPath, "utf8").replace("config.maxRedirects = 0", "config.maxRedirects = config.maxRedirects"),
    "utf8",
  );
  report = buildAudit(redirectRoot, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.design_platform_zero_redirect").status, STATUS.FAIL);

  const importRoot = createPassingFixture();
  const importPath = path.join(importRoot, "desktop", "packages", "rules", "skuImport.js");
  fs.writeFileSync(
    importPath,
    fs.readFileSync(importPath, "utf8").replace(
      "maxOutputLength: SKU_IMPORT_LIMITS.maxZipEntryUncompressedBytes",
      "maxOutputLength: Infinity",
    ),
    "utf8",
  );
  report = buildAudit(importRoot, { includeExternal: false });
  assert.equal(report.results.find((item) => item.id === "contract.excel_import_limits").status, STATUS.FAIL);
});

test("completion audit rejects regex XML materialization and weakened N+1 early stop", () => {
  for (const mutation of [
    {
      name: "shared string match materialization",
      mutate: (source) => `${source}\nconst items = xml.match(/<si>/g);\n`,
      evidence: "forbidden",
    },
    {
      name: "row match materialization",
      mutate: (source) => `${source}\nconst rowMatches = xml.match(/<row>/g);\n`,
      evidence: "forbidden",
    },
    {
      name: "removed N+1 check",
      mutate: (source) => source.replace("if (count > options.limit)", "if (false)"),
      evidence: "missing",
    },
    {
      name: "moved N+1 check after tag body scan",
      mutate: (source) => source.replace(
        "if (count > options.limit) throw new Error(); const openEnd = findXmlTagEnd(xml, start, xml.length);",
        "const openEnd = findXmlTagEnd(xml, start, xml.length); if (count > options.limit) throw new Error();",
      ),
      evidence: "missing",
    },
  ]) {
    const root = createPassingFixture();
    const sourcePath = path.join(root, "desktop", "packages", "rules", "skuImport.js");
    fs.writeFileSync(sourcePath, mutation.mutate(fs.readFileSync(sourcePath, "utf8")), "utf8");
    const report = buildAudit(root, { includeExternal: false });
    const contract = report.results.find((item) => item.id === "contract.excel_import_limits");
    assert.equal(contract.status, STATUS.FAIL, mutation.name);
    assert.ok(contract.evidence[mutation.evidence].length > 0, mutation.name);
  }
});
