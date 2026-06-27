"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertScanAcceptedAck,
  buildAckPayload,
  buildWorkerStatus,
  loadAndValidateOutboxPayload,
  normalizeAckTransport,
  normalizeMode,
  numberValue,
  safeFileSegment,
  validateOutboxEntry,
  validateOutboxPayload,
  writeWorkerStatus,
} = require("../tools/wechat-bridge-worker");

function validOutboxEntry(overrides = {}) {
  return {
    taskId: "send_1",
    attemptId: "attempt_1",
    wechatAccountId: "wechat_1",
    conversationId: "conv_1",
    fileName: "outbox.json",
    preview: {
      protocolVersion: "wechat_bridge_outbox_v1",
      outboxFileName: "outbox.json",
      attemptId: "attempt_1",
      wechatAccountId: "wechat_1",
      conversationId: "conv_1",
    },
    ...overrides,
  };
}

function validOutboxPayload(overrides = {}) {
  return {
    version: "wechat_bridge_outbox_v1",
    ackToken: "a".repeat(64),
    taskId: "send_1",
    wechatAccountId: "wechat_1",
    conversationId: "conv_1",
    target: {
      wechatAccountId: "wechat_1",
      conversationId: "conv_1",
      customerId: "customer_1",
    },
    sendPlan: {
      kind: "text",
      target: {
        wechatAccountId: "wechat_1",
        conversationId: "conv_1",
        customerId: "customer_1",
      },
      actionCount: 1,
      actions: [{ type: "text", text: "hello" }],
      constraints: {
        singleAccountLock: true,
        requireActiveWindowMatch: true,
        requireRecentCustomerMatch: true,
        doNotMarkSentWithoutAck: true,
      },
    },
    payload: { kind: "text", text: "hello" },
    guardSnapshot: { status: "passed", ok: true },
    context: { guardStatus: "passed", windowSnapshotId: "window_1" },
    createdAt: "2026-06-27T00:00:00.000Z",
    ...overrides,
  };
}

test("normalizes bridge worker mode to safe noop by default", () => {
  assert.equal(normalizeMode("simulate_sent"), "simulate_sent");
  assert.equal(normalizeMode("simulate_failed"), "simulate_failed");
  assert.equal(normalizeMode("unexpected"), "noop");
  assert.equal(normalizeMode(""), "noop");
});

test("normalizes bridge ack transport to file scan by default", () => {
  assert.equal(normalizeAckTransport("api"), "api");
  assert.equal(normalizeAckTransport("file"), "file");
  assert.equal(normalizeAckTransport("bad"), "file_scan");
});

test("builds bridge sent ack payload with task and attempt identity", () => {
  const ack = buildAckPayload(
    {
      taskId: "send_1",
      attemptId: "attempt_1",
      wechatAccountId: "wechat_1",
      conversationId: "conv_1",
      fileName: "outbox.json",
      payloadKind: "quote",
      accountDisplayName: "微信客服1号",
      conversationTitle: "王总-端午礼盒",
    },
    "simulate_sent",
    { ackToken: "b".repeat(64) },
  );

  assert.equal(ack.version, "wechat_bridge_ack_v1");
  assert.equal(ack.ackToken, "b".repeat(64));
  assert.equal(ack.taskId, "send_1");
  assert.equal(ack.attemptId, "attempt_1");
  assert.equal(ack.wechatAccountId, "wechat_1");
  assert.equal(ack.conversationId, "conv_1");
  assert.equal(ack.outboxFileName, "outbox.json");
  assert.equal(ack.status, "sent");
  assert.equal(ack.errorMessage, "");
  assert.equal(ack.metadata.source, "wechat-bridge-worker");
  assert.equal(ack.metadata.payloadKind, "quote");
  assert.ok(ack.sentAt);
});

test("builds bridge failed ack payload without pretending sent", () => {
  const ack = buildAckPayload({ taskId: "send_2" }, "simulate_failed");

  assert.equal(ack.status, "failed");
  assert.equal(Boolean(ack.sentAt), false);
  assert.match(ack.errorMessage, /模拟失败/);
});

test("validates bridge outbox identity before building a sent ack", () => {
  const result = validateOutboxEntry({
    taskId: "send_1",
    attemptId: "attempt_1",
    wechatAccountId: "wechat_1",
    conversationId: "conv_1",
    fileName: "outbox.json",
    preview: {
      protocolVersion: "wechat_bridge_outbox_v1",
      outboxFileName: "outbox.json",
      attemptId: "attempt_1",
      wechatAccountId: "wechat_1",
      conversationId: "conv_1",
    },
  });

  assert.equal(result.ok, true);
});

test("rejects bridge outbox entries without protocol identity", () => {
  const result = validateOutboxEntry({
    taskId: "send_1",
    wechatAccountId: "wechat_1",
    conversationId: "conv_1",
    fileName: "outbox.json",
    preview: {
      protocolVersion: "old",
      outboxFileName: "another.json",
      wechatAccountId: "wechat_2",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("protocolVersion"), true);
  assert.equal(result.failedKeys.includes("attemptId"), true);
  assert.equal(result.failedKeys.includes("previewIdentityMatches"), true);
});

test("validates bridge outbox file body before building an ack", () => {
  const result = validateOutboxPayload(validOutboxEntry(), validOutboxPayload());

  assert.equal(result.ok, true);
});

test("rejects bridge outbox file body with mismatched identity", () => {
  const result = validateOutboxPayload(
    validOutboxEntry(),
    validOutboxPayload({
      wechatAccountId: "wechat_2",
      target: {
        wechatAccountId: "wechat_2",
        conversationId: "conv_1",
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("wechatAccountId"), true);
  assert.equal(result.failedKeys.includes("targetIdentity"), true);
});

test("rejects bridge outbox file body without strict send constraints", () => {
  const payload = validOutboxPayload();
  payload.sendPlan.constraints.doNotMarkSentWithoutAck = false;

  const result = validateOutboxPayload(validOutboxEntry(), payload);

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("sendPlanConstraints"), true);
});

test("rejects bridge outbox file body without ack token", () => {
  const payload = validOutboxPayload({ ackToken: "" });

  const result = validateOutboxPayload(validOutboxEntry(), payload);

  assert.equal(result.ok, false);
  assert.equal(result.failedKeys.includes("ackToken"), true);
});

test("loads bridge outbox payload only from the matching outbox file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-outbox-"));
  const filePath = path.join(dir, "outbox.json");
  fs.writeFileSync(filePath, `${JSON.stringify(validOutboxPayload(), null, 2)}\n`, "utf8");

  const result = loadAndValidateOutboxPayload(validOutboxEntry({ filePath, outboxDir: dir }));

  assert.equal(result.filePath, filePath);
  assert.equal(result.validation.ok, true);
  assert.equal(result.payload.taskId, "send_1");
});

test("rejects bridge outbox payload paths outside the outbox directory", () => {
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-outbox-root-"));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-outbox-outside-"));
  const filePath = path.join(outsideDir, "outbox.json");
  fs.writeFileSync(filePath, `${JSON.stringify(validOutboxPayload(), null, 2)}\n`, "utf8");

  assert.throws(
    () => loadAndValidateOutboxPayload(validOutboxEntry({ filePath, outboxDir })),
    /direct child of outbox directory/,
  );
});

test("accepts bridge inbox scan only when current ack is processed", () => {
  const result = assertScanAcceptedAck(
    {
      processed: [{ taskId: "send_1", result: { attempt: { id: "attempt_1" } } }],
      failed: [],
    },
    { taskId: "send_1", attemptId: "attempt_1" },
  );

  assert.equal(result.processed.length, 1);
});

test("rejects bridge inbox scan when current ack failed", () => {
  assert.throws(
    () =>
      assertScanAcceptedAck(
        {
          processed: [],
          failed: [{ taskId: "send_1", errorMessage: "bridge ack binding invalid" }],
        },
        { taskId: "send_1", attemptId: "attempt_1" },
      ),
    /bridge inbox scan failed/,
  );
});

test("rejects bridge inbox scan when current ack was not processed", () => {
  assert.throws(
    () =>
      assertScanAcceptedAck(
        {
          processed: [{ taskId: "send_2" }],
          failed: [],
        },
        { taskId: "send_1", attemptId: "attempt_1" },
      ),
    /did not process ack/,
  );
});

test("sanitizes account ids for lock and ack file names", () => {
  assert.equal(safeFileSegment("wechat:demo/1"), "wechat_demo_1");
  assert.equal(safeFileSegment(""), "unknown");
  assert.equal(safeFileSegment("a".repeat(100)).length, 80);
});

test("clamps numeric bridge worker options", () => {
  assert.equal(numberValue("10", 5, 1, 50), 10);
  assert.equal(numberValue("999", 5, 1, 50), 50);
  assert.equal(numberValue("bad", 5, 1, 50), 5);
});

test("builds bridge worker status without leaking payload content", () => {
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const status = buildWorkerStatus(
    {
      scanned: 2,
      outboxDir: "outbox",
      processed: [{ taskId: "send_1", wechatAccountId: "wechat_1", status: "noop", payload: { text: "secret" } }],
      skipped: [{ taskId: "send_2", wechatAccountId: "wechat_1", reason: "same_account_already_handled" }],
      failed: [],
    },
    {
      apiBase: "http://127.0.0.1:3200/api",
      inboxDir: "inbox",
      lockDir: "locks",
      statusFile: "status.json",
      mode: "noop",
      ackTransport: "file_scan",
    },
    startedAt,
  );

  assert.equal(status.ok, true);
  assert.equal(status.status, "completed");
  assert.equal(status.result.scanned, 2);
  assert.equal(status.result.processedCount, 1);
  assert.equal(status.result.skippedCount, 1);
  assert.equal(status.result.processed[0].taskId, "send_1");
  assert.equal(Object.hasOwn(status.result.processed[0], "payload"), false);
});

test("writes bridge worker status json file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-bridge-status-"));
  const statusFile = path.join(dir, "nested", "status.json");
  writeWorkerStatus(statusFile, { ok: true, status: "completed" });

  const saved = JSON.parse(fs.readFileSync(statusFile, "utf8"));
  assert.equal(saved.ok, true);
  assert.equal(saved.status, "completed");
});
