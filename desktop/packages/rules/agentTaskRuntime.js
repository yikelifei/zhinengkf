"use strict";

/**
 * The first durable seam for the controlled Agent runtime.
 *
 * This module deliberately contains policy and planning only. It does not
 * execute business mutations and it does not call a model. Existing services
 * remain the executors; this module gives them a stable task/tool contract.
 */

const TASK_STATUS = Object.freeze({
  CREATED: "created",
  COLLECTING: "collecting",
  READY: "ready",
  AWAITING_APPROVAL: "awaiting_approval",
  EXECUTING: "executing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  UNKNOWN_OUTCOME: "unknown_outcome",
  HANDED_OFF: "handed_off",
});

const TOOL_EFFECT = Object.freeze({
  READ: "read",
  DRAFT_WRITE: "draft_write",
  BUSINESS_WRITE: "business_write",
  EXTERNAL_SIDE_EFFECT: "external_side_effect",
});

const APPROVAL_POLICY = Object.freeze({
  NONE: "none",
  HUMAN: "human",
  TWO_PERSON: "two_person",
});

const TOOL_DEFINITIONS = Object.freeze([
  tool("catalog.search", TOOL_EFFECT.READ, "view_catalog", APPROVAL_POLICY.NONE),
  tool("customer.profile.get", TOOL_EFFECT.READ, "view_customer", APPROVAL_POLICY.NONE),
  tool("order.query", TOOL_EFFECT.READ, "view_orders", APPROVAL_POLICY.NONE),
  tool("logistics.query", TOOL_EFFECT.READ, "view_logistics", APPROVAL_POLICY.NONE),
  tool("design.status", TOOL_EFFECT.READ, "view_design_jobs", APPROVAL_POLICY.NONE),
  tool("refund.eligibility", TOOL_EFFECT.READ, "view_orders", APPROVAL_POLICY.NONE),
  tool("customer.note.append", TOOL_EFFECT.DRAFT_WRITE, "manage_customers", APPROVAL_POLICY.NONE),
  tool("design.request.create", TOOL_EFFECT.DRAFT_WRITE, "manage_design_executions", APPROVAL_POLICY.NONE),
  tool("quote.draft.create", TOOL_EFFECT.DRAFT_WRITE, "manage_quotes", APPROVAL_POLICY.NONE),
  tool("after_sales.case.create", TOOL_EFFECT.DRAFT_WRITE, "manage_order_fulfillment", APPROVAL_POLICY.HUMAN),
  tool("order.address_change.execute", TOOL_EFFECT.BUSINESS_WRITE, "manage_order_fulfillment", APPROVAL_POLICY.HUMAN),
  tool("order.cancel.execute", TOOL_EFFECT.BUSINESS_WRITE, "manage_order_fulfillment", APPROVAL_POLICY.HUMAN),
  tool("refund.execute", TOOL_EFFECT.EXTERNAL_SIDE_EFFECT, "execute_refunds", APPROVAL_POLICY.TWO_PERSON),
  tool("refund.verify", TOOL_EFFECT.READ, "view_refunds", APPROVAL_POLICY.NONE),
]);

const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map((item) => [item.name, item]));

function tool(name, effect, requiredCapability, approvalPolicy) {
  return Object.freeze({
    name,
    version: "1",
    effect,
    requiredCapability,
    approvalPolicy,
    timeoutMs: effect === TOOL_EFFECT.READ ? 5000 : 10000,
    retryPolicy: effect === TOOL_EFFECT.READ ? "safe_read_only" : "never_unknown_outcome",
    requiresIdempotencyKey: effect !== TOOL_EFFECT.READ,
  });
}

function listToolDefinitions() {
  return TOOL_DEFINITIONS.map((item) => ({ ...item }));
}

function getToolDefinition(name) {
  const item = TOOL_BY_NAME.get(String(name || "").trim());
  return item ? { ...item } : null;
}

/**
 * Evaluate a proposed tool invocation. A true result only means the
 * invocation satisfies policy; the caller still has to execute the existing
 * business service and persist the result.
 */
function evaluateToolInvocation(name, input = {}) {
  const definition = TOOL_BY_NAME.get(String(name || "").trim());
  if (!definition) return denied("unknown_tool", "工具未注册");

  const identity = normalizeIdentity(input.identity || input);
  const missingIdentity = ["wechatAccountId", "conversationId", "customerId"]
    .filter((key) => !identity[key]);
  if (missingIdentity.length) {
    return denied("identity_required", `缺少身份绑定：${missingIdentity.join(",")}`, definition);
  }

  if (definition.requiresIdempotencyKey && !String(input.idempotencyKey || "").trim()) {
    return denied("idempotency_required", "写操作必须提供幂等键", definition);
  }

  const capabilities = new Set(normalizeList(input.capabilities));
  if (definition.requiredCapability && !capabilities.has(definition.requiredCapability)) {
    return denied("capability_required", `缺少工具权限：${definition.requiredCapability}`, definition);
  }

  const routePolicy = input.routingPolicy && typeof input.routingPolicy === "object"
    ? input.routingPolicy
    : {};
  const routeManualRequired = routePolicy.manualRequired === true;
  const approval = String(input.approvalStatus || "").trim();
  const executionPhase = String(input.executionPhase || "execute").trim().toLowerCase() || "execute";
  const previewPhase = executionPhase === "preview";
  if (!previewPhase && routeManualRequired && definition.effect !== TOOL_EFFECT.READ && approval !== "approved") {
    return denied("route_manual_review_required", "当前路由要求人工审核", definition);
  }
  if (!previewPhase && definition.approvalPolicy !== APPROVAL_POLICY.NONE && approval !== "approved") {
    return denied("approval_required", `需要${definition.approvalPolicy === APPROVAL_POLICY.TWO_PERSON ? "双人" : "人工"}审批`, definition);
  }

  return {
    allowed: true,
    reason: "policy_passed",
    definition,
    identity,
    audit: {
      tool: definition.name,
      effect: definition.effect,
      executionPhase,
      approvalPolicy: definition.approvalPolicy,
      idempotencyKey: definition.requiresIdempotencyKey ? String(input.idempotencyKey).trim() : null,
    },
  };
}

function denied(reason, message, definition = null) {
  return {
    allowed: false,
    reason,
    message,
    definition,
  };
}

/**
 * Create a deterministic task envelope from the existing route and inbound
 * automation plan. The envelope is safe to persist in a send task payload or
 * a future AgentTask table.
 */
function buildAgentTaskPlan({ input = {}, route = {}, plan = {} } = {}) {
  const identity = normalizeIdentity({
    wechatAccountId: input.wechatAccountId || route.wechatAccountId,
    conversationId: input.conversationId || route.conversationId,
    customerId: input.customerId || route.customerId,
  });
  const missingFields = normalizeList(plan.missingFields || route.missingFields);
  const routingPolicy = plan.routingPolicy || route.routingPolicy || {};
  const manualRequired = routingPolicy.manualRequired === true;
  const humanReview = plan.shouldNotifyHuman === true || manualRequired;
  const status = humanReview
    ? TASK_STATUS.AWAITING_APPROVAL
    : missingFields.length
      ? TASK_STATUS.COLLECTING
      : TASK_STATUS.READY;
  const steps = inferTaskSteps(route, plan, missingFields);
  const operationKey = firstText(
    input.operationKey,
    input.inboundMessageId,
    input.messageId,
    route.operationKey,
    identity.conversationId && route.text ? `${identity.conversationId}:${route.text}` : "",
  ) || "unbound";

  return {
    version: "agent_task_plan_v1",
    id: `agent-task:${stableKey(operationKey)}`,
    status,
    taskType: taskTypeFor(route, plan),
    identity,
    objective: truncate(firstText(route.text, input.customerText), 500),
    lane: firstText(routingPolicy.lane, route.action, "unknown"),
    routeAction: firstText(route.action, "unknown"),
    planType: firstText(plan.type, "queue_reply"),
    reason: firstText(plan.reason, "inbound_route"),
    missingFields,
    nextStep: nextTaskStep(status, steps),
    steps,
    handoff: humanReview ? buildHandoffSnapshot({ input, route, plan, identity, missingFields }) : null,
    createdFrom: {
      routeId: firstText(route.id),
      inboundMessageId: firstText(input.inboundMessageId, input.messageId),
    },
  };
}

function inferTaskSteps(route, plan, missingFields) {
  if (plan.shouldNotifyHuman === true || plan.routingPolicy?.manualRequired === true) {
    return [{ key: "human.review", mode: "approval", tool: null, status: "pending" }];
  }
  if (missingFields.length) {
    return [{ key: "conversation.collect_info", mode: "conversation", tool: null, status: "pending" }];
  }
  if (plan.shouldCreateDesignJob === true) {
    return [{ key: "design.request.create", mode: "tool", tool: "design.request.create", status: "planned" }];
  }
  const agentKey = String(route.agentKey || "");
  if (agentKey === "after_sales") {
    return [{ key: "refund.eligibility", mode: "tool", tool: "refund.eligibility", status: "planned" }];
  }
  if (agentKey === "logistics_exception") {
    return [{ key: "logistics.query", mode: "tool", tool: "logistics.query", status: "planned" }];
  }
  if (agentKey === "order_payment") {
    return [{ key: "order.query", mode: "tool", tool: "order.query", status: "planned" }];
  }
  if (["pre_sales", "gift_design"].includes(agentKey)) {
    return [{ key: "catalog.search", mode: "tool", tool: "catalog.search", status: "planned" }];
  }
  return [{ key: "reply.compose", mode: "conversation", tool: null, status: "planned" }];
}

function buildHandoffSnapshot({ input, route, plan, identity, missingFields }) {
  return {
    version: "handoff_snapshot_v1",
    reason: firstText(plan.reason, route.routingPolicy?.reason, "需要人工处理"),
    customerText: truncate(firstText(input.customerText, route.text), 500),
    riskFlags: normalizeList(route.riskFlags),
    scene: firstText(route.scene, route.agentKey),
    agentKey: firstText(route.agentKey),
    knownFacts: {
      budget: route.budget || null,
      salesContext: route.salesContext || null,
    },
    missingFields,
    identity,
    suggestedNextStep: firstText(
      plan.routingPolicy?.nextStep,
      route.routingPolicy?.nextStep,
      "人工核验后继续处理",
    ),
    autoResume: false,
  };
}

function taskTypeFor(route, plan) {
  if (plan.shouldCreateDesignJob) return "design_request";
  if (route.agentKey === "after_sales") return "after_sales";
  if (route.agentKey === "logistics_exception") return "logistics";
  if (route.agentKey === "order_payment") return "order_payment";
  if (route.agentKey === "pre_sales" || route.agentKey === "gift_design") return "sales_consultation";
  return "customer_service";
}

function nextTaskStep(status, steps) {
  if (status === TASK_STATUS.AWAITING_APPROVAL) return "human.review";
  return steps[0]?.key || "reply.compose";
}

function normalizeIdentity(value = {}) {
  return {
    wechatAccountId: firstText(value.wechatAccountId),
    conversationId: firstText(value.conversationId),
    customerId: firstText(value.customerId),
  };
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => (typeof item === "string" ? item : item?.id || item?.key))
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
}

function firstText(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function stableKey(value) {
  return String(value || "unbound")
    .trim()
    .replace(/[^\p{L}\p{N}_:-]+/gu, "-")
    .slice(0, 160) || "unbound";
}

module.exports = {
  APPROVAL_POLICY,
  TASK_STATUS,
  TOOL_EFFECT,
  buildAgentTaskPlan,
  evaluateToolInvocation,
  getToolDefinition,
  listToolDefinitions,
};
