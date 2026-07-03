"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function setupService() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inbound-scene-memory-"));
  process.env.WECHAT_BRIDGE_OUTBOX_DIR = path.join(tempDir, "outbox");
  process.env.WECHAT_BRIDGE_INBOX_DIR = path.join(tempDir, "inbox");
  process.env.WECHAT_BRIDGE_LOCK_DIR = path.join(tempDir, "locks");
  process.env.WECHAT_BRIDGE_WORKER_STATUS_FILE = path.join(tempDir, "worker-status.json");

  require("ts-node").register({
    transpileOnly: true,
    compilerOptions: { module: "CommonJS" },
  });

  const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
  const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
  const { OrdersService } = require("../apps/api/src/orders/orders.service");
  const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
  const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
  const { appConfig } = require("../apps/api/src/shared/app-config");

  appConfig.wechatBridgeOutboxDir = process.env.WECHAT_BRIDGE_OUTBOX_DIR;
  appConfig.wechatBridgeInboxDir = process.env.WECHAT_BRIDGE_INBOX_DIR;
  appConfig.wechatBridgeLockDir = process.env.WECHAT_BRIDGE_LOCK_DIR;
  appConfig.wechatBridgeWorkerStatusFile = process.env.WECHAT_BRIDGE_WORKER_STATUS_FILE;

  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  const notifications = new NotificationsService({}, localStore);
  const orders = new OrdersService({}, localStore, notifications);
  const service = new WechatDispatchService({}, localStore, new WechatSendAdapterService(), notifications, orders);
  return { localStore, service };
}

test("wechat inbound scene memory stays scoped to current account conversation", async () => {
  const { localStore, service } = setupService();
  const text = "package tracking stuck exact memory";
  const otherRoute = localStore.createRouteEvaluation(
    {
      channel: "wechat",
      text,
      customerId: "customer_demo_2",
      conversationId: "conversation_demo_2",
      wechatAccountId: "wechat_demo_2",
    },
    {
      agentKey: "general",
      scene: "unclear",
      suggestedReply: "",
      score: 0,
    },
  );
  const currentRoute = localStore.createRouteEvaluation(
    {
      channel: "wechat",
      text,
      customerId: "customer_demo_1",
      conversationId: "conversation_demo_1",
      wechatAccountId: "wechat_demo_1",
    },
    {
      agentKey: "general",
      scene: "unclear",
      suggestedReply: "",
      score: 0,
    },
  );
  const other = localStore.correctRouteEvaluation(otherRoute.id, {
    agentKey: "after_sales",
    scene: "other-account-scene",
    idealReply: "other account answer",
    reviewer: "test",
  });
  const current = localStore.correctRouteEvaluation(currentRoute.id, {
    agentKey: "logistics_exception",
    scene: "current-account-scene",
    idealReply: "current account answer",
    reviewer: "test",
  });

  const result = await service.processInboundMessage({
    wechatAccountId: "wechat_demo_1",
    conversationId: "conversation_demo_1",
    customerId: "customer_demo_1",
    text,
  });

  assert.equal(result.route.sceneMemory?.sampleId, current.trainingSample.id);
  assert.notEqual(result.route.sceneMemory?.sampleId, other.trainingSample.id);
  assert.equal(result.route.wechatAccountId, "wechat_demo_1");
  assert.equal(result.route.conversationId, "conversation_demo_1");
});
