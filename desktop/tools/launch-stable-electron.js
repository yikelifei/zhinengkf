"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  DESKTOP_WEB_SESSION_FILE_ENV,
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
const electronOutLog = path.join(runtimeDir, "electron-launch.out.log");
const electronErrLog = path.join(runtimeDir, "electron-launch.err.log");

if (typeof electronPath !== "string" || !fs.existsSync(electronPath)) {
  throw new Error("Electron runtime was not found");
}
if (!fs.existsSync(electronEntry)) {
  throw new Error(`Electron entry was not found: ${electronEntry}`);
}

const proof = readDesktopWebSessionProof(sessionFile);
const env = withoutDesktopWebSessionProof(process.env);
env[DESKTOP_WEB_SESSION_PROOF_ENV] = proof;
env[DESKTOP_WEB_SESSION_FILE_ENV] = sessionFile;
const requestedWebUrl = process.env.WEB_URL || "http://127.0.0.1:3100/overview";
env.WEB_URL = requestedWebUrl;
const requestedInstanceId = String(process.env.DESKTOP_INSTANCE_ID || "default").trim().toLowerCase();
const instanceId = /^[a-z0-9][a-z0-9-]{0,31}$/.test(requestedInstanceId)
  ? requestedInstanceId
  : "default";
env.DESKTOP_INSTANCE_ID = instanceId;
env.DESKTOP_RUNTIME_DIR = runtimeDir;
const electronArgs = [
  "--no-sandbox",
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--disable-gpu-sandbox",
  "--disable-accelerated-2d-canvas",
  "--disable-accelerated-video-decode",
  "--disable-zero-copy",
  "--in-process-gpu",
  "--disable-crash-reporter",
];
const profileId = `${instanceId}-v2`;
const userDataDir = path.join(runtimeDir, "electron-user-data", profileId);
fs.mkdirSync(userDataDir, { recursive: true });
electronArgs.push(`--user-data-dir=${userDataDir}`);
electronArgs.push(electronEntry, `--smart-kefu-web-url=${requestedWebUrl}`);

const stdout = fs.openSync(electronOutLog, "a");
const stderr = fs.openSync(electronErrLog, "a");
let launchConfirmed = false;
let stdioClosed = false;
const child = spawn(electronPath, electronArgs, {
  cwd: root,
  env,
  detached: false,
  stdio: ["ignore", stdout, stderr],
  windowsHide: false,
});

function closeStdio() {
  if (stdioClosed) return;
  stdioClosed = true;
  for (const fd of [stdout, stderr]) {
    try {
      fs.closeSync(fd);
    } catch {}
  }
}

child.once("error", (error) => {
  closeStdio();
  console.error(`[desktop] failed to launch Electron: ${error?.message || error}`);
  process.exitCode = 1;
});
child.once("spawn", () => {
  console.log(`[desktop] Electron started pid=${child.pid}`);
  setTimeout(() => {
    launchConfirmed = true;
    closeStdio();
  }, 3_000).unref();
});
child.once("exit", (code, signal) => {
  closeStdio();
  if (launchConfirmed) return;
  if (code === 0 && !signal) {
    launchConfirmed = true;
    console.log("[desktop] Electron handed off to an existing single-instance window");
    return;
  }
  console.error(`[desktop] Electron exited before the window stayed open code=${code ?? ""} signal=${signal ?? ""}`);
  console.error(`[desktop] Electron stderr log: ${electronErrLog}`);
  process.exitCode = 1;
});
