"use strict";

const { app, BrowserWindow, Notification, ipcMain, nativeTheme } = require("electron");
const path = require("node:path");
const { PackagedServiceManager } = require("./packaged-runtime");

const WEB_URL = process.env.WEB_URL || "http://127.0.0.1:3100/overview";
const APP_TITLE = "智能体客服工作台";

let mainWindow = null;
let packagedServices = null;

function windowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#f5f5f7";
}

function startupErrorHtml(message) {
  const recoveryMessage = app.isPackaged
    ? "请查看用户数据目录 logs 下的 packaged-api.log 和 packaged-web.log 后重试。"
    : "请先运行项目目录中的 repair-stable-desktop.cmd，并保持服务窗口打开，再重新打开桌面端。";
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>${APP_TITLE}</title></head>
<body style="font-family:Segoe UI,Microsoft YaHei,sans-serif;padding:32px;background:#f5f5f7;color:#1d1d1f">
  <h2>${APP_TITLE} 启动失败</h2>
  <p>无法打开 ${escapeHtml(WEB_URL)}</p>
  <pre style="white-space:pre-wrap;background:#fff;border:1px solid #d2d2d7;border-radius:8px;padding:16px">${escapeHtml(message)}</pre>
  <p>${recoveryMessage}</p>
</body></html>`,
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

async function startApplication() {
  if (app.isPackaged) {
    packagedServices = new PackagedServiceManager({
      executablePath: process.execPath,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      userDataPath: app.getPath("userData"),
    });
    await packagedServices.start();
  }
  createMainWindow();
}

const ownsSingleInstance = app.requestSingleInstanceLock();
if (!ownsSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(startApplication).catch((error) => {
    console.error("[desktop] packaged services failed", error);
    createMainWindow();
    if (mainWindow) mainWindow.loadURL(startupErrorHtml(error?.message || error || "unknown error"));
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}

app.on("before-quit", () => {
  packagedServices?.stop();
  packagedServices = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

nativeTheme.on("updated", () => {
  if (mainWindow) mainWindow.setBackgroundColor(windowBackgroundColor());
});

ipcMain.handle("notify", async (_event, payload) => {
  const title = String(payload?.title || "智能客服提醒");
  const body = String(payload?.body || "");
  if (Notification.isSupported()) new Notification({ title, body }).show();
  return { ok: true };
});
