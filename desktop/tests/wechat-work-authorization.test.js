"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const { appConfig } = require("../apps/api/src/shared/app-config");
const { WechatWorkApiClient } = require("../apps/api/src/wechat-work/wechat-work-api.client");
const { WechatWorkAuthorizationController } = require("../apps/api/src/wechat-work/wechat-work-authorization.controller");
const { WechatWorkAuthorizationService } = require("../apps/api/src/wechat-work/wechat-work-authorization.service");
const { WechatWorkSuiteApiClient } = require("../apps/api/src/wechat-work/wechat-work-suite-api.client");

test("official WeCom install flow is signed, single-use, and stores credentials encrypted", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-work-auth-"));
  const storeFile = path.join(tempDir, "authorization.json");
  const suiteId = "ww_suite_test";
  const suiteToken = "suite-callback-token";
  const suiteTicket = "suite-ticket-sensitive";
  const permanentCode = "permanent-code-sensitive";
  const encodingKey = crypto.randomBytes(32).toString("base64").replace(/=$/, "");
  const previous = applyConfig({
    customerServicePublicBaseUrl: "https://kefu.example.com",
    wechatWorkSuiteId: suiteId,
    wechatWorkSuiteSecret: "test-suite-secret-placeholder",
    wechatWorkSuiteToken: suiteToken,
    wechatWorkSuiteEncodingAesKey: encodingKey,
    wechatWorkSuiteStorageKey: crypto.randomBytes(32).toString("base64"),
    wechatWorkSuiteAuthorizationStoreFile: storeFile,
    wechatWorkSuiteInstallBaseUrl: "https://open.work.weixin.qq.com/3rdapp/install",
  });
  const calls = [];
  const suiteApi = {
    clearSuiteToken: () => calls.push("clearSuiteToken"),
    getPreAuthCode: async (ticket) => {
      calls.push(["getPreAuthCode", ticket]);
      return { preAuthCode: "pre-auth-code", expiresIn: 1200 };
    },
    getPermanentCode: async (ticket, authCode) => {
      calls.push(["getPermanentCode", ticket, authCode]);
      return {
        permanent_code: permanentCode,
        auth_corp_info: { corpid: "ww-corp-1", corp_name: "测试企业", corp_type: "verified" },
      };
    },
    getCorpAccessToken: async (ticket, corpId, code) => {
      calls.push(["getCorpAccessToken", ticket, corpId, code]);
      return { accessToken: "mock-corp-access-token-placeholder", expiresIn: 7200 };
    },
  };

  try {
    const service = new WechatWorkAuthorizationService(suiteApi);
    const ticketXml = `<xml><SuiteId><![CDATA[${suiteId}]]></SuiteId><InfoType><![CDATA[suite_ticket]]></InfoType><SuiteTicket><![CDATA[${suiteTicket}]]></SuiteTicket></xml>`;
    const ticketCallback = encryptedCallback(ticketXml, suiteId, encodingKey, suiteToken);
    assert.equal(await service.handleSuiteCallback(ticketCallback.query, ticketCallback.body), "success");

    const created = await service.createInstallLink();
    const installUrl = new URL(created.installUrl);
    assert.equal(installUrl.origin, "https://open.work.weixin.qq.com");
    assert.equal(installUrl.pathname, "/3rdapp/install");
    assert.equal(installUrl.searchParams.get("suite_id"), suiteId);
    assert.equal(installUrl.searchParams.get("pre_auth_code"), "pre-auth-code");
    assert.equal(
      installUrl.searchParams.get("redirect_uri"),
      "https://kefu.example.com/api/wechat-work/authorization/callback",
    );
    const state = installUrl.searchParams.get("state");
    assert.ok(state && state.length >= 40);

    const authorized = await service.handleAuthorizationRedirect({ auth_code: "temporary-auth-code", state });
    assert.deepEqual(authorized, { corpId: "ww-corp-1", corpName: "测试企业", status: "active" });
    await assert.rejects(
      service.handleAuthorizationRedirect({ auth_code: "temporary-auth-code", state }),
      /already consumed/,
    );
    const createAuthXml = `<xml><SuiteId><![CDATA[${suiteId}]]></SuiteId><InfoType><![CDATA[create_auth]]></InfoType><AuthCode><![CDATA[temporary-auth-code]]></AuthCode></xml>`;
    const duplicateCallback = encryptedCallback(createAuthXml, suiteId, encodingKey, suiteToken);
    assert.equal(await service.handleSuiteCallback(duplicateCallback.query, duplicateCallback.body), "success");

    const status = service.getStatus();
    assert.equal(status.readyForInstall, true);
    assert.equal(status.activeAuthorizationCount, 1);
    assert.equal(status.credentialMode, "suite_authorization");
    assert.equal(status.latestFlow.status, "completed");
    assert.equal(JSON.stringify(status).includes(permanentCode), false);
    assert.equal(await service.getPrimaryAuthorizedCorpAccessToken(), "mock-corp-access-token-placeholder");

    const stored = fs.readFileSync(storeFile, "utf8");
    assert.equal(stored.includes(suiteTicket), false);
    assert.equal(stored.includes(permanentCode), false);
    assert.match(stored, /"ciphertext"/);
    assert.deepEqual(calls, [
      "clearSuiteToken",
      ["getPreAuthCode", suiteTicket],
      ["getPermanentCode", suiteTicket, "temporary-auth-code"],
      ["getCorpAccessToken", suiteTicket, "ww-corp-1", permanentCode],
    ]);
  } finally {
    restoreConfig(previous);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("suite callback rejects a forged signature before writing credentials", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-work-auth-forged-"));
  const storeFile = path.join(tempDir, "authorization.json");
  const encodingKey = crypto.randomBytes(32).toString("base64").replace(/=$/, "");
  const previous = applyConfig({
    wechatWorkSuiteId: "ww_suite_test",
    wechatWorkSuiteToken: "suite-token",
    wechatWorkSuiteEncodingAesKey: encodingKey,
    wechatWorkSuiteStorageKey: crypto.randomBytes(32).toString("base64"),
    wechatWorkSuiteAuthorizationStoreFile: storeFile,
  });
  try {
    const service = new WechatWorkAuthorizationService({ clearSuiteToken() {} });
    const callback = encryptedCallback(
      "<xml><InfoType><![CDATA[suite_ticket]]></InfoType><SuiteTicket><![CDATA[secret]]></SuiteTicket></xml>",
      "ww_suite_test",
      encodingKey,
      "suite-token",
    );
    callback.query.msg_signature = "0".repeat(40);
    await assert.rejects(service.handleSuiteCallback(callback.query, callback.body), /invalid suite callback signature/);
    assert.equal(fs.existsSync(storeFile), false);
  } finally {
    restoreConfig(previous);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("suite API client calls the documented token, pre-auth, permanent-code and corp-token endpoints", async () => {
  const previous = applyConfig({
    wechatWorkSuiteId: "ww-suite",
    wechatWorkSuiteSecret: "test-suite-secret-placeholder",
    wechatWorkSuiteApiBaseUrl: "https://qyapi.weixin.qq.com",
  });
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null };
    calls.push(request);
    if (request.url.endsWith("/cgi-bin/service/get_suite_token")) {
      return jsonResponse({ errcode: 0, suite_access_token: "mock-suite-access-token-placeholder", expires_in: 7200 });
    }
    if (request.url.includes("/cgi-bin/service/get_pre_auth_code?")) {
      return jsonResponse({ errcode: 0, pre_auth_code: "pre-auth-code", expires_in: 1200 });
    }
    if (request.url.includes("/cgi-bin/service/get_permanent_code?")) {
      return jsonResponse({
        errcode: 0,
        permanent_code: "permanent-code",
        auth_corp_info: { corpid: "ww-corp", corp_name: "授权企业" },
      });
    }
    if (request.url.includes("/cgi-bin/service/get_corp_token?")) {
      return jsonResponse({ errcode: 0, access_token: "mock-corp-access-token-placeholder", expires_in: 7200 });
    }
    throw new Error(`unexpected request ${request.url}`);
  };
  try {
    const client = new WechatWorkSuiteApiClient();
    await client.getPreAuthCode("suite-ticket");
    await client.getPermanentCode("suite-ticket", "auth-code");
    await client.getCorpAccessToken("suite-ticket", "ww-corp", "permanent-code");
    assert.deepEqual(calls, [
      {
        url: "https://qyapi.weixin.qq.com/cgi-bin/service/get_suite_token",
        method: "POST",
        body: { suite_id: "ww-suite", suite_secret: "test-suite-secret-placeholder", suite_ticket: "suite-ticket" },
      },
      {
        url: "https://qyapi.weixin.qq.com/cgi-bin/service/get_pre_auth_code?suite_access_token=mock-suite-access-token-placeholder",
        method: "GET",
        body: null,
      },
      {
        url: "https://qyapi.weixin.qq.com/cgi-bin/service/get_permanent_code?suite_access_token=mock-suite-access-token-placeholder",
        method: "POST",
        body: { auth_code: "auth-code" },
      },
      {
        url: "https://qyapi.weixin.qq.com/cgi-bin/service/get_corp_token?suite_access_token=mock-suite-access-token-placeholder",
        method: "POST",
        body: { auth_corpid: "ww-corp", permanent_code: "permanent-code" },
      },
    ]);
  } finally {
    global.fetch = originalFetch;
    restoreConfig(previous);
  }
});

test("existing WeChat customer-service API prefers an active suite authorization token", async () => {
  const previous = applyConfig({
    wechatWorkApiBaseUrl: "https://qyapi.weixin.qq.com",
    wechatWorkCorpId: "static-corp",
    wechatWorkSecret: "static-secret",
  });
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return jsonResponse({ errcode: 0, errmsg: "ok", msgid: "accepted-message" });
  };
  try {
    const authorization = {
      hasActiveAuthorization: () => true,
      getPrimaryAuthorizedCorpAccessToken: async () => "suite-corp-access-token",
      clearCorpAccessToken() {},
    };
    const client = new WechatWorkApiClient(authorization);
    const result = await client.sendText({
      externalUserId: "wm-customer",
      openKfid: "wk-kf",
      text: "您好",
      msgid: "local-message",
    });
    assert.equal(result.msgid, "accepted-message");
    assert.equal(urls.length, 1);
    assert.match(urls[0], /\/cgi-bin\/kf\/send_msg\?access_token=suite-corp-access-token$/);
    assert.equal(urls[0].includes("/cgi-bin/gettoken"), false);
  } finally {
    global.fetch = originalFetch;
    restoreConfig(previous);
  }
});

test("authorization completion page escapes the enterprise name", async () => {
  const controller = new WechatWorkAuthorizationController({
    handleAuthorizationRedirect: async () => ({
      corpId: "ww-corp",
      corpName: '<img src=x onerror="alert(1)">',
      status: "active",
    }),
  });
  const html = await controller.handleAuthorizationRedirect({ auth_code: "code", state: "state" });
  assert.equal(html.includes("<img src=x"), false);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

function encryptedCallback(message, receiveId, encodingKey, token) {
  const key = Buffer.from(`${encodingKey}=`, "base64");
  const messageBytes = Buffer.from(message);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(messageBytes.length);
  const plaintext = Buffer.concat([crypto.randomBytes(16), length, messageBytes, Buffer.from(receiveId)]);
  const padding = 32 - (plaintext.length % 32);
  const padded = Buffer.concat([plaintext, Buffer.alloc(padding, padding)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
  const timestamp = "1720000000";
  const nonce = "test-nonce";
  const signature = crypto.createHash("sha1").update([token, timestamp, nonce, encrypted].sort().join("")).digest("hex");
  return {
    query: { msg_signature: signature, timestamp, nonce },
    body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
  };
}

function applyConfig(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = appConfig[key];
    appConfig[key] = value;
  }
  return previous;
}

function restoreConfig(values) {
  for (const [key, value] of Object.entries(values)) appConfig[key] = value;
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
