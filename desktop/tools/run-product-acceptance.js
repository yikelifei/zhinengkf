"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const {
  createWechatWindowObserverProofSession,
  wechatWindowObserverServiceEnv,
  withoutWechatWindowObserverProof,
} = require("./wechat-window-observer-session");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..");
const matrixPath = path.join(desktopRoot, "config", "product-acceptance-matrix.json");
const nextEnvFile = path.join(desktopRoot, "apps", "web", "next-env.d.ts");
const nextEnvProductionTypes =
  '/// <reference types="next" />\n' +
  '/// <reference types="next/image-types/global" />\n' +
  '/// <reference types="next/navigation-types/compat/navigation" />\n' +
  'import "./.next/types/routes.d.ts";\n' +
  "\n" +
  "// NOTE: This file should not be edited\n" +
  "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.\n";
const forbiddenMutationPatterns = [
  /\/api\/wechat-work\/kf\/send-text\/?$/,
  /\/api\/wechat\/send-tasks\/[^/]+\/mark-sent(?:-current-window)?\/?$/,
  /\/api\/wechat\/send-tasks\/[^/]+\/bridge-ack\/?$/,
  /\/api\/chat\/send\/?$/,
];
const localSafeWechatWorkFixtures = [
  {
    sourceAccountId: "wechat_demo_1",
    accountId: "wechat_work_acceptance_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    openKfid: "e2e-open-kfid-1",
    externalUserId: "e2e-external-user-1",
  },
  {
    sourceAccountId: "wechat_demo_2",
    accountId: "wechat_work_acceptance_2",
    conversationId: "conversation_demo_2",
    customerId: "customer_demo_2",
    openKfid: "e2e-open-kfid-2",
    externalUserId: "e2e-external-user-2",
  },
];

class BlockedError extends Error {
  constructor(message, blockers = [], evidence = {}) {
    super(message);
    this.name = "BlockedError";
    this.blockers = blockers;
    this.evidence = evidence;
  }
}

const handlers = {
  stack_startup: runStackStartup,
  identity_isolation: runIdentityIsolation,
  manual_safe_queue: runManualSafeQueue,
  inbound_local: runInboundLocal,
  wechat_work_callback: runWechatWorkCallback,
  design_task: runDesignTask,
  automation_cycle: runAutomationCycle,
  crm_regression: runCrmRegression,
  contract_regression: runContractRegression,
  commerce_lifecycle_journey: runCommerceLifecycleJourney,
  commerce_contract_regression: runCommerceContractRegression,
  training_governance_regression: runTrainingGovernanceRegression,
  training_agent_ai_journey: runTrainingAgentAiJourney,
  layout_390: runLayout390,
  external_design_readiness: runExternalDesignReadiness,
  external_wechat_work_readiness: runExternalWechatWorkReadiness,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const matrix = loadMatrix(matrixPath);
  validateMatrix(matrix);
  if (!Object.prototype.hasOwnProperty.call(matrix.modeDefinitions, options.mode)) {
    throw new Error(`unsupported acceptance mode: ${options.mode}`);
  }

  const runId = `e2e-${stamp()}-${process.pid}`;
  const outputDir = path.resolve(options.outputDir || path.join(desktopRoot, ".runtime", "acceptance", runId));
  const serviceRuntimeDir = path.join(outputDir, "service-runtime");
  fs.mkdirSync(serviceRuntimeDir, { recursive: true });

  const context = {
    matrix,
    options,
    runId,
    outputDir,
    serviceRuntimeDir,
    results: [],
    children: [],
    mutationLog: [],
    safetyViolations: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    stack: null,
    serviceEnv: null,
    primaryConversation: null,
    manualSendTask: null,
  };

  const selectedModes = selectModes(options.mode);
  console.log(`[acceptance] run=${runId} mode=${options.mode} selected=${[...selectedModes].join(",")}`);
  console.log("[acceptance] safety=loopback-only, real-send=forbidden, real-payment=forbidden, internal-payment-ledger=allowed");
  console.log(`[acceptance] output=${outputDir}`);

  try {
    for (const scenario of matrix.scenarios) {
      if (!selectedModes.has(scenario.mode)) {
        context.results.push(buildSkippedResult(scenario, options.mode));
        continue;
      }
      const result = await executeScenario(context, scenario);
      context.results.push(result);
      writeReports(context);
      console.log(`[${statusLabel(result.status)}] ${scenario.id} ${scenario.titleZh}`);
      if (result.errorMessage) console.log(`       ${singleLine(result.errorMessage)}`);
    }
  } finally {
    await stopServices(context);
    restoreNextEnvTypes();
    context.finishedAt = new Date().toISOString();
    writeReports(context);
  }

  const report = buildReport(context);
  console.log(
    `[acceptance] passed=${report.summary.passed} failed=${report.summary.failed} blocked=${report.summary.blocked} skipped=${report.summary.skipped}`,
  );
  console.log(`[acceptance] json=${report.artifacts.jsonReport}`);
  console.log(`[acceptance] markdown=${report.artifacts.markdownReport}`);

  if (report.summary.failed > 0) process.exitCode = 1;
  else if (options.strict && report.summary.blocked > 0) process.exitCode = 2;
}

function restoreNextEnvTypes() {
  if (!fs.existsSync(nextEnvFile)) return;
  const current = fs.readFileSync(nextEnvFile, "utf8");
  if (current === nextEnvProductionTypes) return;
  fs.writeFileSync(nextEnvFile, nextEnvProductionTypes, "utf8");
}

async function executeScenario(context, scenario) {
  const startedAt = Date.now();
  const base = {
    id: scenario.id,
    capability: scenario.capability,
    mode: scenario.mode,
    titleZh: scenario.titleZh,
    acceptance: scenario.acceptance,
    sideEffectClass: scenario.sideEffectClass,
    mutatesExternal: scenario.mutatesExternal,
    knownLimit: scenario.knownLimit || "",
    externalDependencies: scenario.externalDependencies || [],
    startedAt: new Date(startedAt).toISOString(),
  };
  const handler = handlers[scenario.handler];
  if (!handler) {
    return {
      ...base,
      status: "failed",
      durationMs: Date.now() - startedAt,
      evidence: {},
      blockers: [],
      errorMessage: `unknown acceptance handler: ${scenario.handler}`,
    };
  }

  try {
    const outcome = (await handler(context, scenario)) || {};
    return {
      ...base,
      status: outcome.status || "passed",
      durationMs: Date.now() - startedAt,
      evidence: outcome.evidence || {},
      blockers: outcome.blockers || [],
      errorMessage: outcome.errorMessage || "",
    };
  } catch (error) {
    if (error instanceof BlockedError) {
      return {
        ...base,
        status: "blocked",
        durationMs: Date.now() - startedAt,
        evidence: error.evidence || {},
        blockers: error.blockers || [error.message],
        errorMessage: error.message,
      };
    }
    return {
      ...base,
      status: "failed",
      durationMs: Date.now() - startedAt,
      evidence: error?.evidence || {},
      blockers: [],
      errorMessage: error instanceof Error ? error.stack || error.message : String(error),
    };
  }
}

async function runStackStartup(context) {
  const required = [
    path.join(desktopRoot, "node_modules", "next", "dist", "bin", "next"),
    path.join(desktopRoot, "node_modules", "typescript", "bin", "tsc"),
  ];
  const missing = required.filter((item) => !fs.existsSync(item));
  if (missing.length) {
    throw new BlockedError("desktop dependencies are missing; run npm.cmd ci first", missing);
  }

  const [webPort, apiPort, mockPort] = await distinctFreePorts(3);
  const apiBase = `http://127.0.0.1:${apiPort}/api`;
  const webUrl = `http://127.0.0.1:${webPort}/`;
  const mockBase = `http://127.0.0.1:${mockPort}`;
  const designConfigPath = path.join(context.serviceRuntimeDir, "design-platform-config.json");
  const aiSettingsPath = path.join(context.serviceRuntimeDir, "ai-settings.yaml");
  const localStoreFile = path.join(context.serviceRuntimeDir, "local-store.json");
  const wechatWorkKey = Buffer.from("0123456789abcdef0123456789abcdef", "utf8")
    .toString("base64")
    .replace(/=$/, "");
  const internalApiToken = crypto.randomBytes(32).toString("hex");
  const designPlatformCallbackApiKey = crypto.randomBytes(32).toString("hex");
  const desktopWebSessionProof = crypto.randomBytes(32).toString("hex");
  const observerProofSession = createWechatWindowObserverProofSession(context.serviceRuntimeDir);
  const serviceEnv = {
    ...withoutWechatWindowObserverProof(process.env),
    NEXT_TELEMETRY_DISABLED: "1",
    USE_LOCAL_STORE: "true",
    WEB_PORT: String(webPort),
    API_PORT: String(apiPort),
    MOCK_DESIGN_PLATFORM_PORT: String(mockPort),
    DESKTOP_RUNTIME_DIR: context.serviceRuntimeDir,
    LOCAL_STORE_FILE: localStoreFile,
    LOCAL_STORAGE_ROOT: path.join(context.serviceRuntimeDir, "storage"),
    DESIGN_PLATFORM_ADAPTER: "standard_v1",
    DESIGN_PLATFORM_BASE_URL: mockBase,
    DESIGN_PLATFORM_RUNTIME_CONFIG: designConfigPath,
    DESIGN_PLATFORM_CALLBACK_API_KEY: designPlatformCallbackApiKey,
    ACCEPTANCE_ALLOW_LOOPBACK_DESIGN_DOWNLOADS: "1",
    ALLOW_DEMO_DATA_MUTATIONS: "1",
    AI_ENGINE_SETTINGS_PATH: aiSettingsPath,
    LOCAL_ACCEPTANCE_AI_KEY: "loopback-acceptance-only",
    CUSTOMER_SERVICE_PUBLIC_BASE_URL: `http://127.0.0.1:${apiPort}`,
    INTERNAL_API_TOKEN: internalApiToken,
    DESKTOP_WEB_SESSION_PROOF: desktopWebSessionProof,
    WECHAT_SEND_ADAPTER: "dry_run",
    WECHAT_BRIDGE_OUTBOX_DIR: path.join(context.serviceRuntimeDir, "wechat-outbox"),
    WECHAT_BRIDGE_INBOX_DIR: path.join(context.serviceRuntimeDir, "wechat-inbox"),
    WECHAT_BRIDGE_DISPATCH_DIR: path.join(context.serviceRuntimeDir, "wechat-dispatch"),
    WECHAT_BRIDGE_LOCK_DIR: path.join(context.serviceRuntimeDir, "wechat-bridge-locks"),
    WECHAT_BRIDGE_WORKER_STATUS_FILE: path.join(context.serviceRuntimeDir, "wechat-bridge-worker-status.json"),
    PERSONAL_WECHAT_BRIDGE_STATUS_FILE: path.join(context.serviceRuntimeDir, "personal-wechat-bridge-status.json"),
    WECHAT_WINDOW_SNAPSHOT_INBOX_DIR: path.join(context.serviceRuntimeDir, "wechat-window-snapshots"),
    WECHAT_WINDOW_OBSERVER_STATUS_FILE: path.join(context.serviceRuntimeDir, "wechat-window-observer-status.json"),
    PERSONAL_WECHAT_SEND: "0",
    PERSONAL_WECHAT_AUTO_ENTER: "0",
    PERSONAL_WECHAT_BRIDGE_AUTO_ENTER: "0",
    PERSONAL_WECHAT_ALLOW_UNVERIFIED_WINDOW: "0",
    BRIDGE_MODE: "noop",
    LOW_VALUE_AUTOMATION_ENABLED: "true",
    LOW_VALUE_AUTOMATION_RUN_ON_START: "false",
    LOW_VALUE_AUTOMATION_INTERVAL_MS: "3600000",
    LOW_VALUE_AUTOMATION_MODE: "interval",
    LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE: "false",
    WECHAT_WORK_CORP_ID: "e2e-corp-id",
    WECHAT_WORK_AGENT_ID: "1000002",
    WECHAT_WORK_SECRET: "e2e-secret-not-real",
    WECHAT_WORK_TOKEN: "e2e-callback-token",
    WECHAT_WORK_ENCODING_AES_KEY: wechatWorkKey,
    WECHAT_WORK_OPEN_KFID: "e2e-open-kfid",
    WECHAT_WORK_API_BASE_URL: mockBase,
    WECHAT_WORK_DEFAULT_WECHAT_ACCOUNT_ID: localSafeWechatWorkFixtures[0].accountId,
    WECHAT_WORK_DEFAULT_CONVERSATION_ID: "conversation_demo_1",
    WECHAT_WORK_DEFAULT_CUSTOMER_ID: "customer_demo_1",
  };
  context.serviceEnv = serviceEnv;
  context.internalApiToken = internalApiToken;
  context.observerProofToken = observerProofSession.token;
  context.observerProofFile = observerProofSession.tokenFile;
  context.wechatWork = {
    token: serviceEnv.WECHAT_WORK_TOKEN,
    aesKey: serviceEnv.WECHAT_WORK_ENCODING_AES_KEY,
    receiveId: serviceEnv.WECHAT_WORK_CORP_ID,
  };

  fs.writeFileSync(
    aiSettingsPath,
    [
      "ai_engine:",
      "  enabled: true",
      "  primary: local_acceptance",
      "  fallback_chain: []",
      "  timeout_seconds: 5",
      "  max_retries: 0",
      "  providers:",
      "    local_acceptance:",
      "      enabled: true",
      "      api_key: ${LOCAL_ACCEPTANCE_AI_KEY}",
      `      base_url: ${mockBase}/v1`,
      "      model: local-acceptance-text",
      "      request_format: openai",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    designConfigPath,
    `${JSON.stringify({ designPlatformAdapter: "standard_v1", designPlatformBaseUrl: mockBase }, null, 2)}\n`,
    "utf8",
  );

  if (!context.options.noBuild) {
    const build = await runCmdLine("call npm.cmd run build:api", {
      cwd: desktopRoot,
      env: serviceEnv,
      timeoutMs: 180_000,
    });
    assertCommandPassed(build, "npm run build:api");
  }
  const apiEntry = path.join(desktopRoot, "dist", "apps", "api", "main.js");
  if (!fs.existsSync(apiEntry)) throw new Error(`API build entry missing: ${apiEntry}`);

  spawnService(context, "mock-design", [path.join(desktopRoot, "tools", "mock-design-platform.js")], serviceEnv);
  const apiServiceEnv = wechatWindowObserverServiceEnv(serviceEnv, "api", observerProofSession.tokenFile);
  spawnService(context, "api", [apiEntry], apiServiceEnv);
  spawnService(
    context,
    "web",
    [
      path.join(desktopRoot, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "apps/web",
      "-p",
      String(webPort),
      "--hostname",
      "127.0.0.1",
      "--webpack",
    ],
    serviceEnv,
  );

  await waitForHttp(`${mockBase}/v1/health`, 20_000);
  await waitForHttp(`${apiBase}/health`, 40_000);
  await waitForHttp(webUrl, 150_000);

  context.stack = { webPort, apiPort, mockPort, webUrl, apiBase, mockBase };
  const health = await requestJson(context, "/health");
  const mockHealth = await requestJson(context, `${mockBase}/v1/health`, { baseUrl: null });
  assert(health.ok === true, "API health did not report ok=true");
  assert(health.dataMode === "local-json", `unexpected API data mode: ${health.dataMode}`);
  assert(mockHealth.ok === true, "mock design health did not report ok=true");
  await requestJson(context, "/wechat/accounts");
  const identityFixtures = prepareLocalSafeWechatWorkFixtures(context, localStoreFile);
  const visibleAccounts = await requestJson(context, "/wechat/accounts");
  assert(visibleAccounts.length >= identityFixtures.length, "local-safe Enterprise WeChat fixtures are not visible");
  context.acceptanceIdentities = identityFixtures;

  return {
    evidence: {
      webUrl,
      apiHealthUrl: `${apiBase}/health`,
      mockHealthUrl: `${mockBase}/v1/health`,
      dataMode: health.dataMode,
      localStoreFile,
      identityFixtureAccountIds: identityFixtures.map((item) => item.accountId),
      logs: Object.fromEntries(context.children.map((item) => [item.name, item.logPath])),
    },
  };
}

async function runIdentityIsolation(context) {
  requireStack(context);
  const accounts = await requestJson(context, "/wechat/accounts");
  assert(Array.isArray(accounts) && accounts.length >= 2, "expected at least two WeChat accounts");
  const [firstFixture, secondFixture] = requireAcceptanceIdentities(context);
  const first = accounts.find((item) => item.id === firstFixture.accountId) || accounts[0];
  const second = accounts.find((item) => item.id === secondFixture.accountId) || accounts[1];
  const firstConversations = await requestJson(context, `/wechat/conversations?wechatAccountId=${encodeURIComponent(first.id)}`);
  const secondConversations = await requestJson(context, `/wechat/conversations?wechatAccountId=${encodeURIComponent(second.id)}`);
  assert(firstConversations.length > 0 && secondConversations.length > 0, "each account must have at least one conversation");
  assert(firstConversations.every((item) => item.wechatAccountId === first.id), "first account leaked another account conversation");
  assert(secondConversations.every((item) => item.wechatAccountId === second.id), "second account leaked another account conversation");
  const firstConversationIds = new Set(firstConversations.map((item) => item.id));
  const secondConversationIds = new Set(secondConversations.map((item) => item.id));
  assert([...firstConversationIds].every((id) => !secondConversationIds.has(id)), "conversation ids overlap between accounts");
  const firstCustomerIds = new Set(firstConversations.map((item) => item.customerId));
  assert(secondConversations.every((item) => !firstCustomerIds.has(item.customerId)), "customer ids overlap between accounts");

  const conversation = firstConversations[0];
  context.primaryConversation = conversation;
  const beforeTasks = await requestJson(context, "/wechat/send-tasks");
  const rejected = await requestJson(context, "/wechat/inbound/messages", {
    method: "POST",
    expectedStatuses: [400],
    body: {
      wechatAccountId: second.id,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      text: "E2E 错绑消息不应落库或排队",
      externalId: `${context.runId}-wrong-binding`,
    },
  });
  const afterTasks = await requestJson(context, "/wechat/send-tasks");
  assert(afterTasks.length === beforeTasks.length, "rejected cross-account inbound created a send task");

  return {
    evidence: {
      accountIds: [first.id, second.id],
      conversationCounts: { [first.id]: firstConversations.length, [second.id]: secondConversations.length },
      rejectedStatus: 400,
      rejectedMessage: rejected.message || rejected.error || "binding rejected",
      sendTaskCountUnchanged: beforeTasks.length,
    },
  };
}

async function runManualSafeQueue(context) {
  const conversation = await ensurePrimaryConversation(context);
  const expected = identityExpectation(conversation);
  const result = await requestJson(context, `/wechat/conversations/${encodeURIComponent(conversation.id)}/manual-replies`, {
    method: "POST",
    body: {
      text: "E2E 人工回复安全入队验证：只排队，不发送。",
      operationKey: `${context.runId}:manual-reply:safe-queue`,
      ...expected,
    },
  });
  assert(result.queued === true, "manual reply endpoint did not confirm queueing");
  const task = result.task;
  assert(task.status === "queued", `manual queue task status is ${task.status}`);
  assert(task.wechatAccountId === conversation.wechatAccountId, "queued task account mismatch");
  assert(task.conversationId === conversation.id, "queued task conversation mismatch");
  assert(task.customerId === conversation.customerId, "queued task customer mismatch");
  assert(task.payload?.source === "manual_reply", "queued task is not marked as a manual reply");
  const binding = task.guardSnapshot?.binding;
  assert(binding && binding.ok !== false && (!binding.failedKeys || binding.failedKeys.length === 0), "queued task binding was not verified");
  const attemptQuery = new URLSearchParams({
    sendTaskId: task.id,
    wechatAccountId: task.wechatAccountId,
    conversationId: task.conversationId,
    customerId: task.customerId,
  });
  const attempts = await requestJson(context, `/wechat/send-attempts?${attemptQuery}`);
  assert(Array.isArray(attempts) && attempts.length === 0, "safe enqueue unexpectedly created a send attempt");
  context.manualSendTask = task;
  return {
    evidence: {
      taskId: task.id,
      status: task.status,
      identity: {
        wechatAccountId: task.wechatAccountId,
        conversationId: task.conversationId,
        customerId: task.customerId,
      },
      bindingStatus: binding.status || "passed",
      sendAttemptCount: attempts.length,
      payloadSource: task.payload?.source || "",
      realSendInvoked: false,
    },
  };
}

async function runInboundLocal(context) {
  const conversation = await ensurePrimaryConversation(context);
  const result = await requestJson(context, "/wechat/inbound/messages", {
    method: "POST",
    body: {
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      text: "最低多少份起做，可以小批量吗？",
      externalId: `${context.runId}-inbound-safe`,
    },
  });
  assert(result.message?.direction === "inbound", "inbound message was not persisted");
  assert(result.message?.conversationId === conversation.id, "inbound message conversation mismatch");
  assert(result.route?.conversationId === conversation.id, "route conversation mismatch");
  assert(result.plan && typeof result.plan.type === "string", "inbound automation plan is missing");
  if (result.plan.shouldQueueReply) {
    assert(result.sendTask?.status === "queued", "inbound reply did not enter queued state");
    assert(result.sendTask?.conversationId === conversation.id, "inbound send task conversation mismatch");
  } else {
    assert(result.sendTask === null, "inbound plan disallowed queueing but returned a send task");
  }
  assert(result.sendTask?.status !== "sent", "inbound flow marked a message sent");
  return {
    evidence: {
      messageId: result.message.id,
      routeId: result.route.id,
      routeAction: result.route.action,
      planType: result.plan.type,
      shouldQueueReply: Boolean(result.plan.shouldQueueReply),
      sendTaskId: result.sendTask?.id || null,
      sendTaskStatus: result.sendTask?.status || null,
      realSendInvoked: false,
    },
  };
}

async function runWechatWorkCallback(context) {
  requireStack(context);
  const innerXml = [
    "<xml>",
    "<Event><![CDATA[kf_msg_or_event]]></Event>",
    "<Token><![CDATA[e2e-sync-token]]></Token>",
    "<OpenKfId><![CDATA[e2e-open-kfid]]></OpenKfId>",
    "</xml>",
  ].join("");
  const encrypted = encryptWechatWorkMessage(innerXml, context.wechatWork.aesKey, context.wechatWork.receiveId);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `e2e-${process.pid}`;
  const callbackBody = { Encrypt: encrypted };
  const beforeTasks = await requestJson(context, "/wechat/send-tasks");
  const invalid = await requestJson(
    context,
    `/wechat-work/callback?msg_signature=invalid&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}`,
    {
      method: "POST",
      body: callbackBody,
      expectedStatuses: [400],
    },
  );
  const afterInvalidTasks = await requestJson(context, "/wechat/send-tasks");
  assert(afterInvalidTasks.length === beforeTasks.length, "invalid callback signature created a send task");
  const signature = sha1Sorted([context.wechatWork.token, timestamp, nonce, encrypted]);
  const valid = await requestJson(
    context,
    `/wechat-work/callback?msg_signature=${signature}&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}`,
    {
      method: "POST",
      body: callbackBody,
    },
  );
  assert(
    valid.text === "success",
    `authentic wrapped enterprise WeChat callback was not acknowledged: ${JSON.stringify(valid)}`,
  );
  const afterValidTasks = await requestJson(context, "/wechat/send-tasks");
  assert(afterValidTasks.length === beforeTasks.length, "callback acknowledgement created an outbound task");
  const audit = await requestJson(context, "/wechat-work/kf/audit?limit=20");
  const accepted = (audit.records || []).find(
    (record) => record.action === "callback_accepted" && record.status === "processed" && record.openKfid === "e2e-open-kfid",
  );
  assert(accepted, "valid callback acknowledgement was not recorded in the Enterprise WeChat audit log");

  return {
    evidence: {
      invalidSignatureStatus: 400,
      invalidSignatureMessage: invalid.message || "signature mismatch",
      invalidMutationCount: afterInvalidTasks.length - beforeTasks.length,
      acknowledgement: valid.text,
      acceptedAuditId: accepted.id,
      validMutationCount: afterValidTasks.length - beforeTasks.length,
      externalWechatApiCalled: false,
    },
  };
}

async function runDesignTask(context) {
  const conversation = await ensurePrimaryConversation(context);
  const payload = {
    operationKey: `${context.runId}:design-job:create`,
    wechatAccountId: conversation.wechatAccountId,
    customerId: conversation.customerId,
    conversationId: conversation.id,
    budget: { mode: "per_box", amount: 180, perUnitAmount: 180, quantity: 20, totalAmount: 3600 },
    scene: "端午员工福利礼盒",
    bundle: {
      items: [
        { skuCode: "BOX-A", name: "红金礼盒A", salePrice: 60, costPrice: 30, quantity: 1 },
        { skuCode: "TEA-A", name: "茶叶礼品A", salePrice: 110, costPrice: 65, quantity: 1 },
      ],
    },
    assets: [],
    assetIds: [],
    customerText: "需要端午员工福利礼盒效果图",
    outputCount: 4,
  };
  const job = await requestJson(context, "/design-jobs", { method: "POST", body: payload });
  assert(job.id && job.conversationId === conversation.id, "design job was not bound to the conversation");
  assert(job.customerId === conversation.customerId, "design job customer mismatch");
  assert(job.wechatAccountId === conversation.wechatAccountId, "design job account mismatch");
  assert(["draft", "manual_review"].includes(job.status), `unexpected design job status: ${job.status}`);
  const listed = await requestJson(
    context,
    `/design-jobs?wechatAccountId=${encodeURIComponent(conversation.wechatAccountId)}&conversationId=${encodeURIComponent(conversation.id)}&customerId=${encodeURIComponent(conversation.customerId)}`,
  );
  assert(listed.some((item) => item.id === job.id), "design job was not returned by scoped list");
  const rejected = await requestJson(context, "/design-jobs", {
    method: "POST",
    expectedStatuses: [400],
    body: {
      ...payload,
      operationKey: `${context.runId}:design-job:cross-identity`,
      wechatAccountId: requireAcceptanceIdentities(context)[1].accountId,
    },
  });
  const mockHealth = await requestJson(context, `${context.stack.mockBase}/v1/health`, { baseUrl: null });
  assert(mockHealth.ok === true, "mock design platform is not healthy");
  return {
    evidence: {
      designJobId: job.id,
      status: job.status,
      readiness: job.readiness || null,
      scopedListCount: listed.length,
      crossIdentityRejected: true,
      crossIdentityMessage: rejected.message || "identity rejected",
      mockDesignHealth: mockHealth,
      formalExternalGenerationSubmitted: false,
    },
  };
}

async function runCommerceLifecycleJourney(context) {
  const conversation = await ensurePrimaryConversation(context);
  const expected = identityExpectation(conversation);
  const identityQuery = buildIdentityQuery(conversation);
  const customerLogo = await requestJson(context, "/assets/demo-customer-logo", {
    method: "POST",
    body: {
      customerId: conversation.customerId,
      ...expected,
    },
  });
  assert(customerLogo.id, "demo customer logo asset was not created");

  const payload = {
    operationKey: `${context.runId}:commerce:design-job:create`,
    wechatAccountId: conversation.wechatAccountId,
    customerId: conversation.customerId,
    conversationId: conversation.id,
    budget: { mode: "per_box", amount: 160, perUnitAmount: 160, quantity: 20, totalAmount: 3200 },
    scene: "local-safe gift-box lifecycle",
    bundle: buildCommerceAcceptanceBundle(),
    assetIds: [customerLogo.id],
    customerText: "local-safe acceptance: generate gift-box candidate images for a confirmed commerce lifecycle.",
    outputCount: 4,
  };
  const job = await requestJson(context, "/design-jobs", { method: "POST", body: payload });
  assert(job.id && job.conversationId === conversation.id, "commerce design job was not bound to the conversation");
  assert(job.customerId === conversation.customerId, "commerce design job customer mismatch");

  const preflight = await requestJson(context, `/design-jobs/${encodeURIComponent(job.id)}/preflight`, {
    method: "POST",
    body: expected,
  });
  assert(preflight.ok === true, `commerce design preflight was not ready: ${JSON.stringify(preflight.missing || preflight.checks || [])}`);

  const submitted = await requestJson(context, `/design-jobs/${encodeURIComponent(job.id)}/submit`, {
    method: "POST",
    body: {
      operationKey: `${context.runId}:commerce:design-job:submit`,
      ...expected,
    },
    timeoutMs: 30_000,
  });
  const completedJob = await waitForDesignJobImages(context, unwrapDesignJob(submitted), expected);
  const images = [...(completedJob.images || [])].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const firstImage = images[0];
  assert(firstImage?.id || firstImage?.imageId, "commerce design job did not return a selectable candidate image");

  const selection = await requestJson(context, `/design-jobs/${encodeURIComponent(job.id)}/select-image`, {
    method: "POST",
    body: {
      text: "choose image 1",
      referencedImageId: firstImage.id || firstImage.imageId,
      ...expected,
    },
  });
  assert(selection.matched === true, `candidate image selection was not matched: ${JSON.stringify(selection)}`);
  const quote =
    selection.quote ||
    (await requestJson(context, `/design-jobs/${encodeURIComponent(job.id)}/quote`, {
      method: "POST",
      body: expected,
    }));
  assert(quote.id, "commerce quote draft was not created");
  assert(quote.designJobId === job.id, "commerce quote was not bound to the design job");
  assert(quote.selectedImageId, "commerce quote has no selected image");

  const payment = await requestJson(context, `/quotes/${encodeURIComponent(quote.id)}/verify-payment-proof`, {
    method: "POST",
    body: {
      operationKey: `${context.runId}:commerce:quote:payment-proof`,
      paymentStatus: "paid",
      amountCny: quote.totalPrice || 3200,
      method: "internal_acceptance_ledger",
      proofReference: `local-safe-${context.runId}`,
      note: "local-safe acceptance records an internal payment proof ledger only.",
      ...expected,
    },
  });
  assert(payment.paymentEvent?.id, "internal payment proof ledger event was not recorded");
  assert(payment.orderDraft?.id, "payment proof did not create or confirm an order draft");
  assert(payment.orderDraft.status === "confirmed", `order was not confirmed after payment proof: ${payment.orderDraft.status}`);
  assert(payment.orderDraft.paymentStatus === "paid", `order payment status is not paid: ${payment.orderDraft.paymentStatus}`);
  assert(payment.sendTask?.status === "queued", "order confirmation did not remain in the safe send queue");

  const orderId = payment.orderDraft.id;
  const processing = await requestJson(context, `/orders/${encodeURIComponent(orderId)}/fulfillment`, {
    method: "POST",
    body: {
      operationKey: `${context.runId}:commerce:order:fulfillment:processing`,
      status: "processing",
      productionStatus: "in_production",
      productionDueAt: "2026-08-06 18:00",
      customerNotes: "local-safe acceptance: production started.",
      ...expected,
    },
  });
  assert(processing.status === "processing", `order did not enter processing: ${processing.status}`);
  assert(processing.productionStatus === "in_production", `order production did not start: ${processing.productionStatus}`);

  const qualityChecked = await requestJson(context, `/orders/${encodeURIComponent(orderId)}/fulfillment`, {
    method: "POST",
    body: {
      operationKey: `${context.runId}:commerce:order:fulfillment:quality-check`,
      productionStatus: "quality_check",
      productionDueAt: "2026-08-06 18:00",
      customerNotes: "local-safe acceptance: production moved to quality check.",
      ...expected,
    },
  });
  assert(qualityChecked.productionStatus === "quality_check", `order did not enter quality check: ${qualityChecked.productionStatus}`);

  const readyToShip = await requestJson(context, `/orders/${encodeURIComponent(orderId)}/fulfillment`, {
    method: "POST",
    body: {
      operationKey: `${context.runId}:commerce:order:fulfillment:ready-to-ship`,
      productionStatus: "ready_to_ship",
      productionDueAt: "2026-08-06 18:00",
      customerNotes: "local-safe acceptance: order passed quality check and is ready to ship.",
      ...expected,
    },
  });
  assert(readyToShip.productionStatus === "ready_to_ship", `order was not ready to ship: ${readyToShip.productionStatus}`);

  const productionFollowup = await requestJson(context, `/wechat/orders/${encodeURIComponent(orderId)}/queue-followup`, {
    method: "POST",
    body: {
      operationKey: `${context.runId}:commerce:order:production-followup`,
      type: "production",
      reason: "acceptance-production-followup",
      ...expected,
    },
  });
  assert(productionFollowup.sendTask?.status === "queued", "production follow-up did not remain queued");

  const shipped = await requestJson(context, `/orders/${encodeURIComponent(orderId)}/fulfillment`, {
    method: "POST",
    body: {
      operationKey: `${context.runId}:commerce:order:fulfillment:shipped`,
      productionStatus: "shipped",
      carrier: "SF Express",
      trackingNo: `SF${context.runId.replace(/\D/g, "").slice(-12).padStart(12, "0")}`,
      shippedAt: "2026-08-07 15:00",
      customerNotes: "local-safe acceptance: shipment facts recorded.",
      ...expected,
    },
  });
  assert(shipped.productionStatus === "shipped", `order was not marked shipped: ${shipped.productionStatus}`);

  const fulfilled = await requestJson(context, `/orders/${encodeURIComponent(orderId)}/fulfillment`, {
    method: "POST",
    body: {
      operationKey: `${context.runId}:commerce:order:fulfillment:delivered`,
      status: "fulfilled",
      productionStatus: "delivered",
      carrier: shipped.carrier,
      trackingNo: shipped.trackingNo,
      shippedAt: shipped.shippedAt,
      deliveredAt: "2026-08-08 10:00",
      customerNotes: "local-safe acceptance: customer delivery confirmed.",
      ...expected,
    },
  });
  assert(fulfilled.status === "fulfilled", `order final status is not fulfilled: ${fulfilled.status}`);
  assert(fulfilled.productionStatus === "delivered", `order production final status is not delivered: ${fulfilled.productionStatus}`);

  const deliveryFollowup = await requestJson(context, `/wechat/orders/${encodeURIComponent(orderId)}/queue-followup`, {
    method: "POST",
    body: {
      operationKey: `${context.runId}:commerce:order:delivery-followup`,
      type: "delivery",
      reason: "acceptance-delivery-followup",
      ...expected,
    },
  });
  assert(deliveryFollowup.sendTask?.status === "queued", "delivery follow-up did not remain queued");

  const sendTaskIds = [
    payment.sendTask?.id,
    productionFollowup.sendTask?.id,
    deliveryFollowup.sendTask?.id,
  ].filter(Boolean);
  const tasks = await requestJson(context, `/wechat/send-tasks?${identityQuery}`);
  const journeyTasks = tasks.filter((task) => sendTaskIds.includes(task.id));
  assert(journeyTasks.length === sendTaskIds.length, "not every commerce send task was visible in the safe queue");
  assert(journeyTasks.every((task) => task.status !== "sent"), "commerce journey marked a send task sent");
  const attemptCounts = {};
  for (const taskId of sendTaskIds) {
    const attempts = await requestJson(context, `/wechat/send-attempts?sendTaskId=${encodeURIComponent(taskId)}&${identityQuery}`);
    attemptCounts[taskId] = attempts.length;
    assert(attempts.length === 0, `commerce send task ${taskId} created a send attempt`);
  }

  return {
    evidence: {
      customerLogoAssetId: customerLogo.id,
      designJobId: job.id,
      externalJobId: completedJob.externalJobId || null,
      imageCandidateCount: images.length,
      selectedImageId: quote.selectedImageId,
      quoteDraftId: quote.id,
      quoteTotalPrice: quote.totalPrice,
      paymentEventId: payment.paymentEvent.id,
      orderDraftId: orderId,
      finalOrderStatus: fulfilled.status,
      finalProductionStatus: fulfilled.productionStatus,
      confirmationSendTaskId: payment.sendTask?.id || null,
      productionFollowupSendTaskId: productionFollowup.sendTask?.id || null,
      deliveryFollowupSendTaskId: deliveryFollowup.sendTask?.id || null,
      queuedSendTaskStatuses: Object.fromEntries(journeyTasks.map((task) => [task.id, task.status])),
      sendAttemptCounts: attemptCounts,
      realPaymentGatewayCalled: false,
      realSendInvoked: false,
      externalMutationCount: context.mutationLog.filter((item) => item.external).length,
    },
  };
}

async function runAutomationCycle(context) {
  requireStack(context);
  const statusBefore = await requestJson(context, "/automation/status");
  const readiness = await requestJson(context, "/automation/readiness");
  const conversation = await ensurePrimaryConversation(context);
  const run = await requestJson(context, "/automation/run-once", {
    method: "POST",
    body: {
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
    },
  });
  const statusAfter = await requestJson(context, "/automation/status");
  assert(run.trigger === "manual", `automation trigger is ${run.trigger}`);
  assert(Array.isArray(run.steps), "automation run steps are missing");
  assert(Array.isArray(run.errors), "automation run errors are missing");
  assert(run.identityAudit && typeof run.identityAudit === "object", "automation identity audit is missing");
  assert(statusAfter.lastRun?.startedAt === run.startedAt, "automation run was not persisted to status");
  assert(statusBefore.processSendQueue === false && statusAfter.processSendQueue === false, "automation send queue processing was not disabled");
  const sentTasks = (await requestJson(context, "/wechat/send-tasks")).filter((task) => task.status === "sent");
  assert(sentTasks.length === 0, "automation cycle marked a task sent");
  return {
    evidence: {
      enabled: statusBefore.enabled,
      active: statusBefore.active,
      processSendQueue: statusBefore.processSendQueue,
      readinessReady: readiness.ready,
      readinessBlockers: readiness.blockers || [],
      runSkipped: Boolean(run.skipped),
      runReason: run.reason || "",
      stepStatuses: run.steps.map((item) => ({ step: item.step, status: item.status })),
      errorCount: run.errors.length,
      sentTaskCount: sentTasks.length,
    },
  };
}

async function runCrmRegression(context) {
  const command = "call tools\\_run_python_task.bat scripts\\run_unit_tests.py tests\\test_crm_database.py";
  const result = await runCmdLine(command, {
    cwd: repoRoot,
    env: { ...process.env, SMART_KEFU_NO_PAUSE: "1", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    timeoutMs: 120_000,
  });
  assertCommandPassed(result, "CRM database regression");
  const match = result.stdout.match(/Unit tests:\s+(\d+) passed,\s+(\d+) failed/);
  assert(match && Number(match[2]) === 0, "CRM test summary is missing or failed");
  return {
    evidence: {
      command,
      passed: Number(match[1]),
      failed: Number(match[2]),
      outputTail: tail(result.stdout, 12),
    },
  };
}

async function runContractRegression(context) {
  const files = [
    "tests/enterprise-wechat-only-api-surface.test.js",
    "tests/identity-binding.test.js",
    "tests/inbound-workflow.test.js",
    "tests/wechat-inbound-auth.test.js",
    "tests/wechat-work-api.test.js",
    "tests/wechat-work-production-readiness.test.js",
    "tests/automation-service-status.test.js",
    "tests/mock-design-platform.test.js",
    "tests/product-acceptance-matrix.test.js",
  ];
  const result = await runCommand(process.execPath, ["--test", ...files], {
    cwd: desktopRoot,
    env: acceptanceLoopbackEnv(context, {
      PERSONAL_WECHAT_SEND: "0",
      PERSONAL_WECHAT_AUTO_ENTER: "0",
    }),
    timeoutMs: 180_000,
  });
  assertCommandPassed(result, "selected Node contract regression");
  return {
    evidence: {
      command: `node --test ${files.join(" ")}`,
      files,
      outputTail: tail(result.stdout, 20),
    },
  };
}

async function runCommerceContractRegression(context) {
  const files = [
    "tests/design-job-create-ui.test.js",
    "tests/design-quote-ui.test.js",
    "tests/payment-routing-boundaries.test.js",
    "tests/sales-order-fulfillment-ui.test.js",
    "tests/sales-record-single-read.test.js",
    "tests/order-followup-message.test.js",
    "tests/commerce-page-responsibilities.test.js",
  ];
  const result = await runCommand(process.execPath, ["--test", ...files], {
    cwd: desktopRoot,
    env: acceptanceLoopbackEnv(context, {
      PERSONAL_WECHAT_SEND: "0",
      PERSONAL_WECHAT_AUTO_ENTER: "0",
      PERSONAL_WECHAT_BRIDGE_AUTO_ENTER: "0",
      LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE: "false",
    }),
    timeoutMs: 180_000,
  });
  assertCommandPassed(result, "commerce lifecycle contract regression");
  return {
    evidence: {
      command: `node --test ${files.join(" ")}`,
      files,
      coveredFlows: [
        "design_job_create",
        "design_quote_create",
        "quote_payment_boundary",
        "order_fulfillment_fields",
        "sales_single_record_reads",
        "order_followup_messages",
        "commerce_page_responsibilities",
      ],
      paymentMutationAttempted: false,
      realSendInvoked: false,
      outputTail: tail(result.stdout, 20),
    },
  };
}

async function runTrainingGovernanceRegression(context) {
  const files = [
    "tests/chat-training.test.js",
    "tests/local-store-training-samples.test.js",
    "tests/training-service.test.js",
    "tests/training-overview-ui.test.js",
    "tests/operator-access.test.js",
    "tests/operator-access-ui.test.js",
    "tests/trusted-operator-ui.test.js",
  ];
  const result = await runCommand(process.execPath, ["--test", ...files], {
    cwd: desktopRoot,
    env: acceptanceLoopbackEnv(context, {
      PERSONAL_WECHAT_SEND: "0",
      PERSONAL_WECHAT_AUTO_ENTER: "0",
      PERSONAL_WECHAT_BRIDGE_AUTO_ENTER: "0",
      LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE: "false",
    }),
    timeoutMs: 180_000,
  });
  assertCommandPassed(result, "training and trusted-operator regression");
  return {
    evidence: {
      command: `node --test ${files.join(" ")}`,
      files,
      coveredFlows: [
        "chat_training_import",
        "training_sample_identity_scope",
        "agent_skill_suggestions",
        "training_overview",
        "trusted_operator_policy",
        "high_risk_route_guard",
      ],
      paymentMutationAttempted: false,
      realSendInvoked: false,
      outputTail: tail(result.stdout, 20),
    },
  };
}

async function runTrainingAgentAiJourney(context) {
  requireStack(context);
  const conversation = await ensurePrimaryConversation(context);
  const directIdentity = {
    wechatAccountId: conversation.wechatAccountId,
    conversationId: conversation.id,
    customerId: conversation.customerId,
  };
  const expected = identityExpectation(conversation);
  const identityQuery = buildIdentityQuery(conversation);
  const agents = await requestJson(context, `/agents?${identityQuery}`);
  const agent = agents.find((item) => item.key === "logistics_exception");
  assert(agent?.id, "logistics exception Agent was not available");

  const customerQuestion = `acceptance logistics stuck tracking ${context.runId}`;
  const idealReply = [
    "I will check the current tracking status first, contact the carrier if the parcel is stalled,",
    "and update the customer before promising refund or reshipment.",
  ].join(" ");
  const chatImport = await requestJson(context, "/training/chat-imports", {
    method: "POST",
    body: {
      operationKey: `${context.runId}:training-agent-ai:chat-import`,
      name: "local-safe training to agent acceptance",
      channel: "wechat",
      agentId: agent.id,
      text: [`客户：${customerQuestion}?`, `客服：${idealReply}`].join("\n"),
      ...directIdentity,
    },
  });
  assert(chatImport.id, "chat import was not created");
  assert(Array.isArray(chatImport.samples) && chatImport.samples.length > 0, "chat import did not create training samples");
  const importedSample = chatImport.samples[0];

  const review = await requestJson(context, `/training/samples/${encodeURIComponent(importedSample.id)}/review`, {
    method: "POST",
    body: {
      status: "ready",
      agentId: agent.id,
      agentKey: "logistics_exception",
      scene: "logistics_exception",
      customerText: customerQuestion,
      idealReply,
      score: 92,
      skillHints: ["logistics tracking", "carrier follow-up"],
      note: "local-safe acceptance confirmed the imported sample for scoped Agent training.",
      ...expected,
    },
  });
  assert(review.sample?.id === importedSample.id, "training sample review returned the wrong sample");
  assert(review.sample?.status === "ready", "training sample was not marked ready");
  assert(review.sample?.quality?.level === "safe", `training sample quality is not safe: ${review.sample?.quality?.level}`);
  assert(review.sample?.quality?.usage?.routeMemory === true, "training sample was not accepted as route memory");
  assert(review.sample?.quality?.usage?.replySkill === true, "training sample was not accepted as reply skill");

  const routeAndReplySamples = await requestJson(
    context,
    `/training/samples?agentId=${encodeURIComponent(agent.id)}&quality=route_and_reply&${identityQuery}`,
  );
  assert(routeAndReplySamples.some((sample) => sample.id === importedSample.id), "reviewed sample was not visible as route_and_reply training");

  const suggestions = await requestJson(
    context,
    `/training/skill-suggestions?agentId=${encodeURIComponent(agent.id)}&minScore=60&${identityQuery}`,
  );
  const selectedSuggestions = suggestions.filter((suggestion) => (suggestion.sampleIds || []).includes(importedSample.id));
  assert(selectedSuggestions.length > 0, "reviewed sample did not produce scoped Agent skill suggestions");
  assert(selectedSuggestions.every((suggestion) => suggestion.scope?.level === "conversation"), "skill suggestions were not scoped to the conversation");

  const applied = await requestJson(context, "/training/skill-suggestions/apply", {
    method: "POST",
    body: {
      agentId: agent.id,
      minScore: 60,
      suggestionKeys: selectedSuggestions.map((suggestion) => suggestion.suggestionKey),
      includeNeedsReview: true,
      ...directIdentity,
    },
  });
  assert(Number(applied.selected || 0) === selectedSuggestions.length, "not every scoped suggestion was selected");
  assert(Number(applied.applied || 0) === selectedSuggestions.length, "not every scoped suggestion was applied after trusted review");
  assert(Array.isArray(applied.blocked) && applied.blocked.length === 0, "scoped suggestions were unexpectedly blocked");

  const skills = await requestJson(context, `/agents/${encodeURIComponent(agent.id)}/skills?${identityQuery}`);
  const scopedSkillNames = new Set(selectedSuggestions.map((suggestion) => suggestion.name));
  const scopedSkills = skills.filter((skill) => scopedSkillNames.has(skill.name));
  assert(scopedSkills.length > 0, "applied scoped Agent skills were not visible to the same identity");
  assert(scopedSkills.every((skill) => skill.scope?.level === "conversation"), "applied Agent skills were not conversation-scoped");

  const secondaryAccountId = requireAcceptanceIdentities(context)[1].accountId;
  const otherConversations = await requestJson(
    context,
    `/wechat/conversations?wechatAccountId=${encodeURIComponent(secondaryAccountId)}`,
  );
  const otherConversation = otherConversations[0];
  assert(otherConversation?.id && otherConversation.customerId, "second demo conversation was not available for identity isolation proof");
  const otherQuery = buildIdentityQuery({
    wechatAccountId: secondaryAccountId,
    id: otherConversation.id,
    customerId: otherConversation.customerId,
  });
  const crossIdentitySkills = await requestJson(context, `/agents/${encodeURIComponent(agent.id)}/skills?${otherQuery}`);
  assert(
    crossIdentitySkills.every((skill) => !scopedSkillNames.has(skill.name)),
    "conversation-scoped Agent skill leaked into another identity",
  );

  const inbound = await requestJson(context, "/wechat/inbound/messages", {
    method: "POST",
    body: {
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      text: customerQuestion,
      externalId: `${context.runId}-training-agent-ai-inbound`,
    },
  });
  assert(inbound.message?.direction === "inbound", "training Agent inbound message was not persisted");
  assert(inbound.route?.agentKey === "logistics_exception", `training Agent route used ${inbound.route?.agentKey}`);
  assert(inbound.route?.sceneMemory?.applied === true, "reviewed training sample was not used as route memory");
  assert((inbound.route?.appliedSkills || []).some((skill) => scopedSkillNames.has(skill.name)), "inbound reply did not apply the scoped Agent skill");
  assert((inbound.route?.knowledgeMatches || []).length > 0, "inbound reply did not match reviewed knowledge");
  assert(inbound.route?.replyDraft?.source === "ai_assisted", `reply draft did not use the local-safe AI layer: ${inbound.route?.replyDraft?.source}`);
  assert(inbound.route?.replyDraft?.aiAssistance?.used === true, "local-safe journey did not use the loopback AI provider");
  assert(inbound.route?.replyDraft?.aiAssistance?.provider === "local_acceptance", "training journey used an unexpected AI provider");
  if (inbound.plan?.shouldQueueReply) {
    assert(inbound.sendTask?.status === "queued", "training Agent reply did not remain queued");
    const attempts = await requestJson(context, `/wechat/send-attempts?sendTaskId=${encodeURIComponent(inbound.sendTask.id)}&${identityQuery}`);
    assert(attempts.length === 0, "training Agent queued reply created a real send attempt");
  } else {
    assert(inbound.sendTask === null, "non-queued training Agent plan returned a send task");
  }

  const contractFiles = [
    "tests/agent-router.test.js",
    "tests/agent-reply-draft.test.js",
    "tests/agent-reply-draft-identity.test.js",
    "tests/agents-skill-identity.test.js",
    "tests/wechat-ai-suggestion.test.js",
    "tests/ai-provider-router.test.js",
    "tests/ai-provider-config.test.js",
  ];
  const contractResult = await runCommand(process.execPath, ["--test", ...contractFiles], {
    cwd: desktopRoot,
    env: acceptanceLoopbackEnv(context, {
      PERSONAL_WECHAT_SEND: "0",
      PERSONAL_WECHAT_AUTO_ENTER: "0",
      PERSONAL_WECHAT_BRIDGE_AUTO_ENTER: "0",
      LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE: "false",
    }),
    timeoutMs: 180_000,
  });
  assertCommandPassed(contractResult, "training Agent and AI fallback contract regression");

  return {
    evidence: {
      chatImportId: chatImport.id,
      reviewedSampleId: importedSample.id,
      agentId: agent.id,
      suggestionCount: selectedSuggestions.length,
      appliedSkillCount: scopedSkills.length,
      crossIdentitySkillCount: crossIdentitySkills.length,
      inboundMessageId: inbound.message?.id || null,
      routeId: inbound.route?.id || null,
      routeAction: inbound.route?.action || "",
      sceneMemoryApplied: inbound.route?.sceneMemory?.applied === true,
      appliedSkillNames: inbound.route?.appliedSkills?.map((skill) => skill.name) || [],
      knowledgeMatchCount: inbound.route?.knowledgeMatches?.length || 0,
      aiAssistanceUsed: inbound.route?.replyDraft?.aiAssistance?.used === true,
      aiFailureFallbackCovered: true,
      sendTaskId: inbound.sendTask?.id || null,
      sendTaskStatus: inbound.sendTask?.status || null,
      realSendInvoked: false,
      externalMutationCount: context.mutationLog.filter((item) => item.external).length,
      contractCommand: `node --test ${contractFiles.join(" ")}`,
      contractOutputTail: tail(contractResult.stdout, 20),
    },
  };
}

async function runLayout390(context) {
  requireStack(context);
  if (context.options.skipLayout) throw new BlockedError("responsive renderer was skipped by --skip-layout", ["layout renderer disabled"]);
  const outputDir = path.join(context.outputDir, "responsive-layout");
  const outputPath = path.join(outputDir, "responsive-layout-report.json");
  const markdownPath = path.join(outputDir, "responsive-layout-report.zh-CN.md");
  const edgeProbePath = path.join(outputDir, "edge-probe.json");
  const screenshotDir = path.join(outputDir, "screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });

  const result = await runEdgeLayoutProbe({
    cwd: desktopRoot,
    env: {
      ...context.serviceEnv,
      RESPONSIVE_QA_WEB_URL: context.stack.webUrl,
      RESPONSIVE_QA_PROBE_OUTPUT: edgeProbePath,
      RESPONSIVE_QA_SCREENSHOT_DIR: screenshotDir,
    },
    outputPath: edgeProbePath,
    timeoutMs: 180_000,
  });
  if (!fs.existsSync(edgeProbePath)) assertCommandPassed(result, "responsive Edge CDP layout probe");
  const parsed = readJsonFile(edgeProbePath);
  const status = parsed.status === "passed" ? "passed" : parsed.status === "failed" ? "failed" : "blocked";
  const layout = {
    schemaVersion: 1,
    startedAt: parsed.startedAt || new Date().toISOString(),
    finishedAt: parsed.finishedAt || new Date().toISOString(),
    status,
    passed: status === "passed",
    url: context.stack.webUrl,
    renderer: parsed.renderer || "Microsoft Edge CDP",
    title: parsed.title || "",
    requestedViewports: [
      { name: "desktop-1536", width: 1536, height: 960 },
      { name: "mobile-390", width: 390, height: 844 },
    ],
    viewports: Array.isArray(parsed.viewports) ? parsed.viewports : [],
    blockers: buildResponsiveLayoutBlockers(status, parsed, result, "Edge CDP renderer"),
    failures: Array.isArray(parsed.failures) ? parsed.failures : [],
    consoleErrors: Array.isArray(parsed.consoleErrors) ? parsed.consoleErrors : [],
    process: {
      edge: commandEvidence(result),
    },
    artifacts: {
      jsonReport: outputPath,
      markdownReport: markdownPath,
      probeReport: edgeProbePath,
      edgeProbeReport: edgeProbePath,
      screenshotDir,
    },
    stage: parsed.stage || "",
    diagnostics: parsed.diagnostics || null,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(layout, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderResponsiveLayoutMarkdown(layout), "utf8");
  assert(fs.existsSync(outputPath), "responsive layout JSON was not written");
  if (layout.status === "blocked") {
    throw new BlockedError("responsive layout QA is blocked", layout.blockers || ["renderer unavailable"], {
      reportPath: outputPath,
      process: layout.process || null,
    });
  }
  assert(layout.status === "passed", `responsive layout failed: ${(layout.failures || []).join("; ")}`);
  assert(Array.isArray(layout.viewports) && layout.viewports.length === 2, "responsive layout must include 1536px and 390px evidence");
  assertResponsiveScreenshotEvidence(layout.viewports, screenshotDir);
  return {
    evidence: {
      renderer: layout.renderer || "Chromium renderer",
      url: layout.url,
      viewports: layout.viewports.map((item) => ({
        name: item.name,
        viewport: item.viewport,
        checks: item.checks,
        interaction: item.interaction,
        screenshotPath: item.screenshotPath,
      })),
      consoleErrors: layout.consoleErrors || [],
      reportPath: outputPath,
      markdownPath: layout.artifacts?.markdownReport || "",
    },
  };
}

function assertResponsiveScreenshotEvidence(viewports, screenshotDir) {
  const screenshotRoot = `${path.resolve(screenshotDir)}${path.sep}`;
  for (const expectedName of ["desktop-1536", "mobile-390"]) {
    const viewport = viewports.find((item) => item?.name === expectedName);
    assert(viewport, `responsive layout is missing ${expectedName} evidence`);
    const screenshotPath = path.resolve(String(viewport.screenshotPath || ""));
    assert(screenshotPath.startsWith(screenshotRoot), `${expectedName} screenshot escaped the acceptance artifact directory`);
    const stat = fs.statSync(screenshotPath, { throwIfNoEntry: false });
    assert(stat?.isFile() && stat.size > 0, `${expectedName} screenshot artifact is missing or empty`);
  }
}

async function runEdgeLayoutProbe(options) {
  const maxAttempts = 3;
  const attempts = [];
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.rmSync(options.outputPath, { force: true });
    } catch {
      // Best-effort cleanup; the next probe write still determines the final state.
    }
    const result = await runCommand(process.execPath, [
      path.join(desktopRoot, "tools", "product-acceptance-layout-edge-probe.js"),
    ], {
      cwd: options.cwd,
      env: {
        ...options.env,
        RESPONSIVE_QA_EDGE_ATTEMPT: String(attempt),
      },
      timeoutMs: options.timeoutMs,
    });
    const summary = readResponsiveLayoutProbeSummary(options.outputPath);
    attempts.push({
      attempt,
      code: result.code,
      signal: result.signal,
      timedOut: Boolean(result.timedOut),
      probeStatus: summary.status,
      viewportCount: summary.viewportCount,
      stderrTail: tail(result.stderr, 12),
    });
    lastResult = result;
    if (result.code === 0 || result.timedOut || summary.status === "failed" || summary.viewportCount > 0) break;
    if (attempt < maxAttempts) await delay(1_000);
  }
  return { ...lastResult, attempts };
}

function acceptanceLoopbackEnv(context, overrides = {}) {
  const stackBasedMockBase = context?.stack?.mockBase;
  const defaultMockBase = context?.serviceEnv?.DESIGN_PLATFORM_BASE_URL || "http://127.0.0.1:3700";
  const inheritedEnv = context?.serviceEnv || process.env;
  return {
    ...inheritedEnv,
    ...overrides,
    DESIGN_PLATFORM_ADAPTER: "standard_v1",
    DESIGN_PLATFORM_BASE_URL: stackBasedMockBase || defaultMockBase,
    ACCEPTANCE_ALLOW_LOOPBACK_DESIGN_DOWNLOADS: "1",
  };
}

function readResponsiveLayoutProbeSummary(filePath) {
  if (!fs.existsSync(filePath)) return { status: "missing", viewportCount: 0 };
  try {
    const probe = readJsonFile(filePath);
    return {
      status: probe.status || "unknown",
      viewportCount: Array.isArray(probe.viewports) ? probe.viewports.length : 0,
    };
  } catch (error) {
    return { status: `unreadable: ${error.message}`, viewportCount: 0 };
  }
}

function buildResponsiveLayoutBlockers(status, probe, result, rendererLabel) {
  const blockers = Array.isArray(probe.blockers) ? [...probe.blockers] : [];
  if (status !== "blocked" || blockers.length) return blockers;
  if (result.timedOut) return [`${rendererLabel} did not finish within 180000ms`];
  return [
    `${rendererLabel} stopped before completing both viewports after ${(result.attempts || []).length || 1} attempt(s) (code=${result.code}, signal=${result.signal || "none"})`,
  ];
}

function commandEvidence(result) {
  return {
    code: result.code,
    signal: result.signal,
    timedOut: Boolean(result.timedOut),
    stdoutTail: tail(result.stdout, 30),
    stderrTail: tail(result.stderr, 30),
    attempts: result.attempts || [],
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function renderResponsiveLayoutMarkdown(report) {
  const lines = [
    "# Responsive layout acceptance",
    "",
    `- Status: **${String(report.status || "blocked").toUpperCase()}**`,
    `- URL: \`${report.url || "not provided"}\``,
    `- Renderer: ${report.renderer || "unknown"}`,
    `- Started: ${report.startedAt || ""}`,
    `- Finished: ${report.finishedAt || ""}`,
    "",
    "## Viewports",
    "",
    "| Viewport | Size | Status | Horizontal overflow | Navigation | Primary pane | Interaction |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const viewport of report.viewports || []) {
    const checks = viewport.checks || {};
    lines.push(
      `| ${viewport.name} | ${viewport.viewport?.width || "?"}x${viewport.viewport?.height || "?"} | ${viewport.passed ? "PASS" : "FAIL"} | ${responsiveMark(checks.noPageHorizontalOverflow)} | ${responsiveMark(checks.navigationAvailable)} | ${responsiveMark(checks.primaryPaneVisible)} | ${responsiveMark(checks.interactionReachable)} |`,
    );
  }
  if (!(report.viewports || []).length) lines.push("| no rendered evidence | - | BLOCKED | - | - | - | - |");
  lines.push("", "## Issues", "");
  const issues = [...(report.blockers || []), ...(report.failures || [])];
  if (issues.length) issues.forEach((item) => lines.push(`- ${singleLine(item)}`));
  else lines.push("- none");
  lines.push("", "## Artifacts", "", `- JSON: \`${report.artifacts.jsonReport}\``, `- Edge probe: \`${report.artifacts.edgeProbeReport}\``, `- Screenshots: \`${report.artifacts.screenshotDir}\``, "");
  return `${lines.join("\n")}\n`;
}

function responsiveMark(value) {
  return value === true ? "PASS" : value === false ? "FAIL" : "-";
}

async function runExternalDesignReadiness(context) {
  requireExternalReadinessPermission(context);
  const readiness = await externalRequest(context, "/integrations/design-platform/readiness");
  const blockers = [];
  if (readiness.adapter !== "art_image_local") blockers.push(`adapter=${readiness.adapter || "unknown"}, expected art_image_local`);
  if (readiness.canSubmitFormalGeneration !== true) blockers.push(...(readiness.nextSteps || ["formal generation is not ready"]));
  if (blockers.length) {
    throw new BlockedError("真实设计平台尚未达到正式出图就绪条件", blockers, {
      adapter: readiness.adapter,
      canSubmitFormalGeneration: readiness.canSubmitFormalGeneration,
      health: readiness.health || null,
    });
  }
  return {
    evidence: {
      adapter: readiness.adapter,
      canSubmitFormalGeneration: readiness.canSubmitFormalGeneration,
      latencyMs: readiness.latencyMs,
      submittedDesignJob: false,
    },
  };
}

async function runExternalWechatWorkReadiness(context) {
  requireExternalReadinessPermission(context);
  const status = await externalRequest(context, "/wechat-work/status");
  const required = ["corpId", "secret", "token", "encodingAesKey", "openKfid", "defaultConversation"];
  const missing = required.filter((key) => status.configured?.[key] !== true);
  const callbackUrl = String(status.callbackUrl || "");
  if (!/^https:\/\//i.test(callbackUrl)) missing.push("publicHttpsCallbackUrl");
  if (missing.length) {
    throw new BlockedError("真实企业微信配置尚未就绪", missing.map((item) => `missing: ${item}`), {
      configured: status.configured,
      callbackUrl,
    });
  }
  return {
    evidence: {
      configured: status.configured,
      callbackUrl,
      apiBaseUrl: status.apiBaseUrl,
      syncCalled: false,
      sendCalled: false,
    },
  };
}

function requireExternalReadinessPermission(context) {
  if (!context.options.allowExternalReadiness) {
    throw new BlockedError("real-external 只读探测需要显式传入 --allow-external-readiness", ["external readiness permission not granted"]);
  }
}

async function externalRequest(context, route) {
  const apiBase = context.options.apiBase || process.env.ACCEPTANCE_API_BASE || "http://127.0.0.1:3200/api";
  await requestJson(context, "/health", { baseUrl: apiBase });
  return requestJson(context, route, { baseUrl: apiBase });
}

async function ensurePrimaryConversation(context) {
  requireStack(context);
  if (context.primaryConversation) return context.primaryConversation;
  const primaryFixture = requireAcceptanceIdentities(context)[0];
  const conversations = await requestJson(
    context,
    `/wechat/conversations?wechatAccountId=${encodeURIComponent(primaryFixture.accountId)}`,
  );
  const conversation = conversations.find((item) => item.id === "conversation_demo_1") || conversations[0];
  if (!conversation) {
    throw new BlockedError("no local-safe Enterprise WeChat conversation is available", [primaryFixture.accountId]);
  }
  context.primaryConversation = conversation;
  return conversation;
}

function requireAcceptanceIdentities(context) {
  if (!Array.isArray(context.acceptanceIdentities) || context.acceptanceIdentities.length < 2) {
    throw new BlockedError("local-safe Enterprise WeChat identity fixtures are unavailable", ["MCK-STACK-001"]);
  }
  return context.acceptanceIdentities;
}

function prepareLocalSafeWechatWorkFixtures(context, localStoreFile) {
  const relativeStorePath = path.relative(context.serviceRuntimeDir, localStoreFile);
  if (relativeStorePath.startsWith("..") || path.isAbsolute(relativeStorePath)) {
    throw new Error(`refusing to prepare acceptance fixtures outside the isolated runtime: ${localStoreFile}`);
  }
  if (!fs.existsSync(localStoreFile)) {
    throw new Error(`local store was not initialized for acceptance: ${localStoreFile}`);
  }

  const data = JSON.parse(fs.readFileSync(localStoreFile, "utf8"));
  const now = new Date().toISOString();
  const prepared = localSafeWechatWorkFixtures.map((fixture) => {
    const account = data.wechatAccounts.find((item) => item.id === fixture.sourceAccountId || item.id === fixture.accountId);
    const customer = data.customers.find((item) => item.id === fixture.customerId);
    const conversation = data.conversations.find((item) => item.id === fixture.conversationId);
    if (!account || !customer || !conversation) {
      throw new Error(`canonical local-store seed is missing acceptance identity ${fixture.sourceAccountId}`);
    }

    account.id = fixture.accountId;
    account.platform = "wechat_work_kf";
    account.wechatWork = { ...(account.wechatWork || {}), openKfid: fixture.openKfid };
    account.updatedAt = now;
    customer.source = "wechat_work_kf";
    customer.wechatWorkExternalUserId = fixture.externalUserId;
    customer.updatedAt = now;
    conversation.channel = "work_wechat";
    conversation.wechatAccountId = fixture.accountId;
    conversation.externalChatId = `wechat_work_kf:${fixture.openKfid}:${fixture.externalUserId}`;
    conversation.wechatWork = { openKfid: fixture.openKfid, externalUserId: fixture.externalUserId };
    conversation.updatedAt = now;

    return { ...fixture };
  });

  const fixtureConversationIds = new Set(prepared.map((item) => item.conversationId));
  data.wechatWorkBindings = (Array.isArray(data.wechatWorkBindings) ? data.wechatWorkBindings : [])
    .filter((binding) => !fixtureConversationIds.has(binding.conversationId));
  for (const fixture of prepared) {
    data.wechatWorkBindings.push({
      id: `wechat_work_binding_acceptance_${fixture.accountId.endsWith("_2") ? "2" : "1"}`,
      openKfid: fixture.openKfid,
      externalUserId: fixture.externalUserId,
      wechatAccountId: fixture.accountId,
      customerId: fixture.customerId,
      conversationId: fixture.conversationId,
      createdAt: now,
      updatedAt: now,
      lastInboundAt: now,
    });
  }
  fs.writeFileSync(localStoreFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return prepared;
}

function requireStack(context) {
  if (!context.stack) throw new BlockedError("local acceptance stack is unavailable", ["MCK-STACK-001"]);
}

function identityExpectation(record) {
  return {
    expectedWechatAccountId: record.wechatAccountId,
    expectedConversationId: record.conversationId || record.id,
    expectedCustomerId: record.customerId,
  };
}

function buildIdentityQuery(record) {
  const params = new URLSearchParams();
  params.set("wechatAccountId", record.wechatAccountId);
  params.set("conversationId", record.conversationId || record.id);
  params.set("customerId", record.customerId);
  return params.toString();
}

function buildCommerceAcceptanceBundle() {
  const box = {
    skuCode: "BOX-A",
    name: "Demo gift box A",
    type: "gift_box",
    salePrice: 40,
    costPrice: 18,
    stock: 150,
    dimensions: { lengthCm: 32, widthCm: 24, heightCm: 9 },
    weightGram: 420,
    leadTimeDays: 3,
    mainImagePath: "https://example.test/smart-kefu/demo-skus/box-a.png",
    imageUrl: "https://example.test/smart-kefu/demo-skus/box-a.png",
  };
  const tea = {
    skuCode: "TEA-A",
    name: "Demo tea gift A",
    type: "item",
    salePrice: 118,
    costPrice: 58,
    stock: 80,
    dimensions: { lengthCm: 16, widthCm: 9, heightCm: 6 },
    weightGram: 280,
    leadTimeDays: 5,
    mainImagePath: "https://example.test/smart-kefu/demo-skus/tea-a.png",
    imageUrl: "https://example.test/smart-kefu/demo-skus/tea-a.png",
  };
  return {
    giftBox: box,
    items: [box, tea],
    automation: {
      ready: true,
      blockers: [],
    },
  };
}

function unwrapDesignJob(value) {
  if (value?.job) return value.job;
  return value || {};
}

async function waitForDesignJobImages(context, job, expected) {
  let latest = unwrapDesignJob(job);
  let lastRemoteStatus = "";
  const pollTrace = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const images = Array.isArray(latest.images) ? latest.images : [];
    if (images.length > 0) return latest;
    const polled = await requestJson(context, `/design-jobs/${encodeURIComponent(latest.id)}/poll`, {
      method: "POST",
      body: expected,
      timeoutMs: 30_000,
    });
    lastRemoteStatus = polled.remoteStatus || polled.result?.status || latest.status || "";
    latest = unwrapDesignJob(polled);
    const latestImages = Array.isArray(latest.images) ? latest.images : [];
    const resultImages = Array.isArray(polled.result?.images) ? polled.result.images : [];
    pollTrace.push({
      attempt: attempt + 1,
      remoteStatus: lastRemoteStatus,
      jobStatus: latest.status || "",
      jobImageCount: latestImages.length,
      resultImageCount: resultImages.length,
      errorMessage: latest.errorMessage || polled.result?.errorMessage || "",
    });
    if (latestImages.length > 0) return latest;
    if (["failed", "manual_review", "timeout", "cancelled"].includes(String(latest.status || lastRemoteStatus))) {
      const detail = pollTrace.map((item) => `${item.attempt}:${item.remoteStatus}/${item.jobStatus}:jobImages=${item.jobImageCount}:resultImages=${item.resultImageCount}${item.errorMessage ? `:${singleLine(item.errorMessage)}` : ""}`).join(" | ");
      throw new Error(`design job reached terminal status before images: ${latest.status || lastRemoteStatus}; trace=${detail}`);
    }
    await delay(300);
  }
  const detail = pollTrace.map((item) => `${item.attempt}:${item.remoteStatus}/${item.jobStatus}:jobImages=${item.jobImageCount}:resultImages=${item.resultImageCount}${item.errorMessage ? `:${singleLine(item.errorMessage)}` : ""}`).join(" | ");
  throw new Error(`design job did not produce candidate images; last remote status=${lastRemoteStatus || "unknown"}; trace=${detail || "none"}`);
}

async function requestJson(context, route, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const expectedStatuses = options.expectedStatuses || [200, 201];
  let url;
  if (/^https?:\/\//i.test(route)) {
    url = new URL(route);
  } else {
    const baseUrl = options.baseUrl === null ? null : options.baseUrl || context.stack?.apiBase || context.options.apiBase;
    if (!baseUrl) throw new Error(`no base URL for ${route}`);
    url = new URL(String(route).replace(/^\/+/, ""), `${String(baseUrl).replace(/\/+$/, "")}/`);
  }
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if (!loopback && !(context.options.mode === "real-external" && context.options.allowExternalReadiness && method === "GET")) {
    context.safetyViolations.push(`blocked non-loopback ${method} ${url.origin}`);
    throw new Error(`safety policy blocked non-loopback request: ${method} ${url.origin}`);
  }
  if (method !== "GET" && method !== "HEAD" && forbiddenMutationPatterns.some((pattern) => pattern.test(url.pathname))) {
    context.safetyViolations.push(`blocked forbidden mutation ${method} ${url.pathname}`);
    throw new Error(`safety policy blocked forbidden mutation: ${method} ${url.pathname}`);
  }
  if (method !== "GET" && method !== "HEAD") {
    context.mutationLog.push({ method, url: url.toString(), loopback, external: !loopback });
  }

  const headers = { ...(options.headers || {}) };
  if (
    context.internalApiToken &&
    context.stack?.apiBase &&
    url.origin === new URL(context.stack.apiBase).origin
  ) {
    headers["x-internal-api-token"] = context.internalApiToken;
  }
  let body = options.body;
  if (body !== undefined && body !== null && typeof body !== "string" && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    if (!headers["content-type"] && !headers["Content-Type"]) headers["content-type"] = "application/json";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 20_000);
  let response;
  try {
    response = await fetch(url, { method, headers, body, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { text };
    }
  }
  if (!expectedStatuses.includes(response.status)) {
    const error = new Error(`${method} ${url} returned ${response.status}: ${singleLine(text).slice(0, 500)}`);
    error.evidence = { status: response.status, response: data };
    throw error;
  }
  return data;
}

function encryptWechatWorkMessage(message, encodingAesKey, receiveId) {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  if (key.length !== 32) throw new Error("test enterprise WeChat AES key must decode to 32 bytes");
  const random = crypto.createHash("sha256").update(message).digest().subarray(0, 16);
  const messageBuffer = Buffer.from(message, "utf8");
  const messageLength = Buffer.alloc(4);
  messageLength.writeUInt32BE(messageBuffer.length, 0);
  const plain = Buffer.concat([random, messageLength, messageBuffer, Buffer.from(receiveId, "utf8")]);
  const pad = 32 - (plain.length % 32 || 32);
  const padLength = pad === 0 ? 32 : pad;
  const padded = Buffer.concat([plain, Buffer.alloc(padLength, padLength)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

function sha1Sorted(values) {
  return crypto.createHash("sha1").update([...values].sort().join("")).digest("hex");
}

function spawnService(context, name, args, env) {
  const logsDir = path.join(context.outputDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `${name}.log`);
  const fd = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, args, {
    cwd: desktopRoot,
    env,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
  });
  fs.closeSync(fd);
  context.children.push({ name, child, pid: child.pid, logPath });
  return child;
}

async function stopServices(context) {
  for (const service of [...context.children].reverse()) {
    if (!service.pid || service.child.exitCode !== null) continue;
    try {
      service.child.kill();
    } catch {
      // The service may already have stopped between the exit check and kill.
    }
    await waitForChildExit(service.child, 1_500);
    if (process.platform === "win32" && service.child.exitCode === null) {
      spawnSync("taskkill", ["/PID", String(service.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 5_000,
      });
      await waitForChildExit(service.child, 1_500);
    } else if (service.child.exitCode === null) {
      try {
        service.child.kill("SIGKILL");
      } catch {
        // Already stopped.
      }
    }
  }
  context.children = [];
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const attempts = { count: 0 };
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastResponseStatus = null;
  while (Date.now() < deadline) {
    try {
      attempts.count += 1;
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      lastResponseStatus = response.status;
      if (response.status >= 200 && response.status < 400) {
        await response.arrayBuffer();
        return;
      }
      lastError = new Error(`received ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(350);
  }
  const lastErrorMessage = lastError ? singleLine(String(lastError.message || String(lastError))) : "unknown";
  const lastErrorName = lastError && lastError.name ? lastError.name : "Error";
  const lastErrorCode = lastError && lastError.code ? lastError.code : "";
  const responseHint = lastResponseStatus === null ? "n/a" : String(lastResponseStatus);
  const codeSuffix = lastErrorCode ? ` code=${lastErrorCode}` : "";
  const timeoutMsUsed = timeoutMs < Infinity ? `${timeoutMs}ms` : "unlimited";
  throw new Error(
    `[acceptance] waitForHttp failed for ${url}: ${lastErrorName}${codeSuffix}: ${lastErrorMessage} (status=${responseHint}, attempts=${attempts.count}, timeout=${timeoutMsUsed})`,
  );
}

function runCmdLine(commandLine, options = {}) {
  if (process.platform !== "win32") {
    return runCommand("sh", ["-lc", commandLine], options);
  }
  return runCommand(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], options);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || desktopRoot,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current, chunk) => (current + chunk.toString("utf8")).slice(-200_000);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        child.kill("SIGTERM");
      }
    }, options.timeoutMs || 120_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ command, args, code, signal, timedOut, stdout, stderr });
    });
  });
}

function assertCommandPassed(result, label) {
  if (result.code !== 0) {
    throw new Error(
      `${label} exited with ${result.code}${result.signal ? ` signal=${result.signal}` : ""}\n${tail(result.stderr || result.stdout, 30)}`,
    );
  }
}

async function distinctFreePorts(count) {
  const ports = [];
  while (ports.length < count) {
    const port = await freePort();
    if (!ports.includes(port)) ports.push(port);
  }
  return ports;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function loadMatrix(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateMatrix(matrix) {
  if (!matrix || matrix.schemaVersion !== 1) throw new Error("unsupported product acceptance matrix schema");
  if (!Array.isArray(matrix.scenarios) || !matrix.scenarios.length) throw new Error("product acceptance matrix has no scenarios");
  const ids = new Set();
  for (const scenario of matrix.scenarios) {
    if (!scenario.id || ids.has(scenario.id)) throw new Error(`invalid or duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    if (!handlers[scenario.handler]) throw new Error(`matrix handler is not implemented: ${scenario.handler}`);
    if (!Object.prototype.hasOwnProperty.call(matrix.modeDefinitions, scenario.mode)) {
      throw new Error(`scenario ${scenario.id} has invalid mode ${scenario.mode}`);
    }
    if (scenario.mutatesExternal !== false) throw new Error(`scenario ${scenario.id} must not mutate external systems`);
  }
  const capabilities = new Set(matrix.scenarios.map((scenario) => scenario.capability));
  for (const capability of matrix.requiredCapabilities || []) {
    if (!capabilities.has(capability)) throw new Error(`matrix is missing required capability: ${capability}`);
  }
}

function selectModes(mode) {
  if (mode === "mock") return new Set(["mock"]);
  if (mode === "local-safe") return new Set(["mock", "local-safe"]);
  if (mode === "real-external") return new Set(["real-external"]);
  return new Set([mode]);
}

function buildSkippedResult(scenario, requestedMode) {
  return {
    id: scenario.id,
    capability: scenario.capability,
    mode: scenario.mode,
    titleZh: scenario.titleZh,
    acceptance: scenario.acceptance,
    sideEffectClass: scenario.sideEffectClass,
    mutatesExternal: scenario.mutatesExternal,
    knownLimit: scenario.knownLimit || "",
    externalDependencies: scenario.externalDependencies || [],
    status: "skipped",
    durationMs: 0,
    evidence: {},
    blockers: [],
    errorMessage: `requested mode ${requestedMode} does not execute ${scenario.mode}`,
  };
}

function buildReport(context) {
  const summary = { passed: 0, failed: 0, blocked: 0, skipped: 0, total: context.results.length };
  for (const result of context.results) summary[result.status] += 1;
  const externalDependencies = [
    ...new Set(
      context.matrix.scenarios
        .filter((scenario) => scenario.mode === "real-external")
        .flatMap((scenario) => scenario.externalDependencies || []),
    ),
  ];
  const jsonReport = path.join(context.outputDir, "product-acceptance-report.json");
  const markdownReport = path.join(context.outputDir, "product-acceptance-report.zh-CN.md");
  return {
    schemaVersion: 1,
    matrixVersion: context.matrix.matrixVersion,
    runId: context.runId,
    requestedMode: context.options.mode,
    executedModes: [...selectModes(context.options.mode)],
    startedAt: context.startedAt,
    finishedAt: context.finishedAt || new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      desktopRoot,
      runtimeDir: context.serviceRuntimeDir,
      urls: context.stack || { apiBase: context.options.apiBase || process.env.ACCEPTANCE_API_BASE || "http://127.0.0.1:3200/api" },
      browserPlugin: "absent",
    },
    safety: {
      policy: context.matrix.safetyPolicy,
      actual: {
        realSendEnabled: false,
        paymentMutationEnabled: false,
        externalMutationCount: context.mutationLog.filter((item) => item.external).length,
        loopbackMutationCount: context.mutationLog.filter((item) => !item.external).length,
        safetyViolations: context.safetyViolations,
      },
    },
    summary,
    results: context.results,
    externalDependencies,
    artifacts: {
      outputDir: context.outputDir,
      jsonReport,
      markdownReport,
      screenshot390: existingArtifact(path.join(context.outputDir, "responsive-layout", "screenshots", "mobile-390.png")),
    },
  };
}

function existingArtifact(filePath) {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  return stat?.isFile() && stat.size > 0 ? filePath : null;
}

function writeReports(context) {
  fs.mkdirSync(context.outputDir, { recursive: true });
  const report = buildReport(context);
  fs.writeFileSync(report.artifacts.jsonReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(report.artifacts.markdownReport, renderMarkdown(report), "utf8");
}

function renderMarkdown(report) {
  const lines = [
    "# 产品级端到端验收报告",
    "",
    `- 运行编号：${report.runId}`,
    `- 请求模式：${report.requestedMode}`,
    `- 执行模式：${report.executedModes.join("、")}`,
    `- 开始时间：${report.startedAt}`,
    `- 完成时间：${report.finishedAt}`,
    `- 结果：通过 ${report.summary.passed}，失败 ${report.summary.failed}，阻塞 ${report.summary.blocked}，跳过 ${report.summary.skipped}`,
    "",
    "## 安全结论",
    "",
    `- 真实发信：${report.safety.actual.realSendEnabled ? "已启用" : "未启用"}`,
    `- 付款状态变更：${report.safety.actual.paymentMutationEnabled ? "已启用" : "未启用"}`,
    `- 外部写操作：${report.safety.actual.externalMutationCount}`,
    `- 安全策略违规：${report.safety.actual.safetyViolations.length}`,
    "- 旧版 `/api/chat/send` 会直接操作微信，本验收明确不调用。",
    "",
    "## 场景明细",
    "",
    "| 状态 | ID | 模式 | 能力 | 场景 | 耗时 |",
    "| --- | --- | --- | --- | --- | ---: |",
  ];
  for (const result of report.results) {
    lines.push(
      `| ${statusLabel(result.status)} | ${md(result.id)} | ${md(result.mode)} | ${md(result.capability)} | ${md(result.titleZh)} | ${result.durationMs} ms |`,
    );
  }
  const findings = report.results.filter((item) => item.status === "failed" || item.status === "blocked");
  lines.push("", "## 失败或阻塞", "");
  if (!findings.length) lines.push("- 无");
  for (const result of findings) {
    lines.push(`- **${result.id} ${result.titleZh}**：${singleLine(result.errorMessage || result.blockers.join("；"))}`);
    for (const blocker of result.blockers || []) lines.push(`  - ${singleLine(blocker)}`);
  }
  lines.push("", "## 真实外部依赖（默认未执行）", "");
  for (const dependency of report.externalDependencies) lines.push(`- ${dependency}`);
  lines.push(
    "",
    "## 产物",
    "",
    `- 机器可读报告：${report.artifacts.jsonReport}`,
    `- 中文报告：${report.artifacts.markdownReport}`,
    `- 390px 截图：${report.artifacts.screenshot390 || "未生成"}`,
    "",
  );
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = {
    mode: "local-safe",
    outputDir: "",
    apiBase: "",
    allowExternalReadiness: false,
    strict: true,
    noBuild: false,
    skipLayout: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") options.mode = String(argv[++index] || "");
    else if (arg === "--output-dir") options.outputDir = String(argv[++index] || "");
    else if (arg === "--api-base") options.apiBase = String(argv[++index] || "");
    else if (arg === "--allow-external-readiness") options.allowExternalReadiness = true;
    else if (arg === "--no-strict") options.strict = false;
    else if (arg === "--no-build") options.noBuild = true;
    else if (arg === "--skip-layout") options.skipLayout = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node tools/run-product-acceptance.js [options]

Options:
  --mode mock|local-safe|real-external   default: local-safe
  --output-dir <path>                    report and isolated runtime directory
  --api-base <url>                       local API used by real-external probes
  --allow-external-readiness             allow read-only real dependency probes
  --no-build                             reuse existing dist/apps/api/main.js
  --skip-layout                          skip the Electron 390px renderer
  --no-strict                            blocked scenarios do not set exit code 2

Safety defaults: loopback-only, no real message send, no payment mutation.`);
}

function listFiles(directory, suffix) {
  if (!directory || !fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => path.join(directory, entry.name));
}

function statusLabel(status) {
  return { passed: "通过", failed: "失败", blocked: "阻塞", skipped: "跳过" }[status] || status;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tail(value, count) {
  return String(value || "").split(/\r?\n/).filter(Boolean).slice(-count).join("\n");
}

function singleLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function md(value) {
  return singleLine(value).replace(/\|/g, "\\|");
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

module.exports = {
  buildReport,
  loadMatrix,
  parseArgs,
  renderMarkdown,
  selectModes,
  validateMatrix,
};
