"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const webUrl = String(process.env.ACCEPTANCE_WEB_URL || "").trim();
const outputPath = path.resolve(
  process.env.ACCEPTANCE_LAYOUT_OUTPUT || path.join(process.cwd(), ".runtime", "acceptance-layout-390.json"),
);
const screenshotPath = path.resolve(
  process.env.ACCEPTANCE_LAYOUT_SCREENSHOT || path.join(process.cwd(), ".runtime", "acceptance-layout-390.png"),
);
const userDataPath = path.join(path.dirname(outputPath), "electron-user-data");

fs.mkdirSync(userDataPath, { recursive: true });
app.setPath("userData", userDataPath);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

app.whenReady().then(run).catch(fail);

async function run() {
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?/i.test(webUrl)) {
    throw new Error("ACCEPTANCE_WEB_URL must be an explicit loopback HTTP URL");
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });

  const consoleErrors = [];
  const window = new BrowserWindow({
    width: 390,
    height: 844,
    useContentSize: true,
    show: false,
    backgroundColor: "#f5f5f7",
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on("console-message", (...args) => {
    const event = args[0];
    const level = typeof event === "object" && event ? event.level : args[1];
    const message = typeof event === "object" && event ? event.message : args[2];
    if (level === "error" || level === 3) consoleErrors.push(String(message || "unknown console error"));
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    consoleErrors.push(`renderer exited: ${details.reason}`);
  });

  await window.loadURL(webUrl);
  await waitFor(
    window,
    `document.querySelector('.rail button[data-section-id="send-center"]') && document.querySelector('.workspace')`,
    45_000,
  );
  await window.webContents.executeJavaScript(`(async () => {
    const target = document.querySelector('.rail button[data-section-id="send-center"]');
    target.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const current = document.querySelector('.rail button[data-section-id="send-center"]');
    const rail = current.closest('.rail');
    rail.scrollLeft = Math.max(0, current.offsetLeft - (rail.clientWidth - current.offsetWidth) / 2);
  })()`, true);
  await waitFor(
    window,
    `document.querySelector('.workspace')?.dataset.activeSection === 'send-center'`,
    15_000,
  );
  await delay(800);

  const inspection = await window.webContents.executeJavaScript(`(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const root = document.documentElement;
    const body = document.body;
    const workspace = document.querySelector('.workspace');
    const sendButton = document.querySelector('.rail button[data-section-id="send-center"]');
    const sendSection = document.querySelector('#send-center');
    const rail = sendButton?.closest('.rail');
    const buttonRect = sendButton?.getBoundingClientRect();
    const sectionRect = sendSection?.getBoundingClientRect();
    const sectionStyle = sendSection ? getComputedStyle(sendSection) : null;
    const bodyText = body?.innerText || '';
    const frameworkOverlay = Boolean(document.querySelector('[data-nextjs-toast], nextjs-portal [data-nextjs-error-overlay]'));
    const checks = {
      exactViewportWidth: viewport.width === 390,
      pageHasContent: bodyText.trim().length > 100,
      noFrameworkErrorOverlay: !frameworkOverlay && !/Application error|Unhandled Runtime Error/i.test(bodyText),
      noPageHorizontalOverflow: root.scrollWidth <= root.clientWidth + 1 && body.scrollWidth <= body.clientWidth + 1,
      sendCenterSelected: workspace?.dataset.activeSection === 'send-center' && sendButton?.classList.contains('active'),
      selectedControlVisible: Boolean(buttonRect && buttonRect.width > 0 && buttonRect.height > 0 && buttonRect.right > 0 && buttonRect.left < viewport.width),
      selectedPanelVisible: Boolean(
        sectionRect && sectionRect.width > 0 && sectionRect.height > 0 &&
        sectionStyle && sectionStyle.display !== 'none' && sectionStyle.visibility !== 'hidden'
      ),
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
      },
      interaction: {
        target: '.rail button[data-section-id="send-center"]',
        activeSection: workspace?.dataset.activeSection || null,
        activeClass: Boolean(sendButton?.classList.contains('active')),
        ariaCurrent: sendButton?.getAttribute('aria-current') || null,
        controlRect: buttonRect ? {
          left: buttonRect.left,
          right: buttonRect.right,
          width: buttonRect.width,
          height: buttonRect.height,
        } : null,
        railMetrics: rail ? {
          clientWidth: rail.clientWidth,
          scrollWidth: rail.scrollWidth,
          scrollLeft: rail.scrollLeft,
        } : null,
      },
      checks,
    };
  })()`, true);

  const image = await window.webContents.capturePage();
  fs.writeFileSync(screenshotPath, image.toPNG());
  const failures = Object.entries(inspection.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (consoleErrors.length) failures.push("rendererConsoleErrors");
  const result = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    renderer: "Electron Chromium",
    ...inspection,
    consoleErrors,
    failures,
    passed: failures.length === 0,
    screenshotPath,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  window.destroy();
  app.exit(result.passed ? 0 : 1);
}

async function waitFor(window, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await window.webContents.executeJavaScript(`Boolean(${expression})`, true)) return;
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

function fail(error) {
  const result = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    passed: false,
    failures: [error instanceof Error ? error.message : String(error)],
    consoleErrors: [],
    screenshotPath,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.error(error?.stack || error);
  app.exit(1);
}
