"use strict";

const { app, BrowserWindow, Notification, WebContentsView, ipcMain, nativeTheme, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { PackagedServiceManager } = require("./packaged-runtime");
const { createDesktopSessionRefreshWatcher } = require("./desktop-session-refresh");
const {
  createZhenxiDesktopDeviceInfo,
  normalizeZhenxiEmbeddedBounds,
  normalizeZhenxiEmbeddedUrl,
  resolveZhenxiDesktopLayout,
} = require("./zhenxi-embedded-view");

const WEB_URL = process.env.WEB_URL || "http://127.0.0.1:3100/overview";
const APP_TITLE = process.env.DESKTOP_APP_TITLE || "智能体客服工作台";
const DESKTOP_SESSION_COOKIE = "smart_kefu_desktop_session";
const DESKTOP_SESSION_PROOF_PATTERN = /^[a-f0-9]{64}$/i;
const DESKTOP_INSTANCE_ID = normalizeDesktopInstanceId(process.env.DESKTOP_INSTANCE_ID);
const DESKTOP_SESSION_PARTITION = DESKTOP_INSTANCE_ID === "default"
  ? "persist:smart-kefu-desktop"
  : `persist:smart-kefu-desktop-${DESKTOP_INSTANCE_ID}`;
const ZHENXI_EMBEDDED_PARTITION = DESKTOP_INSTANCE_ID === "default"
  ? "persist:smart-kefu-zhenxi-ai"
  : `persist:smart-kefu-zhenxi-ai-${DESKTOP_INSTANCE_ID}`;

let mainWindow = null;
let packagedServices = null;
let namedInstanceLockFile = null;
let desktopSessionRefreshWatcher = null;
let zhenxiEmbeddedView = null;
let zhenxiEmbeddedAttached = false;
let zhenxiEmbeddedUrl = "";
let zhenxiEmbeddedLoading = false;
let zhenxiEmbeddedError = "";
let zhenxiEmbeddedLayout = null;
const zhenxiDesktopDevice = createZhenxiDesktopDeviceInfo();
let zhenxiActivation = { checked: false, active: false, reason: "unknown", deviceIdSuffix: zhenxiDesktopDevice.id.slice(-10), errorMessage: "" };
let zhenxiActivationCheckedAt = 0;

function normalizeDesktopInstanceId(value) {
  const normalized = String(value || "default").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(normalized) ? normalized : "default";
}

function acquireNamedInstanceLock() {
  const lockRoot = path.resolve(process.env.DESKTOP_RUNTIME_DIR || app.getPath("userData"));
  const lockFile = path.join(lockRoot, `electron-${DESKTOP_INSTANCE_ID}.lock`);
  fs.mkdirSync(lockRoot, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockFile, "wx", 0o600);
      fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, instanceId: DESKTOP_INSTANCE_ID })}\n`, "utf8");
      fs.closeSync(fd);
      namedInstanceLockFile = lockFile;
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const stat = fs.lstatSync(lockFile);
        if (!stat.isFile() || stat.isSymbolicLink()) return false;
        const existing = JSON.parse(fs.readFileSync(lockFile, "utf8"));
        if (isPidAlive(existing?.pid)) return false;
        fs.rmSync(lockFile, { force: true });
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        return false;
      }
    }
  }
  return false;
}

function releaseNamedInstanceLock() {
  if (!namedInstanceLockFile) return;
  try {
    const payload = JSON.parse(fs.readFileSync(namedInstanceLockFile, "utf8"));
    if (Number(payload?.pid) === process.pid) fs.rmSync(namedInstanceLockFile, { force: true });
  } catch {}
  namedInstanceLockFile = null;
}

function isPidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}

function windowBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#f5f5f7";
}

function startupErrorHtml(message) {
  const recoveryMessage = app.isPackaged
    ? "请查看用户数据目录 logs 下的 packaged-api.log 和 packaged-web.log 后重试。"
    : "请运行项目目录中的 repair-stable-desktop.cmd；修复会在后台完成，无需保持命令窗口打开，然后重新打开桌面端。";
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
      partition: DESKTOP_SESSION_PARTITION,
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
    destroyZhenxiEmbeddedView();
    mainWindow = null;
  });
}

function ensureZhenxiEmbeddedView() {
  if (zhenxiEmbeddedView && !zhenxiEmbeddedView.webContents.isDestroyed()) return zhenxiEmbeddedView;
  const view = new WebContentsView({
    webPreferences: {
      partition: ZHENXI_EMBEDDED_PARTITION,
      preload: path.join(__dirname, "zhenxi-embedded-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: [
        `--art-device-id=${encodeURIComponent(zhenxiDesktopDevice.id)}`,
        `--art-device-label=${encodeURIComponent(zhenxiDesktopDevice.label)}`,
      ],
    },
  });
  view.setBackgroundColor(windowBackgroundColor());
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event, url) => {
    if (!normalizeZhenxiEmbeddedUrl(url)) event.preventDefault();
  });
  view.webContents.on("did-start-loading", () => {
    zhenxiEmbeddedLoading = true;
    zhenxiEmbeddedError = "";
  });
  view.webContents.on("did-stop-loading", () => {
    zhenxiEmbeddedLoading = false;
  });
  view.webContents.on("did-finish-load", () => {
    if (zhenxiEmbeddedLayout) applyZhenxiDesktopLayout(view, zhenxiEmbeddedLayout.bounds);
  });
  view.webContents.on("did-fail-load", (_event, code, description, validatedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    zhenxiEmbeddedLoading = false;
    zhenxiEmbeddedError = `${description || "臻希 AI 页面加载失败"} (${code})`;
    if (validatedUrl && !zhenxiEmbeddedUrl) zhenxiEmbeddedUrl = String(validatedUrl);
  });
  zhenxiEmbeddedView = view;
  return view;
}

function attachZhenxiEmbeddedView() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const view = ensureZhenxiEmbeddedView();
  if (!zhenxiEmbeddedAttached) {
    mainWindow.contentView.addChildView(view);
    zhenxiEmbeddedAttached = true;
  }
  return true;
}

function hideZhenxiEmbeddedView() {
  if (!mainWindow || mainWindow.isDestroyed() || !zhenxiEmbeddedView || !zhenxiEmbeddedAttached) return;
  try {
    mainWindow.contentView.removeChildView(zhenxiEmbeddedView);
  } catch {}
  zhenxiEmbeddedAttached = false;
}

function destroyZhenxiEmbeddedView() {
  hideZhenxiEmbeddedView();
  try {
    zhenxiEmbeddedView?.webContents.close();
  } catch {}
  zhenxiEmbeddedView = null;
  zhenxiEmbeddedUrl = "";
  zhenxiEmbeddedLoading = false;
  zhenxiEmbeddedError = "";
  zhenxiEmbeddedLayout = null;
  zhenxiActivation = { checked: false, active: false, reason: "unknown", deviceIdSuffix: zhenxiDesktopDevice.id.slice(-10), errorMessage: "" };
  zhenxiActivationCheckedAt = 0;
}

function zhenxiEmbeddedStatus() {
  return {
    ok: Boolean(zhenxiEmbeddedView && !zhenxiEmbeddedView.webContents.isDestroyed()),
    attached: zhenxiEmbeddedAttached,
    loading: zhenxiEmbeddedLoading,
    url: zhenxiEmbeddedUrl,
    errorMessage: zhenxiEmbeddedError,
    layout: zhenxiEmbeddedLayout
      ? {
          mode: "desktop",
          zoomFactor: zhenxiEmbeddedLayout.zoomFactor,
          logicalViewportWidth: zhenxiEmbeddedLayout.logicalViewportWidth,
        }
      : { mode: "desktop", zoomFactor: 1, logicalViewportWidth: 1440 },
    activation: { ...zhenxiActivation },
  };
}

function applyZhenxiDesktopLayout(view, bounds) {
  const layout = resolveZhenxiDesktopLayout(bounds);
  if (!layout) return false;
  zhenxiEmbeddedLayout = layout;
  view.setBounds(layout.bounds);
  view.webContents.setZoomFactor(layout.zoomFactor);
  return true;
}

async function discoverZhenxiReleaseDesktop() {
  const origins = Array.from({ length: 10 }, (_value, index) => `http://127.0.0.1:${31870 + index}`);
  const results = await Promise.all(origins.map((origin) => probeZhenxiReleaseDesktop(origin)));
  const available = results.find((result) => result.ok);
  return {
    ok: Boolean(available),
    url: available?.url || "",
    checkedCount: origins.length,
  };
}

async function probeZhenxiReleaseDesktop(origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(new URL("/api/health", origin), {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, url: origin };
    const payload = await response.json();
    const data = payload && typeof payload === "object" && payload.data && typeof payload.data === "object" ? payload.data : payload;
    const healthy = data?.service === "zhenxi-ai" && (data?.status === "ok" || data?.ok === true);
    return { ok: healthy, url: healthy ? origin : "" };
  } catch {
    return { ok: false, url: "" };
  } finally {
    clearTimeout(timer);
  }
}

async function refreshZhenxiActivation(force = false) {
  const normalizedUrl = normalizeZhenxiEmbeddedUrl(zhenxiEmbeddedUrl);
  if (!normalizedUrl) return zhenxiEmbeddedStatus();
  if (!force && zhenxiActivationCheckedAt && Date.now() - zhenxiActivationCheckedAt < 10_000) {
    return zhenxiEmbeddedStatus();
  }
  zhenxiActivationCheckedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const endpoint = new URL("/api/activation/status", normalizedUrl);
    const response = await fetch(endpoint, {
      headers: { "x-art-device-id": zhenxiDesktopDevice.id },
      redirect: "error",
      signal: controller.signal,
    });
    const payload = await response.json();
    const data = payload && typeof payload === "object" && payload.data && typeof payload.data === "object" ? payload.data : {};
    zhenxiActivation = {
      checked: response.ok && payload?.ok === true,
      active: data.active === true,
      reason: typeof data.reason === "string" ? data.reason : response.ok ? "unknown" : `http_${response.status}`,
      deviceIdSuffix: typeof data.deviceIdSuffix === "string" && data.deviceIdSuffix ? data.deviceIdSuffix : zhenxiDesktopDevice.id.slice(-10),
      errorMessage: response.ok ? "" : `HTTP ${response.status}`,
    };
  } catch (error) {
    zhenxiActivation = {
      ...zhenxiActivation,
      checked: false,
      active: false,
      reason: "status_unavailable",
      errorMessage: error instanceof Error ? error.message : "activation status unavailable",
    };
  } finally {
    clearTimeout(timer);
  }
  return zhenxiEmbeddedStatus();
}

function assertTrustedMainWindowSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error("DESKTOP_EMBEDDED_UNTRUSTED_SENDER");
  }
}

async function startApplication() {
  let webSessionProof = String(process.env.DESKTOP_WEB_SESSION_PROOF || "").trim();
  if (app.isPackaged) {
    packagedServices = new PackagedServiceManager({
      executablePath: process.execPath,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      userDataPath: app.getPath("userData"),
    });
    await packagedServices.start();
    webSessionProof = packagedServices.webSessionProof;
  }
  await installDesktopSessionCookie(webSessionProof);
  createMainWindow();
  startDesktopSessionRefreshWatcher(webSessionProof);
}

async function installDesktopSessionCookie(proof) {
  const value = String(proof || "").trim();
  if (!DESKTOP_SESSION_PROOF_PATTERN.test(value)) return false;
  const target = new URL(WEB_URL);
  const hostname = target.hostname.toLowerCase();
  if (target.protocol !== "http:" && target.protocol !== "https:") return false;
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]" && hostname !== "::1") {
    return false;
  }
  await session.fromPartition(DESKTOP_SESSION_PARTITION).cookies.set({
    url: target.origin,
    name: DESKTOP_SESSION_COOKIE,
    value,
    path: "/api",
    httpOnly: true,
    sameSite: "strict",
    secure: target.protocol === "https:",
  });
  return true;
}

function startDesktopSessionRefreshWatcher(initialProof) {
  if (app.isPackaged || desktopSessionRefreshWatcher) return;
  const sessionFile = String(process.env.DESKTOP_WEB_SESSION_FILE || "").trim();
  if (!sessionFile) return;
  desktopSessionRefreshWatcher = createDesktopSessionRefreshWatcher({
    sessionFile,
    initialProof,
    onProofChange: async (proof) => {
      if (!await installDesktopSessionCookie(proof)) return false;
      await reloadMainWindowWhenWebReady();
      return true;
    },
  });
}

async function reloadMainWindowWhenWebReady() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    try {
      const response = await fetch(WEB_URL, { cache: "no-store", redirect: "manual" });
      if (response.status >= 200 && response.status < 400) {
        await mainWindow.loadURL(WEB_URL);
        return true;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

const ownsSingleInstance = DESKTOP_INSTANCE_ID === "default"
  ? app.requestSingleInstanceLock()
  : acquireNamedInstanceLock();
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
  desktopSessionRefreshWatcher?.stop();
  desktopSessionRefreshWatcher = null;
  releaseNamedInstanceLock();
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

ipcMain.handle("zhenxi-embedded:open", async (event, payload) => {
  assertTrustedMainWindowSender(event);
  const url = normalizeZhenxiEmbeddedUrl(payload?.url);
  const bounds = normalizeZhenxiEmbeddedBounds(payload?.bounds);
  if (!url) return { ...zhenxiEmbeddedStatus(), ok: false, errorMessage: "不允许加载此臻希 AI 地址。" };
  if (!bounds) return { ...zhenxiEmbeddedStatus(), ok: false, errorMessage: "臻希 AI 内嵌区域尺寸无效。" };
  if (!attachZhenxiEmbeddedView()) return { ...zhenxiEmbeddedStatus(), ok: false, errorMessage: "客服主窗口当前不可用。" };
  applyZhenxiDesktopLayout(zhenxiEmbeddedView, bounds);
  if (zhenxiEmbeddedUrl !== url || zhenxiEmbeddedView.webContents.getURL() !== url) {
    zhenxiEmbeddedUrl = url;
    zhenxiEmbeddedLoading = true;
    zhenxiEmbeddedError = "";
    try {
      await zhenxiEmbeddedView.webContents.loadURL(url);
    } catch (error) {
      zhenxiEmbeddedLoading = false;
      zhenxiEmbeddedError = error instanceof Error ? error.message : "臻希 AI 页面加载失败。";
    }
  }
  return refreshZhenxiActivation(true);
});

ipcMain.handle("zhenxi-embedded:discover-desktop", async (event) => {
  assertTrustedMainWindowSender(event);
  return discoverZhenxiReleaseDesktop();
});

ipcMain.handle("zhenxi-embedded:set-bounds", async (event, payload) => {
  assertTrustedMainWindowSender(event);
  const bounds = normalizeZhenxiEmbeddedBounds(payload);
  if (!bounds || !zhenxiEmbeddedView || !zhenxiEmbeddedAttached) return zhenxiEmbeddedStatus();
  applyZhenxiDesktopLayout(zhenxiEmbeddedView, bounds);
  return zhenxiEmbeddedStatus();
});

ipcMain.handle("zhenxi-embedded:reload", async (event) => {
  assertTrustedMainWindowSender(event);
  if (!zhenxiEmbeddedView || zhenxiEmbeddedView.webContents.isDestroyed()) return zhenxiEmbeddedStatus();
  zhenxiEmbeddedError = "";
  zhenxiEmbeddedView.webContents.reload();
  return refreshZhenxiActivation(true);
});

ipcMain.handle("zhenxi-embedded:status", async (event) => {
  assertTrustedMainWindowSender(event);
  return refreshZhenxiActivation(false);
});

ipcMain.handle("zhenxi-embedded:hide", async (event) => {
  assertTrustedMainWindowSender(event);
  hideZhenxiEmbeddedView();
  return zhenxiEmbeddedStatus();
});
