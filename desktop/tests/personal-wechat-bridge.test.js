"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {
  ACCOUNTS_CONFIG_VERSION,
  BRIDGE_ACK_VERSION,
  buildAckPayload,
  buildActionPlan,
  buildStatus,
  executeBoundWechatActions,
  readConfig,
  resolveAccountBinding,
  runOnce,
  selectDispatchFiles,
  validateAccountsConfig,
  validateDispatchPayload,
  validateSourceOutbox,
} = require("../tools/personal-wechat-bridge");

test("validates explicit account to process, window and Windows session bindings", () => {
  const config = buildAccountsConfig();
  assert.equal(validateAccountsConfig(config).ok, true);

  config.accounts.push({ ...config.accounts[0], wechatAccountId: "account_2" });
  const duplicate = validateAccountsConfig(config);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, "accounts_config_duplicate");
});

test("RPA driver keeps process/window identity but does not require legacy UI Automation ids", () => {
  const config = buildAccountsConfig();
  config.accounts[0].accountNickname = "设计3号ai出图";
  delete config.accounts[0].ui;
  assert.equal(validateAccountsConfig(config, "wechatauto_rpa").ok, true);

  delete config.accounts[0].accountNickname;
  const missingNickname = validateAccountsConfig(config, "wechatauto_rpa");
  assert.equal(missingNickname.ok, false);
  assert.match(missingNickname.reason, /accountNickname/);
});

test("RPA driver only calls the configured loopback host and forwards its verification proof", async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({ url: request.url, token: request.headers["x-personal-wechat-rpa-token"], body: JSON.parse(body) });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        actionCount: 1,
        accountVerified: true,
        chatVerified: true,
        recentMessageVerified: true,
        operationVerified: true,
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const result = await executeBoundWechatActions(
      { binding: { accountNickname: "设计3号ai出图" }, actions: [{ type: "text", text: "test" }] },
      {
        driver: "wechatauto_rpa",
        rpaEndpoint: `http://127.0.0.1:${address.port}`,
        rpaToken: "local-test-token",
        sendTimeoutMs: 5000,
      },
      "send",
    );
    assert.equal(result.ok, true);
    assert.equal(result.operationVerified, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/send");
    assert.equal(requests[0].token, "local-test-token");
    assert.equal(requests[0].body.binding.accountNickname, "设计3号ai出图");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("RPA runtime config supplies driver endpoint token and nickname without token env", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-wechat-rpa-config-"));
  const configFile = path.join(tempDir, "personal-wechat-rpa.json");
  fs.writeFileSync(configFile, JSON.stringify({
    token: "runtime-token",
    port: 4321,
    accountNickname: "设计3号ai出图",
  }), "utf8");
  const previous = {
    PERSONAL_WECHAT_DRIVER: process.env.PERSONAL_WECHAT_DRIVER,
    PERSONAL_WECHAT_RPA_CONFIG_FILE: process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE,
    PERSONAL_WECHAT_RPA_TOKEN: process.env.PERSONAL_WECHAT_RPA_TOKEN,
    PERSONAL_WECHAT_RPA_ENDPOINT: process.env.PERSONAL_WECHAT_RPA_ENDPOINT,
    PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME: process.env.PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME,
  };
  try {
    delete process.env.PERSONAL_WECHAT_DRIVER;
    delete process.env.PERSONAL_WECHAT_RPA_TOKEN;
    delete process.env.PERSONAL_WECHAT_RPA_ENDPOINT;
    delete process.env.PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME;
    process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE = configFile;
    const config = readConfig();
    assert.equal(config.driver, "wechatauto_rpa");
    assert.equal(config.rpaEndpoint, "http://127.0.0.1:4321");
    assert.equal(config.rpaToken, "runtime-token");
    assert.equal(config.rpaAccountNickname, "设计3号ai出图");
    assert.equal(config.rpaConfigFile, path.resolve(configFile));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("legacy single RPA configuration still resolves its bound account", () => {
  const accountsConfig = buildAccountsConfig();
  accountsConfig.accounts[0].accountNickname = "设计3号ai出图";
  const result = resolveAccountBinding(buildDispatch(), {
    driver: "wechatauto_rpa",
    accountsConfig,
    rpaEndpoint: "http://127.0.0.1:3211",
    rpaToken: "legacy-token",
    rpaAccountNickname: "设计3号ai出图",
  });
  assert.equal(result.ok, true);
  assert.equal(result.account.wechatAccountId, "account_1");
});

test("RPA registry routes each wechatAccountId to its own endpoint and token", async () => {
  const first = await startRpaTestServer();
  const second = await startRpaTestServer();
  const config = {
    driver: "wechatauto_rpa",
    rpaInstances: [
      { wechatAccountId: "account_1", endpoint: first.endpoint, token: "token-for-account-1", accountNickname: "客服一号" },
      { wechatAccountId: "account_2", endpoint: second.endpoint, token: "token-for-account-2", accountNickname: "客服二号" },
    ],
    sendTimeoutMs: 5000,
  };
  try {
    const [firstResult, secondResult] = await Promise.all([
      executeBoundWechatActions(
        { binding: { wechatAccountId: "account_1", accountNickname: "客服一号" }, actions: [{ type: "text", text: "first" }] },
        config,
      ),
      executeBoundWechatActions(
        { binding: { wechatAccountId: "account_2", accountNickname: "客服二号" }, actions: [{ type: "text", text: "second" }] },
        config,
      ),
    ]);

    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    assert.equal(first.requests.length, 1);
    assert.equal(second.requests.length, 1);
    assert.equal(first.requests[0].token, "token-for-account-1");
    assert.equal(second.requests[0].token, "token-for-account-2");
    assert.equal(first.requests[0].body.binding.wechatAccountId, "account_1");
    assert.equal(second.requests[0].body.binding.wechatAccountId, "account_2");
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test("RPA registry rejects nickname mismatch, missing account instance and non-loopback endpoint", async () => {
  const accountsConfig = buildAccountsConfig(true);
  accountsConfig.accounts[0].accountNickname = "客服一号";
  accountsConfig.accounts[1].accountNickname = "客服二号";
  const instanceOne = {
    wechatAccountId: "account_1",
    endpoint: "http://127.0.0.1:3211",
    token: "token-for-account-1",
    accountNickname: "客服一号",
  };

  const wrongNickname = resolveAccountBinding(buildDispatch(), {
    driver: "wechatauto_rpa",
    accountsConfig,
    rpaInstances: [{ ...instanceOne, accountNickname: "错误账号" }],
  });
  assert.equal(wrongNickname.ok, false);
  assert.equal(wrongNickname.code, "account_nickname_mismatch");

  const secondTarget = buildTarget("account_2", "conversation_2", "customer_2", "Chat 2");
  const missingInstance = resolveAccountBinding(buildDispatch({
    wechatAccountId: "account_2",
    conversationId: "conversation_2",
    target: secondTarget,
    preflight: buildPreflight("account_2", "conversation_2", "customer_2", "Chat 2"),
  }), {
    driver: "wechatauto_rpa",
    accountsConfig,
    rpaInstances: [instanceOne],
  });
  assert.equal(missingInstance.ok, false);
  assert.equal(missingInstance.code, "rpa_instance_missing");

  const externalEndpoint = await executeBoundWechatActions(
    { binding: { wechatAccountId: "account_1", accountNickname: "客服一号" }, actions: [{ type: "text", text: "blocked" }] },
    { driver: "wechatauto_rpa", rpaInstances: [{ ...instanceOne, endpoint: "http://example.com:3211" }] },
  );
  assert.equal(externalEndpoint.ok, false);
  assert.equal(externalEndpoint.code, "rpa_endpoint_invalid");
});

test("RPA registry is loaded from runtime config and status never exposes instance tokens", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-wechat-rpa-registry-"));
  const configFile = path.join(tempDir, "personal-wechat-rpa.json");
  fs.writeFileSync(configFile, JSON.stringify({
    instances: [
      { wechatAccountId: "account_1", endpoint: "http://127.0.0.1:4321", token: "registry-secret-one", accountNickname: "客服一号" },
      { wechatAccountId: "account_2", endpoint: "http://localhost:4322", token: "registry-secret-two", accountNickname: "客服二号" },
    ],
  }), "utf8");
  const previous = {
    PERSONAL_WECHAT_DRIVER: process.env.PERSONAL_WECHAT_DRIVER,
    PERSONAL_WECHAT_RPA_CONFIG_FILE: process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE,
    PERSONAL_WECHAT_RPA_TOKEN: process.env.PERSONAL_WECHAT_RPA_TOKEN,
    PERSONAL_WECHAT_RPA_ENDPOINT: process.env.PERSONAL_WECHAT_RPA_ENDPOINT,
    PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME: process.env.PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME,
  };
  try {
    delete process.env.PERSONAL_WECHAT_DRIVER;
    delete process.env.PERSONAL_WECHAT_RPA_TOKEN;
    delete process.env.PERSONAL_WECHAT_RPA_ENDPOINT;
    delete process.env.PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME;
    process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE = configFile;
    const config = readConfig();
    assert.equal(config.driver, "wechatauto_rpa");
    assert.equal(config.rpaInstances.length, 2);
    assert.equal(config.rpaInstances[1].wechatAccountId, "account_2");

    const status = buildStatus(null, config, new Date().toISOString());
    const serialized = JSON.stringify(status);
    assert.equal(status.rpaInstanceCount, 2);
    assert.equal(status.rpaTokenConfigured, true);
    assert.deepEqual(status.rpaInstances.map((item) => item.tokenConfigured), [true, true]);
    assert.doesNotMatch(serialized, /registry-secret-one|registry-secret-two/);
    assert.equal(Object.hasOwn(status.rpaInstances[0], "token"), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("dispatch contract requires exact target and recent message evidence", () => {
  const dispatch = buildDispatch();
  assert.equal(validateDispatchPayload(dispatch, "account-task-attempt.dispatch.json").ok, true);

  const missingRecent = buildDispatch({ preflight: buildPreflight("account_1", "conversation_1", "customer_1", "Chat 1", ""), target: { ...dispatch.target, recentMessageText: "" } });
  const result = validateDispatchPayload(missingRecent, "account-task-attempt.dispatch.json");
  assert.equal(result.ok, false);
  assert.match(result.reason, /recent message/);
});

test("builds text and local image actions and rejects remote images", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-wechat-storage-"));
  const imagePath = path.join(storageRoot, "result.png");
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const plan = buildActionPlan([{ type: "text", text: "hello" }, { type: "image", filePath: imagePath }], { localStorageRoot: storageRoot });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.actions, [{ type: "text", text: "hello" }, { type: "image", filePath: fs.realpathSync(imagePath) }]);
  assert.equal(buildActionPlan([{ type: "image", filePath: "https://example.test/x.png" }], { localStorageRoot: storageRoot }).ok, false);
});

test("source outbox identity and actions must exactly match dispatch", () => {
  const dispatch = buildDispatch();
  const outbox = buildOutbox();
  assert.equal(validateSourceOutbox(dispatch, { payload: outbox }).ok, true);

  outbox.sendPlan.actions = [{ type: "text", text: "different" }];
  const mismatch = validateSourceOutbox(dispatch, { payload: outbox });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /differ/);
});

test("resolves only the configured account and conversation binding", () => {
  const dispatch = buildDispatch();
  const result = resolveAccountBinding(dispatch, { accountsConfig: buildAccountsConfig() });
  assert.equal(result.ok, true);
  assert.equal(result.account.processId, 101);
  assert.equal(result.conversation.customerId, "customer_1");

  const wrongChat = resolveAccountBinding(
    buildDispatch({ target: { ...dispatch.target, conversationTitle: "Other chat" } }),
    { accountsConfig: buildAccountsConfig() },
  );
  assert.equal(wrongChat.ok, false);
  assert.equal(wrongChat.code, "chat_binding_mismatch");
});

test("sent ack includes task, account, conversation and customer identity", () => {
  const dispatch = buildDispatch();
  const outbox = buildOutbox();
  const ack = buildAckPayload(dispatch, outbox, "sent", { source: "test" });
  assert.equal(ack.version, BRIDGE_ACK_VERSION);
  assert.equal(ack.ackToken, outbox.ackToken);
  assert.equal(ack.taskId, dispatch.taskId);
  assert.equal(ack.attemptId, dispatch.attemptId);
  assert.equal(ack.wechatAccountId, dispatch.wechatAccountId);
  assert.equal(ack.conversationId, dispatch.conversationId);
  assert.equal(ack.customerId, dispatch.target.customerId);
  assert.equal(ack.status, "sent");
});

test("dispatch selection round-robins accounts before taking a second task", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-wechat-selection-"));
  const files = [
    ["account_1-a.dispatch.json", "account_1"],
    ["account_1-b.dispatch.json", "account_1"],
    ["account_2-a.dispatch.json", "account_2"],
  ].map(([name, wechatAccountId]) => {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, JSON.stringify({ wechatAccountId }), "utf8");
    return filePath;
  });
  const selected = selectDispatchFiles(files, 2).map((item) => path.basename(item));
  assert.deepEqual(selected, ["account_1-a.dispatch.json", "account_2-a.dispatch.json"]);
});

test("real operation stage serializes each account while different accounts run in parallel", async () => {
  const fixture = createRuntimeFixture();
  writeTaskFixture(fixture, "account_1", "conversation_1", "customer_1", "Chat 1", "task_1", "attempt_1");
  writeTaskFixture(fixture, "account_1", "conversation_1", "customer_1", "Chat 1", "task_2", "attempt_2");
  writeTaskFixture(fixture, "account_2", "conversation_2", "customer_2", "Chat 2", "task_3", "attempt_3");

  const activeByAccount = new Map();
  let globalActive = 0;
  let maxGlobalActive = 0;
  let sameAccountOverlap = false;
  const operationExecutor = async (payload) => {
    const accountId = payload.binding.wechatAccountId;
    const count = activeByAccount.get(accountId) || 0;
    if (count > 0) sameAccountOverlap = true;
    activeByAccount.set(accountId, count + 1);
    globalActive += 1;
    maxGlobalActive = Math.max(maxGlobalActive, globalActive);
    await new Promise((resolve) => setTimeout(resolve, 35));
    activeByAccount.set(accountId, activeByAccount.get(accountId) - 1);
    globalActive -= 1;
    return {
      ok: true,
      actionCount: payload.actions.length,
      accountVerified: true,
      chatVerified: true,
      recentMessageVerified: true,
      operationVerified: true,
    };
  };

  const result = await runOnce({
    ...fixture.config,
    operationExecutor,
    scanAckExecutor: () => ({ processed: [{ taskId: "task_1" }, { taskId: "task_2" }, { taskId: "task_3" }], failed: [] }),
  });

  assert.equal(result.processed.length, 3);
  assert.equal(result.blocked.length, 0);
  assert.equal(sameAccountOverlap, false);
  assert.ok(maxGlobalActive >= 2, `expected different accounts in parallel, observed max ${maxGlobalActive}`);
});

test("different accounts in the same Windows session share a serialized input lane", async () => {
  const fixture = createRuntimeFixture();
  fixture.config.accountsConfig.accounts[1].windowsSessionId = 1;
  writeTaskFixture(fixture, "account_1", "conversation_1", "customer_1", "Chat 1", "task_s1", "attempt_s1");
  writeTaskFixture(fixture, "account_2", "conversation_2", "customer_2", "Chat 2", "task_s2", "attempt_s2");
  let active = 0;
  let maxActive = 0;
  fixture.config.operationExecutor = async (payload) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 25));
    active -= 1;
    return {
      ok: true,
      actionCount: payload.actions.length,
      accountVerified: true,
      chatVerified: true,
      recentMessageVerified: true,
      operationVerified: true,
    };
  };
  fixture.config.scanAckExecutor = () => ({ processed: [{ taskId: "task_s1" }, { taskId: "task_s2" }], failed: [] });

  const result = await runOnce(fixture.config);
  assert.equal(result.processed.length, 2);
  assert.equal(maxActive, 1);
});

test("unsafe UI result blocks dispatch and writes no acknowledgement", async () => {
  const fixture = createRuntimeFixture();
  const dispatchFile = writeTaskFixture(fixture, "account_1", "conversation_1", "customer_1", "Chat 1", "task_block", "attempt_block");
  fixture.config.operationExecutor = () => ({ ok: false, code: "chat_identity_mismatch", errorMessage: "wrong chat" });
  fixture.config.scanAckExecutor = () => assert.fail("scan must not run without a verified send");

  const result = await runOnce(fixture.config);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.processed.length, 0);
  assert.equal(fs.readdirSync(fixture.inboxDir).length, 0);
  assert.equal(fs.existsSync(dispatchFile), true);
  assert.equal(fs.readdirSync(fixture.blockedDir).filter((name) => name.endsWith(".blocked.json")).length, 1);
});

test("implementation has no unverified-window escape hatch or first-process activation", () => {
  const bridge = fs.readFileSync(path.join(__dirname, "..", "tools", "personal-wechat-bridge.js"), "utf8");
  const helper = fs.readFileSync(path.join(__dirname, "..", "tools", "personal-wechat-window.ps1"), "utf8");
  assert.doesNotMatch(bridge, /ALLOW_UNVERIFIED_WINDOW|allowUnverifiedWindow/);
  assert.doesNotMatch(helper, /Get-Process Weixin,WeChat|foreach \(\$p in \$procs\)/);
  assert.match(helper, /GetWindowThreadProcessId/);
  assert.match(helper, /windows_session_mismatch/);
  assert.match(helper, /recent_message_mismatch/);
  assert.match(helper, /send_not_observed/);
});

function createRuntimeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-wechat-runtime-"));
  const dispatchDir = path.join(root, "dispatch");
  const inboxDir = path.join(root, "inbox");
  const lockDir = path.join(root, "locks");
  const blockedDir = path.join(root, "blocked");
  const storageRoot = path.join(root, "storage");
  for (const directory of [dispatchDir, inboxDir, lockDir, blockedDir, storageRoot]) fs.mkdirSync(directory, { recursive: true });
  return {
    root,
    dispatchDir,
    inboxDir,
    lockDir,
    blockedDir,
    storageRoot,
    config: {
      apiBase: "http://127.0.0.1:3200/api",
      dispatchDir,
      inboxDir,
      lockDir,
      blockedDir,
      localStorageRoot: storageRoot,
      accountsConfig: buildAccountsConfig(true),
      limit: 20,
      lockStaleMs: 300000,
      sendEnabled: true,
      scanAckInbox: true,
      pasteDelayMs: 100,
      confirmDelayMs: 300,
    },
  };
}

function writeTaskFixture(fixture, accountId, conversationId, customerId, chatTitle, taskId, attemptId) {
  const outboxDir = path.join(fixture.root, "outbox");
  fs.mkdirSync(outboxDir, { recursive: true });
  const outboxFileName = `${taskId}.json`;
  const outboxFilePath = path.join(outboxDir, outboxFileName);
  const outbox = buildOutbox({
    taskId,
    wechatAccountId: accountId,
    conversationId,
    target: buildTarget(accountId, conversationId, customerId, chatTitle),
    sendPlan: buildSendPlan(accountId, conversationId, customerId, `hello ${taskId}`),
  });
  fs.writeFileSync(outboxFilePath, `${JSON.stringify(outbox, null, 2)}\n`, "utf8");
  const dispatch = buildDispatch({
    taskId,
    attemptId,
    wechatAccountId: accountId,
    conversationId,
    sourceOutboxFileName: outboxFileName,
    sourceOutboxFilePath: outboxFilePath,
    target: buildTarget(accountId, conversationId, customerId, chatTitle),
    preflight: buildPreflight(accountId, conversationId, customerId, chatTitle),
    sendPlan: {
      actions: [{ type: "text", text: `hello ${taskId}` }],
      constraints: strictConstraints(),
    },
  });
  const dispatchFile = path.join(fixture.dispatchDir, `${accountId}-${taskId}-${attemptId}.dispatch.json`);
  fs.writeFileSync(dispatchFile, `${JSON.stringify(dispatch, null, 2)}\n`, "utf8");
  return dispatchFile;
}

function buildAccountsConfig(includeSecond = false) {
  const accounts = [buildAccount("account_1", 101, "1001", 1, "session_1", "conversation_1", "customer_1", "Chat 1")];
  if (includeSecond) accounts.push(buildAccount("account_2", 202, "2002", 2, "session_2", "conversation_2", "customer_2", "Chat 2"));
  return { version: ACCOUNTS_CONFIG_VERSION, accounts };
}

async function startRpaTestServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      requests.push({ url: request.url, token: request.headers["x-personal-wechat-rpa-token"], body: payload });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        actionCount: payload.actions.length,
        accountVerified: true,
        chatVerified: true,
        recentMessageVerified: true,
        operationVerified: true,
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function buildAccount(accountId, processId, windowHandle, windowsSessionId, sessionId, conversationId, customerId, chatTitle) {
  return {
    wechatAccountId: accountId,
    sessionId,
    processId,
    windowHandle,
    windowsSessionId,
    processName: "Weixin",
    executablePath: "C:\\Program Files\\Tencent\\Weixin\\Weixin.exe",
    accountText: `Service ${accountId}`,
    ui: {
      accountAutomationId: "AccountIdentity",
      chatTitleAutomationId: "ChatTitle",
      messageListAutomationId: "MessageList",
      inputAutomationId: "ChatInput",
    },
    conversations: [{ conversationId, customerId, chatTitle }],
  };
}

function buildDispatch(overrides = {}) {
  const target = buildTarget("account_1", "conversation_1", "customer_1", "Chat 1");
  return {
    version: "wechat_bridge_dispatch_v1",
    taskId: "task_1",
    attemptId: "attempt_1",
    wechatAccountId: "account_1",
    conversationId: "conversation_1",
    sourceOutboxFileName: "task_1.json",
    sourceOutboxFilePath: "C:\\runtime\\wechat-outbox\\task_1.json",
    target,
    preflight: buildPreflight("account_1", "conversation_1", "customer_1", "Chat 1"),
    sendPlan: { actions: [{ type: "text", text: "hello" }], constraints: strictConstraints() },
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    ...overrides,
  };
}

function buildOutbox(overrides = {}) {
  return {
    version: "wechat_bridge_outbox_v1",
    ackToken: "a".repeat(64),
    taskId: "task_1",
    wechatAccountId: "account_1",
    conversationId: "conversation_1",
    target: buildTarget("account_1", "conversation_1", "customer_1", "Chat 1"),
    sendPlan: buildSendPlan("account_1", "conversation_1", "customer_1", "hello"),
    guardSnapshot: { status: "passed", ok: true },
    context: { guardStatus: "passed", windowSnapshotId: "window_1" },
    ...overrides,
  };
}

function buildTarget(accountId, conversationId, customerId, conversationTitle) {
  return {
    wechatAccountId: accountId,
    conversationId,
    customerId,
    conversationTitle,
    recentMessageText: "latest customer message",
    windowSnapshotId: "window_1",
  };
}

function buildSendPlan(accountId, conversationId, customerId, text) {
  return {
    target: { wechatAccountId: accountId, conversationId, customerId },
    actions: [{ type: "text", text }],
    actionCount: 1,
    constraints: strictConstraints(),
  };
}

function strictConstraints() {
  return {
    singleAccountLock: true,
    requireActiveWindowMatch: true,
    requireRecentCustomerMatch: true,
    doNotMarkSentWithoutAck: true,
  };
}

function buildPreflight(accountId, conversationId, customerId, conversationTitle, recentMessageText = "latest customer message") {
  return {
    expectedWechatAccountId: accountId,
    expectedConversationId: conversationId,
    expectedCustomerId: customerId,
    expectedConversationTitle: conversationTitle,
    expectedRecentMessageText: recentMessageText,
    expectedWindowSnapshotId: "window_1",
    rejectIfAnyCheckFails: true,
    rejectIfWindowChanged: true,
    rejectIfExpired: true,
    rejectIfOutboxMissing: true,
  };
}
