"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildReport } = require("../tools/run-product-acceptance");

const root = path.resolve(__dirname, "..");
const matrixPath = path.join(root, "config", "product-acceptance-matrix.json");
const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));

test("product acceptance matrix covers every requested capability and mode", () => {
  const capabilities = new Set(matrix.scenarios.map((scenario) => scenario.capability));
  for (const capability of matrix.requiredCapabilities) {
    assert.equal(capabilities.has(capability), true, `missing capability: ${capability}`);
  }
  assert.equal(capabilities.has("personal_wechat_dry_run"), false);
  assert.deepEqual(new Set(Object.keys(matrix.modeDefinitions)), new Set(["mock", "local-safe", "real-external"]));
  assert.equal(matrix.defaultMode, "local-safe");
});

test("safe modes cannot mutate external systems", () => {
  for (const scenario of matrix.scenarios.filter((item) => item.mode !== "real-external")) {
    assert.equal(scenario.mutatesExternal, false, `${scenario.id} must not mutate external systems`);
    assert.notEqual(scenario.sideEffectClass, "read-write-external");
  }
  assert.equal(matrix.safetyPolicy.realMessageSend, "forbidden");
  assert.equal(matrix.safetyPolicy.paymentMutation, "external_forbidden_internal_ledger_allowed");
  assert.equal(matrix.safetyPolicy.allowedInternalPaymentMutations.includes("/api/quotes/:id/verify-payment-proof"), true);
  assert.equal(matrix.safetyPolicy.forcedEnvironment.PERSONAL_WECHAT_SEND, "0");
  assert.equal(matrix.safetyPolicy.forcedEnvironment.PERSONAL_WECHAT_BRIDGE_AUTO_ENTER, "0");
  assert.equal(matrix.safetyPolicy.forbiddenHttpMutations.includes("/api/quotes/:id/verify-payment-proof"), false);
  assert.equal(matrix.safetyPolicy.forbiddenHttpMutations.includes("/api/chat/send"), true);
});

test("real external scenarios are read-only and declare dependencies", () => {
  const external = matrix.scenarios.filter((scenario) => scenario.mode === "real-external");
  assert.ok(external.length >= 2);
  assert.equal(external.some((scenario) => scenario.capability === "personal_wechat_dry_run"), false);
  for (const scenario of external) {
    assert.equal(scenario.mutatesExternal, false);
    assert.equal(scenario.sideEffectClass, "read-only-external");
    assert.ok(Array.isArray(scenario.externalDependencies) && scenario.externalDependencies.length > 0);
  }
});

test("acceptance runner and responsive renderer are wired to package scripts", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const runner = fs.readFileSync(path.join(root, "tools", "run-product-acceptance.js"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "tools", "product-acceptance-layout-probe.js"), "utf8");
  const edgeRenderer = fs.readFileSync(path.join(root, "tools", "product-acceptance-layout-edge-probe.js"), "utf8");
  const responsiveRunner = fs.readFileSync(path.join(root, "tools", "run-responsive-layout-qa.js"), "utf8");

  assert.match(packageJson.scripts["acceptance:e2e"], /run-product-acceptance\.js/);
  assert.match(packageJson.scripts["acceptance:e2e:local-safe"], /run-product-acceptance\.js --mode local-safe/);
  assert.match(packageJson.scripts["delivery:acceptance"], /run-product-acceptance\.js --mode local-safe/);
  assert.match(packageJson.scripts["delivery:audit"], /project-completion-audit\.js/);
  assert.match(packageJson.scripts["delivery:staging-readiness"], /staging-readiness-evidence\.js/);
  assert.match(packageJson.scripts["delivery:handoff"], /delivery-handoff-bundle\.js/);
  assert.match(packageJson.scripts["qa:responsive"], /run-responsive-layout-qa\.js/);
  assert.equal(fs.existsSync(path.join(root, "tools", "quality", "run_product_acceptance.bat")), true);
  assert.match(runner, /PERSONAL_WECHAT_SEND:\s*"0"/);
  assert.match(runner, /LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE:\s*"false"/);
  assert.match(runner, /INTERNAL_API_TOKEN:\s*internalApiToken/);
  assert.match(runner, /DESIGN_PLATFORM_CALLBACK_API_KEY:\s*designPlatformCallbackApiKey/);
  assert.match(runner, /ACCEPTANCE_ALLOW_LOOPBACK_DESIGN_DOWNLOADS:\s*"1"/);
  assert.match(runner, /ALLOW_DEMO_DATA_MUTATIONS:\s*"1"/);
  assert.match(runner, /AI_ENGINE_SETTINGS_PATH:\s*aiSettingsPath/);
  assert.match(runner, /primary: local_acceptance/);
  assert.match(runner, /base_url: \$\{mockBase\}\/v1/);
  assert.match(runner, /LOCAL_ACCEPTANCE_AI_KEY:\s*"loopback-acceptance-only"/);
  assert.match(runner, /DESKTOP_WEB_SESSION_PROOF:\s*desktopWebSessionProof/);
  assert.match(runner, /function restoreNextEnvTypes\(\)/);
  assert.match(runner, /import "\.\/\.next\/types\/routes\.d\.ts";/);
  assert.doesNotMatch(runner, /\.next\/dev\/types\/routes/);
  assert.match(runner, /await stopServices\(context\);\s+restoreNextEnvTypes\(\);/);
  assert.match(runner, /headers\["x-internal-api-token"\]\s*=\s*context\.internalApiToken/);
  assert.match(runner, /valid\.text\s*===\s*"success"/);
  assert.match(runner, /record\.action\s*===\s*"callback_accepted"/);
  assert.match(runner, /record\.status\s*===\s*"processed"/);
  assert.match(runner, /tests\/enterprise-wechat-only-api-surface\.test\.js/);
  assert.match(runner, /tests\/wechat-inbound-auth\.test\.js/);
  assert.match(runner, /tests\/wechat-work-api\.test\.js/);
  assert.match(runner, /tests\/wechat-work-production-readiness\.test\.js/);
  assert.match(runner, /commerce_lifecycle_journey:\s*runCommerceLifecycleJourney/);
  assert.match(runner, /\/assets\/demo-customer-logo/);
  assert.match(runner, /\/design-jobs\/\$\{encodeURIComponent\(job\.id\)\}\/submit/);
  assert.match(runner, /\/design-jobs\/\$\{encodeURIComponent\(latest\.id\)\}\/poll/);
  assert.match(runner, /\/design-jobs\/\$\{encodeURIComponent\(job\.id\)\}\/select-image/);
  assert.match(runner, /\/quotes\/\$\{encodeURIComponent\(quote\.id\)\}\/verify-payment-proof/);
  assert.match(runner, /\/orders\/\$\{encodeURIComponent\(orderId\)\}\/fulfillment/);
  assert.match(runner, /productionStatus:\s*"quality_check"/);
  assert.match(runner, /productionStatus:\s*"ready_to_ship"/);
  assert.match(runner, /productionStatus:\s*"shipped"/);
  assert.match(runner, /productionStatus:\s*"delivered"/);
  assert.match(runner, /\/wechat\/orders\/\$\{encodeURIComponent\(orderId\)\}\/queue-followup/);
  assert.match(runner, /\/wechat\/send-attempts\?sendTaskId=/);
  assert.match(runner, /realPaymentGatewayCalled:\s*false/);
  assert.match(runner, /commerce_contract_regression:\s*runCommerceContractRegression/);
  assert.match(runner, /tests\/design-job-create-ui\.test\.js/);
  assert.match(runner, /tests\/design-quote-ui\.test\.js/);
  assert.match(runner, /tests\/payment-routing-boundaries\.test\.js/);
  assert.match(runner, /tests\/sales-order-fulfillment-ui\.test\.js/);
  assert.match(runner, /tests\/order-followup-message\.test\.js/);
  assert.match(runner, /tests\/commerce-page-responsibilities\.test\.js/);
  assert.match(runner, /training_governance_regression:\s*runTrainingGovernanceRegression/);
  assert.match(runner, /training_agent_ai_journey:\s*runTrainingAgentAiJourney/);
  assert.match(runner, /tests\/chat-training\.test\.js/);
  assert.match(runner, /tests\/local-store-training-samples\.test\.js/);
  assert.match(runner, /tests\/training-service\.test\.js/);
  assert.match(runner, /tests\/training-overview-ui\.test\.js/);
  assert.match(runner, /tests\/operator-access\.test\.js/);
  assert.match(runner, /tests\/operator-access-ui\.test\.js/);
  assert.match(runner, /tests\/trusted-operator-ui\.test\.js/);
  assert.match(runner, /\/training\/chat-imports/);
  assert.match(runner, /\/training\/samples\/\$\{encodeURIComponent\(importedSample\.id\)\}\/review/);
  assert.match(runner, /\/training\/skill-suggestions\?agentId=/);
  assert.match(runner, /\/training\/skill-suggestions\/apply/);
  assert.match(runner, /\/agents\/\$\{encodeURIComponent\(agent\.id\)\}\/skills/);
  assert.match(runner, /sceneMemory\?\.applied === true/);
  assert.match(runner, /tests\/wechat-ai-suggestion\.test\.js/);
  assert.match(runner, /tests\/ai-provider-router\.test\.js/);
  assert.match(runner, /tests\/ai-provider-config\.test\.js/);
  assert.doesNotMatch(runner, /tests\/personal-wechat-bridge\.test\.js/);
  assert.doesNotMatch(runner, /personal_bridge_no_send|external_personal_wechat_readiness/);
  assert.doesNotMatch(runner, /runPersonalBridgeNoSend|runExternalPersonalWechatReadiness/);
  assert.match(runner, /await waitForChildExit\(service\.child/);
  assert.match(runner, /operationKey:\s*`\$\{context\.runId\}:design-job:create`/);
  assert.match(runner, /operationKey:\s*`\$\{context\.runId\}:design-job:cross-identity`/);
  assert.match(runner, /responsive-layout-report\.json/);
  assert.match(runner, /product-acceptance-layout-edge-probe\.js/);
  assert.match(runner, /RESPONSIVE_QA_PROBE_OUTPUT:\s*edgeProbePath/);
  assert.match(runner, /edge-probe\.json/);
  assert.match(runner, /renderer:\s*layout\.renderer \|\| "Chromium renderer"/);
  assert.match(runner, /assertResponsiveScreenshotEvidence\(layout\.viewports, screenshotDir\)/);
  assert.match(runner, /responsive-layout", "screenshots", "mobile-390\.png"/);
  assert.doesNotMatch(runner, /path\.join\(context\.outputDir, "layout-390\.png"\)/);
  assert.match(renderer, /name:\s*"desktop-1536",\s*width:\s*1536/);
  assert.match(renderer, /name:\s*"mobile-390",\s*width:\s*390/);
  assert.match(renderer, /capturePage/);
  assert.match(renderer, /app\.setPath\("userData"/);
  assert.match(renderer, /app\.disableHardwareAcceleration\(\)/);
  assert.match(renderer, /loadUrlWithRetry/);
  assert.match(renderer, /waitForReachableLoopback/);
  assert.match(renderer, /smart_kefu_desktop_session/);
  assert.match(renderer, /data-section-id=\"send-center\"/);
  assert.match(responsiveRunner, /runProbeChild/);
  assert.match(responsiveRunner, /RESPONSIVE_QA_USER_DATA_PATH/);
  assert.match(responsiveRunner, /product-acceptance-layout-edge-probe\.js/);
  assert.match(responsiveRunner, /edge-probe\.json/);
  assert.match(edgeRenderer, /renderer:\s*"Microsoft Edge CDP"/);
  assert.match(edgeRenderer, /name:\s*"desktop-1536",\s*width:\s*1536/);
  assert.match(edgeRenderer, /name:\s*"mobile-390",\s*width:\s*390/);
  assert.match(edgeRenderer, /Page\.captureScreenshot/);
  assert.match(edgeRenderer, /Network\.setCookie/);
  assert.match(edgeRenderer, /Target\.createTarget/);
  assert.match(edgeRenderer, /Target\.attachToTarget/);
  assert.match(edgeRenderer, /sessionId/);
  assert.match(edgeRenderer, /smart_kefu_desktop_session/);
  assert.match(edgeRenderer, /buildEdgeBrowserEnv/);
  assert.match(edgeRenderer, /\^npm_/);
  assert.match(edgeRenderer, /\^ELECTRON_/);
  assert.match(edgeRenderer, /--use-gl=swiftshader/);
  assert.match(edgeRenderer, /--disable-gpu-compositing/);
  assert.match(edgeRenderer, /--remote-allow-origins=\*/);
  assert.match(responsiveRunner, /status:\s*"blocked"/);
  assert.match(responsiveRunner, /responsive-layout-report\.zh-CN\.md/);
});

test("acceptance report only advertises a real non-empty 390px screenshot artifact", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-acceptance-artifact-"));
  const screenshotPath = path.join(outputDir, "responsive-layout", "screenshots", "mobile-390.png");
  const context = {
    matrix: { matrixVersion: "test", safetyPolicy: {}, scenarios: [] },
    runId: "artifact-test",
    options: { mode: "local-safe" },
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    serviceRuntimeDir: path.join(outputDir, "runtime"),
    outputDir,
    stack: null,
    mutationLog: [],
    safetyViolations: [],
    results: [],
  };
  try {
    assert.equal(buildReport(context).artifacts.screenshot390, null);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    fs.writeFileSync(screenshotPath, Buffer.from([1, 2, 3]));
    assert.equal(buildReport(context).artifacts.screenshot390, screenshotPath);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("local-safe acceptance promotes demo seeds into isolated Enterprise WeChat identities", () => {
  const runner = fs.readFileSync(path.join(root, "tools", "run-product-acceptance.js"), "utf8");

  assert.match(runner, /accountId:\s*"wechat_work_acceptance_1"/);
  assert.match(runner, /accountId:\s*"wechat_work_acceptance_2"/);
  assert.match(runner, /platform\s*=\s*"wechat_work_kf"/);
  assert.match(runner, /conversation\.channel\s*=\s*"work_wechat"/);
  assert.match(runner, /path\.relative\(context\.serviceRuntimeDir, localStoreFile\)/);
  assert.match(runner, /refusing to prepare acceptance fixtures outside the isolated runtime/);
  assert.match(runner, /context\.acceptanceIdentities\s*=\s*identityFixtures/);
  assert.doesNotMatch(runner, /WECHAT_WORK_DEFAULT_WECHAT_ACCOUNT_ID:\s*"wechat_demo_1"/);
});

test("manual reply acceptance uses the real conversation queue API, not demo send tasks", () => {
  const runner = fs.readFileSync(path.join(root, "tools", "run-product-acceptance.js"), "utf8");
  const manualScenario = matrix.scenarios.find((scenario) => scenario.id === "LSF-MANUAL-QUEUE-001");
  const manualStart = runner.indexOf("async function runManualSafeQueue");
  const manualEnd = runner.indexOf("async function runInboundLocal", manualStart);
  const manualHandler = runner.slice(manualStart, manualEnd);

  assert.ok(manualScenario, "manual queue scenario should exist");
  assert.match(manualHandler, /\/wechat\/conversations\/\$\{encodeURIComponent\(conversation\.id\)\}\/manual-replies/);
  assert.match(manualHandler, /task\.payload\?\.source === "manual_reply"/);
  assert.doesNotMatch(manualHandler, /send-tasks\/demo|createDemoSendTask/);
  assert.doesNotMatch(manualScenario.knownLimit || "", /send-tasks\/demo|demo/);
});

test("commerce lifecycle journey is required local-safe end-to-end acceptance", () => {
  const scenario = matrix.scenarios.find((item) => item.id === "LSF-COMMERCE-JOURNEY-001");
  assert.equal(matrix.requiredCapabilities.includes("commerce_lifecycle_journey"), true);
  assert.ok(scenario, "commerce lifecycle journey scenario should exist");
  assert.equal(scenario.capability, "commerce_lifecycle_journey");
  assert.equal(scenario.mode, "local-safe");
  assert.equal(scenario.handler, "commerce_lifecycle_journey");
  assert.equal(scenario.mutatesExternal, false);
  assert.equal(scenario.sideEffectClass, "local-ephemeral");
  assert.match(scenario.acceptance, /internal payment-proof ledger/);
  assert.match(scenario.acceptance, /without real payment gateway calls or real sending/);
  assert.doesNotMatch(JSON.stringify(scenario), /send-text|mark-sent|bridge-ack|\/api\/chat\/send/);
});

test("commerce lifecycle contracts are required local-safe acceptance", () => {
  const scenario = matrix.scenarios.find((item) => item.id === "LSF-COMMERCE-001");
  assert.equal(matrix.requiredCapabilities.includes("commerce_lifecycle_contracts"), true);
  assert.ok(scenario, "commerce lifecycle scenario should exist");
  assert.equal(scenario.capability, "commerce_lifecycle_contracts");
  assert.equal(scenario.mode, "local-safe");
  assert.equal(scenario.handler, "commerce_contract_regression");
  assert.equal(scenario.mutatesExternal, false);
  assert.equal(scenario.sideEffectClass, "temp-files-only");
  assert.doesNotMatch(JSON.stringify(scenario), /send-text|verify-payment-proof|mark-sent|bridge-ack|\/api\/chat\/send/);
});

test("training and trusted-operator governance contracts are required local-safe acceptance", () => {
  const scenario = matrix.scenarios.find((item) => item.id === "LSF-TRAINING-GOVERNANCE-001");
  assert.equal(matrix.requiredCapabilities.includes("training_governance_contracts"), true);
  assert.ok(scenario, "training and governance scenario should exist");
  assert.equal(scenario.capability, "training_governance_contracts");
  assert.equal(scenario.mode, "local-safe");
  assert.equal(scenario.handler, "training_governance_regression");
  assert.equal(scenario.mutatesExternal, false);
  assert.equal(scenario.sideEffectClass, "temp-files-only");
  assert.doesNotMatch(JSON.stringify(scenario), /send-text|verify-payment-proof|mark-sent|bridge-ack|\/api\/chat\/send/);
});

test("training Agent and AI fallback journey is required local-safe acceptance", () => {
  const scenario = matrix.scenarios.find((item) => item.id === "LSF-TRAINING-AGENT-AI-001");
  assert.equal(matrix.requiredCapabilities.includes("training_agent_ai_journey"), true);
  assert.ok(scenario, "training Agent and AI fallback journey scenario should exist");
  assert.equal(scenario.capability, "training_agent_ai_journey");
  assert.equal(scenario.mode, "local-safe");
  assert.equal(scenario.handler, "training_agent_ai_journey");
  assert.equal(scenario.mutatesExternal, false);
  assert.equal(scenario.sideEffectClass, "local-ephemeral");
  assert.match(scenario.acceptance, /Imports a customer-bound chat transcript/);
  assert.match(scenario.acceptance, /AI provider failure falls back to the rule draft/);
  assert.doesNotMatch(JSON.stringify(scenario), /send-text|verify-payment-proof|mark-sent|bridge-ack|\/api\/chat\/send/);
});

test("bridge worker restores customer identity from the sanitized API preview", () => {
  const worker = fs.readFileSync(path.join(root, "tools", "wechat-bridge-worker.js"), "utf8");
  assert.match(worker, /customerId:\s*entry\.customerId \|\| entry\.preview\?\.customerId \|\| ""/);
});
