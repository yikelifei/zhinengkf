"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { installIsolatedAppConfigEnv } = require("./isolated-app-config-env");

const isolatedConfig = installIsolatedAppConfigEnv("smart-kefu-enterprise-wechat-surface-");
test.after(() => isolatedConfig.cleanup());

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", experimentalDecorators: true, emitDecoratorMetadata: true },
});

const appModulePath = path.join(__dirname, "../apps/api/src/app.module");
const appConfigPath = path.join(__dirname, "../apps/api/src/shared/app-config");
const personalControllerPath = path.join(__dirname, "../apps/api/src/personal-wechat-rpa/personal-wechat-rpa.controller");
const wechatControllerPath = path.join(__dirname, "../apps/api/src/wechat/wechat.controller");
const read = (relativePath) => fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

function loadAppControllers(productMode) {
  const originalProductMode = process.env.WECHAT_PRODUCT_MODE;
  if (productMode == null) {
    delete process.env.WECHAT_PRODUCT_MODE;
  } else {
    process.env.WECHAT_PRODUCT_MODE = productMode;
  }
  delete require.cache[require.resolve(appModulePath)];
  try {
    const { AppModule } = require(appModulePath);
    return Reflect.getMetadata("controllers", AppModule) || [];
  } finally {
    delete require.cache[require.resolve(appModulePath)];
    if (originalProductMode == null) {
      delete process.env.WECHAT_PRODUCT_MODE;
    } else {
      process.env.WECHAT_PRODUCT_MODE = originalProductMode;
    }
  }
}

function withProductMode(productMode, fn) {
  const originalProductMode = process.env.WECHAT_PRODUCT_MODE;
  if (productMode == null) {
    delete process.env.WECHAT_PRODUCT_MODE;
  } else {
    process.env.WECHAT_PRODUCT_MODE = productMode;
  }
  try {
    return fn();
  } finally {
    if (originalProductMode == null) {
      delete process.env.WECHAT_PRODUCT_MODE;
    } else {
      process.env.WECHAT_PRODUCT_MODE = originalProductMode;
    }
  }
}

function createWechatController() {
  const calls = [];
  const service = new Proxy({}, {
    get(_target, property) {
      return (...args) => {
        calls.push({ method: String(property), args });
        return { method: String(property), args };
      };
    },
  });
  const { WechatController } = require(wechatControllerPath);
  return { controller: new WechatController(service), calls };
}

function assertForbidden(action, message) {
  assert.throws(action, (error) => {
    assert.equal(error?.status, 403);
    assert.match(String(error?.message || ""), message);
    return true;
  });
}

test("enterprise wechat only mode does not expose personal WeChat RPA API controllers", () => {
  const { PersonalWechatRpaController } = require(personalControllerPath);

  assert.equal(loadAppControllers(undefined).includes(PersonalWechatRpaController), false);
  assert.equal(loadAppControllers("enterprise_wechat_only").includes(PersonalWechatRpaController), false);
  assert.equal(loadAppControllers("legacy_personal_wechat").includes(PersonalWechatRpaController), false);
});

test("enterprise wechat controller removes bridge and window APIs and rejects non-official inbound", () => {
  withProductMode(undefined, () => {
    const { controller, calls } = createWechatController();
    assert.throws(() => controller.processChannelInboundTest("personal_wechat", {}), /only work_wechat is supported/);
    assert.throws(() => controller.processChannelInboundTest("mini_program", {}), /only work_wechat is supported/);
    for (const method of [
      "listBridgeOutbox",
      "listBridgeDispatch",
      "getBridgeStatus",
      "scanBridgeInbox",
      "listWindowSnapshots",
      "getWindowObserverStatus",
      "captureWindowObserverOnce",
      "scanWindowSnapshotInbox",
      "createDemoWindowSnapshot",
      "validateWithCurrentWindow",
      "markSent",
      "markSentWithCurrentWindow",
      "acknowledgeBridgeSend",
    ]) assert.equal(typeof controller[method], "undefined", `${method} must not be exposed`);
    assert.equal(calls.length, 0);
  });
});

test("Enterprise WeChat channel status does not report terminal failures as pending", () => {
  const dispatchSource = read("apps/api/src/wechat/wechat-dispatch.service.ts");
  assert.match(dispatchSource, /\["queued", "sending", "pending_ack"\]\.includes/);
  assert.doesNotMatch(dispatchSource, /!\["sent", "cancelled"\]\.includes\(task\.status\)/);
});

test("enterprise wechat only mode rejects windows bridge send adapter but keeps official and dry-run paths", () => {
  withProductMode("enterprise_wechat_only", () => {
    const { appConfig } = require(appConfigPath);
    const originalAdapter = appConfig.wechatSendAdapter;
    appConfig.wechatSendAdapter = "dry_run";
    try {
      const { controller, calls } = createWechatController();
      assertForbidden(() => controller.getSendAdapter("windows_bridge"), /windows_bridge/);
      assertForbidden(() => controller.processSafeSendQueue({ adapter: "windows_bridge" }), /windows_bridge/);
      assertForbidden(() => controller.executeSend("send_1", { adapter: "windows_bridge" }), /windows_bridge/);

      assert.equal(controller.getSendAdapter("wechat_work_kf").method, "getSendAdapter");
      assert.equal(controller.processSafeSendQueue({ adapter: "dry_run" }).method, "processSafeSendQueue");
      assert.equal(controller.executeSend("send_1", { adapter: "wechat_work_kf" }).method, "executeQueuedSend");
      assert.equal(controller.executeDryRun("send_1", {}).method, "executeDryRunSend");

      appConfig.wechatSendAdapter = "windows_bridge";
      assertForbidden(() => controller.executeSend("send_2", {}), /windows_bridge/);
      assert.equal(calls.map((call) => call.method).includes("executeQueuedSend"), true);
    } finally {
      appConfig.wechatSendAdapter = originalAdapter;
    }
  });
});

test("legacy product mode cannot reopen removed personal WeChat APIs", () => {
  withProductMode("legacy_personal_wechat", () => {
    const { controller, calls } = createWechatController();
    assert.throws(() => controller.processChannelInboundTest("personal_wechat", {}), /only work_wechat is supported/);
    assertForbidden(() => controller.getSendAdapter("windows_bridge"), /windows_bridge/);
    assertForbidden(() => controller.processSafeSendQueue({ adapter: "windows_bridge" }), /windows_bridge/);
    assertForbidden(() => controller.executeSend("send_legacy", { adapter: "windows_bridge" }), /windows_bridge/);
    assert.equal(typeof controller.listBridgeOutbox, "undefined");
    assert.equal(typeof controller.getWindowObserverStatus, "undefined");
    assert.equal(typeof controller.acknowledgeBridgeSend, "undefined");
    assert.equal(calls.length, 0);
  });
});
