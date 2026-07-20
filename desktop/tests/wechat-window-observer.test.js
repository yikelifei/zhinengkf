"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
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
const { createWechatWindowObserverProofSession } = require("../tools/wechat-window-observer-session");
const { verifyWechatWindowObserverEvidence } = require("../packages/rules/wechatWindowEvidence");

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
      proofToken: "1".repeat(64),
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
  assert.equal(saved.version, "wechat_window_observer_v1");
  assert.match(saved.signature, /^[a-f0-9]{64}$/);
  assert.equal(saved.snapshot.wechatAccountId, "wechat_demo_1");
  assert.equal(saved.snapshot.recentCustomerId, "customer_demo_1");
});

test("running observer reloads a rotated proof file before every signed snapshot", async () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-window-observer-rotation-"));
  const inboxDir = path.join(runtimeDir, "inbox");
  const firstSession = createWechatWindowObserverProofSession(runtimeDir, { token: "2".repeat(64) });
  const config = {
    apiBase: "http://127.0.0.1:3200/api",
    inboxDir,
    statusFile: path.join(runtimeDir, "status.json"),
    proofFile: firstSession.tokenFile,
    scan: false,
    dryRun: false,
    accounts: [{ wechatAccountId: "wechat_demo_1", processNames: ["WeChat"] }],
    conversations: [],
  };
  const capture = () => ({ title: "WeChat", processName: "WeChat", processId: 11 });

  const first = await runOnce(config, capture);
  const firstEvidence = JSON.parse(fs.readFileSync(first.snapshotFile, "utf8"));
  assert.equal(verifyWechatWindowObserverEvidence(firstEvidence, "2".repeat(64)).ok, true);

  createWechatWindowObserverProofSession(runtimeDir, { tokenFile: firstSession.tokenFile, token: "3".repeat(64) });
  const second = await runOnce(config, capture);
  const secondEvidence = JSON.parse(fs.readFileSync(second.snapshotFile, "utf8"));
  assert.equal(verifyWechatWindowObserverEvidence(secondEvidence, "3".repeat(64)).ok, true);
  assert.equal(verifyWechatWindowObserverEvidence(secondEvidence, "2".repeat(64)).ok, false);
});

test("observer scan authenticates its HTTP request with the current scoped proof token", async (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-window-observer-http-auth-"));
  const token = "4".repeat(64);
  let observedHeader = "";
  const server = http.createServer((request, response) => {
    observedHeader = String(request.headers["x-wechat-window-observer-token"] || "");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ scanned: 0, processed: [], failed: [], pending: 0, total: 0, limit: 50 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await runOnce(
    {
      apiBase: `http://127.0.0.1:${server.address().port}/api`,
      inboxDir: path.join(runtimeDir, "inbox"),
      statusFile: path.join(runtimeDir, "status.json"),
      proofToken: token,
      requestTimeoutMs: 1000,
      scan: true,
      dryRun: false,
      accounts: [],
      conversations: [],
    },
    () => ({ title: "WeChat", processName: "WeChat", processId: 11 }),
  );

  assert.equal(observedHeader, token);
  assert.equal(result.scanResult.scanned, 0);
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
