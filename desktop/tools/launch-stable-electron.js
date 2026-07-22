"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  DESKTOP_WEB_SESSION_PROOF_ENV,
  readDesktopWebSessionProof,
  resolveDesktopWebSessionFile,
  withoutDesktopWebSessionProof,
} = require("./desktop-web-session");

const root = path.resolve(__dirname, "..");
const runtimeDir = process.env.DESKTOP_RUNTIME_DIR
  ? path.resolve(process.env.DESKTOP_RUNTIME_DIR)
  : path.join(root, ".runtime-stable");
const sessionFile = resolveDesktopWebSessionFile(runtimeDir);
const electronEntry = path.join(root, "apps", "electron", "main.js");
const electronPath = require("electron");

if (typeof electronPath !== "string" || !fs.existsSync(electronPath)) {
  throw new Error("Electron runtime was not found");
}
if (!fs.existsSync(electronEntry)) {
  throw new Error(`Electron entry was not found: ${electronEntry}`);
}

const proof = readDesktopWebSessionProof(sessionFile);
const env = withoutDesktopWebSessionProof(process.env);
env[DESKTOP_WEB_SESSION_PROOF_ENV] = proof;
env.WEB_URL = process.env.WEB_URL || "http://127.0.0.1:3100/overview";

const child = spawn(electronPath, [electronEntry], {
  cwd: root,
  env,
  detached: true,
  stdio: "ignore",
  windowsHide: false,
});

child.once("error", (error) => {
  console.error(`[desktop] failed to launch Electron: ${error?.message || error}`);
  process.exitCode = 1;
});
child.once("spawn", () => {
  console.log(`[desktop] Electron started pid=${child.pid}`);
  child.unref();
});
