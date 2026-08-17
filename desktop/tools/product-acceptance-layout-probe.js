"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const webUrl = String(process.env.RESPONSIVE_QA_WEB_URL || process.env.ACCEPTANCE_WEB_URL || "").trim();
const outputPath = path.resolve(
  process.env.RESPONSIVE_QA_PROBE_OUTPUT
    || process.env.ACCEPTANCE_LAYOUT_OUTPUT
    || path.join(process.cwd(), ".runtime", "responsive-qa", "electron-probe.json"),
);
const screenshotDir = path.resolve(
  process.env.RESPONSIVE_QA_SCREENSHOT_DIR
    || path.dirname(process.env.ACCEPTANCE_LAYOUT_SCREENSHOT || outputPath),
);
const viewports = [
  { name: "desktop-1536", width: 1536, height: 960, mobile: false },
  { name: "mobile-390", width: 390, height: 844, mobile: true },
];
const desktopSessionProof = String(process.env.DESKTOP_WEB_SESSION_PROOF || "").trim();
const userDataPath = path.resolve(process.env.RESPONSIVE_QA_USER_DATA_PATH || path.join(path.dirname(outputPath), "electron-user-data"));
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  status: "blocked",
  passed: false,
  renderer: "Electron Chromium",
  url: webUrl,
  title: "",
  viewports: [],
  blockers: [],
  failures: [],
  consoleErrors: [],
};

fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });
app.setPath("userData", userDataPath);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

writeProbe();
app.whenReady().then(run).catch(block);

async function run() {
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?/i.test(webUrl)) {
    throw new Error("RESPONSIVE_QA_WEB_URL must be an explicit loopback HTTP URL");
  }

  for (const viewport of viewports) {
    const result = await inspectViewport(viewport);
    report.viewports.push(result);
    report.consoleErrors.push(...result.consoleErrors.map((message) => `${viewport.name}: ${message}`));
    report.failures.push(...result.failures.map((name) => `${viewport.name}: ${name}`));
    report.title ||= result.title;
    writeProbe();
  }

  report.status = report.failures.length === 0 ? "passed" : "failed";
  report.passed = report.status === "passed";
  report.finishedAt = new Date().toISOString();
  writeProbe();
  app.exit(report.passed ? 0 : 1);
}

async function inspectViewport(spec) {
  const consoleErrors = [];
  let rendererGone = null;
  const browserWindow = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    useContentSize: true,
    show: false,
    backgroundColor: "#f7f8fa",
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  browserWindow.webContents.on("console-message", (...args) => {
    const event = args[0];
    const level = typeof event === "object" && event ? event.level : args[1];
    const message = typeof event === "object" && event ? event.message : args[2];
    if (level === "error" || level === 3) consoleErrors.push(String(message || "unknown console error"));
  });
  browserWindow.webContents.on("render-process-gone", (_event, details) => {
    rendererGone = `renderer exited: ${details.reason}`;
  });

  try {
    await installDesktopSessionCookie(browserWindow, webUrl);
    await loadUrlWithRetry(browserWindow, webUrl, spec.name);
    await waitFor(
      browserWindow,
      `document.querySelector('main') && document.querySelector('[data-route-id]') && document.body.innerText.trim().length > 100`,
      60_000,
    );
    await delay(500);

    const interaction = spec.mobile
      ? await runMobileNavigationInteraction(browserWindow)
      : await runDesktopNavigationInteraction(browserWindow);
    await waitFor(
      browserWindow,
      `location.pathname === '/send/queue' && document.querySelector('[data-route-id="sendQueue"]')`,
      30_000,
    );
    await delay(700);

    const inspection = await browserWindow.webContents.executeJavaScript(`(() => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const root = document.documentElement;
      const body = document.body;
      const main = document.querySelector('main');
      const pane = document.querySelector('[data-route-id="sendQueue"]');
      const desktopNavigation = document.querySelector('#workbench-desktop-navigation');
      const mobileNavigation = Array.from(document.querySelectorAll('nav')).find((item) => item.querySelector('button[aria-controls="workbench-mobile-navigation"]'));
      const activeDesktopLink = document.querySelector('a[data-section-id="send-center"][aria-current="page"]');
      const mobileTrigger = document.querySelector('button[aria-controls="workbench-mobile-navigation"]');
      const mainRect = main?.getBoundingClientRect();
      const paneRect = pane?.getBoundingClientRect();
      const desktopRect = desktopNavigation?.getBoundingClientRect();
      const mobileRect = mobileNavigation?.getBoundingClientRect();
      const triggerRect = mobileTrigger?.getBoundingClientRect();
      const mainStyle = main ? getComputedStyle(main) : null;
      const frameworkOverlay = Boolean(document.querySelector('[data-nextjs-toast], nextjs-portal [data-nextjs-error-overlay]'));
      const visible = (rect) => Boolean(rect && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < viewport.width && rect.bottom > 0 && rect.top < viewport.height);
      const mobile = ${spec.mobile ? "true" : "false"};
      const navigationAvailable = mobile
        ? visible(mobileRect) && visible(triggerRect) && getComputedStyle(mobileNavigation).display !== 'none'
        : visible(desktopRect) && visible(activeDesktopLink?.getBoundingClientRect()) && getComputedStyle(desktopNavigation).display !== 'none';
      const bottomPadding = mainStyle ? Number.parseFloat(mainStyle.paddingBottom) || 0 : 0;
      const checks = {
        exactViewport: viewport.width === ${spec.width} && viewport.height === ${spec.height},
        pageHasContent: body.innerText.trim().length > 100,
        noFrameworkErrorOverlay: !frameworkOverlay && !/Application error|Unhandled Runtime Error/i.test(body.innerText),
        noPageHorizontalOverflow: root.scrollWidth <= root.clientWidth + 1 && body.scrollWidth <= body.clientWidth + 1,
        navigationAvailable,
        primaryPaneVisible: visible(mainRect) && visible(paneRect),
        interactionReachable: location.pathname === '/send/queue' && pane?.getAttribute('data-route-id') === 'sendQueue',
        mobileNavigationDoesNotCoverContent: !mobile || bottomPadding + 2 >= (mobileRect?.height || 0),
      };
      return {
        url: location.href,
        title: document.title,
        viewport,
        documentMetrics: {
          clientWidth: root.clientWidth,
          scrollWidth: root.scrollWidth,
          bodyClientWidth: body.clientWidth,
          bodyScrollWidth: body.scrollWidth,
          mainClientWidth: main?.clientWidth || 0,
          mainScrollWidth: main?.scrollWidth || 0,
        },
        navigation: {
          mode: mobile ? 'mobile-bottom-and-drawer' : 'desktop-sidebar',
          activeDesktopLink: Boolean(activeDesktopLink),
          mobileTriggerExpanded: mobileTrigger?.getAttribute('aria-expanded') || null,
          bottomPadding,
          mobileNavigationHeight: mobileRect?.height || 0,
        },
        checks,
      };
    })()`, true);

    const screenshotPath = path.join(screenshotDir, `${spec.name}.png`);
    const image = await browserWindow.webContents.capturePage();
    fs.writeFileSync(screenshotPath, image.toPNG());
    const failures = Object.entries(inspection.checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    if (rendererGone) consoleErrors.push(rendererGone);
    if (consoleErrors.length) failures.push("rendererConsoleErrors");
    return {
      name: spec.name,
      ...inspection,
      interaction,
      screenshotPath,
      consoleErrors,
      failures,
      passed: failures.length === 0,
    };
  } finally {
    if (!browserWindow.isDestroyed()) browserWindow.destroy();
  }
}

async function installDesktopSessionCookie(browserWindow, url) {
  if (!/^[a-f0-9]{64}$/i.test(desktopSessionProof)) return false;
  const target = new URL(url);
  await browserWindow.webContents.session.cookies.set({
    url: target.origin,
    name: "smart_kefu_desktop_session",
    value: desktopSessionProof,
    path: "/api",
    httpOnly: true,
    sameSite: "strict",
    secure: target.protocol === "https:",
  });
  return true;
}

async function loadUrlWithRetry(browserWindow, url, viewportName) {
  const attempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await browserWindow.loadURL(url);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await waitForReachableLoopback(url, 5_000);
      await delay(750 * attempt);
      if (!browserWindow.isDestroyed()) browserWindow.webContents.stop();
    }
  }
  throw new Error(`${viewportName} failed to load ${url} after ${attempts} attempts: ${lastError?.message || lastError}`);
}

async function waitForReachableLoopback(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      await response.body?.cancel();
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`web service was not reachable before renderer retry: ${lastError?.message || lastError || "unknown error"}`);
}

async function runDesktopNavigationInteraction(browserWindow) {
  return browserWindow.webContents.executeJavaScript(`(() => {
    const target = document.querySelector('a[data-section-id="send-center"]');
    if (!target) throw new Error('desktop send-center navigation link is missing');
    const rect = target.getBoundingClientRect();
    target.focus();
    target.click();
    return {
      target: 'a[data-section-id="send-center"]',
      wasVisible: rect.width > 0 && rect.height > 0,
      focusedBeforeClick: document.activeElement === target,
    };
  })()`, true);
}

async function runMobileNavigationInteraction(browserWindow) {
  const opened = await browserWindow.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('button[aria-controls="workbench-mobile-navigation"]');
    if (!trigger) throw new Error('mobile all-features trigger is missing');
    const rect = trigger.getBoundingClientRect();
    trigger.focus();
    trigger.click();
    return {
      target: 'button[aria-controls="workbench-mobile-navigation"]',
      wasVisible: rect.width > 0 && rect.height > 0,
      focusedBeforeClick: document.activeElement === trigger,
    };
  })()`, true);
  await waitFor(browserWindow, `document.querySelector('#workbench-mobile-navigation[role="dialog"]')`, 10_000);
  const selected = await browserWindow.webContents.executeJavaScript(`(() => {
    const drawer = document.querySelector('#workbench-mobile-navigation[role="dialog"]');
    const target = drawer?.querySelector('a[href="/send/queue"]');
    if (!target) throw new Error('send queue link is missing from mobile drawer');
    const rect = target.getBoundingClientRect();
    target.focus();
    target.click();
    return {
      target: '#workbench-mobile-navigation a[href="/send/queue"]',
      drawerVisible: Boolean(drawer && drawer.getBoundingClientRect().height > 0),
      targetVisible: rect.width > 0 && rect.height > 0,
      focusedBeforeClick: document.activeElement === target,
    };
  })()`, true);
  return { ...opened, drawerSelection: selected };
}

async function waitFor(browserWindow, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (browserWindow.isDestroyed()) throw new Error("renderer window was destroyed");
    try {
      if (await browserWindow.webContents.executeJavaScript(`Boolean(${expression})`, true)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`renderer wait timed out: ${expression}${lastError ? ` (${lastError.message})` : ""}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeProbe() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function block(error) {
  report.status = "blocked";
  report.passed = false;
  report.finishedAt = new Date().toISOString();
  report.blockers.push(error instanceof Error ? error.message : String(error));
  writeProbe();
  console.error(error?.stack || error);
  app.exit(2);
}
