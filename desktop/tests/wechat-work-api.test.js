"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { NotificationsService } = require("../apps/api/src/notifications/notifications.service");
const { OrdersService } = require("../apps/api/src/orders/orders.service");
const { appConfig } = require("../apps/api/src/shared/app-config");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
const { WechatWorkService } = require("../apps/api/src/wechat-work/wechat-work.service");

function setup() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-work-api-"));
  appConfig.useLocalStore = true;
  appConfig.wechatWorkCorpId = "corp-test";
  appConfig.wechatWorkSecret = "secret-test";
  appConfig.wechatWorkToken = "token-test";
  appConfig.wechatWorkEncodingAesKey = crypto.randomBytes(32).toString("base64").replace(/=$/, "");
  appConfig.wechatWorkOpenKfid = "wk-default";
  appConfig.wechatWorkApiBaseUrl = "https://qyapi.weixin.qq.com";
  appConfig.wechatSendAdapter = "wechat_work_kf";
  appConfig.customerServicePublicBaseUrl = "https://kefu.example.com";
  appConfig.wechatWorkSendMaxAttempts = 3;
  appConfig.wechatWorkSendRetryDelaySeconds = 1;
  appConfig.wechatBridgeOutboxDir = path.join(tempDir, "outbox");
  appConfig.wechatBridgeInboxDir = path.join(tempDir, "inbox");
  appConfig.wechatBridgeDispatchDir = path.join(tempDir, "dispatch");
  appConfig.wechatBridgeLockDir = path.join(tempDir, "locks");
  appConfig.wechatBridgeWorkerStatusFile = path.join(tempDir, "worker.json");

  const api = {
    syncCalls: [],
    sendCalls: [],
    syncResponse: { errcode: 0, errmsg: "ok", has_more: 0, msg_list: [] },
    sendFailures: [],
    async syncMessages(payload) {
      this.syncCalls.push(payload);
      return this.syncResponse;
    },
    async sendText(payload) {
      this.sendCalls.push(payload);
      const failure = this.sendFailures.shift();
      if (failure) throw failure;
      return { errcode: 0, errmsg: "ok", msgid: `api-${payload.msgid}` };
    },
  };
  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  const notifications = new NotificationsService({}, localStore);
  const orders = new OrdersService({}, localStore, notifications);
  const adapter = new WechatSendAdapterService(api);
  const dispatch = new WechatDispatchService({}, localStore, adapter, notifications, orders);
  const service = new WechatWorkService(dispatch, localStore, api);
  return { api, localStore, dispatch, service };
}

test("sync_msg persists isolated open_kfid + external_userid mappings and deduplicates msgid", async () => {
  const { api, localStore, service } = setup();
  api.syncResponse = {
    errcode: 0,
    errmsg: "ok",
    has_more: 0,
    msg_list: [
      {
        msgid: "incoming-1",
        open_kfid: "wk-a",
        external_userid: "wm-customer-a",
        send_time: 1710000000,
        msgtype: "text",
        text: { content: "我要做礼盒" },
      },
      {
        msgid: "incoming-1",
        open_kfid: "wk-a",
        external_userid: "wm-customer-a",
        send_time: 1710000000,
        msgtype: "text",
        text: { content: "重复投递" },
      },
      {
        msgid: "incoming-2",
        open_kfid: "wk-a",
        external_userid: "wm-customer-b",
        send_time: 1710000001,
        msgtype: "image",
        image: { media_id: "media-1" },
      },
    ],
  };

  const result = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-a" });
  assert.equal(result.processedCount, 2);
  assert.equal(result.duplicateCount, 1);
  const bindingA = localStore.getWechatWorkBinding("wk-a", "wm-customer-a");
  const bindingB = localStore.getWechatWorkBinding("wk-a", "wm-customer-b");
  assert.ok(bindingA);
  assert.ok(bindingB);
  assert.equal(bindingA.wechatAccountId, bindingB.wechatAccountId);
  assert.notEqual(bindingA.customerId, bindingB.customerId);
  assert.notEqual(bindingA.conversationId, bindingB.conversationId);
  assert.equal(localStore.findMessageByExternalId(bindingA.conversationId, "incoming-1").text, "我要做礼盒");
  assert.equal(localStore.findMessageByExternalId(bindingB.conversationId, "incoming-2").text, "[图片]");
});

test("encrypted callback acknowledges immediately and forwards Token + OpenKfId to sync_msg", async () => {
  const { api, service } = setup();
  const xml = "<xml><ToUserName><![CDATA[corp-test]]></ToUserName><CreateTime>1710000000</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[callback-sync-token]]></Token><OpenKfId><![CDATA[wk-callback]]></OpenKfId></xml>";
  const encrypted = encryptCallback(xml, appConfig.wechatWorkEncodingAesKey, appConfig.wechatWorkCorpId);
  const query = { timestamp: "1710000000", nonce: "nonce-test" };
  query.msg_signature = sha1Sorted([appConfig.wechatWorkToken, query.timestamp, query.nonce, encrypted]);

  const response = await service.handleCallback(query, `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`);
  assert.equal(response, "success");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(api.syncCalls.length, 1);
  assert.equal(api.syncCalls[0].token, "callback-sync-token");
  assert.equal(api.syncCalls[0].openKfid, "wk-callback");
});

test("one malformed sync_msg item is audited without blocking later customer messages", async () => {
  const { api, localStore, service } = setup();
  api.syncResponse = {
    errcode: 0,
    errmsg: "ok",
    has_more: 0,
    msg_list: [
      { msgid: "bad-1", open_kfid: "wk-batch", external_userid: "wm-bad", msgtype: "unknown_type" },
      { msgid: "good-1", open_kfid: "wk-batch", external_userid: "wm-good", msgtype: "text", text: { content: "继续处理" } },
    ],
  };
  const result = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-batch" });
  assert.equal(result.failedCount, 1);
  assert.equal(result.processedCount, 1);
  assert.equal(localStore.getWechatWorkBinding("wk-batch", "wm-bad"), null);
  assert.ok(localStore.getWechatWorkBinding("wk-batch", "wm-good"));
  assert.ok((await service.listAuditLogs()).records.some((item) => item.action === "inbound_failed" && item.msgid === "bad-1"));
});

test("explicit WeChat Work dispatch calls kf/send_msg and persists send attempt audit", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-send", externalUserId: "wm-send" });
  const queued = await service.queueCustomerServiceText({ openKfid: "wk-send", externalUserId: "wm-send", text: "您好，方案已确认" });

  const result = await service.dispatchCustomerServiceText(queued.task.id);
  assert.equal(result.task.status, "sent");
  assert.equal(api.sendCalls.length, 1);
  assert.equal(api.sendCalls[0].externalUserId, "wm-send");
  assert.equal(api.sendCalls[0].openKfid, "wk-send");
  assert.equal(api.sendCalls[0].text, "您好，方案已确认");
  assert.equal(localStore.getSendTask(queued.task.id).status, "sent");
  const attempt = localStore.getLatestSendAttempt(queued.task.id, { adapter: "wechat_work_kf" });
  assert.equal(attempt.status, "sent");
  assert.equal(attempt.metadata.apiMsgId, `api-kf_${queued.task.id}`);
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "send_dispatch_requested"));
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "send_api_accepted"));
});

test("callback validation failures are audited without recording secrets or response bodies", async () => {
  const { localStore, service } = setup();
  await assert.rejects(() => service.verifyCallback({}), /echostr is required/);
  const failure = localStore
    .listWechatWorkAuditLogs()
    .find((item) => item.action === "callback_verification_rejected");
  assert.ok(failure);
  assert.equal(failure.status, "failed");
  assert.equal(failure.errorMessage, "echostr is required");
  assert.equal(JSON.stringify(failure).includes("secret-test"), false);
  assert.equal(JSON.stringify(failure).includes("token-test"), false);
  assert.equal(Object.hasOwn(failure, "response"), false);
});

test("kf/send_msg transport failures are bounded and create a new attempt on retry", async () => {
  const { api, localStore, dispatch, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-retry", externalUserId: "wm-retry" });
  const queued = await service.queueCustomerServiceText({ openKfid: "wk-retry", externalUserId: "wm-retry", text: "重试测试" });
  api.sendFailures.push(new Error("temporary network failure"));

  const first = await dispatch.processSafeSendQueue({ adapter: "wechat_work_kf", conversationId: binding.conversationId });
  assert.equal(first.failed.length, 1);
  assert.equal(localStore.getSendTask(queued.task.id).status, "queued");
  assert.equal(localStore.getLatestSendAttempt(queued.task.id).metadata.retryScheduled, true);

  const second = await dispatch.executeQueuedSend(queued.task.id, { adapter: "wechat_work_kf" });
  assert.equal(second.task.status, "sent");
  assert.equal(localStore.listSendAttempts({ sendTaskId: queued.task.id }).filter((item) => item.adapter === "wechat_work_kf").length, 2);
});

test("sync_msg msg_send_fail event reverses API-accepted send to failed", async () => {
  const { api, localStore, dispatch, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-fail-event", externalUserId: "wm-fail-event" });
  const queued = await service.queueCustomerServiceText({ openKfid: "wk-fail-event", externalUserId: "wm-fail-event", text: "异步失败测试" });
  await dispatch.executeQueuedSend(queued.task.id, { adapter: "wechat_work_kf" });
  const acceptedAttempt = localStore.getLatestSendAttempt(queued.task.id, { adapter: "wechat_work_kf" });
  api.syncResponse = {
    errcode: 0,
    errmsg: "ok",
    has_more: 0,
    msg_list: [
      {
        msgid: "failure-event-1",
        msgtype: "event",
        event: {
          event_type: "msg_send_fail",
          open_kfid: "wk-fail-event",
          external_userid: "wm-fail-event",
          fail_msgid: acceptedAttempt.metadata.apiMsgId,
          fail_type: 4,
        },
      },
    ],
  };

  await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-fail-event" });
  assert.equal(localStore.getSendTask(queued.task.id).status, "failed");
  assert.equal(localStore.getLatestSendAttempt(queued.task.id, { adapter: "wechat_work_kf" }).status, "failed");
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "send_async_failed"));
  assert.equal(binding.conversationId, localStore.getWechatWorkBinding("wk-fail-event", "wm-fail-event").conversationId);
});

test("status reports missing callback/public/send configuration without exposing secrets", async () => {
  const { service } = setup();
  appConfig.customerServicePublicBaseUrl = "http://127.0.0.1:3200";
  const status = await service.getStatus();
  assert.equal(status.ready, false);
  assert.equal(status.checks.find((item) => item.key === "publicHttpsUrl").ok, false);
  assert.equal(JSON.stringify(status).includes("secret-test"), false);
  assert.equal(JSON.stringify(status).includes("token-test"), false);
});

test("app config loads Enterprise WeChat values from the desktop env file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-work-env-"));
  fs.writeFileSync(
    path.join(tempDir, ".env"),
    [
      "WECHAT_WORK_CORP_ID=corp-from-env",
      "WECHAT_WORK_SECRET=secret-from-env",
      "WECHAT_SEND_ADAPTER=wechat_work_kf",
      "CUSTOMER_SERVICE_PUBLIC_BASE_URL=https://kefu.example.com",
    ].join("\n"),
    "utf8",
  );
  const childEnv = { ...process.env };
  for (const key of ["DESKTOP_ENV_FILE", "WECHAT_WORK_CORP_ID", "WECHAT_WORK_SECRET", "WECHAT_SEND_ADAPTER", "CUSTOMER_SERVICE_PUBLIC_BASE_URL"]) {
    delete childEnv[key];
  }
  const tsNodePath = require.resolve("ts-node");
  const appConfigPath = path.resolve(__dirname, "../apps/api/src/shared/app-config.ts");
  const script = [
    `require(${JSON.stringify(tsNodePath)}).register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });`,
    `const { appConfig } = require(${JSON.stringify(appConfigPath)});`,
    "process.stdout.write(JSON.stringify({ corpId: appConfig.wechatWorkCorpId, secret: appConfig.wechatWorkSecret, adapter: appConfig.wechatSendAdapter, publicBaseUrl: appConfig.customerServicePublicBaseUrl }));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", script], { cwd: tempDir, env: childEnv, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    corpId: "corp-from-env",
    secret: "secret-from-env",
    adapter: "wechat_work_kf",
    publicBaseUrl: "https://kefu.example.com",
  });
});

function encryptCallback(message, encodingAesKey, receiveId) {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  const random = crypto.randomBytes(16);
  const messageBuffer = Buffer.from(message, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(messageBuffer.length, 0);
  const plain = Buffer.concat([random, length, messageBuffer, Buffer.from(receiveId, "utf8")]);
  const pad = 32 - (plain.length % 32 || 32);
  const padded = Buffer.concat([plain, Buffer.alloc(pad || 32, pad || 32)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

function sha1Sorted(values) {
  return crypto.createHash("sha1").update([...values].sort().join("")).digest("hex");
}
