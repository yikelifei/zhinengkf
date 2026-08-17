"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { installIsolatedAppConfigEnv } = require("./isolated-app-config-env");

const isolatedConfig = installIsolatedAppConfigEnv("smart-kefu-wechat-work-remote-readiness-");
test.after(() => isolatedConfig.cleanup());

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const {
  WECHAT_WORK_READINESS_TOKEN_HEADER,
  fetchWechatWorkRemoteReadiness,
  readinessExportTokenMatches,
} = require("../apps/api/src/wechat-work/wechat-work-readiness-remote");
const { WechatWorkController } = require("../apps/api/src/wechat-work/wechat-work.controller");
const { WechatWorkService } = require("../apps/api/src/wechat-work/wechat-work.service");

const TOKEN = "a".repeat(64);

function validReport() {
  return {
    schema: "smart_kefu_wechat_work_readiness_v1",
    mode: "offline_preflight",
    networkCalls: false,
    status: "ready",
    productionReady: true,
    local: { status: "ready", ready: true, checks: [] },
    external: { status: "ready", ready: true, checks: [], blockers: [] },
    callback: { path: "/api/wechat-work/callback", url: "https://kefu.example.com/api/wechat-work/callback" },
    identityPolicy: { channel: "work_wechat", accountPlatform: "wechat_work_kf", adapter: "wechat_work_kf" },
  };
}

test("readiness export accepts only independent fixed-length hexadecimal tokens", () => {
  assert.equal(readinessExportTokenMatches(TOKEN, TOKEN), true);
  assert.equal(readinessExportTokenMatches(TOKEN, "b".repeat(64)), false);
  assert.equal(readinessExportTokenMatches(TOKEN, "short"), false);
  assert.equal(readinessExportTokenMatches("", ""), false);
});

test("desktop remote readiness uses the exact HTTPS path and dedicated header", async () => {
  let request;
  const report = await fetchWechatWorkRemoteReadiness({
    url: "https://kefu.example.com/api/wechat-work/readiness/export",
    token: TOKEN,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return Response.json(validReport());
    },
  });

  assert.equal(request.url, "https://kefu.example.com/api/wechat-work/readiness/export");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers[WECHAT_WORK_READINESS_TOKEN_HEADER], TOKEN);
  assert.equal(request.options.headers["x-internal-api-token"], undefined);
  assert.equal(report.productionReady, true);
  assert.equal(report.source.kind, "production_server");
  assert.equal(report.source.endpoint, "https://kefu.example.com");
});

test("desktop remote readiness rejects alternate paths and invalid response schemas", async () => {
  await assert.rejects(
    fetchWechatWorkRemoteReadiness({
      url: "https://kefu.example.com/api/wechat-work/preflight",
      token: TOKEN,
      fetchImpl: async () => Response.json(validReport()),
    }),
    (error) => error.code === "remote_readiness_url_invalid",
  );
  await assert.rejects(
    fetchWechatWorkRemoteReadiness({
      url: "https://kefu.example.com/api/wechat-work/readiness/export",
      token: TOKEN,
      fetchImpl: async () => Response.json({ ok: true }),
    }),
    (error) => error.code === "remote_readiness_invalid_schema",
  );
});

test("public readiness export is token-scoped and cannot reuse the internal admin token", async () => {
  const originalExportToken = process.env.WECHAT_WORK_READINESS_EXPORT_TOKEN;
  const originalInternalToken = process.env.INTERNAL_API_TOKEN;
  process.env.WECHAT_WORK_READINESS_EXPORT_TOKEN = TOKEN;
  process.env.INTERNAL_API_TOKEN = "b".repeat(64);
  try {
    const controller = new WechatWorkController({
      async getProductionPreflightExport() {
        return validReport();
      },
    });
    assert.throws(
      () => controller.getProductionPreflightExport(process.env.INTERNAL_API_TOKEN),
      /invalid readiness export token/,
    );
    assert.equal((await controller.getProductionPreflightExport(TOKEN)).productionReady, true);
  } finally {
    restoreEnv("WECHAT_WORK_READINESS_EXPORT_TOKEN", originalExportToken);
    restoreEnv("INTERNAL_API_TOKEN", originalInternalToken);
  }
});

test("desktop preflight prefers production readiness and labels a remote outage truthfully", async () => {
  const originalTarget = process.env.SMART_KEFU_RUNTIME_TARGET;
  const originalUrl = process.env.WECHAT_WORK_REMOTE_READINESS_URL;
  const originalToken = process.env.WECHAT_WORK_REMOTE_READINESS_TOKEN;
  const originalFetch = global.fetch;
  process.env.SMART_KEFU_RUNTIME_TARGET = "desktop";
  process.env.WECHAT_WORK_REMOTE_READINESS_URL = "https://kefu.example.com/api/wechat-work/readiness/export";
  process.env.WECHAT_WORK_REMOTE_READINESS_TOKEN = TOKEN;
  const localStore = {
    listWechatAccounts: () => [],
    listWechatWorkAuditLogs: () => [],
  };
  try {
    const service = new WechatWorkService({}, localStore, {});
    global.fetch = async () => Response.json(validReport());
    const remote = await service.getProductionPreflight();
    assert.equal(remote.productionReady, true);
    assert.equal(remote.source.kind, "production_server");

    global.fetch = async () => {
      throw new Error("offline");
    };
    const fallback = await service.getProductionPreflight();
    assert.equal(fallback.productionReady, false);
    assert.equal(fallback.source.kind, "remote_unavailable");
    assert.equal(fallback.source.errorCode, "remote_readiness_unreachable");
  } finally {
    global.fetch = originalFetch;
    restoreEnv("SMART_KEFU_RUNTIME_TARGET", originalTarget);
    restoreEnv("WECHAT_WORK_REMOTE_READINESS_URL", originalUrl);
    restoreEnv("WECHAT_WORK_REMOTE_READINESS_TOKEN", originalToken);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
