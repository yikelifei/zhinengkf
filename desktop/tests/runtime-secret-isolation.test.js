"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS" } });

const { renderWindowsWrapperEnvironment, selectServiceEnvironment, selectWrapperEnvironment } = require("../packages/runtime/service-environment");
const { atomicWritePrivateJson, readPrivateJsonFile } = require("../tools/private-runtime-file");
const { buildWindowObserverChildEnvironment } = require("../apps/api/src/shared/runtime-child-environment");
const { buildApiServiceEnvironment, buildWebServiceEnvironment } = require("../apps/electron/packaged-runtime");

const sentinels = {
  PATH: "safe-path",
  INTERNAL_API_TOKEN: "internal-secret",
  DATABASE_URL: "database-secret",
  LOW_VALUE_AUTOMATION_REDIS_URL: "redis-secret",
  WECHAT_WORK_SECRET: "wecom-secret",
  WECHAT_WORK_SUITE_ID: "wecom-suite-id",
  WECHAT_WORK_SUITE_SECRET: "wecom-suite-secret",
  WECHAT_WORK_SUITE_TOKEN: "wecom-suite-token",
  WECHAT_WORK_SUITE_ENCODING_AES_KEY: "wecom-suite-aes-key",
  WECHAT_WORK_SUITE_STORAGE_KEY: "wecom-suite-storage-key",
  DESIGN_PLATFORM_ACCESS_TOKEN: "design-secret",
  DESIGN_PLATFORM_COOKIE: "design-cookie",
  PERSONAL_WECHAT_RPA_TOKEN: "rpa-secret",
  UNRELATED_SECRET: "unrelated-secret",
  ZHENXI_AI_APP_URL: "https://app.zhenxiai.cloud",
  ZHENXI_AI_SITE_URL: "https://zhenxiai.cloud",
  ZHENXI_AI_WWW_URL: "https://www.zhenxiai.cloud",
  ZHENXI_AI_LOCAL_BASE_URL: "http://127.0.0.1:3010",
  ZHENXI_AI_LOCAL_DEV_URL: "http://127.0.0.1:3000",
  ZHENXI_AI_LOCAL_PREVIEW_URL: "http://127.0.0.1:3001",
  DESIGN_PLATFORM_RUNTIME_CONFIG: "C:\\runtime\\design.json",
  WECHAT_BRIDGE_SERVICE_TOKEN_FILE: "C:\\runtime\\bridge.key",
  WECHAT_WINDOW_OBSERVER_PROOF_FILE: "C:\\runtime\\observer.key",
  PERSONAL_WECHAT_RPA_CONFIG_FILE: "C:\\runtime\\personal.json",
  SMART_KEFU_RUNTIME_TARGET: "desktop",
  LOW_VALUE_AUTOMATION_ENABLED: "true",
  LOW_VALUE_AUTOMATION_MODE: "interval",
  LOW_VALUE_AUTOMATION_RUN_ON_START: "true",
};

test("service environments expose business secrets only to the API", () => {
  const api = selectServiceEnvironment("api", sentinels);
  for (const key of [
    "DATABASE_URL",
    "LOW_VALUE_AUTOMATION_REDIS_URL",
    "WECHAT_WORK_SECRET",
    "WECHAT_WORK_SUITE_ID",
    "WECHAT_WORK_SUITE_SECRET",
    "WECHAT_WORK_SUITE_TOKEN",
    "WECHAT_WORK_SUITE_ENCODING_AES_KEY",
    "WECHAT_WORK_SUITE_STORAGE_KEY",
    "DESIGN_PLATFORM_ACCESS_TOKEN",
  ]) {
    assert.equal(api[key], sentinels[key], key);
  }
  for (const key of [
    "ZHENXI_AI_APP_URL",
    "ZHENXI_AI_SITE_URL",
    "ZHENXI_AI_WWW_URL",
    "ZHENXI_AI_LOCAL_BASE_URL",
    "ZHENXI_AI_LOCAL_DEV_URL",
    "ZHENXI_AI_LOCAL_PREVIEW_URL",
  ]) {
    assert.equal(api[key], sentinels[key], key);
  }
  assert.equal(api.UNRELATED_SECRET, undefined);

  for (const name of ["web", "design-platform-mock", "wechat-window-observer", "wechat-bridge-worker", "personal-wechat-rpa-host", "personal-wechat-bridge"]) {
    const env = selectServiceEnvironment(name, sentinels);
    for (const key of ["DATABASE_URL", "LOW_VALUE_AUTOMATION_REDIS_URL", "WECHAT_WORK_SECRET", "WECHAT_WORK_SUITE_SECRET", "WECHAT_WORK_SUITE_TOKEN", "WECHAT_WORK_SUITE_ENCODING_AES_KEY", "WECHAT_WORK_SUITE_STORAGE_KEY", "DESIGN_PLATFORM_ACCESS_TOKEN", "DESIGN_PLATFORM_COOKIE", "PERSONAL_WECHAT_RPA_TOKEN", "UNRELATED_SECRET"]) {
      assert.equal(env[key], undefined, `${name}:${key}`);
    }
  }
  assert.equal(selectServiceEnvironment("personal-wechat-bridge", sentinels).PERSONAL_WECHAT_RPA_CONFIG_FILE, sentinels.PERSONAL_WECHAT_RPA_CONFIG_FILE);
});

test("packaged Web keeps only its in-memory proof and API token", () => {
  const options = {
    resourcesPath: "C:\\Program Files\\Smart Kefu\\resources",
    appPath: "C:\\Program Files\\Smart Kefu\\resources\\app.asar",
    userDataPath: "C:\\Users\\operator\\AppData\\Roaming\\Smart Kefu",
    baseEnv: sentinels,
    token: "packaged-internal-token",
  };
  const api = buildApiServiceEnvironment(options);
  const web = buildWebServiceEnvironment({ ...options, webSessionProof: "session-proof" });
  assert.equal(api.DATABASE_URL, "database-secret");
  assert.equal(api.DESKTOP_WEB_SESSION_PROOF, undefined);
  assert.equal(web.INTERNAL_API_TOKEN, "packaged-internal-token");
  assert.equal(web.DESKTOP_WEB_SESSION_PROOF, "session-proof");
  for (const key of ["DATABASE_URL", "LOW_VALUE_AUTOMATION_REDIS_URL", "WECHAT_WORK_SECRET", "WECHAT_WORK_SUITE_SECRET", "WECHAT_WORK_SUITE_TOKEN", "WECHAT_WORK_SUITE_ENCODING_AES_KEY", "WECHAT_WORK_SUITE_STORAGE_KEY", "DESIGN_PLATFORM_ACCESS_TOKEN", "DESIGN_PLATFORM_COOKIE", "UNRELATED_SECRET", "DESKTOP_ENV_FILE"]) {
    assert.equal(web[key], undefined, key);
  }
  const webWrapper = renderWindowsWrapperEnvironment("web", web).join("\r\n");
  assert.doesNotMatch(webWrapper, /packaged-internal-token|session-proof/);
});

test("generated cmd environment persists file references but no raw credential", (t) => {
  const wrapper = selectWrapperEnvironment("api", selectServiceEnvironment("api", sentinels));
  assert.equal(wrapper.DESIGN_PLATFORM_RUNTIME_CONFIG, sentinels.DESIGN_PLATFORM_RUNTIME_CONFIG);
  assert.equal(wrapper.ZHENXI_AI_APP_URL, sentinels.ZHENXI_AI_APP_URL);
  assert.equal(wrapper.ZHENXI_AI_LOCAL_BASE_URL, sentinels.ZHENXI_AI_LOCAL_BASE_URL);
  assert.equal(wrapper.ZHENXI_AI_LOCAL_DEV_URL, sentinels.ZHENXI_AI_LOCAL_DEV_URL);
  assert.equal(wrapper.ZHENXI_AI_LOCAL_PREVIEW_URL, sentinels.ZHENXI_AI_LOCAL_PREVIEW_URL);
  assert.equal(wrapper.SMART_KEFU_RUNTIME_TARGET, "desktop");
  assert.equal(wrapper.LOW_VALUE_AUTOMATION_ENABLED, "true");
  assert.equal(wrapper.LOW_VALUE_AUTOMATION_MODE, "interval");
  assert.equal(wrapper.LOW_VALUE_AUTOMATION_RUN_ON_START, "true");
  for (const key of ["INTERNAL_API_TOKEN", "DATABASE_URL", "LOW_VALUE_AUTOMATION_REDIS_URL", "WECHAT_WORK_SECRET", "WECHAT_WORK_SUITE_SECRET", "WECHAT_WORK_SUITE_TOKEN", "WECHAT_WORK_SUITE_ENCODING_AES_KEY", "WECHAT_WORK_SUITE_STORAGE_KEY", "DESIGN_PLATFORM_ACCESS_TOKEN", "DESIGN_PLATFORM_COOKIE", "PERSONAL_WECHAT_RPA_TOKEN"]) {
    assert.equal(wrapper[key], undefined, key);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-wrapper-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const wrapperPath = path.join(directory, "run-api.cmd");
  fs.writeFileSync(wrapperPath, ["@echo off", ...renderWindowsWrapperEnvironment("api", selectServiceEnvironment("api", sentinels)), "node api.js"].join("\r\n"));
  const generated = fs.readFileSync(wrapperPath, "utf8");
  assert.match(generated, /DESIGN_PLATFORM_RUNTIME_CONFIG/);
  for (const secret of ["internal-secret", "database-secret", "redis-secret", "wecom-secret", "wecom-suite-secret", "wecom-suite-token", "wecom-suite-aes-key", "wecom-suite-storage-key", "design-secret", "design-cookie", "rpa-secret", "unrelated-secret"]) {
    assert.doesNotMatch(generated, new RegExp(secret), secret);
  }
});

test("one-shot observer child does not inherit API business secrets", () => {
  const env = buildWindowObserverChildEnvironment(sentinels, {
    WECHAT_WINDOW_OBSERVER_PROOF_FILE: "C:\\runtime\\observer.key",
    WECHAT_WINDOW_SNAPSHOT_INBOX_DIR: "C:\\runtime\\inbox",
  });
  assert.equal(env.WECHAT_WINDOW_OBSERVER_PROOF_FILE, "C:\\runtime\\observer.key");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.INTERNAL_API_TOKEN, undefined);
  assert.equal(env.DESIGN_PLATFORM_ACCESS_TOKEN, undefined);
});

test("private runtime JSON writes atomically and rejects unsafe targets", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-private-runtime-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, "design-platform-config.json");
  atomicWritePrivateJson(target, { token: "secret" });
  assert.deepEqual(readPrivateJsonFile(target, {}), { token: "secret" });
  atomicWritePrivateJson(target, { token: "replacement" });
  assert.deepEqual(readPrivateJsonFile(target, {}), { token: "replacement" });
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith(".tmp")), false);
  if (process.platform !== "win32") assert.equal(fs.statSync(target).mode & 0o777, 0o600);

  const directoryTarget = path.join(directory, "directory-target");
  fs.mkdirSync(directoryTarget);
  assert.throws(() => atomicWritePrivateJson(directoryTarget, {}), /Unsafe runtime file target/);

  const invalidTarget = path.join(directory, "invalid.json");
  fs.writeFileSync(invalidTarget, "{not-json", { mode: 0o600 });
  assert.throws(() => readPrivateJsonFile(invalidTarget, {}), SyntaxError);

  const junctionTarget = path.join(directory, "junction-target");
  fs.symlinkSync(directory, junctionTarget, "junction");
  assert.throws(() => readPrivateJsonFile(junctionTarget, {}), /Unsafe runtime file target/);
  assert.throws(() => atomicWritePrivateJson(junctionTarget, {}), /Unsafe runtime file target/);

  const symlinkTarget = path.join(directory, "symlink-target.json");
  try {
    fs.symlinkSync(target, symlinkTarget, "file");
  } catch (error) {
    t.diagnostic(`symlink assertion skipped: ${error.code || error.message}`);
    return;
  }
  assert.throws(() => readPrivateJsonFile(symlinkTarget, {}), /Unsafe runtime file target/);
  assert.throws(() => atomicWritePrivateJson(symlinkTarget, {}), /Unsafe runtime file target/);
});
