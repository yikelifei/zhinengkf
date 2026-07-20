"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createWechatWindowObserverEvidence,
  verifyWechatWindowObserverEvidence,
} = require("../packages/rules/wechatWindowEvidence");
const { validateSendGuard } = require("../packages/rules/sendGuard");
const {
  createWechatWindowObserverProofSession,
  readWechatWindowObserverProofToken,
  wechatWindowObserverServiceEnv,
} = require("../tools/wechat-window-observer-session");

const token = "7".repeat(64);
const now = "2026-07-20T08:00:10.000Z";
const snapshot = {
  source: "browser_claim_is_ignored",
  isOnline: true,
  wechatAccountId: "wechat-1",
  accountDisplayName: "service-1",
  windowHandle: "12345",
  processId: 987,
  chatTitle: "customer-1-chat",
  activeChatTitle: "customer-1-chat",
  externalChatId: "external-1",
  recentCustomerId: "customer-1",
  recentMessageText: "hello",
  confidence: 0.95,
  capturedAt: "2026-07-20T08:00:00.000Z",
  raw: { processName: "WeChat" },
};

test("observer HMAC authenticates all send-guard fields and canonicalizes source", () => {
  const envelope = createWechatWindowObserverEvidence(snapshot, token, {
    issuedAt: snapshot.capturedAt,
    nonce: "1".repeat(48),
  });
  const verified = verifyWechatWindowObserverEvidence(envelope, token, { now, maxAgeSeconds: 30 });

  assert.equal(verified.ok, true);
  assert.equal(verified.snapshot.source, "windows_foreground_observer");
  assert.equal(verified.snapshot.wechatAccountId, "wechat-1");
  assert.match(verified.evidence.nonceHash, /^[a-f0-9]{64}$/);

  for (const [field, value] of [
    ["wechatAccountId", "attacker-account"],
    ["chatTitle", "attacker-chat"],
    ["recentCustomerId", "attacker-customer"],
    ["capturedAt", "2026-07-20T08:00:09.000Z"],
    ["confidence", 1],
  ]) {
    const tampered = { ...envelope, snapshot: { ...envelope.snapshot, [field]: value } };
    assert.equal(verifyWechatWindowObserverEvidence(tampered, token, { now, maxAgeSeconds: 30 }).ok, false, field);
  }
});

test("observer evidence rejects wrong token, expiry, future timestamps and malformed signature", () => {
  const envelope = createWechatWindowObserverEvidence(snapshot, token, {
    issuedAt: snapshot.capturedAt,
    nonce: "2".repeat(48),
  });

  assert.equal(verifyWechatWindowObserverEvidence(envelope, "8".repeat(64), { now }).reason, "signature_mismatch");
  assert.equal(
    verifyWechatWindowObserverEvidence(envelope, token, { now: "2026-07-20T08:01:00.000Z", maxAgeSeconds: 30 }).reason,
    "expired_evidence",
  );
  assert.equal(
    verifyWechatWindowObserverEvidence(envelope, token, { now: "2026-07-20T07:59:00.000Z", maxFutureSkewSeconds: 5 }).reason,
    "future_timestamp",
  );
  assert.equal(verifyWechatWindowObserverEvidence({ ...envelope, signature: "bad" }, token, { now }).reason, "invalid_signature");
});

test("send guard blocks demo/manual evidence and accepts only verified observer marker", () => {
  const base = {
    task: { id: "send-1", wechatAccountId: "wechat-1" },
    account: { id: "wechat-1" },
    conversation: { id: "conversation-1", title: "customer-1-chat", customerId: "customer-1" },
    customer: { id: "customer-1" },
    accountQueueTaskIds: ["send-1"],
  };
  const identity = {
    wechatAccountId: "wechat-1",
    chatTitle: "customer-1-chat",
    recentCustomerId: "customer-1",
    capturedAt: snapshot.capturedAt,
  };

  for (const source of ["demo", "manual", "window_snapshot_inbox"]) {
    const result = validateSendGuard({ ...base, activeWindow: { ...identity, source }, now: new Date(now) });
    assert.equal(result.ok, false, source);
    assert.equal(result.failedKeys.includes("verifiedObserverEvidence"), true, source);
  }

  const trusted = validateSendGuard({
    ...base,
    activeWindow: {
      ...identity,
      source: "windows_foreground_observer",
      diagnostic: {
        observerEvidence: {
          verified: true,
          version: "wechat_window_observer_v1",
          nonceHash: "a".repeat(64),
        },
      },
    },
    now: new Date(now),
  });
  assert.equal(trusted.ok, true);
});

test("observer proof session is random, file-backed and scoped away from web and other workers", () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-observer-session-"));
  const session = createWechatWindowObserverProofSession(runtimeDir);
  assert.match(session.token, /^[a-f0-9]{64}$/);
  assert.equal(readWechatWindowObserverProofToken(session.tokenFile), session.token);

  const apiEnv = wechatWindowObserverServiceEnv({ PUBLIC_VALUE: "ok" }, "api", session.tokenFile);
  const observerEnv = wechatWindowObserverServiceEnv({}, "wechat-window-observer", session.tokenFile);
  const webEnv = wechatWindowObserverServiceEnv({ WECHAT_WINDOW_OBSERVER_PROOF_FILE: session.tokenFile }, "web", session.tokenFile);
  const workerEnv = wechatWindowObserverServiceEnv({ WECHAT_WINDOW_OBSERVER_PROOF_FILE: session.tokenFile }, "wechat-bridge-worker", session.tokenFile);
  assert.equal(apiEnv.WECHAT_WINDOW_OBSERVER_PROOF_FILE, session.tokenFile);
  assert.equal(observerEnv.WECHAT_WINDOW_OBSERVER_PROOF_FILE, session.tokenFile);
  assert.equal(webEnv.WECHAT_WINDOW_OBSERVER_PROOF_FILE, undefined);
  assert.equal(workerEnv.WECHAT_WINDOW_OBSERVER_PROOF_FILE, undefined);
  assert.equal(JSON.stringify(apiEnv).includes(session.token), false);
});

test("observer proof session rotates an existing key without leaving temp or backup files", () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-observer-rotate-"));
  const first = createWechatWindowObserverProofSession(runtimeDir, { token: "3".repeat(64) });
  const second = createWechatWindowObserverProofSession(runtimeDir, {
    tokenFile: first.tokenFile,
    token: "4".repeat(64),
  });

  assert.equal(second.tokenFile, first.tokenFile);
  assert.equal(readWechatWindowObserverProofToken(second.tokenFile), "4".repeat(64));
  assert.deepEqual(fs.readdirSync(runtimeDir), [path.basename(second.tokenFile)]);
});

test("snapshot routes and launchers keep the observer proof fail-closed and non-browser-writable", () => {
  const root = path.resolve(__dirname, "..");
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
  const controller = read("apps/api/src/wechat/wechat.controller.ts");
  const service = read("apps/api/src/wechat/wechat-dispatch.service.ts");
  const observer = read("tools/wechat-window-observer.js");

  assert.doesNotMatch(controller, /@Post\("window-snapshots"\)/);
  assert.match(controller, /@Post\("window-snapshots\/inbox\/scan"\)/);
  assert.match(service, /verifyWechatWindowObserverEvidence/);
  assert.match(service, /claimJsonInboxFile/);
  assert.match(service, /observer evidence replay rejected/);
  assert.match(service, /trustedObserverSnapshot/);
  assert.doesNotMatch(service, /source:\s*"window_snapshot_inbox"/);
  assert.match(observer, /createWechatWindowObserverEvidence/);

  for (const relative of [
    "tools/start-dev-ports.js",
    "tools/ports-stack-starter.js",
    "tools/desktop-service-supervisor.js",
    "tools/stable-runtime-launcher.js",
    "tools/start-wechat-safe-workers.js",
    "tools/run-product-acceptance.js",
  ]) {
    assert.match(read(relative), /WECHAT_WINDOW_OBSERVER_PROOF_FILE|WechatWindowObserverProofSession|wechatWindowObserverServiceEnv/, relative);
  }
});
