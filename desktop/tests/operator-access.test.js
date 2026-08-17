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
const { AgentsController } = require("../apps/api/src/agents/agents.controller");
const { AiProviderController } = require("../apps/api/src/ai/ai-provider.controller");
const { AutomationController } = require("../apps/api/src/automation/automation.controller");
const { AssetsController } = require("../apps/api/src/assets/assets.controller");
const { CatalogController } = require("../apps/api/src/catalog/catalog.controller");
const { DesignJobsController } = require("../apps/api/src/design-jobs/design-jobs.controller");
const { DesignPlatformController } = require("../apps/api/src/integrations/design-platform/design-platform.controller");
const { QuotesController } = require("../apps/api/src/quotes/quotes.controller");
const { NotificationsController } = require("../apps/api/src/notifications/notifications.controller");
const { OrdersController } = require("../apps/api/src/orders/orders.controller");
const { ReviewsController } = require("../apps/api/src/reviews/reviews.controller");
const { RoutingController } = require("../apps/api/src/routing/routing.controller");
const { TrainingController } = require("../apps/api/src/training/training.controller");
const { WechatController } = require("../apps/api/src/wechat/wechat.controller");
const { WechatWorkController } = require("../apps/api/src/wechat-work/wechat-work.controller");
const { WechatWorkAuthorizationController } = require("../apps/api/src/wechat-work/wechat-work-authorization.controller");
const { PersonalWechatRpaController } = require("../apps/api/src/personal-wechat-rpa/personal-wechat-rpa.controller");
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
    "manage_design_executions",
    "manage_order_fulfillment",
    "manage_training",
    "execute_agent_skills",
    "manage_roles",
  ]);
  assert.deepEqual([...OPERATOR_CAPABILITY_MATRIX.admin], [...OPERATOR_CAPABILITIES]);
  assert.deepEqual([...OPERATOR_CAPABILITY_MATRIX.supervisor], [
    "view_console",
    "manage_channels",
    "manage_assignments",
    "reply_conversations",
    "approve_send",
    "manage_design_executions",
    "manage_order_fulfillment",
    "manage_training",
    "execute_agent_skills",
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

test("design execution charge and recovery routes require a trusted operator and ignore body reviewer", async () => {
  const protectedMethods = [
    "create",
    "scanTimeouts",
    "pollActiveResults",
    "autoSubmitDrafts",
    "autoProcessLowValue",
    "scanHighValueHandoffs",
    "createTimeoutDemo",
    "createFailureDemo",
    "submit",
    "pollResult",
    "retry",
    "attachAssets",
    "repairLocalImageFile",
    "requestRevision",
    "cancel",
    "selectImage",
    "createQuote",
    "markManualReview",
    "resolveUnknownExecution",
    "resolveExecutionRefund",
  ];
  for (const methodName of protectedMethods) {
    const handler = DesignJobsController.prototype[methodName];
    assert.equal(
      Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, handler),
      "manage_design_executions",
      `${methodName} capability`,
    );
  }
  assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, DesignJobsController), "view_console");
  assert.equal(
    Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, DesignJobsController.prototype.preflight),
    "view_console",
  );
  assert.equal(
    Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, DesignJobsController.prototype.quickConfirmSend),
    "approve_send",
  );
  assert.equal(
    Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, DesignPlatformController.prototype.health),
    undefined,
  );
  for (const methodName of ["readiness", "config"]) {
    assert.equal(
      Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, DesignPlatformController.prototype[methodName]),
      "view_console",
      `design platform ${methodName} capability`,
    );
  }
  for (const methodName of ["updateConfig", "login", "redeemActivation", "smokeTest"]) {
    assert.equal(
      Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, DesignPlatformController.prototype[methodName]),
      "manage_design_executions",
      `design platform ${methodName} capability`,
    );
  }
  assert.equal(
    Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, DesignPlatformController.prototype.smokeTest),
    "manage_design_executions",
  );

  const guard = new OperatorAccessGuard(new Reflector(), new OperatorAccessService());
  for (const [controllerClass, methodName] of [
    [DesignJobsController, "retry"],
    [DesignJobsController, "resolveUnknownExecution"],
    [DesignJobsController, "resolveExecutionRefund"],
    [DesignPlatformController, "smokeTest"],
  ]) {
    const handler = controllerClass.prototype[methodName];
    assert.throws(
      () => guard.canActivate(executionContext(handler, controllerClass, { headers: {}, body: {} })),
      (error) => error?.getStatus?.() === 403,
    );
    assert.throws(
      () => guard.canActivate(executionContext(handler, controllerClass, {
        headers: { [INTERNAL_API_TOKEN_HEADER]: "b".repeat(64) },
        body: { reviewer: "attacker" },
      })),
      (error) => error?.getStatus?.() === 403,
    );
    const request = {
      headers: { [INTERNAL_API_TOKEN_HEADER]: VALID_TOKEN },
      body: { reviewer: "attacker" },
    };
    assert.equal(guard.canActivate(executionContext(handler, controllerClass, request)), true);
    assert.equal(request.trustedOperator.id, "local_admin");
  }

  const calls = [];
  const controller = new DesignJobsController({
    resolveUnknownExecution: async (...args) => { calls.push(args); return {}; },
    resolveExecutionRefund: async (...args) => { calls.push(args); return {}; },
  });
  await controller.resolveUnknownExecution(
    "job-1",
    "execution-1",
    { resolution: "confirmed_not_generated_refunded", reviewer: "attacker" },
    LOCAL_ADMIN_PRINCIPAL,
  );
  await controller.resolveExecutionRefund(
    "job-1",
    "execution-2",
    { resolution: "confirmed_refunded", reviewer: "attacker" },
    LOCAL_ADMIN_PRINCIPAL,
  );
  assert.equal(calls.length, 2);
  for (const args of calls) {
    assert.equal(args[2].reviewer, undefined);
    assert.equal(args[3], "local_admin");
  }

  const quickCalls = [];
  const quickController = new DesignJobsController({
    quickConfirmAndQueueSend: async (...args) => { quickCalls.push(args); return {}; },
  });
  await quickController.quickConfirmSend("job-quick", {}, LOCAL_ADMIN_PRINCIPAL);
  assert.match(quickCalls[0][1].reviewer, /local_admin/);
  assert.doesNotMatch(quickCalls[0][1].reviewer, /^人工客服$/);
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
  const designJobs = read("apps/api/src/design-jobs/design-jobs.controller.ts");
  assert.match(conversation, /@RequireOperatorCapability\("manage_assignments"\)[\s\S]*?operator: principal\.id/);
  assert.match(personalWechat, /@Post\("instances"\)[\s\S]*?@RequireOperatorCapability\("manage_channels"\)/);
  assert.match(personalWechat, /@Post\("instances\/:wechatAccountId\/disable"\)[\s\S]*?@RequireOperatorCapability\("manage_channels"\)/);
  assert.match(wechat, /@Post\("conversations\/:id\/manual-replies"\)[\s\S]*?operator: principal\.id/);
  assert.match(wechat, /@Post\("conversations\/:id\/manual-lock"\)[\s\S]*?reviewer: principal\.id/);
  assert.match(wechat, /@Post\("send-tasks\/:id\/execute"\)[\s\S]*?@RequireOperatorCapability\("approve_send"\)/);
  assert.match(designJobs, /@Post\(":id\/submit"\)[\s\S]*?@RequireOperatorCapability\("manage_design_executions"\)/);
  assert.match(designJobs, /@Post\(":id\/executions\/:executionId\/resolve-refund"\)[\s\S]*?principal\.id/);
});

test("high-risk operator routes use the existing capability matrix while dedicated callbacks stay public", () => {
  assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, ReviewsController), "view_console");
  assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, AutomationController), "view_console");
  assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, TrainingController), "view_console");

  const expectedCapabilities = [
    [WechatWorkController, "syncCustomerServiceMessages", "manage_channels"],
    [WechatWorkController, "getStatus", "view_console"],
    [WechatWorkController, "getProductionPreflight", "view_console"],
    [WechatWorkController, "sendCustomerServiceText", "approve_send"],
    [WechatWorkController, "sendCustomerServiceImages", "approve_send"],
    [WechatWorkController, "dispatchCustomerServiceText", "approve_send"],
    [WechatWorkController, "listAuditLogs", "view_console"],
    [WechatWorkAuthorizationController, "getAuthorizationStatus", "view_console"],
    [WechatWorkAuthorizationController, "createAuthorizationInstallLink", "manage_channels"],
    [ReviewsController, "reviewDesignJob", "approve_send"],
    [ReviewsController, "reviewQuote", "approve_send"],
    [ReviewsController, "reviewOrder", "approve_send"],
    [QuotesController, "queueSend", "approve_send"],
    [QuotesController, "verifyPaymentProof", "approve_send"],
    [AutomationController, "runOnce", "approve_send"],
    [AutomationController, "start", "approve_send"],
    [AutomationController, "stop", "approve_send"],
    [TrainingController, "importChat", "manage_training"],
    [TrainingController, "reviewSample", "manage_training"],
    [TrainingController, "batchReviewSamples", "manage_training"],
    [TrainingController, "applySkillSuggestions", "manage_training"],
    [PersonalWechatRpaController, "listInstances", "view_console"],
    [PersonalWechatRpaController, "validateInstance", "manage_channels"],
    [PersonalWechatRpaController, "upsertInstance", "manage_channels"],
    [PersonalWechatRpaController, "disableInstance", "manage_channels"],
  ];
  for (const [controllerClass, methodName, capability] of expectedCapabilities) {
    assert.equal(
      Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, controllerClass.prototype[methodName]),
      capability,
      `${controllerClass.name}.${methodName}`,
    );
  }

  for (const methodName of ["verifyCallback", "handleCallback"]) {
    assert.equal(
      Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, WechatWorkController.prototype[methodName]),
      undefined,
      `WechatWorkController.${methodName} must remain public`,
    );
  }
  for (const methodName of ["handleAuthorizationRedirect", "verifySuiteCallback", "handleSuiteCallback"]) {
    assert.equal(
      Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, WechatWorkAuthorizationController.prototype[methodName]),
      undefined,
      `WechatWorkAuthorizationController.${methodName} must remain public`,
    );
  }

  const guard = new OperatorAccessGuard(new Reflector(), new OperatorAccessService());
  for (const [controllerClass, methodName] of [
    [WechatWorkController, "dispatchCustomerServiceText"],
    [WechatWorkAuthorizationController, "createAuthorizationInstallLink"],
    [ReviewsController, "reviewOrder"],
    [QuotesController, "verifyPaymentProof"],
    [AutomationController, "runOnce"],
    [TrainingController, "reviewSample"],
  ]) {
    const handler = controllerClass.prototype[methodName];
    assert.throws(
      () => guard.canActivate(executionContext(handler, controllerClass, { headers: {}, body: {} })),
      (error) => error?.getStatus?.() === 403,
      `${controllerClass.name}.${methodName} missing token`,
    );
    assert.throws(
      () => guard.canActivate(executionContext(handler, controllerClass, {
        headers: { [INTERNAL_API_TOKEN_HEADER]: "b".repeat(64) },
        body: { reviewer: "attacker", owner: "attacker" },
      })),
      (error) => error?.getStatus?.() === 403,
      `${controllerClass.name}.${methodName} forged token`,
    );
    const request = { headers: { [INTERNAL_API_TOKEN_HEADER]: VALID_TOKEN }, body: {} };
    assert.equal(guard.canActivate(executionContext(handler, controllerClass, request)), true);
    assert.equal(request.trustedOperator.id, "local_admin");
  }
});

test("high-risk controllers discard browser-owned reviewer and owner fields", async () => {
  const calls = [];
  const reviews = new ReviewsController({
    reviewDesignJob: async (...args) => calls.push(["reviewDesignJob", ...args]),
    reviewQuote: async (...args) => calls.push(["reviewQuote", ...args]),
    reviewOrder: async (...args) => calls.push(["reviewOrder", ...args]),
  });
  await reviews.reviewDesignJob("design-1", { decision: "approve_send", reviewer: "attacker" }, LOCAL_ADMIN_PRINCIPAL);
  await reviews.reviewQuote("quote-1", { decision: "approve_quote", reviewer: "attacker" }, LOCAL_ADMIN_PRINCIPAL);
  await reviews.reviewOrder("order-1", { decision: "approve_confirmation", reviewer: "attacker" }, LOCAL_ADMIN_PRINCIPAL);

  const quotes = new QuotesController({
    queueSend: async (...args) => calls.push(["queueSend", ...args]),
    verifyPaymentProofAndQueueConfirmation: async (...args) => calls.push(["verifyPaymentProof", ...args]),
  });
  await quotes.queueSend(
    "quote-2",
    {
      owner: "attacker",
      actor: "attacker",
      operator: "attacker",
      reviewer: "attacker",
      note: "safe",
      source: "browser",
      queuedBy: "low_value_automation",
      quoteDraftId: "forged-quote",
      orderDraftId: "forged-order",
      paymentStatus: "paid",
      automation: { source: "order_confirmation", valueLevel: "low" },
    },
    LOCAL_ADMIN_PRINCIPAL,
  );
  await quotes.verifyPaymentProof(
    "quote-3",
    { paymentStatus: "paid", owner: "attacker", actor: "attacker", operator: "attacker", reviewer: "attacker" },
    LOCAL_ADMIN_PRINCIPAL,
  );

  const wechat = new WechatController({
    setConversationManualLock: async (...args) => calls.push(["setConversationManualLock", ...args]),
    queueOrderConfirmation: async (...args) => calls.push(["queueOrderConfirmation", ...args]),
    queueOrderFollowup: async (...args) => calls.push(["queueOrderFollowup", ...args]),
  });
  const forgedAutomation = {
    source: "order_followup",
    valueLevel: "low",
    orderDraftId: "forged-order",
    quoteDraftId: "forged-quote",
    paymentStatus: "paid",
    queuedBy: "low_value_automation",
  };
  await wechat.queueOrderConfirmation(
    "order-2",
    {
      ...forgedAutomation,
      automation: forgedAutomation,
      owner: "attacker",
      note: "safe",
      reason: "manual-confirmation",
    },
    LOCAL_ADMIN_PRINCIPAL,
  );
  await wechat.setConversationManualLock(
    "conversation-2",
    {
      expectedWechatAccountId: "wechat-2",
      expectedConversationId: "conversation-2",
      expectedCustomerId: "customer-2",
      locked: true,
      reviewer: "attacker",
      reason: "manual_takeover",
      note: "safe",
      effectKey: "design-job-owned-effect-key",
      automation: forgedAutomation,
    },
    LOCAL_ADMIN_PRINCIPAL,
  );
  await wechat.queueOrderFollowup(
    "order-3",
    {
      ...forgedAutomation,
      automation: forgedAutomation,
      owner: "attacker",
      type: "production",
      reason: "manual-followup",
    },
    LOCAL_ADMIN_PRINCIPAL,
  );

  const training = new TrainingController({
    reviewSample: async (...args) => calls.push(["reviewSample", ...args]),
    batchReviewSamples: async (...args) => calls.push(["batchReviewSamples", ...args]),
  });
  await training.reviewSample("sample-1", { status: "ready", reviewer: "attacker" }, LOCAL_ADMIN_PRINCIPAL);
  await training.batchReviewSamples({ sampleIds: ["sample-1"], status: "ready", reviewer: "attacker" }, LOCAL_ADMIN_PRINCIPAL);

  assert.equal(calls.length, 10);
  for (const [name, _id, payload] of calls) {
    const actualPayload = name === "batchReviewSamples" ? _id : payload;
    assert.equal(actualPayload.reviewer === "attacker" || actualPayload.owner === "attacker", false, name);
    assert.equal(actualPayload.actor, undefined, name);
    assert.equal(actualPayload.operator, undefined, name);
    if (name.startsWith("review") || name === "batchReviewSamples") assert.equal(actualPayload.reviewer, "local_admin", name);
    if (["queueSend", "verifyPaymentProof", "queueOrderConfirmation", "queueOrderFollowup"].includes(name)) {
      assert.equal(actualPayload.owner, "local_admin", name);
    }
    if (["queueSend", "queueOrderConfirmation", "queueOrderFollowup"].includes(name)) {
      assert.equal(actualPayload.automation, undefined, name);
      assert.equal(actualPayload.source, undefined, name);
      assert.equal(actualPayload.queuedBy, undefined, name);
      assert.equal(actualPayload.quoteDraftId, undefined, name);
      assert.equal(actualPayload.orderDraftId, undefined, name);
      assert.equal(actualPayload.paymentStatus, undefined, name);
    }
    if (name === "setConversationManualLock") {
      assert.equal(actualPayload.reviewer, "local_admin");
      assert.equal(actualPayload.effectKey, undefined);
      assert.equal(actualPayload.automation, undefined);
    }
  }
});

test("remaining operator-facing mutation controllers require a trusted local session", () => {
  for (const controllerClass of [
    AgentsController,
    AiProviderController,
    AssetsController,
    CatalogController,
    NotificationsController,
    OrdersController,
    QuotesController,
    RoutingController,
  ]) {
    assert.equal(
      Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, controllerClass),
      "view_console",
      `${controllerClass.name} class boundary`,
    );
  }

  const expectedCapabilities = [
    [AssetsController, "upload", "manage_design_executions"],
    [AssetsController, "createDemoCustomerLogo", "manage_design_executions"],
    [CatalogController, "createDemoSkuImages", "manage_design_executions"],
    [CatalogController, "upsertSku", "manage_design_executions"],
    [CatalogController, "batchUpdateSkus", "manage_design_executions"],
    [CatalogController, "deactivateSku", "manage_design_executions"],
    [CatalogController, "restoreSku", "manage_design_executions"],
    [CatalogController, "bulkUpsert", "manage_design_executions"],
    [CatalogController, "importText", "manage_design_executions"],
    [CatalogController, "importFile", "manage_design_executions"],
    [NotificationsController, "createDemo", "manage_training"],
    [OrdersController, "createFromQuote", "manage_design_executions"],
    [OrdersController, "update", "manage_design_executions"],
    [OrdersController, "updateFulfillment", "manage_order_fulfillment"],
    [OrdersController, "createAfterSales", "manage_order_fulfillment"],
    [OrdersController, "resolveAfterSales", "manage_order_fulfillment"],
    [OrdersController, "reviseSelection", "manage_design_executions"],
    [QuotesController, "update", "manage_design_executions"],
    [QuotesController, "reviseSelection", "manage_design_executions"],
    [RoutingController, "evaluate", "manage_training"],
    [RoutingController, "correctEvaluation", "manage_training"],
  ];
  for (const [controllerClass, methodName, capability] of expectedCapabilities) {
    const handler = controllerClass.prototype[methodName];
    assert.equal(Reflect.getMetadata(OPERATOR_CAPABILITY_METADATA, handler), capability, `${controllerClass.name}.${methodName}`);
  }

  const guard = new OperatorAccessGuard(new Reflector(), new OperatorAccessService());
  for (const [controllerClass, methodName] of [
    [AssetsController, "upload"],
    [CatalogController, "upsertSku"],
    [NotificationsController, "markRead"],
    [OrdersController, "update"],
    [OrdersController, "updateFulfillment"],
    [OrdersController, "createAfterSales"],
    [OrdersController, "resolveAfterSales"],
    [QuotesController, "update"],
    [RoutingController, "correctEvaluation"],
  ]) {
    const handler = controllerClass.prototype[methodName];
    assert.throws(
      () => guard.canActivate(executionContext(handler, controllerClass, { headers: {}, body: {} })),
      (error) => error?.getStatus?.() === 403,
      `${controllerClass.name}.${methodName} missing token`,
    );
    const request = { headers: { [INTERNAL_API_TOKEN_HEADER]: VALID_TOKEN }, body: {} };
    assert.equal(guard.canActivate(executionContext(handler, controllerClass, request)), true);
    assert.equal(request.trustedOperator.id, "local_admin");
  }
});

test("routing correction discards a browser-owned reviewer", async () => {
  const calls = [];
  const controller = new RoutingController({
    correctEvaluation: async (...args) => calls.push(args),
  });
  await controller.correctEvaluation(
    "evaluation-1",
    { agentKey: "sales", reviewer: "attacker", note: "safe" },
    LOCAL_ADMIN_PRINCIPAL,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].reviewer, "local_admin");
  assert.equal(JSON.stringify(calls[0]).includes("attacker"), false);
});

test("generic quote and order mutations bind owner to the trusted operator", async () => {
  const calls = [];
  const quotes = new QuotesController({
    update: async (...args) => calls.push(["quote-update", ...args]),
    reviseSelectedImage: async (...args) => calls.push(["quote-revise", ...args]),
  });
  const orders = new OrdersController({
    update: async (...args) => calls.push(["order-update", ...args]),
    updateFulfillment: async (...args) => calls.push(["order-fulfillment", ...args]),
    createAfterSalesCase: async (...args) => calls.push(["order-after-sales-create", ...args]),
    resolveAfterSalesCase: async (...args) => calls.push(["order-after-sales-resolve", ...args]),
    reviseSelectedImage: async (...args) => calls.push(["order-revise", ...args]),
  });
  const forged = { owner: "attacker", actor: "attacker", operator: "attacker", reviewer: "attacker" };

  await quotes.update("quote-1", { ...forged, status: "manual_review" }, LOCAL_ADMIN_PRINCIPAL);
  await quotes.reviseSelection("quote-1", { ...forged, selectedImageId: "image-1" }, LOCAL_ADMIN_PRINCIPAL);
  await orders.update("order-1", { ...forged, status: "processing" }, LOCAL_ADMIN_PRINCIPAL);
  await orders.updateFulfillment("order-1", { ...forged, operationKey: "order-fulfillment:test", productionStatus: "in_production" }, LOCAL_ADMIN_PRINCIPAL);
  await orders.createAfterSales("order-1", { ...forged, operationKey: "order-after-sales-create:test", type: "replacement", reason: "破损补发" }, LOCAL_ADMIN_PRINCIPAL);
  await orders.resolveAfterSales("order-1", "case-1", { ...forged, operationKey: "order-after-sales-resolve:test", resolutionType: "replacement", replacementTrackingNo: "SF1000" }, LOCAL_ADMIN_PRINCIPAL);
  await orders.reviseSelection("order-1", { ...forged, selectedImageId: "image-1" }, LOCAL_ADMIN_PRINCIPAL);

  assert.equal(calls.length, 7);
  for (const [name, ...args] of calls) {
    const payload = args.findLast((item) => item && typeof item === "object" && !Array.isArray(item));
    assert.equal(payload.owner, "local_admin", name);
    assert.equal(payload.actor, undefined, name);
    assert.equal(payload.operator, undefined, name);
    assert.equal(payload.reviewer, undefined, name);
    assert.equal(JSON.stringify(payload).includes("attacker"), false, name);
  }
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
