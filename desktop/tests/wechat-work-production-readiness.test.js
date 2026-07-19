"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { appConfig } = require("../apps/api/src/shared/app-config");
const { buildWechatWorkProductionReadiness } = require("../apps/api/src/wechat-work/wechat-work-readiness");

const configuredKeys = [
  "useLocalStore", "wechatWorkCorpId", "wechatWorkSecret", "wechatWorkToken", "wechatWorkEncodingAesKey",
  "customerServicePublicBaseUrl", "wechatWorkApiBaseUrl", "wechatSendAdapter",
];

function configure(useLocalStore) {
  appConfig.useLocalStore = useLocalStore;
  appConfig.wechatWorkCorpId = "corp-configured";
  appConfig.wechatWorkSecret = "secret-configured";
  appConfig.wechatWorkToken = "token-configured";
  appConfig.wechatWorkEncodingAesKey = crypto.randomBytes(32).toString("base64").replace(/=$/, "");
  appConfig.customerServicePublicBaseUrl = "https://kefu.example.com";
  appConfig.wechatWorkApiBaseUrl = "https://qyapi.weixin.qq.com";
  appConfig.wechatSendAdapter = "wechat_work_kf";
}

function persistenceCheck(report) {
  return report.local.checks.find((item) => item.key === "persistence");
}

test("WeChat Work production readiness accepts implemented Prisma persistence", () => {
  const original = Object.fromEntries(configuredKeys.map((key) => [key, appConfig[key]]));
  try {
    configure(false);
    const report = buildWechatWorkProductionReadiness({ mappedAccounts: 2, auditRecords: 3 });
    assert.equal(report.local.status, "ready");
    assert.equal(persistenceCheck(report).status, "ready");
    assert.match(persistenceCheck(report).detail, /Prisma persistence enabled/);
    assert.doesNotMatch(persistenceCheck(report).detail, /not implemented/i);
    assert.equal(report.status, "blocked");
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
    assert.equal(report.productionReady, false);
  } finally {
    Object.assign(appConfig, original);
  }
});
