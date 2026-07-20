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
const { WechatWorkApiClient, WechatWorkApiError } = require("../apps/api/src/wechat-work/wechat-work-api.client");
const { WechatWorkService } = require("../apps/api/src/wechat-work/wechat-work.service");

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);

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
  appConfig.localStorageRoot = path.join(tempDir, "storage");
  fs.mkdirSync(appConfig.localStorageRoot, { recursive: true });

  const api = {
    syncCalls: [],
    sendCalls: [],
    uploadCalls: [],
    imageSendCalls: [],
    operationCalls: [],
    downloadCalls: [],
    syncResponse: { errcode: 0, errmsg: "ok", has_more: 0, msg_list: [] },
    sendFailures: [],
    uploadFailures: [],
    imageSendFailures: [],
    downloadFailures: [],
    async syncMessages(payload) {
      this.syncCalls.push(payload);
      return this.syncResponse;
    },
    async sendText(payload) {
      this.sendCalls.push(payload);
      this.operationCalls.push({ type: "text", msgid: payload.msgid });
      const failure = this.sendFailures.shift();
      if (failure) throw failure;
      return { errcode: 0, errmsg: "ok", msgid: `api-${payload.msgid}` };
    },
    async downloadMedia(payload) {
      this.downloadCalls.push(payload);
      const failure = this.downloadFailures.shift();
      if (failure) throw failure;
      return { bytes: VALID_PNG, contentType: "image/png", size: VALID_PNG.length };
    },
    async uploadImage(payload) {
      this.uploadCalls.push(payload);
      this.operationCalls.push({ type: "upload", filePath: payload.filePath });
      const failure = this.uploadFailures.shift();
      if (failure) throw failure;
      return { errcode: 0, errmsg: "ok", media_id: `media-${this.uploadCalls.length}`, type: "image" };
    },
    async sendImage(payload) {
      this.imageSendCalls.push(payload);
      this.operationCalls.push({ type: "image", mediaId: payload.mediaId, msgid: payload.msgid });
      const failure = this.imageSendFailures.shift();
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
  return { api, localStore, dispatch, service, tempDir };
}

function writePng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 1),
  ]));
  return filePath;
}

function createBoundDesignJob(localStore, binding, imagePaths) {
  const job = localStore.createDesignJob({
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    wechatAccountId: binding.wechatAccountId,
    status: "completed",
  });
  localStore.upsertDesignImages(job.id, imagePaths.map((localPath, index) => ({
    imageId: `candidate-${index + 1}`,
    position: index + 1,
    localPath,
  })));
  return job;
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
  const imageMessage = localStore.findMessageByExternalId(bindingB.conversationId, "incoming-2");
  assert.equal(imageMessage.text, "[图片]");
  assert.equal(api.downloadCalls.length, 1);
  assert.equal(api.downloadCalls[0].mediaId, "media-1");
  assert.equal(imageMessage.attachments[0].mediaId, "media-1");
  assert.equal(imageMessage.attachments[0].status, "ready");
  assert.match(imageMessage.attachments[0].fingerprint, /^dhash64:v1:[a-f0-9]{16}$/);
  assert.equal(fs.existsSync(imageMessage.attachments[0].localPath), true);
});

test("permanent inbound media failure persists a controlled manual-review attachment without a fake hash", async () => {
  const { api, localStore, service } = setup();
  api.downloadFailures.push(new WechatWorkApiError("media_get", "permanent media error", {
    errcode: 40007,
    disposition: "permanent",
  }));
  api.syncResponse = {
    errcode: 0,
    has_more: 0,
    msg_list: [{
      msgid: "incoming-permanent-image",
      open_kfid: "wk-media",
      external_userid: "wm-media",
      msgtype: "image",
      image: { media_id: "invalid-media" },
    }],
  };

  const result = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-media" });
  assert.equal(result.processedCount, 1);
  const binding = localStore.getWechatWorkBinding("wk-media", "wm-media");
  const message = localStore.findMessageByExternalId(binding.conversationId, "incoming-permanent-image");
  assert.deepEqual(message.attachments[0], {
    source: "wechat_work_kf",
    msgid: "incoming-permanent-image",
    msgtype: "image",
    openKfid: "wk-media",
    externalUserId: "wm-media",
    mediaId: "invalid-media",
    status: "manual_review",
    reviewRequired: true,
    reason: "permanent",
    apiErrcode: 40007,
  });
  assert.equal("fingerprint" in message.attachments[0], false);
  assert.equal("localPath" in message.attachments[0], false);
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "inbound_media_manual_review"));
});

test("transient or delayed inbound media failure is audited without advancing durable state", async () => {
  for (const disposition of ["retry_exhausted", "delayed_blocked"]) {
    const { api, localStore, service } = setup();
    api.downloadFailures.push(new WechatWorkApiError("media_get", "retry later", {
      errcode: disposition === "delayed_blocked" ? 45009 : undefined,
      disposition,
    }));
    api.syncResponse = {
      errcode: 0,
      has_more: 1,
      next_cursor: "must-not-advance",
      msg_list: [{
        msgid: `incoming-${disposition}`,
        open_kfid: "wk-transient",
        external_userid: "wm-transient",
        msgtype: "image",
        image: { media_id: "retry-media" },
      }],
    };

    const result = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-transient" });
    assert.equal(result.retryRequired, true);
    assert.equal(result.cursorCommitted, false);
    assert.equal(localStore.getWechatWorkSyncCursor("wk-transient"), null);
    assert.equal(localStore.getWechatWorkBinding("wk-transient", "wm-transient"), null);
    const msgid = `incoming-${disposition}`;
    const audit = localStore.listWechatWorkAuditLogs().find((item) => item.msgid === msgid);
    assert.equal(audit.action, "inbound_failed");
    assert.equal(audit.status, "transient_failed");
    assert.equal(localStore.hasWechatWorkAuditMsgId(msgid), false);
  }
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

test("sync_msg resumes from a durable per-open_kfid cursor after service restart", async () => {
  const { api, localStore, dispatch, service } = setup();
  api.syncResponse = { errcode: 0, errmsg: "ok", has_more: 0, next_cursor: "cursor-a-1", msg_list: [] };
  const first = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-cursor-a" });
  assert.equal(first.cursorCommitted, true);
  assert.equal(localStore.getWechatWorkSyncCursor("wk-cursor-a").nextCursor, "cursor-a-1");
  assert.equal(localStore.getWechatWorkSyncCursor("wk-cursor-b"), null);

  const restarted = new WechatWorkService(dispatch, localStore, api);
  api.syncResponse = { errcode: 0, errmsg: "ok", has_more: 0, next_cursor: "cursor-a-2", msg_list: [] };
  await restarted.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-cursor-a" });
  assert.equal(api.syncCalls.at(-1).cursor, "cursor-a-1");
  assert.equal(localStore.getWechatWorkSyncCursor("wk-cursor-a").nextCursor, "cursor-a-2");
});

test("transient inbound failure replays the same cursor and only terminal completion commits it", async () => {
  const { api, localStore, dispatch, service } = setup();
  api.syncResponse = {
    errcode: 0,
    errmsg: "ok",
    has_more: 0,
    next_cursor: "cursor-transient-next",
    msg_list: [{ msgid: "transient-1", open_kfid: "wk-transient", external_userid: "wm-transient", msgtype: "text", text: { content: "重试" } }],
  };
  const original = dispatch.processInboundMessage.bind(dispatch);
  let calls = 0;
  dispatch.processInboundMessage = async (payload) => {
    calls += 1;
    if (calls === 1) throw new Error("temporary storage outage");
    return original(payload);
  };

  const first = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-transient" });
  assert.equal(first.retryRequired, true);
  assert.equal(first.cursorCommitted, false);
  assert.equal(localStore.getWechatWorkSyncCursor("wk-transient"), null);
  assert.equal(localStore.hasWechatWorkAuditMsgId("transient-1"), false);

  const second = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-transient" });
  assert.equal(second.processedCount, 1);
  assert.equal(second.cursorCommitted, true);
  assert.equal(api.syncCalls.at(-1).cursor, "");
  assert.equal(localStore.getWechatWorkSyncCursor("wk-transient").nextCursor, "cursor-transient-next");
});

test("bounded inbound failures become permanent manual review and then skip duplicate replay", async () => {
  const { api, localStore, dispatch, service } = setup();
  api.syncResponse = {
    errcode: 0,
    errmsg: "ok",
    has_more: 0,
    next_cursor: "cursor-permanent",
    msg_list: [{ msgid: "permanent-1", open_kfid: "wk-permanent", external_userid: "wm-permanent", msgtype: "text", text: { content: "持久失败" } }],
  };
  let calls = 0;
  dispatch.processInboundMessage = async () => {
    calls += 1;
    throw new Error("repeatable transient failure");
  };
  const first = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-permanent" });
  const second = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-permanent" });
  const third = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-permanent" });
  assert.equal(first.cursorCommitted, false);
  assert.equal(second.cursorCommitted, false);
  assert.equal(third.cursorCommitted, true);
  assert.equal(third.failed[0].status, "permanent_manual_review");
  assert.equal(localStore.hasWechatWorkAuditMsgId("permanent-1"), true);
  const replay = await service.syncCustomerServiceMessages({ token: "sync-token", cursor: "", openKfid: "wk-permanent" });
  assert.equal(replay.duplicateCount, 1);
  assert.equal(replay.cursorCommitted, false);
  assert.equal(calls, 3);
});

test("sync inbound idempotency ignores callback and outbound audit rows with colliding ids", () => {
  const { localStore } = setup();
  localStore.recordWechatWorkAudit({ action: "callback_accepted", status: "processed", msgid: "shared-id", callbackId: "callback-id" });
  localStore.recordWechatWorkAudit({ action: "send_api_accepted", status: "processed", msgid: "shared-id" });
  assert.equal(localStore.hasWechatWorkAuditMsgId("shared-id"), false);
  assert.equal(localStore.hasWechatWorkCallbackId("callback-id"), true);
  localStore.recordWechatWorkAudit({ action: "inbound_processed", status: "processed", msgid: "shared-id" });
  assert.equal(localStore.hasWechatWorkAuditMsgId("shared-id"), true);
});

test("cursor CAS rejects stale and cross-scope commits", () => {
  const { localStore } = setup();
  localStore.commitWechatWorkSyncCursor({ openKfid: "wk-cas-a", expectedCursor: "", nextCursor: "a-1" });
  assert.throws(
    () => localStore.commitWechatWorkSyncCursor({ openKfid: "wk-cas-a", expectedCursor: "", nextCursor: "a-stale" }),
    /stale cursor commit/,
  );
  localStore.commitWechatWorkSyncCursor({ openKfid: "wk-cas-b", expectedCursor: "", nextCursor: "b-1" });
  assert.equal(localStore.getWechatWorkSyncCursor("wk-cas-a").nextCursor, "a-1");
  assert.equal(localStore.getWechatWorkSyncCursor("wk-cas-b").nextCursor, "b-1");
});

test("empty final next_cursor never resets a previously durable cursor", async () => {
  const { api, localStore, service } = setup();
  localStore.commitWechatWorkSyncCursor({ openKfid: "wk-empty-next", expectedCursor: "", nextCursor: "cursor-safe" });
  api.syncResponse = { errcode: 0, errmsg: "ok", has_more: 0, next_cursor: "", msg_list: [] };
  const result = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-empty-next" });
  assert.equal(result.cursorCommitted, false);
  assert.equal(result.retryRequired, true);
  assert.equal(result.nextCursor, "cursor-safe");
  assert.equal(localStore.getWechatWorkSyncCursor("wk-empty-next").nextCursor, "cursor-safe");
});

test("cross-open_kfid item fails closed without advancing or leaking the foreign customer", async () => {
  const { api, localStore, service } = setup();
  api.syncResponse = {
    errcode: 0,
    errmsg: "ok",
    has_more: 0,
    next_cursor: "must-not-commit",
    msg_list: [{ msgid: "cross-scope-1", open_kfid: "wk-foreign", external_userid: "wm-secret", msgtype: "text", text: { content: "错误范围" } }],
  };
  const result = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-owned" });
  assert.equal(result.cursorCommitted, false);
  assert.equal(result.retryRequired, true);
  assert.equal(localStore.getWechatWorkSyncCursor("wk-owned"), null);
  const audit = localStore.listWechatWorkAuditLogs().find((item) => item.msgid === "cross-scope-1");
  assert.equal(audit.openKfid, "wk-owned");
  assert.equal(audit.externalUserId, null);
  assert.equal(audit.cursorScopeMismatch, true);
});

test("explicit WeChat Work dispatch calls kf/send_msg and persists send attempt audit", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-send", externalUserId: "wm-send" });
  const queued = await service.queueCustomerServiceText({ requestId: "wechat-work:test-send-text", openKfid: "wk-send", externalUserId: "wm-send", text: "您好，方案已确认" });

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

test("WeChat Work image send uploads and dispatches text plus multiple images in order", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-images", externalUserId: "wm-images" });
  const first = writePng(path.join(appConfig.localStorageRoot, "designs", "first.png"));
  const second = writePng(path.join(appConfig.localStorageRoot, "designs", "second.png"));
  const designJob = createBoundDesignJob(localStore, binding, [first, second]);
  const queued = await service.queueCustomerServiceImages({
    requestId: "wechat-work:test-images",
    openKfid: "wk-images",
    externalUserId: "wm-images",
    text: "方案如下",
    imagePaths: [first, second],
    designJobId: designJob.id,
  });

  const result = await service.dispatchCustomerServiceText(queued.task.id);
  assert.equal(result.task.status, "sent");
  assert.deepEqual(api.operationCalls.map((item) => item.type), ["text", "upload", "image", "upload", "image"]);
  assert.deepEqual(api.imageSendCalls.map((item) => item.mediaId), ["media-1", "media-2"]);
  assert.deepEqual(api.imageSendCalls.map((item) => item.msgid), [`kf_${queued.task.id}_2`, `kf_${queued.task.id}_3`]);
  const attempt = localStore.getLatestSendAttempt(queued.task.id, { adapter: "wechat_work_kf" });
  assert.equal(attempt.status, "sent");
  assert.equal(attempt.metadata.apiMsgIds.length, 3);
  assert.equal(localStore.findWechatWorkSendAttemptByMsgId(attempt.metadata.apiMsgIds[2]).id, attempt.id);
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "send_images_queued" && item.imageCount === 2));
});

test("WeChat Work image upload failure stays unsent and uses bounded retry", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upload-fail", externalUserId: "wm-upload-fail" });
  const image = writePng(path.join(appConfig.localStorageRoot, "upload-fail.png"));
  const designJob = createBoundDesignJob(localStore, binding, [image]);
  api.uploadFailures.push(new WechatWorkApiError("media_upload", "explicit upload failure", { errcode: 40007 }));
  const queued = await service.queueCustomerServiceImages({
    requestId: "wechat-work:test-upload-fail",
    openKfid: "wk-upload-fail",
    externalUserId: "wm-upload-fail",
    imagePaths: [image],
    designJobId: designJob.id,
  });

  const result = await service.dispatchCustomerServiceText(queued.task.id);
  assert.equal(result.task.status, "queued");
  assert.equal(result.retryScheduled, true);
  assert.equal(api.imageSendCalls.length, 0);
  assert.equal(localStore.getLatestSendAttempt(queued.task.id).metadata.failureStage, "upload_image");
});

test("uncertain WeChat Work image send fails closed without automatic retry", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-send-unknown", externalUserId: "wm-send-unknown" });
  const image = writePng(path.join(appConfig.localStorageRoot, "send-unknown.png"));
  const designJob = createBoundDesignJob(localStore, binding, [image]);
  api.imageSendFailures.push(new Error("socket closed after request write"));
  const queued = await service.queueCustomerServiceImages({
    requestId: "wechat-work:test-send-unknown",
    openKfid: "wk-send-unknown",
    externalUserId: "wm-send-unknown",
    imagePaths: [image],
    designJobId: designJob.id,
  });

  const result = await service.dispatchCustomerServiceText(queued.task.id);
  assert.equal(result.task.status, "failed");
  assert.equal(result.retryScheduled, false);
  assert.equal(result.attempt.metadata.deliveryState, "unknown");
  assert.equal(result.attempt.metadata.automaticRetryBlocked, true);
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "send_delivery_unknown"));
});

test("partial multi-image send never retries already accepted images", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-partial", externalUserId: "wm-partial" });
  const first = writePng(path.join(appConfig.localStorageRoot, "partial-first.png"));
  const second = writePng(path.join(appConfig.localStorageRoot, "partial-second.png"));
  const designJob = createBoundDesignJob(localStore, binding, [first, second]);
  api.imageSendFailures.push(null, new WechatWorkApiError("send_msg", "explicit send rejection", { errcode: 95004 }));
  const queued = await service.queueCustomerServiceImages({
    requestId: "wechat-work:test-partial",
    openKfid: "wk-partial",
    externalUserId: "wm-partial",
    imagePaths: [first, second],
    designJobId: designJob.id,
  });

  const result = await service.dispatchCustomerServiceText(queued.task.id);
  assert.equal(result.task.status, "failed");
  assert.equal(result.retryScheduled, false);
  assert.equal(result.attempt.metadata.deliveryState, "partial");
  assert.equal(result.attempt.metadata.acceptedMessageIds.length, 1);
  assert.equal(result.attempt.metadata.automaticRetryBlocked, true);
});

test("WeChat Work image queue rejects paths outside LOCAL_STORAGE_ROOT", async () => {
  const { service, tempDir } = setup();
  const outside = writePng(path.join(tempDir, "outside.png"));
  await assert.rejects(
    () => service.queueCustomerServiceImages({ requestId: "wechat-work:test-outside", openKfid: "wk-outside", externalUserId: "wm-outside", imagePaths: [outside] }),
    /inside LOCAL_STORAGE_ROOT/,
  );
});

test("WeChat Work image queue rejects a design job bound to another customer", async () => {
  const { localStore, service } = setup();
  const owner = localStore.upsertWechatWorkBinding({ openKfid: "wk-design-owner", externalUserId: "wm-owner" });
  localStore.upsertWechatWorkBinding({ openKfid: "wk-design-owner", externalUserId: "wm-other" });
  const image = writePng(path.join(appConfig.localStorageRoot, "wrong-customer.png"));
  const designJob = createBoundDesignJob(localStore, owner, [image]);

  await assert.rejects(
    () => service.queueCustomerServiceImages({
      requestId: "wechat-work:test-wrong-customer",
      openKfid: "wk-design-owner",
      externalUserId: "wm-other",
      designJobId: designJob.id,
      imagePaths: [image],
    }),
    /not bound to the selected WeChat Work customer/,
  );
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

test("kf/send_msg explicit API failures are bounded and create a new attempt on retry", async () => {
  const { api, localStore, dispatch, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-retry", externalUserId: "wm-retry" });
  const queued = await service.queueCustomerServiceText({ requestId: "wechat-work:test-retry", openKfid: "wk-retry", externalUserId: "wm-retry", text: "重试测试" });
  api.sendFailures.push(new WechatWorkApiError("send_msg", "temporary explicit API failure", { errcode: 45009 }));

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
  const queued = await service.queueCustomerServiceText({ requestId: "wechat-work:test-fail-event", openKfid: "wk-fail-event", externalUserId: "wm-fail-event", text: "异步失败测试" });
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

test("official API client uploads image multipart then sends image media_id", async (t) => {
  const { tempDir } = setup();
  const image = writePng(path.join(appConfig.localStorageRoot, "client-upload.png"));
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("/cgi-bin/gettoken?")) {
      return new Response(JSON.stringify({ errcode: 0, access_token: "access-token", expires_in: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).includes("/cgi-bin/media/upload?")) {
      assert.equal(init.method, "POST");
      assert.match(String(url), /access_token=access-token&type=image$/);
      assert.ok(init.body instanceof FormData);
      const media = init.body.get("media");
      assert.equal(media.name, "client-upload.png");
      assert.equal(media.type, "image/png");
      assert.equal(media.size, fs.statSync(image).size);
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok", type: "image", media_id: "media-client" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(init.body);
    assert.equal(body.msgtype, "image");
    assert.deepEqual(body.image, { media_id: "media-client" });
    assert.equal(body.msgid, "message-client");
    return new Response(JSON.stringify({ errcode: 0, errmsg: "ok", msgid: "api-message-client" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = new WechatWorkApiClient();
  const upload = await client.uploadImage({ filePath: image });
  const sent = await client.sendImage({
    externalUserId: "wm-client",
    openKfid: "wk-client",
    mediaId: upload.media_id,
    msgid: "message-client",
  });
  assert.equal(sent.msgid, "api-message-client");
  assert.equal(requests.length, 3);
  assert.equal(path.dirname(image).startsWith(path.resolve(tempDir)), true);
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
