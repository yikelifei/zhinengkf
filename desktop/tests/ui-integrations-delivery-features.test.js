"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const webRoot = path.join(desktopRoot, "apps/web/src");

function read(relativePath) {
  return fs.readFileSync(path.join(webRoot, relativePath), "utf8");
}

function sourceFiles(relativeDirectory) {
  const directory = path.join(webRoot, relativeDirectory);
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
    .map((name) => ({ name, source: fs.readFileSync(path.join(directory, name), "utf8") }));
}

function assertStableButtonContracts(files) {
  for (const { name, source } of files) {
    for (const match of source.matchAll(/<button\b[\s\S]*?>/g)) {
      assert.match(match[0], /data-action-id=/, `${name} has a button without a stable data-action-id`);
      assert.match(match[0], /aria-label=/, `${name} has a button without an aria-label`);
    }
  }
}

test("integration feature barrel exports route-ready independent page modules", () => {
  const source = read("features/integrations/index.ts");
  for (const page of [
    "ChannelsStatusPage",
    "WechatWorkPreflightPage",
    "WechatWorkConfigurationPage",
    "WechatWorkFlowPage",
  ]) {
    assert.match(source, new RegExp(`\\b${page}\\b`));
  }
  assert.doesNotMatch(source, /PersonalWechat|WindowEvidencePage/);
});

test("integration controllers reuse existing production components and real contracts", () => {
  const channels = read("features/integrations/channels-status-page.tsx");
  const preflight = read("features/integrations/wechat-work-preflight-page.tsx");
  const configuration = read("features/integrations/wechat-work-configuration-page.tsx");
  const firstSetup = read("features/integrations/wechat-work-first-setup-wizard.tsx");
  const flow = read("features/integrations/wechat-work-flow-page.tsx");

  assert.match(channels, /loadWechatChannelStatus/);
  assert.match(channels, /channel\.key === "work_wechat"/);
  assert.doesNotMatch(channels, /personal_wechat:|mini_program/);
  assert.match(preflight, /getWechatWorkProductionPreflight/);
  assert.match(configuration, /readiness\.local\.checks/);
  assert.match(configuration, /WechatWorkFirstSetupWizard/);
  assert.match(firstSetup, /首次企业配置向导/);
  assert.match(firstSetup, /validateWechatWorkCustomerServiceSecret\(secret, corpId\)/);
  assert.match(firstSetup, /saveWechatWorkCustomerServiceCredential/);
  assert.match(firstSetup, /callbackToken/);
  assert.match(firstSetup, /encodingAesKey/);
  assert.match(firstSetup, /enableAutomaticReplies/);
  assert.match(firstSetup, /type="password"/);
  assert.doesNotMatch(firstSetup, /localStorage|sessionStorage/);
  assert.match(flow, /status\.visualFlow/);
});

test("integration notices accept rich content without invalid paragraph nesting", () => {
  const featurePage = read("features/integrations/feature-page.tsx");
  assert.match(featurePage, /<div className=\{styles\.noticeBody\}>\{children\}<\/div>/);
  assert.doesNotMatch(featurePage, /<p>\{children\}<\/p>/);
});

test("send feature barrel exports queue, blocked, read-only diagnostics, and diagnostic operations", () => {
  const source = read("features/send/index.ts");
  assert.match(source, /SendQueuePage/);
  assert.match(source, /SendBlockedPage/);
  assert.match(source, /SendDiagnosticsPage/);
  assert.match(source, /SendDiagnosticsOperationsPage/);
});

test("send pages preserve identity binding, explicit confirmation, and fail-closed execution", () => {
  const queue = read("features/send/send-queue-page.tsx");
  const blocked = read("features/send/send-blocked-page.tsx");
  const policy = read("features/send/send-policy.ts");

  assert.match(queue, /validateSendTaskCurrentWindow/);
  assert.match(queue, /executeSendTask/);
  assert.match(queue, /processSafeSendQueue/);
  assert.match(queue, /cancelSendTask/);
  assert.match(queue, /isTrustedDesktopSessionError/);
  assert.match(queue, /sessionBlocked/);
  assert.match(queue, /需要可信桌面会话/);
  assert.match(queue, /\[\.\.\.new Set\(errors\)\]/);
  assert.match(queue, /identityExpectation\(task\)/);
  assert.match(queue, /pendingConfirmation/);
  assert.match(queue, /canExecuteSendTask/);
  assert.match(queue, /blockedByEarlierTask/);
  assert.match(queue, /确认取消待发送任务/);
  assert.match(blocked, /requeueSendTask/);
  assert.match(blocked, /cancelSendTask/);
  assert.match(blocked, /identityExpectation\(task\)/);
  assert.match(blocked, /pendingConfirmation/);
  assert.match(policy, /manualLocked/);
  assert.match(policy, /isManualReplySendTask/);
  assert.match(policy, /task\.payload\?\.source === "manual_reply"/);
  assert.match(policy, /task\.conversation\?\.manualLocked/);
  assert.match(policy, /!isManualReplySendTask\(task\)/);
  assert.match(policy, /blockedByRoutingPolicy/);
  assert.match(policy, /guardSnapshot\?\.status === "passed"/);
  assert.match(policy, /task\.status === "sending"/);
});

test("read-only diagnostics and send scans stay separate from Enterprise WeChat setup", () => {
  const diagnostics = read("features/send/send-diagnostics-page.tsx");
  const operations = read("features/send/send-diagnostics-operations-page.tsx");
  const configuration = read("features/integrations/wechat-work-configuration-page.tsx");
  assert.match(diagnostics, /Promise\.allSettled/);
  assert.match(diagnostics, /getBridgeStatus/);
  assert.match(diagnostics, /getBridgeOutbox/);
  assert.match(diagnostics, /getWindowObserverStatus/);
  assert.match(diagnostics, /getSendAttempts/);
  assert.doesNotMatch(diagnostics, /scanSendOperations|scanBridgeInbox|scanWindowSnapshotInbox|captureWindowObserverOnce/);
  assert.match(operations, /scanSendOperations/);
  assert.match(operations, /scanBridgeInbox/);
  assert.doesNotMatch(operations, /scanWindowSnapshotInbox|captureWindowObserverOnce/);
  assert.match(operations, /\/integrations\/wechat-work\/flow/);
  assert.doesNotMatch(operations, /\/integrations\/personal-wechat|个人微信窗口|窗口收件页/);
  assert.doesNotMatch(diagnostics + operations, /桥接回执|微信桥接|真实微信窗口|窗口证据|等待桥接/);
  assert.match(diagnostics + operations, /企业微信发送回执/);
  assert.match(configuration, /createWechatWorkAuthorizationInstallLink/);
  assert.doesNotMatch(configuration, /captureWindowObserverOnce|testWechatChannelInbound/);
});

test("training import examples stay aligned to Enterprise WeChat only delivery", () => {
  const source = read("features/training/training-import-page.tsx");
  assert.match(source, /placeholder="可选，如企业微信客服"/);
  assert.doesNotMatch(source, /placeholder="可选，如个人微信"/);
});

test("new production feature controllers contain no demo, wrong-window, timeout injection, or global load", () => {
  const files = [...sourceFiles("features/integrations"), ...sourceFiles("features/send")];
  const combined = files.map(({ source }) => source).join("\n");

  assert.doesNotMatch(combined, /createDemo(?:SendTask|WindowSnapshot)/);
  assert.doesNotMatch(combined, /executeDryRunSend/);
  assert.doesNotMatch(combined, /"wrong_chat"/);
  assert.doesNotMatch(combined, /failure[_-]?timeout/i);
  assert.doesNotMatch(combined, /\bload\s*\(\s*\)/);
  assert.doesNotMatch(combined, /\bfetch\s*\(/);
  assertStableButtonContracts(files);
});

test("retained shared integration controls expose stable action ids and accessible button names", () => {
  const files = [
    "components/wechat-work-readiness-panel.tsx",
  ].map((name) => ({ name, source: read(name) }));
  assertStableButtonContracts(files);
});

test("feature styles keep actions touchable and collapse cleanly at 390px", () => {
  const integrationsCss = read("features/integrations/integration-pages.module.css");
  const sendCss = read("features/send/send-pages.module.css");
  for (const css of [integrationsCss, sendCss]) {
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /@media\s*\(max-width:\s*520px\)/);
    assert.match(css, /grid-template-columns:\s*1fr/);
    assert.doesNotMatch(css, /overflow-x:\s*(?:auto|scroll)/);
  }
});
