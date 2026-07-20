"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { GUARDS_METADATA } = require("@nestjs/common/constants");
const { Reflector } = require("@nestjs/core");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const { appConfig } = require("../apps/api/src/shared/app-config");
const { WechatController } = require("../apps/api/src/wechat/wechat.controller");
const { ConversationOperationsController } = require("../apps/api/src/conversation-ops/conversation-operations.controller");
const { WechatWorkController } = require("../apps/api/src/wechat-work/wechat-work.controller");
const {
  WECHAT_BRIDGE_TOKEN_HEADER,
  WECHAT_WINDOW_OBSERVER_TOKEN_HEADER,
  WechatBridgeAccessGuard,
  WechatWindowObserverAccessGuard,
} = require("../apps/api/src/wechat/wechat-runtime-access.guard");
const {
  INTERNAL_API_TOKEN_HEADER,
  OPERATOR_CAPABILITY_METADATA,
  OperatorAccessGuard,
} = require("../apps/api/src/operator-access/operator-access.guard");
const { OperatorAccessService } = require("../apps/api/src/operator-access/operator-access.service");
const { internalApiServiceEnv } = require("../tools/internal-api-session");
const {
  createWechatBridgeServiceSession,
  wechatBridgeServiceEnv,
} = require("../tools/wechat-bridge-service-session");

const VALID_TOKEN = "d".repeat(64);

test("generic WeChat inbound requires approve_send and the operator guard while WeCom callback stays public", () => {
  const inbound = WechatController.prototype.processInboundMessage;
  assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, inbound), "approve_send");
  assert.ok((Reflect.getMetadata(GUARDS_METADATA, inbound) || []).includes(OperatorAccessGuard));

  for (const methodName of ["verifyCallback", "handleCallback"]) {
    const callback = WechatWorkController.prototype[methodName];
    assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, callback), undefined, methodName);
    assert.equal((Reflect.getMetadata(GUARDS_METADATA, callback) || []).includes(OperatorAccessGuard), false, methodName);
  }
});

test("operator reads and mark-read are guarded while bridge ack keeps its per-dispatch authentication contract", () => {
  for (const methodName of [
    "listAccounts",
    "listConversations",
    "listConversationTimeline",
    "markConversationMessagesRead",
    "listSendTasks",
    "listSendAttempts",
    "getSendAdapter",
    "getChannelStatus",
  ]) {
    const method = WechatController.prototype[methodName];
    assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, method), "view_console", methodName);
    assert.ok((Reflect.getMetadata(GUARDS_METADATA, method) || []).includes(OperatorAccessGuard), methodName);
  }

  for (const methodName of ["listBridgeOutbox", "listBridgeDispatch", "getBridgeStatus", "scanBridgeInbox"]) {
    const method = WechatController.prototype[methodName];
    assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, method), "view_console", methodName);
    assert.ok((Reflect.getMetadata(GUARDS_METADATA, method) || []).includes(WechatBridgeAccessGuard), methodName);
  }

  for (const methodName of ["listWindowSnapshots", "getWindowObserverStatus", "scanWindowSnapshotInbox"]) {
    const method = WechatController.prototype[methodName];
    assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, method), "view_console", methodName);
    assert.ok((Reflect.getMetadata(GUARDS_METADATA, method) || []).includes(WechatWindowObserverAccessGuard), methodName);
  }

  assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, ConversationOperationsController), "view_console");
  assert.ok((Reflect.getMetadata(GUARDS_METADATA, ConversationOperationsController) || []).includes(OperatorAccessGuard));

  const bridgeAck = WechatController.prototype.acknowledgeBridgeSend;
  assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, bridgeAck), undefined);
  assert.equal((Reflect.getMetadata(GUARDS_METADATA, bridgeAck) || []).length, 0);
});

test("anonymous and forged reads cannot call services or mark inbound messages read", () => {
  const previousToken = appConfig.internalApiToken;
  const calls = [];
  try {
    appConfig.internalApiToken = VALID_TOKEN;
    const wechat = new WechatController({
      listAccounts: () => calls.push("listAccounts"),
      markConversationMessagesRead: (...args) => calls.push(["markRead", ...args]),
    });
    const operations = new ConversationOperationsController({ listQueue: (...args) => calls.push(["listQueue", ...args]) });
    const guard = new OperatorAccessGuard(new Reflector(), new OperatorAccessService());

    for (const [controllerClass, handler, body] of [
      [WechatController, WechatController.prototype.listAccounts, undefined],
      [WechatController, WechatController.prototype.markConversationMessagesRead, {
        expectedWechatAccountId: "wechat-1",
        expectedConversationId: "conversation-1",
        expectedCustomerId: "customer-1",
      }],
      [ConversationOperationsController, ConversationOperationsController.prototype.listQueue, undefined],
    ]) {
      for (const headers of [{}, { [INTERNAL_API_TOKEN_HEADER]: "e".repeat(64) }]) {
        assert.throws(
          () => guard.canActivate(executionContext(handler, controllerClass, { headers, body })),
          (error) => error?.getStatus?.() === 403 && error?.getResponse?.().code === "trusted_local_session_required",
        );
      }
    }

    assert.equal(calls.length, 0);
    assert.ok(wechat);
    assert.ok(operations);
  } finally {
    appConfig.internalApiToken = previousToken;
  }
});

test("valid internal proof can read and mark exactly once through the existing operator boundary", async () => {
  const previousToken = appConfig.internalApiToken;
  const calls = [];
  try {
    appConfig.internalApiToken = VALID_TOKEN;
    const controller = new WechatController({
      listAccounts: async () => { calls.push("listAccounts"); return [{ id: "wechat-1" }]; },
      markConversationMessagesRead: async (identity) => { calls.push(["markRead", identity]); return { updatedCount: 2 }; },
    });
    const guard = new OperatorAccessGuard(new Reflector(), new OperatorAccessService());
    const request = { headers: { [INTERNAL_API_TOKEN_HEADER]: VALID_TOKEN } };

    assert.equal(guard.canActivate(executionContext(WechatController.prototype.listAccounts, WechatController, request)), true);
    assert.deepEqual(await controller.listAccounts(), [{ id: "wechat-1" }]);

    const identity = {
      expectedWechatAccountId: "wechat-1",
      expectedConversationId: "conversation-1",
      expectedCustomerId: "customer-1",
    };
    assert.equal(guard.canActivate(executionContext(
      WechatController.prototype.markConversationMessagesRead,
      WechatController,
      { headers: request.headers, body: identity },
    )), true);
    assert.deepEqual(await controller.markConversationMessagesRead("conversation-1", identity), { updatedCount: 2 });
    assert.deepEqual(calls, [
      "listAccounts",
      ["markRead", { wechatAccountId: "wechat-1", conversationId: "conversation-1", customerId: "customer-1" }],
    ]);
  } finally {
    appConfig.internalApiToken = previousToken;
  }
});

test("bridge and observer sessions rotate per request, remain isolated, and never inherit the operator token", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-runtime-auth-"));
  const previousInternal = appConfig.internalApiToken;
  const previousBridgeFile = appConfig.wechatBridgeServiceTokenFile;
  const previousObserverFile = appConfig.wechatWindowObserverProofFile;
  try {
    const bridgeFile = path.join(tempDir, "bridge.key");
    const observerFile = path.join(tempDir, "observer.key");
    const bridgeOne = "1".repeat(64);
    const bridgeTwo = "2".repeat(64);
    const observerOne = "3".repeat(64);
    const observerTwo = "4".repeat(64);
    createWechatBridgeServiceSession(tempDir, { tokenFile: bridgeFile, token: bridgeOne });
    fs.writeFileSync(observerFile, `${observerOne}\n`, "utf8");
    appConfig.internalApiToken = VALID_TOKEN;
    appConfig.wechatBridgeServiceTokenFile = bridgeFile;
    appConfig.wechatWindowObserverProofFile = observerFile;

    const operatorGuard = new OperatorAccessGuard(new Reflector(), new OperatorAccessService());
    const bridgeGuard = new WechatBridgeAccessGuard(operatorGuard);
    const observerGuard = new WechatWindowObserverAccessGuard(operatorGuard);
    const bridgeHandler = WechatController.prototype.listBridgeOutbox;
    const observerHandler = WechatController.prototype.scanWindowSnapshotInbox;

    assert.equal(bridgeGuard.canActivate(executionContext(bridgeHandler, WechatController, {
      headers: { [WECHAT_BRIDGE_TOKEN_HEADER]: bridgeOne },
    })), true);
    assert.equal(observerGuard.canActivate(executionContext(observerHandler, WechatController, {
      headers: { [WECHAT_WINDOW_OBSERVER_TOKEN_HEADER]: observerOne },
    })), true);
    assert.throws(() => bridgeGuard.canActivate(executionContext(bridgeHandler, WechatController, {
      headers: { [WECHAT_BRIDGE_TOKEN_HEADER]: observerOne },
    })), (error) => error?.getResponse?.().code === "trusted_wechat_bridge_session_required");
    assert.throws(() => observerGuard.canActivate(executionContext(observerHandler, WechatController, {
      headers: { [WECHAT_WINDOW_OBSERVER_TOKEN_HEADER]: bridgeOne },
    })), (error) => error?.getResponse?.().code === "trusted_wechat_window_observer_session_required");

    fs.writeFileSync(bridgeFile, `${bridgeTwo}\n`, "utf8");
    fs.writeFileSync(observerFile, `${observerTwo}\n`, "utf8");
    assert.throws(() => bridgeGuard.canActivate(executionContext(bridgeHandler, WechatController, {
      headers: { [WECHAT_BRIDGE_TOKEN_HEADER]: bridgeOne },
    })));
    assert.equal(bridgeGuard.canActivate(executionContext(bridgeHandler, WechatController, {
      headers: { [WECHAT_BRIDGE_TOKEN_HEADER]: bridgeTwo },
    })), true);
    assert.throws(() => observerGuard.canActivate(executionContext(observerHandler, WechatController, {
      headers: { [WECHAT_WINDOW_OBSERVER_TOKEN_HEADER]: observerOne },
    })));
    assert.equal(observerGuard.canActivate(executionContext(observerHandler, WechatController, {
      headers: { [WECHAT_WINDOW_OBSERVER_TOKEN_HEADER]: observerTwo },
    })), true);

    assert.equal(bridgeGuard.canActivate(executionContext(bridgeHandler, WechatController, {
      headers: { [INTERNAL_API_TOKEN_HEADER]: VALID_TOKEN },
    })), true);
    assert.equal(observerGuard.canActivate(executionContext(observerHandler, WechatController, {
      headers: { [INTERNAL_API_TOKEN_HEADER]: VALID_TOKEN },
    })), true);

    const workerEnv = wechatBridgeServiceEnv(
      internalApiServiceEnv({ INTERNAL_API_TOKEN: VALID_TOKEN }, "wechat-bridge-worker", VALID_TOKEN),
      "wechat-bridge-worker",
      bridgeFile,
    );
    const webEnv = wechatBridgeServiceEnv(
      internalApiServiceEnv({}, "web", VALID_TOKEN),
      "web",
      bridgeFile,
    );
    assert.equal(workerEnv.INTERNAL_API_TOKEN, undefined);
    assert.equal(workerEnv.WECHAT_BRIDGE_SERVICE_TOKEN_FILE, bridgeFile);
    assert.equal(webEnv.INTERNAL_API_TOKEN, VALID_TOKEN);
    assert.equal(webEnv.WECHAT_BRIDGE_SERVICE_TOKEN_FILE, undefined);
    assert.equal(JSON.stringify(workerEnv).includes(bridgeTwo), false);
  } finally {
    appConfig.internalApiToken = previousInternal;
    appConfig.wechatBridgeServiceTokenFile = previousBridgeFile;
    appConfig.wechatWindowObserverProofFile = previousObserverFile;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("anonymous and forged generic inbound requests fail before any dispatch side effect", () => {
  const previousToken = appConfig.internalApiToken;
  const calls = [];
  try {
    appConfig.internalApiToken = VALID_TOKEN;
    const controller = new WechatController({
      processInboundMessage: async (...args) => {
        calls.push(args);
        return { accepted: true };
      },
    });
    const guard = new OperatorAccessGuard(new Reflector(), new OperatorAccessService());
    const handler = WechatController.prototype.processInboundMessage;
    const payload = { text: "should not persist", operator: "attacker", role: "admin" };

    for (const headers of [
      {},
      { [INTERNAL_API_TOKEN_HEADER]: "e".repeat(64) },
      { authorization: "Bearer forged", "x-operator-role": "admin" },
    ]) {
      assert.throws(
        () => guard.canActivate(executionContext(handler, WechatController, { headers, body: payload })),
        (error) => error?.getStatus?.() === 403 && error?.getResponse?.().code === "trusted_local_session_required",
      );
    }

    assert.equal(calls.length, 0);
  } finally {
    appConfig.internalApiToken = previousToken;
  }
});

test("existing INTERNAL_API_TOKEN authorizes a trusted operator and dispatches inbound exactly once", async () => {
  const previousToken = appConfig.internalApiToken;
  const calls = [];
  try {
    appConfig.internalApiToken = VALID_TOKEN;
    const controller = new WechatController({
      processInboundMessage: async (...args) => {
        calls.push(args);
        return { accepted: true };
      },
    });
    const guard = new OperatorAccessGuard(new Reflector(), new OperatorAccessService());
    const handler = WechatController.prototype.processInboundMessage;
    const payload = {
      wechatAccountId: "wechat-1",
      conversationId: "conversation-1",
      customerId: "customer-1",
      text: "trusted inbound",
      externalId: "external-1",
    };
    const request = {
      headers: { [INTERNAL_API_TOKEN_HEADER]: VALID_TOKEN },
      body: payload,
    };

    assert.equal(guard.canActivate(executionContext(handler, WechatController, request)), true);
    assert.equal(request.trustedOperator.id, "local_admin");
    assert.equal(request.trustedOperator.role, "admin");
    assert.equal(request.trustedOperator.authenticationProvider, "local_desktop_session");

    assert.deepEqual(await controller.processInboundMessage(payload, request.trustedOperator), { accepted: true });
    assert.deepEqual(calls, [[payload]]);
  } finally {
    appConfig.internalApiToken = previousToken;
  }
});

function executionContext(handler, controllerClass, request) {
  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}
