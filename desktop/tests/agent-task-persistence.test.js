"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-task-runtime-"));
process.env.LOCAL_STORE_FILE = path.join(tempRoot, "local-store.json");
const { appConfig } = require("../apps/api/src/shared/app-config");
const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { WechatPersistence } = require("../apps/api/src/wechat/wechat-persistence");
const { AgentTaskToolExecutorService } = require("../apps/api/src/agent-tasks/agent-task-tool-executor.service");

test.after(() => {
  appConfig.useLocalStore = true;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("Agent task local persistence is idempotent and hydrates steps and approvals", async () => {
  appConfig.useLocalStore = true;
  const persistence = new WechatPersistence({}, new LocalStoreService());
  const payload = {
    operationKey: "inbound-operation-agent-task-1",
    id: "agent_task_inbound_1",
    status: "awaiting_approval",
    taskType: "customer_service",
    lane: "manual_review",
    routeAction: "human_handoff",
    planType: "manual_review",
    reason: "用户要求人工处理",
    objective: "将对话交接给人工客服",
    identity: {
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_1",
      customerId: "customer_demo_1",
    },
    steps: [
      { key: "capture_context", status: "completed", mode: "system", toolName: "conversation.get_context" },
      { key: "human_handoff", status: "awaiting_approval", mode: "approval", toolName: "conversation.handoff" },
    ],
    approval: {
      policy: "manual_handoff",
      requestedBy: "agent",
      metadata: { reason: "用户明确要求人工" },
    },
  };

  const first = await persistence.createAgentTask(payload);
  const replay = await persistence.createAgentTask({ ...payload, payload: { replay: true } });
  assert.equal(first.id, "agent_task_inbound_1");
  assert.equal(replay.id, first.id);
  assert.equal(replay.steps.length, 2);
  assert.equal(replay.steps[1].status, "awaiting_approval");
  assert.equal(replay.approvals.length, 1);
  assert.equal(replay.approvals[0].policy, "manual_handoff");
  assert.equal(replay.toolExecutions.length, 2);
  assert.equal(replay.toolExecutions[0].toolName, "conversation.get_context");
  assert.equal(replay.toolExecutions[0].effect, "unknown");

  const filtered = await persistence.listAgentTasks({
    status: "awaiting_approval",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
  });
  assert.deepEqual(filtered.map((task) => task.id), [first.id]);
  assert.equal(await persistence.getAgentTask("missing-agent-task"), null);

  const completed = await persistence.updateAgentTask(first.id, {
    status: "succeeded",
    currentStep: "human_handoff",
    handoff: { queue: "vip-support", contextComplete: true },
  });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.currentStep, "human_handoff");
  assert.ok(completed.completedAt);
  assert.deepEqual(completed.handoff, { queue: "vip-support", contextComplete: true });
});

test("Agent task replay rejects an identity change", async () => {
  appConfig.useLocalStore = true;
  const persistence = new WechatPersistence({}, new LocalStoreService());
  const payload = {
    operationKey: "inbound-operation-agent-task-identity",
    objective: "查询订单状态",
    identity: {
      wechatAccountId: "wechat_demo_1",
      conversationId: "conversation_demo_2",
      customerId: "customer_demo_2",
    },
  };
  await persistence.createAgentTask(payload);
  await assert.rejects(
    () => persistence.createAgentTask({
      ...payload,
      identity: { ...payload.identity, customerId: "customer_other" },
    }),
    /replay changed customerId/,
  );
});

test("Agent task follows the linked outbound send lifecycle", async () => {
  appConfig.useLocalStore = true;
  const store = new LocalStoreService();
  const persistence = new WechatPersistence({}, store);
  const conversation = store.listConversations()[0];
  const task = await persistence.createAgentTask({
    operationKey: "inbound-operation-agent-task-send-sync",
    objective: "发送客服答复",
    identity: {
      wechatAccountId: conversation.wechatAccountId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
    },
  });
  const sendTask = await persistence.createSendTask({
    operationKey: "send-operation-agent-task-send-sync",
    wechatAccountId: conversation.wechatAccountId,
    conversationId: conversation.id,
    customerId: conversation.customerId,
    payload: { agentTaskId: task.id },
  });
  assert.equal((await persistence.getAgentTask(task.id)).status, "executing");
  await persistence.updateSendTask(sendTask.id, { status: "sent", sentAt: new Date().toISOString() });
  const completed = await persistence.getAgentTask(task.id);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.currentStep, "reply.sent");
});

test("Agent task persistence is wired to a protected read-only API contract", () => {
  const root = path.join(__dirname, "..");
  const controller = fs.readFileSync(path.join(root, "apps", "api", "src", "agent-tasks", "agent-tasks.controller.ts"), "utf8");
  const moduleSource = fs.readFileSync(path.join(root, "apps", "api", "src", "app.module.ts"), "utf8");
  const migration = fs.readFileSync(
    path.join(root, "prisma", "migrations", "20260820110000_agent_task_runtime", "migration.sql"),
    "utf8",
  );
  assert.match(controller, /@Controller\("agent-tasks"\)/);
  assert.match(controller, /@RequireOperatorCapability\("view_console"\)/);
  assert.match(controller, /@Get\("?:id"\)/);
  assert.match(controller, /@Post\(":id\/approvals\/:approvalId\/decision"\)/);
  assert.match(controller, /@RequireOperatorCapability\("approve_send"\)/);
  assert.match(controller, /@Post\(":id\/tool-executions\/:executionId\/execute"\)/);
  assert.match(controller, /@RequireOperatorCapability\("execute_agent_skills"\)/);
  assert.match(controller, /@Post\(":id\/tool-executions\/:executionId\/preview"\)/);
  assert.match(controller, /@Post\(":id\/tool-executions\/:executionId\/verify"\)/);
  assert.match(moduleSource, /AgentTasksController/);
  assert.match(moduleSource, /AgentTaskToolExecutorService/);
  assert.match(moduleSource, /WechatPersistence/);
  assert.match(migration, /CREATE TABLE "AgentTask"/);
  assert.match(migration, /CREATE TABLE "AgentTaskStep"/);
  assert.match(migration, /CREATE TABLE "AgentTaskApproval"/);
  assert.match(migration, /CREATE TABLE "AgentTaskToolExecution"/);
  assert.match(migration, /AgentTaskToolExecution_operationKey_key/);
});

test("Agent task approval is an atomic, idempotent state transition", async () => {
  appConfig.useLocalStore = true;
  const persistence = new WechatPersistence({}, new LocalStoreService());
  const task = await persistence.createAgentTask({
    operationKey: "inbound-operation-agent-task-approval-transition",
    status: "awaiting_approval",
    objective: "转交人工客服",
    steps: [{ key: "human.review", mode: "approval", status: "pending" }],
    approval: { policy: "human", metadata: { source: "test" } },
  });
  const approval = task.approvals[0];
  const approved = await persistence.decideAgentTaskApproval(task.id, approval.id, {
    decision: "approved",
    reviewer: "主管",
    note: "确认交接",
  });
  assert.equal(approved.status, "ready");
  assert.equal(approved.steps[0].status, "approved");
  assert.equal(approved.approvals[0].reviewer, "主管");
  assert.equal(approved.approvals[0].decisionNote, "确认交接");
  const replay = await persistence.decideAgentTaskApproval(task.id, approval.id, { decision: "approved" });
  assert.equal(replay.status, "ready");
  await assert.rejects(
    () => persistence.decideAgentTaskApproval(task.id, approval.id, { decision: "rejected" }),
    /already been decided/,
  );
});

test("Agent task read tool executor binds identity, audits result, and replays safely", async () => {
  appConfig.useLocalStore = true;
  const persistence = new WechatPersistence({}, new LocalStoreService());
  const task = await persistence.createAgentTask({
    operationKey: "inbound-operation-agent-tool-order-query",
    status: "ready",
    objective: "查询订单状态",
    identity: {
      wechatAccountId: "wechat_tool_1",
      conversationId: "conversation_tool_1",
      customerId: "customer_tool_1",
    },
    steps: [{ key: "order.query", mode: "tool", tool: "order.query", status: "planned" }],
  });
  const execution = task.toolExecutions[0];
  const orders = {
    async list(filter) {
      assert.deepEqual(filter, {
        wechatAccountId: "wechat_tool_1",
        conversationId: "conversation_tool_1",
        customerId: "customer_tool_1",
      });
      return [{
        id: "order_tool_1",
        quoteDraftId: "quote_tool_1",
        designJobId: "design_tool_1",
        customerId: filter.customerId,
        conversationId: filter.conversationId,
        wechatAccountId: filter.wechatAccountId,
        quantity: 2,
        unitPrice: 10,
        totalPrice: 20,
        status: "draft",
        paymentStatus: "unpaid",
        productionStatus: "not_started",
        owner: "客服",
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:01.000Z",
        totalCost: 999,
      }];
    },
    async getById() {
      throw new Error("getById should not be called for list query");
    },
    async refundEligibility() {
      throw new Error("refundEligibility should not be called for order query");
    },
  };
  const executor = new AgentTaskToolExecutorService(persistence, orders);
  const first = await executor.execute(task.id, execution.id, {
    idempotencyKey: "tool-read-order-query-1",
    input: { limit: 10 },
  }, "operator-test");
  assert.equal(first.status, "succeeded");
  assert.equal(first.replayed, false);
  assert.equal(first.result.orders[0].id, "order_tool_1");
  assert.equal(first.result.orders[0].totalCost, undefined);
  const stored = await persistence.getAgentTaskToolExecution(execution.id);
  assert.equal(stored.status, "succeeded");
  assert.equal(stored.idempotencyKey, "tool-read-order-query-1");
  assert.equal((await persistence.getAgentTask(task.id)).status, "ready");

  const replay = await executor.execute(task.id, execution.id, {
    idempotencyKey: "tool-read-order-query-1",
    input: { limit: 10 },
  }, "operator-test");
  assert.equal(replay.replayed, true);
  await assert.rejects(
    () => executor.execute(task.id, execution.id, {
      idempotencyKey: "tool-read-order-query-other",
      input: { limit: 10 },
    }, "operator-test"),
    /different.*幂等键|不同的幂等键/,
  );
});

test("Agent task refund eligibility read tool reuses the order service policy snapshot", async () => {
  appConfig.useLocalStore = true;
  const persistence = new WechatPersistence({}, new LocalStoreService());
  const task = await persistence.createAgentTask({
    operationKey: "inbound-operation-agent-tool-refund-eligibility",
    status: "ready",
    identity: {
      wechatAccountId: "wechat_tool_2",
      conversationId: "conversation_tool_2",
      customerId: "customer_tool_2",
    },
    steps: [{ key: "refund.eligibility", mode: "tool", tool: "refund.eligibility", status: "planned" }],
  });
  const calls = [];
  const orders = {
    async refundEligibility(id, expected) {
      calls.push({ id, expected });
      return { orderDraftId: id, eligible: true, paymentSummary: { refundableAmountCny: 88 } };
    },
    async list() { throw new Error("list should not be called"); },
    async getById() { throw new Error("getById should not be called"); },
  };
  const executor = new AgentTaskToolExecutorService(persistence, orders);
  const result = await executor.execute(task.id, task.toolExecutions[0].id, {
    idempotencyKey: "tool-read-refund-eligibility-1",
    input: { orderDraftId: "order_tool_2" },
  });
  assert.equal(result.result.eligible, true);
  assert.deepEqual(calls, [{
    id: "order_tool_2",
    expected: {
      expectedWechatAccountId: "wechat_tool_2",
      expectedConversationId: "conversation_tool_2",
      expectedCustomerId: "customer_tool_2",
    },
  }]);
});

test("Agent task write tool preview records facts without mutating business data", async () => {
  appConfig.useLocalStore = true;
  const persistence = new WechatPersistence({}, new LocalStoreService());
  const task = await persistence.createAgentTask({
    operationKey: "inbound-operation-agent-tool-after-sales-preview",
    status: "ready",
    identity: {
      wechatAccountId: "wechat_tool_3",
      conversationId: "conversation_tool_3",
      customerId: "customer_tool_3",
    },
    steps: [{ key: "after_sales.case.create", mode: "tool", tool: "after_sales.case.create", status: "planned" }],
  });
  const calls = [];
  const orders = {
    async afterSalesCasePreview(id, payload) {
      calls.push({ id, payload });
      return {
        phase: "preview",
        noWrite: true,
        orderDraftId: id,
        paymentSummary: { refundableAmountCny: 88 },
        requiresHumanReview: true,
      };
    },
    async createAfterSalesCase(id, payload) {
      calls.push({ action: "execute", id, payload });
      return { id: "case_tool_3", orderDraftId: id, status: "open" };
    },
    async listAfterSalesCases() {
      return [{ id: "case_tool_3", status: "open" }];
    },
    async list() { throw new Error("list should not be called"); },
    async getById() { throw new Error("getById should not be called"); },
    async refundEligibility() { throw new Error("refundEligibility should not be called"); },
  };
  const executor = new AgentTaskToolExecutorService(persistence, orders);
  const first = await executor.preview(task.id, task.toolExecutions[0].id, {
    idempotencyKey: "tool-preview-after-sales-1",
    input: {
      orderDraftId: "order_tool_3",
      type: "refund",
      reason: "客户申请退款",
      requestedAmountCny: 50,
      evidenceReference: "chat:123",
    },
  });
  assert.equal(first.status, "previewed");
  assert.equal(first.result.noWrite, true);
  assert.equal(first.task.status, "awaiting_approval");
  assert.equal(first.approval.status, "pending");
  assert.equal(first.approval.metadata.toolExecutionId, task.toolExecutions[0].id);
  assert.equal((await persistence.getAgentTask(task.id)).status, "awaiting_approval");
  assert.equal((await persistence.getAgentTaskToolExecution(task.toolExecutions[0].id)).status, "previewed");
  assert.deepEqual(calls, [{
    id: "order_tool_3",
    payload: {
      type: "refund",
      reason: "客户申请退款",
      requestedAmountCny: 50,
      evidenceReference: "chat:123",
      desiredResolution: undefined,
      expectedWechatAccountId: "wechat_tool_3",
      expectedConversationId: "conversation_tool_3",
      expectedCustomerId: "customer_tool_3",
    },
  }]);
  const replay = await executor.preview(task.id, task.toolExecutions[0].id, {
    idempotencyKey: "tool-preview-after-sales-1",
    input: {
      orderDraftId: "order_tool_3",
      type: "refund",
      reason: "客户申请退款",
      requestedAmountCny: 50,
      evidenceReference: "chat:123",
    },
  });
  assert.equal(replay.replayed, true);
  const approved = await persistence.decideAgentTaskApproval(task.id, first.approval.id, {
    decision: "approved",
    reviewer: "主管",
    note: "金额和证据已核对，允许进入执行阶段",
  });
  assert.equal(approved.status, "ready");
  assert.equal(approved.approvals[0].status, "approved");
  const executed = await executor.execute(task.id, task.toolExecutions[0].id, {
    idempotencyKey: "tool-preview-after-sales-1",
    input: {
      orderDraftId: "order_tool_3",
      type: "refund",
      reason: "客户申请退款",
      requestedAmountCny: 50,
      evidenceReference: "chat:123",
    },
  }, "operator-test");
  assert.equal(executed.status, "succeeded");
  assert.equal(executed.result.id, "case_tool_3");
  assert.equal((await persistence.getAgentTaskToolExecution(task.toolExecutions[0].id)).status, "succeeded");
  assert.equal(calls[1].action, "execute");
  assert.equal(calls[1].payload.operationKey, "tool-preview-after-sales-1");
  const verified = await executor.verify(task.id, task.toolExecutions[0].id, "operator-test");
  assert.equal(verified.status, "verified");
  assert.equal(verified.verification.verified, true);
  assert.equal((await persistence.getAgentTaskToolExecution(task.toolExecutions[0].id)).status, "verified");
});
