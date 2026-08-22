"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyZhenxiSharedSessionRequestHeaders,
  isZhenxiSessionMutationUrl,
  publicZhenxiSharedSessionStatus,
  readZhenxiSharedSession,
  resolveZhenxiSharedSessionFiles,
  stripZhenxiAuthCookies,
} = require("../apps/electron/zhenxi-shared-session");

test("shared session resolver prefers the explicitly configured Zhenxi session file", () => {
  const files = resolveZhenxiSharedSessionFiles({
    sessionFile: "E:\\controlled\\external-active-user.json",
    appData: "C:\\Users\\artist\\AppData\\Roaming",
  });
  assert.equal(files[0], path.resolve("E:\\controlled\\external-active-user.json"));
  assert.equal(files.length, 1);
});

test("shared session reader accepts a current external desktop session without exposing it publicly", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-zhenxi-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionFile = path.join(root, "external-active-user.json");
  fs.writeFileSync(sessionFile, JSON.stringify({
    userId: "user-1",
    accessToken: "header.payload.signature",
    deviceId: "desktop-shared-device",
    updatedAt: "2026-08-20T01:00:00.000Z",
  }));

  const shared = readZhenxiSharedSession({
    sessionFile,
    appData: "",
    now: Date.parse("2026-08-20T01:01:00.000Z"),
  });
  assert.equal(shared.authenticated, true);
  assert.equal(shared.accessToken, "header.payload.signature");
  assert.equal(shared.deviceId, "desktop-shared-device");
  assert.deepEqual(publicZhenxiSharedSessionStatus(shared), {
    checked: true,
    authenticated: true,
    source: "external-zhenxi-desktop",
    updatedAt: "2026-08-20T01:00:00.000Z",
    deviceIdSuffix: "red-device",
    errorMessage: "",
  });
  assert.equal("accessToken" in publicZhenxiSharedSessionStatus(shared), false);
});

test("shared session reader rejects stale, malformed, and missing external sessions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-zhenxi-stale-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionFile = path.join(root, "external-active-user.json");
  fs.writeFileSync(sessionFile, JSON.stringify({
    userId: "user-1",
    accessToken: "token with spaces",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }));
  assert.equal(readZhenxiSharedSession({ sessionFile, appData: "", now: Date.parse("2026-08-20T00:00:00.000Z") }).authenticated, false);
  assert.equal(readZhenxiSharedSession({ sessionFile: path.join(root, "missing.json"), appData: "" }).authenticated, false);
});

test("request policy strips embedded auth cookies and injects only the current external token", () => {
  assert.equal(
    stripZhenxiAuthCookies("theme=dark; art_access_token=old; art_refresh_token=old-refresh; locale=zh"),
    "theme=dark; locale=zh",
  );
  const headers = applyZhenxiSharedSessionRequestHeaders({
    Cookie: "theme=dark; art_access_token=old",
    authorization: "Bearer embedded-token",
  }, {
    authenticated: true,
    accessToken: "external.token.signature",
    deviceId: "desktop-shared-device",
  });
  assert.equal(headers.Cookie, "theme=dark");
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.Authorization, "Bearer external.token.signature");
  assert.equal(headers["x-art-device-id"], "desktop-shared-device");

  const loggedOut = applyZhenxiSharedSessionRequestHeaders({ Cookie: "art_access_token=old" }, { authenticated: false });
  assert.equal(loggedOut.Cookie, undefined);
  assert.equal(loggedOut.Authorization, undefined);
});

test("embedded session policy blocks creation of a second login session", () => {
  assert.equal(isZhenxiSessionMutationUrl("http://127.0.0.1:31871/api/auth/login"), true);
  assert.equal(isZhenxiSessionMutationUrl("http://127.0.0.1:31871/api/auth/refresh"), true);
  assert.equal(isZhenxiSessionMutationUrl("http://127.0.0.1:31871/api/auth/logout"), true);
  assert.equal(isZhenxiSessionMutationUrl("http://127.0.0.1:31871/api/auth/session"), false);
  assert.equal(isZhenxiSessionMutationUrl("http://127.0.0.1:31871/api/projects"), false);
});
