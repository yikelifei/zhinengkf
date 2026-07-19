"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..");
const matrixPath = path.join(desktopRoot, "config", "product-acceptance-matrix.json");
const forbiddenMutationPatterns = [
  /\/api\/wechat-work\/kf\/send-text\/?$/,
  /\/api\/wechat\/send-tasks\/[^/]+\/mark-sent(?:-current-window)?\/?$/,
  /\/api\/wechat\/send-tasks\/[^/]+\/bridge-ack\/?$/,
  /\/api\/quotes\/[^/]+\/verify-payment-proof\/?$/,
  /\/api\/chat\/send\/?$/,
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
  personal_bridge_no_send: runPersonalBridgeNoSend,
  inbound_local: runInboundLocal,
  wechat_work_callback: runWechatWorkCallback,
  design_task: runDesignTask,
  automation_cycle: runAutomationCycle,
  crm_regression: runCrmRegression,
  contract_regression: runContractRegression,
  layout_390: runLayout390,
  external_design_readiness: runExternalDesignReadiness,
  external_wechat_work_readiness: runExternalWechatWorkReadiness,
  external_personal_wechat_readiness: runExternalPersonalWechatReadiness,
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
  console.log("[acceptance] safety=loopback-only, real-send=forbidden, payment=forbidden");
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
  const localStoreFile = path.join(context.serviceRuntimeDir, "local-store.json");
  const wechatWorkKey = Buffer.from("0123456789abcdef0123456789abcdef", "utf8")
    .toString("base64")
    .replace(/=$/, "");
  const internalApiToken = crypto.randomBytes(32).toString("hex");
  const serviceEnv = {
    ...process.env,
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
    CUSTOMER_SERVICE_PUBLIC_BASE_URL: `http://127.0.0.1:${apiPort}`,
    INTERNAL_API_TOKEN: internalApiToken,
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
    LOW_VALUE_AUTOMATION_PROCESS_SEND_QUEUE: "false",
    WECHAT_WORK_CORP_ID: "e2e-corp-id",
    WECHAT_WORK_AGENT_ID: "1000002",
    WECHAT_WORK_SECRET: "e2e-secret-not-real",
    WECHAT_WORK_TOKEN: "e2e-callback-token",
    WECHAT_WORK_ENCODING_AES_KEY: wechatWorkKey,
    WECHAT_WORK_OPEN_KFID: "e2e-open-kfid",
    WECHAT_WORK_API_BASE_URL: mockBase,
    WECHAT_WORK_DEFAULT_WECHAT_ACCOUNT_ID: "wechat_demo_1",
    WECHAT_WORK_DEFAULT_CONVERSATION_ID: "conversation_demo_1",
    WECHAT_WORK_DEFAULT_CUSTOMER_ID: "customer_demo_1",
  };
  context.serviceEnv = serviceEnv;
  context.internalApiToken = internalApiToken;
  context.wechatWork = {
    token: serviceEnv.WECHAT_WORK_TOKEN,
    aesKey: serviceEnv.WECHAT_WORK_ENCODING_AES_KEY,
    receiveId: serviceEnv.WECHAT_WORK_CORP_ID,
  };

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
  spawnService(context, "api", [apiEntry], serviceEnv);
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

  return {
    evidence: {
      webUrl,
      apiHealthUrl: `${apiBase}/health`,
      mockHealthUrl: `${mockBase}/v1/health`,
      dataMode: health.dataMode,
      localStoreFile,
      logs: Object.fromEntries(context.children.map((item) => [item.name, item.logPath])),
    },
  };
}

async function runIdentityIsolation(context) {
  requireStack(context);
  const accounts = await requestJson(context, "/wechat/accounts");
  assert(Array.isArray(accounts) && accounts.length >= 2, "expected at least two WeChat accounts");
  const first = accounts.find((item) => item.id === "wechat_demo_1") || accounts[0];
  const second = accounts.find((item) => item.id === "wechat_demo_2") || accounts[1];
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
  const task = await requestJson(context, "/wechat/send-tasks/demo", {
    method: "POST",
    body: {
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      text: "E2E 人工回复安全入队验证：只排队，不发送。",
      ...expected,
    },
  });
  assert(task.status === "queued", `manual queue task status is ${task.status}`);
  assert(task.wechatAccountId === conversation.wechatAccountId, "queued task account mismatch");
  assert(task.conversationId === conversation.id, "queued task conversation mismatch");
  assert(task.customerId === conversation.customerId, "queued task customer mismatch");
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
      realSendInvoked: false,
    },
  };
}

async function runPersonalBridgeNoSend(context) {
  requireStack(context);
  if (!context.manualSendTask) throw new BlockedError("manual safe queue task is unavailable", ["LSF-MANUAL-QUEUE-001"]);
  const task = context.manualSendTask;
  const expected = identityExpectation(task);
  const snapshot = await requestJson(context, "/wechat/window-snapshots/demo", {
    method: "POST",
    body: {
      mode: "correct",
      wechatAccountId: task.wechatAccountId,
      conversationId: task.conversationId,
      ...expected,
    },
  });
  assert(snapshot.diagnostic?.ok !== false, "demo window snapshot is not safe");
  const execution = await requestJson(context, `/wechat/send-tasks/${encodeURIComponent(task.id)}/execute`, {
    method: "POST",
    body: { adapter: "windows_bridge", ...expected },
  });
  assert(execution.task?.status === "sending", `bridge task status is ${execution.task?.status}`);
  assert(execution.attempt?.status === "started", `bridge attempt status is ${execution.attempt?.status}`);

  const worker = await runCommand(process.execPath, [
    path.join(desktopRoot, "tools", "wechat-bridge-worker.js"),
    "--once",
    "--mode",
    "dispatch",
    "--api-base",
    context.stack.apiBase,
  ], {
    cwd: desktopRoot,
    env: { ...context.serviceEnv, BRIDGE_MODE: "dispatch" },
    timeoutMs: 30_000,
  });
  assertCommandPassed(worker, "wechat bridge dispatch worker");

  const dispatchFiles = listFiles(context.serviceEnv.WECHAT_BRIDGE_DISPATCH_DIR, ".dispatch.json");
  assert(dispatchFiles.length >= 1, "bridge worker did not create a dispatch file");
  const personal = await runCommand(process.execPath, [
    path.join(desktopRoot, "tools", "personal-wechat-bridge.js"),
    "--once",
    "--api-base",
    context.stack.apiBase,
    "--dispatch-dir",
    context.serviceEnv.WECHAT_BRIDGE_DISPATCH_DIR,
    "--inbox-dir",
    context.serviceEnv.WECHAT_BRIDGE_INBOX_DIR,
    "--status-file",
    context.serviceEnv.PERSONAL_WECHAT_BRIDGE_STATUS_FILE,
  ], {
    cwd: desktopRoot,
    env: {
      ...context.serviceEnv,
      PERSONAL_WECHAT_SEND: "0",
      PERSONAL_WECHAT_AUTO_ENTER: "0",
      PERSONAL_WECHAT_BRIDGE_AUTO_ENTER: "0",
      PERSONAL_WECHAT_DISABLE_ACK_SCAN: "1",
    },
    timeoutMs: 30_000,
  });
  assertCommandPassed(personal, "personal WeChat no-send bridge");
  const bridgeStatus = JSON.parse(fs.readFileSync(context.serviceEnv.PERSONAL_WECHAT_BRIDGE_STATUS_FILE, "utf8"));
  const ackFiles = listFiles(context.serviceEnv.WECHAT_BRIDGE_INBOX_DIR, ".ack.json");
  assert(bridgeStatus.sendEnabled === false, "personal bridge unexpectedly enabled real send");
  assert(bridgeStatus.autoEnter !== true, "personal bridge unexpectedly enabled auto-enter");
  assert(Number(bridgeStatus.result?.skippedCount || 0) >= 1, "personal bridge did not observe-and-skip dispatch");
  assert(Number(bridgeStatus.result?.processedCount || 0) === 0, "personal bridge processed a real send");
  assert(ackFiles.length === 0, "personal bridge wrote an acknowledgement in no-send mode");
  const tasks = await requestJson(
    context,
    `/wechat/send-tasks?conversationId=${encodeURIComponent(task.conversationId)}&wechatAccountId=${encodeURIComponent(task.wechatAccountId)}`,
  );
  const refreshed = tasks.find((item) => item.id === task.id);
  assert(refreshed?.status === "sending", `task should wait for ack, got ${refreshed?.status}`);

  return {
    evidence: {
      taskId: task.id,
      windowSnapshotId: snapshot.id,
      attemptId: execution.attempt.id,
      dispatchFiles,
      bridgeStatusFile: context.serviceEnv.PERSONAL_WECHAT_BRIDGE_STATUS_FILE,
      sendEnabled: bridgeStatus.sendEnabled,
      autoEnter: bridgeStatus.autoEnter,
      skippedCount: bridgeStatus.result.skippedCount,
      ackFileCount: ackFiles.length,
      finalTaskStatus: refreshed.status,
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
    (record) => record.action === "callback_accepted" && record.status === "accepted" && record.openKfid === "e2e-open-kfid",
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
    body: { ...payload, wechatAccountId: "wechat_demo_2" },
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

async function runAutomationCycle(context) {
  requireStack(context);
  const statusBefore = await requestJson(context, "/automation/status");
  const readiness = await requestJson(context, "/automation/readiness");
  const run = await requestJson(context, "/automation/run-once", {
    method: "POST",
    body: {
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
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
    "tests/identity-binding.test.js",
    "tests/inbound-workflow.test.js",
    "tests/personal-wechat-bridge.test.js",
    "tests/automation-service-status.test.js",
    "tests/mock-design-platform.test.js",
    "tests/product-acceptance-matrix.test.js",
  ];
  const result = await runCommand(process.execPath, ["--test", ...files], {
    cwd: desktopRoot,
    env: { ...process.env, PERSONAL_WECHAT_SEND: "0", PERSONAL_WECHAT_AUTO_ENTER: "0" },
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

async function runLayout390(context) {
  requireStack(context);
  if (context.options.skipLayout) throw new BlockedError("responsive renderer was skipped by --skip-layout", ["layout renderer disabled"]);
  const outputDir = path.join(context.outputDir, "responsive-layout");
  const outputPath = path.join(outputDir, "responsive-layout-report.json");
  const result = await runCommand(process.execPath, [
    path.join(desktopRoot, "tools", "run-responsive-layout-qa.js"),
    "--url",
    context.stack.webUrl,
    "--output-dir",
    outputDir,
  ], {
    cwd: desktopRoot,
    env: context.serviceEnv,
    timeoutMs: 180_000,
  });
  if (!fs.existsSync(outputPath)) assertCommandPassed(result, "responsive layout QA runner");
  assert(fs.existsSync(outputPath), "responsive layout JSON was not written");
  const layout = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  if (layout.status === "blocked") {
    throw new BlockedError("responsive Electron layout QA is blocked", layout.blockers || ["renderer unavailable"], {
      reportPath: outputPath,
      process: layout.process || null,
    });
  }
  assert(layout.status === "passed", `responsive layout failed: ${(layout.failures || []).join("; ")}`);
  assert(Array.isArray(layout.viewports) && layout.viewports.length === 2, "responsive layout must include 1536px and 390px evidence");
  return {
    evidence: {
      renderer: "existing Electron Chromium runtime",
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

async function runExternalPersonalWechatReadiness(context) {
  requireExternalReadinessPermission(context);
  const channels = await externalRequest(context, "/wechat/channels/status");
  const bridge = await externalRequest(context, "/wechat/bridge/status");
  const personal = channels.channels?.find((item) => item.key === "personal_wechat");
  const blockers = [];
  if (!personal || personal.status !== "ready") blockers.push(`personal_wechat channel status=${personal?.status || "missing"}`);
  if (bridge.worker?.ok !== true) blockers.push(bridge.worker?.message || "bridge worker is not ready");
  if (blockers.length) {
    throw new BlockedError("真实个人微信桥接尚未就绪", blockers, {
      channel: personal || null,
      worker: bridge.worker || null,
    });
  }
  return {
    evidence: {
      channelStatus: personal.status,
      workerStatus: bridge.worker.status,
      realSendAttempted: false,
      autoEnterAttempted: false,
      ackWritten: false,
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
  const conversations = await requestJson(context, "/wechat/conversations?wechatAccountId=wechat_demo_1");
  const conversation = conversations.find((item) => item.id === "conversation_demo_1") || conversations[0];
  if (!conversation) throw new BlockedError("no demo conversation is available", ["wechat_demo_1 conversation"]);
  context.primaryConversation = conversation;
  return conversation;
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
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (response.status >= 200 && response.status < 400) {
        await response.arrayBuffer();
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(350);
  }
  throw lastError || new Error(`timed out waiting for ${url}`);
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
    const append = (current, chunk) => (current + chunk.toString("utf8")).slice(-200_000);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => {
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
      resolve({ command, args, code, signal, stdout, stderr });
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
      screenshot390: path.join(context.outputDir, "layout-390.png"),
    },
  };
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
    `- 390px 截图：${report.artifacts.screenshot390}`,
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
