"use strict";

const assert = require("node:assert/strict");
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
const { WechatWorkController } = require("../apps/api/src/wechat-work/wechat-work.controller");
const {
  INTERNAL_API_TOKEN_HEADER,
  OPERATOR_CAPABILITY_METADATA,
  OperatorAccessGuard,
} = require("../apps/api/src/operator-access/operator-access.guard");
const { OperatorAccessService } = require("../apps/api/src/operator-access/operator-access.service");

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
