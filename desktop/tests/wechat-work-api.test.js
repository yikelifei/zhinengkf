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
const { deterministicOperationId } = require("../apps/api/src/shared/operation-idempotency");
const { WechatDispatchService } = require("../apps/api/src/wechat/wechat-dispatch.service");
const { WechatSendAdapterService } = require("../apps/api/src/wechat/wechat-send-adapter.service");
const { WechatWorkApiClient, WechatWorkApiError } = require("../apps/api/src/wechat-work/wechat-work-api.client");
const {
  WechatWorkService,
  callbackSyncRetryDelayMs,
} = require("../apps/api/src/wechat-work/wechat-work.service");
const {
  sealWechatWorkEventCode,
  wechatWorkEventCodeHash,
} = require("../apps/api/src/wechat-work/wechat-work-event-code");
const {
  WechatWorkInboundUnderstandingService,
} = require("../apps/api/src/wechat-work/wechat-work-inbound-understanding.service");

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAIAAACkr0LiAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVR4nGOowA0YhoEcAE90ZUHwfJsHAAAAAElFTkSuQmCC",
  "base64",
);
const WECHAT_WORK_EVENT_CODE_SHORT_TTL_MS = 20_000;
const WECHAT_WORK_EVENT_CODE_LONG_TTL_MS = 48 * 60 * 60 * 1000;

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
  appConfig.wechatWorkExternalContactSecret = "";
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
    messageCalls: [],
    uploadCalls: [],
    imageSendCalls: [],
    operationCalls: [],
    downloadCalls: [],
    customerProfileCalls: [],
    contactWayCalls: [],
    accountListCalls: 0,
    accountCreateCalls: [],
    accountUpdateCalls: [],
    accountDeleteCalls: [],
    servicerListCalls: [],
    servicerAddCalls: [],
    servicerDeleteCalls: [],
    corpStatisticCalls: [],
    servicerStatisticCalls: [],
    applicationListCalls: 0,
    visibleUserListCalls: [],
    upgradeConfigCalls: 0,
    userProfileCalls: [],
    customerUpgradeCalls: [],
    externalContactFollowUserCalls: [],
    externalContactWayCalls: [],
    externalContactGetCalls: [],
    externalContactQrDownloadCalls: [],
    customerUpgradeCancelCalls: [],
    serviceStateGetCalls: [],
    serviceStateTransferCalls: [],
    eventTextCalls: [],
    eventMessageCalls: [],
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
    servicerListResponses: new Map([["wk-default", {
      errcode: 0,
      errmsg: "ok",
      servicer_list: [{ userid: "member-owner", status: 0 }],
    }]]),
    corpStatisticResponse: {
      errcode: 0,
      errmsg: "ok",
      statistic_list: [{
        stat_time: 1_775_472_400,
        statistic: {
          session_cnt: 5,
          customer_cnt: 4,
          customer_msg_cnt: 12,
          ai_session_reply_cnt: 3,
          ai_transfer_rate: 0.25,
          upgrade_service_customer_cnt: 1,
        },
      }],
    },
    servicerStatisticResponses: new Map(),
    visibleUserListResponse: {
      errcode: 0,
      errmsg: "ok",
      next_cursor: "",
      dept_user: [{ userid: "member-owner", department: 1 }],
    },
    applicationListResponse: {
      errcode: 0,
      errmsg: "ok",
      agentlist: [{ agentid: 1000003, name: "臻希AI", square_logo_url: "https://example.com/app.png" }],
    },
    upgradeConfigResponse: {
      errcode: 0,
      errmsg: "ok",
      member_range: { userid_list: ["member-owner"], department_id_list: [] },
      groupchat_range: { chat_id_list: [] },
    },
    externalContactFollowUserResponse: {
      errcode: 0,
      errmsg: "ok",
      follow_user: ["member-owner"],
    },
    externalContactResponses: new Map(),
    serviceStateResponse: { errcode: 0, errmsg: "ok", service_state: 1 },
    serviceStateTransferResponse: { errcode: 0, errmsg: "ok", service_state: 2 },
    userProfileResponses: new Map([[
      "member-owner",
      { errcode: 0, errmsg: "ok", userid: "member-owner", name: "售后小司", alias: "member-owner" },
    ]]),
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
    async sendMessage(payload) {
      this.messageCalls.push(payload);
      this.operationCalls.push({ type: payload.msgtype, msgid: payload.msgid });
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
    async listApplications() {
      this.applicationListCalls += 1;
      if (this.applicationListResponse instanceof Error) throw this.applicationListResponse;
      return this.applicationListResponse;
    },
    async addCustomerServiceAccount(payload) {
      this.accountCreateCalls.push(payload);
      return { errcode: 0, errmsg: "ok", open_kfid: "wk-created" };
    },
    async updateCustomerServiceAccount(payload) {
      this.accountUpdateCalls.push(payload);
      return { errcode: 0, errmsg: "ok" };
    },
    async deleteCustomerServiceAccount(openKfid) {
      this.accountDeleteCalls.push(openKfid);
      return { errcode: 0, errmsg: "ok" };
    },
    async listCustomerServiceServicers(openKfid) {
      this.servicerListCalls.push(openKfid);
      return this.servicerListResponses.get(openKfid) || { errcode: 0, errmsg: "ok", servicer_list: [] };
    },
    async getCustomerServiceCorpStatistic(payload) {
      this.corpStatisticCalls.push(payload);
      if (this.corpStatisticResponse instanceof Error) throw this.corpStatisticResponse;
      return this.corpStatisticResponse;
    },
    async getCustomerServiceServicerStatistic(payload) {
      this.servicerStatisticCalls.push(payload);
      const key = payload.servicerUserId || "__summary";
      const configured = this.servicerStatisticResponses.get(key);
      if (configured instanceof Error) throw configured;
      return configured || {
        errcode: 0,
        errmsg: "ok",
        statistic_list: [{
          stat_time: 1_775_472_400,
          statistic: {
            session_cnt: payload.servicerUserId ? 2 : 4,
            customer_cnt: payload.servicerUserId ? 2 : 3,
            customer_msg_cnt: 8,
            reply_rate: 0.75,
            first_reply_average_sec: 18,
            satisfied_rate: 1,
            upgrade_service_customer_cnt: 1,
            msg_rejected_customer_cnt: 0,
          },
        }],
      };
    },
    async addCustomerServiceServicers(payload) {
      this.servicerAddCalls.push(payload);
      return {
        errcode: 0,
        errmsg: "ok",
        result_list: payload.userIds.map((userid) => ({ userid, errcode: 0, errmsg: "ok" })),
      };
    },
    async deleteCustomerServiceServicers(payload) {
      this.servicerDeleteCalls.push(payload);
      return {
        errcode: 0,
        errmsg: "ok",
        result_list: payload.userIds.map((userid) => ({ userid, errcode: 0, errmsg: "ok" })),
      };
    },
    clearAccessToken() {},
    async getUpgradeServiceConfig() {
      this.upgradeConfigCalls += 1;
      return this.upgradeConfigResponse;
    },
    async listExternalContactFollowUsers(secret) {
      this.externalContactFollowUserCalls.push(secret || null);
      if (this.externalContactFollowUserResponse instanceof Error) throw this.externalContactFollowUserResponse;
      return this.externalContactFollowUserResponse;
    },
    async createExternalContactWay(payload) {
      this.externalContactWayCalls.push(payload);
      return {
        errcode: 0,
        errmsg: "ok",
        config_id: `contact-way-${payload.memberUserId}`,
        qr_code: "https://p.qpic.cn/external-contact-qr/test",
      };
    },
    async getExternalContactWay(configId) {
      return {
        errcode: 0,
        errmsg: "ok",
        contact_way: {
          config_id: configId,
          qr_code: "https://p.qpic.cn/external-contact-qr/test",
        },
      };
    },
    async getExternalContact(externalUserId) {
      this.externalContactGetCalls.push(externalUserId);
      return this.externalContactResponses.get(externalUserId) || {
        errcode: 0,
        errmsg: "ok",
        external_contact: { external_userid: externalUserId },
      };
    },
    async downloadExternalContactQrCode(url) {
      this.externalContactQrDownloadCalls.push(url);
      return { bytes: VALID_PNG, contentType: "image/png", size: VALID_PNG.length };
    },
    clearExternalContactAccessToken() {},
    async getUserProfile(userId) {
      this.userProfileCalls.push(userId);
      const response = this.userProfileResponses.get(userId);
      if (response instanceof Error) throw response;
      return response || { errcode: 0, errmsg: "ok", userid: userId };
    },
    async listVisibleUserIds(cursor) {
      this.visibleUserListCalls.push(cursor);
      return this.visibleUserListResponse;
    },
    async upgradeCustomerToMember(payload) {
      this.customerUpgradeCalls.push(payload);
      return { errcode: 0, errmsg: "ok" };
    },
    async cancelCustomerUpgrade(payload) {
      this.customerUpgradeCancelCalls.push(payload);
      return { errcode: 0, errmsg: "ok" };
    },
    async getServiceState(payload) {
      this.serviceStateGetCalls.push(payload);
      return this.serviceStateResponse;
    },
    async transferServiceState(payload) {
      this.serviceStateTransferCalls.push(payload);
      return this.serviceStateTransferResponse;
    },
    async sendTextOnEvent(payload) {
      this.eventTextCalls.push(payload);
      return { errcode: 0, errmsg: "ok", msgid: payload.msgid || "api-event-msgid" };
    },
    async sendMessageOnEvent(payload) {
      this.eventMessageCalls.push(payload);
      return { errcode: 0, errmsg: "ok", msgid: payload.msgid || "api-event-menu-msgid" };
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

test("customer-service operations resolves Chinese member names and exposes manageable accounts", async () => {
  const { api, service } = setup();
  api.accountListResponse.account_list.push({
    open_kfid: "wk-sales",
    name: "销售顾问",
    avatar: "https://example.com/sales.png",
    manage_privilege: true,
  });
  api.servicerListResponses.set("wk-default", {
    errcode: 0,
    errmsg: "ok",
    servicer_list: [
      { userid: "member-owner", status: 0 },
      { userid: "member-sales", status: 0 },
    ],
  });
  api.servicerListResponses.set("wk-sales", {
    errcode: 0,
    errmsg: "ok",
    servicer_list: [{ userid: "member-sales", status: 0 }],
  });
  api.visibleUserListResponse.dept_user.push({ userid: "member-sales", department: 2 });
  api.userProfileResponses.set("member-sales", {
    errcode: 0,
    errmsg: "ok",
    userid: "member-sales",
    name: "销售小李",
    avatar: "https://example.com/member-sales.png",
    department: [2],
  });

  const result = await service.getCustomerServiceOperations();

  assert.equal(result.accountCount, 2);
  assert.equal(result.servicerCount, 2);
  assert.equal(result.manageableAccountCount, 2);
  assert.equal(result.directoryAvailable, true);
  assert.equal(result.accounts[0].servicers[0].displayName, "售后小司");
  assert.equal(result.accounts[1].servicers[0].displayName, "销售小李");
  assert.equal(result.availableMembers.find((member) => member.userId === "member-sales").displayName, "销售小李");
});

test("customer-service operations falls back to upgrade specialists when full directory permission is missing", async () => {
  const { api, service } = setup();
  api.listVisibleUserIds = async () => {
    throw new WechatWorkApiError("user_list_id", "api forbidden", { errcode: 48002 });
  };
  api.upgradeConfigResponse.member_range.userid_list.push("member-sales");
  api.userProfileResponses.set("member-sales", {
    errcode: 0,
    errmsg: "ok",
    userid: "member-sales",
    name: "销售小李",
  });

  const result = await service.getCustomerServiceOperations();

  assert.equal(result.directoryAvailable, false);
  assert.equal(result.memberSource, "upgrade_service_members");
  assert.match(result.directoryError, /回退到升级服务专员范围/);
  assert.equal(result.availableMembers.find((member) => member.userId === "member-sales").displayName, "销售小李");
});

test("servicer operations are audited and cannot remove the final servicer", async () => {
  const { api, localStore, service } = setup();
  api.visibleUserListResponse.dept_user.push({ userid: "member-sales", department: 2 });

  const added = await service.addCustomerServiceServicers({
    openKfid: "wk-default",
    userIds: ["member-sales"],
    requestId: "operations:add-member-sales",
  });

  assert.equal(added.ok, true);
  assert.deepEqual(api.servicerAddCalls[0], { openKfid: "wk-default", userIds: ["member-sales"] });
  assert.equal(localStore.listWechatWorkAuditLogs(10)[0].action, "kf_servicers_added");

  await assert.rejects(
    () => service.deleteCustomerServiceServicers({
      openKfid: "wk-default",
      userIds: ["member-owner"],
      requestId: "operations:delete-final-servicer",
    }),
    /至少保留一名接待人员/,
  );
  assert.equal(api.servicerDeleteCalls.length, 0);
});

test("customer-service statistics aggregates official daily data, resolves names, and records read audit", async () => {
  const { api, localStore, service } = setup();
  const result = await service.getCustomerServiceStatistics({
    openKfid: "wk-default",
    startDate: shanghaiDateDaysAgo(7),
    endDate: shanghaiDateDaysAgo(1),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.partial, false);
  assert.equal(result.corporate.summary.sessionCount, 5);
  assert.equal(result.corporate.summary.aiTransferRate, 0.25);
  assert.equal(result.servicerSummary.summary.replyRate, 0.75);
  assert.equal(result.servicers[0].displayName, "售后小司");
  assert.equal(result.servicers[0].summary.firstReplyAverageSec, 18);
  assert.equal(api.corpStatisticCalls.length, 1);
  assert.equal(api.servicerStatisticCalls.length, 2);
  const audit = localStore.listWechatWorkAuditLogs(10)[0];
  assert.equal(audit.action, "kf_statistics_read");
  assert.equal(audit.status, "processed");
  assert.equal(audit.openKfid, "wk-default");
});

test("customer-service statistics surfaces permission failures without claiming data readiness", async () => {
  const { api, localStore, service } = setup();
  api.corpStatisticResponse = new WechatWorkApiError("get_corp_statistic", "api forbidden", { errcode: 48002 });

  const result = await service.getCustomerServiceStatistics({
    openKfid: "wk-default",
    startDate: shanghaiDateDaysAgo(7),
    endDate: shanghaiDateDaysAgo(1),
  });

  assert.equal(result.status, "permission_required");
  assert.equal(result.corporate, null);
  assert.match(result.error.message, /统计权限/);
  assert.equal(localStore.listWechatWorkAuditLogs(10)[0].status, "failed");
});

test("customer-service statistics stops remaining servicer reads after the first official rate limit", async () => {
  const { api, service } = setup();
  api.servicerListResponses.set("wk-default", {
    errcode: 0,
    errmsg: "ok",
    servicer_list: [
      { userid: "member-owner", status: 0 },
      { userid: "member-sales", status: 0 },
    ],
  });
  api.servicerStatisticResponses.set(
    "member-owner",
    new WechatWorkApiError("get_servicer_statistic", "rate limited", { errcode: 45009, retryAfterSeconds: 60 }),
  );

  const result = await service.getCustomerServiceStatistics({
    openKfid: "wk-default",
    startDate: shanghaiDateDaysAgo(7),
    endDate: shanghaiDateDaysAgo(1),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.partial, true);
  assert.equal(result.partialReason, "rate_limited");
  assert.deepEqual(api.servicerStatisticCalls.map((item) => item.servicerUserId || "summary"), ["summary", "member-owner"]);
  assert.equal(result.errors[1].code, "WECHAT_WORK_STATISTICS_SKIPPED_AFTER_RATE_LIMIT");
});

test("customer-service statistics rejects today and date ranges longer than 31 days before calling official APIs", async () => {
  const { api, service } = setup();
  await assert.rejects(
    () => service.getCustomerServiceStatistics({
      openKfid: "wk-default",
      startDate: shanghaiDateDaysAgo(30),
      endDate: shanghaiDateDaysAgo(0),
    }),
    /昨天至前 180 天/,
  );
  await assert.rejects(
    () => service.getCustomerServiceStatistics({
      openKfid: "wk-default",
      startDate: shanghaiDateDaysAgo(40),
      endDate: shanghaiDateDaysAgo(1),
    }),
    /最多查询 31 个自然日/,
  );
  assert.equal(api.corpStatisticCalls.length, 0);
});

test("the configured customer-service account cannot be deleted", async () => {
  const { api, service } = setup();

  await assert.rejects(
    () => service.deleteCustomerServiceAccount({
      openKfid: "wk-default",
      confirmName: "咨询客服",
      requestId: "operations:delete-configured-account",
    }),
    /正在使用的客服账号不能删除/,
  );
  assert.equal(api.accountDeleteCalls.length, 0);
});

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
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upgrade", externalUserId: "wm-upgrade" });

  const config = await service.getUpgradeServiceConfig();
  assert.equal(config.ready, true);
  assert.deepEqual(config.memberUserIds, ["member-owner"]);
  assert.deepEqual(config.memberOptions, [{
    userId: "member-owner",
    displayName: "售后小司",
    resolution: "user_get",
  }]);
  assert.match(config.detail, /解析了成员姓名/);
  assert.equal(config.deliveryReady, true);
  assert.equal(config.customerContact.configured, true);
  assert.deepEqual(config.customerContact.eligibleMemberUserIds, ["member-owner"]);
  assert.deepEqual(api.userProfileCalls, ["member-owner"]);

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
  assert.equal(result.customerDeliveryApiAccepted, true);
  assert.equal(result.customerPhoneReceiptConfirmed, false);
  assert.equal(result.deliveryMode, "wechat_work_external_contact_qr");
  assert.match(result.deliveryNote, /接口已受理/);
  assert.equal(api.externalContactWayCalls.length, 1);
  assert.equal(api.externalContactQrDownloadCalls.length, 1);
  assert.deepEqual(api.operationCalls.map((item) => item.type), ["upload", "image", "text"]);
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
  assert.equal(audit.memberUserId, "member-owner");

  const duplicate = await service.upgradeCustomerToMemberService({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
    requestId: "customer-upgrade:test-duplicate-new-request",
  });
  assert.equal(duplicate.recommended, true);
  assert.equal(duplicate.alreadyRecommended, true);
  assert.equal(duplicate.customerDeliveryApiAccepted, true);
  assert.equal(duplicate.alreadyDelivered, true);
  assert.equal(duplicate.customerPhoneReceiptConfirmed, false);
  assert.equal(duplicate.duplicateScope, "customer_member");
  assert.equal(api.customerUpgradeCalls.length, 1);
  assert.equal(api.externalContactWayCalls.length, 1);
  assert.deepEqual(api.operationCalls.map((item) => item.type), ["upload", "image", "text"]);

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

test("concurrent long-term upgrade requests create and send exactly one specialist QR", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upgrade-concurrent", externalUserId: "wm-upgrade-concurrent" });
  const originalCreate = api.createExternalContactWay.bind(api);
  api.createExternalContactWay = async (payload) => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return originalCreate(payload);
  };
  const payload = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
  };

  const results = await Promise.all([
    service.upgradeCustomerToMemberService({ ...payload, requestId: "customer-upgrade:concurrent-a" }),
    service.upgradeCustomerToMemberService({ ...payload, requestId: "customer-upgrade:concurrent-b" }),
  ]);

  assert.equal(api.externalContactWayCalls.length, 1);
  assert.equal(api.externalContactQrDownloadCalls.length, 1);
  assert.equal(api.customerUpgradeCalls.length, 1);
  assert.deepEqual(api.operationCalls.map((item) => item.type), ["upload", "image", "text"]);
  assert.equal(results.some((result) => result.customerDeliveryApiAccepted), true);
  const status = await service.getCustomerUpgradeStatus({ ...payload });
  assert.equal(status.status, "api_accepted");
});

test("specialist QR remains successful when the optional wording hits the session limit", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  api.sendFailures.push(new WechatWorkApiError("send_msg", "send msg count limit", { errcode: 95001 }));
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upgrade-partial", externalUserId: "wm-upgrade-partial" });
  const payload = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
  };

  const first = await service.upgradeCustomerToMemberService({ ...payload, requestId: "customer-upgrade:partial-a" });
  assert.equal(first.deliveryStatus, "api_accepted");
  assert.equal(first.customerDeliveryApiAccepted, true);
  assert.equal(first.textStatus, "failed");
  assert.equal(first.imageStatus, "api_accepted");
  const operationsAfterFirst = api.operationCalls.length;

  const duplicate = await service.upgradeCustomerToMemberService({ ...payload, requestId: "customer-upgrade:partial-b" });
  assert.equal(duplicate.deliveryStatus, "api_accepted");
  assert.equal(duplicate.customerDeliveryApiAccepted, true);
  assert.equal(api.operationCalls.length, operationsAfterFirst);
  assert.equal(api.externalContactWayCalls.length, 1);
  assert.equal(api.customerUpgradeCalls.length, 1);
});

test("a first QR failure leaves the optional specialist wording not started", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  api.imageSendFailures.push(new WechatWorkApiError("send_msg", "send msg count limit", { errcode: 95001 }));
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upgrade-text-failed", externalUserId: "wm-upgrade-text-failed" });

  const result = await service.upgradeCustomerToMemberService({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
    requestId: "customer-upgrade:text-failed",
  });

  assert.equal(result.deliveryStatus, "failed");
  assert.equal(result.textStatus, "not_started");
  assert.equal(result.imageStatus, "failed");
  assert.deepEqual(api.operationCalls.map((item) => item.type), ["upload", "image"]);
});

test("the next inbound message safely resumes only a failed specialist QR", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  api.imageSendFailures.push(new WechatWorkApiError("send_msg", "send msg count limit", { errcode: 95001 }));
  const binding = localStore.upsertWechatWorkBinding({
    openKfid: "wk-upgrade-recover",
    externalUserId: "wm-upgrade-recover",
  });
  const payload = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
  };

  const first = await service.upgradeCustomerToMemberService({
    ...payload,
    requestId: "customer-upgrade:recover-first",
  });
  assert.equal(first.imageStatus, "failed");
  const operationsAfterFirst = api.operationCalls.length;

  const recovered = await service.resumePendingCustomerUpgradeQrAfterInbound({
    binding,
    msgid: "inbound-opens-new-send-window",
  });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.upgrade.status, "api_accepted");
  assert.equal(recovered.upgrade.imageStatus, "api_accepted");
  assert.equal(recovered.upgrade.textStatus, "not_started");
  assert.deepEqual(
    api.operationCalls.slice(operationsAfterFirst).map((item) => item.type),
    ["upload", "image"],
  );

  const duplicate = await service.resumePendingCustomerUpgradeQrAfterInbound({
    binding,
    msgid: "inbound-opens-new-send-window",
  });
  assert.equal(duplicate, null);
  assert.equal(api.externalContactWayCalls.length, 1);
});

test("a deferred specialist QR recovery stays queued and suppresses duplicate inbound routing", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  api.imageSendFailures.push(new WechatWorkApiError("send_msg", "send msg count limit", { errcode: 95001 }));
  const binding = localStore.upsertWechatWorkBinding({
    openKfid: "wk-upgrade-recovery-queued",
    externalUserId: "wm-upgrade-recovery-queued",
  });
  const identity = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
  };
  const first = await service.upgradeCustomerToMemberService({
    ...identity,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
    requestId: "customer-upgrade:recovery-queued-first",
  });
  assert.equal(first.imageStatus, "failed");
  const blocker = await service.queueCustomerServiceText({
    requestId: "wechat-work:recovery-queue-blocker",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "队首占位消息",
  });
  const sendCountBeforeInbound = api.sendCalls.length;

  const processed = await service.processSyncedItem({
    msgid: "inbound-recovery-is-queued",
    open_kfid: binding.openKfid,
    external_userid: binding.externalUserId,
    send_time: Math.floor(Date.now() / 1000),
    msgtype: "text",
    text: { content: "二维码发了吗" },
  }, binding.openKfid);

  assert.equal(processed.status, "processed");
  assert.equal(processed.result.plan.type, "service_action_queued");
  assert.equal(processed.result.plan.reason, "customer_upgrade_qr_queued");
  assert.equal(processed.result.sendTask, null);
  assert.equal(api.sendCalls.length, sendCountBeforeInbound);
  assert.equal(localStore.getSendTask(blocker.task.id).status, "queued");
  const upgrade = await service.getCustomerUpgradeStatus({
    ...identity,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
  });
  assert.equal(upgrade.status, "queued");
  assert.equal(upgrade.imageStatus, "queued");
  const duplicateRecovery = await service.resumePendingCustomerUpgradeQrAfterInbound({
    binding,
    msgid: "another-message-must-not-create-another-qr-task",
  });
  assert.equal(duplicateRecovery, null);
  const queuedQrTasks = localStore.listSendTasks().filter((task) => (
    task.status === "queued"
    && task.id !== blocker.task.id
    && task.payload?.kind === "wechat_work_messages"
  ));
  assert.equal(queuedQrTasks.length, 1);
});

test("a failed specialist QR recovery requeues the same durable task on the next inbound window", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  api.imageSendFailures.push(
    new WechatWorkApiError("send_msg", "initial image failed", { errcode: 95001 }),
    new WechatWorkApiError("send_msg", "first recovery failed", { errcode: 95001 }),
  );
  const binding = localStore.upsertWechatWorkBinding({
    openKfid: "wk-upgrade-recovery-requeue",
    externalUserId: "wm-upgrade-recovery-requeue",
  });
  const identity = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
  };
  const initial = await service.upgradeCustomerToMemberService({
    ...identity,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
    requestId: "customer-upgrade:recovery-requeue-initial",
  });
  assert.equal(initial.imageStatus, "failed");
  const firstRecovery = await service.resumePendingCustomerUpgradeQrAfterInbound({
    binding,
    msgid: "inbound-recovery-fails-once",
  });
  assert.equal(firstRecovery.recovered, false);
  assert.equal(firstRecovery.upgrade.status, "failed");
  const failedRecoveryTaskId = firstRecovery.upgrade.sendTaskId;
  const taskCountAfterFailure = localStore.listSendTasks().length;

  const recovered = await service.resumePendingCustomerUpgradeQrAfterInbound({
    binding,
    msgid: "inbound-recovery-reuses-task",
  });
  assert.equal(recovered.recovered, true, JSON.stringify(recovered));
  assert.equal(recovered.upgrade.status, "api_accepted");
  assert.equal(recovered.upgrade.sendTaskId, failedRecoveryTaskId);
  assert.equal(localStore.listSendTasks().length, taskCountAfterFailure);
  assert.equal(localStore.listSendAttempts({ sendTaskId: failedRecoveryTaskId }).length, 2);
});

test("selecting a new specialist permanently supersedes the old failed QR", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  api.visibleUserListResponse.dept_user.push({ userid: "member-second", department: 1 });
  api.upgradeConfigResponse.member_range.userid_list.push("member-second");
  api.externalContactFollowUserResponse.follow_user.push("member-second");
  api.userProfileResponses.set("member-second", {
    errcode: 0,
    errmsg: "ok",
    userid: "member-second",
    name: "另一专员",
    alias: "member-second",
  });
  api.imageSendFailures.push(
    new WechatWorkApiError("send_msg", "send msg count limit", { errcode: 95001 }),
    new WechatWorkApiError("send_msg", "send msg count limit", { errcode: 95001 }),
  );
  const binding = localStore.upsertWechatWorkBinding({
    openKfid: "wk-upgrade-superseded",
    externalUserId: "wm-upgrade-superseded",
  });
  const identity = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
  };

  const first = await service.upgradeCustomerToMemberService({
    ...identity,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
    requestId: "customer-upgrade:superseded-first",
  });
  const second = await service.upgradeCustomerToMemberService({
    ...identity,
    memberUserId: "member-second",
    wording: "添加企业微信后，我继续为您服务。",
    requestId: "customer-upgrade:superseded-second",
  });
  assert.equal(first.imageStatus, "failed");
  assert.equal(second.imageStatus, "failed");

  const firstId = deterministicOperationId(
    "wwupgrade",
    `${appConfig.wechatWorkCorpId}:${binding.openKfid}:${binding.externalUserId}:member-owner`,
  );
  const secondId = deterministicOperationId(
    "wwupgrade",
    `${appConfig.wechatWorkCorpId}:${binding.openKfid}:${binding.externalUserId}:member-second`,
  );
  assert.equal(localStore.getWechatWorkCustomerUpgrade(firstId).status, "superseded");
  assert.equal(localStore.getWechatWorkCustomerUpgrade(secondId).status, "failed");

  const recovered = await service.resumePendingCustomerUpgradeQrAfterInbound({
    binding,
    msgid: "inbound-recovers-current-specialist-only",
  });
  assert.equal(recovered.upgrade.id, secondId);
  assert.equal(recovered.upgrade.memberUserId, "member-second");
  assert.equal(recovered.upgrade.status, "api_accepted");
  const staleRecovery = await service.resumePendingCustomerUpgradeQrAfterInbound({
    binding,
    msgid: "inbound-must-not-recover-old-specialist",
  });
  assert.equal(staleRecovery, null);
  assert.equal(localStore.getWechatWorkCustomerUpgrade(firstId).status, "superseded");
});

test("specialist QR recovery runs before the inbound route can apply a manual lock", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  api.imageSendFailures.push(new WechatWorkApiError("send_msg", "send msg count limit", { errcode: 95001 }));
  const binding = localStore.upsertWechatWorkBinding({
    openKfid: "wk-upgrade-route-lock",
    externalUserId: "wm-upgrade-route-lock",
  });
  const payload = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
  };
  const first = await service.upgradeCustomerToMemberService({
    ...payload,
    requestId: "customer-upgrade:route-lock-first",
  });
  assert.equal(first.imageStatus, "failed");
  const operationsAfterFirst = api.operationCalls.length;

  const processed = await service.processSyncedItem({
    msgid: "inbound-route-lock-opens-window",
    open_kfid: binding.openKfid,
    external_userid: binding.externalUserId,
    send_time: Math.floor(Date.now() / 1000),
    msgtype: "text",
    text: { content: "测试二维码" },
  }, binding.openKfid);

  assert.equal(processed.status, "processed");
  assert.equal(processed.result.plan.type, "service_action_completed");
  assert.equal(processed.result.plan.reason, "customer_upgrade_qr_recovered");
  assert.equal(processed.result.sendTask, null);
  assert.equal(processed.result.notification, null);
  assert.equal(
    localStore.listConversations().find((item) => item.id === binding.conversationId).manualLocked,
    false,
  );
  const status = await service.getCustomerUpgradeStatus(payload);
  assert.equal(status.status, "api_accepted");
  assert.equal(status.imageStatus, "api_accepted");
  assert.deepEqual(
    api.operationCalls.slice(operationsAfterFirst).map((item) => item.type),
    ["upload", "image"],
  );
});

test("operator QR recovery uses the latest inbound message and selected specialist", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  api.imageSendFailures.push(new WechatWorkApiError("send_msg", "send msg count limit", { errcode: 95001 }));
  const binding = localStore.upsertWechatWorkBinding({
    openKfid: "wk-upgrade-operator-retry",
    externalUserId: "wm-upgrade-operator-retry",
  });
  const payload = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
  };
  const first = await service.upgradeCustomerToMemberService({
    ...payload,
    requestId: "customer-upgrade:operator-retry-first",
  });
  assert.equal(first.imageStatus, "failed");
  const upgrade = localStore.getWechatWorkCustomerUpgrade(
    deterministicOperationId(
      "wwupgrade",
      `${appConfig.wechatWorkCorpId}:${binding.openKfid}:${binding.externalUserId}:member-owner`,
    ),
  );
  localStore.createMessage({
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    wechatAccountId: binding.wechatAccountId,
    direction: "inbound",
    text: "继续发送二维码",
    externalId: "operator-retry-inbound",
    createdAt: new Date(Date.parse(upgrade.updatedAt) + 1_000).toISOString(),
  });

  const recovered = await service.retryPendingCustomerUpgradeQr(payload);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.triggerMsgid, "operator-retry-inbound");
  assert.equal(recovered.status.status, "api_accepted");
  assert.equal(recovered.status.imageStatus, "api_accepted");
});

test("specialist QR delivery resumes a persisted remote contact way without creating another one", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upgrade-resume", externalUserId: "wm-upgrade-resume" });
  const upgradeId = deterministicOperationId(
    "wwupgrade",
    `${appConfig.wechatWorkCorpId}:${binding.openKfid}:${binding.externalUserId}:member-owner`,
  );
  const state = `lt_${crypto.createHash("sha256").update(upgradeId).digest("hex").slice(0, 20)}`;
  localStore.claimWechatWorkCustomerUpgrade({
    id: upgradeId,
    corpId: appConfig.wechatWorkCorpId,
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    state,
    claimToken: "customer-upgrade:crashed-process",
  });
  localStore.updateWechatWorkCustomerUpgrade(upgradeId, {
    status: "remote_created",
    configId: "contact-way-resume",
    qrCodeUrl: "https://p.qpic.cn/external-contact-qr/test",
  });

  const result = await service.upgradeCustomerToMemberService({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
    requestId: "customer-upgrade:resume",
  });

  assert.equal(result.customerDeliveryApiAccepted, true);
  assert.equal(api.externalContactWayCalls.length, 0);
  assert.equal(api.externalContactQrDownloadCalls.length, 1);
  assert.equal(localStore.getWechatWorkCustomerUpgrade(upgradeId).configId, "contact-way-resume");
});

test("external-contact callback confirms the customer added the selected specialist", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upgrade-added", externalUserId: "wm-upgrade-added" });
  api.customerProfileResponse = {
    errcode: 0,
    errmsg: "ok",
    customer_list: [{ external_userid: binding.externalUserId, unionid: "union-upgrade-added" }],
  };
  api.externalContactResponses.set("wm-added-contact", {
    errcode: 0,
    errmsg: "ok",
    external_contact: { external_userid: "wm-added-contact", unionid: "union-upgrade-added" },
  });
  const payload = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
  };
  await service.upgradeCustomerToMemberService({ ...payload, requestId: "customer-upgrade:added" });
  const upgradeId = deterministicOperationId(
    "wwupgrade",
    `${appConfig.wechatWorkCorpId}:${binding.openKfid}:${binding.externalUserId}:member-owner`,
  );
  const upgrade = localStore.getWechatWorkCustomerUpgrade(upgradeId);
  const halfXml = `<xml><ToUserName><![CDATA[corp-test]]></ToUserName><CreateTime>1710000001</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[change_external_contact]]></Event><ChangeType><![CDATA[add_half_external_contact]]></ChangeType><UserID><![CDATA[member-owner]]></UserID><ExternalUserID><![CDATA[wm-added-contact]]></ExternalUserID><State><![CDATA[${upgrade.state}]]></State></xml>`;
  const halfEncrypted = encryptCallback(halfXml, appConfig.wechatWorkEncodingAesKey, appConfig.wechatWorkCorpId);
  const halfQuery = { timestamp: "1710000001", nonce: "nonce-external-contact-half" };
  halfQuery.msg_signature = sha1Sorted([appConfig.wechatWorkToken, halfQuery.timestamp, halfQuery.nonce, halfEncrypted]);

  assert.equal(await service.handleCallback(halfQuery, `<xml><Encrypt><![CDATA[${halfEncrypted}]]></Encrypt></xml>`), "success");
  const halfStatus = await service.getCustomerUpgradeStatus(payload);
  assert.equal(halfStatus.status, "half_added_pending");
  assert.equal(halfStatus.customerAddedSpecialistConfirmed, false);
  assert.equal(halfStatus.customerPhoneReceiptConfirmed, false);

  const xml = `<xml><ToUserName><![CDATA[corp-test]]></ToUserName><CreateTime>1710000002</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[change_external_contact]]></Event><ChangeType><![CDATA[add_external_contact]]></ChangeType><UserID><![CDATA[member-owner]]></UserID><ExternalUserID><![CDATA[wm-added-contact]]></ExternalUserID><State><![CDATA[${upgrade.state}]]></State></xml>`;
  const encrypted = encryptCallback(xml, appConfig.wechatWorkEncodingAesKey, appConfig.wechatWorkCorpId);
  const query = { timestamp: "1710000002", nonce: "nonce-external-contact-full" };
  query.msg_signature = sha1Sorted([appConfig.wechatWorkToken, query.timestamp, query.nonce, encrypted]);

  assert.equal(await service.handleCallback(query, `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`), "success");
  const status = await service.getCustomerUpgradeStatus(payload);
  assert.equal(status.status, "added_confirmed");
  assert.equal(status.customerPhoneReceiptConfirmed, false);
  assert.equal(status.customerAddedSpecialistConfirmed, true);
  assert.deepEqual(api.externalContactGetCalls, ["wm-added-contact"]);
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "customer_upgrade_half_added_pending"));
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "customer_upgrade_added_confirmed"));
});

test("a forwarded specialist QR cannot complete another customer upgrade", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upgrade-forwarded", externalUserId: "wm-upgrade-forwarded" });
  api.customerProfileResponse = {
    errcode: 0,
    errmsg: "ok",
    customer_list: [{ external_userid: binding.externalUserId, unionid: "union-original-customer" }],
  };
  api.externalContactResponses.set("wm-scanner-other", {
    errcode: 0,
    errmsg: "ok",
    external_contact: { external_userid: "wm-scanner-other", unionid: "union-other-scanner" },
  });
  const payload = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
  };
  await service.upgradeCustomerToMemberService({ ...payload, requestId: "customer-upgrade:forwarded" });
  const upgradeId = deterministicOperationId(
    "wwupgrade",
    `${appConfig.wechatWorkCorpId}:${binding.openKfid}:${binding.externalUserId}:member-owner`,
  );
  const state = localStore.getWechatWorkCustomerUpgrade(upgradeId).state;
  const xml = `<xml><ToUserName><![CDATA[corp-test]]></ToUserName><CreateTime>1710000003</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[change_external_contact]]></Event><ChangeType><![CDATA[add_external_contact]]></ChangeType><UserID><![CDATA[member-owner]]></UserID><ExternalUserID><![CDATA[wm-scanner-other]]></ExternalUserID><State><![CDATA[${state}]]></State></xml>`;
  const encrypted = encryptCallback(xml, appConfig.wechatWorkEncodingAesKey, appConfig.wechatWorkCorpId);
  const query = { timestamp: "1710000003", nonce: "nonce-forwarded-contact" };
  query.msg_signature = sha1Sorted([appConfig.wechatWorkToken, query.timestamp, query.nonce, encrypted]);

  assert.equal(await service.handleCallback(query, `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`), "success");
  const status = await service.getCustomerUpgradeStatus(payload);
  assert.equal(status.status, "identity_unverified");
  assert.equal(status.customerAddedSpecialistConfirmed, false);
  assert.equal(status.customerPhoneReceiptConfirmed, false);
  assert.match(status.errorMessage, /unionid 不一致/);
  assert.ok(localStore.listWechatWorkAuditLogs().some((item) => item.action === "customer_upgrade_identity_unverified"));
});

test("msg_send_fail updates specialist QR delivery status and repeat clicks stay locked", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upgrade-async-fail", externalUserId: "wm-upgrade-async-fail" });
  const payload = {
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
  };
  await service.upgradeCustomerToMemberService({ ...payload, requestId: "customer-upgrade:async-fail-a" });
  const before = await service.getCustomerUpgradeStatus(payload);
  const upgradeId = deterministicOperationId(
    "wwupgrade",
    `${appConfig.wechatWorkCorpId}:${binding.openKfid}:${binding.externalUserId}:member-owner`,
  );
  const upgrade = localStore.getWechatWorkCustomerUpgrade(upgradeId);
  assert.equal(before.status, "api_accepted");
  api.syncResponse = {
    errcode: 0,
    errmsg: "ok",
    has_more: 0,
    msg_list: [{
      msgid: "upgrade-image-failure-event",
      msgtype: "event",
      event: {
        event_type: "msg_send_fail",
        open_kfid: binding.openKfid,
        external_userid: binding.externalUserId,
        fail_msgid: upgrade.imageMsgId,
        fail_type: 4,
      },
    }],
  };

  await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: binding.openKfid });
  const failed = await service.getCustomerUpgradeStatus(payload);
  assert.equal(failed.status, "async_failed");
  assert.equal(failed.imageStatus, "async_failed");
  const operationsAfterFailure = api.operationCalls.length;
  const duplicate = await service.upgradeCustomerToMemberService({ ...payload, requestId: "customer-upgrade:async-fail-b" });
  assert.equal(duplicate.deliveryStatus, "async_failed");
  assert.equal(api.operationCalls.length, operationsAfterFailure);
});

test("long-term customer upgrade reuses the existing application credential and reports missing customer-contact permission", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upgrade", externalUserId: "wm-upgrade" });
  api.externalContactFollowUserResponse = new WechatWorkApiError(
    "externalcontact_get_follow_user_list",
    "api forbidden",
    { errcode: 48002 },
  );

  const config = await service.getUpgradeServiceConfig();
  assert.equal(config.ready, true);
  assert.equal(config.deliveryReady, false);
  assert.equal(config.customerContact.configured, true);
  assert.equal(config.customerContact.credentialSource, "wechat_work_shared");
  assert.equal(config.customerContact.blockerCode, "CUSTOMER_CONTACT_PERMISSION_MISSING");
  assert.deepEqual(config.customerContact.applications, [{ agentId: 1000003, name: "臻希AI" }]);
  assert.match(config.customerContact.detail, /无需寻找第二个 Secret/);

  await assert.rejects(
    () => service.upgradeCustomerToMemberService({
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      memberUserId: "member-owner",
      wording: "添加企业微信后，我继续为您服务。",
      requestId: "customer-upgrade:missing-contact-secret",
    }),
    /客户联系 API 权限/,
  );
  assert.equal(api.customerUpgradeCalls.length, 0);
  assert.equal(api.externalContactWayCalls.length, 0);
});

test("customer-contact credential validation uses a separate secret and checks upgrade-member scope", async () => {
  const { api, service } = setup();

  const result = await service.validateCustomerContactCredential({ secret: "external-contact-secret-test" });

  assert.equal(result.valid, true);
  assert.equal(result.eligibleMemberCount, 1);
  assert.deepEqual(result.eligibleMemberUserIds, ["member-owner"]);
  assert.deepEqual(api.externalContactFollowUserCalls, ["external-contact-secret-test"]);
  assert.equal(appConfig.wechatWorkExternalContactSecret, "");
});

test("customer-service matrix exposes official state, event, cancel, and QR permission boundaries", async () => {
  const { api, localStore, dispatch, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-state", externalUserId: "wm-state" });
  localStore.recordWechatWorkAudit({
    action: "external_contact_way_create_failed",
    status: "failed",
    openKfid: "wk-state",
    apiName: "externalcontact_add_contact_way",
    apiErrcode: 48002,
    createdAt: "2026-08-18T08:00:00.000Z",
  });

  const matrix = await service.getCapabilityMatrix();
  const upgradeCapability = matrix.capabilities.find((item) => item.key === "upgrade_service");
  const cancelCapability = matrix.capabilities.find((item) => item.key === "cancel_upgrade_service");
  const serviceStateCapability = matrix.capabilities.find((item) => item.key === "service_state");
  const richCapability = matrix.capabilities.find((item) => item.key === "send_rich_messages");
  const eventCapability = matrix.capabilities.find((item) => item.key === "send_msg_on_event");
  const qrCapability = matrix.capabilities.find((item) => item.key === "external_contact_qr");
  assert.equal(matrix.configured, true);
  assert.equal(upgradeCapability.customerVisibleDelivery, false);
  assert.match(upgradeCapability.detail, /不会自动向客户发送专员二维码/);
  assert.equal(cancelCapability.status, "available_unverified");
  assert.equal(serviceStateCapability.status, "available_unverified");
  assert.equal(richCapability.status, "available_unverified");
  assert.match(richCapability.detail, /文本、图片、语音、视频、文件、图文链接、小程序、菜单和位置/);
  assert.equal(eventCapability.status, "available_unverified");
  assert.match(eventCapability.detail, /文本和菜单事件响应/);
  assert.equal(qrCapability.status, "permission_blocked");
  assert.equal(qrCapability.errcode, 48002);
  assert.equal(qrCapability.lastVerifiedAt, "2026-08-18T08:00:00.000Z");

  localStore.recordWechatWorkAudit({
    action: "external_contact_credential_validated",
    status: "processed",
    createdAt: "2026-08-18T09:00:00.000Z",
  });
  const repairedMatrix = await service.getCapabilityMatrix();
  const repairedQrCapability = repairedMatrix.capabilities.find((item) => item.key === "external_contact_qr");
  assert.equal(repairedQrCapability.status, "available_unverified");
  assert.equal(repairedQrCapability.errcode, undefined);
  assert.equal(repairedQrCapability.lastVerifiedAt, "2026-08-18T09:00:00.000Z");

  const cancel = await service.cancelCustomerUpgradeService({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    requestId: "customer-upgrade-cancel:test",
  });
  assert.equal(cancel.cancelled, true);
  assert.equal(cancel.customerVisibleDelivery, false);
  assert.deepEqual(api.customerUpgradeCancelCalls, [{
    openKfid: "wk-state",
    externalUserId: "wm-state",
  }]);

  api.serviceStateResponse = {
    errcode: 0,
    errmsg: "ok",
    service_state: 0,
    servicer_userid: "member-owner",
  };
  const state = await service.getCustomerServiceState({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
  });
  assert.equal(state.serviceState, 0);
  assert.equal(state.serviceStateName, "未处理");
  assert.equal(state.msgCodePresent, false);
  assert.equal("msgCode" in state, false);
  assert.equal(api.serviceStateGetCalls[0].openKfid, "wk-state");

  api.serviceStateTransferResponse = {
    errcode: 0,
    errmsg: "ok",
    service_state: 3,
    servicer_userid: "member-owner",
    msg_code: "event-code-for-state-transfer",
  };
  const transferred = await service.transferCustomerServiceState({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    serviceState: 3,
    servicerUserId: "member-owner",
    requestId: "service-state:test-transfer",
  });
  assert.equal(transferred.serviceState, 3);
  assert.equal(transferred.msgCodePresent, true);
  assert.ok(transferred.eventCredentialId);
  assert.equal("msgCode" in transferred, false);
  assert.equal("requiresMsgCodeReply" in transferred, false);
  assert.deepEqual(api.serviceStateTransferCalls[0], {
    openKfid: "wk-state",
    externalUserId: "wm-state",
    serviceState: 3,
    servicerUserId: "member-owner",
  });

  const event = await service.sendCustomerServiceEventText({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    eventCredentialId: transferred.eventCredentialId,
    text: "事件响应测试",
    requestId: "send-msg-on-event:test",
  });
  assert.equal(event.accepted, true);
  assert.equal(event.status, "sent");
  assert.ok(event.sendTaskId);
  assert.ok(event.sendAttemptId);
  assert.equal(event.eventCredentialId, transferred.eventCredentialId);
  assert.equal(api.eventTextCalls[0].code, "event-code-for-state-transfer");
  assert.equal(api.eventTextCalls[0].text, "事件响应测试");
  assert.match(api.eventTextCalls[0].msgid, /^kf_/);
  const credentialAudit = localStore.listWechatWorkAuditLogs(50)
    .find((item) => item.action === "event_reply_credential" && item.id === transferred.eventCredentialId);
  assert.equal(credentialAudit.status, "consumed");
  assert.equal(credentialAudit.ttlMs, WECHAT_WORK_EVENT_CODE_LONG_TTL_MS);
  assert.equal("eventCodeSecret" in credentialAudit, false);
  assert.equal(credentialAudit.eventCredentialSecretStored, false);
  assert.ok(credentialAudit.eventCredentialSecretClearedAt);
  assert.equal(JSON.stringify(credentialAudit).includes("event-code-for-state-transfer"), false);
  const eventAudit = localStore.listWechatWorkAuditLogs(50)
    .find((item) => item.action === "send_msg_on_event_queued");
  assert.ok(eventAudit.eventCodeHash);
  assert.equal(JSON.stringify(eventAudit).includes("event-code-for-state-transfer"), false);
  assert.equal(JSON.stringify(localStore.read()).includes("event-code-for-state-transfer"), false);
  assert.equal(JSON.stringify(localStore.read()).includes("eventCodeSecret"), false);
  const storedEventTask = localStore.getSendTask(event.sendTaskId);
  assert.equal("eventCodeSecret" in storedEventTask.payload, false);
  assert.equal(storedEventTask.payload.eventCredentialSecretStored, false);
  const publicAudit = await service.listAuditLogs(50);
  assert.equal(JSON.stringify(publicAudit).includes("eventCodeSecret"), false);
  const publicTasks = await dispatch.listSendTasks({ conversationId: binding.conversationId });
  assert.equal(JSON.stringify(publicTasks).includes("event-code-for-state-transfer"), false);
  assert.equal(JSON.stringify(publicTasks).includes("eventCodeSecret"), false);
  await assert.rejects(
    () => service.sendCustomerServiceEventText({
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      eventCredentialId: transferred.eventCredentialId,
      text: "第二次事件响应",
      requestId: "send-msg-on-event:test-second",
    }),
    /事件响应凭证已经使用或失效/,
  );
  assert.equal(api.eventTextCalls.length, 1);
  await assert.rejects(
    () => dispatch.requeueSendTask(event.sendTaskId, {
      expectedWechatAccountId: binding.wechatAccountId,
      expectedConversationId: binding.conversationId,
      expectedCustomerId: binding.customerId,
    }),
    /事件响应凭证.*不能重新排队/,
  );
  const sendAudit = localStore.listWechatWorkAuditLogs(50)
    .find((item) => item.action === "send_api_accepted" && item.sendTaskId === event.sendTaskId);
  assert.ok(sendAudit);
});

test("official rich customer-service messages queue, validate, audit, and dispatch through kf/send_msg", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-rich", externalUserId: "wm-rich" });
  const queued = await service.queueCustomerServiceMessage({
    openKfid: "wk-rich",
    externalUserId: "wm-rich",
    requestId: "rich-message:test",
    messages: [
      {
        msgtype: "link",
        link: {
          title: "报价单",
          desc: "查看本次设计报价",
          url: "https://kefu.example.com/quotes/q-001",
        },
      },
      {
        msgtype: "msgmenu",
        msgmenu: {
          head_content: "请选择下一步",
          list: [
            { type: "click", click: { id: "confirm_quote", content: "确认报价" } },
            { type: "view", view: { url: "https://kefu.example.com/orders/o-001", content: "查看订单" } },
          ],
        },
      },
      {
        msgtype: "location",
        location: {
          latitude: 31.2304,
          longitude: 121.4737,
          name: "门店",
          address: "上海市黄浦区",
        },
      },
      {
        msgtype: "voice",
        voice: { media_id: "voice-media-id" },
      },
      {
        msgtype: "video",
        video: { media_id: "video-media-id" },
      },
    ],
  });

  assert.equal(queued.task.payload.kind, "wechat_work_messages");
  assert.deepEqual(queued.task.payload.messages.map((item) => item.msgtype), ["link", "msgmenu", "location", "voice", "video"]);
  const delivery = await service.dispatchCustomerServiceText(queued.task.id);
  assert.equal(delivery.task.status, "sent");
  assert.deepEqual(api.messageCalls.map((item) => item.msgtype), ["link", "msgmenu", "location", "voice", "video"]);
  assert.deepEqual(api.messageCalls[0].message, {
    title: "报价单",
    desc: "查看本次设计报价",
    url: "https://kefu.example.com/quotes/q-001",
  });
  assert.equal(api.messageCalls[1].message.list[0].click.id, "confirm_quote");
  assert.equal(api.messageCalls[2].message.latitude, 31.2304);
  assert.equal(api.messageCalls[3].message.media_id, "voice-media-id");
  assert.equal(api.messageCalls[4].message.media_id, "video-media-id");
  assert.ok(api.messageCalls.every((item) => item.openKfid === binding.openKfid && item.externalUserId === binding.externalUserId));
  const audit = localStore.listWechatWorkAuditLogs(50)
    .find((item) => item.action === "send_rich_messages_queued" && item.sendTaskId === queued.task.id);
  assert.equal(audit.messageCount, 5);
  assert.deepEqual(audit.messageTypes, ["link", "msgmenu", "location", "voice", "video"]);
});

test("direct official dispatch defers a later task until it reaches the account queue head", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-serial", externalUserId: "wm-serial" });
  const first = await service.queueCustomerServiceText({
    requestId: "wechat-work:serial-first",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "第一条",
  });
  const second = await service.queueCustomerServiceText({
    requestId: "wechat-work:serial-second",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "第二条",
  });

  const deferred = await service.dispatchCustomerServiceText(second.task.id);
  assert.equal(deferred.deferred, true);
  assert.equal(deferred.reason, "not_account_queue_head");
  assert.equal(deferred.queueHeadId, first.task.id);
  assert.equal(api.sendCalls.length, 0);
  assert.equal(localStore.getSendTask(second.task.id).status, "queued");

  await service.dispatchCustomerServiceText(first.task.id);
  await service.dispatchCustomerServiceText(second.task.id);
  assert.deepEqual(api.sendCalls.map((item) => item.text), ["第一条", "第二条"]);
});

test("event msgmenu replies use a single-use welcome credential and clear sealed event code", async () => {
  const { api, localStore, service, dispatch } = setup();
  const message = {
    msgid: "enter-session-event",
    open_kfid: "wk-event-menu",
    external_userid: "wm-event-menu",
    msgtype: "event",
    event: {
      event_type: "enter_session",
      welcome_code: "welcome-code-for-menu",
    },
  };
  api.syncResponse = { errcode: 0, errmsg: "ok", has_more: 0, msg_list: [message] };
  const processed = await service.syncCustomerServiceMessages({ openKfid: "wk-event-menu", limit: 1 });
  assert.equal(processed.processedCount, 1);
  const binding = localStore.getWechatWorkBinding("wk-event-menu", "wm-event-menu");
  const credentialAudit = localStore.listWechatWorkAuditLogs(50)
    .find((item) => item.action === "event_reply_credential" && item.openKfid === "wk-event-menu");
  assert.ok(credentialAudit);
  assert.equal(credentialAudit.ttlMs, WECHAT_WORK_EVENT_CODE_SHORT_TTL_MS);

  const event = await service.sendCustomerServiceEventMenu({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    eventCredentialId: credentialAudit.id,
    msgmenu: {
      head_content: "欢迎咨询",
      list: [{ type: "click", click: { id: "need_quote", content: "我要报价" } }],
    },
    requestId: "send-msg-on-event-menu:test",
  });
  assert.equal(event.accepted, true);
  assert.equal(event.status, "sent");
  assert.equal(api.eventMessageCalls.length, 1);
  assert.equal(api.eventMessageCalls[0].code, "welcome-code-for-menu");
  assert.equal(api.eventMessageCalls[0].msgtype, "msgmenu");
  assert.equal(api.eventMessageCalls[0].message.list[0].click.id, "need_quote");
  const consumed = localStore.getWechatWorkAuditLog(credentialAudit.id);
  assert.equal(consumed.status, "consumed");
  assert.equal("eventCodeSecret" in consumed, false);
  assert.equal(JSON.stringify(localStore.read()).includes("welcome-code-for-menu"), false);
  const storedEventTask = localStore.getSendTask(event.sendTaskId);
  assert.equal(storedEventTask.payload.kind, "wechat_work_event_msgmenu");
  assert.equal("eventCodeSecret" in storedEventTask.payload, false);
  await assert.rejects(
    () => dispatch.requeueSendTask(event.sendTaskId, {
      expectedWechatAccountId: binding.wechatAccountId,
      expectedConversationId: binding.conversationId,
      expectedCustomerId: binding.customerId,
    }),
    /事件响应凭证.*不能重新排队/,
  );
});

test("event msgmenu replies allow ended service-state msg_code before the short expiry", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-event-menu-ended", externalUserId: "wm-event-menu-ended" });
  api.serviceStateTransferResponse = {
    errcode: 0,
    errmsg: "ok",
    service_state: 4,
    msg_code: "ended-state-menu-code",
  };
  const ended = await service.transferCustomerServiceState({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    serviceState: 4,
    requestId: "service-state:menu-ended",
  });
  assert.equal(ended.serviceState, 4);
  assert.ok(ended.eventCredentialId);
  const credentialAudit = localStore.getWechatWorkAuditLog(ended.eventCredentialId);
  assert.equal(credentialAudit.serviceState, 4);
  assert.equal(credentialAudit.ttlMs, WECHAT_WORK_EVENT_CODE_SHORT_TTL_MS);

  const event = await service.sendCustomerServiceEventMenu({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    eventCredentialId: ended.eventCredentialId,
    msgmenu: {
      head_content: "本次服务已结束",
      list: [{ type: "click", click: { id: "restart_service", content: "重新咨询" } }],
    },
    requestId: "send-msg-on-event-menu:ended",
  });
  assert.equal(event.accepted, true);
  assert.equal(event.status, "sent");
  assert.equal(api.eventMessageCalls.length, 1);
  assert.equal(api.eventMessageCalls[0].code, "ended-state-menu-code");
  assert.equal(api.eventMessageCalls[0].msgtype, "msgmenu");
  assert.equal(localStore.getWechatWorkAuditLog(ended.eventCredentialId).status, "consumed");
});

test("event msgmenu replies reject service-state msg_code before consuming the credential", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-event-menu-blocked", externalUserId: "wm-event-menu-blocked" });
  api.serviceStateTransferResponse = {
    errcode: 0,
    errmsg: "ok",
    service_state: 3,
    servicer_userid: "member-owner",
    msg_code: "state-code-menu-blocked",
  };
  const transferred = await service.transferCustomerServiceState({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    serviceState: 3,
    servicerUserId: "member-owner",
    requestId: "service-state:menu-blocked",
  });
  await assert.rejects(
    () => service.sendCustomerServiceEventMenu({
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      eventCredentialId: transferred.eventCredentialId,
      msgmenu: {
        list: [{ type: "click", click: { id: "invalid_menu", content: "菜单" } }],
      },
      requestId: "send-msg-on-event-menu:blocked",
    }),
    /事件菜单只支持用户进入会话欢迎语或结束会话场景/,
  );
  assert.equal(api.eventMessageCalls.length, 0);
  const credentialAudit = localStore.getWechatWorkAuditLog(transferred.eventCredentialId);
  assert.equal(credentialAudit.status, "pending");
  assert.ok(credentialAudit.eventCodeSecret);
});

test("event reply credential atomic claim prevents concurrent double sends", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-event-race", externalUserId: "wm-event-race" });
  api.serviceStateTransferResponse = {
    errcode: 0,
    errmsg: "ok",
    service_state: 3,
    servicer_userid: "member-owner",
    msg_code: "race-event-code",
  };
  const transferred = await service.transferCustomerServiceState({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    serviceState: 3,
    servicerUserId: "member-owner",
    requestId: "service-state:race",
  });

  const results = await Promise.allSettled([
    service.sendCustomerServiceEventText({
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      eventCredentialId: transferred.eventCredentialId,
      text: "并发事件响应 A",
      requestId: "send-msg-on-event:race-a",
    }),
    service.sendCustomerServiceEventText({
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      eventCredentialId: transferred.eventCredentialId,
      text: "并发事件响应 B",
      requestId: "send-msg-on-event:race-b",
    }),
  ]);

  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.match(String(results.find((item) => item.status === "rejected").reason?.message || ""), /事件响应凭证已经使用或失效/);
  assert.equal(api.eventTextCalls.length, 1);
  const credentialAudit = localStore.getWechatWorkAuditLog(transferred.eventCredentialId);
  assert.equal(credentialAudit.status, "consumed");
  assert.equal("eventCodeSecret" in credentialAudit, false);
  const eventTasks = localStore.listSendTasks({ conversationId: binding.conversationId })
    .filter((task) => task.payload?.kind === "wechat_work_event_text");
  assert.equal(eventTasks.length, 1);
  assert.equal(JSON.stringify(localStore.read()).includes("eventCodeSecret"), false);
});

test("event reply credential checks the original WeChat Work identity before sending", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-event-bound", externalUserId: "wm-event-bound" });
  api.serviceStateTransferResponse = {
    errcode: 0,
    errmsg: "ok",
    service_state: 3,
    servicer_userid: "member-owner",
    msg_code: "bound-event-code",
  };
  const transferred = await service.transferCustomerServiceState({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    serviceState: 3,
    servicerUserId: "member-owner",
    requestId: "service-state:bound",
  });
  const originalCredential = localStore.getWechatWorkAuditLog(transferred.eventCredentialId);
  localStore.upsertWechatWorkAudit({
    ...originalCredential,
    openKfid: "wk-stale-event-bound",
  });

  await assert.rejects(
    () => service.sendCustomerServiceEventText({
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      eventCredentialId: transferred.eventCredentialId,
      text: "身份错配事件响应",
      requestId: "send-msg-on-event:bound",
    }),
    /事件响应凭证与当前客户身份不一致/,
  );
  assert.equal(api.eventTextCalls.length, 0);
  const credentialAudit = localStore.getWechatWorkAuditLog(transferred.eventCredentialId);
  assert.equal(credentialAudit.status, "pending");
  assert.equal(credentialAudit.openKfid, "wk-stale-event-bound");
  const publicAudit = await service.listAuditLogs(50);
  assert.equal(JSON.stringify(publicAudit).includes("eventCodeSecret"), false);
});

test("event reply text validation does not consume the one-time credential", async () => {
  const { localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-event-validate", externalUserId: "wm-event-validate" });
  const credentialId = "event-credential-validate";
  localStore.upsertWechatWorkAudit({
    id: credentialId,
    action: "event_reply_credential",
    status: "pending",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    eventCodeHash: wechatWorkEventCodeHash("validate-event-code"),
    eventCodeSecret: sealWechatWorkEventCode("validate-event-code"),
    expiresAt: new Date(Date.now() + WECHAT_WORK_EVENT_CODE_LONG_TTL_MS).toISOString(),
    ttlMs: WECHAT_WORK_EVENT_CODE_LONG_TTL_MS,
  });

  await assert.rejects(
    () => service.sendCustomerServiceEventText({
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      eventCredentialId: credentialId,
      text: "",
      requestId: "send-msg-on-event:validate-empty",
    }),
    /text is required/,
  );

  const credentialAudit = localStore.getWechatWorkAuditLog(credentialId);
  assert.equal(credentialAudit.status, "pending");
  assert.ok(credentialAudit.eventCodeSecret);
});

test("generic queued send execution clears event credential secrets", async () => {
  const { api, localStore, dispatch } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-event-generic", externalUserId: "wm-event-generic" });
  const eventCode = "generic-execute-event-code";
  const task = localStore.createSendTask({
    operationKey: "send-msg-on-event:generic-execute",
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    payload: {
      kind: "wechat_work_event_text",
      text: "通用入口事件响应",
      eventCredentialId: "event-credential-generic",
      eventCodeHash: wechatWorkEventCodeHash(eventCode),
      eventCodeSecret: sealWechatWorkEventCode(eventCode),
      eventCredentialExpiresAt: new Date(Date.now() + WECHAT_WORK_EVENT_CODE_LONG_TTL_MS).toISOString(),
    },
    guardSnapshot: {
      source: "wechat_work_kf_event",
      eventCredentialSingleUse: true,
    },
  });

  const result = await dispatch.executeQueuedSend(task.id, {
    adapter: "wechat_work_kf",
    expectedWechatAccountId: binding.wechatAccountId,
    expectedConversationId: binding.conversationId,
    expectedCustomerId: binding.customerId,
  });

  assert.equal(result.task.status, "sent");
  assert.equal(api.eventTextCalls[0].code, eventCode);
  const storedTask = localStore.getSendTask(task.id);
  assert.equal("eventCodeSecret" in storedTask.payload, false);
  assert.equal(storedTask.payload.eventCredentialSecretStored, false);
  assert.equal(JSON.stringify(localStore.read()).includes("eventCodeSecret"), false);
});

test("expired event reply credential is marked expired and clears its secret", async () => {
  const { api, localStore, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-event-expired", externalUserId: "wm-event-expired" });
  const credentialId = "event-credential-expired";
  localStore.upsertWechatWorkAudit({
    id: credentialId,
    action: "event_reply_credential",
    status: "pending",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    eventCodeHash: wechatWorkEventCodeHash("expired-event-code"),
    eventCodeSecret: sealWechatWorkEventCode("expired-event-code"),
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    ttlMs: WECHAT_WORK_EVENT_CODE_SHORT_TTL_MS,
  });

  await assert.rejects(
    () => service.sendCustomerServiceEventText({
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      eventCredentialId: credentialId,
      text: "过期事件响应",
      requestId: "send-msg-on-event:expired",
    }),
    /事件响应凭证已过期/,
  );

  assert.equal(api.eventTextCalls.length, 0);
  const credentialAudit = localStore.getWechatWorkAuditLog(credentialId);
  assert.equal(credentialAudit.status, "expired");
  assert.equal("eventCodeSecret" in credentialAudit, false);
  assert.equal(credentialAudit.eventCredentialSecretStored, false);
});

test("upgrade configuration keeps official userid when member name cannot be resolved", async () => {
  const { api, service } = setup();
  api.userProfileResponses.set(
    "member-owner",
    new WechatWorkApiError("user_get", "wechat work user_get failed: forbidden", { errcode: 48002 }),
  );

  const config = await service.getUpgradeServiceConfig();

  assert.equal(config.ready, true);
  assert.deepEqual(config.memberUserIds, ["member-owner"]);
  assert.deepEqual(config.memberOptions, [{
    userId: "member-owner",
    displayName: "member-owner",
    resolution: "userid_fallback",
    errorCode: 48002,
  }]);
  assert.match(config.detail, /显示 UserID/);
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

test("long-term customer upgrade respects an in-flight semantic lock", async () => {
  const { api, localStore, service } = setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-upgrade", externalUserId: "wm-upgrade" });
  const auditId = deterministicOperationId("wwaudit", `customer-upgrade:${binding.externalUserId}:member-owner`);
  localStore.upsertWechatWorkAudit({
    id: auditId,
    action: "customer_upgrade_recommended",
    status: "pending",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    operationKey: "customer-upgrade:already-in-flight",
  });

  const result = await service.upgradeCustomerToMemberService({
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    memberUserId: "member-owner",
    wording: "添加企业微信后，我继续为您服务。",
    requestId: "customer-upgrade:second-click",
  });

  assert.equal(result.recommended, true);
  assert.equal(result.alreadyRecommended, true);
  assert.equal(result.recommendationPending, true);
  assert.equal(result.recommendationAuditId, auditId);
  assert.equal(api.customerUpgradeCalls.length, 0);
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

test("sync_msg event creates a bound one-time reply credential without storing raw event code", async () => {
  const { api, localStore, service } = setup();
  api.syncResponse = {
    errcode: 0,
    errmsg: "ok",
    has_more: 0,
    next_cursor: "cursor-event-code",
    msg_list: [{
      msgid: "event-welcome-code-1",
      open_kfid: "wk-event-code",
      external_userid: "wm-event-code",
      msgtype: "event",
      event: {
        event_type: "enter_session",
        open_kfid: "wk-event-code",
        external_userid: "wm-event-code",
        welcome_code: "welcome-code-secret-123",
      },
    }],
  };

  const result = await service.syncCustomerServiceMessages({ token: "sync-token", openKfid: "wk-event-code" });
  assert.equal(result.processedCount, 1);
  const binding = localStore.getWechatWorkBinding("wk-event-code", "wm-event-code");
  assert.ok(binding);
  const eventAudit = localStore.listWechatWorkAuditLogs(50)
    .find((item) => item.action === "event_processed" && item.msgid === "event-welcome-code-1");
  assert.ok(eventAudit.eventCredentialId);
  assert.equal(eventAudit.wechatAccountId, binding.wechatAccountId);
  assert.equal(eventAudit.conversationId, binding.conversationId);
  assert.equal(eventAudit.customerId, binding.customerId);
  assert.equal(JSON.stringify(eventAudit).includes("welcome-code-secret-123"), false);
  const credentialAudit = localStore.listWechatWorkAuditLogs(50)
    .find((item) => item.action === "event_reply_credential" && item.id === eventAudit.eventCredentialId);
  assert.equal(credentialAudit.status, "pending");
  assert.equal(credentialAudit.ttlMs, WECHAT_WORK_EVENT_CODE_SHORT_TTL_MS);
  assert.equal(credentialAudit.openKfid, "wk-event-code");
  assert.equal(credentialAudit.externalUserId, "wm-event-code");
  assert.equal(JSON.stringify(credentialAudit).includes("welcome-code-secret-123"), false);
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

test("manual conversation reply completes through kf/send_msg without requiring manual takeover", async () => {
  const { api, localStore, dispatch } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-manual-send", externalUserId: "wm-manual-send" });
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

test("manual conversation reply remains sendable after manual takeover", async () => {
  const { api, localStore, dispatch } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-manual-locked-send", externalUserId: "wm-manual-locked-send" });
  const queued = await dispatch.enqueueManualReply({
    operationKey: "wechat-work:manual-reply-survives-lock",
    wechatAccountId: binding.wechatAccountId,
    conversationId: binding.conversationId,
    customerId: binding.customerId,
    text: "人工接管后继续直接回复客户",
    operator: "operator-test",
  });

  const lock = await dispatch.setConversationManualLock(binding.conversationId, {
    ...expectedIdentity(binding),
    locked: true,
    reviewer: "operator-test",
    reason: "manual_takeover_test",
    note: "测试人工接管后，人工回复仍可直接发送。",
  });

  assert.equal(lock.conversation.manualLocked, true);
  assert.equal(localStore.getSendTask(queued.task.id).status, "queued");

  const result = await dispatch.executeManualReplyNow(queued.task.id, expectedIdentity(binding));

  assert.equal(result.task.status, "sent");
  assert.equal(result.attempt.status, "sent");
  assert.equal(api.sendCalls.length, 1);
  assert.equal(api.sendCalls[0].text, "人工接管后继续直接回复客户");
});

test("Prisma manual takeover blocking skips queued manual replies", async (t) => {
  t.after(() => {
    appConfig.useLocalStore = true;
  });
  appConfig.useLocalStore = false;
  const manualTask = {
    id: "task-prisma-manual-reply",
    status: "queued",
    conversationId: "conversation-prisma-manual",
    payload: { kind: "text", text: "manual", source: "manual_reply", manualReply: true },
    guardSnapshot: { manualReply: true },
  };
  const automaticTask = {
    id: "task-prisma-auto-reply",
    status: "queued",
    conversationId: "conversation-prisma-manual",
    payload: { kind: "text", text: "auto" },
    guardSnapshot: {},
  };
  const updatedIds = [];
  const prisma = {
    wechatSendTask: {
      async findMany(query) {
        assert.deepEqual(query.where, { conversationId: "conversation-prisma-manual", status: "queued" });
        return [manualTask, automaticTask];
      },
      async update({ where, data }) {
        updatedIds.push(where.id);
        return { id: where.id, ...data };
      },
    },
  };
  const dispatch = new WechatDispatchService(prisma, {}, {}, {}, {});

  const blocked = await dispatch.blockQueuedSendTasksForManualLock({ id: "conversation-prisma-manual" }, "operator-test");

  assert.deepEqual(updatedIds, ["task-prisma-auto-reply"]);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].id, "task-prisma-auto-reply");
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

test("local restart recovery settles known official API failure and releases account queue", async () => {
  const { api, localStore, dispatch, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-restart-failed", externalUserId: "wm-restart-failed" });
  const failedHead = await service.queueCustomerServiceText({
    requestId: "wechat-work:restart-known-failed-head",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "known failed official attempt",
  });
  const queued = await service.queueCustomerServiceText({
    requestId: "wechat-work:restart-known-failed-next",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "next reply can now send",
  });
  localStore.updateSendTask(failedHead.task.id, { status: "sending" });
  const attempt = localStore.createSendAttempt({
    sendTaskId: failedHead.task.id,
    adapter: "wechat_work_kf",
    status: "started",
    errorMessage: "wechat work send_msg failed: send msg count limit, e=95001",
    metadata: {
      deliveryState: "in_flight",
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
    },
  });
  localStore.updateSendAttempt(attempt.id, {
    startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  });

  const scan = await dispatch.scanSendOperations({ conversationId: binding.conversationId });
  const recoveredTask = localStore.getSendTask(failedHead.task.id);
  const recoveredAttempt = localStore.getLatestSendAttempt(failedHead.task.id, { adapter: "wechat_work_kf" });
  assert.equal(scan.wechatWorkFailedRecovered, 1);
  assert.equal(recoveredTask.status, "failed");
  assert.equal(recoveredTask.guardSnapshot.deliveryState, "failed");
  assert.equal(recoveredTask.guardSnapshot.automaticRetryBlocked, true);
  assert.equal(recoveredAttempt.status, "failed");
  assert.equal(recoveredAttempt.metadata.deliveryState, "failed");
  assert.ok(localStore.listWechatWorkAuditLogs().some((entry) =>
    entry.sendTaskId === failedHead.task.id && entry.action === "send_api_failed_recovered"));

  const queue = await dispatch.processSafeSendQueue({
    adapter: "wechat_work_kf",
    conversationId: binding.conversationId,
  });
  assert.equal(queue.processed[0].task.id, queued.task.id);
  assert.deepEqual(api.sendCalls.map((item) => item.text), ["next reply can now send"]);
});

test("local restart recovery keeps accepted official messages manual-review even with later API limit failure", async () => {
  const { api, localStore, dispatch, service } = setup();
  const binding = localStore.upsertWechatWorkBinding({ openKfid: "wk-restart-accepted", externalUserId: "wm-restart-accepted" });
  const partialHead = await service.queueCustomerServiceText({
    requestId: "wechat-work:restart-accepted-head",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "partial official attempt",
  });
  const queued = await service.queueCustomerServiceText({
    requestId: "wechat-work:restart-accepted-next",
    openKfid: binding.openKfid,
    externalUserId: binding.externalUserId,
    text: "must wait for manual delivery check",
  });
  localStore.updateSendTask(partialHead.task.id, { status: "sending" });
  const attempt = localStore.createSendAttempt({
    sendTaskId: partialHead.task.id,
    adapter: "wechat_work_kf",
    status: "started",
    errorMessage: "wechat work send_msg failed: send msg count limit, e=95001",
    metadata: {
      deliveryState: "in_flight",
      wechatAccountId: binding.wechatAccountId,
      conversationId: binding.conversationId,
      customerId: binding.customerId,
      acceptedMessageIds: ["kf_partial_1"],
    },
  });
  localStore.updateSendAttempt(attempt.id, {
    startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  });

  const scan = await dispatch.scanSendOperations({ conversationId: binding.conversationId });
  const protectedTask = localStore.getSendTask(partialHead.task.id);
  const protectedAttempt = localStore.getLatestSendAttempt(partialHead.task.id, { adapter: "wechat_work_kf" });
  assert.equal(scan.wechatWorkFailedRecovered, 0);
  assert.equal(scan.wechatWorkDeliveryUnknown, 1);
  assert.equal(protectedTask.status, "sending");
  assert.equal(protectedTask.guardSnapshot.deliveryState, "unknown");
  assert.equal(protectedTask.guardSnapshot.automaticRetryBlocked, true);
  assert.equal(protectedTask.guardSnapshot.manualReviewRequired, true);
  assert.equal(protectedAttempt.status, "started");
  assert.equal(protectedAttempt.metadata.deliveryState, "unknown");
  assert.deepEqual(protectedAttempt.metadata.acceptedMessageIds, ["kf_partial_1"]);

  const queue = await dispatch.processSafeSendQueue({
    adapter: "wechat_work_kf",
    conversationId: binding.conversationId,
  });
  assert.deepEqual(queue.processed, []);
  assert.equal(localStore.getSendTask(queued.task.id).status, "queued");
  assert.deepEqual(api.sendCalls, []);
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
    if (request.url.includes("/cgi-bin/user/get?")) {
      return Response.json({ errcode: 0, errmsg: "ok", userid: "member-owner", name: "售后小司" });
    }
    return Response.json({ errcode: 0, errmsg: "ok" });
  };

  const client = new WechatWorkApiClient();
  const contact = await client.createCustomerContactWay({ openKfid: "wk-entry", scene: "smart_kefu_customer_entry" });
  const config = await client.getUpgradeServiceConfig();
  const member = await client.getUserProfile("member-owner");
  await client.upgradeCustomerToMember({
    openKfid: "wk-entry",
    externalUserId: "wm-customer",
    memberUserId: "member-owner",
    wording: "添加企业微信后继续为您服务。",
  });

  assert.equal(contact.url, "https://work.weixin.qq.com/kf/customer-link");
  assert.deepEqual(config.member_range.userid_list, ["member-owner"]);
  assert.equal(member.name, "售后小司");
  assert.match(requests[1].url, /\/cgi-bin\/kf\/add_contact_way\?access_token=access-token/);
  assert.equal(requests[1].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    open_kfid: "wk-entry",
    scene: "smart_kefu_customer_entry",
  });
  assert.match(requests[2].url, /\/cgi-bin\/kf\/customer\/get_upgrade_service_config\?access_token=access-token/);
  assert.equal(requests[2].init.method, "GET");
  assert.match(requests[3].url, /\/cgi-bin\/user\/get\?access_token=access-token&userid=member-owner/);
  assert.equal(requests[3].init.method, "GET");
  assert.match(requests[4].url, /\/cgi-bin\/kf\/customer\/upgrade_service\?access_token=access-token/);
  assert.deepEqual(JSON.parse(requests[4].init.body), {
    open_kfid: "wk-entry",
    external_userid: "wm-customer",
    type: 1,
    member: {
      userid: "member-owner",
      wording: "添加企业微信后继续为您服务。",
    },
  });
});

test("official API client uses the customer-contact secret for member QR creation and trusted download", async (t) => {
  setup();
  appConfig.wechatWorkExternalContactSecret = "external-contact-secret-test";
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const requests = [];
  global.fetch = async (url, init = {}) => {
    const request = { url: String(url), init };
    requests.push(request);
    if (request.url.includes("/cgi-bin/gettoken?")) {
      return Response.json({ errcode: 0, access_token: "external-contact-token", expires_in: 7200 });
    }
    if (request.url.includes("/cgi-bin/externalcontact/get_follow_user_list?")) {
      return Response.json({ errcode: 0, errmsg: "ok", follow_user: ["member-owner"] });
    }
    if (request.url.includes("/cgi-bin/externalcontact/add_contact_way?")) {
      return Response.json({
        errcode: 0,
        errmsg: "ok",
        config_id: "contact-way-member-owner",
        qr_code: "https://p.qpic.cn/external-contact-qr/member-owner",
      });
    }
    if (request.url.includes("/cgi-bin/externalcontact/get_contact_way?")) {
      return Response.json({
        errcode: 0,
        errmsg: "ok",
        contact_way: {
          config_id: "contact-way-member-owner",
          qr_code: "https://p.qpic.cn/external-contact-qr/member-owner",
        },
      });
    }
    if (request.url.includes("/cgi-bin/externalcontact/get?")) {
      return Response.json({
        errcode: 0,
        errmsg: "ok",
        external_contact: {
          external_userid: "wm-added-contact",
          unionid: "union-added-contact",
        },
      });
    }
    if (request.url.includes("/cgi-bin/externalcontact/update_contact_way?")) {
      return Response.json({ errcode: 0, errmsg: "ok" });
    }
    if (request.url.includes("/cgi-bin/externalcontact/del_contact_way?")) {
      return Response.json({ errcode: 0, errmsg: "ok" });
    }
    if (request.url === "https://p.qpic.cn/external-contact-qr/member-owner") {
      return new Response(VALID_PNG, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(VALID_PNG.length) },
      });
    }
    throw new Error(`unexpected request: ${request.url}`);
  };

  const client = new WechatWorkApiClient();
  const followUsers = await client.listExternalContactFollowUsers();
  const contactWay = await client.createExternalContactWay({
    memberUserId: "member-owner",
    remark: "智能客服长期服务",
    state: "lt_member_owner",
  });
  const downloaded = await client.downloadExternalContactQrCode(contactWay.qr_code);
  const loaded = await client.getExternalContactWay(contactWay.config_id);
  const externalContact = await client.getExternalContact("wm-added-contact");
  await client.updateExternalContactWay({
    configId: contactWay.config_id,
    memberUserId: "member-owner",
    remark: "智能客服长期服务",
    state: "lt_member_owner",
  });
  await client.deleteExternalContactWay(contactWay.config_id);

  assert.deepEqual(followUsers.follow_user, ["member-owner"]);
  assert.equal(contactWay.config_id, "contact-way-member-owner");
  assert.deepEqual(downloaded.bytes, VALID_PNG);
  assert.equal(loaded.contact_way.config_id, "contact-way-member-owner");
  assert.equal(externalContact.external_contact.unionid, "union-added-contact");
  assert.match(requests[1].url, /\/cgi-bin\/externalcontact\/get_follow_user_list\?access_token=external-contact-token/);
  assert.match(requests[2].url, /\/cgi-bin\/externalcontact\/add_contact_way\?access_token=external-contact-token/);
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    type: 1,
    scene: 2,
    remark: "智能客服长期服务",
    skip_verify: true,
    state: "lt_member_owner",
    user: ["member-owner"],
  });
  assert.match(requests[4].url, /\/cgi-bin\/externalcontact\/get_contact_way\?access_token=external-contact-token/);
  assert.deepEqual(JSON.parse(requests[4].init.body), { config_id: "contact-way-member-owner" });
  assert.match(requests[5].url, /\/cgi-bin\/externalcontact\/get\?access_token=external-contact-token&external_userid=wm-added-contact/);
  assert.match(requests[6].url, /\/cgi-bin\/externalcontact\/update_contact_way\?access_token=external-contact-token/);
  assert.deepEqual(JSON.parse(requests[6].init.body), {
    config_id: "contact-way-member-owner",
    type: 1,
    scene: 2,
    remark: "智能客服长期服务",
    skip_verify: true,
    state: "lt_member_owner",
    user: ["member-owner"],
  });
  assert.match(requests[7].url, /\/cgi-bin\/externalcontact\/del_contact_way\?access_token=external-contact-token/);
  assert.deepEqual(JSON.parse(requests[7].init.body), { config_id: "contact-way-member-owner" });
});

test("official API client wraps customer-service cancel, state, transfer, and event-send endpoints", async (t) => {
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
      return Response.json({ errcode: 0, access_token: "access-token", expires_in: 7200 });
    }
    if (request.url.includes("/cgi-bin/kf/service_state/get?")) {
      return Response.json({ errcode: 0, errmsg: "ok", service_state: 1, servicer_userid: "member-owner" });
    }
    if (request.url.includes("/cgi-bin/kf/service_state/trans?")) {
      return Response.json({ errcode: 0, errmsg: "ok", service_state: 3, servicer_userid: "member-owner", msg_code: "event-code" });
    }
    if (request.url.includes("/cgi-bin/kf/send_msg_on_event?")) {
      return Response.json({ errcode: 0, errmsg: "ok", msgid: "api-event-msgid" });
    }
    if (request.url.includes("/cgi-bin/kf/send_msg?")) {
      return Response.json({ errcode: 0, errmsg: "ok", msgid: "api-location-msgid" });
    }
    return Response.json({ errcode: 0, errmsg: "ok" });
  };

  const client = new WechatWorkApiClient();
  await client.cancelCustomerUpgrade({ openKfid: "wk-entry", externalUserId: "wm-customer" });
  const state = await client.getServiceState({ openKfid: "wk-entry", externalUserId: "wm-customer" });
  const transfer = await client.transferServiceState({
    openKfid: "wk-entry",
    externalUserId: "wm-customer",
    serviceState: 3,
    servicerUserId: "member-owner",
  });
  const event = await client.sendTextOnEvent({
    code: "event-code",
    text: "事件响应测试",
    msgid: "event-msgid",
  });
  const eventMenu = await client.sendMessageOnEvent({
    code: "event-menu-code",
    msgid: "event-menu-msgid",
    msgtype: "msgmenu",
    message: {
      head_content: "欢迎咨询",
      list: [{ type: "click", click: { id: "quote", content: "我要报价" } }],
    },
  });
  const location = await client.sendMessage({
    externalUserId: "wm-customer",
    openKfid: "wk-entry",
    msgid: "location-msgid",
    msgtype: "location",
    message: {
      latitude: 31.2304,
      longitude: 121.4737,
      name: "门店",
      address: "上海市黄浦区",
    },
  });

  assert.equal(state.service_state, 1);
  assert.equal(transfer.msg_code, "event-code");
  assert.equal(event.msgid, "api-event-msgid");
  assert.equal(eventMenu.msgid, "api-event-msgid");
  assert.equal(location.msgid, "api-location-msgid");
  assert.match(requests[1].url, /\/cgi-bin\/kf\/customer\/cancel_upgrade_service\?access_token=access-token/);
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    open_kfid: "wk-entry",
    external_userid: "wm-customer",
  });
  assert.match(requests[2].url, /\/cgi-bin\/kf\/service_state\/get\?access_token=access-token/);
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    open_kfid: "wk-entry",
    external_userid: "wm-customer",
  });
  assert.match(requests[3].url, /\/cgi-bin\/kf\/service_state\/trans\?access_token=access-token/);
  assert.deepEqual(JSON.parse(requests[3].init.body), {
    open_kfid: "wk-entry",
    external_userid: "wm-customer",
    service_state: 3,
    servicer_userid: "member-owner",
  });
  assert.match(requests[4].url, /\/cgi-bin\/kf\/send_msg_on_event\?access_token=access-token/);
  assert.deepEqual(JSON.parse(requests[4].init.body), {
    code: "event-code",
    msgid: "event-msgid",
    msgtype: "text",
    text: { content: "事件响应测试" },
  });
  assert.match(requests[5].url, /\/cgi-bin\/kf\/send_msg_on_event\?access_token=access-token/);
  assert.deepEqual(JSON.parse(requests[5].init.body), {
    code: "event-menu-code",
    msgid: "event-menu-msgid",
    msgtype: "msgmenu",
    msgmenu: {
      head_content: "欢迎咨询",
      list: [{ type: "click", click: { id: "quote", content: "我要报价" } }],
    },
  });
  assert.match(requests[6].url, /\/cgi-bin\/kf\/send_msg\?access_token=access-token/);
  assert.deepEqual(JSON.parse(requests[6].init.body), {
    touser: "wm-customer",
    open_kfid: "wk-entry",
    msgid: "location-msgid",
    msgtype: "location",
    location: {
      latitude: 31.2304,
      longitude: 121.4737,
      name: "门店",
      address: "上海市黄浦区",
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

test("official API client uses the documented account, servicer, and member-directory contracts", async (t) => {
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
      return Response.json({ errcode: 0, access_token: "access-token", expires_in: 7200 });
    }
    if (request.url.includes("/cgi-bin/kf/servicer/list?")) {
      return Response.json({ errcode: 0, errmsg: "ok", servicer_list: [{ userid: "member-owner", status: 0 }] });
    }
    if (request.url.includes("/cgi-bin/kf/get_corp_statistic?")) {
      return Response.json({ errcode: 0, errmsg: "ok", statistic_list: [] });
    }
    if (request.url.includes("/cgi-bin/kf/get_servicer_statistic?")) {
      return Response.json({ errcode: 0, errmsg: "ok", statistic_list: [] });
    }
    if (request.url.includes("/cgi-bin/user/list_id?")) {
      return Response.json({ errcode: 0, errmsg: "ok", next_cursor: "", dept_user: [{ userid: "member-owner", department: 1 }] });
    }
    if (request.url.includes("/cgi-bin/kf/account/add?")) {
      return Response.json({ errcode: 0, errmsg: "ok", open_kfid: "wk-created" });
    }
    return Response.json({
      errcode: 0,
      errmsg: "ok",
      result_list: [{ userid: "member-owner", errcode: 0, errmsg: "ok" }],
    });
  };

  const client = new WechatWorkApiClient();
  await client.listCustomerServiceServicers("wk-operations");
  await client.listVisibleUserIds();
  await client.addCustomerServiceAccount({ name: "销售顾问", mediaId: "media-avatar" });
  await client.updateCustomerServiceAccount({ openKfid: "wk-operations", name: "资深销售顾问" });
  await client.deleteCustomerServiceAccount("wk-deprecated");
  await client.addCustomerServiceServicers({ openKfid: "wk-operations", userIds: ["member-owner"] });
  await client.deleteCustomerServiceServicers({ openKfid: "wk-operations", userIds: ["member-owner"] });
  await client.getCustomerServiceCorpStatistic({ openKfid: "wk-operations", startTime: 1_645_545_600, endTime: 1_645_632_000 });
  await client.getCustomerServiceServicerStatistic({
    openKfid: "wk-operations",
    servicerUserId: "member-owner",
    startTime: 1_645_545_600,
    endTime: 1_645_632_000,
  });

  assert.match(requests[1].url, /\/cgi-bin\/kf\/servicer\/list\?.*open_kfid=wk-operations/);
  assert.deepEqual(JSON.parse(requests[2].init.body), { cursor: "", limit: 10000 });
  assert.deepEqual(JSON.parse(requests[3].init.body), { name: "销售顾问", media_id: "media-avatar" });
  assert.deepEqual(JSON.parse(requests[4].init.body), { open_kfid: "wk-operations", name: "资深销售顾问" });
  assert.deepEqual(JSON.parse(requests[5].init.body), { open_kfid: "wk-deprecated" });
  assert.deepEqual(JSON.parse(requests[6].init.body), { open_kfid: "wk-operations", userid_list: ["member-owner"] });
  assert.deepEqual(JSON.parse(requests[7].init.body), { open_kfid: "wk-operations", userid_list: ["member-owner"] });
  assert.match(requests[8].url, /\/cgi-bin\/kf\/get_corp_statistic\?/);
  assert.deepEqual(JSON.parse(requests[8].init.body), {
    open_kfid: "wk-operations",
    start_time: 1_645_545_600,
    end_time: 1_645_632_000,
  });
  assert.match(requests[9].url, /\/cgi-bin\/kf\/get_servicer_statistic\?/);
  assert.deepEqual(JSON.parse(requests[9].init.body), {
    open_kfid: "wk-operations",
    servicer_userid: "member-owner",
    start_time: 1_645_545_600,
    end_time: 1_645_632_000,
  });
});

function shanghaiDateDaysAgo(daysAgo) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

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

test("official API client reuses the existing application secret for customer-contact permission checks", async (t) => {
  setup();
  appConfig.wechatWorkSecret = "shared-application-secret-test";
  appConfig.wechatWorkExternalContactSecret = "";
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  const requests = [];
  global.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes("/cgi-bin/gettoken?")) {
      return Response.json({ errcode: 0, access_token: "shared-application-token", expires_in: 7200 });
    }
    return Response.json({ errcode: 0, errmsg: "ok", follow_user: ["member-owner"] });
  };

  const client = new WechatWorkApiClient();
  const result = await client.listExternalContactFollowUsers();

  assert.deepEqual(result.follow_user, ["member-owner"]);
  assert.equal(new URL(requests[0]).searchParams.get("corpsecret"), "shared-application-secret-test");
  assert.match(requests[1], /\/cgi-bin\/externalcontact\/get_follow_user_list\?access_token=shared-application-token/);
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
