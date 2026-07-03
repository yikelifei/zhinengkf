"use strict";

const { app, BrowserWindow, Notification, ipcMain, nativeTheme } = require("electron");
const path = require("node:path");

const WEB_URL = process.env.WEB_URL || "http://127.0.0.1:3100";
const APP_TITLE = "智能体客服工作台";

let mainWindow = null;

function windowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#f5f5f7";
}

function startupErrorHtml(message) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${APP_TITLE}</title>
</head>
<body style="font-family:Segoe UI,Microsoft YaHei,sans-serif;padding:32px;background:#f5f5f7;color:#1d1d1f">
  <h2>${APP_TITLE} 启动失败</h2>
  <p>无法打开 ${escapeHtml(WEB_URL)}</p>
  <pre style="white-space:pre-wrap;background:#fff;border:1px solid #d2d2d7;border-radius:8px;padding:16px">${escapeHtml(message)}</pre>
  <p>请先运行 start-stable-desktop.cmd，再重新打开桌面端。</p>
</body>
</html>`,
  )}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    title: APP_TITLE,
    backgroundColor: windowBackgroundColor(),
    autoHideMenuBar: true,
    show: false,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 18, y: 18 },
          vibrancy: "sidebar",
          visualEffectState: "active",
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(WEB_URL).catch((error) => {
    if (!mainWindow) return;
    mainWindow.loadURL(startupErrorHtml(error?.message || error || "unknown error"));
  });
  mainWindow.once("ready-to-show", () => {
    if (mainWindow) mainWindow.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

nativeTheme.on("updated", () => {
  if (mainWindow) mainWindow.setBackgroundColor(windowBackgroundColor());
});

ipcMain.handle("notify", async (_event, payload) => {
  const title = String(payload?.title || "智能体客服提醒");
  const body = String(payload?.body || "");
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
  return { ok: true };
});
