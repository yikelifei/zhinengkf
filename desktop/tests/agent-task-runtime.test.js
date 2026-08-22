"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  APPROVAL_POLICY,
  TASK_STATUS,
  TOOL_EFFECT,
  buildAgentTaskPlan,
  evaluateToolInvocation,
  getToolDefinition,
  listToolDefinitions,
  planInboundAutomation,
} = require("../packages/rules");

const identity = {
  wechatAccountId: "wechat-account-1",
  conversationId: "conversation-1",
  customerId: "customer-1",
};

test("tool registry distinguishes read tools from irreversible business effects", () => {
  const refund = getToolDefinition("refund.execute");
  assert.equal(refund.effect, TOOL_EFFECT.EXTERNAL_SIDE_EFFECT);
  assert.equal(refund.approvalPolicy, APPROVAL_POLICY.TWO_PERSON);
  assert.equal(refund.requiresIdempotencyKey, true);
  assert.ok(listToolDefinitions().some((item) => item.name === "order.query"));
});

test("read-only tool invocation requires identity and capability", () => {
  const missingIdentity = evaluateToolInvocation("order.query", { capabilities: ["view_orders"] });
  assert.equal(missingIdentity.allowed, false);
  assert.equal(missingIdentity.reason, "identity_required");

  const missingCapability = evaluateToolInvocation("order.query", { identity });
  assert.equal(missingCapability.allowed, false);
  assert.equal(missingCapability.reason, "capability_required");

  const allowed = evaluateToolInvocation("order.query", {
    identity,
    capabilities: ["view_orders"],
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.definition.effect, TOOL_EFFECT.READ);
});

test("business tool invocation fails closed until approval and idempotency are present", () => {
  const missingIdempotency = evaluateToolInvocation("refund.execute", {
    identity,
    capabilities: ["execute_refunds"],
    approvalStatus: "approved",
  });
  assert.equal(missingIdempotency.allowed, false);
  assert.equal(missingIdempotency.reason, "idempotency_required");

  const missingApproval = evaluateToolInvocation("refund.execute", {
    identity,
    capabilities: ["execute_refunds"],
    idempotencyKey: "refund:case-1:attempt-1",
  });
  assert.equal(missingApproval.allowed, false);
  assert.equal(missingApproval.reason, "approval_required");

  const allowed = evaluateToolInvocation("refund.execute", {
    identity,
    capabilities: ["execute_refunds"],
    idempotencyKey: "refund:case-1:attempt-1",
    approvalStatus: "approved",
  });
  assert.equal(allowed.allowed, true);
});

test("write tool preview bypasses mutation approval but keeps identity, capability and idempotency gates", () => {
  const preview = evaluateToolInvocation("refund.execute", {
    identity,
    capabilities: ["execute_refunds"],
    idempotencyKey: "refund:case-1:preview-1",
    executionPhase: "preview",
    approvalStatus: "preview",
  });
  assert.equal(preview.allowed, true);
  assert.equal(preview.audit.executionPhase, "preview");
});

test("task plan records collection state and the next safe step", () => {
  const task = buildAgentTaskPlan({
    input: { ...identity, inboundMessageId: "message-1", customerText: "我要查订单" },
    route: {
      ...identity,
      agentKey: "order_payment",
      action: "collect_info",
      text: "我要查订单",
      missingFields: ["order_or_payment_info"],
      routingPolicy: { lane: "info_collection", canAskClarification: true },
    },
    plan: {
      type: "queue_reply",
      reason: "missing_required_info",
      missingFields: ["order_or_payment_info"],
      routingPolicy: { lane: "info_collection", canAskClarification: true },
    },
  });

  assert.equal(task.status, TASK_STATUS.COLLECTING);
  assert.equal(task.taskType, "order_payment");
  assert.equal(task.nextStep, "conversation.collect_info");
  assert.deepEqual(task.identity, identity);
  assert.equal(task.handoff, null);
});

test("manual route creates an approval task and a bounded handoff snapshot", () => {
  const task = buildAgentTaskPlan({
    input: { ...identity, inboundMessageId: "message-2", customerText: "我要投诉并申请赔偿" },
    route: {
      ...identity,
      agentKey: "after_sales",
      action: "manual_review",
      scene: "售后安抚",
      text: "我要投诉并申请赔偿",
      riskFlags: ["投诉", "赔偿"],
      missingFields: ["order_or_evidence"],
    },
    plan: {
      type: "queue_reply",
      reason: "risk_or_sensitive_route",
      shouldNotifyHuman: true,
      routingPolicy: { lane: "risk_human", manualRequired: true, nextStep: "人工核验订单和凭证" },
    },
  });

  assert.equal(task.status, TASK_STATUS.AWAITING_APPROVAL);
  assert.equal(task.nextStep, "human.review");
  assert.equal(task.handoff.reason, "risk_or_sensitive_route");
  assert.deepEqual(task.handoff.riskFlags, ["投诉", "赔偿"]);
  assert.equal(task.handoff.autoResume, false);
});

test("inbound automation exposes the task envelope without changing its existing action", () => {
  const plan = planInboundAutomation({
    conversationId: identity.conversationId,
    customerId: identity.customerId,
    wechatAccountId: identity.wechatAccountId,
    inboundMessageId: "message-3",
    customerText: "我要查物流",
    route: {
      ...identity,
      agentKey: "logistics_exception",
      action: "collect_info",
      text: "我要查物流",
      missingFields: ["order_or_tracking"],
      routingPolicy: { lane: "info_collection", canAskClarification: true },
    },
  });

  assert.equal(plan.type, "queue_reply");
  assert.equal(plan.reason, "missing_required_info");
  assert.equal(plan.agentTask.version, "agent_task_plan_v1");
  assert.equal(plan.agentTask.status, TASK_STATUS.COLLECTING);
  assert.equal(plan.agentTask.identity.conversationId, identity.conversationId);
});
