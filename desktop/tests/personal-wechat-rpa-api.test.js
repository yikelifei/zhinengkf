"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { LocalStoreService } = require("../apps/api/src/local-store/local-store.service");
const { PersonalWechatRpaService } = require("../apps/api/src/personal-wechat-rpa/personal-wechat-rpa.service");
const { executeBoundWechatActions } = require("../tools/personal-wechat-bridge");

function setup(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-wechat-rpa-api-"));
  const configFile = path.join(tempDir, "personal-wechat-rpa.json");
  process.env.PERSONAL_WECHAT_RPA_CONFIG_FILE = configFile;
  delete process.env.PERSONAL_WECHAT_RPA_ENDPOINT;
  if (options.legacy === false) {
    delete process.env.PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME;
    delete process.env.PERSONAL_WECHAT_RPA_TOKEN;
  } else {
    process.env.PERSONAL_WECHAT_RPA_ACCOUNT_NICKNAME = "设计3号ai出图";
    process.env.PERSONAL_WECHAT_RPA_TOKEN = "test-rpa-token";
    fs.writeFileSync(configFile, JSON.stringify({ ownerWxId: "wxid_design_3" }), "utf8");
  }
  const localStore = new LocalStoreService();
  localStore.filePath = path.join(tempDir, "local-store.json");
  const dispatch = {
    calls: [],
    async processInboundMessage(payload) {
      const existing = localStore.findMessageByExternalId(payload.conversationId, payload.externalId);
      if (existing) {
        return {
          duplicate: true,
          message: {
            ...existing,
            customerId: payload.customerId,
            wechatAccountId: payload.wechatAccountId,
          },
          sendTask: null,
        };
      }
      this.calls.push(payload);
      return {
        message: localStore.createMessage({ ...payload, direction: "inbound" }),
        sendTask: { id: `task-${this.calls.length}` },
      };
    },
  };
  const service = new PersonalWechatRpaService(localStore, dispatch);
  return { tempDir, configFile, localStore, dispatch, service };
}

function inbound(overrides = {}) {
  return {
    version: "personal_wechat_rpa_event_v1",
    accountNickname: "设计3号ai出图",
    ownerWxId: "wxid_design_3",
    chatTitle: "测试客户A",
    conversationType: "direct",
    senderName: "测试客户A",
    message: "我想做一套礼盒",
    messageType: "text",
    externalId: "rpa-message-1",
    createdAt: "2026-07-15T10:00:00.000Z",
    attachments: [],
    ...overrides,
  };
}

test("RPA inbound creates an exact account/chat binding and deduplicates externalId", async () => {
  const { localStore, dispatch, service } = setup();
  const first = await service.processInbound(inbound(), "test-rpa-token");
  const duplicate = await service.processInbound(inbound(), "test-rpa-token");

  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.binding.wechatAccount.displayName, "设计3号ai出图");
  assert.equal(first.binding.conversation.title, "测试客户A");
  assert.equal(first.binding.conversation.channel, "personal_wechat");
  assert.equal(duplicate.duplicate, true);
  assert.equal(dispatch.calls.length, 1);
  assert.equal(localStore.listPersonalWechatRpaBindings().length, 1);
  assert.equal(localStore.findMessageByExternalId(first.binding.conversationId, "rpa-message-1").text, "我想做一套礼盒");
});

test("RPA reservation stores only allowlisted attachment business fields", async () => {
  const { localStore, service } = setup();
  await service.processInbound(inbound({
    externalId: "rpa-safe-operation-snapshot",
    attachments: [{
      role: "image",
      mimeType: "image/png",
      token: "rpa-attachment-secret",
      endpoint: "http://127.0.0.1:4888",
      localPath: "C:\\private\\rpa.png",
    }],
  }), "test-rpa-token");
  const operation = JSON.parse(fs.readFileSync(localStore.filePath, "utf8"))
    .inboundMessageOperations.find((item) => item.externalId === "rpa-safe-operation-snapshot");
  const snapshot = JSON.stringify(operation.normalizedPayload);
  assert.match(snapshot, /image\/png/);
  assert.doesNotMatch(snapshot, /rpa-attachment-secret|127\.0\.0\.1|private\\\\rpa/i);
  assert.doesNotMatch(snapshot, /"(?:token|endpoint|localPath)"/i);
});

test("RPA inbound rejects any account other than the dedicated nickname", async () => {
  const { service } = setup();
  await assert.rejects(
    service.processInbound(inbound({ accountNickname: "其他微信号" }), "test-rpa-token"),
    /invalid or ambiguous personal WeChat RPA token/,
  );
});

test("RPA inbound ignores self messages before creating a customer binding", async () => {
  const { localStore, dispatch, service } = setup();
  const result = await service.processInbound(inbound({ senderName: "我", externalId: "self-1" }), "test-rpa-token");
  assert.equal(result.ignored, true);
  assert.equal(dispatch.calls.length, 0);
  assert.equal(localStore.listPersonalWechatRpaBindings().length, 0);
});

test("RPA status and inbound require the shared local token", async () => {
  const { service } = setup();
  await assert.rejects(service.getStatus("wrong-token"), /invalid or ambiguous personal WeChat RPA token/);
  await assert.rejects(service.processInbound(inbound(), "wrong-token"), /invalid or ambiguous personal WeChat RPA token/);
});

test("RPA instance validation requires identity, token and an explicit loopback port", () => {
  const { service } = setup({ legacy: false });
  const missing = service.validateInstance({ wechatAccountId: "account_1", endpoint: "http://127.0.0.1:3211" });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(" "), /accountNickname is required/);
  assert.match(missing.errors.join(" "), /ownerWxId is required/);
  assert.match(missing.errors.join(" "), /token is required/);

  const external = service.validateInstance(instanceInput({ endpoint: "http://example.com:3211" }));
  assert.equal(external.ok, false);
  assert.match(external.errors.join(" "), /loopback-only/);

  const missingPort = service.validateInstance(instanceInput({ endpoint: "http://localhost" }));
  assert.equal(missingPort.ok, false);
  assert.match(missingPort.errors.join(" "), /explicit port/);

  const valid = service.validateInstance(instanceInput());
  assert.equal(valid.ok, true);
  assert.equal(valid.instance.port, 3211);
  assert.equal(valid.instance.tokenConfigured, true);
  assert.equal(Object.hasOwn(valid.instance, "token"), false);
  assert.doesNotMatch(JSON.stringify(valid), /instance-secret-1/);
});

test("RPA registry atomically creates and updates unique account instances without leaking tokens", () => {
  const { tempDir, configFile, service } = setup({ legacy: false });
  fs.writeFileSync(configFile, JSON.stringify({
    accountNickname: "旧单账号",
    ownerWxId: "wxid_legacy_owner",
    token: "legacy-root-secret",
    port: 4555,
    unrelatedSetting: "preserve-me",
  }), "utf8");

  const legacy = service.getRegistry();
  assert.equal(legacy.mode, "legacy_single");
  assert.equal(legacy.ready, true);
  assert.equal(legacy.legacy.port, 4555);
  assert.doesNotMatch(JSON.stringify(legacy), /legacy-root-secret/);

  const first = service.upsertInstance(instanceInput());
  const second = service.upsertInstance(instanceInput({
    wechatAccountId: "account_2",
    endpoint: "http://localhost:3212",
    accountNickname: "客服二号",
    ownerWxId: "wxid_owner_2",
    token: "instance-secret-2",
  }));
  const updated = service.upsertInstance({
    wechatAccountId: "account_1",
    endpoint: "http://[::1]:3311",
    accountNickname: "客服一号新版",
  });

  assert.equal(first.operation, "created");
  assert.equal(second.registry.activeCount, 2);
  assert.equal(updated.operation, "updated");
  assert.equal(updated.instance.port, 3311);
  assert.equal(updated.registry.ready, true);
  assert.doesNotMatch(JSON.stringify({ first, second, updated }), /instance-secret-1|instance-secret-2|legacy-root-secret/);

  const saved = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.equal(saved.unrelatedSetting, "preserve-me");
  assert.equal(saved.token, "legacy-root-secret");
  assert.equal(saved.instances.length, 2);
  assert.equal(saved.instances.find((item) => item.wechatAccountId === "account_1").token, "instance-secret-1");
  assert.equal(saved.instances.find((item) => item.wechatAccountId === "account_1").endpoint, "http://[::1]:3311");
  assert.equal(new Set(saved.instances.map((item) => item.wechatAccountId)).size, 2);
  assert.deepEqual(fs.readdirSync(tempDir).filter((name) => name.endsWith(".tmp")), []);
});

test("RPA registry readiness rejects duplicate wechatAccountId without exposing either token", () => {
  const { configFile, service } = setup({ legacy: false });
  fs.writeFileSync(configFile, JSON.stringify({
    instances: [
      instanceInput({ token: "duplicate-secret-one" }),
      instanceInput({ endpoint: "http://127.0.0.1:3212", token: "duplicate-secret-two" }),
    ],
  }), "utf8");
  const before = fs.readFileSync(configFile, "utf8");
  const readiness = service.getRegistry();
  assert.equal(readiness.ready, false);
  assert.match(readiness.errors.join(" "), /must be unique/);
  assert.doesNotMatch(JSON.stringify(readiness), /duplicate-secret-one|duplicate-secret-two/);
  assert.throws(() => service.upsertInstance(instanceInput()), /must be repaired before update/);
  assert.equal(fs.readFileSync(configFile, "utf8"), before);
});

test("malformed RPA config reports a redacted error and is never overwritten", () => {
  const { configFile, service } = setup({ legacy: false });
  const malformed = '{"token":"malformed-secret",';
  fs.writeFileSync(configFile, malformed, "utf8");
  const readiness = service.getRegistry();
  assert.equal(readiness.ready, false);
  assert.match(readiness.errors.join(" "), /not valid JSON/);
  assert.doesNotMatch(JSON.stringify(readiness), /malformed-secret/);
  assert.throws(() => service.upsertInstance(instanceInput()), /not valid JSON/);
  assert.equal(fs.readFileSync(configFile, "utf8"), malformed);
});

test("disabling an RPA instance writes a fail-closed tombstone and supports credential-preserving re-enable", async () => {
  const { configFile, service } = setup({ legacy: false });
  service.upsertInstance(instanceInput());

  const disabled = service.disableInstance("account_1");
  assert.equal(disabled.operation, "disabled");
  assert.equal(disabled.instance.enabled, false);
  assert.equal(disabled.registry.activeCount, 0);
  assert.equal(disabled.registry.disabledCount, 1);
  assert.equal(disabled.registry.ready, false);
  assert.doesNotMatch(JSON.stringify(disabled), /instance-secret-1/);

  const savedDisabled = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.deepEqual(savedDisabled.instances[0], {
    wechatAccountId: "account_1",
    endpoint: "",
    token: "",
    accountNickname: "客服一号",
    ownerWxId: "wxid_owner_1",
    enabled: false,
    tombstone: true,
    updatedAt: savedDisabled.instances[0].updatedAt,
  });
  assert.equal(savedDisabled.disabledInstances[0].token, "instance-secret-1");
  const bridgeResult = await executeBoundWechatActions(
    { binding: { wechatAccountId: "account_1", accountNickname: "客服一号" }, actions: [{ type: "text", text: "must not send" }] },
    { driver: "wechatauto_rpa", rpaInstances: savedDisabled.instances },
  );
  assert.equal(bridgeResult.ok, false);
  assert.equal(bridgeResult.code, "rpa_instance_invalid");

  const unchanged = service.disableInstance("account_1");
  assert.equal(unchanged.operation, "unchanged");
  const enabled = service.upsertInstance({ wechatAccountId: "account_1", enabled: true });
  assert.equal(enabled.instance.enabled, true);
  assert.equal(enabled.registry.activeCount, 1);
  assert.equal(enabled.registry.disabledCount, 0);
  const savedEnabled = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.equal(savedEnabled.instances[0].token, "instance-secret-1");
  assert.equal(savedEnabled.instances[0].tombstone, undefined);
  assert.deepEqual(savedEnabled.disabledInstances, []);
});

test("RPA inbound authentication binds each registry token to its account nickname", async () => {
  const { service } = setup({ legacy: false });
  service.upsertInstance(instanceInput({ accountNickname: "设计3号ai出图", ownerWxId: "wxid_design_3" }));
  service.upsertInstance(instanceInput({
    wechatAccountId: "account_2",
    endpoint: "http://127.0.0.1:3212",
    accountNickname: "设计4号ai出图",
    ownerWxId: "wxid_design_4",
    token: "instance-secret-2",
  }));

  const result = await service.processInbound(inbound(), "instance-secret-1");
  assert.equal(result.ok, true);
  await assert.rejects(
    service.processInbound(inbound({ externalId: "wrong-account-token" }), "instance-secret-2"),
    /invalid or ambiguous personal WeChat RPA token/,
  );
  const status = await service.getStatus("instance-secret-2");
  assert.equal(status.expectedAccountNickname, "设计4号ai出图");
  assert.doesNotMatch(JSON.stringify(status), /instance-secret-1|instance-secret-2/);
});

function instanceInput(overrides = {}) {
  return {
    wechatAccountId: "account_1",
    endpoint: "http://127.0.0.1:3211",
    accountNickname: "客服一号",
    ownerWxId: "wxid_owner_1",
    token: "instance-secret-1",
    enabled: true,
    ...overrides,
  };
}
