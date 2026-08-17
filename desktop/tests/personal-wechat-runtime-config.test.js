"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ensurePersonalWechatRuntimeRegistry } = require("../tools/personal-wechat-runtime-config");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("stable runtime migrates a legacy RPA identity to the one matching platform account and repairs duplicate bindings", (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-wechat-runtime-"));
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  writeJson(path.join(runtimeDir, "personal-wechat-rpa.json"), {
    accountNickname: "设计3号ai出图",
    ownerWxId: "wxid_owner",
    token: "private-rpa-token",
    port: 3211,
  });
  writeJson(path.join(runtimeDir, "local-store.json"), {
    wechatAccounts: [{
      id: "account_real",
      platform: "personal_wechat_rpa",
      displayName: "设计3号ai出图",
      alias: "wxid_owner",
      personalWechatRpa: { accountNickname: "设计3号ai出图", ownerWxId: "wxid_owner" },
    }],
    personalWechatRpaBindings: [{
      wechatAccountId: "account_real",
      conversationId: "conversation_real",
      customerId: "customer_real",
      chatTitle: "客户群",
    }],
  });
  const runtimeIdentity = {
    sessionId: "wxid_owner:123:456",
    processId: 123,
    windowHandle: "456",
    windowsSessionId: 1,
    processName: "Weixin",
    executablePath: "D:\\weixin\\Weixin.exe",
    accountText: "设计3号ai出图",
    accountNickname: "设计3号ai出图",
    ownerWxId: "wxid_owner",
  };
  writeJson(path.join(runtimeDir, "personal-wechat-accounts.json"), {
    version: "personal_wechat_accounts_v1",
    accounts: [
      {
        ...runtimeIdentity,
        wechatAccountId: "account_stale",
        conversations: [{ conversationId: "conversation_stale", customerId: "customer_stale", chatTitle: "旧客户群" }],
      },
      {
        ...runtimeIdentity,
        wechatAccountId: "account_real",
        conversations: [],
      },
    ],
  });

  const result = ensurePersonalWechatRuntimeRegistry(runtimeDir);

  assert.deepEqual(result, {
    migrated: true,
    configRepaired: false,
    accountsRepaired: true,
    wechatAccountId: "account_real",
    reason: "runtime_identity_aligned",
  });
  assert.doesNotMatch(JSON.stringify(result), /private-rpa-token/);
  const config = JSON.parse(fs.readFileSync(path.join(runtimeDir, "personal-wechat-rpa.json"), "utf8"));
  assert.equal(config.registryVersion, "personal_wechat_rpa_registry_v1");
  assert.equal(config.instances.length, 1);
  assert.equal(config.instances[0].wechatAccountId, "account_real");
  assert.equal(config.instances[0].token, "private-rpa-token");
  const accounts = JSON.parse(fs.readFileSync(path.join(runtimeDir, "personal-wechat-accounts.json"), "utf8"));
  assert.equal(accounts.accounts.length, 1);
  assert.equal(accounts.accounts[0].wechatAccountId, "account_real");
  assert.deepEqual(accounts.accounts[0].conversations, [{
    conversationId: "conversation_real",
    customerId: "customer_real",
    chatTitle: "客户群",
  }]);
});

test("legacy RPA migration fails closed when the platform identity is ambiguous", (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-wechat-runtime-"));
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const legacy = {
    accountNickname: "同名账号",
    ownerWxId: "wxid_owner",
    token: "private-rpa-token",
    port: 3211,
  };
  writeJson(path.join(runtimeDir, "personal-wechat-rpa.json"), legacy);
  writeJson(path.join(runtimeDir, "local-store.json"), {
    wechatAccounts: ["account_a", "account_b"].map((id) => ({
      id,
      platform: "personal_wechat_rpa",
      personalWechatRpa: { accountNickname: "同名账号", ownerWxId: "wxid_owner" },
    })),
    personalWechatRpaBindings: [],
  });

  const result = ensurePersonalWechatRuntimeRegistry(runtimeDir);

  assert.equal(result.migrated, false);
  assert.equal(result.reason, "store_identity_ambiguous");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runtimeDir, "personal-wechat-rpa.json"), "utf8")), legacy);
});

test("stable runtime repairs a mojibake RPA nickname from the exact bound platform account", (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "personal-wechat-runtime-"));
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  writeJson(path.join(runtimeDir, "personal-wechat-rpa.json"), {
    registryVersion: "personal_wechat_rpa_registry_v1",
    accountNickname: "璁捐3鍙穉i鍑哄浘",
    ownerWxId: "wxid_owner",
    token: "private-rpa-token",
    instances: [{
      wechatAccountId: "account_real",
      endpoint: "http://127.0.0.1:3211",
      token: "private-rpa-token",
      accountNickname: "璁捐3鍙穉i鍑哄浘",
      ownerWxId: "wxid_owner",
      enabled: true,
    }],
  });
  writeJson(path.join(runtimeDir, "local-store.json"), {
    wechatAccounts: [{
      id: "account_real",
      platform: "personal_wechat_rpa",
      displayName: "设计3号ai出图",
      alias: "wxid_owner",
      personalWechatRpa: { accountNickname: "设计3号ai出图", ownerWxId: "wxid_owner" },
    }],
    personalWechatRpaBindings: [],
  });
  writeJson(path.join(runtimeDir, "personal-wechat-accounts.json"), {
    version: "personal_wechat_accounts_v1",
    accounts: [{
      wechatAccountId: "account_real",
      accountText: "设计3号ai出图",
      accountNickname: "设计3号ai出图",
      ownerWxId: "wxid_owner",
      conversations: [],
    }],
  });

  const result = ensurePersonalWechatRuntimeRegistry(runtimeDir);

  assert.equal(result.migrated, false);
  assert.equal(result.configRepaired, true);
  assert.equal(result.accountsRepaired, false);
  const config = JSON.parse(fs.readFileSync(path.join(runtimeDir, "personal-wechat-rpa.json"), "utf8"));
  assert.equal(config.accountNickname, "设计3号ai出图");
  assert.equal(config.instances[0].accountNickname, "设计3号ai出图");
  assert.equal(config.instances[0].token, "private-rpa-token");
});
