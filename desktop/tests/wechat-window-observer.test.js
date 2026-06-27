"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildObserverStatus,
  buildSnapshotFromWindow,
  isWechatLikeWindow,
  numberValue,
  ruleMatchesWindow,
  runOnce,
  safeFileSegment,
  writeObserverStatus,
} = require("../tools/wechat-window-observer");

test("matches account and conversation rules from foreground window title", () => {
  const snapshot = buildSnapshotFromWindow(
    {
      title: "Wang gift box - WeChat",
      processName: "WeChat",
      processId: 1234,
      executablePath: "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe",
    },
    {
      accounts: [
        {
          name: "service-account-1",
          wechatAccountId: "wechat_demo_1",
          accountDisplayName: "Service 1",
          processNames: ["WeChat"],
          titleIncludes: ["Wang"],
        },
      ],
      conversations: [
        {
          name: "wang-gift-box",
          wechatAccountId: "wechat_demo_1",
          conversationId: "conversation_demo_1",
          customerId: "customer_demo_1",
          titleIncludes: ["gift box"],
          chatTitle: "Wang gift box",
        },
      ],
    },
    "2026-06-26T00:00:00.000Z",
  );

  assert.equal(snapshot.source, "windows_foreground_observer");
  assert.equal(snapshot.isOnline, true);
  assert.equal(snapshot.wechatAccountId, "wechat_demo_1");
  assert.equal(snapshot.accountDisplayName, "Service 1");
  assert.equal(snapshot.chatTitle, "Wang gift box");
  assert.equal(snapshot.recentCustomerId, "customer_demo_1");
  assert.equal(snapshot.processId, 1234);
  assert.equal(snapshot.confidence, 0.95);
  assert.equal(snapshot.raw.matchedAccountRule, "service-account-1");
  assert.equal(snapshot.raw.matchedConversationRule, "wang-gift-box");
});

test("leaves non-wechat foreground window offline and unbound", () => {
  const snapshot = buildSnapshotFromWindow(
    { title: "README.md - Editor", processName: "Code", processId: 77 },
    { accounts: [{ wechatAccountId: "wechat_demo_1", processNames: ["WeChat"] }] },
    "2026-06-26T00:00:00.000Z",
  );

  assert.equal(snapshot.isOnline, false);
  assert.equal(snapshot.wechatAccountId, "");
  assert.equal(snapshot.confidence, 0.15);
});

test("supports exact, all-token and any-token title matching", () => {
  const windowInfo = { title: "Customer A - WeChat", processName: "WeChat", processId: 8 };

  assert.equal(ruleMatchesWindow({ titleEquals: "Customer A - WeChat" }, windowInfo), true);
  assert.equal(ruleMatchesWindow({ titleIncludes: ["Customer", "WeChat"] }, windowInfo), true);
  assert.equal(ruleMatchesWindow({ titleIncludes: ["Customer", "Missing"] }, windowInfo), false);
  assert.equal(ruleMatchesWindow({ titleAnyIncludes: ["Missing", "Customer"] }, windowInfo), true);
  assert.equal(ruleMatchesWindow({}, windowInfo), false);
});

test("detects wechat-like windows by process name or title token", () => {
  assert.equal(isWechatLikeWindow({ processName: "WeChat", title: "" }, {}), true);
  assert.equal(isWechatLikeWindow({ processName: "Explorer", title: "客户 - 微信" }, {}), true);
  assert.equal(isWechatLikeWindow({ processName: "Explorer", title: "Folder" }, {}), false);
});

test("runOnce writes a snapshot file without scanning in default mode", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-window-observer-"));
  const result = await runOnce(
    {
      apiBase: "http://127.0.0.1:3200/api",
      inboxDir: dir,
      statusFile: path.join(dir, "status.json"),
      scan: false,
      dryRun: false,
      accounts: [{ wechatAccountId: "wechat_demo_1", processNames: ["WeChat"], titleIncludes: ["Wang"] }],
      conversations: [{ wechatAccountId: "wechat_demo_1", customerId: "customer_demo_1", titleIncludes: ["Wang"] }],
    },
    () => ({ title: "Wang - WeChat", processName: "WeChat", processId: 11 }),
  );

  assert.equal(Boolean(result.snapshotFile), true);
  assert.equal(result.scanResult, null);

  const saved = JSON.parse(fs.readFileSync(result.snapshotFile, "utf8"));
  assert.equal(saved.wechatAccountId, "wechat_demo_1");
  assert.equal(saved.recentCustomerId, "customer_demo_1");
});

test("observer status avoids leaking raw chat title", () => {
  const status = buildObserverStatus(
    {
      snapshot: {
        source: "windows_foreground_observer",
        isOnline: true,
        wechatAccountId: "wechat_demo_1",
        chatTitle: "Sensitive customer title",
        confidence: 0.95,
      },
      snapshotFile: "snapshot.json",
      windowSummary: { processName: "WeChat", processId: 44, hasTitle: true },
    },
    {
      apiBase: "http://127.0.0.1:3200/api",
      inboxDir: "inbox",
      statusFile: "status.json",
      scan: false,
      dryRun: false,
    },
    new Date(Date.now() - 1000).toISOString(),
  );

  assert.equal(status.ok, true);
  assert.equal(status.result.wechatAccountId, "wechat_demo_1");
  assert.equal(JSON.stringify(status).includes("Sensitive customer title"), false);
});

test("writes observer status and clamps numeric options", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-window-status-"));
  const statusFile = path.join(dir, "nested", "status.json");
  writeObserverStatus(statusFile, { ok: true, status: "completed" });

  assert.equal(JSON.parse(fs.readFileSync(statusFile, "utf8")).ok, true);
  assert.equal(numberValue("100000", 3000, 500, 60000), 60000);
  assert.equal(numberValue("bad", 3000, 500, 60000), 3000);
  assert.equal(safeFileSegment("wechat:demo/1"), "wechat_demo_1");
});
