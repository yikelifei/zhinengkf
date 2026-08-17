"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { installIsolatedAppConfigEnv } = require("./isolated-app-config-env");

const isolatedConfig = installIsolatedAppConfigEnv("smart-kefu-wechat-work-readiness-");
test.after(() => isolatedConfig.cleanup());

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { appConfig } = require("../apps/api/src/shared/app-config");
const { buildWechatWorkProductionReadiness } = require("../apps/api/src/wechat-work/wechat-work-readiness");

const configuredKeys = [
  "useLocalStore", "wechatWorkCorpId", "wechatWorkSecret", "wechatWorkToken", "wechatWorkEncodingAesKey",
  "customerServicePublicBaseUrl", "wechatWorkApiBaseUrl", "wechatSendAdapter", "wechatWorkOpenKfid",
];

function configure(useLocalStore) {
  appConfig.useLocalStore = useLocalStore;
  appConfig.wechatWorkCorpId = "corp-configured";
  appConfig.wechatWorkSecret = "secret-configured";
  appConfig.wechatWorkToken = "token-configured";
  appConfig.wechatWorkEncodingAesKey = crypto.randomBytes(32).toString("base64").replace(/=$/, "");
  appConfig.wechatWorkOpenKfid = "wk-configured";
  appConfig.customerServicePublicBaseUrl = "https://kefu.example.com";
  appConfig.wechatWorkApiBaseUrl = "https://qyapi.weixin.qq.com";
  appConfig.wechatSendAdapter = "wechat_work_kf";
}

function persistenceCheck(report) {
  return report.local.checks.find((item) => item.key === "persistence");
}

function externalCheck(report, key) {
  return report.external.checks.find((item) => item.key === key);
}

function localCheck(report, key) {
  return report.local.checks.find((item) => item.key === key);
}

test("WeChat Work production readiness accepts implemented Prisma persistence", () => {
  const original = Object.fromEntries(configuredKeys.map((key) => [key, appConfig[key]]));
  try {
    configure(false);
    const report = buildWechatWorkProductionReadiness({ mappedAccounts: 2, auditRecords: 3 });
    assert.equal(report.local.status, "ready");
    assert.equal(persistenceCheck(report).status, "ready");
    assert.match(persistenceCheck(report).detail, /Prisma persistence enabled/);
    assert.equal(localCheck(report, "open_kfid").status, "ready");
    assert.match(localCheck(report, "open_kfid").fix, /WECHAT_WORK_OPEN_KFID/);
    assert.equal(
      report.callback.consoleFields.find((item) => item.key === "callback_url").copyValue,
      "https://kefu.example.com/api/wechat-work/callback",
    );
    assert.equal(report.callback.consoleFields.find((item) => item.key === "callback_token").secret, true);
    assert.equal(report.callback.consoleFields.find((item) => item.key === "encoding_aes_key").secret, true);
    assert.equal(report.callback.consoleFields.find((item) => item.key === "open_kfid").status, "ready");
    assert.equal(report.preLiveChecklist.duringIcp.find((item) => item.key === "official_send_contract").status, "ready");
    assert.equal(
      report.preLiveChecklist.beforeExternalJointTest.find((item) => item.key === "controlled_inbound_outbound_acceptance").status,
      "blocked",
    );
    assert.ok(report.callback.localVerification.some((item) => item.includes("preflight")));
    assert.ok(report.callback.externalVerification.some((item) => item.includes("sync_msg")));
    assert.doesNotMatch(persistenceCheck(report).detail, /not implemented/i);
    assert.equal(report.status, "blocked");
    assert.equal(report.launchPlan.currentPhase, "external_acceptance");
    assert.match(report.launchPlan.recommendedNextAction, /公网 HTTPS/);
    assert.equal(externalCheck(report, "public_callback_url").status, "blocked");
    assert.equal(report.launchPlan.duringIcp.every((item) => item.phase === "during_icp"), true);
    assert.equal(report.launchPlan.duringIcp.find((item) => item.key === "server_contract_ready").status, "ready");
    assert.equal(report.launchPlan.afterIcp.find((item) => item.key === "live_receive_send_acceptance").status, "blocked");
  } finally {
    Object.assign(appConfig, original);
  }
});

test("WeChat Work production readiness keeps local JSON mode out of production-ready state", () => {
  const original = Object.fromEntries(configuredKeys.map((key) => [key, appConfig[key]]));
  try {
    configure(true);
    const report = buildWechatWorkProductionReadiness({ mappedAccounts: 0, auditRecords: 0 });
    assert.equal(report.local.status, "missing");
    assert.equal(persistenceCheck(report).status, "missing");
    assert.match(persistenceCheck(report).detail, /local\/demo mode/);
    assert.equal(report.launchPlan.currentPhase, "local_configuring");
    assert.equal(report.launchPlan.duringIcp.find((item) => item.key === "server_contract_ready").status, "missing");
    assert.equal(report.productionReady, false);
  } finally {
    Object.assign(appConfig, original);
  }
});

test("WeChat Work production readiness unlocks external checks from persisted live evidence", () => {
  const original = Object.fromEntries(configuredKeys.map((key) => [key, appConfig[key]]));
  try {
    configure(false);
    const report = buildWechatWorkProductionReadiness({
      mappedAccounts: 1,
      auditRecords: 4,
      runtimeEvidence: {
        callbackVerificationAccepted: true,
        callbackAccepted: true,
        inboundProcessed: true,
        sendApiAccepted: true,
      },
    });

    assert.equal(report.productionReady, true);
    assert.equal(report.status, "ready");
    assert.equal(externalCheck(report, "public_callback_url").status, "ready");
    assert.equal(externalCheck(report, "public_https_reachability").status, "ready");
    assert.equal(externalCheck(report, "callback_registration").status, "ready");
    assert.equal(externalCheck(report, "customer_service_api_permissions").status, "ready");
    assert.equal(externalCheck(report, "live_callback_sync_and_send").status, "ready");
    assert.equal(report.callback.consoleFields.find((item) => item.key === "callback_url").status, "ready");
    assert.equal(
      report.preLiveChecklist.beforeExternalJointTest.find((item) => item.key === "controlled_inbound_outbound_acceptance").status,
      "ready",
    );
    assert.equal(report.launchPlan.currentPhase, "production_ready");
  } finally {
    Object.assign(appConfig, original);
  }
});

test("WeChat Work production readiness records proven API access without claiming a callback close-loop", () => {
  const original = Object.fromEntries(configuredKeys.map((key) => [key, appConfig[key]]));
  try {
    configure(false);
    const report = buildWechatWorkProductionReadiness({
      mappedAccounts: 1,
      auditRecords: 2,
      runtimeEvidence: {
        inboundProcessed: true,
        sendApiAccepted: true,
      },
    });

    assert.equal(externalCheck(report, "customer_service_api_permissions").status, "ready");
    assert.equal(externalCheck(report, "live_callback_sync_and_send").status, "blocked");
    assert.match(externalCheck(report, "live_callback_sync_and_send").detail, /callback_accepted/);
    assert.equal(report.productionReady, false);
  } finally {
    Object.assign(appConfig, original);
  }
});

test("WeChat Work production readiness accepts suite authorization instead of static corp credentials", () => {
  const original = Object.fromEntries(configuredKeys.map((key) => [key, appConfig[key]]));
  try {
    configure(false);
    appConfig.wechatWorkCorpId = "";
    appConfig.wechatWorkSecret = "";
    const report = buildWechatWorkProductionReadiness({
      mappedAccounts: 1,
      auditRecords: 1,
      authorizedInstallation: true,
    });
    const corpId = report.local.checks.find((item) => item.key === "corp_id");
    const secret = report.local.checks.find((item) => item.key === "customer_service_secret");
    assert.equal(corpId.status, "ready");
    assert.equal(secret.status, "ready");
    assert.match(secret.detail, /suite authorization/);
    assert.equal(report.local.status, "ready");
    assert.equal(report.launchPlan.duringIcp.find((item) => item.key === "credentials_ready").status, "ready");
  } finally {
    Object.assign(appConfig, original);
  }
});

test("WeChat Work production readiness keeps public callback work in the post-ICP plan", () => {
  const original = Object.fromEntries(configuredKeys.map((key) => [key, appConfig[key]]));
  try {
    configure(false);
    appConfig.customerServicePublicBaseUrl = "";
    const report = buildWechatWorkProductionReadiness({ mappedAccounts: 1, auditRecords: 1 });

    assert.equal(report.local.status, "ready");
    assert.equal(report.status, "missing");
    assert.equal(report.launchPlan.currentPhase, "icp_waiting");
    assert.equal(report.local.checks.some((item) => item.key === "public_callback_url"), false);
    assert.equal(externalCheck(report, "public_callback_url").status, "missing");
    assert.equal(report.callback.url, "");
    assert.equal(report.callback.publicHttpsFormatReady, false);
    assert.equal(report.launchPlan.afterIcp.find((item) => item.key === "public_https_callback").status, "missing");
    assert.equal(report.callback.consoleFields.find((item) => item.key === "callback_url").status, "missing");
    assert.equal(
      report.callback.consoleFields.find((item) => item.key === "callback_url").copyValue,
      "{CUSTOMER_SERVICE_PUBLIC_BASE_URL}/api/wechat-work/callback",
    );
    assert.equal(
      report.preLiveChecklist.beforeExternalJointTest.find((item) => item.key === "public_https_callback").blockedBy,
      "ICP/domain setup pending",
    );
    assert.equal(report.launchPlan.afterIcp.every((item) => item.phase === "after_icp"), true);
    assert.equal(report.launchPlan.duringIcp.some((item) => item.owner === "developer"), true);
  } finally {
    Object.assign(appConfig, original);
  }
});

test("WeChat Work production readiness explains missing OpenKfid without falling back to personal WeChat", () => {
  const original = Object.fromEntries(configuredKeys.map((key) => [key, appConfig[key]]));
  try {
    configure(false);
    appConfig.wechatWorkOpenKfid = "";
    const report = buildWechatWorkProductionReadiness({ mappedAccounts: 1, auditRecords: 1 });

    assert.equal(localCheck(report, "open_kfid").status, "blocked");
    assert.match(localCheck(report, "open_kfid").reason, /customer-service account/);
    assert.match(localCheck(report, "open_kfid").fix, /WECHAT_WORK_OPEN_KFID/);
    assert.equal(report.local.status, "blocked");
    assert.equal(report.local.ready, false);
    assert.equal(report.launchPlan.currentPhase, "local_configuring");
    assert.equal(report.launchPlan.duringIcp.find((item) => item.key === "open_kfid_ready").status, "blocked");
    assert.equal(report.preLiveChecklist.duringIcp.find((item) => item.key === "official_send_contract").status, "blocked");
    assert.ok(report.codeContracts.includes("enterprise_wechat_only_no_personal_rpa_production_send"));
    assert.equal(JSON.stringify(report).includes("windows_bridge"), false);
  } finally {
    Object.assign(appConfig, original);
  }
});
