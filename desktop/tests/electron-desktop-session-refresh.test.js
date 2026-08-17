"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createDesktopSessionRefreshWatcher,
  readDesktopSessionProof,
} = require("../apps/electron/desktop-session-refresh");

const PROOF_A = "a".repeat(64);
const PROOF_B = "b".repeat(64);

test("desktop Electron adopts a rotated stable Web session proof exactly once", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-electron-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionFile = path.join(root, "desktop-web-session.json");
  fs.writeFileSync(sessionFile, JSON.stringify({ proof: PROOF_A }), "utf8");
  const applied = [];
  const watcher = createDesktopSessionRefreshWatcher({
    sessionFile,
    initialProof: PROOF_A,
    onProofChange: async (proof) => {
      applied.push(proof);
      return true;
    },
  });
  t.after(() => watcher.stop());

  fs.writeFileSync(sessionFile, JSON.stringify({ proof: PROOF_B }), "utf8");
  assert.equal(await watcher.refresh(), true);
  assert.equal(await watcher.refresh(), false);
  assert.deepEqual(applied, [PROOF_B]);
  assert.equal(watcher.currentProof(), PROOF_B);
});

test("desktop session refresh ignores malformed files and symbolic links", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "smart-kefu-electron-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "target.json");
  const link = path.join(root, "desktop-web-session.json");
  fs.writeFileSync(target, JSON.stringify({ proof: PROOF_B }), "utf8");
  try {
    fs.symlinkSync(target, link, "file");
    assert.equal(readDesktopSessionProof(link), null);
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
  }
  fs.writeFileSync(target, JSON.stringify({ proof: "invalid" }), "utf8");
  assert.equal(readDesktopSessionProof(target), null);
});

test("stable Electron launcher passes only the session file location to the refresh watcher", () => {
  const launcher = fs.readFileSync(path.join(__dirname, "..", "tools", "launch-stable-electron.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "apps", "electron", "main.js"), "utf8");
  assert.match(launcher, /env\[DESKTOP_WEB_SESSION_FILE_ENV\] = sessionFile/);
  assert.match(main, /createDesktopSessionRefreshWatcher/);
  assert.match(main, /installDesktopSessionCookie\(proof\)/);
  assert.match(main, /reloadMainWindowWhenWebReady/);
  assert.match(main, /desktopSessionRefreshWatcher\?\.stop\(\)/);
});
