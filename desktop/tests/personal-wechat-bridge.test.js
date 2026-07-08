"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BRIDGE_ACK_VERSION,
  buildAckPayload,
  buildTextPayload,
  validateDispatchPayload,
  validateSourceOutbox,
} = require("../tools/personal-wechat-bridge");

test("personal wechat bridge validates dispatch contract", () => {
  const dispatch = buildDispatch();
  const result = validateDispatchPayload(dispatch, "account-task-attempt.dispatch.json");
  assert.equal(result.ok, true);
});

test("personal wechat bridge rejects missing dispatch identity", () => {
  const dispatch = buildDispatch({ conversationId: "" });
  const result = validateDispatchPayload(dispatch, "account-task-attempt.dispatch.json");
  assert.equal(result.ok, false);
  assert.match(result.reason, /conversationId/);
});

test("personal wechat bridge joins text actions only", () => {
  assert.equal(
    buildTextPayload([
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ]),
    "hello\r\nworld",
  );
  assert.equal(buildTextPayload([{ type: "image", filePath: "x.png" }]), "");
});

test("personal wechat bridge binds ack to source outbox token", () => {
  const dispatch = buildDispatch();
  const outbox = buildOutbox();
  const validation = validateSourceOutbox(dispatch, { payload: outbox });
  assert.equal(validation.ok, true);

  const ack = buildAckPayload(dispatch, outbox, "sent", { source: "test" });
  assert.equal(ack.version, BRIDGE_ACK_VERSION);
  assert.equal(ack.ackToken, outbox.ackToken);
  assert.equal(ack.taskId, dispatch.taskId);
  assert.equal(ack.attemptId, dispatch.attemptId);
  assert.equal(ack.wechatAccountId, dispatch.wechatAccountId);
  assert.equal(ack.conversationId, dispatch.conversationId);
  assert.equal(ack.status, "sent");
  assert.equal(ack.outboxFileName, dispatch.sourceOutboxFileName);
});

test("personal wechat bridge rejects mismatched source outbox", () => {
  const dispatch = buildDispatch();
  const outbox = buildOutbox({ conversationId: "other-conversation" });
  const validation = validateSourceOutbox(dispatch, { payload: outbox });
  assert.equal(validation.ok, false);
  assert.match(validation.reason, /conversationId/);
});

function buildDispatch(overrides = {}) {
  return {
    version: "wechat_bridge_dispatch_v1",
    taskId: "task_1",
    attemptId: "attempt_1",
    wechatAccountId: "account_1",
    conversationId: "conversation_1",
    sourceOutboxFileName: "task_1.json",
    sourceOutboxFilePath: "C:\\runtime\\wechat-outbox\\task_1.json",
    sendPlan: {
      actions: [{ type: "text", text: "hello" }],
    },
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
    ...overrides,
  };
}
