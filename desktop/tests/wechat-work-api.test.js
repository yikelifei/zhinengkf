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
const {
  WechatWorkService,
  callbackSyncRetryDelayMs,
} = require("../apps/api/src/wechat-work/wechat-work.service");
const {
  WechatWorkInboundUnderstandingService,
} = require("../apps/api/src/wechat-work/wechat-work-inbound-understanding.service");

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);

function testWavBytes() {
  const sampleRate = 16000;
  const dataSize = Math.floor(sampleRate * 0.2) * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function setup(options = {}) {
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
  appConfig.wechatWorkAutoSyncRateLimitBackoffMs = 60_000;
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
    customerProfileCalls: [],
    contactWayCalls: [],
    accountListCalls: 0,
    upgradeConfigCalls: 0,
    customerUpgradeCalls: [],
    syncResponse: { errcode: 0, errmsg: "ok", has_more: 0, msg_list: [] },
    sendFailures: [],
    uploadFailures: [],
    imageSendFailures: [],
    downloadFailures: [],
    downloadResponse: { bytes: VALID_PNG, contentType: "image/png", size: VALID_PNG.length },
    customerProfileResponse: { errcode: 0, errmsg: "ok", customer_list: [] },
    contactWayResponse: { errcode: 0, errmsg: "ok", url: "https://work.weixin.qq.com/kf/customer-entry-test" },
    accountListResponse: {
      errcode: 0,
      errmsg: "ok",
      account_list: [{ open_kfid: "wk-default", name: "咨询客服", avatar: "", manage_privilege: true }],
    },
    upgradeConfigResponse: {
      errcode: 0,
      errmsg: "ok",
      member_range: { userid_list: ["member-owner"], department_id_list: [] },
      groupchat_range: { chat_id_list: [] },
    },
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
      return this.downloadResponse;
    },
    async getCustomerProfiles(externalUserIds) {
      this.customerProfileCalls.push(externalUserIds);
      return this.customerProfileResponse;
    },
    async createCustomerContactWay(payload) {
      this.contactWayCalls.push(payload);
      return this.contactWayResponse;
    },
    async listCustomerServiceAccounts() {
      this.accountListCalls += 1;
      return this.accountListResponse;
    },
    async listCustomerServiceAccountsWithSecret(secret) {
      this.validatedSecret = secret;
      return this.accountListResponse;
    },
    clearAccessToken() {},
    async getUpgradeServiceConfig() {
      this.upgradeConfigCalls += 1;
      return this.upgradeConfigResponse;
    },
    async upgradeCustomerToMember(payload) {
      this.customerUpgradeCalls.push(payload);
      return { errcode: 0, errmsg: "ok" };
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
  const service = new WechatWorkService(
    dispatch,
    localStore,
    api,
    undefined,
    undefined,
    undefined,
    options.inboundUnderstanding,
    options.assets,
  );
  return { api, localStore, dispatch, service, tempDir };
}

test("customer profile refresh replaces placeholder identity with official nickname and avatar", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-profile", externalUserId: "wm-profile" });
  api.customerProfileResponse = {
    errcode: 0,
    errmsg: "ok",
    customer_list: [{
      external_userid: "wm-profile",
      nickname: "真实客户昵称",
      avatar: "https://example.com/customer-avatar.png",
    }],
  };

  const result = await service.refreshCustomerProfile({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
  });

  assert.equal(api.customerProfileCalls.length, 1);
  assert.deepEqual(api.customerProfileCalls[0], ["wm-profile"]);
  assert.equal(result.customer.name, "真实客户昵称");
  assert.equal(result.customer.avatarUrl, "https://example.com/customer-avatar.png");
  assert.equal(result.conversation.title, "真实客户昵称");
});

test("an inbound customer logo is registered as a scoped design asset before routing", async () => {
  const uploads = [];
  let localStore;
  const assets = {
    list: async (filter) => localStore.listDesignAssets(filter),
    upload: async (payload) => {
      uploads.push(payload);
      const localPath = path.join(appConfig.localStorageRoot, "design-assets", `${Date.now()}-${payload.fileName}`);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, Buffer.from(payload.base64, "base64"));
      return localStore.createDesignAsset({
        ownerType: payload.ownerType,
        ownerId: payload.ownerId,
        role: payload.role,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        localPath,
        normalizedLocalPath: localPath,
        sizeBytes: fs.statSync(localPath).size,
        source: payload.source,
        wechatAccountId: payload.expectedWechatAccountId,
        conversationId: payload.expectedConversationId,
        customerId: payload.expectedCustomerId,
      });
    },
  };
  const inboundUnderstanding = {
    enrich: async (normalized) => ({
      ...normalized,
      text: `${normalized.text}\n视觉理解：客户上传了公司 Logo。`,
      understanding: { status: "understood", summary: "客户上传了公司 Logo" },
    }),
  };
  const prepared = setup({ assets, inboundUnderstanding });
  ({ localStore } = prepared);
  const { api, service } = prepared;
  api.syncResponse = {
    errcode: 0,
    errmsg: "ok",
    has_more: 0,
    msg_list: [{
      msgid: "incoming-customer-logo",
      open_kfid: "wk-logo",
      external_userid: "wm-logo",
      msgtype: "image",
      image: { media_id: "media-logo" },
    }],
  };

  const result = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-logo" });
  const binding = localStore.getWechatWorkBinding("wk-logo", "wm-logo");
  const message = localStore.findMessageByExternalId(binding.conversationId, "incoming-customer-logo");

  assert.equal(result.processedCount, 1);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].role, "customer_logo");
  assert.equal(uploads[0].expectedWechatAccountId, binding.wechatAccountId);
  assert.equal(uploads[0].expectedConversationId, binding.conversationId);
  assert.equal(uploads[0].expectedCustomerId, binding.customerId);
  assert.equal(message.attachments[0].assetId, localStore.listDesignAssets({ customerId: binding.customerId })[0].id);
});

test("customer entry uses the official contact-way API and reuses the generated link", async () => {
  const { api, localStore, dispatch, service } = setup();

  const first = await service.createCustomerEntryContactWay();
  const second = await service.createCustomerEntryContactWay();

  assert.equal(first.url, "https://work.weixin.qq.com/kf/customer-entry-test");
  assert.equal(first.openKfid, "wk-default");
  assert.equal(first.scene, "smart_kefu_customer_entry");
  assert.deepEqual(second, first);
  assert.deepEqual(api.contactWayCalls, [{ openKfid: "wk-default", scene: "smart_kefu_customer_entry" }]);
  assert.equal(
    localStore.listWechatWorkAuditLogs(20).filter((item) => item.action === "customer_entry_generated").length,
    1,
  );

  const restartedService = new WechatWorkService(dispatch, localStore, api);
  const restored = await restartedService.getCustomerEntryContactWay();
  assert.equal(restored.url, first.url);
  assert.equal(api.contactWayCalls.length, 1);
});

test("all accessible customer-service accounts receive one persistent QR entry", async () => {
  const { api, localStore, service } = setup();
  api.accountListResponse.account_list = [
    { open_kfid: "wk-default", name: "primary", avatar: "", manage_privilege: true },
    { open_kfid: "wk-secondary", name: "secondary", avatar: "", manage_privilege: false },
    { open_kfid: "wk-third", name: "third", avatar: "", manage_privilege: false },
  ];
  api.createCustomerContactWay = async function createCustomerContactWay(payload) {
    this.contactWayCalls.push(payload);
    return {
      errcode: 0,
      errmsg: "ok",
      url: `https://work.weixin.qq.com/kfid/${payload.openKfid}`,
    };
  };

  const first = await service.bindAllCustomerEntryContactWays();
  assert.equal(first.ok, true);
  assert.equal(first.accountCount, 3);
  assert.equal(first.boundAccountCount, 3);
  assert.equal(first.createdAccountCount, 3);
  assert.equal(first.reusedAccountCount, 0);
  assert.equal(first.failedAccountCount, 0);
  assert.deepEqual(api.contactWayCalls.map((call) => call.openKfid), ["wk-default", "wk-secondary", "wk-third"]);
  assert.equal(
    localStore.listWechatWorkAuditLogs(20).filter((item) => item.action === "customer_entry_generated").length,
    3,
  );

  const second = await service.bindAllCustomerEntryContactWays();
  assert.equal(second.ok, true);
  assert.equal(second.createdAccountCount, 0);
  assert.equal(second.reusedAccountCount, 3);
  assert.equal(api.contactWayCalls.length, 3);
});

test("long-term customer upgrade validates the bound identity and configured specialist", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upgrade", externalUserId: "wm-upgrade" });

  const config = await service.getUpgradeServiceConfig();
  assert.equal(config.ready, true);
  assert.deepEqual(config.memberUserIds, ["member-owner"]);

  const result = await service.upgradeCustomerToMemberService({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
    requestId: "customer-upgrade:test-0001",
  });

  assert.equal(result.recommended, true);
  assert.equal(result.alreadyRecommended, false);
  assert.deepEqual(api.customerUpgradeCalls, [{
    openKfid: "wk-upgrade",
    externalUserId: "wm-upgrade",
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
  }]);
  const audit = localStore.listWechatWorkAuditLogs(20)
    .find((item) => item.action === "customer_upgrade_recommended");
  assert.equal(audit.customerId, binding.customerId);
  assert.equal(audit.conversationId, binding.conversationId);

  await assert.rejects(
    () => service.upgradeCustomerToMemberService({
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      memberUserId: "not-configured",
      requestId: "customer-upgrade:test-0002",
    }),
    /不在企业微信“升级服务”允许范围内/,
  );
});

test("upgrade configuration reports missing Enterprise WeChat permission as an actionable client error", async () => {
  const { api, service } = setup();
  api.getUpgradeServiceConfig = async () => {
    throw new WechatWorkApiError("get_upgrade_service_config", "api forbidden", { errcode: 48002 });
  };

  await assert.rejects(
    () => service.getUpgradeServiceConfig(),
    (error) => error?.status === 400 && /开通微信客服“升级服务”接口权限/.test(error.message),
  );
});

test("customer entry reports mismatched Enterprise WeChat credential mode as an actionable client error", async () => {
  const { api, service } = setup();
  api.createCustomerContactWay = async () => {
    throw new WechatWorkApiError("add_contact_way", "already use in wecom", { errcode: 95011 });
  };

  await assert.rejects(
    () => service.createCustomerEntryContactWay(),
    (error) => error?.status === 400 && /联合版微信客服/.test(error.message) && /独立版 Secret/.test(error.message),
  );
});

test("existing official customer-service link can be imported, replaced, and restored", async () => {
  const { api, localStore, dispatch, service } = setup();
  const first = await service.importCustomerEntryContactWay({
    url: "https://work.weixin.qq.com/kf/kf-first?enc_scene=first-signed-value",
  });
  const replacement = await service.importCustomerEntryContactWay({
    url: "https://work.weixin.qq.com/kf/kf-second?enc_scene=second-signed-value",
  });

  assert.equal(first.scene, "wecom_admin_import");
  assert.equal(replacement.url, "https://work.weixin.qq.com/kf/kf-second?enc_scene=second-signed-value");
  assert.equal(api.contactWayCalls.length, 0);
  assert.equal(
    localStore.listWechatWorkAuditLogs(20).filter((item) => item.action === "customer_entry_generated").length,
    1,
  );

  const restartedService = new WechatWorkService(dispatch, localStore, api);
  assert.equal((await restartedService.getCustomerEntryContactWay()).url, replacement.url);
});

test("stable kfid customer-service link can be imported without a legacy scene query", async () => {
  const { api, service } = setup();
  const entry = await service.importCustomerEntryContactWay({
    url: "https://work.weixin.qq.com/kfid/kf-stable-customer-entry",
  });

  assert.equal(entry.url, "https://work.weixin.qq.com/kfid/kf-stable-customer-entry");
  assert.equal(entry.scene, "wecom_admin_import");
  assert.equal(api.contactWayCalls.length, 0);
});

test("customer-service link import rejects non-official or incomplete links", async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.importCustomerEntryContactWay({ url: "https://example.com/kf/not-official?enc_scene=fake" }),
    /企业微信官方客服链接/,
  );
  await assert.rejects(
    () => service.importCustomerEntryContactWay({ url: "https://work.weixin.qq.com/kf/kf-missing-signature" }),
    /缺少企业微信签名参数/,
  );
});

test("live connection diagnosis reads official customer-service accounts without overstating runtime evidence", async () => {
  const { api, service } = setup();
  const diagnosis = await service.diagnoseCustomerServiceConnection();

  assert.equal(api.accountListCalls, 1);
  assert.equal(diagnosis.apiReachable, true);
  assert.equal(diagnosis.credentialCompatible, true);
  assert.equal(diagnosis.configuredOpenKfidFound, true);
  assert.equal(diagnosis.ready, false);
  assert.equal(diagnosis.blockerCode, "RUNTIME_EVIDENCE_PENDING");
});

test("live connection diagnosis exposes the real 95011 credential-mode blocker", async () => {
  const { api, service } = setup();
  api.listCustomerServiceAccounts = async () => {
    throw new WechatWorkApiError("account_list", "already use in wecom", { errcode: 95011 });
  };
  const diagnosis = await service.diagnoseCustomerServiceConnection();

  assert.equal(diagnosis.ready, false);
  assert.equal(diagnosis.credentialCompatible, false);
  assert.equal(diagnosis.blockerCode, "CREDENTIAL_MODE_MISMATCH_95011");
  assert.match(diagnosis.detail, /微信客服 Secret/);
});

test("customer-service Secret is verified before being saved with an official account", async () => {
  const { api, service, tempDir } = setup();
  const envFile = path.join(tempDir, "runtime.env");
  fs.writeFileSync(envFile, "UNCHANGED_VALUE=keep\nWECHAT_WORK_SECRET=old-secret\nWECHAT_WORK_OPEN_KFID=wk-old\n", "utf8");
  const previousEnvFile = process.env.DESKTOP_ENV_FILE;
  process.env.DESKTOP_ENV_FILE = envFile;
  try {
    api.syncResponse = {
      errcode: 0,
      errmsg: "ok",
      has_more: 0,
      next_cursor: "cursor-after-connect",
      msg_list: [],
    };
    const validation = await service.validateCustomerServiceCredential({ secret: "new-customer-service-secret-123" });
    assert.equal(validation.valid, true);
    assert.equal(validation.suggestedOpenKfid, "wk-default");
    const saved = await service.saveCustomerServiceCredential({
      secret: "new-customer-service-secret-123",
      openKfid: "wk-default",
    });
    assert.equal(saved.saved, true);
    assert.equal(saved.account.name, "咨询客服");
    assert.equal(saved.activation.activated, true);
    assert.equal(saved.activation.sync.ok, true);
    assert.equal(saved.activation.customerEntry.ok, true);
    assert.equal(saved.activation.customerEntry.entry.url, "https://work.weixin.qq.com/kf/customer-entry-test");
    const persisted = fs.readFileSync(envFile, "utf8");
    assert.match(persisted, /UNCHANGED_VALUE=keep/);
    assert.match(persisted, /WECHAT_WORK_SECRET=new-customer-service-secret-123/);
    assert.match(persisted, /WECHAT_WORK_OPEN_KFID=wk-default/);
    assert.equal(api.validatedSecret, "new-customer-service-secret-123");
    assert.deepEqual(api.syncCalls, [{ token: undefined, cursor: "", limit: 100, openKfid: "wk-default" }]);
    assert.deepEqual(api.contactWayCalls, [{ openKfid: "wk-default", scene: "smart_kefu_customer_entry" }]);
  } finally {
    if (previousEnvFile === undefined) delete process.env.DESKTOP_ENV_FILE;
    else process.env.DESKTOP_ENV_FILE = previousEnvFile;
  }
});

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
  const imageOperation = localStore.getInboundMessageOperation(bindingB.wechatAccountId, "incoming-2");
  assert.equal(imageOperation.normalizedPayload.attachments[0].mediaId, "media-1");
  assert.equal(imageOperation.normalizedPayload.attachments[0].type, "image/png");
  assert.equal("localPath" in imageOperation.normalizedPayload.attachments[0], false);
});

test("sync_msg turns image understanding into the actual customer turn before Xiaoshi routing", async () => {
  const inboundUnderstanding = new WechatWorkInboundUnderstandingService({
    async understandImages() {
      return {
        text: "客户图片中是咖色礼盒，腰封需要印公司 Logo，未提供数量和预算",
        provider: "vision-stub",
        model: "vision-fast",
        attempts: 1,
      };
    },
  });
  const { api, localStore, service } = setup({ inboundUnderstanding });
  api.syncResponse = {
    errcode: 0,
    has_more: 0,
    msg_list: [{
      msgid: "incoming-understood-image",
      open_kfid: "wk-understood",
      external_userid: "wm-understood",
      msgtype: "image",
      image: { media_id: "media-understood" },
    }],
  };

  const result = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-understood" });
  const binding = localStore.getWechatWorkBinding("wk-understood", "wm-understood");
  const message = localStore.findMessageByExternalId(binding.conversationId, "incoming-understood-image");
  const route = localStore.listRouteEvaluations({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
  })[0];

  assert.equal(result.processedCount, 1);
  assert.match(message.text, /咖色礼盒.*公司 Logo/);
  assert.notEqual(message.text, "[图片]");
  assert.equal(message.attachments[0].mediaUnderstanding.status, "understood");
  assert.equal(route.text, message.text);
  assert.equal(route.replyDraft.mediaUnderstanding.status, "understood");
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "inbound_media_understood"));
});

test("sync_msg downloads voice with its own limit, transcribes it, and routes the transcript", async (t) => {
  if (spawnSync("ffmpeg", ["-version"], { windowsHide: true }).status !== 0) return t.skip("ffmpeg unavailable");
  const inboundUnderstanding = new WechatWorkInboundUnderstandingService({
    async transcribeAudio() {
      return {
        text: "教师节要八百份，单价二十五元以内，有没有实用一点的",
        provider: "stt-stub",
        model: "stt-fast",
        attempts: 1,
      };
    },
  });
  const { api, localStore, service } = setup({ inboundUnderstanding });
  const bytes = testWavBytes();
  api.downloadResponse = { bytes, contentType: "audio/wav", size: bytes.length };
  api.syncResponse = {
    errcode: 0,
    has_more: 0,
    msg_list: [{
      msgid: "incoming-understood-voice",
      open_kfid: "wk-understood-voice",
      external_userid: "wm-understood-voice",
      msgtype: "voice",
      voice: { media_id: "voice-understood" },
    }],
  };

  const result = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-understood-voice" });
  const binding = localStore.getWechatWorkBinding("wk-understood-voice", "wm-understood-voice");
  const message = localStore.findMessageByExternalId(binding.conversationId, "incoming-understood-voice");

  assert.equal(result.processedCount, 1);
  assert.equal(api.downloadCalls[0].maxBytes, 20 * 1024 * 1024);
  assert.match(message.text, /教师节.*八百份.*二十五元/);
  assert.equal(message.attachments[0].msgtype, "voice");
  assert.match(message.attachments[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(message.attachments[0].mediaUnderstanding.status, "understood");
});

test("failed image understanding blocks placeholder auto-replies and routes to manual review", async () => {
  const inboundUnderstanding = new WechatWorkInboundUnderstandingService({
    async understandImages() {
      throw new Error("vision provider unavailable");
    },
  });
  const { api, localStore, service } = setup({ inboundUnderstanding });
  api.syncResponse = {
    errcode: 0,
    has_more: 0,
    msg_list: [{
      msgid: "incoming-unreadable-image",
      open_kfid: "wk-unreadable",
      external_userid: "wm-unreadable",
      msgtype: "image",
      image: { media_id: "media-unreadable" },
    }],
  };

  const result = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-unreadable" });
  const binding = localStore.getWechatWorkBinding("wk-unreadable", "wm-unreadable");
  const message = localStore.findMessageByExternalId(binding.conversationId, "incoming-unreadable-image");
  const route = localStore.listRouteEvaluations({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
  })[0];

  assert.equal(result.processedCount, 1);
  assert.match(message.text, /图片处理失败.*人工查看/);
  assert.equal(route.action, "manual_review");
  assert.equal(route.routingPolicy.canQueueAutoReply, false);
  assert.equal(api.sendCalls.length, 0);
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "inbound_media_manual_review"));
});

test("independent-mode recovery sync does not require a callback token", async () => {
  const { api, service } = setup();
  api.syncResponse = {
    errcode: 0,
    errmsg: "ok",
    has_more: 0,
    next_cursor: "independent-cursor-1",
    msg_list: [],
  };

  const result = await service.syncCustomerServiceMessages({ openKfid: "wk-independent" });

  assert.equal(result.ok, true);
  assert.equal(result.cursorCommitted, true);
  assert.equal(api.syncCalls.length, 1);
  assert.equal(api.syncCalls[0].token, undefined);
  assert.equal(api.syncCalls[0].openKfid, "wk-independent");
});

test("fallback polling synchronizes every accessible customer-service account and backs off permission-denied accounts", async () => {
  const { api, localStore, service } = setup();
  api.accountListResponse = {
    errcode: 0,
    errmsg: "ok",
    account_list: [
      { open_kfid: "wk-default", name: "primary", avatar: "", manage_privilege: true },
      { open_kfid: "wk-secondary", name: "secondary", avatar: "", manage_privilege: false },
      { open_kfid: "wk-denied", name: "denied", avatar: "", manage_privilege: false },
    ],
  };
  api.syncMessages = async function syncMessages(payload) {
    this.syncCalls.push(payload);
    if (payload.openKfid === "wk-denied") {
      throw new WechatWorkApiError("sync_msg", "api forbidden for no kfid privilege", { errcode: 48007 });
    }
    return {
      errcode: 0,
      errmsg: "ok",
      has_more: 0,
      next_cursor: `cursor-${payload.openKfid}-${this.syncCalls.length}`,
      msg_list: [],
    };
  };

  const first = await service.syncAllCustomerServiceAccounts({ limit: 37 });
  assert.equal(first.ok, true);
  assert.equal(first.partial, true);
  assert.equal(first.accountCount, 3);
  assert.equal(first.synchronizedAccountCount, 2);
  assert.equal(first.skippedAccountCount, 1);
  assert.deepEqual(api.syncCalls.map((call) => call.openKfid), ["wk-default", "wk-secondary", "wk-denied"]);
  assert.deepEqual(
    localStore.listWechatAccounts()
      .filter((account) => ["wk-default", "wk-secondary", "wk-denied"].includes(account.wechatWork?.openKfid))
      .map((account) => account.displayName)
      .sort(),
    ["denied", "primary", "secondary"],
  );
  assert.ok(first.accounts.every((account) => account.wechatAccountId));

  const second = await service.syncAllCustomerServiceAccounts({ limit: 37 });
  assert.equal(second.synchronizedAccountCount, 2);
  assert.equal(second.skippedAccountCount, 1);
  assert.deepEqual(api.syncCalls.map((call) => call.openKfid), [
    "wk-default",
    "wk-secondary",
    "wk-denied",
    "wk-default",
    "wk-secondary",
  ]);
});

test("fallback polling rotates a bounded account batch instead of bursting every account", async () => {
  const { api, service } = setup();
  api.accountListResponse = {
    errcode: 0,
    errmsg: "ok",
    account_list: [
      { open_kfid: "wk-default", name: "primary", avatar: "", manage_privilege: true },
      { open_kfid: "wk-secondary", name: "secondary", avatar: "", manage_privilege: false },
      { open_kfid: "wk-third", name: "third", avatar: "", manage_privilege: false },
    ],
  };

  const first = await service.syncAllCustomerServiceAccounts({ limit: 37, maxAccounts: 1 });
  const second = await service.syncAllCustomerServiceAccounts({ limit: 37, maxAccounts: 1 });

  assert.deepEqual(api.syncCalls.map((call) => call.openKfid), ["wk-default", "wk-secondary"]);
  assert.equal(first.accountCount, 3);
  assert.equal(first.attemptedAccountCount, 1);
  assert.equal(first.deferredAccountCount, 2);
  assert.equal(second.attemptedAccountCount, 1);
  assert.equal(second.deferredAccountCount, 2);
});

test("fallback polling stops a 45009 burst and honors the shared delayed retry window", async () => {
  const { api, service } = setup();
  api.accountListResponse = {
    errcode: 0,
    errmsg: "ok",
    account_list: [
      { open_kfid: "wk-default", name: "primary", avatar: "", manage_privilege: true },
      { open_kfid: "wk-secondary", name: "secondary", avatar: "", manage_privilege: false },
    ],
  };
  api.syncMessages = async function syncMessages(payload) {
    this.syncCalls.push(payload);
    throw new WechatWorkApiError("sync_msg", "rate limited", { errcode: 45009 });
  };

  const first = await service.syncAllCustomerServiceAccounts({ limit: 37, maxAccounts: 2 });
  const second = await service.syncAllCustomerServiceAccounts({ limit: 37, maxAccounts: 2 });

  assert.equal(first.throttled, true);
  assert.equal(first.blockerCode, "SYNC_RATE_LIMIT_BACKOFF_45009");
  assert.equal(first.attemptedAccountCount, 1);
  assert.equal(first.accounts[0].blockerCode, "SYNC_RATE_LIMIT_BACKOFF_45009");
  assert.equal(api.syncCalls.length, 1);
  assert.equal(second.throttled, true);
  assert.equal(second.attemptedAccountCount, 0);
  assert.equal(api.accountListCalls, 1);
  assert.equal(api.syncCalls.length, 1);
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
  const { api, dispatch, localStore, service } = setup();
  let immediateReplyRuns = 0;
  const originalProcessSafeSendQueue = dispatch.processSafeSendQueue.bind(dispatch);
  dispatch.processSafeSendQueue = async (params) => {
    immediateReplyRuns += 1;
    assert.equal(params.automationOnly, true);
    assert.equal(params.inboundReplyOnly, true);
    return originalProcessSafeSendQueue(params);
  };
  api.syncResponse = {
    errcode: 0,
    errmsg: "ok",
    has_more: 0,
    next_cursor: "callback-cursor-1",
    msg_list: [{
      msgid: "callback-customer-message-1",
      open_kfid: "wk-callback",
      external_userid: "wm-callback-customer",
      msgtype: "text",
      text: { content: "你好" },
    }],
  };
  const xml = "<xml><ToUserName><![CDATA[corp-test]]></ToUserName><CreateTime>1710000000</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[callback-sync-token]]></Token><OpenKfId><![CDATA[wk-callback]]></OpenKfId></xml>";
  const encrypted = encryptCallback(xml, appConfig.wechatWorkEncodingAesKey, appConfig.wechatWorkCorpId);
  const query = { timestamp: "1710000000", nonce: "nonce-test" };
  query.msg_signature = sha1Sorted([appConfig.wechatWorkToken, query.timestamp, query.nonce, encrypted]);

  const response = await service.handleCallback(query, `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`);
  assert.equal(response, "success");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(api.syncCalls.length, 1);
  assert.equal(api.syncCalls[0].token, "callback-sync-token");
  assert.equal(api.syncCalls[0].openKfid, "wk-callback");
  assert.equal(immediateReplyRuns, 1);
  assert.ok(localStore.listWechatWorkAuditLogs(20).some((item) => (
    item.action === "callback_sync_completed"
    && item.processedCount === 1
  )));
});

test("callback sync retries a transient network failure without waiting for fallback polling", async () => {
  const { api, localStore, service } = setup();
  let calls = 0;
  api.syncMessages = async function syncMessages(payload) {
    this.syncCalls.push(payload);
    calls += 1;
    if (calls === 1) throw new WechatWorkApiError("sync_msg", "fetch failed");
    return { errcode: 0, errmsg: "ok", has_more: 0, msg_list: [] };
  };

  await service.handleRemoteCallbackSignal({ openKfid: "wk-retry", eventId: "event-retry" });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  assert.equal(api.syncCalls.length, 2);
  const audit = localStore.listWechatWorkAuditLogs(20);
  assert.ok(audit.some((item) => item.action === "callback_sync_failed" && item.retryScheduled === true));
  assert.ok(audit.some((item) => item.action === "callback_sync_completed" && item.retryAttempt === 1));
});

test("callback retry policy backs off rate limits and rejects permanent API errors", () => {
  assert.equal(callbackSyncRetryDelayMs(new WechatWorkApiError("sync_msg", "fetch failed"), 0), 750);
  assert.equal(callbackSyncRetryDelayMs(new WechatWorkApiError("sync_msg", "fetch failed"), 3), null);
  assert.equal(
    callbackSyncRetryDelayMs(new WechatWorkApiError("sync_msg", "rate limited", { errcode: 45009 }), 0, 60_000),
    60_000,
  );
  assert.equal(
    callbackSyncRetryDelayMs(new WechatWorkApiError("sync_msg", "invalid secret", { errcode: 40001 }), 0),
    null,
  );
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

test("manual conversation reply completes through kf/send_msg instead of staying in sending", async () => {
  const { api, localStore, dispatch } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-manual-send", externalUserId: "wm-manual-send" });
  localStore.updateConversation(binding.conversationId, { manualLocked: true });
  const queued = await dispatch.enqueueManualReply({
    operationKey: "wechat-work:manual-reply-completes",
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    text: "人工核对后的回复",
    operator: "operator-test",
  });

  const result = await dispatch.executeManualReplyNow(queued.task.id, expectedIdentity(binding));

  assert.equal(result.task.status, "sent");
  assert.equal(result.attempt.status, "sent");
  assert.equal(api.sendCalls.length, 1);
  assert.equal(api.sendCalls[0].text, "人工核对后的回复");
  assert.equal(localStore.getSendTask(queued.task.id).status, "sent");
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
  const outboundMsgId = api.sendCalls[0].msgid;
  const expectedMsgId = `kf_${crypto.createHash("sha256").update(queued.task.id).digest("hex").slice(0, 27)}`;
  assert.equal(outboundMsgId, expectedMsgId);
  assert.equal(Buffer.byteLength(outboundMsgId, "utf8"), 30);
  assert.equal(localStore.getSendTask(queued.task.id).status, "sent");
  const attempt = localStore.getLatestSendAttempt(queued.task.id, { adapter: "wechat_work_kf" });
  assert.equal(attempt.status, "sent");
  assert.equal(attempt.metadata.apiMsgId, `api-${outboundMsgId}`);
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "send_dispatch_requested"));
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "send_api_accepted"));
});

test("sending official delivery cancel protection still converges to a late API success", async () => {
  const { api, localStore, dispatch, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-late-success", externalUserId: "wm-late-success" });
  const queued = await service.queueCustomerServiceText({
    requestId: "wechat-work:late-success-after-cancel",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "late official success",
  });
  let releaseSend;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const release = new Promise((resolve) => { releaseSend = resolve; });
  api.sendText = async (payload) => {
    api.sendCalls.push(payload);
    markStarted();
    await release;
    return { errcode: 0, errmsg: "ok", msgid: `api-${payload.msgid}` };
  };

  const inFlight = service.dispatchCustomerServiceText(queued.task.id);
  await started;
  const protectedTask = dispatch.cancelSendTask(queued.task.id, expectedIdentity(binding, {
    reason: "operator requested stop while official delivery was in flight",
  }));
  assert.equal(protectedTask.status, "sending");
  assert.equal(protectedTask.guardSnapshot.deliveryState, "unknown");
  releaseSend();
  const completed = await inFlight;

  assert.equal(completed.task.status, "sent");
  assert.equal(completed.task.guardSnapshot.deliveryState, "sent");
  assert.equal(completed.task.guardSnapshot.manualReviewRequired, false);
  assert.equal(localStore.getLatestSendAttempt(queued.task.id).status, "sent");
});

test("audited confirmed not sent outranks a later official API success", async () => {
  const { api, localStore, dispatch, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-manual-outranks", externalUserId: "wm-manual-outranks" });
  const queued = await service.queueCustomerServiceText({
    requestId: "wechat-work:manual-outranks-late-success",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "manual conclusion must remain terminal",
  });
  let releaseSend;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const release = new Promise((resolve) => { releaseSend = resolve; });
  api.sendText = async (payload) => {
    api.sendCalls.push(payload);
    markStarted();
    await release;
    return { errcode: 0, errmsg: "ok", msgid: `api-${payload.msgid}` };
  };

  const inFlight = service.dispatchCustomerServiceText(queued.task.id);
  await started;
  dispatch.cancelSendTask(queued.task.id, expectedIdentity(binding, {
    reason: "stop requested before manual verification",
  }));
  const resolutionPayload = expectedIdentity(binding, {
    operationKey: "send-resolution:official-not-sent:0001",
    resolution: "confirmed_not_sent",
    reason: "operator verified that the official message did not appear",
  });
  const resolved = await dispatch.resolveUnknownSendDelivery(
    queued.task.id,
    resolutionPayload,
    "operator-official-review",
  );
  assert.equal(resolved.status, "failed");
  assert.equal(resolved.guardSnapshot.deliveryResolutionPriority, "manual_audited_terminal");

  releaseSend();
  const lateCompletion = await inFlight;
  assert.equal(lateCompletion.task.status, "failed");
  assert.equal(lateCompletion.stateChanged, true);
  const finalTask = localStore.getSendTask(queued.task.id);
  assert.equal(finalTask.status, "failed");
  assert.equal(finalTask.guardSnapshot.manualDeliveryResolution.resolution, "confirmed_not_sent");
  assert.equal(
    localStore.listWechatWorkAuditLogs().filter((entry) => entry.action === "send_delivery_manual_resolution").length,
    1,
  );
});

test("local restart recovery keeps stale official delivery unknown and blocks automatic replay idempotently", async () => {
  const { api, localStore, dispatch, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-restart-unknown", externalUserId: "wm-restart-unknown" });
  const stale = await service.queueCustomerServiceText({
    requestId: "wechat-work:restart-unknown-stale",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "stale official attempt",
  });
  const queued = await service.queueCustomerServiceText({
    requestId: "wechat-work:restart-unknown-next",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "must not replay while predecessor is unknown",
  });
  localStore.updateSendTask(stale.task.id, { status: "sending" });
  const attempt = localStore.createSendAttempt({
    sendTaskId: stale.task.id,
    adapter: "wechat_work_kf",
    status: "started",
    metadata: {
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
    },
  });
  localStore.updateSendAttempt(attempt.id, {
    startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  });

  const first = await dispatch.scanSendOperations({ conversationId: binding.conversationId });
  const replay = await dispatch.scanSendOperations({ conversationId: binding.conversationId });
  const protectedTask = localStore.getSendTask(stale.task.id);
  const protectedAttempt = localStore.getLatestSendAttempt(stale.task.id, { adapter: "wechat_work_kf" });
  assert.equal(first.wechatWorkDeliveryUnknown, 1);
  assert.equal(replay.wechatWorkDeliveryUnknown, 1);
  assert.equal(protectedTask.status, "sending");
  assert.equal(protectedTask.guardSnapshot.deliveryState, "unknown");
  assert.equal(protectedTask.guardSnapshot.manualReviewRequired, true);
  assert.equal(protectedAttempt.status, "started");
  assert.equal(
    localStore.listWechatWorkAuditLogs().filter((entry) =>
      entry.sendTaskId === stale.task.id && entry.action === "send_delivery_unknown").length,
    1,
  );

  const queue = await dispatch.processSafeSendQueue({
    adapter: "wechat_work_kf",
    conversationId: binding.conversationId,
  });
  assert.equal(api.sendCalls.length, 0);
  assert.equal(queue.processed.length, 0);
  assert.equal(queue.skipped[0].sendTaskId, queued.task.id);
  assert.equal(queue.skipped[0].reason, "not_account_queue_head");
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
  const baseMsgId = `kf_${crypto.createHash("sha256").update(queued.task.id).digest("hex").slice(0, 27)}`;
  assert.equal(api.sendCalls[0].msgid, `${baseMsgId}_1`);
  assert.deepEqual(api.imageSendCalls.map((item) => item.msgid), [`${baseMsgId}_2`, `${baseMsgId}_3`]);
  assert.ok(
    [api.sendCalls[0], ...api.imageSendCalls]
      .every((item) => Buffer.byteLength(item.msgid, "utf8") <= 32),
  );
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

test("WeChat Work invalid customer-service session fails once without automatic retry", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-session-invalid", externalUserId: "wm-session-invalid" });
  api.sendFailures.push(new WechatWorkApiError("send_msg", "send msg session status invalid", { errcode: 95018 }));
  const queued = await service.queueCustomerServiceText({
    requestId: "wechat-work:test-session-invalid",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "route-only test reply",
  });

  const result = await service.dispatchCustomerServiceText(queued.task.id);
  assert.equal(result.task.status, "failed");
  assert.equal(result.retryScheduled, false);
  assert.equal(api.sendCalls.length, 1);
  assert.equal(result.attempt.metadata.deliveryState, "failed");
  assert.equal(result.attempt.metadata.automaticRetryBlocked, true);
  assert.equal(result.task.guardSnapshot.manualReviewRequired, false);
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "send_api_failed"));
});

test("WeChat Work send-count exhaustion fails once without low-value replay", async () => {
  const { api, localStore, dispatch, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-count-limit", externalUserId: "wm-count-limit" });
  api.sendFailures.push(new WechatWorkApiError("send_msg", "send msg count limit", { errcode: 95001 }));
  const queued = await service.queueCustomerServiceText({
    requestId: "wechat-work:test-count-limit",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "route-only test reply",
  });
  localStore.updateSendTask(queued.task.id, {
    guardSnapshot: {
      ...(queued.task.guardSnapshot || {}),
      automation: { source: "inbound_message", valueLevel: "low", planType: "queue_reply" },
    },
  });

  const result = await service.dispatchCustomerServiceText(queued.task.id);
  assert.equal(result.task.status, "failed");
  assert.equal(result.retryScheduled, false);
  assert.equal(api.sendCalls.length, 1);
  assert.equal(result.attempt.metadata.deliveryState, "failed");
  assert.equal(result.attempt.metadata.automaticRetryBlocked, true);

  const scan = await dispatch.scanSendOperations({ conversationId: binding.conversationId });
  assert.equal(scan.tasks.autoRetriedLowValue.length, 0);
  assert.equal(localStore.listSendAttempts({ sendTaskId: queued.task.id, limit: 20 }).length, 1);
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
  assert.equal(result.task.status, "sending");
  assert.equal(result.retryScheduled, false);
  assert.equal(result.attempt.status, "started");
  assert.equal(result.attempt.metadata.deliveryState, "unknown");
  assert.equal(result.attempt.metadata.automaticRetryBlocked, true);
  assert.equal(result.task.guardSnapshot.manualReviewRequired, true);
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "send_delivery_unknown"));
});

test("in-flight cancellation survives a later known API failure and low-value scan does not replay it", async () => {
  const { api, localStore, dispatch, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-cancel-race", externalUserId: "wm-cancel-race" });
  const queued = await service.queueCustomerServiceText({
    requestId: "wechat-work:cancel-race",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "route-only test reply",
  });
  localStore.updateSendTask(queued.task.id, {
    guardSnapshot: {
      ...(queued.task.guardSnapshot || {}),
      automation: { source: "inbound_message", valueLevel: "low", planType: "queue_reply" },
    },
  });

  let rejectSend;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  api.sendText = async (payload) => {
    api.sendCalls.push(payload);
    signalStarted();
    return new Promise((resolve, reject) => { rejectSend = reject; });
  };

  const sending = service.dispatchCustomerServiceText(queued.task.id);
  await started;
  const protectedTask = dispatch.cancelSendTask(queued.task.id, {
    ...expectedIdentity(binding),
    reason: "route_only_acceptance_cancel",
  });
  assert.equal(protectedTask.status, "sending");
  assert.equal(protectedTask.guardSnapshot.automaticRetryBlocked, true);
  rejectSend(new WechatWorkApiError("send_msg", "send msg count limit", { errcode: 95001 }));

  const result = await sending;
  assert.equal(result.retryScheduled, false);
  assert.equal(result.task.status, "failed");
  assert.equal(result.task.guardSnapshot.automaticRetryBlocked, true);
  assert.equal(Boolean(result.task.guardSnapshot.cancelRequestedAt), true);

  const scan = await dispatch.scanSendOperations({ conversationId: binding.conversationId });
  assert.equal(scan.tasks.autoRetriedLowValue.length, 0);
  assert.equal(localStore.getSendTask(queued.task.id).status, "failed");
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
  assert.equal(result.task.status, "sending");
  assert.equal(result.retryScheduled, false);
  assert.equal(result.attempt.status, "started");
  assert.equal(result.attempt.metadata.deliveryState, "partial");
  assert.equal(result.attempt.metadata.acceptedMessageIds.length, 1);
  assert.equal(result.attempt.metadata.automaticRetryBlocked, true);
});

function expectedIdentity(binding, extra = {}) {
  return {
    expectedWechatAccountId: binding.wechatAccountId,
    expectedConversationId: binding.conversationId,
    expectedCustomerId: binding.customerId,
    ...extra,
  };
}

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

test("official API client omits token for independent-mode recovery sync", async (t) => {
  setup();
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
    const body = JSON.parse(init.body);
    assert.equal("token" in body, false);
    assert.equal(body.cursor, "");
    assert.equal(body.open_kfid, "wk-independent-client");
    return new Response(JSON.stringify({
      errcode: 0,
      errmsg: "ok",
      has_more: 0,
      next_cursor: "independent-client-cursor",
      msg_list: [],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await new WechatWorkApiClient().syncMessages({ openKfid: "wk-independent-client" });
  assert.equal(result.next_cursor, "independent-client-cursor");
  assert.equal(requests.length, 2);
});

test("official API client requests customer nickname and avatar with customer/batchget", async (t) => {
  setup();
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
    return new Response(JSON.stringify({
      errcode: 0,
      errmsg: "ok",
      customer_list: [{ external_userid: "wm-profile", nickname: "客户昵称", avatar: "https://example.com/a.png" }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await new WechatWorkApiClient().getCustomerProfiles(["wm-profile"]);

  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /\/cgi-bin\/kf\/customer\/batchget\?access_token=access-token/);
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    external_userid_list: ["wm-profile"],
    need_enter_session_context: 0,
  });
  assert.equal(result.customer_list[0].nickname, "客户昵称");
});

test("official API client creates customer links and submits configured member upgrades", async (t) => {
  setup();
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const requests = [];
  global.fetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url.includes("/cgi-bin/gettoken?")) {
      return new Response(JSON.stringify({ errcode: 0, access_token: "access-token", expires_in: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (request.url.includes("/cgi-bin/kf/add_contact_way?")) {
      return Response.json({ errcode: 0, errmsg: "ok", url: "https://work.weixin.qq.com/kf/customer-link" });
    }
    if (request.url.includes("/cgi-bin/kf/customer/get_upgrade_service_config?")) {
      return Response.json({
        errcode: 0,
        errmsg: "ok",
        member_range: { userid_list: ["member-owner"], department_id_list: [] },
        groupchat_range: { chat_id_list: [] },
      });
    }
    return Response.json({ errcode: 0, errmsg: "ok" });
  };

  const client = new WechatWorkApiClient();
  const contact = await client.createCustomerContactWay({ openKfid: "wk-entry", scene: "smart_kefu_customer_entry" });
  const config = await client.getUpgradeServiceConfig();
  await client.upgradeCustomerToMember({
    openKfid: "wk-entry",
    externalUserId: "wm-customer",
    memberUserId: "member-owner",
    wording: "添加企业微信后继续为您服务。",
  });

  assert.equal(contact.url, "https://work.weixin.qq.com/kf/customer-link");
  assert.deepEqual(config.member_range.userid_list, ["member-owner"]);
  assert.match(requests[1].url, /\/cgi-bin\/kf\/add_contact_way\?access_token=access-token/);
  assert.equal(requests[1].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    open_kfid: "wk-entry",
    scene: "smart_kefu_customer_entry",
  });
  assert.match(requests[2].url, /\/cgi-bin\/kf\/customer\/get_upgrade_service_config\?access_token=access-token/);
  assert.equal(requests[2].init.method, "GET");
  assert.match(requests[3].url, /\/cgi-bin\/kf\/customer\/upgrade_service\?access_token=access-token/);
  assert.deepEqual(JSON.parse(requests[3].init.body), {
    open_kfid: "wk-entry",
    external_userid: "wm-customer",
    type: 1,
    member: {
      userid: "member-owner",
      wording: "添加企业微信后继续为您服务。",
    },
  });
});

test("official API client retries sync_msg without the optional callback token after errcode 95012", async (t) => {
  setup();
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const syncBodies = [];
  global.fetch = async (url, init = {}) => {
    if (String(url).includes("/cgi-bin/gettoken?")) {
      return new Response(JSON.stringify({ errcode: 0, access_token: "access-token", expires_in: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(init.body);
    syncBodies.push(body);
    if (syncBodies.length === 1) {
      return new Response(JSON.stringify({ errcode: 95012, errmsg: "not use in wecom" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      errcode: 0,
      errmsg: "ok",
      has_more: 0,
      next_cursor: "fallback-cursor",
      msg_list: [],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await new WechatWorkApiClient().syncMessages({
    token: "callback-token",
    openKfid: "wk-token-fallback",
  });
  assert.equal(result.next_cursor, "fallback-cursor");
  assert.equal(syncBodies.length, 2);
  assert.equal(syncBodies[0].token, "callback-token");
  assert.equal("token" in syncBodies[1], false);
  assert.equal(syncBodies[1].open_kfid, "wk-token-fallback");
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
