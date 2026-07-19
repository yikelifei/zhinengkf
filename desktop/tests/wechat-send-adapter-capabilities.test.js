"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS" },
});

const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");

test("windows bridge declares image support for generated design files", () => {
  const service = new WechatSendAdapterService();
  const bridge = service.describe("windows_bridge");

  assert.equal(bridge.capabilities.images, true);
  assert.equal(bridge.capabilities.writesOutbox, true);
  assert.equal(bridge.capabilities.requiresWindowGuard, true);
});

test("dry run keeps image support for safe local verification", () => {
  const service = new WechatSendAdapterService();
  const dryRun = service.describe("dry_run");

  assert.equal(dryRun.capabilities.images, true);
  assert.equal(dryRun.capabilities.writesOutbox, false);
  assert.equal(dryRun.realSend, false);
});

test("WeChat Work official adapter declares guarded image support", () => {
  const service = new WechatSendAdapterService();
  const official = service.describe("wechat_work_kf");

  assert.equal(official.capabilities.images, true);
  assert.equal(official.capabilities.requiresWindowGuard, false);
  assert.equal(official.capabilities.writesOutbox, false);
  assert.equal(official.realSend, true);
});

test("windows bridge lists dispatch instruction files separately", () => {
  const dispatchDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-dispatch-list-"));
  process.env.WECHAT_BRIDGE_DISPATCH_DIR = dispatchDir;
  const adapterPath = require.resolve("../apps/api/src/wechat/wechat-send-adapter.service");
  const configPath = require.resolve("../apps/api/src/shared/app-config");
  delete require.cache[adapterPath];
  delete require.cache[configPath];
  const { WechatSendAdapterService: ReloadedService } = require("../apps/api/src/wechat/wechat-send-adapter.service");

  fs.writeFileSync(
    path.join(dispatchDir, "wechat_1-send_1-attempt_1.dispatch.json"),
    `${JSON.stringify({
      version: "wechat_bridge_dispatch_v1",
      taskId: "send_1",
      attemptId: "attempt_1",
      wechatAccountId: "wechat_1",
      conversationId: "conversation_1",
      sourceOutboxFileName: "outbox.json",
      sendPlan: { kind: "design_images", actionCount: 2, actions: [] },
      createdAt: "2026-07-03T12:00:00.000Z",
    })}\n`,
    "utf8",
  );

  const service = new ReloadedService();
  const entries = service.listBridgeDispatch();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].taskId, "send_1");
  assert.equal(entries[0].wechatAccountId, "wechat_1");
  assert.equal(entries[0].conversationId, "conversation_1");
  assert.equal(entries[0].payloadKind, "design_images");
  assert.equal(entries[0].actionCount, 2);
});
