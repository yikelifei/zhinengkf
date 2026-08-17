"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { ConversationOperationsService } = require("../apps/api/src/conversation-ops/conversation-operations.service");
const { appConfig } = require("../apps/api/src/shared/app-config");

function setup(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-operations-"));
  const previousUseLocalStore = appConfig.useLocalStore;
  appConfig.useLocalStore = true;
  t.after(() => {
    appConfig.useLocalStore = previousUseLocalStore;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  const service = new ConversationOperationsService(localStore);
  return { localStore, service };
}

const identityOne = {
  wechatAccountId: "wechat_demo_1",
  conversationId: "conversation_demo_1",
  customerId: "customer_demo_1",
};

function updatePayload(patch = {}) {
  return {
    expectedWechatAccountId: identityOne.wechatAccountId,
    expectedConversationId: identityOne.conversationId,
    expectedCustomerId: identityOne.customerId,
    operator: "operator-test-1",
    ...patch,
  };
}

function assertHttpError(fn, status, pattern) {
  assert.throws(fn, (error) => {
    assert.equal(error.getStatus(), status);
    assert.match(error.message, pattern);
    return true;
  });
}

test("legacy conversations are exposed as unassigned with explicit no_sla defaults", (t) => {
  const { service } = setup(t);
  const result = service.listQueue({ limit: 20 });
  const record = result.records.find((item) => item.id === identityOne.conversationId);

  assert.ok(record);
  assert.equal(record.assignee, null);
  assert.equal(record.assignmentState, "unassigned");
  assert.equal(record.priority, "normal");
  assert.equal(record.status, "open");
  assert.equal(record.slaDueAt, null);
  assert.equal(record.firstResponseDueAt, null);
  assert.equal(record.slaState, "no_sla");
  assert.equal(record.isOverdue, false);
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.unassigned, 2);
  assert.equal(result.summary.needsAttention, 2);
  assert.equal(result.summary.noSla, 2);
});

test("needsAttention counts the union of overdue and unassigned conversations without double counting", (t) => {
  const { service } = setup(t);
  service.updateConversation(
    identityOne.conversationId,
    updatePayload({ slaDueAt: "2020-01-02T08:00:00.000Z" }),
  );

  const queue = service.listQueue({ limit: 1 });
  assert.equal(queue.records.length, 1, "record pagination should not change summary scope");
  assert.equal(queue.summary.unassigned, 2);
  assert.equal(queue.summary.overdue, 1);
  assert.equal(queue.summary.needsAttention, 2, "the overdue unassigned conversation must be counted once");
  assert.equal(service.getQueueSummary().needsAttention, 2);
});

test("explicit assignment, priority, lifecycle, and SLA updates persist with one identity-bound audit", (t) => {
  const { localStore, service } = setup(t);
  const slaDueAt = "2035-05-02T08:00:00.000Z";
  const firstResponseDueAt = "2035-05-01T08:15:00.000Z";
  const result = service.updateConversation(
    identityOne.conversationId,
    updatePayload({
      assignee: "operator-42",
      priority: "urgent",
      status: "pending",
      slaDueAt,
      firstResponseDueAt,
      reason: "explicit test assignment",
    }),
  );

  assert.deepEqual(result.changedFields, ["assignee", "priority", "status", "slaDueAt", "firstResponseDueAt"]);
  assert.equal(result.conversation.assignee, "operator-42");
  assert.equal(result.conversation.assignmentState, "assigned");
  assert.equal(result.conversation.priority, "urgent");
  assert.equal(result.conversation.status, "pending");
  assert.equal(result.conversation.slaDueAt, slaDueAt);
  assert.equal(result.conversation.firstResponseDueAt, firstResponseDueAt);
  assert.equal(result.conversation.slaState, "on_track");
  assert.equal(result.audit.reviewer, "operator-test-1");
  assert.equal(result.audit.decision, "conversation_operations_update");
  assert.equal(result.audit.metadata.auditType, "conversation_operations");
  assert.deepEqual(result.audit.metadata.changedFields, result.changedFields);
  assert.equal(result.audit.metadata.wechatAccountId, identityOne.wechatAccountId);
  assert.equal(result.audit.metadata.conversationId, identityOne.conversationId);
  assert.equal(result.audit.metadata.customerId, identityOne.customerId);

  const persisted = new ConversationOperationsService(localStore).getConversation(identityOne);
  assert.equal(persisted.assignee, "operator-42");
  assert.equal(persisted.priority, "urgent");
  assert.equal(service.listAudit(identityOne).length, 1);
});

test("updates require the complete matching account, conversation, and customer identity", (t) => {
  const { service } = setup(t);

  assertHttpError(
    () => service.updateConversation(identityOne.conversationId, { assignee: "operator-42", operator: "operator-test-1" }),
    400,
    /requires complete identity/,
  );
  assertHttpError(
    () =>
      service.updateConversation(
        identityOne.conversationId,
        updatePayload({ expectedWechatAccountId: "wechat_demo_2", assignee: "operator-42" }),
      ),
    400,
    /identity mismatch: wechatAccountId/,
  );
  assertHttpError(
    () =>
      service.updateConversation(
        identityOne.conversationId,
        updatePayload({ expectedCustomerId: "customer_demo_2", assignee: "operator-42" }),
      ),
    400,
    /identity mismatch: customerId/,
  );
  assertHttpError(
    () =>
      service.updateConversation(
        identityOne.conversationId,
        updatePayload({ expectedConversationId: "conversation_demo_2", assignee: "operator-42" }),
      ),
    400,
    /must match path id/,
  );
  assert.equal(service.getConversation(identityOne).assignmentState, "unassigned");
  assert.equal(service.listAudit(identityOne).length, 0);
});

test("updates reject invented lifecycle values, invalid dates, missing operators, and empty patches", (t) => {
  const { service } = setup(t);

  assertHttpError(
    () => service.updateConversation(identityOne.conversationId, updatePayload({ priority: "super_urgent" })),
    400,
    /invalid priority/,
  );
  assertHttpError(
    () => service.updateConversation(identityOne.conversationId, updatePayload({ status: "waiting_for_manager" })),
    400,
    /invalid status/,
  );
  assertHttpError(
    () => service.updateConversation(identityOne.conversationId, updatePayload({ slaDueAt: "not-a-date" })),
    400,
    /valid ISO date/,
  );
  assertHttpError(
    () => service.updateConversation(identityOne.conversationId, { ...updatePayload({ assignee: "operator-42" }), operator: "" }),
    400,
    /requires operator/,
  );
  assertHttpError(
    () => service.updateConversation(identityOne.conversationId, updatePayload()),
    400,
    /requires at least one/,
  );
});

test("queue filters and summary report real overdue, assignment, priority, lifecycle, and SLA counts", (t) => {
  const { service } = setup(t);
  const overdueAt = "2020-01-02T08:00:00.000Z";
  const firstResponseOverdueAt = "2020-01-01T08:00:00.000Z";
  service.updateConversation(
    identityOne.conversationId,
    updatePayload({
      assignee: "operator-42",
      priority: "high",
      status: "pending",
      slaDueAt: overdueAt,
      firstResponseDueAt: firstResponseOverdueAt,
    }),
  );

  const summary = service.getQueueSummary();
  assert.equal(summary.total, 2);
  assert.equal(summary.assigned, 1);
  assert.equal(summary.unassigned, 1);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.needsAttention, 2);
  assert.equal(summary.slaOverdue, 1);
  assert.equal(summary.firstResponseOverdue, 1);
  assert.equal(summary.noSla, 1);
  assert.equal(summary.priorities.high, 1);
  assert.equal(summary.priorities.normal, 1);
  assert.equal(summary.statuses.pending, 1);
  assert.equal(summary.statuses.open, 1);

  assert.deepEqual(service.listQueue({ overdue: "true" }).records.map((item) => item.id), [identityOne.conversationId]);
  assert.deepEqual(service.listQueue({ assignee: "unassigned" }).records.map((item) => item.id), ["conversation_demo_2"]);
  assert.equal(service.listQueue({ priority: "high", status: "pending" }).total, 1);
  assert.equal(service.listQueue({ slaDueAt: overdueAt, firstResponseDueAt: firstResponseOverdueAt }).total, 1);
  assert.equal(service.listQueue({ slaDueBefore: "2021-01-01T00:00:00.000Z" }).total, 1);
  assert.equal(service.listQueue(identityOne).records[0].id, identityOne.conversationId);

  assertHttpError(
    () => service.listQueue({ customerId: identityOne.customerId }),
    400,
    /requires complete identity/,
  );
});

test("clearing assignment and SLA remains explicit and audited, while identical updates are no-ops", (t) => {
  const { service } = setup(t);
  service.updateConversation(
    identityOne.conversationId,
    updatePayload({ assignee: "operator-42", slaDueAt: "2035-05-02T08:00:00.000Z" }),
  );
  const cleared = service.updateConversation(
    identityOne.conversationId,
    updatePayload({ assignee: null, slaDueAt: null }),
  );
  assert.equal(cleared.conversation.assignmentState, "unassigned");
  assert.equal(cleared.conversation.slaState, "no_sla");
  assert.deepEqual(cleared.changedFields, ["assignee", "slaDueAt"]);
  assert.equal(service.listAudit(identityOne).length, 2);

  const noOp = service.updateConversation(identityOne.conversationId, updatePayload({ assignee: null, slaDueAt: null }));
  assert.equal(noOp.audit, null);
  assert.deepEqual(noOp.changedFields, []);
  assert.equal(service.listAudit(identityOne).length, 2);
});

test("conversation operations controller is registered with query, summary, audit, and patch routes", () => {
  const controller = fs.readFileSync(
    path.join(__dirname, "../apps/api/src/conversation-ops/conversation-operations.controller.ts"),
    "utf8",
  );
  const appModule = fs.readFileSync(path.join(__dirname, "../apps/api/src/app.module.ts"), "utf8");
  assert.match(controller, /@Controller\("conversation-ops"\)/);
  assert.match(controller, /@Get\("queue"\)/);
  assert.match(controller, /@Get\("queue\/summary"\)/);
  assert.match(controller, /@Get\("conversations\/:id"\)/);
  assert.match(controller, /@Get\("conversations\/:id\/audit"\)/);
  assert.match(controller, /@Patch\("conversations\/:id"\)/);
  assert.match(appModule, /ConversationOperationsController/);
  assert.match(appModule, /ConversationOperationsService/);
});
