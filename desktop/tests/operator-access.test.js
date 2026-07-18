"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Reflector } = require("@nestjs/core");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const { appConfig } = require("../apps/api/src/shared/app-config");
const { OperatorAccessController } = require("../apps/api/src/operator-access/operator-access.controller");
const {
  INTERNAL_API_TOKEN_HEADER,
  OPERATOR_CAPABILITY_METADATA,
  OperatorAccessGuard,
} = require("../apps/api/src/operator-access/operator-access.guard");
const { OPERATOR_CAPABILITY_MATRIX } = require("../apps/api/src/operator-access/operator-access.policy");
const {
  LOCAL_ADMIN_PRINCIPAL,
  OperatorAccessService,
  constantTimeTokenMatches,
} = require("../apps/api/src/operator-access/operator-access.service");
const { OPERATOR_CAPABILITIES, OPERATOR_ROLES } = require("../apps/api/src/operator-access/operator-access.types");

const VALID_TOKEN = "a".repeat(64);
const originalToken = appConfig.internalApiToken;
appConfig.internalApiToken = VALID_TOKEN;
test.after(() => {
  appConfig.internalApiToken = originalToken;
});

test("policy defines the complete conservative role and capability matrix", () => {
  assert.deepEqual([...OPERATOR_ROLES], ["admin", "supervisor", "agent", "read_only"]);
  assert.deepEqual([...OPERATOR_CAPABILITIES], [
    "view_console",
    "manage_channels",
    "manage_assignments",
    "reply_conversations",
    "approve_send",
    "manage_training",
    "manage_roles",
  ]);
  assert.deepEqual([...OPERATOR_CAPABILITY_MATRIX.admin], [...OPERATOR_CAPABILITIES]);
  assert.deepEqual([...OPERATOR_CAPABILITY_MATRIX.supervisor], [
    "view_console",
    "manage_channels",
    "manage_assignments",
    "reply_conversations",
    "approve_send",
    "manage_training",
  ]);
  assert.deepEqual([...OPERATOR_CAPABILITY_MATRIX.agent], ["view_console", "reply_conversations"]);
  assert.deepEqual([...OPERATOR_CAPABILITY_MATRIX.read_only], ["view_console"]);
});

test("policy preview fails closed and never trusts self-reported admin fields", () => {
  const service = new OperatorAccessService();
  for (const input of [
    {},
    { role: "admin" },
    { capability: "view_console" },
    { role: "owner", capability: "view_console" },
    { role: "admin", capability: "delete_everything" },
  ]) {
    const result = service.evaluate(input);
    assert.equal(result.policyAllows, false);
    assert.equal(result.authorizationGranted, false);
    assert.equal(result.trustedPrincipal, false);
  }

  const spoofed = service.evaluate({
    role: "admin",
    capability: "manage_roles",
    trustedPrincipal: true,
    isAdmin: true,
    headers: { "x-operator-role": "admin", authorization: "Bearer forged" },
  });
  assert.equal(spoofed.policyAllows, true);
  assert.equal(spoofed.authorizationGranted, false);
  assert.equal(spoofed.enforcementApplied, false);
  assert.equal(spoofed.trustedPrincipal, false);
  assert.match(spoofed.notice, /客户端提交的角色不能建立身份/);
});

test("launcher token comparison is constant-time at the digest boundary and fails closed", () => {
  assert.equal(constantTimeTokenMatches(VALID_TOKEN, VALID_TOKEN), true);
  assert.equal(constantTimeTokenMatches(VALID_TOKEN, "b".repeat(64)), false);
  assert.equal(constantTimeTokenMatches(VALID_TOKEN, "a".repeat(63)), false);
  assert.equal(constantTimeTokenMatches("", ""), false);
  assert.equal(constantTimeTokenMatches(VALID_TOKEN, [VALID_TOKEN]), false);
});

test("valid local session maps only to the fixed local_admin admin principal", () => {
  const service = new OperatorAccessService();
  const principal = service.requireTrustedCapability(VALID_TOKEN, "reply_conversations");
  assert.deepEqual(principal, LOCAL_ADMIN_PRINCIPAL);
  assert.equal(principal.id, "local_admin");
  assert.equal(principal.role, "admin");
  assert.equal(principal.authenticationProvider, "local_desktop_session");

  assert.throws(
    () => service.requireTrustedCapability("b".repeat(64), "reply_conversations"),
    (error) => error?.getResponse?.().code === "trusted_local_session_required",
  );
});

test("status distinguishes active local enforcement from missing request proof", () => {
  const service = new OperatorAccessService();
  const active = service.getStatus(VALID_TOKEN);
  assert.equal(active.mode, "local_desktop_enforced");
  assert.equal(active.trustedPrincipal, true);
  assert.equal(active.enforcementReady, true);
  assert.equal(active.authenticationProvider, "local_desktop_session");
  assert.equal(active.roleBindingReady, true);
  assert.equal(active.principal.id, "local_admin");
  assert.deepEqual(active.blockers, []);
  assert.ok(active.limitations.some((item) => item.code === "enterprise_sso_not_configured"));
  assert.ok(active.limitations.some((item) => item.code === "multi_operator_identity_unavailable"));

  const untrusted = service.getStatus();
  assert.equal(untrusted.mode, "preflight_only");
  assert.equal(untrusted.trustedPrincipal, false);
  assert.equal(untrusted.enforcementReady, false);
  assert.equal(untrusted.authenticationProvider, "not_authenticated");
  assert.ok(untrusted.blockers.some((item) => item.code === "trusted_session_proof_missing"));
});

test("guard rejects spoofed headers and attaches only the server principal", () => {
  const service = new OperatorAccessService();
  const reflector = new Reflector();
  const guard = new OperatorAccessGuard(reflector, service);
  const handler = () => undefined;
  class Controller {}
  Reflect.defineMetadata(OPERATOR_CAPABILITY_METADATA, "reply_conversations", handler);

  const request = {
    headers: {
      [INTERNAL_API_TOKEN_HEADER]: VALID_TOKEN,
      "x-operator-role": "read_only",
      authorization: "Bearer forged",
    },
    body: { role: "admin", operator: "attacker", trustedPrincipal: true },
  };
  const context = executionContext(handler, Controller, request);
  assert.equal(guard.canActivate(context), true);
  assert.equal(request.trustedOperator.id, "local_admin");
  assert.equal(request.trustedOperator.role, "admin");
  assert.notEqual(request.trustedOperator.id, request.body.operator);

  const rejected = executionContext(handler, Controller, {
    headers: { [INTERNAL_API_TOKEN_HEADER]: "b".repeat(64), "x-operator-role": "admin" },
    body: { role: "admin", operator: "local_admin" },
  });
  assert.throws(
    () => guard.canActivate(rejected),
    (error) => error?.getStatus?.() === 403 && error?.getResponse?.().code === "trusted_local_session_required",
  );
});

test("controller status accepts only the internal proof and protected controllers overwrite audit actors", () => {
  const service = new OperatorAccessService();
  const controller = new OperatorAccessController(service);
  assert.equal(controller.getStatus(VALID_TOKEN).enforcementReady, true);
  assert.equal(controller.getStatus("forged").enforcementReady, false);
  assert.equal(controller.evaluate({ role: "read_only", capability: "view_console" }).authorizationGranted, false);

  const conversation = read("apps/api/src/conversation-ops/conversation-operations.controller.ts");
  const personalWechat = read("apps/api/src/personal-wechat-rpa/personal-wechat-rpa.controller.ts");
  const wechat = read("apps/api/src/wechat/wechat.controller.ts");
  assert.match(conversation, /@RequireOperatorCapability\("manage_assignments"\)[\s\S]*?operator: principal\.id/);
  assert.match(personalWechat, /@Post\("instances"\)[\s\S]*?@RequireOperatorCapability\("manage_channels"\)/);
  assert.match(personalWechat, /@Post\("instances\/:wechatAccountId\/disable"\)[\s\S]*?@RequireOperatorCapability\("manage_channels"\)/);
  assert.match(wechat, /@Post\("conversations\/:id\/manual-replies"\)[\s\S]*?operator: principal\.id/);
  assert.match(wechat, /@Post\("conversations\/:id\/manual-lock"\)[\s\S]*?reviewer: principal\.id/);
  assert.match(wechat, /@Post\("send-tasks\/:id\/execute"\)[\s\S]*?@RequireOperatorCapability\("approve_send"\)/);
});

function executionContext(handler, controllerClass, request) {
  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}
