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
    "WindowInboundOperationsPage",
    "PersonalWechatInstancesPage",
    "PersonalWechatControlPage",
    "PersonalWechatSafetyPage",
  ]) {
    assert.match(source, new RegExp(`\\b${page}\\b`));
  }
});

test("integration controllers reuse existing production components and real contracts", () => {
  const instances = read("features/integrations/personal-wechat-instances-page.tsx");
  const control = read("features/integrations/personal-wechat-control-page.tsx");
  const safety = read("features/integrations/personal-wechat-safety-page.tsx");
  const channels = read("features/integrations/channels-status-page.tsx");
  const preflight = read("features/integrations/wechat-work-preflight-page.tsx");
  const inbound = read("features/integrations/window-inbound-operations-page.tsx");

  assert.match(instances, /PersonalWechatInstancesPanel/);
  assert.match(instances, /getPersonalWechatRpaRegistry/);
  assert.match(instances, /validatePersonalWechatRpaInstance/);
  assert.match(instances, /savePersonalWechatRpaInstance/);
  assert.match(instances, /disablePersonalWechatRpaInstance/);
  assert.match(control, /PersonalWechatWorkspace/);
  assert.match(control, /fixedView="accounts"/);
  assert.match(control, /语音能力未接入/);
  assert.match(safety, /MessageSafetyGovernance/);
  assert.match(safety, /globallyStopped/);
  assert.match(channels, /getWechatChannelStatus/);
  assert.match(preflight, /getWechatWorkProductionPreflight/);
  assert.match(inbound, /captureWindowObserverOnce/);
  assert.match(inbound, /scanWindowSnapshotInbox/);
  assert.match(inbound, /testWechatChannelInbound/);
  assert.match(inbound, /drillConfirmed/);
});

test("send feature barrel exports queue, blocked, and diagnostics pages", () => {
  const source = read("features/send/index.ts");
  assert.match(source, /SendQueuePage/);
  assert.match(source, /SendBlockedPage/);
  assert.match(source, /SendDiagnosticsPage/);
});

test("send pages preserve identity binding, explicit confirmation, and fail-closed execution", () => {
  const queue = read("features/send/send-queue-page.tsx");
  const blocked = read("features/send/send-blocked-page.tsx");
  const policy = read("features/send/send-policy.ts");

  assert.match(queue, /validateSendTaskCurrentWindow/);
  assert.match(queue, /executeSendTask/);
  assert.match(queue, /processSafeSendQueue/);
  assert.match(queue, /identityExpectation\(task\)/);
  assert.match(queue, /pendingConfirmation/);
  assert.match(queue, /canExecuteSendTask/);
  assert.match(blocked, /requeueSendTask/);
  assert.match(blocked, /cancelSendTask/);
  assert.match(blocked, /identityExpectation\(task\)/);
  assert.match(blocked, /pendingConfirmation/);
  assert.match(policy, /manualLocked/);
  assert.match(policy, /blockedByRoutingPolicy/);
  assert.match(policy, /guardSnapshot\?\.status === "passed"/);
  assert.match(policy, /task\.status === "sending"/);
});

test("diagnostics reads each runtime source independently and only exposes real operational scans", () => {
  const source = read("features/send/send-diagnostics-page.tsx");
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /getBridgeStatus/);
  assert.match(source, /getBridgeOutbox/);
  assert.match(source, /getWindowObserverStatus/);
  assert.match(source, /getSendAttempts/);
  assert.match(source, /scanSendOperations/);
  assert.match(source, /scanBridgeInbox/);
  assert.match(source, /scanWindowSnapshotInbox/);
  assert.match(source, /captureWindowObserverOnce/);
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

test("reused integration controls expose stable action ids and accessible button names", () => {
  const files = [
    "components/wechat-work-readiness-panel.tsx",
    "components/personal-wechat-instances-panel.tsx",
    "components/personal-wechat-workspace/personal-wechat-workspace.tsx",
    "components/personal-wechat-control-center/personal-wechat-control-center.tsx",
    "components/personal-wechat-control-center/account-fleet-pane.tsx",
    "components/personal-wechat-control-center/account-inspector-pane.tsx",
    "components/message-safety-governance/message-safety-governance.tsx",
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
